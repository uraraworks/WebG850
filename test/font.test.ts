import { describe, expect, it } from 'vitest';
import { FONT_GLYPH_HEIGHT, FONT_GLYPH_WIDTH, getGlyph } from '../src/machine/font.ts';

const FIRST_CODE = 0x20;
const LAST_CODE = 0x7e;

describe('font', () => {
  it('セルの寸法が 5x7 である', () => {
    expect(FONT_GLYPH_WIDTH).toBe(5);
    expect(FONT_GLYPH_HEIGHT).toBe(7);
  });

  it('ASCII 0x20〜0x7E の全 95 文字が 5 バイトのグリフを持つ', () => {
    for (let code = FIRST_CODE; code <= LAST_CODE; code++) {
      const glyph = getGlyph(code);
      expect(glyph.length).toBe(5);
      for (const byte of glyph) {
        // 7 ドット分（bit0〜bit6）に収まっている＝上位ビットが立っていない
        expect(byte).toBeLessThan(1 << FONT_GLYPH_HEIGHT);
        expect(byte).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('未定義コードは空白ではなく全点灯の箱を返す', () => {
    const fullBox = new Uint8Array([0x7f, 0x7f, 0x7f, 0x7f, 0x7f]); // 7ドット全点灯 = 0b1111111 = 0x7f
    expect(getGlyph(0x00)).toEqual(fullBox);
    expect(getGlyph(0x1f)).toEqual(fullBox); // 制御コード領域
    expect(getGlyph(0x7f)).toEqual(fullBox); // DEL（収録範囲外）
    expect(getGlyph(0x100)).toEqual(fullBox); // 範囲外の値
  });

  it('スペース(0x20)は全消灯', () => {
    expect(getGlyph(0x20)).toEqual(new Uint8Array([0, 0, 0, 0, 0]));
  });

  it("'A' (0x41) のビットパターンが固定値と一致する（回帰検出用）", () => {
    // .#..#   ..#..
    // .#.#.   .#.#.
    // #...#   #...#
    // #...#   #...#
    // #####   #####
    // #...#   #...#
    // #...#   #...#
    // 列ごとに: col0=#はrow2,3,4,5,6 → bit2..bit6 = 0b1111100 = 0x7c
    //           col1=#はrow1,4       → bit1,bit4   = 0b0010010 = 0x12
    //           col2=#はrow0,4       → bit0,bit4   = 0b0010001 = 0x11
    //           col3=#はrow1,4       → bit1,bit4   = 0b0010010 = 0x12
    //           col4=#はrow2,3,4,5,6 → bit2..bit6 = 0b1111100 = 0x7c
    expect(getGlyph(0x41)).toEqual(new Uint8Array([0x7c, 0x12, 0x11, 0x12, 0x7c]));
  });

  it("'0' (0x30) のビットパターンが固定値と一致する（回帰検出用、O と区別するため内部に斜め線あり）", () => {
    // .###.   #...#
    // #...#   #..##
    // #..##   #.#.#
    // #.#.#   ##..#
    // ##..#   #...#
    // #...#   .###.
    // .###.
    // 列方向の値は getGlyph() の実測値をそのまま固定値化している（tools/dump_font.mjs で目視確認済み）。
    expect(getGlyph(0x30)).toEqual(new Uint8Array([0x3e, 0x51, 0x49, 0x45, 0x3e]));
  });

  it("'#' (0x23) のビットパターンが固定値と一致する（回帰検出用）", () => {
    // #####   .#.#.
    // .#.#.   .#.#.
    // #####   #####
    // .#.#.   .#.#.
    // #####   #####
    // .#.#.   .#.#.
    // .#.#.   .#.#.
    // col0: row2,4        → 0b0010100 = 0x14
    // col1: row0,1,2,3,4,5,6 → 0b1111111 = 0x7f
    // col2: row2,4        → 0b0010100 = 0x14
    // col3: 同col1        → 0x7f
    // col4: 同col0        → 0x14
    expect(getGlyph(0x23)).toEqual(new Uint8Array([0x14, 0x7f, 0x14, 0x7f, 0x14]));
  });
});
