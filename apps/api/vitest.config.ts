import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
    },
    // Integration tests hit a real Postgres via vitest.integration.config.ts
    // (run separately with `pnpm test:integration`) -- they'd fail here
    // against the fake DATABASE_URL above, which this default suite's mocked
    // prisma never actually connects to.
    exclude: ['**/node_modules/**', '**/integration-tests/**'],
  },
});
