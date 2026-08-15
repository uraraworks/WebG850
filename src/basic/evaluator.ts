// 式評価と変数ストア。docs/design/phase1_runtime.md「変数」節、
// docs/design/phase1_grammar.md「式」節に対応する。
//
// 組込み関数（RND/SIN/…）の実装は別担当が src/basic/functions/ に作成中のため、
// ここでは import せず、実行時に外から注入されたテーブル（BuiltinTable）を
// 呼び出すだけにする（依頼の規約どおり）。

import type { ArrayRef, BinaryOp, BinaryOperator, Expr, FunctionCall, UnaryOp } from './ast.js';
import { BasicError, ErrorCode, UnsupportedError } from './errors.js';
import {
  IMPLICIT_ARRAY_SIZE,
  markUncertainUsed,
  type UncertainId,
} from './uncertain.js';
import {
  asNumeric,
  asString,
  type BasicValue,
  type BasicValueType,
  defaultValueForType,
  isNumeric,
  isString,
  isStringVariableName,
  numeric,
  str,
  typeMismatchError,
  variableValueType,
} from './value.js';

// ─────────────────────────────────────────────────────────────
// 組込み関数テーブル（注入される側の型定義。実装は別担当）
// ─────────────────────────────────────────────────────────────

export type AngleMode = 'DEG' | 'RAD' | 'GRAD';

export interface BuiltinContext {
  angleMode: AngleMode;
  rnd(): number;
  inkey(): string;
  markUncertainUsed(id: string): void;
}

export type BuiltinFn = (args: BasicValue[], ctx: BuiltinContext) => BasicValue;

export interface BuiltinSpec {
  minArgs: number;
  maxArgs: number;
  fn: BuiltinFn;
}

export type BuiltinTable = Record<string, BuiltinSpec>;

// ─────────────────────────────────────────────────────────────
// 変数ストア
// ─────────────────────────────────────────────────────────────
//
// docs/design/phase1_runtime.md「変数」節のとおり、数値変数／文字列変数／
// 数値配列／文字列配列を別々の名前空間として持つ（`A` と `A$` と `A(0)` は別物）。

interface ArrayEntry {
  elementType: BasicValueType;
  /** 各次元のサイズ（要素数。DIM A(10) なら 11）。 */
  dims: number[];
  /** 1次元にフラット化した要素列（row-major）。 */
  elements: BasicValue[];
  /** 文字列配列の1要素あたりの最大文字数（DIM A$(n)*m の m）。数値配列や無指定は null。 */
  maxStringLength: number | null;
}

export class VariableStore {
  private readonly numericScalars = new Map<string, number>();
  private readonly stringScalars = new Map<string, string>();
  private readonly arrays = new Map<string, ArrayEntry>();
  /** DIM で明示的に確保済みの配列名（DIM の重複検出用。暗黙生成された配列は含めない）。 */
  private readonly explicitlyDimmed = new Set<string>();

  // ── スカラー変数 ──────────────────────────────────────

  getScalar(name: string): BasicValue {
    if (isStringVariableName(name)) {
      return str(this.stringScalars.get(name) ?? '');
    }
    return numeric(this.numericScalars.get(name) ?? 0);
  }

  setScalar(name: string, value: BasicValue): void {
    if (isStringVariableName(name)) {
      this.stringScalars.set(name, asString(value));
    } else {
      this.numericScalars.set(name, asNumeric(value));
    }
  }

  eraseScalar(name: string): void {
    this.numericScalars.delete(name);
    this.stringScalars.delete(name);
  }

  // ── 配列変数 ──────────────────────────────────────────

  /**
   * `DIM A(10)` 相当。`dims` は各次元の要素数（添字の最大値+1）。
   * 既に DIM 済みの配列名を再度 DIM しようとした場合は ERROR 30。
   */
  dim(name: string, dims: readonly number[], maxStringLength: number | null): void {
    if (this.explicitlyDimmed.has(name)) {
      throw new BasicError(ErrorCode.DUPLICATE_DIM, `DIM: 配列 ${name} は既に確保されています`);
    }
    this.arrays.set(name, this.makeArrayEntry(name, dims, maxStringLength));
    this.explicitlyDimmed.add(name);
  }

  private makeArrayEntry(
    name: string,
    dims: readonly number[],
    maxStringLength: number | null,
  ): ArrayEntry {
    const elementType = variableValueType(name);
    const total = dims.reduce((a, b) => a * b, 1);
    const elements = Array.from({ length: total }, () => defaultValueForType(elementType));
    return { elementType, dims: [...dims], elements, maxStringLength };
  }

  /**
   * DIM していない配列への初回アクセス時に暗黙生成する。
   * サイズは `uncertain.ts` の `IMPLICIT_ARRAY_SIZE`（0〜10 の 11 要素）を
   * 参照インデックスの次元数ぶん繰り返す（多次元の暗黙サイズはマニュアルに
   * 記載が無いため、各次元とも同じ暗黙サイズを採用した。判断点）。
   */
  private ensureArray(name: string, dimCount: number): ArrayEntry {
    const existing = this.arrays.get(name);
    if (existing) return existing;
    markUncertainUsed('IMPLICIT_ARRAY_SIZE');
    const dims = Array.from({ length: dimCount }, () => IMPLICIT_ARRAY_SIZE);
    const entry = this.makeArrayEntry(name, dims, null);
    this.arrays.set(name, entry);
    return entry;
  }

