// ダイレクトモード（LCD上のラインエディタ）用の補助関数。
//
// `parser.ts` の `parseProgram`/`tokenizeProgram` は「全ての行に行番号が付く」
// 前提（`tokenizeProgram` は行番号が無い行を構文エラーにする）で、プログラム
// テキスト全体を一括で読む用途向けに作られている。ダイレクトモードで
// 「行番号なしの1行」（例: `PRINT 1+2`、`RUN` 単体）をその場で実行するには、
// 行番号を要求しない別の入口が要る。ここでは `tokenize`/`parseStatementList`
// という既存の部品をそのまま組み合わせるだけで、新しい構文規則は増やさない。

import { Cursor, parseStatementList } from './parser.ts';
import { tokenize } from './tokenizer.ts';
import type { Stmt } from './ast.ts';

/**
 * 行番号を含まない1行分のテキストを文リストへパースする。
 * 空白のみの行を渡すと空配列を返す（呼び出し側で「何もしない」扱いにする）。
 */
export function parseDirectStatements(text: string): Stmt[] {
  if (text.trim() === '') return [];
  const cursor = new Cursor(tokenize(text), text);
  return parseStatementList(cursor);
}
