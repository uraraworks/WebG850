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
  | 'BEEP_DURATION_AS_PERIOD_COUNT'
  | 'INPUT_ON_INVALID_NUMBER'
  | 'GRAPHICS_CURSOR_FOLLOWS_DRAWING'
  | 'SCROLL_DEFERRED_UNTIL_NEXT_WRITE'
  | 'CURSOR_SHAPE'
  | 'CURSOR_BLINK_PERIOD_MS'
  | 'CURSOR_VISIBLE_WHEN_IDLE_ONLY'
  | 'DIRECT_MODE_PROMPT'
  | 'ERROR_PREFIX_QUESTION_MARK'
  | 'INITIAL_BASIC_MODE'
  | 'IMPLICIT_THEN'
  | 'UNPARENTHESIZED_CALL_BINDING'
  | 'LINE_TRAILING_SLOTS_BY_CONTENT'
  | 'USING_OVERFLOW_STYLE'
  | 'USING_NEGATIVE_SIGN_PLACEMENT'
  | 'MEMORY_ADDRESS_WRAP'
  | 'MEMORY_BYTE_TRUNCATION'
  | 'MEMORY_NOT_ROM_BACKED'
  | 'INTEGER_DIVISION_ROUNDING';

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

// ─────────────────────────────────────────────────────────────
// INPUT で数値変数に非数値が入力されたときの挙動
// （旧実装は 0 を代入して継続していたが、それでは入力ミスに誰も気づけず
//  改善のループが回らないため見直した。interpreter.ts の executeInput 参照）
// ─────────────────────────────────────────────────────────────

/**
 * `true` なら、数値変数への `INPUT` に非数値文字列が入力されたとき、
 * その値を捨てて同じ変数の入力を求め直す（多くの BASIC の `?REDO` 相当）。
 * `false` なら（旧実装）0 を代入してそのまま先へ進む。
 *
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` の INPUT には
 * 数値変換に失敗した場合の記載が無く未確定。0 を黙って代入する実装は、
 * 利用者の入力ミスも作品側のバグも「なんか変な値が入った」以上の情報を
 * 残さず、誰も気づけないまま実行が進んでしまう（親 CLAUDE.md
 * 「間違いが見えないと改善のループが回らない」に反する）。
 * 再入力を求める側は、実機のポケコン BASIC を含め同世代の多くの実装が
 * 採る挙動であり、「入力ミスが見える」という安全側でもあるため暫定採用する。
 *
 * 参照: docs/spec/basic_commands.yaml の INPUT エントリの notes
 */
export const INPUT_ON_INVALID_NUMBER_REDO = true;

// ─────────────────────────────────────────────────────────────
// PSET / LINE 描画後のグラフィックカーソル追従
// ─────────────────────────────────────────────────────────────

/**
 * `true` なら `PSET` / `PRESET` / `LINE` の描画後、グラフィックカーソルを
 * 描画した点（LINE は終点）へ移動させる。
 *
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` の PSET/PRESET には
 * カーソル追従の記載が無く未確定。ただし LINE の notes には「(x1,y1)省略時は
 * グラフィックカーソルの現在位置を使う」と明記されており、これは
 * `LINE -(x2,y2)` のように前回の描画点から続けて線を引く書き方
 * （同世代 BASIC で広く見られる連結描画のイディオム）を成立させるには、
 * 描画のたびにカーソルが追従している必要がある。PSET/PRESET も同じ追従を
 * させる方が「PSET で打った点から LINE を続ける」書き方が自然に動くため、
 * 3命令とも追従させる側を暫定採用した。
 *
 * 参照: docs/spec/basic_commands.yaml の LINE エントリの params(x1,y1) notes
 */
export const GRAPHICS_CURSOR_FOLLOWS_DRAWING = true;

// ─────────────────────────────────────────────────────────────
// 最下行での改行スクロールのタイミング
// ─────────────────────────────────────────────────────────────

