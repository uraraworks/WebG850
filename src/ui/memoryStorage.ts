/**
 * `PEEK`/`POKE`（`src/machine/memory.ts`）の永続化ストレージ。ブラウザの
 * `localStorage` を使う。
 *
 * 【設計】 インタプリタ本体・`Machine`・テストは localStorage に一切触れない
 * （依頼指示：「インタプリタ本体が localStorage に直接依存しないこと」）。
 * ここ（`src/ui/`）だけが `ByteStorage` を実装し、`main.ts` から
 * `machine.attachMemoryStorage()` で後から差し込む（`attachAudio` と同じ設計）。
 *
 * 実装は全アドレスを1個の JSON へまとめて1キーに保存する。実在作品の用例では
 * 数バイト（ハイスコア保存）しか使わないため、アドレスごとに別キーへ分ける
 * 必要は無く、`set` のたびに毎回全体を書き直しても負荷にならない。
 */

import type { ByteStorage } from '../machine/memory.ts';

const DEFAULT_KEY = 'g850:memory';

export class LocalStorageByteStorage implements ByteStorage {
  private readonly cache: Record<number, number>;

  constructor(private readonly key: string = DEFAULT_KEY) {
    this.cache = this.load();
  }

  private load(): Record<number, number> {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') return {};
      const result: Record<number, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const addr = Number(k);
        if (Number.isFinite(addr) && typeof v === 'number') {
          result[addr] = v;
        }
      }
      return result;
    } catch {
      // 壊れたJSON・quota例外等は「保存が無かったこと」として扱う（無言で握りつぶすが、
      // PEEK/POKE 自体は動き続けるので実害は「引き継ぎに失敗した」程度に留まる）。
      return {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.cache));
    } catch {
      // quota超過等。永続化を諦めるだけで実行は継続する。
    }
  }

  get(addr: number): number | undefined {
    return this.cache[addr];
  }

  set(addr: number, value: number): void {
    this.cache[addr] = value;
    this.save();
  }
}
