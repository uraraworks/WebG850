// LocalStorageByteStorage（src/ui/memoryStorage.ts）のテスト。
//
// vitest.config.ts の environment は 'node' で、Node の組込み `localStorage`
// は永続化ファイル未指定だと動作しない（実測。setItem が例外を投げる）ため、
// ここでは最小限の Storage 互換モックを globalThis.localStorage へ差し込んで検証する。
// ブラウザ実機では window.localStorage がこの役目を果たす。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageByteStorage } from '../src/ui/memoryStorage.ts';

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

describe('LocalStorageByteStorage', () => {
  let original: unknown;

  beforeEach(() => {
    original = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = new MockLocalStorage();
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  });

  it('set した値を get で読み戻せる', () => {
    const storage = new LocalStorageByteStorage('test:key1');
    storage.set(0xfe, 42);
    expect(storage.get(0xfe)).toBe(42);
  });

  it('別インスタンス（再起動相当）でも localStorage 経由で値が引き継がれる', () => {
    const first = new LocalStorageByteStorage('test:key2');
    first.set(0xff, 7);
    const second = new LocalStorageByteStorage('test:key2');
    expect(second.get(0xff)).toBe(7);
  });

  it('未書き込みのアドレスは undefined（MemoryBank側で0埋めする）', () => {
    const storage = new LocalStorageByteStorage('test:key3');
    expect(storage.get(0)).toBeUndefined();
  });

  it('壊れたJSONが入っていても例外を投げず空として扱う', () => {
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage.setItem('test:key4', '{not json');
    const storage = new LocalStorageByteStorage('test:key4');
    expect(storage.get(0)).toBeUndefined();
  });
});
