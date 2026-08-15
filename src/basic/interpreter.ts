// 実行エンジン（ジェネレータ）。docs/design/phase1_runtime.md（今回の最重要資料）と
// docs/design/phase1_architecture.md「実行モデル」節に従う。
//
// ブロック構造（WHILE/WEND, REPEAT/UNTIL, IF/ELSE/ENDIF）は AST に畳まれていないため、
// 実行時に前方走査でマッチングする（GOTO でブロックを跨いでも壊れない設計の要）。

import type {
  AssignTarget,
  DataValue,
  Expr,
  ForStmt,
  IfClause,
  InputItem,
  InputPrompt,
  JumpTarget,
  ProgramLine,
  Stmt,
} from './ast.js';
import type { FillPattern } from '../machine/screen.ts';
import {
  type AngleMode,
  type BuiltinContext,
  type BuiltinTable,
  Evaluator,
  VariableStore,
} from './evaluator.js';
import { BasicError, ErrorCode, UnsupportedError } from './errors.js';
import type { Machine } from '../machine/machine.ts';
import {
  ANGLE_MODE_RESET_ON_RUN,
  FOR_CHECKS_BEFORE_BODY,
  GRAPHICS_CURSOR_FOLLOWS_DRAWING,
  INPUT_ON_INVALID_NUMBER_REDO,
  markUncertainUsed,
  type UncertainId,
} from './uncertain.js';
import { formatNumber } from './number.js';
import {
  asNumeric,
  type BasicValue,
  isNumeric,
  numeric,
  str,
  typeMismatchError,
  variableValueType,
} from './value.js';

// ─────────────────────────────────────────────────────────────
// 実行位置・中断
// ─────────────────────────────────────────────────────────────

/** 実行位置。行は`program`配列の添字（`lineIndex`）で指す。 */
export interface PC {
  readonly lineIndex: number;
  readonly stmtIndex: number;
}

/** docs/design/phase1_architecture.md「実行モデル」節の Suspend 型。 */
export type Suspend =
  | { kind: 'input'; prompt: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'yield' }
  | { kind: 'end' };

/** 1文の実行結果。ディスパッチャが次に何をすべきかを示す。 */
type StmtResult = 'advance' | 'jumped' | Suspend;

// ─────────────────────────────────────────────────────────────
// ループスタック
// ─────────────────────────────────────────────────────────────
//
// docs/design/phase1_runtime.md「スタック」節：ループ／呼び出し／DATAポインタを
// 別々に持つ。ループは FOR/WHILE/REPEAT を1本のスタックへ混在させる
// （NEXT の巻き戻しが同じスタック上で完結できるようにするため）。

interface ForLoopEntry {
  readonly kind: 'FOR';
  readonly variable: string;
  readonly to: number;
  readonly step: number;
  /** NEXT でループ継続時に戻る先（FOR ヘッダの直後）。 */
  readonly bodyPC: PC;
}

interface WhileLoopEntry {
  readonly kind: 'WHILE';
  /** WEND でループ継続時に戻る先（WHILE ヘッダ自身。条件を再評価する）。 */
  readonly headerPC: PC;
}

interface RepeatLoopEntry {
  readonly kind: 'REPEAT';
  /** UNTIL でループ継続時に戻る先（REPEAT の直後）。 */
  readonly headerPC: PC;
}

type LoopEntry = ForLoopEntry | WhileLoopEntry | RepeatLoopEntry;

interface DataItem {
  readonly value: DataValue;
  readonly pc: PC;
  readonly lineNumber: number | null;
}

/** `INPUT` の「メッセージ1つ＋それに続く変数群」の単位（`executeInput` 参照）。 */
interface InputGroup {
  readonly prompt: InputPrompt | null;
  readonly targets: AssignTarget[];
}

// ─────────────────────────────────────────────────────────────
// インタプリタ本体
// ─────────────────────────────────────────────────────────────

export class Interpreter {
  readonly variables = new VariableStore();
  readonly machine: Machine;

  private readonly program: readonly ProgramLine[];
  /** 行番号 → program配列の添字。GOTO のたびに線形探索しないための対応表。 */
  private readonly lineIndex = new Map<number, number>();
  /** ラベル名（`*ラベル`）→ 実行位置。 */
  private readonly labelIndex = new Map<string, PC>();

  private dataItems: DataItem[] = [];
  private dataPointer = 0;

  pc: PC = { lineIndex: 0, stmtIndex: 0 };
  private loopStack: LoopEntry[] = [];
  private callStack: PC[] = [];
  private tron = false;
  private breakRequested = false;
  /** INPUT/WAIT で同じ文へ再突入するときに行頭処理を1回だけスキップするためのフラグ。 */
  private suspendedAtSamePC = false;

  angleMode: AngleMode = 'DEG';
  /** 実行中かどうか（`START`/`GOTO`しても行が尽きたら false になる）。 */
  running = false;
  /** `CONT` で再開できる状態か（BREAK/STOP/END の直後は true、ERROR/未実装は false）。 */
  contAvailable = false;

  private readonly builtins: BuiltinTable;
  private readonly builtinContext: BuiltinContext;
  private readonly evaluator: Evaluator;

  constructor(program: readonly ProgramLine[], machine: Machine, builtins: BuiltinTable = {}) {
    this.program = program;
    this.machine = machine;
    // POINT は画面（machine/screen.ts）に依存するため functions/index.ts の
    // BUILTINS には含まれていない（同ファイルのコメント参照）。「画面を持つ
    // 実装から BUILTINS へ足す想定」どおり、画面にアクセスできるここで足す。
    this.builtins = {
      ...builtins,
      POINT: {
        minArgs: 2,
        maxArgs: 2,
        fn: (args) => {
          const x = Math.trunc(asNumeric(args[0]));
          const y = Math.trunc(asNumeric(args[1]));
          return numeric(this.machine.screen.point(x, y));
        },
      },
    };

    program.forEach((line, idx) => {
      if (line.lineNumber !== null) {
        this.lineIndex.set(line.lineNumber, idx);
      }
      line.statements.forEach((stmt, stmtIdx) => {
        if (stmt.kind === 'LabelStmt') {
          this.labelIndex.set(stmt.name, { lineIndex: idx, stmtIndex: stmtIdx });
        }
      });
    });

    this.builtinContext = {
      angleMode: this.angleMode,
      rnd: () => this.machine.rnd(),
      inkey: () => this.machine.keyboard.inkey(),
      markUncertainUsed: (id: string) => markUncertainUsed(id as UncertainId),
    };
    this.evaluator = new Evaluator(this.variables, this.builtins, this.builtinContext);

    this.collectData();
  }

  /** `DATA` はプログラム全体を走査して事前収集する（実行されない行の DATA も読める）。 */
  private collectData(): void {
    const items: DataItem[] = [];
    this.program.forEach((line, lineIdx) => {
      line.statements.forEach((stmt, stmtIdx) => {
        if (stmt.kind === 'DataStmt') {
          for (const value of stmt.values) {
            items.push({ value, pc: { lineIndex: lineIdx, stmtIndex: stmtIdx }, lineNumber: line.lineNumber });
          }
        }
      });
    });
    this.dataItems = items;
  }

  /** 外部（キー入力ハンドラ等）から BREAK キー相当を伝える。 */
  requestBreak(): void {
    this.breakRequested = true;
  }

  // ── 公開エントリポイント ────────────────────────────────

  /**
   * `RUN` 共通の初期化処理（変数・スタック・DATAポインタ・TRON状態のリセット）。
   * 外部エントリポイントの `run()` と、プログラム中に書かれた `RUN` 文
   * （`executeRunStmt`）の双方から呼ばれる。
   */
  private resetForRun(): void {
    this.variables.clear();
    this.loopStack = [];
    this.callStack = [];
    this.dataPointer = 0;
    this.tron = false;
    this.breakRequested = false;
    // docs/design/phase1_runtime.md「角度モード」節：RUN でリセットするかは不確定。
    // ANGLE_MODE_RESET_ON_RUN（暫定 false ＝維持）に従う。
    markUncertainUsed('ANGLE_MODE_RESET_ON_RUN');
    if (ANGLE_MODE_RESET_ON_RUN) {
      this.angleMode = 'DEG';
      this.builtinContext.angleMode = 'DEG';
    }
    this.contAvailable = false;
  }

