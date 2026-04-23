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
  return new Promise((resolve) => {
    const data = load();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile) return resolve({ ok: false, error: 'not-found' });

    const flag = scope === 'global' ? '--global' : '--local';
    const cmds = [
      `git config ${flag} user.name "${profile.gitUser}"`,
      `git config ${flag} user.email "${profile.gitEmail}"`,
    ];
    if (profile.signingKey) {
      cmds.push(`git config ${flag} user.signingkey "${profile.signingKey}"`);
      cmds.push(`git config ${flag} gpg.program gpg`);
    }

    exec(cmds.join(' && '), { cwd, timeout: 5000, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        const isNotRepo = (stderr || '').toLowerCase().includes('not a git repository');
        return resolve({ ok: false, error: isNotRepo ? 'not-a-git-repo' : (stderr.trim() || err.message) });
      }
      data.active    = profileId;
      data.lastScope = scope;
      save(data);
      resolve({ ok: true, profile, scope });
    });
  });
}

module.exports = { load, save, switchProfile, _setProfilesPath };
