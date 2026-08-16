// ソーステキスト → トークン列。
// docs/design/phase1_architecture.md の全体構成に対応する最初の段。
//
// G850 BASIC は変数名とキーワードの間に空白が要らない（"FORI=1TO10" が通る）ため、
// 予約語は最長一致方式で拾う（依頼指示）。境界チェックはしない＝
// "TOTAL" は "TO" + "TAL" のように分割され得る。これは実機の1バイトトークン方式
// ポケコンBASIC共通の性質（識別子は予約語で始めない、という利用者側の作法で
// 回避する）で、この実装だけの欠陥ではない。

import { BasicError, ErrorCode } from './errors.js';
import { KEYWORDS, type Token } from './token.js';

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'));
}

function isHexDigit(ch: string | undefined): boolean {
  return (
    ch !== undefined &&
    ((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'F') || (ch >= 'a' && ch <= 'f'))
  );
}

function isIdentifierChar(ch: string | undefined): boolean {
  return isLetter(ch) || isDigit(ch);
}

/**
 * `text` の `pos` から始まる最長一致の予約語を返す（無ければ null）。
 * KEYWORDS は token.ts 側であらかじめ長い順に並べてあるので、
 * 先頭から見つかったものが最長一致になる。
 */
function matchKeyword(text: string, pos: number): string | null {
  for (const kw of KEYWORDS) {
    if (text.startsWith(kw, pos)) {
      return kw;
    }
  }
  return null;
}

interface ReadResult {
  readonly token: Token;
  readonly next: number;
}

/** 10進数値リテラル（整数・小数・指数表記）を読む。 */
function readNumber(text: string, start: number): ReadResult {
  let pos = start;
  while (isDigit(text[pos])) pos++;
  if (text[pos] === '.') {
    pos++;
    while (isDigit(text[pos])) pos++;
  }
  if (text[pos] === 'E' || text[pos] === 'e') {
    let expPos = pos + 1;
    if (text[expPos] === '+' || text[expPos] === '-') expPos++;
    if (isDigit(text[expPos])) {
      pos = expPos;
      while (isDigit(text[pos])) pos++;
    }
    // 'E' の後に数字が続かない場合は指数部とみなさず、'E' の手前で確定する。
  }
  const raw = text.slice(start, pos);
  return {
    token: { type: 'number', text: raw, numberValue: Number(raw), pos: start, end: pos },
    next: pos,
  };
}

/** 16進数値リテラル（"&H" + 16進数字）を読む。 */
function readHexNumber(text: string, start: number): ReadResult {
  let pos = start + 2; // '&H' を読み飛ばす
  const digitsStart = pos;
  while (isHexDigit(text[pos])) pos++;
  const digits = text.slice(digitsStart, pos);
  const raw = text.slice(start, pos);
  if (digits.length === 0) {
    throw new BasicError(ErrorCode.SYNTAX, `16進数リテラルの桁がありません: "${raw}"`);
  }
  return {
    token: { type: 'number', text: raw, numberValue: parseInt(digits, 16), pos: start, end: pos },
    next: pos,
  };
}

/**
 * 文字列リテラルを読む。閉じクォートが無いまま行末に達した場合は、
 * そこまでを文字列として扱う。
 *
 * 【推測で決めた点・理由】 未終端文字列リテラルの扱いはマニュアルに記載が
 * 無かった。多くの古典 BASIC で共通する「行末まで文字列とみなす」慣習を
 * 採用した。エスケープ（"" による引用符自体の埋め込み等）の有無も未確認のため
 * 実装していない（G850 の文字列に引用符自体を含める方法があるかは不明）。
 */
function readString(text: string, start: number): ReadResult {
  let pos = start + 1;
  while (pos < text.length && text[pos] !== '"') {
    pos++;
  }
  const content = text.slice(start + 1, pos);
  if (text[pos] === '"') {
    pos++; // 閉じクォートを消費
  }
  const raw = text.slice(start, pos);
  return {
    token: { type: 'string', text: raw, stringValue: content, pos: start, end: pos },
    next: pos,
  };
}

/** 識別子（変数名・配列名）を読む。末尾の `$` は文字列変数の印として含める。 */
function readIdentifier(text: string, start: number): ReadResult {
  let pos = start;
  while (isIdentifierChar(text[pos])) pos++;
  if (text[pos] === '$') pos++;
  const raw = text.slice(start, pos);
  return { token: { type: 'identifier', text: raw, pos: start, end: pos }, next: pos };
}

