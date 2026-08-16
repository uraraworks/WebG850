/**
 * カーソル点滅専用の再描画ループ。
 *
 * 【直した不具合】 `cursorOverlay.ts`（`isCursorBlinkOn`）の点滅計算は `nowMs` に
 * 基づく時刻ベースで正しく書かれていたが、`ui/runtime.ts` の `Runtime`（`rAF` ループ）は
 * **BASIC プログラム実行中だけ**回る。入力待ち（ダイレクトモードでキー入力を待っている間）は
 * 誰も `render()` を呼ばないため、時刻上は点滅の位相が進んでいても画面が更新されなかった
 * （実機ブラウザで確認：カーソルが点滅しない）。
 *
 * 時間で変化するものを描くには、時間で描き直す必要がある
 * （以前の液晶残像の不具合＝「描画回数」に減衰を紐づけて静止画面で焼き付いた話の逆）。
 *
 * このクラスは「入力待ちの間だけ」`CURSOR_BLINK_PERIOD_MS` 間隔でタイマーを持ち、
 * 表示⇔非表示の位相が実際に切り替わった瞬間だけ `render` を呼ぶ。`stop()` されている間
 * （プログラム実行中・タブ非表示中）はタイマー自体を持たないため、無駄な再描画は起きない。
 */

import { CURSOR_BLINK_PERIOD_MS } from '../basic/uncertain.ts';
import { isCursorBlinkOn } from '../machine/cursorOverlay.ts';

/** `setInterval`/`clearInterval`/現在時刻の取得だけを抜き出した最小インタフェース（テスト用に差し替え可能）。 */
export interface BlinkScheduler {
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
  now(): number;
}

/**
 * ブラウザの `window.setInterval`/`Date.now` を使うスケジューラ。
 *
 * 【判断した点・理由】 `window` が存在しない環境（vitest は `environment: 'node'`。
 * `vite.config.ts` 参照）で `DirectMode` を構築するテストが多数あるため、
 * `window` が無ければ「何もしないダミー」を返す。`CursorBlinkLoop` 自体の
 * 単体テストは `test/cursorBlinkLoop.test.ts` が手動スケジューラを注入して検証する。
 * こうすることで `DirectMode` 側は常に同じ既定値を使えばよく（テストごとに
 * ダミーを差し替える必要が無い）、本番（ブラウザ）だけで自然に有効になる。
 */
export function browserBlinkScheduler(): BlinkScheduler {
  if (typeof window === 'undefined') {
    return {
      setInterval: () => 0,
      clearInterval: () => {},
      now: () => Date.now(),
    };
  }
  return {
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (id) => window.clearInterval(id),
    now: () => Date.now(),
  };
}

export class CursorBlinkLoop {
  private timerId: number | null = null;
  private lastPhase: boolean | null = null;

  constructor(
    private readonly render: () => void,
    private readonly scheduler: BlinkScheduler = browserBlinkScheduler(),
  ) {}

  /**
   * 点滅タイマーを開始する。既に動いている場合は何もしない（二重起動防止）。
   * 開始した瞬間の位相を記録するだけで、ここでは `render` を呼ばない
   * （呼び出し側が既に直前の状態を描画済みという前提。`DirectMode` 参照）。
   */
  start(): void {
    if (this.timerId !== null) return;
    this.lastPhase = isCursorBlinkOn(this.scheduler.now());
    this.timerId = this.scheduler.setInterval(() => this.tick(), CURSOR_BLINK_PERIOD_MS);
  }

  /** 点滅タイマーを止める（プログラム実行中・タブ非表示中はこちら）。 */
  stop(): void {
    if (this.timerId === null) return;
    this.scheduler.clearInterval(this.timerId);
    this.timerId = null;
    this.lastPhase = null;
  }

  /** 動作中かどうか（テスト・デバッグ用）。 */
  running(): boolean {
    return this.timerId !== null;
  }

  private tick(): void {
    const phase = isCursorBlinkOn(this.scheduler.now());
    if (phase === this.lastPhase) return; // 位相が変わっていなければ再描画は不要。
    this.lastPhase = phase;
    this.render();
  }
}