  private offsetOf(entry: ArrayEntry, name: string, indices: readonly number[]): number {
    if (indices.length !== entry.dims.length) {
      throw new BasicError(
        ErrorCode.SYNTAX,
        `${name}: 添字の次元数が一致しません（宣言 ${entry.dims.length} 次元、指定 ${indices.length} 次元）`,
      );
    }
    let offset = 0;
    for (let i = 0; i < entry.dims.length; i++) {
      const idx = indices[i];
      if (!Number.isInteger(idx) || idx < 0 || idx >= entry.dims[i]) {
        throw new BasicError(
          ErrorCode.SUBSCRIPT_OUT_OF_RANGE,
          `${name}: 添字が範囲外です (${idx})`,
        );
      }
      offset = offset * entry.dims[i] + idx;
    }
    return offset;
  }

  getArrayElement(name: string, indices: readonly number[]): BasicValue {
    const entry = this.ensureArray(name, indices.length);
    return entry.elements[this.offsetOf(entry, name, indices)];
  }

  setArrayElement(name: string, indices: readonly number[], value: BasicValue): void {
    const entry = this.ensureArray(name, indices.length);
    const offset = this.offsetOf(entry, name, indices);
    if (entry.elementType === 'string') {
      let s = asString(value);
      // DIM A$(n)*m の *m（1要素あたりの最大文字数）を超過した分は切り捨てる
      // （docs/design/phase1_runtime.md「変数」節）。
      if (entry.maxStringLength !== null && s.length > entry.maxStringLength) {
        s = s.slice(0, entry.maxStringLength);
      }
      entry.elements[offset] = str(s);
    } else {
      entry.elements[offset] = numeric(asNumeric(value));
    }
  }

  eraseArray(name: string): void {
    this.arrays.delete(name);
    this.explicitlyDimmed.delete(name);
  }

  /** `CLEAR`：全変数（スカラー・配列とも）を破棄する。 */
  clear(): void {
    this.numericScalars.clear();
    this.stringScalars.clear();
    this.arrays.clear();
    this.explicitlyDimmed.clear();
  }
}

// ─────────────────────────────────────────────────────────────
// 16bit 2の補数（AND/OR/XOR/NOT 用）
// ─────────────────────────────────────────────────────────────
//
// docs/spec/basic_commands.yaml の AND/OR/XOR/NOT summary に明記されている
// とおり「-32768〜32767 の16bit2の補数表現に変換してビット演算」を行う。
// 範囲外の値をどう扱うかは記載が無いため、2進16bitへラップする
// （判断点。エラーにはしない）。

function toUint16(x: number): number {
  const t = Math.trunc(x);
  return ((t % 65536) + 65536) % 65536;
}

function uint16ToInt16(u: number): number {
  return u >= 32768 ? u - 65536 : u;
}

function bitwise16(op: 'AND' | 'OR' | 'XOR', a: number, b: number): number {
  const ua = toUint16(a);
  const ub = toUint16(b);
  let ur: number;
  if (op === 'AND') ur = ua & ub;
  else if (op === 'OR') ur = ua | ub;
  else ur = ua ^ ub;
  return uint16ToInt16(ur);
}

/** `NOT X = -(X+1)`（basic_commands.yaml NOT の summary の式そのまま）。 */
function bitwiseNot16(x: number): number {
  return uint16ToInt16(toUint16(-(Math.trunc(x) + 1)));
}

// ─────────────────────────────────────────────────────────────
// 式評価
// ─────────────────────────────────────────────────────────────

const COMPARISON_OPS = new Set<BinaryOperator>(['=', '<>', '<', '>', '<=', '>=']);

export class Evaluator {
  constructor(
    private readonly variables: VariableStore,
    private readonly builtins: BuiltinTable,
    private readonly context: BuiltinContext,
  ) {}

  evaluate(expr: Expr): BasicValue {
    switch (expr.kind) {
      case 'NumberLiteral':
        return numeric(expr.value);
      case 'StringLiteral':
        return str(expr.value);
      case 'VariableRef':
        return this.variables.getScalar(expr.name);
      case 'ArrayRef':
        return this.evalArrayRef(expr);
      case 'FunctionCall':
        return this.evalFunctionCall(expr);
      case 'UnaryOp':
        return this.evalUnary(expr);
      case 'BinaryOp':
        return this.evalBinary(expr);
      case 'UnsupportedExpr':
        // docs/design/phase1_architecture.md「未実装を無言にしない」。
        throw new UnsupportedError(expr.name);
    }
  }

  /** 配列添字（複数）をまとめて数値の配列へ評価する。DIM/READ/ERASE 等からも使う。 */
  evalIndices(indices: readonly Expr[]): number[] {
    return indices.map((e) => Math.trunc(asNumeric(this.evaluate(e))));
  }

