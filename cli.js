'use strict';

const fs = require('fs');
const dns = require('dns');
const http = require('http');
const https = require('https');
const yaml = require('js-yaml');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { URL } = require('url');

const DEFAULT_PORT = 4788;
const DEFAULT_CORE_PORT = 4790;
const DEFAULT_HTTP_PORT = 4780;
const DEFAULT_SOCKS_PORT = 4781;
const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const CORE_START_TIMEOUT_MS = 20000;
const DEFAULT_USER_AGENT = 'ClashMeta/1.19.27 SilverVPN/0.1';
const SHADOWROCKET_USER_AGENT = 'Shadowrocket/1995 CFNetwork/1408.0.4 Darwin/22.5.0';
const ROCKET_RESPONSE_KEY = 'RocketMaker';
const DEFAULT_ROCKET_DISCOVERY_URL = 'http://127.0.0.1:4788/rocket';
const SUPPORTED_SUBSCRIPTION_SCHEMES = new Set(['ssr', 'vmess']);
const KNOWN_SUBSCRIPTION_SCHEMES = new Set([
  'ssr',
  'vmess',
  'ss',
  'trojan',
  'vless',
  'hysteria',
  'hysteria2',
  'hy2',
  'tuic',
  'snell'
]);
const MODE_ALIASES = {
  rule: 'rule',
  smart: 'rule',
  intelligent: 'rule',
  auto: 'rule',
  global: 'global',
  direct: 'direct'
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
  'DOMAIN-SUFFIX,google.com,Proxy',
  'DOMAIN-SUFFIX,googleapis.com,Proxy',
  'DOMAIN-SUFFIX,gstatic.com,Proxy',
  'DOMAIN,storage.googleapis.com,Proxy',
  'DOMAIN-SUFFIX,github.com,Proxy',
  'DOMAIN-SUFFIX,githubusercontent.com,Proxy'
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

function copyDirectory(source, target, overwrite = false) {
  if (!fs.existsSync(source)) {
    return;
  }
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(from, to, overwrite);
    } else if (entry.isFile() && (overwrite || !fs.existsSync(to))) {
      fs.copyFileSync(from, to);
    }
  }
}

function normalizeBypassHosts(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(/\r?\n/);
  const cleaned = [];
  const seen = new Set();
  for (const item of source) {
    const value = String(item || '').trim();
    if (!value || value.startsWith('#') || seen.has(value)) {
      continue;
    }
    cleaned.push(value);
    seen.add(value);
  }
  return cleaned;
}

function bypassHostToDirectRule(host) {
  if (host === 'localhost') {
    return 'DOMAIN,localhost,DIRECT';
  }
  if (host === '::1') {
    return 'IP-CIDR6,::1/128,DIRECT,no-resolve';
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(host)) {
    return `IP-CIDR,${host},DIRECT,no-resolve`;
  }
  if (/^[0-9a-f:]+\/\d{1,3}$/i.test(host)) {
    return `IP-CIDR6,${host},DIRECT,no-resolve`;
  }
  if (host.startsWith('*.')) {
    return `DOMAIN-SUFFIX,${host.slice(2)},DIRECT`;
  }
  if (host.startsWith('.')) {
    return `DOMAIN-SUFFIX,${host.slice(1)},DIRECT`;
  }
  if (/^[a-z0-9.-]+$/i.test(host)) {
    return `DOMAIN,${host},DIRECT`;
  }
  return '';
}

function getDirectRules(settings = {}) {
  return normalizeBypassHosts([
    ...normalizeBypassHosts([...DEFAULT_BYPASS_HOSTS, ...(settings.bypassHosts || [])]).map(bypassHostToDirectRule),
    ...ALWAYS_DIRECT_RULES
  ]);
}

function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function getPaths(args) {
  const dataDir =
    args['data-dir'] ||
    process.env.SILVERVPN_DATA_DIR ||
    process.env.XIONGMAO_DATA_DIR ||
    path.join(os.homedir(), '.config', 'SilverVPN');
  const resources = args.resources || path.join(__dirname, 'resources');
  return {
    dataDir,
    resources,
    configDir: path.join(dataDir, 'clash-configs'),
    runtimeDir: path.join(dataDir, 'clash-runtime'),
    logsDir: path.join(dataDir, 'logs'),
    settingsFile: path.join(dataDir, 'settings.json'),
    activeConfigFile: path.join(dataDir, 'clash-configs', 'config.yaml'),
    runtimeConfigFile: path.join(dataDir, 'clash-runtime', 'config.yaml'),
    defaultConfigFile: path.join(resources, 'clash-configs', 'config.yaml'),
    defaultMmdbFile: path.join(resources, 'clash-configs', 'Country.mmdb')
  };
}

function copyIfMissing(source, target) {
  if (!fs.existsSync(target) && fs.existsSync(source)) {
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
  }
}

function activeConfigIsPlaceholder(paths) {
  const text = readText(paths.activeConfigFile);
  return !text.trim() || text.includes('线路加载失败，请点击左侧刷新按钮');
}

function migrateLegacyData(paths) {
  if (fs.existsSync(paths.activeConfigFile) && !activeConfigIsPlaceholder(paths)) {
    return;
  }
  const candidates = [
    path.join(os.homedir(), '.config', 'silvervpn'),
    path.join(os.homedir(), '.config', 'SilverVPN'),
    path.join(os.homedir(), '.config', '熊猫上网 Linux'),
    path.join(os.homedir(), '.config', 'xiongmao-vpn-linux')
  ].filter(dir => path.resolve(dir) !== path.resolve(paths.dataDir));

  for (const source of candidates) {
    if (fs.existsSync(path.join(source, 'clash-configs', 'config.yaml'))) {
      for (const entry of ['clash-configs', 'clashy-configs', 'subscriptions']) {
        copyDirectory(path.join(source, entry), path.join(paths.dataDir, entry), true);
      }
      copyIfMissing(path.join(source, 'settings.json'), paths.settingsFile);
      return;
    }
  }
}

function initialize(paths) {
  migrateLegacyData(paths);
  ensureDir(paths.configDir);
  ensureDir(paths.runtimeDir);
  ensureDir(paths.logsDir);
  copyIfMissing(paths.defaultConfigFile, paths.activeConfigFile);
  copyIfMissing(paths.defaultMmdbFile, path.join(paths.configDir, 'Country.mmdb'));
  copyIfMissing(paths.defaultMmdbFile, path.join(paths.runtimeDir, 'Country.mmdb'));
  if (!fs.existsSync(paths.settingsFile)) {
    writeJson(paths.settingsFile, {
      currentProfile: paths.activeConfigFile,
      systemProxy: false,
      currentSelector: 'Proxy',
      currentProxy: ''
    });
  }
}

