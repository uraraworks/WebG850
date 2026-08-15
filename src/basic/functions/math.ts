// 数値系の組込み関数（phase: 1, kind: function のうち数値関連）。
//
// 仕様は docs/spec/basic_commands.yaml を正典とする。実行例（notes）がある
// ものは test/functions_math.test.ts の回帰テストに落としてある。
//
// 未確定・未文書の挙動は「もっともらしい値で黙って埋めない」
// （親 CLAUDE.md の方針）。定義域を外れた入力は ERROR を投げる。
// 例外は EXP のみ：docs/spec の notes に「範囲外は関数値0」と明記されている。

import { BasicError, ErrorCode, UnsupportedError } from '../errors.js';
import { asNumeric, asString, numeric, str, type BasicValue } from '../value.js';
import { REC_ASSIGNS_X_TO_Y } from '../uncertain.js';
import type { AngleMode, BuiltinContext, BuiltinFn, BuiltinSpec } from './types.js';

function illegal(message: string): never {
  throw new BasicError(ErrorCode.ILLEGAL_FUNCTION_CALL, message);
}

function num(args: BasicValue[], index: number): number {
  return asNumeric(args[index]);
}

// ─────────────────────────────────────────────────────────────
// 角度モード変換
//
// DEG（既定）/ RAD / GRAD の3モードで三角関数・POL/REC の角度単位が変わる。
// docs/spec/basic_commands.yaml の ACS/ASN/ATN/SIN/COS/TAN/POL/REC の notes 参照。
// ─────────────────────────────────────────────────────────────

function toRadians(value: number, mode: AngleMode): number {
  switch (mode) {
    case 'DEG':
      return (value * Math.PI) / 180;
    case 'RAD':
      return value;
    case 'GRAD':
      return (value * Math.PI) / 200;
  }
}

function fromRadians(rad: number, mode: AngleMode): number {
  switch (mode) {
    case 'DEG':
      return (rad * 180) / Math.PI;
    case 'RAD':
      return rad;
    case 'GRAD':
      return (rad * 200) / Math.PI;
  }
}

// TAN の極（cos(θ)=0 付近）を検出するための閾値。実機の精度指標には効かない
// 工学的な安全策（無言で巨大な有限値を返さないための境界）。
const TAN_POLE_EPS = 1e-10;

// ─────────────────────────────────────────────────────────────
// 三角関数・逆三角関数
// ─────────────────────────────────────────────────────────────

const sin: BuiltinFn = (args, ctx) => numeric(Math.sin(toRadians(num(args, 0), ctx.angleMode)));
const cos: BuiltinFn = (args, ctx) => numeric(Math.cos(toRadians(num(args, 0), ctx.angleMode)));
const tan: BuiltinFn = (args, ctx) => {
  const rad = toRadians(num(args, 0), ctx.angleMode);
  if (Math.abs(Math.cos(rad)) < TAN_POLE_EPS) {
    illegal('TAN: 定義域外です（極）');
  }
  return numeric(Math.tan(rad));
};

const asn: BuiltinFn = (args, ctx) => {
  const x = num(args, 0);
  if (x < -1 || x > 1) illegal('ASN: 引数は -1〜1 の範囲で指定してください');
  return numeric(fromRadians(Math.asin(x), ctx.angleMode));
};

const acs: BuiltinFn = (args, ctx) => {
  const x = num(args, 0);
  if (x < -1 || x > 1) illegal('ACS: 引数は -1〜1 の範囲で指定してください');
  return numeric(fromRadians(Math.acos(x), ctx.angleMode));
};

const atn: BuiltinFn = (args, ctx) => numeric(fromRadians(Math.atan(num(args, 0)), ctx.angleMode));

// ─────────────────────────────────────────────────────────────
// 双曲線関数・逆双曲線関数
//
// HSN/HCS/HTN は全ての実数で数学的に定義される。docs/spec の range
// (-227.9559242〜230.2585092) は EXP と同じ演算可能範囲の記載であり、
// 範囲外は表示時（number.ts の roundToMantissa）のオーバーフロー処理に任せる
// （phase1_architecture.md「内部計算は表示のときだけ丸める」）。
// ─────────────────────────────────────────────────────────────

