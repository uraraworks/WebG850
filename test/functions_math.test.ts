// src/basic/functions/math.ts のテスト。
//
// docs/spec/basic_commands.yaml の notes にある実行例は回帰テストとして
// 必ず拾う（BuiltinContext の呼び出し規約は src/basic/functions/types.ts）。
// 表示文字列との比較は number.ts の formatNumber を通す
// （docs/spec/number_display.md「有効数字10桁・四捨五入」）。

import { describe, expect, it } from 'vitest';
import { BasicError } from '../src/basic/errors.js';
import { formatNumber } from '../src/basic/number.js';
import { numeric, str, type BasicValue } from '../src/basic/value.js';
import { MATH_BUILTINS } from '../src/basic/functions/math.js';
import type { AngleMode, BuiltinContext } from '../src/basic/functions/types.js';

function makeCtx(angleMode: AngleMode = 'DEG', rndSeq: number[] = []): BuiltinContext {
  let i = 0;
  return {
    angleMode,
    rnd: () => {
      const v = rndSeq[i % rndSeq.length] ?? 0;
      i++;
      return v;
    },
    inkey: () => '',
    markUncertainUsed: () => {},
  };
}

function call(name: string, args: BasicValue[], ctx: BuiltinContext = makeCtx()): BasicValue {
  const spec = MATH_BUILTINS[name];
  if (!spec) throw new Error(`未登録: ${name}`);
  return spec.fn(args, ctx);
}

function callNum(name: string, args: BasicValue[], ctx?: BuiltinContext): number {
  const v = call(name, args, ctx);
  if (v.type !== 'numeric') throw new Error(`数値を期待: ${name}`);
  return v.value;
}

describe('マニュアル実行例の回帰テスト', () => {
  it('AHC 10 → 2.993222846', () => {
    expect(formatNumber(callNum('AHC', [numeric(10)]))).toBe(' 2.993222846');
  });

  it('AHS 27.3 → 4.000369154', () => {
    expect(formatNumber(callNum('AHS', [numeric(27.3)]))).toBe(' 4.000369154');
  });

  it('AHT 0.7 → 0.8673005277（マニュアルの0.867300527は末尾7が脱字。number_display.md参照）', () => {
    expect(formatNumber(callNum('AHT', [numeric(0.7)]))).toBe(' 0.8673005277');
  });

  it('REC(12,30) → 10.39230485（DEGモード）', () => {
    const ctx = makeCtx('DEG');
    expect(formatNumber(callNum('REC', [numeric(12), numeric(30)], ctx))).toBe(' 10.39230485');
  });

  it('SQU 4 → 16', () => {
    expect(callNum('SQU', [numeric(4)])).toBe(16);
  });

  it('VDEG "1度30分36秒" → 1.51', () => {
    expect(callNum('VDEG', [str('1度30分36秒')])).toBeCloseTo(1.51, 10);
  });

  it('FIX(-8.4) = -8（INT(-8.4)=-9と対比）', () => {
    expect(callNum('FIX', [numeric(-8.4)])).toBe(-8);
    expect(callNum('INT', [numeric(-8.4)])).toBe(-9);
  });

  it('EXP(10) = 220026.4658（範囲内）、範囲外は0', () => {
    expect(callNum('EXP', [numeric(10)])).toBeCloseTo(22026.4658, 3);
    expect(callNum('EXP', [numeric(1000)])).toBe(0);
    expect(callNum('EXP', [numeric(-1000)])).toBe(0);
  });

  it('HSN 4 = 27.2899172（両版一致の実行例）', () => {
    expect(callNum('HSN', [numeric(4)])).toBeCloseTo(27.2899172, 6);
  });

  it('HTN 0.9 = 0.71629787（両版一致の実行例）', () => {
    expect(callNum('HTN', [numeric(0.9)])).toBeCloseTo(0.71629787, 6);
  });

  it('POL(8,6) → 10、Z(θ)は本モジュールの責務外だが distance は8-6-10の直角三角形', () => {
    expect(callNum('POL', [numeric(8), numeric(6)])).toBe(10);
  });
});

describe('角度モードによる三角関数の違い', () => {
  it('SIN: DEG/RAD/GRAD で 90°相当がそれぞれ1になる', () => {
    expect(callNum('SIN', [numeric(90)], makeCtx('DEG'))).toBeCloseTo(1, 10);
    expect(callNum('SIN', [numeric(Math.PI / 2)], makeCtx('RAD'))).toBeCloseTo(1, 10);
    expect(callNum('SIN', [numeric(100)], makeCtx('GRAD'))).toBeCloseTo(1, 10);
  });

  it('COS: 同じ角度でもモードが違えば異なる値になる', () => {
    const cosDeg = callNum('COS', [numeric(60)], makeCtx('DEG'));
    const cosRad = callNum('COS', [numeric(60)], makeCtx('RAD'));
    expect(cosDeg).toBeCloseTo(0.5, 10);
    expect(cosDeg).not.toBeCloseTo(cosRad, 5);
  });

  it('ATN: 角度モードに応じて戻り値の単位が変わる（ATN(1)）', () => {
    expect(callNum('ATN', [numeric(1)], makeCtx('DEG'))).toBeCloseTo(45, 10);
    expect(callNum('ATN', [numeric(1)], makeCtx('RAD'))).toBeCloseTo(Math.PI / 4, 10);
    expect(callNum('ATN', [numeric(1)], makeCtx('GRAD'))).toBeCloseTo(50, 10);
  });
});

