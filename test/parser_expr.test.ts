// 式パーサのテスト。docs/design/phase1_grammar.md「式」節の優先順位表を
// そのとおりに実装できているかを構造レベルで確認する。

import { describe, expect, it } from 'vitest';
import type { BinaryOp, Expr, UnaryOp } from '../src/basic/ast.js';
import { cursorFromTokens, parseExpression } from '../src/basic/parser.js';
import { tokenize } from '../src/basic/tokenizer.js';

/** ソース文字列を最後まで消費する形で式をパースする（テスト専用の便宜関数）。 */
function parse(source: string): Expr {
  const cursor = cursorFromTokens(tokenize(source));
  const expr = parseExpression(cursor);
  expect(cursor.atEnd()).toBe(true);
  return expr;
}

describe('parseExpression: 優先順位・結合', () => {
  it('-2^2 は -(2^2) の構造になる（単項マイナスは ^ より弱い）', () => {
    const expr = parse('-2^2') as UnaryOp;
    expect(expr.kind).toBe('UnaryOp');
    expect(expr.op).toBe('-');
    const inner = expr.operand as BinaryOp;
    expect(inner.kind).toBe('BinaryOp');
    expect(inner.op).toBe('^');
    expect((inner.left as any).value).toBe(2);
    expect((inner.right as any).value).toBe(2);
  });

  it('2^3^2 は右結合（2^(3^2)）になる', () => {
    const expr = parse('2^3^2') as BinaryOp;
    expect(expr.kind).toBe('BinaryOp');
    expect(expr.op).toBe('^');
    expect((expr.left as any).value).toBe(2);
    const right = expr.right as BinaryOp;
    expect(right.kind).toBe('BinaryOp');
    expect(right.op).toBe('^');
    expect((right.left as any).value).toBe(3);
    expect((right.right as any).value).toBe(2);
  });

  it('1+2*3 は乗算が先に結合する', () => {
    const expr = parse('1+2*3') as BinaryOp;
    expect(expr.op).toBe('+');
    expect((expr.left as any).value).toBe(1);
    const right = expr.right as BinaryOp;
    expect(right.op).toBe('*');
    expect((right.left as any).value).toBe(2);
    expect((right.right as any).value).toBe(3);
  });

  it('1+8\\3 は \\（整数除算）が + より先に結合する', () => {
    const expr = parse('1+8\\3') as BinaryOp;
    expect(expr.op).toBe('+');
    expect((expr.left as any).value).toBe(1);
    const right = expr.right as BinaryOp;
    expect(right.op).toBe('\\');
    expect((right.left as any).value).toBe(8);
    expect((right.right as any).value).toBe(3);
  });

  it('8\\2*3 は \\ と * が同順位で左結合する（(8\\2)*3）', () => {
    const expr = parse('8\\2*3') as BinaryOp;
    expect(expr.op).toBe('*');
    const left = expr.left as BinaryOp;
    expect(left.op).toBe('\\');
    expect((left.left as any).value).toBe(8);
    expect((left.right as any).value).toBe(2);
    expect((expr.right as any).value).toBe(3);
  });

  it('8\\2 MOD 3 は \\ と MOD が同順位で左結合する（(8\\2) MOD 3）', () => {
    const expr = parse('8\\2 MOD 3') as BinaryOp;
    expect(expr.op).toBe('MOD');
    const left = expr.left as BinaryOp;
    expect(left.op).toBe('\\');
    expect((left.left as any).value).toBe(8);
    expect((left.right as any).value).toBe(2);
    expect((expr.right as any).value).toBe(3);
  });

  it('NOT A AND B は (NOT A) AND B になる', () => {
    const expr = parse('NOT A AND B') as BinaryOp;
    expect(expr.kind).toBe('BinaryOp');
    expect(expr.op).toBe('AND');
    const left = expr.left as UnaryOp;
    expect(left.kind).toBe('UnaryOp');
    expect(left.op).toBe('NOT');
    expect((left.operand as any).name).toBe('A');
    expect((expr.right as any).name).toBe('B');
  });

  it('A=1 OR B=2 は比較が OR より強く結合する', () => {
    const expr = parse('A=1 OR B=2') as BinaryOp;
    expect(expr.op).toBe('OR');
    const left = expr.left as BinaryOp;
    expect(left.op).toBe('=');
    expect((left.left as any).name).toBe('A');
    expect((left.right as any).value).toBe(1);
    const right = expr.right as BinaryOp;
    expect(right.op).toBe('=');
    expect((right.left as any).name).toBe('B');
    expect((right.right as any).value).toBe(2);
  });
});

