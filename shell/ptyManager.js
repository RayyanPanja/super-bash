const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/** Returns the default shell path for the current platform. */
function getDefaultShell() {
  if (process.platform !== 'win32') {
    return process.env.SHELL || '/bin/bash';
  }

  // 1. Check Windows registry — Git for Windows sets this on install
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\GitForWindows" /v InstallPath',
      { encoding: 'utf8', windowsHide: true, timeout: 3000 }
    );
    const m = out.match(/InstallPath\s+REG_SZ\s+(.+)/);
    if (m) {
      const bash = path.join(m[1].trim(), 'bin', 'bash.exe');
      if (fs.existsSync(bash)) return bash.replace(/\\/g, '/');
    }
  } catch { /* registry key absent or reg.exe not found */ }

  // 2. Walk common install locations (covers non-default drives / 32-bit installs)
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean);

  for (const root of roots) {
    const bash = path.join(root, 'Git', 'bin', 'bash.exe');
    if (fs.existsSync(bash)) return bash.replace(/\\/g, '/');
  }

  // 3. Ask PATH — works for Scoop / Chocolatey / custom installs
  try {
    const which = execSync('where bash.exe', { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const found = which.trim().split('\n')[0].trim();
    if (found && fs.existsSync(found)) return found.replace(/\\/g, '/');
  } catch { /* bash not on PATH */ }

  // 4. Hard fallback — at least gives a clear error in the PTY if missing
  return 'C:/Program Files/Git/bin/bash.exe';
}

const SAFE_ALIAS_KEY = /^[a-zA-Z_][a-zA-Z0-9_.:-]*$/;

/**
 * Writes a temporary bash init file that sources the user's .bashrc
 * and then registers all configured aliases.
 * Returns the path to the temp file.
 */
function createAliasInitFile(aliases) {
  const tmpPath = path.join(
    os.tmpdir(),
    `superbash_init_${crypto.randomUUID()}.sh`
  );

  let content = '#!/bin/bash\n';
  content += '[ -f ~/.bashrc ] && source ~/.bashrc\n';
  content += '[ -f ~/.bash_profile ] && source ~/.bash_profile\n';

  for (const [key, cmd] of Object.entries(aliases)) {
    if (!SAFE_ALIAS_KEY.test(key)) {
      process.stderr.write(`[super-bash] Skipping unsafe alias key: "${key}"\n`);
      continue;
    }
    const escaped = cmd.replace(/'/g, "'\\''");
    content += `alias ${key}='${escaped}'\n`;
  }

  fs.writeFileSync(tmpPath, content, { mode: 0o700 });
  return tmpPath;
}

class PtyManager {
  constructor() {
    /**
     * @type {Map<string, { process: import('node-pty').IPty, tmpFile: string|null }>}
     */
    this.sessions = new Map();
  }

  /**
   * Spawns a new PTY session.
   * Callbacks are registered synchronously before returning to avoid race conditions.
   *
   * @param {object} opts
   * @param {number} [opts.cols=80]
   * @param {number} [opts.rows=24]
   * @param {Record<string,string>} [opts.env={}]
   * @param {string|null} [opts.shellPath]
   * @param {Record<string,string>} [opts.aliases={}]
   * @param {(data: string) => void} [opts.onData]
   * @param {(exitCode: number) => void} [opts.onExit]
   * @returns {string} sessionId
   */
  create({ cols = 80, rows = 24, env = {}, shellPath = null, aliases = {}, onData, onExit } = {}) {
    const shell = shellPath || getDefaultShell();
    const sessionId = crypto.randomUUID();

    let args = [];
    let tmpFile = null;

    const hasAliases = Object.keys(aliases).length > 0;
    const isBash = shell.toLowerCase().includes('bash');
    if (hasAliases && isBash) {
      tmpFile = createAliasInitFile(aliases);
      args = ['--init-file', tmpFile];
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: { ...process.env, ...env },
    });

    // Register callbacks synchronously before any async gap to avoid missed events
    if (onData) ptyProcess.onData(onData);
    if (onExit) ptyProcess.onExit(({ exitCode }) => onExit(exitCode));

    this.sessions.set(sessionId, { process: ptyProcess, tmpFile });
    return sessionId;
  }

  /** Write data to a PTY session (user keystrokes). */
  write(sessionId, data) {
    const s = this.sessions.get(sessionId);
    if (s) s.process.write(data);
  }

  /** Resize a PTY session when the terminal pane resizes. */
  resize(sessionId, cols, rows) {
    const s = this.sessions.get(sessionId);
    if (s) {
      try {
        s.process.resize(cols, rows);
      } catch {
        // PTY may have exited; ignore resize errors
      }
    }
  }

  /** Register a callback for data arriving from a PTY session. */
  onData(sessionId, callback) {
    const s = this.sessions.get(sessionId);
    if (s) s.process.onData(callback);
  }

  /** Register a callback for when the PTY process exits. */
  onExit(sessionId, callback) {
    const s = this.sessions.get(sessionId);
    if (s) s.process.onExit(({ exitCode }) => callback(exitCode));
  }

  /** Kill a single PTY session and remove it from the map. */
  destroy(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try { s.process.kill(); } catch { /* already dead */ }
    if (s.tmpFile) {
      try { fs.unlinkSync(s.tmpFile); } catch { /* ignore */ }
    }
    this.sessions.delete(sessionId);
  }

  /** Kill all sessions — call before app quit to avoid zombie processes. */
  destroyAll() {
    for (const sessionId of [...this.sessions.keys()]) {
      this.destroy(sessionId);
    }
  }
}

module.exports = PtyManager;
