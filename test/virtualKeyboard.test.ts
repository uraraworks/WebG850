// src/ui/virtualKeyboard.ts の単体テスト。
// DOM は組み立てず（vitest は environment: 'node'）、`pressVirtualKey` を直接呼んで
// 実際の Machine/DirectMode への効果を検証する（test/directMode.test.ts と同じ流儀）。

import { describe, expect, it } from 'vitest';
import { DirectMode } from '../src/ui/directMode.ts';
import type { Scheduler } from '../src/ui/runtime.ts';
import { Machine } from '../src/machine/machine.ts';
import {
  pressVirtualKey,
  VIRTUAL_KEYBOARD_ROWS,
  type VirtualKeyAction,
} from '../src/ui/virtualKeyboard.ts';

function manualScheduler(): Scheduler {
  return {
    requestFrame() {
      return 1;
    },
    cancelFrame() {},
  };
}

function buildCtx() {
  const machine = new Machine(1);
  let renderCount = 0;
  const unsupportedNotices: string[] = [];
  const dm = new DirectMode(
    machine,
    {
      render: () => renderCount++,
      notifyUnsupported: (name) => unsupportedNotices.push(name),
    },
    manualScheduler(),
  );
  return {
    machine,
    directMode: dm,
    render: () => renderCount++,
    getRenderCount: () => renderCount,
    getUnsupportedNotices: () => unsupportedNotices,
  };
}

/** 現在のカーソル手前のテキストと突き合わせるため、画面全体を別 Machine で組んで比較する。 */
function expectScreenText(machine: Machine, text: string): void {
  const cmp = new Machine();
  cmp.screen.writeText(text);
  expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
}

/** ラベルから該当キーの action を探す（データ定義の回帰確認に使う）。 */
function findAction(label: string): VirtualKeyAction {
  for (const row of VIRTUAL_KEYBOARD_ROWS) {
    for (const def of row) {
      if (def.label === label) return def.action;
    }
  }
  throw new Error(`キー "${label}" が見つかりません`);
}