  /** `RUN` 相当。先頭から実行する。変数・スタック・DATAポインタを初期化する。 */
  *run(): Generator<Suspend, void, void> {
    this.resetForRun();
    this.pc = { lineIndex: 0, stmtIndex: 0 };
    yield* this.coreLoop();
  }

  /** `CONT` 相当。BREAK/STOP/END で止まった状態から再開する。状態は保持済みのものをそのまま使う。 */
  *cont(): Generator<Suspend, void, void> {
    if (!this.contAvailable) {
      throw new BasicError(ErrorCode.CONT_INVALID_STATE, 'CONT: 再開できる状態ではありません');
    }
    this.contAvailable = false;
    yield* this.coreLoop();
  }

  // ── 実行ループ ──────────────────────────────────────────

  private *coreLoop(): Generator<Suspend, void, void> {
    this.running = true;
    for (;;) {
      if (!this.running) {
        yield { kind: 'end' };
        return;
      }

      const line = this.program[this.pc.lineIndex];
      if (!line) {
        // プログラム終端まで実行し尽くした（暗黙の END）。
        this.running = false;
        this.contAvailable = false;
        continue;
      }

      // INPUT/WAIT で同じ文を再開する場合、pc は据え置かれたままここへ戻ってくる。
      // その場合は行頭の BREAK確認/TRON/yield を再実行しない
      // （多重にTRON表示やyieldが挟まるのを防ぐ。`suspendedAtSamePC` 参照）。
      if (this.pc.stmtIndex === 0 && !this.suspendedAtSamePC) {
        // TRON / BREAK 確認 / 画面更新の譲渡は「行の実行ループの先頭に1箇所だけ」
        // （docs/design/phase1_runtime.md「TRON / TROFF」節）。
        if (this.breakRequested) {
          this.breakRequested = false;
          this.haltWithMessage('BREAK', line.lineNumber, true, true);
          continue;
        }
        if (this.tron && line.lineNumber !== null) {
          this.machine.screen.writeText(`[${line.lineNumber}]`);
        }
        yield { kind: 'yield' };
      }
      this.suspendedAtSamePC = false;

      const stmt = line.statements[this.pc.stmtIndex];
      if (!stmt) {
        this.pc = { lineIndex: this.pc.lineIndex + 1, stmtIndex: 0 };
        continue;
      }

      let result: StmtResult;
      try {
        result = this.executeStatement(stmt);
      } catch (e) {
        if (e instanceof BasicError) {
          this.haltWithMessage(`ERROR ${e.code}`, e.lineNumber ?? line.lineNumber, false, true);
          continue;
        }
        if (e instanceof UnsupportedError) {
          this.machine.reportUnimplemented(e.name_);
          this.haltWithMessage(`?UNSUPPORTED ${e.name_}`, e.lineNumber ?? line.lineNumber, false, true);
          continue;
        }
        throw e;
      }

      // END/STOP はこの文自身が this.running = false にするが、CONT で「この文の次」
      // から再開できるよう、running の状態に関わらず pc の advance/jump は必ず適用する
      // （ループ先頭の `if (!this.running)` が次の反復で停止処理を行う）。
      if (result === 'advance') {
        this.pc = { lineIndex: this.pc.lineIndex, stmtIndex: this.pc.stmtIndex + 1 };
      } else if (result === 'jumped') {
        // pc はハンドラ側で既に更新済み。
      } else {
        // INPUT/WAIT のキー入力・時間待ち。pc はこの文のまま据え置き、
        // 次回 coreLoop に戻ってきたときに同じ文（executeStatement）を
        // 呼び直して続きから再開する（inputState 等はインタプリタ側で保持）。
        this.suspendedAtSamePC = true;
        yield result;
      }
    }
  }

  /** 実行を停止し、必要ならメッセージを画面へ出す。 */
  private haltWithMessage(
    prefix: string,
    lineNumber: number | null | undefined,
    contAvailable: boolean,
    printMessage: boolean,
  ): void {
    this.running = false;
    this.contAvailable = contAvailable;
    if (printMessage) {
      const n = lineNumber ?? '?';
      this.machine.screen.writeText(`\n${prefix} IN ${n}\n`);
    }
  }

  // ── 前方走査（ブロック構造は AST に畳んでいないので実行時にマッチングする） ──

  private statementAt(pc: PC): Stmt | undefined {
    return this.program[pc.lineIndex]?.statements[pc.stmtIndex];
  }

  private advancePosition(pc: PC): PC | null {
    const line = this.program[pc.lineIndex];
    if (!line) return null;
    if (pc.stmtIndex + 1 < line.statements.length) {
      return { lineIndex: pc.lineIndex, stmtIndex: pc.stmtIndex + 1 };
    }
    const nextLineIdx = pc.lineIndex + 1;
    if (nextLineIdx >= this.program.length) return null;
    return { lineIndex: nextLineIdx, stmtIndex: 0 };
  }

  private pastEndPC(): PC {
    return { lineIndex: this.program.length, stmtIndex: 0 };
  }

  private nextOf(pc: PC): PC {
    return this.advancePosition(pc) ?? this.pastEndPC();
  }

  /**
   * `from` の次の文から前方走査し、`openKind` と同種のネストを数えながら
   * 深さ0で最初に現れる `closeKinds` のいずれかの位置を返す。
   * 見つからなければ null（プログラム終端まで対応する閉じが無い）。
   */
  private scanForward(
    from: PC,
    openKind: Stmt['kind'],
    closeKinds: readonly Stmt['kind'][],
  ): PC | null {
    let pos = this.advancePosition(from);
    let depth = 0;
    while (pos) {
      const stmt = this.statementAt(pos);
      if (stmt) {
        if (stmt.kind === openKind) {
          depth++;
        } else if (closeKinds.includes(stmt.kind)) {
          if (depth === 0) return pos;
          depth--;
        }
      }
      pos = this.advancePosition(pos);
    }
    return null;
  }

  private resolveTarget(target: JumpTarget): PC {
    if (target.kind === 'LineNumberTarget') {
      const idx = this.lineIndex.get(target.value);
      if (idx === undefined) {
        throw new BasicError(ErrorCode.UNDEFINED_LINE, `存在しない行番号です: ${target.value}`);
      }
      return { lineIndex: idx, stmtIndex: 0 };
    }
    const pc = this.labelIndex.get(target.name);
    if (pc === undefined) {
      throw new BasicError(ErrorCode.UNDEFINED_LINE, `存在しないラベルです: ${target.name}`);
    }
    return pc;
  }

  private comparePC(a: PC, b: PC): number {
    return a.lineIndex - b.lineIndex || a.stmtIndex - b.stmtIndex;
  }

  // ── 代入 ────────────────────────────────────────────────

  private assignTo(target: AssignTarget, value: BasicValue): void {
    const expectedType = variableValueType(target.name);
    if (value.type !== expectedType) {
      throw typeMismatchError(`${target.name}: 代入する値の型が一致しません`);
    }
    if (target.kind === 'VariableRef') {
      this.variables.setScalar(target.name, value);
    } else {
      const indices = this.evaluator.evalIndices(target.indices);
      this.variables.setArrayElement(target.name, indices, value);
    }
  }

  // ── PRINT ───────────────────────────────────────────────

  /**
   * `,` 区切りのゾーン送り幅。docs/spec/basic_commands.yaml PRINT の summary
   * 「カンマ区切りは12桁ゾーン単位」より（不確定仕様ではなく仕様書に明記された値）。
   */
  private static readonly PRINT_ZONE_WIDTH = 12;

  private printZoneTab(): void {
    const { col, row } = this.machine.screen.cursor;
    const next = (Math.floor(col / Interpreter.PRINT_ZONE_WIDTH) + 1) * Interpreter.PRINT_ZONE_WIDTH;
    const cols = 24; // TEXT_COLS。screen.ts の定数を直接importしてもよいが循環を避け値で持つ。
    if (next >= cols) {
      this.machine.screen.writeText('\n');
    } else {
      this.machine.screen.locate(next, row);
    }
  }

