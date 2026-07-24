import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Loaded before defineConfig runs, so DATABASE_URL etc. resolve to the real
// local Postgres from .env instead of vitest.config.ts's fake test values --
// these tests exercise the real Express app + Prisma client against it.
dotenv.config({ path: path.join(__dirname, '.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/integration-tests/**/*.test.ts'],
    // One real Postgres, one seeded fixture set -- tests must not interleave.
    fileParallelism: false,
  },
});
