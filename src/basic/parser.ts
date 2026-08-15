// トークン列 → AST。今回（式パーサ担当）は式（Expr）のみを実装する。
// 文（Stmt）パーサは次の担当が Cursor を再利用して足す想定
// （docs/design/phase1_grammar.md「式」節の優先順位表に対応）。

import type {
  ArrayRef,
  AssignTarget,
  BinaryOp,
  BinaryOperator,
  CaseStmt,
  ClearStmt,
  DataStmt,
  DataValue,
  DefaultStmt,
  DimSpec,
  DimStmt,
  ElseStmt,
  EndIfStmt,
  EndStmt,
  EndSwitchStmt,
  EraseStmt,
  Expr,
  ForStmt,
  FunctionCall,
  GosubStmt,
  GotoStmt,
  IfClause,
  IfLineStmt,
  IfStmt,
  InputItem,
  InputStmt,
  JumpTarget,
  LabelStmt,
  LetAssignment,
  LetStmt,
  NextStmt,
  NumberLiteral,
  OnGosubStmt,
  OnGotoStmt,
  PrintItem,
  PrintSegment,
  PrintStmt,
  ProgramLine,
  ReadStmt,
  RemStmt,
  RepeatStmt,
  RestoreStmt,
  ReturnStmt,
  StopStmt,
  Stmt,
  StringLiteral,
  SwitchStmt,
  UnaryOp,
  UnaryOperator,
  UnsupportedExpr,
  UnsupportedStmt,
  UntilStmt,
  VariableRef,
  WendStmt,
  WhileStmt,
} from './ast.js';
import { BasicError, ErrorCode } from './errors.js';
import { tokenizeProgram } from './tokenizer.js';
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

/**
 * `(` から対応する `)` までのカンマ区切り引数リストを読む。括弧が無ければ構文エラー。
 * 文パーサ側（配列参照・DIM 以外の各種変数リスト）からも再利用する。
 */
