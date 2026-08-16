// 画面・図形系／ダイレクトコマンド系の文パーサのテスト。
// docs/design/phase1_grammar.md「文」節・docs/spec/basic_commands.yaml の
// 該当エントリの format に対応するかを構造レベルで確認する。

import { describe, expect, it } from 'vitest';
import type {
  AutoStmt,
  BeepStmt,
  CircleStmt,
  DeleteStmt,
  GprintStmt,
  LineStmt,
  ListStmt,
  LocateStmt,
  RenumStmt,
  RunStmt,
  Stmt,
} from '../src/basic/ast.js';
import { Cursor, parseStatementList } from '../src/basic/parser.js';
import { tokenize } from '../src/basic/tokenizer.js';

/** 1行分のソースを最後まで消費する形で文リストにパースする（テスト便宜）。 */
function parseLine(source: string): Stmt[] {
  const cursor = new Cursor(tokenize(source), source);
  return parseStatementList(cursor);
}

describe('LINE', () => {
  it('始点省略形（グラフィックカーソル位置を使う）', () => {
    const [stmt] = parseLine('LINE-(10,20)') as [LineStmt];
    expect(stmt.kind).toBe('LineStmt');
    expect(stmt.from).toBeNull();
    expect(stmt.to).toMatchObject({ x: { value: 10 }, y: { value: 20 } });
  });

  it('始点あり', () => {
    const [stmt] = parseLine('LINE(0,0)-(10,20)') as [LineStmt];
    expect(stmt.from).toMatchObject({ x: { value: 0 }, y: { value: 0 } });
    expect(stmt.to).toMatchObject({ x: { value: 10 }, y: { value: 20 } });
  });

  it(',B 付き（描画モード・線種は省略）', () => {
    const [stmt] = parseLine('LINE(0,0)-(10,20),,,B') as [LineStmt];
    expect(stmt.mode).toBeNull();
    expect(stmt.lineStyle).toBeNull();
    expect(stmt.box).toBe('B');
  });

  it(',BF 付き', () => {
    const [stmt] = parseLine('LINE(0,0)-(10,20),,,BF') as [LineStmt];
    expect(stmt.box).toBe('BF');
  });

  it('描画モード付き（S|R|X）', () => {
    const [stmt] = parseLine('LINE(0,0)-(10,20),X') as [LineStmt];
    expect(stmt.mode).toBe('X');
    expect(stmt.lineStyle).toBeNull();
    expect(stmt.box).toBeNull();
  });

  it('描画モード・線種の両方を指定', () => {
    const [stmt] = parseLine('LINE(0,0)-(10,20),R,&HF0') as [LineStmt];
    expect(stmt.mode).toBe('R');
    expect(stmt.lineStyle).toMatchObject({ kind: 'NumberLiteral' });
  });

  describe('末尾スロット（モード/線種/矩形）を内容で判定（不確定仕様 LINE_TRAILING_SLOTS_BY_CONTENT）', () => {
    it(',B のように空スロットのカンマを省いて矩形だけ直接指定できる', () => {
      const [stmt] = parseLine('LINE(0,0)-(10,20),B') as [LineStmt];
      expect(stmt.mode).toBeNull();
      expect(stmt.lineStyle).toBeNull();
      expect(stmt.box).toBe('B');
    });

    it(',BF のように空スロットのカンマを省いて矩形だけ直接指定できる', () => {
      const [stmt] = parseLine('LINE(0,0)-(10,20),BF') as [LineStmt];
      expect(stmt.box).toBe('BF');
    });

    it(',,B（モードだけ空スロット）でも矩形として読める（線種の変数参照に誤読しない）', () => {
      const [stmt] = parseLine('LINE(0,0)-(10,20),,B') as [LineStmt];
      expect(stmt.mode).toBeNull();
      expect(stmt.lineStyle).toBeNull();
      expect(stmt.box).toBe('B');
    });

    it('モードスロットに矩形指定を書いても矩形として読める（,B,,のような並び）', () => {
      const [stmt] = parseLine('LINE(0,0)-(10,20),B,,') as [LineStmt];
      expect(stmt.box).toBe('B');
    });

    it('同じ種類のスロットが2回現れたら構文エラー', () => {
      expect(() => parseLine('LINE(0,0)-(10,20),B,,BF')).toThrow();
    });
  });
});

