/**
 * PC-G850V の画面モデル。
 *
 * `docs/design/phase1_architecture.md` の「画面モデル」節に従い、
 * テキストとグラフィックを区別しない **144×48 ドットの単一ビットマップ 1 枚**
 * （`Uint8Array(144*48)`、1 バイト 1 ドット、0=消灯／1=点灯）として持つ。
 * `PRINT` で文字を描いても `PSET` でその上から欠けさせられるし、逆も然り。
 * 実機と同じ「同一面」の振る舞いになる。
 *
 * テキストは 24 桁×6 行、1 セル 6×8 ドットで、字形（`font.ts`、5×7）を
 * セルの左上に詰めて描く（右 1 列・下 1 行が字間／行間の空白）。
 */

import { FONT_GLYPH_HEIGHT, FONT_GLYPH_WIDTH, getGlyph } from './font.ts';

export const SCREEN_WIDTH = 144;
export const SCREEN_HEIGHT = 48;

export const TEXT_COLS = 24; // 144 / 6
export const TEXT_ROWS = 6; // 48 / 8
export const CELL_WIDTH = 6;
export const CELL_HEIGHT = 8;

/** 描画モード。S=セット(点灯) R=消去(消灯) X=反転。CIRCLE/LINE/PAINT系で共通。 */
export type DrawMode = 'S' | 'R' | 'X';

/** CIRCLE / PAINT で共通のパターン番号（0〜6）。 */
export type FillPattern = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ─────────────────────────────────────────────────────────────
// CIRCLE の開始角・終了角（不確定仕様）
//
// src/basic/uncertain.ts の流儀（暫定値を名前付き定数に集約し、
// 何を採用したか・なぜかをコメントで明記する）に倣う。src/basic/ 配下は
// 別担当が編集中のため触れず、参照元となるこのファイル側に集約する。
// ─────────────────────────────────────────────────────────────

/**
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` CIRCLE の notes にある通り、
 * 独語マニュアルは開始角・終了角の範囲を「0〜360」、英語マニュアルは「-360〜360
 * （負値は原点から弧への半径線を引き扇形にする。正値は弧のみ）」と記載しており、
 * 両版で食い違っている。しかも独語版自身が載せる実行例
 * `CIRCLE(71,23),20,-45,-135` は負角度を使っており「0〜360」という独語版自身の
 * 記述とすでに矛盾している。
 *
 * 本実装では英語版の記述（範囲 -360〜360、符号で扇形/弧を切替）を暫定採用する。
 * 理由: (1) 独語版は自己矛盾しており範囲記述の信頼性が低い、
 * (2) 英語版は符号の意味（扇形になるか弧のみか）まで具体的に説明しており
 * 情報量が大きい。どちらが実機の実際の受理範囲かは実測でしか確定できないため、
 * `verifiable_by_measurement: true` の通り、後日実測できたらこの節を丸ごと
 * 差し替えること。
 *
 * 参照: docs/spec/basic_commands.yaml の CIRCLE エントリ (notes)
 */
export const CIRCLE_ANGLE_MIN = -360;
export const CIRCLE_ANGLE_MAX = 360;
/** 開始角省略時の既定値。独語・英語共通で「省略時0」。 */
export const CIRCLE_ANGLE_START_DEFAULT = 0;
/** 終了角省略時の既定値。独語・英語共通で「省略時360」（全円）。 */
export const CIRCLE_ANGLE_END_DEFAULT = 360;
/**
 * 負角度の意味づけ。英語版の記述に従い、開始角・終了角のいずれかが負のとき、
 * 円弧の両端から中心へ半径線を足して扇形にする。独語版にはこの説明が無いため、
 * 独語版準拠に切り替える場合はここを見直すこと。
 */
export const CIRCLE_NEGATIVE_ANGLE_MEANS_SECTOR = true;

// ─────────────────────────────────────────────────────────────
// LINE の線種ビットパターン（判断が必要だった箇所。マニュアルには
// 「線のビットパターン」としか書かれておらず、ビットの向きは未記載）
// ─────────────────────────────────────────────────────────────

