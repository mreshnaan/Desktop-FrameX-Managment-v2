import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const API_DIR = path.join(REPO_ROOT, 'apps/api');
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps/desktop');
const WEB_DIR = path.join(REPO_ROOT, 'apps/web');
const CDP_PORT = 9222;
const API_PORT = 4000;
const WEB_PORT = 5173;

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

// tauri.e2e.conf.json's isolated bundle id keeps this from ever touching a
// real dev/install's AppData. Wiped before every run for a clean local DB.
function wipeE2eAppData() {
  const roaming = process.env.APPDATA;
  const local = process.env.LOCALAPPDATA;
  for (const base of [roaming, local]) {
    if (!base) continue;
    const dir = path.join(base, 'com.cueroom.desktop.e2e');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

export default async function globalSetup() {
  // 1. Build and start the real apps/api server against local Postgres.
  // Always rebuild here -- a stale dist/ (e.g. from before a server-side
  // fix) would otherwise silently run outdated server code during the e2e
  // suite, which previously required a manual rebuild step to avoid.
  execFileSync('pnpm', ['--filter', '@cue-room/api', 'build'], { cwd: REPO_ROOT, stdio: 'inherit', shell: true });
  const apiEntry = path.join(API_DIR, 'dist/server.js');
  if (!existsSync(apiEntry)) {
    throw new Error(`${apiEntry} not found after "pnpm --filter @cue-room/api build"`);
  }
  const apiProcess: ChildProcess = spawn(process.execPath, [apiEntry], {
    cwd: API_DIR,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(API_PORT) },
    stdio: 'inherit',
  });

  await waitFor(`http://localhost:${API_PORT}/health`, 15_000, 'apps/api');

  // 2. Seed the known e2e test user (see apps/api/scripts/e2e-seed.mjs).
  execFileSync(
    process.execPath,
    [path.join(API_DIR, 'scripts/e2e-seed.mjs')],
    { cwd: API_DIR, env: process.env, stdio: 'inherit' },
  );

  // 3. Build the frontend, then the debug Tauri binary (--no-bundle: e2e only needs the raw .exe).
  execFileSync('pnpm', ['build'], { cwd: DESKTOP_DIR, stdio: 'inherit', shell: true });
  execFileSync(
    'pnpm',
    ['exec', 'tauri', 'build', '--debug', '--no-bundle', '--config', 'src-tauri/tauri.e2e.conf.json'],
    { cwd: DESKTOP_DIR, stdio: 'inherit', shell: true },
  );

  // 4. Launch the binary with WebView2's CDP port enabled so Playwright can drive it.
  wipeE2eAppData();
  const exePath = path.join(DESKTOP_DIR, 'src-tauri/target/debug/cue-room-desktop.exe');
  if (!existsSync(exePath)) {
    throw new Error(`${exePath} not found after tauri build`);
  }
  const appProcess: ChildProcess = spawn(exePath, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
    stdio: 'inherit',
  });

  await waitFor(`http://localhost:${CDP_PORT}/json/version`, 20_000, 'the desktop app (CDP)');

  // 5. Also start apps/web's dev server -- only cross-app-sync needs it,
  // but it's cheap to keep running for the whole suite.
  const webProcess: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: WEB_DIR,
    env: { ...process.env, PORT: String(WEB_PORT) },
    stdio: 'inherit',
    shell: true,
  });
  await waitFor(`http://localhost:${WEB_PORT}`, 20_000, 'apps/web dev server');

  return async function globalTeardown() {
    killTree(appProcess.pid);
    killTree(webProcess.pid);
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
    wipeE2eAppData();
  };
}
