// RUN/BREAK/LIST ボタンを束ねる src/ui/app.ts の結合テスト。
// 「入力欄の内容が実行されること」「BREAK で無限ループが止まること」
// 「パースエラーが表示されること」を、実際の Interpreter/Runtime を使って確認する。
//
// dumpAscii による比較は test/interpreter.test.ts と同じ流儀：期待する見た目は
// 別の Machine を用意して素直な命令列（PRINT 等）で作り、画面ビットマップ同士を
// 比較する（画面表示用の文字列組み立てロジックを二重に書かない）。

import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/app.ts';
import type { Scheduler } from '../src/ui/runtime.ts';
import { Machine } from '../src/machine/machine.ts';

/** test/runtime.test.ts と同じ、手動で1フレームずつ進められるテスト用スケジューラ。 */
function manualScheduler(): Scheduler & { tick(): void } {
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
  };
}

function buildApp() {
  const machine = new Machine(1);
  const scheduler = manualScheduler();
  let renderCount = 0;
  const app = new App(machine, { render: () => renderCount++ }, scheduler);
  return { app, machine, scheduler, getRenderCount: () => renderCount };
}

describe('App.run: 入力欄の内容が実行される', () => {
  it('RUN したソースが実際に実行され、画面に反映される', () => {
    const { app, machine, scheduler } = buildApp();
    app.run('10 PRINT "OK"');
    scheduler.tick();

    const cmp = new Machine();
    cmp.screen.writeText('OK\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });

  it('2回目の RUN は前回の実行状態を引きずらない（変数がリセットされる）', () => {
    const { app, machine, scheduler } = buildApp();
    app.run('10 A=1\n20 PRINT A');
    scheduler.tick();
    app.run('10 PRINT A');
    scheduler.tick();

    // A は新しい実行では未代入（0）のはず。数値 PRINT は符号用の1桁ぶん
    // 先頭にスペースが付く（正の数の符号位置。number.ts の書式化仕様）。
    const cmp = new Machine();
    cmp.screen.writeText(' 0\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});

describe('App.break: BREAK ボタンで無限ループを止められる', () => {
  it('10 GOTO 10 を BREAK ボタンで止められる', () => {
    const { app, machine, scheduler } = buildApp();
    app.run('10 GOTO 10');

    for (let i = 0; i < 5; i++) {
      scheduler.tick();
      expect(machine).toBeDefined(); // まだ走っている（例外なく tick できる）ことの確認
    }

    app.break();
    scheduler.tick();

    // BREAK IN 10 が画面に出て、これ以上フレームが予約されていない
    // （= 停止した）ことを確認する。
    const cmp = new Machine();
    cmp.screen.writeText('\nBREAK IN 10\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});

describe('App.run: パースエラーが表示される', () => {
  it('構文エラーのあるソースは実行されず、行番号付きでエラーが表示される', () => {
    const { app, machine, scheduler, getRenderCount } = buildApp();
    // FOR に対応する TO が無い、明確な構文エラー。
    app.run('10 FOR I=1');
    // パースエラーは同期的に検出されるので、tick 無しでも表示されているはず。
    expect(getRenderCount()).toBeGreaterThan(0);

    const text = machine.screen.dumpAscii(0, 0, 144, 48);
    const blank = new Machine().screen.dumpAscii(0, 0, 144, 48);
    expect(text).not.toBe(blank);
    // 「?ERROR 10 IN 10」（SYNTAX=10, 行番号10）が表示されているはず。
    const cmp = new Machine();
    cmp.screen.writeText('?ERROR 10 IN 10\n');
    expect(text).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));

    // エラー後に無関係な tick をしても新しい実行が始まったりしない
    // （パース失敗時は Runtime を作らないため）。
    scheduler.tick();
  });
});

describe('App.list: LIST ボタンで現在のプログラムが表示される', () => {
  it('RUN 前は何も起きない', () => {
    const { app, getRenderCount } = buildApp();
    app.list();
    expect(getRenderCount()).toBe(0);
  });

  it('RUN したプログラムを LIST できる', () => {
    const { app, machine, scheduler } = buildApp();
    app.run('10 PRINT "OK"');
    scheduler.tick();
    app.list();

    // LIST の出力は「実行結果(OK)の後ろに、復元されたソース1行が続く」形。
    const cmp = new Machine();
    cmp.screen.writeText('OK\n');
    cmp.screen.writeText('10 PRINT "OK"\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});
