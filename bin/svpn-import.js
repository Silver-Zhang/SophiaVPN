#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const DEFAULT_HTTP_PORT = 4780;
const DEFAULT_SOCKS_PORT = 4781;
const DEFAULT_CORE_PORT = 4790;
const DEFAULT_USER_AGENT = 'ClashMeta/1.19.27 SilverVPN/0.1';
const SHADOWROCKET_USER_AGENT = 'Shadowrocket/1995 CFNetwork/1408.0.4 Darwin/22.5.0';
const KNOWN_SCHEMES = new Set(['ss', 'ssr', 'vmess', 'trojan', 'vless', 'hysteria', 'hysteria2', 'hy2', 'tuic', 'snell']);
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
    args['data-dir'] || process.env.SILVERVPN_DATA_DIR || path.join(os.homedir(), '.config', 'SilverVPN'),
    'SilverVPN data directory'
  );
  return {
    dataDir,
    configDir: path.join(dataDir, 'clash-configs'),
    subscriptionsDir: path.join(dataDir, 'subscriptions'),
    subscriptionsFile: path.join(dataDir, 'clashy-configs', 'subscriptions.json'),
    settingsFile: path.join(dataDir, 'settings.json'),
    activeConfigFile: path.join(dataDir, 'clash-configs', 'config.yaml')
  };
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

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function cleanString(value) {
  return String(value || '').replace(/\u0000/g, '').trim();
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_error) {
    return String(value || '');
  }
}

