/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
// Tauri-specific settings (fixed port, strictPort, ignoring src-tauri in the
// watcher) follow Tauri 2's documented Vite setup so `tauri dev` can rely on
// a stable dev server URL.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'jsdom',
    // e2e/ holds Playwright specs (a separate test runner, own config) --
    // without this exclusion vitest also tries to collect them and fails
    // with "Playwright Test did not expect test() to be called here."
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
} as UserConfig)
