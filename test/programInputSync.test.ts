// プログラム入力欄（`#program-input`）と `DirectMode`（`ProgramStore`）の同期の
// 回帰テスト。
//
// 不具合：ディスクライブラリの一覧からプログラムを選ぶと `LIST` には正しく
// 反映されるのに、「編集」パネルの入力欄が古い内容のまま残っていた。
// `DirectMode.loadProgram()` は `ProgramStore.clear()` してから取り込む
// （CLOAD 相当の全置換）ため、古い内容が残った入力欄で「プログラムに取り込む」を
// 押すと、ライブラリから読み込んだプログラムが消えてしまう（データ消失）。
//
// `src/ui/main.ts` は DOM 全体を結線する大きな関数でテストから直接叩けないため、
// 同期ロジックだけを切り出した `src/ui/programInputSync.ts` の `createProgramInputSync`
// を対象に、実際の `DirectMode`/`Machine` を使って検証する
// （`test/libraryIntegration.test.ts` と同じ流儀：ダミーではなく本物の
// `DirectMode` を動かして末端の `LIST` 出力まで確認する）。

import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine/machine.ts';
import { DirectMode } from '../src/ui/directMode.ts';
import { createProgramInputSync, type ProgramInputAdapter } from '../src/ui/programInputSync.ts';
import type { Scheduler } from '../src/ui/runtime.ts';

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

/** `<textarea>` を持たない、テスト用の最小限の入力欄アダプタ。 */
function fakeInput(initial = ''): ProgramInputAdapter & { value: string } {
  return {
    value: initial,
    getValue(): string {
      return this.value;
    },
    setValue(v: string): void {
      this.value = v;
    },
  };
}

describe('入力欄とProgramStoreの同期（programInputSync）', () => {
  it('本命の回帰テスト：ライブラリ読み込み相当のloadProgramIntoDirectModeで入力欄が更新され、その状態で取り込んでもプログラムが壊れない', () => {
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);
    const input = fakeInput('古い内容が残っている入力欄');

    const { loadProgramIntoDirectMode } = createProgramInputSync(dm, input);

    // ディスクライブラリからプログラムを読み込んだ状況を再現する。
    const libraryProgram = '10 PRINT "AAA"\n20 END\n';
    loadProgramIntoDirectMode(libraryProgram);

    // 修正前は input.value が古い内容のままだった（本命の回帰）。
    expect(input.value).toBe('10 PRINT "AAA"\n20 END');

    // その状態で「プログラムに取り込む」を押しても、読み込んだプログラムが消えない
    // （＝実害の再現）：もう一度 loadProgramIntoDirectMode(input.value) を呼ぶのが
    // 「取り込む」ボタンの実際の配線（`main.ts` 参照）。
    loadProgramIntoDirectMode(input.value);

    dm.runCommand('LIST');
    scheduler.tickAll();
    expectScreenText(machine, 'LIST\n10 PRINT "AAA"\n20 END\nOK\n');
  });

  it('LCD側の行編集がsyncProgramInputIfUntouchedで入力欄へ反映される（編集パネルを開いたとき相当）', () => {
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);
    const input = fakeInput('');

    const { loadProgramIntoDirectMode, syncProgramInputIfUntouched } = createProgramInputSync(dm, input);
    loadProgramIntoDirectMode('10 PRINT "A"\n');
    expect(input.value).toBe('10 PRINT "A"');

    // LCD 上で行を打って編集する（commitNumberedLine 経由。入力欄からは見えない）。
    dm.runCommand('20 PRINT "B"');
    scheduler.tickAll();

    // まだ同期していないので入力欄は古いまま。
    expect(input.value).toBe('10 PRINT "A"');

    // 「編集」パネルを開いた相当の呼び出し。
    syncProgramInputIfUntouched();
    expect(input.value).toBe('10 PRINT "A"\n20 PRINT "B"');
  });

  it('入力欄に未取り込みの編集があるときはsyncProgramInputIfUntouchedで上書きされない', () => {
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);
    const input = fakeInput('');

    const { loadProgramIntoDirectMode, syncProgramInputIfUntouched } = createProgramInputSync(dm, input);
    loadProgramIntoDirectMode('10 PRINT "A"\n');

    // 利用者が入力欄を書きかけている（まだ「取り込む」を押していない）。
    input.value = '10 PRINT "A"\n20 PRINT "書きかけ"';

    // LCD 側でも別の編集が起きていたとしても、
    dm.runCommand('30 PRINT "C"');
    scheduler.tickAll();

    // 未取り込みの編集があるので、パネルを開き直しても上書きされない。
    syncProgramInputIfUntouched();
    expect(input.value).toBe('10 PRINT "A"\n20 PRINT "書きかけ"');
  });

  it('起動時のサンプル投入相当でも入力欄が初期状態から食い違わない', () => {
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const dm = new DirectMode(machine, { render: () => {} }, scheduler);
    const input = fakeInput('');

    const { loadProgramIntoDirectMode, syncProgramInputIfUntouched } = createProgramInputSync(dm, input);
    const sample = '10 FOR I=1 TO 3\n20 PRINT I\n30 NEXT I\n40 PRINT "DONE"';
    loadProgramIntoDirectMode(sample);

    expect(input.value).toBe(sample);
    // 直後に編集パネルを開いても（未取り込み編集は無いので）食い違わない。
    syncProgramInputIfUntouched();
    expect(input.value).toBe(sample);
  });
});