describe('pressVirtualKey', () => {
  it('文字キー：CAPS が既定(大文字)のとき大文字で入る', () => {
    const ctx = buildCtx();
    pressVirtualKey(ctx, { type: 'char', key: 'q' });
    expectScreenText(ctx.machine, 'Q');
  });

  it('文字キー：CAPS を切り替えた後は小文字で入る', () => {
    const ctx = buildCtx();
    pressVirtualKey(ctx, { type: 'capsToggle' });
    expect(ctx.machine.keyboard.isCapsLockOn()).toBe(false);
    pressVirtualKey(ctx, { type: 'char', key: 'q' });
    expectScreenText(ctx.machine, 'q');
  });

  it('text キー（関数名ショートカット）は CAPS 状態に関わらず固定表記で入る', () => {
    const ctx = buildCtx();
    pressVirtualKey(ctx, { type: 'capsToggle' }); // 小文字モードへ
    pressVirtualKey(ctx, { type: 'text', text: 'SIN(' });
    expectScreenText(ctx.machine, 'SIN(');
  });

  it('ENTER キーで行が確定する（PRO モードで行番号なしの PRINT はダイレクト実行される）', () => {
    const ctx = buildCtx();
    for (const ch of 'PRINT 1') {
      pressVirtualKey(ctx, { type: 'char', key: ch });
    }
    pressVirtualKey(ctx, { type: 'enter' });
    // 実行完了まで待つ必要は無い（manualScheduler は requestFrame を呼ぶだけで
    // tick しないため、Runtime は開始直後の状態のまま。ここでは「無反応で
    // 落ちない」ことと入力エコーの確認のみを見る）。
    expect(ctx.machine.screen.dumpAscii(0, 0, 144, 8)).not.toBe(new Machine().screen.dumpAscii(0, 0, 144, 8));
  });

  it('BS キーで直前の1文字が消える', () => {
    const ctx = buildCtx();
    pressVirtualKey(ctx, { type: 'char', key: 'a' });
    pressVirtualKey(ctx, { type: 'backspace' });
    expectScreenText(ctx.machine, '');
  });

  it('CAPS インジケータ相当：capsToggle は setCapsLock を反転させる', () => {
    const ctx = buildCtx();
    expect(ctx.machine.keyboard.isCapsLockOn()).toBe(true);
    pressVirtualKey(ctx, { type: 'capsToggle' });
    expect(ctx.machine.keyboard.isCapsLockOn()).toBe(false);
    pressVirtualKey(ctx, { type: 'capsToggle' });
    expect(ctx.machine.keyboard.isCapsLockOn()).toBe(true);
  });

  it('BASIC キー（modeToggle）は PRO/RUN を切り替える', () => {
    const ctx = buildCtx();
    expect(ctx.directMode.getMode()).toBe('PRO');
    pressVirtualKey(ctx, { type: 'modeToggle' });
    expect(ctx.directMode.getMode()).toBe('RUN');
  });

  it('未実装キー：画面には何も打ち込まず、machine に記録が残り、通知が飛ぶ', () => {
    const ctx = buildCtx();
    pressVirtualKey(ctx, { type: 'unsupported', name: 'TEXT' });
    // 【直した点・理由】 以前は `?UNSUPPORTED TEXT` をラインへ打ち込んでいたが、
    // それだと編集中の行の内容が壊れてしまう（下の「編集中の行を壊さない」テスト参照）。
    // 画面（＝編集中の行）は一切変えず、記録と通知だけを行うよう変更した。
    expectScreenText(ctx.machine, '');
    expect(ctx.machine.getUnimplementedReport()).toEqual([{ name: 'TEXT', count: 1 }]);
    expect(ctx.getUnsupportedNotices()).toEqual(['TEXT']);
  });

  it('未実装キーを複数回押すと踏んだ回数が増え、通知も都度飛ぶ', () => {
    const ctx = buildCtx();
    pressVirtualKey(ctx, { type: 'unsupported', name: 'MDF' });
    pressVirtualKey(ctx, { type: 'unsupported', name: 'MDF' });
    expect(ctx.machine.getUnimplementedReport()).toEqual([{ name: 'MDF', count: 2 }]);
    expect(ctx.getUnsupportedNotices()).toEqual(['MDF', 'MDF']);
  });

  it('編集中の行を壊さない：未実装キーを押しても入力中の行の内容は変わらない', () => {
    const ctx = buildCtx();
    // 「10 PRINT "A」まで打っている途中で未実装キー（2ndF 等）を押しても、
    // 編集中の行が `?UNSUPPORTED 2ndF` 等で汚染されてはならない
    // （依頼「未実装キーが入力中の行を壊す」の再発防止）。
    for (const ch of '10 PRINT "A') {
      pressVirtualKey(ctx, { type: 'char', key: ch });
    }
    pressVirtualKey(ctx, { type: 'unsupported', name: '2ndF' });
    expectScreenText(ctx.machine, '10 PRINT "A');
    expect(ctx.machine.getUnimplementedReport()).toEqual([{ name: '2ndF', count: 1 }]);
    expect(ctx.getUnsupportedNotices()).toEqual(['2ndF']);
  });

  it('データ定義：写真から確定した主要キーが全て揃っている', () => {
    for (const label of ['BASIC', 'ON', 'CAPS', 'ENTER', 'BS', 'SPACE', 'sin', 'CLS']) {
      expect(() => findAction(label)).not.toThrow();
    }
  });

  it('データ定義：未確定のキーは unsupported として記録されている', () => {
    for (const label of ['TEXT', 'CONST', 'ANS', 'OFF', '2ndF', 'カナ', 'MDF', 'SHIFT', 'TAB']) {
      expect(findAction(label)).toEqual({ type: 'unsupported', name: expect.any(String) });
    }
  });
});
