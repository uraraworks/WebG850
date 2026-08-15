#!/usr/bin/env node
// src/machine/font.ts の全 95 文字を ASCII アートでダンプし、目視確認するためのツール。
//
// 重要: font.ts の内部データ（GLYPH_ROWS）をそのまま再掲するのではなく、
// 公開 API である getGlyph() の戻り値（列方向 5 バイト）を行方向へ復元して
// 表示する。これにより「設計データ ⇔ 列方向エンコード」の変換が正しく
// 往復していることも同時に確認できる。
//
// 実行: node tools/dump_font.mjs
// （Node の TypeScript type-stripping で src/machine/font.ts を直接 import する）

import { getGlyph, FONT_GLYPH_WIDTH, FONT_GLYPH_HEIGHT } from '../src/machine/font.ts';

const FIRST_CODE = 0x20;
const LAST_CODE = 0x7e;

function glyphToRows(code) {
  const cols = getGlyph(code);
  const rows = [];
  for (let y = 0; y < FONT_GLYPH_HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < FONT_GLYPH_WIDTH; x++) {
      row += (cols[x] >> y) & 1 ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

let missing = 0;
let malformed = 0;

for (let code = FIRST_CODE; code <= LAST_CODE; code++) {
  const ch = String.fromCharCode(code);
  const cols = getGlyph(code);
  if (cols.length !== FONT_GLYPH_WIDTH) {
    malformed++;
    console.log(`!! code=0x${code.toString(16)} (${ch}) バイト数が ${cols.length}（期待 ${FONT_GLYPH_WIDTH}）`);
    continue;
  }
  const rows = glyphToRows(code);
  console.log(`--- 0x${code.toString(16).padStart(2, '0')} '${ch}' ---`);
  for (const row of rows) {
    console.log(row.replace(/#/g, '#').replace(/\./g, '.'));
  }
}

console.log('');
console.log(`収録数: ${LAST_CODE - FIRST_CODE + 1} 文字（0x${FIRST_CODE.toString(16)}〜0x${LAST_CODE.toString(16)}）`);
console.log(`不整合: malformed=${malformed} missing=${missing}`);

// 未定義コードが全点灯の箱になることも合わせて確認する。
const undef = glyphToRows(0x00);
console.log('');
console.log('--- 未定義コード 0x00（全点灯の箱を期待） ---');
for (const row of undef) console.log(row);
