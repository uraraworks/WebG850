// 文パーサのテスト。docs/design/phase1_grammar.md「文」節・「行」節に
// 対応するかを構造レベルで確認する。

import { describe, expect, it } from 'vitest';
import type {
  CaseStmt,
  DataStmt,
  EraseStmt,
  ForStmt,
  GotoStmt,
  IfLineStmt,
  IfStmt,
  InputStmt,
  LabelStmt,
  LetStmt,
  NextStmt,
  PrintStmt,
  RemStmt,
  Stmt,
} from '../src/basic/ast.js';
import { Cursor, parseProgram, parseStatementList } from '../src/basic/parser.js';
import { tokenize } from '../src/basic/tokenizer.js';

/** 1行分のソースを最後まで消費する形で文リストにパースする（テスト便宜）。 */
function parseLine(source: string): Stmt[] {
  const cursor = new Cursor(tokenize(source));
  return parseStatementList(cursor);
}

describe('FOR / NEXT', () => {
  it('FOR I=1 TO 10 STEP 2 をパースできる', () => {
    const [stmt] = parseLine('FOR I=1 TO 10 STEP 2') as [ForStmt];
    expect(stmt.kind).toBe('ForStmt');
    expect(stmt.variable.name).toBe('I');
    expect((stmt.from as any).value).toBe(1);
    expect((stmt.to as any).value).toBe(10);
    expect((stmt.step as any).value).toBe(2);
  });

  it('STEP 省略時は step が null', () => {
    const [stmt] = parseLine('FOR I=1 TO 10') as [ForStmt];
    expect(stmt.step).toBeNull();
  });

  it('NEXT（変数あり）', () => {
    const [stmt] = parseLine('NEXT I') as [NextStmt];
    expect(stmt.kind).toBe('NextStmt');
    expect(stmt.variable?.name).toBe('I');
  });

  it('NEXT（変数省略）', () => {
    const [stmt] = parseLine('NEXT') as [NextStmt];
    expect(stmt.kind).toBe('NextStmt');
    expect(stmt.variable).toBeNull();
  });

  it('空白なしの FORI=1TO10 が通る（最長一致トークナイズ）', () => {
    const [stmt] = parseLine('FORI=1TO10') as [ForStmt];
    expect(stmt.kind).toBe('ForStmt');
    expect(stmt.variable.name).toBe('I');
    expect((stmt.to as any).value).toBe(10);
  });
});

describe('IF の2形態', () => {
  it('1行形式: THEN の直後にトークンがあれば IfLineStmt', () => {
    const [stmt] = parseLine('IF A=1 THEN 100') as [IfLineStmt];
    expect(stmt.kind).toBe('IfLineStmt');
    expect(stmt.thenClause).toMatchObject({ kind: 'LineNumberTarget', value: 100 });
    expect(stmt.elseClause).toBeNull();
  });

  it('1行形式で ELSE も取れる', () => {
    const [stmt] = parseLine('IF A=1 THEN 100 ELSE 200') as [IfLineStmt];
    expect(stmt.elseClause).toMatchObject({ kind: 'LineNumberTarget', value: 200 });
  });

  it('1行形式で THEN の後が文の場合もパースできる', () => {
    const [stmt] = parseLine('IF A=1 THEN PRINT A') as [IfLineStmt];
    expect(stmt.kind).toBe('IfLineStmt');
    expect((stmt.thenClause as PrintStmt).kind).toBe('PrintStmt');
  });

  it('ブロック形式: THEN の直後が行末なら IfStmt（ヘッダのみ）', () => {
    const [stmt] = parseLine('IF A=1 THEN') as [IfStmt];
    expect(stmt.kind).toBe('IfStmt');
  });

  it('ELSE / ENDIF は独立したマーカー文になる（ブロックを畳まない）', () => {
    expect(parseLine('ELSE')[0]?.kind).toBe('ElseStmt');
    expect(parseLine('ENDIF')[0]?.kind).toBe('EndIfStmt');
  });
});

