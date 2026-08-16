import { describe, expect, it } from 'vitest';
import { FONT_GLYPH_HEIGHT, FONT_GLYPH_WIDTH, getGlyph } from '../src/machine/font.ts';
import { CELL_HEIGHT, CELL_WIDTH, Screen } from '../src/machine/screen.ts';

/** getGlyph() の列方向5バイトを、セル(6x8)左上詰めの `#`/`.` ダンプ文字列へ変換する（テスト用）。 */
function glyphCellDump(code: number): string {
  const glyph = getGlyph(code);
  const lines: string[] = [];
  for (let y = 0; y < CELL_HEIGHT; y++) {
    let line = '';
    for (let x = 0; x < CELL_WIDTH; x++) {
      const on = x < FONT_GLYPH_WIDTH && y < FONT_GLYPH_HEIGHT && ((glyph[x] >> y) & 1) !== 0;
      line += on ? '#' : '.';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

describe('screen: 基本ドット操作', () => {
  it('pset/preset/point が座標通りに動く', () => {
    const screen = new Screen();
    expect(screen.point(3, 4)).toBe(0);
    screen.pset(3, 4);
    expect(screen.point(3, 4)).toBe(1);
    screen.preset(3, 4);
    expect(screen.point(3, 4)).toBe(0);
  });

  it('pxor は点灯状態を反転する', () => {
    const screen = new Screen();
    screen.pxor(1, 1);
    expect(screen.point(1, 1)).toBe(1);
    screen.pxor(1, 1);
    expect(screen.point(1, 1)).toBe(0);
  });

  it('画面外座標は例外を投げず黙って無視され、pointは常に0を返す', () => {
    const screen = new Screen();
    expect(() => screen.pset(-1, 0)).not.toThrow();
    expect(() => screen.pset(144, 0)).not.toThrow();
    expect(() => screen.pset(0, -1)).not.toThrow();
    expect(() => screen.pset(0, 48)).not.toThrow();
    expect(() => screen.preset(-100, -100)).not.toThrow();
    expect(() => screen.pxor(9999, 9999)).not.toThrow();

    expect(screen.point(-1, 0)).toBe(0);
    expect(screen.point(144, 0)).toBe(0);
    expect(screen.point(0, -1)).toBe(0);
    expect(screen.point(0, 48)).toBe(0);
    expect(screen.point(-100, -100)).toBe(0);
    expect(screen.point(9999, 9999)).toBe(0);
  });
});

describe('screen: putChar', () => {
  it('セル(6x8)を消してから字形(5x7左上詰め)を描く', () => {
    const screen = new Screen();
    screen.putChar(0, 0, 0x23); // '#'
    expect(screen.dumpAscii(0, 0, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x23));
  });

  it('別の文字を同じセルへ描き直すと、前の字形が完全に消える', () => {
    const screen = new Screen();
    screen.putChar(2, 1, 0x23); // 密な字形 '#'
    screen.putChar(2, 1, 0x20); // space（全消灯）→ セルを塗り替える
    const x0 = 2 * CELL_WIDTH;
    const y0 = 1 * CELL_HEIGHT;
    expect(screen.dumpAscii(x0, y0, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x20));
  });
});

describe('screen: テキスト出力とスクロール（遅延スクロール、SCROLL_DEFERRED_UNTIL_NEXT_WRITE）', () => {
  it('最下行での改行の直後は、まだスクロールしていない（保留のみ）', () => {
    const screen = new Screen();
    screen.putChar(0, 0, 0x41); // 'A' at row0
    screen.putChar(0, 1, 0x42); // 'B' at row1

    screen.locate(0, 5); // 最下行
    screen.writeText('\n'); // 最下行での改行 → この時点ではまだスクロールしない

    // row0 の 'A' はまだそのまま残っている（押し出されていない）。
    expect(screen.dumpAscii(0, 0, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x41));
    // row1 の 'B' もまだ元の位置のまま。
    expect(screen.dumpAscii(0, CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x42));
  });

  it('画面行数ちょうど(6行)の出力後は、先頭行が残っている（再現ケース）', () => {
    // main.ts の DEMO_PROGRAM 相当：6行ちょうどの出力で先頭行が消えてはいけない。
    const screen = new Screen();
    screen.writeText('1\n2\n3\n4\n5\nOK');

    // 先頭行(row0)の '1' が押し出されずに残っている。
    expect(screen.dumpAscii(0, 0, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x31));
    // 最終行(row5)には 'OK' の 'O' が書かれている。
    expect(screen.dumpAscii(0, 5 * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x4f));
  });

  it('7行目を書き始めた時点で初めてスクロールする', () => {
    const screen = new Screen();
    screen.putChar(0, 0, 0x41); // 'A' at row0
    screen.putChar(0, 1, 0x42); // 'B' at row1

    screen.locate(0, 5); // 最下行
    screen.writeText('\n'); // 保留
    screen.writeText('C'); // 7行目にあたる最初の1文字 → ここで初めてスクロール

    // row1 にあった 'B' が row0 の位置(y=0)へ詰まっている。
    expect(screen.dumpAscii(0, 0, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x42));
    // 新しい最下行(row5)に 'C' が書かれている。
    expect(screen.dumpAscii(0, 5 * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x43));
  });

  it('最下行で改行した後にlocate()でカーソルを動かすと、スクロールは起きない', () => {
    const screen = new Screen();
    screen.putChar(0, 0, 0x41); // 'A' at row0

    screen.locate(0, 5); // 最下行
    screen.writeText('\n'); // 保留
    screen.locate(0, 2); // カーソル移動 → 保留は解除される
    screen.writeText('Z'); // ここではスクロールしないはず

    // row0 の 'A' はそのまま残っている。
    expect(screen.dumpAscii(0, 0, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x41));
    // 'Z' は移動先(row2)に書かれている。
    expect(screen.dumpAscii(0, 2 * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x5a));
  });

  it('長い出力で複数回スクロールしても正しく流れる（既存動作の回帰確認）', () => {
    const screen = new Screen();
    // 8行ぶん出力（6行の画面に対して2回スクロールが起きるはず）。
    screen.writeText('1\n2\n3\n4\n5\n6\n7\n8');

    // '8'まで書いた時点で先頭行は '3'（1,2は押し出され済み）になっているはず。
    expect(screen.dumpAscii(0, 0, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x33));
    expect(screen.dumpAscii(0, 5 * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x38));
  });

  it('writeText は24桁を超えると自動折り返しする', () => {
    const screen = new Screen();
    const text = 'A'.repeat(25); // 24桁+1
    screen.writeText(text);
    // 25文字目は次行(row1)の col0 に描かれる。
    expect(screen.dumpAscii(0, CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)).toBe(glyphCellDump(0x41));
  });
});

describe('screen: line / rect / fillRect', () => {
  it('水平線', () => {
    const screen = new Screen();
    screen.line(0, 0, 4, 0);
    expect(screen.dumpAscii(0, 0, 5, 1)).toBe('#####');
  });

  it('垂直線', () => {
    const screen = new Screen();
    screen.line(0, 0, 0, 4);
    expect(screen.dumpAscii(0, 0, 1, 5)).toBe('#\n#\n#\n#\n#');
  });

  it('斜め線(45度)', () => {
    const screen = new Screen();
    screen.line(0, 0, 4, 4);
    expect(screen.dumpAscii(0, 0, 5, 5)).toBe(['#....', '.#...', '..#..', '...#.', '....#'].join('\n'));
  });

  it('rect は枠のみを描く', () => {
    const screen = new Screen();
    screen.rect(0, 0, 4, 3);
    expect(screen.dumpAscii(0, 0, 5, 4)).toBe(['#####', '#...#', '#...#', '#####'].join('\n'));
  });

  it('fillRect は矩形を塗りつぶす', () => {
    const screen = new Screen();
    screen.fillRect(0, 0, 2, 1);
    expect(screen.dumpAscii(0, 0, 3, 2)).toBe(['###', '###'].join('\n'));
  });
});

describe('screen: 描画モード R / X', () => {
  it('モードR(消去)は点灯ドットを消灯する', () => {
    const screen = new Screen();
    screen.fillRect(0, 0, 3, 3); // 4x4 全点灯
    screen.fillRect(1, 1, 2, 2, 'R'); // 中央2x2を消去
    expect(screen.dumpAscii(0, 0, 4, 4)).toBe(['####', '#..#', '#..#', '####'].join('\n'));
  });

  it('モードX(反転)は2回適用すると元に戻る', () => {
    const screen = new Screen();
    screen.fillRect(0, 0, 3, 3); // 4x4 全点灯
    const before = screen.dumpAscii(0, 0, 4, 4);
    screen.fillRect(1, 1, 2, 2, 'X'); // 中央2x2を反転（点灯→消灯）
    expect(screen.dumpAscii(0, 0, 4, 4)).toBe(['####', '#..#', '#..#', '####'].join('\n'));
    screen.fillRect(1, 1, 2, 2, 'X'); // もう一度反転で元通り
    expect(screen.dumpAscii(0, 0, 4, 4)).toBe(before);
  });

  it('モードXは消灯ドットに適用すると点灯する', () => {
    const screen = new Screen();
    screen.fillRect(0, 0, 2, 2, 'X');
    expect(screen.dumpAscii(0, 0, 3, 3)).toBe(['###', '###', '###'].join('\n'));
  });
});

describe('screen: circle / paint（不確定仕様のスナップショット）', () => {
  it('全円のパターン塗りつぶし(6=全塗り)は中心を点灯させる', () => {
    const screen = new Screen();
    screen.circle(20, 20, 5, 0, 360, 1, 'S', 6);
    expect(screen.point(20, 20)).toBe(1);
  });

  it('パターン0(塗りなし)の円は中心を点灯させない', () => {
    const screen = new Screen();
    screen.circle(20, 20, 5);
    expect(screen.point(20, 20)).toBe(0);
  });

  it('負角度の扇形は中心へ半径線を引く（現在の暫定仕様のスナップショット）', () => {
    const screen = new Screen();
    screen.circle(20, 20, 5, -90, 0);
    // 中心のすぐ右(半径線の通り道)が点灯しているはず。
    expect(screen.point(20, 20) === 1 || screen.point(21, 20) === 1).toBe(true);
  });

  it('paint は境界に囲まれた領域を塗る', () => {
    const screen = new Screen();
    screen.rect(0, 0, 4, 4);
    screen.paint(2, 2, 6); // パターン6=全塗り
    expect(screen.point(2, 2)).toBe(1);
    // 枠の外は塗られない。
    expect(screen.point(6, 6)).toBe(0);
  });
});
