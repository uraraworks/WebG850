// BASIC エラー。番号は docs/spec/basic_errors.yaml の code に対応する。
// ここでは全番号を網羅せず、コード側から実際に投げるものだけ定数化する
// （残りは basic_errors.yaml を正典として都度参照すればよい）。

/** docs/spec/basic_errors.yaml の code 列に対応する番号定数。 */
export const ErrorCode = {
  /** 10: 許されない式または命令が使われた（構文エラー）。 */
  SYNTAX: 10,
  /** 20: 計算結果が演算可能範囲（10^100）を超えた（オーバーフロー）。 */
  OVERFLOW: 20,
  /** 21: ゼロ除算が発生した。 */
  DIVISION_BY_ZERO: 21,
  /** 22: 許されない演算が行われた（定義域外の計算）。 */
  ILLEGAL_FUNCTION_CALL: 22,
  /** 40: 指定した行番号またはラベルが存在しない。 */
  UNDEFINED_LINE: 40,
  /** 41: 行番号の指定が不正（有効範囲は1〜65279）。 */
  ILLEGAL_LINE_NUMBER: 41,
  /** 90: 数値変数へ文字を、あるいは文字列変数へ数値を代入しようとした（型不一致）。 */
  TYPE_MISMATCH: 90,
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * BASIC 実行中に発生するエラー。実機は `?ERROR n IN 行番号` のような形で
 * 番号を表示するだけなので、メッセージは実装側の日本語（開発者向け）でよい。
 * 画面表示用の文字列組み立ては machine/interpreter 側の責務とし、ここでは
 * 番号と補助情報の運搬だけを行う。
 */
export class BasicError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    /** エラーが発生した BASIC の行番号（分かる場合）。 */
    public readonly lineNumber?: number,
  ) {
    super(message);
    this.name = 'BasicError';
  }
}

/**
 * 未実装命令用のエラー。パーサ／インタプリタが「知らない命令名」に出会ったら
 * これを投げる。設計書「未実装を無言にしない」節に対応する
 * （docs/design/phase1_architecture.md）。
 *
 * BasicError を継承しないのは、これが「BASIC プログラム上のエラー」ではなく
 * 「この実装がまだ対応していない」という実装側の事情を表すため。呼び出し側
 * （machine/interpreter）はこれを捕まえて `?UNSUPPORTED <名前> IN <行番号>`
 * のような表示に変換する。
 */
export class UnsupportedError extends Error {
  constructor(
    /** 未対応の命令・関数名（例: "CIRCLE"）。 */
    public readonly name_: string,
    /** 発生した BASIC の行番号（分かる場合）。 */
    public readonly lineNumber?: number,
  ) {
    super(`未実装の命令/関数です: ${name_}`);
    this.name = 'UnsupportedError';
  }
}
