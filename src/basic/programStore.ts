// ダイレクトモード（LCD上のラインエディタ）が保持する「プログラム本体」。
//
// `Interpreter` はコンストラクタで受け取った `program`（パース済み AST）を
// 読み取り専用として扱う設計（`docs/design/phase1_architecture.md`）で、
// 行の追加・置換・削除に応じて動的に書き換える機能を持たない。そのため、
// 生テキストの行を行番号ごとに保持するのはこの `ProgramStore` の役目にし、
// `RUN`/`LIST` の直前に `toSource()` でテキストへ組み立て直して
// `parseProgram()` に渡し、新しい `Interpreter` を作り直す
// （`ui/app.ts` の `App.run()` が RUN のたびに作り直しているのと同じ考え方）。

export class ProgramStore {
  /** 行番号 → 行番号を除いた本文（生テキスト）。 */
  private readonly lines = new Map<number, string>();

  /** 行を格納する。本文が空白のみの場合は削除として扱う（実機の慣行に合わせる）。 */
  setLine(lineNumber: number, text: string): void {
    if (text.trim() === '') {
      this.lines.delete(lineNumber);
      return;
    }
    this.lines.set(lineNumber, text);
  }

  /** 指定行番号を削除する（行番号だけを入力した場合に使う）。 */
  deleteLine(lineNumber: number): void {
    this.lines.delete(lineNumber);
  }

  /** `NEW` 相当。全行を消去する。 */
  clear(): void {
    this.lines.clear();
  }

  /** 現在格納されている行数。 */
  get size(): number {
    return this.lines.size;
  }

  /** 行番号順に並べた `"<行番号> <本文>"` をテキストへ組み立てる。`parseProgram()` にそのまま渡せる。 */
  toSource(): string {
    const numbers = Array.from(this.lines.keys()).sort((a, b) => a - b);
    return numbers.map((n) => `${n} ${this.lines.get(n)}`).join('\n');
  }
}