function parseScalarConfigValue(text, key, fallback) {
  const match = text.match(new RegExp(`^${key}:\\s*([^\\n#]+)`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : fallback;
}

function writeScalarConfigValue(text, key, value) {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${key}:.*$`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }
  return `${line}\n${text}`;
}

function readConfigSummary(paths) {
  const text = readText(paths.activeConfigFile);
  return {
    port: Number(parseScalarConfigValue(text, 'port', DEFAULT_HTTP_PORT)),
    'socks-port': Number(parseScalarConfigValue(text, 'socks-port', DEFAULT_SOCKS_PORT)),
    mode: parseScalarConfigValue(text, 'mode', 'Rule'),
    'external-controller': `127.0.0.1:${DEFAULT_CORE_PORT}`
  };
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function decodeBase64Text(value) {
  const compact = String(value || '').trim().replace(/\s+/g, '');
  if (!compact || compact.length % 4 === 1 || /[^A-Za-z0-9+/=_-]/.test(compact)) {
    return null;
  }

  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const decoded = Buffer.from(padded, 'base64').toString('utf8');
  if (!decoded.trim() || decoded.includes('\uFFFD')) {
    return null;
  }
  return stripBom(decoded);
}

function decodeBase64Binary(value) {
  const compact = String(value || '').trim().replace(/\s+/g, '');
  if (!compact || compact.length % 4 === 1 || /[^A-Za-z0-9+/=_-]/.test(compact)) {
    return null;
  }
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('binary');
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isSubUrl(value) {
  return /^sub:\/\//i.test(String(value || '').trim());
}

function parseSubUrl(value) {
  const text = String(value || '').trim();
  if (!isSubUrl(text)) {
    throw new Error('Sub URL decode failed: missing sub:// prefix.');
  }

  const payload = text.slice('sub://'.length);
  const hashIndex = payload.indexOf('#');
  const encodedBody = hashIndex >= 0 ? payload.slice(0, hashIndex) : payload;
  const encodedName = hashIndex >= 0 ? payload.slice(hashIndex + 1) : '';
  const decodedUrl = decodeBase64Text(safeDecodeURIComponent(encodedBody));

  if (!decodedUrl) {
    throw new Error('Sub URL decode failed: body is not valid base64/base64url.');
  }

  const subscriptionUrl = decodedUrl.trim();
  if (!isHttpUrl(subscriptionUrl)) {
    throw new Error('Sub URL decode failed: decoded value is not an HTTP/HTTPS URL.');
  }

  return {
    subscriptionUrl,
    name: encodedName ? safeDecodeURIComponent(encodedName).trim() : ''
  };
}

function collectTopLevelKeys(text) {
  const keys = new Set();
  const pattern = /^([A-Za-z][A-Za-z0-9 _-]*):(?:\s|$)/gm;
  let match;
  while ((match = pattern.exec(text))) {
    keys.add(match[1].trim());
  }
  return keys;
}

function hasAnyKey(keys, candidates) {
  return candidates.some(candidate => keys.has(candidate));
}

function looksLikeClashYaml(text) {
  const value = stripBom(text).trim();
  if (!value || value.startsWith('<')) {
    return false;
  }

  const keys = collectTopLevelKeys(value);
  const hasProxyDefinitions = hasAnyKey(keys, ['proxies', 'Proxy', 'proxy-providers']);
  const hasProxyGroups = hasAnyKey(keys, ['proxy-groups', 'Proxy Group']);
  const hasRules = hasAnyKey(keys, ['rules', 'Rule', 'rule-providers']);
  const hasPort = hasAnyKey(keys, ['port', 'mixed-port', 'socks-port', 'redir-port', 'tproxy-port']);
  const hasYamlShape = /^[-A-Za-z0-9 _]+:\s*/m.test(value);

  return (
    hasYamlShape &&
    ((hasProxyDefinitions && (hasProxyGroups || hasRules)) ||
      (hasProxyGroups && hasRules) ||
      (hasPort && (hasProxyDefinitions || hasProxyGroups || hasRules)))
  );
}

function looksLikeSubscriptionRejection(text) {
  const value = stripBom(text).trim().slice(0, 4096);
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();
  const looksLikeHtml = lower.startsWith('<!doctype html') || lower.startsWith('<html') || /<body[\s>]/i.test(value);
  const hasDenyText =
    lower.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('access denied') ||
    lower.includes('unauthorized') ||
    lower.includes('permission denied') ||
    lower.includes('cloudflare') ||
    lower.includes('cf-error') ||
    value.includes('拒绝') ||
    value.includes('禁止') ||
    value.includes('未授权');

  return (looksLikeHtml && hasDenyText) || /^(403|401)\s/.test(lower);
}

function decodeSubscriptionBase64Field(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const decoded = decodeBase64Text(safeDecodeURIComponent(raw));
  return decoded === null ? safeDecodeURIComponent(raw) : decoded;
}

function parseUriQuery(queryText) {
  const params = {};
  for (const pair of String(queryText || '').split('&')) {
    if (!pair) {
      continue;
    }
    const separatorIndex = pair.indexOf('=');
    const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
    const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
    const key = safeDecodeURIComponent(rawKey);
    if (key) {
      params[key] = safeDecodeURIComponent(rawValue);
    }
  }
  return params;
}

function cleanString(value) {
  return String(value || '').replace(/\u0000/g, '').trim();
}

function cleanOptionalString(value) {
  const text = cleanString(value);
  return text || undefined;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function removeEmptyValues(value) {
  if (Array.isArray(value)) {
    const items = value
      .map(item => removeEmptyValues(item))
      .filter(item => item !== undefined && !(Array.isArray(item) && item.length === 0));
    return items.length ? items : undefined;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, removeEmptyValues(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return value;
}

function splitHostList(value) {
  const hosts = cleanString(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return hosts.length ? hosts : undefined;
}

function isTruthyParam(value) {
  return ['1', 'true', 'tls', 'yes'].includes(cleanString(value).toLowerCase());
}

function getUriScheme(uri) {
  const match = String(uri || '').trim().match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
  return match ? match[1].toLowerCase() : '';
}

function splitOuterUriPayload(uri, scheme) {
  const body = String(uri || '')
    .replace(new RegExp(`^${scheme}:\\/\\/`, 'i'), '')
    .trim();
  const hashIndex = body.indexOf('#');
  const beforeHash = hashIndex >= 0 ? body.slice(0, hashIndex) : body;
  const fragment = hashIndex >= 0 ? body.slice(hashIndex + 1) : '';
  const queryIndex = beforeHash.indexOf('?');
  return {
    payload: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    queryText: queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '',
    fragment
  };
}

function stripUriToken(value) {
  return String(value || '').replace(/^[<("'`]+|[>)"'`,;]+$/g, '');
}

function extractSubscriptionUris(text) {
  const uris = [];
  for (const token of stripBom(text).replace(/\r\n/g, '\n').split(/\s+/)) {
    const uri = stripUriToken(token);
    const scheme = getUriScheme(uri);
    if (KNOWN_SUBSCRIPTION_SCHEMES.has(scheme)) {
      uris.push(uri);
    }
  }
  return uris;
}

function uniqueProxyName(preferredName, usedNames, fallbackName) {
  const baseName = cleanString(preferredName) || fallbackName;
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function parseSsrUri(uri) {
  const outer = splitOuterUriPayload(uri, 'ssr');
  const decoded = decodeBase64Text(outer.payload);
  if (!decoded) {
    throw new Error('invalid SSR base64 payload');
  }

  const queryMarker = decoded.indexOf('/?');
  const mainPart = queryMarker >= 0 ? decoded.slice(0, queryMarker) : decoded.split('?')[0];
  const queryText = queryMarker >= 0 ? decoded.slice(queryMarker + 2) : decoded.split('?').slice(1).join('?');
  const parts = mainPart.split(':');
  if (parts.length < 6) {
    throw new Error('invalid SSR main fields');
  }

  const passwordEncoded = parts.pop();
  const obfs = parts.pop();
  const method = parts.pop();
  const protocol = parts.pop();
  const portText = parts.pop();
  const server = parts.join(':');
  const port = parsePort(portText);
  const password = decodeSubscriptionBase64Field(passwordEncoded);

  if (!cleanString(server) || !port || !cleanString(method) || !password) {
    throw new Error('invalid SSR required fields');
  }

  const params = parseUriQuery(queryText);
  const remarks = decodeSubscriptionBase64Field(params.remarks);
  const proxy = removeEmptyValues({
    name: remarks,
    type: 'ssr',
    server: cleanString(server),
    port,
    cipher: cleanString(method),
    password,
    protocol: cleanString(protocol) || 'origin',
    obfs: cleanString(obfs) || 'plain',
    'protocol-param': decodeSubscriptionBase64Field(params.protoparam),
    'obfs-param': decodeSubscriptionBase64Field(params.obfsparam),
    udp: true
  });

  return {
    name: remarks,
    proxy
  };
}

function parseLegacyVmessPayload(decoded, outer) {
  const decodedHashIndex = decoded.indexOf('#');
  const decodedBeforeHash = decodedHashIndex >= 0 ? decoded.slice(0, decodedHashIndex) : decoded;
  const decodedFragment = decodedHashIndex >= 0 ? decoded.slice(decodedHashIndex + 1) : '';
  const decodedQueryIndex = decodedBeforeHash.indexOf('?');
  const endpoint = decodedQueryIndex >= 0 ? decodedBeforeHash.slice(0, decodedQueryIndex) : decodedBeforeHash;
  const decodedQuery = decodedQueryIndex >= 0 ? decodedBeforeHash.slice(decodedQueryIndex + 1) : '';
  const params = {
    ...parseUriQuery(decodedQuery),
    ...parseUriQuery(outer.queryText)
  };

  const atIndex = endpoint.lastIndexOf('@');
  const authSeparator = endpoint.indexOf(':');
  if (authSeparator <= 0 || atIndex <= authSeparator + 1) {
    throw new Error('invalid VMess legacy payload');
  }

  const cipher = cleanString(endpoint.slice(0, authSeparator)) || 'auto';
  const uuid = cleanString(endpoint.slice(authSeparator + 1, atIndex));
  const serverPort = endpoint.slice(atIndex + 1);
  const portSeparator = serverPort.lastIndexOf(':');
  if (portSeparator <= 0) {
    throw new Error('invalid VMess legacy server fields');
  }

  const server = cleanString(serverPort.slice(0, portSeparator)).replace(/^\[|\]$/g, '');
  const port = parsePort(serverPort.slice(portSeparator + 1));
  if (!server || !port || !uuid) {
    throw new Error('invalid VMess legacy required fields');
  }

  const obfs = cleanString(params.obfs).toLowerCase();
  const network = obfs === 'websocket' || obfs === 'ws' ? 'ws' : undefined;
  const name =
    decodeSubscriptionBase64Field(params.remarks || params.name || params.ps) ||
    safeDecodeURIComponent(outer.fragment || decodedFragment);
  const host = cleanString(params.obfsParam || params.host);
  const pathValue = cleanString(params.path);
  const proxy = {
    name,
    type: 'vmess',
    server,
    port,
    uuid,
    alterId: Number(params.alterId || params.aid || 0) || 0,
    cipher,
    udp: true,
    tls: isTruthyParam(params.tls) ? true : undefined,
    servername: cleanOptionalString(params.sni || params.servername)
  };

  if (network) {
    proxy.network = network;
    proxy['ws-opts'] = removeEmptyValues({
      path: pathValue || '/',
      headers: {
        Host: host
      }
    });
  }

  return {
    name,
    proxy: removeEmptyValues(proxy)
  };
}

function parseVmessUri(uri) {
  const outer = splitOuterUriPayload(uri, 'vmess');
  const decoded = decodeBase64Text(outer.payload);
  if (!decoded) {
    throw new Error('invalid VMess base64 payload');
  }

  let data;
  try {
    data = JSON.parse(decoded);
  } catch (error) {
    return parseLegacyVmessPayload(decoded, outer);
  }

  const network = cleanString(data.net || data.network || 'tcp').toLowerCase();
  const headerType = cleanString(data.type).toLowerCase();
  const port = parsePort(data.port);
  const server = cleanString(data.add || data.server);
  const uuid = cleanString(data.id || data.uuid);
  if (!server || !port || !uuid) {
    throw new Error('invalid VMess required fields');
  }

  const tlsValue = data.tls === true ? 'tls' : cleanString(data.tls).toLowerCase();
  const tls = tlsValue === 'tls' || tlsValue === 'true';
  const host = cleanString(data.host);
  const pathValue = cleanString(data.path);
  const proxyNetwork = network === 'tcp' && headerType === 'http' ? 'http' : network;
  const outerParams = parseUriQuery(outer.queryText);
  const outerName =
    decodeSubscriptionBase64Field(outerParams.remarks || outerParams.name || outerParams.ps) ||
    safeDecodeURIComponent(outer.fragment);
  const proxy = {
    name: cleanString(data.ps || data.name || outerName),
    type: 'vmess',
    server,
    port,
    uuid,
    alterId: Number(data.aid || data.alterId || 0) || 0,
    cipher: cleanString(data.scy || data.cipher || 'auto') || 'auto',
    udp: true,
    tls: tls ? true : undefined,
    servername: cleanOptionalString(data.sni || data.servername)
  };

  if (proxyNetwork && proxyNetwork !== 'tcp') {
    proxy.network = proxyNetwork;
  }

  if (proxyNetwork === 'ws') {
    proxy['ws-opts'] = removeEmptyValues({
      path: pathValue || '/',
      headers: {
        Host: host
      }
    });
  } else if (proxyNetwork === 'h2') {
    proxy['h2-opts'] = removeEmptyValues({
      path: pathValue || '/',
      host: splitHostList(host)
    });
  } else if (proxyNetwork === 'grpc') {
    proxy['grpc-opts'] = removeEmptyValues({
      'grpc-service-name': pathValue || headerType
    });
  } else if (proxyNetwork === 'http') {
    proxy['http-opts'] = removeEmptyValues({
      path: pathValue ? [pathValue] : undefined,
      headers: {
        Host: splitHostList(host)
      }
    });
  }

  return {
    name: proxy.name,
    proxy: removeEmptyValues(proxy)
  };
}

function yamlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(String(key));
}

function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function isYamlCollection(value) {
  return value && typeof value === 'object';
}

function filteredYamlEntries(value) {
  return Object.entries(value).filter(([, item]) => item !== undefined);
}

function appendYamlValue(lines, value, indent) {
  const prefix = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix}[]`);
      return;
    }
    for (const item of value) {
      if (Array.isArray(item)) {
        lines.push(`${prefix}-`);
        appendYamlValue(lines, item, indent + 2);
      } else if (item && typeof item === 'object') {
        const entries = filteredYamlEntries(item);
        if (entries.length === 0) {
          lines.push(`${prefix}- {}`);
          continue;
        }
        const [firstKey, firstValue] = entries[0];
        if (isYamlCollection(firstValue)) {
          lines.push(`${prefix}- ${yamlKey(firstKey)}:`);
          appendYamlValue(lines, firstValue, indent + 4);
        } else {
          lines.push(`${prefix}- ${yamlKey(firstKey)}: ${yamlScalar(firstValue)}`);
        }
        for (const [key, itemValue] of entries.slice(1)) {
          if (isYamlCollection(itemValue)) {
            lines.push(`${prefix}  ${yamlKey(key)}:`);
            appendYamlValue(lines, itemValue, indent + 4);
          } else {
            lines.push(`${prefix}  ${yamlKey(key)}: ${yamlScalar(itemValue)}`);
          }
        }
      } else {
        lines.push(`${prefix}- ${yamlScalar(item)}`);
      }
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of filteredYamlEntries(value)) {
      if (isYamlCollection(item)) {
        lines.push(`${prefix}${yamlKey(key)}:`);
        appendYamlValue(lines, item, indent + 2);
      } else {
        lines.push(`${prefix}${yamlKey(key)}: ${yamlScalar(item)}`);
      }
    }
    return;
  }

  lines.push(`${prefix}${yamlScalar(value)}`);
}

function stringifyYaml(value) {
  const lines = [];
  appendYamlValue(lines, value, 0);
  return `${lines.join('\n')}\n`;
}

function buildClashYamlFromProxies(proxies, settings = {}) {
  const names = proxies.map(proxy => proxy.name);
  return stringifyYaml({
    port: DEFAULT_HTTP_PORT,
    'socks-port': DEFAULT_SOCKS_PORT,
    'allow-lan': false,
    mode: 'Rule',
    'log-level': 'info',
    'external-controller': `127.0.0.1:${DEFAULT_CORE_PORT}`,
    proxies,
    'proxy-groups': [
      {
        name: 'Proxy',
        type: 'select',
        proxies: [...names, 'DIRECT']
      }
    ],
    rules: [...getDirectRules(settings), 'MATCH,Proxy']
  });
}

function convertSubscriptionUriList(text, label) {
  const uris = extractSubscriptionUris(text);
  if (uris.length === 0) {
    return null;
  }

  const proxies = [];
  const usedNames = new Set();
  const skippedSchemes = {};
  let skippedProxyCount = 0;

  for (const uri of uris) {
    const scheme = getUriScheme(uri);
    if (!SUPPORTED_SUBSCRIPTION_SCHEMES.has(scheme)) {
      skippedSchemes[scheme] = (skippedSchemes[scheme] || 0) + 1;
      skippedProxyCount += 1;
      continue;
    }

    try {
      const parsed = scheme === 'ssr' ? parseSsrUri(uri) : parseVmessUri(uri);
      const proxy = parsed.proxy;
      proxy.name = uniqueProxyName(parsed.name || proxy.name, usedNames, `Proxy ${proxies.length + 1}`);
      proxies.push(proxy);
    } catch (error) {
      skippedSchemes[scheme] = (skippedSchemes[scheme] || 0) + 1;
      skippedProxyCount += 1;
    }
  }

  if (proxies.length === 0) {
    throw new Error(
      `${label} URI list contains no supported nodes. Supported schemes: ${[...SUPPORTED_SUBSCRIPTION_SCHEMES].join(
        ', '
      )}; skipped ${skippedProxyCount} node(s).`
    );
  }

  return {
    text: buildClashYamlFromProxies(proxies),
    convertedSubscription: true,
    proxyCount: proxies.length,
    skippedProxyCount,
    skippedProxySchemes: Object.keys(skippedSchemes).length ? skippedSchemes : undefined
  };
}

function normalizeConfigPayload(rawText, label) {
  const text = stripBom(rawText).replace(/\r\n/g, '\n');
  if (looksLikeClashYaml(text)) {
    return { text: ensureTrailingNewline(text), decodedBase64: false };
  }

  const converted = convertSubscriptionUriList(text, label);
  if (converted) {
    return {
      ...converted,
      decodedBase64: false
    };
  }

  const decoded = decodeBase64Text(text);
  if (decoded && looksLikeClashYaml(decoded)) {
    return {
      text: ensureTrailingNewline(stripBom(decoded).replace(/\r\n/g, '\n')),
      decodedBase64: true
    };
  }

  if (decoded) {
    const convertedDecoded = convertSubscriptionUriList(decoded, label);
    if (convertedDecoded) {
      return {
        ...convertedDecoded,
        decodedBase64: true
      };
    }
  }

  throw new Error(`${label} content does not look like Clash YAML.`);
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    const hasPath = parsed.pathname && parsed.pathname !== '/';
    const hasSearch = Boolean(parsed.search);
    return `${parsed.protocol}//${parsed.host}${hasPath ? '/...' : ''}${hasSearch ? '?...' : ''}`;
  } catch (error) {
    return '[invalid url]';
  }
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) {
    return '';
  }
  if (!isHttpUrl(text)) {
    throw new Error(`API base URL must be HTTP/HTTPS: ${text}`);
  }
  return text;
}