describe('PRINT', () => {
  it('カンマ区切り（ゾーン送り）', () => {
    const [stmt] = parseLine('PRINT A,B') as [PrintStmt];
    expect(stmt.items).toHaveLength(2);
    expect(stmt.items[0]?.sep).toBeNull();
    expect(stmt.items[1]?.sep).toBe(',');
    expect(stmt.trailingSep).toBeNull();
  });

  it('セミコロン区切り（連結）', () => {
    const [stmt] = parseLine('PRINT A;B') as [PrintStmt];
    expect(stmt.items[1]?.sep).toBe(';');
  });

  it('末尾セミコロンで改行抑制', () => {
    const [stmt] = parseLine('PRINT A;') as [PrintStmt];
    expect(stmt.items).toHaveLength(1);
    expect(stmt.trailingSep).toBe(';');
  });

  it('引数なしの PRINT は空行', () => {
    const [stmt] = parseLine('PRINT') as [PrintStmt];
    expect(stmt.items).toHaveLength(0);
    expect(stmt.trailingSep).toBeNull();
  });

  it('PRINT USING を項目として読める', () => {
    const [stmt] = parseLine('PRINT USING "###";A') as [PrintStmt];
    expect(stmt.items[0]?.value).toMatchObject({ kind: 'PrintUsing' });
    expect(stmt.items[1]?.sep).toBe(';');
  });
});

describe('GOTO / GOSUB / RESTORE の飛び先3形態', () => {
  it('GOTO 100（行番号）', () => {
    const [stmt] = parseLine('GOTO 100') as [GotoStmt];
    expect(stmt.target).toMatchObject({ kind: 'LineNumberTarget', value: 100 });
  });

  it('GOTO "LBL"（引用符付きラベル）', () => {
    const [stmt] = parseLine('GOTO "LBL"') as [GotoStmt];
    expect(stmt.target).toMatchObject({ kind: 'LabelTarget', name: 'LBL' });
  });

  it('GOTO *LBL（アスタリスク付きラベル）', () => {
    const [stmt] = parseLine('GOTO *LBL') as [GotoStmt];
    expect(stmt.target).toMatchObject({ kind: 'LabelTarget', name: 'LBL' });
  });
});

describe('DATA / REM は : でも終わらない', () => {
  it('DATA は : を値の一部として飲み込まない代わりに、コロンで文が終わる', () => {
    const stmts = parseLine('DATA 1,2,3:PRINT 1');
    expect(stmts).toHaveLength(2);
    expect((stmts[0] as DataStmt).values.map((v) => v.text)).toEqual(['1', '2', '3']);
    expect(stmts[1]?.kind).toBe('PrintStmt');
  });

  it('REM は : 以降も行末までコメントとして飲み込む（文が増えない）', () => {
    const stmts = parseLine('A=1:REM comment : still comment');
    expect(stmts).toHaveLength(2);
    expect(stmts[0]?.kind).toBe('LetStmt');
    expect((stmts[1] as RemStmt).kind).toBe('RemStmt');
  });

  it("' も行末までコメント", () => {
    const stmts = parseLine("A=1:' comment : still comment");
    expect(stmts).toHaveLength(1);
    expect(stmts[0]?.kind).toBe('LetStmt');
  });
});

describe('複文・行番号', () => {
  it('A=1:B=2:PRINT A の3文に分かれる', () => {
    const stmts = parseLine('A=1:B=2:PRINT A');
    expect(stmts).toHaveLength(3);
    expect(stmts[0]?.kind).toBe('LetStmt');
    expect((stmts[0] as LetStmt).assignments[0]?.target.name).toBe('A');
    expect(stmts[1]?.kind).toBe('LetStmt');
    expect(stmts[2]?.kind).toBe('PrintStmt');
  });

  it('LET は省略できる（暗黙代入）', () => {
    const [stmt] = parseLine('A=1') as [LetStmt];
    expect(stmt.kind).toBe('LetStmt');
    expect(stmt.assignments).toHaveLength(1);
  });

  it('LET A=1,B=2 のようにカンマで複数代入できる', () => {
    const [stmt] = parseLine('LET A=1,B=2') as [LetStmt];
    expect(stmt.assignments).toHaveLength(2);
    expect(stmt.assignments[1]?.target.name).toBe('B');
  });

  it('行番号つきの行をパースできる', () => {
    const [line] = parseProgram('100 PRINT 1');
    expect(line?.lineNumber).toBe(100);
    expect(line?.statements[0]?.kind).toBe('PrintStmt');
  });

  it('複数行のプログラムを行の配列にパースできる', () => {
    const lines = parseProgram('10 A=1\n20 PRINT A\n30 GOTO 10');
    expect(lines).toHaveLength(3);
    expect(lines[0]?.lineNumber).toBe(10);
    expect(lines[2]?.statements[0]?.kind).toBe('GotoStmt');
  });
});

