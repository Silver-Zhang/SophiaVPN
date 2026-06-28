#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function usage() {
  console.log(`Usage:
  svpn profile rename <number|name|id> <new-name>
  svpn profile delete <number|name|id> [--yes|-y]

Examples:
  svpn profile rename 1 MyProfile
  svpn profile rename "Custom Subscription" Grempt
  svpn profile delete 2 --yes

Safety:
  - only the current user's ~/.config/SilverVPN is modified.
  - no /etc, route, DNS, TUN or other users' files are touched.`);
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
  file = assertPathInHome(file, 'SilverVPN profile file');
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function getPaths() {
  const dataDir = assertPathInHome(
    process.env.SILVERVPN_DATA_DIR || path.join(os.homedir(), '.config', 'SilverVPN'),
    'SilverVPN data directory'
  );
  return {
    dataDir,
    settingsFile: path.join(dataDir, 'settings.json'),
    subscriptionsFile: path.join(dataDir, 'clashy-configs', 'subscriptions.json')
  };
}

function readProfiles(paths) {
  const data = readJson(paths.subscriptionsFile, { subscriptions: [] });
  return Array.isArray(data.subscriptions) ? data.subscriptions : [];
}

function writeProfiles(paths, profiles) {
  writeJson(paths.subscriptionsFile, { subscriptions: profiles });
}

function profileLabel(profile, index) {
  return `${String(index + 1).padStart(2, ' ')}. ${profile.name || profile.id || '(unnamed)'}`;
}

function resolveProfile(profiles, value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Missing profile selector.');

  if (/^\d+$/.test(input)) {
    const index = Number(input) - 1;
    if (index >= 0 && index < profiles.length) return { profile: profiles[index], index };
  }

  let matches = profiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => profile.id === input || profile.name === input);

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Profile selector is ambiguous: ${input}`);

  matches = profiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => String(profile.name || '').includes(input));

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const list = matches.map(({ profile, index }) => `  ${profileLabel(profile, index)}`).join('\n');
    throw new Error(`Profile selector is ambiguous: ${input}\n${list}`);
  }

  throw new Error(`Profile not found: ${input}`);
}

function renameProfile(paths, selector, newName) {
  const name = String(newName || '').trim();
  if (!name) throw new Error('Usage: svpn profile rename <number|name|id> <new-name>');

  const profiles = readProfiles(paths);
  if (!profiles.length) throw new Error('No subscription profiles found.');

  const { profile, index } = resolveProfile(profiles, selector);
  const oldName = profile.name || profile.id;
  profiles[index] = { ...profile, name, renamedAt: new Date().toISOString() };
  writeProfiles(paths, profiles);

  const settings = readJson(paths.settingsFile, {});
  if (settings.currentProfileId === profile.id) {
    settings.currentProfileName = name;
    if (settings.profile && typeof settings.profile === 'object') settings.profile.name = name;
    writeJson(paths.settingsFile, settings);
  }

  console.log(`Profile renamed: ${oldName} -> ${name}`);
}

function deleteProfile(paths, selector, options = {}) {
  const profiles = readProfiles(paths);
  if (!profiles.length) throw new Error('No subscription profiles found.');

  const { profile, index } = resolveProfile(profiles, selector);
  const settings = readJson(paths.settingsFile, {});
  const isActive = settings.currentProfileId === profile.id;

  if (isActive && !options.yes) {
    throw new Error('Refusing to delete the active profile without --yes. Run: svpn profile delete <profile> --yes');
  }

  writeProfiles(paths, profiles.filter((_, itemIndex) => itemIndex !== index));

  if (profile.fileName) {
    const file = assertPathInHome(profile.fileName, 'Subscription profile');
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }

  if (isActive) {
    delete settings.currentProfileId;
    delete settings.currentProfileName;
    writeJson(paths.settingsFile, settings);
  }

  console.log(`Profile deleted: ${profile.name || profile.id}`);
  if (isActive) console.log('The active Clash config file was kept to avoid breaking a running backend.');
}

function main() {
  let argv = process.argv.slice(2);
  if (argv[0] === 'profile') argv = argv.slice(1);
  const command = argv[0] || 'help';
  const paths = getPaths();

  if (command === 'help' || command === '--help' || command === '-h') return usage();
  if (command === 'rename') return renameProfile(paths, argv[1], argv.slice(2).join(' '));
  if (command === 'delete' || command === 'remove' || command === 'rm') {
    return deleteProfile(paths, argv[1], { yes: argv.includes('--yes') || argv.includes('-y') });
  }
  throw new Error('Usage: svpn profile rename <number|name|id> <new-name> OR svpn profile delete <number|name|id> [--yes]');
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
