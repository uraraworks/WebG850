// src/basic/functions/string.ts のテスト。

import { describe, expect, it } from 'vitest';
import { BasicError } from '../src/basic/errors.js';
import { numeric, str, type BasicValue } from '../src/basic/value.js';
import { STRING_BUILTINS } from '../src/basic/functions/string.js';
import type { BuiltinContext } from '../src/basic/functions/types.js';

function makeCtx(inkeyValue = ''): BuiltinContext {
  return {
    angleMode: 'DEG',
    rnd: () => 0,
    inkey: () => inkeyValue,
    markUncertainUsed: () => {},
  };
}

function call(name: string, args: BasicValue[], ctx: BuiltinContext = makeCtx()): BasicValue {
  const spec = STRING_BUILTINS[name];
  if (!spec) throw new Error(`未登録: ${name}`);
  return spec.fn(args, ctx);
}

function callStr(name: string, args: BasicValue[], ctx?: BuiltinContext): string {
  const v = call(name, args, ctx);
  if (v.type !== 'string') throw new Error(`文字列を期待: ${name}`);
  return v.value;
}

function callNum(name: string, args: BasicValue[], ctx?: BuiltinContext): number {
  const v = call(name, args, ctx);
  if (v.type !== 'numeric') throw new Error(`数値を期待: ${name}`);
  return v.value;
}

describe('マニュアル実行例の回帰テスト', () => {
  it('HEX$(64) = "&40"', () => {
    expect(callStr('HEX$', [numeric(64)])).toBe('&40');
  });
});

describe('LEFT$/RIGHT$/MID$ の境界', () => {
  it('LEFT$: 文字数が文字列長を超える場合は全体を返す', () => {
    expect(callStr('LEFT$', [str('AB'), numeric(10)])).toBe('AB');
  });

  it('LEFT$: 文字数0は空文字列', () => {
    expect(callStr('LEFT$', [str('AB'), numeric(0)])).toBe('');
  });

  it('LEFT$: 文字数は四捨五入される', () => {
    expect(callStr('LEFT$', [str('ABCDE'), numeric(2.5)])).toBe('ABC'); // round(2.5)=3
  });

  it('RIGHT$: 文字数が文字列長を超える場合は全体を返す', () => {
    expect(callStr('RIGHT$', [str('AB'), numeric(10)])).toBe('AB');
  });

  it('RIGHT$: 空文字列に対しても正しく動く', () => {
    expect(callStr('RIGHT$', [str(''), numeric(3)])).toBe('');
  });

  it('LEFT$/RIGHT$: 文字数が範囲外(0〜255の外)はエラー', () => {
    expect(() => call('LEFT$', [str('AB'), numeric(-1)])).toThrow(BasicError);
    expect(() => call('LEFT$', [str('AB'), numeric(256)])).toThrow(BasicError);
  });

  it('MID$: 位置が文字列長を超える場合は空文字列', () => {
    expect(callStr('MID$', [str('ABC'), numeric(10), numeric(2)])).toBe('');
  });

  it('MID$: 位置が範囲外(1〜255の外)はエラー', () => {
    expect(() => call('MID$', [str('ABC'), numeric(0), numeric(2)])).toThrow(BasicError);
    expect(() => call('MID$', [str('ABC'), numeric(256), numeric(2)])).toThrow(BasicError);
  });

  it('MID$: 文字数は切り捨て（四捨五入ではない）', () => {
    expect(callStr('MID$', [str('ABCDE'), numeric(1), numeric(2.9)])).toBe('AB'); // trunc(2.9)=2
  });

  it('MID$: 通常ケース', () => {
    expect(callStr('MID$', [str('ABCDE'), numeric(2), numeric(3)])).toBe('BCD');
  });
});

describe('ASC/CHR$/LEN', () => {
  it('ASC: 先頭1文字のコードを返す（2文字以上でも先頭のみ）', () => {
    expect(callNum('ASC', [str('ABC')])).toBe(65);
  });

  it('ASC: 空文字列はエラー（無言で0を返さない）', () => {
    expect(() => call('ASC', [str('')])).toThrow(BasicError);
  });

  it('CHR$: ASCのほぼ逆関数', () => {
    expect(callStr('CHR$', [numeric(65)])).toBe('A');
  });

  it('LEN: 空白や制御コードも1文字として数える', () => {
    expect(callNum('LEN', [str('A B')])).toBe(3);
    expect(callNum('LEN', [str('')])).toBe(0);
  });
});

describe('VAL', () => {
  it('10進文字列を数値に変換する', () => {
    expect(callNum('VAL', [str('123.45')])).toBeCloseTo(123.45, 10);
  });

  it('& で始まる文字列は16進として解釈する', () => {
    expect(callNum('VAL', [str('&40')])).toBe(64);
  });

  it('不正な文字を含む場合は0を返す（仕様に明記された挙動）', () => {
    expect(callNum('VAL', [str('ABC')])).toBe(0);
    expect(callNum('VAL', [str('&ZZ')])).toBe(0);
  });

  it('STR$ と VAL は往復する', () => {
    const s = callStr('STR$', [numeric(-42.5)]);
    expect(callNum('VAL', [str(s)])).toBeCloseTo(-42.5, 10);
  });
});

describe('INKEY$', () => {
  it('ctx.inkey() をそのまま返す', () => {
    expect(callStr('INKEY$', [], makeCtx('A'))).toBe('A');
    expect(callStr('INKEY$', [], makeCtx(''))).toBe('');
  });
});

describe('型違いでエラーになること', () => {
  it('文字列関数に数値を渡すとERROR 90', () => {
    expect(() => call('LEN', [numeric(1)])).toThrow(BasicError);
    try {
      call('LEN', [numeric(1)]);
    } catch (e) {
      expect((e as BasicError).code).toBe(90);
    }
  });

  it('CHR$/HEX$ に文字列を渡すとERROR 90', () => {
    expect(() => call('CHR$', [str('A')])).toThrow(BasicError);
    expect(() => call('HEX$', [str('A')])).toThrow(BasicError);
  });
});
