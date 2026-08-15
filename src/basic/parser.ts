// トークン列 → AST。今回（式パーサ担当）は式（Expr）のみを実装する。
// 文（Stmt）パーサは次の担当が Cursor を再利用して足す想定
// （docs/design/phase1_grammar.md「式」節の優先順位表に対応）。

import type {
  ArrayRef,
  BinaryOp,
  BinaryOperator,
  Expr,
  FunctionCall,
  NumberLiteral,
  StringLiteral,
  UnaryOp,
  UnaryOperator,
  UnsupportedExpr,
  VariableRef,
} from './ast.js';
import { BasicError, ErrorCode } from './errors.js';
import type { Token, TokenType } from './token.js';

// ─────────────────────────────────────────────────────────────
// カーソル（次の担当が文パーサでもそのまま使う共通構造）
// ─────────────────────────────────────────────────────────────

/**
 * トークン列の読み取り位置を持つ共通カーソル。式パーサ・文パーサの両方が
 * これを介してトークンを読み進める。comment トークンは構文上意味を持たない
 * （行末までの残りを丸呑みしているだけ）ため、ここで除外しておく。
 */
export class Cursor {
  private readonly tokens: readonly Token[];
  private pos = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens.filter((t) => t.type !== 'comment');
  }

  /** `offset` 個先のトークンを覗く（消費しない）。範囲外は undefined。 */
  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  /** 現在のトークンを消費して返す。無ければ構文エラー（式の途中で行が終わった等）。 */
  next(): Token {
    const t = this.tokens[this.pos];
    if (t === undefined) {
      throw new BasicError(ErrorCode.SYNTAX, '式が終端しています（トークンが不足）');
    }
    this.pos++;
    return t;
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  /** 現在位置が指定した種別のトークンかどうか。 */
  checkType(type: TokenType): boolean {
    return this.peek()?.type === type;
  }

  /** 現在位置が指定したテキストの keyword トークンかどうか。 */
  checkKeyword(text: string): boolean {
    const t = this.peek();
    return t !== undefined && t.type === 'keyword' && t.text === text;
  }

  /** 現在位置が指定したテキストの operator トークンかどうか。 */
  checkOperator(text: string): boolean {
    const t = this.peek();
    return t !== undefined && t.type === 'operator' && t.text === text;
  }

  /** 現在位置が候補のいずれかのテキストを持つ operator トークンかどうか。一致したテキストを返す。 */
  matchOperator(...candidates: string[]): string | null {
    const t = this.peek();
    if (t !== undefined && t.type === 'operator' && candidates.includes(t.text)) {
      return t.text;
    }
    return null;
  }

  /** 現在位置が候補のいずれかのテキストを持つ keyword トークンかどうか。一致したテキストを返す。 */
  matchKeyword(...candidates: string[]): string | null {
    const t = this.peek();
    if (t !== undefined && t.type === 'keyword' && candidates.includes(t.text)) {
      return t.text;
    }
    return null;
  }

  /** 指定した種別のトークンを消費する。違えば構文エラー。 */
  expectType(type: TokenType, context: string): Token {
    const t = this.peek();
    if (t === undefined || t.type !== type) {
      throw new BasicError(
        ErrorCode.SYNTAX,
        `${context}: "${type}" を期待しましたが ${t ? `"${t.text}"` : '行末'} でした`,
      );
    }
    return this.next();
  }
}

// ─────────────────────────────────────────────────────────────
// 関数名の分類（docs/spec/basic_commands.yaml の kind: function を正典とする）
// ─────────────────────────────────────────────────────────────
//
// token.ts の KEYWORDS 表と同じ方針で、yaml の内容をここに手で写し取る
// （ビルドに yaml パーサを追加していないため）。差し替えるときは
// basic_commands.yaml 側の kind: function な行と突き合わせること。

type FunctionPhase = 1 | 2 | 3;

interface FunctionInfo {
  readonly phase: FunctionPhase;
  /** true なら括弧・引数を取らない（PI, FRE, MDF, INKEY$, PIOGET）。 */
  readonly noParen: boolean;
}

/** Phase 1: 引数も括弧も取らない4関数。 */
const PHASE1_NO_PAREN = ['PI', 'FRE', 'MDF', 'INKEY$'];

/** Phase 1: 括弧付き関数（45個 = 49 - 4）。 */
const PHASE1_WITH_PAREN = [
  'ABS', 'ACS', 'AHC', 'AHS', 'AHT', 'ASC', 'ASN', 'ATN', 'CHR$', 'COS',
  'CUB', 'CUR', 'DEG', 'DMS', 'DMS$', 'EXP', 'FACT', 'FIX', 'HCS', 'HEX$',
  'HSN', 'HTN', 'INT', 'LEFT$', 'LEN', 'LN', 'LOG', 'MID$', 'NCR', 'NPR',
  'POINT', 'POL', 'RCP', 'REC', 'RIGHT$', 'RND', 'SGN', 'SIN', 'SQR', 'SQU',
  'STR$', 'TAN', 'TEN', 'VAL', 'VDEG',
];

