'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

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

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function readSettings() {
  return readJson(path.join(DATA_DIR, 'settings.json'), {});
}

function readProfilesData() {
  const settings = readSettings();
  const data = readJson(path.join(DATA_DIR, 'clashy-configs', 'subscriptions.json'), { subscriptions: [] });
  const list = Array.isArray(data.subscriptions) ? data.subscriptions : [];
  return {
    currentProfileId: settings.currentProfileId || '',
    rows: list.map((profile, index) => ({
      index: index + 1,
      id: profile.id || '',
      name: profile.name || profile.id || `Profile ${index + 1}`,
      kind: profile.kind || '',
      sourceType: profile.sourceType || '',
      proxyCount: Number.isInteger(profile.proxyCount) ? profile.proxyCount : null,
      url: profile.url || profile.subscriptionUrl || '',
      urlDisplay: profile.urlDisplay || profile.subscriptionUrlDisplay || '',
      importedAt: profile.importedAt || '',
      selected: Boolean(profile.id && profile.id === settings.currentProfileId)
    }))
  };
}

function parseNodeRows(raw, status) {
  const currentName = status && status.node ? String(status.node) : '';
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\*)?\s*(\d+)\.\s+(.+?)(?:\s{2,}((?:\d+\s*ms)|失败|fail(?:ed)?))?\s*$/i);
    if (!match) continue;
    const selected = Boolean(match[1]) || (currentName && match[3] === currentName);
    const delayText = match[4] ? match[4].replace(/\s+/g, ' ').trim() : '';
    const delayMatch = delayText.match(/^(\d+)\s*ms$/i);
    rows.push({
      index: Number(match[2]),
      name: match[3].trim(),
      selected,
      delay: delayMatch ? Number(delayMatch[1]) : null,
      delayText: delayText || '',
      delayOk: delayMatch ? true : delayText ? false : null
    });
  }
  return {
    rows,
    current: rows.find(row => row.selected) || null,
    count: rows.length
  };
}

function parseConflictSummary(raw) {
  const text = String(raw || '').trim();
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+(.+?)\s+\[([^\]]+)\],\s*pid=(\d+)/);
    if (match) rows.push({ name: match[1], type: match[2], pid: Number(match[3]) });
  }
  const blocking = rows.length > 0;
  const grouped = [];
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.name} [${row.type}]`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [label, count] of counts) grouped.push({ label, count });
  return {
    blocking,
    count: rows.length,
    rows,
    grouped,
    tone: blocking ? 'warn' : 'ok',
    title: blocking ? `发现 ${rows.length} 个相关进程` : '未发现会抢占代理的软件',
    message: blocking
      ? '这些进程可能是 VPN、代理或网络接入客户端。SophiaVPN 启动时如果发现系统/终端代理被它们占用，会直接失败并提示你先关闭对应软件。'
      : '当前没有发现明显的 VPN、代理或网络接入客户端占用。'
  };
}

function stripElectronError(value) {
  return String(value || '')
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}

function conciseText(value, fallback = '') {
  const text = stripElectronError(value || fallback);
  if (!text) return '';
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .filter(line => !/^\s*\/Applications\/|^\s*\/Users\/|--type=|--field-trial-handle=/.test(line));
  return lines.slice(0, 12).join('\n');
}

function summarizeConflicts(raw) {
  const summary = parseConflictSummary(raw);
  const text = String(raw || '').trim();
  if (!text) return '未检测到冲突进程。\nNo conflicting process detected.';
  if (!summary.rows.length) {
    return conciseText(text) || '未检测到冲突进程。\nNo conflicting process detected.';
  }
  const lines = [`检测到 ${summary.count} 个相关进程。SophiaVPN 启动时不会抢占其他软件的代理。`, `${summary.count} related process(es) detected. SophiaVPN will not take over another app's proxy.`];
  for (const item of summary.grouped) {
    lines.push(`- ${item.label}${item.count > 1 ? ` x${item.count}` : ''}`);
  }
  return lines.join('\n');
}

function runSync(command, args = []) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseScutilProxy(raw) {
  const values = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9]+)\s+:\s+(.+?)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function pidsForListeningPort(port) {
  if (!port) return [];
  const result = runSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (!result.ok && !result.stdout.trim()) return [];
  return [...new Set(result.stdout.split(/\s+/).map(Number).filter(Number.isInteger))];
}

