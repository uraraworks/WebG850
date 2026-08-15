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

import {
  DEFAULT_DURATION_PARAM,
  DEFAULT_PITCH_HZ,
  durationParamToMs,
  PITCH_0_HZ,
  PITCH_255_HZ,
  pitchToFrequencyHz,
} from '../basic/uncertain.ts';

// BEEP の音程→周波数・持続時間パラメータの解釈は `src/basic/uncertain.ts` に
// 集約されている（不確定仕様は1ファイルへ集約する方針のため、旧実装をそこへ移設した）。
// ここでは再エクスポートして、既存のテスト（`test/sound.test.ts`）からの
// `import { pitchToFrequencyHz, ... } from '../src/machine/sound.ts'` を壊さない。
export { DEFAULT_DURATION_PARAM, DEFAULT_PITCH_HZ, durationParamToMs, PITCH_0_HZ, PITCH_255_HZ, pitchToFrequencyHz };

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
