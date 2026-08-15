// 組込み関数（phase: 1, kind: function）のレジストリ組み立て。
//
// docs/spec/basic_commands.yaml で kind: function かつ phase: 1 の 49 個のうち、
// POINT は画面（machine/screen.ts）に依存するためここでは実装しない
// （呼び出し側が別途、画面を持つ実装から BUILTINS へ足す想定）。

import { MATH_BUILTINS } from './math.js';
import { STRING_BUILTINS } from './string.js';
import type { AngleMode, BuiltinContext, BuiltinFn, BuiltinSpec } from './types.js';

export type { AngleMode, BuiltinContext, BuiltinFn, BuiltinSpec };

export const BUILTINS: Record<string, BuiltinSpec> = {
  ...MATH_BUILTINS,
  ...STRING_BUILTINS,
};