function commandForPid(pid) {
  const result = runSync('ps', ['-p', String(pid), '-o', 'command=']);
  return result.ok ? result.stdout.trim() : '';
}

function basenameFromCommand(command) {
  const first = String(command || '').split(/\s+/)[0] || '';
  return first ? path.basename(first) : '未知进程';
}

function processLabel(command) {
  const value = String(command || '');
  const lower = value.toLowerCase();
  if (value.includes(APP_ROOT) || value.includes(DATA_DIR) || lower.includes('sophiavpn')) return 'SophiaVPN';
  if (value.includes('熊猫') || lower.includes('panda') || value.includes('/rocket/') || lower.includes('clashr-darwin')) return '熊猫云 / Panda';
  if (lower.includes('expressvpn')) return 'ExpressVPN';
  if (lower.includes('easyconnect')) return 'EasyConnect';
  if (lower.includes('pulse secure') || lower.includes('ivanti')) return 'Pulse Secure / Ivanti';
  if (lower.includes('inode')) return 'iNode';
  return basenameFromCommand(value);
}

function ownerForLocalPort(port) {
  const pids = pidsForListeningPort(port);
  if (!pids.length) return { label: '未发现监听进程', detail: '' };
  const owners = pids.map(pid => {
    const command = commandForPid(pid);
    return { pid, label: processLabel(command), command };
  });
  const labels = [...new Set(owners.map(owner => `${owner.label} (PID ${owner.pid})`))];
  return {
    label: labels.join(', '),
    detail: owners.map(owner => `${owner.pid}: ${owner.command}`).join('\n')
  };
}

function localProxyOwnerForUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(?:https?|socks5h?|socks):\/\/(?:127\.0\.0\.1|localhost):(\d+)/i);
  if (!match) return null;
  return ownerForLocalPort(Number(match[1]));
}

function endpoint(values, prefix) {
  const enabled = values[`${prefix}Enable`] === '1';
  const host = values[`${prefix}Proxy`] || '';
  const port = Number(values[`${prefix}Port`] || 0);
  const owner = enabled && host === '127.0.0.1' ? ownerForLocalPort(port) : { label: enabled ? '外部代理' : '未启用', detail: '' };
  return { enabled, host, port, owner };
}

function buildSystemProxySummary(status) {
  if (process.platform !== 'darwin') {
    return { text: '系统代理检查仅支持 macOS。\nSystem proxy check is only available on macOS.', enabled: false, ownedBySophia: false, endpoints: [] };
  }
  const result = runSync('scutil', ['--proxy']);
  if (!result.ok) {
    return { text: conciseText(result.stderr, '无法读取系统代理。'), enabled: false, ownedBySophia: false, endpoints: [] };
  }
  const values = parseScutilProxy(result.stdout);
  const http = endpoint(values, 'HTTP');
  const https = endpoint(values, 'HTTPS');
  const socks = endpoint(values, 'SOCKS');
  const ports = (status && status.ports) || {};
  const matchesSophia = item => item.enabled && item.host === '127.0.0.1' && (item.port === ports.http || item.port === ports.socks);
  const enabled = http.enabled || https.enabled || socks.enabled;
  const ownedBySophia = matchesSophia(http) || matchesSophia(https) || matchesSophia(socks);
  const lines = [];
  if (!enabled) {
    lines.push('macOS 系统代理：未启用。', 'macOS system proxy: disabled.');
  } else {
    lines.push(`HTTP: ${http.enabled ? `${http.host}:${http.port} · ${http.owner.label}` : '未启用'}`);
    lines.push(`HTTPS: ${https.enabled ? `${https.host}:${https.port} · ${https.owner.label}` : '未启用'}`);
    lines.push(`SOCKS: ${socks.enabled ? `${socks.host}:${socks.port} · ${socks.owner.label}` : '未启用'}`);
    lines.push(ownedBySophia ? '当前系统代理指向 SophiaVPN。' : '当前系统代理未指向 SophiaVPN，关闭 SophiaVPN 时不会改动它。');
  }
  if (!ownedBySophia) {
    lines.push('启动规则：点击“启动 / Start”会同时接管系统代理；如果这里显示熊猫云/Panda 或其他软件，启动会失败。');
    lines.push('Start rule: Start takes over system proxy. If Panda or another app owns it, Start will fail.');
  }
  const endpointRows = [
    { name: 'HTTP', ...http },
    { name: 'HTTPS', ...https },
    { name: 'SOCKS', ...socks }
  ].map(item => ({
    name: item.name,
    enabled: item.enabled,
    host: item.host,
    port: item.port,
    endpoint: item.enabled ? `${item.host}:${item.port}` : '未启用 / Disabled',
    ownerLabel: item.owner ? item.owner.label : '',
    ownedBySophia: matchesSophia(item),
    tone: !item.enabled ? 'muted' : matchesSophia(item) ? 'ok' : 'warn'
  }));
  return { enabled, ownedBySophia, http, https, socks, endpoints: endpointRows, text: lines.join('\n') };
}

