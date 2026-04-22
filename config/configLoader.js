const fs = require('fs');
const path = require('path');
const os = require('os');

/** Default config — all keys a consumer can expect. */
const DEFAULT_CONFIG = {
  aliases: {},
  env: {},
  startupMessage: '',
  shellPath: null,
  fontSize: 14,
  fontFamily: '"JetBrains Mono", "Courier New", monospace',
  theme: {
    background: '#0d0d0d',
    accent: '#f0a500',
  },
};

/** Recursively merges override into base. Arrays replace (not concat). */
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const isPlainObject =
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !Array.isArray(override[key]);
    if (isPlainObject && typeof base[key] === 'object' && base[key] !== null) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/** Reads and parses a JSON file; returns {} on any error. */
function loadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Loads and merges config from two sources:
 *  1. ./team.config.json  (team defaults, lowest priority)
 *  2. ~/.superbash/personal.json  (personal overrides, highest priority)
 */
function load() {
  // __dirname is config/ — go up one level to reach the project root
  const teamPath = path.join(__dirname, '..', 'team.config.json');
  const personalPath = path.join(os.homedir(), '.superbash', 'personal.json');

  const team = loadJson(teamPath);
  const personal = loadJson(personalPath);

  return deepMerge(deepMerge(DEFAULT_CONFIG, team), personal);
}

module.exports = { load, deepMerge, loadJson };
