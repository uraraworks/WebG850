// src/basic/generated/command_table.ts が現在の
// docs/spec/basic_commands.yaml / docs/spec/basic_tokens.yaml と一致していることを
// 検証する。yaml を編集して npm run gen を忘れた場合に落ちるようにするのが目的
// （依頼元: 手写し表の生成物化。手書きは実装とズレるため一致をテストで縛る）。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMMANDS_YAML_PATH,
  OUT_PATH,
  TOKENS_YAML_PATH,
  generateCommandTableSource,
} from '../tools/gen_command_table.mjs';

describe('command_table (生成物と yaml の一致)', () => {
  it('src/basic/generated/command_table.ts は yaml から再生成した内容と一致する', () => {
    const commandsYamlText = readFileSync(COMMANDS_YAML_PATH, 'utf8');
    const tokensYamlText = readFileSync(TOKENS_YAML_PATH, 'utf8');
    const regenerated = generateCommandTableSource(commandsYamlText, tokensYamlText);
    const committed = readFileSync(OUT_PATH, 'utf8');
    expect(committed).toBe(regenerated);
  });
});