/**
 * `true` なら最下行での改行を「次に文字が書かれる時点まで」遅延スクロールとして
 * 保留する（端末・多くのポケコンBASICの一般的挙動）。`false` なら（旧実装）
 * 改行が発生した瞬間にその場でスクロールする。
 *
 * 【推測で決めた点・理由】 `docs/design/phase1_architecture.md` にスクロールの
 * 発火タイミングの記載が無く未確定。旧実装（即時スクロール）では、画面行数
 * ちょうど（6行）の出力をしただけで最終行の改行が先頭行を押し出してしまい、
 * 「まだ次の文字を1つも書いていないのに1行消える」という利用者から見て
 * 明らかにおかしい挙動になっていた
 * （`10 FOR I=1 TO 5`/`20 PRINT I`/`30 NEXT I`/`40 PRINT "OK"` が
 * `1 2 3 4 5 OK` の6行ちょうどのはずが `2 3 4 5 OK` になる）。
 * 端末や同世代ポケコンBASICで広く見られる「遅延スクロール」（最下行の改行時点
 * ではまだスクロールせず、次に文字を書く／カーソルを要する出力が起きた時点で
 * 初めてスクロールする）を採用すれば、画面ちょうどの出力は最後まで見える。
 * `locate()`/`cls()` でカーソルが移動した場合は保留を解除する（移動後に
 * 遅れてスクロールが発火すると別のバグになるため）。
 *
 * 参照: docs/design/phase1_architecture.md「画面モデル」節
 */
export const SCROLL_DEFERRED_UNTIL_NEXT_WRITE = true;

// ─────────────────────────────────────────────────────────────
// テキストカーソル（LCD上のラインエディタ）の見た目
// ─────────────────────────────────────────────────────────────
//
// `docs/spec/basic_commands.yaml` はテキストカーソルの「位置」の規則
// （PRINT/LOCATE 等でどこへ動くか）しか記述しておらず、カーソルの
// 見た目（形・点滅周期・表示するタイミング）は一切記載が無い。3項目とも
// マニュアルからは確定できないため、ここへ集約して暫定値を1箇所にまとめる。
// 実装は `src/machine/cursorOverlay.ts`（LCDのビットマップは汚さず、
// canvas 描画時にだけ重ねる。`POINT` の結果に影響しない）。

/**
 * カーソルの形。`'block'` はセル全体を反転、`'underline'` はセル最下段の
 * 1ドット行だけを反転する。
 *
 * 【推測で決めた点・理由】 マニュアルに記載が無い。144×48・1セル6×8ドットという
 * 非常に小さい LCD では、下線（1ドット行）だと視認性が低く「どこに文字が
 * 入るか」が分かりにくいと判断し、ブロック（セル全体反転）を暫定採用する。
 * 差し替える場合はこの定数だけを変えればよい。
 *
 * 【根拠を得た】第三者の使用記録（kyoro205.blog.fc2.com/blog-entry-469.html、
 * 個人ブログのPC-G850使い方紹介）に「カーソルキーを押すと黒い■のカーソルが
 * 点滅し、移動させることができる」旨の記述があり、'block' かつ点滅する点は
 * 裏付けが取れた（verified_by: usage_report_3rd_party。`docs/spec/SCHEMA.md` の
 * 区分。使用記録でありマニュアルではない点に注意）。ただし点滅周期
 * （下記 `CURSOR_BLINK_PERIOD_MS`）は不明のまま。
 * 詳細は docs/spec/operation_behavior.md 参照。
 */
export const CURSOR_SHAPE: 'block' | 'underline' = 'block';

/**
 * カーソルの点滅周期（ミリ秒）。この時間ごとに表示⇔非表示が切り替わる
 * （1周期 = 表示 + 非表示で `CURSOR_BLINK_PERIOD_MS * 2`）。
 *
 * 【推測で決めた点・理由】 マニュアルに記載が無い。一般的なターミナル・
 * エディタで広く使われる 500ms 前後の点滅周期を、実測値が無い前提での
 * 妥当な既定値として暫定採用する。
 */
export const CURSOR_BLINK_PERIOD_MS = 500;

/**
 * `true` なら、ダイレクトモードの入力待ち（実行中でない状態）のときだけ
 * カーソルを表示する。`false` ならプログラム実行中も（`INPUT` 待ち以外の
 * 場面を含め）常に表示する。
 *
 * 【推測で決めた点・理由】 マニュアルに記載が無い。プログラム実行中に
 * 画面の好きな位置へカーソルが出ていると、`PRINT`/`LOCATE` によるカーソル
 * 移動がユーザー入力とは無関係に頻繁に起こるため、点滅カーソルが
 * ちらついて画面を読みにくくすると判断した。「入力を受け付けている場面
 * （ダイレクトモードの待機中）でだけ出す」を暫定採用する。
 */
