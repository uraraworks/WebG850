// 実在作品コーパスに対する到達度計測ハーネス。
//
// 目的: 「実在の作品が何本動くか」を機械的に測る（親 CLAUDE.md
// 「成功指標は実機と一致するかではなく実在の作品が動くか」節に対応）。
// このスクリプトはインタプリタ本体（src/basic/*, src/machine/*）を
// 一切変更せず、既存の公開 API（parseProgram / Interpreter / Machine）を
// 外から呼ぶだけの読み取り専用ハーネスとして書く。
//
// コーパスは第三者作品の調査目的の一時取得物であり、このリポジトリには
// 絶対にコミットしない。コーパスの場所は環境変数 G850_CORPUS から受け取る
// （既定値をソースへ焼き込まない。未指定はエラー終了）。
//
// 使い方: G850_CORPUS=/path/to/corpus/basic npm run measure
//         （出力先を変えたいときは第1引数 or --out=<dir>）
//
// 出力: <outDir>/corpus_result.json（機械可読）と
//       <outDir>/corpus_result.txt（人が読めるレポート）。
// 既定の出力先はこのファイルと同じリポジトリ直下の `measure-output/`
// （.gitignore 済み）。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILTINS } from '../src/basic/functions/index.ts';
import { parseProgram, parseStatementList, Cursor } from '../src/basic/parser.ts';
import { tokenizeProgram } from '../src/basic/tokenizer.ts';
import type { AssignTarget, InputItem, ProgramLine, Stmt } from '../src/basic/ast.ts';
import { variableValueType } from '../src/basic/value.ts';
import { Interpreter, type Suspend } from '../src/basic/interpreter.ts';
import { Machine } from '../src/machine/machine.ts';
import { getGlyph } from '../src/machine/font.ts';
import { CELL_HEIGHT, CELL_WIDTH, TEXT_COLS, TEXT_ROWS } from '../src/machine/screen.ts';

// ─────────────────────────────────────────────────────────────
// コーパスの読み込み
// ─────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function requireCorpusDir(): string {
  const dir = process.env.G850_CORPUS;
  if (!dir) {
    console.error(
      '[measure_corpus] 環境変数 G850_CORPUS が未設定です。' +
        'コーパス（*.txt が並ぶディレクトリ）のパスを指定してください。' +
        '例: G850_CORPUS=/path/to/corpus/basic npm run measure',
    );
    process.exit(1);
  }
  if (!existsSync(dir)) {
    console.error(`[measure_corpus] G850_CORPUS で指定されたディレクトリが存在しません: ${dir}`);
    process.exit(1);
  }
  return dir;
}

interface CorpusEntry {
  readonly id: string;
  readonly filePath: string;
  readonly source: string;
}