const hsn: BuiltinFn = (args) => numeric(Math.sinh(num(args, 0)));
const hcs: BuiltinFn = (args) => numeric(Math.cosh(num(args, 0)));
const htn: BuiltinFn = (args) => numeric(Math.tanh(num(args, 0)));

const ahc: BuiltinFn = (args) => {
  const x = num(args, 0);
  if (x < 1) illegal('AHC: 引数は 1 以上で指定してください');
  return numeric(Math.acosh(x));
};

const ahs: BuiltinFn = (args) => numeric(Math.asinh(num(args, 0)));

const aht: BuiltinFn = (args) => {
  const x = num(args, 0);
  if (x <= -1 || x >= 1) illegal('AHT: 引数は -1〜1 の範囲（両端を除く）で指定してください');
  return numeric(Math.atanh(x));
};

// ─────────────────────────────────────────────────────────────
// 指数・対数
// ─────────────────────────────────────────────────────────────

// EXP の演算可能範囲。docs/spec/basic_commands.yaml「範囲外は関数値0」明記。
const EXP_MIN = -227.9559242;
const EXP_MAX = 230.2585092;

const exp: BuiltinFn = (args) => {
  const x = num(args, 0);
  if (x < EXP_MIN || x > EXP_MAX) return numeric(0);
  return numeric(Math.exp(x));
};

// LN の下限。docs/spec の notes「引数が1E-99未満のときERROR」より。
// 該当エラー番号（39）は docs/spec/basic_errors.yaml に未収録のため、
// 同種の「定義域外の計算」を表す ILLEGAL_FUNCTION_CALL(22) を用いる。
const LN_MIN = 1e-99;

const ln: BuiltinFn = (args) => {
  const x = num(args, 0);
  if (x < LN_MIN) illegal('LN: 引数は 1E-99 以上で指定してください');
  return numeric(Math.log(x));
};

const log: BuiltinFn = (args) => {
  const x = num(args, 0);
  if (x <= 0) illegal('LOG: 引数は正の数で指定してください');
  return numeric(Math.log10(x));
};

const ten: BuiltinFn = (args) => numeric(10 ** num(args, 0));

// ─────────────────────────────────────────────────────────────
// べき乗・平方根・逆数
// ─────────────────────────────────────────────────────────────

const abs: BuiltinFn = (args) => numeric(Math.abs(num(args, 0)));
const squ: BuiltinFn = (args) => {
  const x = num(args, 0);
  return numeric(x * x);
};
const cub: BuiltinFn = (args) => {
  const x = num(args, 0);
  return numeric(x * x * x);
};
const cur: BuiltinFn = (args) => numeric(Math.cbrt(num(args, 0)));

const sqr: BuiltinFn = (args) => {
  const x = num(args, 0);
  if (x < 0) illegal('SQR: 引数は 0 以上で指定してください');
  return numeric(Math.sqrt(x));
};

const rcp: BuiltinFn = (args) => {
  const x = num(args, 0);
  if (x === 0) throw new BasicError(ErrorCode.DIVISION_BY_ZERO, 'RCP: 0 の逆数は計算できません');
  return numeric(1 / x);
};

// ─────────────────────────────────────────────────────────────
// 整数化・符号
// ─────────────────────────────────────────────────────────────

const int: BuiltinFn = (args) => numeric(Math.floor(num(args, 0)));
const fix: BuiltinFn = (args) => numeric(Math.trunc(num(args, 0)));
const sgn: BuiltinFn = (args) => {
  const x = num(args, 0);
  return numeric(x > 0 ? 1 : x < 0 ? -1 : 0);
};

// ─────────────────────────────────────────────────────────────
// 階乗・組み合わせ・順列
//
// 大きな n・r でも実行時間を有限に保つため、積の途中で演算可能範囲
// （number.ts の OVERFLOW_THRESHOLD=10^100 相当）を超えたら即座に打ち切って
// ERROR 20 にする（無限ループにも桁あふれの無言な垂れ流しにもしない）。
// ─────────────────────────────────────────────────────────────

const OVERFLOW_GUARD = 10 ** 100;
// ループを打ち切る保険の上限。100! 程度で OVERFLOW_GUARD を超えるので
// 実際にここへ到達するのは n や r が明らかに非現実的な値のときだけ。
const LOOP_GUARD = 100000;

