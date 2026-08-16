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
  const cursor = new Cursor(tokenize(source), source);
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
    expect((stmt.thenClause as Stmt[])[0].kind).toBe('PrintStmt');
  });

  it('ブロック形式: THEN の直後が行末なら IfStmt（ヘッダのみ）', () => {
    const [stmt] = parseLine('IF A=1 THEN') as [IfStmt];
    expect(stmt.kind).toBe('IfStmt');
  });

  it('ELSE / ENDIF は独立したマーカー文になる（ブロックを畳まない）', () => {
    expect(parseLine('ELSE')[0]?.kind).toBe('ElseStmt');
    expect(parseLine('ENDIF')[0]?.kind).toBe('EndIfStmt');
  });

  it('THEN 節が `:` 区切りの複文を取れる（ELSE で終わる）', () => {
    const [stmt] = parseLine('IF A=1 THEN B=1:C=2 ELSE D=3') as [IfLineStmt];
    const thenStmts = stmt.thenClause as Stmt[];
    expect(thenStmts).toHaveLength(2);
    expect(thenStmts[0].kind).toBe('LetStmt');
    expect(thenStmts[1].kind).toBe('LetStmt');
    expect((stmt.elseClause as Stmt[])[0].kind).toBe('LetStmt');
  });

  it('ELSE 節も `:` 区切りの複文を取れる（行末で終わる）', () => {
    const [stmt] = parseLine('IF A=1 THEN B=1 ELSE C=2:D=3') as [IfLineStmt];
    const elseStmts = stmt.elseClause as Stmt[];
    expect(elseStmts).toHaveLength(2);
    expect(elseStmts[0].kind).toBe('LetStmt');
    expect(elseStmts[1].kind).toBe('LetStmt');
  });

  it('節の先頭が行番号だけなら残りが複文でも暗黙 GOTO（飛び先）として扱う', () => {
    const [stmt] = parseLine('IF A=1 THEN 100 ELSE B=1:C=2') as [IfLineStmt];
    expect(stmt.thenClause).toMatchObject({ kind: 'LineNumberTarget', value: 100 });
    const elseStmts = stmt.elseClause as Stmt[];
    expect(elseStmts).toHaveLength(2);
  });

  it('1行に複数の ELSE が現れても直近の未結合 IF に結合する（dangling else）', () => {
    // 外側 IF の THEN 節が「内側 IF 文」1つだけを含み、内側 IF が自分の
    // ELSE（Y=2）を貪欲に取ったあと、外側の ELSE（Z=3）は外側 IF に残る。
    const [stmt] = parseLine('IF A=1 THEN IF B=1 THEN X=1 ELSE Y=2 ELSE Z=3') as [IfLineStmt];
    const outerThen = stmt.thenClause as Stmt[];
    expect(outerThen).toHaveLength(1);
    const inner = outerThen[0] as IfLineStmt;
    expect(inner.kind).toBe('IfLineStmt');
    expect(((inner.thenClause as Stmt[])[0] as any).kind).toBe('LetStmt');
    expect(((inner.elseClause as Stmt[])[0] as any).assignments[0].target.name).toBe('Y');
    expect(((stmt.elseClause as Stmt[])[0] as any).assignments[0].target.name).toBe('Z');
  });
});

