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
