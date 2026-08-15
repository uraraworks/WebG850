/**
 * PC-G850V の「マシン」束ね役。
 *
 * `docs/design/phase1_architecture.md` のディレクトリ構成メモに従い、
 * `screen`（画面）と、キーボード／音のプレースホルダを1つにまとめる。
 * キーボード（INKEY$・物理キー入力）と BEEP（WebAudio）の実装は次の担当が
 * 行うため、ここではインタフェースだけを定義し、既定実装は呼ばれたら
 * 明示的に `UnsupportedError` を投げる（無言のダミーにしない。
 * `docs/design/phase1_architecture.md`「未実装を無言にしない」節）。
 */

import { UnsupportedError } from '../basic/errors.js';
import { LinearCongruentialGenerator, seedFromCurrentTime } from '../basic/uncertain.js';
import { Screen } from './screen.ts';

/** キーボード入力のインタフェース。実装は次担当（INKEY$・物理キー入力）。 */
export interface KeyboardInterface {
  /** INKEY$ 相当。押されているキー1文字、キーが無ければ空文字列を返す想定。 */
  inkey(): string;
}

/** BEEP のインタフェース。実装は次担当（WebAudio）。 */
export interface SoundInterface {
  beep(count: number, pitch: number | null, duration: number | null): void;
}

/**
 * 未実装のプレースホルダ実装。
 * 「動いているように見えて実は何もしていない」状態を避けるため、
 * 呼ばれたら常に `UnsupportedError` を投げる。
 */
class UnimplementedKeyboard implements KeyboardInterface {
  inkey(): string {
    throw new UnsupportedError('INKEY$');
  }
}

class UnimplementedSound implements SoundInterface {
  beep(): void {
    throw new UnsupportedError('BEEP');
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

  /** 次担当が実装するまでは `UnimplementedKeyboard`（呼ぶと例外）が入る。 */
  keyboard: KeyboardInterface = new UnimplementedKeyboard();
  /** 次担当が実装するまでは `UnimplementedSound`（呼ぶと例外）が入る。 */
  sound: SoundInterface = new UnimplementedSound();

  private rng: LinearCongruentialGenerator;

  /** 未実装・部分未対応の命令名 → 踏んだ回数。 */
  private readonly unimplemented = new Map<string, number>();

  constructor(seed: number = seedFromCurrentTime()) {
    this.rng = new LinearCongruentialGenerator(seed);
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