export const CURSOR_VISIBLE_WHEN_IDLE_ONLY = true;

// ─────────────────────────────────────────────────────────────
// ダイレクトモードの入力待ちプロンプト
// （旧実装は src/ui/directMode.ts に 'OK\n' が直書きされ、この不確定仕様が
//  どこにも記録されないまま毎回画面に出続けていた。ここへ集約する）
// ─────────────────────────────────────────────────────────────

/**
 * コマンド実行後、次の入力を待つときに画面へ出すプロンプト文字列。
 *
 * 【推測で決めた点・理由】 `docs/spec/` のどの仕様書にも記載が無い。
 * `OK` は MS-BASIC 系の慣行からの推測にすぎず、実機の根拠は無い。
 *
 * 一方 `docs/spec/operation_behavior.md`「未確定のまま残る事項」節の調査
 * （出典2 `poke-com.jimdofree.com`）には「RUN MODE / PROGRAM MODE では `>`
 * のみが表示される」旨の記述がある。ただしこの出典はシャープのポケコン全般
 * （PC-E200 等を含む）を横断的に扱う記事で、**この記述が G850V/VS 固有かどうかは
 * 確定できない**（verified_by: usage_report_3rd_party としても機種の切り分けが
 * 弱い）。
 *
 * 資料の確度が「G850 固有と確定できない」段階でしかないため、いま `OK` から
 * `>` へ切り替える根拠としては弱いと判断し、**暫定値は現状維持（`OK`）とする**。
 * 差し替える場合はこの定数だけを変えればよい。
 *
 * 参照: docs/spec/operation_behavior.md「未確定のまま残る事項 > 入力待ちの
 * プロンプト表示」
 */
export const DIRECT_MODE_PROMPT = 'OK';

/**
 * ダイレクトモードの入力待ちプロンプトの表示文字列（末尾の改行込み）を返す。
 * `markUncertainUsed` は呼び出し側の都度ではなく、ここへ集約して1回だけ呼ぶ。
 */
export function directModePrompt(): string {
  markUncertainUsed('DIRECT_MODE_PROMPT');
  return `${DIRECT_MODE_PROMPT}\n`;
}

// ─────────────────────────────────────────────────────────────
// エラー表示先頭の "?"
// ─────────────────────────────────────────────────────────────

/**
 * `true` なら `ERROR n` / `UNSUPPORTED name` の表示の先頭に `?` を付ける
 * （例: `?ERROR 10`）。`false` なら付けない（例: `ERROR 10`）。
 *
 * 【推測で決めた点・理由】 `docs/spec/` のどの仕様書にも `?` の記載は無い。
 * `docs/spec/operation_behavior.md` の調査（出典2）は「`ERROR ●●` を `CLS`
 * キーで消せる」と書いており、先頭に `?` が付くとは読めない。
 *
 * 一方、このプロジェクト独自の `?UNSUPPORTED name`（未実装命令の表示。実機由来
 * ではなくこのエミュレータだけの表示）は既に `?` 付きで実装されている。`ERROR`
 * とは出自が違う表示だが、画面上では両者が同じ「実行が止まったときのメッセージ」
 * という役割を共有しており、片方だけ `?` が有る/無いと利用者から見て一貫しない
 * （「同じ場面で出るメッセージなのに時々 `?` が消える」という体験になる）。
 *
 * ここでは **`?UNSUPPORTED` との表示上の一貫性を、資料の字面（`ERROR ●●` に
 * `?` が無いこと）より優先** し、`ERROR` 側にも `?` を付ける（＝現状維持）を
 * 暫定採用する。`?UNSUPPORTED` 自体は実機由来ではないためこの定数の対象外
 * （実機の書式に合わせる必要が無い）。資料の記述どおり `ERROR` からだけ `?` を
 * 外す場合はここを `false` にする。
 *
 * 参照: docs/spec/operation_behavior.md「未確定のまま残る事項 > エラー表示の
 * 実際の文字列」
 */
export const ERROR_PREFIX_QUESTION_MARK = true;

