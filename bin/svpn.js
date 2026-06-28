#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');
const yaml = require('js-yaml');

const APP_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DELAY_URL = 'https://www.gstatic.com/generate_204';
const START_TIMEOUT_MS = 15000;
const DEFAULT_BASE_PORTS = [4780, 4880, 4980, 5080, 5180, 5280, 5380, 5480, 5580, 5680];
const MODE_ALIASES = {
  rule: 'rule',
  smart: 'rule',
  intelligent: 'rule',
  auto: 'rule',
  global: 'global',
  direct: 'direct'
};
const MODE_LABELS = {
  rule: '智能代理',
  Rule: '智能代理',
  global: '全局代理',
  Global: '全局代理',
  direct: '直连模式',
  Direct: '直连模式'
};
const DEFAULT_BYPASS_HOSTS = [
  'localhost',
  '127.0.0.0/8',
  '::1',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  'gitlab.reallab.org.cn',
  '*.reallab.org.cn',
  '*.local'
];
const ALWAYS_PROXY_RULES = [
  'DOMAIN-SUFFIX,claude.ai,Proxy',
  'DOMAIN-SUFFIX,anthropic.com,Proxy',
  'DOMAIN-SUFFIX,claudeusercontent.com,Proxy',
  'DOMAIN,platform.claude.com,Proxy',
  'DOMAIN,downloads.claude.ai,Proxy',
  'DOMAIN-SUFFIX,openai.com,Proxy',
  'DOMAIN-SUFFIX,chatgpt.com,Proxy',
  'DOMAIN-SUFFIX,github.com,Proxy',
  'DOMAIN-SUFFIX,githubusercontent.com,Proxy',
  'DOMAIN-SUFFIX,githubcopilot.com,Proxy',
  'DOMAIN,copilot-proxy.githubusercontent.com,Proxy'
];
const ALWAYS_DIRECT_RULES = ['GEOIP,CN,DIRECT'];

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_error) {
    return fallback;
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(file, value) {
  file = assertPathInHome(file, 'SilverVPN output file');
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function assertPathInHome(target, label) {
  const home = fs.realpathSync(os.homedir());
  const resolved = path.resolve(target);
  let existing = resolved;
  const missing = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  const canonical = path.join(fs.realpathSync(existing), ...missing);
  if (canonical !== home && !canonical.startsWith(`${home}${path.sep}`)) {
    throw new Error(`${label} must stay inside the current user's HOME: ${canonical}`);
  }
  return canonical;
}

function getPaths(args = {}) {
  const dataDir = assertPathInHome(
    args['data-dir'] ||
    process.env.SILVERVPN_DATA_DIR ||
    path.join(os.homedir(), '.config', 'SilverVPN'),
    'SilverVPN data directory'
  );
  const resources = args.resources || path.join(APP_ROOT, 'resources');
  return {
    dataDir,
    resources,
    configDir: path.join(dataDir, 'clash-configs'),
    runtimeDir: path.join(dataDir, 'clash-runtime'),
    logsDir: path.join(dataDir, 'logs'),
    settingsFile: path.join(dataDir, 'settings.json'),
    serverFile: path.join(dataDir, 'server.json'),
    pidFile: path.join(dataDir, 'svpn.pid'),
    shellProxyFile: path.join(dataDir, 'shell-proxy.sh'),
    shellHookFile: path.join(dataDir, 'shell-hook.sh'),
    subscriptionsDir: path.join(dataDir, 'subscriptions'),
    subscriptionsFile: path.join(dataDir, 'clashy-configs', 'subscriptions.json'),
    activeConfigFile: path.join(dataDir, 'clash-configs', 'config.yaml'),
    runtimeConfigFile: path.join(dataDir, 'clash-runtime', 'config.yaml'),
    defaultMmdbFile: path.join(resources, 'clash-configs', 'Country.mmdb')
  };
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function portsFromBase(base) {
  if (base + 10 > 65535) throw new Error(`Invalid port base: ${base}`);
  return {
    http: base,
    socks: base + 1,
    service: base + 8,
    core: base + 10
  };
}

function listListeningPorts() {
  try {
    const output = execSync('ss -H -ltn', { encoding: 'utf8' });
    const ports = new Set();
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/:(\d+)\s/);
      if (match) ports.add(Number(match[1]));
    }
    return ports;
  } catch (_error) {
    return new Set();
  }
}

function portSetAvailable(ports, allowPidRunning = false) {
  if (allowPidRunning) return true;
  const used = listListeningPorts();
  return [ports.http, ports.socks, ports.service, ports.core].every(port => !used.has(port));
}

function findAvailablePorts() {
  for (const base of DEFAULT_BASE_PORTS) {
    const ports = portsFromBase(base);
    if (portSetAvailable(ports)) return ports;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  for (let offset = 0; offset < 50; offset += 1) {
    const base = 6000 + ((uid + offset) % 200) * 10;
    const ports = portsFromBase(base);
    if (portSetAvailable(ports)) return ports;
  }
  throw new Error('No free SilverVPN port set found. Run: svpn config ports <base-port>');
}

function getServerConfig(paths) {
  return readJson(paths.serverFile, {});
}

function saveServerConfig(paths, config) {
  writeJson(paths.serverFile, config);
}

function getPorts(paths, args = {}) {
  const config = getServerConfig(paths);
  if (args['base-port']) {
    const ports = portsFromBase(normalizePort(args['base-port']));
    config.ports = ports;
    saveServerConfig(paths, config);
    return ports;
  }
  if (process.env.SVPN_BASE_PORT) {
    return portsFromBase(normalizePort(process.env.SVPN_BASE_PORT));
  }
  if (config.ports && config.ports.http && config.ports.socks && config.ports.service && config.ports.core) {
    return config.ports;
  }
  const ports = findAvailablePorts();
  config.ports = ports;
  saveServerConfig(paths, config);
  return ports;
}

function formatPorts(ports) {
  return `HTTP ${ports.http} / SOCKS ${ports.socks} / API ${ports.service} / Core ${ports.core}`;
}

function findCore(paths) {
  if (process.env.CLASH_CORE && fs.existsSync(process.env.CLASH_CORE)) return process.env.CLASH_CORE;
  const archMap = { x64: 'amd64', arm64: 'arm64', arm: 'armv7' };
  const arch = archMap[process.arch] || process.arch;
  const candidates = [
    `mihomo-linux-${arch}`,
    `clash-meta-linux-${arch}`,
    `clash-linux-${arch}`,
    'mihomo',
    'clash'
  ].map(name => path.join(paths.resources, 'clash-binaries', name));
  for (const file of candidates) {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch (_error) {
      // continue
    }
  }
  for (const name of ['mihomo', 'clash-meta', 'clash']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return '';
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function processBelongsToCurrentUser(pid) {
  try {
    if (fs.statSync(`/proc/${Number(pid)}`).uid !== process.getuid()) return false;
    const command = fs.readFileSync(`/proc/${Number(pid)}/cmdline`, 'utf8').replace(/\0/g, ' ');
    return command.includes(path.resolve(__filename)) && command.includes(' daemon');
  } catch (_error) {
    return false;
  }
}

function readPidInfo(paths) {
  const info = readJson(paths.pidFile, null);
  if (!info || !info.pid) return null;
  return info;
}

function isRunning(paths) {
  const info = readPidInfo(paths);
  return Boolean(info && pidAlive(info.pid) && processBelongsToCurrentUser(info.pid));
}

function requestCore(ports, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: ports.core,
        path: pathname,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
        },
        timeout: options.timeout || 5000
      },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`core HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(raw ? JSON.parse(raw) : null);
          } catch (_error) {
            resolve(raw);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('core request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForCore(ports, timeoutMs = START_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await requestCore(ports, '/configs', { timeout: 1200 });
      return true;
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  return false;
}

function normalizeBypassHosts(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const item of source) {
    const value = String(item || '').trim();
    if (!value || value.startsWith('#') || seen.has(value)) continue;
    out.push(value);
    seen.add(value);
  }
  return out;
}

function bypassHostToDirectRule(host) {
  if (host === 'localhost') return 'DOMAIN,localhost,DIRECT';
  if (host === '::1') return 'IP-CIDR6,::1/128,DIRECT,no-resolve';
  if (/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(host)) return `IP-CIDR,${host},DIRECT,no-resolve`;
  if (/^[0-9a-f:]+\/\d{1,3}$/i.test(host)) return `IP-CIDR6,${host},DIRECT,no-resolve`;
  if (host.startsWith('*.')) return `DOMAIN-SUFFIX,${host.slice(2)},DIRECT`;
  if (host.startsWith('.')) return `DOMAIN-SUFFIX,${host.slice(1)},DIRECT`;
  if (/^[a-z0-9.-]+$/i.test(host)) return `DOMAIN,${host},DIRECT`;
  return '';
}

function getDirectRules(settings = {}) {
  return normalizeBypassHosts([
    ...normalizeBypassHosts([...DEFAULT_BYPASS_HOSTS, ...(settings.bypassHosts || [])]).map(bypassHostToDirectRule),
    ...ALWAYS_DIRECT_RULES
  ]).filter(Boolean);
}

function getProxyTarget(config) {
  const groups = Array.isArray(config['proxy-groups'])
    ? config['proxy-groups']
    : Array.isArray(config['Proxy Group'])
      ? config['Proxy Group']
      : [];
  const selectable = groups.filter(group => {
    const type = String((group && group.type) || '').toLowerCase();
    return group && group.name && ['select', 'url-test', 'fallback', 'load-balance'].includes(type);
  });
  return (selectable.find(group => group.name === 'Proxy') || selectable[0] || {}).name || 'Proxy';
}

function ensureRoutingRules(config, settings) {
  const proxyTarget = getProxyTarget(config);
  const desired = [
    ...ALWAYS_PROXY_RULES.map(rule => rule.replace(/,Proxy$/, `,${proxyTarget}`)),
    ...getDirectRules(settings)
  ];
  const existing = Array.isArray(config.rules) ? config.rules.map(String) : [];
  const seen = new Set(existing);
  const missing = desired.filter(rule => !seen.has(rule));
  config.rules = [...missing, ...existing];
  if (!config.rules.some(rule => /^MATCH,/.test(String(rule)))) {
    config.rules.push(`MATCH,${proxyTarget}`);
  }
}

function prepareRuntimeConfig(paths, ports) {
  if (!fs.existsSync(paths.activeConfigFile)) {
    throw new Error(`Config not found: ${paths.activeConfigFile}. Import a subscription first.`);
  }
  const settings = readJson(paths.settingsFile, {});
  const raw = readText(paths.activeConfigFile);
  const config = yaml.load(raw) || {};
  delete config['mixed-port'];
  delete config['redir-port'];
  delete config['tproxy-port'];
  delete config.tun;
  config.port = ports.http;
  config['socks-port'] = ports.socks;
  config['external-controller'] = `127.0.0.1:${ports.core}`;
  config.secret = '';
  if (settings.mode) config.mode = settings.mode;
  ensureRoutingRules(config, settings);
  const runtimeConfigFile = assertPathInHome(paths.runtimeConfigFile, 'Runtime config');
  ensureDir(path.dirname(runtimeConfigFile));
  fs.writeFileSync(runtimeConfigFile, yaml.dump(config, { lineWidth: 160 }));
  if (fs.existsSync(paths.defaultMmdbFile)) {
    fs.copyFileSync(
      paths.defaultMmdbFile,
      assertPathInHome(path.join(paths.runtimeDir, 'Country.mmdb'), 'Runtime database')
    );
  }
}

function appendLog(paths, stream, line) {
  ensureDir(paths.logsDir);
  fs.appendFileSync(assertPathInHome(path.join(paths.logsDir, stream), 'SilverVPN log'), line);
}

function proxyToCore(ports, request, response) {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: ports.core,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${ports.core}` }
    },
    upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    }
  );
  upstream.on('error', error => {
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: false, error: error.message }));
  });
  request.pipe(upstream);
}

