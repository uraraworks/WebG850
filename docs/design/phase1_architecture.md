# Phase 1 アーキテクチャ設計

互換 BASIC インタプリタの実装方針。**ROM を使わない独立実装**である前提は
`CONTRIBUTING.md` / 親の `CLAUDE.md` を参照。ここでは「どう作るか」だけを書く。

## 到達目標

`docs/spec/basic_commands.yaml` で `phase: 1` の 102 命令が動くこと。
Z80 コアも BIOS も無しに、TypeScript だけで完結する。

## 全体構成

```
ソーステキスト
   │  tokenizer.ts     行番号＋トークン列へ
   ▼
トークン列
   │  parser.ts        行単位で AST へ（プログラム格納時に一度だけ）
   ▼
Program（行番号 → Statement[]）
   │  interpreter.ts   ジェネレータで1文ずつ実行
   ▼
Machine（screen / keyboard / sound）
```

**パースは入力時に一度だけ**行い、実行時は AST を歩く。実機は中間コードを
逐次解釈するが、そこを真似ても観測できる差は出ない（速度は元々桁違いなので
`docs/spec` の精度指標に効かない）。中間コード（`basic_tokens.yaml`）は
LIST 表示とセーブ形式の互換のために別途使う。

## 実行モデル：ジェネレータ

ブラウザではブロッキングできない。`INPUT` のキー待ち、`WAIT` の時間待ち、
無限ループ中の画面更新、BREAK キー — いずれも実行を中断して制御を返す必要がある。

インタプリタの実行本体を `function*` で書き、中断が要る箇所で `yield` する。

```ts
type Suspend =
  | { kind: 'input';  prompt: string }   // キー入力待ち
  | { kind: 'wait';   ms: number }       // 時間待ち
  | { kind: 'yield' }                    // 画面更新のための譲渡
  | { kind: 'end' }
```

ホスト（`ui/runtime.ts`）は `requestAnimationFrame` ごとに一定ステップ回し、
`yield` が返ったら描画して次フレームへ。これで `setTimeout` の入れ子も
状態機械の手書きも要らず、`for` ループや `GOSUB` の再帰が素直に書ける。

**理由の記録**: 過去に別プロジェクトで「コアが実時間に自己同期していて
呼び出し回数を増やしても進まない」問題を踏んでいる。ここは自前実装なので
ステップ数＝進行量が保証される側に倒す。

## 数値モデル

実機は BCD・仮数 10 桁・指数 ±99 の単精度のみ（倍精度は無い）。

**採用**: 内部計算は JavaScript の `number`（IEEE754 double）で行い、
**表示・文字列化のときだけ 10 桁へ丸める**。

- 根拠: 精度方針（完全再現は目指さない）に従う。BCD 10 桁演算器を書けば
  丸め誤差まで一致させられるが、`docs/spec` の成功指標（実在作品が動くか）に
  効かない一方でコストと不具合の温床が大きい
- 影響が出るのは「10 桁を超える桁で誤差が可視化される計算」だけで、
  投稿作品でそこに依存するものは想定しにくい
- 集約先: `src/basic/number.ts` の `MANTISSA_DIGITS = 10` と
  `EXPONENT_MAX = 99`。差し替えるならこの 1 ファイルで済む形にする

オーバーフロー（|x| >= 1e100）は ERROR を出す。無言で `Infinity` を垂れ流さない。

## 画面モデル

**144 × 48 ドットの単一ビットマップ 1 枚**（`Uint8Array(144*48)`、1 バイト 1 ドット）。

- テキストは 24 桁 × 6 行。1 セル 6 × 8 ドット、字形は 5 × 7 を左上詰め
- テキストとグラフィックは**同じ面**。`PSET` で文字を欠けさせられるし、
  `PRINT` はその領域のドットを上書きする。実機と同じ振る舞いになる
- 字形（`src/machine/font.ts`）は **ROM から吸わず自分で打つ**。
  ASCII 0x20–0x7E ＋ カナを順次埋める。未定義コードは「未実装が見える」よう
  全点灯の箱を出す（無言で空白にしない）

## 未実装を無言にしない

親 `CLAUDE.md` の「適当だと分からないのは別問題」に対応する実装規則。

- パーサが知らない命令に出会ったら `UnsupportedError(name)` を投げ、
  画面に `?UNSUPPORTED <名前> IN <行番号>` と出す。握り潰さない
- 引数の一部だけ未対応（例: `CIRCLE` のパターン指定）の場合も、
  黙って無視せず `machine.reportUnimplemented(...)` に記録する。
  常時警告はしないが、デバッグパネルから一覧できる
- 不確定仕様（`CIRCLE` / `REC` / `RANDOMIZE` の 3 件）は
  `src/basic/uncertain.ts` に名前付き定数として集約し、
  `docs/spec/basic_commands.yaml` の該当エントリを参照コメントで書く

## ディレクトリ構成

```
src/
  basic/
    tokenizer.ts     テキスト → トークン列
    token.ts         トークン種別の定義
    ast.ts           AST ノード型
    parser.ts        トークン列 → AST
    number.ts        数値の丸め・書式化（10桁）
    value.ts         値（数値／文字列）と型変換
    errors.ts        BasicError（basic_errors.yaml の番号に対応）
    interpreter.ts   実行エンジン（ジェネレータ）
    functions/       組込み関数（math.ts / string.ts）
    statements/      命令の実装
    uncertain.ts     不確定仕様の集約
  machine/
    screen.ts        144x48 ビットマップ＋テキストカーソル
    font.ts          5x7 字形（自作）
    keyboard.ts      キー状態と INKEY$ バッファ
    sound.ts         BEEP（WebAudio）
    machine.ts       上記の束ね役
  ui/
    runtime.ts       rAF ループとジェネレータの駆動
    main.ts          エントリポイント
    canvas.ts        ビットマップ → canvas 描画
index.html
test/                vitest
```

## テスト方針

`vitest`。単体テストは「入力 BASIC ソース → 期待する画面出力／変数状態」の形で書く。
画面はビットマップを文字列にダンプして比較できるヘルパを用意する。

不確定仕様の箇所には必ずテストを当てる。解釈を差し替えたときに
どこが変わるかが即座に分かる状態を保つ。

## ビルド

Vite + TypeScript + Vitest のみ。ランタイム依存パッケージはゼロ。
`npm run build` で `dist/` に静的ファイルが出て、そのまま GitHub Pages に置ける。
「ブラウザを開くだけで動く」ためにサーバ側処理は一切持たない。