/**
 * `ERROR n` の表示プレフィックス（例: `?ERROR 10` または `ERROR 10`）を組み立てる。
 * `?UNSUPPORTED` はこの関数を経由しない（上記コメントの通り実機由来ではないため）。
 */
export function formatErrorPrefix(code: number): string {
  markUncertainUsed('ERROR_PREFIX_QUESTION_MARK');
  return ERROR_PREFIX_QUESTION_MARK ? `?ERROR ${code}` : `ERROR ${code}`;
}

// ─────────────────────────────────────────────────────────────
// 電源投入直後の動作モード（PRO / RUN）
// ─────────────────────────────────────────────────────────────

/**
 * 電源投入直後（＝このエミュレータの起動直後）の動作モード。
 *
 * 【推測で決めた点・理由】 `docs/spec/operation_behavior.md`「未確定のまま残る
 * 事項」の「電源投入直後の画面表示」のとおり、実機の電源投入直後がPRO/RUN
 * どちらのモードかは、参照した第三者の使用記録3本のいずれにも記載が無く
 * 未確定である。
 *
 * ここでは **PRO を暫定採用する**。理由：ダイレクトモードは「電源を入れたら
 * すぐ画面に打てる」ことを重視しており（`ui/directMode.ts` 冒頭コメント）、
 * 初見の利用者が最初に触るのは大抵「行番号付きでプログラムを打つ」操作。
 * RUN モードを既定にすると、数字始まりの入力がプログラムとして格納されず
 * 「何を打っても消える（計算されるだけ）」ように見え、初見の利用者が
 * 一番詰まりやすい形になる。PRO を既定にしておけば、電卓的な計算だけしたい
 * 利用者は `BASIC` キー（ホスト割当は `ui/directMode.ts` の `toggleMode` 参照）
 * を1回押すだけで RUN へ切り替えられるため、詰まりの被害が小さい側を選んだ。
 *
 * 参照: docs/spec/operation_behavior.md「未確定のまま残る事項」
 */
export const INITIAL_BASIC_MODE: 'PRO' | 'RUN' = 'PRO';

/**
 * 起動時の動作モードを取得する。`directModePrompt()` と同じ形（呼ぶたびに
 * `markUncertainUsed` を1回集約して呼ぶ）で、`ui/directMode.ts` の
 * コンストラクタから1回だけ呼ぶ想定。
 */
export function initialBasicMode(): 'PRO' | 'RUN' {
  markUncertainUsed('INITIAL_BASIC_MODE');
  return INITIAL_BASIC_MODE;
}

// ─────────────────────────────────────────────────────────────
// IF の THEN 省略
// ─────────────────────────────────────────────────────────────
//
// 実装は src/basic/parser.ts の parseIfStmt。ここには判断の根拠だけを記す
// （フラグではなく分岐そのものが実装なので、切り替え用の定数は無い。
// `markUncertainUsed('IMPLICIT_THEN')` を踏んだ箇所を見れば実装位置は分かる）。

/**
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` の IF は
 * `format: "IF <条件> THEN <行番号>|*ラベル|<文> [ELSE …]"` と THEN 必須の
 * 書式のみを記載しており、THEN 省略はマニュアルに記載が無い。
 *
 * 一方、実在作品31本を機械解析した結果、IF の出現1063箇所のうち THEN 付きは
 * わずか33箇所（97%が省略）だった。28作品が省略形を使っており、
 * マニュアルの書式より実際の使用実態の方が圧倒的に優勢という逆転した状況。
 * この規律プロジェクトの成功指標は「実在の作品が動くか」（親 CLAUDE.md）なので、
 * マニュアルの記載より実測された使用実態を優先し、THEN 省略を受理する。
 *
 * 【既知の制約】 THEN 省略時、条件式の直後に `*ラベル` を続けることはできない。
 * `*` は乗算演算子と同じトークンのため、条件式パーサが `IF A=1 *LOOP` を
 * 「`A=1*LOOP` という乗算を含む条件式」として食べてしまい曖昧性を切り分けられない
 * （THEN 付きなら THEN が明確な区切りになるため問題にならない）。実在作品の計測でも
 * THEN 省略と `*ラベル` の組み合わせは確認されていないため対応対象外とした。
 * `*ラベル` へ飛びたい場合は THEN を書けば従来どおり動く。
 *
 * 参照: docs/design/phase1_grammar.md「IF は2形態ある」節
 */
