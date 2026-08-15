// 実行ループ（src/ui/runtime.ts）の結合テスト。
// vitest は environment: 'node' で `requestAnimationFrame` が無いため、
// `Scheduler` インタフェースへ差し替えたテスト用スケジューラ（手動で1フレームずつ
// 進められるもの）を注入する。docs/design/phase1_runtime.md「中断と再開」節、
// BREAK キーでの停止を実プログラムで確認する。

import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/basic/interpreter.ts';
import { parseProgram } from '../src/basic/parser.ts';
import { Keyboard } from '../src/machine/keyboard.ts';
import { Machine } from '../src/machine/machine.ts';
import { Runtime, STEPS_PER_FRAME, type Scheduler } from '../src/ui/runtime.ts';

/** テスト用スケジューラ。`requestFrame` は実行せず貯めておき、`tick()` で1フレームぶん手動実行する。 */
function manualScheduler(): Scheduler & { tick(): void; pendingCount(): number } {
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
    pendingCount() {
      return pending ? 1 : 0;
    },
  };
}

function buildRuntime(source: string) {
  const program = parseProgram(source);
  const machine = new Machine(1);
  const interpreter = new Interpreter(program, machine, {});
  const scheduler = manualScheduler();
  let renderCount = 0;
  let ended = false;
  const runtime = new Runtime(
    interpreter,
    machine.keyboard,
    {
      render: () => {
        renderCount++;
      },
      onEnd: () => {
        ended = true;
      },
    },
    scheduler,
  );
  return {
    runtime,
    scheduler,
    machine,
    interpreter,
    getRenderCount: () => renderCount,
    isEnded: () => ended,
  };
}

describe('Runtime: 通常終了', () => {
  it('短いプログラムは数フレームで end に到達し、画面出力が反映される', () => {
    const { runtime, scheduler, machine, getRenderCount, isEnded } = buildRuntime(
      '10 FOR I=1 TO 3\n20 PRINT I\n30 NEXT I',
    );
    runtime.start();
    // STEPS_PER_FRAME が十分大きいため、この程度のループなら1フレームで終わる。
    scheduler.tick();
    expect(isEnded()).toBe(true);
    expect(getRenderCount()).toBeGreaterThan(0);
    // カーソルが動いている＝PRINTが実行された証拠。
    expect(machine.screen.cursor.row).toBeGreaterThan(0);
  });

  it('frameCount で「何フレーム回ったか」を数えられる', () => {
    const { runtime, scheduler } = buildRuntime('10 PRINT "A"');
    expect(runtime.frameCount).toBe(0);
    runtime.start();
    scheduler.tick();
    expect(runtime.frameCount).toBe(1);
  });
});

describe('Runtime: BREAK キーで停止', () => {
  it('無限ループのプログラムを BREAK キーで実際に止められる', () => {
    // 10 GOTO 10 は無限ループ。BREAK が効かなければ tick() がフレーム予算を
    // 使い切って次フレームを予約し続けるだけで、テストは無限には停止しない
    // （STEPS_PER_FRAME 分だけ回ってから 'yield' で1フレームが終わる設計のため）。
    const { runtime, scheduler, machine, isEnded } = buildRuntime('10 GOTO 10');
    runtime.start();

    // 何フレームか回しても終わらないことを確認（無限ループが実際に無限であることの確認）。
    for (let i = 0; i < 5; i++) {
      scheduler.tick();
      expect(isEnded()).toBe(false);
    }

    // BREAK キーを押す。
    machine.keyboard.handleKeyDown({ key: 'Escape', code: 'Escape' } as KeyboardEvent);
    scheduler.tick();

    expect(isEnded()).toBe(true);
    // 画面に BREAK IN <行番号> が出る（interpreter.ts の haltWithMessage）。
    // 24桁×6行のうち、最終行付近に文字が書かれているはず（厳密な文字比較はしない）。
  });

  it('BREAK 未消費の場合は無限ループが止まらない（対照確認）', () => {
    const { runtime, scheduler, isEnded } = buildRuntime('10 GOTO 10');
    runtime.start();
    for (let i = 0; i < 10; i++) {
      scheduler.tick();
    }
    expect(isEnded()).toBe(false);
    runtime.stop();
  });
});

describe('Runtime: STEPS_PER_FRAME で1フレームの実行量を区切る', () => {
  it('STEPS_PER_FRAME 行より長いループは複数フレームに分かれる', () => {
    const lineCount = STEPS_PER_FRAME * 2 + 10;
    // 各 FOR 反復が1「行」の yield を消費するので、十分な回数ループさせる。
    const { runtime, scheduler, isEnded } = buildRuntime(`10 FOR I=1 TO ${lineCount}\n20 NEXT I`);
    runtime.start();
    scheduler.tick();
    expect(isEnded()).toBe(false); // 1フレームでは終わらない
    let frames = 1;
    while (!isEnded() && frames < 20) {
      scheduler.tick();
      frames++;
    }
    expect(isEnded()).toBe(true);
    expect(frames).toBeGreaterThan(1);
  });
});
