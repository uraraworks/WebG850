// ダイレクトモード（LCD上のラインエディタ）用の補助関数。
//
// `parser.ts` の `parseProgram`/`tokenizeProgram` は「全ての行に行番号が付く」
// 前提（`tokenizeProgram` は行番号が無い行を構文エラーにする）で、プログラム
// テキスト全体を一括で読む用途向けに作られている。ダイレクトモードで
// 「行番号なしの1行」（例: `PRINT 1+2`、`RUN` 単体）をその場で実行するには、
// 行番号を要求しない別の入口が要る。ここでは `tokenize`/`parseStatementList`
// という既存の部品をそのまま組み合わせるだけで、新しい構文規則は増やさない。

import { Cursor, parseExpression, parseStatementList } from './parser.ts';
import { tokenize } from './tokenizer.ts';
import type { Stmt } from './ast.ts';

/**
 * 行番号を含まない1行分のテキストを文リストへパースする。
 * 空白のみの行を渡すと空配列を返す（呼び出し側で「何もしない」扱いにする）。
 *
 * 【RUN モード対応で追加】 `parseStatement`（parser.ts）の文法は「文は識別子
 * （暗黙 LET）か予約語で始まる」前提で、数値・文字列リテラルや `(`・単項符号
 * で始まる行（例: `30`、`3+4`、`-5`）は元々どの文にも当てはまらず構文エラーに
 * なっていた。これらのトークンは実際の文法では絶対に文の先頭に来ない
 * （`LET`/キーワード/識別子のいずれでもない）ため、先読みだけで「文ではなく
 * 式そのものが打たれた」と確実に判定できる。RUN モード（`ui/directMode.ts`）が
 * 数字始まりの入力を「計算式として評価」するために、ここで式として読み、
 * 暗黙の `PRINT <式>` として扱う（実機ポケコンの電卓的な使い方＝式を打つと
 * 結果が表示される、という挙動に対応させるため）。
 */
export function parseDirectStatements(text: string): Stmt[] {
  if (text.trim() === '') return [];
  const cursor = new Cursor(tokenize(text), text);
  if (looksLikeBareExpressionStart(cursor)) {
    return [parseBareExpressionAsPrint(cursor)];
  }
  return parseStatementList(cursor);
}

/** 文の先頭には絶対に来ないトークン種別・記号かどうかを判定する（式の先頭だけがこの形になる）。 */
function looksLikeBareExpressionStart(cursor: Cursor): boolean {
  const tok = cursor.peek();
  if (tok === undefined) return false;
  if (tok.type === 'number' || tok.type === 'string' || tok.type === 'lparen') return true;
  if (tok.type === 'operator' && (tok.text === '-' || tok.text === '+')) return true;
  return false;
}

/** 行全体を1つの式として読み、暗黙の `PRINT <式>` へ変換する。 */
function parseBareExpressionAsPrint(cursor: Cursor): Stmt {
  const tok = cursor.peek();
  const pos = tok ? tok.pos : 0;
  const value = parseExpression(cursor);
  return {
    kind: 'PrintStmt',
    items: [{ sep: null, value }],
    trailingSep: null,
    pos,
  };
}
