/**
 * ダイレクトモード（LCD 上のラインエディタ）。
 *
 * 実機と同じく「電源を入れたらすぐ画面に打てる」形の中核。`ui/app.ts` の
 * `App`（プログラム入力欄＋RUN/BREAK/LIST ボタン）とは独立した、並行の
 * 入力経路として実装する（依頼「テキスト入力欄は…補助機能へ格下げ」に対し、
 * 今回は両者の統合＝パネル化は次担当のスコープのため、既存の `App` には
 * 一切手を入れず、同じ `Machine`（＝同じ LCD）へ描く別経路を追加するだけに
 * 留めた）。
 *
 * 状態:
 * - `ProgramStore`: 行番号ごとの生テキスト（実機のプログラムメモリ相当）
 * - `Interpreter`: `ProgramStore` の内容から作り直す実行エンジン。
 *   行の格納・削除・`NEW` のたびに作り直す（`Interpreter` は `program` を
 *   読み取り専用として扱う設計のため。`ui/app.ts` の `App.run()` と同じ考え方）。
 *   ダイレクト文の実行そのもの（`RUN` を含む）では作り直さない＝変数を
 *   引き継ぐ（`interpreter.ts` の `runDirect` 参照）。
 */

import type { Stmt } from '../basic/ast.ts';
import { BasicError, UnsupportedError } from '../basic/errors.ts';
import { parseDirectStatements } from '../basic/directLine.ts';
import { BUILTINS } from '../basic/functions/index.ts';
import { Interpreter } from '../basic/interpreter.ts';
import { parseProgram } from '../basic/parser.ts';
import { ProgramStore } from '../basic/programStore.ts';
import type { Machine } from '../machine/machine.ts';
import { applyCapsLock } from '../machine/keyboard.ts';
import { TEXT_COLS } from '../machine/screen.ts';
import type { CursorOverlayState } from '../machine/cursorOverlay.ts';
import { browserScheduler, Runtime, type Scheduler } from './runtime.ts';

/** 行番号で始まる行を判定する正規表現。先頭の空白を許し、行番号と本文の間の空白は任意。 */
const NUMBERED_LINE = /^\s*(\d+)\s*(.*)$/;

export interface DirectModeCallbacks {
  /** 画面を再描画する。`Runtime` へそのまま渡す他、行編集・エラー表示の直後にも呼ぶ。 */
  render: () => void;
}

export class DirectMode {
  private programStore = new ProgramStore();
  private interpreter: Interpreter;
  private runtime: Runtime | null = null;

  /**
   * ダイレクト実行（RUN/LIST/NEW を含む）を「Enter を押した／`runCommand` を
   * 呼んだ瞬間」から「`onDirectEnd` で完了する瞬間」まで true にするフラグ。
   *
   * 【判断した点・理由】 以前は `isRunning()` が `Interpreter.running` を
   * そのまま返していたが、この値はジェネレータ（`coreLoop`）の本体が実際に
   * 動き出すまで（＝`Runtime` が rAF で最初のフレームを回すまで）true に
   * ならない。そのため「NEW を Enter した直後、まだ1フレームも進んでいない間」
   * に次の行を打つと `isRunning()` が false のままラインエディタへ素通りし、
   * NEW の消去（`ProgramStore.clear()`）が効く前に別の行を書き込めてしまう
   * （公開版を実機操作して発見。行の追加とNEWの消去の実行順序が競合し、
   * 消去前の古い行が生き残る）。`executeDirect` を呼んだ時点で同期的に true、
   * `onDirectEnd` で完了した時点で false にすることで、rAF の実際の発火有無に
   * 関わらず「コマンドを確定した瞬間から完了まで実行中」を保証する。
   */
  private busy = false;

  /** 確定（Enter）前の、現在入力中の1行分のテキスト。 */
  private lineBuffer = '';

  constructor(
    private readonly machine: Machine,
    private readonly callbacks: DirectModeCallbacks,
    private readonly scheduler: Scheduler = browserScheduler(),
  ) {
    this.interpreter = this.buildInterpreter();
  }

  private buildInterpreter(): Interpreter {
    // ProgramStore の内容は常に構文的に妥当な行のみ（commitNumberedLine が
    // 格納前に検証するため）、ここでの parseProgram が失敗することは無い想定。
    const program = parseProgram(this.programStore.toSource());
    return new Interpreter(program, this.machine, BUILTINS);
  }

  /** 実行中かどうか（キー入力の行き先分離・カーソル表示の可否に使う）。 */
  isRunning(): boolean {
    return this.busy;
  }

  /** BREAK ボタン相当。実行中ならダイレクトモード側の実行へ BREAK を要求する。 */
  requestBreak(): void {
    this.interpreter.requestBreak();
  }