describe('CIRCLE', () => {
  it('半径のみ（残りは全省略）', () => {
    const [stmt] = parseLine('CIRCLE(10,10),5') as [CircleStmt];
    expect(stmt.startAngle).toBeNull();
    expect(stmt.endAngle).toBeNull();
    expect(stmt.aspect).toBeNull();
    expect(stmt.mode).toBeNull();
    expect(stmt.pattern).toBeNull();
  });

  it('引数を空のまま飛ばす（開始角・終了角・縦横比を省略しモードだけ指定）', () => {
    const [stmt] = parseLine('CIRCLE(10,10),5,,,,X') as [CircleStmt];
    expect(stmt.startAngle).toBeNull();
    expect(stmt.endAngle).toBeNull();
    expect(stmt.aspect).toBeNull();
    expect(stmt.mode).toBe('X');
    expect(stmt.pattern).toBeNull();
  });

  it('「省略」と「0を指定」が区別できる', () => {
    const [stmt] = parseLine('CIRCLE(10,10),5,0,0,0') as [CircleStmt];
    expect(stmt.startAngle).toMatchObject({ kind: 'NumberLiteral', value: 0 });
    expect(stmt.endAngle).toMatchObject({ kind: 'NumberLiteral', value: 0 });
    expect(stmt.aspect).toMatchObject({ kind: 'NumberLiteral', value: 0 });
    // 比較: 全省略なら null のまま
    const [stmtOmitted] = parseLine('CIRCLE(10,10),5,,,') as [CircleStmt];
    expect(stmtOmitted.startAngle).toBeNull();
    expect(stmtOmitted.endAngle).toBeNull();
    expect(stmtOmitted.aspect).toBeNull();
  });

  it('全項目指定', () => {
    const [stmt] = parseLine('CIRCLE(71,23),20,-45,-135,2,S,3') as [CircleStmt];
    // 負角度は単項マイナスの UnaryOp になる（式パーサ側の既定動作）。
    expect(stmt.startAngle).toMatchObject({ kind: 'UnaryOp', op: '-', operand: { value: 45 } });
    expect(stmt.endAngle).toMatchObject({ kind: 'UnaryOp', op: '-', operand: { value: 135 } });
    expect(stmt.aspect).toMatchObject({ value: 2 });
    expect(stmt.mode).toBe('S');
    expect(stmt.pattern).toMatchObject({ value: 3 });
  });
});

describe('LOCATE', () => {
  it('桁のみ', () => {
    const [stmt] = parseLine('LOCATE 5') as [LocateStmt];
    expect(stmt.col).toMatchObject({ value: 5 });
    expect(stmt.row).toBeNull();
  });

  it('桁と行', () => {
    const [stmt] = parseLine('LOCATE 5,2') as [LocateStmt];
    expect(stmt.col).toMatchObject({ value: 5 });
    expect(stmt.row).toMatchObject({ value: 2 });
  });
});

describe('GCURSOR / PSET / PRESET / PAINT', () => {
  it('GCURSOR (<x>,<y>)', () => {
    const [stmt] = parseLine('GCURSOR (10,20)');
    expect(stmt).toMatchObject({ kind: 'GcursorStmt', x: { value: 10 }, y: { value: 20 } });
  });

  it('PSET は X オプション無し', () => {
    const [stmt] = parseLine('PSET (1,2)');
    expect(stmt).toMatchObject({ kind: 'PsetStmt', invert: false });
  });

  it('PSET (<x>,<y>),X で反転', () => {
    const [stmt] = parseLine('PSET (1,2),X');
    expect(stmt).toMatchObject({ kind: 'PsetStmt', invert: true });
  });

  it('PRESET (<x>,<y>)', () => {
    const [stmt] = parseLine('PRESET (1,2)');
    expect(stmt).toMatchObject({ kind: 'PresetStmt' });
  });

  it('PAINT (<x>,<y>),<パターン>', () => {
    const [stmt] = parseLine('PAINT (1,2),3');
    expect(stmt).toMatchObject({ kind: 'PaintStmt', pattern: { value: 3 } });
  });
});

