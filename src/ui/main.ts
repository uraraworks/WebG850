// エントリポイント。
// machine/screen・ui/canvas の結線に加え、プログラム入力欄パネルと RUN/BREAK/LIST
// ボタンを結線する。
//
// 【判断した点・理由】 以前は「LCD 直接入力（`DirectMode`）」と「入力欄＋RUN/BREAK/LIST
// ボタン（旧 `ui/app.ts` の `App`）」が別々の `Interpreter`/`Runtime` を持つ、
// 完全に独立した2本の実行経路だった。今回、RUN/LIST ボタンを「LCD へそのコマンドを
// キーボードで打って Enter を押したのと同じ経路」（`DirectMode.runCommand`）に
// 統合したことで `App` は不要になったため削除した。実行経路は `DirectMode` の
// 1本だけになる（依頼「別経路のまま両方を維持しないこと」）。
// 入力欄は実行系を持たず、「プログラムに取り込む」ボタンで `DirectMode` の
// `ProgramStore` へ書き込むだけの、コピペ用の補助パネルという位置づけにした。

import { Machine } from '../machine/machine.ts';
import type { Screen } from '../machine/screen.ts';
import { attachCanvas } from './canvas.ts';
import { DirectMode } from './directMode.ts';
import { dispatchKeydown, isFormControlTarget } from './keyRouting.ts';
import { LocalStorageLibraryStore } from './library/localStorageLibraryStore.ts';
import { attachLibraryPanel } from './library/panel.ts';
import { LocalStorageByteStorage } from './memoryStorage.ts';
import { attachVirtualKeyboard } from './virtualKeyboard.ts';

const FIRST_ASCII = 0x20;
const LAST_ASCII = 0x7e;

/**
 * 起動確認用テストパターン：全95文字のフォント一覧＋枠線・円・塗りつぶし。
 *
 * 【判断した点・理由】 「テストパターンは残すか消すか任せる」との指示に対し、
 * **残す**を選んだ。font.ts/screen.ts の見た目の崩れに気づける起動時の
 * セルフチェックとして引き続き有用なため。BASIC プログラムの実行結果は
 * このパターンに続けて（画面下端からのスクロールで）表示される。
 */
function drawTestPattern(screen: Screen): void {
  screen.cls();

  // 上4行(0〜3行目, 24桁×4行=96セル)へ ASCII 0x20〜0x7E (95文字) を敷き詰める。
  let text = '';
  for (let code = FIRST_ASCII; code <= LAST_ASCII; code++) {
    text += String.fromCharCode(code);
  }
  screen.writeText(text);

  // 下段(y=32〜47の16ドット帯)に図形サンプルを並べる。
  const bandTop = 32;
  const bandBottom = 47;

  // 枠線のみの矩形
  screen.rect(2, bandTop + 2, 32, bandBottom - 1);

  // 塗りつぶし矩形
  screen.fillRect(40, bandTop + 2, 58, bandBottom - 1);

  // 円（枠のみ）
  screen.circle(75, bandTop + 8, 7);

  // 円（パターン6=全塗り）
  screen.circle(96, bandTop + 8, 7, 0, 360, 1, 'S', 6);

  // 枠を描いてから PAINT で塗る（パターン2=縦線）
  screen.rect(110, bandTop + 2, 141, bandBottom - 1);
  screen.paint(125, bandTop + 8, 2);
}

/**
 * プログラム入力欄の初期値（起動時デモ）。
 *
 * 【直した点・理由】 カーソルを置く時点で保留中のスクロールを解決するよう
 * 直したことで（`src/machine/screen.ts` の `resolveScrollForCursorPlacement`
 * 参照）、入力待ちに戻った瞬間にもう1行分スクロールするようになった。
 * 以前は `FOR I=1 TO 5` だったが、それだと最終行のカーソル用にもう1行必要になり
 * 出力の先頭行が画面から欠けてしまう。実機ブラウザで実際に表示させて確認しながら
 * `TO 3` まで減らし、"RUN" の実行結果とカーソル行が画面（6行）に収まるようにした。
 *
 * 【直した点・理由】 以前は最終行が `PRINT "OK"` で、実行後に `DirectMode` が
 * 出すシステムのプロンプト（`uncertain.ts` の `DIRECT_MODE_PROMPT`、既定 `OK`）と
 * 同じ文字列が並び、「OK が2行あるが正しいのか」と利用者を混乱させた
 * （デモの出力文字列とシステム表示は無関係だが、たまたま同じ語だったため紛らわしい）。
 * デモ側の文字列を別のものに変えて区別できるようにする。
 */