  private executePrint(stmt: Extract<Stmt, { kind: 'PrintStmt' }>): StmtResult {
    for (const seg of stmt.items) {
      if (seg.sep === ',') {
        this.printZoneTab();
      }
      if (seg.value.kind === 'PrintUsing') {
        // 【判断】 USING の書式解釈は未対応（依頼スコープ外）。無言で無視せず記録した上で、
        // 以降の項目は書式なしでそのまま出力を続ける。
        this.machine.reportUnimplemented('PRINT USING');
        continue;
      }
      const value = this.evaluator.evaluate(seg.value);
      const text = isNumeric(value) ? formatNumber(value.value) : value.value;
      this.machine.screen.writeText(text);
    }
    if (stmt.trailingSep === null) {
      this.machine.screen.writeText('\n');
    } else if (stmt.trailingSep === ',') {
      this.printZoneTab();
    }
    // trailingSep === ';' は何もしない（次のPRINTがそのまま連結される）。
    return 'advance';
  }

  // ── INPUT ───────────────────────────────────────────────
  //
  // 【設計】 INPUT は「メッセージ表示 → 1行入力待ち（yield）→ カンマ区切りで
  // 複数変数へ代入」を、メッセージが挟まるたびに繰り返す。yield を挟んだ再開のため
  // 状態（どのグループまで処理したか）を `inputState` に保持し、次に coreLoop から
  // 呼ばれたときに続きから再開する（pc はこの文のまま据え置かれる。coreLoop 側の
  // `suspendedAtSamePC` フラグ参照）。
  //
  // 【判断】 `InputPrompt` はメッセージ文字列（Expr）を持つが、grammar上は文字列
  // リテラル以外の式が来ることは想定していない。`asString` で評価するのではなく
  // 一般の `evaluate` 結果をそのまま文字列化する（数値式が来ても壊れないように）。

  private inputGroupsCache: { items: readonly InputItem[]; groups: InputGroup[] } | null = null;
  private inputState: { groups: InputGroup[]; groupIndex: number; promptShown: boolean } | null = null;

  private buildInputGroups(items: readonly InputItem[]): InputGroup[] {
    if (this.inputGroupsCache && this.inputGroupsCache.items === items) {
      return this.inputGroupsCache.groups;
    }
    const groups: InputGroup[] = [];
    let current: InputGroup | null = null;
    for (const item of items) {
      if (item.kind === 'InputPrompt') {
        current = { prompt: item, targets: [] };
        groups.push(current);
      } else {
        if (!current) {
          current = { prompt: null, targets: [] };
          groups.push(current);
        }
        current.targets.push(item);
      }
    }
    this.inputGroupsCache = { items, groups };
    return groups;
  }

  /**
   * INPUT で入力された1行分の生テキストを、対象変数の型に応じて変換する。
   * 数値変数への変換に失敗したときは `null` を返す（呼び出し側が
   * `INPUT_ON_INVALID_NUMBER_REDO` に従って再入力を求める。
   * `docs/basic/uncertain.ts` の該当項参照）。
   */
  private convertInputValue(raw: string, target: AssignTarget): BasicValue | null {
    if (variableValueType(target.name) === 'string') {
      return str(raw);
    }
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (Number.isNaN(n)) return null;
    return numeric(n);
  }

  private executeInput(stmt: Extract<Stmt, { kind: 'InputStmt' }>): StmtResult {
    if (!this.inputState) {
      this.inputState = { groups: this.buildInputGroups(stmt.items), groupIndex: 0, promptShown: false };
    }
    const st = this.inputState;
    while (st.groupIndex < st.groups.length) {
      const group = st.groups[st.groupIndex];
      if (!st.promptShown) {
        if (group.prompt) {
          const msgValue = this.evaluator.evaluate(group.prompt.message);
          const msg = isNumeric(msgValue) ? formatNumber(msgValue.value) : msgValue.value;
          this.machine.screen.writeText(msg);
          if (!group.prompt.quiet) this.machine.screen.writeText('?');
        } else {
          this.machine.screen.writeText('?');
        }
        st.promptShown = true;
      }
      if (!this.machine.keyboard.isLineReady()) {
        return { kind: 'input', prompt: '' };
      }
      const line = this.machine.keyboard.takeLine();
      this.machine.screen.writeText(`${line}\n`);
      const parts = line.split(',');
      const converted: BasicValue[] = [];
      let invalid = false;
      for (let i = 0; i < group.targets.length; i++) {
        const raw = (parts[i] ?? '').trim();
        const value = this.convertInputValue(raw, group.targets[i]);
        if (value === null) {
          invalid = true;
          break;
        }
        converted.push(value);
      }
      if (invalid) {
        markUncertainUsed('INPUT_ON_INVALID_NUMBER');
        if (INPUT_ON_INVALID_NUMBER_REDO) {
          // 同じグループ（プロンプト＋変数群）を再入力させる。pc はこの文のまま
          // 据え置かれているので、次に coreLoop から呼ばれたときにこの while が
          // 同じ groupIndex から再開する。
          st.promptShown = false;
          continue;
        }
        // 旧挙動（暫定オフ時）：0 を代入して継続する。
        group.targets.forEach((target, i) => {
          this.assignTo(target, variableValueType(target.name) === 'string' ? str('') : numeric(0));
        });
        st.groupIndex++;
        st.promptShown = false;
        continue;
      }
      group.targets.forEach((target, i) => {
        this.assignTo(target, converted[i]);
      });
      st.groupIndex++;
      st.promptShown = false;
    }
    this.inputState = null;
    return 'advance';
  }

  // ── DATA / READ / RESTORE ──────────────────────────────

  private convertDataValue(dv: DataValue, target: AssignTarget): BasicValue {
    const expectedType = variableValueType(target.name);
    if (expectedType === 'string') {
      return str(dv.text);
    }
    const n = Number(dv.text.trim());
    if (Number.isNaN(n)) {
      throw typeMismatchError(`READ: "${dv.text}" を数値に変換できません`);
    }
    return numeric(n);
  }

  private executeRead(stmt: Extract<Stmt, { kind: 'ReadStmt' }>): StmtResult {
    for (const target of stmt.targets) {
      if (this.dataPointer >= this.dataItems.length) {
        throw new BasicError(ErrorCode.OUT_OF_DATA, 'READ: 読み込む DATA がありません');
      }
      const item = this.dataItems[this.dataPointer];
      this.dataPointer++;
      this.assignTo(target, this.convertDataValue(item.value, target));
    }
    return 'advance';
  }

  private executeRestore(stmt: Extract<Stmt, { kind: 'RestoreStmt' }>): StmtResult {
    if (!stmt.target) {
      this.dataPointer = 0;
      return 'advance';
    }
    if (stmt.target.kind === 'LineNumberTarget') {
      const n = stmt.target.value;
      const idx = this.dataItems.findIndex((it) => it.lineNumber !== null && it.lineNumber >= n);
      this.dataPointer = idx === -1 ? this.dataItems.length : idx;
      return 'advance';
    }
    const targetPC = this.resolveTarget(stmt.target);
    const idx = this.dataItems.findIndex((it) => this.comparePC(it.pc, targetPC) >= 0);
    this.dataPointer = idx === -1 ? this.dataItems.length : idx;
    return 'advance';
  }

  // ── FOR / NEXT ──────────────────────────────────────────

  private executeFor(stmt: ForStmt): StmtResult {
    const fromVal = asNumeric(this.evaluator.evaluate(stmt.from));
    const toVal = asNumeric(this.evaluator.evaluate(stmt.to));
    const stepVal = stmt.step ? asNumeric(this.evaluator.evaluate(stmt.step)) : 1;
    this.variables.setScalar(stmt.variable.name, numeric(fromVal));

    // docs/design/phase1_runtime.md「FOR の判定順序」節：前判定
    // （FOR_CHECKS_BEFORE_BODY=true）を暫定採用。
    markUncertainUsed('FOR_CHECKS_BEFORE_BODY');
    const outOfRange = stepVal >= 0 ? fromVal > toVal : fromVal < toVal;
    const skip = FOR_CHECKS_BEFORE_BODY && outOfRange;

    if (skip) {
      const closePC = this.scanForward(this.pc, 'ForStmt', ['NextStmt']);
      if (!closePC) {
        // basic_errors.yaml に「FORに対応するNEXTが無い」専用の番号は無いため、
        // 構文エラー(10)を流用する（判断点）。
        throw new BasicError(ErrorCode.SYNTAX, 'FOR: 対応する NEXT が見つかりません');
      }
      this.pc = this.nextOf(closePC);
      return 'jumped';
    }

    this.loopStack.push({
      kind: 'FOR',
      variable: stmt.variable.name,
      to: toVal,
      step: stepVal,
      bodyPC: this.nextOf(this.pc),
    });
    return 'advance';
  }