async function daemon(paths, args) {
  const ports = getPorts(paths, args);
  const core = findCore(paths);
  if (!core) throw new Error('mihomo core not found. Run scripts/install-core.sh first.');
  prepareRuntimeConfig(paths, ports);

  const child = spawn(core, ['-d', paths.runtimeDir], {
    stdio: ['ignore', 'inherit', 'inherit']
  });
  let shuttingDown = false;
  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, pid: process.pid, corePid: child.pid, ports }));
      return;
    }
    proxyToCore(ports, request, response);
  });

  const stop = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    if (pidAlive(child.pid)) child.kill(signal || 'SIGTERM');
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  child.on('exit', code => {
    if (!shuttingDown) process.exit(code || 1);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ports.service, '127.0.0.1', resolve);
  });
}

async function waitForService(ports, timeoutMs = START_TIMEOUT_MS) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const value = await new Promise((resolve, reject) => {
        const request = http.get(
          { hostname: '127.0.0.1', port: ports.service, path: '/health', timeout: 1000 },
          response => {
            let raw = '';
            response.on('data', chunk => { raw += chunk; });
            response.on('end', () => resolve(JSON.parse(raw)));
          }
        );
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.on('error', reject);
      });
      if (value && value.ok) return true;
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  return false;
}

async function restoreSelection(paths, ports) {
  const settings = readJson(paths.settingsFile, {});
  const config = await requestCore(ports, '/configs');
  const proxies = await requestCore(ports, '/proxies');
  const selector = getSelectorName(paths, proxies, config && config.mode);
  const group = proxies.proxies && proxies.proxies[selector];
  const candidates = group && Array.isArray(group.all) ? group.all : [];
  let selected = settings.currentProxy;
  if (!selected || !candidates.includes(selected)) {
    selected = candidates.find(name => !['DIRECT', 'REJECT', 'PASS'].includes(name)) || '';
  }
  if (selected && group.now !== selected) {
    await requestCore(ports, `/proxies/${encodeURIComponent(selector)}`, {
      method: 'PUT',
      body: { name: selected }
    });
  }
  if (selected) {
    settings.currentProxy = selected;
    writeJson(paths.settingsFile, settings);
  }
}

