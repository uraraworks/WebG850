// エントリポイント。
// machine/screen・ui/canvas の結線に加え、tokenizer→parser→interpreter を通し、
// 実際に簡単な BASIC プログラムを実行して画面へ出す。

import { BUILTINS } from '../basic/functions/index.ts';
import { Interpreter } from '../basic/interpreter.ts';
import { parseProgram } from '../basic/parser.ts';
import { Machine } from '../machine/machine.ts';
import type { Screen } from '../machine/screen.ts';
import { attachCanvas, PAGE_BACKGROUND_COLOR } from './canvas.ts';
import { Runtime } from './runtime.ts';

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

/** 起動時に実行する確認用 BASIC プログラム。テストパターンの後に画面へ流れて出る。 */
const DEMO_PROGRAM = '10 FOR I=1 TO 5\n20 PRINT I\n30 NEXT I\n40 PRINT "OK"';

function main(): void {
  document.body.style.background = PAGE_BACKGROUND_COLOR;
  document.body.style.display = 'flex';
  document.body.style.justifyContent = 'center';
  document.body.style.alignItems = 'center';
  document.body.style.minHeight = '100vh';
  document.body.style.margin = '0';

  const canvas = document.querySelector<HTMLCanvasElement>('#screen');
  if (canvas === null) {
    throw new Error('#screen canvas が見つかりません');
  }

  const machine = new Machine();
  drawTestPattern(machine.screen);

  const { render, resize } = attachCanvas(canvas, machine.screen);
  render();
  window.addEventListener('resize', resize);

  window.addEventListener('keydown', (e) => machine.keyboard.handleKeyDown(e));
  window.addEventListener('keyup', (e) => machine.keyboard.handleKeyUp(e));

  // AudioContext はユーザー操作（クリック・キー押下等）のイベントハンドラの中でしか
  // 生成できないブラウザがあるため、最初の操作で一度だけ接続する。
  let audioAttached = false;
  const attachAudioOnce = (): void => {
    if (audioAttached) return;
    audioAttached = true;
    machine.attachAudio(new AudioContext());
  };
  window.addEventListener('keydown', attachAudioOnce, { once: true });
  window.addEventListener('click', attachAudioOnce, { once: true });

  const program = parseProgram(DEMO_PROGRAM);
  const interpreter = new Interpreter(program, machine, BUILTINS);

  const runtime = new Runtime(interpreter, machine.keyboard, { render });
  runtime.start();
}

main();
