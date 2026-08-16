/**
 * テキストカーソルの点滅描画を、LCD のビットマップ（`Screen` の内部 `dots`）とは
 * 別に扱うためのヘルパ。
 *
 * 【重要】 カーソルは `Screen` のドットへ焼き込まない。焼き込むと `POINT` が
 * カーソルの点滅で結果を変えてしまう（依頼指示の最重要点）。ここでは
 * `Screen.getDots()` が返す配列を**複製してから**上書きし、元の配列には
 * 一切触れない。呼び出し側（`ui/canvas.ts`）はこの関数の戻り値だけを
 * 描画に使い、`Screen` 自体には触れない。
 *
 * 形・点滅周期・表示タイミングの不確定仕様は `src/basic/uncertain.ts`
 * （`CURSOR_SHAPE`/`CURSOR_BLINK_PERIOD_MS`/`CURSOR_VISIBLE_WHEN_IDLE_ONLY`）参照。
 */

import { CURSOR_BLINK_PERIOD_MS, CURSOR_SHAPE, markUncertainUsed } from '../basic/uncertain.ts';
import { CELL_HEIGHT, CELL_WIDTH, SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.ts';

/** カーソルの表示位置（テキストの桁・行、`Screen.cursor` と同じ単位）。 */
export interface CursorOverlayState {
  readonly col: number;
  readonly row: number;
}

/**
 * 現在時刻がカーソルの「表示フェーズ」かどうかを返す（点滅の片側）。
 * `nowMs` を外から渡せるようにして、`Date.now()` に依存せずテストできるようにする。
 */
export function isCursorBlinkOn(nowMs: number): boolean {
  markUncertainUsed('CURSOR_BLINK_PERIOD_MS');
  return Math.floor(nowMs / CURSOR_BLINK_PERIOD_MS) % 2 === 0;
}

/**
 * `dots`（`Screen.getDots()` の戻り値）を書き換えず、カーソルを重ねた**新しい配列**を返す。
 * `cursor` が `null`、または点滅の非表示フェーズのときは `dots` をそのまま返す
 * （複製すら行わない。呼び出し側のホットパスで無駄なアロケーションを避けるため）。
 */
export function applyCursorOverlay(dots: Uint8Array, cursor: CursorOverlayState | null, nowMs: number): Uint8Array {
  markUncertainUsed('CURSOR_VISIBLE_WHEN_IDLE_ONLY');
  if (!cursor) return dots;
  if (!isCursorBlinkOn(nowMs)) return dots;

  markUncertainUsed('CURSOR_SHAPE');
  const out = dots.slice();
  const x0 = cursor.col * CELL_WIDTH;
  const y0 = cursor.row * CELL_HEIGHT;
  const yStart = CURSOR_SHAPE === 'underline' ? CELL_HEIGHT - 1 : 0;

  for (let dy = yStart; dy < CELL_HEIGHT; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= SCREEN_HEIGHT) continue;
    for (let dx = 0; dx < CELL_WIDTH; dx++) {
      const x = x0 + dx;
      if (x < 0 || x >= SCREEN_WIDTH) continue;
      const idx = y * SCREEN_WIDTH + x;
      out[idx] = out[idx] ? 0 : 1;
    }
  }
  return out;
}
