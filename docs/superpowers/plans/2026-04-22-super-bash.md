# Super Bash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Super Bash" — a frameless Electron desktop app that is a Git Bash replacement with split-pane terminals, gold-on-black theming, team config injection, and full PTY support.

**Architecture:** Electron main process owns all node-pty PTY sessions (via PtyManager) and exposes them to the renderer exclusively through a contextBridge preload — nodeIntegration is disabled. The renderer uses xterm.js v4 (UMD script-tag build) with fit/web-links/search addons, plain HTML/CSS/JS, no framework. Config is loaded at startup by merging `team.config.json` (team defaults) then `~/.superbash/personal.json` (personal overrides).

**Tech Stack:** Electron 28+, node-pty 1.x, xterm 4.19.x, xterm-addon-fit 0.5.x, xterm-addon-web-links 0.6.x, xterm-addon-search 0.8.x, electron-builder, Jest (config unit tests)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `package.json` | deps, scripts, electron-builder config |
| `main.js` | BrowserWindow creation, IPC handlers for PTY ops + window controls |
| `preload.js` | contextBridge — exposes `window.electronAPI` to renderer |
| `shell/ptyManager.js` | Creates/manages node-pty instances keyed by sessionId; handles aliases init file |
| `config/configLoader.js` | Loads + deep-merges team.config.json and ~/.superbash/personal.json |
| `renderer/index.html` | App shell: custom titlebar, two pane divs, divider, script tags |
| `renderer/styles.css` | All styles: dark theme, gold accents, frameless titlebar, pane layout |
| `renderer/terminal.js` | xterm instances, split logic, divider drag, keyboard shortcuts, font zoom |
| `tests/configLoader.test.js` | Unit tests for config merging logic |
| `team.config.json` | Example team config |
| `examples/personal.json` | Example personal config |

---

