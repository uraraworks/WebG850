// src/machine/cursorOverlay.ts の単体テスト。
// 最重要点：カーソルの重畳描画は `Screen` の内部ビットマップ（`POINT` が読む配列）を
// 一切書き換えないこと（依頼指示の最重要点）。

import { describe, expect, it } from 'vitest';
import { applyCursorOverlay, isCursorBlinkOn } from '../src/machine/cursorOverlay.ts';
import { CURSOR_BLINK_PERIOD_MS } from '../src/basic/uncertain.ts';
import { Screen, CELL_WIDTH, CELL_HEIGHT } from '../src/machine/screen.ts';

describe('isCursorBlinkOn', () => {
  it('CURSOR_BLINK_PERIOD_MS ごとに表示⇔非表示が切り替わる', () => {
    expect(isCursorBlinkOn(0)).toBe(true);
    expect(isCursorBlinkOn(CURSOR_BLINK_PERIOD_MS - 1)).toBe(true);
    expect(isCursorBlinkOn(CURSOR_BLINK_PERIOD_MS)).toBe(false);
    expect(isCursorBlinkOn(CURSOR_BLINK_PERIOD_MS * 2)).toBe(true);
  });
});

describe('applyCursorOverlay: Screen のビットマップを汚さない', () => {
  it('カーソルを重ねても元の Uint8Array（Screen.getDots()）は変化しない', () => {
    const screen = new Screen();
    screen.writeText('HELLO');
    const original = screen.getDots();
    const originalCopy = original.slice();

    applyCursorOverlay(original, { col: 2, row: 0 }, 0);

    expect(original).toEqual(originalCopy);
  });

  it('POINT 相当（Screen.point）の結果はカーソル描画の影響を受けない', () => {
    const screen = new Screen();
    // カーソル位置(セル0,0)の左上ドットは消灯のまま、のはず。
    expect(screen.point(0, 0)).toBe(0);
    applyCursorOverlay(screen.getDots(), { col: 0, row: 0 }, 0);
    expect(screen.point(0, 0)).toBe(0);
  });

  it('表示フェーズでは戻り値にカーソルセル分のドットが反転して現れる', () => {
    const screen = new Screen();
    const dots = screen.getDots();
    const overlaid = applyCursorOverlay(dots, { col: 0, row: 0 }, 0); // isCursorBlinkOn(0) === true

    let onCount = 0;
    for (let dy = 0; dy < CELL_HEIGHT; dy++) {
      for (let dx = 0; dx < CELL_WIDTH; dx++) {
        if (overlaid[dy * 144 + dx] !== 0) onCount++;
      }
    }
    // 元は全消灯セルなので、ブロックカーソルなら 6x8=48 ドット全てが点灯するはず。
    expect(onCount).toBeGreaterThan(0);
  });

  it('非表示フェーズでは dots をそのまま返す（複製もしない）', () => {
    const screen = new Screen();
    const dots = screen.getDots();
    const result = applyCursorOverlay(dots, { col: 0, row: 0 }, CURSOR_BLINK_PERIOD_MS); // 非表示フェーズ
    expect(result).toBe(dots); // 同一参照
  });

  it('cursor が null なら dots をそのまま返す', () => {
    const screen = new Screen();
    const dots = screen.getDots();
    const result = applyCursorOverlay(dots, null, 0);
    expect(result).toBe(dots);
  });
});