  private executeNext(stmt: Extract<Stmt, { kind: 'NextStmt' }>): StmtResult {
    if (stmt.variable) {
      const name = stmt.variable.name;
      let found = -1;
      for (let i = this.loopStack.length - 1; i >= 0; i--) {
        const e = this.loopStack[i];
        if (e.kind === 'FOR' && e.variable === name) {
          found = i;
          break;
        }
      }
      if (found === -1) {
        throw new BasicError(ErrorCode.NEXT_WITHOUT_FOR, `NEXT ${name}: 対応する FOR がありません`);
      }
      // NEXT <変数> でスタック最上位でない場合は、その変数が見つかるまで
      // 内側のループを暗黙に閉じる（巻き戻す）。
      this.loopStack.length = found + 1;
    } else if (this.loopStack.length === 0 || this.loopStack[this.loopStack.length - 1].kind !== 'FOR') {
      throw new BasicError(ErrorCode.NEXT_WITHOUT_FOR, 'NEXT: 対応する FOR がありません');
    }

    const entry = this.loopStack[this.loopStack.length - 1] as ForLoopEntry;
    const current = asNumeric(this.variables.getScalar(entry.variable));
    const next = current + entry.step;
    const cont = entry.step >= 0 ? next <= entry.to : next >= entry.to;
    this.variables.setScalar(entry.variable, numeric(next));
    if (cont) {
      this.pc = entry.bodyPC;
      return 'jumped';
    }
    this.loopStack.pop();
    return 'advance';
  }

  // ── WHILE / WEND, REPEAT / UNTIL ───────────────────────

  private executeWhile(stmt: Extract<Stmt, { kind: 'WhileStmt' }>): StmtResult {
    const cond = asNumeric(this.evaluator.evaluate(stmt.condition));
    if (cond !== 0) {
      this.loopStack.push({ kind: 'WHILE', headerPC: this.pc });
      return 'advance';
    }
    const closePC = this.scanForward(this.pc, 'WhileStmt', ['WendStmt']);
    if (!closePC) {
      throw new BasicError(ErrorCode.WHILE_WITHOUT_WEND, 'WHILE: 対応する WEND が見つかりません');
    }
    this.pc = this.nextOf(closePC);
    return 'jumped';
  }

  private executeWend(): StmtResult {
    const top = this.loopStack[this.loopStack.length - 1];
    if (!top || top.kind !== 'WHILE') {
      throw new BasicError(ErrorCode.WEND_WITHOUT_WHILE, 'WEND: 対応する WHILE がありません');
    }
    this.loopStack.pop();
    this.pc = top.headerPC;
    return 'jumped';
  }

  private executeRepeat(): StmtResult {
    this.loopStack.push({ kind: 'REPEAT', headerPC: this.nextOf(this.pc) });
    return 'advance';
  }

  private executeUntil(stmt: Extract<Stmt, { kind: 'UntilStmt' }>): StmtResult {
    const top = this.loopStack[this.loopStack.length - 1];
    if (!top || top.kind !== 'REPEAT') {
      throw new BasicError(ErrorCode.UNTIL_WITHOUT_REPEAT, 'UNTIL: 対応する REPEAT がありません');
    }
    const cond = asNumeric(this.evaluator.evaluate(stmt.condition));
    if (cond !== 0) {
      this.loopStack.pop();
      return 'advance';
    }
    this.pc = top.headerPC;
    return 'jumped';
  }

  // ── IF（1行形式 / ブロック形式） ────────────────────────

  private executeIfLine(stmt: Extract<Stmt, { kind: 'IfLineStmt' }>): StmtResult {
    const cond = asNumeric(this.evaluator.evaluate(stmt.condition));
    const clause = cond !== 0 ? stmt.thenClause : stmt.elseClause;
    if (clause === null) return 'advance';
    if (clause.kind === 'LineNumberTarget' || clause.kind === 'LabelTarget') {
      this.pc = this.resolveTarget(clause);
      return 'jumped';
    }
    // THEN/ELSE 節が文そのものの場合：同じディスパッチャで実行する。
    // this.pc は IF 文自身の位置のままなので、その文が「次へ進む」と
    // 判断した場合の advance 先も IF 文の次（＝行の続き）になり、意図と一致する。
    return this.executeStatement(clause);
  }

  private executeIfBlock(stmt: Extract<Stmt, { kind: 'IfStmt' }>): StmtResult {
    const cond = asNumeric(this.evaluator.evaluate(stmt.condition));
    if (cond !== 0) return 'advance';
    const closePC = this.scanForward(this.pc, 'IfStmt', ['ElseStmt', 'EndIfStmt']);
    if (!closePC) {
      throw new BasicError(ErrorCode.IF_WITHOUT_ENDIF, 'IF: 対応する ENDIF が見つかりません');
    }
    this.pc = this.nextOf(closePC);
    return 'jumped';
  }

  private executeElse(): StmtResult {
    // THEN 節を実行し終えて ELSE マーカーへ自然に到達した＝ELSE節はスキップする。
    const closePC = this.scanForward(this.pc, 'IfStmt', ['EndIfStmt']);
    if (!closePC) {
      throw new BasicError(ErrorCode.IF_WITHOUT_ENDIF, 'ELSE: 対応する ENDIF が見つかりません');
    }
    this.pc = this.nextOf(closePC);
    return 'jumped';
  }

  // ── SWITCH / CASE / DEFAULT / ENDSWITCH ────────────────
  //
  // docs/design/phase1_runtime.md の方針どおり、ブロックを AST に畳まず
  // 実行時に前方走査でマッチングする（IF/WHILE と同じ考え方）。
  // `SWITCH` に到達したら式を1回評価し、値が一致する `CASE` （無ければ
  // `DEFAULT`、それも無ければ `ENDSWITCH` 直後）まで前方走査してジャンプする。
  // 一致した CASE の本体を実行し終えて次の CASE/DEFAULT マーカーに自然到達したら
  // （フォールスルーはしない仕様のため）ENDSWITCH まで読み飛ばす。

  private valuesEqual(a: BasicValue, b: BasicValue): boolean {
    return a.type === b.type && a.value === b.value;
  }

  private executeSwitch(stmt: Extract<Stmt, { kind: 'SwitchStmt' }>): StmtResult {
    const val = this.evaluator.evaluate(stmt.expr);
    let pos = this.advancePosition(this.pc);
    let depth = 0;
    let defaultPC: PC | null = null;
    while (pos) {
      const s = this.statementAt(pos);
      if (s) {
        if (s.kind === 'SwitchStmt') {
          depth++;
        } else if (s.kind === 'EndSwitchStmt') {
          if (depth === 0) {
            this.pc = defaultPC ?? pos;
            return 'jumped';
          }
          depth--;
        } else if (depth === 0 && s.kind === 'CaseStmt') {
          for (const ve of s.values) {
            if (this.valuesEqual(this.evaluator.evaluate(ve), val)) {
              this.pc = this.nextOf(pos);
              return 'jumped';
            }
          }
        } else if (depth === 0 && s.kind === 'DefaultStmt' && defaultPC === null) {
          defaultPC = this.nextOf(pos);
        }
      }
      pos = this.advancePosition(pos);
    }
    throw new BasicError(ErrorCode.SYNTAX, 'SWITCH: 対応する ENDSWITCH が見つかりません');
  }

  /** `CASE`/`DEFAULT` に自然到達（前のCASE本体からのフォールスルー）した場合、対応するENDSWITCHまで読み飛ばす。 */
  private executeCaseOrDefaultFallthrough(): StmtResult {
    const closePC = this.scanForward(this.pc, 'SwitchStmt', ['EndSwitchStmt']);
    if (!closePC) {
      throw new BasicError(ErrorCode.SYNTAX, 'CASE/DEFAULT: 対応する ENDSWITCH が見つかりません');
    }
    this.pc = this.nextOf(closePC);
    return 'jumped';
  }

