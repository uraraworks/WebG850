/**
 * 画面ビットマップ（`machine/screen.ts`）を `<canvas>` へ描画する。
 *
 * 【方針転換（実機 LCD の見た目再現）】 以前は 144×48 のビットマップをそのまま
 * backing store とし、`image-rendering: pixelated` で単純拡大していた（「緑地に
 * 真っ黒な四角」）。今回、実機 SHARP PC-G850S の STN 液晶に近づけるため、
 * backing store を `SUBPIXEL_SCALE` 倍に高解像度化し、その中で
 * 「反射板」「ドット同士の格子」「にじみ（影）」「残像」「列方向の濃淡
 * （クロストーク）」を層として合成する（ゲームボーイ実機液晶を再現した
 * 先行事例の考え方を踏襲：ぼかしフィルタ一発ではなく液晶の構造を模す）。
 * 最終的な CSS 拡大は `pixelated` をやめ、ブラウザの通常の補間に任せる
 * （にじみを生かすため。1ドット線が消えないことは目視で確認済み——
 * 詳細は各定数のコメントとセッション記録を参照）。
 *
 * `POINT` の結果に影響する `Screen`（`machine/screen.ts`）とカーソル重畳
 * （`machine/cursorOverlay.ts`）は一切変更していない。ここで行っているのは
 * 見た目の描画層の追加だけである。
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

/**
 * LCD の点灯ドット色（濃色）。
 *
 * 実機写真（ユーザー提供、1枚・1照明条件からの推定）では真っ黒ではなく、
 * ややブルーが混ざった濃灰に見えた。旧 `#1a1a1a`（無彩色の黒に近い）より
 * 明度をわずかに上げ、青みを足した。
 */
export const DOT_ON_COLOR = '#2f323d';
/**
 * LCD の消灯ドット色（薄いがページ背景とは区別できる色）。
 *
 * 実機写真では旧 `#9ead86` より彩度が低く明るい「淡い灰緑」に見えた。
 * HSL でおおよそ 彩度-8pt・明度+8pt 相当に振った値。
 */
export const DOT_OFF_COLOR = '#b7bfae';
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

// ─────────────────────────────────────────────────────────────
// LCD 描画層の定数（全て canvas.ts に集約。src/basic/uncertain.ts には入れない
// ——あちらは「プログラムから見える挙動が変わる不確定仕様」の置き場所で、
// 液晶パネルの見え方はプログラムの挙動に影響しないため、境界を混ぜない）。
// ─────────────────────────────────────────────────────────────

/**
 * backing store の高解像度化倍率（論理ドット1個 = SUBPIXEL_SCALE × SUBPIXEL_SCALE
 * 物理ピクセル）。にじみ（ぼかし）・格子・ドット間の隙間を表現するための
 * 下地の解像度。大きいほど滑らかだが描画コストが増える。4 倍
 * （144×48 → 576×192）は、5倍表示（720×240）でも過度な引き伸ばしにならず、
 * 2倍表示（288×96）でも縮小しすぎない、という体感で決めた値。
 */
const SUBPIXEL_SCALE = 4;

/**
 * ドット1個を描く正方形と、セル境界との隙間（backing store のピクセル単位）。
 * 「ドット同士にわずかな隙間がある」という実機写真の見え方を表現する。
 * SUBPIXEL_SCALE(4) に対して 0.6px の隙間＝ドット本体は 3.4×3.4px。
 * 大きくしすぎるとドットが痩せて格子が主張しすぎ、文字が薄く見えるため、
 * 目視確認しながら小さめに抑えた。
 */
const DOT_GAP_PX = 0.6;

/**
 * 画素間格子の濃さ（黒の重ね塗りアルファ）。背景（消灯色）は明るいため
 * 相対的に格子が見えやすく、点灯ドット色（濃色）の上に乗る部分は
 * 元々暗いため格子はほぼ視認できない——という「明るい領域ほど格子が
 * 目立つ」挙動が、格子を全面に均一な絶対濃度で敷くだけで自然に成立する
 * （明度差が大きいところほどコントラスト比が高くなるため）。
 */
const GRID_ALPHA = 0.12;

/**
 * にじみ（反射板に落ちる影）のぼかし半径（backing store ピクセル単位、
 * `ctx.filter = blur(...)` に渡す）。近すぎるとにじみが目立たず、
 * 離しすぎると輪郭が浮いて文字が潰れる。2倍・5倍表示の両方で
 * 1ドット線・隣接する文字（0/O, 1/l, 8/B）が判別できる上限として
 * 目視で選んだ値。
 */
const BLEED_BLUR_PX = 1.4;

/** にじみ層を重ねる際の不透明度。強くしすぎると文字が滲んで潰れるため控えめ。 */
const BLEED_ALPHA = 0.5;