async function start(paths, args) {
  const ports = getPorts(paths, args);
  if (isRunning(paths)) {
    console.log(`SilverVPN 已在后台运行：${formatPorts(ports)}`);
    return;
  }
  if (!portSetAvailable(ports)) {
    throw new Error(`端口组被占用：${formatPorts(ports)}。请运行 svpn config ports <base-port> 设置个人端口。`);
  }
  const core = findCore(paths);
  if (!core) throw new Error('mihomo core not found. Run scripts/install.sh first.');
  prepareRuntimeConfig(paths, ports);
  ensureDir(paths.logsDir);
  const stdout = fs.openSync(assertPathInHome(path.join(paths.logsDir, 'svpn-core.log'), 'SilverVPN log'), 'a');
  const stderr = fs.openSync(assertPathInHome(path.join(paths.logsDir, 'svpn-core.err.log'), 'SilverVPN log'), 'a');
  const child = spawn(process.execPath, [path.resolve(__filename), 'daemon', '--data-dir', paths.dataDir], {
    detached: true,
    stdio: ['ignore', stdout, stderr]
  });
  child.unref();
  writeJson(paths.pidFile, {
    pid: child.pid,
    command: path.resolve(__filename),
    core,
    ports,
    startedAt: new Date().toISOString(),
    user: os.userInfo().username
  });
  const ready = (await waitForService(ports)) && (await waitForCore(ports));
  if (!ready) {
    if (pidAlive(child.pid) && processBelongsToCurrentUser(child.pid)) child.kill('SIGTERM');
    fs.rmSync(paths.pidFile, { force: true });
    throw new Error(`后台已启动但 Core 未就绪。查看日志：${path.join(paths.logsDir, 'svpn-core.err.log')}`);
  }
  await restoreSelection(paths, ports);
  if (args.proxy) writeShellProxy(paths, ports, true);
  const proxyEnabled = shellProxyEnabled(paths);
  console.log('SilverVPN 已启动');
  console.log(`模式：proxy-only 后台`);
  console.log(`端口：${formatPorts(ports)}`);
  console.log(`终端代理：${proxyEnabled ? '已开启' : '未开启（运行 svpn proxy on）'}`);
}

