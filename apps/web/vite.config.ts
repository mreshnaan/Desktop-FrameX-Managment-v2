/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { branding } from './src/config/branding.ts'

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
// NOTE: The `/// <reference types="vitest/config" />` directive above enables
// the `test` key to type-check under `tsc --noEmit`, but NOT under `tsc -b`
// (composite mode used by the build script). Importing defineConfig from
// 'vitest/config' fails due to vite version conflict (vitest bundles vite@5,
// workspace uses vite@8). The `as UserConfig` cast is a deliberate trade-off
// to make the build pass; revisit if vitest/vite versions are ever aligned.
export default defineConfig({
  plugins: [react(), tailwindcss(), injectAppTitle()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
