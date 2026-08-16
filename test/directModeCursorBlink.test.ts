// DirectMode（src/ui/directMode.ts）とカーソル点滅ループ（src/ui/cursorBlinkLoop.ts）の
// 結線を検証する。修正前の不具合：入力待ちの間、時刻が進んでも誰も render() を呼ばず
// カーソルが点滅しなかった（`Runtime` の rAF ループはプログラム実行中だけ回るため）。
//
// vitest は environment: 'node' のため、Runtime 用・BlinkLoop 用それぞれに手動で
// 進められるスケジューラを注入する（test/runtime.test.ts / test/directMode.test.ts と同じ流儀）。

import { describe, expect, it } from 'vitest';
import { DirectMode } from '../src/ui/directMode.ts';
import type { BlinkScheduler } from '../src/ui/cursorBlinkLoop.ts';
import type { Scheduler } from '../src/ui/runtime.ts';
import { Machine } from '../src/machine/machine.ts';
import { CURSOR_BLINK_PERIOD_MS } from '../src/basic/uncertain.ts';

/** test/runtime.test.ts と同じ、手動で1フレームずつ進められる Runtime 用スケジューラ。 */
function manualScheduler(): Scheduler & { tickAll(max?: number): void } {
  let pending: ((time: number) => void) | null = null;
  return {
    requestFrame(cb) {
      pending = cb;
      return 1;
    },
    cancelFrame() {
      pending = null;
    },
    tickAll(max = 1000) {
      for (let i = 0; i < max && pending; i++) {
        const cb = pending;
        pending = null;
        cb?.(0);
      }
    },
  };
}

/** test/cursorBlinkLoop.test.ts と同じ、手動で時刻とタイマー発火を制御できる BlinkScheduler。 */
function manualBlinkScheduler(): BlinkScheduler & {
  tick(): void;
  setNow(t: number): void;
  isRunning(): boolean;
} {
  let cb: (() => void) | null = null;
  let nowMs = 0;
  return {
    setInterval(callback) {
      cb = callback;
      return 1;
    },
    clearInterval() {
      cb = null;
    },
    now: () => nowMs,
    tick() {
      cb?.();
    },
    setNow(t: number) {
      nowMs = t;
    },
    isRunning: () => cb !== null,
  };
}

function buildDirectMode() {
  const machine = new Machine(1);
  const runtimeScheduler = manualScheduler();
  const blinkScheduler = manualBlinkScheduler();
  let renderCount = 0;
  const dm = new DirectMode(
    machine,
    { render: () => renderCount++ },
    runtimeScheduler,
    blinkScheduler,
  );
  return { dm, machine, runtimeScheduler, blinkScheduler, getRenderCount: () => renderCount };
}

describe('DirectMode: 入力待ちの間、カーソル点滅で再描画される', () => {
  it('構築直後（入力待ち）は点滅ループが動いており、時刻を進めると render が呼ばれる', () => {
    const { blinkScheduler, getRenderCount } = buildDirectMode();
    expect(blinkScheduler.isRunning()).toBe(true);

    const before = getRenderCount();
    blinkScheduler.setNow(CURSOR_BLINK_PERIOD_MS);
    blinkScheduler.tick();
    expect(getRenderCount()).toBe(before + 1);
  });

  it('プログラム実行中は点滅ループが止まる（実行中に無駄な再描画をしない）', () => {
    const { dm, runtimeScheduler, blinkScheduler, getRenderCount } = buildDirectMode();

    // 無限ループを実行させて「実行中」状態を作る。
    dm.loadProgram('10 GOTO 10');
    dm.runCommand('RUN');
    expect(dm.isRunning()).toBe(true);
    expect(blinkScheduler.isRunning()).toBe(false); // 点滅タイマーは止まっているはず。

    const before = getRenderCount();
    blinkScheduler.setNow(CURSOR_BLINK_PERIOD_MS * 5);
    blinkScheduler.tick(); // 止まっているので何も起きないはず。
    expect(getRenderCount()).toBe(before);

    // 後始末：BREAK 相当で実行を止める。
    dm.requestBreak();
    runtimeScheduler.tickAll();
  });

  it('プログラム終了後、入力待ちに戻ると点滅ループが再開する', () => {
    const { dm, runtimeScheduler, blinkScheduler, getRenderCount } = buildDirectMode();

    dm.loadProgram('10 PRINT "A"');
    dm.runCommand('RUN');
    runtimeScheduler.tickAll(); // 短いプログラムなので数フレームで終わる。
    expect(dm.isRunning()).toBe(false);
    expect(blinkScheduler.isRunning()).toBe(true); // 点滅が再開しているはず。

    // 再開時（`blinkLoop.start()`）の位相は `now()`（この時点でまだ 0）で記録されるため、
    // そこから確実に位相が反転する奇数倍の時刻まで進める。
    const before = getRenderCount();
    blinkScheduler.setNow(CURSOR_BLINK_PERIOD_MS);
    blinkScheduler.tick();
    expect(getRenderCount()).toBe(before + 1);
  });

  it('pauseCursorBlink/resumeCursorBlink でタブ非表示中は点滅が止まる', () => {
    const { dm, blinkScheduler, getRenderCount } = buildDirectMode();
    expect(blinkScheduler.isRunning()).toBe(true);

    dm.pauseCursorBlink();
    expect(blinkScheduler.isRunning()).toBe(false);

    const before = getRenderCount();
    blinkScheduler.setNow(CURSOR_BLINK_PERIOD_MS * 3);
    blinkScheduler.tick(); // 止まっているので何も起きない。
    expect(getRenderCount()).toBe(before);

    dm.resumeCursorBlink();
    expect(blinkScheduler.isRunning()).toBe(true);
    blinkScheduler.setNow(CURSOR_BLINK_PERIOD_MS * 4);
    blinkScheduler.tick();
    expect(getRenderCount()).toBe(before + 1);
  });
});
