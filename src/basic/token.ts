// トークン種別の定義。予約語表は docs/spec/basic_tokens.yaml の `name` 列を
// 正典とする（SCHEMA.md / 依頼指示）。ここに手で予約語表を作り直さない。

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
}

/**
 * 予約語表（docs/spec/basic_tokens.yaml の name 列、141件）。
 *
 * 既知の注意点（docs/仕様_BASIC命令セット.md「中間コード表との突き合わせ」節より）:
 * - `POIPUT`（0x49）は中間コード表側の誤記で、マニュアル本文・目次では `PIOPUT` に
 *   統一されている。ただし SCHEMA.md の指示により予約語は basic_tokens.yaml を
 *   正典とするため、ここでは修正せず yaml の表記のままにしている
 *   （パーサ担当が対応する際にどちらを採用するか判断すること）。
 * - `AUTO` は命令一覧側にのみ存在しトークンが未特定のため、この表には含まれない。
 *
 * 最長一致でのキーワード判定に使うため、あらかじめ文字列長の降順に並べておく
 * （tokenizer.ts 側で改めてソートしてもよいが、表自体を読みやすい順にしておく）。
 */
export const KEYWORDS: readonly string[] = [
  'MON', 'RUN', 'NEW', 'CONT', 'PASS', 'LIST', 'LLIST', 'CLOAD', 'RENUM', 'LOAD',
  'DELETE', 'FILES', 'LCOPY', 'CSAVE', 'OPEN', 'CLOSE', 'SAVE', 'RANDOMIZE', 'DEGREE',
  'RADIAN', 'GRAD', 'BEEP', 'WAIT', 'GOTO', 'TRON', 'TROFF', 'CLEAR', 'USING', 'DIM',
  'CALL', 'POKE', 'GPRINT', 'PSET', 'PRESET', 'ERASE', 'LFILES', 'KILL', 'OUT',
  'PIOSET', 'POIPUT', 'SPOUT', 'SPINP', 'HDCOPY', 'ENDIF', 'REPEAT', 'UNTIL', 'CLS',
  'LOCATE', 'TO', 'STEP', 'THEN', 'ON', 'IF', 'FOR', 'LET', 'REM', 'END', 'NEXT',
  'STOP', 'READ', 'DATA', 'PRINT', 'INPUT', 'GOSUB', 'LNINPUT', 'LPRINT', 'RETURN',
  'RESTORE', 'GCURSOR', 'LINE', 'CIRCLE', 'PAINT', 'OUTPUT', 'APPEND', 'AS', 'ELSE',
  'WHILE', 'WEND', 'SWITCH', 'CASE', 'DEFAULT', 'ENDSWITCH', 'MDF', 'REC', 'POL',
  'TEN', 'RCP', 'SQU', 'CUR', 'HSN', 'HCS', 'HTN', 'AHS', 'AHC', 'AHT', 'FACT', 'LN',
  'LOG', 'EXP', 'SQR', 'SIN', 'COS', 'TAN', 'INT', 'ABS', 'SGN', 'DEG', 'DMS', 'ASN',
  'ACS', 'ATN', 'RND', 'AND', 'OR', 'NOT', 'PEEK', 'XOR', 'INP', 'PIOGET', 'POINT',
  'PI', 'FRE', 'EOF', 'LOF', 'NCR', 'NPR', 'CUB', 'MOD', 'FIX', 'ASC', 'VAL', 'LEN',
  'VDEG', 'INKEY$', 'MID$', 'LEFT$', 'RIGHT$', 'CHR$', 'STR$', 'HEX$', 'DMS$',
]
  // 最長一致 (tokenizer.ts の readKeyword) のため長い順に並べ替える。
  // 同じ長さのものは表の元の並びを保つ（安定ソート）。
  .slice()
  .sort((a, b) => b.length - a.length);

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

export function isKeyword(text: string): boolean {
  return KEYWORD_SET.has(text);
}
