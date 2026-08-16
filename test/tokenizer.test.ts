import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/basic/tokenizer.js';

describe('tokenize', () => {
  it('空白なしの FORI=1TO10 を FOR / I / = / 1 / TO / 10 に分割する', () => {
    const tokens = tokenize('FORI=1TO10');
    expect(tokens.map((t) => [t.type, t.text])).toEqual([
      ['keyword', 'FOR'],
      ['identifier', 'I'],
      ['operator', '='],
      ['number', '1'],
      ['keyword', 'TO'],
      ['number', '10'],
    ]);
    expect(tokens[3]?.numberValue).toBe(1);
    expect(tokens[5]?.numberValue).toBe(10);
  });

  it('16進数リテラル &HFF を 255 として読む', () => {
    const tokens = tokenize('&HFF');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'number', text: '&HFF', numberValue: 255 });
  });

  it('16進数リテラルは大文字小文字を問わない', () => {
    const tokens = tokenize('&hff');
    expect(tokens[0]).toMatchObject({ type: 'number', numberValue: 255 });
  });

  it('文字列リテラルを読む', () => {
    const tokens = tokenize('"HELLO WORLD"');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: 'string',
      text: '"HELLO WORLD"',
      stringValue: 'HELLO WORLD',
    });
  });

  it('閉じクォートが無い文字列は行末までを内容とする', () => {
    const tokens = tokenize('"UNCLOSED');
    expect(tokens[0]).toMatchObject({ type: 'string', stringValue: 'UNCLOSED' });
  });

  it("' 以降を行末までコメントとして扱う", () => {
    const tokens = tokenize('PRINT 1 \' 注記');
    expect(tokens.map((t) => t.type)).toEqual(['keyword', 'number', 'comment']);
    expect(tokens[2]?.text).toBe("' 注記");
  });

  it('REM 以降を行末までコメントとして扱う', () => {
    const tokens = tokenize('PRINT 1:REM 注記');
    expect(tokens.map((t) => t.type)).toEqual([
      'keyword',
      'number',
      'colon',
      'keyword',
      'comment',
    ]);
    expect(tokens[3]?.text).toBe('REM');
    expect(tokens[4]?.text).toBe(' 注記');
  });

  it('REM のみで本文が無い場合はコメントトークンを出さない', () => {
    const tokens = tokenize('REM');
    expect(tokens.map((t) => t.type)).toEqual(['keyword']);
  });

  it(': で区切られた複文をトークン化する', () => {
    const tokens = tokenize('A=1:B=2');
    expect(tokens.map((t) => [t.type, t.text])).toEqual([
      ['identifier', 'A'],
      ['operator', '='],
      ['number', '1'],
      ['colon', ':'],
      ['identifier', 'B'],
      ['operator', '='],
      ['number', '2'],
    ]);
  });

  it('文字列変数名（末尾 $）を識別子として読む', () => {
    const tokens = tokenize('NAME$="X"');
    expect(tokens[0]).toMatchObject({ type: 'identifier', text: 'NAME$' });
  });

  it('2文字演算子 <= >= <> を1トークンとして読む', () => {
    const tokens = tokenize('A<=1:B>=2:C<>3');
    const ops = tokens.filter((t) => t.type === 'operator').map((t) => t.text);
    expect(ops).toEqual(['<=', '>=', '<>']);
  });

  it('小数・指数表記の数値リテラルを読む', () => {
    const tokens = tokenize('1.5 1.5E10 1E+3 1E-3');
    expect(tokens.map((t) => t.numberValue)).toEqual([1.5, 1.5e10, 1e3, 1e-3]);
  });

  it('整数部を省略した小数リテラル（.5）は 0.5 と等価に読める', () => {
    const tokens = tokenize('.5 0.5');
    expect(tokens.map((t) => t.type)).toEqual(['number', 'number']);
    expect(tokens.map((t) => t.numberValue)).toEqual([0.5, 0.5]);
  });

  it('識別子中のドット（A.B）は数値リテラルへ誤読しない', () => {
    // ドットの直後が数字のときだけ数値リテラルとして扱う。A.B は従来どおり
    // identifier "A" / operator "." / identifier "B" に分かれる。
    const tokens = tokenize('A.B');
    expect(tokens.map((t) => [t.type, t.text])).toEqual([
      ['identifier', 'A'],
      ['operator', '.'],
      ['identifier', 'B'],
    ]);
  });
});
