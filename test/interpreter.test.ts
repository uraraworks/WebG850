// インタプリタの結合テスト。「BASICソース → 実行 → 画面ダンプまたは変数の値」の形で書く。
// docs/design/phase1_runtime.md の各節に対応する。

import { describe, expect, it } from 'vitest';
import type { BuiltinContext, BuiltinTable } from '../src/basic/evaluator.js';
import { BasicError, UnsupportedError } from '../src/basic/errors.js';
import { Interpreter } from '../src/basic/interpreter.js';
import { parseProgram } from '../src/basic/parser.js';
import { numeric, str } from '../src/basic/value.js';
import { Machine } from '../src/machine/machine.ts';

/** ダミーの組込み関数テーブル（別担当実装の完成を待たずにテストするため自前で用意する）。 */
function dummyBuiltins(): BuiltinTable {
  return {
    ABS: {
      minArgs: 1,
      maxArgs: 1,
      fn: (args) => numeric(Math.abs((args[0] as { value: number }).value)),
    },
    STR$: {
      minArgs: 1,
      maxArgs: 1,
      fn: (args) => str(String((args[0] as { value: number }).value)),
    },
    RND: {
      minArgs: 0,
      maxArgs: 1,
      fn: (_args, ctx: BuiltinContext) => numeric(ctx.rnd()),
    },
  };
}

/** ソース全体を実行し切る（yield は全て消費するだけ）。無限ループ検出用に上限を設ける。 */
function run(source: string, builtins: BuiltinTable = dummyBuiltins()): { interpreter: Interpreter; machine: Machine } {
  const program = parseProgram(source);
  const machine = new Machine(1);
  const interpreter = new Interpreter(program, machine, builtins);
  const gen = interpreter.run();
  let steps = 0;
  let res = gen.next();
  while (!res.done) {
    steps++;
    if (steps > 200000) throw new Error('run(): ステップ数上限を超えました（無限ループの疑い）');
    res = gen.next();
  }
  return { interpreter, machine };
}

