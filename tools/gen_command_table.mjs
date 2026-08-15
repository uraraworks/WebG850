// docs/spec/basic_commands.yaml と docs/spec/basic_tokens.yaml から
// src/basic/generated/command_table.ts を生成するスクリプト。
//
// 目的: token.ts の予約語表・parser.ts の phase 分類表は、以前は yaml からの
// 手写しだった（親 CLAUDE.md の「制限事項の一覧は手で書かない」原則に反する）。
// 実装済みの命令が誤って phase 2/3 に分類されると、動く命令なのに
// ?UNSUPPORTED が出て測定結果が下振れするため、yaml を単一の正典にする。
//
// 使い方: npm run gen
//
// 注意:
// - yaml パーサ（devDependencies の "yaml"）を使うのはこのスクリプトだけ。
//   生成物 (command_table.ts) は素の TypeScript でランタイム依存はゼロのまま。
// - 生成物はコミットに含める（ビルド時生成にしない）。差分が出たら
//   test/command_table.test.ts が落ちる。
// - yaml の name が basic_tokens.yaml の予約語表に無いもの（例: PRINT#, BLOAD
//   のように単独の予約語ではなく複合構文/未実装のもの）は STATEMENT_PHASES に
//   含めない。呼び出し側（token.ts/parser.ts）で yaml に無いが必要な例外を
//   別途明示的に足す。
//
// generateCommandTableSource() は test/command_table.test.ts からも
// 再利用する（「生成し直して差分が出たら落ちる」検証のため）。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const COMMANDS_YAML_PATH = join(REPO_ROOT, 'docs/spec/basic_commands.yaml');
export const TOKENS_YAML_PATH = join(REPO_ROOT, 'docs/spec/basic_tokens.yaml');
export const OUT_PATH = join(REPO_ROOT, 'src/basic/generated/command_table.ts');

function jsonLiteral(value) {
  return JSON.stringify(value);
}

/**
 * commandsYamlText / tokensYamlText（yaml の生テキスト）から
 * command_table.ts のソースコード文字列を生成して返す。ファイルには書かない。
 */
export function generateCommandTableSource(commandsYamlText, tokensYamlText) {
  const commandsDoc = parse(commandsYamlText);
  const tokensDoc = parse(tokensYamlText);

  const tokenNames = tokensDoc.tokens.map((t) => t.name);
  const tokenNameSet = new Set(tokenNames);

  // --- FUNCTIONS: kind === 'function' の全命令。noParen は format の1行目に
  //     '(' が無いかどうかから機械的に導出する（PI/FRE/MDF/INKEY$/PIOGET）。
  const functionCommands = commandsDoc.commands
    .filter((c) => c.kind === 'function')
    .map((c) => {
      const firstLine = String(c.format ?? '').split('\n')[0];
      const noParen = !firstLine.includes('(');
      return { name: c.name, phase: c.phase, noParen };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // --- STATEMENT_PHASES: kind が statement/command かつ phase が 2 か 3 の命令。
  //     ただし basic_tokens.yaml に同名の予約語が実在するものだけを対象にする
  //     （PRINT#/INPUT#/BLOAD 等、単体の予約語ではない/未実装のものは除外）。
  const statementPhases = commandsDoc.commands
    .filter(
      (c) =>
        (c.kind === 'statement' || c.kind === 'command') &&
        (c.phase === 2 || c.phase === 3) &&
        tokenNameSet.has(c.name)
    )
    .map((c) => ({ name: c.name, phase: c.phase }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const excluded = commandsDoc.commands.filter(
    (c) =>
      (c.kind === 'statement' || c.kind === 'command') &&
      (c.phase === 2 || c.phase === 3) &&
      !tokenNameSet.has(c.name)
  );
  const exclusionNote = excluded.map((c) => ` * - ${c.name}`).join('\n') + '\n';

  const lines = [];
  lines.push('// 自動生成ファイル。手で編集しないこと。');
  lines.push('// 生成元: docs/spec/basic_commands.yaml / docs/spec/basic_tokens.yaml');
  lines.push('// 生成コマンド: npm run gen (tools/gen_command_table.mjs)');
  lines.push('//');
  lines.push('// yaml に無いが実装上必要な例外（AUTO の予約語登録、POIPUT/PIOPUT の表記差など）は');
  lines.push('// ここには含めない。呼び出し側 (src/basic/token.ts, src/basic/parser.ts) で');
  lines.push('// 理由つきの例外リストとして別管理する。');
  lines.push('');
  lines.push('/** basic_tokens.yaml の予約語表（141件、yaml記載順）。 */');
  lines.push(`export const TOKEN_KEYWORDS: readonly string[] = ${jsonLiteral(tokenNames)};`);
  lines.push('');
  lines.push('export type CommandPhase = 1 | 2 | 3;');
  lines.push('');
  lines.push('export interface GeneratedFunctionSpec {');
  lines.push('  readonly name: string;');
  lines.push('  readonly phase: CommandPhase;');
  lines.push('  /** true なら括弧・引数を取らない（PI, FRE, MDF, INKEY$, PIOGET）。 */');
  lines.push('  readonly noParen: boolean;');
  lines.push('}');
  lines.push('');
  lines.push(
    '/** basic_commands.yaml の kind: function 全命令（54件）。phase・noParen も yaml から機械導出。 */'
  );
  lines.push('export const GENERATED_FUNCTIONS: readonly GeneratedFunctionSpec[] = [');
  for (const f of functionCommands) {
    lines.push(`  { name: ${jsonLiteral(f.name)}, phase: ${f.phase}, noParen: ${f.noParen} },`);
  }
  lines.push('];');
  lines.push('');
  lines.push('export interface GeneratedStatementPhaseSpec {');
  lines.push('  readonly name: string;');
  lines.push('  readonly phase: 2 | 3;');
  lines.push('}');
  lines.push('');
  lines.push(
    '/**\n * basic_commands.yaml の kind: statement/command のうち phase 2/3 の命令で、\n' +
      ' * かつ basic_tokens.yaml に同名の予約語が実在するもの。\n' +
      ' *\n' +
      ' * yaml 上は phase 2/3 だが除外される命令（単独の予約語ではない、または\n' +
      ' * 未実装で tokens.yaml に対応する項目が無いもの）:\n' +
      exclusionNote +
      ' */'
  );
  lines.push('export const GENERATED_STATEMENT_PHASES: readonly GeneratedStatementPhaseSpec[] = [');
  for (const s of statementPhases) {
    lines.push(`  { name: ${jsonLiteral(s.name)}, phase: ${s.phase} },`);
  }
  lines.push('];');
  lines.push('');

  return lines.join('\n');
}

// CLI として直接実行された場合だけファイルへ書き出す（test からの import 時は実行しない）。
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const commandsYamlText = readFileSync(COMMANDS_YAML_PATH, 'utf8');
  const tokensYamlText = readFileSync(TOKENS_YAML_PATH, 'utf8');
  const source = generateCommandTableSource(commandsYamlText, tokensYamlText);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, source, 'utf8');
  console.log(`generated: ${OUT_PATH}`);
}
