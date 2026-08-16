// src/ui/directMode.ts（LCD 上のラインエディタ）の結合テスト。
// vitest は environment: 'node' のため、`Keyboard` テストと同じ流儀で
// `{ key, code }` だけを持つ擬似 `KeyboardEvent` を作って渡す。
//
// 画面の検証は test/app.test.ts と同じ流儀：期待するテキストを別の Machine へ
// `writeText` で書き、ビットマップ（`dumpAscii`）同士を比較する（数値の書式化
// ルールを本テストで再実装せず、`formatNumber` をそのまま使う）。

import { describe, expect, it } from 'vitest';
import { DirectMode } from '../src/ui/directMode.ts';
import type { Scheduler } from '../src/ui/runtime.ts';
import { Machine } from '../src/machine/machine.ts';
import { TEXT_COLS } from '../src/machine/screen.ts';
import { formatNumber } from '../src/basic/number.ts';
import { parseDirectStatements } from '../src/basic/directLine.ts';
import { BasicError, UnsupportedError } from '../src/basic/errors.ts';

/** test/runtime.test.ts / test/app.test.ts と同じ、手動で1フレームずつ進められるスケジューラ。 */
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

function keyEvent(key: string): KeyboardEvent {
  return { key, code: '' } as KeyboardEvent;
}

function buildDirectMode() {
  const machine = new Machine(1);
  const scheduler = manualScheduler();
  let renderCount = 0;
  const dm = new DirectMode(machine, { render: () => renderCount++ }, scheduler);
  return { dm, machine, scheduler, getRenderCount: () => renderCount };
}

/** 複数文字をまとめて打鍵させるヘルパ。 */
function type(dm: DirectMode, text: string): void {
  for (const ch of text) {
    dm.handleKeyDown(keyEvent(ch));
  }
}

function enter(dm: DirectMode): void {
  dm.handleKeyDown(keyEvent('Enter'));
}

function backspace(dm: DirectMode): void {
  dm.handleKeyDown(keyEvent('Backspace'));
}

/** 実際の画面と、期待するテキストを書いた別 Machine の画面を全面比較する。 */
function expectScreenText(machine: Machine, expected: string): void {
  const cmp = new Machine();
  cmp.screen.writeText(expected);
  expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
}

describe('DirectMode: 文字入力とカーソル', () => {
  it('文字を打つと画面に出て、カーソル位置が進む', () => {
    const { dm, machine } = buildDirectMode();
    expect(machine.screen.cursor).toEqual({ col: 0, row: 0 });

    type(dm, 'AB');

    expect(machine.screen.cursor).toEqual({ col: 2, row: 0 });
    expectScreenText(machine, 'AB');
  });

  it('Backspace で1文字消える（画面・カーソルとも1つ戻る）', () => {
    const { dm, machine } = buildDirectMode();
    type(dm, 'AB');
    backspace(dm);

    expect(machine.screen.cursor).toEqual({ col: 1, row: 0 });
    expectScreenText(machine, 'A');
  });

  it('何も打っていない状態での Backspace は何もしない', () => {
    const { dm, machine } = buildDirectMode();
    backspace(dm);
    expect(machine.screen.cursor).toEqual({ col: 0, row: 0 });
    expectScreenText(machine, '');
  });

  it('24桁を超えると次の行へ折り返す', () => {
    const { dm, machine } = buildDirectMode();
    type(dm, 'A'.repeat(TEXT_COLS + 3));
    expect(machine.screen.cursor).toEqual({ col: 3, row: 1 });
    expectScreenText(machine, 'A'.repeat(TEXT_COLS + 3));
  });

  it('折り返した直後の Backspace は前の行の末尾へ戻る', () => {
    const { dm, machine } = buildDirectMode();
    // ちょうど24桁書いた時点で（Screen.writeText の折り返し実装により）
    // カーソルは既に次の行（col:0, row:1）へ進んでいる。
    type(dm, 'A'.repeat(TEXT_COLS));
    expect(machine.screen.cursor).toEqual({ col: 0, row: 1 });
    backspace(dm);
    expect(machine.screen.cursor).toEqual({ col: TEXT_COLS - 1, row: 0 });
    expectScreenText(machine, 'A'.repeat(TEXT_COLS - 1));
  });
});

