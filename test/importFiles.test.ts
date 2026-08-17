// importFiles（src/ui/library/importFiles.ts）のテスト。
//
// Node 組込みの `File`（Node 20+, undici 経由）を直接使う。ブラウザの `File API` と
// 互換の `arrayBuffer()` が使えるため、DOM（jsdom 等）を用意しなくても検証できる
// （vitest.config.ts の environment は 'node'）。

import { describe, expect, it } from 'vitest';
import { importFiles } from '../src/ui/library/importFiles.ts';

// テストのフィクスチャは自分で書いた数行の BASIC のみを使う
// （`G850/CLAUDE.md` 依頼「第三者の作品を一切入れない」）。

function textFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

function bytesFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type: 'text/plain' });
}

describe('importFiles', () => {
  it('.bas ファイルを取り込める', async () => {
    const { entries, ignoredCount } = await importFiles([textFile('sample.bas', '10 PRINT "HI"')]);
    expect(ignoredCount).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.program).toBe('10 PRINT "HI"');
    expect(entries[0]?.source).toBe('local');
  });

  it('.txt ファイルを取り込める（大文字拡張子も可）', async () => {
    const { entries, ignoredCount } = await importFiles([textFile('sample.TXT', '10 PRINT 1')]);
    expect(ignoredCount).toBe(0);
    expect(entries).toHaveLength(1);
  });

  it('対象外の拡張子は無視し、件数を返す（無言で捨てない）', async () => {
    const { entries, ignoredCount } = await importFiles([
      textFile('readme.md', 'hello'),
      textFile('sample.bas', '10 END'),
      textFile('image.png', 'binary'),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('sample');
    expect(ignoredCount).toBe(2);
  });

  it('タイトルは拡張子を除いたファイル名になる', async () => {
    const { entries } = await importFiles([textFile('MY.GAME.bas', '10 END')]);
    expect(entries[0]?.title).toBe('MY.GAME');
  });

  it('note は空文字で初期化される', async () => {
    const { entries } = await importFiles([textFile('sample.bas', '10 END')]);
    expect(entries[0]?.note).toBe('');
  });

  it('CRLF は \\n に正規化される', async () => {
    const { entries } = await importFiles([textFile('sample.bas', '10 PRINT 1\r\n20 PRINT 2\r\n')]);
    expect(entries[0]?.program).toBe('10 PRINT 1\n20 PRINT 2\n');
  });

  it('CR のみの改行も \\n に正規化される', async () => {
    const { entries } = await importFiles([textFile('sample.bas', '10 PRINT 1\r20 PRINT 2\r')]);
    expect(entries[0]?.program).toBe('10 PRINT 1\n20 PRINT 2\n');
  });

  it('UTF-8 として不正なバイト列（Shift_JIS由来）は Shift_JIS で読み直す', async () => {
    // "10 REM " (ASCII) + Shift_JIS の「あ」(0x82 0xA0) + "\n"
    const { entries } = await importFiles([
      bytesFile('sjis.bas', [0x31, 0x30, 0x20, 0x52, 0x45, 0x4d, 0x20, 0x82, 0xa0, 0x0a]),
    ]);
    expect(entries[0]?.program).toBe('10 REM あ\n');
  });

  it('通常のUTF-8ファイルはそのままUTF-8で読める', async () => {
    const { entries } = await importFiles([textFile('utf8.bas', '10 REM あ')]);
    expect(entries[0]?.program).toBe('10 REM あ');
  });

  it('複数ファイルをまとめて取り込める（idが重複しない）', async () => {
    const { entries } = await importFiles([
      textFile('a.bas', '10 END'),
      textFile('b.bas', '20 END'),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).not.toBe(entries[1]?.id);
  });

  it('空配列を渡すと空の結果になる', async () => {
    const { entries, ignoredCount } = await importFiles([]);
    expect(entries).toEqual([]);
    expect(ignoredCount).toBe(0);
  });
});
