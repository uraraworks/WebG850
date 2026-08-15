// 数値の丸め・書式化。docs/design/phase1_architecture.md「数値モデル」節に従う。
//
// 採用方針: 内部計算は JS の number（IEEE754 double）のまま行い、
// 表示・文字列化のときだけここで 10 桁に丸める。実機の BCD 10 桁演算器を
// 再現するわけではない（精度方針: 完全再現は目指さない）。
//
// ここを直せば数値モデル全体が差し替わるよう、桁数・指数範囲は
// 名前付き定数として export する。

import { BasicError, ErrorCode } from './errors.js';

/** 仮数部の有効桁数（実機は BCD 10 桁）。 */
export const MANTISSA_DIGITS = 10;

/** 指数部の絶対値の上限（実機は ±99）。 */
export const EXPONENT_MAX = 99;

/**
 * オーバーフロー閾値。docs/spec/basic_errors.yaml の code 20 が
 * 「計算結果が演算可能範囲（10^100）を超えた」と明記しているため、
 * これは推測ではなく仕様書由来の値。
 */
const OVERFLOW_THRESHOLD = 10 ** (EXPONENT_MAX + 1);

/**
 * 値を仮数 10 桁に丸める。オーバーフロー（|x| >= 10^100）や非有限値
 * （Infinity/NaN、ゼロ除算等の結果）は無言で Infinity を返さず ERROR 20 にする
 * （設計書「オーバーフローは無言で Infinity を返さない」）。
 */
export function roundToMantissa(x: number): number {
  if (!Number.isFinite(x)) {
    throw new BasicError(ErrorCode.OVERFLOW, `オーバーフロー: 非有限な値です (${String(x)})`);
  }
  if (x === 0) {
    // -0 は 0 として扱う（BASIC に符号付きゼロの概念は無いと考える）。
    return 0;
  }
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  // toPrecision で10桁の有効数字に丸め、number に戻す。
  const rounded = Number(abs.toPrecision(MANTISSA_DIGITS));
  const result = sign * rounded;
  if (Math.abs(result) >= OVERFLOW_THRESHOLD) {
    throw new BasicError(
      ErrorCode.OVERFLOW,
      `オーバーフロー: |${x}| が 10^${EXPONENT_MAX + 1} 以上です`,
    );
  }
  return result;
}

/**
 * 指数表記部分（"1.234567891E+15" の "E+15" 側）を組み立てる。
 *
 * 【推測で決めた点・理由】 実機の PRINT 出力書式（指数の符号有無・桁数、
 * 区切り文字 "E" の有無）はマニュアル（docs/仕様_BASIC命令セット.md）からは
 * 確定できなかった。同世代の MS-BASIC 系ポケコン・電卓で広く使われる
 * 「E+符号+2桁」という慣習を採用した。EXPONENT_MAX=99 なので2桁で収まる。
 * 実機入手後に画面表示と突き合わせて要検証（この関数を直せば差し替えられる）。
 */
function formatExponent(exponent: number): string {
  const expSign = exponent < 0 ? '-' : '+';
  const expDigits = String(Math.abs(exponent)).padStart(2, '0');
  return `E${expSign}${expDigits}`;
}

/** 仮数部の文字列化。末尾の余分な 0 と、整数になった場合の小数点を落とす。 */
function trimTrailingZeros(s: string): string {
  if (!s.includes('.')) {
    return s;
  }
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * floor(log10(abs)) を求める。Math.log10 は 1000 や 1e21 のような
 * ちょうどの桁で浮動小数点誤差により 1 ずれることがあるため、
 * 10 のべき乗との比較で補正する。
 */
function computeExponent(abs: number): number {
  let exponent = Math.floor(Math.log10(abs));
  if (10 ** exponent > abs) {
    exponent -= 1;
  } else if (10 ** (exponent + 1) <= abs) {
    exponent += 1;
  }
  return exponent;
}

function formatFixed(abs: number): string {
  if (Number.isInteger(abs)) {
    return String(abs);
  }
  // 有効数字 MANTISSA_DIGITS 桁を保つよう小数点以下の桁数を計算する。
  const integerDigits = computeExponent(abs) + 1;
  const fractionDigits = Math.max(0, MANTISSA_DIGITS - Math.max(1, integerDigits));
  const s = abs.toFixed(fractionDigits);
  return trimTrailingZeros(s);
}

function formatExponential(abs: number, exponentHint: number): string {
  let exponent = exponentHint;
  let mantissa = abs / 10 ** exponent;
  let mantissaStr = mantissa.toPrecision(MANTISSA_DIGITS);
  // 丸めで 10.000... になってしまうケースを補正する（例: 9.9999999995 → 10）。
  if (Number(mantissaStr) >= 10) {
    exponent += 1;
    mantissa = abs / 10 ** exponent;
    mantissaStr = mantissa.toPrecision(MANTISSA_DIGITS);
  }
  return trimTrailingZeros(mantissaStr) + formatExponent(exponent);
}

/**
 * PRINT で出す文字列に変換する。
 *
 * - 正数は先頭にスペース（符号の位置を負数と揃える）、負数は "-"（依頼指示）
 * - 整数は小数点を出さない（依頼指示）
 * - 桁あふれ（10桁の仮数で固定小数点表記できない）は指数表記にする（依頼指示）
 *
 * 【推測で決めた点・理由】 固定小数点 ⇔ 指数表記の切り替え閾値は
 * マニュアルに記載が無かった。ここでは
 * 「整数部が MANTISSA_DIGITS(10) 桁を超える」または「絶対値が 0.01 未満」
 * を指数表記の条件とした。これは同世代の MS-BASIC 系ポケコン・電卓で
 * 広く見られる慣習（有効桁数に対して大きすぎる/小さすぎる値をE表記にする）
 * からの類推であり、実機の閾値そのものではない。実機入手後に要検証。
 */
export function formatNumber(x: number): string {
  const rounded = roundToMantissa(x);
  if (rounded === 0) {
    return ' 0';
  }
  const sign = rounded < 0 ? '-' : ' ';
  const abs = Math.abs(rounded);
  const exponent = computeExponent(abs);

  const useExponential = exponent >= MANTISSA_DIGITS || exponent < -2;
  const body = useExponential ? formatExponential(abs, exponent) : formatFixed(abs);
  return sign + body;
}
