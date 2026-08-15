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
// docs/design/phase1_grammar.md「文」節に対応する。ブロック構造
// （FOR/NEXT、WHILE/WEND、REPEAT/UNTIL、IF/ELSE/ENDIF、
// SWITCH/CASE/DEFAULT/ENDSWITCH）は AST に畳まず、それぞれ独立した
// フラットな文ノードとして表現する（実行時にスタックでマッチングする設計。
// GOTO でブロックの内外へ自由に飛べる実機挙動のため）。

/**
 * 未対応の文。知らないキーワード、または phase 2/3 と判明している命令の文を
 * 表す。式の UnsupportedExpr と同じ考え方（docs/design/phase1_grammar.md
 * 「未対応の扱い」）。
 *
 * 【判断】 画面・図形系（CLS/LOCATE/PSET/LINE/CIRCLE/PAINT/GPRINT/BEEP/WAIT 等）
 * とダイレクトコマンド系（RUN/LIST/NEW/AUTO/RENUM 等）は次の担当のスコープの
 * ため、今回のディスパッチャは分類表を持たない。それらは reason: 'unknown'
 * として素通りする（本当に未知の綴りと区別できないが、フェーズ外ではなく
 * 「次の担当が未実装」という状態なので誤りではない。次の担当が
 * STATEMENT_PHASE 相当の表を拡張して正しく分類すること）。
 */
export interface UnsupportedStmt extends NodeBase {
  readonly kind: 'UnsupportedStmt';
  readonly name: string;
  readonly reason: 'unknown' | 'phase2' | 'phase3';
}

/** 飛び先。`<行番号>` / `"<ラベル>"` / `*ラベル` の3形態を共通で表す。 */
export type JumpTarget = LineNumberTarget | LabelTarget;

export interface LineNumberTarget extends NodeBase {
  readonly kind: 'LineNumberTarget';
  readonly value: number;
}

/** `"<ラベル>"`（引用符付き文字列）と `*ラベル` のどちらの書き方も同じ対象を指すため統一する。 */
export interface LabelTarget extends NodeBase {
  readonly kind: 'LabelTarget';
  readonly name: string;
}

/** `*ラベル` 単独の文（行頭に置ける飛び先の定義）。 */
export interface LabelStmt extends NodeBase {
  readonly kind: 'LabelStmt';
  readonly name: string;
}

/** 代入先。スカラー変数または配列要素。 */
export type AssignTarget = VariableRef | ArrayRef;

export interface LetAssignment {
  readonly target: AssignTarget;
  readonly value: Expr;
}

/** `LET`（省略可）。`A=1,B=2` のようにカンマ区切りで複数代入できる。 */
export interface LetStmt extends NodeBase {
  readonly kind: 'LetStmt';
  readonly assignments: readonly LetAssignment[];
}

/** `PRINT USING "<format>"` 節。項目リストの途中にも現れうる。 */
export interface PrintUsing extends NodeBase {
  readonly kind: 'PrintUsing';
  readonly format: Expr;
}

export type PrintItem = Expr | PrintUsing;

export interface PrintSegment {
  /** この項目の直前にあった区切り記号（先頭項目は null）。 */
  readonly sep: ',' | ';' | null;
  readonly value: PrintItem;
}

/** `PRINT`。`,`＝12桁ゾーン送り、`;`＝連結、末尾 `;`＝改行抑制、引数なし＝空行。 */
export interface PrintStmt extends NodeBase {
  readonly kind: 'PrintStmt';
  readonly items: readonly PrintSegment[];
  /** 末尾の区切り記号（改行抑制/ゾーン送りのまま行が終わった場合）。無ければ null。 */
  readonly trailingSep: ',' | ';' | null;
}

/** `INPUT` のメッセージ部分。`;` 付きなら `?` 表示を抑制する（quiet）。 */
export interface InputPrompt extends NodeBase {
  readonly kind: 'InputPrompt';
  readonly message: Expr;
  readonly quiet: boolean;
}