function requireNonNegativeInteger(x: number, label: string): void {
  if (!Number.isFinite(x) || x < 0 || Math.round(x) !== x) {
    illegal(`${label}: 0以上の整数で指定してください`);
  }
}

const fact: BuiltinFn = (args) => {
  const n = num(args, 0);
  requireNonNegativeInteger(n, 'FACT');
  if (n > LOOP_GUARD) {
    throw new BasicError(ErrorCode.OVERFLOW, 'FACT: 演算可能範囲を超えます');
  }
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
    if (result >= OVERFLOW_GUARD) {
      throw new BasicError(ErrorCode.OVERFLOW, 'FACT: 演算可能範囲を超えます');
    }
  }
  return numeric(result);
};

function permutationProduct(n: number, r: number, label: string): number {
  requireNonNegativeInteger(n, label);
  requireNonNegativeInteger(r, label);
  if (r > n) illegal(`${label}: r は n 以下で指定してください`);
  if (r > LOOP_GUARD) {
    throw new BasicError(ErrorCode.OVERFLOW, `${label}: 演算可能範囲を超えます`);
  }
  let result = 1;
  for (let i = 0; i < r; i++) {
    result *= n - i;
    if (result >= OVERFLOW_GUARD) {
      throw new BasicError(ErrorCode.OVERFLOW, `${label}: 演算可能範囲を超えます`);
    }
  }
  return result;
}

const npr: BuiltinFn = (args) => {
  const n = num(args, 0);
  const r = num(args, 1);
  return numeric(permutationProduct(n, r, 'NPR'));
};

const ncr: BuiltinFn = (args) => {
  const n = num(args, 0);
  const r = num(args, 1);
  const nPr = permutationProduct(n, r, 'NCR');
  let rFact = 1;
  for (let i = 2; i <= r; i++) rFact *= i;
  return numeric(nPr / rFact);
};

// ─────────────────────────────────────────────────────────────
// 定数・乱数
// ─────────────────────────────────────────────────────────────

const pi: BuiltinFn = () => numeric(Math.PI);

// RND(<0) が「直前と同じ値を返す」ための状態。
// ctx.rnd() 自体の内部状態（PRNG）は呼び出し側が持つが、「直前に RND が
// 生成した値そのもの」はこの関数の責務なのでモジュール内に保持する。
let lastRndValue = 0;

const rnd: BuiltinFn = (args, ctx) => {
  const x = num(args, 0);
  if (x < 0) {
    return numeric(lastRndValue);
  }
  if (x > 1) {
    // 【推測で決めた点】 x が整数でない場合の上限は明記が無いため floor(x) を採用。
    // x===1 ちょうどの境界（0<x<1 でも x>1 でもない）は「x>1」側の延長として
    // 扱い、1〜1 の整数（＝常に1）を返すことにした。
    const upper = Math.floor(x);
    if (upper < 1) illegal('RND: 引数の扱いが不正です');
    const v = Math.floor(ctx.rnd() * upper) + 1;
    lastRndValue = v;
    return numeric(v);
  }
  // 0<=x<=1: 0以上1未満の小数乱数。docs/spec notes「最大10桁」に従い、
  // 生成した時点で有効数字10桁に切り詰める（表示時の丸めとは別に、
  // RND 自体の特性として明記されているため）。
  const v = Number(ctx.rnd().toPrecision(10));
  lastRndValue = v;
  return numeric(v);
};

// FRE: 空きメモリを返す。この実装（ブラウザ上の疑似機）にはメモリ管理の
// 実体が無いため、固定値のプレースホルダを返す。実際のメモリ量を計測する
// 仕組みができたら差し替える（不確定仕様の集約対象ではなく、単に未実装の
// サブシステムの穴なので uncertain.ts には入れていない）。
const FRE_PLACEHOLDER_BYTES = 26000;
const fre: BuiltinFn = () => numeric(FRE_PLACEHOLDER_BYTES);

// MDF: 電卓モードの「直前の計算結果」と「DIGIT 表示桁数」という、
// 現在の BuiltinContext には無い状態に依存する（docs/spec の notes 参照。
// マニュアル自体も BASIC プログラム中の挙動を明記できていない）。
// 無い状態を「もっともらしく」捏造するより、未対応と分かる形にする
// （phase1_architecture.md「未実装を無言にしない」）。
const mdf: BuiltinFn = () => {
  throw new UnsupportedError('MDF');
};

