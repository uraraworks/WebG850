// BASIC エラー。番号は docs/spec/basic_errors.yaml の code に対応する。
// ここでは全番号を網羅せず、コード側から実際に投げるものだけ定数化する
// （残りは basic_errors.yaml を正典として都度参照すればよい）。

/**
 * docs/spec/basic_errors.yaml の code 列に対応する番号定数。
 *
 * interpreter.ts（実行エンジン）で新たに必要になった番号（13/30/32/51/52/53/61/62/63/64）を
 * ここへ追記した。いずれも basic_errors.yaml に既に定義済みの番号を割り当てただけで、
 * 新規に番号を発明したものではない。
 */
export const ErrorCode = {
  /** 10: 許されない式または命令が使われた（構文エラー）。 */
  SYNTAX: 10,
  /** 13: CONT命令が不正な状態で実行された。 */
  CONT_INVALID_STATE: 13,
  /** 20: 計算結果が演算可能範囲（10^100）を超えた（オーバーフロー）。 */
  OVERFLOW: 20,
  /** 21: ゼロ除算が発生した。 */
  DIVISION_BY_ZERO: 21,
  /** 22: 許されない演算が行われた（定義域外の計算）。 */
  ILLEGAL_FUNCTION_CALL: 22,
  /** 30: 既に使用されている配列変数名を再度 DIM しようとした（DIMの重複）。 */
  DUPLICATE_DIM: 30,
  /** 32: 配列の添字が確保したサイズを超えた（添字範囲外）。 */
  SUBSCRIPT_OUT_OF_RANGE: 32,
  /** 40: 指定した行番号またはラベルが存在しない。 */
  UNDEFINED_LINE: 40,
  /** 41: 行番号の指定が不正（有効範囲は1〜65279）。 */
  ILLEGAL_LINE_NUMBER: 41,
  /** 51: サブルーチン呼び出しのないまま RETURN を実行しようとした。 */
  RETURN_WITHOUT_GOSUB: 51,
  /** 52: NEXT に対応する FOR が無い。 */
  NEXT_WITHOUT_FOR: 52,
  /** 53: READ に対応する DATA が無い（データを読み切った）。 */
  OUT_OF_DATA: 53,
  /** 61: ブロック形式の IF/ELSE に ENDIF を対応させずに実行しようとした。 */
  IF_WITHOUT_ENDIF: 61,
  /** 62: REPEAT に対応しない UNTIL が使われた。 */
  UNTIL_WITHOUT_REPEAT: 62,
  /** 63: WEND に対応しない WHILE が使われた（＝WENDに対応するWHILEが無い）。 */
  WEND_WITHOUT_WHILE: 63,
  /** 64: WHILE ループに対応する WEND が見つからない。 */
  WHILE_WITHOUT_WEND: 64,
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