async function stop(paths, args) {
  const info = readPidInfo(paths);
  if (!info || !info.pid || !pidAlive(info.pid) || !processBelongsToCurrentUser(info.pid)) {
    fs.rmSync(paths.pidFile, { force: true });
    if (args.proxy) writeShellProxy(paths, getPorts(paths, args), false);
    console.log('SilverVPN 未在后台运行');
    return;
  }
  process.kill(Number(info.pid), 'SIGTERM');
  const started = Date.now();
  while (pidAlive(info.pid) && Date.now() - started < 5000) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fs.rmSync(paths.pidFile, { force: true });
  if (args.proxy !== false) writeShellProxy(paths, info.ports || getPorts(paths, args), false);
  console.log('SilverVPN 已停止');
}

async function restart(paths, args) {
  await stop(paths, { ...args, proxy: false });
  await new Promise(resolve => setTimeout(resolve, 500));
  await start(paths, args);
}

function readModeLabel(mode) {
  return MODE_LABELS[mode] || mode || '未知';
}

async function getCoreState(paths, ports) {
  const state = { running: false, config: null, proxies: null };
  try {
    state.config = await requestCore(ports, '/configs', { timeout: 2000 });
    state.proxies = await requestCore(ports, '/proxies', { timeout: 3000 });
    state.running = true;
  } catch (_error) {
    state.running = false;
  }
  return state;
}

function getSelectorName(paths, proxies, mode = '') {
  const items = proxies && proxies.proxies ? proxies.proxies : {};
  if (String(mode).toLowerCase() === 'global' && items.GLOBAL) return 'GLOBAL';
  try {
    const config = yaml.load(readText(paths.activeConfigFile)) || {};
    const target = getProxyTarget(config);
    if (items[target] && Array.isArray(items[target].all)) return target;
  } catch (_error) {
    // Fall through to compatibility selectors.
  }
  if (items.Proxy && Array.isArray(items.Proxy.all)) return 'Proxy';
  const found = Object.entries(items).find(([, value]) => Array.isArray(value.all) && value.all.length);
  return found ? found[0] : 'Proxy';
}

function getCurrentNode(paths, proxies, mode = '') {
  const items = proxies && proxies.proxies ? proxies.proxies : {};
  const proxy = items[getSelectorName(paths, proxies, mode)] || items.GLOBAL;
  return proxy ? proxy.now || '' : '';
}

async function getDelay(ports, node) {
  if (!node) return null;
  const target = encodeURIComponent(node);
  const url = encodeURIComponent(DEFAULT_DELAY_URL);
  try {
    const value = await requestCore(ports, `/proxies/${target}/delay?timeout=5000&url=${url}`, { timeout: 6500 });
    return Number.isFinite(value.delay) ? value.delay : null;
  } catch (_error) {
    return null;
  }
}

function shellProxyEnabled(paths) {
  const text = readText(paths.shellProxyFile);
  return /SILVERVPN_PROXY_ENABLED=1/.test(text);
}

function vscodeProxyEnabled(ports) {
  const files = [
    path.join(os.homedir(), '.vscode-server', 'data', 'Machine', 'settings.json'),
    path.join(os.homedir(), '.vscode-server-insiders', 'data', 'Machine', 'settings.json')
  ];
  return files.every(file => {
    const value = readJson(file, null);
    return value && value['http.proxy'] === `http://127.0.0.1:${ports.http}` && value['http.proxySupport'] === 'override';
  });
}

