// トークン種別の定義。予約語表は docs/spec/basic_tokens.yaml の `name` 列を
// 正典とする（SCHEMA.md / 依頼指示）。ここに手で予約語表を作り直さない
// （src/basic/generated/command_table.ts を npm run gen で生成し、それを使う）。

import { TOKEN_KEYWORDS } from './generated/command_table.js';

export type TokenType =
  | 'keyword' // 予約語（KEYWORDS 参照）
  | 'number' // 数値リテラル（10進・&H 16進）
  | 'string' // 文字列リテラル
  | 'identifier' // 変数名・配列名（数値: A, B12 / 文字列: A$, B12$）
  | 'operator' // + - * / ^ = < > <= >= <> \
  | 'lparen' // (
  | 'rparen' // )
  | 'comma' // ,
  | 'semicolon' // ;
  | 'colon' // : 複文区切り（解釈はパーサの担当。ここではトークンとして出すだけ）
  | 'comment'; // REM / ' 以降の行末までのコメント本文

export interface Token {
  readonly type: TokenType;
  /** ソース上の原文表記（数値・文字列も元の書き方のまま保持する）。 */
  readonly text: string;
  /** number リテラルの解釈済み値（10進・16進とも10進 number にして持つ）。 */
  readonly numberValue?: number;
  /** string リテラルの解釈済み値（前後のダブルクォートを除いた中身）。 */
  readonly stringValue?: string;
  /** ソース中の開始位置（0始まり）。エラー表示・LIST 再構成用。 */
  readonly pos: number;
  /**
   * ソース中の終了位置（このトークンの直後、半開区間の終端）。
   * `pos`〜`end` を元テキストからそのまま切り出せば、トークン化で失われる
   * 空白等を復元できる（DATA / REM の本文再構成に使う。依頼元: バグ修正指示）。
   */
  readonly end: number;
}

/**
 * yaml に無いが予約語として必要な例外（生成物 TOKEN_KEYWORDS には混ぜない）。
 *
 * - `AUTO` は命令一覧（basic_commands.yaml）側にのみ存在し中間コードが
 *   basic_tokens.yaml に無いが、文パーサ（ダイレクトコマンド系担当）が
 *   予約語として認識する必要があるため追加した。中間コード値は未確定のまま
 *   （トークン化時の判定にしか使わないため実害はない）。
 */
const KEYWORD_EXCEPTIONS: readonly string[] = ['AUTO'];

/**
 * 予約語表（docs/spec/basic_tokens.yaml の name 列、141件 + 上記例外）。
 * 生成元は src/basic/generated/command_table.ts（npm run gen で再生成）。
 *
 * 既知の注意点（docs/仕様_BASIC命令セット.md「中間コード表との突き合わせ」節より）:
 * - `POIPUT`（0x49）は中間コード表側の誤記で、マニュアル本文・目次では `PIOPUT` に
 *   統一されている。ただし SCHEMA.md の指示により予約語は basic_tokens.yaml を
 *   正典とするため、ここでは修正せず yaml の表記のままにしている
 *   （パーサ担当が対応する際にどちらを採用するか判断すること）。
 *
 * 最長一致でのキーワード判定に使うため、あらかじめ文字列長の降順に並べておく
 * （tokenizer.ts 側で改めてソートしてもよいが、表自体を読みやすい順にしておく）。
 */
export const KEYWORDS: readonly string[] = [...TOKEN_KEYWORDS, ...KEYWORD_EXCEPTIONS]
  // 最長一致 (tokenizer.ts の readKeyword) のため長い順に並べ替える。
  // 同じ長さのものは表の元の並びを保つ（安定ソート）。
  .slice()
  .sort((a, b) => b.length - a.length);

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

export function isKeyword(text: string): boolean {
  return KEYWORD_SET.has(text);
}