describe('parseExpression: 一次式', () => {
  it('16進リテラル &HFF', () => {
    const expr = parse('&HFF');
    expect(expr.kind).toBe('NumberLiteral');
    expect((expr as any).value).toBe(255);
    expect((expr as any).raw).toBe('&HFF');
  });

  it('指数表記リテラル 1E-3', () => {
    const expr = parse('1E-3');
    expect(expr.kind).toBe('NumberLiteral');
    expect((expr as any).value).toBeCloseTo(0.001);
  });

  it('文字列リテラル', () => {
    const expr = parse('"HELLO"');
    expect(expr.kind).toBe('StringLiteral');
    expect((expr as any).value).toBe('HELLO');
  });

  it('文字列変数 A$', () => {
    const expr = parse('A$');
    expect(expr.kind).toBe('VariableRef');
    expect((expr as any).name).toBe('A$');
  });

  it('配列参照 A(1,2)', () => {
    const expr = parse('A(1,2)') as any;
    expect(expr.kind).toBe('ArrayRef');
    expect(expr.name).toBe('A');
    expect(expr.indices).toHaveLength(2);
    expect(expr.indices[0].value).toBe(1);
    expect(expr.indices[1].value).toBe(2);
  });

  it('PI は括弧なしの一次式になる', () => {
    const expr = parse('PI');
    expect(expr.kind).toBe('FunctionCall');
    expect((expr as any).name).toBe('PI');
    expect((expr as any).args).toHaveLength(0);
  });

  it('SIN(X) は関数呼び出しになる', () => {
    const expr = parse('SIN(X)') as any;
    expect(expr.kind).toBe('FunctionCall');
    expect(expr.name).toBe('SIN');
    expect(expr.args).toHaveLength(1);
    expect(expr.args[0].kind).toBe('VariableRef');
    expect(expr.args[0].name).toBe('X');
  });

  it('PEEK(0) は FunctionCall になる（ROM非依存の単なるバイト配列としてphase1実装済み）', () => {
    const expr = parse('PEEK(0)') as any;
    expect(expr.kind).toBe('FunctionCall');
    expect(expr.name).toBe('PEEK');
    expect(expr.args).toHaveLength(1);
  });

  it('EOF(1) は Phase 3 として Unsupported 扱いになる', () => {
    const expr = parse('EOF(1)') as any;
    expect(expr.kind).toBe('UnsupportedExpr');
    expect(expr.reason).toBe('phase3');
  });
});

describe('parseExpression: 括弧なし関数呼び出し（不確定仕様 UNPARENTHESIZED_CALL_BINDING）', () => {
  it('CHR$ 135 は括弧なしで FunctionCall になる', () => {
    const expr = parse('CHR$ 135') as any;
    expect(expr.kind).toBe('FunctionCall');
    expect(expr.name).toBe('CHR$');
    expect(expr.args).toHaveLength(1);
    expect(expr.args[0].kind).toBe('NumberLiteral');
    expect(expr.args[0].value).toBe(135);
  });

  it('RND 6 は括弧なしで FunctionCall になる', () => {
    const expr = parse('RND 6') as any;
    expect(expr.kind).toBe('FunctionCall');
    expect(expr.name).toBe('RND');
    expect(expr.args[0].value).toBe(6);
  });

  it('VAL A$ / LEN A$ は括弧なしで変数を引数に取れる', () => {
    const val = parse('VAL A$') as any;
    expect(val.kind).toBe('FunctionCall');
    expect(val.args[0].kind).toBe('VariableRef');
    expect(val.args[0].name).toBe('A$');

    const len = parse('LEN A$') as any;
    expect(len.kind).toBe('FunctionCall');
    expect(len.args[0].name).toBe('A$');
  });

  it('CHR$ (140-B) は従来どおり括弧付きの複合式を引数に取れる（非退行）', () => {
    const expr = parse('CHR$ (140-B)') as any;
    expect(expr.kind).toBe('FunctionCall');
    expect(expr.args).toHaveLength(1);
    const arg = expr.args[0] as BinaryOp;
    expect(arg.kind).toBe('BinaryOp');
    expect(arg.op).toBe('-');
    expect((arg.left as any).value).toBe(140);
    expect((arg.right as any).name).toBe('B');
  });

  it('CHR$ 140-B は束縛が最も強く、CHR$(140)-B と解釈される', () => {
    const expr = parse('CHR$ 140-B') as BinaryOp;
    expect(expr.kind).toBe('BinaryOp');
    expect(expr.op).toBe('-');
    const left = expr.left as any;
    expect(left.kind).toBe('FunctionCall');
    expect(left.name).toBe('CHR$');
    expect(left.args).toHaveLength(1);
    expect(left.args[0].value).toBe(140);
    expect((expr.right as any).name).toBe('B');
  });

  it('括弧付き呼び出しは従来どおり動く（非退行）', () => {
    const expr = parse('CHR$(135)') as any;
    expect(expr.kind).toBe('FunctionCall');
    expect(expr.args[0].value).toBe(135);
  });

  it('引数2個以上の関数（MID$）は括弧なしでは構文エラーになる', () => {
    expect(() => parse('MID$ A$,1,2')).toThrow();
  });

  it('引数2個以上の関数は従来どおり括弧付きで動く（非退行）', () => {
    const expr = parse('MID$(A$,1,2)') as any;
    expect(expr.kind).toBe('FunctionCall');
    expect(expr.args).toHaveLength(3);
  });
});
