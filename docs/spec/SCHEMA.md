# BASIC 命令セット仕様書 スキーマ定義

`docs/spec/*.yaml` の書式定義。これは **Phase 1（互換 BASIC）の設計書兼テスト仕様**である。

## 大原則

1. **原文（ドイツ語マニュアル）の散文を翻訳して貼らない。**
   抽出するのは「命令名・書式・引数の型と範囲・返り値・エラー条件」という**事実**だけ。
   説明文は自分の言葉で 1〜2 文に要約して `summary` に日本語で書く。
2. **推測で埋めない。** マニュアルに書かれていない項目は `null` にし、
   `status: needs_measurement` を立てる。もっともらしい値を入れるのが最悪の失敗。
3. **OCR 由来のノイズを疑う。** 底本は OCR された PDF で、`0`↔`O`、`≤`→`s`、
   `1O:` のような誤認が実在する。書式行が壊れていると判断したら
   `ocr_suspect: true` を立て、`format` には読み取れた通りを入れて `notes` に所見を書く。
   きれいに直したように見せない。

## ファイル一覧

| ファイル | 内容 |
|---|---|
| `basic_commands.yaml` | 命令・関数・コマンドの一覧（本体） |
| `basic_errors.yaml` | BASIC エラーコード一覧 |
| `basic_tokens.yaml` | BASIC 中間コード表（テキスト ⇄ 内部形式） |

## basic_commands.yaml

トップレベルは `commands:` の配列。1 要素 = 1 命令。

```yaml
commands:
  - name: ABS                  # 正式表記。$ や # を含む場合はそのまま（例: LEFT$, PRINT#）
    aliases: []                # 別表記・略記（例: REM に対する ')
    kind: function             # 下記「kind」参照
    category: math             # 下記「category」参照
    format: "ABS(<数値式>)"     # マニュアル記載の書式。角括弧=省略可、| =択一 の記法を保つ
    summary: "数値式の絶対値を返す。"   # 日本語 1〜2 文
    params:
      - name: 数値式
        type: numeric          # numeric | string | var | array | line_no | file_no | expr | any
        optional: false
        range: null            # 例: "-1 <= x <= 1"。記載が無ければ null
        notes: null
    returns: numeric           # numeric | string | none
    errors: []                 # 例: ["ERROR 1", "引数が範囲外のとき ERROR 2"]。不明なら []
    phase: 1                   # 1 | 2 | 3 （下記「phase」参照）
    status: documented         # documented | partial | needs_measurement
    ocr_suspect: false
    verified_by: manual_3rd_party        # 下記「verified_by」参照
    verifiable_by_measurement: true      # 下記「verifiable_by_measurement」参照
    source: "manual_de p.182 / manual_en p.182"   # 底本と該当ページ
    notes: null                # 実装時の注意、機種差、疑問点
```

### kind

| 値 | 意味 |
|---|---|
| `function` | 式の中で値を返すもの（`ABS`, `LEFT$`, `INKEY$`） |
| `statement` | プログラム行に書く命令（`PRINT`, `FOR`, `GOTO`） |
| `command` | 主にダイレクトモードで使うもの（`RUN`, `LIST`, `NEW`） |
| `operator` | 演算子・書式指定（`USING`, `&H`） |

`RUN` のように両用のものは主用途で選び、`notes` に併記する。

### category

`math` / `string` / `control`（分岐・ループ）/ `var`（変数・配列・DATA）/
`io`（PRINT・INPUT・画面）/ `graphics` / `file`（RAM ディスク・シリアル）/
`hardware`（PEEK・POKE・CALL・OUT・INP・PIO）/ `system`（モード・デバッグ・その他）

### phase — 実装フェーズ

| 値 | 基準 |
|---|---|
| `1` | ROM 非依存で実装できる。互換 BASIC の範囲（演算・文字列・制御・PRINT・グラフィック） |
| `2` | Z80 コアや BIOS・実機メモリ配置に依存する（`CALL` `PEEK` `POKE` `OUT` `INP` `MON`） |
| `3` | 周辺機器・ファイル・プリンタ・PIC など、後回しでシーンへの影響が小さいもの |