describe('定義域チェック（無言でNaN/Infinityを返さない）', () => {
  it('ASN/ACS: |x|>1 はエラー', () => {
    expect(() => call('ASN', [numeric(1.5)])).toThrow(BasicError);
    expect(() => call('ACS', [numeric(-1.5)])).toThrow(BasicError);
  });

  it('SQR: 負数はエラー', () => {
    expect(() => call('SQR', [numeric(-1)])).toThrow(BasicError);
  });

  it('LN: 1E-99未満はエラー', () => {
    expect(() => call('LN', [numeric(0)])).toThrow(BasicError);
    expect(() => call('LN', [numeric(1)])).not.toThrow();
  });

  it('LOG: 0以下はエラー', () => {
    expect(() => call('LOG', [numeric(0)])).toThrow(BasicError);
    expect(() => call('LOG', [numeric(-5)])).toThrow(BasicError);
  });

  it('RCP: 0の逆数はエラー', () => {
    expect(() => call('RCP', [numeric(0)])).toThrow(BasicError);
  });

  it('AHC: 1未満はエラー、AHT: |x|>=1 はエラー', () => {
    expect(() => call('AHC', [numeric(0.5)])).toThrow(BasicError);
    expect(() => call('AHT', [numeric(1)])).toThrow(BasicError);
    expect(() => call('AHT', [numeric(-1)])).toThrow(BasicError);
  });

  it('TAN: 極ではエラー', () => {
    expect(() => call('TAN', [numeric(90)], makeCtx('DEG'))).toThrow(BasicError);
  });

  it('FACT: 負数・非整数はエラー', () => {
    expect(() => call('FACT', [numeric(-1)])).toThrow(BasicError);
    expect(() => call('FACT', [numeric(2.5)])).toThrow(BasicError);
    expect(callNum('FACT', [numeric(5)])).toBe(120);
    expect(callNum('FACT', [numeric(0)])).toBe(1);
  });

  it('FACT: 演算可能範囲(10^100)超はオーバーフローエラー', () => {
    expect(() => call('FACT', [numeric(200)])).toThrow(BasicError);
    try {
      call('FACT', [numeric(200)]);
    } catch (e) {
      expect((e as BasicError).code).toBe(20);
    }
  });

  it('NCR/NPR: rがnを超えるとエラー', () => {
    expect(() => call('NCR', [numeric(3), numeric(5)])).toThrow(BasicError);
    expect(callNum('NCR', [numeric(5), numeric(2)])).toBe(10);
    expect(callNum('NPR', [numeric(5), numeric(2)])).toBe(20);
  });
});

describe('型違いでエラーになること', () => {
  it('数値関数に文字列を渡すとERROR 90', () => {
    expect(() => call('SIN', [str('X')])).toThrow(BasicError);
    try {
      call('SIN', [str('X')]);
    } catch (e) {
      expect((e as BasicError).code).toBe(90);
    }
  });

  it('VDEG に数値を渡すとERROR 90', () => {
    expect(() => call('VDEG', [numeric(1)])).toThrow(BasicError);
  });
});

describe('RND', () => {
  it('0<x<1: ctx.rnd() を経由し、Math.random を直接呼ばない', () => {
    const ctx = makeCtx('DEG', [0.25]);
    expect(callNum('RND', [numeric(1)], ctx)).toBeCloseTo(0.25, 9);
  });

  it('x>1: 1〜floor(x)の整数', () => {
    const ctx = makeCtx('DEG', [0.999999]);
    const v = callNum('RND', [numeric(6)], ctx);
    expect(v).toBe(6); // floor(0.999999*6)+1 = 6
    expect(Number.isInteger(v)).toBe(true);
  });

  it('x<0: 直前と同じ値を返す', () => {
    const ctx = makeCtx('DEG', [0.4]);
    const first = callNum('RND', [numeric(1)], ctx);
    const second = callNum('RND', [numeric(-1)], ctx);
    expect(second).toBe(first);
  });
});

describe('DEG/DMS/DMS$/VDEG の相互変換', () => {
  it('DMS(50.5) → DEG(...) で往復する', () => {
    const packed = callNum('DMS', [numeric(50.5)]);
    expect(callNum('DEG', [numeric(packed)])).toBeCloseTo(50.5, 8);
  });

  it("DMS$(1.51) は 1°30'36.00\" 相当の文字列になる", () => {
    const v = call('DMS$', [numeric(1.51)]) as { type: 'string'; value: string };
    expect(v.value).toBe('1°30\'36.00"');
  });
});

describe('MDF: 現在の呼び出し規約では実現できない状態に依存するため未対応', () => {
  it('UnsupportedError を投げる（黙って値を捏造しない）', () => {
    expect(() => call('MDF', [])).toThrow();
  });
});
