// 画面・図形系／INPUT／SWITCH/CASE/DEFAULT/ENDSWITCH／LIST の結合テスト。
// docs/design/phase1_runtime.md・phase1_architecture.md の各節に対応する。
// test/interpreter.test.ts と同じ「BASICソース → 実行 → 画面ダンプまたは変数の値」の形。

import { describe, expect, it } from 'vitest';
import type { BuiltinTable } from '../src/basic/evaluator.js';
import { Interpreter } from '../src/basic/interpreter.js';
import { parseProgram } from '../src/basic/parser.js';
import { numeric } from '../src/basic/value.js';
import { Machine } from '../src/machine/machine.ts';

/** `code` を明示的に空文字列にしない、通常の擬似 KeyboardEvent を作る（keyboard.test.ts と同じ方針）。 */
function keyEvent(key: string, code: string): KeyboardEvent {
  return { key, code } as KeyboardEvent;
}

/** ソース全体を実行し切る（INPUT 等の中断が無い前提）。無限ループ検出用に上限を設ける。 */
function run(source: string, builtins: BuiltinTable = {}): { interpreter: Interpreter; machine: Machine } {
  const program = parseProgram(source);
  const machine = new Machine(1);
  const interpreter = new Interpreter(program, machine, builtins);
  const gen = interpreter.run();
  let steps = 0;
  let res = gen.next();
  while (!res.done) {
    if (!res.value || res.value.kind === 'input') {
      throw new Error('run(): INPUT 待ちで停止しました（run() ヘルパは中断を想定していません）');
    }
    steps++;
    if (steps > 200000) throw new Error('run(): ステップ数上限を超えました（無限ループの疑い）');
    res = gen.next();
  }
  return { interpreter, machine };
}

describe('PSET / PRESET / LINE', () => {
  it('PSET で1ドット点灯する', () => {
    const { machine } = run('10 PSET (3,2)');
    expect(machine.screen.point(3, 2)).toBe(1);
    expect(machine.screen.point(4, 2)).toBe(0);
  });

  it('PSET ,X は現在の点灯状態を反転する', () => {
    const { machine } = run('10 PSET (3,2)\n20 PSET (3,2),X');
    expect(machine.screen.point(3, 2)).toBe(0);
  });

  it('PRESET で消灯する', () => {
    const { machine } = run('10 PSET (5,5)\n20 PRESET (5,5)');
    expect(machine.screen.point(5, 5)).toBe(0);
  });

  it('LINE (x1,y1)-(x2,y2) で水平線が引ける', () => {
    const { machine } = run('10 LINE (0,0)-(4,0)');
    expect(machine.screen.dumpAscii(0, 0, 5, 1)).toBe('#####');
  });

  it('LINE の始点省略はグラフィックカーソル位置を使う（PSETで動かした位置から続く）', () => {
    const { machine } = run('10 PSET (2,0)\n20 LINE -(2,3)');
    // (2,0)から(2,3)まで縦線。
    expect(machine.screen.dumpAscii(2, 0, 1, 4)).toBe('#\n#\n#\n#');
  });

  it('LINE ,,B で矩形の枠だけを描く', () => {
    const { machine } = run('10 LINE (0,0)-(3,3),,,B');
    const dump = machine.screen.dumpAscii(0, 0, 4, 4);
    expect(dump).toBe('####\n#..#\n#..#\n####');
  });

  it('LINE ,,BF で塗りつぶし矩形を描く', () => {
    const { machine } = run('10 LINE (0,0)-(2,2),,,BF');
    expect(machine.screen.dumpAscii(0, 0, 3, 3)).toBe('###\n###\n###');
  });
});