### Task 1: Project Scaffold + package.json

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "super-bash",
  "version": "1.0.0",
  "description": "A Git Bash replacement with split panes, gold-on-black theme, and team config",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder",
    "rebuild": "electron-rebuild -f -w node-pty",
    "test": "jest"
  },
  "dependencies": {
    "electron": "^28.3.0",
    "node-pty": "^1.0.0",
    "xterm": "4.19.0",
    "xterm-addon-fit": "0.5.0",
    "xterm-addon-web-links": "0.6.0",
    "xterm-addon-search": "0.8.2"
  },
  "devDependencies": {
    "electron-builder": "^24.9.0",
    "electron-rebuild": "^3.2.9",
    "jest": "^29.7.0"
  },
  "build": {
    "appId": "com.superbash.app",
    "productName": "Super Bash",
    "files": [
      "main.js",
      "preload.js",
      "renderer/**/*",
      "shell/**/*",
      "config/**/*",
      "assets/**/*",
      "team.config.json",
      "node_modules/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    },
    "mac": {
      "target": "dmg",
      "icon": "assets/icon.icns"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p shell config renderer assets/fonts tests examples
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: node_modules created, no errors.

- [ ] **Step 4: Rebuild node-pty for Electron**

node-pty is a native addon and must be compiled against Electron's Node version.

```bash
npm run rebuild
```

Expected: `✓ Rebuild Complete` (or similar). If electron-rebuild is missing, install it: `npm install --save-dev electron-rebuild @electron/rebuild`.

- [ ] **Step 5: Commit scaffold**

```bash
git init
git add package.json
git commit -m "feat: scaffold super-bash project"
```

---

### Task 2: Config Loader (TDD)

**Files:**
- Create: `config/configLoader.js`
- Create: `tests/configLoader.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/configLoader.test.js`:

```javascript
const path = require('path');
const os = require('os');
const fs = require('fs');
const { deepMerge, loadJson } = require('../config/configLoader');

describe('deepMerge', () => {
  test('returns base when override is empty', () => {
    const base = { a: 1, b: { c: 2 } };
    expect(deepMerge(base, {})).toEqual(base);
  });

  test('override scalar replaces base scalar', () => {
    expect(deepMerge({ fontSize: 14 }, { fontSize: 18 })).toEqual({ fontSize: 18 });
  });

  test('deeply merges nested objects', () => {
    const base = { theme: { background: '#000', accent: '#f0a500' } };
    const override = { theme: { accent: '#fff' } };
    expect(deepMerge(base, override)).toEqual({
      theme: { background: '#000', accent: '#fff' },
    });
  });

  test('override wins for top-level keys not in base', () => {
    expect(deepMerge({}, { shellPath: '/bin/zsh' })).toEqual({ shellPath: '/bin/zsh' });
  });

  test('merges aliases from both configs', () => {
    const base = { aliases: { gs: 'git status' } };
    const override = { aliases: { gp: 'git push' } };
    expect(deepMerge(base, override)).toEqual({
      aliases: { gs: 'git status', gp: 'git push' },
    });
  });
});

describe('loadJson', () => {
  test('returns empty object when file does not exist', () => {
    expect(loadJson('/nonexistent/path/file.json')).toEqual({});
  });

  test('parses valid JSON file', () => {
    const tmpFile = path.join(os.tmpdir(), `test_${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify({ fontSize: 16 }));
    expect(loadJson(tmpFile)).toEqual({ fontSize: 16 });
    fs.unlinkSync(tmpFile);
  });

  test('returns empty object on malformed JSON', () => {
    const tmpFile = path.join(os.tmpdir(), `bad_${Date.now()}.json`);
    fs.writeFileSync(tmpFile, '{ invalid json }');
    expect(loadJson(tmpFile)).toEqual({});
    fs.unlinkSync(tmpFile);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../config/configLoader'`

- [ ] **Step 3: Implement configLoader.js**

Create `config/configLoader.js`:

```javascript
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
  const teamPath = path.join(process.cwd(), 'team.config.json');
  const personalPath = path.join(os.homedir(), '.superbash', 'personal.json');

  const team = loadJson(teamPath);
  const personal = loadJson(personalPath);

  return deepMerge(deepMerge(DEFAULT_CONFIG, team), personal);
}

module.exports = { load, deepMerge, loadJson };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add config/configLoader.js tests/configLoader.test.js
git commit -m "feat: add config loader with deep merge (team + personal)"
```

---

### Task 3: PTY Manager

**Files:**
- Create: `shell/ptyManager.js`

- [ ] **Step 1: Create ptyManager.js**

Create `shell/ptyManager.js`:

```javascript
const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Returns the default shell path for the current platform. */
function getDefaultShell() {
  if (process.platform === 'win32') {
    return 'C:/Program Files/Git/bin/bash.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

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
  // Source default user config so their prompt/functions survive
  content += '[ -f ~/.bashrc ] && source ~/.bashrc\n';
  content += '[ -f ~/.bash_profile ] && source ~/.bash_profile\n';

  for (const [key, cmd] of Object.entries(aliases)) {
    // Escape single quotes inside the command
    const escaped = cmd.replace(/'/g, "'\\''");
    content += `alias ${key}='${escaped}'\n`;
  }

  fs.writeFileSync(tmpPath, content, { mode: 0o700 });
  return tmpPath;
}

class PtyManager {
  constructor() {
    /** @type {Map<string, import('node-pty').IPty>} */
    this.sessions = new Map();

    /** Track temp init files so we can clean them up on exit. */
    this._tmpFiles = new Set();
  }

  /**
   * Spawns a new PTY session.
   * @param {object} opts
   * @param {number} [opts.cols=80]
   * @param {number} [opts.rows=24]
   * @param {Record<string,string>} [opts.env={}]
   * @param {string|null} [opts.shellPath]
   * @param {Record<string,string>} [opts.aliases={}]
   * @returns {string} sessionId
   */
  create({ cols = 80, rows = 24, env = {}, shellPath = null, aliases = {} } = {}) {
    const shell = shellPath || getDefaultShell();
    const sessionId = crypto.randomUUID();

    let args = [];

    // Inject aliases via a temp --init-file when shell is bash
    const hasAliases = Object.keys(aliases).length > 0;
    const isBash = shell.toLowerCase().includes('bash');
    if (hasAliases && isBash) {
      const initFile = createAliasInitFile(aliases);
      this._tmpFiles.add(initFile);
      args = ['--init-file', initFile];
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: { ...process.env, ...env },
    });

    this.sessions.set(sessionId, ptyProcess);
    return sessionId;
  }

  /** Write data to a PTY session (user keystrokes). */
  write(sessionId, data) {
    const p = this.sessions.get(sessionId);
    if (p) p.write(data);
  }

  /** Resize a PTY session when the terminal pane resizes. */
  resize(sessionId, cols, rows) {
    const p = this.sessions.get(sessionId);
    if (p) {
      try {
        p.resize(cols, rows);
      } catch {
        // PTY may have exited; ignore resize errors
      }
    }
  }

  /** Register a callback for data arriving from a PTY session. */
  onData(sessionId, callback) {
    const p = this.sessions.get(sessionId);
    if (p) p.onData(callback);
  }

  /** Register a callback for when the PTY process exits. */
  onExit(sessionId, callback) {
    const p = this.sessions.get(sessionId);
    if (p) p.onExit(({ exitCode }) => callback(exitCode));
  }

  /** Kill a single PTY session and remove it from the map. */
  destroy(sessionId) {
    const p = this.sessions.get(sessionId);
    if (!p) return;
    try { p.kill(); } catch { /* already dead */ }
    this.sessions.delete(sessionId);
  }

  /** Kill all sessions — call before app quit to avoid zombie processes. */
  destroyAll() {
    for (const sessionId of [...this.sessions.keys()]) {
      this.destroy(sessionId);
    }
    // Clean up temp alias init files
    for (const tmpFile of this._tmpFiles) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
    this._tmpFiles.clear();
  }
}

module.exports = PtyManager;
```

- [ ] **Step 2: Verify module loads without error**

```bash
node -e "const P = require('./shell/ptyManager'); console.log('ok', typeof P);"
```

Expected: `ok function`

- [ ] **Step 3: Commit**

```bash
git add shell/ptyManager.js
git commit -m "feat: add PTY manager with alias init file injection"
```

---

### Task 4: Preload (Context Bridge)

**Files:**
- Create: `preload.js`

- [ ] **Step 1: Create preload.js**

```javascript
/**
 * preload.js
 *
 * Runs in a privileged context with access to Node/Electron APIs.
 * Exposes a safe, typed API to the renderer via contextBridge.
 * nodeIntegration is disabled — the renderer cannot require() anything.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Config ─────────────────────────────────────────────────────────────────
  /** Loads merged team + personal config from main process. */
  loadConfig: () => ipcRenderer.invoke('config:load'),

  // ── PTY / Shell ────────────────────────────────────────────────────────────
  /**
   * Creates a new PTY session.
   * @param {{ cols: number, rows: number, env: object, shellPath: string|null, aliases: object }} opts
   * @returns {Promise<string>} sessionId
   */
  createShell: (opts) => ipcRenderer.invoke('shell:create', opts),

  /** Send keystrokes/data to the PTY. */
  writeToShell: (sessionId, data) =>
    ipcRenderer.send('shell:write', { sessionId, data }),

  /** Notify the PTY of a terminal resize. */
  resizeShell: (sessionId, cols, rows) =>
    ipcRenderer.send('shell:resize', { sessionId, cols, rows }),

  /** Kill a PTY session. */
  destroyShell: (sessionId) =>
    ipcRenderer.send('shell:destroy', { sessionId }),

  /**
   * Listen for output data from a PTY session.
   * @returns {() => void} unsubscribe function
   */
  onShellData: (sessionId, callback) => {
    const channel = `shell:data:${sessionId}`;
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * Listen for PTY process exit.
   * @returns {() => void} unsubscribe function
   */
  onShellExit: (sessionId, callback) => {
    const channel = `shell:exit:${sessionId}`;
    const handler = (_event, code) => callback(code);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // ── Window Controls ────────────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow:    () => ipcRenderer.send('window:close'),
});
```

- [ ] **Step 2: Commit**

```bash
git add preload.js
git commit -m "feat: add contextBridge preload exposing shell + config IPC"
```

---

### Task 5: Main Process

**Files:**
- Create: `main.js`

- [ ] **Step 1: Create main.js**

```javascript
/**
 * main.js — Electron main process
 *
 * Responsibilities:
 *   - Create the BrowserWindow (frameless)
 *   - Own all PTY sessions via PtyManager
 *   - Handle IPC messages from the renderer (config, shell ops, window controls)
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const PtyManager = require('./shell/ptyManager');
const ConfigLoader = require('./config/configLoader');

let mainWindow;
const ptyManager = new PtyManager();

// ── Window creation ──────────────────────────────────────────────────────────

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1400, width),
    height: Math.min(900, height),
    minWidth: 600,
    minHeight: 400,
    frame: false,                  // custom titlebar in renderer
    backgroundColor: '#0d0d0d',   // prevents white flash on load
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,      // renderer cannot access Node
      nodeIntegration: false,
      sandbox: false,              // required for preload to use require()
    },
  });

  mainWindow.loadFile('renderer/index.html');
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  ptyManager.destroyAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC: Config ──────────────────────────────────────────────────────────────

ipcMain.handle('config:load', () => ConfigLoader.load());

// ── IPC: Shell / PTY ─────────────────────────────────────────────────────────

ipcMain.handle('shell:create', (event, opts = {}) => {
  const sessionId = ptyManager.create(opts);

  // Forward PTY output to the renderer that requested the session
  ptyManager.onData(sessionId, (data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`shell:data:${sessionId}`, data);
    }
  });

  ptyManager.onExit(sessionId, (code) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`shell:exit:${sessionId}`, code);
    }
  });

  return sessionId;
});

ipcMain.on('shell:write', (_event, { sessionId, data }) => {
  ptyManager.write(sessionId, data);
});

ipcMain.on('shell:resize', (_event, { sessionId, cols, rows }) => {
  ptyManager.resize(sessionId, cols, rows);
});

ipcMain.on('shell:destroy', (_event, { sessionId }) => {
  ptyManager.destroy(sessionId);
});

// ── IPC: Window controls ─────────────────────────────────────────────────────

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());
```

- [ ] **Step 2: Sanity check — app should launch**

```bash
npm start
```

Expected: Electron window opens (blank white, no renderer files yet). No crash in main process. Close with Ctrl+C in terminal.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add Electron main process with PTY IPC handlers"
```

---

### Task 6: HTML Structure

**Files:**
- Create: `renderer/index.html`

- [ ] **Step 1: Create renderer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'"
  />
  <title>Super Bash</title>

  <!-- JetBrains Mono from Google Fonts (CDN fallback) -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet"
  />

  <!-- xterm.js v4 — UMD builds from node_modules (loaded before terminal.js) -->
  <link rel="stylesheet" href="../node_modules/xterm/css/xterm.css" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <!-- ── Custom titlebar (frameless window) ──────────────────────────── -->
  <div id="titlebar">
    <div id="app-title">Super Bash</div>
    <div id="window-controls">
      <button id="btn-minimize" title="Minimize">&#x2212;</button>
      <button id="btn-maximize" title="Maximize">&#x25A1;</button>
      <button id="btn-close"    title="Close">&#x2715;</button>
    </div>
  </div>

  <!-- ── Split terminal area ─────────────────────────────────────────── -->
  <div id="terminal-container">

    <!-- Left pane (always visible) -->
    <div class="terminal-pane active" id="pane-left">
      <div class="pane-titlebar">
        <span class="pane-cwd" id="cwd-left">~</span>
      </div>
      <div class="terminal-wrapper" id="terminal-left"></div>
    </div>

    <!-- Draggable divider -->
    <div id="pane-divider" class="hidden"></div>

    <!-- Right pane (hidden until Ctrl+Shift+T) -->
    <div class="terminal-pane hidden" id="pane-right">
      <div class="pane-titlebar">
        <span class="pane-cwd" id="cwd-right">~</span>
      </div>
      <div class="terminal-wrapper" id="terminal-right"></div>
    </div>

  </div>

  <!-- xterm.js UMD scripts — order matters: core first, then addons -->
  <script src="../node_modules/xterm/lib/xterm.js"></script>
  <script src="../node_modules/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
  <script src="../node_modules/xterm-addon-web-links/lib/xterm-addon-web-links.js"></script>
  <script src="../node_modules/xterm-addon-search/lib/xterm-addon-search.js"></script>

  <script src="terminal.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add renderer/index.html
git commit -m "feat: add renderer HTML with titlebar and split pane containers"
```

---

### Task 7: CSS Styling

**Files:**
- Create: `renderer/styles.css`

- [ ] **Step 1: Create renderer/styles.css**

```css
/* ── CSS variables (gold-on-black theme) ──────────────────────────────────── */
:root {
  --bg-primary:        #0d0d0d;
  --bg-secondary:      #141414;
  --bg-tertiary:       #1a1a1a;
  --accent:            #f0a500;
  --accent-dim:        rgba(240, 165, 0, 0.25);
  --text-primary:      #e0e0e0;
  --text-dim:          #555;
  --titlebar-height:   36px;
  --pane-header-height:28px;
  --divider-width:     4px;
  --border-radius:     0px;
}

/* ── Reset ────────────────────────────────────────────────────────────────── */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  user-select: none;
}

/* ── Custom titlebar ─────────────────────────────────────────────────────── */
#titlebar {
  height: var(--titlebar-height);
  background: var(--bg-secondary);
  border-bottom: 1px solid #1f1f1f;
  display: flex;
  align-items: center;
  /* -webkit-app-region: drag marks the whole bar as draggable */
  -webkit-app-region: drag;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

#app-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.12em;
  color: var(--accent);
  text-transform: uppercase;
  pointer-events: none;
}

#window-controls {
  margin-left: auto;
  display: flex;
  -webkit-app-region: no-drag;  /* buttons must opt out of drag */
}

#window-controls button {
  width: 46px;
  height: var(--titlebar-height);
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease, color 0.12s ease;
}

#window-controls button:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-primary);
}

#btn-close:hover {
  background: #c0392b !important;
  color: #fff !important;
}

/* ── Terminal container ───────────────────────────────────────────────────── */
#terminal-container {
  display: flex;
  flex-direction: row;
  height: calc(100vh - var(--titlebar-height));
  width: 100%;
  overflow: hidden;
}

/* ── Individual pane ─────────────────────────────────────────────────────── */
.terminal-pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 100px;
  overflow: hidden;
  border: 1px solid transparent;
  transition: border-color 0.15s ease;
}

.terminal-pane.active {
  border-color: var(--accent);
}

.terminal-pane.hidden {
  display: none;
}

/* ── Pane title bar (shows current working directory) ────────────────────── */
.pane-titlebar {
  height: var(--pane-header-height);
  background: var(--bg-tertiary);
  border-bottom: 1px solid #1f1f1f;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11px;
  color: var(--text-dim);
  flex-shrink: 0;
  transition: color 0.15s ease, border-color 0.15s ease;
  overflow: hidden;
}

.terminal-pane.active .pane-titlebar {
  color: var(--accent);
  border-bottom-color: var(--accent-dim);
}

.pane-cwd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── xterm.js terminal wrapper ───────────────────────────────────────────── */
.terminal-wrapper {
  flex: 1 1 0;
  overflow: hidden;
  padding: 4px;
  /* xterm.js renders a canvas that fills this container */
}

/* Override xterm.js to fill height properly */
.terminal-wrapper .xterm {
  height: 100%;
}

.terminal-wrapper .xterm-viewport {
  overflow-y: hidden !important;
}

/* ── Draggable divider between panes ─────────────────────────────────────── */
#pane-divider {
  width: var(--divider-width);
  min-width: var(--divider-width);
  background: #1a1a1a;
  cursor: col-resize;
  flex-shrink: 0;
  transition: background 0.15s ease;
  position: relative;
}

#pane-divider::after {
  /* Invisible wider hit area for easier dragging */
  content: '';
  position: absolute;
  inset: 0 -4px;
}

#pane-divider:hover,
#pane-divider.dragging {
  background: var(--accent);
}

#pane-divider.hidden {
  display: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/styles.css
git commit -m "feat: add gold-on-black CSS theme with split pane layout"
```

---

### Task 8: Terminal JavaScript (xterm.js + split logic)

**Files:**
- Create: `renderer/terminal.js`

**Note on xterm v4 UMD globals:** When loaded via `<script>` tags:
- `xterm/lib/xterm.js` → exposes `Terminal` class as `window.Terminal`
- `xterm-addon-fit/lib/xterm-addon-fit.js` → exposes `window.FitAddon` namespace; use `new FitAddon.FitAddon()`
- `xterm-addon-web-links/lib/xterm-addon-web-links.js` → `new WebLinksAddon.WebLinksAddon()`
- `xterm-addon-search/lib/xterm-addon-search.js` → `new SearchAddon.SearchAddon()`

- [ ] **Step 1: Create renderer/terminal.js**

```javascript
/**
 * terminal.js
 *
 * Manages xterm.js terminal instances for the left and right panes.
 * Handles: pane creation, split/close, divider drag-to-resize,
 * keyboard shortcuts, font zoom, and PTY ↔ xterm wiring.
 *
 * Globals provided by <script> tags in index.html (xterm v4 UMD builds):
 *   Terminal, FitAddon, WebLinksAddon, SearchAddon
 */

// ── Application state ────────────────────────────────────────────────────────

const state = {
  /** @type {{ term: Terminal, fitAddon: FitAddon, sessionId: string, unsubData: ()=>void, unsubExit: ()=>void } | null} */
  panes: {
    left:  null,
    right: null,
  },
  activePaneId: 'left',
  isSplit: false,
  fontSize: 14,
  /** @type {object} merged config from main process */
  config: null,
};

// ── xterm theme (matches styles.css) ────────────────────────────────────────

const XTERM_THEME = {
  background:     '#0d0d0d',
  foreground:     '#e0e0e0',
  cursor:         '#f0a500',
  cursorAccent:   '#0d0d0d',
  selectionBackground: 'rgba(240, 165, 0, 0.3)',
  black:          '#1a1a1a', red:          '#e06c75',
  green:          '#98c379', yellow:       '#e5c07b',
  blue:           '#61afef', magenta:      '#c678dd',
  cyan:           '#56b6c2', white:        '#abb2bf',
  brightBlack:    '#3e4451', brightRed:    '#e06c75',
  brightGreen:    '#98c379', brightYellow: '#e5c07b',
  brightBlue:     '#61afef', brightMagenta:'#c678dd',
  brightCyan:     '#56b6c2', brightWhite:  '#ffffff',
};

// ── Initialization ───────────────────────────────────────────────────────────

async function init() {
  // Load merged config (team + personal) from main process
  state.config = await window.electronAPI.loadConfig();
  state.fontSize = state.config.fontSize || 14;

  // Left pane is always open at startup
  await createPane('left');

  // Wire titlebar window control buttons
  document.getElementById('btn-minimize').addEventListener('click', () =>
    window.electronAPI.minimizeWindow()
  );
  document.getElementById('btn-maximize').addEventListener('click', () =>
    window.electronAPI.maximizeWindow()
  );
  document.getElementById('btn-close').addEventListener('click', () =>
    window.electronAPI.closeWindow()
  );

  // Divider drag-to-resize
  initDividerDrag();

  // Global keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeydown);

  // Re-fit terminals when the Electron window is resized
  window.addEventListener('resize', () => fitAll());

  setActivePane('left');
}

// ── Pane creation ────────────────────────────────────────────────────────────

/**
 * Creates an xterm Terminal, loads addons, opens it in the DOM,
 * spawns a PTY session, and wires the two together.
 */
async function createPane(paneId) {
  const container = document.getElementById(`terminal-${paneId}`);

  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Courier New", monospace',
    fontSize: state.fontSize,
    theme: XTERM_THEME,
    scrollback: 5000,
    cursorBlink: true,
    allowTransparency: false,
    // Let xterm handle Ctrl+Shift+C / Ctrl+Shift+V natively for copy/paste
    allowProposedApi: true,
  });

  const fitAddon     = new FitAddon.FitAddon();
  const webLinks     = new WebLinksAddon.WebLinksAddon();
  const searchAddon  = new SearchAddon.SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(webLinks);
  term.loadAddon(searchAddon);

  term.open(container);
  fitAddon.fit();

  // Spawn PTY in main process
  const sessionId = await window.electronAPI.createShell({
    cols:      term.cols,
    rows:      term.rows,
    env:       state.config.env || {},
    shellPath: state.config.shellPath || null,
    aliases:   state.config.aliases || {},
  });

  // Keystrokes → PTY
  term.onData((data) => {
    window.electronAPI.writeToShell(sessionId, data);
  });

  // PTY output → terminal display
  const unsubData = window.electronAPI.onShellData(sessionId, (data) => {
    term.write(data);
  });

  // PTY exit notification
  const unsubExit = window.electronAPI.onShellExit(sessionId, () => {
    term.write('\r\n\x1b[33m[Process exited — press any key to close pane]\x1b[0m\r\n');
  });

  // Print startup message from config (styled in amber)
  if (state.config.startupMessage) {
    term.write(`\x1b[33m${state.config.startupMessage}\x1b[0m\r\n`);
  }

  // Update pane CWD label when shell reports a title change via OSC 0/2
  term.onTitleChange((title) => {
    if (title) {
      document.getElementById(`cwd-${paneId}`).textContent = title;
    }
  });

  // Clicking inside the terminal wrapper focuses that pane
  container.addEventListener('mousedown', () => setActivePane(paneId));

  state.panes[paneId] = { term, fitAddon, sessionId, unsubData, unsubExit };
}

// ── Pane focus ───────────────────────────────────────────────────────────────

function setActivePane(paneId) {
  if (!state.panes[paneId]) return;
  state.activePaneId = paneId;

  document.querySelectorAll('.terminal-pane').forEach((el) =>
    el.classList.remove('active')
  );
  document.getElementById(`pane-${paneId}`).classList.add('active');
  state.panes[paneId].term.focus();
}

// ── Split open / close ───────────────────────────────────────────────────────

async function openSplit() {
  if (state.isSplit) return;
  state.isSplit = true;

  document.getElementById('pane-right').classList.remove('hidden');
  document.getElementById('pane-divider').classList.remove('hidden');

  await createPane('right');
  fitAll();
  setActivePane('right');
}

function closePane(paneId) {
  const pane = state.panes[paneId];
  if (!pane) return;

  // Tear down listeners and kill the PTY session
  pane.unsubData();
  pane.unsubExit();
  window.electronAPI.destroyShell(pane.sessionId);
  pane.term.dispose();
  state.panes[paneId] = null;

  if (paneId === 'right') {
    state.isSplit = false;
    document.getElementById('pane-right').classList.add('hidden');
    document.getElementById('pane-divider').classList.add('hidden');
    // Reset left pane flex so it fills the container again
    document.getElementById('pane-left').style.flex = '';
    setActivePane('left');
  } else if (paneId === 'left') {
    // Closing the left pane also closes right (no orphan panes)
    if (state.panes.right) closePane('right');
  }
}

// ── Fit all visible terminals ─────────────────────────────────────────────────

function fitAll() {
  for (const paneId of Object.keys(state.panes)) {
    const pane = state.panes[paneId];
    if (!pane) continue;
    pane.fitAddon.fit();
    window.electronAPI.resizeShell(pane.sessionId, pane.term.cols, pane.term.rows);
  }
}

// ── Divider drag-to-resize ───────────────────────────────────────────────────

function initDividerDrag() {
  const divider   = document.getElementById('pane-divider');
  const container = document.getElementById('terminal-container');
  const leftPane  = document.getElementById('pane-left');
  const rightPane = document.getElementById('pane-right');

  let isDragging    = false;
  let startX        = 0;
  let startLeftPx   = 0;

  divider.addEventListener('mousedown', (e) => {
    isDragging  = true;
    startX      = e.clientX;
    startLeftPx = leftPane.getBoundingClientRect().width;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    // Prevent text selection while dragging
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const totalWidth   = container.getBoundingClientRect().width;
    const dividerWidth = divider.getBoundingClientRect().width;
    const delta        = e.clientX - startX;
    const newLeft      = Math.max(
      100,
      Math.min(totalWidth - dividerWidth - 100, startLeftPx + delta)
    );
    const pct = (newLeft / totalWidth) * 100;

    // Set left pane to a fixed percentage; right pane takes the rest
    leftPane.style.flex  = `0 0 ${pct}%`;
    rightPane.style.flex = `1 1 0`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    // Re-fit after resize so xterm columns update
    fitAll();
  });
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────

function handleGlobalKeydown(e) {
  const { ctrlKey, shiftKey, key } = e;

  // Ctrl+Shift+T — open split pane
  if (ctrlKey && shiftKey && key === 'T') {
    e.preventDefault();
    openSplit();
    return;
  }

  // Ctrl+Shift+W — close focused pane
  if (ctrlKey && shiftKey && key === 'W') {
    e.preventDefault();
    closePane(state.activePaneId);
    return;
  }

  // Ctrl+Tab — switch focus between panes
  if (ctrlKey && key === 'Tab') {
    e.preventDefault();
    if (state.isSplit) {
      setActivePane(state.activePaneId === 'left' ? 'right' : 'left');
    }
    return;
  }

  // Ctrl+Shift+C — copy terminal selection to clipboard
  if (ctrlKey && shiftKey && key === 'C') {
    e.preventDefault();
    const pane = state.panes[state.activePaneId];
    if (pane) {
      const text = pane.term.getSelection();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
    }
    return;
  }

  // Ctrl+Shift+V — paste from clipboard to active terminal
  if (ctrlKey && shiftKey && key === 'V') {
    e.preventDefault();
    const pane = state.panes[state.activePaneId];
    if (pane) {
      navigator.clipboard.readText().then((text) => {
        if (text) window.electronAPI.writeToShell(pane.sessionId, text);
      }).catch(() => {});
    }
    return;
  }

  // Ctrl+= or Ctrl+Plus — increase font size
  if (ctrlKey && !shiftKey && (key === '=' || key === '+')) {
    e.preventDefault();
    adjustFontSize(+1);
    return;
  }

  // Ctrl+- — decrease font size
  if (ctrlKey && !shiftKey && key === '-') {
    e.preventDefault();
    adjustFontSize(-1);
    return;
  }
}

function adjustFontSize(delta) {
  state.fontSize = Math.max(8, Math.min(32, state.fontSize + delta));
  for (const pane of Object.values(state.panes)) {
    if (!pane) continue;
    pane.term.options.fontSize = state.fontSize;
    pane.fitAddon.fit();
    window.electronAPI.resizeShell(pane.sessionId, pane.term.cols, pane.term.rows);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Commit**

```bash
git add renderer/terminal.js
git commit -m "feat: add xterm.js terminal with split panes, divider drag, and keyboard shortcuts"
```

---

### Task 9: Example Config Files

**Files:**
- Create: `team.config.json`
- Create: `examples/personal.json`

- [ ] **Step 1: Create team.config.json**

```json
{
  "_comment": "Super Bash — team-shared config. Commit this file. Personal overrides go in ~/.superbash/personal.json.",
  "startupMessage": "Welcome to Super Bash — team workspace. Type 'help-team' for project shortcuts.",
  "aliases": {
    "gs":        "git status",
    "gp":        "git push",
    "gl":        "git pull",
    "glog":      "git log --oneline --graph --decorate -20",
    "gco":       "git checkout",
    "nrd":       "npm run dev",
    "nrt":       "npm run test",
    "help-team": "echo 'Aliases: gs gp gl glog gco nrd nrt'"
  },
  "env": {
    "SUPER_BASH": "1",
    "FORCE_COLOR": "1"
  }
}
```

- [ ] **Step 2: Create examples/personal.json**

```json
{
  "_comment": "Copy this to ~/.superbash/personal.json and customize. Personal settings override team.config.json.",
  "shellPath": null,
  "fontSize": 14,
  "startupMessage": "",
  "theme": {
    "background": "#0d0d0d",
    "accent": "#f0a500"
  },
  "aliases": {
    "ll":   "ls -la --color=auto",
    "..":   "cd ..",
    "...":  "cd ../.."
  },
  "env": {
    "EDITOR": "vim"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add team.config.json examples/personal.json
git commit -m "feat: add example team and personal config files"
```

---

### Task 10: Manual Testing Checklist

- [ ] **Step 1: Start the app**

```bash
npm start
```

Expected: Frameless window opens. Custom titlebar shows "Super Bash" in gold. Left pane shows a bash prompt.

- [ ] **Step 2: Verify shell works**

In the left terminal, type: `echo hello && ls -la`

Expected: Output printed with colors. Prompt returns.

- [ ] **Step 3: Verify split (Ctrl+Shift+T)**

Press `Ctrl+Shift+T`. Expected: Right pane appears with its own bash prompt. Active border is gold.

- [ ] **Step 4: Verify divider drag**

Drag the divider between panes. Expected: Both panes resize, terminals re-fit (no content clipping).

- [ ] **Step 5: Verify pane focus (Ctrl+Tab)**

Press `Ctrl+Tab`. Expected: Focus moves to the other pane. Gold border shifts.

- [ ] **Step 6: Verify font zoom**

Press `Ctrl+=` three times. Expected: Font size increases. Press `Ctrl+-` three times to restore.

- [ ] **Step 7: Verify copy/paste**

Select text in terminal with mouse. Press `Ctrl+Shift+C`. Open a text editor and paste — clipboard should contain the selection. Then press `Ctrl+Shift+V` with something on clipboard — text should appear in terminal.

- [ ] **Step 8: Verify aliases from team.config.json**

In terminal, type `gs` and press Enter. Expected: `git status` output (or "not a git repo" error — either confirms alias works).

- [ ] **Step 9: Verify close pane (Ctrl+Shift+W)**

With two panes open, press `Ctrl+Shift+W`. Expected: Focused pane closes, single pane fills window.

- [ ] **Step 10: Verify window controls**

Click minimize, maximize, close buttons in titlebar. Expected: Each works as expected. Close exits the app.

- [ ] **Step 11: Verify interactive programs**

In terminal, type `vim` and press Enter. Expected: vim opens with proper rendering. Press `:q` to exit.

- [ ] **Step 12: Commit final state**

```bash
git add .
git commit -m "feat: complete Super Bash v1.0 — split terminal Electron app"
```

---

## Spec Coverage Checklist

| Requirement | Task |
|-------------|------|
| Split terminal with two independent PTY panes | Task 8 (`openSplit`, `createPane`) |
| Draggable divider with xterm fit-on-release | Task 8 (`initDividerDrag` + `fitAll`) |
| Pane titlebar showing CWD | Tasks 6, 8 (`term.onTitleChange`) |
| Active pane gold border highlight | Tasks 7, 8 (`setActivePane`) |
| Windows: Git Bash shell / Mac+Linux: $SHELL | Task 3 (`getDefaultShell`) |
| Full PTY — vim/htop/colors work | Task 3 (`name: 'xterm-256color'`) |
| JetBrains Mono font via Google Fonts CDN | Tasks 6, 7 |
| 14px default font size | Tasks 3, 8 (`fontSize: 14`) |
| Ctrl+= / Ctrl+- font zoom | Task 8 (`adjustFontSize`) |
| Deep dark (#0d0d0d) + gold (#f0a500) theme | Task 7 |
| Frameless window with custom titlebar | Tasks 5, 6, 7 |
| 5000-line scrollback | Task 8 (`scrollback: 5000`) |
| Team config (aliases, env, startupMessage, shellPath) | Tasks 2, 3, 9 |
| Personal config override | Task 2 (`deepMerge`) |
| Alias injection into shell | Task 3 (`createAliasInitFile`) |
| Env injection into PTY | Task 3 (`env: { ...process.env, ...env }`) |
| Startup message printed to terminal | Task 8 (`state.config.startupMessage`) |
| Ctrl+Shift+T — open split | Task 8 |
| Ctrl+Shift+W — close pane | Task 8 |
| Ctrl+Tab — switch focus | Task 8 |
| Ctrl+Shift+C/V — copy/paste | Task 8 |
| contextIsolation: true + contextBridge | Task 4 |
| node-pty in main process only | Tasks 3, 5 |
| electron-builder NSIS + DMG | Task 1 |
| Example config files | Task 9 |