function parseShellProxyFile() {
  const file = path.join(DATA_DIR, 'shell-proxy.sh');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const enabled = /export\s+SOPHIAVPN_PROXY_ENABLED=1/.test(text) || /export\s+SILVERVPN_PROXY_ENABLED=1/.test(text);
  const readVar = name => {
    const match = text.match(new RegExp(`(?:export\\s+)?${name}=['"]?([^'"\\n]+)['"]?`));
    return match ? match[1].trim() : '';
  };
  return {
    file,
    enabled,
    http: readVar('HTTP_PROXY'),
    https: readVar('HTTPS_PROXY'),
    all: readVar('ALL_PROXY'),
    noProxy: readVar('NO_PROXY')
  };
}

function buildTerminalProxySummary(status) {
  const shell = parseShellProxyFile();
  const envProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY ||
    process.env.http_proxy || process.env.https_proxy || process.env.all_proxy || '';
  const target = shell.http || shell.https || shell.all || envProxy;
  const owner = localProxyOwnerForUrl(target);
  const ports = (status && status.ports) || {};
  const expected = ports.http ? `http://127.0.0.1:${ports.http}` : '';
  const ownedBySophia = Boolean(target && expected && target === expected);
  const lines = [];

  lines.push(`Sophia 终端代理状态：${shell.enabled ? '已开启' : '未开启'}`);
  lines.push(`Sophia terminal proxy state: ${shell.enabled ? 'enabled' : 'disabled'}`);
  if (target) {
    lines.push(`目标 / Target: ${target}`);
    lines.push(`监听进程 / Owner: ${owner ? owner.label : '不是本机代理地址 / not a local proxy endpoint'}`);
  } else {
    lines.push('目标 / Target: 无 / none');
  }
  if (envProxy && envProxy !== target) {
    const envOwner = localProxyOwnerForUrl(envProxy);
    lines.push(`App 环境代理 / App env proxy: ${envProxy}`);
    lines.push(`App 环境监听进程 / App env owner: ${envOwner ? envOwner.label : '未知 / unknown'}`);
  }
  lines.push(ownedBySophia
    ? '当前终端代理目标指向 SophiaVPN。'
    : '当前终端代理未指向 SophiaVPN。');
  lines.push('启动规则：点击“启动 / Start”会同时写入 Sophia 终端代理；已有终端执行 source ~/.config/SophiaVPN/shell-hook.sh 或打开新终端。');
  lines.push('Start rule: Start writes Sophia terminal proxy too. Existing terminals should source ~/.config/SophiaVPN/shell-hook.sh or open a new terminal.');
  return {
    enabled: shell.enabled,
    ownedBySophia,
    target,
    owner,
    ownerLabel: owner ? owner.label : '',
    expected,
    shellFile: shell.file,
    text: lines.join('\n')
  };
}

async function buildDashboard(options = {}) {
  const statusResult = await sophia(['status', '--json', '--no-delay']);
  const status = parseStatusJson(statusResult.stdout) || null;
  const textResult = await sophia(['status', '--no-delay']);
  const profileResult = await sophia(['profile', 'list']);
  const nodeArgs = options.nodeDelay ? ['nodes', '--delay'] : ['nodes'];
  const nodeResult = status && (status.running || status.coreReachable) ? await sophia(nodeArgs) : { ok: true, stdout: 'Core is not running.', stderr: '' };
  const conflictResult = await sophia(['conflicts']);
  const terminalResult = await sophia(['proxy', 'status']);
  const systemProxy = buildSystemProxySummary(status);
  const terminalProxy = buildTerminalProxySummary(status);
  const profiles = readProfilesData();
  const nodesText = resultText(nodeResult);
  const conflictsRaw = resultText(conflictResult);
  return {
    ok: statusResult.ok,
    status,
    statusText: conciseText(resultText(textResult) || resultText(statusResult)),
    profilesText: conciseText(resultText(profileResult), '没有已保存的订阅方案。'),
    profiles,
    nodesText: conciseText(nodesText, 'Core is not running.'),
    nodes: parseNodeRows(nodesText, status),
    conflictsText: summarizeConflicts(conflictsRaw),
    conflicts: parseConflictSummary(conflictsRaw),
    terminalProxyText: terminalProxy.text || conciseText(resultText(terminalResult)),
    systemProxy,
    terminalProxy,
    dataDir: DATA_DIR,
    logDir: LOG_DIR
  };
}

