/**
 * ライブラリパネル（「棚」）の DOM 構築と描画。
 *
 * 同一作者の WebX68k と同じ流儀（`#library-panel` ＋ `.panel-switch-btn` の開閉ボタン、
 * 既存のコピペ用パネル・仮想キーボードと排他）に揃える。配線は `index.html` /
 * `ui/main.ts` 側で行う。
 *
 * 【判断した点・理由】 このファイルは `DirectMode` を直接知らない（依頼どおり）。
 * 行クリックでの読み込みは `LibraryPanelContext.onLoadProgram` コールバック経由で
 * 外（`main.ts`）へ渡し、そこで `directMode.loadProgram()` を呼ぶ形にする。
 *
 * 【絶対の制約（権利）】 ここで扱う `LibraryEntry.program` はユーザーが自分のブラウザへ
 * 取り込んだファイルの内容であり、`LibraryStore`（localStorage）にのみ保存される。
 * リポジトリにもサーバにも一切送信・保存しない。
 */

import { importFiles } from './importFiles.ts';
import type { LibraryEntry, LibraryStore } from './types.ts';

export interface LibraryPanelContext {
  readonly store: LibraryStore;
  /** 行クリック時に呼ぶ。`DirectMode.loadProgram` への配線は呼び出し元（`main.ts`）が行う。 */
  readonly onLoadProgram: (program: string) => void;
}

const IGNORED_NOTICE_DURATION_MS = 3200;

/**
 * `DataTransferItem`（ドロップされた項目）から再帰的に `File` を集める。
 * フォルダ丸ごとのドラッグ＆ドロップ（依頼）に対応するため、`webkitGetAsEntry()` で
 * 得られる `FileSystemEntry` ツリーを辿る。非対応ブラウザでは `item.getAsFile()` の
 * 単一ファイルへフォールバックする。
 */
async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items);
  const hasEntrySupport = items.some(
    (item) => typeof (item as unknown as { webkitGetAsEntry?: unknown }).webkitGetAsEntry === 'function',
  );
  if (!hasEntrySupport) {
    return Array.from(dataTransfer.files);
  }

  const entries = items
    .map((item) => (item as unknown as { webkitGetAsEntry(): FileSystemEntryLike | null }).webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntryLike => entry !== null);

  const files: File[] = [];
  await Promise.all(entries.map((entry) => walkEntry(entry, files)));
  return files;
}

/** `webkitGetAsEntry()` が返す型。lib.dom.d.ts に無いためここで最小限に定義する。 */
interface FileSystemEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  file(callback: (file: File) => void): void;
  createReader(): {
    readEntries(callback: (entries: FileSystemEntryLike[]) => void): void;
  };
}

async function walkEntry(entry: FileSystemEntryLike, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve) => entry.file(resolve));
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries は一度に全件を返さない実装があるため、空配列が返るまで呼び続ける。
    let batch: FileSystemEntryLike[];
    do {
      batch = await new Promise<FileSystemEntryLike[]>((resolve) => reader.readEntries(resolve));
      await Promise.all(batch.map((child) => walkEntry(child, out)));
    } while (batch.length > 0);
  }
}