/** Phase 2 の関数。PIOGET のみ括弧なし。 */
const PHASE2_FUNCTIONS: ReadonlyArray<[string, boolean]> = [
  ['INP', false],
  ['PEEK', false],
  ['PIOGET', true],
];

/** Phase 3 の関数。 */
const PHASE3_FUNCTIONS: ReadonlyArray<[string, boolean]> = [
  ['EOF', false],
  ['LOF', false],
];

const FUNCTION_INFO: ReadonlyMap<string, FunctionInfo> = new Map<string, FunctionInfo>([
  ...PHASE1_NO_PAREN.map((name): [string, FunctionInfo] => [name, { phase: 1, noParen: true }]),
  ...PHASE1_WITH_PAREN.map((name): [string, FunctionInfo] => [name, { phase: 1, noParen: false }]),
  ...PHASE2_FUNCTIONS.map(([name, noParen]): [string, FunctionInfo] => [name, { phase: 2, noParen }]),
  ...PHASE3_FUNCTIONS.map(([name, noParen]): [string, FunctionInfo] => [name, { phase: 3, noParen }]),
]);

// ─────────────────────────────────────────────────────────────
// 式パーサ本体
// ─────────────────────────────────────────────────────────────
//
// docs/design/phase1_grammar.md「式」節の優先順位表（#1〜#9）にそのまま対応させる。
// 外側（弱く結合）から内側（強く結合）へ呼び出しが連なる、典型的な再帰下降。
//
//   parseExpression (=parseOr, #9 OR/XOR)
//     -> parseAnd (#8 AND)
//       -> parseNot (#7 単項 NOT)
//         -> parseComparison (#6 = <> < > <= >=)
//           -> parseAdditive (#5 + -)
//             -> parseMultiplicative (#4 * / MOD)
//               -> parseUnarySign (#3 単項 - +)
//                 -> parsePower (#2 ^)
//                   -> parsePrimary (#1 一次式)

/** 式を1つ読む。next の担当も含め、以後はこの関数からトークン列に乗る。 */
export function parseExpression(cursor: Cursor): Expr {
  return parseOr(cursor);
}

function parseOr(cursor: Cursor): Expr {
  let left = parseAnd(cursor);
  let op: string | null;
  while ((op = cursor.matchKeyword('OR', 'XOR')) !== null) {
    cursor.next();
    const right = parseAnd(cursor);
    left = makeBinary(op as BinaryOperator, left, right);
  }
  return left;
}

function parseAnd(cursor: Cursor): Expr {
  let left = parseNot(cursor);
  while (cursor.checkKeyword('AND')) {
    const opTok = cursor.next();
    const right = parseNot(cursor);
    left = makeBinary('AND', left, right, opTok.pos);
  }
  return left;
}

/** #7 単項 NOT（右結合＝多重 NOT を許すよう自分自身を再帰呼び出しする）。 */
function parseNot(cursor: Cursor): Expr {
  if (cursor.checkKeyword('NOT')) {
    const opTok = cursor.next();
    const operand = parseNot(cursor);
    return makeUnary('NOT', operand, opTok.pos);
  }
  return parseComparison(cursor);
}

const COMPARISON_OPERATORS = ['=', '<>', '<=', '>=', '<', '>'];

function parseComparison(cursor: Cursor): Expr {
  let left = parseAdditive(cursor);
  let op: string | null;
  while ((op = cursor.matchOperator(...COMPARISON_OPERATORS)) !== null) {
    const opTok = cursor.next();
    const right = parseAdditive(cursor);
    left = makeBinary(op as BinaryOperator, left, right, opTok.pos);
  }
  return left;
}

function parseAdditive(cursor: Cursor): Expr {
  let left = parseMultiplicative(cursor);
  let op: string | null;
  while ((op = cursor.matchOperator('+', '-')) !== null) {
    const opTok = cursor.next();
    const right = parseMultiplicative(cursor);
    left = makeBinary(op as BinaryOperator, left, right, opTok.pos);
  }
  return left;
}

function parseMultiplicative(cursor: Cursor): Expr {
  let left = parseUnarySign(cursor);
  for (;;) {
    const opText = cursor.matchOperator('*', '/') ?? cursor.matchKeyword('MOD');
    if (opText === null) break;
    const opTok = cursor.next();
    const right = parseUnarySign(cursor);
    left = makeBinary(opText as BinaryOperator, left, right, opTok.pos);
  }
  return left;
}

/** #3 単項 `-` `+`（右結合）。`-2^2` が `-(2^2)` になるよう parsePower を内側に置く。 */
function parseUnarySign(cursor: Cursor): Expr {
  const op = cursor.matchOperator('-', '+');
  if (op !== null) {
    const opTok = cursor.next();
    const operand = parseUnarySign(cursor);
    return makeUnary(op as UnaryOperator, operand, opTok.pos);
  }
  return parsePower(cursor);
}