export const IMPLICIT_THEN_NOTE = 'THEN省略は実在作品31本の計測(IF 1063箇所中THEN付き33箇所)を根拠に受理する';

// ─────────────────────────────────────────────────────────────
// 括弧なし関数呼び出しの束縛の強さ
// ─────────────────────────────────────────────────────────────
//
// 実装は src/basic/parser.ts の parseFunctionOrUnsupported。

/**
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` の各関数 format は
 * すべて `NAME(<引数>)` の括弧付き書式のみを記載しており、括弧を省略した
 * 呼び出し（`CHR$ 135` 等）はマニュアルに記載が無い。
 *
 * 実在作品31本の計測では、引数1個の関数について括弧なし呼び出しが29作品で
 * 常用されていた（例: `CHR$ 135` `RND 6` `VAL A$` `LEN A$`）。ただし
 * **引数が複合式のときは作者が例外なく括弧を付けている**（`CHR$ (140-B)`、
 * `INT ( RND (0` 等）。この観測から「括弧なし形式は単純な一次式にしか
 * 使われていない」と読み取り、括弧なし引数は**式全体ではなく単項/一次式
 * レベル（優先順位表 #1〜#3、`parseUnarySign` が読む範囲）までしか読まない**
 * と決めた。つまり `CHR$ 140-B` は `CHR$(140-B)` ではなく `CHR$(140)-B`
 * （140 だけを引数に取り、その後 B を引き算する）と解釈する。
 *
 * 引数2個以上の関数（`MID$` 等）は元々括弧必須の書式しか観測されておらず、
 * このプロジェクトでも括弧必須のまま変更していない。
 *
 * 差し替える場合: `parser.ts` の `parseFunctionOrUnsupported` 内、
 * `args = [parseUnarySign(cursor)]` の行を別の優先順位のパーサ関数
 * （例えば `parseMultiplicative` 等）に差し替えれば束縛の強さが変わる。
 *
 * 参照: docs/design/phase1_grammar.md「一次式」節
 */
export const UNPARENTHESIZED_CALL_BINDING_NOTE =
  '括弧なし引数は単項/一次式レベル(#1-3)までしか読まない。根拠は実在作品31本の計測(複合式には括弧を付ける慣行)';

// ─────────────────────────────────────────────────────────────
// LINE 末尾3スロット（モード／線種／矩形）の判定基準
// ─────────────────────────────────────────────────────────────
//
// 実装は src/basic/parser.ts の parseLineStmt。

/**
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` の LINE は
 * `format: LINE [(<x1>,<y1>)]-(<x2>,<y2>)[,S|R|X][,<線種>][,B|BF]` と、
 * モード→線種→矩形の3スロットが位置固定である書式のみを記載している。
 * この書式に厳密に従うと、モードと線種を省略して矩形だけ指定したい場合は
 * `,,,B`（空スロットぶんのカンマを毎回打つ）が必須になるはずだが、
 * 実在作品31本の計測では `LINE (x1,y1)-(x2,y2),B` のように空スロットの
 * カンマを省き、1個のカンマの直後に矩形指定を直接書く用例が複数件見つかった。
 *
 * マニュアルの位置固定書式と実際の使用実態が食い違うため、位置ではなく
 * **トークンの内容**（`S`/`R`/`X` はモード、`B`/`BF` は矩形、それ以外は式として
 * 線種）でスロットを判定する方式に変更した。位置固定の書き方（`,,,B` 等）も
 * 内容判定と矛盾しないためそのまま動く。実測でモード/矩形が同時に複数回
 * 現れることは無かったため、同じ種類のスロットが2回現れた場合は構文エラーに
 * している（無言で片方を無視すると入力ミスに気づけないため）。
 *
 * 参照: docs/spec/basic_commands.yaml の LINE エントリ (format)
 */
export const LINE_TRAILING_SLOTS_BY_CONTENT_NOTE =
  'LINE末尾3スロット(モード/線種/矩形)は位置ではなくトークン内容で判定する。根拠は実在作品31本の計測(空スロットのカンマを省いてB/BFを直接書く用例)';

// ─────────────────────────────────────────────────────────────
// USING / PRINT USING の桁あふれ・符号の扱い
// ─────────────────────────────────────────────────────────────
//
// 実装は src/basic/using.ts の formatUsingNumber。

