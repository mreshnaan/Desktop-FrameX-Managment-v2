/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { branding } from './src/config/branding.ts'

const host = process.env.TAURI_DEV_HOST

// Keeps index.html's <title> driven by the same branding.ts the rest of the
// app reads, instead of a second hardcoded copy of the app name in HTML.
function injectAppTitle(): Plugin {
  return {
    name: 'inject-app-title',
    transformIndexHtml(html) {
      return html.replace(/<title>.*<\/title>/, `<title>${branding.appName}</title>`)
    },
  }
}

// https://vite.dev/config/
// Tauri-specific settings (fixed port, strictPort, ignoring src-tauri in the
// watcher) follow Tauri 2's documented Vite setup so `tauri dev` can rely on
// a stable dev server URL.
export default defineConfig({
  plugins: [react(), tailwindcss(), injectAppTitle()],
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
