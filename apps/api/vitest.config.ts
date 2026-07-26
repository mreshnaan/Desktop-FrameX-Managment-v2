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
    // Integration tests need a real Postgres -- run separately via
    // vitest.integration.config.ts (`pnpm test:integration`).
    exclude: ['**/node_modules/**', '**/integration-tests/**'],
  },
});
