import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Native/binary deps (bcrypt, @prisma/client) must stay real node_modules
  // requires, not inlined -- listed explicitly rather than relying on tsup's default.
  external: ['@prisma/client', 'bcrypt', 'express', 'jsonwebtoken', 'cors'],
});