function decodeBase64Text(value) {
  const compact = String(value || '').trim().replace(/\s+/g, '');
  if (!compact || compact.length % 4 === 1 || /[^A-Za-z0-9+/=_-]/.test(compact)) return null;
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    if (!decoded.trim() || decoded.includes('\uFFFD')) return null;
    return stripBom(decoded);
  } catch (_error) {
    return null;
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function isSubUrl(value) {
  return /^sub:\/\//i.test(String(value || '').trim());
}

function parseSubUrl(value) {
  const text = String(value || '').trim();
  const payload = text.slice('sub://'.length);
  const hashIndex = payload.indexOf('#');
  const encodedBody = hashIndex >= 0 ? payload.slice(0, hashIndex) : payload;
  const encodedName = hashIndex >= 0 ? payload.slice(hashIndex + 1) : '';
  const decodedUrl = decodeBase64Text(safeDecodeURIComponent(encodedBody));
  if (!decodedUrl || !isHttpUrl(decodedUrl.trim())) {
    throw new Error('Sub URL decode failed: body is not a valid HTTP/HTTPS URL.');
  }
  return { subscriptionUrl: decodedUrl.trim(), name: encodedName ? safeDecodeURIComponent(encodedName).trim() : '' };
}

function downloadUrl(url) {
  const agents = [DEFAULT_USER_AGENT, SHADOWROCKET_USER_AGENT, 'clash-verge/v1.7.7', 'Mozilla/5.0'];
  const errors = [];
  for (const userAgent of agents) {
    const result = spawnSync(
      'curl',
      ['-fsSL', '--max-time', '45', '--retry', '1', '-A', userAgent, url],
      { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, env: process.env }
    );
    if (result.status === 0 && result.stdout && result.stdout.trim()) return result.stdout;
    errors.push((result.stderr || result.stdout || `curl exited ${result.status}`).trim());
  }
  throw new Error(`Subscription download failed: ${errors.filter(Boolean).slice(-1)[0] || 'unknown error'}`);
}

function loadSource(source) {
  if (isSubUrl(source)) {
    const parsed = parseSubUrl(source);
    return { text: downloadUrl(parsed.subscriptionUrl), sourceUrl: parsed.subscriptionUrl, suggestedName: parsed.name, sourceType: 'sub-url' };
  }
  if (isHttpUrl(source)) {
    return { text: downloadUrl(source), sourceUrl: source, suggestedName: '', sourceType: 'subscription-url' };
  }
  const file = assertPathInHome(source, 'Import source file');
  return { text: fs.readFileSync(file, 'utf8'), sourceUrl: '', suggestedName: path.basename(file), sourceType: 'file' };
}

function normalizeBypassHosts(values) {
  const out = [];
  const seen = new Set();
  for (const item of values) {
    const value = cleanString(item);
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

function getDirectRules() {
  return normalizeBypassHosts(DEFAULT_BYPASS_HOSTS).map(bypassHostToDirectRule).filter(Boolean).concat(ALWAYS_DIRECT_RULES);
}

function looksLikeClashConfig(value) {
  try {
    const data = yaml.load(stripBom(value)) || {};
    return Boolean(
      (Array.isArray(data.proxies) || data['proxy-providers']) &&
        (Array.isArray(data['proxy-groups']) || data['proxy-groups'] || Array.isArray(data.rules))
    );
  } catch (_error) {
    return false;
  }
}

function parseUriQuery(queryText) {
  const params = {};
  for (const pair of String(queryText || '').split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const key = safeDecodeURIComponent(index >= 0 ? pair.slice(0, index) : pair);
    const value = index >= 0 ? pair.slice(index + 1) : '';
    if (key) params[key] = safeDecodeURIComponent(value);
  }
  return params;
}

function splitOuterUri(uri, scheme) {
  const body = String(uri || '').replace(new RegExp(`^${scheme}:\\/\\/`, 'i'), '').trim();
  const hashIndex = body.indexOf('#');
  const beforeHash = hashIndex >= 0 ? body.slice(0, hashIndex) : body;
  const fragment = hashIndex >= 0 ? body.slice(hashIndex + 1) : '';
  const queryIndex = beforeHash.indexOf('?');
  return {
    payload: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    queryText: queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '',
    fragment: safeDecodeURIComponent(fragment)
  };
}

function getUriScheme(uri) {
  const match = String(uri || '').trim().match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
  return match ? match[1].toLowerCase() : '';
}

function stripUriToken(value) {
  return String(value || '').replace(/^[<("'`]+|[>)"'`,;]+$/g, '');
}

function extractSubscriptionUris(text) {
  const uris = [];
  for (const token of stripBom(text).replace(/\r\n/g, '\n').split(/\s+/)) {
    const uri = stripUriToken(token);
    const scheme = getUriScheme(uri);
    if (KNOWN_SCHEMES.has(scheme)) uris.push(uri);
  }
  return uris;
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function removeEmptyValues(value) {
  if (Array.isArray(value)) {
    const out = value.map(removeEmptyValues).filter(item => item !== undefined);
    return out.length ? out : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = removeEmptyValues(item);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function isTruthyParam(value) {
  return ['1', 'true', 'tls', 'yes'].includes(cleanString(value).toLowerCase());
}

function splitHostList(value) {
  return cleanString(value).split(',').map(item => item.trim()).filter(Boolean);
}

function parseHostPort(value) {
  const text = cleanString(value);
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    const server = text.slice(1, end);
    const port = parsePort(text.slice(end + 2));
    return { server, port };
  }
  const index = text.lastIndexOf(':');
  if (index <= 0) throw new Error(`invalid server:port: ${value}`);
  return { server: text.slice(0, index), port: parsePort(text.slice(index + 1)) };
}

function parseUserEndpoint(payload) {
  const at = payload.lastIndexOf('@');
  if (at <= 0) throw new Error('missing userinfo@server:port');
  return { userInfo: payload.slice(0, at), ...parseHostPort(payload.slice(at + 1)) };
}

function uniqueProxyName(name, used, fallback) {
  const base = cleanString(name) || fallback;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function decodeBase64Field(value) {
  const decoded = decodeBase64Text(safeDecodeURIComponent(value));
  return decoded === null ? safeDecodeURIComponent(value) : decoded;
}

function parseSsUri(uri) {
  const outer = splitOuterUri(uri, 'ss');
  const params = parseUriQuery(outer.queryText);
  let payload = safeDecodeURIComponent(outer.payload);
  if (!payload.includes('@')) {
    const decoded = decodeBase64Text(payload);
    if (!decoded) throw new Error('invalid SS base64 payload');
    payload = decoded;
  }
  const parsed = parseUserEndpoint(payload);
  if (!parsed.port) throw new Error('invalid SS port');
  let methodPassword = parsed.userInfo;
  if (!methodPassword.includes(':')) methodPassword = decodeBase64Field(methodPassword);
  const sep = methodPassword.indexOf(':');
  if (sep <= 0) throw new Error('invalid SS cipher/password');
  const name = outer.fragment || params.remarks || params.name;
  const proxy = {
    name,
    type: 'ss',
    server: cleanString(parsed.server),
    port: parsed.port,
    cipher: cleanString(methodPassword.slice(0, sep)),
    password: methodPassword.slice(sep + 1),
    udp: true
  };
  if (params.plugin) {
    const [plugin, ...parts] = params.plugin.split(';');
    const opts = {};
    for (const item of parts) {
      const [key, value = ''] = item.split('=');
      if (key) opts[key] = value || true;
    }
    proxy.plugin = plugin;
    proxy['plugin-opts'] = opts;
  }
  return { name, proxy: removeEmptyValues(proxy) };
}

function parseTrojanUri(uri) {
  const outer = splitOuterUri(uri, 'trojan');
  const params = parseUriQuery(outer.queryText);
  const parsed = parseUserEndpoint(safeDecodeURIComponent(outer.payload));
  if (!parsed.port) throw new Error('invalid Trojan port');
  const network = cleanString(params.type || params.network).toLowerCase();
  const host = params.host || params['ws-host'];
  const proxy = {
    name: outer.fragment || params.name,
    type: 'trojan',
    server: cleanString(parsed.server),
    port: parsed.port,
    password: safeDecodeURIComponent(parsed.userInfo),
    udp: true,
    sni: params.sni || params.peer || params.servername,
    network: network && network !== 'tcp' ? network : undefined
  };
  if (network === 'ws') proxy['ws-opts'] = removeEmptyValues({ path: params.path || '/', headers: { Host: host } });
  if (network === 'grpc') proxy['grpc-opts'] = removeEmptyValues({ 'grpc-service-name': params.serviceName || params['service-name'] });
  return { name: proxy.name, proxy: removeEmptyValues(proxy) };
}

function parseVlessUri(uri) {
  const outer = splitOuterUri(uri, 'vless');
  const params = parseUriQuery(outer.queryText);
  const parsed = parseUserEndpoint(safeDecodeURIComponent(outer.payload));
  if (!parsed.port) throw new Error('invalid VLESS port');
  const network = cleanString(params.type || params.network).toLowerCase();
  const security = cleanString(params.security).toLowerCase();
  const proxy = {
    name: outer.fragment || params.name,
    type: 'vless',
    server: cleanString(parsed.server),
    port: parsed.port,
    uuid: safeDecodeURIComponent(parsed.userInfo),
    udp: true,
    tls: security === 'tls' || security === 'reality' || isTruthyParam(params.tls) ? true : undefined,
    flow: params.flow,
    servername: params.sni || params.servername,
    network: network && network !== 'tcp' ? network : undefined
  };
  if (network === 'ws') proxy['ws-opts'] = removeEmptyValues({ path: params.path || '/', headers: { Host: params.host } });
  if (network === 'grpc') proxy['grpc-opts'] = removeEmptyValues({ 'grpc-service-name': params.serviceName || params['service-name'] });
  if (security === 'reality') {
    proxy['reality-opts'] = removeEmptyValues({ 'public-key': params.pbk, 'short-id': params.sid });
  }
  return { name: proxy.name, proxy: removeEmptyValues(proxy) };
}

function parseHysteria2Uri(uri) {
  const scheme = getUriScheme(uri);
  const outer = splitOuterUri(uri, scheme);
  const params = parseUriQuery(outer.queryText);
  const parsed = parseUserEndpoint(safeDecodeURIComponent(outer.payload));
  if (!parsed.port) throw new Error('invalid Hysteria2 port');
  const proxy = {
    name: outer.fragment || params.name,
    type: 'hysteria2',
    server: cleanString(parsed.server),
    port: parsed.port,
    password: safeDecodeURIComponent(parsed.userInfo),
    sni: params.sni,
    obfs: params.obfs,
    'obfs-password': params['obfs-password'] || params.obfs_password,
    udp: true
  };
  return { name: proxy.name, proxy: removeEmptyValues(proxy) };
}

function parseTuicUri(uri) {
  const outer = splitOuterUri(uri, 'tuic');
  const params = parseUriQuery(outer.queryText);
  const parsed = parseUserEndpoint(safeDecodeURIComponent(outer.payload));
  if (!parsed.port) throw new Error('invalid TUIC port');
  const sep = parsed.userInfo.indexOf(':');
  const proxy = {
    name: outer.fragment || params.name,
    type: 'tuic',
    server: cleanString(parsed.server),
    port: parsed.port,
    uuid: sep >= 0 ? parsed.userInfo.slice(0, sep) : parsed.userInfo,
    password: sep >= 0 ? parsed.userInfo.slice(sep + 1) : params.password,
    sni: params.sni,
    alpn: splitHostList(params.alpn),
    'congestion-controller': params.congestion_control || params['congestion-controller'],
    'udp-relay-mode': params.udp_relay_mode || params['udp-relay-mode']
  };
  return { name: proxy.name, proxy: removeEmptyValues(proxy) };
}

function parseSnellUri(uri) {
  const outer = splitOuterUri(uri, 'snell');
  const params = parseUriQuery(outer.queryText);
  const parsed = parseUserEndpoint(safeDecodeURIComponent(outer.payload));
  if (!parsed.port) throw new Error('invalid Snell port');
  const proxy = {
    name: outer.fragment || params.name,
    type: 'snell',
    server: cleanString(parsed.server),
    port: parsed.port,
    psk: safeDecodeURIComponent(parsed.userInfo),
    version: Number(params.version || 3) || 3,
    'obfs-opts': removeEmptyValues({ mode: params.obfs, host: params['obfs-host'] || params.host })
  };
  return { name: proxy.name, proxy: removeEmptyValues(proxy) };
}

function parseVmessUri(uri) {
  const outer = splitOuterUri(uri, 'vmess');
  const decoded = decodeBase64Text(outer.payload);
  if (!decoded) throw new Error('invalid VMess base64 payload');
  const data = JSON.parse(decoded);
  const network = cleanString(data.net || data.network || 'tcp').toLowerCase();
  const port = parsePort(data.port);
  const server = cleanString(data.add || data.server);
  const uuid = cleanString(data.id || data.uuid);
  if (!server || !port || !uuid) throw new Error('invalid VMess required fields');
  const tlsValue = data.tls === true ? 'tls' : cleanString(data.tls).toLowerCase();
  const proxy = {
    name: data.ps || data.name || outer.fragment,
    type: 'vmess',
    server,
    port,
    uuid,
    alterId: Number(data.aid || data.alterId || 0) || 0,
    cipher: cleanString(data.scy || data.cipher || 'auto') || 'auto',
    udp: true,
    tls: tlsValue === 'tls' || tlsValue === 'true' ? true : undefined,
    servername: data.sni || data.servername,
    network: network !== 'tcp' ? network : undefined
  };
  if (network === 'ws') proxy['ws-opts'] = removeEmptyValues({ path: data.path || '/', headers: { Host: data.host } });
  if (network === 'grpc') proxy['grpc-opts'] = removeEmptyValues({ 'grpc-service-name': data.path || data.type });
  return { name: proxy.name, proxy: removeEmptyValues(proxy) };
}

function parseSsrUri(uri) {
  const outer = splitOuterUri(uri, 'ssr');
  const decoded = decodeBase64Text(outer.payload);
  if (!decoded) throw new Error('invalid SSR base64 payload');
  const queryMarker = decoded.indexOf('/?');
  const mainPart = queryMarker >= 0 ? decoded.slice(0, queryMarker) : decoded.split('?')[0];
  const queryText = queryMarker >= 0 ? decoded.slice(queryMarker + 2) : decoded.split('?').slice(1).join('?');
  const parts = mainPart.split(':');
  if (parts.length < 6) throw new Error('invalid SSR fields');
  const passwordEncoded = parts.pop();
  const obfs = parts.pop();
  const method = parts.pop();
  const protocol = parts.pop();
  const port = parsePort(parts.pop());
  const server = parts.join(':');
  const params = parseUriQuery(queryText);
  const remarks = decodeBase64Field(params.remarks);
  const proxy = {
    name: remarks,
    type: 'ssr',
    server: cleanString(server),
    port,
    cipher: cleanString(method),
    password: decodeBase64Field(passwordEncoded),
    protocol: cleanString(protocol) || 'origin',
    obfs: cleanString(obfs) || 'plain',
    'protocol-param': decodeBase64Field(params.protoparam),
    'obfs-param': decodeBase64Field(params.obfsparam),
    udp: true
  };
  return { name: remarks, proxy: removeEmptyValues(proxy) };
}

function parseUri(uri) {
  const scheme = getUriScheme(uri);
  if (scheme === 'ss') return parseSsUri(uri);
  if (scheme === 'ssr') return parseSsrUri(uri);
  if (scheme === 'vmess') return parseVmessUri(uri);
  if (scheme === 'trojan') return parseTrojanUri(uri);
  if (scheme === 'vless') return parseVlessUri(uri);
  if (scheme === 'hysteria' || scheme === 'hysteria2' || scheme === 'hy2') return parseHysteria2Uri(uri);
  if (scheme === 'tuic') return parseTuicUri(uri);
  if (scheme === 'snell') return parseSnellUri(uri);
  throw new Error(`unsupported scheme: ${scheme}`);
}

function buildConfigFromProxies(proxies) {
  const names = proxies.map(proxy => proxy.name);
  return {
    port: DEFAULT_HTTP_PORT,
    'socks-port': DEFAULT_SOCKS_PORT,
    'allow-lan': false,
    mode: 'Rule',
    'log-level': 'info',
    'external-controller': `127.0.0.1:${DEFAULT_CORE_PORT}`,
    proxies,
    'proxy-groups': [{ name: 'Proxy', type: 'select', proxies: [...names, 'DIRECT'] }],
    rules: [...ALWAYS_PROXY_RULES, ...getDirectRules(), 'MATCH,Proxy']
  };
}

function normalizeConfig(rawText, label) {
  const text = stripBom(rawText).replace(/\r\n/g, '\n');
  if (looksLikeClashConfig(text)) {
    const config = yaml.load(text) || {};
    delete config.tun;
    return { text: ensureTrailingNewline(yaml.dump(config, { lineWidth: 160 })), proxyCount: Array.isArray(config.proxies) ? config.proxies.length : 0, converted: false, decodedBase64: false };
  }

  const converted = convertUriList(text, label);
  if (converted) return converted;

  const decoded = decodeBase64Text(text);
  if (decoded) {
    if (looksLikeClashConfig(decoded)) {
      const config = yaml.load(decoded) || {};
      delete config.tun;
      return { text: ensureTrailingNewline(yaml.dump(config, { lineWidth: 160 })), proxyCount: Array.isArray(config.proxies) ? config.proxies.length : 0, converted: false, decodedBase64: true };
    }
    const convertedDecoded = convertUriList(decoded, label);
    if (convertedDecoded) return { ...convertedDecoded, decodedBase64: true };
  }

  throw new Error(`${label} content is not Clash YAML and contains no supported subscription URIs.`);
}

function convertUriList(text, label) {
  const uris = extractSubscriptionUris(text);
  if (!uris.length) return null;
  const proxies = [];
  const usedNames = new Set();
  const skipped = {};
  for (const uri of uris) {
    const scheme = getUriScheme(uri);
    try {
      const parsed = parseUri(uri);
      const proxy = parsed.proxy;
      proxy.name = uniqueProxyName(parsed.name || proxy.name, usedNames, `Proxy ${proxies.length + 1}`);
      proxies.push(proxy);
    } catch (_error) {
      skipped[scheme] = (skipped[scheme] || 0) + 1;
    }
  }
  if (!proxies.length) {
    throw new Error(`${label} URI list contains no convertible nodes; skipped ${uris.length} node(s).`);
  }
  return {
    text: yaml.dump(buildConfigFromProxies(proxies), { lineWidth: 160 }),
    proxyCount: proxies.length,
    converted: true,
    decodedBase64: false,
    skipped
  };
}

function profileId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname && parsed.pathname !== '/' ? '/...' : ''}${parsed.search ? '?...' : ''}`;
  } catch (_error) {
    return '';
  }
}

function saveProfile(paths, source, normalized, name, loaded) {
  ensureDir(paths.configDir);
  ensureDir(paths.subscriptionsDir);
  const activeConfigFile = assertPathInHome(paths.activeConfigFile, 'Active config');
  fs.writeFileSync(activeConfigFile, normalized.text);

  const id = `custom-${profileId(loaded.sourceUrl || source)}`;
  const profileFile = assertPathInHome(path.join(paths.subscriptionsDir, `${id}.yaml`), 'Subscription profile');
  fs.copyFileSync(activeConfigFile, profileFile);

  const settings = readJson(paths.settingsFile, {});
  settings.currentProfileId = id;
  settings.currentProfile = activeConfigFile;
  settings.profile = {
    sourceType: loaded.sourceType,
    name: name || loaded.suggestedName || 'Custom Subscription',
    subscriptionUrl: loaded.sourceUrl || '',
    subscriptionUrlDisplay: loaded.sourceUrl ? redactUrl(loaded.sourceUrl) : '',
    decodedBase64: Boolean(normalized.decodedBase64),
    convertedSubscription: Boolean(normalized.converted),
    proxyCount: normalized.proxyCount,
    importedAt: new Date().toISOString()
  };
  writeJson(paths.settingsFile, settings);

  const data = readJson(paths.subscriptionsFile, { subscriptions: [] });
  const subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : [];
  const record = {
    id,
    fileName: profileFile,
    name: name || loaded.suggestedName || 'Custom Subscription',
    kind: 'custom',
    sourceType: loaded.sourceType,
    url: loaded.sourceUrl || (/^https?:|^sub:/i.test(source) ? source : ''),
    urlDisplay: loaded.sourceUrl ? redactUrl(loaded.sourceUrl) : '',
    proxyCount: normalized.proxyCount,
    importedAt: settings.profile.importedAt
  };
  writeJson(paths.subscriptionsFile, { subscriptions: [...subscriptions.filter(item => item.id !== id), record] });
  return record;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args._[0];
  const name = args._.slice(1).join(' ');
  if (!source || args.help) {
    console.log('Usage: svpn import <subscription-url|sub://...|config.yaml> [profile-name]');
    console.log('Supported URI schemes: ss, ssr, vmess, trojan, vless, hysteria2/hy2, tuic, snell');
    return;
  }
  const paths = getPaths(args);
  ensureDir(paths.dataDir);
  const loaded = loadSource(source);
  const normalized = normalizeConfig(loaded.text, loaded.sourceUrl || source);
  const record = saveProfile(paths, source, normalized, name, loaded);
  const skippedText = normalized.skipped && Object.keys(normalized.skipped).length
    ? `；跳过：${Object.entries(normalized.skipped).map(([scheme, count]) => `${scheme} ${count}`).join(', ')}`
    : '';
  console.log(`订阅已导入：${record.name}（${record.proxyCount || '未知'} 节点${skippedText}）`);
  if (normalized.converted) console.log('格式：URI 列表已转换为 Clash/Mihomo YAML');
  if (normalized.decodedBase64) console.log('格式：已自动解码 base64 订阅内容');
}

main();
