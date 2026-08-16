import { describe, expect, it } from 'vitest';
import { UnsupportedError } from '../src/basic/errors.js';
import { formatUsingNumber } from '../src/basic/using.js';

describe('formatUsingNumber', () => {
  it('"####" は整数を右寄せ4桁で出す', () => {
    expect(formatUsingNumber('####', 42)).toBe('  42');
    expect(formatUsingNumber('####', 0)).toBe('   0');
  });

  it('"###.##" は小数部を四捨五入して固定桁数で出す', () => {
    expect(formatUsingNumber('###.##', 3.14159)).toBe('  3.14');
    expect(formatUsingNumber('###.##', 3.145)).toBe('  3.15');
  });

  it('整数部が桁数を超えると桁あふれ（"%"付きで完全な値）になる', () => {
    expect(formatUsingNumber('##', 123)).toBe('%123');
    expect(formatUsingNumber('#.#', 12.3)).toBe('%12.3');
  });

  it('負数は整数部の余白へ符号を詰める', () => {
    // "####" は4桁。"12" は2桁なので余白1桁分に "-" を詰め、全体で4文字になる。
    expect(formatUsingNumber('####', -12)).toBe(' -12');
  });

  it('負数で符号を置く余白が無ければ桁あふれ扱いになる', () => {
    expect(formatUsingNumber('##', -12)).toBe('%-12');
  });

  it('"#"/"." 以外の書式文字（, ^ &）は無言で無視せず UnsupportedError を投げる', () => {
    expect(() => formatUsingNumber('#,###', 1000)).toThrow(UnsupportedError);
    expect(() => formatUsingNumber('#.##^^^^', 1)).toThrow(UnsupportedError);
    expect(() => formatUsingNumber('&&&&&', 1)).toThrow(UnsupportedError);
    try {
      formatUsingNumber('#,###', 1000);
      throw new Error('ここには到達しないはず');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedError);
      expect((e as UnsupportedError).name_).toBe('USING(,)');
    }
  });
});
