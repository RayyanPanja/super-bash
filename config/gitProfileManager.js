const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');

let _profilesPath = path.join(os.homedir(), '.superbash', 'git-profiles.json');

function _setProfilesPath(p) { _profilesPath = p; }

const DEFAULT_DATA = { active: null, lastScope: 'local', profiles: [] };

function load() {
  try {
    if (!fs.existsSync(_profilesPath)) return { ...DEFAULT_DATA };
    return JSON.parse(fs.readFileSync(_profilesPath, 'utf8'));
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function save(data) {
  const dir = path.dirname(_profilesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(_profilesPath, JSON.stringify(data, null, 2), 'utf8');
}

function switchProfile({ profileId, scope, cwd }) {
  // implemented in Task 2
}

module.exports = { load, save, switchProfile, _setProfilesPath };
