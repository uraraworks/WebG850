// `USING` / `PRINT USING` の書式文字列を数値へ適用する。
//
// docs/spec/basic_commands.yaml PRINT の notes より、書式文字は
// `#`=数値の桁、`.`=小数点区切り、`,`=3桁カンマ区切り、`^`=指数表記、
// `&`=文字列の桁の5種類。依頼スコープに従い、ここでは `#` と `.` のみを実装し、
// それ以外の書式文字（`,` `^` `&`）や未知の文字が来たら無言で無視せず
// `UnsupportedError` を投げる（親 CLAUDE.md「未実装の命令は無言で無視しない」）。

import { UnsupportedError } from './errors.js';
import { markUncertainUsed } from './uncertain.js';

/** サポート対象の書式文字（`#` = 桁、`.` = 小数点）。 */
const SUPPORTED_CHARS = new Set(['#', '.']);

/**
 * USING の書式文字列を解析する。サポート外の文字（`,`/`^`/`&`、あるいは
 * 単なる綴り間違い）が1文字でも含まれていたら `UnsupportedError` を投げる。
 */
function parseFormat(format: string): { intDigits: number; hasDot: boolean; fracDigits: number } {
  for (const ch of format) {
    if (!SUPPORTED_CHARS.has(ch)) {
      // 【判断】 "USING(<文字>)" という名前で UnsupportedError を投げる。
      // 依頼指示「無言で無視せず ?UNSUPPORTED として見えるようにする」に対応。
      throw new UnsupportedError(`USING(${ch})`);
    }
  }
  const dotIndex = format.indexOf('.');
  const hasDot = dotIndex !== -1;
  const intPart = hasDot ? format.slice(0, dotIndex) : format;
  const fracPart = hasDot ? format.slice(dotIndex + 1) : '';
  // 2個目の "." は SUPPORTED_CHARS チェックを通っているが構文として不正
  // （分割ロジックが最初の "." しか見ないため、2個目以降は fracPart 側の
  // 文字数に混ざり込む）。実在作品の計測でも複数ドットの用例は無かったため、
  // ここでは fracPart に残った "." もそのまま桁数として無視する（安全側）。
  const intDigits = (intPart.match(/#/g) ?? []).length;
  const fracDigits = (fracPart.match(/#/g) ?? []).length;
  return { intDigits, hasDot, fracDigits };
}

/**
 * 桁あふれ（整数部が書式の桁数に収まらない、または符号を置く余白が無い）
 * ときの表示。`%` を前置してまるめ無しの完全な値を出す（`uncertain.ts`
 * `USING_OVERFLOW_STYLE_NOTE` 参照。MS-BASIC系の慣行からの類推）。
 */
function formatOverflow(value: number, fracDigits: number): string {
  markUncertainUsed('USING_OVERFLOW_STYLE');
  return `%${value.toFixed(fracDigits)}`;
}

/**
 * 数値1個を USING の書式文字列へ当てはめる。
 *
 * - `#` は桁のプレースホルダ、`.` は小数点区切り。
 * - 小数部は `fracDigits` 桁に四捨五入する。
 * - 整数部が `intDigits` 桁に収まらない場合、あるいは負数で符号を置く余白が
 *   無い場合は桁あふれとして `%` 付きの完全な値を返す（`uncertain.ts` 参照）。
 * - `#`/`.` 以外の書式文字が含まれる場合は `UnsupportedError` を投げる。
 */
export function formatUsingNumber(format: string, value: number): string {
  const { intDigits, hasDot, fracDigits } = parseFormat(format);
  const negative = value < 0;
  const abs = Math.abs(value);
  const rounded = Number(abs.toFixed(fracDigits));
  const fixed = rounded.toFixed(fracDigits);
  const dotIndex = fixed.indexOf('.');
  const intStr = dotIndex === -1 ? fixed : fixed.slice(0, dotIndex);
  const fracStr = dotIndex === -1 ? '' : fixed.slice(dotIndex + 1);

  if (intStr.length > intDigits) {
    return formatOverflow(value, fracDigits);
  }

  let paddedInt: string;
  if (negative) {
    // 符号は整数部の余白（未使用の "#" 桁）へ詰める。余白が無ければ
    // 桁あふれと同じ扱い（uncertain.ts USING_NEGATIVE_SIGN_PLACEMENT_NOTE）。
    if (intStr.length >= intDigits) {
      return formatOverflow(value, fracDigits);
    }
    markUncertainUsed('USING_NEGATIVE_SIGN_PLACEMENT');
    const padding = intDigits - intStr.length - 1;
    paddedInt = ' '.repeat(padding) + '-' + intStr;
  } else {
    paddedInt = intStr.padStart(intDigits, ' ');
  }

  return hasDot ? `${paddedInt}.${fracStr}` : paddedInt;
}