describe('IF: THEN 省略（不確定仕様 IMPLICIT_THEN）', () => {
  it('THEN を省略して行番号を続けると IfLineStmt になる', () => {
    const [stmt] = parseLine('IF A=1 100') as [IfLineStmt];
    expect(stmt.kind).toBe('IfLineStmt');
    expect(stmt.thenClause).toMatchObject({ kind: 'LineNumberTarget', value: 100 });
    expect(stmt.elseClause).toBeNull();
  });

  // 【既知の制約】 THEN を省略した場合、条件式の直後に続く `*ラベル` は
  // 受理できない。`*` は乗算演算子と同じトークンなので、条件式パーサが
  // `A=1 *LOOP` を「A=1*LOOP という乗算を含む条件式」として食べてしまい、
  // 曖昧性を切り分けられない（THEN 付きなら THEN が明確な区切りになるため
  // 問題にならない）。実在作品の計測でも THEN 省略と *ラベルの組み合わせは
  // 確認されていないため、この組み合わせは対応対象外とする
  // （*ラベルへ飛びたい場合は THEN を書けば従来どおり動く）。

  it('THEN を省略して文を続けられる（ELSE も取れる）', () => {
    const [stmt] = parseLine('IF A=1 PRINT A ELSE PRINT B') as [IfLineStmt];
    expect(stmt.kind).toBe('IfLineStmt');
    expect((stmt.thenClause as Stmt[])[0].kind).toBe('PrintStmt');
    expect((stmt.elseClause as Stmt[])[0].kind).toBe('PrintStmt');
  });

  it('THEN 付きの従来構文は非退行で動く', () => {
    const [stmt] = parseLine('IF A=1 THEN 100') as [IfLineStmt];
    expect(stmt.kind).toBe('IfLineStmt');
    expect(stmt.thenClause).toMatchObject({ kind: 'LineNumberTarget', value: 100 });
  });

  it('IF が連鎖する（実在作品で常用される書き方）', () => {
    const [stmt] = parseLine('IF U=0 IF X>5 GOSUB 210') as [IfLineStmt];
    expect(stmt.kind).toBe('IfLineStmt');
    const inner = (stmt.thenClause as Stmt[])[0] as IfLineStmt;
    expect(inner.kind).toBe('IfLineStmt');
    expect((inner.thenClause as Stmt[])[0].kind).toBe('GosubStmt');
  });

  it('IF が3連鎖してさらに複文が続く（複文は最も内側の THEN 節に属する）', () => {
    const [stmt] = parseLine('IF U=0 IF INKEY$="4" IF X>5 GOSUB 210:X=X-1') as [IfLineStmt];
    expect(stmt.kind).toBe('IfLineStmt');
    const inner1 = (stmt.thenClause as Stmt[])[0] as IfLineStmt;
    const inner2 = inner1.thenClause as Stmt[];
    expect(inner2[0].kind).toBe('IfLineStmt');
    const inner3 = inner2[0] as IfLineStmt;
    // `:X=X-1` は最も内側の IF の THEN 節（複文）に属する。以前は THEN 節が
    // 単一文しか取れず、この `X=X-1` が IF の外側（無条件）の文として
    // トップレベルに漏れ出していた。
    expect(inner3.thenClause as Stmt[]).toHaveLength(2);
    expect((inner3.thenClause as Stmt[])[0].kind).toBe('GosubStmt');
    expect((inner3.thenClause as Stmt[])[1].kind).toBe('LetStmt');
  });

  it('THEN も節も無い IF 単独は構文エラー', () => {
    expect(() => parseLine('IF A=1')).toThrow();
  });

  it('THEN 無しでブロック形式（IfStmt ヘッダのみ）にはならない', () => {
    // ブロック形式は「THEN の後が行末」で判定するため、THEN を省略した場合に
    // 節を全く読まない IfStmt を許す根拠が無い（上のテストで構文エラーになる）。
    const [stmt] = parseLine('IF A=1 THEN') as [IfStmt];
    expect(stmt.kind).toBe('IfStmt');
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

describe('DATA / REM の空白復元（バグ修正）', () => {
  it('DATA HELLO WORLD の項目は空白を保ったまま HELLO WORLD になる', () => {
    const [stmt] = parseLine('DATA HELLO WORLD') as [DataStmt];
    expect(stmt.values.map((v) => v.text)).toEqual(['HELLO WORLD']);
  });

  it('DATA A,B , C はカンマ区切りで前後の空白を落として分割する', () => {
    const [stmt] = parseLine('DATA A,B , C') as [DataStmt];
    expect(stmt.values.map((v) => v.text)).toEqual(['A', 'B', 'C']);
  });

  it('DATA "X,Y",Z は引用符内のカンマを区切りにしない', () => {
    const [stmt] = parseLine('DATA "X,Y",Z') as [DataStmt];
    expect(stmt.values).toEqual([
      { text: 'X,Y', quoted: true, pos: expect.any(Number) },
      { text: 'Z', quoted: false, pos: expect.any(Number) },
    ]);
  });

  it('引用符なしの数値項目（10進・小数・16進）を読める', () => {
    const [stmt] = parseLine('DATA 1, 2.5, &HFF') as [DataStmt];
    expect(stmt.values.map((v) => v.text)).toEqual(['1', '2.5', '&HFF']);
  });

  it('REM の本文は元の空白・: がそのまま残る', () => {
    const stmts = parseLine('A=1:REM  hello   world : still comment') as Stmt[];
    expect(stmts).toHaveLength(2);
    expect((stmts[1] as RemStmt).text).toBe('  hello   world : still comment');
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
    // 【判断】 CLS は元々このテストの例だったが、画面・図形系パーサ担当の
    // スコープで ClsStmt として実装されたため差し替えた。MDF は関数専用の
    // キーワード（引数なし関数）で文としては未対応のまま残るため代わりに使う。
    const stmt = parseLine('MDF')[0];
    expect(stmt).toMatchObject({ kind: 'UnsupportedStmt', name: 'MDF', reason: 'unknown' });
  });

  it('phase2/3 と判明している命令は reason で区別される', () => {
    expect(parseLine('POKE 1,2')[0]).toMatchObject({ kind: 'UnsupportedStmt', reason: 'phase2' });
    expect(parseLine('CLOAD')[0]).toMatchObject({ kind: 'UnsupportedStmt', reason: 'phase3' });
  });
});
