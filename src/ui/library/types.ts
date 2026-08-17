/**
 * ディスクライブラリ（「手元の棚」）機能の型定義。
 *
 * 【判断した点・理由】 今回実装するのは「手元の棚」（ユーザーが取り込んだファイル）
 * のみだが、将来「同梱サンプル棚」「URL 取得」を足す前提で `source` をユニオン型に
 * しておく（依頼どおり）。`LibraryStore` もインタフェースにして、将来
 * IndexedDB 実装や同梱サンプル用の読み取り専用実装へ差し替えられるようにする。
 */

/**
 * ライブラリに並ぶ1件のプログラム。
 *
 * 【絶対の制約（権利）】 `program` はブラウザの localStorage にのみ保存され、
 * リポジトリにもサーバにも一切残らない（`localStorageLibraryStore.ts` 参照）。
 */
export interface LibraryEntry {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly program: string;
  /**
   * 取り込み経路。現状は手元ファイルの `'local'` のみ。
   * 将来 `'bundled'`（同梱サンプル）・`'url'`（URL 取得）を追加する前提。
   */
  readonly source: 'local';
  readonly addedAt: number;
}

/** `LibraryEntry` の一部を書き換えるための差分（`update` 用）。 */
export type LibraryEntryPatch = Partial<Pick<LibraryEntry, 'title' | 'note' | 'program'>>;

/**
 * ライブラリの永続化ストアが満たすべきインタフェース。
 *
 * 【判断した点・理由】 現状の実装は `localStorageLibraryStore.ts`（localStorage）
 * のみだが、インタフェースを切ることで将来「同梱サンプル棚」（読み取り専用）や
 * 「URL 取得」用の別実装へ差し替えられるようにする（依頼どおり）。
 */
export interface LibraryStore {
  list(): LibraryEntry[];
  add(entries: readonly LibraryEntry[]): void;
  update(id: string, patch: LibraryEntryPatch): void;
  remove(id: string): void;
}
