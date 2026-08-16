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
import { BasicError, ErrorCode, UnsupportedError } from '../src/basic/errors.ts';

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

describe('DirectMode: 直接打鍵の大文字化（実機は既定で大文字入力）', () => {
  it('小文字キーで打っても画面には大文字で出る', () => {
    const { dm, machine } = buildDirectMode();
    type(dm, 'ab');
    expectScreenText(machine, 'AB');
  });

  it('machine.keyboard.setCapsLock(false) にすると小文字のまま出る', () => {
    const { dm, machine } = buildDirectMode();
    machine.keyboard.setCapsLock(false);
    type(dm, 'ab');
    expectScreenText(machine, 'ab');
  });

  it('loadProgram（テキスト入力欄パネル相当）は大文字化しない：文字列リテラルの小文字がそのまま RUN の出力に出る', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    // BASIC キーワード（PRINT）は大文字が必須のためそのまま書く。
    // 判定したいのは文字列リテラル中の小文字が変換されずに残るかどうか。
    dm.loadProgram('10 PRINT "hello"');
    dm.runCommand('RUN');
    scheduler.tickAll();

    // 直接打鍵（type）経由なら "HELLO" になるところ、loadProgram はそのまま無変換で通す。
    expectScreenText(machine, 'RUN\nhello\nOK\n');
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

  it('行番号の無いダイレクト実行時のエラーは "IN ?" を出さない（実行中のゼロ除算）', () => {
    // 実機ブラウザで発見したバグの再現：ダイレクト実行には行番号が無いのに
    // `IN ?` という埋め草が出ていた。行番号が無い場合は IN 節ごと省く。
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, 'PRINT 1/0');
    enter(dm);
    scheduler.tickAll();

    // `interpreter.ts` の `haltWithMessage` は既存仕様として先頭に空行を1つ出す
    // （`\n${...}\n`）。ここで検証したいのは「IN ?」が出ないことなので、その仕様はそのまま。
    expectScreenText(machine, 'PRINT 1/0\n\n?ERROR 21\nOK\n');
  });

  it('プログラム実行中のエラーは行番号付きで "?ERROR n IN m" と表示される', () => {
    // ダイレクト実行の書式（? 付き）と揃える（以前は `?` の有無が食い違っていた）。
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT 1/0');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT 1/0\nRUN\n\n?ERROR 21 IN 10\nOK\n');
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

  it('NEW の実行完了前（スケジューラが1フレームも進んでいない間）は「実行中」として打鍵を無視する', () => {
    // NEW は `Runtime`（rAF駆動）経由で実行されるため、Enter を押した直後の
    // 時点ではまだ1フレームも進んでおらず、プログラム本体の消去（onDirectEnd）は
    // 完了していない。この間に次の行を打ってしまうと、消去前の ProgramStore へ
    // 書き込まれてしまい、「NEW のはずが古い行が生き残る」実行順序の競合が起きる
    // （公開版で実機操作により発見。scheduler.tick() 前でも isRunning() は
    // true を返し、打鍵をラインエディタへ入れない設計にすることで塞ぐ）。
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "X"');
    enter(dm);
    type(dm, '20 PRINT "Y"');
    enter(dm);
    type(dm, 'NEW');
    enter(dm);

    // まだ scheduler.tick() していない＝NEW はまだ実行完了していないはずだが、
    // ここで「実行中」として扱われている必要がある。
    expect(dm.isRunning()).toBe(true);
    type(dm, '10 PRINT "Z"'); // 実行中なので無視されるはず
    enter(dm);

    scheduler.tickAll();
    type(dm, 'LIST');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "X"\n20 PRINT "Y"\nNEW\nOK\nLIST\nOK\n');
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

describe('DirectMode.runCommand: RUN/LIST ボタン相当が打鍵と同じ経路を通る', () => {
  it('打鍵で RUN したときと画面が一致する', () => {
    const typed = buildDirectMode();
    type(typed.dm, '10 PRINT "OK"');
    enter(typed.dm);
    type(typed.dm, 'RUN');
    enter(typed.dm);
    typed.scheduler.tickAll();

    const viaButton = buildDirectMode();
    type(viaButton.dm, '10 PRINT "OK"');
    enter(viaButton.dm);
    viaButton.dm.runCommand('RUN');
    viaButton.scheduler.tickAll();

    expect(viaButton.machine.screen.dumpAscii(0, 0, 144, 48)).toBe(
      typed.machine.screen.dumpAscii(0, 0, 144, 48),
    );
  });

  it('画面を消さない（前の表示に続けて RUN の実行結果が表示される）', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "OK"');
    enter(dm);
    dm.runCommand('RUN');
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "OK"\nRUN\nOK\nOK\n');
  });

  it('LIST も打鍵と同じ経路で実行される', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 PRINT "X"');
    enter(dm);
    dm.runCommand('LIST');
    scheduler.tickAll();

    expectScreenText(machine, '10 PRINT "X"\nLIST\n10 PRINT "X"\nOK\n');
  });

  it('実行中は何もしない', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 FOR I=1 TO 100000');
    enter(dm);
    type(dm, '20 NEXT I');
    enter(dm);
    dm.runCommand('RUN');
    scheduler.tick();
    expect(dm.isRunning()).toBe(true);

    const before = machine.screen.dumpAscii(0, 0, 144, 48);
    dm.runCommand('LIST'); // 実行中なので無視されるはず
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(before);
  });
});

describe('DirectMode.loadProgram: 入力欄パネルの取り込みボタン相当', () => {
  it('複数行を取り込み、RUN で実行できる（画面へは逐次エコーしない）', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    dm.loadProgram('10 FOR I=1 TO 3\n20 PRINT I\n30 NEXT I');
    dm.runCommand('RUN');
    scheduler.tickAll();

    const nums = [1, 2, 3].map((n) => `${formatNumber(n)}\n`).join('');
    expectScreenText(machine, `RUN\n${nums}OK\n`);
  });

  it('取り込みは差分マージではなく置き換え（前回取り込んだ行は消える）', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    dm.loadProgram('10 PRINT "A"\n20 PRINT "B"');
    dm.loadProgram('10 PRINT "ONLY"');
    dm.runCommand('RUN');
    scheduler.tickAll();

    expectScreenText(machine, 'RUN\nONLY\nOK\n');
  });

  it('行番号の無い行・空行は無視される', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    dm.loadProgram('\n10 PRINT "A"\nREM コメント\n');
    dm.runCommand('LIST');
    scheduler.tickAll();

    expectScreenText(machine, 'LIST\n10 PRINT "A"\nOK\n');
  });

  it('構文エラー行は既存のエラー表示を出し、取り込まれない', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    dm.loadProgram('10 @@@');

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

    dm.runCommand('LIST');
    scheduler.tickAll();
    expectScreenText(machine, `${errorLine}\nLIST\nOK\n`);
  });

  it('実行中は何もしない', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '10 FOR I=1 TO 100000');
    enter(dm);
    type(dm, '20 NEXT I');
    enter(dm);
    dm.runCommand('RUN');
    scheduler.tick();
    expect(dm.isRunning()).toBe(true);

    const before = machine.screen.dumpAscii(0, 0, 144, 48);
    dm.loadProgram('99 PRINT "X"'); // 実行中なので無視されるはず
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(before);
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

  it('保留中の遅延スクロールがあっても、カーソルは既存の文字に重ならない位置へ置かれる', () => {
    // 実機ブラウザで発見したバグの再現：エラー表示等で最下行に達し改行が
    // 保留状態のまま入力待ちに戻ると、以前はカーソルがまだスクロールしていない
    // 最下行の既存の文字の上に重なって描かれていた。
    const { dm, machine } = buildDirectMode();
    // 画面ちょうど6行分書いて、最下行での改行を保留状態にする。
    machine.screen.writeText('1\n2\n3\n4\n5\nOK\n');
    expect(machine.screen.cursor).toEqual({ col: 0, row: 5 }); // 保留中、まだ見た目は変わっていない

    const overlay = dm.getCursorOverlay();

    // カーソルを問い合わせた時点で保留中のスクロールが解決され、
    // カーソル行(row5)は空になっている＝既存の文字と重ならない。
    expect(overlay).toEqual({ col: 0, row: 5 });
    const blankRow5 = new Machine().screen.dumpAscii(0, 5 * 8, 144, 8);
    expect(machine.screen.dumpAscii(0, 5 * 8, 144, 8)).toBe(blankRow5);
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

describe('DirectMode: PRO/RUN モード（docs/spec/operation_behavior.md 事項4）', () => {
  it('既定モードは PRO', () => {
    const { dm } = buildDirectMode();
    expect(dm.getMode()).toBe('PRO');
  });

  it('BASIC キー割当（F2）で PRO⇔RUN が切り替わる', () => {
    const { dm } = buildDirectMode();
    dm.handleKeyDown(keyEvent('F2'));
    expect(dm.getMode()).toBe('RUN');
    dm.handleKeyDown(keyEvent('F2'));
    expect(dm.getMode()).toBe('PRO');
  });

  it('toggleMode() でも切り替わる（画面上のボタン相当）', () => {
    const { dm } = buildDirectMode();
    dm.toggleMode();
    expect(dm.getMode()).toBe('RUN');
  });

  it('PRO モードでは行番号始まりの入力がプログラムへ格納される', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    type(dm, '30 PRINT "A"');
    enter(dm);
    type(dm, 'LIST');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, '30 PRINT "A"\nLIST\n30 PRINT "A"\nOK\n');
  });

  it('RUN モードでは行番号始まりの入力が格納されず、計算結果として表示される（30 → 30）', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    dm.toggleMode();
    expect(dm.getMode()).toBe('RUN');

    type(dm, '30');
    enter(dm);
    scheduler.tickAll();

    expectScreenText(machine, `30\n${formatNumber(30)}\nOK\n`);

    // プログラムへ格納されていないことも確認する（PRO へ戻して LIST が空）。
    dm.toggleMode();
    type(dm, 'LIST');
    enter(dm);
    scheduler.tickAll();
    expectScreenText(machine, `30\n${formatNumber(30)}\nOK\nLIST\nOK\n`);
  });

  it('RUN モードで LIST を打つと ERROR 12（PRO/RUNモードの選択が誤っている）になる', () => {
    const { dm, machine, scheduler } = buildDirectMode();
    // 先に PRO モードでプログラムを1行格納しておく（LIST が実際に動けば見えてしまう）。
    type(dm, '10 PRINT "X"');
    enter(dm);
    dm.toggleMode();
    expect(dm.getMode()).toBe('RUN');

    type(dm, 'LIST');
    enter(dm);
    scheduler.tickAll();

    // 他の構文エラー表示（reportError 経由）と同じく、この時点ではまだ次の
    // 入力待ちプロンプト（OK）は出ない（Runtime を経由せず即座に return するため。
    // 既存の「構文エラーの行は…」テストと同じ挙動）。
    expect(ErrorCode.MODE_MISMATCH).toBe(12);
    expectScreenText(machine, `10 PRINT "X"\nLIST\n?ERROR ${ErrorCode.MODE_MISMATCH}\n`);
  });

  it('モードを切り替えても LCD のビットマップ（Screen）は変化しない（インジケータは DOM 側の責務）', () => {
    const { dm, machine } = buildDirectMode();
    type(dm, 'AB');
    const before = machine.screen.dumpAscii(0, 0, 144, 48);

    dm.toggleMode();

    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(before);
  });

  it('実行中は BASIC キー／toggleMode() を受け付けない', () => {
    const { dm, scheduler } = buildDirectMode();
    type(dm, '10 FOR I=1 TO 100000');
    enter(dm);
    type(dm, '20 NEXT I');
    enter(dm);
    type(dm, 'RUN');
    enter(dm);
    scheduler.tick();
    expect(dm.isRunning()).toBe(true);

    dm.handleKeyDown(keyEvent('F2'));
    expect(dm.getMode()).toBe('PRO'); // 実行中は無視されるので既定のまま
  });
});