describe('GPRINT', () => {
  it('ビットパターン列（;区切り）', () => {
    const [stmt] = parseLine('GPRINT &HFF;&H0F;16') as [GprintStmt];
    expect(stmt.items).toHaveLength(3);
    expect(stmt.items[0]).toMatchObject({ sep: null });
    expect(stmt.items[1]).toMatchObject({ sep: ';' });
  });

  it('文字列（16進文字列）指定', () => {
    const [stmt] = parseLine('GPRINT "FF0F"') as [GprintStmt];
    expect(stmt.items).toHaveLength(1);
    expect(stmt.items[0]?.value).toMatchObject({ kind: 'StringLiteral', value: 'FF0F' });
  });

  it('引数なしはカーソルを1ドット下げるだけ（items が空）', () => {
    const [stmt] = parseLine('GPRINT') as [GprintStmt];
    expect(stmt.items).toHaveLength(0);
  });

  it('末尾に区切り記号が無ければ trailingSep は null', () => {
    const [stmt] = parseLine('GPRINT &HFF') as [GprintStmt];
    expect(stmt.trailingSep).toBeNull();
  });

  it('末尾 ; は trailingSep に保持される（カーソル位置保持の合図）', () => {
    const [stmt] = parseLine('GPRINT &HFF;') as [GprintStmt];
    expect(stmt.items).toHaveLength(1);
    expect(stmt.trailingSep).toBe(';');
  });

  it('末尾 , は trailingSep に保持される（1ドット隙間の合図）', () => {
    const [stmt] = parseLine('GPRINT &HFF,') as [GprintStmt];
    expect(stmt.items).toHaveLength(1);
    expect(stmt.trailingSep).toBe(',');
  });
});

describe('BEEP / WAIT / RANDOMIZE / CLS / LCOPY', () => {
  it('BEEP 回数のみ', () => {
    const [stmt] = parseLine('BEEP 3') as [BeepStmt];
    expect(stmt.count).toMatchObject({ value: 3 });
    expect(stmt.pitch).toBeNull();
    expect(stmt.duration).toBeNull();
  });

  it('BEEP 回数,音程を省略,持続時間', () => {
    const [stmt] = parseLine('BEEP 3,,100') as [BeepStmt];
    expect(stmt.pitch).toBeNull();
    expect(stmt.duration).toMatchObject({ value: 100 });
  });

  it('WAIT 引数なし', () => {
    const [stmt] = parseLine('WAIT');
    expect(stmt).toMatchObject({ kind: 'WaitStmt', value: null });
  });

  it('WAIT 64', () => {
    const [stmt] = parseLine('WAIT 64');
    expect(stmt).toMatchObject({ kind: 'WaitStmt', value: { value: 64 } });
  });

  it('CLS / RANDOMIZE は単独文', () => {
    expect(parseLine('CLS')[0]).toMatchObject({ kind: 'ClsStmt' });
    expect(parseLine('RANDOMIZE')[0]).toMatchObject({ kind: 'RandomizeStmt' });
  });

  it('LCOPY <開始行>,<終了行>,<コピー先行>', () => {
    const [stmt] = parseLine('LCOPY 100,200,500');
    expect(stmt).toMatchObject({
      kind: 'LcopyStmt',
      fromLine: { value: 100 },
      toLine: { value: 200 },
      destLine: { value: 500 },
    });
  });
});

describe('RUN / LIST', () => {
  it('RUN 引数なし', () => {
    const [stmt] = parseLine('RUN') as [RunStmt];
    expect(stmt.target).toBeNull();
  });

  it('RUN 100', () => {
    const [stmt] = parseLine('RUN 100') as [RunStmt];
    expect(stmt.target).toMatchObject({ kind: 'LineNumberTarget', value: 100 });
  });

  it('RUN "LBL"', () => {
    const [stmt] = parseLine('RUN "LBL"') as [RunStmt];
    expect(stmt.target).toMatchObject({ kind: 'LabelTarget', name: 'LBL' });
  });

  it('LIST も同様に飛び先を取れる', () => {
    const [stmt] = parseLine('LIST 100') as [ListStmt];
    expect(stmt.target).toMatchObject({ kind: 'LineNumberTarget', value: 100 });
  });
});

