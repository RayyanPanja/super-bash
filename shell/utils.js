/**
 * shell/utils.js — pure utility functions shared by main.js and tests.
 * No Electron, no IPC — safe to require() in Jest.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * Converts a Git Bash POSIX path to a Windows native path.
 * e.g.  /c/Users/foo  →  C:\Users\foo  (Windows only)
 * On any other platform the path is returned unchanged.
 */
function resolveShellPath(shellPath) {
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(shellPath)) {
    return shellPath[1].toUpperCase() + ':' + shellPath.slice(2).replace(/\//g, path.sep);
  }
  return shellPath;
}

/** Expand a leading ~ to the user's home directory. */
function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Read and parse a team-snippets.json file; returns [] on any error. */
function readTeamSnippets(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data.snippets) ? data.snippets : [];
  } catch {
    return [];
  }
}

/**
 * Parse the raw output of the three git queries into a status object.
 * All arguments may be null (command failed / not a repo).
 *
 * @param {string|null} branch
 * @param {string|null} porcelain  git status --porcelain output
 * @param {string|null} aheadBehind  "N\tM" from git rev-list --left-right --count
 * @returns {{ isRepo: boolean, branch?: string, dirty?: number, ahead?: number, behind?: number }}
 */
function parseGitStatus(branch, porcelain, aheadBehind) {
  if (!branch) return { isRepo: false };

  const dirty = porcelain
    ? porcelain.split('\n').filter(l => l.trim()).length
    : 0;

  let ahead = 0, behind = 0;
  if (aheadBehind) {
    const [a, b] = aheadBehind.split(/\s+/).map(Number);
    ahead  = a || 0;
    behind = b || 0;
  }

  return { isRepo: true, branch, dirty, ahead, behind };
}

module.exports = { resolveShellPath, expandHome, readTeamSnippets, parseGitStatus };
