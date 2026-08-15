/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Phase 1: ランタイム依存パッケージはゼロ。Vite/TS/Vitest のみで完結させる方針
// （docs/design/phase1_architecture.md「ビルド」節）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