export type InputItem = InputPrompt | AssignTarget;

/** `INPUT`。メッセージと変数が交互に並びうる（docs 参照）。 */
export interface InputStmt extends NodeBase {
  readonly kind: 'InputStmt';
  readonly items: readonly InputItem[];
}

/** `IF` の1行形式の THEN/ELSE 節：飛び先か、単一の文のどちらか。 */
export type IfClause = JumpTarget | Stmt;

/** `IF <条件> THEN <飛び先|文> [ELSE <飛び先|文>]`（1行形式、自己完結）。 */
export interface IfLineStmt extends NodeBase {
  readonly kind: 'IfLineStmt';
  readonly condition: Expr;
  readonly thenClause: IfClause;
  readonly elseClause: IfClause | null;
}

/** `IF <条件> THEN`（ブロック形式のヘッダ）。対応する ELSE/ENDIF は実行時にマッチングする。 */
export interface IfStmt extends NodeBase {
  readonly kind: 'IfStmt';
  readonly condition: Expr;
}

/** ブロック形式 IF の `ELSE`（単独マーカー）。 */
export interface ElseStmt extends NodeBase {
  readonly kind: 'ElseStmt';
}

/** ブロック形式 IF の `ENDIF`（単独マーカー）。 */
export interface EndIfStmt extends NodeBase {
  readonly kind: 'EndIfStmt';
}

/** `FOR <変数>=<式> TO <式> [STEP <式>]`（ヘッダのみ。NEXT と対でループスタックにマッチングする）。 */
export interface ForStmt extends NodeBase {
  readonly kind: 'ForStmt';
  readonly variable: VariableRef;
  readonly from: Expr;
  readonly to: Expr;
  readonly step: Expr | null;
}

/** `NEXT [<変数>]`。省略時はループスタック最上位を閉じる。 */
export interface NextStmt extends NodeBase {
  readonly kind: 'NextStmt';
  readonly variable: VariableRef | null;
}

/** `WHILE <条件>`（ヘッダのみ）。 */
export interface WhileStmt extends NodeBase {
  readonly kind: 'WhileStmt';
  readonly condition: Expr;
}

/** `WEND`（単独マーカー）。 */
export interface WendStmt extends NodeBase {
  readonly kind: 'WendStmt';
}

/** `REPEAT`（単独マーカー）。 */
export interface RepeatStmt extends NodeBase {
  readonly kind: 'RepeatStmt';
}

/** `UNTIL <条件>`。 */
export interface UntilStmt extends NodeBase {
  readonly kind: 'UntilStmt';
  readonly condition: Expr;
}

/** `SWITCH <式>`（ヘッダのみ）。 */
export interface SwitchStmt extends NodeBase {
  readonly kind: 'SwitchStmt';
  readonly expr: Expr;
}

/** `CASE <値の並び>`。 */
export interface CaseStmt extends NodeBase {
  readonly kind: 'CaseStmt';
  readonly values: readonly Expr[];
}

/** `DEFAULT`（単独マーカー）。 */
export interface DefaultStmt extends NodeBase {
  readonly kind: 'DefaultStmt';
}

/** `ENDSWITCH`（単独マーカー）。 */
export interface EndSwitchStmt extends NodeBase {
  readonly kind: 'EndSwitchStmt';
}

/** `GOTO <飛び先>`。 */
export interface GotoStmt extends NodeBase {
  readonly kind: 'GotoStmt';
  readonly target: JumpTarget;
}

/** `GOSUB <飛び先>`。 */
export interface GosubStmt extends NodeBase {
  readonly kind: 'GosubStmt';
  readonly target: JumpTarget;
}

/** `RETURN`（単独）。 */
export interface ReturnStmt extends NodeBase {
  readonly kind: 'ReturnStmt';
}