function rc4Transform(input, key = ROCKET_RESPONSE_KEY) {
  const state = [];
  const keyBytes = [];
  let output = '';
  for (let index = 0; index < 256; index += 1) {
    keyBytes[index] = key.charCodeAt(index % key.length);
    state[index] = index;
  }

  let cursor = 0;
  for (let index = 0; index < 256; index += 1) {
    cursor = (cursor + state[index] + keyBytes[index]) % 256;
    const current = state[index];
    state[index] = state[cursor];
    state[cursor] = current;
  }

  let i = 0;
  let j = 0;
  for (let index = 0; index < input.length; index += 1) {
    i = (i + 1) % 256;
    j = (j + state[i]) % 256;
    const current = state[i];
    state[i] = state[j];
    state[j] = current;
    const streamByte = state[(state[i] + state[j]) % 256];
    output += String.fromCharCode(input.charCodeAt(index) ^ streamByte);
  }
  return output;
}

function decodeRocketApiResponse(rawText) {
  const text = stripBom(String(rawText || '')).trim();
  if (!text) {
    throw new Error('API returned an empty response.');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    // The macOS client expects base64 text encrypted with the RocketMaker RC4-like stream.
  }

  const encrypted = decodeBase64Binary(text);
  if (!encrypted) {
    throw new Error('API response was neither JSON nor RocketMaker encoded JSON.');
  }
  try {
    return JSON.parse(rc4Transform(encrypted, ROCKET_RESPONSE_KEY));
  } catch (error) {
    throw new Error('API response could not be decoded with RocketMaker.');
  }
}

