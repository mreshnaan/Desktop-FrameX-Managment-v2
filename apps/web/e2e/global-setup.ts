import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const API_DIR = path.join(REPO_ROOT, 'apps/api');
const API_PORT = 4000;

dotenv.config({ path: path.join(API_DIR, '.env'), quiet: true });

async function waitFor(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet -- keep polling.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  } catch {
    // Already dead -- fine.
  }
}

// Mirrors apps/desktop/e2e/global-setup.ts's approach (same real api + real
// Postgres + real seeded user), minus the Tauri/CDP layer -- this is a plain
// browser app, so Playwright's own webServer-style orchestration is done by
// hand here rather than via the config's `webServer` option, to keep both
// suites structured the same way.
export default async function globalSetup() {
  const apiEntry = path.join(API_DIR, 'dist/server.js');
  if (!existsSync(apiEntry)) {
    throw new Error(`${apiEntry} not found -- run "pnpm --filter @cue-room/api build" first`);
  }
  const apiProcess: ChildProcess = spawn(process.execPath, [apiEntry], {
    cwd: API_DIR,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(API_PORT) },
    stdio: 'inherit',
  });

  await waitFor(`http://localhost:${API_PORT}/health`, 15_000, 'apps/api');

  // Seed the known e2e test user (shared with apps/desktop's suite --
  // see apps/api/scripts/e2e-seed.mjs; the two suites are never run
  // concurrently against the same api instance).
  execFileSync(
    process.execPath,
    [path.join(API_DIR, 'scripts/e2e-seed.mjs')],
    { cwd: API_DIR, env: process.env, stdio: 'inherit' },
  );

  return async function globalTeardown() {
    killTree(apiProcess.pid);
    try {
      execFileSync(
        process.execPath,
        [path.join(API_DIR, 'scripts/e2e-cleanup.mjs')],
        { cwd: API_DIR, env: process.env, stdio: 'inherit' },
      );
    } catch {
      // Best-effort -- don't fail the whole run over cleanup.
    }
  };
}