describe('CIRCLE', () => {
  it('CIRCLE で円（枠）が描ける', () => {
    const { machine } = run('10 CIRCLE (10,10),5');
    // 円周上の点(半径ぶん離れた4点)は点灯し、中心は消灯している。
    expect(machine.screen.point(10, 5)).toBe(1); // 上端
    expect(machine.screen.point(10, 15)).toBe(1); // 下端
    expect(machine.screen.point(5, 10)).toBe(1); // 左端
    expect(machine.screen.point(15, 10)).toBe(1); // 右端
    expect(machine.screen.point(10, 10)).toBe(0); // 中心（枠のみなので消灯）
  });

  it('CIRCLE(10,10),5,,,,X の引数飛ばし（開始角・終了角・縦横比の省略）が正しく解釈される', () => {
    // 事前に全塗り円を描いておき、,,,X（モードのみ指定＝反転）で上書きすると
    // 円周部分だけが消灯するはず（開始角/終了角/縦横比は省略＝既定値の全円）。
    const { machine } = run('10 CIRCLE (10,10),5,,,,,6\n20 CIRCLE (10,10),5,,,,X');
    // 全塗り円の中心付近は点灯したまま、円周ちょうどの点は反転して消灯している。
    expect(machine.screen.point(10, 10)).toBe(1); // 中心は円周ではないので影響を受けない
    expect(machine.screen.point(10, 5)).toBe(0); // 円周上（上端）は反転されて消灯
  });
});

describe('PAINT / POINT', () => {
  it('PAINT で矩形の内側を塗りつぶせる。POINT は点灯状態を返す', () => {
    const { machine } = run('10 LINE (0,0)-(4,4),,,B\n20 PAINT (2,2),6', {
      POINT: {
        minArgs: 2,
        maxArgs: 2,
        fn: () => numeric(0), // ダミー（POINTはInterpreterが自前で足すため、ここでは使われない）
      },
    });
    expect(machine.screen.point(2, 2)).toBe(1); // 内側は塗られている
    expect(machine.screen.point(0, 0)).toBe(1); // 枠自体も点灯のまま
  });

  it('POINT(x,y) 関数が点灯状態(0/1)を返し、画面外は常に0を返す', () => {
    const { interpreter } = run('10 PSET (7,7)\n20 A=POINT(7,7)\n30 B=POINT(8,7)\n40 C=POINT(-1,0)\n50 D=POINT(999,999)');
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(1));
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(0));
    expect(interpreter.variables.getScalar('C')).toEqual(numeric(0));
    expect(interpreter.variables.getScalar('D')).toEqual(numeric(0));
  });
});

describe('GCURSOR / GPRINT', () => {
  it('GPRINT はグラフィックカーソル位置から縦8ドットのビットパターンを描く', () => {
    // 255 (&HFF) は8ドット全点灯の1列。
    const { machine } = run('10 GCURSOR (0,0)\n20 GPRINT 255');
    expect(machine.screen.dumpAscii(0, 0, 1, 8)).toBe('#\n#\n#\n#\n#\n#\n#\n#');
    expect(machine.screen.point(1, 0)).toBe(0);
  });

  it('引数無しの GPRINT はグラフィックカーソルを1ドット下げるだけで何も描かない', () => {
    const { machine } = run('10 GCURSOR (0,0)\n20 GPRINT\n30 GPRINT 255');
    // 1ドット下がった(0,1)から描かれるはず。
    expect(machine.screen.point(0, 0)).toBe(0);
    expect(machine.screen.point(0, 1)).toBe(1);
  });
});

describe('BEEP', () => {
  it('BEEP は AudioContext 未接続でも例外を投げず実行できる（NullSound）', () => {
    expect(() => run('10 BEEP 1')).not.toThrow();
  });
});

describe('LCOPY は未対応として記録され、実行は継続する', () => {
  it('LCOPY実行後もプログラムが止まらず、reportUnimplemented に記録される', () => {
    const { machine, interpreter } = run('10 LCOPY 1,1,1\n20 A=1');
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(1));
    expect(machine.getUnimplementedReport().some((r) => r.name === 'LCOPY')).toBe(true);
  });
});

