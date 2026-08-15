// 不確定仕様の集約。
//
// マニュアル（docs/仕様_BASIC命令セット.md）や実行例からは確定できず、
// 「もっともらしい値」を暫定採用している項目をここに1ファイルへ集める。
// 親 CLAUDE.md の方針（「不確定な仕様は、根拠を明示して1つ選び、後で1箇所直せば
// 変わる形にする」「間違いが見えないと改善のループが回らない」）に対応する部分。
//
// 各定数は「暫定でこう決めた理由」と「参照すべき仕様書の場所」をコメントで持つ。
// 差し替えるときはこのファイルの値と、必要なら根拠コメントを更新すればよい。

/**
 * 実行時に踏んだ不確定仕様の識別子。
 * デバッグパネル（別担当実装）はこれを一覧表示する想定。
 */
export type UncertainId =
  | 'VARNAME_SIGNIFICANT_CHARS'
  | 'IMPLICIT_ARRAY_SIZE'
  | 'FOR_CHECKS_BEFORE_BODY'
  | 'ANGLE_MODE_RESET_ON_RUN'
  | 'EXPONENTIAL_SWITCH_THRESHOLD'
  | 'EXPONENT_FORMAT'
  | 'POSITIVE_LEADING_SPACE'
  | 'RANDOM_PRNG'
  | 'REC_RESERVED_VAR_ASSIGNMENT'
  | 'BEEP_PITCH_LINEAR_INTERPOLATION'
  | 'BEEP_DURATION_AS_PERIOD_COUNT';

/** 実行時に踏んだ不確定仕様の集合。プロセス生存中は積み上がる一方（明示的に reset するまで消えない）。 */
const usedUncertainIds = new Set<UncertainId>();

/**
 * 不確定仕様を実際に踏んだことを記録する。
 * 各実装箇所（number.ts、将来の parser/interpreter 等）は、当該の不確定仕様を
 * 使用する分岐を通ったタイミングでこれを呼ぶこと。
 */
export function markUncertainUsed(id: UncertainId): void {
  usedUncertainIds.add(id);
}

/** これまでに記録された不確定仕様の一覧を返す（デバッグパネル向け）。 */
export function getUsedUncertainIds(): UncertainId[] {
  return Array.from(usedUncertainIds);
}

/** 記録をクリアする（テスト用。CLEAR/NEW 相当のタイミングで呼ぶことも想定）。 */
export function resetUncertainUsage(): void {
  usedUncertainIds.clear();
}

// ─────────────────────────────────────────────────────────────
// 変数名の有効文字数
// ─────────────────────────────────────────────────────────────

/**
 * 変数名の有効文字数。`null` は「無制限（全文字が区別される）」を表す。
 *
 * 【推測で決めた点・理由】 実機は先頭2文字のみ有効（`ABC` と `ABD` が同一変数）という
 * 制約がある可能性が高いが、マニュアルに記載が無いため確定していない。
 * 2文字制限を入れて誤って別変数を潰す方が、入れずに動く方より被害が大きいので、
 * 暫定で「全文字有効（無制限）」を採用する。
 *
 * 参照: docs/design/phase1_grammar.md「変数名」節
 */
export const VARNAME_SIGNIFICANT_CHARS: number | null = null;

// ─────────────────────────────────────────────────────────────
// DIM 省略時の配列サイズ
// ─────────────────────────────────────────────────────────────

/**
 * `DIM` していない配列を参照したときの暗黙の要素数（添字 0〜10 の 11 要素）。
 *
 * 【推測で決めた点・理由】 マニュアルに記載が無い。多くの BASIC 実装が
 * 0〜10 の 11 要素を暗黙に確保する慣行に従った。
 *
 * 参照: docs/design/phase1_runtime.md「変数」節
 */
export const IMPLICIT_ARRAY_SIZE = 11;

// ─────────────────────────────────────────────────────────────
// FOR の判定順序
// ─────────────────────────────────────────────────────────────

/**
 * `true` なら `FOR` はループ本体に入る前に終了条件を判定する
 * （`FOR I=1 TO 0` は本体を1回も実行しない＝前判定）。
 *
 * 【推測で決めた点・理由】 `FOR I=1 TO 0` が本体を実行するかはマニュアルに記載が無い。
 * 判定を後に置く（後判定）実装だと `FOR I=1 TO 0` が配列外アクセスを起こす作品が
 * 壊れるため、前判定の方が「壊れない側」として暫定採用する。
 *
 * 参照: docs/design/phase1_runtime.md「FOR の判定順序」節
 */
