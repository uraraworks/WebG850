/**
 * キーボード入力の実装。
 *
 * `docs/design/phase1_architecture.md`「ディレクトリ構成」節の役割分担どおり、
 * 押下中キーの集合と、`INKEY$`／`INPUT` 行入力の両方が使うキーバッファを持つ。
 *
 * **DOM に直接依存しない設計**にしてある。`window`/`document` への
 * `addEventListener` はホスト側（`ui/runtime.ts` や `ui/main.ts`）が行い、
 * 受け取った `KeyboardEvent` をこのクラスの `handleKeyDown`/`handleKeyUp` へ
 * そのまま渡す。これによりテストからは実イベントを new して流し込むだけで
 * 検証できる（ブラウザ起動もモックも不要）。
 */

/**
 * BREAK キーに割り当てる物理キー。
 *
 * 【判断した点・理由】 実機の BREAK キーに対応する PC キーボード上の
 * キーは仕様書に記載が無い。ブラウザアプリで「実行中の処理を止める」役割に
 * 慣習的に使われる `Escape` を既定として採用する。
 * - 理由1: IME 変換中や他のキーと衝突しにくい（単独で意味を持つキー）
 * - 理由2: ブラウザ標準のショートカット（Ctrl+C 等）と衝突しない
 * - 理由3: 「止める」操作として利用者が直感的に連想しやすい
 * 差し替える場合はこの定数だけ変更すればよい。
 */
export const BREAK_KEY = 'Escape';

/**
 * `KeyboardEvent` から「押されたキーを表す文字列」を1つ求める。
 *
 * 【注意点】 自動テスト用ブラウザ（ヘッドレス自動操作）が発行する
 * `KeyboardEvent` は `code` が空文字列になることがある
 * （`feedback_browser_automation_key_code_empty.md`）。`code` だけに
 * 依存した判定はテスト環境で機能しなくなるため、`code` が空のときは
 * `key` にフォールバックする。
 */
function eventKeyId(e: KeyboardEvent): string {
  if (e.code) return e.code;
  return e.key;
}

/**
 * `INKEY$` 用に1文字を表現する。矢印キー等の非文字キーは
 * 仕様書に対応表が無いため、`key` が1文字の場合のみ文字として扱い、
 * それ以外（"ArrowLeft" 等の複数文字表現）は無視する。
 *
 * 【判断した点・理由】 実機 INKEY$ が矢印キー等に何を返すかは
 * 仕様書に記載が無い。「未対応キーは無視（キーバッファに積まない）」という
 * 安全側（誤ったコードを積んで別の文字と誤認させない）を暫定採用する。
 */
function inkeyCharFromEvent(e: KeyboardEvent): string | null {
  if (e.key.length === 1) return e.key;
  if (e.key === 'Enter') return '\r';
  if (e.key === 'Backspace') return '\b';
  return null;
}

/**
 * CAPS ロックの既定値。
 *
 * 実機 PC-G850 は電源投入時から英字が既定で大文字入力になる
 * （小文字は `CAPS` キーの上に印字された「小文字」ラベルへ切り替えて出す）。
 * 仮想キーボードに `CAPS` キーを載せる予定があるため、この既定値と
 * `Keyboard.capsLock` フィールド1つを切り替えるだけで挙動が変わる形にしてある
 * （`setCapsLock`/`isCapsLockOn` 経由で配線する）。
 */
export const DEFAULT_CAPS_LOCK = true;

/**
 * 英字1文字に CAPS ロック状態を適用する。
 * CAPS オンなら大文字化、オフならそのまま返す（英字以外はそのまま）。
 */
export function applyCapsLock(ch: string, capsLock: boolean): string {
  return capsLock ? ch.toUpperCase() : ch;
}

export class Keyboard {
  /** 現在押下中のキー識別子（`eventKeyId` の値）の集合。 */
  private readonly pressed = new Set<string>();

