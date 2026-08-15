// BEEP（src/machine/sound.ts）の単体テスト。
// 実際に鳴らさず、ダミー AudioContext（AudioContextLike を満たす最小実装）を注入して、
// Oscillator の生成・接続・start/stop が期待通り呼ばれることを確認する。

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PITCH_HZ,
  durationParamToMs,
  pitchToFrequencyHz,
  Sound,
  type AudioContextLike,
  type GainLike,
  type OscillatorLike,
} from '../src/machine/sound.ts';

interface Call {
  freq: number;
  startTime: number;
  stopTime: number;
}

/** テスト用のダミー AudioContext。生成された Oscillator の呼び出しを記録する。 */
function createDummyAudioContext(): { ctx: AudioContextLike; calls: Call[] } {
  const calls: Call[] = [];

  const ctx: AudioContextLike = {
    currentTime: 0,
    destination: {},
    createOscillator(): OscillatorLike {
      const osc: OscillatorLike & { _freq: number } = {
        _freq: 0,
        frequency: {
          get value() {
            return osc._freq;
          },
          set value(v: number) {
            osc._freq = v;
          },
        },
        connect: () => {},
        start: (when = 0) => {
          calls.push({ freq: osc._freq, startTime: when, stopTime: NaN });
        },
        stop: (when = 0) => {
          calls[calls.length - 1].stopTime = when;
        },
      };
      return osc;
    },
    createGain(): GainLike {
      return { gain: { value: 0 }, connect: () => {} };
    },
  };

  return { ctx, calls };
}

describe('pitchToFrequencyHz', () => {
  it('音程0は約7kHz、音程255は約230Hz（仕様書の両端点）', () => {
    expect(pitchToFrequencyHz(0)).toBeCloseTo(7000, 5);
    expect(pitchToFrequencyHz(255)).toBeCloseTo(230, 5);
  });
});

describe('durationParamToMs', () => {
  it('周波数が低いほど、同じ持続時間パラメータでも実時間は長くなる', () => {
    const short = durationParamToMs(160, 4000);
    const long = durationParamToMs(160, 230);
    expect(long).toBeGreaterThan(short);
  });
});

describe('Sound.beep', () => {
  it('ダミー AudioContext に対して count 回 Oscillator が鳴らされる', () => {
    const { ctx, calls } = createDummyAudioContext();
    const sound = new Sound(ctx);
    sound.beep(3, null, null);
    expect(calls.length).toBe(3);
    // 音程省略時は DEFAULT_PITCH_HZ（仕様書「省略時4kHz相当」）。
    expect(calls[0].freq).toBeCloseTo(DEFAULT_PITCH_HZ, 5);
  });

  it('count=0 のときは何も鳴らさない', () => {
    const { ctx, calls } = createDummyAudioContext();
    const sound = new Sound(ctx);
    sound.beep(0, null, null);
    expect(calls.length).toBe(0);
  });

  it('音程パラメータを渡すと pitchToFrequencyHz の変換結果が周波数に使われる', () => {
    const { ctx, calls } = createDummyAudioContext();
    const sound = new Sound(ctx);
    sound.beep(1, 255, null);
    expect(calls[0].freq).toBeCloseTo(pitchToFrequencyHz(255), 5);
  });

  it('鳴動ごとに開始時刻がずれる（直列に鳴る）', () => {
    const { ctx, calls } = createDummyAudioContext();
    const sound = new Sound(ctx);
    sound.beep(2, null, null);
    expect(calls[1].startTime).toBeGreaterThan(calls[0].startTime);
  });
});