/**
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` の USING/PRINT は
 * `#`=数値の桁、`.`=小数点区切りというプレースホルダの意味しか記載しておらず、
 * 桁数を超える値を書式に当てはめたとき（桁あふれ）の表示形式はマニュアルに
 * 記載が無い。
 *
 * ここでは同世代・同系統の MS-BASIC が広く採用する慣行（桁あふれ時は書式を
 * 諦めて `%` を数値の前に付け、丸めのない完全な値をそのまま出す）を暫定採用する。
 * 実機固有の挙動ではなく他機種からの類推であることを明示するため、値そのもの
 * （`%` 付き）は変えず、根拠をここに集約した。差し替える場合は
 * `using.ts` の `formatUsingNumber` の桁あふれ分岐のみを直せばよい。
 *
 * 参照: docs/spec/basic_commands.yaml の USING / PRINT エントリ
 */
export const USING_OVERFLOW_STYLE_NOTE =
  '桁あふれ時は"%"を前置してまるめ無しの完全な値を出す(MS-BASIC系の慣行からの類推。実機未確認)';

/**
 * 【推測で決めた点・理由】 負数を書式へ当てはめる際、符号をどこに置くか
 * （整数部の余白へ詰めるか、専用の桁を要求するか）もマニュアルに記載が無い。
 * 整数部の余白（`#` のうち実際の桁より多く確保された分）があればそこへ
 * `-` を1文字割り当て、余白が無ければ桁あふれと同じ扱い（`%` 付き）にする、
 * という「桁あふれと同じ判定基準を符号にも適用する」単純な規則を採用した。
 *
 * 参照: docs/spec/basic_commands.yaml の USING / PRINT エントリ
 */
export const USING_NEGATIVE_SIGN_PLACEMENT_NOTE =
  '負符号は整数部の余白へ詰める。余白が無ければ桁あふれと同じ%付き表示にする(実機未確認、桁あふれ規則からの単純な拡張)';

// ─────────────────────────────────────────────────────────────
// PEEK / POKE のメモリモデル
// ─────────────────────────────────────────────────────────────
//
// 実装は src/machine/memory.ts の MemoryBank。
//
// 【重要な割り切り】 このエミュレータは ROM を持たないため、実機の
// メモリマップ（BIOS/システムワークエリア等がどのアドレスに何を持つか）を
// 再現することは原理的にできない（親 CLAUDE.md「ROM を使わない」）。
// 実在作品での PEEK/POKE の使われ方を調べた結果、`&HF5`〜`&HFF`
// （ゼロページ末尾の数バイト）を「電源を切っても消えない小さなメモリ」
// としてハイスコア保存に使うだけの用例しか無かったため、実機のメモリ
// マップとは無関係な、**単なる読み書き可能なバイト配列**として実装する。
// 実機で意味を持つ番地（BIOSワークエリア等）を読んでも、このエミュレータでは
// 単に「未書き込み＝0」が返るだけであり、実機の値を再現しない。この制限は
// 隠さず、ここと docs/spec 側の両方に明記する
// （親 CLAUDE.md「わかる範囲で動かし、不確定な仕様は…知りたい人が確認できる
// 場所に出す」）。
export const MEMORY_NOT_ROM_BACKED_NOTE =
  'PEEK/POKEは実機メモリマップを再現しない単なるバイト配列。ROM非依存の方針により実アドレスの内容は再現不能で、未書き込みアドレスは常に0を返す';

/**
 * 【推測で決めた点・理由】 アドレスの有効範囲は `docs/spec/basic_commands.yaml`
 * に `0 <= addr <= 65535` と明記されているが、範囲外を指定したときの挙動
 * （エラーにするか、切り詰めるか）はマニュアルに記載が無い。
 *
 * ここでは「アドレスバスの幅を超えた分は無視される」という物理的なメモリの
 * 素直な解釈（16ビット＝65536通りに折り返す）を採用し、`addr mod 65536`
 * （負値は正規化）で折り返す。エラーで停止させるより「壊れない側」を選ぶ
 * という本プロジェクトの一貫した方針（`FOR_CHECKS_BEFORE_BODY` 等と同じ考え方）
 * にも合致する。
 *
 * 参照: docs/spec/basic_commands.yaml の PEEK/POKE エントリ
 */