async function actionResult(result, action) {
  const raw = resultText(result);
  const dashboard = await buildDashboard(action === 'nodes-delay' ? { nodeDelay: true } : {});
  const text = action === 'conflicts'
    ? summarizeConflicts(raw)
    : action === 'system-proxy-status'
      ? dashboard.systemProxy.text
      : action === 'terminal-proxy-status'
        ? dashboard.terminalProxy.text
      : conciseText(raw);
  return { ...result, text, rawText: raw, dashboard };
}

async function handleAction(action, payload = {}) {
  switch (action) {
    case 'dashboard':
      return buildDashboard();
    case 'install-sophia':
    case 'install-svpn': {
      const result = await run('bash', [path.join(APP_ROOT, 'scripts', 'install-sophia.sh')]);
      return actionResult(result, action);
    }
    case 'conflicts': {
      const result = await sophia(['conflicts']);
      return actionResult(result, action);
    }
    case 'import': {
      const source = String(payload.source || '').trim();
      const name = String(payload.name || 'My Profile').trim() || 'My Profile';
      if (!source) throw new Error('请输入订阅 URL 或配置文件路径。 Subscription URL or file is required.');
      const result = await sophia(['import', source, name]);
      return actionResult(result, action);
    }
    case 'on': {
      const result = await sophia(['on']);
      return actionResult(result, action);
    }
    case 'off': {
      const result = await sophia(['off']);
      return actionResult(result, action);
    }
    case 'test': {
      const result = await sophia(['test']);
      return actionResult(result, action);
    }
    case 'nodes-delay': {
      const result = await sophia(['nodes', '--delay']);
      return actionResult(result, action);
    }
    case 'use-node': {
      const node = String(payload.node || '').trim();
      if (!node) throw new Error('请输入节点编号或名称。 Node number or name is required.');
      const result = await sophia(['use', node]);
      return actionResult(result, action);
    }
    case 'mode': {
      const mode = String(payload.mode || 'smart').trim();
      const result = await sophia(['mode', mode]);
      return actionResult(result, action);
    }
    case 'profile-use': {
      const profile = String(payload.profile || '').trim();
      if (!profile) throw new Error('请输入订阅方案编号或名称。 Profile number or name is required.');
      const result = await sophia(['profile', 'use', profile]);
      return actionResult(result, action);
    }
    case 'profile-rename': {
      const profile = String(payload.profile || '').trim();
      const name = String(payload.name || '').trim();
      if (!profile || !name) throw new Error('请输入要重命名的订阅和新名称。 Profile selector and new name are required.');
      const result = await sophia(['profile', 'rename', profile, name]);
      return actionResult(result, action);
    }
    case 'profile-delete': {
      const profile = String(payload.profile || '').trim();
      if (!profile) throw new Error('请输入要删除的订阅方案。 Profile selector is required.');
      const args = ['profile', 'delete', profile];
      if (payload.yes) args.push('--yes');
      const result = await sophia(args);
      return actionResult(result, action);
    }
    case 'system-proxy-status': {
      const dashboard = await buildDashboard();
      return { ok: true, code: 0, stdout: dashboard.systemProxy.text, stderr: '', text: dashboard.systemProxy.text, dashboard };
    }
    case 'system-proxy-on': {
      const result = await sophia(['system-proxy', 'on']);
      return actionResult(result, action);
    }
    case 'system-proxy-off': {
      const result = await sophia(['system-proxy', 'off']);
      return actionResult(result, action);
    }
    case 'terminal-proxy-status': {
      const result = await sophia(['proxy', 'status']);
      return actionResult(result, action);
    }
    case 'terminal-proxy-on': {
      const result = await sophia(['proxy', 'on']);
      return actionResult(result, action);
    }
    case 'terminal-proxy-off': {
      const result = await sophia(['proxy', 'off']);
      return actionResult(result, action);
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
      throw new Error(`不支持的操作：${action}. Unsupported action.`);
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