  /**
   * CAPS ロック状態。既定は大文字（`DEFAULT_CAPS_LOCK`）。
   * `INKEY$`／`INPUT` と LCD 直接打鍵（`ui/directMode.ts`）の両方が
   * ここを参照するため、CAPS キー実装時はここを1箇所切り替えれば両方に効く。
   */
  private capsLock = DEFAULT_CAPS_LOCK;

  /** `INKEY$` 用のキーバッファ（1文字ずつ FIFO）。 */
  private readonly inkeyBuffer: string[] = [];

  /** `INPUT` の行入力用バッファ（確定前の1行分）。 */
  private lineBuffer = '';
  /** 行入力が確定（Enter）したかどうか。確定後は `takeLine` で取り出すまで保持する。 */
  private lineReady = false;

  /** BREAK キーが押された回数。`consumeBreak` で読み取って消費する。 */
  private breakCount = 0;

  /**
   * `keydown` イベントを1つ処理する。ホスト側から
   * `window.addEventListener('keydown', e => keyboard.handleKeyDown(e))`
   * のように渡す想定。
   */
  handleKeyDown(e: KeyboardEvent): void {
    const id = eventKeyId(e);
    this.pressed.add(id);

    if (id === BREAK_KEY || e.key === BREAK_KEY) {
      this.breakCount++;
      return;
    }

    const rawCh = inkeyCharFromEvent(e);
    if (rawCh === null) return;

    if (rawCh === '\r') {
      this.lineReady = true;
      return;
    }
    if (rawCh === '\b') {
      this.lineBuffer = this.lineBuffer.slice(0, -1);
      return;
    }

    // `INPUT`/`INKEY$` の大文字化: 仕様書に記載が無いため、LCD 直接打鍵
    // （`ui/directMode.ts`）と揃えて大文字にする（判断: 実行中の入力だけ
    // 小文字のままだと直接打鍵との非対称が利用者から見えて不自然なため）。
    const ch = applyCapsLock(rawCh, this.capsLock);
    this.inkeyBuffer.push(ch);
    this.lineBuffer += ch;
  }

  /** `keyup` イベントを1つ処理する。押下中キー集合から取り除くだけ。 */
  handleKeyUp(e: KeyboardEvent): void {
    this.pressed.delete(eventKeyId(e));
  }

  /** 指定した物理キーが現在押下中かどうか。 */
  isPressed(keyId: string): boolean {
    return this.pressed.has(keyId);
  }

  /** CAPS ロック状態を切り替える（将来の仮想キーボード `CAPS` キーから呼ぶ想定）。 */
  setCapsLock(on: boolean): void {
    this.capsLock = on;
  }

  /** 現在の CAPS ロック状態。 */
  isCapsLockOn(): boolean {
    return this.capsLock;
  }

  /** `INKEY$` 相当。バッファ先頭の1文字を取り出す。無ければ空文字列。 */
  inkey(): string {
    return this.inkeyBuffer.shift() ?? '';
  }

  /** `INPUT` 用：行が確定済みかどうか。 */
  isLineReady(): boolean {
    return this.lineReady;
  }

  /** `INPUT` 用：確定した1行を取り出し、バッファをリセットする。未確定なら空文字列。 */
  takeLine(): string {
    if (!this.lineReady) return '';
    const line = this.lineBuffer;
    this.lineBuffer = '';
    this.lineReady = false;
    return line;
  }

  /** BREAK キーが押されたことがあれば消費して true を返す（1回だけ検出）。 */
  consumeBreak(): boolean {
    if (this.breakCount <= 0) return false;
    this.breakCount--;
    return true;
  }

  /**
   * テスト・CLEAR 相当で全状態をリセットする。
   * `capsLock` はキートップの物理モードであり `CLEAR`（変数のリセット）とは
   * 独立した状態のため、意図的にここではリセットしない。
   */
  reset(): void {
    this.pressed.clear();
    this.inkeyBuffer.length = 0;
    this.lineBuffer = '';
    this.lineReady = false;
    this.breakCount = 0;
  }
}