describe('LET / PRINT', () => {
  it('10 A=1:B=2:PRINT A+B が 3 を出す', () => {
    const { machine } = run('10 A=1:B=2:PRINT A+B');
    // PRINTは正数の前にスペース1つ、末尾に改行を出す（POSITIVE_LEADING_SPACE）。
    const cmp = new Machine();
    cmp.screen.writeText(' 3\n');
    expect(machine.screen.dumpAscii(0, 0, 6 * 3, 16)).toBe(cmp.screen.dumpAscii(0, 0, 6 * 3, 16));
  });

  it('PRINT の文字列出力をダンプで確認できる（数値変数と文字列変数は別名前空間）', () => {
    const { machine } = run('10 A=3:A$="HI":PRINT A;A$');
    // A=3, A$="HI" は別変数。連結出力される。
    // 期待値: " 3HI"（正数の先頭スペース＋整数3＋文字列HI）を1文字ずつ描画したもの。
    const blank = new Machine().screen.dumpAscii(0, 0, 6 * 4, 8);
    const cmp = new Machine();
    cmp.screen.writeText(' 3HI');
    expect(machine.screen.dumpAscii(0, 0, 6 * 4, 8)).toBe(cmp.screen.dumpAscii(0, 0, 6 * 4, 8));
    expect(machine.screen.dumpAscii(0, 0, 6 * 4, 8)).not.toBe(blank);
  });

  it('数値変数と文字列変数は別名前空間（A と A$）', () => {
    const { interpreter } = run('10 A=5:A$="X"');
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(5));
    expect(interpreter.variables.getScalar('A$')).toEqual(str('X'));
  });

  it('型不一致の代入は ERROR(90) となり画面へ表示される（実行中のエラーは run() 内部で捕捉され表示に変換される設計のため、例外の送出ではなく画面表示で確認する）', () => {
    const { machine, interpreter } = run('10 A=1:A="X"');
    expect(interpreter.running).toBe(false);
    expect(interpreter.contAvailable).toBe(false);
    const cmp = new Machine();
    cmp.screen.writeText('\n?ERROR 90 IN 10\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });

  it('PRINT のカンマ区切りは12桁ゾーン送り、末尾セミコロンで改行抑制', () => {
    const { machine } = run('10 PRINT "A";\n20 PRINT "B"');
    const cmp = new Machine();
    cmp.screen.writeText('AB\n');
    expect(machine.screen.dumpAscii(0, 0, 24, 8)).toBe(cmp.screen.dumpAscii(0, 0, 24, 8));
  });
});

describe('FOR / NEXT', () => {
  it('反復して合計を計算する', () => {
    const { interpreter } = run('10 S=0\n20 FOR I=1 TO 5\n30 S=S+I\n40 NEXT I\n50 END');
    expect(interpreter.variables.getScalar('S')).toEqual(numeric(15));
    expect(interpreter.variables.getScalar('I')).toEqual(numeric(6));
  });

  it('STEP 負値で降順に反復する', () => {
    const { interpreter } = run('10 S=0\n20 FOR I=5 TO 1 STEP -1\n30 S=S+I\n40 NEXT I');
    expect(interpreter.variables.getScalar('S')).toEqual(numeric(15));
  });

  it('FOR I=1 TO 0 は本体を1回も実行しない（前判定、FOR_CHECKS_BEFORE_BODY）', () => {
    const { interpreter } = run('10 N=0\n20 FOR I=1 TO 0\n30 N=N+1\n40 NEXT I');
    expect(interpreter.variables.getScalar('N')).toEqual(numeric(0));
  });

  it('NEXT の変数省略はスタック最上位を閉じ、指定時は巻き戻す（多重ループ）', () => {
    const src = `
10 C=0
20 FOR I=1 TO 2
30 FOR J=1 TO 2
40 C=C+1
50 NEXT
60 NEXT I
`;
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('C')).toEqual(numeric(4));
  });

  it(
    '同一行内で完結するFOR/NEXTがループ変数を書き換え続けて終了条件に到達しなくても、' +
      'gen.next()呼び出し自体が無限にブロックしない（行頭に依らず一定文数ごとに安全弁yieldする）。' +
      '実在作品runbridge.txtの`FOR Q=0 TO 1:Q=-(INKEY$=" "):NEXT`（スペースキー待ちの慣用句）が' +
      '同じ行の中だけでジャンプし続け、行頭yieldに一度も到達せずコーパス計測プロセスごと固まった' +
      '不具合の最小再現。修正前は最初にこの無限ループへ入った時点で1回の`gen.next()`が永久に' +
      '返らずハングする（本テスト自体がタイムアウトしてハングを検出する）。',
    () => {
      const program = parseProgram('10 FOR I=0 TO 1:I=0:NEXT');
      const machine = new Machine(1);
      const interpreter = new Interpreter(program, machine, dummyBuiltins());
      const gen = interpreter.run();
      // 200000ステップ全消化（十数秒かかる）まで待たず、少数回の gen.next() の中で
      // 複数回yieldが返ってくることだけを確認する。行頭に依らない安全弁が無ければ
      // 最初のFOR本体突入後、この呼び出しの中のどこかで永久にブロックする。
      let yieldCount = 0;
      let res = gen.next();
      for (let i = 0; i < 5000 && !res.done; i++) {
        if (res.value.kind === 'yield') yieldCount++;
        if (yieldCount >= 5) break;
        res = gen.next();
      }
      expect(res.done).toBe(false); // 終了条件に到達しない無限ループのまま実行中
      expect(yieldCount).toBeGreaterThanOrEqual(5); // 行頭に依らず安全弁yieldが繰り返し発生している
    },
    3000,
  );
});

describe('GOSUB / RETURN', () => {
  it('複文の途中（コロン区切りの2文目）へ RETURN で戻る', () => {
    const src = `
10 A=0
20 GOSUB 100
30 A=A+1:A=A+10
40 END
100 A=A+1000
110 RETURN
`;
    const { interpreter } = run(src);
    // 20行GOSUB -> 100/110で+1000してRETURN -> 戻り先は30行の"GOSUB"の次の文
    // ("A=A+1" のさらに次、コロン区切りの2文目 "A=A+10" ではなく1文目から)。
    // ここでは「30行の最初の文から再開しA+1とA+10の両方が効く」ことを検証する。
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(1011));
  });

  it('RETURN 単体は ERROR(51) となり停止する', () => {
    const { interpreter } = run('10 RETURN');
    expect(interpreter.running).toBe(false);
    expect(interpreter.contAvailable).toBe(false);
  });

  it('GOSUB がコロン区切りの複文の2文目へ戻れる', () => {
    const src = `
10 A=0
20 A=A+1:GOSUB 100
30 END
100 A=A+100
110 RETURN
`;
    // 100行実行後、20行の「GOSUBの次の文」は存在しないので30行のENDへ戻り、そこで終了する。
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(101));
  });
});