const TWO_CHAR_OPERATORS = ['<=', '>=', '<>'];
const ONE_CHAR_OPERATORS = '+-*/\\^=<>';

/**
 * ソース1行分（行番号を含まない本文）をトークン列にする。
 * `REM` キーワードおよび `'` は行末までコメント扱いにする。
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const len = source.length;
  let pos = 0;

  while (pos < len) {
    const ch = source[pos] as string;

    if (ch === ' ' || ch === '\t') {
      pos++;
      continue;
    }

    if (ch === "'") {
      tokens.push({ type: 'comment', text: source.slice(pos), pos, end: len });
      break;
    }

    if (ch === '"') {
      const { token, next } = readString(source, pos);
      tokens.push(token);
      pos = next;
      continue;
    }

    if (ch === '&' && (source[pos + 1] === 'H' || source[pos + 1] === 'h')) {
      const { token, next } = readHexNumber(source, pos);
      tokens.push(token);
      pos = next;
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(source[pos + 1]))) {
      // 【不確定仕様】 整数部を省略した小数リテラル（`.5`）。マニュアルに
      // 明記は無いが実在作品コーパスの計測で複数件確認できたため受理する。
      // readNumber は先頭が '.' でも整数部0桁のまま小数部から読める。
      // "A.B" のような識別子由来の誤読を避けるため、'.' の直後が数字の
      // ときだけ数値リテラルとして扱う（数字が続かなければ従来通り
      // 未知文字トークンに落ちる）。
      const { token, next } = readNumber(source, pos);
      tokens.push(token);
      pos = next;
      continue;
    }

    if (isLetter(ch)) {
      const kw = matchKeyword(source, pos);
      if (kw !== null) {
        tokens.push({ type: 'keyword', text: kw, pos, end: pos + kw.length });
        pos += kw.length;
        if (kw === 'REM') {
          const rest = source.slice(pos);
          if (rest.length > 0) {
            tokens.push({ type: 'comment', text: rest, pos, end: len });
          }
          pos = len;
        }
        continue;
      }
      const { token, next } = readIdentifier(source, pos);
      tokens.push(token);
      pos = next;
      continue;
    }

    if (ch === ':') {
      tokens.push({ type: 'colon', text: ':', pos, end: pos + 1 });
      pos++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', text: ',', pos, end: pos + 1 });
      pos++;
      continue;
    }
    if (ch === ';') {
      tokens.push({ type: 'semicolon', text: ';', pos, end: pos + 1 });
      pos++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', text: '(', pos, end: pos + 1 });
      pos++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', text: ')', pos, end: pos + 1 });
      pos++;
      continue;
    }

    const two = source.slice(pos, pos + 2);
    if (TWO_CHAR_OPERATORS.includes(two)) {
      tokens.push({ type: 'operator', text: two, pos, end: pos + 2 });
      pos += 2;
      continue;
    }

    if (ONE_CHAR_OPERATORS.includes(ch)) {
      tokens.push({ type: 'operator', text: ch, pos, end: pos + 1 });
      pos++;
      continue;
    }

    // 字句レベルでは判断がつかない文字。無言で読み飛ばさず、1文字の
    // operator トークンとして出す（構文的な妥当性判定はパーサの担当）。
    tokens.push({ type: 'operator', text: ch, pos, end: pos + 1 });
    pos++;
  }

  return tokens;
}

export interface ProgramLine {
  readonly lineNumber: number;
  readonly tokens: Token[];
  /**
   * 行番号を除いた本文（`tokenize` にそのまま渡した文字列）。
   * トークンの `pos`/`end` はこの文字列上の位置を指すため、DATA / REM の
   * 本文を元テキストのまま復元したいパーサ側はこれを使ってスライスする。
   */
  readonly text: string;
}

/**
 * プログラム全体（複数行）をトークン化する。各行の先頭の行番号を取り出し、
 * 残りを `tokenize` に渡す。空行は読み飛ばす。
 */
export function tokenizeProgram(source: string): ProgramLine[] {
  const lines = source.split(/\r\n|\r|\n/);
  const result: ProgramLine[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    let pos = 0;
    while (line[pos] === ' ' || line[pos] === '\t') pos++;
    const numStart = pos;
    while (isDigit(line[pos])) pos++;
    if (pos === numStart) {
      throw new BasicError(ErrorCode.SYNTAX, `行番号がありません: "${line}"`);
    }
    const lineNumber = Number(line.slice(numStart, pos));
    const text = line.slice(pos);
    result.push({ lineNumber, tokens: tokenize(text), text });
  }

  return result;
}
