import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

// apps/e2e has no .env of its own — load apps/api/.env so seed fixtures
// (which use apps/api's Prisma client) can find DATABASE_URL etc. when
// Playwright's test process runs.
dotenv.config({ path: path.resolve(__dirname, '../api/.env') });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // tests share one Postgres + API instance
  retries: 0,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm --filter @cue-room/web dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
