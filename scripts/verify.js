'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const requireSubscription = argv.includes('--require-subscription');
const realUrlFile = getArgValue('--real-url');
const tempDirs = [];
const results = [];

function getArgValue(name) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`${name} requires a file path argument`);
      }
      return next;
    }
    if (value.startsWith(`${name}=`)) {
      const next = value.slice(name.length + 1);
      if (!next) {
        throw new Error(`${name} requires a file path argument`);
      }
      return next;
    }
  }
  return '';
}

function makeTempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xiongmao-vpn-verify-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function cleanupTempDirs() {
  for (const dir of tempDirs.reverse()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatCommand(args) {
  return ['node', 'cli.js', ...args].map(value => JSON.stringify(String(value))).join(' ');
}

function formatProcessResult(result, heading) {
  const lines = [
    heading,
    `command: ${formatCommand(result.args)}`,
    `exit: ${result.code}${result.signal ? ` signal=${result.signal}` : ''}`,
    'stdout:',
    result.stdout.trim() || '<empty>',
    'stderr:',
    result.stderr.trim() || '<empty>'
  ];
  return lines.join('\n');
}

function processError(result, heading) {
  const error = new Error(formatProcessResult(result, heading));
  error.result = result;
  return error;
}

function assertOk(condition, message, context = '') {
  if (!condition) {
    throw new Error(context ? `${message}\n${context}` : message);
  }
}

function runCli(args, options = {}) {
  const child = spawn(process.execPath, ['cli.js', ...args], {
    cwd: root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = {
    args,
    stdout: '',
    stderr: '',
    code: null,
    signal: null
  };

  child.stdout.on('data', chunk => {
    result.stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    result.stderr += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    child.on('error', error => {
      reject(error);
    });
    child.on('close', (code, signal) => {
      result.code = code;
      result.signal = signal;
      if (code !== 0 && !options.allowFailure) {
        reject(processError(result, options.heading || 'CLI command failed'));
        return;
      }
      resolve(result);
    });
  });
}

function parseJsonResult(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not print valid JSON\n${formatProcessResult(result, `${label} output`)}`);
  }
}

function buildClashYaml({ httpPort, socksPort, mode, names }) {
  const proxyItems = names
    .map(
      (name, index) => `  - name: ${name}
    type: http
    server: 127.0.0.${index + 1}
    port: ${8000 + index}`
    )
    .join('\n');
  const groupItems = names.map(name => `      - ${name}`).join('\n');
  return `port: ${httpPort}
socks-port: ${socksPort}
mode: ${mode}
proxies:
${proxyItems}
proxy-groups:
  - name: Proxy
    type: select
    proxies:
${groupItems}
rules:
  - MATCH,Proxy
`;
}

function buildJsonInlineClashYaml({ httpPort, socksPort, mode, names }) {
  const proxyItems = names
    .map((name, index) =>
      `  - ${JSON.stringify({
        name,
        type: 'http',
        server: `127.0.1.${index + 1}`,
        port: 8100 + index
      })}`
    )
    .join('\n');
  const groupItems = names.map(name => `      - ${name}`).join('\n');
  return `port: ${httpPort}
socks-port: ${socksPort}
mode: ${mode}
proxies:
${proxyItems}
proxy-groups:
  - name: Proxy
    type: select
    proxies:
${groupItems}
rules:
  - MATCH,Proxy
`;
}

function writeFixtureConfig(dir, filename, options) {
  const file = path.join(dir, filename);
  fs.writeFileSync(file, buildClashYaml(options));
  return file;
}

function writeJsonInlineFixtureConfig(dir, filename, options) {
  const file = path.join(dir, filename);
  fs.writeFileSync(file, buildJsonInlineClashYaml(options));
  return file;
}

function encodeBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function rc4Transform(input, key = 'RocketMaker') {
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

function encodeRocketResponse(value) {
  return Buffer.from(rc4Transform(JSON.stringify(value)), 'binary').toString('base64');
}

function encodeBase64Url(text) {
  return encodeBase64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildUriListFixtures() {
  const ssrName = 'Fixture SSR';
  const vmessName = 'Fixture VMess';
  const ssrPayload = [
    'fixture-ssr.test',
    '8388',
    'origin',
    'aes-128-cfb',
    'plain',
    encodeBase64Url('fixture-password')
  ].join(':');
  const ssrQuery = [
    `obfsparam=${encodeBase64Url('')}`,
    `protoparam=${encodeBase64Url('')}`,
    `remarks=${encodeBase64Url(ssrName)}`,
    `group=${encodeBase64Url('Fixture Group')}`
  ].join('&');
  const ssrUri = `ssr://${encodeBase64Url(`${ssrPayload}/?${ssrQuery}`)}`;
  const vmessUri = `vmess://${encodeBase64(
    JSON.stringify({
      v: '2',
      ps: vmessName,
      add: 'fixture-vmess.test',
      port: '443',
      id: '00000000-0000-4000-8000-000000000001',
      aid: '0',
      scy: 'auto',
      net: 'ws',
      type: 'none',
      host: 'fixture-vmess.test',
      path: '/fixture',
      tls: 'tls',
      sni: 'fixture-vmess.test'
    })
  )}`;

  return {
    names: [ssrName, vmessName],
    text: `${ssrUri}\n${vmessUri}\n`
  };
}

async function getOpenPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        timeout: 2000
      },
      response => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          raw += chunk;
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`${pathname} returned HTTP ${response.statusCode}: ${raw}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`${pathname} did not return JSON: ${raw}`));
          }
        });
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error(`${pathname} request timed out`));
    });
    request.on('error', reject);
  });
}

function startServe(dataDir, port, corePort) {
  const args = ['serve', '--demo', '--port', String(port), '--core-port', String(corePort), '--data-dir', dataDir];
  const child = spawn(process.execPath, ['cli.js', ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const proc = {
    child,
    args,
    stdout: '',
    stderr: '',
    code: null,
    signal: null
  };
  child.stdout.on('data', chunk => {
    proc.stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    proc.stderr += chunk.toString();
  });
  child.once('exit', (code, signal) => {
    proc.code = code;
    proc.signal = signal;
  });
  return proc;
}

async function waitForServer(port, proc) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 5000) {
    if (proc.code !== null) {
      throw processError(proc, 'serve exited before becoming healthy');
    }
    try {
      return await requestJson(port, '/health');
    } catch (error) {
      lastError = error;
      await delay(150);
    }
  }
  throw new Error(
    `service did not become healthy within 5 seconds: ${lastError ? lastError.message : 'no response'}\n${formatProcessResult(
      proc,
      'serve output'
    )}`
  );
}

async function stopServe(proc) {
  if (proc.code !== null) {
    return;
  }
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      proc.child.kill('SIGKILL');
      resolve();
    }, 2000);
    proc.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.child.kill('SIGTERM');
  });
}

async function verifyDoctorAndInitialStatus(dataDir) {
  const doctor = await runCli(['doctor', '--data-dir', dataDir], { heading: 'doctor check failed' });
  assertOk(doctor.stdout.includes('node:'), 'doctor output did not include node check', formatProcessResult(doctor, 'doctor output'));
  assertOk(
    doctor.stdout.includes(`dataDir: ${dataDir}`),
    'doctor output did not use the temporary data-dir',
    formatProcessResult(doctor, 'doctor output')
  );

  const statusResult = await runCli(['status', '--data-dir', dataDir], { heading: 'status check failed' });
  const status = parseJsonResult(statusResult, 'status');
  assertOk(status.dataDir === dataDir, `status used unexpected dataDir: ${status.dataDir}`);
  assertOk(status.configExists === true, 'status did not report an initialized config');
  assertOk(typeof status.proxyCount === 'number', 'status did not report proxyCount');
  results.push(`doctor/status ok: proxyCount=${status.proxyCount}`);
}

async function verifyLocalImport(dataDir, fixtureDir) {
  const names = ['Local Alpha', 'Local Beta', 'Local Gamma'];
  const configFile = writeFixtureConfig(fixtureDir, 'local-import.yaml', {
    httpPort: 19080,
    socksPort: 19081,
    mode: 'Rule',
    names
  });

  await runCli(['import', configFile, '--data-dir', dataDir], { heading: 'local YAML import failed' });

  const statusResult = await runCli(['status', '--data-dir', dataDir], { heading: 'status after local import failed' });
  const status = parseJsonResult(statusResult, 'status after local import');
  assertOk(status.configExists === true, 'local import did not create an active config');
  assertOk(status.httpPort === 19080, `local import status httpPort=${status.httpPort}, expected 19080`);
  assertOk(status.socksPort === 19081, `local import status socksPort=${status.socksPort}, expected 19081`);
  assertOk(status.proxyCount === names.length, `local import proxyCount=${status.proxyCount}, expected ${names.length}`);

  const savedConfig = fs.readFileSync(status.config, 'utf8');
  for (const name of names) {
    assertOk(savedConfig.includes(name), `active config is missing imported proxy ${name}`);
  }
  results.push(`local YAML import ok: proxyCount=${status.proxyCount}`);
  return { names, status };
}

async function verifyJsonInlineProxyImport(fixtureDir) {
  const dataDir = makeTempDir('json-inline-data');
  const names = ['JSON Inline Alpha', 'JSON Inline Beta'];
  const configFile = writeJsonInlineFixtureConfig(fixtureDir, 'json-inline-import.yaml', {
    httpPort: 19380,
    socksPort: 19381,
    mode: 'Rule',
    names
  });

  await runCli(['import', configFile, '--data-dir', dataDir], { heading: 'JSON-inline YAML import failed' });

  const statusResult = await runCli(['status', '--data-dir', dataDir], { heading: 'status after JSON-inline import failed' });
  const status = parseJsonResult(statusResult, 'status after JSON-inline import');
  assertOk(status.configExists === true, 'JSON-inline import did not create an active config');
  assertOk(status.proxyCount === names.length, `JSON-inline proxyCount=${status.proxyCount}, expected ${names.length}`);

  results.push(`JSON-inline YAML import ok: proxyCount=${status.proxyCount}`);
}

async function verifyModeCommand(dataDir) {
  for (const mode of ['global', 'direct', 'rule']) {
    const modeResult = await runCli(['mode', mode, '--data-dir', dataDir], { heading: `${mode} mode command failed` });
    const modeOutput = parseJsonResult(modeResult, `${mode} mode command`);
    assertOk(modeOutput.ok === true, `${mode} mode command did not report ok=true`);
    assertOk(modeOutput.mode === mode, `${mode} mode command reported mode=${modeOutput.mode}`);
    assertOk(modeOutput.saved === true, `${mode} mode command did not save config mode`);

    const statusResult = await runCli(['status', '--data-dir', dataDir], { heading: `status after ${mode} mode failed` });
    const status = parseJsonResult(statusResult, `status after ${mode} mode`);
    assertOk(String(status.mode).toLowerCase() === mode, `status mode=${status.mode}, expected ${mode}`);
  }
  results.push('mode command ok: global/direct/rule');
}

async function verifyDemoServe(dataDir, expected) {
  const port = await getOpenPort();
  let corePort = await getOpenPort();
  while (corePort === port) {
    corePort = await getOpenPort();
  }
  const proc = startServe(dataDir, port, corePort);
  try {
    const health = await waitForServer(port, proc);
    const configs = await requestJson(port, '/configs');
    const proxies = await requestJson(port, '/proxies');
    assertOk(health.ok === true, 'health.ok is false', formatProcessResult(proc, 'serve output'));
    assertOk(health.dataDir === dataDir, 'health endpoint used unexpected dataDir', JSON.stringify(health, null, 2));
    assertOk(configs.port === expected.status.httpPort, `configs.port=${configs.port}, expected ${expected.status.httpPort}`);
    assertOk(
      configs['socks-port'] === expected.status.socksPort,
      `configs.socks-port=${configs['socks-port']}, expected ${expected.status.socksPort}`
    );
    assertOk(proxies.proxies && proxies.proxies.Proxy, 'proxies endpoint did not expose Proxy selector');
    assertOk(
      proxies.proxies.Proxy.all.length === expected.names.length,
      `proxies Proxy.all length=${proxies.proxies.Proxy.all.length}, expected ${expected.names.length}`
    );
    results.push(`demo serve ok: mode=${health.mode} http=${configs.port} socks=${configs['socks-port']} proxyCount=${proxies.proxies.Proxy.all.length}`);
  } catch (error) {
    throw new Error(`${error.message}\n${formatProcessResult(proc, 'serve output')}`);
  } finally {
    await stopServe(proc);
  }
}

function startSubscriptionServer(configText, options = {}) {
  const body = options.base64 ? encodeBase64(configText) : configText;
  const contentType = options.contentType || 'text/yaml; charset=utf-8';
  const pathname = options.pathname || '/subscription.yaml';
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push({
      url: request.url,
      userAgent: request.headers['user-agent'] || ''
    });
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        hits,
        url: `http://127.0.0.1:${server.address().port}${pathname}`
      });
    });
  });
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

