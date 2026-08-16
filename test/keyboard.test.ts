// キーボード（src/machine/keyboard.ts）の単体テスト。
// vitest は environment: 'node' で動いており DOM の `KeyboardEvent` コンストラクタが
// 存在しないため、`Keyboard` が実際に読む `key`/`code` フィールドだけを持つ
// 最小限のオブジェクトを作って `KeyboardEvent` にキャストする
// （`Keyboard` 側は DOM に直接依存しない設計なので、これで実装コードは変更不要）。

import { describe, expect, it } from 'vitest';
import { applyCapsLock, BREAK_KEY, DEFAULT_CAPS_LOCK, Keyboard } from '../src/machine/keyboard.ts';

/** `code` を明示的に空文字列にした擬似 KeyboardEvent を作る（自動テスト用ブラウザの実挙動を模す）。 */
function keyEventNoCode(key: string): KeyboardEvent {
  return { key, code: '' } as KeyboardEvent;
}

function keyEvent(key: string, code: string): KeyboardEvent {
  return { key, code } as KeyboardEvent;
}

describe('Keyboard: INKEY$ バッファ', () => {
  it('keydown を流し込むと inkey() で1文字ずつ取り出せる', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent('A', 'KeyA'));
    kb.handleKeyDown(keyEvent('B', 'KeyB'));
    expect(kb.inkey()).toBe('A');
    expect(kb.inkey()).toBe('B');
    expect(kb.inkey()).toBe(''); // 空なら空文字列
  });

  it('code が空文字列（自動テスト用ブラウザの実挙動）でも key で判定できる', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEventNoCode('X'));
    expect(kb.inkey()).toBe('X');
  });

  it('矢印キーなど1文字でないキーは INKEY$ バッファに積まない', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent('ArrowLeft', 'ArrowLeft'));
    expect(kb.inkey()).toBe('');
  });
});

describe('Keyboard: 押下中キー集合', () => {
  it('keydown で押下中になり、keyup で外れる', () => {
    const kb = new Keyboard();
    const down = keyEvent('A', 'KeyA');
    kb.handleKeyDown(down);
    expect(kb.isPressed('KeyA')).toBe(true);
    kb.handleKeyUp(keyEvent('A', 'KeyA'));
    expect(kb.isPressed('KeyA')).toBe(false);
  });
});

describe('Keyboard: INPUT 行入力', () => {
  it('文字を打ってから Enter で1行確定する', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent('1', 'Digit1'));
    kb.handleKeyDown(keyEvent('2', 'Digit2'));
    expect(kb.isLineReady()).toBe(false);
    kb.handleKeyDown(keyEvent('Enter', 'Enter'));
    expect(kb.isLineReady()).toBe(true);
    expect(kb.takeLine()).toBe('12');
    // 取り出した後はリセットされる。
    expect(kb.isLineReady()).toBe(false);
    expect(kb.takeLine()).toBe('');
  });

  it('Backspace で1文字消せる', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent('A', 'KeyA'));
    kb.handleKeyDown(keyEvent('B', 'KeyB'));
    kb.handleKeyDown(keyEvent('Backspace', 'Backspace'));
    kb.handleKeyDown(keyEvent('Enter', 'Enter'));
    expect(kb.takeLine()).toBe('A');
  });
});

describe('Keyboard: BREAK キー', () => {
  it(`既定の BREAK キー(${BREAK_KEY}) を押すと consumeBreak が true を返す（1回だけ）`, () => {
    const kb = new Keyboard();
    expect(kb.consumeBreak()).toBe(false);
    kb.handleKeyDown(keyEvent(BREAK_KEY, BREAK_KEY));
    expect(kb.consumeBreak()).toBe(true);
    expect(kb.consumeBreak()).toBe(false); // 消費済みなので2回目は false
  });

  it('BREAK キーは INKEY$ バッファに積まれない', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent(BREAK_KEY, BREAK_KEY));
    expect(kb.inkey()).toBe('');
  });
});

describe('Keyboard: CAPS ロック（既定で大文字入力）', () => {
  it('既定値は大文字（DEFAULT_CAPS_LOCK）', () => {
    expect(DEFAULT_CAPS_LOCK).toBe(true);
  });

  it('applyCapsLock: オンなら大文字化、オフならそのまま', () => {
    expect(applyCapsLock('a', true)).toBe('A');
    expect(applyCapsLock('a', false)).toBe('a');
    expect(applyCapsLock('A', true)).toBe('A');
    expect(applyCapsLock('1', true)).toBe('1'); // 英字以外はそのまま
  });

  it('小文字キーを打っても INKEY$/INPUT へは既定で大文字が積まれる', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent('a', 'KeyA'));
    expect(kb.inkey()).toBe('A');
  });

  it('INPUT の行入力も既定で大文字になる', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent('a', 'KeyA'));
    kb.handleKeyDown(keyEvent('b', 'KeyB'));
    kb.handleKeyDown(keyEvent('Enter', 'Enter'));
    expect(kb.takeLine()).toBe('AB');
  });

  it('setCapsLock(false) にすると小文字のまま積まれる', () => {
    const kb = new Keyboard();
    kb.setCapsLock(false);
    expect(kb.isCapsLockOn()).toBe(false);
    kb.handleKeyDown(keyEvent('a', 'KeyA'));
    expect(kb.inkey()).toBe('a');
  });

  it('reset() では CAPS ロック状態は変わらない（物理モードのため CLEAR と独立）', () => {
    const kb = new Keyboard();
    kb.setCapsLock(false);
    kb.reset();
    expect(kb.isCapsLockOn()).toBe(false);
  });
});

describe('Keyboard: reset', () => {
  it('reset() で全状態が初期化される', () => {
    const kb = new Keyboard();
    kb.handleKeyDown(keyEvent('A', 'KeyA'));
    kb.handleKeyDown(keyEvent(BREAK_KEY, BREAK_KEY));
    kb.reset();
    expect(kb.isPressed('KeyA')).toBe(false);
    expect(kb.inkey()).toBe('');
    expect(kb.consumeBreak()).toBe(false);
  });
});
