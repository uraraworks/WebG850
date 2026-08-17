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
import { ErrorCode, appendErrorLineSuffix, BasicError, UnsupportedError } from '../basic/errors.ts';
import { parseDirectStatements } from '../basic/directLine.ts';
import { BUILTINS } from '../basic/functions/index.ts';
import { Interpreter } from '../basic/interpreter.ts';
import { parseProgram } from '../basic/parser.ts';
import { ProgramStore } from '../basic/programStore.ts';
import { directModePrompt, formatErrorPrefix, initialBasicMode } from '../basic/uncertain.ts';
import type { Machine } from '../machine/machine.ts';
import { applyCapsLock } from '../machine/keyboard.ts';
import { TEXT_COLS } from '../machine/screen.ts';
import type { CursorOverlayState } from '../machine/cursorOverlay.ts';
import { browserBlinkScheduler, CursorBlinkLoop, type BlinkScheduler } from './cursorBlinkLoop.ts';
import { browserScheduler, Runtime, type Scheduler } from './runtime.ts';

/** 行番号で始まる行を判定する正規表現。先頭の空白を許し、行番号と本文の間の空白は任意。 */
const NUMBERED_LINE = /^\s*(\d+)\s*(.*)$/;

/** 動作モード。実機の `BASIC` キーで切り替わる（`docs/spec/operation_behavior.md` 事項4）。 */
export type BasicMode = 'PRO' | 'RUN';

/**
 * `BASIC` キーに割り当てる物理キー。
 *
 * 【判断した点・理由】 実機の `BASIC` キーに対応する PC キーボード上のキーは
 * 仕様書に記載が無い。`machine/keyboard.ts` の `BREAK_KEY`（`Escape`）が既に
 * 「実行中の処理を止める」役割を占有しているため衝突を避ける必要がある。
 * - `F2` を採用: (1) 印字可能文字ではないため `printableChar` に一切引っかからず
 *   ラインエディタへの誤入力を作り込まずに済む、(2) ブラウザ標準のショートカット
 *   （タブ切替・戻る等）と衝突しない、(3) キーボード上で独立した機能キーであり
 *   「モードを切り替える」という他と違う操作であることを直感的に示せる。
 * 差し替える場合はこの定数だけ変更すればよい。画面上のボタン（操作バー）でも
 * 同じ `toggleMode()` を呼べるようにしてあるため、物理キーを持たないスマートフォンでも
 * 切り替えられる（`BREAK` ボタンを置いたのと同じ理由。`ui/main.ts` 参照）。
 */
const MODE_TOGGLE_KEY = 'F2';

export interface DirectModeCallbacks {
  /** 画面を再描画する。`Runtime` へそのまま渡す他、行編集・エラー表示の直後にも呼ぶ。 */
  render: () => void;
  /**
   * 未実装の仮想キーが押されたことを、編集中の行とは無関係に伝える
   * （`notifyUnsupported` 参照）。呼び出し側（`ui/main.ts`）は LCD 枠外の
   * 通知領域にキー名を一時的に表示する想定。省略可（テスト等で不要な場合）。
   */
  notifyUnsupported?: (name: string) => void;
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

  /**
   * カーソル点滅専用の再描画ループ（`cursorBlinkLoop.ts`）。「入力待ちの間だけ」動かす
   * （`busy` の遷移＝`executeDirect`/`onDirectEnd` に合わせて `stop`/`start` する。
   * `handleKeyDown`/`insertChar` 等の打鍵直後は `busy` が変わらないため触らなくてよい）。
   *
   * 【時間で変化するものは時間で描き直す】 点滅の位相計算（`isCursorBlinkOn`）自体は
   * 時刻ベースで正しいが、`Runtime`（rAF ループ）は実行中だけ回るため、入力待ちで
   * 画面が静止していると位相が進んでも誰も再描画しなかった不具合の対策
   * （旧不具合＝LCD残像の減衰を「描画回数」に紐づけて静止画面で焼き付いた話の逆）。
   */
  private readonly blinkLoop: CursorBlinkLoop;