function loadCorpus(dir: string): CorpusEntry[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));
  return files
    .map((f) => {
      const filePath = join(dir, f);
      return { id: basename(f, '.txt'), filePath, source: readFileSync(filePath, 'utf8') };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ─────────────────────────────────────────────────────────────
// 静的到達度（主指標）
// ─────────────────────────────────────────────────────────────

interface ParseErrorInfo {
  readonly line: number | null;
  readonly message: string;
}

interface UnsupportedUsage {
  readonly name: string;
  readonly line: number | null;
}

interface StaticResult {
  readonly parseErrors: ParseErrorInfo[];
  readonly unsupportedUsages: UnsupportedUsage[];
  readonly pass: boolean;
}

/**
 * パース段階では「未実装」は例外ではなく AST 上のノード（UnsupportedStmt /
 * UnsupportedExpr）として表現される（parser.ts 参照）。加えて、パースは
 * 通るが実行時に UnsupportedError を投げる文が4種ある
 * （AutoStmt/DeleteStmt/PassStmt/RenumStmt — Phase 3 のエディタ系コマンドで、
 * interpreter.ts の executeStatement 側 switch に case が無く default 節へ
 * 落ちる）。実際に interpreter.ts の switch 節と ast.ts の Stmt 一覧を
 * 突き合わせて確認した差分をここに明示する（勘ではなくソース比較の結果）。
 * PrintUsing（PRINT USING の書式部分）と LcopyStmt（LCOPY）は例外を投げず
 * `machine.reportUnimplemented` だけを呼ぶ「部分未対応」だが、これも
 * 「実在作品がこの命令を使っているか」を知りたいという趣旨に合うため
 * 未実装カウントに含める。
 */
const RUNTIME_UNSUPPORTED_STMT_KINDS: ReadonlyMap<string, string> = new Map([
  ['AutoStmt', 'AUTO'],
  ['DeleteStmt', 'DELETE'],
  ['PassStmt', 'PASS'],
  ['RenumStmt', 'RENUM'],
  ['LcopyStmt', 'LCOPY'],
]);

/**
 * AST は「plain object の木」として作られている（ast.ts の各 interface に
 * メソッドは無い）ため、フィールド名を1つずつ知らなくても汎用の深さ優先探索で
 * 全ノードを網羅できる。将来 AST にフィールドが増えても取りこぼさない。
 */
function collectUnsupportedFromNode(
  node: unknown,
  lineNumber: number | null,
  out: UnsupportedUsage[],
  seen: Set<unknown>,
): void {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collectUnsupportedFromNode(item, lineNumber, out, seen);
    return;
  }

  const obj = node as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === 'UnsupportedStmt' || kind === 'UnsupportedExpr') {
    out.push({ name: String(obj.name), line: lineNumber });
  } else if (kind === 'PrintUsing') {
    out.push({ name: 'PRINT USING', line: lineNumber });
  } else if (typeof kind === 'string' && RUNTIME_UNSUPPORTED_STMT_KINDS.has(kind)) {
    out.push({ name: RUNTIME_UNSUPPORTED_STMT_KINDS.get(kind)!, line: lineNumber });
  }

  for (const key of Object.keys(obj)) {
    if (key === 'pos') continue; // 文字位置は木構造ではない（探索不要）
    collectUnsupportedFromNode(obj[key], lineNumber, out, seen);
  }
}

/**
 * 全行をトークナイズ＋パースする。`parseProgram` をそのまま使わない理由：
 * `parseProgram` は最初のパースエラーで例外を投げて全体を止めるため、
 * 「何行目にエラーがあるか」を1件しか拾えない。ここでは行ごとに
 * try/catch して、1つの作品内の複数エラーを全部集める。
 */