function formatAddedAt(addedAt: number): string {
  const date = new Date(addedAt);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function attachLibraryPanel(container: HTMLElement, ctx: LibraryPanelContext): void {
  container.innerHTML = '';

  const note = document.createElement('p');
  note.className = 'library-panel__note';
  note.textContent =
    'お手元の BASIC プログラム（.txt / .bas）を取り込むと一覧に並びます。行をクリックするとプログラムに読み込まれます（実行は操作バーの RUN で行ってください）。取り込んだ内容はこの端末のブラウザ内にのみ保存され、外部へは送信されません。';
  container.appendChild(note);

  const toolbar = document.createElement('div');
  toolbar.className = 'library-panel__toolbar';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.txt,.bas';
  fileInput.className = 'library-panel__file-input';
  fileInput.id = 'library-file-input';
  fileInput.setAttribute('aria-label', 'ファイルを選択して取り込む');

  const fileLabel = document.createElement('label');
  fileLabel.className = 'control-bar__button library-panel__file-label';
  fileLabel.htmlFor = fileInput.id;
  fileLabel.textContent = 'ファイルを選択';

  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  // webkitdirectory は標準の HTMLInputElement 型定義に無いため属性で付与する。
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.className = 'library-panel__file-input';
  folderInput.id = 'library-folder-input';
  folderInput.setAttribute('aria-label', 'フォルダを選択して取り込む');

  const folderLabel = document.createElement('label');
  folderLabel.className = 'control-bar__button library-panel__file-label';
  folderLabel.htmlFor = folderInput.id;
  folderLabel.textContent = 'フォルダを選択';

  toolbar.appendChild(fileInput);
  toolbar.appendChild(fileLabel);
  toolbar.appendChild(folderInput);
  toolbar.appendChild(folderLabel);
  container.appendChild(toolbar);

  const ignoredNotice = document.createElement('p');
  ignoredNotice.className = 'library-panel__ignored-notice';
  ignoredNotice.setAttribute('aria-live', 'polite');
  container.appendChild(ignoredNotice);
  let ignoredNoticeTimer: number | null = null;
  const showIgnoredNotice = (ignoredCount: number): void => {
    if (ignoredCount <= 0) return;
    ignoredNotice.textContent = `対象外のファイル（.txt / .bas 以外）を ${ignoredCount} 件無視しました。`;
    ignoredNotice.classList.add('library-panel__ignored-notice--visible');
    if (ignoredNoticeTimer !== null) window.clearTimeout(ignoredNoticeTimer);
    ignoredNoticeTimer = window.setTimeout(() => {
      ignoredNotice.classList.remove('library-panel__ignored-notice--visible');
      ignoredNoticeTimer = null;
    }, IGNORED_NOTICE_DURATION_MS);
  };

  const list = document.createElement('ul');
  list.className = 'library-panel__list';
  container.appendChild(list);

  const empty = document.createElement('p');
  empty.className = 'library-panel__empty';
  empty.textContent = '取り込んだプログラムはまだありません。上のボタン、またはこのパネルへのドラッグ＆ドロップでファイル（フォルダ丸ごとも可）を取り込めます。';
  container.appendChild(empty);

  function renderList(): void {
    const entries = ctx.store.list();
    list.innerHTML = '';
    empty.classList.toggle('hidden', entries.length > 0);
    for (const entry of entries) {
      list.appendChild(buildRow(entry));
    }
  }

  function buildRow(entry: LibraryEntry): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'library-panel__row';

    const main = document.createElement('div');
    main.className = 'library-panel__row-main';
    main.setAttribute('role', 'button');
    main.tabIndex = 0;
    main.setAttribute('aria-label', `${entry.title} を読み込む`);

    const title = document.createElement('span');
    title.className = 'library-panel__row-title';
    title.textContent = entry.title;

    const addedAt = document.createElement('span');
    addedAt.className = 'library-panel__row-added-at';
    addedAt.textContent = formatAddedAt(entry.addedAt);

    main.appendChild(title);
    main.appendChild(addedAt);

    const load = (): void => ctx.onLoadProgram(entry.program);
    main.addEventListener('click', load);
    main.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        load();
      }
    });

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'library-panel__row-note';
    noteInput.placeholder = 'メモ';
    noteInput.value = entry.note;
    noteInput.addEventListener('change', () => {
      ctx.store.update(entry.id, { note: noteInput.value });
    });
    // 行クリックでの読み込みに巻き込まれないよう、メモ欄内でのクリックは伝播させない。
    noteInput.addEventListener('click', (e) => e.stopPropagation());

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'library-panel__row-remove';
    removeButton.textContent = '削除';
    removeButton.setAttribute('aria-label', `${entry.title} を削除`);
    removeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.store.remove(entry.id);
      renderList();
    });

    row.appendChild(main);
    row.appendChild(noteInput);
    row.appendChild(removeButton);
    return row;
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    const { entries, ignoredCount } = await importFiles(Array.from(files));
    ctx.store.add(entries);
    showIgnoredNotice(ignoredCount);
    renderList();
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files === null || fileInput.files.length === 0) return;
    void handleFiles(fileInput.files).finally(() => {
      fileInput.value = '';
    });
  });
  folderInput.addEventListener('change', () => {
    if (folderInput.files === null || folderInput.files.length === 0) return;
    void handleFiles(folderInput.files).finally(() => {
      folderInput.value = '';
    });
  });

  // パネル全体をドロップ領域にする（依頼「フォルダのドラッグ＆ドロップに対応」）。
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    container.classList.add('library-panel--dragover');
  });
  container.addEventListener('dragleave', () => {
    container.classList.remove('library-panel--dragover');
  });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.classList.remove('library-panel--dragover');
    if (e.dataTransfer === null) return;
    void collectFilesFromDataTransfer(e.dataTransfer).then((files) => handleFiles(files));
  });

  renderList();
}
