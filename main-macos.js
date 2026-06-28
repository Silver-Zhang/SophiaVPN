'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP_ROOT = __dirname;
const DATA_DIR = process.env.SOPHIAVPN_DATA_DIR || path.join(os.homedir(), '.config', 'SophiaVPN');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const SOPHIA = path.join(APP_ROOT, 'bin', 'sophia');
let mainWindow = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function coreEnv() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const core = path.join(APP_ROOT, 'resources', 'clash-binaries', `mihomo-darwin-${arch}`);
  return {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`,
    SOPHIAVPN_DATA_DIR: DATA_DIR,
    SILVERVPN_DATA_DIR: DATA_DIR,
    ...(fs.existsSync(core) ? { CLASH_CORE: core } : {})
  };
}

function run(command, args = [], options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd || APP_ROOT,
      env: { ...coreEnv(), ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      resolve({ ok: false, code: -1, stdout, stderr: stderr || error.message });
    });
    child.on('exit', code => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function sophia(args = []) {
  if (!fs.existsSync(SOPHIA)) {
    return { ok: false, code: -1, stdout: '', stderr: `SophiaVPN wrapper not found: ${SOPHIA}` };
  }
  return run('bash', [SOPHIA, ...args]);
}

function resultText(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function parseStatusJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function buildDashboard() {
  const statusResult = await sophia(['status', '--json']);
  const status = parseStatusJson(statusResult.stdout) || null;
  const textResult = await sophia(['status']);
  const profileResult = await sophia(['profile', 'list']);
  const nodeResult = status && status.running ? await sophia(['nodes']) : { ok: true, stdout: 'Core is not running.', stderr: '' };
  const conflictResult = await sophia(['conflicts']);
  return {
    ok: statusResult.ok,
    status,
    statusText: resultText(textResult) || resultText(statusResult),
    profilesText: resultText(profileResult),
    nodesText: resultText(nodeResult),
    conflictsText: resultText(conflictResult),
    dataDir: DATA_DIR,
    logDir: LOG_DIR
  };
}

async function handleAction(action, payload = {}) {
  switch (action) {
    case 'dashboard':
      return buildDashboard();
    case 'install-sophia':
    case 'install-svpn': {
      const result = await run('bash', [path.join(APP_ROOT, 'scripts', 'install-sophia.sh')]);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'conflicts': {
      const result = await sophia(['conflicts']);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'import': {
      const source = String(payload.source || '').trim();
      const name = String(payload.name || 'My Profile').trim() || 'My Profile';
      if (!source) throw new Error('Subscription URL or file is required.');
      const result = await sophia(['import', source, name]);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'on': {
      const result = await sophia(['on']);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'off': {
      const result = await sophia(['off']);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'test': {
      const result = await sophia(['test']);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'nodes-delay': {
      const result = await sophia(['nodes', '--delay']);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'use-node': {
      const node = String(payload.node || '').trim();
      if (!node) throw new Error('Node number or name is required.');
      const result = await sophia(['use', node]);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'mode': {
      const mode = String(payload.mode || 'smart').trim();
      const result = await sophia(['mode', mode]);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'profile-use': {
      const profile = String(payload.profile || '').trim();
      if (!profile) throw new Error('Profile number or name is required.');
      const result = await sophia(['profile', 'use', profile]);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'profile-rename': {
      const profile = String(payload.profile || '').trim();
      const name = String(payload.name || '').trim();
      if (!profile || !name) throw new Error('Profile selector and new name are required.');
      const result = await sophia(['profile', 'rename', profile, name]);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'profile-delete': {
      const profile = String(payload.profile || '').trim();
      if (!profile) throw new Error('Profile selector is required.');
      const args = ['profile', 'delete', profile];
      if (payload.yes) args.push('--yes');
      const result = await sophia(args);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'system-proxy-status': {
      const result = await sophia(['system-proxy', 'status']);
      return { ...result, text: resultText(result), dashboard: await buildDashboard() };
    }
    case 'open-data-dir':
      ensureDir(DATA_DIR);
      await shell.openPath(DATA_DIR);
      return { ok: true };
    case 'open-log-dir':
      ensureDir(LOG_DIR);
      await shell.openPath(LOG_DIR);
      return { ok: true };
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'SophiaVPN',
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload-macos.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(APP_ROOT, 'renderer', 'macos.html'));
}

app.whenReady().then(() => {
  ensureDir(DATA_DIR);
  ensureDir(LOG_DIR);
  ipcMain.handle('SOPHIAVPN_MACOS', async (_event, action, payload) => handleAction(action, payload));
  ipcMain.handle('SILVERVPN_MACOS', async (_event, action, payload) => handleAction(action, payload));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