export const FOR_CHECKS_BEFORE_BODY = true;

// ─────────────────────────────────────────────────────────────
// RUN 時の角度モード
// ─────────────────────────────────────────────────────────────

/**
 * `true` なら `RUN` で角度モード（DEGREE/RADIAN/GRAD）を既定（DEGREE）へ戻す。
 * `false` なら直前のモードを維持する。
 *
 * 【推測で決めた点・理由】 マニュアルに記載が無い。リセットする実装だと、
 * 直前に `RADIAN` を打った利用者の意図が消えてしまうため、維持（`false`）を
 * 暫定採用する。
 *
 * 参照: docs/design/phase1_runtime.md「角度モード」節
 */
export const ANGLE_MODE_RESET_ON_RUN = false;

// ─────────────────────────────────────────────────────────────
// 固定小数点 ⇔ 指数表記の切替閾値・指数の書式
// （旧 src/basic/number.ts から移設）
// ─────────────────────────────────────────────────────────────

/**
 * 整数部の桁数がこれを超えたら指数表記に切り替える閾値。
 *
 * 【推測で決めた点・理由】 マニュアルに実行例が無く未確定
 * （`docs/spec/number_display.md`「まだ確定していない規則」）。仮数の有効桁数
 * （`number.ts` の `MANTISSA_DIGITS` = 10）と同じ値を採用した。値を変えるときは
 * `MANTISSA_DIGITS` との対応も見直すこと（循環 import を避けるためここでは
 * 直値として持ち、自動連動はさせていない）。
 *
 * 参照: docs/spec/number_display.md「まだ確定していない規則」
 */
export const EXPONENTIAL_SWITCH_INTEGER_DIGITS = 10;

/**
 * 絶対値がこの値未満なら指数表記に切り替える閾値。
 *
 * 【推測で決めた点・理由】 マニュアルに実行例が無く未確定。同世代の MS-BASIC 系
 * ポケコン・電卓で広く見られる「0.01 未満を E 表記にする」慣習からの類推であり、
 * 実機の閾値そのものではない。
 *
 * 参照: docs/spec/number_display.md「まだ確定していない規則」
 */
export const EXPONENTIAL_SWITCH_MIN_ABS = 0.01;

/**
 * 指数表記部分（"1.234567891E+15" の "E+15" 側）を組み立てる。
 *
 * 【推測で決めた点・理由】 実機の PRINT 出力書式（指数の符号有無・桁数、
 * 区切り文字 "E" の有無）はマニュアルからは確定できなかった。同世代の
 * MS-BASIC 系ポケコン・電卓で広く使われる「E+符号+2桁」という慣習を採用した。
 * `number.ts` の `EXPONENT_MAX = 99` なので2桁で収まる。
 *
 * 参照: docs/spec/number_display.md「まだ確定していない規則」
 */
export function formatExponent(exponent: number): string {
  markUncertainUsed('EXPONENT_FORMAT');
  const expSign = exponent < 0 ? '-' : '+';
  const expDigits = String(Math.abs(exponent)).padStart(2, '0');
  return `E${expSign}${expDigits}`;
}

// ─────────────────────────────────────────────────────────────
// 正数の先頭スペース
// ─────────────────────────────────────────────────────────────

/**
 * `true` なら正数の表示先頭にスペースを1つ出す（符号の位置を負数の "-" と揃える）。
 *
 * 【推測で決めた点・理由】 マニュアルの実行例は原文の組版で桁が揃えられており、
 * 先頭スペースの有無そのものを実行例から確定できない。同世代 BASIC の慣行
 * （符号位置を揃えて桁を読みやすくする）から「出す」を暫定採用する。
 *
 * 参照: docs/spec/number_display.md「まだ確定していない規則」
 */
export const POSITIVE_LEADING_SPACE = true;

// ─────────────────────────────────────────────────────────────
// 乱数（RND / RANDOMIZE）
// ─────────────────────────────────────────────────────────────

/**
 * 乱数生成に使う線形合同法の定数（Numerical Recipes 系の値）。
 *
 * 【推測で決めた点・理由】 実機の乱数系列とは一致させられない
 * （`docs/spec` の `RANDOMIZE` は不確定3件のうちの1つ）。系列そのものより
 * 「周期が十分長く偏りが小さいこと」を優先し、広く知られた LCG 定数を
 * 決め打ちで採用した。実機系列の実測ができた場合はこの節を丸ごと差し替える。
 *
 * 参照: docs/design/phase1_runtime.md「乱数」節
 */
