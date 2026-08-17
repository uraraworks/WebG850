// @vitest-environment jsdom
//
// ディスクライブラリ（「棚」）機能（74b5976 で追加）の結合テスト。
//
// 単体テスト（test/importFiles.test.ts / test/libraryStore.test.ts）は各部品が
// 単独で正しいことしか確認していない。「一覧の行をクリックしたら、そのプログラムが
// 本当に ProgramStore に入るか」という結線そのものは一度も検証されていなかった。
// ブラウザでの目視確認は、ペインが非表示で requestAnimationFrame が1回も回らない
// （実測 rAF カウント 0）ため canvas から何も観測できず、確認できなかった。
// だから環境に依存しない形（jsdom + 実際の DirectMode/Machine）でテストとして固定する。
//
// vitest.config.ts が無く既定は environment: 'node' だが、このファイルは DOM
// （document.createElement 等）を組み立てる panel.ts を実際に動かす必要があるため、
// ファイル先頭の `@vitest-environment jsdom` でこのファイルだけ jsdom に切り替える
// （test/keyRoutingIntegration.test.ts / test/directMode.test.ts は DOM を使わないので node のまま）。
//
// クリックは `element.click()` ではなく、実クリックに近い経路で測るため
// pointerdown/mousedown/mouseup/click を dispatchEvent で順に投げる
// （`feedback_dom_churn_swallows_real_clicks.md`：element.click() では再現しない不具合がある）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachLibraryPanel } from '../src/ui/library/panel.ts';
import { importFiles } from '../src/ui/library/importFiles.ts';
import { LocalStorageLibraryStore } from '../src/ui/library/localStorageLibraryStore.ts';
import { DirectMode } from '../src/ui/directMode.ts';
import type { Scheduler } from '../src/ui/runtime.ts';
import { Machine } from '../src/machine/machine.ts';

// test/libraryStore.test.ts と同じ最小限の Storage 互換モック
// （vitest.config.ts が無いため既定 environment は node だが、このファイルは
// jsdom へ切り替えているので実は window.localStorage が使える。それでも他の
// テストファイルとの流儀を揃え、かつテスト間の干渉を避けるため引き続き差し替える）。
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

// test/keyRoutingIntegration.test.ts / test/directMode.test.ts と同じ、手動で
// 1フレームずつ進められるスケジューラ。
function manualScheduler(): Scheduler & { tick(): void; tickAll(max?: number): void } {
  let pending: ((time: number) => void) | null = null;
  return {
    requestFrame(cb) {
      pending = cb;
      return 1;
    },
    cancelFrame() {
      pending = null;
    },
    tick() {
      const cb = pending;
      pending = null;
      cb?.(0);
    },
    tickAll(max = 1000) {
      for (let i = 0; i < max && pending; i++) {
        this.tick();
      }
    },
  };
}

/** 実際の画面と、期待するテキストを書いた別 Machine の画面を全面比較する（directMode.test.ts と同じ流儀）。 */
function expectScreenText(machine: Machine, expected: string): void {
  const cmp = new Machine();
  cmp.screen.writeText(expected);
  expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
}

/** テスト用の自作 BASIC ファイル（第三者作品は使わない：G850/CLAUDE.md の絶対の制約）。 */
function textFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

/** `element.click()` ではなく、実クリックに近い順序で dispatchEvent する。 */
function realClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

function rowByTitle(container: HTMLElement, title: string): HTMLLIElement {
  const rows = Array.from(container.querySelectorAll<HTMLLIElement>('.library-panel__row'));
  const row = rows.find((r) => r.querySelector('.library-panel__row-title')?.textContent === title);
  if (row === undefined) throw new Error(`row not found: ${title}`);
  return row;
}

