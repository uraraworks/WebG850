// 実行エンジン（ジェネレータ）。docs/design/phase1_runtime.md（今回の最重要資料）と
// docs/design/phase1_architecture.md「実行モデル」節に従う。
//
// ブロック構造（WHILE/WEND, REPEAT/UNTIL, IF/ELSE/ENDIF）は AST に畳まれていないため、
// 実行時に前方走査でマッチングする（GOTO でブロックを跨いでも壊れない設計の要）。

import type {
  AssignTarget,
  DataValue,
  ForStmt,
  JumpTarget,
  ProgramLine,
  Stmt,
} from './ast.js';
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
    this.builtins = builtins;

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

  /** `RUN` 相当。先頭から実行する。変数・スタック・DATAポインタを初期化する。 */
  *run(): Generator<Suspend, void, void> {
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

      if (this.pc.stmtIndex === 0) {
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
        // 将来の INPUT/WAIT 用（Phase1 の実装対象文からは発生しない）。
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

      default:
        // INPUT・画面図形系・INKEY$・ダイレクトコマンド系など、今回のスコープ外の文。
        // 無言で飛ばさず「未実装」として停止する（依頼指示）。
        throw new UnsupportedError(this.unimplementedName(stmt));
    }
  }
}
