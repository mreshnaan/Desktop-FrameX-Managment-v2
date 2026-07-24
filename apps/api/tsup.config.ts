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
  // Native/binary and runtime-sensitive deps must stay real node_modules
  // requires rather than get inlined into the bundle:
  // - bcrypt: native addon (.node binary)
  // - @prisma/client: resolves its generated query-engine binary relative
  //   to node_modules at runtime
  // express/jsonwebtoken/cors are also externalized as standard practice
  // for a Node backend bundle. tsup auto-externalizes all `dependencies`
  // from package.json by default, but we list these explicitly so the
  // intent survives even if that default ever changes.
  external: ['@prisma/client', 'bcrypt', 'express', 'jsonwebtoken', 'cors'],
});