export const RANDOM_LCG_MULTIPLIER = 1664525;
/** 線形合同法の増分。上記と同じ根拠。 */
export const RANDOM_LCG_INCREMENT = 1013904223;
/** 線形合同法の法（2^32）。上記と同じ根拠。 */
export const RANDOM_LCG_MODULUS = 2 ** 32;

/**
 * 線形合同法による乱数生成器。`RND` 実装が内部状態として持つ想定。
 *
 * 参照: docs/design/phase1_runtime.md「乱数」節
 */
export class LinearCongruentialGenerator {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    markUncertainUsed('RANDOM_PRNG');
  }

  /** 次の乱数を [0, 1) の範囲で返す。 */
  next(): number {
    this.state = (Math.imul(this.state, RANDOM_LCG_MULTIPLIER) + RANDOM_LCG_INCREMENT) >>> 0;
    return this.state / RANDOM_LCG_MODULUS;
  }
}

/**
 * `RANDOMIZE`（引数なし）で使う既定シード。現在時刻から与える。
 *
 * 【推測で決めた点・理由】 マニュアルに `RANDOMIZE` 引数なし時の挙動の記載が無い。
 * 「実行のたびに違う系列になる」という一般的な BASIC の慣行に従い、現在時刻を
 * シード源とした。
 *
 * 参照: docs/design/phase1_runtime.md「乱数」節
 */
export function seedFromCurrentTime(): number {
  return Date.now() >>> 0;
}

// ─────────────────────────────────────────────────────────────
// REC の予約変数 Y・Z への割り当て
// ─────────────────────────────────────────────────────────────

/**
 * `REC(距離,角度)` 実行後、直交座標の x 成分・y 成分をそれぞれ予約変数 Y・Z の
 * どちらへ割り当てるか。
 *
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` の REC の notes に
 * 詳しいとおり、本文（独語・英語とも同内容）を字義通り読めば「Y=x軸からの距離
 * (=y座標)、Z=y軸からの距離(=x座標)」となるはずだが、英語版の実行例
 * `REC(12,30)→10.39230485` に付いた編集者注記「(x≈10.4)」「(y=6, PRINT Z)」は
 * 逆に「関数値(=x成分)がY、Zがy成分」と読める内容になっており、両版で食い違う
 * （独語版には検証できる数値例が無い）。
 *
 * POL は本文と実行例が一致する（Y=r, Z=θ）のに REC だけ食い違うのは不自然で、
 * 実測でしか確定できない。ここでは **実行例（動く方の記述）を優先** し、
 * 「関数値と同じ x 成分を Y へ、y 成分を Z へ」割り当てる解釈を暫定採用する。
 * 本文の文言どおりに実装するより「サンプルコードをそのまま動かしたときに
 * 実行例の出力(Y≈10.4, Z=6)と一致する」実装の方が、投稿作品との整合性を
 * 壊しにくいと判断した。
 *
 * 予約変数 Y・Z への実際の代入は本モジュール（functions/）の責務外
 * （インタプリタ側が BuiltinContext 経由の戻り値だけでなく、この定数を見て
 * 代入先を決める想定）。REC 関数自体は呼び出し時に `markUncertainUsed`
 * でこの不確定仕様を踏んだことだけを記録する。
 *
 * 参照: docs/spec/basic_commands.yaml の REC エントリの notes
 */
export const REC_ASSIGNS_X_TO_Y = true;

// ─────────────────────────────────────────────────────────────
// CIRCLE の開始角・終了角
// （旧 src/machine/screen.ts から移設。並行作業を避けるため一時的に screen.ts
// 側へ置かれていたが、不確定仕様は本ファイルへ集約する方針のため移した）
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
/**
 * 負角度の意味づけ。英語版の記述に従い、開始角・終了角のいずれかが負のとき、
 * 円弧の両端から中心へ半径線を足して扇形にする。独語版にはこの説明が無いため、
 * 独語版準拠に切り替える場合はここを見直すこと。
 */
export const CIRCLE_NEGATIVE_ANGLE_MEANS_SECTOR = true;

// ─────────────────────────────────────────────────────────────
// BEEP の音程→周波数・持続時間パラメータの解釈
// （旧 src/machine/sound.ts から移設。不確定仕様は本ファイルへ集約する方針のため。
//  根拠コメントは移設元のものをそのまま保持している）
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
  markUncertainUsed('BEEP_PITCH_LINEAR_INTERPOLATION');
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
  markUncertainUsed('BEEP_DURATION_AS_PERIOD_COUNT');
  const periodMs = 1000 / frequencyHz;
  return durationParam * periodMs;
}