describe('NEW / CONT / TRON / TROFF / DEGREE / RADIAN / GRAD / PASS', () => {
  it('引数なしコマンドはそれぞれの単独ノードになる', () => {
    expect(parseLine('NEW')[0]).toMatchObject({ kind: 'NewStmt' });
    expect(parseLine('CONT')[0]).toMatchObject({ kind: 'ContStmt' });
    expect(parseLine('TRON')[0]).toMatchObject({ kind: 'TronStmt' });
    expect(parseLine('TROFF')[0]).toMatchObject({ kind: 'TroffStmt' });
    expect(parseLine('DEGREE')[0]).toMatchObject({ kind: 'DegreeStmt' });
    expect(parseLine('RADIAN')[0]).toMatchObject({ kind: 'RadianStmt' });
    expect(parseLine('GRAD')[0]).toMatchObject({ kind: 'GradStmt' });
  });

  it('PASS "<パスワード>"', () => {
    const [stmt] = parseLine('PASS "SECRET"');
    expect(stmt).toMatchObject({ kind: 'PassStmt', password: { kind: 'StringLiteral', value: 'SECRET' } });
  });
});

describe('AUTO', () => {
  it('全省略', () => {
    const [stmt] = parseLine('AUTO') as [AutoStmt];
    expect(stmt.startLine).toBeNull();
    expect(stmt.increment).toBeNull();
  });

  it('開始行番号のみ', () => {
    const [stmt] = parseLine('AUTO 100') as [AutoStmt];
    expect(stmt.startLine).toMatchObject({ value: 100 });
    expect(stmt.increment).toBeNull();
  });

  it('開始行番号と増分', () => {
    const [stmt] = parseLine('AUTO 100,5') as [AutoStmt];
    expect(stmt.startLine).toMatchObject({ value: 100 });
    expect(stmt.increment).toMatchObject({ value: 5 });
  });
});

describe('DELETE', () => {
  it('全省略', () => {
    const [stmt] = parseLine('DELETE') as [DeleteStmt];
    expect(stmt.start).toBeNull();
    expect(stmt.end).toBeNull();
    expect(stmt.hasDash).toBe(false);
  });

  it('単一行', () => {
    const [stmt] = parseLine('DELETE 100') as [DeleteStmt];
    expect(stmt.start).toMatchObject({ value: 100 });
    expect(stmt.end).toBeNull();
    expect(stmt.hasDash).toBe(false);
  });

  it('範囲指定', () => {
    const [stmt] = parseLine('DELETE 100-200') as [DeleteStmt];
    expect(stmt.start).toMatchObject({ value: 100 });
    expect(stmt.end).toMatchObject({ value: 200 });
    expect(stmt.hasDash).toBe(true);
  });

  it('以降全部（DELETE 100-）', () => {
    const [stmt] = parseLine('DELETE 100-') as [DeleteStmt];
    expect(stmt.start).toMatchObject({ value: 100 });
    expect(stmt.end).toBeNull();
    expect(stmt.hasDash).toBe(true);
  });

  it('先頭から（DELETE -200）', () => {
    const [stmt] = parseLine('DELETE -200') as [DeleteStmt];
    expect(stmt.start).toBeNull();
    expect(stmt.end).toMatchObject({ value: 200 });
    expect(stmt.hasDash).toBe(true);
  });
});

describe('RENUM', () => {
  it('全省略', () => {
    const [stmt] = parseLine('RENUM') as [RenumStmt];
    expect(stmt.oldLine).toBeNull();
    expect(stmt.newLine).toBeNull();
    expect(stmt.increment).toBeNull();
  });

  it('旧行番号のみ', () => {
    const [stmt] = parseLine('RENUM 100') as [RenumStmt];
    expect(stmt.oldLine).toMatchObject({ value: 100 });
    expect(stmt.newLine).toBeNull();
    expect(stmt.increment).toBeNull();
  });

  it('旧行番号・新行番号・増分', () => {
    const [stmt] = parseLine('RENUM 100,500,20') as [RenumStmt];
    expect(stmt.oldLine).toMatchObject({ value: 100 });
    expect(stmt.newLine).toMatchObject({ value: 500 });
    expect(stmt.increment).toMatchObject({ value: 20 });
  });

  it('新行番号を省略し増分だけ指定', () => {
    const [stmt] = parseLine('RENUM 100,,20') as [RenumStmt];
    expect(stmt.newLine).toBeNull();
    expect(stmt.increment).toMatchObject({ value: 20 });
  });
});