  /** タブが非表示中かどうか（`pauseCursorBlink`/`resumeCursorBlink` 参照）。 */
  private tabHidden = false;

  /** 確定（Enter）前の、現在入力中の1行分のテキスト。 */
  private lineBuffer = '';

  /**
   * 現在の動作モード（PRO/RUN）。既定値は `uncertain.ts` の `INITIAL_BASIC_MODE`
   * （未確認、暫定 PRO）。`initialBasicMode()` 経由で取得することで
   * `markUncertainUsed` がここを通るたびに1回記録される。
   */
  private mode: BasicMode = initialBasicMode();

  constructor(
    private readonly machine: Machine,
    private readonly callbacks: DirectModeCallbacks,
    private readonly scheduler: Scheduler = browserScheduler(),
    blinkScheduler: BlinkScheduler = browserBlinkScheduler(),
  ) {
    this.interpreter = this.buildInterpreter();
    this.blinkLoop = new CursorBlinkLoop(() => this.callbacks.render(), blinkScheduler);
    // 起動直後は入力待ち（busy=false）から始まるため、点滅ループも最初から動かす。
    this.blinkLoop.start();
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

  /** 現在の動作モード（画面右上のインジケータ表示・テストに使う）。 */
  getMode(): BasicMode {
    return this.mode;
  }

  /**
   * `BASIC` キー／画面上のモード切替ボタン相当。PRO⇔RUN を入れ替える。
   * 実行中は何もしない（打鍵経路と同じ防御。`handleKeyDown`/`runCommand` 参照）。
   */
  toggleMode(): void {
    if (this.isRunning()) return;
    this.mode = this.mode === 'PRO' ? 'RUN' : 'PRO';
    this.callbacks.render();
  }

  /**
   * 現在のテキストカーソル位置。実行中は `null`（表示しない。`uncertain.ts` の判断参照）。
   *
   * カーソルを返す＝カーソルを置く瞬間なので、その前に保留中の遅延スクロール
   * （`Screen.resolveScrollForCursorPlacement`）を解決する。実行中は呼ばないため、
   * 「出力中は先頭行が流れない」という既存の挙動には影響しない。
   */
  getCursorOverlay(): CursorOverlayState | null {
    if (this.isRunning()) return null;
    this.machine.screen.resolveScrollForCursorPlacement();
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
    if (isModeToggleKeyEvent(e)) {
      this.toggleMode();
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

  /**
   * 仮想キーボード（`ui/virtualKeyboard.ts`）の関数キー・記号キー用：
   * 文字列をそのまま LCD へ打ち込む。`insertChar` と違い CAPS ロックの影響を
   * 受けない固定表記で入れる。
   *
   * 【判断した点・理由】 `SIN(` 等の関数名ショートカットは BASIC の予約語
   * トークンそのもの（`docs/spec/basic_commands.yaml` の各 `format` は大文字
   * 表記）であり、利用者が CAPS を小文字側へ切り替えていても小文字化すると
   * 構文エラーになりかねない。そのため常に呼び出し側が渡した表記のまま入れる
   * （＝大文字のショートカット文字列を渡す使い方を想定）。
   *
   * 【未実装の仮想キーには使わない】 以前はここで `?UNSUPPORTED <名前>` を
   * ラインへ埋め込んでいたが、編集中の行（例：`10 PRINT "A` の途中）に
   * 割り込んで内容を壊してしまう不具合があった（依頼「未実装キーが入力中の
   * 行を壊す」）。未実装キーの通知は `notifyUnsupported` に分離した。
   */
  insertText(text: string): void {
    if (this.isRunning()) return;
    for (const ch of text) {
      this.lineBuffer += ch;
      this.machine.screen.writeText(ch);
    }
    this.callbacks.render();
  }

  /**
   * 未実装の仮想キー用：編集中の行（`lineBuffer`／LCD）には一切触れず、
   * 押されたキー名を `DirectModeCallbacks.notifyUnsupported` へそのまま
   * 転送するだけの通知。
   *
   * 【判断した点・理由】 「未実装を無言にしない」方針と「編集中の行を壊さない」
   * 要求を両立させるため、`insertText` のようにラインへ埋め込む方式をやめ、
   * 表示先を呼び出し側（`ui/main.ts`）の LCD 枠外の通知領域に切り出した。
   * `DirectMode` 自身は DOM を持たないため、通知の見せ方（表示時間・消し方等）は
   * 呼び出し側の責務とし、ここでは中継のみ行う。
   * `machine.reportUnimplemented` への記録は従来どおり呼び出し側
   * （`ui/virtualKeyboard.ts`）が行う（このメソッドは記録を重複させない）。
   */
  notifyUnsupported(name: string): void {
    this.callbacks.notifyUnsupported?.(name);
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

  /**
   * 現在の `ProgramStore` の中身を `parseProgram()` に渡せる形のテキストで返す。
   *
   * テキスト入力欄パネル（`ui/main.ts`）が「入力欄＝現在のプログラムのビュー」
   * として同期するために使う。LCD 上でのライン単位の編集（`commitNumberedLine`）は
   * ここを経由しないと入力欄側からは見えないため、ディスクライブラリからの
   * 読み込み直後や編集パネルを開いたタイミングで呼んでもらう想定
   * （同期のタイミング判断自体は `ui/main.ts` の責務。`DirectMode` は DOM を知らない）。
   */
  getProgramSource(): string {
    return this.programStore.toSource();
  }

  private commitLine(): void {
    const text = this.lineBuffer;
    this.lineBuffer = '';
    this.machine.screen.writeText('\n');
    this.callbacks.render();

    if (text.trim() === '') return; // 空行 Enter は何もしない。

    // 【PRO/RUN モード分岐】 数字始まりの入力を「行番号（格納）」と「計算式
    // （即時評価）」のどちらとして扱うかは、実機同様このモードだけで決まる
    // （`docs/spec/operation_behavior.md` 事項4）。RUN モードでは行番号らしき
    // 判定そのものを行わず、常にダイレクト実行へ回す（`30` は式として評価され、
    // `directLine.ts` の「文の先頭に来ない先読み」により暗黙の PRINT になる）。
    if (this.mode === 'PRO') {
      const m = NUMBERED_LINE.exec(text);
      if (m) {
        this.commitNumberedLine(Number(m[1]), m[2]);
        return;
      }
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

    // `LIST` は PRO モード限定（`docs/spec/basic_commands.yaml` の LIST の
    // summary/notes に両版一致で明記。`basic_errors.yaml` code 12 が
    // 「PROモード/RUNモードの選択が誤っている」に対応する）。RUN モード中に
    // 打たれたら、実行そのものへ回さずここでエラー表示して終える。
    if (this.mode === 'RUN' && statements.some((s) => s.kind === 'ListStmt')) {
      this.reportError(
        new BasicError(ErrorCode.MODE_MISMATCH, 'LIST は PRO モードでのみ使用できます'),
        null,
      );
      return;
    }

    // `Runtime.startDirect` は rAF 駆動のため、ここではまだ何も実行されていない
    // （最初のフレームが回るまで `Interpreter.running` は true にならない）。
    // それでも「コマンドを確定した瞬間から実行中」として打鍵をブロックできるよう、
    // ここで同期的に true にする（`busy` フィールドのコメント参照）。
    this.busy = true;
    // プログラム実行中はカーソルを表示しない（`getCursorOverlay` 参照）ので、
    // 点滅用の再描画も止める（無駄な描画・スマートフォンの電池消費を避ける）。
    this.blinkLoop.stop();
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
   * （`interpreter.ts` 側が既に出している）→ プロンプト → 次の入力待ち」という
   * 同じ経路に揃える（エラーの有無で分岐すると「エラー時だけ様子が違う」実装になり、
   * かえって分かりにくいため）。
   *
   * プロンプト文字列そのもの（既定 `OK`）は `uncertain.ts` の
   * `directModePrompt`/`DIRECT_MODE_PROMPT` に集約している。マニュアルに
   * 記載が無い推測値である旨・調査で `>` の可能性も出ている旨はそちらのコメント参照。
   */
  private onDirectEnd(statements: readonly Stmt[]): void {
    // `NEW` はインタプリタ内部では実行状態のリセットまでしか行わない設計
    // （`interpreter.ts` の `executeNew` のコメント参照）。プログラム本体
    // （`ProgramStore`）の消去はここ＝エディタ側の責務。
    if (statements.some((s) => s.kind === 'NewStmt')) {
      this.programStore.clear();
      this.interpreter = this.buildInterpreter();
    }
    this.machine.screen.writeText(directModePrompt());
    this.callbacks.render();
    this.busy = false;
    // 入力待ちに戻ったので点滅を再開する（タブが非表示中なら `pauseCursorBlink` 側の
    // 状態で既に止まっている想定だが、念のため `resumeCursorBlink` と同じ判定を通す）。
    if (!this.tabHidden) this.blinkLoop.start();
  }

  /**
   * タブが非表示（`document.visibilitychange` の `hidden`）になったときに呼ぶ。
   * `ui/main.ts` から配線する（`DirectMode` 自身は DOM の `document` を持たない設計を
   * 保つため、イベント購読は呼び出し側の責務とする）。
   *
   * 【判断した点・理由】 バックグラウンドタブでの点滅継続は画面に見えない再描画を
   * 積み重ねるだけで、スマートフォンの電池消費に直接効く。`busy`（プログラム実行中）
   * と独立の理由で止めたいので、専用のフラグ（`tabHidden`）で管理する
   * （`busy` を書き換えると「実行中」の意味が変わってしまうため避けた）。
   */
  pauseCursorBlink(): void {
    this.tabHidden = true;
    this.blinkLoop.stop();
  }

  /**
   * タブが再び表示されたときに呼ぶ。プログラム実行中（`busy`）でなければ点滅を再開する
   * （実行中に再開すると `busy` 側の停止と競合するため、ここでも判定する）。
   */
  resumeCursorBlink(): void {
    this.tabHidden = false;
    if (!this.busy) this.blinkLoop.start();
  }

  /**
   * 行番号部分の組み立ては `appendErrorLineSuffix`（`src/basic/errors.ts`）に
   * 集約している。ダイレクト実行には行番号が無いので、`?` の埋め草は出さず
   * 「IN 部分ごと省く」（旧実装は `IN ${lineNumber ?? '?'}` で `IN ?` を出していたが、
   * 実機ブラウザで見ると不自然な表示だったため）。
   *
   * `ERROR n` 先頭の `?` の有無は `uncertain.ts` の `formatErrorPrefix` に集約
   * している（`?UNSUPPORTED` はこのプロジェクト独自の表示なので対象外。
   * 実機由来の書式に合わせる必要が無いため直書きのままにしている）。
   */
  private reportError(e: unknown, lineNumber: number | null): void {
    let message: string;
    if (e instanceof BasicError) {
      message = appendErrorLineSuffix(formatErrorPrefix(e.code), e.lineNumber ?? lineNumber);
    } else if (e instanceof UnsupportedError) {
      message = appendErrorLineSuffix(`?UNSUPPORTED ${e.name_}`, e.lineNumber ?? lineNumber);
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

/** `key`/`code` の両方を見て `BASIC` キー割当（`MODE_TOGGLE_KEY`）を判定する。 */
function isModeToggleKeyEvent(e: KeyboardEvent): boolean {
  return e.key === MODE_TOGGLE_KEY || e.code === MODE_TOGGLE_KEY;
}
