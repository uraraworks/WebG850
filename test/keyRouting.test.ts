// src/ui/keyRouting.ts の単体テスト。
// 「入力欄にフォーカスがあるときエミュレータへキーが漏れないこと」の判定ロジック本体。
// 実 DOM を組み立てずに `{ tagName }` だけの偽物で検証する（vitest は environment: 'node'）。

import { describe, expect, it } from 'vitest';
import { isFormControlTarget } from '../src/ui/keyRouting.ts';

/** `{ tagName }` だけの偽 DOM 要素を `EventTarget` として扱わせるヘルパ。 */
function fakeTarget(props: Record<string, unknown>): EventTarget {
  return props as unknown as EventTarget;
}

describe('isFormControlTarget', () => {
  it('textarea（プログラム入力欄）は true', () => {
    expect(isFormControlTarget(fakeTarget({ tagName: 'TEXTAREA' }))).toBe(true);
  });

  it('button（RUN/BREAK/LIST ボタン）は true', () => {
    expect(isFormControlTarget(fakeTarget({ tagName: 'BUTTON' }))).toBe(true);
  });

  it('input/select も true', () => {
    expect(isFormControlTarget(fakeTarget({ tagName: 'INPUT' }))).toBe(true);
    expect(isFormControlTarget(fakeTarget({ tagName: 'SELECT' }))).toBe(true);
  });

  it('小文字の tagName でも判定できる', () => {
    expect(isFormControlTarget(fakeTarget({ tagName: 'textarea' }))).toBe(true);
  });

  it('canvas（エミュレータ画面）や body は false', () => {
    expect(isFormControlTarget(fakeTarget({ tagName: 'CANVAS' }))).toBe(false);
    expect(isFormControlTarget(fakeTarget({ tagName: 'BODY' }))).toBe(false);
  });

  it('target が null や tagName を持たないオブジェクトは false', () => {
    expect(isFormControlTarget(null)).toBe(false);
    expect(isFormControlTarget(fakeTarget({}))).toBe(false);
  });
});
