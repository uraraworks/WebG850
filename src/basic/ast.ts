// Phase 1 の AST ノード型。
// docs/design/phase1_grammar.md の「式」節・「文」節に対応する。
//
// 式ノードは今回（式パーサ担当）で確定させる。文ノードは次の担当（文パーサ）が
// 追加しやすいよう、判別可能な union（`kind` フィールドで判別）の形だけ用意し、
// 中身は最小限にとどめる。

// ─────────────────────────────────────────────────────────────
// 式
// ─────────────────────────────────────────────────────────────

/** 二項演算子。優先順位は parser.ts 側（docs/design/phase1_grammar.md の表）で扱う。 */
export type BinaryOperator =
  | '^'
  | '*'
  | '/'
  | 'MOD'
  | '+'
  | '-'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | 'AND'
  | 'OR'
  | 'XOR';

/** 単項演算子。`NOT` も単項として扱う（grammar 表の #7）。 */
export type UnaryOperator = '-' | '+' | 'NOT';

interface NodeBase {
  /** ソース中の開始位置（Token.pos をそのまま転記。エラー表示用）。 */
  readonly pos: number;
}

/** 数値リテラル（10進・16進とも解釈済みの数値を持つ）。 */
export interface NumberLiteral extends NodeBase {
  readonly kind: 'NumberLiteral';
  readonly value: number;
  /** ソース上の原文表記（&HFF 等、LIST 再構成用に残す）。 */
  readonly raw: string;
}

/** 文字列リテラル（前後のダブルクォートを除いた中身）。 */
export interface StringLiteral extends NodeBase {
  readonly kind: 'StringLiteral';
  readonly value: string;
}

/** スカラー変数参照（`A`, `A$`）。配列参照は ArrayRef を使う。 */
export interface VariableRef extends NodeBase {
  readonly kind: 'VariableRef';
  readonly name: string;
}

/** 配列参照（`A(1,2)`）。添字は式のリスト（次元数は実行時に検証する）。 */
export interface ArrayRef extends NodeBase {
  readonly kind: 'ArrayRef';
  readonly name: string;
  readonly indices: readonly Expr[];
}

/**
 * 関数呼び出し。`PI` `FRE` `MDF` `INKEY$` は引数も括弧も取らないため
 * `args` が空配列になる（括弧の有無自体は AST に残さない。パーサが
 * grammar 文書の規則に従って強制するため、この形で表現すれば十分）。
 */
export interface FunctionCall extends NodeBase {
  readonly kind: 'FunctionCall';
  readonly name: string;
  readonly args: readonly Expr[];
}

/** 単項演算（`-x`, `+x`, `NOT x`）。 */
export interface UnaryOp extends NodeBase {
  readonly kind: 'UnaryOp';
  readonly op: UnaryOperator;
  readonly operand: Expr;
}

/** 二項演算（算術・比較・論理をすべて含む）。 */
export interface BinaryOp extends NodeBase {
  readonly kind: 'BinaryOp';
  readonly op: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
}

/**
 * 未対応の式要素。関数名・キーワードとして認識はできたが、
 * このパーサが式として扱えないもの（phase 2/3 の関数、あるいは
 * そもそも未知の綴り）を表す。実行時にここへ到達したら
 * `UnsupportedError` を投げる（docs/design/phase1_grammar.md「未対応の扱い」）。
 */
export interface UnsupportedExpr extends NodeBase {
  readonly kind: 'UnsupportedExpr';
  /** 未対応と判定された名前（関数名・キーワード等）。 */
  readonly name: string;
  /**
   * `'unknown'`: そもそも知らない綴り（basic_commands.yaml に存在しない）。
   * `'phase2'` / `'phase3'`: yaml には存在するが対象フェーズ外と判明している命令。
   */
  readonly reason: 'unknown' | 'phase2' | 'phase3';
}

export type Expr =
  | NumberLiteral
  | StringLiteral
  | VariableRef
  | ArrayRef
  | FunctionCall
  | UnaryOp
  | BinaryOp
  | UnsupportedExpr;

// ─────────────────────────────────────────────────────────────
// 文
// ─────────────────────────────────────────────────────────────
//
// 今回（式パーサ担当）は文パーサを実装しないため、最小限のプレースホルダのみ
// 置く。次の担当は Stmt の union にケースを足し、statement.ts 等へ実装を追加
// していく想定（parser.ts の Cursor 構造はそのまま流用できる）。

/**
 * 未対応の文。知らないキーワード、または phase 2/3 と判明している命令の文を
 * 表す。式の UnsupportedExpr と同じ考え方（docs/design/phase1_grammar.md
 * 「未対応の扱い」）。文パーサ担当が実際に生成する。
 */
export interface UnsupportedStmt extends NodeBase {
  readonly kind: 'UnsupportedStmt';
  readonly name: string;
  readonly reason: 'unknown' | 'phase2' | 'phase3';
}

/** Phase 1 の文ノード。次の担当が具体的な文（PRINT/IF/FOR 等）を追加していく。 */
export type Stmt = UnsupportedStmt;

/** 1行分（複文はセミコロンでなくコロン区切り、docs/design/phase1_grammar.md「行」節）。 */
export interface ProgramLine {
  readonly lineNumber: number | null;
  readonly statements: readonly Stmt[];
}
