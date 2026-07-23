import path from 'node:path'
import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Note: `test` is not part of Vite's own `UserConfig` type — it's added by
// Vitest's ambient module augmentation, which we don't import here because
// vitest's bundled vite types (vite@5) conflict with this workspace's vite@8
// at the type level. The `as UserConfig` cast keeps the rest of this file
// (plugins, resolve.alias) fully type-checked while allowing the `test` key
// vitest reads at runtime.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
  },
} as UserConfig)
