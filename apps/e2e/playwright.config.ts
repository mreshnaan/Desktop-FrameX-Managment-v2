import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

// apps/e2e has no .env of its own — load apps/api/.env so seed fixtures
// (which use apps/api's Prisma client) can find DATABASE_URL etc. when
// Playwright's test process runs.
// quiet: true suppresses dotenv's console output, including its rotating
// promotional "tips" (as of dotenv 17.x) — not needed for test/CI logs.
dotenv.config({ path: path.resolve(__dirname, '../api/.env'), quiet: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // tests share one Postgres + API instance
  workers: 1, // multiple spec files still run in separate workers by default,
              // which races on the shared Postgres cleanup/seed fixtures
  retries: 0,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'pnpm --filter @cue-room/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --filter @cue-room/api dev',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? '',
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? '',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? '',
        PORT: process.env.PORT ?? '4000',
      },
    },
  ],
});
