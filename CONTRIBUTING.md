# Contributing

> WebG850 is a **clean-room implementation that does not reference any ROM image**.
>
> **We welcome:** behavior reports (what worked / didn't, which model you tested), bug reports, and pointers to publicly available documentation.
>
> **We cannot accept:** ROM disassembly results, explanations of internal ROM processing, or ROM images themselves. Receiving such material — even sent in good faith — would make it impossible to explain the provenance of this implementation, so please refrain from sending it.
>
> See the Japanese sections below for full details.

---

WebG850 は **ROM を参照しない独立実装**として作っています。そのため、情報の受け取り方に
他のプロジェクトとは違う制約があります。ご協力いただく前に必ずお読みください。

## 歓迎するもの

- **実機での測定結果**（何を入力したら、何が出力されたか、という組）
- 動作報告（この作品は動いた／動かなかった、この機種で確認した、など）
- 「この作品が動かない」という報告
- 仕様書（`docs/spec/*.yaml`、`docs/仕様_BASIC命令セット.md`）の誤りの指摘

## 受け取れないもの

- ROM の逆アセンブル結果
- ROM 内部の処理手順の解説
- ROM イメージそのもの
- 他のエミュレータのソースコードからの引用

## なぜ受け取れないのか

本プロジェクトは ROM を一切参照しない独立実装として設計しています。
上記のような情報を受け取ってしまうと、**実装の出自を説明できなくなります。**

善意でお送りいただいたとしても、こちらはそれを使うことができず、
むしろ**読んでしまうこと自体が問題**になります（クリーンルーム設計が成立しなくなるため）。
お手数をおかけしますが、上記に該当する情報の送付はご遠慮ください。

## 測定結果を送っていただく場合のお願い

以下を明記してください。機種が混ざると、別機種の挙動がこちらの仕様書に混入してしまいます。

- **機種**（G850 / G850S / G850V / G850VS のいずれか）
- 実機での測定か、他のエミュレータでの測定か
- 入力した内容
- 出力された結果

## 提供いただいたデータの扱い

測定結果は事実データとして本リポジトリ内で公開します。ご協力いただいた方のクレジットは記載します。