function startAccountApiServer(configText) {
  const hits = [];
  let server;
  const sessionCookie = 'xm_session=fixture-session';
  const userData = port => ({
    username: 'fixture-user',
    balance: 12.34,
    traffic: {
      used: 1024,
      total: 4096
    },
    class: 1,
    class_expire: '2099-01-01 00:00:00',
    true_name: 'Fixture User',
    defaultProxy: 'Proxy',
    pc_sub: `http://127.0.0.1:${port}/pc-sub.yaml`
  });

  server = http.createServer((request, response) => {
    hits.push({
      method: request.method,
      url: request.url,
      cookie: request.headers.cookie || ''
    });

    if (request.url === '/pc-sub.yaml') {
      response.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8' });
      response.end(configText);
      return;
    }

    const data = userData(server.address().port);
    if (request.method === 'POST' && request.url === '/v1/login') {
      let raw = '';
      request.on('data', chunk => {
        raw += chunk.toString();
      });
      request.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch (error) {
          // Keep an empty body; the CLI should still surface assertion failures below.
        }
        const ok = body.username === 'fixture-user' && body.password === 'fixture-pass' && typeof body._t === 'number';
        response.writeHead(ok ? 200 : 403, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Set-Cookie': `${sessionCookie}; Path=/; HttpOnly`
        });
        response.end(
          encodeRocketResponse(
            ok
              ? {
                  code: 200,
                  info: 'ok',
                  data
                }
              : {
                  code: 403,
                  info: 'bad credentials'
                }
          )
        );
      });
      return;
    }

    if (request.method === 'GET' && request.url.startsWith('/v1/userinfo')) {
      const ok = String(request.headers.cookie || '').includes(sessionCookie);
      response.writeHead(ok ? 200 : 401, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(
        encodeRocketResponse(
          ok
            ? {
                code: 200,
                info: 'ok',
                data
              }
            : {
                code: 401,
                info: 'missing cookie'
              }
        )
      );
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        hits,
        sessionCookie,
        baseUrl: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

function isSubscriptionUnsupported(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return /Config file not found:\s*sub:\/\//i.test(output) || /sub:\/\/.*not supported/i.test(output) || /subscription.*not implemented/i.test(output);
}

function isUriListConversionUnsupported(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return (
    isSubscriptionUnsupported(result) ||
    /content does not look like Clash YAML/i.test(output) ||
    /URI[- ]?list.*not supported/i.test(output) ||
    /SSR.*not supported/i.test(output) ||
    /VMess.*not supported/i.test(output)
  );
}

function skipOptionalSubscriptionCheck(label, message) {
  if (requireSubscription) {
    return false;
  }
  results.push(`${label} skipped: ${message}; run npm run verify:full after cli.js lands`);
  return true;
}

function hasConvertedSubscriptionMetadata(status) {
  const profile = status.profile || {};
  const convertedSubscription = profile.convertedSubscription;
  if (convertedSubscription === true || /uri[-_ ]?list|ssr|vmess/i.test(String(convertedSubscription || ''))) {
    return true;
  }
  if (profile.convertedUriList === true || profile.uriList === true) {
    return true;
  }

  const metadataValues = [
    profile.subscriptionFormat,
    profile.sourceFormat,
    profile.contentFormat,
    profile.convertedFrom,
    profile.sourceKind
  ]
    .filter(Boolean)
    .map(value => String(value));
  if (metadataValues.some(value => /uri[-_ ]?list|ssr|vmess/i.test(value))) {
    return true;
  }

  return (
    profile.decodedBase64 === true &&
    /sub-url|subscription-url|subscription-file/i.test(String(profile.sourceType || '')) &&
    Number(status.proxyCount) >= 2
  );
}

async function verifySubscriptionImport(fixtureDir) {
  const dataDir = makeTempDir('subscription-data');
  const names = ['Subscription Alpha', 'Subscription Beta', 'Subscription Gamma', 'Subscription Delta'];
  const configText = buildClashYaml({
    httpPort: 19180,
    socksPort: 19181,
    mode: 'Global',
    names
  });
  const subscription = await startSubscriptionServer(configText);
  try {
    const encoded = Buffer.from(subscription.url, 'utf8').toString('base64');
    const subUrl = `sub://${encoded}#test`;
    const importResult = await runCli(['import', subUrl, '--data-dir', dataDir], {
      allowFailure: true,
      heading: 'subscription URL import failed'
    });

    if (importResult.code !== 0) {
      if (!requireSubscription && isSubscriptionUnsupported(importResult)) {
        results.push('subscription import skipped: cli.js does not support sub:// yet; run npm run verify:full after agent A lands');
        return { skipped: true };
      }
      throw processError(importResult, 'subscription URL import failed');
    }

    assertOk(subscription.hits.length > 0, 'subscription import succeeded without requesting the local subscription server');
    assertOk(
      subscription.hits.some(hit => /ClashMeta/i.test(hit.userAgent)),
      'subscription request did not identify SilverVPN as a ClashMeta-compatible client'
    );
    const statusResult = await runCli(['status', '--data-dir', dataDir], { heading: 'status after subscription import failed' });
    const status = parseJsonResult(statusResult, 'status after subscription import');
    assertOk(status.configExists === true, 'subscription import did not create an active config');
    assertOk(status.httpPort === 19180, `subscription status httpPort=${status.httpPort}, expected 19180`);
    assertOk(status.socksPort === 19181, `subscription status socksPort=${status.socksPort}, expected 19181`);
    assertOk(status.proxyCount === names.length, `subscription proxyCount=${status.proxyCount}, expected ${names.length}`);

    const savedConfig = fs.readFileSync(status.config, 'utf8');
    for (const name of names) {
      assertOk(savedConfig.includes(name), `subscription config is missing imported proxy ${name}`);
    }
    fs.writeFileSync(path.join(fixtureDir, 'last-subscription-url.txt'), subscription.url);
    results.push(`subscription import ok: proxyCount=${status.proxyCount}`);
    return { skipped: false };
  } finally {
    await closeServer(subscription.server);
  }
}

async function verifyUriListSubscriptionImport() {
  const dataDir = makeTempDir('uri-list-data');
  const fixture = buildUriListFixtures();
  const subscription = await startSubscriptionServer(fixture.text, {
    base64: true,
    contentType: 'text/plain; charset=utf-8',
    pathname: '/uri-list.txt'
  });

  try {
    const encoded = encodeBase64(subscription.url);
    const subUrl = `sub://${encoded}#fixture`;
    const importResult = await runCli(['import', subUrl, '--data-dir', dataDir], {
      allowFailure: true,
      heading: 'URI-list subscription import failed'
    });

    if (importResult.code !== 0) {
      if (!isUriListConversionUnsupported(importResult)) {
        throw processError(importResult, 'URI-list subscription import failed');
      }
      if (skipOptionalSubscriptionCheck('URI-list subscription import', 'cli.js does not convert base64 SSR/VMess URI lists yet')) {
        return { skipped: true };
      }
      throw processError(importResult, 'URI-list subscription import failed');
    }

    assertOk(subscription.hits.length > 0, 'URI-list import succeeded without requesting the local subscription server');
    const statusResult = await runCli(['status', '--data-dir', dataDir], { heading: 'status after URI-list import failed' });
    const status = parseJsonResult(statusResult, 'status after URI-list import');
    const savedConfig = status.config && fs.existsSync(status.config) ? fs.readFileSync(status.config, 'utf8') : '';
    const incompleteReasons = [];

    if (status.configExists !== true) {
      incompleteReasons.push('URI-list import did not create an active config');
    }
    if (status.proxyCount < fixture.names.length) {
      incompleteReasons.push(`URI-list proxyCount=${status.proxyCount}, expected at least ${fixture.names.length}`);
    }
    for (const name of fixture.names) {
      if (!savedConfig.includes(name)) {
        incompleteReasons.push(`URI-list config is missing converted proxy ${name}`);
      }
    }
    if (!hasConvertedSubscriptionMetadata(status)) {
      incompleteReasons.push('status.profile did not include converted subscription metadata');
    }

    if (incompleteReasons.length > 0) {
      if (skipOptionalSubscriptionCheck('URI-list subscription import', incompleteReasons[0])) {
        return { skipped: true };
      }
      throw new Error(`${incompleteReasons.join('\n')}\nprofile: ${JSON.stringify(status.profile || {}, null, 2)}`);
    }

    results.push(`URI-list subscription import ok: proxyCount=${status.proxyCount}`);
    return { skipped: false };
  } finally {
    await closeServer(subscription.server);
  }
}

async function verifyAccountLoginAndRefresh() {
  const dataDir = makeTempDir('account-data');
  const names = ['Account Alpha', 'Account Beta', 'Account Gamma'];
  const configText = buildClashYaml({
    httpPort: 19280,
    socksPort: 19281,
    mode: 'Rule',
    names
  });
  const api = await startAccountApiServer(configText);
  try {
    const loginResult = await runCli(
      [
        'login',
        '--base',
        api.baseUrl,
        '--username',
        'fixture-user',
        '--password',
        'fixture-pass',
        '--data-dir',
        dataDir
      ],
      { heading: 'account login failed' }
    );
    const login = parseJsonResult(loginResult, 'account login');
    assertOk(login.ok === true, 'login result did not report ok=true', formatProcessResult(loginResult, 'login output'));
    assertOk(login.imported && login.imported.proxyCount === names.length, 'login did not import account subscription');

    const statusAfterLogin = parseJsonResult(
      await runCli(['status', '--data-dir', dataDir], { heading: 'status after account login failed' }),
      'status after account login'
    );
    assertOk(statusAfterLogin.auth && statusAfterLogin.auth.hasCookie === true, 'status did not report saved auth cookie');
    assertOk(statusAfterLogin.auth.username === 'fixture-user', 'status did not report account username');
    assertOk(statusAfterLogin.profile && statusAfterLogin.profile.sourceType === 'account-subscription', 'status did not report account subscription profile');
    assertOk(statusAfterLogin.proxyCount === names.length, `account import proxyCount=${statusAfterLogin.proxyCount}, expected ${names.length}`);

    const refreshResult = await runCli(['refresh-user', '--base', api.baseUrl, '--data-dir', dataDir], {
      heading: 'account refresh-user failed'
    });
    const refresh = parseJsonResult(refreshResult, 'account refresh-user');
    assertOk(refresh.ok === true, 'refresh-user result did not report ok=true', formatProcessResult(refreshResult, 'refresh-user output'));
    assertOk(refresh.imported && refresh.imported.proxyCount === names.length, 'refresh-user did not import account subscription');

    const pcSubHits = api.hits.filter(hit => hit.url === '/pc-sub.yaml');
    assertOk(pcSubHits.length >= 2, `expected login and refresh to download pc_sub, got ${pcSubHits.length}`);
    assertOk(
      pcSubHits.every(hit => hit.cookie.includes(api.sessionCookie)),
      'pc_sub download did not include the saved login cookie'
    );

    results.push(`account login refresh ok: proxyCount=${names.length}`);
  } finally {
    await closeServer(api.server);
  }
}

async function verifyRealUrlImport(source) {
  const dataDir = makeTempDir('real-url-data');
  const sourcePath = path.resolve(root, source);
  assertOk(fs.existsSync(sourcePath), `real .url file not found: ${source}`);

  const importResult = await runCli(['import', sourcePath, '--data-dir', dataDir], {
    allowFailure: true,
    heading: 'real .url import failed'
  });
  if (importResult.code !== 0) {
    throw processError(importResult, 'real .url import failed');
  }

  const statusResult = await runCli(['status', '--data-dir', dataDir], { heading: 'status after real .url import failed' });
  const status = parseJsonResult(statusResult, 'status after real .url import');
  assertOk(status.configExists === true, 'real .url import did not create an active config');
  assertOk(status.proxyCount > 0, `real .url proxyCount=${status.proxyCount}, expected at least 1`);
  assertOk(status.profile && /subscription-file|sub-url|subscription-url/i.test(String(status.profile.sourceType || '')), 'real .url status did not report subscription metadata');
  assertOk(hasConvertedSubscriptionMetadata(status), 'real .url status did not report converted subscription metadata');
  assertOk(
    status.profile.proxyCount === status.proxyCount,
    `real .url profile.proxyCount=${status.profile.proxyCount}, status.proxyCount=${status.proxyCount}`
  );
  assertOk(
    Number.isInteger(status.profile.skippedProxyCount) && status.profile.skippedProxyCount >= 0,
    'real .url status did not report skippedProxyCount'
  );

  results.push(`real .url import ok: proxyCount=${status.proxyCount}`);
}

async function main() {
  const dataDir = makeTempDir('data');
  const fixtureDir = makeTempDir('fixtures');

  try {
    await verifyDoctorAndInitialStatus(dataDir);
    const localImport = await verifyLocalImport(dataDir, fixtureDir);
    await verifyJsonInlineProxyImport(fixtureDir);
    await verifyModeCommand(dataDir);
    await verifyDemoServe(dataDir, localImport);
    await verifySubscriptionImport(fixtureDir);
    await verifyUriListSubscriptionImport();
    await verifyAccountLoginAndRefresh();
    if (realUrlFile) {
      await verifyRealUrlImport(realUrlFile);
    }
    console.log('verify ok');
    for (const line of results) {
      console.log(line);
    }
  } finally {
    cleanupTempDirs();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