  /** 現在のテキストカーソル位置。実行中は `null`（表示しない。`uncertain.ts` の判断参照）。 */
  getCursorOverlay(): CursorOverlayState | null {
    if (this.isRunning()) return null;
    const { col, row } = this.machine.screen.cursor;
    return { col, row };
  }

  /**
   * `keydown` イベントを1つ処理する。呼び出し側（`ui/main.ts`）が
   * フォーム部品へのフォーカス（`isFormControlTarget`）と「何かが実行中でないか」
   * （`App.isRunning()` も含む）を確認してから呼ぶ想定。ここでは自分自身の
   * 実行中判定だけ重ねて防御する。
   */
  handleKeyDown(e: KeyboardEvent): void {
    if (this.isRunning()) return;

    if (isEnterKeyEvent(e)) {
      this.commitLine();
      return;
    }
    if (isBackspaceKeyEvent(e)) {
      this.backspace();
      return;
    }
    const ch = printableChar(e);
    if (ch !== null) {
      this.insertChar(ch);
    }
  }

  /**
   * LCD への直接打鍵1文字を反映する。
   *
   * 実機は既定で大文字入力（`machine/keyboard.ts` の `DEFAULT_CAPS_LOCK` 参照）
   * のため、ここで CAPS ロック状態に従って大文字化する。**非対称の注意**：
   * テキスト入力欄パネル（`loadProgram`）はプログラムファイル相当として
   * 書かれた文字をそのまま扱い、ここを通らないので変換されない。
   */
  private insertChar(ch: string): void {
    const displayCh = applyCapsLock(ch, this.machine.keyboard.isCapsLockOn());
    this.lineBuffer += displayCh;
    this.machine.screen.writeText(displayCh);
    this.callbacks.render();
  }

  private backspace(): void {
    if (this.lineBuffer.length === 0) return;
    this.lineBuffer = this.lineBuffer.slice(0, -1);

    const { col, row } = this.machine.screen.cursor;
    let newCol = col - 1;
    let newRow = row;
    if (newCol < 0) {
      newCol = TEXT_COLS - 1;
      newRow = row - 1;
    }
    if (newRow < 0) return; // 保険。lineBuffer が空でない限り通常は起こらない。

    this.machine.screen.putChar(newCol, newRow, 0x20);
    this.machine.screen.locate(newCol, newRow);
    this.callbacks.render();
  }

  /**
   * RUN/LIST ボタン相当。指定したコマンド文字列を「LCD へキーボードで打ち込んで
   * Enter を押した」のと完全に同じ経路（`commitLine`）で実行する。
   *
   * 【判断した点・理由】 以前は `ui/app.ts` の `App` が RUN 前に必ず `cls()` して
   * いたが、実機の RUN は画面を消さない（消すのは CLS 文だけ）。ボタンを
   * `commitLine` に合流させることで、直接入力と別実装を持たずに済み、
   * 「ボタンだけ挙動が違う」余地が構造的に無くなる。
   *
   * 実行中は何もしない（`handleKeyDown` と同じ防御。BREAK ボタンで止めてから使う想定）。
   */
  runCommand(text: string): void {
    if (this.isRunning()) return;
    this.lineBuffer = text;
    this.machine.screen.writeText(text);
    this.callbacks.render();
    this.commitLine();
  }

  /**
   * テキスト入力欄パネルの「プログラムに取り込む」ボタン相当。
   * 行番号付きの各行を `commitNumberedLine` へそのまま渡し、1行ずつ打って
   * Enter したのと同じ検証・格納をする。行番号の無い行（空行含む）は無視する。
   *
   * 【判断した点・理由】 打鍵の逐次エコー（画面へ1文字ずつ表示）まではしない
   * ＝実機の CLOAD（テープからの一括読み込み）に近い扱いとした。LCD の狭い
   * 画面へ入力欄の内容をまるごとエコーすると、複数行のプログラムでは画面が
   * 一括読み込みの結果より読みにくくなるため。構文エラー行は `commitNumberedLine`
   * が既存の経路でエラー表示するので、ここでは黙って落とさない
   * （依頼の「未実装・不正な入力を無言で無視しない」方針に合わせる）。
   *
   * 呼ぶたびに既存のプログラムをいったん消してから取り込む（CLOAD 相当＝
   * 入力欄の内容で丸ごと置き換える）。差分マージにすると、入力欄から消した
   * 行が LCD 側にだけ残り続け、「入力欄の内容を取り込んだはず」という見た目と
   * 実際のプログラムが食い違う（実機に無い罠になるため避けた）。
   */
  loadProgram(source: string): void {
    if (this.isRunning()) return;
    this.programStore.clear();
    for (const rawLine of source.split('\n')) {
      const m = NUMBERED_LINE.exec(rawLine);
      if (m === null) continue; // 行番号の無い行（空行含む）は無視する。
      this.commitNumberedLine(Number(m[1]), m[2]);
    }
    this.callbacks.render();
  }

