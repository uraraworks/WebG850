// BASIC の値（数値／文字列）の表現と型変換。
// docs/design/phase1_architecture.md のディレクトリ構成メモに従い、
// 配列はここでは値の型定義だけを置く（DIM の実装は別担当）。

import { BasicError, ErrorCode } from './errors.js';

export type BasicValueType = 'numeric' | 'string';

export interface NumericValue {
  readonly type: 'numeric';
  readonly value: number;
}

export interface StringValue {
  readonly type: 'string';
  readonly value: string;
}

/** BASIC の値。数値と文字列の2種類のみ（配列は BasicArray を参照）。 */
export type BasicValue = NumericValue | StringValue;

export function numeric(value: number): NumericValue {
  return { type: 'numeric', value };
}

export function str(value: string): StringValue {
  return { type: 'string', value };
}

export function isNumeric(v: BasicValue): v is NumericValue {
  return v.type === 'numeric';
}

export function isString(v: BasicValue): v is StringValue {
  return v.type === 'string';
}

/**
 * 数値を取り出す。文字列が渡されたら型不一致エラー（ERROR 90）。
 * 例: 数値専用の関数（SIN 等）に文字列変数を渡した場合。
 */
export function asNumeric(v: BasicValue, lineNumber?: number): number {
  if (v.type !== 'numeric') {
    throw new BasicError(
      ErrorCode.TYPE_MISMATCH,
      '数値が必要な場所に文字列が指定されました',
      lineNumber,
    );
  }
  return v.value;
}

/** 文字列を取り出す。数値が渡されたら型不一致エラー（ERROR 90）。 */
export function asString(v: BasicValue, lineNumber?: number): string {
  if (v.type !== 'string') {
    throw new BasicError(
      ErrorCode.TYPE_MISMATCH,
      '文字列が必要な場所に数値が指定されました',
      lineNumber,
    );
  }
  return v.value;
}

/**
 * 変数名から型を判定する。G850 BASIC は変数名末尾の `$` で
 * 文字列変数を表す（例: `A$`, `NAME$`）。それ以外は数値変数。
 */
export function isStringVariableName(name: string): boolean {
  return name.endsWith('$');
}

export function variableValueType(name: string): BasicValueType {
  return isStringVariableName(name) ? 'string' : 'numeric';
}

/** 変数の初期値（未代入時の既定値）。数値は 0、文字列は空文字列。 */
export function defaultValueForType(type: BasicValueType): BasicValue {
  return type === 'numeric' ? numeric(0) : str('');
}

export function defaultValueForVariableName(name: string): BasicValue {
  return defaultValueForType(variableValueType(name));
}

/**
 * 配列の値の型定義のみ。DIM による確保・添字アクセス・添字範囲外エラー
 * （ERROR 32）の実装はパーサ／インタプリタ担当が別途行う。
 * ここでは「配列は要素の型と各次元のサイズを持つ」という形だけを固定する。
 */
export interface BasicArray {
  readonly elementType: BasicValueType;
  /** 各次元のサイズ（DIM で確保した添字の要素数。上限+1 かは実装側の規約による）。 */
  readonly dimensions: readonly number[];
  /** 1次元にフラット化して保持する想定の要素列。 */
  readonly elements: BasicValue[];
}

export function typeMismatchError(message: string, lineNumber?: number): BasicError {
  return new BasicError(ErrorCode.TYPE_MISMATCH, message, lineNumber);
}
