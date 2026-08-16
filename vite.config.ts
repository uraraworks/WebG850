/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Phase 1: ランタイム依存パッケージはゼロ。Vite/TS/Vitest のみで完結させる方針
// （docs/design/phase1_architecture.md「ビルド」節）。
export default defineConfig({
  // GitHub Pages のプロジェクトサイト配信(https://uraraworks.github.io/WebG850/)に
  // 対応するため相対パスを指定する。ルート配信・サブパス配信のどちらでも同じ
  // 設定で動き、`npm run dev` とも齟齬が出ないため相対パスを選んだ。
  base: './',
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