  private commitLine(): void {
    const text = this.lineBuffer;
    this.lineBuffer = '';
    this.machine.screen.writeText('\n');
    this.callbacks.render();

    if (text.trim() === '') return; // 空行 Enter は何もしない。

    const m = NUMBERED_LINE.exec(text);
    if (m) {
      this.commitNumberedLine(Number(m[1]), m[2]);
      return;
    }
    this.executeDirect(text);
  }

  /** 行番号で始まる行。本文が空なら削除、それ以外は構文検証してから格納する。 */
  private commitNumberedLine(lineNumber: number, rest: string): void {
    if (rest.trim() === '') {
      this.programStore.deleteLine(lineNumber);
      this.interpreter = this.buildInterpreter();
      return;
    }

    try {
      // 構文検証のみ。ここで作った AST は使い捨てる（ProgramStore は生テキストで
      // 持ち、実際の AST は RUN/LIST のたびに `buildInterpreter` で作り直す）。
      parseDirectStatements(rest);
    } catch (e) {
      this.reportError(e, lineNumber);
      return;
    }

    this.programStore.setLine(lineNumber, rest);
    this.interpreter = this.buildInterpreter();
  }

  /** 行番号を伴わない行。ダイレクト実行する（`RUN`/`LIST`/`NEW`/`PRINT ...` 等）。 */
  private executeDirect(text: string): void {
    let statements: Stmt[];
    try {
      statements = parseDirectStatements(text);
    } catch (e) {
      this.reportError(e, null);
      return;
    }
    if (statements.length === 0) return;

    // `Runtime.startDirect` は rAF 駆動のため、ここではまだ何も実行されていない
    // （最初のフレームが回るまで `Interpreter.running` は true にならない）。
    // それでも「コマンドを確定した瞬間から実行中」として打鍵をブロックできるよう、
    // ここで同期的に true にする（`busy` フィールドのコメント参照）。
    this.busy = true;
    this.runtime = new Runtime(
      this.interpreter,
      this.machine.keyboard,
      {
        render: this.callbacks.render,
        onEnd: () => this.onDirectEnd(statements),
      },
      this.scheduler,
    );
    this.runtime.startDirect(statements);
  }

  /**
   * ダイレクト実行が終わったとき（正常終了・BREAK・STOP・ERROR・?UNSUPPORTED の
   * いずれでも）に呼ばれる。実機の慣行に合わせ、エラー時も「既存のエラー表示
   * （`interpreter.ts` 側が既に出している）→ OK → 次の入力待ち」という同じ経路に
   * 揃える（エラーの有無で分岐すると「エラー時だけ様子が違う」実装になり、
   * かえって分かりにくいため）。
   */
  private onDirectEnd(statements: readonly Stmt[]): void {
    // `NEW` はインタプリタ内部では実行状態のリセットまでしか行わない設計
    // （`interpreter.ts` の `executeNew` のコメント参照）。プログラム本体
    // （`ProgramStore`）の消去はここ＝エディタ側の責務。
    if (statements.some((s) => s.kind === 'NewStmt')) {
      this.programStore.clear();
      this.interpreter = this.buildInterpreter();
    }
    this.machine.screen.writeText('OK\n');
    this.callbacks.render();
    this.busy = false;
  }

  private reportError(e: unknown, lineNumber: number | null): void {
    let message: string;
    if (e instanceof BasicError) {
      message = `?ERROR ${e.code} IN ${e.lineNumber ?? lineNumber ?? '?'}`;
    } else if (e instanceof UnsupportedError) {
      message = `?UNSUPPORTED ${e.name_} IN ${e.lineNumber ?? lineNumber ?? '?'}`;
    } else {
      message = '?ERROR (UNKNOWN)';
    }
    this.machine.screen.writeText(`${message}\n`);
    this.callbacks.render();
  }
}

/**
 * `KeyboardEvent` から印字可能な1文字を求める。`e.code` だけに依存すると
 * 自動化ブラウザで `code` が空になるケースを取りこぼす
 * （`feedback_browser_automation_key_code_empty.md`）ため `e.key` を主に見る。
 * 修飾キー（Ctrl/Alt/Meta）併用時はブラウザ標準のショートカットと衝突しない
 * よう対象外にする。
 */
function printableChar(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = e.key;
  if (typeof k === 'string' && k.length === 1) return k;
  return null;
}

/** `key`/`code` の両方を見て Enter（テンキーの Enter を含む）を判定する。 */
function isEnterKeyEvent(e: KeyboardEvent): boolean {
  return e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
}

/** `key`/`code` の両方を見て Backspace を判定する。 */
function isBackspaceKeyEvent(e: KeyboardEvent): boolean {
  return e.key === 'Backspace' || e.code === 'Backspace';
}
