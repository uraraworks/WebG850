// ui/main.ts が組む「window keydown → isFormControlTarget で分岐 → machine.keyboard」
// という配線そのものを、実際の App/Runtime/Interpreter を使って結合テストする。
//
// 依頼「3. キー入力の行き先を分離する」の受け入れ条件（両方とも実測すること）：
//   - 入力欄（textarea）にフォーカスがあるときに打った文字は、エミュレータの
//     キーバッファへ漏れないこと
//   - INPUT 待ちのときはキーがちゃんとエミュレータへ届くこと

import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/app.ts';
import { isFormControlTarget } from '../src/ui/keyRouting.ts';
import type { Scheduler } from '../src/ui/runtime.ts';
import { Machine } from '../src/machine/machine.ts';

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

/** `main.ts` の `window.addEventListener('keydown', ...)` と同じ配線を再現する。 */
function makeKeydownHandler(machine: Machine) {
  return (e: KeyboardEvent): void => {
    if (isFormControlTarget(e.target)) return;
    machine.keyboard.handleKeyDown(e);
  };
}

/** `{ tagName }` だけの偽 DOM 要素を `EventTarget` として扱わせるヘルパ。 */
function fakeTarget(tagName: string): EventTarget {
  return { tagName } as unknown as EventTarget;
}

/** `target` 付きの `KeyboardEvent` 相当を作る（vitest は environment: 'node' のため自前で組む）。 */
function keyEvent(key: string, code: string, target: EventTarget | null): KeyboardEvent {
  return { key, code, target } as unknown as KeyboardEvent;
}

describe('キー入力の行き先分離（main.ts の配線を再現した結合テスト）', () => {
  it('textarea にフォーカスがあるときの打鍵は machine.keyboard へ届かない', () => {
    const machine = new Machine(1);
    const onKeydown = makeKeydownHandler(machine);
    const textarea = fakeTarget('TEXTAREA');

    for (const ch of 'ABC') {
      onKeydown(keyEvent(ch, `Key${ch}`, textarea));
    }

    // INKEY$ バッファにも INPUT の行バッファにも一切積まれていないこと。
    expect(machine.keyboard.inkey()).toBe('');
    expect(machine.keyboard.isLineReady()).toBe(false);
  });

  it('フォーム部品にフォーカスが無いときの打鍵は machine.keyboard へ届く（INPUT 待ちの再開含む）', () => {
    const machine = new Machine(1);
    const scheduler = manualScheduler();
    const app = new App(machine, { render: () => {} }, scheduler);
    const onKeydown = makeKeydownHandler(machine);
    // フォーム部品ではないターゲット（実運用では #screen canvas 相当）。
    const canvas = fakeTarget('CANVAS');

    app.run('10 INPUT A\n20 PRINT A+1');
    scheduler.tick(); // INPUT 待ちで 'input' Suspend まで進む

    for (const ch of '41') {
      onKeydown(keyEvent(ch, `Digit${ch}`, canvas));
    }
    onKeydown(keyEvent('Enter', 'Enter', canvas));

    scheduler.tick(); // 確定した行を読み取って代入・続行し、PRINT A+1 まで実行する

    // キーが実際にエミュレータへ届いて INPUT が「41」を受け取った証拠として、
    // A+1 = 42 が画面に表示されていることを確認する（値そのものの検証）。
    // INPUT は既定で "?" プロンプトを出し、確定した行をそのままエコーする
    // （interpreter.ts executeInput）。数値 PRINT は符号位置ぶん先頭にスペースが付く
    // （number.ts の書式化仕様）。
    const cmp = new Machine();
    cmp.screen.writeText('?41\n');
    cmp.screen.writeText(' 42\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});