describe('ディスクライブラリ 結合テスト（File → 一覧 → クリック → ProgramStore）', () => {
  let original: unknown;

  beforeEach(() => {
    original = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = new MockLocalStorage();
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  });

  it('行クリックで ProgramStore へ入り、別の行をクリックすると置き換わる（マージされない）', async () => {
    const programA = '10 PRINT "AAA"\n20 END\n';
    const programB = '10 PRINT "BBB"\n20 GOTO 10\n'; // 無限ループになるが LIST は実行しないので問題ない

    const { entries } = await importFiles([textFile('a.bas', programA), textFile('b.bas', programB)]);
    expect(entries).toHaveLength(2);

    const store = new LocalStorageLibraryStore('test:libint1');
    store.add(entries);

    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);

    // onLoadProgram に渡された値そのものも記録し、末端（ProgramStore）に加えて
    // 経路の途中（コールバック引数）も検証できるようにする。
    const loadedPrograms: string[] = [];
    const container = document.createElement('div');
    attachLibraryPanel(container, {
      store,
      onLoadProgram: (program) => {
        loadedPrograms.push(program);
        dm.loadProgram(program);
      },
    });

    const rows = container.querySelectorAll('.library-panel__row');
    expect(rows).toHaveLength(2);

    // --- A の行をクリック ---
    const rowAMain = rowByTitle(container, 'a').querySelector<HTMLElement>('.library-panel__row-main');
    expect(rowAMain).not.toBeNull();
    realClick(rowAMain!);

    expect(loadedPrograms).toEqual([programA]);

    // 末端：ProgramStore の中身は LIST（RUN ではなく LIST を使う。B は GOTO で無限ループ
    // するため、A/B 共通の検証手段として実行を伴わない LIST を選ぶ）で確認する。
    dm.runCommand('LIST');
    scheduler.tickAll();
    let expected = 'LIST\n10 PRINT "AAA"\n20 END\nOK\n';
    expectScreenText(machine, expected);

    // --- 続けて B の行をクリック：置き換わり、A が残らないこと ---
    const rowBMain = rowByTitle(container, 'b').querySelector<HTMLElement>('.library-panel__row-main');
    expect(rowBMain).not.toBeNull();
    realClick(rowBMain!);

    expect(loadedPrograms).toEqual([programA, programB]);

    dm.runCommand('LIST');
    scheduler.tickAll();
    expected += 'LIST\n10 PRINT "BBB"\n20 GOTO 10\nOK\n';
    expectScreenText(machine, expected);
  });

  it('削除ボタンで行が消え、store.list() からも消える', async () => {
    const { entries } = await importFiles([
      textFile('a.bas', '10 PRINT "A"\n'),
      textFile('b.bas', '10 PRINT "B"\n'),
    ]);
    const store = new LocalStorageLibraryStore('test:libint2');
    store.add(entries);

    const container = document.createElement('div');
    attachLibraryPanel(container, { store, onLoadProgram: () => {} });

    expect(container.querySelectorAll('.library-panel__row')).toHaveLength(2);

    const rowA = rowByTitle(container, 'a');
    const removeButton = rowA.querySelector<HTMLElement>('.library-panel__row-remove');
    expect(removeButton).not.toBeNull();
    realClick(removeButton!);

    expect(container.querySelectorAll('.library-panel__row')).toHaveLength(1);
    expect(store.list().map((e) => e.title)).toEqual(['b']);
  });

  it('メモ欄を編集して change を発火すると store.list() の note に反映される', async () => {
    const { entries } = await importFiles([textFile('a.bas', '10 PRINT "A"\n')]);
    const store = new LocalStorageLibraryStore('test:libint3');
    store.add(entries);

    const container = document.createElement('div');
    attachLibraryPanel(container, { store, onLoadProgram: () => {} });

    const noteInput = container.querySelector<HTMLInputElement>('.library-panel__row-note');
    expect(noteInput).not.toBeNull();
    noteInput!.value = 'お気に入り';
    noteInput!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(store.list()[0]?.note).toBe('お気に入り');
  });

  it('30件取り込むと30行すべてが描画される（到達性）', async () => {
    const files = Array.from({ length: 30 }, (_, i) => textFile(`p${i}.bas`, `10 PRINT ${i}\n`));
    const { entries } = await importFiles(files);
    expect(entries).toHaveLength(30);

    const store = new LocalStorageLibraryStore('test:libint4');
    store.add(entries);

    const container = document.createElement('div');
    attachLibraryPanel(container, { store, onLoadProgram: () => {} });

    const rows = container.querySelectorAll('.library-panel__row');
    expect(rows).toHaveLength(30);

    // 30件目（一番下）が実際に DOM 上に存在すること＝一覧がスクロールで隠れる想定の
    // 件数でも DOM から欠落しない（描画を省略していない）ことを確認する。
    expect(() => rowByTitle(container, 'p29')).not.toThrow();

    // 「一覧が overflow-y: auto 前提でスクロール可能な設計になっていること」について：
    // jsdom はレイアウト（CSS のカスケード適用・ボックスの実測）を計算しないため、
    // list.scrollHeight / list.clientHeight は常に 0 になり、0 > 0 の比較は成立しない
    // （測れないものを測ったふりをしない）。そのためこの項目は
    //   (a) 30行すべてが DOM に存在すること（上で確認済み）
    //   (b) スクロール可能にする CSS ルール自体が存在すること
    // の2点で代替する。(b) はスタイルシートのソースを直接読んで確認する
    // （jsdom 上で <link> 経由の CSS を適用させても計算結果は得られないため、
    // 適用ではなくルールの存在確認に留める）。
    const fs = await import('node:fs');
    const path = await import('node:path');
    const cssPath = path.resolve(import.meta.dirname, '../src/ui/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    const listRuleMatch = css.match(/\.library-panel__list\s*\{[^}]*\}/);
    expect(listRuleMatch).not.toBeNull();
    expect(listRuleMatch![0]).toMatch(/overflow-y:\s*auto/);
  });
});