function analyzeStatic(source: string): StaticResult {
  const parseErrors: ParseErrorInfo[] = [];
  const unsupportedUsages: UnsupportedUsage[] = [];

  let lines: ReturnType<typeof tokenizeProgram>;
  try {
    lines = tokenizeProgram(source);
  } catch (e) {
    parseErrors.push({ line: null, message: e instanceof Error ? e.message : String(e) });
    return { parseErrors, unsupportedUsages, pass: false };
  }

  for (const line of lines) {
    const cursor = new Cursor(line.tokens, line.text);
    try {
      const statements = parseStatementList(cursor);
      for (const stmt of statements) {
        collectUnsupportedFromNode(stmt, line.lineNumber, unsupportedUsages, new Set());
      }
    } catch (e) {
      parseErrors.push({ line: line.lineNumber, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return { parseErrors, unsupportedUsages, pass: parseErrors.length === 0 && unsupportedUsages.length === 0 };
}

// ─────────────────────────────────────────────────────────────
// 実行到達度（副指標）
// ─────────────────────────────────────────────────────────────

/**
 * 文の実行数の予算。coreLoop は「行の先頭」でだけ `{kind:'yield'}` を返す
 * （1文ごとではない）ため、ここでの1カウントは概ね「1行の実行」に相当する。
 * 依頼の「200,000文」の精神を汲み、この粒度でのカウントに200,000を採用する。
 */
const STEP_BUDGET = 200_000;

/**
 * 万一 yield が挟まらない密なループ（例: 1行内で完結する FOR/NEXT の
 * 巨大反復）が STEP_BUDGET をすり抜けても、壁時計ベースでハーネス全体が
 * 止まらないようにする安全網。WAIT の実時間待機（Date.now() 基準）が
 * そのまま素通しになるため、正当な WAIT も飲み込む前提でやや長めに取る。
 */
const WALL_CLOCK_BUDGET_MS = 10_000;

type RuntimeStatus = 'RAN' | 'TIMEOUT' | 'ERROR';

interface RuntimeResult {
  readonly status: RuntimeStatus;
  readonly detail: string;
  readonly steps: number;
}

interface AssignTargetGroup {
  readonly targets: AssignTarget[];
}

/** interpreter.ts の private buildInputGroups と同じ規則（プロンプトごとに区切る）。 */
function buildInputGroups(items: readonly InputItem[]): AssignTargetGroup[] {
  const groups: AssignTargetGroup[] = [];
  let current: AssignTargetGroup | null = null;
  for (const item of items) {
    if (item.kind === 'InputPrompt') {
      current = { targets: [] };
      groups.push(current);
    } else {
      if (!current) {
        current = { targets: [] };
        groups.push(current);
      }
      current.targets.push(item);
    }
  }
  return groups;
}

/** `INPUT`/`WAIT`（引数無し）の行入力バッファへ直接書き込むための最小限の型。 */
interface KeyboardLineBufferAccess {
  lineBuffer: string;
  lineReady: boolean;
}

/**
 * INPUT のスタブ値を決める状態。同じ文（pc）に留まっている間はグループが
 * 1つずつ進む（executeInput の while ループと同じ前提）ので、pc が変わったら
 * カウンタをリセットする。
 */
interface InputStubState {
  pcKey: string | null;
  groupIndex: number;
}

/**
 * 現在の PC が指す INPUT 文を見て、型に応じたスタブ値（数値なら "1"、
 * 文字列なら "A"）をカンマ区切りの1行にして `Keyboard` の内部バッファへ
 * 直接書き込む。`INKEY$` 用バッファ（`inkeyBuffer`）は汚さないよう、
 * `handleKeyDown` は経由せず private フィールドへ直接書く
 * （依頼の「INKEY$ は空文字列を返す」を壊さないため）。
 */
function feedInputStub(
  interpreter: Interpreter,
  machine: Machine,
  program: readonly ProgramLine[],
  state: InputStubState,
): void {
  const pc = interpreter.pc;
  const pcKey = `${pc.lineIndex}:${pc.stmtIndex}`;
  if (state.pcKey !== pcKey) {
    state.pcKey = pcKey;
    state.groupIndex = 0;
  }

  let raw = '1';
  const stmt: Stmt | undefined = program[pc.lineIndex]?.statements[pc.stmtIndex];
  if (stmt && stmt.kind === 'InputStmt') {
    const groups = buildInputGroups(stmt.items);
    const group = groups[state.groupIndex] ?? groups[groups.length - 1];
    if (group && group.targets.length > 0) {
      raw = group.targets.map((t) => (variableValueType(t.name) === 'string' ? 'A' : '1')).join(',');
    }
  }
  state.groupIndex++;

  const kb = machine.keyboard as unknown as KeyboardLineBufferAccess;
  kb.lineBuffer = raw;
  kb.lineReady = true;
}

/** `WAIT`（引数無し）は ENTER 相当の行確定だけを待つ。中身は空でよい。 */
function feedEnterForWait(machine: Machine): void {
  const kb = machine.keyboard as unknown as KeyboardLineBufferAccess;
  kb.lineBuffer = '';
  kb.lineReady = true;
}

/**
 * 画面テキストの OCR デコード。`Screen` は文字列ログを持たない（ドット絵の
 * まま保持する設計）ため、`?ERROR n IN m` / `?UNSUPPORTED <name> IN m` を
 * 読み取るには自前でビットマップ→文字への逆変換が要る。`font.ts`
 * （自作フォント、ROM 非依存）と `writeText`/`putChar` が使っているのと
 * 同じ 6x8 セル・5x7 字形の規約を使い、セルごとに ASCII 0x20〜0x7E の
 * どれと一致するかを総当たりで探す。
 */
function decodeScreenText(machine: Machine): string {
  const rows: string[] = [];
  for (let row = 0; row < TEXT_ROWS; row++) {
    let line = '';
    for (let col = 0; col < TEXT_COLS; col++) {
      line += decodeCell(machine, col, row);
    }
    rows.push(line.replace(/\s+$/u, ''));
  }
  return rows.join('\n');
}

function decodeCell(machine: Machine, col: number, row: number): string {
  const x0 = col * CELL_WIDTH;
  const y0 = row * CELL_HEIGHT;
  for (let code = 0x20; code <= 0x7e; code++) {
    const glyph = getGlyph(code);
    let matched = true;
    outer: for (let gx = 0; gx < 5; gx++) {
      for (let gy = 0; gy < 7; gy++) {
        const want = (glyph[gx] >> gy) & 1;
        const got = machine.screen.point(x0 + gx, y0 + gy);
        if (want !== got) {
          matched = false;
          break outer;
        }
      }
    }
    if (matched) return String.fromCharCode(code);
  }
  return ' '; // 既知のグリフに一致しない（未定義コードの箱型グリフ等）は空白扱い
}

function runProgram(source: string): RuntimeResult {
  let program: ProgramLine[];
  try {
    program = parseProgram(source);
  } catch (e) {
    return { status: 'ERROR', detail: `PARSE: ${e instanceof Error ? e.message : String(e)}`, steps: 0 };
  }

  const machine = new Machine(1);
  const interpreter = new Interpreter(program, machine, BUILTINS);
  const gen = interpreter.run();

  const inputState: InputStubState = { pcKey: null, groupIndex: 0 };
  let steps = 0;
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;

  try {
    let res = gen.next();
    while (!res.done) {
      const suspend: Suspend = res.value;

      if (suspend.kind === 'yield') {
        steps++;
        if (steps > STEP_BUDGET) {
          return { status: 'TIMEOUT', detail: `steps>${STEP_BUDGET}`, steps };
        }
      }
      if (Date.now() > deadline) {
        return { status: 'TIMEOUT', detail: `wall clock > ${WALL_CLOCK_BUDGET_MS}ms`, steps };
      }

      if (suspend.kind === 'input') {
        feedInputStub(interpreter, machine, program, inputState);
      } else if (suspend.kind === 'wait' && suspend.ms === -1) {
        // WAIT（引数無し）は ENTER 待ち。Date.now() 基準の実時間待機
        // （ms > 0）はスタブせず、素通しにして再チェックさせる
        // （executeWait は毎回 Date.now() を読み直すので busy loop で自然に進む）。
        feedEnterForWait(machine);
      }

      res = gen.next();
    }
  } catch (e) {
    // BasicError/UnsupportedError は coreLoop 内部で捕捉されて画面表示に
    // 変換される設計（interpreter.ts 参照）なので、ここに到達する例外は
    // ハーネス側の呼び方の誤りかインタプリタ外の想定外エラー。
    return { status: 'ERROR', detail: `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`, steps };
  }

  const text = decodeScreenText(machine);
  const unsupportedMatch = text.match(/\?UNSUPPORTED (\S+)(?: IN (\d+))?/);
  if (unsupportedMatch) {
    const line = unsupportedMatch[2] ? ` IN ${unsupportedMatch[2]}` : '';
    return { status: 'ERROR', detail: `UNSUPPORTED ${unsupportedMatch[1]}${line}`, steps };
  }
  const errorMatch = text.match(/\?ERROR (\d+)(?: IN (\d+))?/);
  if (errorMatch) {
    const line = errorMatch[2] ? ` IN ${errorMatch[2]}` : '';
    return { status: 'ERROR', detail: `ERROR ${errorMatch[1]}${line}`, steps };
  }
  return { status: 'RAN', detail: '', steps };
}

// ─────────────────────────────────────────────────────────────
// 集計・出力
// ─────────────────────────────────────────────────────────────

interface WorkResult {
  readonly id: string;
  readonly staticResult: StaticResult;
  readonly runtimeResult: RuntimeResult;
}

function main(): void {
  const corpusDir = requireCorpusDir();
  const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='));
  const outDir = outArg ? outArg.slice('--out='.length) : join(REPO_ROOT, 'measure-output');
  mkdirSync(outDir, { recursive: true });

  const entries = loadCorpus(corpusDir);
  if (entries.length === 0) {
    console.error(`[measure_corpus] コーパスが見つかりません（*.txt が0件）: ${corpusDir}`);
    process.exit(1);
  }

  const results: WorkResult[] = entries.map((entry) => {
    const staticResult = analyzeStatic(entry.source);
    let runtimeResult: RuntimeResult;
    try {
      runtimeResult = runProgram(entry.source);
    } catch (e) {
      runtimeResult = { status: 'ERROR', detail: `HARNESS: ${e instanceof Error ? e.message : String(e)}`, steps: 0 };
    }
    return { id: entry.id, staticResult, runtimeResult };
  });

  // ── 集計 ──
  const total = results.length;
  const staticPass = results.filter((r) => r.staticResult.pass);
  const staticFailParse = results.filter((r) => r.staticResult.parseErrors.length > 0);
  const staticFailUnsupportedOnly = results.filter(
    (r) => r.staticResult.parseErrors.length === 0 && r.staticResult.unsupportedUsages.length > 0,
  );

  const unsupportedByWorkCount = new Map<string, number>();
  for (const r of results) {
    const names = new Set(r.staticResult.unsupportedUsages.map((u) => u.name));
    for (const name of names) {
      unsupportedByWorkCount.set(name, (unsupportedByWorkCount.get(name) ?? 0) + 1);
    }
  }
  const unsupportedRanking = Array.from(unsupportedByWorkCount.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const runtimeCounts = { RAN: 0, TIMEOUT: 0, ERROR: 0 } as Record<RuntimeStatus, number>;
  for (const r of results) runtimeCounts[r.runtimeResult.status]++;

  // ── JSON 出力 ──
  const jsonPath = join(outDir, 'corpus_result.json');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        corpusDir,
        total,
        summary: {
          staticPass: staticPass.length,
          staticFailParse: staticFailParse.length,
          staticFailUnsupportedOnly: staticFailUnsupportedOnly.length,
          runtime: runtimeCounts,
        },
        unsupportedRanking: unsupportedRanking.map(([name, count]) => ({ name, worksUsing: count })),
        works: results,
      },
      null,
      2,
    ),
    'utf8',
  );

  // ── テキストレポート出力 ──
  const lines: string[] = [];
  lines.push(`計測日時: ${new Date().toISOString()}`);
  lines.push(`コーパス: ${corpusDir}`);
  lines.push(`作品数: ${total}`);
  lines.push('');
  lines.push('## 静的到達度（主指標）');
  lines.push(`PASS（パースエラー0 かつ 未実装0）: ${staticPass.length}/${total}`);
  lines.push(`FAIL（パースエラーあり）: ${staticFailParse.length}/${total}`);
  lines.push(`FAIL（未実装のみ・パース自体は成功）: ${staticFailUnsupportedOnly.length}/${total}`);
  lines.push('');
  lines.push('## 実行到達度（副指標）');
  lines.push(`RAN: ${runtimeCounts.RAN}/${total}`);
  lines.push(`TIMEOUT: ${runtimeCounts.TIMEOUT}/${total}`);
  lines.push(`ERROR: ${runtimeCounts.ERROR}/${total}`);
  lines.push('');
  lines.push('## 未実装機能の使用作品数ランキング（全件）');
  if (unsupportedRanking.length === 0) {
    lines.push('（未実装の使用は検出されませんでした）');
  } else {
    for (const [name, count] of unsupportedRanking) {
      lines.push(`${count}\t${name}`);
    }
  }
  lines.push('');
  lines.push('## FAIL 一覧（静的：パースエラーまたは未実装）');
  for (const r of results) {
    if (r.staticResult.pass) continue;
    lines.push(`- ${r.id}`);
    for (const pe of r.staticResult.parseErrors) {
      lines.push(`    parse error${pe.line !== null ? ` (line ${pe.line})` : ''}: ${pe.message}`);
    }
    const names = Array.from(new Set(r.staticResult.unsupportedUsages.map((u) => u.name)));
    for (const name of names) {
      const linesForName = r.staticResult.unsupportedUsages
        .filter((u) => u.name === name)
        .map((u) => u.line)
        .filter((l): l is number => l !== null);
      lines.push(`    unsupported: ${name}${linesForName.length > 0 ? ` (line ${linesForName.join(', ')})` : ''}`);
    }
  }
  lines.push('');
  lines.push('## 実行到達度 詳細（RAN 以外）');
  for (const r of results) {
    if (r.runtimeResult.status === 'RAN') continue;
    lines.push(`- ${r.id}: ${r.runtimeResult.status} ${r.runtimeResult.detail} (steps=${r.runtimeResult.steps})`);
  }

  const txtPath = join(outDir, 'corpus_result.txt');
  writeFileSync(txtPath, lines.join('\n') + '\n', 'utf8');

  console.log(lines.join('\n'));
  console.log('');
  console.log(`[measure_corpus] JSON: ${jsonPath}`);
  console.log(`[measure_corpus] TXT : ${txtPath}`);
}

main();
