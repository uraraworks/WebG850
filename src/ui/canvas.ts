/**
 * 画面ビットマップ（`machine/screen.ts`）を `<canvas>` へ描画する。
 *
 * キャンバスの実ピクセル（backing store）は画面モデルと同じ 144×48 に固定し、
 * CSS の `width`/`height` で整数倍に拡大表示する（`image-rendering: pixelated`
 * で最近傍拡大にし、1ドット線を潰さない）。等倍未満（縮小）にはしない。
 *
 * 【判断した点・理由】 「背景色と消灯ドット色を分ける」という指示は、
 * この canvas 自体が画面モデルと同サイズ（余白なし）なため、キャンバスの外側
 * （ページ背景）と、キャンバス内の消灯ドット色を別の色にする、という意味で解釈した。
 * 消灯ドットが完全な黒背景に沈んで見えなくなる事故を避けつつ、実機LCDの
 * 「消灯セグメントもうっすら見える」質感に近づけるため、消灯色は完全な黒/白ではなく
 * 中間的な色（`DOT_OFF_COLOR`）を採用した。
 */

import type { Screen } from '../machine/screen.ts';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../machine/screen.ts';

/** 既定の拡大倍率（144×48 → 576×192）。ウィンドウが十分広いときはこれを使う。 */
export const DEFAULT_SCALE = 4;

/** LCD の点灯ドット色（濃色）。 */
export const DOT_ON_COLOR = '#1a1a1a';
/** LCD の消灯ドット色（薄いがページ背景とは区別できる色）。 */
export const DOT_OFF_COLOR = '#9ead86';
/**
 * ページ背景色。消灯ドット色とは別の色にして、キャンバスの境界が分かるようにする。
 *
 * 白基調のページデザイン（`src/ui/style.css`）に合わせた、ごく薄いグレー。
 * 純白にしないのは、LCD 周りの縁取り（筐体）との境界を保ち、長時間の閲覧でも
 * 目が疲れにくくするため。
 */
export const PAGE_BACKGROUND_COLOR = '#f2f1ec';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const DOT_ON_RGB = hexToRgb(DOT_ON_COLOR);
const DOT_OFF_RGB = hexToRgb(DOT_OFF_COLOR);

/**
 * 利用可能な幅・高さから、144×48 を整数倍で収められる最大の倍率を返す。
 * 収まらない場合でも最低 1 倍は保証する（等倍未満に縮小しない）。
 */
export function computeScale(availableWidth: number, availableHeight: number): number {
  const maxByWidth = Math.floor(availableWidth / SCREEN_WIDTH);
  const maxByHeight = Math.floor(availableHeight / SCREEN_HEIGHT);
  const scale = Math.min(maxByWidth, maxByHeight);
  if (!Number.isFinite(scale) || scale < 1) return 1;
  return scale;
}

export interface CanvasBinding {
  /** 画面ビットマップの現在の内容を canvas へ描画する。 */
  render: () => void;
  /** コンテナ寸法に応じて表示倍率(CSSサイズ)を再計算する。 */
  resize: () => void;
}

/** `<canvas>` を画面モデルに接続する。backing store を 144×48 に固定し、CSS 拡大の準備をする。 */
export function attachCanvas(canvas: HTMLCanvasElement, screen: Screen): CanvasBinding {
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.background = DOT_OFF_COLOR;

  const ctx2d = canvas.getContext('2d');
  if (ctx2d === null) {
    throw new Error('2d context を取得できません');
  }
  // const な ctx2d を確定した型の別名に束ね直す。ネストした関数(render)の中まで
  // null 除外の絞り込みが伝播しないための回避（TypeScript の制御フロー解析の制約）。
  const ctx: CanvasRenderingContext2D = ctx2d;
  const imageData = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

  function resize(): void {
    const parent = canvas.parentElement;
    const availableWidth = parent?.clientWidth || window.innerWidth || SCREEN_WIDTH * DEFAULT_SCALE;
    const availableHeight = parent?.clientHeight || window.innerHeight || SCREEN_HEIGHT * DEFAULT_SCALE;
    const scale = computeScale(availableWidth, availableHeight) || DEFAULT_SCALE;
    canvas.style.width = `${SCREEN_WIDTH * scale}px`;
    canvas.style.height = `${SCREEN_HEIGHT * scale}px`;
  }

  function render(): void {
    const dots = screen.getDots();
    const data = imageData.data;
    for (let i = 0; i < dots.length; i++) {
      const on = dots[i] !== 0;
      const [r, g, b] = on ? DOT_ON_RGB : DOT_OFF_RGB;
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);

  return { render, resize };
}