  // ── GOTO / GOSUB / RETURN / ON..GOTO / ON..GOSUB ───────

  private executeGoto(stmt: Extract<Stmt, { kind: 'GotoStmt' }>): StmtResult {
    this.pc = this.resolveTarget(stmt.target);
    return 'jumped';
  }

  private executeGosub(stmt: Extract<Stmt, { kind: 'GosubStmt' }>): StmtResult {
    this.callStack.push(this.nextOf(this.pc));
    this.pc = this.resolveTarget(stmt.target);
    return 'jumped';
  }

  private executeReturn(): StmtResult {
    const ret = this.callStack.pop();
    if (!ret) {
      throw new BasicError(ErrorCode.RETURN_WITHOUT_GOSUB, 'RETURN: 対応する GOSUB がありません');
    }
    this.pc = ret;
    return 'jumped';
  }

  private executeOnGoto(stmt: Extract<Stmt, { kind: 'OnGotoStmt' }>): StmtResult {
    return this.executeOnJump(stmt.selector, stmt.targets, false);
  }

  private executeOnGosub(stmt: Extract<Stmt, { kind: 'OnGosubStmt' }>): StmtResult {
    return this.executeOnJump(stmt.selector, stmt.targets, true);
  }

  private executeOnJump(
    selectorExpr: Extract<Stmt, { kind: 'OnGotoStmt' }>['selector'],
    targets: readonly JumpTarget[],
    isGosub: boolean,
  ): StmtResult {
    const n = Math.trunc(asNumeric(this.evaluator.evaluate(selectorExpr)));
    // 【判断】 選択値が範囲外（1〜targets.lengthの外）の場合の挙動はマニュアルに
    // 記載が無い。他BASIC実装の慣行に倣い、エラーにせず次の文へ進む。
    if (n < 1 || n > targets.length) return 'advance';
    const target = targets[n - 1];
    if (isGosub) {
      this.callStack.push(this.nextOf(this.pc));
    }
    this.pc = this.resolveTarget(target);
    return 'jumped';
  }

  // ── DIM / ERASE / CLEAR ────────────────────────────────

  private executeDim(stmt: Extract<Stmt, { kind: 'DimStmt' }>): StmtResult {
    for (const spec of stmt.specs) {
      const dims = spec.dims.map((d) => Math.trunc(asNumeric(this.evaluator.evaluate(d))) + 1);
      const maxLen = spec.stringLength
        ? Math.trunc(asNumeric(this.evaluator.evaluate(spec.stringLength)))
        : null;
      this.variables.dim(spec.name, dims, maxLen);
    }
    return 'advance';
  }

  private executeErase(stmt: Extract<Stmt, { kind: 'EraseStmt' }>): StmtResult {
    for (const target of stmt.targets) {
      if (target.kind === 'ArrayRef') {
        this.variables.eraseArray(target.name);
      } else {
        this.variables.eraseScalar(target.name);
      }
    }
    return 'advance';
  }

  // ── 画面・図形系 ────────────────────────────────────────

  private evalCoord(e: Expr): number {
    return Math.trunc(asNumeric(this.evaluator.evaluate(e)));
  }

  /** CIRCLE/PAINT のパターン番号（0〜6）へ丸める。範囲外は素直にクランプする（判断点）。 */
  private clampPattern(n: number): FillPattern {
    const t = Math.trunc(n);
    return Math.max(0, Math.min(6, t)) as FillPattern;
  }

  private executePset(stmt: Extract<Stmt, { kind: 'PsetStmt' }>): StmtResult {
    const x = this.evalCoord(stmt.x);
    const y = this.evalCoord(stmt.y);
    if (stmt.invert) {
      this.machine.screen.pxor(x, y);
    } else {
      this.machine.screen.pset(x, y);
    }
    this.machine.screen.gcursor(x, y);
    return 'advance';
  }

  private executePreset(stmt: Extract<Stmt, { kind: 'PresetStmt' }>): StmtResult {
    const x = this.evalCoord(stmt.x);
    const y = this.evalCoord(stmt.y);
    this.machine.screen.preset(x, y);
    this.machine.screen.gcursor(x, y);
    return 'advance';
  }

  private executeLine(stmt: Extract<Stmt, { kind: 'LineStmt' }>): StmtResult {
    const cur = this.machine.screen.graphicsCursor;
    const x1 = stmt.from ? this.evalCoord(stmt.from.x) : cur.x;
    const y1 = stmt.from ? this.evalCoord(stmt.from.y) : cur.y;
    const x2 = this.evalCoord(stmt.to.x);
    const y2 = this.evalCoord(stmt.to.y);
    const mode = stmt.mode ?? 'S';
    if (stmt.box === 'B') {
      this.machine.screen.rect(x1, y1, x2, y2, mode);
    } else if (stmt.box === 'BF') {
      this.machine.screen.fillRect(x1, y1, x2, y2, mode);
    } else if (stmt.lineStyle) {
      const pattern = this.evalCoord(stmt.lineStyle) & 0xffff;
      this.machine.screen.line(x1, y1, x2, y2, mode, pattern);
    } else {
      this.machine.screen.line(x1, y1, x2, y2, mode);
    }
    this.machine.screen.gcursor(x2, y2);
    return 'advance';
  }

  private executeCircle(stmt: Extract<Stmt, { kind: 'CircleStmt' }>): StmtResult {
    const x = this.evalCoord(stmt.x);
    const y = this.evalCoord(stmt.y);
    const r = asNumeric(this.evaluator.evaluate(stmt.radius));
    this.machine.screen.circle(
      x,
      y,
      r,
      stmt.startAngle ? asNumeric(this.evaluator.evaluate(stmt.startAngle)) : undefined,
      stmt.endAngle ? asNumeric(this.evaluator.evaluate(stmt.endAngle)) : undefined,
      stmt.aspect ? asNumeric(this.evaluator.evaluate(stmt.aspect)) : undefined,
      stmt.mode ?? undefined,
      stmt.pattern ? this.clampPattern(asNumeric(this.evaluator.evaluate(stmt.pattern))) : undefined,
    );
    return 'advance';
  }

  private executePaint(stmt: Extract<Stmt, { kind: 'PaintStmt' }>): StmtResult {
    const x = this.evalCoord(stmt.x);
    const y = this.evalCoord(stmt.y);
    const pattern = this.clampPattern(asNumeric(this.evaluator.evaluate(stmt.pattern)));
    this.machine.screen.paint(x, y, pattern);
    return 'advance';
  }

  private executeGcursor(stmt: Extract<Stmt, { kind: 'GcursorStmt' }>): StmtResult {
    const x = this.evalCoord(stmt.x);
    const y = this.evalCoord(stmt.y);
    this.machine.screen.gcursor(x, y);
    return 'advance';
  }

  /**
   * `GPRINT <ビットパターン>[;<ビットパターン>…]`。1バイト＝縦8ドットの列として
   * グラフィックカーソル位置から順に描く。
   *
   * 【判断】 ビットの向き（bit0が上か下か）はマニュアルに記載が無い。
   * `font.ts`/`screen.putChar` が採用している「bit0＝セル上端」という向きに
   * 合わせて一貫性を取った。
   *
   * 【判断】 `,`区切りは「1ドット分の隙間」、末尾`;`は「カーソル位置保持」と
   * notes にある。以前はパーサ段階（`parseGprintStmt`）で末尾の区切り記号が
   * 保持されず、常にカーソル位置を保持する（末尾`;`相当）へ丸めてしまっていた。
   * `GprintStmt.trailingSep` に区切りを持たせたことで区別できるようにした：
   * - 末尾 `;` … カーソル位置を保持（notes通り）
   * - 末尾 `,` … 項目間の `,` と同じ「1ドット分の隙間」を最後にも入れたうえで
   *   位置を保持する（項目間の `,` と同じ意味を末尾にも一貫して適用しただけで、
   *   notes に明記された事実ではない）
   * - 区切りなし（通常の行末） … 位置を保持しない。`PRINT` の改行相当として
   *   左端（x=0）へ戻し、1行分（8ドット、テキスト1行の高さ）下げる。
   *   引数無し GPRINT が「1ドットだけ」下げるのとは意図的に区別している
   *   （notes が両者を別項目として書き分けているため）。
   */
  private executeGprint(stmt: Extract<Stmt, { kind: 'GprintStmt' }>): StmtResult {
    let { x, y } = this.machine.screen.graphicsCursor;
    if (stmt.items.length === 0) {
      // 引数無しの GPRINT はカーソルを1ドット下げるだけ（notes参照）。
      this.machine.screen.gcursor(x, y + 1);
      return 'advance';
    }
    for (const seg of stmt.items) {
      if (seg.sep === ',') {
        x += 1;
      }
      const value = this.evaluator.evaluate(seg.value);
      for (const byte of this.gprintBytes(value)) {
        for (let dy = 0; dy < 8; dy++) {
          if ((byte >> dy) & 1) this.machine.screen.pset(x, y + dy);
        }
        x += 1;
      }
    }
    if (stmt.trailingSep === ',') {
      this.machine.screen.gcursor(x + 1, y);
    } else if (stmt.trailingSep === ';') {
      this.machine.screen.gcursor(x, y);
    } else {
      this.machine.screen.gcursor(0, y + 8);
    }
    return 'advance';
  }