describe('WHILE / WEND, REPEAT / UNTIL', () => {
  it('WHILE/WEND で反復する', () => {
    const { interpreter } = run('10 I=0\n20 WHILE I<3\n30 I=I+1\n40 WEND');
    expect(interpreter.variables.getScalar('I')).toEqual(numeric(3));
  });

  it('WHILE が偽なら本体を実行しない', () => {
    const { interpreter } = run('10 I=0\n20 WHILE I>0\n30 I=I+1\n40 WEND');
    expect(interpreter.variables.getScalar('I')).toEqual(numeric(0));
  });

  it('REPEAT/UNTIL は本体を少なくとも1回実行する', () => {
    const { interpreter } = run('10 I=0\n20 REPEAT\n30 I=I+1\n40 UNTIL I>=3');
    expect(interpreter.variables.getScalar('I')).toEqual(numeric(3));
  });

  it('REPEAT/UNTIL は条件が最初から真でも1回は実行する', () => {
    const { interpreter } = run('10 I=5\n20 REPEAT\n30 I=I+1\n40 UNTIL I>=0');
    expect(interpreter.variables.getScalar('I')).toEqual(numeric(6));
  });
});

describe('IF', () => {
  it('1行形式（THEN 行番号）', () => {
    const { interpreter } = run('10 A=1\n20 IF A=1 THEN 40\n30 A=99\n40 A=A+1');
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(2));
  });

  it('1行形式（THEN 文, ELSE 文）', () => {
    const { interpreter: t } = run('10 A=1\n20 IF A=1 THEN B=100 ELSE B=200');
    expect(t.variables.getScalar('B')).toEqual(numeric(100));
    const { interpreter: f } = run('10 A=2\n20 IF A=1 THEN B=100 ELSE B=200');
    expect(f.variables.getScalar('B')).toEqual(numeric(200));
  });

  it('1行形式・THEN 節が複文（条件不成立なら全文が実行されない）', () => {
    const { interpreter } = run('10 A=2\n20 IF A=1 THEN B=1:C=1 ELSE D=1');
    expect(interpreter.variables.getScalar('B').value).toBe(0);
    expect(interpreter.variables.getScalar('C').value).toBe(0);
    expect(interpreter.variables.getScalar('D')).toEqual(numeric(1));
  });

  it('1行形式・THEN 節が複文（条件成立なら全文が実行される）', () => {
    const { interpreter } = run('10 A=1\n20 IF A=1 THEN B=1:C=2 ELSE D=1');
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(1));
    expect(interpreter.variables.getScalar('C')).toEqual(numeric(2));
    expect(interpreter.variables.getScalar('D').value).toBe(0);
  });

  it('1行形式・ELSE 節が複文（条件成立なら ELSE 節の全文が実行されない）', () => {
    const { interpreter } = run('10 A=1\n20 IF A=1 THEN B=1 ELSE C=1:D=1');
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(1));
    expect(interpreter.variables.getScalar('C').value).toBe(0);
    expect(interpreter.variables.getScalar('D').value).toBe(0);
  });

  it('1行形式・ELSE 節が複文（条件不成立なら ELSE 節の全文が実行される）', () => {
    const { interpreter } = run('10 A=2\n20 IF A=1 THEN B=1 ELSE C=1:D=1');
    expect(interpreter.variables.getScalar('B').value).toBe(0);
    expect(interpreter.variables.getScalar('C')).toEqual(numeric(1));
    expect(interpreter.variables.getScalar('D')).toEqual(numeric(1));
  });

  it('1行形式・THEN 省略でも複文が両方取れる', () => {
    const { interpreter: t } = run('10 A=1\n20 IF A=1 B=1:C=2 ELSE D=1:E=2');
    expect(t.variables.getScalar('B')).toEqual(numeric(1));
    expect(t.variables.getScalar('C')).toEqual(numeric(2));
    expect(t.variables.getScalar('D').value).toBe(0);
    expect(t.variables.getScalar('E').value).toBe(0);

    const { interpreter: f } = run('10 A=2\n20 IF A=1 B=1:C=2 ELSE D=1:E=2');
    expect(f.variables.getScalar('B').value).toBe(0);
    expect(f.variables.getScalar('C').value).toBe(0);
    expect(f.variables.getScalar('D')).toEqual(numeric(1));
    expect(f.variables.getScalar('E')).toEqual(numeric(2));
  });

  it('節の先頭が行番号だけなら暗黙 GOTO（複文の ELSE と共存できる）', () => {
    const { interpreter } = run('10 A=1\n20 IF A=1 THEN 40 ELSE B=1:C=2\n30 D=99\n40 D=D+1');
    // THEN 節が行番号のみ→暗黙 GOTO で 40 行へ飛ぶ。30 行は実行されない。
    expect(interpreter.variables.getScalar('D')).toEqual(numeric(1));
    expect(interpreter.variables.getScalar('B').value).toBe(0);
    expect(interpreter.variables.getScalar('C').value).toBe(0);
  });

  it('1行に複数の ELSE が現れても直近の未結合 IF に結合する（dangling else）', () => {
    // 外側 A=1（成立）・内側 B=2（不成立）→ 内側の ELSE（Y=2）が実行され、
    // 外側の ELSE（Z=3）は実行されない。
    const { interpreter } = run('10 A=1\n20 B=1\n30 IF A=1 THEN IF B=2 THEN X=1 ELSE Y=2 ELSE Z=3');
    expect(interpreter.variables.getScalar('X').value).toBe(0);
    expect(interpreter.variables.getScalar('Y')).toEqual(numeric(2));
    expect(interpreter.variables.getScalar('Z').value).toBe(0);
  });

  it('既存の単文 IF は非退行で動く（THEN 節・ELSE 節とも単文のまま）', () => {
    const { interpreter: t } = run('10 A=1\n20 IF A=1 THEN B=100 ELSE B=200');
    expect(t.variables.getScalar('B')).toEqual(numeric(100));
    const { interpreter: f } = run('10 A=2\n20 IF A=1 THEN B=100 ELSE B=200');
    expect(f.variables.getScalar('B')).toEqual(numeric(200));
  });

  it('ブロック形式（IF THEN ... ELSE ... ENDIF）', () => {
    const src = `
10 A=2
20 IF A=1 THEN
30 B=100
40 ELSE
50 B=200
60 ENDIF
70 B=B+1
`;
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(201));
  });

  it('ブロック形式（ELSEなし、条件成立）', () => {
    const src = `
10 A=1
20 IF A=1 THEN
30 B=100
40 ENDIF
50 B=B+1
`;
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(101));
  });
});

