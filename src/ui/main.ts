// エントリポイント。
// パーサ・インタプリタは別担当が実装するため、ここでは machine/screen と
// ui/canvas の結線と、「ブラウザを開くだけで動く」ことが目視確認できる
// テストパターンの描画だけを行う。

import { Screen } from '../machine/screen.ts';
import { attachCanvas, PAGE_BACKGROUND_COLOR } from './canvas.ts';

const FIRST_ASCII = 0x20;
const LAST_ASCII = 0x7e;

/** 起動確認用テストパターン：全95文字のフォント一覧＋枠線・円・塗りつぶし。 */
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

  const screen = new Screen();
  drawTestPattern(screen);

  const { render } = attachCanvas(canvas, screen);
  render();
}

main();