function vscodeProxyState(ports) {
  const check = base => {
    const file = path.join(os.homedir(), base, 'data', 'Machine', 'settings.json');
    const value = readJson(file, null);
    return Boolean(
      value &&
      value['http.proxy'] === `http://127.0.0.1:${ports.http}` &&
      value['http.proxySupport'] === 'override' &&
      value['http.proxyStrictSSL'] === true
    );
  };
  return {
    stable: check('.vscode-server'),
    insiders: check('.vscode-server-insiders')
  };
}

async function status(paths, args) {
  const ports = getPorts(paths, args);
  const pid = readPidInfo(paths);
  const alive = isRunning(paths);
  const core = await getCoreState(paths, ports);
  const mode = core.config ? core.config.mode : readJson(paths.settingsFile, {}).mode || 'rule';
  const node = getCurrentNode(paths, core.proxies, mode) || readJson(paths.settingsFile, {}).currentProxy || '未选择';
  const delay = core.running && node !== '未选择' && !args['no-delay'] ? await getDelay(ports, node) : null;

  if (args.json) {
    console.log(JSON.stringify({ running: alive || core.running, pid: pid && pid.pid, ports, mode, node, delay, terminalProxy: shellProxyEnabled(paths), vscodeProxy: vscodeProxyEnabled(ports), dataDir: paths.dataDir }, null, 2));
    return;
  }

  console.log(`SilverVPN：${alive || core.running ? '运行中' : '未运行'}`);
  console.log(`用户：${os.userInfo().username}`);
  console.log(`模式：${readModeLabel(mode)} (${String(mode).toLowerCase()})`);
  console.log(`节点：${node}${delay === null ? '' : `  ${delay} ms`}`);
  console.log(`代理：HTTP ${ports.http} / SOCKS ${ports.socks}`);
  console.log(`终端代理：${shellProxyEnabled(paths) ? '已开启' : '未开启'}`);
  const vscodeState = vscodeProxyState(ports);
  console.log(`VS Code Stable：${vscodeState.stable ? '已配置 override' : '未配置'}`);
  console.log(`VS Code Insiders：${vscodeState.insiders ? '已配置 override' : '未配置'}`);
  console.log(`后台：${alive ? `PID ${pid.pid}` : '无后台进程'}`);
}

async function setMode(paths, args) {
  const mode = MODE_ALIASES[String(args._[1] || '').toLowerCase()];
  if (!mode) throw new Error('Usage: svpn mode smart|global|direct');
  const ports = getPorts(paths, args);
  const settings = readJson(paths.settingsFile, {});
  settings.mode = mode;
  writeJson(paths.settingsFile, settings);
  try {
    await requestCore(ports, '/configs', { method: 'PATCH', body: { mode } });
    await restoreSelection(paths, ports);
    console.log(`模式已切换：${readModeLabel(mode)}`);
  } catch (_error) {
    console.log(`模式已保存：${readModeLabel(mode)}（Core 未运行，启动后生效）`);
  }
}

function proxyListFromCore(paths, proxies, mode = '') {
  const items = proxies && proxies.proxies ? proxies.proxies : {};
  const group = items[getSelectorName(paths, proxies, mode)] || items.GLOBAL;
  return group && Array.isArray(group.all) ? group.all.filter(name => !['DIRECT', 'REJECT'].includes(name)) : [];
}

async function nodes(paths, args) {
  const ports = getPorts(paths, args);
  const proxies = await requestCore(ports, '/proxies');
  const mode = readJson(paths.settingsFile, {}).mode || 'rule';
  const current = getCurrentNode(paths, proxies, mode);
  const list = proxyListFromCore(paths, proxies, mode);
  const delays = args.delay ? await Promise.all(list.map(name => getDelay(ports, name))) : [];
  for (let index = 0; index < list.length; index += 1) {
    const name = list[index];
    let suffix = '';
    if (args.delay) {
      const delay = delays[index];
      suffix = delay === null ? '  失败' : `  ${delay} ms`;
    }
    const mark = name === current ? '*' : ' ';
    console.log(`${mark} ${String(index + 1).padStart(2, ' ')}. ${name}${suffix}`);
  }
}

function resolveNode(input, list) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Usage: svpn use <node-number-or-name>');
  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1;
    if (index >= 0 && index < list.length) return list[index];
  }
  const exact = list.find(name => name === value);
  if (exact) return exact;
  const partial = list.find(name => name.includes(value));
  if (partial) return partial;
  throw new Error(`Node not found: ${value}`);
}

async function useNode(paths, args) {
  const ports = getPorts(paths, args);
  const proxies = await requestCore(ports, '/proxies');
  const mode = readJson(paths.settingsFile, {}).mode || 'rule';
  const selector = getSelectorName(paths, proxies, mode);
  const list = proxyListFromCore(paths, proxies, mode);
  const node = resolveNode(args._.slice(1).join(' '), list);
  const groups = [...new Set([selector, 'GLOBAL'])];
  for (const group of groups) {
    if (proxies.proxies && proxies.proxies[group]) {
      await requestCore(ports, `/proxies/${encodeURIComponent(group)}`, { method: 'PUT', body: { name: node } }).catch(() => null);
    }
  }
  await requestCore(ports, '/connections', { method: 'DELETE' }).catch(() => null);
  const settings = readJson(paths.settingsFile, {});
  settings.currentProxy = node;
  writeJson(paths.settingsFile, settings);
  const delay = await getDelay(ports, node);
  console.log(`节点已切换：${node}${delay === null ? '' : ` (${delay} ms)`}`);
}

