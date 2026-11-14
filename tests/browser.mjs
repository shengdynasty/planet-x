// Shared launcher for the headless-Chrome suites, so they run on any teammate's machine.
//
//   playwright-core:  $PW_CORE (path to playwright-core/index.mjs)
//                     → <repo>/node_modules/playwright-core   (npm i --no-save playwright-core@1.49.1)
//                     → <scratch>/pw/node_modules/playwright-core
//   Chrome:           $CHROME, else the platform's usual Google Chrome / Chromium location
//   static server:    python's http.server via $PLANETX_PYTHON (a command, e.g. "py -3"), else `py -3` then `python`
//                     on Windows, else `python3`
//   scratch dir:      $PLANETX_SCRATCH, else the Claude Code session scratchpad if present, else <os temp dir>/planet-x
//                     (screenshots and other test output go here, never inside the repo)
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The session scratchpad is one Mac's path and is only used where it exists; everywhere else the output goes under
// the platform's temp dir (os.tmpdir() reads $TMPDIR, %TEMP% or /tmp as appropriate).
const SESSION_SCRATCH = '/private/tmp/claude-501/-Users-shengyan-planet-x/fe009937-83d1-4373-acb2-17af4df64bc0/scratchpad';
export const SCRATCH = process.env.PLANETX_SCRATCH || (existsSync(SESSION_SCRATCH) ? SESSION_SCRATCH : path.join(os.tmpdir(), 'planet-x'));

const PW_CANDIDATES = [
  process.env.PW_CORE,
  process.env.PW && path.join(process.env.PW, 'node_modules/playwright-core/index.mjs'),
  path.join(ROOT, 'node_modules/playwright-core/index.mjs'),
  path.join(SCRATCH, 'pw/node_modules/playwright-core/index.mjs'),
].filter(Boolean);

/** The playwright-core module (its `chromium` export is what the suites use). */
export async function playwright() {
  const found = PW_CANDIDATES.find(p => existsSync(p));
  if (!found) {
    throw new Error('playwright-core not found. Looked at:\n  ' + PW_CANDIDATES.join('\n  ')
      + '\nInstall it without touching package.json:  npm i --no-save playwright-core@1.49.1   (or set PW_CORE=/path/to/playwright-core/index.mjs)');
  }
  return import(pathToFileURL(found).href);
}

function onPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const n of names) for (const d of dirs) { const p = path.join(d, n); if (existsSync(p)) return p; }
  return null;
}

/** Google Chrome (or Chromium) executable for this machine. */
export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const home = os.homedir();
  const candidates = process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : process.platform === 'win32' ? [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData\\Local'), 'Google\\Chrome\\Application\\chrome.exe'),
  ] : [];
  const found = candidates.find(p => existsSync(p)) || (process.platform !== 'win32' && onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']));
  if (!found) throw new Error('Google Chrome not found (looked at ' + (candidates.join(', ') || 'PATH') + '). Set CHROME=/path/to/chrome.');
  return found;
}

// Python commands for the static server, tried in order. On Windows `python3` is usually the Microsoft Store stub
// (exits at once with a hint), so the `py` launcher and `python` come first there. $PLANETX_PYTHON ("py -3",
// "C:\Python312\python.exe", …) is tried on its own when set.
const PYTHONS = process.env.PLANETX_PYTHON ? [process.env.PLANETX_PYTHON.trim().split(/\s+/)]
  : process.platform === 'win32' ? [['py', '-3'], ['python']] : [['python3']];

/**
 * Serve `root` on 127.0.0.1:port with python's http.server. A server already listening there is reused only if it
 * serves this very tree (a stale server left by another worktree once made a suite test old code for an afternoon);
 * otherwise the suite stops with the command to kill it. Each PYTHONS candidate gets 10 s to answer; one that exits
 * first (not installed, the Store stub) or never answers is dropped for the next. Returns the child process to kill,
 * or null when reused.
 */
export async function serve(port, root = ROOT) {
  const probe = 'app/js/main.js', url = `http://127.0.0.1:${port}/${probe}`;
  const served = async () => { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch { return null; } };
  const mine = readFileSync(path.join(root, probe), 'utf8');
  const got = await served();
  if (got !== null) {
    if (got === mine) return null;
    const stop = process.platform === 'win32' ? `netstat -ano | findstr :${port}   then   taskkill /PID <pid> /F` : `lsof -ti tcp:${port} | xargs kill`;
    throw new Error(`port ${port} is already served by another process with different files (a stale server from another worktree?).\n  Stop it:  ${stop}`);
  }
  const tried = [];
  for (const [cmd, ...args] of PYTHONS) {
    const child = spawn(cmd, [...args, '-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
    let gone = null; // set once the child cannot start or exits before serving: move on to the next candidate
    child.on('error', e => { gone ||= e.code === 'ENOENT' ? 'not found' : e.message; });
    child.on('exit', code => { gone ||= `exited with code ${code}`; });
    for (let i = 0; i < 100 && !gone; i++) { if ((await served()) === mine) return child; await new Promise(r => setTimeout(r, 100)); }
    if (!gone) { try { child.kill(); } catch {} gone = 'no answer in 10 s'; }
    tried.push(`${[cmd, ...args].join(' ')}: ${gone}`);
  }
  throw new Error(`could not start a static server on port ${port} with python's http.server.\n  ${tried.join('\n  ')}\n  Set PLANETX_PYTHON to a Python 3 command (Windows: "py -3", or the full path to python.exe).`);
}

/**
 * WebGL backend for headless Chrome: $CHROME_GL = 'metal' (the Mac's GPU: the default on macOS, fly-tos settle in 2 s),
 * 'gl' (a GPU elsewhere) or 'swiftshader' (software: the default off macOS, works without a GPU, ~10 fps on the
 * 1440×900 sky and prone to long stalls once the CPU is hot).
 */
export const GL = process.env.CHROME_GL || (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const GL_ARGS = { swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], metal: ['--use-angle=metal'], gl: ['--use-gl=angle', '--use-angle=gl'] };

/** Launch headless Chrome with a WebGL context (the sky view needs one). */
export async function launch(opts = {}) {
  const { chromium } = await playwright();
  return chromium.launch({ executablePath: chromePath(), args: GL_ARGS[GL] || GL_ARGS.swiftshader, ...opts });
}
