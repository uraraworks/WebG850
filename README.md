# WebG850

> A browser-based emulator/simulator for the Sharp **PC-G850V / PC-G850VS** pocket computer.
>
> This is a clean-room implementation: it does not include, distribute, or reference any ROM image. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
>
> Phase 1 (a compatible BASIC interpreter) is up and running in the browser: it can tokenize, parse, and execute BASIC programs, drawing text and graphics on a 144×48 screen with keyboard input and BEEP support. Editor commands (`AUTO` / `DELETE` / `RENUM` / `PASS`), `LCOPY` (printer output), and `PRINT USING` formatting are not implemented yet, and Phase 2 (Z80 / machine code) and Phase 3 haven't started. Unsupported statements fail loudly with an `?UNSUPPORTED` message instead of being silently ignored.
>
> Documentation is in Japanese.

---

ブラウザで動く、シャープ **PC-G850V / PC-G850VS** のエミュレータ／シミュレータです。

## ROM を使わない独立実装

本プロジェクトは **ROM イメージを一切使いません。** 同梱・配布も行いません。

実装しているのは「ROM と同じインタフェースで、同じ結果を返す**別実装**」です。
命令の名前・書式・引数・返り値といったインタフェース仕様は公開資料を参照して構築していますが、
ROM の中身（逆アセンブルリストや内部処理そのもの）は一切参照していません。
未文書の挙動はブラックボックス実測（入力を与えて出力を記録）で仕様を起こしています。

詳しくは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 現在の状態

**Phase 1（互換 BASIC インタプリタ）が動いています。** ブラウザ上で BASIC プログラムを
字句解析・構文解析・評価し、144×48 ドットの画面に文字とグラフィックを描画できます。
キーボード入力と BEEP（WebAudio）も動作します。組込み関数は 49 個実装済みです。

**未実装**（現時点では動きません）:

- エディタ系コマンド: `AUTO` / `DELETE` / `RENUM` / `PASS`
- `LCOPY`（プリンタ出力）
- `PRINT USING` の書式指定
- Phase 2（Z80 コア／機械語）・Phase 3（エディタ・URL共有・C/CASL）は未着手

未対応の命令に実行が到達すると、黙って無視せず画面に `?UNSUPPORTED <命令名> IN <行番号>`
と表示して停止します（このプロジェクトの方針：不明な挙動を無言にしない）。

仕様は `docs/spec/*.yaml` に機械可読な形で置いています。

| ファイル | 件数 | 内容 |
|---|---|---|
| `docs/spec/basic_commands.yaml` | 136 | 命令・関数・コマンド・演算子 |
| `docs/spec/basic_errors.yaml` | 50 | エラーコード（10〜97） |
| `docs/spec/basic_tokens.yaml` | 141 | BASIC 中間コード表（1バイト） |

読み方や信用してよい範囲の説明は [`docs/仕様_BASIC命令セット.md`](docs/仕様_BASIC命令セット.md) に、
YAML の書式定義は [`docs/spec/SCHEMA.md`](docs/spec/SCHEMA.md) にあります。

## 開発・ビルド

```sh
npm install       # 依存関係のインストール
npm run dev       # 開発サーバ（Vite）
npm run build     # dist/ に静的ファイルを生成（GitHub Pages にそのまま置ける）
npm test          # vitest によるテスト実行（現在 17 ファイル・312 件、全て pass）
```

ランタイム依存パッケージはゼロです（Vite + TypeScript + Vitest のみ）。

## 精度の方針：完全再現は目指さない

成功指標は「実機と一致するか」ではなく「**実在の作品が動くか**」です。
実在作品276本を機械解析した結果、現行投稿シーンの54%が Phase 1（互換 BASIC）だけで動く見込みです。

エミュレータはそもそも完全再現ではありません。浮動小数点の丸め・乱数系列・タイミングなどは
実測で近づけることはできても証明はできません。

不明な部分は無言で無視せず、**制限事項として開示**します。明確になった時点で改善します。

## ライセンス

MIT License. [LICENSE](LICENSE) を参照してください。

## 免責

本プロジェクトはシャープ株式会社とは関係ありません。
PC-G850 / PC-G850V / PC-G850VS はシャープ株式会社の製品名です。