/**
 * 【自分で判断した点・理由】 `LINE` の「線種」引数（0〜65535）が
 * どのドットに対応するかはマニュアルに記載が無い。GW-BASIC 系で広く見られる
 * 「16bit パターンの MSB が線の先頭ドットに対応し、末尾ドットまで進んだら
 * 先頭へ循環する」という慣行を採用した。差し替える場合はこの関数だけを直せばよい。
 */
function isLineBitSet(pattern: number, dotIndex: number): boolean {
  const bit = 15 - (dotIndex % 16);
  return ((pattern >> bit) & 1) !== 0;
}

/** 線パターン省略時（全ドット点灯＝実線）の既定値。 */
const LINE_PATTERN_SOLID = 0xffff;

// ─────────────────────────────────────────────────────────────
// CIRCLE / PAINT 共通のハッチングパターン(0〜6)
// ─────────────────────────────────────────────────────────────

/**
 * 【自分で判断した点・理由】 パターン0〜6の絵柄（横線・縦線・斜線・全塗り）は
 * マニュアルに説明があるが、格子の基準点（画面原点基準か図形原点基準か）や
 * 線の間隔（何ドットおきか）の記載は無い。実装のシンプルさを優先し、
 * 画面原点 (0,0) を基準にした固定間隔の縞模様を採用する。
 * 見た目の粗密は暫定であり、実測できたら差し替える。
 */
function hatchOn(x: number, y: number, pattern: number): boolean {
  switch (pattern) {
    case 0:
      return false; // 塗りなし
    case 1:
      return y % 2 === 0; // 横線
    case 2:
      return x % 2 === 0; // 縦線
    case 3:
      return (x - y + SCREEN_HEIGHT * 4) % 4 === 0; // 右下がり斜線 (\)
    case 4:
      return (x + y) % 4 === 0; // 右上がり斜線 (/)
    case 5:
      return hatchOn(x, y, 3) || hatchOn(x, y, 4); // 3+4のクロスハッチ
    case 6:
      return true; // 全面塗りつぶし
    default:
      return false;
  }
}

interface Point {
  x: number;
  y: number;
}

