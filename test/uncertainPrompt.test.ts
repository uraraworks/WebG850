// src/basic/uncertain.ts に集約したプロンプト（DIRECT_MODE_PROMPT）と
// エラー接頭辞（ERROR_PREFIX_QUESTION_MARK）が、実際に DirectMode の画面表示へ
// 反映されることを確認する結合テスト。
//
// 「uncertain.ts の定数を1箇所変えれば挙動が変わる」ことそのものが集約できている
// 証拠になるため、vi.doMock でモジュールの定数・関数を差し替えたうえで
// DirectMode を動かし、表示が追従することを確認する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** test/directMode.test.ts と同じ、手動で1フレームずつ進められるスケジューラ。 */
function manualScheduler() {
  let pending: ((time: number) => void) | null = null;
  return {
    requestFrame(cb: (time: number) => void) {
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

function keyEvent(key: string): KeyboardEvent {
  return { key, code: '' } as KeyboardEvent;
}

function type(dm: { handleKeyDown(e: KeyboardEvent): void }, text: string): void {
  for (const ch of text) {
    dm.handleKeyDown(keyEvent(ch));
  }
}

function enter(dm: { handleKeyDown(e: KeyboardEvent): void }): void {
  dm.handleKeyDown(keyEvent('Enter'));
}

/**
 * 実際の画面と、期待するテキストを書いた別 Machine の画面を全面比較する
 * （test/directMode.test.ts の `expectScreenText` と同じ流儀。`dumpAscii` は
 * ビットマップの ASCII 表現であり文字列そのものではないため、部分一致
 * （`toContain`）では検証できない）。
 */
async function expectScreenText(machine: InstanceType<typeof import('../src/machine/machine.ts').Machine>, expected: string): Promise<void> {
  const { Machine } = await import('../src/machine/machine.ts');
  const cmp = new Machine();
  cmp.screen.writeText(expected);
  expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
}

describe('uncertain.ts: DIRECT_MODE_PROMPT / ERROR_PREFIX_QUESTION_MARK の集約', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../src/basic/uncertain.ts');
    vi.resetModules();
  });

  it('既定値では入力待ちプロンプトが "OK" で、ERROR 表示の先頭に "?" が付く', async () => {
    const { DirectMode } = await import('../src/ui/directMode.ts');
    const { Machine } = await import('../src/machine/machine.ts');
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);

    type(dm, 'PRINT 1/0');
    enter(dm);
    scheduler.tickAll();

    await expectScreenText(machine, 'PRINT 1/0\n\n?ERROR 21\nOK\n');
  });

  it('DIRECT_MODE_PROMPT を "&" に差し替えると、DirectMode の実際の表示も "&" に変わる', async () => {
    vi.doMock('../src/basic/uncertain.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/basic/uncertain.ts')>();
      return {
        ...actual,
        DIRECT_MODE_PROMPT: '&',
        directModePrompt: () => {
          actual.markUncertainUsed('DIRECT_MODE_PROMPT');
          return '&\n';
        },
      };
    });

    const { DirectMode } = await import('../src/ui/directMode.ts');
    const { Machine } = await import('../src/machine/machine.ts');
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);

    type(dm, 'PRINT 1');
    enter(dm);
    scheduler.tickAll();

    const { formatNumber } = await import('../src/basic/number.ts');
    await expectScreenText(machine, `PRINT 1\n${formatNumber(1)}\n&\n`);
  });

  it('ERROR_PREFIX_QUESTION_MARK を false に差し替えると、ERROR 表示の先頭から "?" が消える', async () => {
    vi.doMock('../src/basic/uncertain.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/basic/uncertain.ts')>();
      return {
        ...actual,
        ERROR_PREFIX_QUESTION_MARK: false,
        formatErrorPrefix: (code: number) => {
          actual.markUncertainUsed('ERROR_PREFIX_QUESTION_MARK');
          return `ERROR ${code}`;
        },
      };
    });

    const { DirectMode } = await import('../src/ui/directMode.ts');
    const { Machine } = await import('../src/machine/machine.ts');
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);

    type(dm, 'PRINT 1/0');
    enter(dm);
    scheduler.tickAll();

    await expectScreenText(machine, 'PRINT 1/0\n\nERROR 21\nOK\n');
  });
});