  private gprintBytes(v: BasicValue): number[] {
    if (isNumeric(v)) {
      return [Math.trunc(v.value) & 0xff];
    }
    const s = v.value;
    const bytes: number[] = [];
    for (let i = 0; i + 1 < s.length; i += 2) {
      const b = parseInt(s.slice(i, i + 2), 16);
      if (!Number.isNaN(b)) bytes.push(b & 0xff);
    }
    return bytes;
  }

  private executeBeep(stmt: Extract<Stmt, { kind: 'BeepStmt' }>): StmtResult {
    const count = this.evalCoord(stmt.count);
    const pitch = stmt.pitch ? this.evalCoord(stmt.pitch) : null;
    const duration = stmt.duration ? this.evalCoord(stmt.duration) : null;
    this.machine.sound.beep(count, pitch, duration);
    return 'advance';
  }

  /** `WAIT` の待機残り時間（引数ありの場合）。実時刻ベース（`Date.now()`）で管理する。 */
  private waitDeadline: number | null = null;

  /**
   * `WAIT [<数値>]`。引数省略時は ENTER キー（`INPUT`と同じ行確定）で再開する
   * 無限待機、引数ありなら 1/64 秒単位の実時間待機。
   *
   * 【判断】 実時間待機は `Suspend.wait` を介してホスト（`ui/runtime.ts`）へ
   * 伝えるが、現状の `Runtime.onFrame` は `ms` を見て実際に間隔を空ける実装には
   * なっていない（次フレームを予約するだけ）。ここでは `Date.now()` を締切として
   * 自前で管理し、ホスト側の対応が無くても実時間で正しく待つようにした
   * （ホストが `ms` を活用する形へ改善しても壊れない設計）。
   */
  private executeWait(stmt: Extract<Stmt, { kind: 'WaitStmt' }>): StmtResult {
    if (stmt.value === null) {
      if (this.machine.keyboard.isLineReady()) {
        this.machine.keyboard.takeLine();
        return 'advance';
      }
      return { kind: 'wait', ms: -1 };
    }
    if (this.waitDeadline === null) {
      const n = this.evalCoord(stmt.value);
      const ms = (n * 1000) / 64;
      this.waitDeadline = Date.now() + ms;
    }
    const remaining = this.waitDeadline - Date.now();
    if (remaining <= 0) {
      this.waitDeadline = null;
      return 'advance';
    }
    return { kind: 'wait', ms: remaining };
  }

  // ── RUN / LIST / NEW / CONT（ダイレクトコマンド系） ─────

  /** `RUN [<行番号>|"<label>"]`。プログラム中に書かれた RUN 文（再実行）。 */
  private executeRun(stmt: Extract<Stmt, { kind: 'RunStmt' }>): StmtResult {
    this.resetForRun();
    this.pc = stmt.target ? this.resolveTarget(stmt.target) : { lineIndex: 0, stmtIndex: 0 };
    return 'jumped';
  }

  /** `LIST [<行番号>|"<label>"]`。プログラムをテキストへ復元して画面表示する。 */
  private executeList(stmt: Extract<Stmt, { kind: 'ListStmt' }>): StmtResult {
    let startIdx = 0;
    if (stmt.target) {
      if (stmt.target.kind === 'LineNumberTarget') {
        // 「存在しない行番号ならその次に大きい行番号から表示」（yaml notes）。
        const n = stmt.target.value;
        const idx = this.program.findIndex((l) => l.lineNumber !== null && l.lineNumber >= n);
        if (idx === -1) {
          throw new BasicError(ErrorCode.UNDEFINED_LINE, `LIST: 行番号 ${n} 以降の行がありません`);
        }
        startIdx = idx;
      } else {
        startIdx = this.resolveTarget(stmt.target).lineIndex;
      }
    }
    for (let i = startIdx; i < this.program.length; i++) {
      this.machine.screen.writeText(`${this.unparseLine(this.program[i])}\n`);
    }
    return 'advance';
  }

  /**
   * `NEW`（単独）。メモリ上のプログラムと全変数を消去する（yaml summary）。
   *
   * 【判断】 このインタプリタはコンストラクタで受け取った `program` を
   * 読み取り専用として実行する設計（`docs/design/phase1_architecture.md`）で、
   * プログラムの動的編集・削除を担うエディタは Phase 3 で別途実装される想定
   * （`AUTO`/`DELETE`/`RENUM` が本依頼のスコープ外なのと同じ理由）。
   * そのためここでは「実行に関わる状態（変数・スタック・DATA位置・TRON）を
   * NEW 相当にリセットし、実行を停止する」ところまでを行い、プログラム本体の
   * 消去はエディタ側の責務として持ち越す。
   */
  private executeNew(): StmtResult {
    this.variables.clear();
    this.loopStack = [];
    this.callStack = [];
    this.dataPointer = 0;
    this.tron = false;
    this.contAvailable = false;
    this.running = false;
    return 'advance';
  }

  /**
   * `CONT`（単独、文としての CONT）。
   *
   * 【判断】 実行中のプログラム文としてここへ到達する時点で、必ず
   * `running === true`（＝停止していない）状態のため、`contAvailable` は
   * 通常 false のままであり、この分岐は事実上常に ERROR(13) になる。
   * 外部からの再開（BREAK/STOP/END後）は `Interpreter.cont()`（ジェネレータ、
   * `Runtime.resumeCont()` から呼ばれる）が別途担うため、文としての CONT は
   * 整合性チェックの意味合いが強い。
   */
  private executeContStmt(): StmtResult {
    if (!this.contAvailable) {
      throw new BasicError(ErrorCode.CONT_INVALID_STATE, 'CONT: 再開できる状態ではありません');
    }
    this.contAvailable = false;
    return 'advance';
  }

  // ── LIST（プログラムをテキストへ復元） ──────────────────

  private unparseJump(target: JumpTarget): string {
    return target.kind === 'LineNumberTarget' ? String(target.value) : `*${target.name}`;
  }

  private unparseTarget(target: AssignTarget): string {
    if (target.kind === 'VariableRef') return target.name;
    return `${target.name}(${target.indices.map((e) => this.unparseExpr(e)).join(',')})`;
  }

  private unparseClause(clause: IfClause): string {
    if (clause.kind === 'LineNumberTarget' || clause.kind === 'LabelTarget') {
      return this.unparseJump(clause);
    }
    return this.unparseStmt(clause);
  }

  private static readonly WORD_BINARY_OPS = new Set(['MOD', 'AND', 'OR', 'XOR']);

  private unparseExpr(e: Expr): string {
    switch (e.kind) {
      case 'NumberLiteral':
        return e.raw;
      case 'StringLiteral':
        return `"${e.value}"`;
      case 'VariableRef':
        return e.name;
      case 'ArrayRef':
        return `${e.name}(${e.indices.map((x) => this.unparseExpr(x)).join(',')})`;
      case 'FunctionCall':
        return e.args.length > 0 ? `${e.name}(${e.args.map((a) => this.unparseExpr(a)).join(',')})` : e.name;
      case 'UnaryOp': {
        const operand = this.unparseExpr(e.operand);
        return e.op === 'NOT' ? `NOT ${operand}` : `${e.op}${operand}`;
      }
      case 'BinaryOp': {
        const opText = Interpreter.WORD_BINARY_OPS.has(e.op) ? ` ${e.op} ` : e.op;
        return `${this.unparseExpr(e.left)}${opText}${this.unparseExpr(e.right)}`;
      }
      case 'UnsupportedExpr':
        return e.name;
    }
  }