/**
 * 残像（前フレームを薄く混ぜる）の減衰率。
 *
 * `render()` が呼ばれるたびに「1フレーム経過」とみなし、消灯した直後の
 * ドットの残り輝度に毎回この係数を掛けて弱める（正確な壁時計基準ではない。
 * `render()` は `ui/runtime.ts` の rAF ループから毎フレーム呼ばれる設計
 * （`STEPS_PER_FRAME` 参照）なので、実用上は概ね1画面更新＝1減衰に対応する）。
 * **現在点灯中のドットは常に不透明度1で描画**し、残像の対象は
 * 「直前まで点灯していて今は消えたドット」だけに限定している
 * （今まさに表示されている1ドット線がぼやける事故を避けるため）。
 */
const PERSISTENCE_DECAY = 0.35;

/** これを下回ったら残像を描画自体しない（無限に薄い尾を引かせない打ち切り）。 */
const PERSISTENCE_MIN_ALPHA = 0.03;

// ─── 列方向の濃淡（クロストーク） ──────────────────────────
//
// 「同じ列に濃い点が並ぶと、その列全体がわずかに濃くなる」という駆動特性。
// ゲームボーイ実機液晶を再現した先行事例が公開しているパラメータ
// （上方向を1とした重み: 上1 / 下0.4 / 左0.25、12ドットで約1/3に減衰、
// 濃さを二乗してから合算=実効値(RMS)、上下端の帯強調、中間濃度で最も
// 目立つ、列ごとの個体差）を出発点にしつつ、G850 は画面が 48 ドットしか
// 無い別機種なので数値はそのまま使わず、GBの画面比率（減衰12/画面高144、
// 帯3程度）で48ドットへ比例縮小してから目視で調整した。
//
// 【先行事例が報告していた失敗を踏まえた設計】 「列全体の平均」を使うと
// 濃い部分の"上"まで一様に暗くなり不自然になる、との報告があったため、
// 平均は使わず、上下で重みの違う指数減衰を行方向に累積する
// （`upEnergy`/`downEnergy` の後退・前進漸化式）。

/** 上方向（自分より下にある点灯ドットが、自分を暗くする度合い）の基準重み。 */
const CROSSTALK_UP_WEIGHT = 1.0;
/** 下方向（自分より上にある点灯ドットが、自分を暗くする度合い）の基準重み。上方向より弱い。 */
const CROSSTALK_DOWN_WEIGHT = 0.4;
/** 左隣の列にある点灯ドットが、同じ行を暗くする度合い（同じ行のみ、距離減衰なし）。 */
const CROSSTALK_LEFT_WEIGHT = 0.25;
/**
 * 減衰が「約1/3」になる距離（行数）。
 * 先行事例（GB, 画面高144ドット中12ドットで1/3）の比率 12/144 を
 * G850 の画面高48ドットへ比例縮小: 48*12/144=4。GBよりずっと低解像度の
 * 画面なので、そのままの絶対値(12)では画面のほぼ全域が影響を受けてしまう
 * ための調整。
 */
const CROSSTALK_DECAY_ROWS_FOR_THIRD = 4;
/**
 * クロストークが生む濃淡の最大アルファ（背景に対する黒の重ね塗り上限）。
 * 文字が滲んで読めなくなるほど濃くならないよう、控えめな値を目視で選んだ。
 */
const CROSSTALK_MAX_ALPHA = 0.09;
/** 上下端で帯を強調する範囲（行数）。GBの40/144を48ドットへ比例縮小し、視認性を見て丸めた。 */
const CROSSTALK_EDGE_BAND_ROWS = 3;
/** 上下端の帯強調そのものの最大アルファ。 */
const CROSSTALK_EDGE_BAND_ALPHA = 0.03;
/** 列ごとの個体差の振れ幅（±この割合）。固定シードから決まるため実行のたびには変わらない。 */
const CROSSTALK_COLUMN_VARIANCE = 0.15;
/** 列ごとの個体差を決める固定シード（毎回同じ癖を再現するため）。 */
const CROSSTALK_SEED = 0x50c8_5000;

/** 決定的な疑似乱数（mulberry32）。シードが同じなら常に同じ列の癖になる。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 列ごとの個体差（1±CROSSTALK_COLUMN_VARIANCE の範囲）。モジュール読み込み時に一度だけ決める。 */
function buildColumnVariance(): Float32Array {
  const rand = mulberry32(CROSSTALK_SEED);
  const out = new Float32Array(SCREEN_WIDTH);
  for (let x = 0; x < SCREEN_WIDTH; x++) {
    out[x] = 1 - CROSSTALK_COLUMN_VARIANCE + rand() * (2 * CROSSTALK_COLUMN_VARIANCE);
  }
  return out;
}

const COLUMN_VARIANCE = buildColumnVariance();