describe('SWITCH / CASE / DEFAULT / ENDSWITCH', () => {
  it('一致する CASE が実行され、他の CASE・DEFAULT はスキップされる', () => {
    const src = [
      '10 A=2',
      '20 SWITCH A',
      '30 CASE 1',
      '40 R=100',
      '50 CASE 2',
      '60 R=200',
      '70 CASE 3',
      '80 R=300',
      '90 DEFAULT',
      '100 R=999',
      '110 ENDSWITCH',
    ].join('\n');
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('R')).toEqual(numeric(200));
  });

  it('一致する CASE が無ければ DEFAULT が実行される', () => {
    const src = ['10 A=9', '20 SWITCH A', '30 CASE 1', '40 R=100', '50 DEFAULT', '60 R=999', '70 ENDSWITCH'].join('\n');
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('R')).toEqual(numeric(999));
  });

  it('一致する CASE も DEFAULT も無ければ ENDSWITCH 直後へ進む', () => {
    const src = ['10 R=0', '20 A=9', '30 SWITCH A', '40 CASE 1', '50 R=100', '60 ENDSWITCH', '70 R=R+1'].join('\n');
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('R')).toEqual(numeric(1));
  });
});

describe('INPUT', () => {
  /** INPUT の1回のキー入力待ちで止まったら、Enterまで打鍵して再開させるヘルパ。 */
  function typeLineAndEnter(machine: Machine, line: string): void {
    for (const ch of line) {
      machine.keyboard.handleKeyDown(keyEvent(ch, `Key${ch.toUpperCase()}`));
    }
    machine.keyboard.handleKeyDown(keyEvent('Enter', 'Enter'));
  }

  it('INPUT はキー入力待ちで中断し、Enterで確定した行を変数へ代入して再開する', () => {
    const program = parseProgram('10 INPUT A\n20 B=A+1');
    const machine = new Machine(1);
    const interpreter = new Interpreter(program, machine, {});
    const gen = interpreter.run();

    let res = gen.next();
    let guard = 0;
    while (!res.done && res.value.kind !== 'input') {
      res = gen.next();
      guard++;
      if (guard > 1000) throw new Error('INPUT待ちに到達しませんでした');
    }
    expect(res.done).toBe(false);

    // まだ確定していないので、もう一度回しても同じ 'input' で止まり続けるはず。
    const stillWaiting = gen.next();
    expect(stillWaiting.done).toBe(false);
    if (!stillWaiting.done) expect(stillWaiting.value.kind).toBe('input');

    typeLineAndEnter(machine, '41');

    guard = 0;
    res = gen.next();
    while (!res.done) {
      res = gen.next();
      guard++;
      if (guard > 1000) throw new Error('INPUT再開後に終了しませんでした');
    }
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(41));
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(42));
  });

  it('INPUT は複数変数をカンマ区切りの1行入力から一括代入する', () => {
    const program = parseProgram('10 INPUT A,B$');
    const machine = new Machine(1);
    const interpreter = new Interpreter(program, machine, {});
    const gen = interpreter.run();

    let res = gen.next();
    while (!res.done && res.value.kind !== 'input') res = gen.next();

    typeLineAndEnter(machine, '7,HI');

    res = gen.next();
    while (!res.done) res = gen.next();

    expect(interpreter.variables.getScalar('A')).toEqual(numeric(7));
    expect(interpreter.variables.getScalar('B$')).toEqual({ type: 'string', value: 'HI' });
  });
});

describe('LIST', () => {
  it('入力したプログラムをテキストへ復元して表示できる（REMの本文・DATA項目内の空白を保持する）', () => {
    // REM: キーワード直後の空白を含む本文をそのまま保持できること。
    // DATA: 引用符なしの項目（"HELLO  WORLD" のような内部に空白を含む1項目）の
    // 空白が保持されること。なお項目の前後（カンマ直前直後）の空白はトークナイザ
    // 段階で失われる（parser.ts の既存実装の性質であり、今回のスコープ外）ため、
    // ここでは「項目内部」の空白保持を検証する。
    const src = '10 A=1+2\n20 REM  これはコメント  \n30 DATA HELLO  WORLD,2,3\n40 LIST';
    const { machine } = run(src);
    const cmp = new Machine();
    cmp.screen.writeText('10 A=1+2\n20 REM  これはコメント  \n30 DATA HELLO  WORLD,2,3\n40 LIST\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});