  /**
   * `Stmt` を BASIC ソーステキストへ戻す（`LIST` 用）。
   *
   * 【判断】 元の入力テキストの空白・大文字小文字・冗長な括弧を厳密に
   * 再現するのではなく、「再度パースすれば同じ意味になる」ことを優先した
   * 正規形で出力する。ただし `REM` の本文（`RemStmt.text`）と `DATA` の
   * 各項目の生テキスト（`DataValue.text`）だけは、依頼指示のとおり
   * 元の空白を含めて完全に保持する。
   */
  private unparseStmt(stmt: Stmt): string {
    switch (stmt.kind) {
      case 'UnsupportedStmt':
        return stmt.name;
      case 'LabelStmt':
        return `*${stmt.name}`;
      case 'LetStmt':
        return stmt.assignments.map((a) => `${this.unparseTarget(a.target)}=${this.unparseExpr(a.value)}`).join(',');
      case 'PrintStmt': {
        let out = 'PRINT';
        stmt.items.forEach((seg, i) => {
          if (i === 0) out += ' ';
          else out += seg.sep === ',' ? ',' : ';';
          out +=
            seg.value.kind === 'PrintUsing'
              ? `USING ${this.unparseExpr(seg.value.format)}`
              : this.unparseExpr(seg.value);
        });
        if (stmt.trailingSep) out += stmt.trailingSep;
        return out;
      }
      case 'InputStmt': {
        let out = 'INPUT ';
        stmt.items.forEach((item, i) => {
          if (i > 0) out += ',';
          if (item.kind === 'InputPrompt') {
            out += `${this.unparseExpr(item.message)}${item.quiet ? ';' : ','}`;
          } else {
            out += this.unparseTarget(item);
          }
        });
        return out;
      }
      case 'IfLineStmt': {
        let out = `IF ${this.unparseExpr(stmt.condition)} THEN ${this.unparseClause(stmt.thenClause)}`;
        if (stmt.elseClause) out += ` ELSE ${this.unparseClause(stmt.elseClause)}`;
        return out;
      }
      case 'IfStmt':
        return `IF ${this.unparseExpr(stmt.condition)} THEN`;
      case 'ElseStmt':
        return 'ELSE';
      case 'EndIfStmt':
        return 'ENDIF';
      case 'ForStmt': {
        let out = `FOR ${stmt.variable.name}=${this.unparseExpr(stmt.from)} TO ${this.unparseExpr(stmt.to)}`;
        if (stmt.step) out += ` STEP ${this.unparseExpr(stmt.step)}`;
        return out;
      }
      case 'NextStmt':
        return stmt.variable ? `NEXT ${stmt.variable.name}` : 'NEXT';
      case 'WhileStmt':
        return `WHILE ${this.unparseExpr(stmt.condition)}`;
      case 'WendStmt':
        return 'WEND';
      case 'RepeatStmt':
        return 'REPEAT';
      case 'UntilStmt':
        return `UNTIL ${this.unparseExpr(stmt.condition)}`;
      case 'SwitchStmt':
        return `SWITCH ${this.unparseExpr(stmt.expr)}`;
      case 'CaseStmt':
        return `CASE ${stmt.values.map((v) => this.unparseExpr(v)).join(',')}`;
      case 'DefaultStmt':
        return 'DEFAULT';
      case 'EndSwitchStmt':
        return 'ENDSWITCH';
      case 'GotoStmt':
        return `GOTO ${this.unparseJump(stmt.target)}`;
      case 'GosubStmt':
        return `GOSUB ${this.unparseJump(stmt.target)}`;
      case 'ReturnStmt':
        return 'RETURN';
      case 'OnGotoStmt':
        return `ON ${this.unparseExpr(stmt.selector)} GOTO ${stmt.targets.map((t) => this.unparseJump(t)).join(',')}`;
      case 'OnGosubStmt':
        return `ON ${this.unparseExpr(stmt.selector)} GOSUB ${stmt.targets.map((t) => this.unparseJump(t)).join(',')}`;
      case 'EndStmt':
        return 'END';
      case 'StopStmt':
        return 'STOP';
      case 'RemStmt':
        // 依頼指示：REM の本文を空白ごと完全保持する。
        return `REM${stmt.text}`;
      case 'DataStmt':
        // 依頼指示：DATA の各項目の空白を保持する（DataValue.text が原文）。
        return `DATA ${stmt.values.map((v) => (v.quoted ? `"${v.text}"` : v.text)).join(',')}`;
      case 'ReadStmt':
        return `READ ${stmt.targets.map((t) => this.unparseTarget(t)).join(',')}`;
      case 'RestoreStmt':
        return stmt.target ? `RESTORE ${this.unparseJump(stmt.target)}` : 'RESTORE';
      case 'DimStmt':
        return `DIM ${stmt.specs
          .map((spec) => {
            const dims = spec.dims.map((d) => this.unparseExpr(d)).join(',');
            const len = spec.stringLength ? `*${this.unparseExpr(spec.stringLength)}` : '';
            return `${spec.name}(${dims})${len}`;
          })
          .join(',')}`;
      case 'EraseStmt':
        return `ERASE ${stmt.targets.map((t) => this.unparseTarget(t)).join(',')}`;
      case 'ClearStmt':
        return 'CLEAR';
      case 'ClsStmt':
        return 'CLS';
      case 'LocateStmt': {
        const colText = stmt.col ? this.unparseExpr(stmt.col) : '';
        const rowText = stmt.row ? this.unparseExpr(stmt.row) : '';
        return rowText ? `LOCATE ${colText},${rowText}` : `LOCATE ${colText}`;
      }
      case 'GcursorStmt':
        return `GCURSOR (${this.unparseExpr(stmt.x)},${this.unparseExpr(stmt.y)})`;
      case 'PsetStmt':
        return `PSET (${this.unparseExpr(stmt.x)},${this.unparseExpr(stmt.y)})${stmt.invert ? ',X' : ''}`;
      case 'PresetStmt':
        return `PRESET (${this.unparseExpr(stmt.x)},${this.unparseExpr(stmt.y)})`;
      case 'LineStmt': {
        let out = 'LINE ';
        if (stmt.from) out += `(${this.unparseExpr(stmt.from.x)},${this.unparseExpr(stmt.from.y)})`;
        out += `-(${this.unparseExpr(stmt.to.x)},${this.unparseExpr(stmt.to.y)})`;
        const parts: string[] = [];
        if (stmt.box !== null || stmt.lineStyle !== null || stmt.mode !== null) parts.push(stmt.mode ?? '');
        if (stmt.box !== null || stmt.lineStyle !== null) {
          parts.push(stmt.lineStyle ? this.unparseExpr(stmt.lineStyle) : '');
        }
        if (stmt.box !== null) parts.push(stmt.box);
        if (parts.length > 0) out += `,${parts.join(',')}`;
        return out;
      }
      case 'CircleStmt': {
        let out = `CIRCLE (${this.unparseExpr(stmt.x)},${this.unparseExpr(stmt.y)}),${this.unparseExpr(stmt.radius)}`;
        const fields = [stmt.startAngle, stmt.endAngle, stmt.aspect, stmt.mode, stmt.pattern];
        let last = -1;
        fields.forEach((f, i) => {
          if (f !== null) last = i;
        });
        if (last >= 0) {
          const parts: string[] = [];
          if (last >= 0) parts.push(stmt.startAngle ? this.unparseExpr(stmt.startAngle) : '');
          if (last >= 1) parts.push(stmt.endAngle ? this.unparseExpr(stmt.endAngle) : '');
          if (last >= 2) parts.push(stmt.aspect ? this.unparseExpr(stmt.aspect) : '');
          if (last >= 3) parts.push(stmt.mode ?? '');
          if (last >= 4) parts.push(stmt.pattern ? this.unparseExpr(stmt.pattern) : '');
          out += `,${parts.join(',')}`;
        }
        return out;
      }
      case 'PaintStmt':
        return `PAINT (${this.unparseExpr(stmt.x)},${this.unparseExpr(stmt.y)}),${this.unparseExpr(stmt.pattern)}`;
      case 'GprintStmt': {
        let out = 'GPRINT';
        stmt.items.forEach((seg, i) => {
          if (i === 0) out += ' ';
          else out += seg.sep === ',' ? ',' : ';';
          out += this.unparseExpr(seg.value);
        });
        if (stmt.trailingSep) out += stmt.trailingSep;
        return out;
      }
      case 'BeepStmt': {
        let out = `BEEP ${this.unparseExpr(stmt.count)}`;
        if (stmt.pitch !== null || stmt.duration !== null) {
          out += `,${stmt.pitch ? this.unparseExpr(stmt.pitch) : ''}`;
        }
        if (stmt.duration !== null) out += `,${this.unparseExpr(stmt.duration)}`;
        return out;
      }
      case 'WaitStmt':
        return stmt.value ? `WAIT ${this.unparseExpr(stmt.value)}` : 'WAIT';
      case 'RandomizeStmt':
        return 'RANDOMIZE';
      case 'LcopyStmt':
        return `LCOPY ${this.unparseExpr(stmt.fromLine)},${this.unparseExpr(stmt.toLine)},${this.unparseExpr(stmt.destLine)}`;
      case 'RunStmt':
        return stmt.target ? `RUN ${this.unparseJump(stmt.target)}` : 'RUN';
      case 'ListStmt':
        return stmt.target ? `LIST ${this.unparseJump(stmt.target)}` : 'LIST';
      case 'NewStmt':
        return 'NEW';
      case 'AutoStmt': {
        if (stmt.startLine === null && stmt.increment === null) return 'AUTO';
        const s = stmt.startLine ? this.unparseExpr(stmt.startLine) : '';
        return stmt.increment ? `AUTO ${s},${this.unparseExpr(stmt.increment)}` : `AUTO ${s}`;
      }
      case 'DeleteStmt': {
        const s = stmt.start ? this.unparseExpr(stmt.start) : '';
        const e = stmt.end ? this.unparseExpr(stmt.end) : '';
        return `DELETE ${s}${stmt.hasDash ? '-' : ''}${e}`;
      }
      case 'RenumStmt': {
        const parts = [stmt.oldLine, stmt.newLine, stmt.increment]
          .map((f) => (f ? this.unparseExpr(f) : null))
          .filter((v): v is string => v !== null);
        return parts.length > 0 ? `RENUM ${parts.join(',')}` : 'RENUM';
      }
      case 'ContStmt':
        return 'CONT';
      case 'TronStmt':
        return 'TRON';
      case 'TroffStmt':
        return 'TROFF';
      case 'DegreeStmt':
        return 'DEGREE';
      case 'RadianStmt':
        return 'RADIAN';
      case 'GradStmt':
        return 'GRAD';
      case 'PassStmt':
        return `PASS ${this.unparseExpr(stmt.password)}`;
    }
  }

