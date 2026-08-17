// @vitest-environment jsdom
//
// UI 結線（`src/ui/setupUi.ts`）自体を通す回帰テスト。
//
// 【検出できなかった穴】 953006b でディスクライブラリからの読み込み直後に入力欄
// （`#program-input`）が古いまま残る不具合を直し `test/programInputSync.test.ts` を
// 追加したが、あのテストは `createProgramInputSync` を単体で叩くだけで、
// `src/ui/main.ts`（当時。現 `setupUi.ts`）の実際の結線
//   attachLibraryPanel(libraryPanel, { onLoadProgram: (program) => loadProgramIntoDirectMode(program) })
// を一度も通らない。ここを
//   onLoadProgram: (program) => directMode!.loadProgram(program)
// （不具合当時の姿）へ戻しても `programInputSync.test.ts` を含む既存テストは
// 1件も落ちない（実測済み）。
//
// このテストは `index.html` を実ファイルから読み込んで本物の DOM を組み、
// `setupUi()`（結線そのもの）を呼び、`File` → ディスクライブラリ → 一覧クリック →
// 入力欄 → 「プログラムに取り込む」ボタン → LIST という、利用者が実際に踏む経路を
// 最初から最後まで通す。
//
// jsdom は `<canvas>` の 2D コンテキストを持たない
// （`canvas.getContext('2d')` が `null` を返す。`canvas` npm パッケージ未導入）ため、
// `attachCanvas`（`src/ui/canvas.ts`）が例外を投げる。ここでは「描画結果を検証する」
// のではなく「結線が例外なく通ること」だけが目的なので、`getContext` を最小限の
// スタブへ差し替えるだけに留める（依頼「canvas に依存しないこと」）。
//
// `requestAnimationFrame` も同様の理由（jsdom の rAF は環境依存で信頼できない：
// `feedback_headless_raf_never_runs.md`）で、`DirectMode`/`Runtime` の既定スケジューラ
// （`src/ui/runtime.ts` の `browserScheduler`）だけを `vi.mock` でテスト用の手動
// スケジューラへ差し替える。`setupUi.ts`/`DirectMode` 自身のロジックは一切変えない
// （呼び出し元から見える既定値の中身をテストだけ差し替えている）。
//
// 「プログラムが消えないこと」の検証は `test/libraryIntegration.test.ts` の
// `expectScreenText` と同じ流儀（末端＝実際の `Machine.screen` の `LIST` 出力）で行う。
// `setupUi()` は `Machine` を外へ一切公開しない設計（依頼どおり、`window` 等への
// テスト専用フックは足さない）ため、`src/machine/machine.ts` を `vi.mock` して
// 実際に生成された `Machine` インスタンスをテスト側だけで捕捉する
// （`Machine` のロジックは一切変えず、生成をフックしているだけ）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatNumber } from '../src/basic/number.ts';
import type { Machine as MachineType } from '../src/machine/machine.ts';
import { importFiles } from '../src/ui/library/importFiles.ts';
import { LocalStorageLibraryStore } from '../src/ui/library/localStorageLibraryStore.ts';
import type { Scheduler } from '../src/ui/runtime.ts';

// ── 手動スケジューラ（test/libraryIntegration.test.ts 等と同じ流儀）。
// `vi.mock` のファクトリから参照するため `vi.hoisted` で巻き上げる。
const { scheduler, machineCapture } = vi.hoisted(() => {
  function manualScheduler(): Scheduler & { tick(): void; tickAll(max?: number): void; reset(): void } {
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
      reset() {
        pending = null;
      },
    };
  }
  return {
    scheduler: manualScheduler(),
    // `Machine` の最後の生成インスタンスを捕捉する箱。`setupUi()` は Machine を
    // 1個しか作らないので単一の参照で足りる。
    machineCapture: { current: null as unknown },
  };
});

