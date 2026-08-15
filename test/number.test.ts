import { describe, expect, it } from 'vitest';
import { BasicError } from '../src/basic/errors.js';
import { formatNumber, MANTISSA_DIGITS, roundToMantissa } from '../src/basic/number.js';

describe('roundToMantissa', () => {
  it('10桁の有効数字に丸める', () => {
    expect(roundToMantissa(1 / 3)).toBe(Number((1 / 3).toPrecision(MANTISSA_DIGITS)));
  });

  it('0 はそのまま 0', () => {
    expect(roundToMantissa(0)).toBe(0);
    expect(roundToMantissa(-0)).toBe(0);
  });

  it('負の数の符号を保つ', () => {
    expect(roundToMantissa(-2.5)).toBe(-2.5);
  });

  it('オーバーフロー（10^100 以上）は無言で Infinity を返さずエラーにする', () => {
    expect(() => roundToMantissa(1e100)).toThrow(BasicError);
    try {
      roundToMantissa(1e100);
      throw new Error('ここには到達しないはず');
    } catch (e) {
      expect(e).toBeInstanceOf(BasicError);
      expect((e as BasicError).code).toBe(20);
    }
  });

  it('非有限な値（Infinity/NaN）もエラーにする', () => {
    expect(() => roundToMantissa(Infinity)).toThrow(BasicError);
    expect(() => roundToMantissa(NaN)).toThrow(BasicError);
  });
});

describe('formatNumber', () => {
  it('整数は小数点を出さない', () => {
    expect(formatNumber(42)).toBe(' 42');
    expect(formatNumber(0)).toBe(' 0');
  });

  it('正数の先頭にスペース、負数には - を付ける', () => {
    expect(formatNumber(5)).toBe(' 5');
    expect(formatNumber(-5)).toBe('-5');
  });

  it('小数は末尾の余分な 0 を出さない', () => {
    expect(formatNumber(3.14)).toBe(' 3.14');
    expect(formatNumber(0.5)).toBe(' 0.5');
  });

  it('桁あふれ（整数部が10桁を超える）は指数表記にする', () => {
    expect(formatNumber(1e12)).toBe(' 1E+12');
    expect(formatNumber(-1e12)).toBe('-1E+12');
  });

  it('絶対値が小さすぎる場合も指数表記にする', () => {
    expect(formatNumber(0.0001)).toBe(' 1E-04');
    expect(formatNumber(-0.0001)).toBe('-1E-04');
  });

  it('オーバーフローする値はエラーにする', () => {
    expect(() => formatNumber(1e100)).toThrow(BasicError);
  });
});

describe('formatNumber — docs/spec/number_display.md の実行例', () => {
  // マニュアル収録の実行例 4 件（AHC/AHS/AHT/REC）をそのまま回帰テストにする。
  // AHT(0.7) は「1未満の値で有効数字が1桁足りない」バグの再現ケース
  // （修正前は ' 0.867300528' になっていた。正しくは ' 0.8673005277'）。
  it('AHC 10 相当 → 2.993222846', () => {
    expect(formatNumber(Math.acosh(10))).toBe(' 2.993222846');
  });

  it('AHS 27.3 相当 → 4.000369154', () => {
    expect(formatNumber(Math.asinh(27.3))).toBe(' 4.000369154');
  });

  it('AHT 0.7 相当 → 0.8673005277（1未満で有効数字10桁になることの確認）', () => {
    expect(formatNumber(Math.atanh(0.7))).toBe(' 0.8673005277');
  });

  it('REC(12,30) 相当 → 10.39230485', () => {
    expect(formatNumber(12 * Math.cos(Math.PI / 6))).toBe(' 10.39230485');
  });

  it('整数は小数点を出さない（SQU の実行例 → 16）', () => {
    expect(formatNumber(16)).toBe(' 16');
  });

  it('末尾の 0 を出さない（VDEG の実行例 1度30分36秒 → 1.51）', () => {
    expect(formatNumber(1.51)).toBe(' 1.51');
  });
});
