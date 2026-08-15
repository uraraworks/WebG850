// 組込み関数の呼び出し規約。
//
// 他担当（parser/evaluator/interpreter）と噛み合わせるための固定インタフェース。
// ここは呼び出し規約の型定義のみを置き、実体（BUILTINS）は index.ts に置く。

import type { BasicValue } from '../value.js';

/** 角度モード。三角関数・POL/REC の角度単位に影響する（既定は DEGREE）。 */
export type AngleMode = 'DEG' | 'RAD' | 'GRAD';

/** 組込み関数の実行に必要な、インタプリタ側から渡される文脈。 */
export interface BuiltinContext {
  /** 現在の角度モード。 */
  angleMode: AngleMode;
  /** 0<=x<1 の乱数を返す（PRNG の実体は呼び出し側が持つ）。RND はこれを介して呼ぶこと。 */
  rnd(): number;
  /** INKEY$ 用。押されていなければ ''。 */
  inkey(): string;
  /** 不確定仕様（src/basic/uncertain.ts）を踏んだことを記録する。 */
  markUncertainUsed(id: string): void;
}

export type BuiltinFn = (args: BasicValue[], ctx: BuiltinContext) => BasicValue;

export interface BuiltinSpec {
  /** 最小引数個数。 */
  minArgs: number;
  /** 最大引数個数。引数を取らないものは 0,0。 */
  maxArgs: number;
  fn: BuiltinFn;
}