// `DirectMode`（延いては `setupUi`）の既定スケジューラだけ手動版へ差し替える。
// `Runtime`/`DirectMode` 自身の実装は一切変えない。
vi.mock('../src/ui/runtime.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/runtime.ts')>();
  return { ...actual, browserScheduler: () => scheduler };
});

// カーソル点滅（`window.setInterval`）はテストと無関係な実タイマーを残さないよう
// 何もしないスケジューラへ差し替える（描画内容の検証には使わないため無害）。
vi.mock('../src/ui/cursorBlinkLoop.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/cursorBlinkLoop.ts')>();
  return {
    ...actual,
    browserBlinkScheduler: () => ({
      setInterval: () => 0,
      clearInterval: () => {},
      now: () => Date.now(),
    }),
  };
});

// `setupUi()` が内部で作る `Machine` インスタンスをテスト側だけで捕捉する
// （`Machine` 自体の実装・エクスポートは変えない。生成をフックするだけ）。
vi.mock('../src/machine/machine.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/machine/machine.ts')>();
  class CapturingMachine extends actual.Machine {
    constructor(...args: ConstructorParameters<typeof actual.Machine>) {
      super(...args);
      machineCapture.current = this;
    }
  }
  return { ...actual, Machine: CapturingMachine };
});

/** テスト用の最小限の 2D コンテキストスタブ。描画内容は検証しない（依頼どおり canvas に依存しない）。 */
function createFakeCtx(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    filter: 'none',
    globalAlpha: 1,
    fillRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D;
}

/** `libraryIntegration.test.ts`/`libraryStore.test.ts` と同じ最小限の Storage 互換モック。 */
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

/** `element.click()` ではなく、実クリックに近い順序で dispatchEvent する
 * （`feedback_dom_churn_swallows_real_clicks.md`：element.click() では再現しない不具合がある）。 */
function realClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

function rowByTitle(container: ParentNode, title: string): HTMLLIElement {
  const rows = Array.from(container.querySelectorAll<HTMLLIElement>('.library-panel__row'));
  const row = rows.find((r) => r.querySelector('.library-panel__row-title')?.textContent === title);
  if (row === undefined) throw new Error(`row not found: ${title}`);
  return row;
}

/** `test/libraryIntegration.test.ts` と同じ流儀：実際の画面と期待テキストを全面比較する。 */
function expectScreenText(machine: MachineType, expected: string): void {
  const cmp = new (machine.constructor as new () => MachineType)();
  cmp.screen.writeText(expected);
  expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
}

const INDEX_HTML_PATH = path.resolve(import.meta.dirname, '../index.html');

/** ディスクライブラリへ取り込むテスト用の自作 BASIC（第三者作品は使わない：G850/CLAUDE.md の絶対の制約）。 */
const LIBRARY_FILE_NAME = 'zqxw-lib.bas';
const LIBRARY_TITLE = 'zqxw-lib';
const LIBRARY_PROGRAM_FILE_CONTENT = '10 PRINT "ZQXWVK"\n20 END\n';
/** `ProgramStore.toSource()`（延いては `#program-input`）が返す正規化後の形。行間は `\n`・末尾改行なし。 */
const LIBRARY_PROGRAM_SOURCE = '10 PRINT "ZQXWVK"\n20 END';

