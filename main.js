/**
 * main.js — Electron main process
 *
 * Responsibilities:
 *   - Create the BrowserWindow (frameless)
 *   - Own all PTY sessions via PtyManager
 *   - Handle IPC messages from the renderer (config, shell ops, window controls)
 */

const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Tray, Menu, nativeImage } = require('electron');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');
const { exec } = require('child_process');
const PtyManager   = require('./shell/ptyManager');
const ConfigLoader = require('./config/configLoader');
const GitProfileManager = require('./config/gitProfileManager');
const { resolveShellPath, expandHome, readTeamSnippets, parseGitStatus } = require('./shell/utils');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray = null;
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

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Super Bash');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  // Auto-update — only active in packaged builds, not during `npm start`
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-available', () => {
      mainWindow?.webContents.send('updater:status', 'update-available');
    });
    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('updater:status', 'update-downloaded');
    });
    autoUpdater.on('error', (err) => {
      console.error('auto-update error', err.message);
    });
  }

  createTray();

  // Ctrl+` toggles the window — works system-wide even when the app is hidden
  globalShortcut.register('CommandOrControl+`', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // With tray support the window is hidden, not destroyed — only quit when
  // the user explicitly chooses Quit from the tray menu (app.isQuitting = true).
  if (app.isQuitting) {
    ptyManager.destroyAll();
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC: Config ──────────────────────────────────────────────────────────────

ipcMain.handle('config:load', () => ConfigLoader.load());

// ── IPC: Team snippets ────────────────────────────────────────────────────────

ipcMain.handle('snippets:load-team', (_event, rawPath) => {
  return readTeamSnippets(expandHome(rawPath));
});

ipcMain.handle('snippets:sync', async (_event, rawPath) => {
  const filePath = expandHome(rawPath);
  const dir = path.dirname(filePath);

  const pullResult = await new Promise((resolve) => {
    exec('git pull', { cwd: dir, timeout: 30000, windowsHide: true },
      (err, stdout, stderr) => resolve({ err, stdout, stderr })
    );
  });

  if (pullResult.err) {
    return { ok: false, error: pullResult.stderr || pullResult.err.message, snippets: [] };
  }

  return { ok: true, snippets: readTeamSnippets(filePath) };
});

// ── IPC: Per-project profile ──────────────────────────────────────────────────

ipcMain.handle('profile:check', (_event, dirPath) => {
  try {
    const resolved = resolveShellPath(dirPath);
    const raw = fs.readFileSync(path.join(resolved, '.superbash'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

// ── IPC: Git profiles ─────────────────────────────────────────────────────────

ipcMain.handle('gitProfile:list', () => GitProfileManager.load());

ipcMain.handle('gitProfile:save', (_event, data) => {
  GitProfileManager.save(data);
  return { ok: true };
});

ipcMain.handle('gitProfile:switch', (_event, { profileId, scope, cwd }) => {
  return GitProfileManager.switchProfile({ profileId, scope, cwd: resolveShellPath(cwd) });
});

// ── IPC: Git status ───────────────────────────────────────────────────────────

function runGit(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

ipcMain.handle('git:status', async (_event, dirPath) => {
  const cwd = resolveShellPath(dirPath);
  const [branch, porcelain, aheadBehind] = await Promise.all([
    runGit('git rev-parse --abbrev-ref HEAD', cwd),
    runGit('git status --porcelain',          cwd),
    runGit('git rev-list --left-right --count HEAD...@{upstream}', cwd),
  ]);

  return parseGitStatus(branch, porcelain, aheadBehind);
});

// ── IPC: Session persistence ──────────────────────────────────────────────────

const SESSION_PATH = path.join(os.homedir(), '.superbash', 'session.json');

ipcMain.handle('session:load', () => {
  try {
    return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('session:save', (_event, data) => {
  try {
    const dir = path.dirname(SESSION_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('session:save error', e.message);
  }
});

// ── IPC: Shell history ────────────────────────────────────────────────────────

ipcMain.handle('history:load', () => {
  const histPath = path.join(os.homedir(), '.bash_history');
  try {
    const lines = fs.readFileSync(histPath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#')); // strip blank lines and HISTTIMEFORMAT stamps
    // Deduplicate keeping the most-recent occurrence of each command
    const seen = new Set();
    const unique = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!seen.has(lines[i])) {
        seen.add(lines[i]);
        unique.push(lines[i]);
      }
    }
    return unique.slice(0, 50).reverse(); // oldest → newest order
  } catch {
    return [];
  }
});

// ── IPC: Shell / PTY ─────────────────────────────────────────────────────────

ipcMain.handle('shell:create', (event, opts = {}) => {
  let sessionId;
  sessionId = ptyManager.create({
    ...opts,
    onData: (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`shell:data:${sessionId}`, data);
      }
    },
    onExit: (code) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`shell:exit:${sessionId}`, code);
      }
    },
  });
  return sessionId;
});

ipcMain.on('shell:write', (_event, { sessionId, data }) => {
  ptyManager.write(sessionId, data);
});

ipcMain.on('shell:resize', (_event, { sessionId, cols, rows }) => {
  if (typeof cols === 'number' && typeof rows === 'number' && cols >= 1 && rows >= 1) {
    ptyManager.resize(sessionId, Math.floor(cols), Math.floor(rows));
  }
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
ipcMain.on('window:close',   () => mainWindow.close());
ipcMain.on('window:opacity', (_event, opacity) => mainWindow.setOpacity(opacity));

// ── IPC: Settings ────────────────────────────────────────────────────────────

ipcMain.handle('settings:save', (_event, overrides) => {
  const personalPath = path.join(os.homedir(), '.superbash', 'personal.json');
  try {
    const dir = path.dirname(personalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Merge incoming overrides into the existing personal.json (preserve other keys)
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(personalPath, 'utf8')); } catch { /* new file */ }
    const merged = { ...existing, ...overrides };
    // Remove null/undefined values so unset keys are stripped
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined) delete merged[k];
    }
    fs.writeFileSync(personalPath, JSON.stringify(merged, null, 2), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Help ─────────────────────────────────────────────────────────────────

ipcMain.on('help:open', () => {
  shell.openPath(path.join(__dirname, 'FEATURES.md'));
});