const SAMPLE_PROGRAM = '10 FOR I=1 TO 3\n20 PRINT I\n30 NEXT I\n40 PRINT "DONE"';

function main(): void {
  // ページ全体のレイアウト（背景色・ヘッダー/フッター配置等）は `src/ui/style.css` に
  // 委譲する。ここでは canvas の結線のみを行う。
  const canvas = document.querySelector<HTMLCanvasElement>('#screen');
  if (canvas === null) {
    throw new Error('#screen canvas が見つかりません');
  }
  const programInput = document.querySelector<HTMLTextAreaElement>('#program-input');
  if (programInput === null) {
    throw new Error('#program-input が見つかりません');
  }
  const runButton = document.querySelector<HTMLButtonElement>('#btn-run');
  const breakButton = document.querySelector<HTMLButtonElement>('#btn-break');
  const listButton = document.querySelector<HTMLButtonElement>('#btn-list');
  const modeButton = document.querySelector<HTMLButtonElement>('#btn-mode');
  if (runButton === null || breakButton === null || listButton === null || modeButton === null) {
    throw new Error('操作ボタン（RUN/BREAK/LIST/BASIC）が見つかりません');
  }
  const modeIndicator = document.querySelector<HTMLDivElement>('#mode-indicator');
  if (modeIndicator === null) {
    throw new Error('#mode-indicator が見つかりません');
  }
  const panelToggleButton = document.querySelector<HTMLButtonElement>('#btn-panel-editor');
  const editorPanel = document.querySelector<HTMLDivElement>('#editor-panel');
  const loadProgramButton = document.querySelector<HTMLButtonElement>('#btn-load-program');
  if (panelToggleButton === null || editorPanel === null || loadProgramButton === null) {
    throw new Error('入力欄パネル（編集ボタン／パネル本体／取り込みボタン）が見つかりません');
  }
  const keyboardToggleButton = document.querySelector<HTMLButtonElement>('#btn-panel-keyboard');
  const virtualKeyboardPanel = document.querySelector<HTMLDivElement>('#virtual-keyboard');
  if (keyboardToggleButton === null || virtualKeyboardPanel === null) {
    throw new Error('仮想キーボード（開閉ボタン／パネル本体）が見つかりません');
  }
  const libraryToggleButton = document.querySelector<HTMLButtonElement>('#btn-panel-library');
  const libraryPanel = document.querySelector<HTMLDivElement>('#library-panel');
  if (libraryToggleButton === null || libraryPanel === null) {
    throw new Error('ディスクライブラリ（開閉ボタン／パネル本体）が見つかりません');
  }
  const unsupportedNotice = document.querySelector<HTMLDivElement>('#unsupported-notice');
  if (unsupportedNotice === null) {
    throw new Error('#unsupported-notice が見つかりません');
  }

  const machine = new Machine();
  // PEEK/POKE（ハイスコア保存用途）を localStorage へ永続化する。
  // 利用不可の環境（プライベートブラウズ等で例外を投げる場合）でも起動を止めない。
  try {
    machine.attachMemoryStorage(new LocalStorageByteStorage());
  } catch {
    // 永続化なしで続行（既定の揮発性ストレージのまま）。
  }
  drawTestPattern(machine.screen);

  // `directMode` は下で構築するが、canvas のカーソル描画コールバックは
  // 先に結線しておきたいため、参照だけ先に確保しておく
  // （実際に呼ばれるのは render() 実行時＝構築後なので問題ない）。
  let directMode: DirectMode | null = null;

  const { render, resize } = attachCanvas(canvas, machine.screen, {
    getCursor: () => directMode?.getCursorOverlay() ?? null,
  });

  /**
   * `DirectMode` へ渡す再描画コールバック。canvas の再描画に加えて、
   * モードインジケータ（RUN/PRO の点灯状態）も毎回更新する。DirectMode 側の
   * 状態変化（行編集・モード切替・実行完了等）はすべてこの1つの `render` を
   * 経由するため、ここへ1箇所差し込むだけで漏れなく追従する。
   */
  const renderAll = (): void => {
    render();
    updateModeIndicator();
  };

  /**
   * 画面右上相当のモード表示（DOM）を現在の `DirectMode`／`Keyboard` の状態に合わせる。
   *
   * 【判断した点・理由】 CAPS インジケータの点灯条件は資料からは確認できない
   * （`docs/spec/operation_behavior.md` 未確定事項）。`machine/keyboard.ts` の
   * コメントにある「小文字は CAPS キーの上に印字された『小文字』ラベルへ切り替えて出す」
   * という実装済みの解釈に沿い、**小文字モード（`isCapsLockOn() === false`）のときに
   * 点灯**とした（キートップに印字された機能名は、その機能が有効なときに点灯する
   * という一般的なキーボードの慣行に合わせた）。既定（大文字）では消灯。
   */
  function updateModeIndicator(): void {
    const mode = directMode?.getMode() ?? 'PRO';
    const lowercaseActive = !machine.keyboard.isCapsLockOn();
    for (const el of Array.from(modeIndicator!.querySelectorAll<HTMLElement>('[data-indicator]'))) {
      const indicator = el.dataset.indicator;
      if (indicator === 'RUN' || indicator === 'PRO') {
        el.classList.toggle('mode-indicator__item--active', indicator === mode);
      } else if (indicator === 'CAPS') {
        el.classList.toggle('mode-indicator__item--active', lowercaseActive);
      }
      // TEXT/CASL/STAT/DEG は今回未実装のため常に消灯のまま。
    }
  }

  renderAll();
  window.addEventListener('resize', resize);

  // AudioContext はユーザー操作（クリック・キー押下等）のイベントハンドラの中でしか
  // 生成できないブラウザがあるため、最初の操作で一度だけ接続する。
  // （入力欄への打鍵やボタンのクリックも「ユーザー操作」であることに変わりはないため、
  // ここは `isFormControlTarget` によるフィルタを掛けない。）
  let audioAttached = false;
  const attachAudioOnce = (): void => {
    if (audioAttached) return;
    audioAttached = true;
    machine.attachAudio(new AudioContext());
  };
  window.addEventListener('keydown', attachAudioOnce, { once: true });
  window.addEventListener('click', attachAudioOnce, { once: true });

  /**
   * 未実装の仮想キー通知（`DirectMode.notifyUnsupported`）を LCD 枠外の
   * `#unsupported-notice` へ一時的に表示する。
   *
   * 【判断した点・理由】 以前は未実装キーを押すと `?UNSUPPORTED <名前>` を
   * 編集中の行へ直接埋め込んでいたが、入力中の行を壊してしまっていた
   * （`G850/CLAUDE.md` 依頼）。「押しても無反応にしない」方針は保ったまま、
   * 表示先を LCD の外（このタイマー付き通知領域）へ切り出すことで両立させる。
   * `setTimeout` で一定時間後に消す（`opacity` の切替のみ。`min-height` を
   * 確保しているレイアウトなのでガタつかない。`src/ui/style.css` 参照）。
   */
  let unsupportedNoticeTimer: number | null = null;
  const NOTICE_DURATION_MS = 1600;
  const showUnsupportedNotice = (name: string): void => {
    unsupportedNotice.textContent = `未実装キー: ${name}`;
    unsupportedNotice.classList.add('unsupported-notice--visible');
    if (unsupportedNoticeTimer !== null) window.clearTimeout(unsupportedNoticeTimer);
    unsupportedNoticeTimer = window.setTimeout(() => {
      unsupportedNotice.classList.remove('unsupported-notice--visible');
      unsupportedNoticeTimer = null;
    }, NOTICE_DURATION_MS);
  };

  directMode = new DirectMode(machine, { render: renderAll, notifyUnsupported: showUnsupportedNotice });
  updateModeIndicator(); // 初期状態（既定 PRO）を反映する。

  // タブが非表示の間はカーソル点滅の再描画を止める（`DirectMode.pauseCursorBlink` 参照。
  // `DirectMode` 自身は `document` を持たない設計のため、購読はここで行う）。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      directMode!.pauseCursorBlink();
    } else {
      directMode!.resumeCursorBlink();
    }
  });

  attachVirtualKeyboard(virtualKeyboardPanel, {
    machine,
    directMode,
    render: renderAll,
  });

  // ディスクライブラリ（「棚」）：取り込んだプログラムは localStorage にのみ保存され
  // （`LocalStorageLibraryStore`）、リポジトリにもサーバにも残らない（依頼「絶対の制約」）。
  // `panel.ts` は `DirectMode` を直接知らないため、読み込みはコールバックで橋渡しする。
  attachLibraryPanel(libraryPanel, {
    store: new LocalStorageLibraryStore(),
    onLoadProgram: (program) => directMode!.loadProgram(program),
  });

  // キー入力の行き先分離（依頼「3./4.」）：
  // - プログラム入力欄パネル（`#program-input` や中のボタン）にフォーカスがあるあいだの
  //   打鍵は、`isFormControlTarget` で弾いてエミュレータへ渡さない（従来どおり）。
  //   パネルは既定で `hidden`（DOM から `display:none`）なので、閉じている間は
  //   そもそも中の要素へフォーカスできず、この分岐は開いているときだけ効く。
  // - それ以外は `machine.keyboard` へ渡す（BREAK キー判定・INPUT/INKEY$ 用の
  //   バッファ蓄積は常時行う。実行中でなくても無害で、RUN のたびに reset される）。
  // - 加えて、**実行中でないとき**だけ `DirectMode`（LCD 上のラインエディタ）へも渡す
  //   （依頼「4. 既定はエミュレータ」）。実行中は渡さない（依頼「実行中は打鍵が
  //   ラインエディタに入らないこと」）。RUN/LIST ボタンも `DirectMode` を経由する
  //   ようになったため、実行中かどうかの判定は `directMode.isRunning()` の1本で足りる。
  window.addEventListener('keydown', (e) => {
    if (isFormControlTarget(e.target)) return;
    dispatchKeydown(machine, directMode!, e);
  });
  window.addEventListener('keyup', (e) => {
    if (isFormControlTarget(e.target)) return;
    machine.keyboard.handleKeyUp(e);
  });

  programInput.value = SAMPLE_PROGRAM;

  // RUN/LIST ボタン：LCD へそのコマンドを打って Enter を押したのと同じ経路
  // （`DirectMode.runCommand`）を通す。画面は消えず、コマンド自体も画面に表示される
  // （依頼「1. RUN/LIST ボタンをそのコマンドを打ったのと同じ動作にする」）。
  runButton.addEventListener('click', () => {
    directMode!.runCommand('RUN');
  });
  listButton.addEventListener('click', () => {
    directMode!.runCommand('LIST');
  });
  // BREAK はコマンドではなくキー相当なので、従来どおり実行中断の直接要求にする。
  breakButton.addEventListener('click', () => {
    directMode!.requestBreak();
  });
  // BASIC ボタン：実機の BASIC キー相当（PRO/RUN モード切替）。物理キー
  // （`ui/directMode.ts` の `MODE_TOGGLE_KEY`）を持たないスマートフォンのための
  // 画面上の代替経路（BREAK ボタンと同じ理由）。
  modeButton.addEventListener('click', () => {
    directMode!.toggleMode();
  });

  // 入力欄／仮想キーボード／ディスクライブラリの3パネルの開閉（同一作者の WebX68k の
  // #btn-panel-keyboard と同じ流儀：aria-pressed で状態を持ち、`hidden` クラスで
  // 表示を切り替える）。どのパネルも同時に開かない（依頼「既存のコピペ用パネルと
  // 同時に開かないようにすること」）。
  //
  // 【判断した点・理由】 以前は2枚を手書きの相互参照（開いたらもう一方を閉じる）で
  // 済ませていたが、3枚になると手書きの相互参照は組み合わせ数が増えて破綻する
  // （依頼「配列ベースの汎用関数にリファクタして3枚を等しく扱うこと」）。
  // 各パネルを `{ button, panel }` の配列として持ち、「開くときは自分以外を全部閉じる」
  // という1つの関数に共通化する。パネル枚数が増えても登録を1行足すだけで済む。
  interface PanelEntry {
    readonly button: HTMLButtonElement;
    readonly panel: HTMLElement;
    open: boolean;
  }
  const panels: readonly PanelEntry[] = [
    { button: panelToggleButton, panel: editorPanel, open: false },
    { button: keyboardToggleButton, panel: virtualKeyboardPanel, open: false },
    { button: libraryToggleButton, panel: libraryPanel, open: false },
  ];
  const setPanelOpen = (target: PanelEntry, open: boolean): void => {
    for (const entry of panels) {
      entry.open = entry === target ? open : false;
      entry.panel.classList.toggle('hidden', !entry.open);
      entry.button.setAttribute('aria-pressed', String(entry.open));
    }
  };
  for (const entry of panels) {
    setPanelOpen(entry, false);
    entry.button.addEventListener('click', () => {
      setPanelOpen(entry, !entry.open);
    });
  }

  // 「プログラムに取り込む」ボタン：入力欄の内容を `DirectMode` の `ProgramStore` へ
  // 反映するだけで、実行はしない（実行は操作バーの RUN ボタンに一本化する）。
  loadProgramButton.addEventListener('click', () => {
    directMode!.loadProgram(programInput.value);
  });

  // 起動時のセルフチェック用テストパターンを消してからサンプルプログラムを
  // LCD 直接入力へ取り込み、RUN ボタンと同じ経路（打鍵を打って Enter）で実行する。
  // ここで明示的に `cls()` するのは、あくまで「起動直後の初期化演出」としての
  // 一度きりの処理であり、RUN ボタン自体（`DirectMode.runCommand`）は画面を消さない。
  machine.screen.cls();
  directMode.loadProgram(SAMPLE_PROGRAM);
  directMode.runCommand('RUN');
}

main();
