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
const os   = require('os');
const fs   = require('fs');
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
ipcMain.on('window:close', () => mainWindow.close());
