/**
 * `requestAnimationFrame` でインタプリタのジェネレータを駆動する実行ループ。
 *
 * `docs/design/phase1_architecture.md`「実行モデル：ジェネレータ」節と
 * `docs/design/phase1_runtime.md`「中断と再開」節に従う。
 *
 * - 1フレームあたり `STEPS_PER_FRAME` 文だけ実行し、`Suspend` が返ったら
 *   描画（`render`）して次フレームへ譲る
 * - BREAK キーは `Keyboard.consumeBreak()` をフレーム先頭で確認し、
 *   `Interpreter.requestBreak()` へ伝える（実際の停止判定は interpreter.ts 側、
 *   `docs/design/phase1_runtime.md`「TRON / TROFF」節と同じ「行頭で1箇所だけ確認」規則）
 * - `rAF` は環境（自動テスト用ブラウザ等）によって回る頻度が違う、
 *   あるいはまったく発火しないことがある
 *   （`feedback_headless_raf_never_runs.md`）。「何フレーム回ったか」を
 *   `frameCount` で数えられるようにしておき、後から検証に使えるようにする
 */

import type { Stmt } from '../basic/ast.ts';
import type { Interpreter, Suspend } from '../basic/interpreter.ts';
import type { Keyboard } from '../machine/keyboard.ts';

/**
 * 1フレームあたりに実行する BASIC 文の数。
 *
 * 【判断した点・理由】 実機の実行速度に厳密に合わせる指標は無い
 * （精度方針：完全再現は目指さない）。「無限ループのプログラムでも
 * 毎フレーム描画・BREAK確認ができる」ことを満たす範囲で、体感的な実行速度が
 * 極端に遅くならない値として決め打った。値を変えるときはこの定数だけ直せばよい。
 */
export const STEPS_PER_FRAME = 500;

/** `requestAnimationFrame`/`cancelAnimationFrame` 相当の最小インタフェース（テスト用に差し替え可能）。 */
export interface Scheduler {
  requestFrame(cb: (time: number) => void): number;
  cancelFrame(id: number): void;
}

/** ブラウザの `window.requestAnimationFrame` をそのまま使うスケジューラ。 */
export function browserScheduler(): Scheduler {
  return {
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
  };
}

export interface RuntimeCallbacks {
  /** 画面を再描画する（`Suspend` を受け取るたびに呼ぶ）。 */
  render: () => void;
  /** 実行が完全に停止した（'end' を受け取った）ときに呼ぶ。省略可。 */
  onEnd?: () => void;
}

/**
 * インタプリタのジェネレータを rAF で駆動するランタイム。
 * `start()` でループを開始し、`stop()` で止める。
 */
export class Runtime {
  private gen: Generator<Suspend, void, void> | null = null;
  private frameId: number | null = null;
  private running = false;

  /** 実際に `requestFrame` のコールバックが呼ばれた回数。検証・デバッグ用。 */
  frameCount = 0;

  constructor(
    private readonly interpreter: Interpreter,
    private readonly keyboard: Keyboard,
    private readonly callbacks: RuntimeCallbacks,
    private readonly scheduler: Scheduler = browserScheduler(),
  ) {}

  /** `RUN` 相当。インタプリタの `run()` ジェネレータを取得してループを開始する。 */
  start(): void {
    this.gen = this.interpreter.run();
    this.beginLoop();
  }

  /** `CONT` 相当。`cont()` ジェネレータを取得してループを開始する。 */
  resumeCont(): void {
    this.gen = this.interpreter.cont();
    this.beginLoop();
  }

  /**
   * ダイレクトモード（LCD上のラインエディタ）で「行番号なしの行」を確定したとき用。
   * `Interpreter.runDirect()` のジェネレータでループを開始する（`docs/design` には
   * 無い、今回の依頼で追加したエントリポイント。詳細は `interpreter.ts` の
   * `runDirect` のコメント参照）。
   */
  startDirect(statements: readonly Stmt[]): void {
    this.gen = this.interpreter.runDirect(statements);
    this.beginLoop();
  }

  private beginLoop(): void {
    this.running = true;
    this.scheduleNextFrame();
  }

  /** ループを止める（BREAK 等）。ジェネレータ自体は破棄しない（CONT 用に interpreter 側が状態を保持する）。 */
  stop(): void {
    this.running = false;
    if (this.frameId !== null) {
      this.scheduler.cancelFrame(this.frameId);
      this.frameId = null;
    }
  }

  private scheduleNextFrame(): void {
    if (!this.running) return;
    this.frameId = this.scheduler.requestFrame(() => this.onFrame());
  }

  private onFrame(): void {
    this.frameCount++;

    // BREAK キーはフレーム先頭で1回だけ確認する
    // （docs/design/phase1_runtime.md の「行頭で1箇所だけ」という設計に倣う）。
    if (this.keyboard.consumeBreak()) {
      this.interpreter.requestBreak();
    }

    const gen = this.gen;
    if (!gen) {
      this.running = false;
      return;
    }

    // 「1文ずつ」ではなく「行の先頭(yield)ごとに1ステップ」で数える
    // （interpreter.ts の coreLoop は行頭でだけ 'yield' する設計のため、
    // 1回の gen.next() 呼び出しは次の yield/end/その他の Suspend まで進む）。
    // 予算 STEPS_PER_FRAME を使い切るか、'yield' 以外の Suspend（'input'/'wait'/'end'）
    // に到達したら、このフレームの実行を切り上げて描画・次フレームへ譲る。
    let stepsLeft = STEPS_PER_FRAME;
    let result: IteratorResult<Suspend, void> = gen.next();
    stepsLeft--;
    while (!result.done && result.value.kind === 'yield' && stepsLeft > 0) {
      result = gen.next();
      stepsLeft--;
    }

    if (result.done) {
      this.running = false;
      this.callbacks.render();
      this.callbacks.onEnd?.();
      return;
    }

    this.callbacks.render();

    const suspend = result.value;
    switch (suspend.kind) {
      case 'end':
        // インタプリタ自身が終了（プログラム終端 / END / STOP / BREAK / ERROR）。
        this.running = false;
        this.callbacks.onEnd?.();
        return;
      case 'yield':
        // 予算 STEPS_PER_FRAME を使い切っただけ。次フレームでそのまま再開する。
        this.scheduleNextFrame();
        return;
      case 'input':
      case 'wait':
        // Phase1 実装対象の文からは発生しない（interpreter.ts のコメント参照）。
        // 将来 INPUT/WAIT が実装された場合も、ジェネレータの性質上
        // 「次フレームで gen.next() を呼べば続きから再開できる」点は同じなので、
        // ここでは同様に次フレームを予約するだけでよい
        // （実際のキー確定待ち・時間待ちの判定は interpreter.ts 側の責務）。
        this.scheduleNextFrame();
        return;
    }
  }
}