export function parseArgumentList(cursor: Cursor): Expr[] {
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

// ─────────────────────────────────────────────────────────────
// 文パーサ本体（docs/design/phase1_grammar.md「文」節に対応）
// ─────────────────────────────────────────────────────────────
//
// ブロック構造（FOR/NEXT, WHILE/WEND, REPEAT/UNTIL, IF/ELSE/ENDIF,
// SWITCH/CASE/DEFAULT/ENDSWITCH）は AST に畳まない。それぞれ独立した文
// ノードとして返すだけで、対応関係の解決は実行時の担当（申し送り参照）。

/** 統計・図形系／ダイレクトコマンド系のうち phase 2/3 と判明しているキーワード。
 * 今回のスコープ外の phase 1 キーワード（CLS 等）はここに含めず 'unknown' に落ちる
 * （ast.ts の UnsupportedStmt コメント参照）。
 */
const STATEMENT_PHASE: ReadonlyMap<string, 2 | 3> = new Map<string, 2 | 3>([
  ['CALL', 2],
  ['OUT', 2],
  ['POKE', 2],
  ['PIOSET', 2],
  // yaml 正典名は PIOPUT だが token.ts 側は basic_tokens.yaml の表記
  // どおり POIPUT を採用している（既知の食い違い、token.ts コメント参照）。
  ['POIPUT', 2],
  ['MON', 2],
  ['CLOSE', 3],
  ['CLOAD', 3],
  ['CSAVE', 3],
  ['SAVE', 3],
  ['LOAD', 3],
  ['FILES', 3],
  ['LFILES', 3],
  ['KILL', 3],
  ['HDCOPY', 3],
  ['OPEN', 3],
  ['SPOUT', 3],
  ['SPINP', 3],
  ['LLIST', 3],
  ['LPRINT', 3],
]);

/** 変数参照または配列参照を読む（LET/INPUT/READ/ERASE などの代入・対象リストで共用）。 */
function parseAssignTarget(cursor: Cursor): AssignTarget {
  const tok = cursor.expectType('identifier', '変数');
  if (cursor.checkType('lparen')) {
    const indices = parseArgumentList(cursor);
    const node: ArrayRef = { kind: 'ArrayRef', name: tok.text, indices, pos: tok.pos };
    return node;
  }
  const node: VariableRef = { kind: 'VariableRef', name: tok.text, pos: tok.pos };
  return node;
}

/**
 * 飛び先の共通パーサ。`<行番号>` / `"<ラベル>"` / `*ラベル` の3形態。
 * GOTO/GOSUB/RESTORE/ON..GOTO/ON..GOSUB/IF(1行形式) で共用する。
 */
function parseTarget(cursor: Cursor): JumpTarget {
  const tok = cursor.peek();
  if (tok === undefined) {
    throw new BasicError(ErrorCode.SYNTAX, '飛び先（行番号またはラベル）を期待しましたが行末でした');
  }
  if (tok.type === 'number') {
    cursor.next();
    const node: JumpTarget = {
      kind: 'LineNumberTarget',
      value: tok.numberValue ?? Number(tok.text),
      pos: tok.pos,
    };
    return node;
  }
  if (tok.type === 'string') {
    cursor.next();
    const node: JumpTarget = { kind: 'LabelTarget', name: tok.stringValue ?? '', pos: tok.pos };
    return node;
  }
  if (tok.type === 'operator' && tok.text === '*') {
    cursor.next();
    const nameTok = cursor.expectType('identifier', '*ラベル');
    const node: JumpTarget = { kind: 'LabelTarget', name: nameTok.text, pos: tok.pos };
    return node;
  }
  throw new BasicError(
    ErrorCode.SYNTAX,
    `飛び先（行番号 / "ラベル" / *ラベル）を期待しましたが "${tok.text}" でした`,
  );
}

/** `*ラベル` 単独の文。 */
function parseLabelStmt(cursor: Cursor): LabelStmt {
  const starTok = cursor.next(); // '*'
  const nameTok = cursor.expectType('identifier', 'ラベル名');
  return { kind: 'LabelStmt', name: nameTok.text, pos: starTok.pos };
}

/** `[LET] <変数>=<式>[,<変数>=<式>……]`（LET 省略形の暗黙代入も同じ関数で扱う）。 */
function parseLetStmt(cursor: Cursor): LetStmt {
  const startTok = cursor.peek();
  if (startTok === undefined) {
    throw new BasicError(ErrorCode.SYNTAX, '代入文を期待しましたが行末でした');
  }
  if (cursor.checkKeyword('LET')) {
    cursor.next();
  }
  const assignments: LetAssignment[] = [parseOneAssignment(cursor)];
  while (cursor.checkType('comma')) {
    cursor.next();
    assignments.push(parseOneAssignment(cursor));
  }
  return { kind: 'LetStmt', assignments, pos: startTok.pos };
}

function parseOneAssignment(cursor: Cursor): LetAssignment {
  const target = parseAssignTarget(cursor);
  if (!cursor.checkOperator('=')) {
    const t = cursor.peek();
    throw new BasicError(
      ErrorCode.SYNTAX,
      `代入文: "=" を期待しましたが ${t ? `"${t.text}"` : '行末'} でした`,
    );
  }
  cursor.next();
  const value = parseExpression(cursor);
  return { target, value };
}

/** `PRINT` 1項目（`USING "<format>"` または式）。 */
function parsePrintItem(cursor: Cursor): PrintItem {
  if (cursor.checkKeyword('USING')) {
    const tok = cursor.next();
    const format = parseExpression(cursor);
    return { kind: 'PrintUsing', format, pos: tok.pos };
  }
  return parseExpression(cursor);
}

/** `PRINT [USING "<format>"] [<項> {(','|';') <項>}] [';']`。 */
function parsePrintStmt(cursor: Cursor): PrintStmt {
  const startTok = cursor.next(); // PRINT
  if (cursor.atEnd() || cursor.checkType('colon')) {
    return { kind: 'PrintStmt', items: [], trailingSep: null, pos: startTok.pos };
  }
  // 項目が1つも無いまま ';' だけが置かれる形（改行だけ抑制する書き方）。
  if (cursor.checkType('semicolon')) {
    const semiTok = cursor.next();
    if (cursor.atEnd() || cursor.checkType('colon')) {
      return { kind: 'PrintStmt', items: [], trailingSep: ';', pos: startTok.pos };
    }
    // ';' の直後に項目が続く珍しい書き方。先頭区切りとしては記録せず素直に読み進める。
    void semiTok;
  }

  const items: PrintSegment[] = [];
  let pendingSep: ',' | ';' | null = null;
  let trailingSep: ',' | ';' | null = null;
  for (;;) {
    const value = parsePrintItem(cursor);
    items.push({ sep: pendingSep, value });
    pendingSep = null;
    trailingSep = null;
    if (cursor.checkType('comma')) {
      cursor.next();
      pendingSep = ',';
      trailingSep = ',';
    } else if (cursor.checkType('semicolon')) {
      cursor.next();
      pendingSep = ';';
      trailingSep = ';';
    } else {
      break;
    }
    if (cursor.atEnd() || cursor.checkType('colon')) {
      break;
    }
  }
  return { kind: 'PrintStmt', items, trailingSep, pos: startTok.pos };
}

/**
 * `INPUT`。メッセージ（文字列リテラル）と変数が交互に並ぶ形を許す
 * （docs/design/phase1_grammar.md 「PRINT」節の隣、INPUT の3形式に対応）。
 */
function parseInputStmt(cursor: Cursor): InputStmt {
  const startTok = cursor.next(); // INPUT
  const items: InputItem[] = [];
  for (;;) {
    if (cursor.checkType('string')) {
      const tok = cursor.next();
      const message: Expr = { kind: 'StringLiteral', value: tok.stringValue ?? '', pos: tok.pos };
      let quiet = false;
      if (cursor.checkType('semicolon')) {
        cursor.next();
        quiet = true;
      } else if (cursor.checkType('comma')) {
        cursor.next();
        quiet = false;
      }
      items.push({ kind: 'InputPrompt', message, quiet, pos: tok.pos });
      continue;
    }
    items.push(parseAssignTarget(cursor));
    if (cursor.checkType('comma')) {
      cursor.next();
      continue;
    }
    break;
  }
  return { kind: 'InputStmt', items, pos: startTok.pos };
}

/**
 * `IF` の THEN/ELSE 節1つ分：`<行番号>` / `*ラベル` / `<文>`。
 * 【判断】 ELSE 節に `<文>` を許すかは資料間で食い違う
 * （yaml の format は `<行番号>|*ラベル` のみ、phase1_grammar.md 本文は
 * `<行番号>|*ラベル|<文>` と明記）。今回は依頼の最重要資料である
 * phase1_grammar.md を優先し、ELSE 節でも文を許容する（THEN 節と同じ
 * parseIfClause を共用）。
 */
function parseIfClause(cursor: Cursor): IfClause {
  const tok = cursor.peek();
  if (tok !== undefined && tok.type === 'number') {
    return parseTarget(cursor);
  }
  if (tok !== undefined && tok.type === 'operator' && tok.text === '*') {
    return parseTarget(cursor);
  }
  return parseStatement(cursor);
}

/**
 * `IF <条件> THEN …`。THEN 直後にトークンがあれば1行形式、無ければ
 * ブロック形式のヘッダとして扱う（判定基準は docs/design/phase1_grammar.md
 * 「IF は2形態ある」節）。
 */
function parseIfStmt(cursor: Cursor): IfLineStmt | IfStmt {
  const startTok = cursor.next(); // IF
  const condition = parseExpression(cursor);
  if (!cursor.checkKeyword('THEN')) {
    const t = cursor.peek();
    throw new BasicError(
      ErrorCode.SYNTAX,
      `IF: "THEN" を期待しましたが ${t ? `"${t.text}"` : '行末'} でした`,
    );
  }
  cursor.next(); // THEN
  const afterThen = cursor.peek();
  if (afterThen === undefined) {
    return { kind: 'IfStmt', condition, pos: startTok.pos };
  }
  const thenClause = parseIfClause(cursor);
  let elseClause: IfClause | null = null;
  if (cursor.checkKeyword('ELSE')) {
    cursor.next();
    elseClause = parseIfClause(cursor);
  }
  return { kind: 'IfLineStmt', condition, thenClause, elseClause, pos: startTok.pos };
}

/** `FOR <変数>=<式> TO <式> [STEP <式>]`（ヘッダのみ）。 */
function parseForStmt(cursor: Cursor): ForStmt {
  const startTok = cursor.next(); // FOR
  const varTok = cursor.expectType('identifier', 'FOR のループ変数');
  const variable: VariableRef = { kind: 'VariableRef', name: varTok.text, pos: varTok.pos };
  if (!cursor.checkOperator('=')) {
    throw new BasicError(ErrorCode.SYNTAX, 'FOR: "=" がありません');
  }
  cursor.next();
  const from = parseExpression(cursor);
  if (!cursor.checkKeyword('TO')) {
    throw new BasicError(ErrorCode.SYNTAX, 'FOR: "TO" がありません');
  }
  cursor.next();
  const to = parseExpression(cursor);
  let step: Expr | null = null;
  if (cursor.checkKeyword('STEP')) {
    cursor.next();
    step = parseExpression(cursor);
  }
  return { kind: 'ForStmt', variable, from, to, step, pos: startTok.pos };
}

/** `NEXT [<変数>]`。 */
function parseNextStmt(cursor: Cursor): NextStmt {
  const startTok = cursor.next(); // NEXT
  let variable: VariableRef | null = null;
  if (cursor.checkType('identifier')) {
    const tok = cursor.next();
    variable = { kind: 'VariableRef', name: tok.text, pos: tok.pos };
  }
  return { kind: 'NextStmt', variable, pos: startTok.pos };
}

/** `DATA` 1項目。式パーサへは渡さず、次の `,`/`:`/行末までの生テキストとして読む。 */
function parseDataValue(cursor: Cursor): DataValue {
  const first = cursor.peek();
  if (first === undefined) {
    throw new BasicError(ErrorCode.SYNTAX, 'DATA: 値がありません');
  }
  if (first.type === 'string') {
    cursor.next();
    return { text: first.stringValue ?? '', quoted: true, pos: first.pos };
  }
  const startPos = first.pos;
  let text = '';
  while (!cursor.atEnd() && !cursor.checkType('comma') && !cursor.checkType('colon')) {
    text += cursor.next().text;
  }
  return { text, quoted: false, pos: startPos };
}

/**
 * `DATA <値のリスト>`。
 * 【判断】 トークナイザは DATA 専用のモードを持たない（依頼で tokenizer.ts に
 * 手を入れないため）。このため各項目はトークン列を連結した生テキストになり、
 * トークン間の空白（"DATA A B" のような区切り無しの複数語）は失われる。
 * 数値・識別子・引用符付き文字列の各1項目は正しく再現できるが、
 * 空白区切りの生テキストは不完全であることを申し送る。
 */
function parseDataStmt(cursor: Cursor): DataStmt {
  const startTok = cursor.next(); // DATA
  const values: DataValue[] = [];
  if (cursor.atEnd() || cursor.checkType('colon')) {
    return { kind: 'DataStmt', values, pos: startTok.pos };
  }
  for (;;) {
    values.push(parseDataValue(cursor));
    if (cursor.checkType('comma')) {
      cursor.next();
      continue;
    }
    break;
  }
  return { kind: 'DataStmt', values, pos: startTok.pos };
}

/** `READ <変数>[,<変数>……]`。 */
function parseReadStmt(cursor: Cursor): ReadStmt {
  const startTok = cursor.next(); // READ
  const targets: AssignTarget[] = [parseAssignTarget(cursor)];
  while (cursor.checkType('comma')) {
    cursor.next();
    targets.push(parseAssignTarget(cursor));
  }
  return { kind: 'ReadStmt', targets, pos: startTok.pos };
}

/** `RESTORE [<行番号>|"<ラベル>"|*ラベル]`。 */
function parseRestoreStmt(cursor: Cursor): RestoreStmt {
  const startTok = cursor.next(); // RESTORE
  let target: JumpTarget | null = null;
  if (!cursor.atEnd() && !cursor.checkType('colon')) {
    target = parseTarget(cursor);
  }
  return { kind: 'RestoreStmt', target, pos: startTok.pos };
}

/** `DIM` の1変数分：`<変数>[$](<index1>[,<index2>])[*<文字列長>]`。 */
function parseDimSpec(cursor: Cursor): DimSpec {
  const nameTok = cursor.expectType('identifier', 'DIM の変数名');
  cursor.expectType('lparen', 'DIM の添字');
  const dims: Expr[] = [parseExpression(cursor)];
  if (cursor.checkType('comma')) {
    cursor.next();
    dims.push(parseExpression(cursor));
  }
  cursor.expectType('rparen', 'DIM の添字');
  let stringLength: Expr | null = null;
  if (cursor.checkOperator('*')) {
    cursor.next();
    stringLength = parseExpression(cursor);
  }
  return { name: nameTok.text, dims, stringLength };
}

/** `DIM <変数>[$](<index1>[,<index2>])[*<文字列長>][,……]`。 */
function parseDimStmt(cursor: Cursor): DimStmt {
  const startTok = cursor.next(); // DIM
  const specs: DimSpec[] = [parseDimSpec(cursor)];
  while (cursor.checkType('comma')) {
    cursor.next();
    specs.push(parseDimSpec(cursor));
  }
  return { kind: 'DimStmt', specs, pos: startTok.pos };
}

/** `ERASE <変数>|<配列>[,…]`。配列全体消去は空括弧 `A()` で表す（indices が空配列）。 */
function parseEraseStmt(cursor: Cursor): EraseStmt {
  const startTok = cursor.next(); // ERASE
  const targets: AssignTarget[] = [parseAssignTarget(cursor)];
  while (cursor.checkType('comma')) {
    cursor.next();
    targets.push(parseAssignTarget(cursor));
  }
  return { kind: 'EraseStmt', targets, pos: startTok.pos };
}

/** `ON <式> GOTO|GOSUB <飛び先>[,<飛び先>……]`。 */
function parseOnStmt(cursor: Cursor): OnGotoStmt | OnGosubStmt {
  const startTok = cursor.next(); // ON
  const selector = parseExpression(cursor);
  let isGosub: boolean;
  if (cursor.checkKeyword('GOSUB')) {
    cursor.next();
    isGosub = true;
  } else if (cursor.checkKeyword('GOTO')) {
    cursor.next();
    isGosub = false;
  } else {
    const t = cursor.peek();
    throw new BasicError(
      ErrorCode.SYNTAX,
      `ON: "GOTO" または "GOSUB" を期待しましたが ${t ? `"${t.text}"` : '行末'} でした`,
    );
  }
  const targets: JumpTarget[] = [parseTarget(cursor)];
  while (cursor.checkType('comma')) {
    cursor.next();
    targets.push(parseTarget(cursor));
  }
  return isGosub
    ? { kind: 'OnGosubStmt', selector, targets, pos: startTok.pos }
    : { kind: 'OnGotoStmt', selector, targets, pos: startTok.pos };
}

/** 未対応の文。残りのトークンは行末（または次の `:`）まで読み飛ばす。 */
function parseUnsupportedKeywordStmt(cursor: Cursor): UnsupportedStmt {
  const tok = cursor.next();
  while (!cursor.atEnd() && !cursor.checkType('colon')) {
    cursor.next();
  }
  const phase = STATEMENT_PHASE.get(tok.text);
  const reason = phase === undefined ? 'unknown' : phase === 2 ? 'phase2' : 'phase3';
  return { kind: 'UnsupportedStmt', name: tok.text, reason, pos: tok.pos };
}

/** 文を1つ読む。行の構造（複文の区切り `:`）は parseStatementList が扱う。 */
export function parseStatement(cursor: Cursor): Stmt {
  const tok = cursor.peek();
  if (tok === undefined) {
    throw new BasicError(ErrorCode.SYNTAX, '文を期待しましたが行末でした');
  }

  if (tok.type === 'operator' && tok.text === '*') {
    return parseLabelStmt(cursor);
  }

  if (tok.type === 'identifier') {
    return parseLetStmt(cursor);
  }

  if (tok.type === 'keyword') {
    switch (tok.text) {
      case 'LET':
        return parseLetStmt(cursor);
      case 'PRINT':
        return parsePrintStmt(cursor);
      case 'INPUT':
        return parseInputStmt(cursor);
      case 'IF':
        return parseIfStmt(cursor);
      case 'FOR':
        return parseForStmt(cursor);
      case 'NEXT':
        return parseNextStmt(cursor);
      case 'WHILE': {
        const t = cursor.next();
        const condition = parseExpression(cursor);
        const node: WhileStmt = { kind: 'WhileStmt', condition, pos: t.pos };
        return node;
      }
      case 'WEND': {
        const t = cursor.next();
        const node: WendStmt = { kind: 'WendStmt', pos: t.pos };
        return node;
      }
      case 'REPEAT': {
        const t = cursor.next();
        const node: RepeatStmt = { kind: 'RepeatStmt', pos: t.pos };
        return node;
      }
      case 'UNTIL': {
        const t = cursor.next();
        const condition = parseExpression(cursor);
        const node: UntilStmt = { kind: 'UntilStmt', condition, pos: t.pos };
        return node;
      }
      case 'ELSE': {
        const t = cursor.next();
        const node: ElseStmt = { kind: 'ElseStmt', pos: t.pos };
        return node;
      }
      case 'ENDIF': {
        const t = cursor.next();
        const node: EndIfStmt = { kind: 'EndIfStmt', pos: t.pos };
        return node;
      }
      case 'SWITCH': {
        const t = cursor.next();
        const expr = parseExpression(cursor);
        const node: SwitchStmt = { kind: 'SwitchStmt', expr, pos: t.pos };
        return node;
      }
      case 'CASE': {
        const t = cursor.next();
        const values: Expr[] = [parseExpression(cursor)];
        while (cursor.checkType('comma')) {
          cursor.next();
          values.push(parseExpression(cursor));
        }
        const node: CaseStmt = { kind: 'CaseStmt', values, pos: t.pos };
        return node;
      }
      case 'DEFAULT': {
        const t = cursor.next();
        const node: DefaultStmt = { kind: 'DefaultStmt', pos: t.pos };
        return node;
      }
      case 'ENDSWITCH': {
        const t = cursor.next();
        const node: EndSwitchStmt = { kind: 'EndSwitchStmt', pos: t.pos };
        return node;
      }
      case 'GOTO': {
        const t = cursor.next();
        const target = parseTarget(cursor);
        const node: GotoStmt = { kind: 'GotoStmt', target, pos: t.pos };
        return node;
      }
      case 'GOSUB': {
        const t = cursor.next();
        const target = parseTarget(cursor);
        const node: GosubStmt = { kind: 'GosubStmt', target, pos: t.pos };
        return node;
      }
      case 'RETURN': {
        const t = cursor.next();
        const node: ReturnStmt = { kind: 'ReturnStmt', pos: t.pos };
        return node;
      }
      case 'ON':
        return parseOnStmt(cursor);
      case 'END': {
        const t = cursor.next();
        const node: EndStmt = { kind: 'EndStmt', pos: t.pos };
        return node;
      }
      case 'STOP': {
        const t = cursor.next();
        const node: StopStmt = { kind: 'StopStmt', pos: t.pos };
        return node;
      }
      case 'REM': {
        const t = cursor.next();
        const node: RemStmt = { kind: 'RemStmt', pos: t.pos };
        return node;
      }
      case 'DATA':
        return parseDataStmt(cursor);
      case 'READ':
        return parseReadStmt(cursor);
      case 'RESTORE':
        return parseRestoreStmt(cursor);
      case 'DIM':
        return parseDimStmt(cursor);
      case 'ERASE':
        return parseEraseStmt(cursor);
      case 'CLEAR': {
        const t = cursor.next();
        const node: ClearStmt = { kind: 'ClearStmt', pos: t.pos };
        return node;
      }
      default:
        return parseUnsupportedKeywordStmt(cursor);
    }
  }

  throw new BasicError(ErrorCode.SYNTAX, `文として使えないトークンです: "${tok.text}"`);
}

/**
 * 1行分の文リストを読む。`:` が複文区切り。末尾が `:` のまま行が終わる
 * （コメントを飲み込んだ結果など）場合は空文を追加せず単に打ち切る。
 */
export function parseStatementList(cursor: Cursor): Stmt[] {
  const statements: Stmt[] = [];
  if (cursor.atEnd()) {
    return statements;
  }
  for (;;) {
    statements.push(parseStatement(cursor));
    if (cursor.checkType('colon')) {
      cursor.next();
      if (cursor.atEnd()) {
        break;
      }
      continue;
    }
    break;
  }
  if (!cursor.atEnd()) {
    const t = cursor.peek();
    throw new BasicError(ErrorCode.SYNTAX, `文の後に余分なトークンがあります: "${t ? t.text : ''}"`);
  }
  return statements;
}

/**
 * プログラム全体（テキスト）を行の配列へ変換する入口関数。
 * 各行の行番号取得・トークン化は tokenizer.ts の `tokenizeProgram` に任せ、
 * ここでは各行のトークン列を文リストへ変換するだけを行う。
 */
export function parseProgram(source: string): ProgramLine[] {
  return tokenizeProgram(source).map((line) => {
    const cursor = new Cursor(line.tokens);
    const statements = parseStatementList(cursor);
    return { lineNumber: line.lineNumber, statements };
  });
}
