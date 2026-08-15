// 文字列系の組込み関数（phase: 1, kind: function のうち文字列関連）。
// 仕様は docs/spec/basic_commands.yaml を正典とする。

import { BasicError, ErrorCode } from '../errors.js';
import { asNumeric, asString, numeric, str } from '../value.js';
import type { BuiltinContext, BuiltinFn, BuiltinSpec } from './types.js';
import { formatNumber } from '../number.js';

function illegal(message: string): never {
  throw new BasicError(ErrorCode.ILLEGAL_FUNCTION_CALL, message);
}

/**
 * LEFT$/RIGHT$/MID$ の文字数引数の丸め処理。
 * docs/spec notes「小数は四捨五入」。範囲外（0〜255 の外）は ERROR。
 */
function roundedCount(x: number, label: string): number {
  const n = Math.round(x);
  if (n < 0 || n > 255) illegal(`${label}: 文字数は 0〜255 の範囲で指定してください`);
  return n;
}

const leftStr: BuiltinFn = (args) => {
  const s = asString(args[0]);
  const n = roundedCount(asNumeric(args[1]), 'LEFT$');
  return str(s.slice(0, n));
};

const rightStr: BuiltinFn = (args) => {
  const s = asString(args[0]);
  const n = roundedCount(asNumeric(args[1]), 'RIGHT$');
  return str(n === 0 ? '' : s.slice(Math.max(0, s.length - n)));
};

const midStr: BuiltinFn = (args) => {
  const s = asString(args[0]);
  const posRaw = asNumeric(args[1]);
  const pos = Math.round(posRaw);
  // docs/spec notes: 位置は 1〜255。範囲外はERROR（具体的なエラー番号は
  // 仕様書に未記載。docs/spec/basic_commands.yaml の MID$ notes 参照）。
  if (pos < 1 || pos > 255) illegal('MID$: 位置は 1〜255 の範囲で指定してください');
  // docs/spec notes: 文字数は小数点以下切り捨て（LEFT$/RIGHT$ の四捨五入とは異なる）。
  const countRaw = Math.trunc(asNumeric(args[2]));
  if (countRaw < 0 || countRaw > 255) illegal('MID$: 文字数は 0〜255 の範囲で指定してください');
  if (pos > s.length) return str('');
  return str(s.slice(pos - 1, pos - 1 + countRaw));
};

const lenFn: BuiltinFn = (args) => numeric(asString(args[0]).length);

const ascFn: BuiltinFn = (args) => {
  const s = asString(args[0]);
  if (s.length === 0) illegal('ASC: 空文字列にはコードがありません');
  return numeric(s.charCodeAt(0));
};

/**
 * CHR$: 整数値(型はInteger) → 対応する1文字。
 * 【推測で決めた点】 マニュアルに有効範囲の明記が無いが、charCodeが未定義に
 * ならないよう 0〜255（拡張ASCII/カナの範囲）に制限した。
 */
const chrStr: BuiltinFn = (args) => {
  const n = Math.round(asNumeric(args[0]));
  if (n < 0 || n > 255) illegal('CHR$: コードは 0〜255 の範囲で指定してください');
  return str(String.fromCharCode(n));
};

/**
 * HEX$: 整数値 → "&" + 16進表記の文字列。例: HEX$(64) = "&40"。
 * 【推測で決めた点】 負の値の扱いはマニュアルに明記が無い。整数化は
 * 「整数として扱われる」の文言から Math.trunc（ゼロ方向）を採用。
 * 負数は 2の補数表現などの根拠が無いため、ここでは ERROR とする
 * （もっともらしい値で黙って埋めるよりは安全側）。
 */
const hexStr: BuiltinFn = (args) => {
  const n = Math.trunc(asNumeric(args[0]));
  if (n < 0) illegal('HEX$: 負の値は未対応です');
  return str('&' + n.toString(16).toUpperCase());
};

// STR$ は PRINT と同じ書式（正数の先頭スペースを含む）を採用する。
// number.ts の formatNumber をそのまま使うことで、PRINT と STR$ の表示が
// 一致する（両者が食い違うと利用者が混乱するため）。
const strStr: BuiltinFn = (args) => str(formatNumber(asNumeric(args[0])));

/**
 * VAL: 文字列 → 数値。先頭が "&" なら16進として解釈する。
 * 不正な文字を含む場合は0を返す（docs/spec 明記。VAL のみ「無言で0」が
 * 仕様として明文化されているので、これは黙殺ではなく仕様どおりの実装）。
 */
const valFn: BuiltinFn = (args) => {
  const raw = asString(args[0]).trim();
  if (raw.length === 0) return numeric(0);
  if (raw.startsWith('&')) {
    const hexBody = raw.slice(1);
    if (!/^[0-9A-Fa-f]+$/.test(hexBody)) return numeric(0);
    return numeric(parseInt(hexBody, 16));
  }
  const m = /^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(raw);
  if (!m) return numeric(0);
  const parsed = Number(m[0]);
  return numeric(Number.isFinite(parsed) ? parsed : 0);
};

const inkeyStr: BuiltinFn = (_args, ctx: BuiltinContext) => str(ctx.inkey());

export const STRING_BUILTINS: Record<string, BuiltinSpec> = {
  'LEFT$': { minArgs: 2, maxArgs: 2, fn: leftStr },
  'RIGHT$': { minArgs: 2, maxArgs: 2, fn: rightStr },
  'MID$': { minArgs: 3, maxArgs: 3, fn: midStr },
  LEN: { minArgs: 1, maxArgs: 1, fn: lenFn },
  ASC: { minArgs: 1, maxArgs: 1, fn: ascFn },
  'CHR$': { minArgs: 1, maxArgs: 1, fn: chrStr },
  'HEX$': { minArgs: 1, maxArgs: 1, fn: hexStr },
  'STR$': { minArgs: 1, maxArgs: 1, fn: strStr },
  VAL: { minArgs: 1, maxArgs: 1, fn: valFn },
  'INKEY$': { minArgs: 0, maxArgs: 0, fn: inkeyStr },
};
