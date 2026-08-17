/**
 * `LibraryStore`（`./types.ts`）の localStorage 実装。キーは `'g850:library'`。
 *
 * 【設計】 `src/ui/memoryStorage.ts`（`LocalStorageByteStorage`）と同じ思想に揃える：
 * 壊れた JSON や quota 例外は握りつぶし、「保存・取り込みに失敗した」程度の実害に
 * 留めて動作は継続する。インタプリタ本体・テストと同様、ここも UI 層（`src/ui/`）
 * だけが localStorage に触れる。
 *
 * 【絶対の制約（権利）】 取り込んだプログラム本体（`LibraryEntry.program`）は
 * ここ（ブラウザの localStorage）にのみ保存され、リポジトリにもサーバにも残らない。
 */

import type { LibraryEntry, LibraryEntryPatch, LibraryStore } from './types.ts';

const DEFAULT_KEY = 'g850:library';

/** `list()` が返す配列の並び順（取り込み日時の昇順＝古い順）を決める比較関数。 */
function byAddedAtAsc(a: LibraryEntry, b: LibraryEntry): number {
  return a.addedAt - b.addedAt;
}

export class LocalStorageLibraryStore implements LibraryStore {
  private entries: LibraryEntry[];

  constructor(private readonly key: string = DEFAULT_KEY) {
    this.entries = this.load();
  }

  private load(): LibraryEntry[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const result: LibraryEntry[] = [];
      for (const item of parsed as unknown[]) {
        const entry = coerceEntry(item);
        if (entry !== null) result.push(entry);
      }
      return result;
    } catch {
      // 壊れたJSON・quota例外等は「保存が無かったこと」として扱う（無言で握りつぶすが、
      // ライブラリ自体は空の状態から動き続けるので実害は「引き継ぎに失敗した」程度に留まる）。
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.entries));
    } catch {
      // quota超過等。永続化を諦めるだけで実行は継続する。
    }
  }

  list(): LibraryEntry[] {
    return [...this.entries].sort(byAddedAtAsc);
  }

  add(entries: readonly LibraryEntry[]): void {
    if (entries.length === 0) return;
    this.entries = [...this.entries, ...entries];
    this.save();
  }

  update(id: string, patch: LibraryEntryPatch): void {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) return;
    const current = this.entries[index];
    if (current === undefined) return;
    const next = [...this.entries];
    next[index] = { ...current, ...patch };
    this.entries = next;
    this.save();
  }

  remove(id: string): void {
    const next = this.entries.filter((e) => e.id !== id);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.save();
  }
}

/** 壊れた・型の合わない要素を弾きつつ `LibraryEntry` へ変換する（`load()` 用）。 */
function coerceEntry(value: unknown): LibraryEntry | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.title !== 'string' ||
    typeof v.note !== 'string' ||
    typeof v.program !== 'string' ||
    v.source !== 'local' ||
    typeof v.addedAt !== 'number'
  ) {
    return null;
  }
  return {
    id: v.id,
    title: v.title,
    note: v.note,
    program: v.program,
    source: 'local',
    addedAt: v.addedAt,
  };
}