/** ドット強度(0〜1)を量子化してキャッシュした `rgba()` 文字列（毎フレームの文字列生成を避ける）。 */
const INTENSITY_LEVELS = 32;
function buildIntensityPalette(): string[] {
  const out: string[] = [];
  for (let lvl = 0; lvl <= INTENSITY_LEVELS; lvl++) {
    const alpha = lvl / INTENSITY_LEVELS;
    out.push(`rgba(${DOT_ON_RGB[0]},${DOT_ON_RGB[1]},${DOT_ON_RGB[2]},${alpha.toFixed(3)})`);
  }
  return out;
}
const DOT_FILL_PALETTE = buildIntensityPalette();

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

/** `<canvas>` を画面モデルに接続する。backing store を高解像度に固定し、LCD 描画層を合成する。 */
export function attachCanvas(canvas: HTMLCanvasElement, screen: Screen, options: AttachCanvasOptions = {}): CanvasBinding {
  const { getCursor } = options;

  const backingWidth = SCREEN_WIDTH * SUBPIXEL_SCALE;
  const backingHeight = SCREEN_HEIGHT * SUBPIXEL_SCALE;

  canvas.width = backingWidth;
  canvas.height = backingHeight;
  // にじみ（ぼかし）を生かすため、以前使っていた `pixelated`（最近傍拡大）は
  // やめ、ブラウザの通常の補間（既定値）に任せる。backing store 側で
  // 意図的にぼかしを作っているので、CSS 拡大の最近傍化はむしろ邪魔になる。
  canvas.style.background = DOT_OFF_COLOR;

  const ctx2d = canvas.getContext('2d');
  if (ctx2d === null) {
    throw new Error('2d context を取得できません');
  }
  const ctx: CanvasRenderingContext2D = ctx2d;

  // ── 反射板＋格子（静的レイヤ。色も格子も毎フレーム変わらないので一度だけ作る） ──
  const reflector = document.createElement('canvas');
  reflector.width = backingWidth;
  reflector.height = backingHeight;
  const rctx = reflector.getContext('2d');
  if (rctx === null) {
    throw new Error('2d context を取得できません（反射板レイヤ）');
  }
  rctx.fillStyle = DOT_OFF_COLOR;
  rctx.fillRect(0, 0, backingWidth, backingHeight);
  rctx.fillStyle = `rgba(0,0,0,${GRID_ALPHA})`;
  for (let gx = 0; gx <= SCREEN_WIDTH; gx++) {
    rctx.fillRect(gx * SUBPIXEL_SCALE - 0.5, 0, 1, backingHeight);
  }
  for (let gy = 0; gy <= SCREEN_HEIGHT; gy++) {
    rctx.fillRect(0, gy * SUBPIXEL_SCALE - 0.5, backingWidth, 1);
  }

  // ── ドット層（毎フレーム描き直すスクラッチキャンバス。にじみのぼかし対象） ──
  const dotsLayer = document.createElement('canvas');
  dotsLayer.width = backingWidth;
  dotsLayer.height = backingHeight;
  const dctx2d = dotsLayer.getContext('2d');
  if (dctx2d === null) {
    throw new Error('2d context を取得できません（ドット層）');
  }
  // ctx と同じ理由（ネストした関数の中まで null 除外の絞り込みが伝播しないため）で束ね直す。
  const dctx: CanvasRenderingContext2D = dctx2d;

  /** 残像用の状態（消灯直後のドットの残り輝度、0〜1）。ドット単位で `render()` を跨いで保持する。 */
  const persistence = new Float32Array(SCREEN_WIDTH * SCREEN_HEIGHT);

  // クロストークの行方向漸化式で使い回すスクラッチ配列（毎フレーム確保しない）。
  const upEnergy = new Float32Array(SCREEN_HEIGHT);
  const downEnergy = new Float32Array(SCREEN_HEIGHT);

  const crosstalkR = Math.pow(1 / 3, 1 / CROSSTALK_DECAY_ROWS_FOR_THIRD);
  const crosstalkR2 = crosstalkR * crosstalkR;
  const upW2 = CROSSTALK_UP_WEIGHT * CROSSTALK_UP_WEIGHT;
  const downW2 = CROSSTALK_DOWN_WEIGHT * CROSSTALK_DOWN_WEIGHT;
  const leftW2 = CROSSTALK_LEFT_WEIGHT * CROSSTALK_LEFT_WEIGHT;

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
    const rawDots = screen.getDots();
    const cursor = getCursor ? getCursor() : null;
    const overlaid = applyCursorOverlay(rawDots, cursor, Date.now());

    // 1. 反射板＋格子を土台としてコピー。
    ctx.drawImage(reflector, 0, 0);

    // 2. 列方向の濃淡（クロストーク）。ドットより先に敷き、消灯セル側にだけ
    //    見える形にする（点灯ドットは後段で不透明に上書きされるため）。
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      // 後退漸化式: upEnergy[y] = r2*(upW2*s(y+1) + upEnergy[y+1])
      // （自分より下(y+1)にある点灯ドットが自分(y)を暗くする＝上方向の伝播）
      upEnergy[SCREEN_HEIGHT - 1] = 0;
      for (let y = SCREEN_HEIGHT - 2; y >= 0; y--) {
        const sBelow = rawDots[(y + 1) * SCREEN_WIDTH + x] !== 0 ? 1 : 0;
        upEnergy[y] = crosstalkR2 * (upW2 * sBelow + upEnergy[y + 1]);
      }
      // 前進漸化式: downEnergy[y] = r2*(downW2*s(y-1) + downEnergy[y-1])
      // （自分より上(y-1)にある点灯ドットが自分(y)を暗くする＝下方向の伝播、弱め）
      downEnergy[0] = 0;
      for (let y = 1; y < SCREEN_HEIGHT; y++) {
        const sAbove = rawDots[(y - 1) * SCREEN_WIDTH + x] !== 0 ? 1 : 0;
        downEnergy[y] = crosstalkR2 * (downW2 * sAbove + downEnergy[y - 1]);
      }
      const variance = COLUMN_VARIANCE[x];
      for (let y = 0; y < SCREEN_HEIGHT; y++) {
        const leftS = x > 0 && rawDots[y * SCREEN_WIDTH + (x - 1)] !== 0 ? 1 : 0;
        const energy = upEnergy[y] + downEnergy[y] + leftW2 * leftS;
        // 「濃さを二乗してから合算」＝各方向のエネルギー(すでに二乗済み)を足したものを
        // 実効値(RMS)として使う。sqrt で元のスケールへ戻す。
        const combined = Math.min(1, Math.sqrt(energy));
        // 中間濃度で最も目立つ（両端=0, 中央=1 の放物線）。
        const peak = 4 * combined * (1 - combined);
        const edgeDist = Math.min(y, SCREEN_HEIGHT - 1 - y);
        const edgeBoost =
          edgeDist < CROSSTALK_EDGE_BAND_ROWS
            ? CROSSTALK_EDGE_BAND_ALPHA * (1 - edgeDist / CROSSTALK_EDGE_BAND_ROWS)
            : 0;
        const alpha = (CROSSTALK_MAX_ALPHA * peak + edgeBoost) * variance;
        if (alpha < 0.004) continue;
        ctx.fillStyle = `rgba(${DOT_ON_RGB[0]},${DOT_ON_RGB[1]},${DOT_ON_RGB[2]},${alpha.toFixed(3)})`;
        ctx.fillRect(x * SUBPIXEL_SCALE, y * SUBPIXEL_SCALE, SUBPIXEL_SCALE, SUBPIXEL_SCALE);
      }
    }

    // 3. ドット層（残像込み）を専用キャンバスへ描く。
    dctx.clearRect(0, 0, backingWidth, backingHeight);
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const idx = y * SCREEN_WIDTH + x;
        const rawOn = rawDots[idx] !== 0;
        const decayed = persistence[idx] * PERSISTENCE_DECAY;
        const baseIntensity = rawOn ? 1 : decayed;
        persistence[idx] = baseIntensity;

        // カーソルの重畳（点滅）は液晶の残像対象にしない。UI要素の瞬時な
        // 反転として扱い、直前の状態に関わらずそのフェーズの値を即座に出す。
        const overlaidOn = overlaid[idx] !== 0;
        const intensity = overlaidOn !== rawOn ? (overlaidOn ? 1 : 0) : baseIntensity;
        if (intensity < PERSISTENCE_MIN_ALPHA) continue;

        const level = Math.round(intensity * INTENSITY_LEVELS);
        dctx.fillStyle = DOT_FILL_PALETTE[level];
        dctx.fillRect(
          x * SUBPIXEL_SCALE + DOT_GAP_PX / 2,
          y * SUBPIXEL_SCALE + DOT_GAP_PX / 2,
          SUBPIXEL_SCALE - DOT_GAP_PX,
          SUBPIXEL_SCALE - DOT_GAP_PX,
        );
      }
    }

    // 4. にじみ（反射板へ落ちる影）: ぼかした複製を先に重ね、その上へ鮮明な
    //    ドット層を重ねる。「素子が反射板に影を落とす」構造をそのまま模す。
    ctx.save();
    ctx.filter = `blur(${BLEED_BLUR_PX}px)`;
    ctx.globalAlpha = BLEED_ALPHA;
    ctx.drawImage(dotsLayer, 0, 0);
    ctx.restore();
    ctx.drawImage(dotsLayer, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);

  return { render, resize };
}