/** `ON <式> GOTO <飛び先>[,<飛び先>…]`。 */
export interface OnGotoStmt extends NodeBase {
  readonly kind: 'OnGotoStmt';
  readonly selector: Expr;
  readonly targets: readonly JumpTarget[];
}

/** `ON <式> GOSUB <飛び先>[,<飛び先>…]`。 */
export interface OnGosubStmt extends NodeBase {
  readonly kind: 'OnGosubStmt';
  readonly selector: Expr;
  readonly targets: readonly JumpTarget[];
}

/** `END`（単独）。 */
export interface EndStmt extends NodeBase {
  readonly kind: 'EndStmt';
}

/** `STOP`（単独）。 */
export interface StopStmt extends NodeBase {
  readonly kind: 'StopStmt';
}

/**
 * `REM` または `'`。行末（`:` でも終わらない）までコメントのため、内容は
 * トークン化の時点で捨てられる（Cursor が comment トークンを除外する設計、
 * parser.ts 参照）。実行時は何もしないだけなので中身を持つ必要がない。
 */
export interface RemStmt extends NodeBase {
  readonly kind: 'RemStmt';
}

/** `DATA` の1項目。式パーサへは渡さず、行末または `,`/`:` までの生テキストとして読む。 */
export interface DataValue extends NodeBase {
  readonly text: string;
  readonly quoted: boolean;
}

/** `DATA <値のリスト>`。カンマ区切り。 */
export interface DataStmt extends NodeBase {
  readonly kind: 'DataStmt';
  readonly values: readonly DataValue[];
}

/** `READ <変数>[,<変数>…]`。 */
export interface ReadStmt extends NodeBase {
  readonly kind: 'ReadStmt';
  readonly targets: readonly AssignTarget[];
}

/** `RESTORE [<行番号>|"<ラベル>"|*ラベル]`。 */
export interface RestoreStmt extends NodeBase {
  readonly kind: 'RestoreStmt';
  readonly target: JumpTarget | null;
}

/** `DIM` の1変数分。`stringLength` は `*<文字列長>` （文字列配列のみ）。 */
export interface DimSpec {
  readonly name: string;
  readonly dims: readonly Expr[];
  readonly stringLength: Expr | null;
}

/** `DIM <変数>[$](<index1>[,<index2>])[*<文字列長>][,……]`。 */
export interface DimStmt extends NodeBase {
  readonly kind: 'DimStmt';
  readonly specs: readonly DimSpec[];
}

/** `ERASE <変数>|<配列>[,…]`。配列全体消去は空括弧 `A()`（ArrayRef.indices が空配列）で表す。 */
export interface EraseStmt extends NodeBase {
  readonly kind: 'EraseStmt';
  readonly targets: readonly AssignTarget[];
}

/** `CLEAR`（単独）。全変数を破棄する。 */
export interface ClearStmt extends NodeBase {
  readonly kind: 'ClearStmt';
}

/** Phase 1 の文ノード。 */
export type Stmt =
  | UnsupportedStmt
  | LabelStmt
  | LetStmt
  | PrintStmt
  | InputStmt
  | IfLineStmt
  | IfStmt
  | ElseStmt
  | EndIfStmt
  | ForStmt
  | NextStmt
  | WhileStmt
  | WendStmt
  | RepeatStmt
  | UntilStmt
  | SwitchStmt
  | CaseStmt
  | DefaultStmt
  | EndSwitchStmt
  | GotoStmt
  | GosubStmt
  | ReturnStmt
  | OnGotoStmt
  | OnGosubStmt
  | EndStmt
  | StopStmt
  | RemStmt
  | DataStmt
  | ReadStmt
  | RestoreStmt
  | DimStmt
  | EraseStmt
  | ClearStmt;

/** 1行分（複文はセミコロンでなくコロン区切り、docs/design/phase1_grammar.md「行」節）。 */
export interface ProgramLine {
  readonly lineNumber: number | null;
  readonly statements: readonly Stmt[];
}
