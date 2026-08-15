// 比較演算・論理否定の真偽値表現に関するテスト。
// docs/design/phase1_grammar.md の訂正（結果は真-1／偽0）と
// docs/spec/basic_commands.yaml の AND/NOT の notes を根拠とする。

import { describe, expect, it } from 'vitest';
import type { BuiltinContext, BuiltinTable } from '../src/basic/evaluator.js';
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

describe('比較演算の真偽値（真=-1／偽=0）', () => {
  it('A=(1=1) は -1 になる', () => {
    const { interpreter } = run('10 A=(1=1)');
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(-1));
  });

  it('A=(1=2) は 0 になる', () => {
    const { interpreter } = run('10 A=(1=2)');
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(0));
  });

  it('PRINT (1=1) が -1 を出す', () => {
    const { machine } = run('10 PRINT (1=1)');
    const cmp = new Machine();
    cmp.screen.writeText('-1\n');
    expect(machine.screen.dumpAscii(0, 0, 6 * 3, 16)).toBe(cmp.screen.dumpAscii(0, 0, 6 * 3, 16));
  });

  it('A=(5>1)*10 は -10 になる', () => {
    const { interpreter } = run('10 A=(5>1)*10');
    expect(interpreter.variables.getScalar('A')).toEqual(numeric(-10));
  });

  it('NOT (1=1) は 0、NOT (1=2) は -1 になる（NOT X = -(X+1) との整合確認）', () => {
    const { interpreter: t } = run('10 A=NOT (1=1)');
    expect(t.variables.getScalar('A')).toEqual(numeric(0));
    const { interpreter: f } = run('10 A=NOT (1=2)');
    expect(f.variables.getScalar('A')).toEqual(numeric(-1));
  });

  it('IF の分岐は非0が真なので従来どおり動く（回帰確認）', () => {
    const { interpreter: t } = run('10 A=0\n20 IF (1=1) THEN A=100 ELSE A=200');
    expect(t.variables.getScalar('A')).toEqual(numeric(100));
    const { interpreter: f } = run('10 A=0\n20 IF (1=2) THEN A=100 ELSE A=200');
    expect(f.variables.getScalar('A')).toEqual(numeric(200));
  });
});