describe('DirectMode: プログラムの格納・置換・削除', () => {
  it('行番号付きの行を Enter で確定するとプログラムへ格納され、RUN で実行できる', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "HI"');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "HI"\nRUN\nHI\nOK\n');
  });

  it('同じ行番号で再度入力すると置換される', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "FIRST"');
    enter(dm);
    type(dm, '10 PRINT "SECOND"');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "FIRST"\n10 PRINT "SECOND"\nRUN\nSECOND\nOK\n');
  });

  it('行番号だけを入力するとその行が削除される', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "A"');
    enter(dm);
    type(dm, '20 PRINT "B"');
    enter(dm);
    type(dm, '10');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "A"\n20 PRINT "B"\n10\nRUN\nB\nOK\n');
  });
});

describe('DirectMode: ダイレクト実行', () => {
  it('行番号なしの行はダイレクト実行される（PRINT 1+2 → 3）', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, 'PRINT 1+2');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, `PRINT 1+2\n${formatNumber(3)}\nOK\n`);
  });

  it('RUN を打つと格納済みのプログラムが動く', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 FOR I=1 TO 3');
    enter(dm);
    type(dm, '20 PRINT I');
    enter(dm);
    type(dm, '30 NEXT I');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tickAll();

    const nums = [1, 2, 3].map((n) => `${formatNumber(n)}\n`).join('');
    expectScreenText(machine, `10 FOR I=1 TO 3\n20 PRINT I\n30 NEXT I\nRUN\n${nums}OK\n`);
  });

  it('LIST を打つと格納済みのプログラムが表示される', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "X"');
    enter(dm);
    type(dm, 'LIST');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "X"\nLIST\n10 PRINT "X"\nOK\n');
  });

  it('構文エラーの行は既存のエラー表示を出し、プログラムへは格納されない', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 @@@');
    enter(dm);
    scheduler.tickAll();
    type(dm, 'LIST');
    enter(dm);
    scheduler.tickAll();

    // 期待するエラー文言は、本テストで再実装せず既存の parseDirectStatements を
    // 実際に呼んで得る（フォーマットの詳細は directMode.ts の実装に委ねる）。
    let errorLine = '';
    try {
      parseDirectStatements('@@@');
      throw new Error('この BASIC ソースは構文エラーになる想定だったが、ならなかった');
    } catch (e) {
      if (e instanceof BasicError) {
        errorLine = `?ERROR ${e.code} IN 10`;
      } else if (e instanceof UnsupportedError) {
        errorLine = `?UNSUPPORTED ${e.name_} IN 10`;
      } else {
        throw e;
      }
    }

    // 構文エラー行は格納されないので、LIST の結果は空（プログラムが1行も無い）。
    expectScreenText(machine, `10 @@@\n${errorLine}\nLIST\nOK\n`);
  });

  it('NEW を打つとプログラムが消え、その後の RUN は何もしない', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "X"');
    enter(dm);
    type(dm, 'NEW');
    enter(dm);
    scheduler.tickAll();
    type(dm, 'RUN');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "X"\nNEW\nOK\nRUN\nOK\n');
  });

  it('実行中は打鍵がラインエディタに入らない', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 FOR I=1 TO 100000');
    enter(dm);
    type(dm, '20 NEXT I');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tick(); // 1フレームだけ進める（500文/フレームでは終わらないはず）
    expect(dm.isRunning()).toBe(true);

    const beforeCol = machine.screen.cursor.col;
    type(dm, 'ZZZ'); // 実行中なので無視されるはず
    expect(machine.screen.cursor.col).toBe(beforeCol);
  });
});

describe('DirectMode: カーソルは LCD のビットマップを汚さない', () => {
  it('getCursorOverlay() を呼んでも Screen.point() の結果は変化しない', () => {
    const { dm, machine } = buildDirectMode();
    type(dm, 'AB');

    const before = machine.screen.dumpAscii(0, 0, 144, 48);
    const overlay = dm.getCursorOverlay();
    expect(overlay).toEqual({ col: 2, row: 0 });
    const after = machine.screen.dumpAscii(0, 0, 144, 48);

    expect(after).toEqual(before);
  });

  it('実行中は null を返す（プログラム実行中はカーソルを表示しない設計）', () => {
    const { dm, scheduler } = buildDirectMode();
    type(dm, '10 FOR I=1 TO 100000');
    enter(dm);
    type(dm, '20 NEXT I');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tick();
    expect(dm.isRunning()).toBe(true);
    expect(dm.getCursorOverlay()).toBeNull();
  });
});
