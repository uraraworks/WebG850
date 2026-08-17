// LocalStorageLibraryStore（src/ui/library/localStorageLibraryStore.ts）のテスト。
//
// test/memoryStorage.test.ts と同じ流儀：vitest.config.ts の environment は 'node'
// で組込み localStorage が使えないため、最小限の Storage 互換モックを
// globalThis.localStorage へ差し込んで検証する。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageLibraryStore } from '../src/ui/library/localStorageLibraryStore.ts';
import type { LibraryEntry } from '../src/ui/library/types.ts';

class MockLocalStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function makeEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: 'id-1',
    title: 'SAMPLE',
    note: '',
    program: '10 PRINT "HI"',
    source: 'local',
    addedAt: 1000,
    ...overrides,
  };
}

describe('LocalStorageLibraryStore', () => {
  let original: unknown;

  beforeEach(() => {
    original = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = new MockLocalStorage();
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  });

  it('localStorage 未使用時は空のリストから始まる', () => {
    const store = new LocalStorageLibraryStore('test:lib1');
    expect(store.list()).toEqual([]);
  });

  it('add した内容を list で読み戻せる', () => {
    const store = new LocalStorageLibraryStore('test:lib2');
    store.add([makeEntry()]);
    expect(store.list()).toEqual([makeEntry()]);
  });

  it('list は addedAt の昇順（古い順）で返す', () => {
    const store = new LocalStorageLibraryStore('test:lib3');
    store.add([makeEntry({ id: 'b', addedAt: 200 }), makeEntry({ id: 'a', addedAt: 100 })]);
    expect(store.list().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('別インスタンス（再起動相当）でも localStorage 経由で値が引き継がれる', () => {
    const first = new LocalStorageLibraryStore('test:lib4');
    first.add([makeEntry()]);
    const second = new LocalStorageLibraryStore('test:lib4');
    expect(second.list()).toEqual([makeEntry()]);
  });

  it('update は指定した id のエントリだけを差し替える', () => {
    const store = new LocalStorageLibraryStore('test:lib5');
    store.add([makeEntry({ id: 'a' }), makeEntry({ id: 'b', title: 'OTHER' })]);
    store.update('a', { note: 'メモ追加' });
    const entries = store.list();
    expect(entries.find((e) => e.id === 'a')?.note).toBe('メモ追加');
    expect(entries.find((e) => e.id === 'b')?.note).toBe('');
  });

  it('update は存在しない id を渡しても例外を投げない（無視する）', () => {
    const store = new LocalStorageLibraryStore('test:lib6');
    store.add([makeEntry({ id: 'a' })]);
    expect(() => store.update('missing', { note: 'x' })).not.toThrow();
    expect(store.list()).toHaveLength(1);
  });

  it('remove は指定した id のエントリだけを取り除く', () => {
    const store = new LocalStorageLibraryStore('test:lib7');
    store.add([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]);
    store.remove('a');
    expect(store.list().map((e) => e.id)).toEqual(['b']);
  });

  it('壊れたJSONが入っていても例外を投げず空として扱う', () => {
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage.setItem(
      'test:lib8',
      '{not json',
    );
    const store = new LocalStorageLibraryStore('test:lib8');
    expect(store.list()).toEqual([]);
  });

  it('配列でないJSONが入っていても例外を投げず空として扱う', () => {
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage.setItem(
      'test:lib9',
      '{"foo":"bar"}',
    );
    const store = new LocalStorageLibraryStore('test:lib9');
    expect(store.list()).toEqual([]);
  });

  it('型の合わない要素が混じっていてもその要素だけ無視する', () => {
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage.setItem(
      'test:lib10',
      JSON.stringify([makeEntry({ id: 'ok' }), { id: 'bad' }]),
    );
    const store = new LocalStorageLibraryStore('test:lib10');
    expect(store.list().map((e) => e.id)).toEqual(['ok']);
  });
});