describe('UI 結線の回帰テスト（index.html → setupUi() → ディスクライブラリ → 入力欄 → LIST）', () => {
  let originalLocalStorage: unknown;

  beforeEach(async () => {
    vi.resetModules();
    scheduler.reset();
    machineCapture.current = null;

    originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = new MockLocalStorage();

    // `<canvas>` の 2D コンテキストが無い jsdom でも `attachCanvas` が例外を
    // 投げないよう、最小限のスタブへ差し替える（描画内容は検証しない）。
    HTMLCanvasElement.prototype.getContext = ((): CanvasRenderingContext2D => createFakeCtx()) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    // `AudioContext` はブラウザ専用で jsdom に無い。最初のクリック/キー押下で
    // 生成されるだけで音は鳴らさないので、最小限のダミーを立てておく。
    class FakeAudioContext {
      readonly currentTime = 0;
      readonly destination = {};
      createOscillator() {
        return { frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
      }
      createGain() {
        return { gain: { value: 0 }, connect: () => {} };
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    // index.html を実ファイルから読み込んで DOM を組む（マークアップの手書きはしない：
    // id/class を変えたときにテストだけ古いまま通り続けるのを避けるため）。
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
    if (bodyMatch === null) throw new Error('index.html の <body> が見つかりません');
    document.body.innerHTML = bodyMatch[1]!;
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('ライブラリから読み込むと入力欄が同期し、「取り込む」を押してもプログラムが消えない', async () => {
    // ディスクライブラリ（既定キー 'g850:library'）へ事前に1件取り込んでおく
    // （`setupUi()` の中で `new LocalStorageLibraryStore()` が構築される前に
    // localStorage へ入れておく必要がある）。
    const file = new File([LIBRARY_PROGRAM_FILE_CONTENT], LIBRARY_FILE_NAME, { type: 'text/plain' });
    const { entries } = await importFiles([file]);
    expect(entries).toHaveLength(1);
    new LocalStorageLibraryStore().add(entries);

    // 実際の結線を呼ぶ（`main.ts` が読み込まれたら呼ぶのと同じ関数）。
    const { setupUi } = await import('../src/ui/setupUi.ts');
    setupUi();

    const machine = machineCapture.current as MachineType;
    expect(machine).not.toBeNull();

    // setupUi() は最後にサンプルプログラムを RUN する（起動デモ）。`DirectMode.loadProgram`
    // は実行中は no-op なので、まずこれを完了させて入力待ちへ戻す。
    scheduler.tickAll();

    const programInput = document.querySelector<HTMLTextAreaElement>('#program-input')!;
    expect(programInput).not.toBeNull();

    // 「ディスクライブラリ」パネルを開く。
    const libraryToggleButton = document.querySelector<HTMLButtonElement>('#btn-panel-library')!;
    realClick(libraryToggleButton);

    const libraryPanel = document.querySelector<HTMLDivElement>('#library-panel')!;
    const row = rowByTitle(libraryPanel, LIBRARY_TITLE);
    const rowMain = row.querySelector<HTMLElement>('.library-panel__row-main')!;
    expect(rowMain).not.toBeNull();

    // --- 一覧の行をクリック：ライブラリのプログラムを読み込む ---
    realClick(rowMain);

    // 1. 入力欄が読み込んだプログラムへ同期していること
    //    （不具合当時：`onLoadProgram` が `directMode!.loadProgram(program)` 直呼びで
    //    入力欄の同期を素通りしていたため、ここが古いサンプルのまま残っていた）。
    expect(programInput.value).toBe(LIBRARY_PROGRAM_SOURCE);

    // 2. その状態で「プログラムに取り込む」を押してもプログラムが消えないこと。
    //    末端＝実際の LIST 出力で確認する（`libraryIntegration.test.ts` と同じ流儀）。
    //    不具合当時：入力欄が同期されていないため、ここで古いサンプルプログラムの
    //    内容が ProgramStore へ上書きされ、ライブラリから読み込んだプログラムが消えていた。
    const loadProgramButton = document.querySelector<HTMLButtonElement>('#btn-load-program')!;
    realClick(loadProgramButton);

    const listButton = document.querySelector<HTMLButtonElement>('#btn-list')!;
    realClick(listButton);
    scheduler.tickAll();

    const demoNums = [1, 2, 3].map((n) => `${formatNumber(n)}\n`).join('');
    const expectedScreen =
      `RUN\n${demoNums}DONE\nOK\n` + // 起動デモ（サンプルプログラム）の RUN 結果
      `LIST\n${LIBRARY_PROGRAM_SOURCE}\nOK\n`; // ライブラリから読み込んだプログラムの LIST 結果
    expectScreenText(machine, expectedScreen);
  });
});