  private evalArrayRef(expr: ArrayRef): BasicValue {
    const indices = this.evalIndices(expr.indices);
    return this.variables.getArrayElement(expr.name, indices);
  }

  private evalFunctionCall(expr: FunctionCall): BasicValue {
    const spec = this.builtins[expr.name];
    if (!spec) {
      // 別担当が実装中/未定義の関数名。無言で0やnullを返さずここで止める。
      throw new UnsupportedError(expr.name);
    }
    if (expr.args.length < spec.minArgs || expr.args.length > spec.maxArgs) {
      throw new BasicError(ErrorCode.SYNTAX, `${expr.name}: 引数の数が不正です`);
    }
    // 角度モード（context.angleMode）は interpreter.ts 側が DEGREE/RADIAN/GRAD 実行時に
    // 同じ context オブジェクトへ直接書き込むので、ここでは読むだけでよい。
    const args = expr.args.map((a) => this.evaluate(a));
    return spec.fn(args, this.context);
  }

  private evalUnary(expr: UnaryOp): BasicValue {
    if (expr.op === 'NOT') {
      const v = asNumeric(this.evaluate(expr.operand));
      return numeric(bitwiseNot16(v));
    }
    const v = asNumeric(this.evaluate(expr.operand));
    return numeric(expr.op === '-' ? -v : v);
  }

  private evalBinary(expr: BinaryOp): BasicValue {
    const op = expr.op;
    if (COMPARISON_OPS.has(op)) {
      return this.evalComparison(op, expr.left, expr.right);
    }
    if (op === 'AND' || op === 'OR' || op === 'XOR') {
      const a = asNumeric(this.evaluate(expr.left));
      const b = asNumeric(this.evaluate(expr.right));
      return numeric(bitwise16(op, a, b));
    }
    if (op === '+') {
      // 「+ は数値加算と文字列連結を兼ねる」（依頼指示）。
      const l = this.evaluate(expr.left);
      const r = this.evaluate(expr.right);
      if (isNumeric(l) && isNumeric(r)) return numeric(l.value + r.value);
      if (isString(l) && isString(r)) return str(l.value + r.value);
      throw typeMismatchError('+ 演算子: 数値と文字列を混在させることはできません');
    }
    const l = asNumeric(this.evaluate(expr.left));
    const r = asNumeric(this.evaluate(expr.right));
    switch (op) {
      case '-':
        return numeric(l - r);
      case '*':
        return numeric(l * r);
      case '/':
        if (r === 0) throw new BasicError(ErrorCode.DIVISION_BY_ZERO, 'ゼロ除算です');
        return numeric(l / r);
      case 'MOD':
        if (r === 0) throw new BasicError(ErrorCode.DIVISION_BY_ZERO, 'ゼロ除算です（MOD）');
        return numeric(l % r);
      case '^': {
        const result = l ** r;
        if (Number.isNaN(result)) {
          throw new BasicError(ErrorCode.ILLEGAL_FUNCTION_CALL, '定義域外の累乗です');
        }
        return numeric(result);
      }
      default:
        throw new BasicError(ErrorCode.SYNTAX, `未知の演算子です: ${String(op)}`);
    }
  }

  private evalComparison(op: BinaryOperator, leftExpr: Expr, rightExpr: Expr): BasicValue {
    const l = this.evaluate(leftExpr);
    const r = this.evaluate(rightExpr);
    let cmp: number;
    if (isNumeric(l) && isNumeric(r)) {
      cmp = l.value < r.value ? -1 : l.value > r.value ? 1 : 0;
    } else if (isString(l) && isString(r)) {
      cmp = l.value < r.value ? -1 : l.value > r.value ? 1 : 0;
    } else {
      throw typeMismatchError('比較演算子: 数値と文字列を混在させることはできません');
    }
    let result: boolean;
    switch (op) {
      case '=':
        result = cmp === 0;
        break;
      case '<>':
        result = cmp !== 0;
        break;
      case '<':
        result = cmp < 0;
        break;
      case '>':
        result = cmp > 0;
        break;
      case '<=':
        result = cmp <= 0;
        break;
      case '>=':
        result = cmp >= 0;
        break;
      default:
        throw new BasicError(ErrorCode.SYNTAX, `未知の比較演算子です: ${String(op)}`);
    }
    // 比較結果は 真=-1（全ビット1）／偽=0。
    // 根拠: docs/spec/basic_commands.yaml の AND の notes に「比較式(真=-1/偽=0)」と
    // 明記されている（5章冒頭 p.42 直前の表現規約）。また NOT の notes にある
    // NOT X = -(X+1) というビット単位全反転の定義とも、真が -1 のときだけ整合する
    // （真が 1 だと NOT 1 = -2 となり真のまま残ってしまう）。
    // 以前は「真1/偽0」としていたが誤りだったため訂正した（docs/design/phase1_grammar.md 参照）。
    return numeric(result ? -1 : 0);
  }
}

export type { UncertainId };
