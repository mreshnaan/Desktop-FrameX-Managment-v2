import { defineConfig } from '@playwright/test';

// No `use.baseURL` / `webServer` here -- there's no dev server to point at.
// global-setup.ts builds and launches the real compiled Tauri binary with
// WebView2's CDP remote-debugging port enabled, and every spec connects to
// it via chromium.connectOverCDP() (see helpers.ts). Specs run serially:
// they share one live apps/api + Postgres instance and one running desktop
// app instance, so parallel workers would race on both.
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalSetup: './global-setup.ts',
});
