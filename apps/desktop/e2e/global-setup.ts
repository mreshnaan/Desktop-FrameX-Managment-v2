import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const API_DIR = path.join(REPO_ROOT, 'apps/api');
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps/desktop');
const CDP_PORT = 9222;
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

// Tauri's app_data_dir is derived from the bundle identifier
// (tauri.e2e.conf.json sets it to com.cueroom.desktop.e2e specifically so
// this never touches a real dev/install's AppData). Wiped before every run
// so each e2e run starts from an empty local database.
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
  // 1. Start the real apps/api server against the real local Postgres --
  // desktop's auth/sync genuinely need a live backend, unlike FrameX which
  // has none. Uses the already-built dist/server.js (run `pnpm build` in
  // apps/api first if this fails to find it).
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

  // 2. Seed the known e2e test user (see apps/api/scripts/e2e-seed.mjs).
  execFileSync(
    process.execPath,
    [path.join(API_DIR, 'scripts/e2e-seed.mjs')],
    { cwd: API_DIR, env: process.env, stdio: 'inherit' },
  );

  // 3. Build the frontend, then the debug Tauri binary with --no-bundle
  // (skip installer creation -- e2e only needs the raw .exe) and the e2e
  // config override (isolated app identifier).
  execFileSync('pnpm', ['build'], { cwd: DESKTOP_DIR, stdio: 'inherit', shell: true });
  execFileSync(
    'pnpm',
    ['exec', 'tauri', 'build', '--debug', '--no-bundle', '--config', 'src-tauri/tauri.e2e.conf.json'],
    { cwd: DESKTOP_DIR, stdio: 'inherit', shell: true },
  );

  // 4. Launch the compiled binary with WebView2's CDP remote-debugging
  // port enabled -- this is what lets Playwright drive it like a browser
  // page, the same technique FrameX's own e2e suite uses.
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

  return async function globalTeardown() {
    killTree(appProcess.pid);
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