  private unparseLine(line: ProgramLine): string {
    const body = line.statements.map((s) => this.unparseStmt(s)).join(':');
    return line.lineNumber !== null ? `${line.lineNumber} ${body}` : body;
  }

  // ── ディスパッチャ ──────────────────────────────────────

  private unimplementedName(stmt: Stmt): string {
    if (stmt.kind === 'UnsupportedStmt') return stmt.name;
    return stmt.kind.replace(/Stmt$/, '').toUpperCase();
  }

  private executeStatement(stmt: Stmt): StmtResult {
    switch (stmt.kind) {
      case 'LabelStmt':
      case 'RemStmt':
      case 'EndIfStmt':
        return 'advance';

      case 'LetStmt':
        for (const assign of stmt.assignments) {
          this.assignTo(assign.target, this.evaluator.evaluate(assign.value));
        }
        return 'advance';

      case 'PrintStmt':
        return this.executePrint(stmt);
      case 'InputStmt':
        return this.executeInput(stmt);

      case 'IfLineStmt':
        return this.executeIfLine(stmt);
      case 'IfStmt':
        return this.executeIfBlock(stmt);
      case 'ElseStmt':
        return this.executeElse();

      case 'ForStmt':
        return this.executeFor(stmt);
      case 'NextStmt':
        return this.executeNext(stmt);

      case 'WhileStmt':
        return this.executeWhile(stmt);
      case 'WendStmt':
        return this.executeWend();
      case 'RepeatStmt':
        return this.executeRepeat();
      case 'UntilStmt':
        return this.executeUntil(stmt);

      case 'SwitchStmt':
        return this.executeSwitch(stmt);
      case 'CaseStmt':
      case 'DefaultStmt':
        return this.executeCaseOrDefaultFallthrough();
      case 'EndSwitchStmt':
        return 'advance';

      case 'GotoStmt':
        return this.executeGoto(stmt);
      case 'GosubStmt':
        return this.executeGosub(stmt);
      case 'ReturnStmt':
        return this.executeReturn();
      case 'OnGotoStmt':
        return this.executeOnGoto(stmt);
      case 'OnGosubStmt':
        return this.executeOnGosub(stmt);

      case 'EndStmt':
        this.running = false;
        this.contAvailable = true;
        return 'advance';
      case 'StopStmt': {
        const line = this.program[this.pc.lineIndex];
        this.haltWithMessage('STOP', line?.lineNumber ?? null, true, true);
        return 'advance';
      }

      case 'DataStmt':
        return 'advance';
      case 'ReadStmt':
        return this.executeRead(stmt);
      case 'RestoreStmt':
        return this.executeRestore(stmt);

      case 'DimStmt':
        return this.executeDim(stmt);
      case 'EraseStmt':
        return this.executeErase(stmt);
      case 'ClearStmt':
        this.variables.clear();
        return 'advance';

      case 'ClsStmt':
        this.machine.screen.cls();
        return 'advance';
      case 'LocateStmt': {
        const cur = this.machine.screen.cursor;
        const col = stmt.col ? Math.trunc(asNumeric(this.evaluator.evaluate(stmt.col))) : cur.col;
        const row = stmt.row ? Math.trunc(asNumeric(this.evaluator.evaluate(stmt.row))) : cur.row;
        this.machine.screen.locate(col, row);
        return 'advance';
      }

      case 'TronStmt':
        this.tron = true;
        return 'advance';
      case 'TroffStmt':
        this.tron = false;
        return 'advance';

      case 'DegreeStmt':
        this.angleMode = 'DEG';
        this.builtinContext.angleMode = 'DEG';
        return 'advance';
      case 'RadianStmt':
        this.angleMode = 'RAD';
        this.builtinContext.angleMode = 'RAD';
        return 'advance';
      case 'GradStmt':
        this.angleMode = 'GRAD';
        this.builtinContext.angleMode = 'GRAD';
        return 'advance';

      case 'RandomizeStmt':
        this.machine.randomize();
        return 'advance';

      case 'GcursorStmt':
        return this.executeGcursor(stmt);
      case 'PsetStmt':
        return this.executePset(stmt);
      case 'PresetStmt':
        return this.executePreset(stmt);
      case 'LineStmt':
        return this.executeLine(stmt);
      case 'CircleStmt':
        return this.executeCircle(stmt);
      case 'PaintStmt':
        return this.executePaint(stmt);
      case 'GprintStmt':
        return this.executeGprint(stmt);
      case 'BeepStmt':
        return this.executeBeep(stmt);
      case 'WaitStmt':
        return this.executeWait(stmt);
      case 'LcopyStmt':
        // 【判断】 プリンタ出力の実装はスコープ外。無言にせず「未対応」を記録し、
        // プログラムは止めずに続行する（UnsupportedError と違い致命的ではない扱い）。
        this.machine.reportUnimplemented('LCOPY');
        return 'advance';

      case 'RunStmt':
        return this.executeRun(stmt);
      case 'ListStmt':
        return this.executeList(stmt);
      case 'NewStmt':
        return this.executeNew();
      case 'ContStmt':
        return this.executeContStmt();

      default:
        // INPUT・画面図形系・INKEY$・ダイレクトコマンド系など、今回のスコープ外の文。
        // 無言で飛ばさず「未実装」として停止する（依頼指示）。
        throw new UnsupportedError(this.unimplementedName(stmt));
    }
  }
}