function writeShellProxy(paths, ports, enabled) {
  paths.shellProxyFile = assertPathInHome(paths.shellProxyFile, 'Shell proxy state');
  ensureDir(path.dirname(paths.shellProxyFile));
  if (!enabled) {
    fs.writeFileSync(paths.shellProxyFile, `# Generated by svpn.\nexport SILVERVPN_PROXY_ENABLED=0\nunset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy\n`);
    fs.chmodSync(paths.shellProxyFile, 0o600);
    return;
  }
  const noProxy = 'localhost,127.0.0.1,::1,gitlab.reallab.org.cn,.reallab.org.cn,.local';
  fs.writeFileSync(
    paths.shellProxyFile,
    `# Generated by svpn.\nexport SILVERVPN_PROXY_ENABLED=1\nexport HTTP_PROXY='http://127.0.0.1:${ports.http}'\nexport HTTPS_PROXY='http://127.0.0.1:${ports.http}'\nexport ALL_PROXY='http://127.0.0.1:${ports.http}'\nexport http_proxy=\"$HTTP_PROXY\"\nexport https_proxy=\"$HTTPS_PROXY\"\nexport all_proxy=\"$ALL_PROXY\"\nexport NO_PROXY='${noProxy}'\nexport no_proxy=\"$NO_PROXY\"\n`
  );
  fs.chmodSync(paths.shellProxyFile, 0o600);
}

function proxy(paths, args) {
  const action = args._[1] || 'status';
  const ports = getPorts(paths, args);
  if (action === 'on') {
    writeShellProxy(paths, ports, true);
    console.log('终端代理已开启');
    console.log('新的 shell 会自动生效；已安装 shell hook 的当前交互 shell 会在下一次提示符刷新。');
    return;
  }
  if (action === 'off') {
    writeShellProxy(paths, ports, false);
    console.log('终端代理已关闭');
    console.log('新的 shell 会自动清理；已安装 shell hook 的当前交互 shell 会在下一次提示符刷新。');
    return;
  }
  console.log(`终端代理：${shellProxyEnabled(paths) ? '已开启' : '未开启'}`);
}

function updateVscodeSettingsFile(file, ports, enabled) {
  if (!enabled && !fs.existsSync(file)) return;
  const data = readJson(file, {});
  if (enabled) {
    data['http.proxy'] = `http://127.0.0.1:${ports.http}`;
    data['http.proxySupport'] = 'override';
    data['http.proxyStrictSSL'] = true;
  } else {
    delete data['http.proxy'];
    delete data['http.proxySupport'];
    delete data['http.proxyStrictSSL'];
  }
  writeJson(file, data);
}

function updateVscodeEnvFile(dir, enabled) {
  const file = assertPathInHome(path.join(dir, 'server-env-setup'), 'VS Code environment file');
  if (!enabled && !fs.existsSync(file)) return;
  ensureDir(dir);
  const begin = '# >>> SilverVPN proxy >>>';
  const end = '# <<< SilverVPN proxy <<<';
  const current = readText(file);
  const pattern = /# >>> SilverVPN proxy >>>[\s\S]*?# <<< SilverVPN proxy <<<\n?/g;
  const cleaned = current.replace(pattern, '').replace(/\s+$/, '');
  const block = `${begin}\nif [ -r "$HOME/.config/SilverVPN/shell-proxy.sh" ]; then\n  . "$HOME/.config/SilverVPN/shell-proxy.sh"\nfi\n${end}`;
  const next = enabled ? `${cleaned ? `${cleaned}\n\n` : '#!/usr/bin/env bash\n'}${block}\n` : `${cleaned}${cleaned ? '\n' : ''}`;
  fs.writeFileSync(file, next);
  fs.chmodSync(file, 0o700);
}

function vscode(paths, args) {
  const action = args._[1] || 'status';
  const ports = getPorts(paths, args);
  const targets = [
    path.join(os.homedir(), '.vscode-server'),
    path.join(os.homedir(), '.vscode-server-insiders')
  ];
  if (action === 'on') {
    writeShellProxy(paths, ports, true);
    for (const base of targets) {
      updateVscodeSettingsFile(path.join(base, 'data', 'Machine', 'settings.json'), ports, true);
      updateVscodeEnvFile(base, true);
    }
    console.log('VS Code Remote 代理已配置：override');
    console.log('请重启 VS Code Server：pkill -f .vscode-server');
    return;
  }
  if (action === 'off') {
    for (const base of targets) {
      updateVscodeSettingsFile(path.join(base, 'data', 'Machine', 'settings.json'), ports, false);
      updateVscodeEnvFile(base, false);
    }
    console.log('VS Code Remote 代理配置已移除');
    console.log('请重启 VS Code Server：pkill -f .vscode-server');
    return;
  }
  console.log(`VS Code：${vscodeProxyEnabled(ports) ? '已配置 override' : '未配置'}`);
}