export function wrapMemoryAddress(addr: number): number {
  markUncertainUsed('MEMORY_ADDRESS_WRAP');
  const wrapped = Math.trunc(addr) % 65536;
  return wrapped < 0 ? wrapped + 65536 : wrapped;
}

/**
 * 【推測で決めた点・理由】 POKE のバイト値の範囲は `0 <= b <= 255` と
 * 明記されているが、範囲外を指定したときの挙動（クランプするか、折り返すか、
 * エラーにするか）はマニュアルに記載が無い。
 *
 * ここでは「1バイトのレジスタは下位8ビットしか保持できない」という
 * 物理的なメモリの素直な解釈（`value & 0xFF`）を採用する。クランプ
 * （範囲外を0か255に丸める）よりも「上位ビットが捨てられるだけ」という
 * 実際のハードウェアの挙動に近く、根拠が強い側を選んだ。
 *
 * 参照: docs/spec/basic_commands.yaml の POKE エントリ
 */
export function truncateMemoryByte(value: number): number {
  markUncertainUsed('MEMORY_BYTE_TRUNCATION');
  // `&` は32bit二の補数表現で計算されるため、0xff との AND は
  // 符号に関係なく常に 0〜255 に収まる（-1 & 0xff === 255 等）。
  return Math.trunc(value) & 0xff;
}

// ─────────────────────────────────────────────────────────────
// `\`（整数除算演算子）の丸め方向
// ─────────────────────────────────────────────────────────────
//
// 実装は src/basic/evaluator.ts の evalBinary（case '\\'）。
// 優先順位（`*` `/` `MOD` と同グループ・左結合）は parser.ts の
// parseMultiplicative 側のコメントを参照（`docs/spec/basic_commands.yaml`
// MOD エントリの notes が「整数除算(¥)とMODの対比計算例」を同じ節に
// 並記していると記す通り、MOD と同順位と判断した。この判断自体は
// 資料の並記に基づくため不確定仕様には含めていない）。

/**
 * 四捨五入（0.5 は絶対値が大きくなる方向、すなわち符号ごとに離れる方向へ丸める）。
 * `docs/spec/basic_commands.yaml` MOD エントリの notes にある実行例
 * `51 MOD -5.7=3(-5.7は-6に丸められ…)` がこの丸め方向（-5.7→-6、0から離れる側）
 * を示しているため、`\` にも同じ規則を適用する。
 */
export function roundHalfAwayFromZero(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * 【推測で決めた点・理由】 `docs/spec/basic_commands.yaml` には `\` 単独の
 * エントリが無く、MOD エントリの notes に「整数除算(¥)とMODの対比計算例」が
 * 英語版マニュアル(3章 Manual Calculations の算術演算子表)に並記されていた、
 * という記述があるのみ。この notes は「両オペランドを四捨五入で整数に丸めて
 * から0方向切り捨ての整数除算・剰余を返す」という丸め規則を、MOD の実行例
 * （`51 MOD -5.7=3` 等）から導いたものであり、`\` 自身の独立した実行例は
 * まだ確認できていない。
 *
 * ここでは MOD と対比計算例として並記されていた資料の性質上、`\` にも
 * 同じ丸め規則（両オペランドを四捨五入で整数化してから 0 方向切り捨ての
 * 商を返す）を適用するのが最も根拠のある選択と判断し、暫定採用する。
 *
 * 【既知の割り切り】 現在の `evaluator.ts` の MOD 実装は JS の `%` を
 * そのまま使っており、この丸め規則を適用していない（MOD 自体の丸め挙動は
 * このタスクのスコープ外のため未修正のまま）。そのため `\` と MOD で
 * 丸めの有無が食い違う状態が残る。丸め規則を実測できた場合、または
 * MOD 側の丸め挙動を見直す場合は、この関数と `evaluator.ts` の両方を
 * 合わせて差し替えること。
 *
 * 参照: docs/spec/basic_commands.yaml MOD エントリの notes
 */
export function integerDivide(dividend: number, divisor: number): number {
  markUncertainUsed('INTEGER_DIVISION_ROUNDING');
  const li = roundHalfAwayFromZero(dividend);
  const ri = roundHalfAwayFromZero(divisor);
  return Math.trunc(li / ri);
}