迷ったら小さい番号を選ばず、`notes` に判断理由を書く。

### status

| 値 | 基準 |
|---|---|
| `documented` | 書式・引数・返り値がマニュアルから確定できる |
| `partial` | 一部（誤差挙動・端数処理・エラー条件など）が未確定 |
| `needs_measurement` | 実測が必要。ブラックボックス実測の対象リストになる |

### verified_by — 何を根拠にそう書いたか

**根拠の強さを混ぜないための列。** 一番強い根拠を1つ書く。

| 値 | 意味 |
|---|---|
| `hardware` | 実機で実測した。最強 |
| `manual_official` | シャープ純正の資料に記載がある |
| `emulator_rom` | **本物の ROM を実行する**エミュレータ（g800＋自分のROM／PockEmul）で実測した |
| `manual_3rd_party` | 第三者編纂のマニュアルに記載がある。**現在の既定値** |
| `emulator_compat` | ROM を実行しない互換実装で観測した。**原則として採用しない**（他人の推測を写すため） |
| `none` | 根拠なし。中間コード表に名前があるだけ、など |

**同じ系譜の資料が複数一致しても根拠は強くならない。**
ドイツ語版 v1.3 と英語版 v3.0 は同一系譜（後者は前者の英訳・改訂）なので、
両方に載っていても `manual_3rd_party` のまま。ただし OCR は独立なので、
両版が一致したら `ocr_suspect` は下ろしてよい。

エミュレータも同様に、g800 / webg850 / sharp-pc-g800a は同一系譜で票が増えない。
独立した2票目は PockEmul だけ。

### verifiable_by_measurement — 測定で裏が取れる種類の情報か

**これが `false` のものは、出所がどこであれ採用しない。**

- `true` … 入力を与えて出力を観測すれば、誰でも同じ結論に到達できる
  （命令の書式、戻り値、エラー番号、中間コードのバイト値、I/O ポートの効果、
  BIOS ルーチンのアドレスと引数）
- `false` … 観測では到達できず、ROM を逆アセンブルしないと書けない
  （ROM 内部の処理手順・分岐構造、外から観測できないワークエリアの用途）

個人の解析サイトを参照してよいかの判定は、サイトの信頼性ではなく**この列**で決める。
各段階が適法でも、由来の鎖はつながったまま残るため。

BASIC 命令はほぼ全て `true` になる（打てば分かるため）。この列が効いてくるのは
Phase 2 の BIOS ルーチンから。

## basic_errors.yaml

```yaml
errors:
  - code: 10
    summary: "構文が解釈できない。"  # 日本語。自分の言葉で書く
    triggers: []                    # 発生条件が書かれていれば箇条書き（日本語）
    source: "manual_de p.296 / manual_en p.297"
```

**底本の解説文を原文で持つフィールドは置かない。**
以前 `message_de` に底本のドイツ語解説文を逐語で入れてしまい、削除した経緯がある。
実機が表示するのは番号だけで、あの文はエラー識別子ではなく著作物としての解説文である。
親切心で書き戻さないこと。

原文を残してよいのは、**実機が実際に画面に出す文字列**だけ（それは識別子であり事実）。
現時点でその文字列は未確認なので、確認できたら `message_display` として追加する。

## basic_tokens.yaml

```yaml
meta:
  source: "akiyan.com / PC-G850S 中間コード表（情報元: ポケコンの場所）"
  caveat: "G850S ベース。G850V との差分は未検証。"
tokens:
  - code: 0x11        # 上位4ビット×16+下位4ビット
    name: "RUN"
```

空セル（未割り当てコード）は**要素を作らない**。行と列の対応を崩さないよう、
HTML の `<table>` を直接パースすること（テキスト化すると空セルが詰まって全体がずれる）。
