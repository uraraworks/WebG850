import { describe, expect, it } from 'vitest';
import type { ByteStorage } from '../src/machine/memory.ts';
import { InMemoryByteStorage, MemoryBank } from '../src/machine/memory.ts';

describe('MemoryBank', () => {
  it('未書き込みのアドレスは0を返す（実機メモリマップは再現しない）', () => {
    const mem = new MemoryBank();
    expect(mem.peek(0)).toBe(0);
    expect(mem.peek(65535)).toBe(0);
  });

  it('POKE→PEEK の往復ができる', () => {
    const mem = new MemoryBank();
    mem.poke(0xfe, [10]);
    expect(mem.peek(0xfe)).toBe(10);
  });

  it('POKE は1文で複数バイトを連続アドレスへ書き込める', () => {
    const mem = new MemoryBank();
    mem.poke(0xfe, [1, 2, 3]);
    expect(mem.peek(0xfe)).toBe(1);
    expect(mem.peek(0xff)).toBe(2);
    expect(mem.peek(0x100)).toBe(3);
  });

  it('バイト値は下位8bitへ切り詰められる（0〜255）', () => {
    const mem = new MemoryBank();
    mem.poke(0, [256]);
    expect(mem.peek(0)).toBe(0);
    mem.poke(1, [-1]);
    expect(mem.peek(1)).toBe(255);
    mem.poke(2, [300]);
    expect(mem.peek(2)).toBe(300 & 0xff);
  });

  it('アドレスは16bitへ折り返す', () => {
    const mem = new MemoryBank();
    mem.poke(65536, [7]);
    expect(mem.peek(0)).toBe(7);
    mem.poke(-1, [9]);
    expect(mem.peek(65535)).toBe(9);
  });

  it('注入したストレージへ実際に書かれる（永続化の差し込みが効くことの確認）', () => {
    const written: Array<[number, number]> = [];
    const storage: ByteStorage = {
      get: () => undefined,
      set: (addr, value) => {
        written.push([addr, value]);
      },
    };
    const mem = new MemoryBank(storage);
    mem.poke(0xf5, [1, 2]);
    expect(written).toEqual([
      [0xf5, 1],
      [0xf6, 2],
    ]);
  });

  it('attachStorage で後からストレージを差し替えられる', () => {
    const custom = new InMemoryByteStorage();
    const mem = new MemoryBank();
    mem.poke(0, [1]);
    mem.attachStorage(custom);
    // 差し替え前の値は引き継がれない設計。
    expect(mem.peek(0)).toBe(0);
    mem.poke(0, [42]);
    expect(custom.get(0)).toBe(42);
  });
});