/** Bresenham のアルゴリズムで2点間の直線上のドット列を求める（水平・垂直・斜め全対応）。 */
function bresenhamLine(x1: number, y1: number, x2: number, y2: number): Point[] {
  const points: Point[] = [];
  let x = x1;
  let y = y1;
  const dx = Math.abs(x2 - x1);
  const dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push({ x, y });
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

export class Screen {
  private readonly dots: Uint8Array;
  private cursorCol = 0;
  private cursorRow = 0;

  constructor() {
    this.dots = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  }

  // ── 基本ドット操作 ──────────────────────────────────────

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < SCREEN_WIDTH && y >= 0 && y < SCREEN_HEIGHT;
  }

  private index(x: number, y: number): number {
    return y * SCREEN_WIDTH + x;
  }

  /** 画面外の座標は例外を投げず黙って無視する。 */
  pset(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    this.dots[this.index(x, y)] = 1;
  }

  /** 画面外の座標は例外を投げず黙って無視する。 */
  preset(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    this.dots[this.index(x, y)] = 0;
  }

  /** 画面外の座標は例外を投げず黙って無視する。 */
  pxor(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    this.dots[i] = this.dots[i] ? 0 : 1;
  }

  /**
   * 指定ドットの点灯状態を返す（点灯:1、消灯:0）。
   * 実在しない座標を指定した場合は常に0を返す
   * （`docs/spec/basic_commands.yaml` POINT の summary 通り）。
   */
  point(x: number, y: number): 0 | 1 {
    if (!this.inBounds(x, y)) return 0;
    return this.dots[this.index(x, y)] !== 0 ? 1 : 0;
  }

  /** S/R/X の描画モードを1点に適用する共通口。図形描画系は全てこれを経由する。 */
  private applyDot(x: number, y: number, mode: DrawMode): void {
    switch (mode) {
      case 'S':
        this.pset(x, y);
        return;
      case 'R':
        this.preset(x, y);
        return;
      case 'X':
        this.pxor(x, y);
        return;
    }
  }

  /** 画面ビットマップの生データへの参照を返す（描画用）。呼び出し側で書き換えないこと。 */
  getDots(): Uint8Array {
    return this.dots;
  }

  // ── テキスト表示 ──────────────────────────────────────

  get cursor(): { col: number; row: number } {
    return { col: this.cursorCol, row: this.cursorRow };
  }

  /** 指定セル（6×8ドット）を消してから、そこへ1文字の字形を左上詰めで描く。 */
  putChar(col: number, row: number, code: number): void {
    if (col < 0 || col >= TEXT_COLS || row < 0 || row >= TEXT_ROWS) return;
    const x0 = col * CELL_WIDTH;
    const y0 = row * CELL_HEIGHT;

    for (let dy = 0; dy < CELL_HEIGHT; dy++) {
      for (let dx = 0; dx < CELL_WIDTH; dx++) {
        this.preset(x0 + dx, y0 + dy);
      }
    }

    const glyph = getGlyph(code);
    for (let gx = 0; gx < FONT_GLYPH_WIDTH; gx++) {
      const colBits = glyph[gx];
      for (let gy = 0; gy < FONT_GLYPH_HEIGHT; gy++) {
        if ((colBits >> gy) & 1) {
          this.pset(x0 + gx, y0 + gy);
        }
      }
    }
  }

  /** カーソル位置を設定する（範囲外は画面内へクランプ）。 */
  locate(col: number, row: number): void {
    this.cursorCol = Math.max(0, Math.min(TEXT_COLS - 1, col));
    this.cursorRow = Math.max(0, Math.min(TEXT_ROWS - 1, row));
  }

  /** 画面消去＋カーソルを左上へ戻す。 */
  cls(): void {
    this.dots.fill(0);
    this.cursorCol = 0;
    this.cursorRow = 0;
  }

  /** 最下行での改行時に呼ぶ。テキスト1行分＝8ドットを上へ詰め、最下行をクリアする。 */
  private scrollUp(): void {
    const rowDots = SCREEN_WIDTH * CELL_HEIGHT;
    this.dots.copyWithin(0, rowDots);
    this.dots.fill(0, this.dots.length - rowDots);
  }

  private newline(): void {
    this.cursorCol = 0;
    if (this.cursorRow < TEXT_ROWS - 1) {
      this.cursorRow++;
    } else {
      this.scrollUp();
      // cursorRow は既に最下行(TEXT_ROWS-1)のまま。
    }
  }

  /**
   * 文字列をカーソル位置から書き込む。`\n` で改行し、桁が右端(24桁目)を
   * 超えたら自動的に折り返す。最下行での改行はスクロールを起こす。
   */
  writeText(s: string): void {
    for (const ch of s) {
      if (ch === '\n') {
        this.newline();
        continue;
      }
      this.putChar(this.cursorCol, this.cursorRow, ch.charCodeAt(0));
      this.cursorCol++;
      if (this.cursorCol >= TEXT_COLS) {
        this.newline();
      }
    }
  }

  // ── 図形描画 ──────────────────────────────────────────

  /**
   * 2点間に直線を描く（Bresenham）。`pattern` は16bitの線種ビットパターン
   * （省略時は全ドット点灯＝実線）。ビットの向きの解釈は `isLineBitSet` 参照。
   */
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    mode: DrawMode = 'S',
    pattern: number = LINE_PATTERN_SOLID,
  ): void {
    const points = bresenhamLine(Math.trunc(x1), Math.trunc(y1), Math.trunc(x2), Math.trunc(y2));
    points.forEach((p, i) => {
      if (isLineBitSet(pattern, i)) {
        this.applyDot(p.x, p.y, mode);
      }
    });
  }

  /** 矩形の枠のみを描く（`LINE ...,B` 用）。2点は対角座標で、順序は問わない。 */
  rect(x1: number, y1: number, x2: number, y2: number, mode: DrawMode = 'S'): void {
    this.line(x1, y1, x2, y1, mode);
    this.line(x2, y1, x2, y2, mode);
    this.line(x2, y2, x1, y2, mode);
    this.line(x1, y2, x1, y1, mode);
  }

  /** 塗りつぶし矩形を描く（`LINE ...,BF` 用）。2点は対角座標で、順序は問わない。 */
  fillRect(x1: number, y1: number, x2: number, y2: number, mode: DrawMode = 'S'): void {
    const xMin = Math.min(Math.trunc(x1), Math.trunc(x2));
    const xMax = Math.max(Math.trunc(x1), Math.trunc(x2));
    const yMin = Math.min(Math.trunc(y1), Math.trunc(y2));
    const yMax = Math.max(Math.trunc(y1), Math.trunc(y2));
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        this.applyDot(x, y, mode);
      }
    }
  }

  /**
   * 円・円弧・扇形・楕円を描く。
   *
   * `startAngle`/`endAngle` の受理範囲と負角度の意味は
   * `CIRCLE_ANGLE_MIN`/`CIRCLE_ANGLE_MAX`/`CIRCLE_NEGATIVE_ANGLE_MEANS_SECTOR`
   * を参照（不確定仕様、詳細はそのコメント）。
   */
  circle(
    cx: number,
    cy: number,
    r: number,
    startAngle: number = CIRCLE_ANGLE_START_DEFAULT,
    endAngle: number = CIRCLE_ANGLE_END_DEFAULT,
    aspect: number = 1,
    mode: DrawMode = 'S',
    pattern: FillPattern = 0,
  ): void {
    const rx = Math.max(1, Math.round(r));
    const ry = Math.max(1, Math.round(r * aspect));
    const isFull = Math.abs(endAngle - startAngle) >= 360;
    const start = isFull ? 0 : startAngle;
    const end = isFull ? 360 : endAngle;
    const isSector =
      CIRCLE_NEGATIVE_ANGLE_MEANS_SECTOR && !isFull && (start < 0 || end < 0);

    const arcKeys = new Set<number>();
    const addPoint = (x: number, y: number): void => {
      if (this.inBounds(x, y)) arcKeys.add(this.index(x, y));
    };
    const addLine = (ax: number, ay: number, bx: number, by: number): void => {
      for (const p of bresenhamLine(ax, ay, bx, by)) addPoint(p.x, p.y);
    };
    const pointOnEllipse = (deg: number): Point => {
      const rad = (deg * Math.PI) / 180;
      // 画面はyが下向きなので、通常の数学角度(反時計回り)に対しyを反転する。
      return { x: Math.round(cx + rx * Math.cos(rad)), y: Math.round(cy - ry * Math.sin(rad)) };
    };

    // 弧を角度方向にサンプリングし、隣接サンプル間はBresenhamで繋いで隙間を作らない。
    const span = Math.abs(end - start) || 360;
    const maxDim = Math.max(rx, ry, 1);
    const stepDeg = Math.max(360 / (2 * Math.PI * maxDim), 0.25);
    const steps = Math.max(Math.ceil(span / stepDeg), 1);
    let last: Point | null = null;
    for (let i = 0; i <= steps; i++) {
      const deg = start + ((end - start) * i) / steps;
      const p = pointOnEllipse(deg);
      if (last) {
        addLine(last.x, last.y, p.x, p.y);
      } else {
        addPoint(p.x, p.y);
      }
      last = p;
    }

    if (isSector) {
      const s = pointOnEllipse(start);
      const e = pointOnEllipse(end);
      addLine(Math.round(cx), Math.round(cy), s.x, s.y);
      addLine(Math.round(cx), Math.round(cy), e.x, e.y);
    }

    // パターン指定時は内部（扇形なら扇の内側のみ）をハッチングで塗る。
    if (pattern !== 0) {
      const xMin = Math.max(0, Math.floor(cx - rx));
      const xMax = Math.min(SCREEN_WIDTH - 1, Math.ceil(cx + rx));
      const yMin = Math.max(0, Math.floor(cy - ry));
      const yMax = Math.min(SCREEN_HEIGHT - 1, Math.ceil(cy + ry));
      const a0 = ((start % 360) + 360) % 360;
      const a1 = ((end % 360) + 360) % 360;
      for (let py = yMin; py <= yMax; py++) {
        for (let px = xMin; px <= xMax; px++) {
          const nx = (px - cx) / rx;
          const ny = (py - cy) / ry;
          if (nx * nx + ny * ny > 1) continue;
          if (!isFull) {
            let angle = (Math.atan2(-(py - cy), px - cx) * 180) / Math.PI;
            if (angle < 0) angle += 360;
            const inRange = a0 <= a1 ? angle >= a0 && angle <= a1 : angle >= a0 || angle <= a1;
            if (!inRange) continue;
          }
          if (hatchOn(px, py, pattern)) {
            this.applyDot(px, py, mode);
            arcKeys.delete(this.index(px, py));
          }
        }
      }
    }

    for (const key of arcKeys) {
      const px = key % SCREEN_WIDTH;
      const py = (key - px) / SCREEN_WIDTH;
      this.applyDot(px, py, mode);
    }
  }

  /**
   * 指定座標を起点に、周囲の画素で囲まれた領域を塗りつぶす（4方向連結の境界塗り）。
   * 境界＝開始点と異なる点灯状態を持つドット。塗り方は `pattern`（0〜6）のハッチング。
   * `PAINT` に S/R/X の指定は無い（`docs/spec/basic_commands.yaml` 参照）。
   */
  paint(x: number, y: number, pattern: FillPattern): void {
    const sx = Math.trunc(x);
    const sy = Math.trunc(y);
    if (!this.inBounds(sx, sy)) return;

    const seedValue = this.dots[this.index(sx, sy)];
    const visited = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
    const region: number[] = [];
    const stack: number[] = [this.index(sx, sy)];
    visited[this.index(sx, sy)] = 1;

    while (stack.length > 0) {
      const idx = stack.pop() as number;
      region.push(idx);
      const px = idx % SCREEN_WIDTH;
      const py = (idx - px) / SCREEN_WIDTH;
      const neighbors: Point[] = [
        { x: px + 1, y: py },
        { x: px - 1, y: py },
        { x: px, y: py + 1 },
        { x: px, y: py - 1 },
      ];
      for (const n of neighbors) {
        if (!this.inBounds(n.x, n.y)) continue;
        const nIdx = this.index(n.x, n.y);
        if (visited[nIdx]) continue;
        if (this.dots[nIdx] !== seedValue) continue; // 境界（開始点と異なる状態）
        visited[nIdx] = 1;
        stack.push(nIdx);
      }
    }

    // 領域の特定が終わってから一括で書き込む（走査中に this.dots を書き換えると
    // 境界判定が壊れるため、識別と適用のフェーズを分離している）。
    for (const idx of region) {
      const px = idx % SCREEN_WIDTH;
      const py = (idx - px) / SCREEN_WIDTH;
      if (hatchOn(px, py, pattern)) {
        this.pset(px, py);
      } else {
        this.preset(px, py);
      }
    }
  }

  // ── テスト用ヘルパ ──────────────────────────────────────

  /** 指定矩形を `#`(点灯)/`.`(消灯) の文字列（行を `\n` 区切り）でダンプする。 */
  dumpAscii(x: number, y: number, w: number, h: number): string {
    const lines: string[] = [];
    for (let dy = 0; dy < h; dy++) {
      let line = '';
      for (let dx = 0; dx < w; dx++) {
        line += this.point(x + dx, y + dy) ? '#' : '.';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }
}