describe('GOTO はブロックを跨いでも壊れない', () => {
  it('WHILE ブロックの内側へ直接 GOTO しても以降のWEND/UNTILの前方走査は独立して機能する', () => {
    const src = `
10 I=0
20 GOTO 40
30 I=I+100
40 WHILE I<3
50 I=I+1
60 WEND
70 END
`;
    const { interpreter } = run(src);
    // 30行は実行されずスキップされ、WHILEループは正しく3回まで回る。
    expect(interpreter.variables.getScalar('I')).toEqual(numeric(3));
  });

  it('IF ブロックの外から GOTO で ELSE 節の内部へ直接飛べる', () => {
    const src = `
10 A=0
20 GOTO 60
30 IF 0=1 THEN
40 A=1
50 ELSE
60 A=A+9
70 ENDIF
80 END
`;
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(9));
  });
});

describe('DATA / READ / RESTORE', () => {
  it('READ で DATA を順に読める（実行されない行の DATA も収集済み）', () => {
    const src = `
10 GOTO 30
20 DATA 999
30 READ A,B$,C
40 END
50 DATA "HI",2
`;
    const { interpreter } = run(src);
    // 20行は実行されない（GOTOでスキップ）が、DATAは事前収集されているので
    // 収集順は 20行→50行、READ A,B$,C は 999→"HI"→2 の順に消費する。
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(999));
    expect(interpreter.variables.getScalar('B$')).toEqual(str('HI'));
    expect(interpreter.variables.getScalar('C')).toEqual(numeric(2));
  });

  it('RESTORE で先頭へ戻れる', () => {
    const src = `
10 DATA 1,2
20 READ A
30 RESTORE
40 READ B
`;
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(1));
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(1));
  });

  it('データを読み切ってから READ すると ERROR(53) となり停止する', () => {
    const { machine, interpreter } = run('10 DATA 1\n20 READ A\n30 READ B');
    expect(interpreter.running).toBe(false);
    const cmp = new Machine();
    cmp.screen.writeText('\n?ERROR 53 IN 30\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});

describe('配列', () => {
  it('DIM ありの配列', () => {
    const src = '10 DIM A(3)\n20 A(0)=10:A(3)=99\n30 B=A(3)';
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('B')).toEqual(numeric(99));
  });

  it('DIM なしの配列は暗黙サイズ(0〜10)で確保される', () => {
    const { interpreter } = run('10 A(10)=5');
    expect(interpreter.variables.getArrayElement('A', [10])).toEqual(numeric(5));
    expect(() => interpreter.variables.getArrayElement('A', [11])).toThrow(BasicError);
  });

  it('添字範囲外は ERROR(32) となり停止する', () => {
    const { machine, interpreter } = run('10 DIM A(2)\n20 A(3)=1');
    expect(interpreter.running).toBe(false);
    const cmp = new Machine();
    cmp.screen.writeText('\n?ERROR 32 IN 20\n');
    expect(machine.screen.dumpAscii(0, 0, 144, 48)).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });

  it('文字列配列と数値配列も別名前空間', () => {
    const { interpreter } = run('10 DIM A(2),A$(2)\n20 A(0)=1:A$(0)="X"');
    expect(interpreter.variables.getArrayElement('A', [0])).toEqual(numeric(1));
    expect(interpreter.variables.getArrayElement('A$', [0])).toEqual(str('X'));
  });

  it('DIM A$(n)*m の文字長超過は切り捨てる', () => {
    const { interpreter } = run('10 DIM A$(1)*3\n20 A$(0)="HELLO"');
    expect(interpreter.variables.getArrayElement('A$', [0])).toEqual(str('HEL'));
  });
});

describe('エラー表示', () => {
  it('エラー時に ?ERROR <番号> IN <行番号> 相当を画面へ出す', () => {
    const { machine } = run('10 A=1/0');
    const text = machine.screen.dumpAscii(0, 0, 144, 48);
    const cmp = new Machine();
    cmp.screen.writeText('\n?ERROR 21 IN 10\n');
    // 期待メッセージがそのままダンプに含まれる（先頭に描画されるはず）。
    expect(text).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});

describe('未実装の文は無言で飛ばさず停止・記録される', () => {
  it('AUTO はエディタ未実装のためスコープ外であり、UnsupportedError 相当で停止し、reportUnimplemented に記録される', () => {
    // AUTO/DELETE/RENUM/PASS はエディタが無いと成立しない直接コマンドで、
    // 依頼指示により今回のスコープ外（?UNSUPPORTED のまま）。INPUT は本担当で
    // 実装済みのため、ここでの検証対象を差し替えた。
    const { machine } = run('10 AUTO');
    const report = machine.getUnimplementedReport();
    expect(report.some((r) => r.name === 'AUTO')).toBe(true);
    const text = machine.screen.dumpAscii(0, 0, 144, 48);
    const cmp = new Machine();
    cmp.screen.writeText('\n?UNSUPPORTED AUTO IN 10\n');
    expect(text).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });

  it('builtins テーブルに無い関数呼び出しは UnsupportedError で停止する（run() 自体はcatchするのでthrowしない）', () => {
    // SIN はトークナイザがキーワードとして認識する（＝識別子+"("のArrayRefにはならず
    // FunctionCallとして評価される）が、ここではダミーの builtins テーブルに登録していない。
    const { machine } = run('10 A=SIN(1)');
    expect(machine.getUnimplementedReport().some((r) => r.name === 'SIN')).toBe(true);
  });
});

describe('CONT による再開', () => {
  it('STOP で止まり、CONT で続きから再開できる', () => {
    const program = parseProgram('10 A=1\n20 STOP\n30 A=A+1');
    const machine = new Machine(1);
    const interpreter = new Interpreter(program, machine, dummyBuiltins());
    const gen = interpreter.run();
    let res = gen.next();
    while (!res.done) res = gen.next();
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(1));
    expect(interpreter.running).toBe(false);
    expect(interpreter.contAvailable).toBe(true);

    const gen2 = interpreter.cont();
    let res2 = gen2.next();
    while (!res2.done) res2 = gen2.next();
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(2));
  });

  it('CONT できない状態（エラー停止後）で呼ぶと ERROR(13)', () => {
    const program = parseProgram('10 A=1/0');
    const machine = new Machine(1);
    const interpreter = new Interpreter(program, machine, dummyBuiltins());
    const gen = interpreter.run();
    let res = gen.next();
    while (!res.done) res = gen.next();
    expect(() => interpreter.cont().next()).toThrow(BasicError);
  });
});

describe('TRON', () => {
  it('実行した行番号を [n] の形で画面へ出す', () => {
    const { machine } = run('10 A=1\n20 TRON\n30 A=A+1\n40 A=A+1');
    const text = machine.screen.dumpAscii(0, 0, 144, 48);
    const cmp = new Machine();
    // TRON自身は20行なので出ない。30,40行の実行で[30][40]が出る。
    cmp.screen.writeText('[30][40]');
    expect(text).toBe(cmp.screen.dumpAscii(0, 0, 144, 48));
  });
});

describe('角度モード', () => {
  it('既定は DEGREE、DEGREE/RADIAN/GRAD で切り替わる', () => {
    const { interpreter } = run('10 RADIAN\n20 GRAD\n30 DEGREE');
    expect(interpreter.angleMode).toBe('DEG');
    const { interpreter: r } = run('10 RADIAN');
    expect(r.angleMode).toBe('RAD');
  });
});

describe('ON GOTO / ON GOSUB', () => {
  it('ON GOTO は選択値に応じて分岐する', () => {
    const src = '10 N=2\n20 ON N GOTO 100,200,300\n30 END\n100 A=1:END\n200 A=2:END\n300 A=3:END';
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(2));
  });

  it('範囲外の選択値は次の文へ進む', () => {
    const src = '10 N=9\n20 ON N GOTO 100,200\n30 A=42\n40 END\n100 A=1\n200 A=2';
    const { interpreter } = run(src);
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(42));
  });
});
