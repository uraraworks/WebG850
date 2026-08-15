/**
 * `BEEP <回数>[,[<音程>][,<持続時間>]]` の実装。WebAudio を使う。
 *
 * `docs/spec/basic_commands.yaml` の BEEP エントリ:
 *   - 回数: 0-65535
 *   - 音程: 0-255（省略可）。0で約7kHz、255で約230Hz（値が大きいほど低音）。省略時4kHz相当。
 *   - 持続時間: 0-65279（省略可）。省略時160。「周波数が低いほど実際の持続は長くなる」
 *
 * **AudioContext を注入できる形**にしてあり、テストでは実際に音を鳴らさない
 * ダミー実装（`OscillatorNode`/`GainNode` 相当の最小インタフェース）を渡せる。
 */

/** `AudioContext` のうち、この実装が実際に使う部分だけを切り出したインタフェース。 */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export interface OscillatorLike {
  frequency: { value: number };
  connect(dest: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainLike {
  gain: { value: number };
  connect(dest: unknown): void;
}

// ─────────────────────────────────────────────────────────────
// 音程 → 周波数の変換（判断が必要だった箇所）
// ─────────────────────────────────────────────────────────────

/** 音程 0 に対応する周波数（仕様書に明記された値）。 */
export const PITCH_0_HZ = 7000;
/** 音程 255 に対応する周波数（仕様書に明記された値）。 */
export const PITCH_255_HZ = 230;
/** 音程省略時の周波数（仕様書に明記された値：「省略時4kHz相当」）。 */
export const DEFAULT_PITCH_HZ = 4000;
/** 持続時間省略時の値（仕様書に明記された値）。 */
export const DEFAULT_DURATION_PARAM = 160;

/**
 * 音程パラメータ（0〜255）を周波数(Hz)へ変換する。
 *
 * 【推測で決めた点・理由】 仕様書は 0→約7kHz・255→約230Hz という両端点のみを
 * 与えており、中間値の補間規則（線形か対数かなど）は記載が無い。
 * 単純さを優先し、0〜255 の間を**線形補間**する。音階のような対数的な
 * ピッチ知覚に近づけたいなら差し替えが要るが、根拠となる中間実測値が無いため
 * ここでは最小の仮定（線形）に留める。差し替える場合はこの関数だけを直せばよい。
 *
 * 参照: docs/spec/basic_commands.yaml BEEP エントリの params.音程.notes
 */
export function pitchToFrequencyHz(pitch: number): number {
  const clamped = Math.max(0, Math.min(255, pitch));
  return PITCH_0_HZ + ((PITCH_255_HZ - PITCH_0_HZ) * clamped) / 255;
}

/**
 * 持続時間パラメータを実時間(ms)へ変換する。
 *
 * 【推測で決めた点・理由】 仕様書は「持続時間」の単位を明記していないが、
 * 「周波数が低いほど実際の持続は長くなる」という挙動を明記している。
 * これは持続時間パラメータが絶対時間（ms）ではなく、**音の1周期を単位に
 * 数えるカウント**（＝波形の周期数）であれば自然に説明できる
 * （同じカウント値でも低音＝周期が長いほど実時間が伸びるため）。
 * この解釈を採用し、`実時間ms = 持続時間パラメータ × (1000 / 周波数Hz)` とする。
 * 実測できていないため暫定であり、他の解釈（絶対msなど）が正しければ
 * この関数だけを差し替えればよい。
 *
 * 参照: docs/spec/basic_commands.yaml BEEP エントリの params.持続時間.notes
 */
export function durationParamToMs(durationParam: number, frequencyHz: number): number {
  const periodMs = 1000 / frequencyHz;
  return durationParam * periodMs;
}

export class Sound {
  constructor(private readonly ctx: AudioContextLike) {}

  /**
   * `BEEP` を実行する。`count` 回、`pitch`/`duration` は省略時 `null`。
   * 各鳴動は前の鳴動が終わってから始まる（直列に鳴らす）。
   */
  beep(count: number, pitch: number | null, duration: number | null): void {
    const n = Math.max(0, Math.trunc(count));
    const freqHz = pitch === null ? DEFAULT_PITCH_HZ : pitchToFrequencyHz(pitch);
    const durationParam = duration === null ? DEFAULT_DURATION_PARAM : duration;
    const durationMs = durationParamToMs(durationParam, freqHz);
    const durationSec = durationMs / 1000;

    // BEEP同士の間隔も仕様書に記載が無い。鳴動時間と同じ長さの無音を挟む
    // （＝鳴動:無音=1:1）という単純な仮定を暫定採用する。
    const cycleSec = durationSec * 2;

    for (let i = 0; i < n; i++) {
      const startTime = this.ctx.currentTime + i * cycleSec;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = freqHz;
      gain.gain.value = 1;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + durationSec);
    }
  }
}
