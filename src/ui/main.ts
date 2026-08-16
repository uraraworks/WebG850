// エントリポイント。
// machine/screen・ui/canvas の結線に加え、プログラム入力欄と RUN/BREAK/LIST ボタンを
// 結線する。パース〜実行〜エラー表示の実体は `ui/app.ts` の `App` に持たせてあり、
// ここでは DOM 要素の取得とイベント配線だけを行う。

import { Machine } from '../machine/machine.ts';
import type { Screen } from '../machine/screen.ts';
import { App } from './app.ts';
import { attachCanvas } from './canvas.ts';
import { isFormControlTarget } from './keyRouting.ts';

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

/** プログラム入力欄の初期値。以前の起動時デモ相当の内容をそのまま置く。 */
const SAMPLE_PROGRAM = '10 FOR I=1 TO 5\n20 PRINT I\n30 NEXT I\n40 PRINT "OK"';

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
  if (runButton === null || breakButton === null || listButton === null) {
    throw new Error('操作ボタン（RUN/BREAK/LIST）が見つかりません');
  }

  const machine = new Machine();
  drawTestPattern(machine.screen);

  const { render, resize } = attachCanvas(canvas, machine.screen);
  render();
  window.addEventListener('resize', resize);

  // キー入力の行き先分離（依頼「3.」）：プログラム入力欄や RUN/BREAK/LIST ボタンに
  // フォーカスがあるあいだの打鍵は、`isFormControlTarget` で弾いてエミュレータへ
  // 渡さない。それ以外（ページ本体・canvas 等にフォーカスがある状態）の打鍵は
  // 従来どおり `machine.keyboard` へ渡し、INPUT/INKEY$ が正しく受け取れるようにする。
  window.addEventListener('keydown', (e) => {
    if (isFormControlTarget(e.target)) return;
    machine.keyboard.handleKeyDown(e);
  });
  window.addEventListener('keyup', (e) => {
    if (isFormControlTarget(e.target)) return;
    machine.keyboard.handleKeyUp(e);
  });

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

  const app = new App(machine, { render });

  programInput.value = SAMPLE_PROGRAM;

  runButton.addEventListener('click', () => {
    app.run(programInput.value);
  });
  breakButton.addEventListener('click', () => {
    app.break();
  });
  listButton.addEventListener('click', () => {
    app.list();
  });

  // テストパターンは起動時のセルフチェック用に一瞬だけ表示する。BASIC の実行結果と
  // 混ざって読めなくなるのを避けるため、プログラム実行前に画面を消す
  // （依頼指示「プログラム実行前に画面を消すこと」）。App.run が内部で
  // `machine.screen.cls()` を呼ぶため、ここでは明示的な cls() は不要。
  app.run(SAMPLE_PROGRAM);
}

main();
