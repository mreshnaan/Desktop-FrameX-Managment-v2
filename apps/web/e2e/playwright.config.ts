import { defineConfig } from '@playwright/test';

// Plain browser e2e (unlike apps/desktop's CDP-attached-to-a-compiled-binary
// approach) -- Playwright's built-in webServer handles starting/stopping the
// Vite dev server; globalSetup handles the real api + Postgres + seeded user.
export default defineConfig({
  testDir: './specs',
  // Specs share one Postgres + one seeded user, so they must not interleave.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