function mergeCookies(existingCookieHeader, setCookieHeaders) {
  const cookieMap = new Map();
  for (const pair of String(existingCookieHeader || '').split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator > 0) {
      cookieMap.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  }

  for (const header of setCookieHeaders || []) {
    const cookie = String(header || '').split(';')[0].trim();
    const separator = cookie.indexOf('=');
    if (separator > 0) {
      cookieMap.set(cookie.slice(0, separator), cookie.slice(separator + 1));
    }
  }

  return [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function requestText(method, sourceUrl, options = {}) {
  const parsed = new URL(sourceUrl);
  const client = parsed.protocol === 'https:' ? https : http;
  const body = options.body ? JSON.stringify(options.body) : null;
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    ...(body
      ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Encoding': 'gzip',
          'Content-Length': Buffer.byteLength(body)
        }
      : {}),
    ...(options.cookie ? { Cookie: options.cookie } : {})
  };

  return new Promise((resolve, reject) => {
    const request = client.request(
      parsed,
      {
        method,
        headers,
        timeout: Number(options.timeoutMs || 15000)
      },
      response => {
        const chunks = [];
        let totalBytes = 0;
        response.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > IMPORT_MAX_BYTES) {
            request.destroy(new Error(`response is larger than ${IMPORT_MAX_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(`HTTP ${response.statusCode}`);
            error.statusCode = response.statusCode;
            error.body = text;
            reject(error);
            return;
          }
          resolve({
            text,
            headers: response.headers,
            statusCode: response.statusCode
          });
        });
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function requestRocketApi(apiBase, pathname, options = {}) {
  const url = `${normalizeBaseUrl(apiBase)}${pathname}`;
  const response = await requestText(options.method || 'GET', url, options);
  const decoded = decodeRocketApiResponse(response.text);
  const cookie = mergeCookies(options.cookie || '', response.headers['set-cookie']);
  if (decoded.code !== 200) {
    const error = new Error(decoded.info || `API returned code ${decoded.code}`);
    error.code = decoded.code;
    error.data = decoded;
    throw error;
  }
  return {
    decoded,
    cookie
  };
}

async function discoverApiBase(settings, args) {
  const explicit = args.base || process.env.XIONGMAO_API_BASE || (settings.auth && settings.auth.apiBase);
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }

  try {
    const response = await requestText('GET', DEFAULT_ROCKET_DISCOVERY_URL, { timeoutMs: 3000 });
    const value = JSON.parse(response.text);
    const discovered = value.init || value.ERR || value.err || value.baseURL || value.baseUrl;
    if (discovered) {
      return normalizeBaseUrl(discovered);
    }
  } catch (error) {
    // Fall through to a clear user-facing error.
  }

  throw new Error('API base URL is required. Pass --base https://... or set XIONGMAO_API_BASE.');
}

function downloadTextOnce(sourceUrl, redirects = 0, userAgent = DEFAULT_USER_AGENT, cookie = '', network = {}) {
  if (redirects > 5) {
    return Promise.reject(new Error('too many redirects'));
  }

  const parsed = new URL(sourceUrl);
  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    let connectTimer = null;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(overallTimer);
      callback(value);
    };
    const request = client.get(
      parsed,
      {
        headers: {
          'User-Agent': userAgent,
          ...(cookie ? { Cookie: cookie } : {})
        },
        ...(network.address && parsed.hostname === network.hostname
          ? {
              lookup: (_hostname, _options, callback) =>
                callback(null, network.address, network.family || 4)
            }
          : {})
      },
      response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new Error('redirect without location'));
            return;
          }
          downloadTextOnce(new URL(location, sourceUrl).toString(), redirects + 1, userAgent, cookie)
            .then(value => finish(resolve, value))
            .catch(error => finish(reject, error));
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          const error = new Error(`HTTP ${response.statusCode}`);
          error.statusCode = response.statusCode;
          finish(reject, error);
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        response.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > IMPORT_MAX_BYTES) {
            request.destroy(new Error(`response is larger than ${IMPORT_MAX_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          finish(resolve, Buffer.concat(chunks).toString('utf8'));
        });
      }
    );
    const overallTimer = setTimeout(() => {
      request.destroy(new Error('request timed out after 60 seconds'));
    }, 60000);
    request.on('socket', socket => {
      if (!socket.connecting) {
        return;
      }
      connectTimer = setTimeout(() => {
        request.destroy(new Error(`connection timed out for ${network.address || parsed.hostname}`));
      }, 12000);
      const connectedEvent = parsed.protocol === 'https:' ? 'secureConnect' : 'connect';
      socket.once(connectedEvent, () => {
        clearTimeout(connectTimer);
        connectTimer = null;
      });
    });
    request.setTimeout(30000, () => {
      request.destroy(new Error('subscription response stalled for 30 seconds'));
    });
    request.on('error', error => finish(reject, error));
  });
}

async function downloadText(sourceUrl, options = {}) {
  const cookie = options.cookie || '';
  const parsed = new URL(sourceUrl);
  let addresses = [];
  try {
    addresses = await dns.promises.lookup(parsed.hostname, { all: true });
  } catch (error) {
    // Let the normal request surface the DNS error with its original context.
  }
  const attempts = addresses.length
    ? addresses.map(item => ({
        hostname: parsed.hostname,
        address: item.address,
        family: item.family
      }))
    : [{}];
  let lastError = null;

  for (const network of attempts) {
    try {
      const text = await downloadTextOnce(sourceUrl, 0, DEFAULT_USER_AGENT, cookie, network);
      if (!looksLikeSubscriptionRejection(text)) {
        return text;
      }
      lastError = new Error('subscription server returned an access denial page');
    } catch (error) {
      lastError = error;
      if (error.statusCode === 401 || error.statusCode === 403) {
        break;
      }
    }
  }

  const fallbackText = await downloadTextOnce(sourceUrl, 0, SHADOWROCKET_USER_AGENT, cookie).catch(error => {
    throw lastError || error;
  });
  if (looksLikeSubscriptionRejection(fallbackText)) {
    throw new Error('subscription server returned an access denial page');
  }
  return fallbackText;
}

async function loadSubscription(subscriptionUrl, options = {}) {
  let rawText;
  try {
    rawText = await downloadText(subscriptionUrl, options);
  } catch (error) {
    throw new Error(`Subscription download failed: ${error.message}`);
  }
  return normalizeConfigPayload(rawText, 'Subscription');
}

function payloadMetadata(payload) {
  return compactObject({
    decodedBase64: payload.decodedBase64 ? true : false,
    convertedSubscription: payload.convertedSubscription ? true : undefined,
    proxyCount: Number.isInteger(payload.proxyCount) ? payload.proxyCount : undefined,
    skippedProxyCount: Number.isInteger(payload.skippedProxyCount) ? payload.skippedProxyCount : undefined,
    skippedProxySchemes: payload.skippedProxySchemes
  });
}

async function resolveImport(paths, source) {
  if (!source) {
    throw new Error('Usage: node cli.js import /path/to/config.yaml|/path/to/sub.url|sub://...|https://...');
  }

  const input = String(source).trim();
  if (isSubUrl(input)) {
    const sub = parseSubUrl(input);
    const payload = await loadSubscription(sub.subscriptionUrl);
    return {
      configText: payload.text,
      metadata: {
        sourceType: 'sub-url',
        name: sub.name || undefined,
        subscriptionUrl: sub.subscriptionUrl,
        subscriptionUrlDisplay: redactUrl(sub.subscriptionUrl),
        ...payloadMetadata(payload)
      }
    };
  }

  if (isHttpUrl(input)) {
    const payload = await loadSubscription(input);
    return {
      configText: payload.text,
      metadata: {
        sourceType: 'subscription-url',
        subscriptionUrl: input,
        subscriptionUrlDisplay: redactUrl(input),
        ...payloadMetadata(payload)
      }
    };
  }

  const filePath = path.resolve(source);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${source}`);
  }

  const fileText = readText(filePath);
  if (isSubUrl(fileText)) {
    const sub = parseSubUrl(fileText);
    const payload = await loadSubscription(sub.subscriptionUrl);
    return {
      configText: payload.text,
      metadata: {
        sourceType: 'subscription-file',
        sourcePath: filePath,
        name: sub.name || path.basename(filePath),
        subscriptionUrl: sub.subscriptionUrl,
        subscriptionUrlDisplay: redactUrl(sub.subscriptionUrl),
        ...payloadMetadata(payload)
      }
    };
  }

  const payload = normalizeConfigPayload(fileText, 'Config file');
  return {
    configText: payload.text,
    metadata: {
      sourceType: 'file',
      sourcePath: filePath,
      name: path.basename(filePath),
      ...payloadMetadata(payload)
    }
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function buildProfileStatus(settings) {
  const profile = settings.profile || {};
  if (!profile.sourceType && !settings.currentProfile) {
    return null;
  }
  return compactObject({
    sourceType: profile.sourceType || 'file',
    name: profile.name || null,
    sourcePath: profile.sourcePath || null,
    subscriptionUrl: profile.subscriptionUrlDisplay || (profile.subscriptionUrl ? redactUrl(profile.subscriptionUrl) : null),
    decodedBase64: profile.decodedBase64 ? true : null,
    convertedSubscription: profile.convertedSubscription ? true : null,
    proxyCount: Number.isInteger(profile.proxyCount) ? profile.proxyCount : null,
    skippedProxyCount: Number.isInteger(profile.skippedProxyCount) ? profile.skippedProxyCount : null,
    skippedProxySchemes: profile.skippedProxySchemes || null,
    importedAt: profile.importedAt || null
  });
}

function buildAuthStatus(settings) {
  const auth = settings.auth || {};
  if (!auth.apiBase && !auth.username && !auth.loggedInAt) {
    return null;
  }
  return compactObject({
    apiBase: auth.apiBase ? redactUrl(auth.apiBase) : null,
    username: auth.username || null,
    loggedInAt: auth.loggedInAt || null,
    userInfoUpdatedAt: auth.userInfoUpdatedAt || null,
    hasCookie: Boolean(auth.cookie)
  });
}

function extractProxyNames(configText) {
  const proxySection =
    configText.match(/(?:^|\n)(?:Proxy|proxies):\s*\n([\s\S]*?)(?:\n(?:Proxy Group|proxy-groups|Rule|rules):|\n[A-Za-z_-]+:\s*\n|$)/);
  const source = proxySection ? proxySection[1] : configText;
  const names = new Set();
  const pattern = /-\s*(?:\{\s*)?["']?name["']?\s*:\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^,\n}]+))/g;

  let match;
  while ((match = pattern.exec(source))) {
    let name = (match[1] || match[2] || match[3] || '').trim();
    if (match[1]) {
      try {
        name = JSON.parse(`"${match[1]}"`);
      } catch (error) {
        name = match[1];
      }
    }
    if (name && !name.includes('type:')) {
      names.add(name);
    }
  }
  return [...names];
}

function getFallbackProxies(paths) {
  const settings = readJson(paths.settingsFile, {});
  const names = extractProxyNames(readText(paths.activeConfigFile));
  const first = settings.currentProxy || names[0] || '';
  return {
    proxies: {
      Proxy: {
        type: 'Selector',
        all: names,
        now: first
      },
      GLOBAL: {
        type: 'Selector',
        all: names,
        now: first
      },
      DIRECT: {
        type: 'Direct',
        all: [],
        now: ''
      },
      REJECT: {
        type: 'Reject',
        all: [],
        now: ''
      }
    }
  };
}

function patchConfigForRuntime(sourceText, corePort) {
  let text = sourceText.replace(/^mixed-port:.*(?:\r?\n|$)/m, '');
  const replacements = {
    port: DEFAULT_HTTP_PORT,
    'socks-port': DEFAULT_SOCKS_PORT,
    'external-controller': `127.0.0.1:${corePort}`,
    secret: '""'
  };

  for (const [key, value] of Object.entries(replacements)) {
    const line = `${key}: ${value}`;
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, line) : `${line}\n${text}`;
  }
  return ensureDirectRules(text);
}

function ensureDirectRules(sourceText, settings = {}) {
  let proxyTarget = 'Proxy';
  try {
    const document = yaml.load(sourceText);
    const groups =
      document && Array.isArray(document['proxy-groups'])
        ? document['proxy-groups']
        : document && Array.isArray(document['Proxy Group'])
          ? document['Proxy Group']
          : [];
    const selectable = groups.filter(group => {
      const type = String((group && group.type) || '').toLowerCase();
      return group && group.name && ['select', 'url-test', 'fallback', 'load-balance'].includes(type);
    });
    const preferred = selectable.find(group => group.name === 'Proxy') || selectable[0];
    if (preferred) {
      proxyTarget = String(preferred.name);
    }
  } catch (error) {
    // Leave YAML validation to mihomo and retain the compatibility default.
  }
  const lines = sourceText.split(/\r?\n/);
  const rulesIndex = lines.findIndex(line => /^rules:\s*$/.test(line));
  const proxyRules = ALWAYS_PROXY_RULES.map(rule => rule.replace(/,Proxy$/, `,${proxyTarget}`));
  const routingRules = [...proxyRules, ...getDirectRules(settings)];

  if (rulesIndex === -1) {
    const rules = [...routingRules, `MATCH,${proxyTarget}`].map(rule => `  - ${rule}`);
    return `${sourceText.replace(/\s*$/, '')}\nrules:\n${rules.join('\n')}\n`;
  }

  let endIndex = rulesIndex + 1;
  while (endIndex < lines.length && !/^[^\s#][^:]*:\s*/.test(lines[endIndex])) {
    endIndex += 1;
  }

  const existingRules = new Set(
    lines
      .slice(rulesIndex + 1, endIndex)
      .map(line => line.trim().replace(/^-\s*/, '').replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  );
  const ruleIndent =
    lines
      .slice(rulesIndex + 1, endIndex)
      .map(line => line.match(/^(\s*)-\s/))
      .find(Boolean)?.[1] ?? '  ';
  const missingRules = routingRules.filter(rule => !existingRules.has(rule));
  lines.splice(rulesIndex + 1, 0, ...missingRules.map(rule => `${ruleIndent}- ${rule}`));
  return lines.join('\n');
}

function prepareRuntimeConfig(paths, corePort) {
  const settings = readJson(paths.settingsFile, {});
  const text = ensureDirectRules(patchConfigForRuntime(readText(paths.activeConfigFile), corePort), settings);
  ensureDir(paths.runtimeDir);
  fs.writeFileSync(paths.runtimeConfigFile, text);
  copyIfMissing(path.join(paths.configDir, 'Country.mmdb'), path.join(paths.runtimeDir, 'Country.mmdb'));
}

function executableExists(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function findInPath(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function findCore(paths) {
  if (process.env.CLASH_CORE && executableExists(process.env.CLASH_CORE)) {
    return process.env.CLASH_CORE;
  }

  const archMap = { x64: 'amd64', arm64: 'arm64', arm: 'armv7' };
  const arch = archMap[process.arch] || process.arch;
  const candidates = [
    `mihomo-linux-${arch}`,
    `clash-meta-linux-${arch}`,
    `clash-linux-${arch}`,
    'mihomo',
    'clash'
  ].map(name => path.join(paths.resources, 'clash-binaries', name));

  for (const candidate of candidates) {
    if (executableExists(candidate)) {
      return candidate;
    }
  }
  for (const command of ['mihomo', 'clash-meta', 'clash']) {
    const found = findInPath(command);
    if (found) {
      return found;
    }
  }
  return '';
}

function appendLog(paths, line) {
  ensureDir(paths.logsDir);
  fs.appendFileSync(path.join(paths.logsDir, 'cli.log'), line);
}

function requestCore(corePort, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : null;
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: corePort,
        path: pathname,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
        }
      },
      response => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          raw += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 400) {
            reject(new Error(`core returned HTTP ${response.statusCode}`));
            return;
          }
          resolve(raw ? JSON.parse(raw) : null);
        });
      }
    );
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function normalizeProxyMode(value) {
  const mode = MODE_ALIASES[String(value || '').trim().toLowerCase()];
  if (!mode) {
    throw new Error('Usage: node cli.js mode rule|global|direct [--core-port 4790] [--data-dir DIR]');
  }
  return mode;
}

function setSavedMode(paths, mode) {
  const currentText = readText(paths.activeConfigFile);
  const nextText = ensureTrailingNewline(writeScalarConfigValue(currentText, 'mode', mode));
  fs.writeFileSync(paths.activeConfigFile, nextText);

  const settings = readJson(paths.settingsFile, {});
  settings.mode = mode;
  writeJson(paths.settingsFile, settings);
}

async function setMode(paths, args) {
  const mode = normalizeProxyMode(args._[1]);
  const corePort = Number(args['core-port'] || DEFAULT_CORE_PORT);
  setSavedMode(paths, mode);

  let applied = false;
  let applyError = null;
  if (!args['no-apply']) {
    try {
      await requestCore(corePort, '/configs', {
        method: 'PATCH',
        body: { mode }
      });
      applied = true;
    } catch (error) {
      applyError = error.message || String(error);
    }
  }

  console.log(
    JSON.stringify(
      compactObject({
        ok: true,
        mode,
        saved: true,
        applied,
        corePort,
        applyError
      }),
      null,
      2
    )
  );
}

async function waitForCore(corePort, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await requestCore(corePort, '/configs');
      return true;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  return false;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(JSON.stringify(value));
}

function sendText(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(value);
}

function proxyToCore(request, response, corePort, paths) {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: corePort,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        host: `127.0.0.1:${corePort}`
      }
    },
    upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        ...upstreamResponse.headers,
        'Access-Control-Allow-Origin': '*'
      });
      upstreamResponse.pipe(response);
    }
  );

  upstream.on('error', () => {
    if (request.method === 'GET' && request.url.startsWith('/configs')) {
      sendJson(response, 200, readConfigSummary(paths));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/proxies')) {
      sendJson(response, 200, getFallbackProxies(paths));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/traffic')) {
      sendText(response, 200, JSON.stringify({ up: 0, down: 0 }));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/logs')) {
      sendText(response, 200, readText(path.join(paths.logsDir, 'cli.log')));
      return;
    }
    sendJson(response, 503, { ok: false, error: 'Clash core is not running.' });
  });

  request.pipe(upstream);
}

async function startServer(paths, args) {
  const port = Number(args.port || DEFAULT_PORT);
  const corePort = Number(args['core-port'] || DEFAULT_CORE_PORT);
  const demo = Boolean(args.demo);
  let child = null;
  let coreReady = false;
  const core = findCore(paths);

  if (core && !demo) {
    prepareRuntimeConfig(paths, corePort);
    child = spawn(core, ['-d', paths.runtimeDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => appendLog(paths, chunk.toString()));
    child.stderr.on('data', chunk => appendLog(paths, chunk.toString()));
    child.on('exit', (code, signal) => {
      appendLog(paths, `[${new Date().toISOString()}] core exited code=${code} signal=${signal}\n`);
      child = null;
    });
    coreReady = await waitForCore(corePort, CORE_START_TIMEOUT_MS);
  }

  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      sendText(response, 204, '');
      return;
    }
    if (request.url === '/health') {
      sendJson(response, 200, {
        ok: true,
        mode: coreReady ? 'core' : 'demo',
        core: core || null,
        config: paths.activeConfigFile,
        dataDir: paths.dataDir
      });
      return;
    }
    proxyToCore(request, response, corePort, paths);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  console.log(`SilverVPN service listening on http://127.0.0.1:${port}`);
  console.log(`mode=${coreReady ? 'core' : 'demo'} config=${paths.activeConfigFile}`);

  const stop = () => {
    server.close();
    if (child) {
      child.kill('SIGTERM');
    }
  };
  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
}

function printStatus(paths) {
  const summary = readConfigSummary(paths);
  const proxies = getFallbackProxies(paths);
  const settings = readJson(paths.settingsFile, {});
  const profile = buildProfileStatus(settings);
  const auth = buildAuthStatus(settings);
  console.log(
    JSON.stringify(
      {
        dataDir: paths.dataDir,
        config: paths.activeConfigFile,
        configExists: fs.existsSync(paths.activeConfigFile),
        httpPort: summary.port,
        socksPort: summary['socks-port'],
        mode: summary.mode,
        proxyCount: proxies.proxies.Proxy.all.length,
        currentProxy: settings.currentProxy || proxies.proxies.Proxy.now || null,
        ...(profile ? { profile } : {}),
        ...(auth ? { auth } : {}),
        core: findCore(paths) || null
      },
      null,
      2
    )
  );
}

function printDoctor(paths) {
  const core = findCore(paths);
  const checks = [
    ['node', process.version],
    ['platform', `${process.platform}/${process.arch}`],
    ['dataDir', paths.dataDir],
    ['configExists', fs.existsSync(paths.activeConfigFile)],
    ['core', core || 'missing'],
    ['gsettings', findInPath('gsettings') || 'missing']
  ];
  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
  if (!core) {
    console.log('hint: set CLASH_CORE=/absolute/path/to/mihomo or place mihomo-linux-amd64 in resources/clash-binaries/');
  }
}

function saveImportedConfig(paths, imported) {
  ensureDir(path.dirname(paths.activeConfigFile));
  fs.writeFileSync(paths.activeConfigFile, imported.configText);
  const settings = readJson(paths.settingsFile, {});
  settings.currentProfile = paths.activeConfigFile;
  settings.profile = compactObject({
    ...imported.metadata,
    importedAt: new Date().toISOString()
  });
  writeJson(paths.settingsFile, settings);
  return settings;
}

async function importConfig(paths, source) {
  const imported = await resolveImport(paths, source);
  saveImportedConfig(paths, imported);
  const sourceLabel =
    imported.metadata.name ||
    imported.metadata.sourcePath ||
    imported.metadata.subscriptionUrlDisplay ||
    imported.metadata.sourceType;
  console.log(`Imported ${sourceLabel} -> ${paths.activeConfigFile}`);
}

function getCredentialArg(args, key, envName) {
  const value = args[key] || process.env[envName] || '';
  return String(value || '').trim();
}

function sanitizeUserInfo(data) {
  const value = data || {};
  return compactObject({
    username: value.username || null,
    balance: value.balance || null,
    traffic: value.traffic || null,
    level: value.class || value.level || null,
    levelExpire: value.class_expire || value.level_expire || null,
    trueName: value.true_name || null,
    defaultProxy: value.defaultProxy || null,
    hasPcSub: Boolean(value.pc_sub)
  });
}

function updateAuthSettings(paths, update) {
  const settings = readJson(paths.settingsFile, {});
  settings.auth = compactObject({
    ...(settings.auth || {}),
    ...update
  });
  writeJson(paths.settingsFile, settings);
  return settings;
}

async function importAccountSubscription(paths, pcSub, metadata) {
  if (!pcSub || !isHttpUrl(pcSub)) {
    return null;
  }
  const payload = await loadSubscription(pcSub, { cookie: metadata.cookie || '' });
  const detectedProxyCount = Number.isInteger(payload.proxyCount)
    ? payload.proxyCount
    : extractProxyNames(payload.text).length;
  const imported = {
    configText: payload.text,
    metadata: {
      sourceType: 'account-subscription',
      name: metadata.name || metadata.username || 'account subscription',
      subscriptionUrl: pcSub,
      subscriptionUrlDisplay: redactUrl(pcSub),
      username: metadata.username || undefined,
      ...payloadMetadata(payload),
      proxyCount: detectedProxyCount
    }
  };
  saveImportedConfig(paths, imported);
  return imported;
}

async function loginAccount(paths, args) {
  const username = getCredentialArg(args, 'username', 'XIONGMAO_USERNAME');
  const password = getCredentialArg(args, 'password', 'XIONGMAO_PASSWORD');
  if (!username || !password) {
    throw new Error('Usage: node cli.js login --base https://... --username USER --password PASS');
  }

  const settings = readJson(paths.settingsFile, {});
  const apiBase = await discoverApiBase(settings, args);
  const { decoded, cookie } = await requestRocketApi(apiBase, '/v1/login', {
    method: 'POST',
    body: {
      username,
      password,
      _t: Math.floor(Date.now() / 1000)
    }
  });

  const user = sanitizeUserInfo(decoded.data || {});
  updateAuthSettings(paths, {
    apiBase,
    username,
    cookie,
    user,
    loggedInAt: new Date().toISOString()
  });

  let imported = null;
  if (decoded.data && decoded.data.pc_sub && !args['no-import']) {
    imported = await importAccountSubscription(paths, decoded.data.pc_sub, {
      name: 'account subscription',
      username,
      cookie
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBase: redactUrl(apiBase),
        username,
        user,
        imported: imported
          ? {
              proxyCount: imported.metadata.proxyCount || null,
              convertedSubscription: Boolean(imported.metadata.convertedSubscription),
              skippedProxyCount: imported.metadata.skippedProxyCount || 0
            }
          : null
      },
      null,
      2
    )
  );
}

async function refreshUser(paths, args) {
  const settings = readJson(paths.settingsFile, {});
  const auth = settings.auth || {};
  const apiBase = await discoverApiBase(settings, args);
  const cookie = auth.cookie || '';
  if (!cookie) {
    throw new Error('No saved login cookie. Run node cli.js login first.');
  }

  const { decoded, cookie: refreshedCookie } = await requestRocketApi(apiBase, '/v1/userinfo', {
    method: 'GET',
    cookie
  });
  const user = sanitizeUserInfo(decoded.data || {});
  updateAuthSettings(paths, {
    apiBase,
    cookie: refreshedCookie || cookie,
    user,
    userInfoUpdatedAt: new Date().toISOString()
  });

  let imported = null;
  if (decoded.data && decoded.data.pc_sub && !args['no-import']) {
    imported = await importAccountSubscription(paths, decoded.data.pc_sub, {
      name: 'account subscription',
      username: auth.username,
      cookie: refreshedCookie || cookie
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBase: redactUrl(apiBase),
        username: auth.username || user.username || null,
        user,
        imported: imported
          ? {
              proxyCount: imported.metadata.proxyCount || null,
              convertedSubscription: Boolean(imported.metadata.convertedSubscription),
              skippedProxyCount: imported.metadata.skippedProxyCount || 0
            }
          : null
      },
      null,
      2
    )
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  const paths = getPaths(args);
  initialize(paths);

  if (command === 'help' || args.help) {
    console.log(`Usage:
  node cli.js doctor [--data-dir DIR]
  node cli.js status [--data-dir DIR]
  node cli.js serve [--port 4788] [--demo] [--data-dir DIR]
  node cli.js import /path/to/config.yaml|/path/to/sub.url|sub://...|https://... [--data-dir DIR]
  node cli.js mode rule|global|direct [--core-port 4790] [--data-dir DIR]
  node cli.js login --base https://... --username USER --password PASS [--data-dir DIR]
  node cli.js refresh-user [--base https://...] [--data-dir DIR]

Environment:
  CLASH_CORE=/absolute/path/to/mihomo
  SILVERVPN_DATA_DIR=~/.config/SilverVPN
  XIONGMAO_API_BASE=https://...
  XIONGMAO_USERNAME=...
  XIONGMAO_PASSWORD=...`);
    return;
  }
  if (command === 'doctor') {
    printDoctor(paths);
    return;
  }
  if (command === 'status') {
    printStatus(paths);
    return;
  }
  if (command === 'serve') {
    await startServer(paths, args);
    return;
  }
  if (command === 'import') {
    await importConfig(paths, args._[1]);
    return;
  }
  if (command === 'mode') {
    await setMode(paths, args);
    return;
  }
  if (command === 'login') {
    await loginAccount(paths, args);
    return;
  }
  if (command === 'refresh-user') {
    await refreshUser(paths, args);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
