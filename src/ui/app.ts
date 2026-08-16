/**
 * RUN / BREAK / LIST のボタン操作を束ねる、DOM 非依存のアプリケーション状態。
 *
 * `ui/main.ts` はここへ「テキストエリアの中身」「ボタンのクリック」を渡すだけにし、
 * パース〜実行〜エラー表示のロジック自体はここへ集約する（DOM を組み立てずに
 * vitest から直接検証できるようにするため。`ui/runtime.ts` が `Scheduler` を
 * 注入できるようにしているのと同じ考え方）。
 */

import { BUILTINS } from '../basic/functions/index.ts';
import { BasicError, UnsupportedError } from '../basic/errors.ts';
import { Interpreter } from '../basic/interpreter.ts';
import { parseProgram } from '../basic/parser.ts';
import type { Machine } from '../machine/machine.ts';
import { browserScheduler, Runtime, type Scheduler } from './runtime.ts';

export interface AppCallbacks {
  /** 画面を再描画する（`Runtime` へそのまま渡す他、RUN/LIST/エラー表示の直後にも呼ぶ）。 */
  render: () => void;
}

/**
 * 訪問者が書いた BASIC プログラムの実行を管理する。
 *
 * 1 インスタンスが「現在ロード中のプログラム」を1つだけ持つ。RUN のたびに
 * 前の実行を止め、新しい `Interpreter`/`Runtime` を作り直す
 * （依頼「RUN … 実行状態はリセット」に対応。`Interpreter` はコンストラクタで
 * 受け取った `program` を読み取り専用として扱う設計＝プログラムを差し替える
 * ときは作り直すしかない、という既存設計に素直に従っている）。
 */
export class App {
  private runtime: Runtime | null = null;
  private interpreter: Interpreter | null = null;

  constructor(
    private readonly machine: Machine,
    private readonly callbacks: AppCallbacks,
    private readonly scheduler: Scheduler = browserScheduler(),
  ) {}

  /** 現在実行中かどうか（BREAK ボタンの活性制御などに使う想定）。 */
  isRunning(): boolean {
    return this.interpreter?.running ?? false;
  }

  /**
   * RUN ボタン相当。`source` をパースして最初から実行する。
   * パースに失敗した場合は画面にエラーを表示して実行はしない
   * （依頼「4. エラーの見せ方」：黙って何も起きない状態を作らない）。
   */
  run(source: string): void {
    // 前の実行を必ず止める。ジェネレータ自体は破棄されるだけで、次の
    // `new Interpreter(...)` が完全に独立した実行状態を作るので「実行状態は
    // リセット」の要件をそのまま満たす。
    this.runtime?.stop();
    this.runtime = null;
    this.interpreter = null;

    let program;
    try {
      program = parseProgram(source);
    } catch (e) {
      this.reportError(e);
      return;
    }

    this.machine.screen.cls();
    // 前回実行の INKEY$/INPUT バッファや BREAK 要求が新しい実行へ漏れないようにする。
    this.machine.keyboard.reset();
    this.callbacks.render();

    const interpreter = new Interpreter(program, this.machine, BUILTINS);
    this.interpreter = interpreter;
    this.runtime = new Runtime(interpreter, this.machine.keyboard, this.callbacks, this.scheduler);
    this.runtime.start();
  }

  /**
   * BREAK ボタン相当。実行中のプログラムへ BREAK を要求する。
   *
   * `keyboard.consumeBreak()` を経由する物理 BREAK キー（`Escape`）とは別経路で、
   * `Interpreter.requestBreak()` を直接呼ぶ。ボタンはスマートフォンに `Escape`
   * キーが無いことへの対応そのものなので、キーボード経由に寄せる理由が無い
   * （依頼「BREAK ボタンは必須」の理由と同じ）。
   */
  break(): void {
    this.interpreter?.requestBreak();
  }

  /**
   * LIST ボタン相当。現在ロード中のプログラムを LCD に表示する
   * （`Interpreter.list()` ＝ 実行系の `LIST` 文の外部公開版）。
   * まだ一度も RUN していない場合は何もしない。
   */
  list(): void {
    if (!this.interpreter) return;
    this.interpreter.list();
    this.callbacks.render();
  }

  /**
   * パースエラーを LCD へ表示する。
   *
   * `interpreter.ts` の `haltWithMessage` が実行時エラーを
   * `ERROR <code> IN <行番号>` / `?UNSUPPORTED <名前> IN <行番号>` の形式で
   * 表示しているのに合わせ、パース時点のエラーも同じ書式にする
   * （画面表示の一貫性のため。既存の表示機構＝`Screen.writeText` をそのまま使う）。
   */
  private reportError(e: unknown): void {
    let message: string;
    if (e instanceof BasicError) {
      message = `?ERROR ${e.code} IN ${e.lineNumber ?? '?'}`;
    } else if (e instanceof UnsupportedError) {
      message = `?UNSUPPORTED ${e.name_} IN ${e.lineNumber ?? '?'}`;
    } else {
      // 想定外の例外。握り潰さず、少なくとも「何かが起きた」ことは画面に出す。
      message = '?ERROR (UNKNOWN)';
    }
    this.machine.screen.cls();
    this.machine.screen.writeText(`${message}\n`);
    this.callbacks.render();
  }
}