function configurePorts(paths, args) {
  const base = args._[2];
  if (!base) {
    const ports = getPorts(paths, args);
    console.log(formatPorts(ports));
    return;
  }
  if (isRunning(paths)) {
    throw new Error('SilverVPN is running. Run svpn off before changing this user\'s ports.');
  }
  const ports = portsFromBase(normalizePort(base));
  const config = getServerConfig(paths);
  config.ports = ports;
  saveServerConfig(paths, config);
  console.log(`个人端口已设置：${formatPorts(ports)}`);
}

async function runTest(paths, args) {
  const ports = getPorts(paths, args);
  const env = {
    ...process.env,
    HTTP_PROXY: `http://127.0.0.1:${ports.http}`,
    HTTPS_PROXY: `http://127.0.0.1:${ports.http}`,
    ALL_PROXY: `http://127.0.0.1:${ports.http}`,
    http_proxy: `http://127.0.0.1:${ports.http}`,
    https_proxy: `http://127.0.0.1:${ports.http}`,
    all_proxy: `http://127.0.0.1:${ports.http}`
  };
  const tests = [
    ['GitHub', 'https://api.github.com/repos/github/copilot-cli/releases/latest'],
    ['GitHub Copilot', 'https://api.githubcopilot.com'],
    ['OpenAI', 'https://api.openai.com/v1/models'],
    ['ChatGPT', 'https://chatgpt.com']
  ];
  const ipResult = spawnSync('curl', ['-sS', '--max-time', '20', 'https://api.ipify.org'], { encoding: 'utf8', env });
  console.log(`出口 IP：${ipResult.status === 0 && ipResult.stdout.trim() ? ipResult.stdout.trim() : '失败'}`);
  for (const [label, url] of tests) {
    const result = spawnSync(
      'curl',
      ['-sS', '-L', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', url],
      { encoding: 'utf8', env }
    );
    const code = String(result.stdout || '').trim();
    let state = '失败';
    if (/^[23]\d\d$/.test(code)) state = `可达 (HTTP ${code})`;
    else if (code === '401') state = '可达，需要认证 (HTTP 401)';
    else if (code === '403') state = '可达，但当前节点/服务拒绝访问 (HTTP 403)';
    else if (/^[45]\d\d$/.test(code)) state = `服务可达 (HTTP ${code})`;
    console.log(`${label}：${state}`);
  }
}

function profileId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function readProfiles(paths) {
  const data = readJson(paths.subscriptionsFile, { subscriptions: [] });
  return Array.isArray(data.subscriptions) ? data.subscriptions : [];
}

function writeProfiles(paths, profiles) {
  writeJson(paths.subscriptionsFile, { subscriptions: profiles });
}

function saveImportedProfile(paths, source, name) {
  const settings = readJson(paths.settingsFile, {});
  const metadata = settings.profile || {};
  const id = `custom-${profileId(source)}`;
  const fileName = path.join(paths.subscriptionsDir, `${id}.yaml`);
  assertPathInHome(fileName, 'Subscription profile');
  ensureDir(paths.subscriptionsDir);
  fs.copyFileSync(paths.activeConfigFile, fileName);
  let proxyCount = metadata.proxyCount || 0;
  if (!proxyCount) {
    try {
      const config = yaml.load(readText(paths.activeConfigFile)) || {};
      proxyCount = Array.isArray(config.proxies) ? config.proxies.length : 0;
    } catch (_error) {
      proxyCount = 0;
    }
  }
  const record = {
    id,
    fileName,
    name: name || metadata.name || 'Custom Subscription',
    kind: 'custom',
    sourceType: metadata.sourceType || 'subscription-url',
    url: metadata.subscriptionUrl || (/^https?:|^sub:/i.test(source) ? source : ''),
    urlDisplay: metadata.subscriptionUrlDisplay || '',
    proxyCount,
    importedAt: metadata.importedAt || new Date().toISOString()
  };
  const profiles = readProfiles(paths).filter(item => item.id !== id && item.fileName !== fileName);
  profiles.push(record);
  writeProfiles(paths, profiles);
  settings.currentProfileId = id;
  settings.currentProfile = paths.activeConfigFile;
  writeJson(paths.settingsFile, settings);
  return record;
}

function listProfiles(paths) {
  const settings = readJson(paths.settingsFile, {});
  const profiles = readProfiles(paths);
  if (!profiles.length) {
    console.log('没有已保存的订阅方案。');
    return;
  }
  profiles.forEach((profile, index) => {
    const active = profile.id === settings.currentProfileId ? '*' : ' ';
    console.log(`${active} ${String(index + 1).padStart(2, ' ')}. ${profile.name || profile.id}  (${profile.proxyCount || '?'} 节点)`);
  });
}

function resolveProfile(paths, value) {
  const profiles = readProfiles(paths);
  const input = String(value || '').trim();
  if (!input) throw new Error('Usage: svpn profile use <number|name>');
  if (/^\d+$/.test(input)) {
    const selected = profiles[Number(input) - 1];
    if (selected) return selected;
  }
  return profiles.find(item => item.id === input || item.name === input) ||
    profiles.find(item => String(item.name || '').includes(input)) ||
    null;
}

async function useProfile(paths, args) {
  const profile = resolveProfile(paths, args._.slice(2).join(' '));
  if (!profile || !profile.fileName || !fs.existsSync(profile.fileName)) {
    throw new Error('Subscription profile not found or its config file is missing.');
  }
  assertPathInHome(profile.fileName, 'Subscription profile');
  fs.copyFileSync(profile.fileName, assertPathInHome(paths.activeConfigFile, 'Active config'));
  const settings = readJson(paths.settingsFile, {});
  settings.currentProfileId = profile.id;
  settings.currentProfile = paths.activeConfigFile;
  writeJson(paths.settingsFile, settings);
  if (isRunning(paths)) await restart(paths, { ...args, proxy: false });
  console.log(`订阅方案已切换：${profile.name || profile.id}`);
}

async function profile(paths, args) {
  const action = args._[1] || 'list';
  if (action === 'list') return listProfiles(paths);
  if (action === 'use') return useProfile(paths, args);
  throw new Error('Usage: svpn profile list|use <number|name>');
}

async function importConfig(paths, args) {
  const source = args._[1];
  if (!source) throw new Error('Usage: svpn import <subscription-url|sub://...|config.yaml> [profile-name]');
  const cli = path.join(APP_ROOT, 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'import', source, '--data-dir', paths.dataDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Subscription import failed').trim());
  }
  const record = saveImportedProfile(paths, source, args._.slice(2).join(' '));
  if (isRunning(paths)) await restart(paths, { ...args, proxy: false });
  console.log(`订阅已导入：${record.name}（${record.proxyCount || '未知'} 节点）`);
}

async function on(paths, args) {
  await start(paths, { ...args, proxy: false });
  proxy(paths, { ...args, _: ['proxy', 'on'] });
  vscode(paths, { ...args, _: ['vscode', 'on'] });
  console.log('SilverVPN 一键开启完成。');
}

async function off(paths, args) {
  vscode(paths, { ...args, _: ['vscode', 'off'] });
  proxy(paths, { ...args, _: ['proxy', 'off'] });
  await stop(paths, { ...args, proxy: false });
  console.log('SilverVPN 一键关闭完成。');
}

function printHelp() {
  console.log(`Usage: svpn <command>\n\nOne-click:\n  svpn on                       Start backend, terminal proxy and both VS Code Remote proxies\n  svpn off                      Stop and remove this user's proxy integrations\n  svpn status                   Human-friendly status\n\nCore commands:\n  svpn start [--proxy]          Start per-user proxy-only backend\n  svpn stop                     Stop backend\n  svpn restart [--proxy]        Restart backend\n\nProxy control:\n  svpn mode smart|global|direct Set proxy-only routing mode\n  svpn nodes [--delay]          List nodes, optionally with delays\n  svpn delay                    Alias for: svpn nodes --delay\n  svpn use <number|name>        Switch node and close old connections\n  svpn proxy on|off             Write per-user terminal proxy state\n  svpn vscode on|off            Configure Stable and Insiders Remote proxy\n\nSubscriptions:\n  svpn import <url|file> [name] Import and save a profile\n  svpn profile list             List subscription profiles\n  svpn profile use <number|name> Switch profile\n\nSetup:\n  svpn config ports <base-port> Set personal HTTP port base, e.g. 4880\n  svpn test                     Test IP/GitHub/Copilot/OpenAI/ChatGPT\n\nSafety:\n  - proxy-only: no TUN, routes, DNS or /etc changes.\n  - only the current user's HOME is modified.\n  - new shells automatically load proxy state through the installed shell hook.\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  const paths = getPaths(args);
  ensureDir(paths.dataDir);
  ensureDir(paths.logsDir);

  if (command === 'help' || args.help) return printHelp();
  if (command === 'daemon') return daemon(paths, args);
  if (command === 'on') return on(paths, args);
  if (command === 'off') return off(paths, args);
  if (command === 'start') return start(paths, args);
  if (command === 'stop') return stop(paths, args);
  if (command === 'restart') return restart(paths, args);
  if (command === 'status') return status(paths, args);
  if (command === 'mode') return setMode(paths, args);
  if (command === 'nodes') return nodes(paths, args);
  if (command === 'delay') return nodes(paths, { ...args, delay: true });
  if (command === 'use') return useNode(paths, args);
  if (command === 'proxy') return proxy(paths, args);
  if (command === 'vscode') return vscode(paths, args);
  if (command === 'test') return runTest(paths, args);
  if (command === 'import') return importConfig(paths, args);
  if (command === 'profile') return profile(paths, args);
  if (command === 'config' && args._[1] === 'ports') return configurePorts(paths, args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
