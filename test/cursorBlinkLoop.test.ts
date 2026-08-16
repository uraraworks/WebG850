// src/ui/cursorBlinkLoop.ts の単体テスト。
// 入力待ちの間、時刻ベースの点滅（cursorOverlay.ts）に合わせて再描画が呼ばれることを検証する。
// vitest は environment: 'node' のため `window.setInterval` は無く、`test/runtime.test.ts` と
// 同じ流儀で「手動で1ティックずつ進められる」BlinkScheduler を注入する。

import { describe, expect, it } from 'vitest';
import { CURSOR_BLINK_PERIOD_MS } from '../src/basic/uncertain.ts';
import { CursorBlinkLoop, type BlinkScheduler } from '../src/ui/cursorBlinkLoop.ts';

/** 手動で時刻を進め、`tick()` でタイマー発火を1回シミュレートできるスケジューラ。 */
function manualBlinkScheduler(): BlinkScheduler & {
  tick(): void;
  setNow(t: number): void;
  intervalMs(): number | null;
  isRunning(): boolean;
} {
  let cb: (() => void) | null = null;
  let intervalMs: number | null = null;
  let nowMs = 0;
  return {
    setInterval(callback, ms) {
      cb = callback;
      intervalMs = ms;
      return 1;
    },
    clearInterval() {
      cb = null;
      intervalMs = null;
    },
    now: () => nowMs,
    tick() {
      cb?.();
    },
    setNow(t: number) {
      nowMs = t;
    },
    intervalMs: () => intervalMs,
    isRunning: () => cb !== null,
  };
}

describe('CursorBlinkLoop: 入力待ちの間、時刻に応じて再描画される', () => {
  it('start() 後、位相が切り替わる時刻まで進めて tick すると render が呼ばれる', () => {
    const scheduler = manualBlinkScheduler();
    let renderCount = 0;
    const loop = new CursorBlinkLoop(() => renderCount++, scheduler);

    loop.start();
    expect(renderCount).toBe(0); // start() 自体は描画しない。

    // 半周期進んだだけでは位相はまだ変わらない。
    scheduler.setNow(Math.floor(CURSOR_BLINK_PERIOD_MS / 2));
    scheduler.tick();
    expect(renderCount).toBe(0);

    // 1周期分進めば表示⇔非表示の位相が切り替わる。
    scheduler.setNow(CURSOR_BLINK_PERIOD_MS);
    scheduler.tick();
    expect(renderCount).toBe(1);

    // さらに1周期進めば再び切り替わる。
    scheduler.setNow(CURSOR_BLINK_PERIOD_MS * 2);
    scheduler.tick();
    expect(renderCount).toBe(2);
  });

  it('CURSOR_BLINK_PERIOD_MS をタイマー間隔として使う（値を変えれば点滅速度も変わる）', () => {
    const scheduler = manualBlinkScheduler();
    const loop = new CursorBlinkLoop(() => {}, scheduler);
    loop.start();
    expect(scheduler.intervalMs()).toBe(CURSOR_BLINK_PERIOD_MS);
  });

  it('stop() するとタイマーが解除され、以後 tick しても render は呼ばれない（実行中は動かさない）', () => {
    const scheduler = manualBlinkScheduler();
    let renderCount = 0;
    const loop = new CursorBlinkLoop(() => renderCount++, scheduler);

    loop.start();
    scheduler.setNow(CURSOR_BLINK_PERIOD_MS);
    scheduler.tick();
    expect(renderCount).toBe(1);

    loop.stop();
    expect(scheduler.isRunning()).toBe(false);
    expect(loop.running()).toBe(false);

    // タイマーは解除済みなので、スケジューラを直接叩いても（コールバックが無いので）何も起きない。
    scheduler.tick();
    expect(renderCount).toBe(1);
  });

  it('start() を2回呼んでも二重にタイマーを持たない', () => {
    const scheduler = manualBlinkScheduler();
    const loop = new CursorBlinkLoop(() => {}, scheduler);
    loop.start();
    const firstIntervalCallSeen = scheduler.intervalMs();
    loop.start();
    expect(scheduler.intervalMs()).toBe(firstIntervalCallSeen); // setInterval が再登録されていない目印。
    expect(loop.running()).toBe(true);
  });

  it('stop() を先に呼んでも（未開始でも）例外にならない', () => {
    const scheduler = manualBlinkScheduler();
    const loop = new CursorBlinkLoop(() => {}, scheduler);
    expect(() => loop.stop()).not.toThrow();
    expect(loop.running()).toBe(false);
  });
});
