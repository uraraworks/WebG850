/**
 * `File[]` → `LibraryEntry[]` の変換。ファイル選択ダイアログ・フォルダのドラッグ＆
 * ドロップ、どちらの入力元（`panel.ts`）から呼ばれても同じロジックを通す。
 *
 * 【判断した点・理由】 対象拡張子（`.txt` `.bas`）以外は無言で捨てず、無視した件数を
 * `ignoredCount` として呼び出し元へ返す（`G850/CLAUDE.md` の「未実装・不採用は無言に
 * しない」方針）。`panel.ts` 側でこの件数を利用者へ表示する。
 *
 * 文字コードは実機由来のファイルが CP932（Shift_JIS）のことがあるため、まず UTF-8 で
 * デコードして置換文字（U+FFFD）が含まれていたら Shift_JIS で読み直す
 * （UTF-8 は不正バイト列を検出できるが、CP932 のテキストはほぼ確実に不正 UTF-8
 * バイト列になるため、この判定で十分実用になる）。
 */

import type { LibraryEntry } from './types.ts';

const ACCEPTED_EXTENSIONS = ['.txt', '.bas'];

export interface ImportFilesResult {
  readonly entries: LibraryEntry[];
  /** 対象拡張子（.txt/.bas）以外だったために無視したファイル数。 */
  readonly ignoredCount: number;
}

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 拡張子を除いたファイル名（タイトルに使う）。 */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

/** 改行を `\n` へ正規化する（CRLF・CR 両対応）。 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** UTF-8 で読み、置換文字が出たら Shift_JIS（CP932）で読み直す。 */
function decodeText(buffer: ArrayBuffer): string {
  const utf8Text = new TextDecoder('utf-8').decode(buffer);
  if (!utf8Text.includes('�')) {
    return utf8Text;
  }
  try {
    return new TextDecoder('shift_jis').decode(buffer);
  } catch {
    // Shift_JIS デコーダ自体が使えない実行環境ではあきらめて UTF-8 の結果を返す
    // （置換文字混じりのまま表示されるが、取り込み自体は継続する）。
    return utf8Text;
  }
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // crypto.randomUUID が無い実行環境向けの簡易フォールバック。
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function importFiles(files: readonly File[]): Promise<ImportFilesResult> {
  const entries: LibraryEntry[] = [];
  let ignoredCount = 0;

  for (const file of files) {
    if (!hasAcceptedExtension(file.name)) {
      ignoredCount++;
      continue;
    }
    const buffer = await file.arrayBuffer();
    const program = normalizeNewlines(decodeText(buffer));
    entries.push({
      id: makeId(),
      title: stripExtension(file.name),
      note: '',
      program,
      source: 'local',
      addedAt: Date.now(),
    });
  }

  return { entries, ignoredCount };
}
