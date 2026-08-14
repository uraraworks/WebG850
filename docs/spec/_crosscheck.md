# basic_tokens.yaml ⇔ basic_commands.yaml 突き合わせ

`basic_tokens.yaml`（141件）と `basic_commands.yaml`（本突き合わせ実施時点で123件。本突き合わせで判明した
抽出漏れ・演算子・トークン表のみ存在の計13件を追加し、現在は136件）の name を突き合わせた結果。
表記ゆれ（`FOR .. NEXT` と `FOR` など）は正規化（`..`/`...`/`/`/`->` 等の区切りで分割）して
突き合わせ、一致したものは「ゆれ」として分離した。

## 1. トークン表にあるが命令一覧に無いもの（20件）

うち、マニュアル第13章 KOMMANDO LEXIKON に本文が実在するのに抽出漏れしているもの:

- **HSN**（0x8A, sinh x, p.27/208付近, 例: `HSN 4 → 27.2899172`）
- **HTN**（0x8C, tanh x, p.27, 例: `HTN 0.9 → 0.71629787`）
- **MDF**（0x80, Modifizierungs-Funktion, p.28, manual.txt 1704行目に本文あり）

→ この3件は `basic_commands.yaml` に項目自体が存在しない**抽出漏れ**。次回作業で追加が必要。

manual.txt 全文検索でも見出しが一切見つからず、そもそも本マニュアルに未収録と判断したもの:

- **CLOAD**（0x16）
- **CSAVE**（0x20）
- **HDCOPY**（0x4C）
- **SPINP**（0x4B）
- **SPOUT**（0x4A）

第13章ではなく別の章（演算子・式の解説章）で説明されており、ch13 の命令レキシコン範囲外と
確認できたもの:

- **AND**（0xA1, 5.11章「論理式」p.42 で説明。命令レキシコンではない）
- **OR**（同上）
- **NOT**（同上）
- **XOR**（同上）
- **MOD**（3章「手動計算」の演算子一覧 p.16 で説明。命令レキシコンではない）
- **STEP**（`FOR..TO..STEP` の構文要素。FOR の項目に内包）
- **TO**（同上、`FOR..TO` の構文要素）
- **AS**（`OPEN..AS` の構文要素。OPEN の項目に内包）
- **APPEND**（`OPEN..FOR APPEND` の構文要素。OPEN の項目に内包）
- **OUTPUT**（`OPEN..FOR OUTPUT` の構文要素。OPEN の項目に内包）

表記ゆれとして別枠に分離したもの（トークン表側の綴りが命令一覧と食い違う）:

- **POIPUT**（0x49）→ 命令一覧では `PIOPUT`。manual.txt 本文（10633-10638行目、目次526行目）は
  一貫して `PIOPUT` であり、`POIPUT` はトークン表側（akiyan.com の中間コード表）の
  誤記／OCR起因の疑いが強い。
- **LNINPUT**（0x63）→ 命令一覧では `LNINPUT#`。`#` の有無の差で、INPUT#/PRINT# と同種の
  表記ゆれ（下記2章参照）。

## 2. 命令一覧にあるがトークン表に無いもの（10件）

- **AUTO**
- **BLOAD**
- **BLOAD M**
- **BLOAD ?**
- **BSAVE**
- **BSAVE M**
- **INPUT#**
- **LNINPUT#**
- **PIOPUT**
- **PRINT#**

このうち `INPUT#` `LNINPUT#` `PRINT#` はトークン表に `INPUT` `LNINPUT` `PRINT`
（`#` 無し）としてそれぞれ存在しており、末尾 `#` の有無だけの**表記ゆれ**と判断できる
（3章参照）。`PIOPUT` はトークン表側の誤記 `POIPUT` との表記ゆれ（1章参照）。

残る `AUTO` `BLOAD` `BLOAD M` `BLOAD ?` `BSAVE` `BSAVE M` の6件は、トークン表に対応する
1バイトコードが見当たらない。`BLOAD`/`BSAVE` は引数違いのバリエーション（`M`=メモリ,
`?`=確認）を命令一覧側で個別項目化しているため、実際のトークンは共通の1つ
（例えば `BLOAD`/`BSAVE` 本体のコード1個）である可能性が高い。トークン表を目視で
再確認したが該当コードが見つからず、**2バイトトークンの可能性**、または
トークン表自体が未収録の可能性がある。要確認。

## 3. 表記ゆれとして正規化一致したもの（9件）

区切り記号（`..` `...` `/` `->`）で分割し、分割後の全要素がトークン表と一致したもの。
実質的に同一命令であり、1章・2章のリストからは除外済み。

| 命令一覧の表記 | 正規化後 | トークン表側 |
|---|---|---|
| `FOR .. NEXT` | FOR, NEXT | 個別に存在 |
| `GOSUB ... RETURN` | GOSUB, RETURN | 個別に存在 |
| `IF .. THEN .. ELSE` | IF, THEN, ELSE | 個別に存在 |
| `IF .. THEN .. ELSE .. ENDIF` | IF, THEN, ELSE, ENDIF | 個別に存在 |
| `ON..GOSUB/GOTO` | ON, GOSUB, GOTO | 個別に存在 |
| `PRINT->LPRINT` | PRINT, LPRINT | 個別に存在 |
| `REPEAT..UNTIL` | REPEAT, UNTIL | 個別に存在 |
| `SWITCH..CASE..DEFAULT..ENDSWITCH` | SWITCH, CASE, DEFAULT, ENDSWITCH | 個別に存在 |
| `WHILE..WEND` | WHILE, WEND | 個別に存在 |

追加で `#` 付き表記ゆれ（1章・2章と重複掲載、参考として集約）:

| 命令一覧 | トークン表 |
|---|---|
| `INPUT#` | `INPUT` |
| `LNINPUT#` | `LNINPUT` |
| `PRINT#` | `PRINT` |
| `PIOPUT` | `POIPUT`（誤記疑い） |

## まとめ件数

- トークン表のみ（真の抽出漏れ・未収録）: 8件（HSN, HTN, MDF, CLOAD, CSAVE, HDCOPY, SPINP, SPOUT）
- トークン表のみ（ch13 対象外と確認できた構文要素・演算子）: 10件（AND, OR, NOT, XOR, MOD, STEP, TO, AS, APPEND, OUTPUT）
- 命令一覧のみ（トークン表に無い、要確認）: 6件（AUTO, BLOAD, BLOAD M, BLOAD ?, BSAVE, BSAVE M）
- 表記ゆれ（区切り記号の正規化で一致）: 9件
- 表記ゆれ（`#`有無・誤記、両リストで重複計上）: 4件（うち2件は上記1章・2章にも計上済み）

### 2026-08-14 追記: 抽出漏れ8件を補完

- 上記「トークン表のみ（真の抽出漏れ・未収録）」8件（HSN, HTN, MDF, CLOAD, CSAVE, HDCOPY, SPINP, SPOUT）を
  `basic_commands.yaml` に追加し解消した。HSN/HTN/MDFは底本に本文があり通常項目として収録。
  CLOAD/CSAVE/HDCOPY/SPINP/SPOUTは底本に記載が無いことを再確認のうえ、`status: needs_measurement`の
  スタブとして収録した（CLOAD/CSAVEはG850V/VSにカセット機能自体が無いため`phase: 3`）。
- 併せて演算子5件（AND, OR, NOT, XOR, MOD）も`kind: operator`として追加。AND/OR/XORは5.11節の
  記述からビット演算（16bit2の補数）と確定できたが、NOTは単項演算子でありビット演算か論理演算か
  底本から確定できなかったため`status: needs_measurement`とした。