describe('その他の文', () => {
  it('*ラベル 単独の文', () => {
    const [stmt] = parseLine('*LBL') as [LabelStmt];
    expect(stmt.kind).toBe('LabelStmt');
    expect(stmt.name).toBe('LBL');
  });

  it('WHILE / WEND', () => {
    expect(parseLine('WHILE A<10')[0]?.kind).toBe('WhileStmt');
    expect(parseLine('WEND')[0]?.kind).toBe('WendStmt');
  });

  it('REPEAT / UNTIL', () => {
    expect(parseLine('REPEAT')[0]?.kind).toBe('RepeatStmt');
    expect(parseLine('UNTIL A=1')[0]?.kind).toBe('UntilStmt');
  });

  it('SWITCH / CASE / DEFAULT / ENDSWITCH', () => {
    expect(parseLine('SWITCH A')[0]?.kind).toBe('SwitchStmt');
    const [caseStmt] = parseLine('CASE 1,2,3') as [CaseStmt];
    expect(caseStmt.values).toHaveLength(3);
    expect(parseLine('DEFAULT')[0]?.kind).toBe('DefaultStmt');
    expect(parseLine('ENDSWITCH')[0]?.kind).toBe('EndSwitchStmt');
  });

  it('GOSUB / RETURN', () => {
    expect(parseLine('GOSUB 100')[0]?.kind).toBe('GosubStmt');
    expect(parseLine('RETURN')[0]?.kind).toBe('ReturnStmt');
  });

  it('ON <式> GOTO / GOSUB', () => {
    const stmt = parseLine('ON X GOTO 100,200,300')[0];
    expect(stmt?.kind).toBe('OnGotoStmt');
    if (stmt?.kind === 'OnGotoStmt') {
      expect(stmt.targets).toHaveLength(3);
    }
  });

  it('END / STOP / CLEAR', () => {
    expect(parseLine('END')[0]?.kind).toBe('EndStmt');
    expect(parseLine('STOP')[0]?.kind).toBe('StopStmt');
    expect(parseLine('CLEAR')[0]?.kind).toBe('ClearStmt');
  });

  it('READ / RESTORE', () => {
    const stmts = parseLine('READ A,B$');
    expect(stmts[0]?.kind).toBe('ReadStmt');
    expect(parseLine('RESTORE')[0]).toMatchObject({ kind: 'RestoreStmt', target: null });
    expect(parseLine('RESTORE 100')[0]).toMatchObject({
      kind: 'RestoreStmt',
      target: { kind: 'LineNumberTarget', value: 100 },
    });
  });

  it('DIM は *文字列長 を含めて読める', () => {
    const stmt = parseLine('DIM A(10),B$(5)*20')[0];
    expect(stmt?.kind).toBe('DimStmt');
    if (stmt?.kind === 'DimStmt') {
      expect(stmt.specs).toHaveLength(2);
      expect(stmt.specs[0]?.stringLength).toBeNull();
      expect(stmt.specs[1]?.name).toBe('B$');
      expect((stmt.specs[1]?.stringLength as any)?.value).toBe(20);
    }
  });

  it('ERASE は空括弧で配列全体を表す', () => {
    const [stmt] = parseLine('ERASE A,B()') as [EraseStmt];
    expect(stmt.targets).toHaveLength(2);
    expect(stmt.targets[1]?.kind).toBe('ArrayRef');
    expect((stmt.targets[1] as any).indices).toHaveLength(0);
  });

  it('INPUT はメッセージと変数が交互に取れる', () => {
    const [stmt] = parseLine('INPUT "NAME";A$,"AGE";B') as [InputStmt];
    expect(stmt.items).toHaveLength(4);
    expect(stmt.items[0]).toMatchObject({ kind: 'InputPrompt', quiet: true });
    expect(stmt.items[1]).toMatchObject({ kind: 'VariableRef', name: 'A$' });
  });

  it('未知のキーワードは UnsupportedStmt(unknown) になる', () => {
    const stmt = parseLine('CLS')[0];
    expect(stmt).toMatchObject({ kind: 'UnsupportedStmt', name: 'CLS', reason: 'unknown' });
  });

  it('phase2/3 と判明している命令は reason で区別される', () => {
    expect(parseLine('POKE 1,2')[0]).toMatchObject({ kind: 'UnsupportedStmt', reason: 'phase2' });
    expect(parseLine('CLOAD')[0]).toMatchObject({ kind: 'UnsupportedStmt', reason: 'phase3' });
  });
});
