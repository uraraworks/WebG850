// プログラム入力欄（`#program-input`）と `DirectMode` の `ProgramStore` の同期。
//
// 【判断した点・理由】 入力欄を「現在のプログラムのビュー」として扱う。
// `DirectMode.loadProgram()` は `ProgramStore.clear()` してから取り込む
// （CLOAD 相当の全置換）ため、ディスクライブラリから読み込んだ直後に入力欄が
// 古い内容のまま残っていると、「プログラムに取り込む」ボタンを押した瞬間に
// せっかく読み込んだプログラムが消えてしまう（データ消失。実害の報告あり）。
//
// `main.ts` は DOM 全体（複数パネルやボタン）を結線する大きな関数のため、
// 同期ロジックだけをここへ切り出してテスト可能にする（`main()` 自体は
// DOM 要素の存在検査等に依存しテストから直接叩けないため）。
// `DirectMode` へは入力欄（DOM）の存在を一切知らせない
// （`panel.ts` が `DirectMode` を直接知らないのと同じ、層をまたがせない流儀）。

/** `DirectMode` 側に要求する最小限のインタフェース（テストでは本物を渡してよい）。 */
export interface ProgramSourceHost {
  getProgramSource(): string;
  loadProgram(source: string): void;
}

/** 入力欄（`<textarea>` 等）側に要求する最小限のインタフェース。 */
export interface ProgramInputAdapter {
  getValue(): string;
  setValue(value: string): void;
}

export interface ProgramInputSync {
  /**
   * `host.loadProgram(source)` を呼んだうえで、入力欄を読み込んだ結果へ同期する。
   * ディスクライブラリからの読み込み・起動時のサンプル投入・「プログラムに取り込む」
   * ボタン（自分自身の内容を読み込み直すだけだが、正規化のため通す）はすべて
   * これ1本に集約する（呼び出しが増えるたびに同期を書き足す設計だと、
   * 足し忘れが無症状で通ってしまうため）。
   */
  loadProgramIntoDirectMode(source: string): void;
  /**
   * 「編集」パネルを開いたときに使う。LCD 側の行編集は入力欄からは見えないため
   * 開くたびに追従させたいが、入力欄に未取り込みの編集があるときは、利用者が
   * 書きかけた内容を無言で消さないよう同期をスキップする。
   * 「未取り込みの編集がある」の判定は、こちらが最後に入力欄へ書き込んだ値
   * （`loadProgramIntoDirectMode` 等で書いた値）と現在の入力欄の値が異なるかで行う。
   */
  syncProgramInputIfUntouched(): void;
}

export function createProgramInputSync(host: ProgramSourceHost, input: ProgramInputAdapter): ProgramInputSync {
  // 「最後にこちらが入力欄へ書き込んだ値」。null は「まだ一度も書き込んでいない」。
  let lastSyncedValue: string | null = null;

  function updateProgramInput(): void {
    const source = host.getProgramSource();
    input.setValue(source);
    lastSyncedValue = source;
  }

  function loadProgramIntoDirectMode(source: string): void {
    host.loadProgram(source);
    updateProgramInput();
  }

  function syncProgramInputIfUntouched(): void {
    if (lastSyncedValue !== null && input.getValue() !== lastSyncedValue) {
      return; // 未取り込みの編集あり：上書きしない。
    }
    updateProgramInput();
  }

  return { loadProgramIntoDirectMode, syncProgramInputIfUntouched };
}