// ─────────────────────────────────────────────────────────────
// 度分秒変換
// ─────────────────────────────────────────────────────────────

/** hh.mmssrr（60進コード化された数値）→ 10進の度数。DEG 関数の実装。 */
const deg: BuiltinFn = (args) => {
  const x = num(args, 0);
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const hh = Math.floor(abs);
  // 小数部を6桁のパック表現 mmssrr として読む（四捨五入で浮動小数点誤差を吸収）。
  const packed = Math.round((abs - hh) * 1e6);
  const mm = Math.floor(packed / 10000);
  const ss = Math.floor((packed % 10000) / 100);
  const rr = packed % 100;
  const value = hh + mm / 60 + (ss + rr / 100) / 3600;
  return numeric(sign * value);
};

/** 10進の度数 → hh.mmssrr（60進コード化された数値）。DMS 関数の実装。 */
const dms: BuiltinFn = (args) => {
  const x = num(args, 0);
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const { hh, mm, ss, rr } = decomposeDegrees(abs);
  const packed = mm * 10000 + ss * 100 + rr;
  return numeric(sign * (hh + packed / 1e6));
};

/** 度数を hh/mm/ss/rr（rr は秒の小数第2位まで＝1/100秒）へ分解する共通処理。 */
function decomposeDegrees(absDegrees: number): {
  hh: number;
  mm: number;
  ss: number;
  rr: number;
} {
  let hh = Math.floor(absDegrees);
  const remM = (absDegrees - hh) * 60;
  let mm = Math.floor(remM);
  const remS = (remM - mm) * 60;
  let ss = Math.floor(remS);
  let rr = Math.round((remS - ss) * 100);
  if (rr >= 100) {
    rr -= 100;
    ss += 1;
  }
  if (ss >= 60) {
    ss -= 60;
    mm += 1;
  }
  if (mm >= 60) {
    mm -= 60;
    hh += 1;
  }
  return { hh, mm, ss, rr };
}

/** 10進の度数 → "hh°mm'ss.rr\"" 形式の文字列。DMS$ 関数の実装。 */
const dmsStr: BuiltinFn = (args) => {
  const x = num(args, 0);
  const sign = x < 0 ? '-' : '';
  const { hh, mm, ss, rr } = decomposeDegrees(Math.abs(x));
  const secStr = `${ss}.${String(rr).padStart(2, '0')}`;
  return str(`${sign}${hh}°${mm}'${secStr}"`);
};

/**
 * "dd度mm分ss.rr秒" 形式の文字列 → 10進の度数。VDEG 関数の実装。
 * 実行例（docs/spec）: "1度30分36秒" → 1.51 。
 *
 * 【推測で決めた点・理由】 度のみ／度分のみ（分・秒省略）の入力可否は
 * マニュアルに実行例が無い。VAL 系関数のような「不正なら0を返す」フォールバックは
 * このケースには適用されると明記されていないため、正規表現に一致しない入力は
 * 無言で0を返さず ILLEGAL_FUNCTION_CALL とする。分・秒はそれぞれ省略可能とした
 * （"1度" だけの入力など）。
 */
const VDEG_PATTERN = /^(-?\d+(?:\.\d+)?)度(?:(\d+(?:\.\d+)?)分)?(?:(\d+(?:\.\d+)?)秒)?$/;

const vdeg: BuiltinFn = (args) => {
  const s = asString(args[0]);
  const m = VDEG_PATTERN.exec(s.trim());
  if (!m) illegal('VDEG: 度分秒形式として解釈できません');
  const degPart = Number(m[1]);
  const min = m[2] !== undefined ? Number(m[2]) : 0;
  const sec = m[3] !== undefined ? Number(m[3]) : 0;
  const sign = degPart < 0 ? -1 : 1;
  const value = Math.abs(degPart) + min / 60 + sec / 3600;
  return numeric(sign * value);
};

// ─────────────────────────────────────────────────────────────
// 極座標 ⇔ 直交座標変換
//
// 予約変数 Y・Z（POL の r/θ、REC の x/y 成分の格納先）への代入は、
// このモジュール（関数の戻り値だけを扱う BuiltinFn の枠組み）の外側
// （インタプリタ側の変数環境）の責務。ここでは関数値のみを返す。
// ─────────────────────────────────────────────────────────────

