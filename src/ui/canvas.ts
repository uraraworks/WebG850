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

import { applyCursorOverlay, type CursorOverlayState } from '../machine/cursorOverlay.ts';
import type { Screen } from '../machine/screen.ts';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../machine/screen.ts';

/** 既定の拡大倍率（144×48 → 576×192）。ウィンドウが十分広いときはこれを使う。 */
export const DEFAULT_SCALE = 4;

/**
 * 拡大倍率の上限。
 *
 * デスクトップの広い画面では、利用可能な幅・高さいっぱいまで拡大すると
 * 144×48 の LCD が 8 倍（約 1180px 幅）を超え、看板のように大写しになって
 * 「携帯機の液晶」に見えなくなる。5 倍（720×240px）を上限とし、
 * 「机の上のポケコンの液晶」程度の見た目に収める。
 */
export const MAX_SCALE = 5;

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
 * 高さによる縮小を検討する閾値（ビューポート高さ）。
 *
 * ページはスクロールしてよい前提のため、通常は高さで倍率を制限しない
 * （倍率は幅と `MAX_SCALE` だけで決める）。高さで縮小するのは、この閾値を
 * 下回るとき——横向きスマートフォンのような「そもそも縦が極端に狭い」
 * 画面に限る。500px はスマートフォンの横向き実寸（多くの機種で 375〜430px）
 * より一回り大きく、通常のデスクトップ／タブレット（800px 以上）には
 * 影響しない値として選んだ。
 */
export const HEIGHT_CONSTRAINT_THRESHOLD = 500;

/**
 * 利用可能な幅から、144×48 を整数倍で収められる最大の倍率を返す。
 * 収まらない場合でも最低 1 倍は保証する（等倍未満に縮小しない）。
 * 上限は `MAX_SCALE`（広い画面で看板のように大写しになるのを防ぐ）。
 *
 * 高さは「最後の手段」として扱う。ページはスクロールしてよいので、
 * `availableHeight` が `HEIGHT_CONSTRAINT_THRESHOLD` 以上ある通常のケースでは
 * 高さによる縮小を一切行わない（操作バー・入力欄が縦を消費しても LCD は潰さない）。
 * 横向きスマートフォンのように高さそのものが極端に狭いときだけ、高さでも
 * 頭打ちにする。
 */
export function computeScale(availableWidth: number, availableHeight: number): number {
  const maxByWidth = Math.floor(availableWidth / SCREEN_WIDTH);
  let scale = Number.isFinite(maxByWidth) && maxByWidth >= 1 ? maxByWidth : 1;
  scale = Math.min(scale, MAX_SCALE);

  if (Number.isFinite(availableHeight) && availableHeight < HEIGHT_CONSTRAINT_THRESHOLD) {
    const maxByHeight = Math.floor(availableHeight / SCREEN_HEIGHT);
    if (Number.isFinite(maxByHeight) && maxByHeight >= 1) {
      scale = Math.min(scale, maxByHeight);
    }
  }
  return scale;
}

export interface CanvasBinding {
  /** 画面ビットマップの現在の内容を canvas へ描画する。 */
  render: () => void;
  /** コンテナ寸法に応じて表示倍率(CSSサイズ)を再計算する。 */
  resize: () => void;
}

/**
 * `getCursor` はテキストカーソルの現在位置を返すコールバック（表示しないときは `null`）。
 * 点滅・重畳描画の実体は `machine/cursorOverlay.ts`（`Screen` のビットマップ自体は
 * 汚さない。詳細はそちらのコメント参照）。省略時はカーソルを描画しない
 * （既存呼び出し元・既存テストへの影響を避けるため）。
 */
export interface AttachCanvasOptions {
  getCursor?: () => CursorOverlayState | null;
}

/** `<canvas>` を画面モデルに接続する。backing store を 144×48 に固定し、CSS 拡大の準備をする。 */
export function attachCanvas(canvas: HTMLCanvasElement, screen: Screen, options: AttachCanvasOptions = {}): CanvasBinding {
  const { getCursor } = options;
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

  /**
   * 表示倍率を、親要素の幅と `window.innerHeight` から再計算する。
   *
   * 【判断した点・理由】 以前は「ビューポート高さ − ヘッダー・フッター等の兄弟要素の
   * 実測高さ合計」を『利用可能な高さ』として求め、`computeScale` に渡していた
   * （ページを常にビューポート内に収める設計だった）。しかしプログラム入力欄・
   * RUN/BREAK/LIST ボタン（`.control-bar`）を追加したことで兄弟要素の合計高さが
   * ビューポート高さに迫る／超えるようになり、差し引き後の残り高さが数十px という
   * 極端な値になって LCD が意図せず低倍率（2倍程度）まで潰れる回帰を起こした。
   *
   * ページはスクロールしてよい前提に変わっているため、高さで倍率を決めるのは
   * 本末転倒（`computeScale` のコメント参照）。ここでは `window.innerHeight` を
   * そのまま `computeScale` に渡し、通常は幅と `MAX_SCALE` だけで倍率が決まる
   * ようにする。高さそのものが極端に狭い（横向きスマートフォンなど、
   * `HEIGHT_CONSTRAINT_THRESHOLD` 未満の）場合にだけ `computeScale` 内部で
   * 高さによる頭打ちが働く。兄弟要素の実測（`getBoundingClientRect`）による
   * 「残り高さ」計算は不要になったため削除した。
   */
  function resize(): void {
    const parent = canvas.parentElement;
    const availableWidth = parent?.clientWidth || window.innerWidth || SCREEN_WIDTH * DEFAULT_SCALE;
    const availableHeight = window.innerHeight || SCREEN_HEIGHT * DEFAULT_SCALE;
    const scale = computeScale(availableWidth, availableHeight) || DEFAULT_SCALE;
    canvas.style.width = `${SCREEN_WIDTH * scale}px`;
    canvas.style.height = `${SCREEN_HEIGHT * scale}px`;
  }

  function render(): void {
    const cursor = getCursor ? getCursor() : null;
    const dots = applyCursorOverlay(screen.getDots(), cursor, Date.now());
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
