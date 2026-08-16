/**
 * `PEEK`/`POKE` が読み書きする「メモリ」。
 *
 * 【重要】 実機のメモリマップは再現しない（ROM を持たないため不可能）。
 * 実在作品の使われ方を調べた結果、ゼロページ末尾数バイトを「電源を切っても
 * 消えない小さなメモリ」としてハイスコア保存に使うだけの用例しか無かったため、
 * ここは単なる読み書き可能なバイト配列として実装する。詳細な根拠は
 * `src/basic/uncertain.ts`（`MEMORY_NOT_ROM_BACKED_NOTE` 以下）を参照。
 *
 * 永続化はここでは行わない。`ByteStorage` を外から注入できる形にしてあり、
 * 既定は揮発性の `InMemoryByteStorage`。ブラウザでの永続化（localStorage）は
 * `src/ui/` 側が `MemoryBank.attachStorage` で差し込む（`Machine.attachAudio`
 * と同じ「後から接続する」設計）。インタプリタ本体・テストは localStorage に
 * 触れないため、Node/テスト環境でも問題なく動く。
 */

import { truncateMemoryByte, wrapMemoryAddress } from '../basic/uncertain.ts';

/** 1バイト単位の読み書きインタフェース。永続化の実体はこれを満たせばよい。 */
export interface ByteStorage {
  /** 未書き込みのアドレスは `undefined` を返すこと（0 埋めは呼び出し側が行う）。 */
  get(addr: number): number | undefined;
  set(addr: number, value: number): void;
}

/** 既定の揮発性実装。プロセス（タブ）が生きている間だけ保持する。 */
export class InMemoryByteStorage implements ByteStorage {
  private readonly bytes = new Map<number, number>();

  get(addr: number): number | undefined {
    return this.bytes.get(addr);
  }

  set(addr: number, value: number): void {
    this.bytes.set(addr, value);
  }
}

/**
 * `PEEK(<アドレス>)` / `POKE <アドレス>,<バイト>[,<バイト>……]` の実体。
 *
 * アドレスは 0〜65535（16bit）に折り返し、バイト値は下位8bitへ切り詰める
 * （どちらも `uncertain.ts` 参照）。未書き込みのアドレスを読むと 0 を返す
 * （実機のROM/BIOSワークエリアの値を再現するわけではない）。
 */
export class MemoryBank {
  private storage: ByteStorage;

  constructor(storage: ByteStorage = new InMemoryByteStorage()) {
    this.storage = storage;
  }

  /**
   * ストレージを差し替える（`Machine.attachAudio` と同じ「後から接続する」設計）。
   * 差し替え前に書かれていた値は新ストレージには引き継がれない
   * （引き継ぎが必要ならこのメソッドを呼ぶ側で移し替えること）。
   */
  attachStorage(storage: ByteStorage): void {
    this.storage = storage;
  }

  peek(addr: number): number {
    const a = wrapMemoryAddress(addr);
    return this.storage.get(a) ?? 0;
  }

  /** `POKE <addr>,<v1>[,<v2>…]` 相当。addr を起点に連続したアドレスへ順に書き込む。 */
  poke(addr: number, values: readonly number[]): void {
    const start = wrapMemoryAddress(addr);
    values.forEach((v, i) => {
      const a = wrapMemoryAddress(start + i);
      this.storage.set(a, truncateMemoryByte(v));
    });
  }
}