/** #2 `^`（右結合）。指数側は単項符号を許すため parseUnarySign を再帰させる（`2^-1` 等）。 */
function parsePower(cursor: Cursor): Expr {
  const base = parsePrimary(cursor);
  if (cursor.checkOperator('^')) {
    const opTok = cursor.next();
    const exponent = parseUnarySign(cursor);
    return makeBinary('^', base, exponent, opTok.pos);
  }
  return base;
}

function makeBinary(op: BinaryOperator, left: Expr, right: Expr, pos?: number): BinaryOp {
  return { kind: 'BinaryOp', op, left, right, pos: pos ?? left.pos };
}

function makeUnary(op: UnaryOperator, operand: Expr, pos: number): UnaryOp {
  return { kind: 'UnaryOp', op, operand, pos };
}

// ─────────────────────────────────────────────────────────────
// #1 一次式
// ─────────────────────────────────────────────────────────────

function parsePrimary(cursor: Cursor): Expr {
  const tok = cursor.peek();
  if (tok === undefined) {
    throw new BasicError(ErrorCode.SYNTAX, '式を期待しましたが行末でした');
  }

  if (tok.type === 'lparen') {
    cursor.next();
    const inner = parseExpression(cursor);
    cursor.expectType('rparen', '括弧付き式');
    return inner;
  }

  if (tok.type === 'number') {
    cursor.next();
    const node: NumberLiteral = {
      kind: 'NumberLiteral',
      value: tok.numberValue ?? Number(tok.text),
      raw: tok.text,
      pos: tok.pos,
    };
    return node;
  }

  if (tok.type === 'string') {
    cursor.next();
    const node: StringLiteral = {
      kind: 'StringLiteral',
      value: tok.stringValue ?? '',
      pos: tok.pos,
    };
    return node;
  }

  if (tok.type === 'identifier') {
    cursor.next();
    if (cursor.checkType('lparen')) {
      const indices = parseArgumentList(cursor);
      const node: ArrayRef = { kind: 'ArrayRef', name: tok.text, indices, pos: tok.pos };
      return node;
    }
    const node: VariableRef = { kind: 'VariableRef', name: tok.text, pos: tok.pos };
    return node;
  }

  if (tok.type === 'keyword') {
    return parseFunctionOrUnsupported(cursor, tok);
  }

  throw new BasicError(ErrorCode.SYNTAX, `式として使えないトークンです: "${tok.text}"`);
}

/** `(` から対応する `)` までのカンマ区切り引数リストを読む。括弧が無ければ構文エラー。 */
function parseArgumentList(cursor: Cursor): Expr[] {
  cursor.expectType('lparen', '関数呼び出し・配列参照の引数');
  const args: Expr[] = [];
  if (!cursor.checkType('rparen')) {
    args.push(parseExpression(cursor));
    while (cursor.checkType('comma')) {
      cursor.next();
      args.push(parseExpression(cursor));
    }
  }
  cursor.expectType('rparen', '関数呼び出し・配列参照の引数');
  return args;
}

/**
 * keyword トークンを一次式として解釈する。関数として登録されている名前なら
 * FunctionCall（phase 1）または UnsupportedExpr（phase 2/3）を作る。
 * 関数として登録されていない keyword（PRINT や IF 等の文キーワード）が
 * 式の一次式位置に出てくるのは構文エラーとして扱う。
 */
function parseFunctionOrUnsupported(cursor: Cursor, tok: Token): Expr {
  const info = FUNCTION_INFO.get(tok.text);
  if (info === undefined) {
    // 【判断】 basic_tokens.yaml のキーワード表は kind: function な名前を
    // 網羅しているため、この分岐へは実質到達しない（関数名は全て FUNCTION_INFO に
    // 載っている）。将来 yaml 側が更新されてもここが黙って壊れないよう、
    // 「関数として使えないキーワード」は構文エラーとして明示的に落とす。
    throw new BasicError(
      ErrorCode.SYNTAX,
      `"${tok.text}" は関数として使えません（式の一次式ではありません）`,
    );
  }

  cursor.next(); // 関数名キーワードを消費

  const hasParen = cursor.checkType('lparen');
  const args = info.noParen
    ? // 引数なし関数。括弧が来ても付けない書き方が正式のはずだが、万一 "()" と
      // 書かれても壊れないよう空引数の括弧だけは許容しておく。
      hasParen
      ? parseArgumentList(cursor)
      : []
    : parseArgumentList(cursor);

  if (info.phase !== 1) {
    const node: UnsupportedExpr = {
      kind: 'UnsupportedExpr',
      name: tok.text,
      reason: info.phase === 2 ? 'phase2' : 'phase3',
      pos: tok.pos,
    };
    return node;
  }

  const node: FunctionCall = { kind: 'FunctionCall', name: tok.text, args, pos: tok.pos };
  return node;
}

/** トークン配列から式パーサへ渡す Cursor を作る補助関数（テスト・呼び出し側の便宜）。 */
export function cursorFromTokens(tokens: readonly Token[]): Cursor {
  return new Cursor(tokens);
}