/** 直交座標(x,y) → 極座標。関数値は距離 r。角度θは呼び出し側が別途 atan2 等で求める想定。 */
const pol: BuiltinFn = (args) => {
  const x = num(args, 0);
  const y = num(args, 1);
  return numeric(Math.hypot(x, y));
};

/**
 * 極座標(距離,角度) → 直交座標。関数値は x 成分（docs/spec 明記、不確定ではない）。
 * 予約変数 Y・Z への割り当て方針は `src/basic/uncertain.ts` の
 * `REC_ASSIGNS_X_TO_Y` に集約（未確定のため、踏んだことをここで記録する）。
 */
const rec: BuiltinFn = (args, ctx) => {
  const distance = num(args, 0);
  const angle = num(args, 1);
  const rad = toRadians(angle, ctx.angleMode);
  ctx.markUncertainUsed('REC_RESERVED_VAR_ASSIGNMENT');
  void REC_ASSIGNS_X_TO_Y; // 定数の存在を明示的に参照（未使用エラー回避＋トレーサビリティ）
  return numeric(distance * Math.cos(rad));
};

export const MATH_BUILTINS: Record<string, BuiltinSpec> = {
  ABS: { minArgs: 1, maxArgs: 1, fn: abs },
  ACS: { minArgs: 1, maxArgs: 1, fn: acs },
  AHC: { minArgs: 1, maxArgs: 1, fn: ahc },
  AHS: { minArgs: 1, maxArgs: 1, fn: ahs },
  AHT: { minArgs: 1, maxArgs: 1, fn: aht },
  ASN: { minArgs: 1, maxArgs: 1, fn: asn },
  ATN: { minArgs: 1, maxArgs: 1, fn: atn },
  COS: { minArgs: 1, maxArgs: 1, fn: cos },
  CUB: { minArgs: 1, maxArgs: 1, fn: cub },
  CUR: { minArgs: 1, maxArgs: 1, fn: cur },
  DEG: { minArgs: 1, maxArgs: 1, fn: deg },
  DMS: { minArgs: 1, maxArgs: 1, fn: dms },
  'DMS$': { minArgs: 1, maxArgs: 1, fn: dmsStr },
  EXP: { minArgs: 1, maxArgs: 1, fn: exp },
  FACT: { minArgs: 1, maxArgs: 1, fn: fact },
  FIX: { minArgs: 1, maxArgs: 1, fn: fix },
  FRE: { minArgs: 0, maxArgs: 0, fn: fre },
  HCS: { minArgs: 1, maxArgs: 1, fn: hcs },
  HSN: { minArgs: 1, maxArgs: 1, fn: hsn },
  HTN: { minArgs: 1, maxArgs: 1, fn: htn },
  INT: { minArgs: 1, maxArgs: 1, fn: int },
  LN: { minArgs: 1, maxArgs: 1, fn: ln },
  LOG: { minArgs: 1, maxArgs: 1, fn: log },
  MDF: { minArgs: 0, maxArgs: 0, fn: mdf },
  NCR: { minArgs: 2, maxArgs: 2, fn: ncr },
  NPR: { minArgs: 2, maxArgs: 2, fn: npr },
  PI: { minArgs: 0, maxArgs: 0, fn: pi },
  POL: { minArgs: 2, maxArgs: 2, fn: pol },
  RCP: { minArgs: 1, maxArgs: 1, fn: rcp },
  REC: { minArgs: 2, maxArgs: 2, fn: rec },
  RND: { minArgs: 1, maxArgs: 1, fn: rnd },
  SGN: { minArgs: 1, maxArgs: 1, fn: sgn },
  SIN: { minArgs: 1, maxArgs: 1, fn: sin },
  SQR: { minArgs: 1, maxArgs: 1, fn: sqr },
  SQU: { minArgs: 1, maxArgs: 1, fn: squ },
  TAN: { minArgs: 1, maxArgs: 1, fn: tan },
  TEN: { minArgs: 1, maxArgs: 1, fn: ten },
  VDEG: { minArgs: 1, maxArgs: 1, fn: vdeg },
};
