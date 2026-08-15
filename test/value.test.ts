import { describe, expect, it } from 'vitest';
import { BasicError } from '../src/basic/errors.js';
import {
  asNumeric,
  asString,
  defaultValueForVariableName,
  isStringVariableName,
  numeric,
  str,
} from '../src/basic/value.js';

describe('value', () => {
  it('変数名末尾の $ で文字列変数を判定する', () => {
    expect(isStringVariableName('A$')).toBe(true);
    expect(isStringVariableName('A')).toBe(false);
  });

  it('既定値は数値0・文字列空文字列', () => {
    expect(defaultValueForVariableName('A')).toEqual(numeric(0));
    expect(defaultValueForVariableName('A$')).toEqual(str(''));
  });

  it('型不一致でエラーを投げる（ERROR 90）', () => {
    expect(() => asNumeric(str('X'))).toThrow(BasicError);
    expect(() => asString(numeric(1))).toThrow(BasicError);
    try {
      asNumeric(str('X'));
    } catch (e) {
      expect((e as BasicError).code).toBe(90);
    }
  });
});
