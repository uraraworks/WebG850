/**
 * PC-G850V の「マシン」束ね役。
 *
 * `docs/design/phase1_architecture.md` のディレクトリ構成メモに従い、
 * `screen`（画面）・`keyboard`（`src/machine/keyboard.ts`）・
 * `sound`（`src/machine/sound.ts`、BEEP/WebAudio）を1つにまとめる。
 * `sound` は AudioContext 未接続でも動かせるよう、既定では鳴動処理を
 * 何もしない `NullSound` を積んでおく（`Machine.attachAudio` で後から接続する）。
 */

import { LinearCongruentialGenerator, seedFromCurrentTime } from '../basic/uncertain.js';
import { Keyboard } from './keyboard.ts';
import { Screen } from './screen.ts';
import { Sound, type AudioContextLike } from './sound.ts';

/** キーボード入力のインタフェース。`Keyboard`（`keyboard.ts`）が実装する。 */
export interface KeyboardInterface {
  /** INKEY$ 相当。押されているキー1文字、キーが無ければ空文字列を返す想定。 */
  inkey(): string;
}

/** BEEP のインタフェース。`Sound`（`sound.ts`）が実装する。 */
export interface SoundInterface {
  beep(count: number, pitch: number | null, duration: number | null): void;
}

/**
 * `AudioContext` 未接続時の既定実装。無言で何もしない（例外を投げない）。
 *
 * 【判断した点・理由】 `AudioContext` はブラウザのユーザー操作
 * （クリック等）まで生成できない制約があるため、起動直後は未接続が普通に起こる。
 * `UnsupportedError` を投げると「BEEP未実装」と誤解を招くため、ここは
 * 「未実装」ではなく「まだ音源へ接続していない」状態として無音を返す。
 */
class NullSound implements SoundInterface {
  beep(): void {
    // 何もしない（AudioContext 未接続）。
  }
}

/** デバッグパネル向け：未実装・部分未対応の記録1件。 */
export interface UnimplementedReport {
  readonly name: string;
  /** 踏んだ回数。 */
  readonly count: number;
}

/**
 * 画面・キーボード・音・乱数源を束ねるマシン本体。
 * インタプリタはこれ1つを介して外界（画面表示・入力・音）とやり取りする。
 */
export class Machine {
  readonly screen = new Screen();

  /** 押下中キー・INKEY$バッファ・INPUT行入力・BREAK検出を持つ（`keyboard.ts`）。 */
  readonly keyboard = new Keyboard();
  /** `attachAudio` で `AudioContext` を接続するまでは無音（`NullSound`）。 */
  sound: SoundInterface = new NullSound();

  private rng: LinearCongruentialGenerator;

  /** 未実装・部分未対応の命令名 → 踏んだ回数。 */
  private readonly unimplemented = new Map<string, number>();

  constructor(seed: number = seedFromCurrentTime()) {
    this.rng = new LinearCongruentialGenerator(seed);
  }

  /**
   * `AudioContext`（ブラウザのユーザー操作イベント内で生成したもの）を接続し、
   * 以後 `BEEP` を実際に鳴らせるようにする。テストでは `AudioContextLike` を
   * 満たすダミーを渡せる（`sound.ts` 参照）。
   */
  attachAudio(ctx: AudioContextLike): void {
    this.sound = new Sound(ctx);
  }

  /**
   * `RND` 系関数が使う乱数源。系列は実機と一致させられない
   * （docs/design/phase1_runtime.md「乱数」節、不確定仕様3件のうちの1つ）。
   */
  rnd(): number {
    return this.rng.next();
  }

  /** `RANDOMIZE` 相当。乱数の種を差し替える。 */
  randomize(seed: number = seedFromCurrentTime()): void {
    this.rng = new LinearCongruentialGenerator(seed);
  }

  /**
   * 未実装・部分未対応を記録する。常時警告はしないが、デバッグパネルから
   * 一覧できるようにするための蓄積先（親 CLAUDE.md
   * 「不確定な仕様は知りたい人が確認できる場所に出す」に対応）。
   */
  reportUnimplemented(name: string): void {
    this.unimplemented.set(name, (this.unimplemented.get(name) ?? 0) + 1);
  }

  /** デバッグパネル向け：これまでに記録された未実装・部分未対応の一覧。 */
  getUnimplementedReport(): UnimplementedReport[] {
    return Array.from(this.unimplemented.entries()).map(([name, count]) => ({ name, count }));
  }
}
