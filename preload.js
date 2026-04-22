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

  // ── Team snippets ──────────────────────────────────────────────────────────
  /** Load snippets from a team-snippets.json file — returns snippet[]. */
  loadTeamSnippets:  (filePath) => ipcRenderer.invoke('snippets:load-team', filePath),
  /** git pull then reload — returns { ok, snippets, error? }. */
  syncTeamSnippets:  (filePath) => ipcRenderer.invoke('snippets:sync', filePath),

  // ── Per-project profile ────────────────────────────────────────────────────
  /** Read .superbash from dirPath — returns parsed object or null if absent. */
  checkProfile: (dirPath) => ipcRenderer.invoke('profile:check', dirPath),

  // ── Git status ─────────────────────────────────────────────────────────────
  /** Run git queries for dirPath — returns { isRepo, branch, dirty, ahead, behind }. */
  getGitStatus: (dirPath) => ipcRenderer.invoke('git:status', dirPath),

  // ── Session persistence ────────────────────────────────────────────────────
  /** Load saved session from ~/.superbash/session.json — returns null if absent. */
  loadSession: () => ipcRenderer.invoke('session:load'),
  /** Persist session state to ~/.superbash/session.json. */
  saveSession: (data) => ipcRenderer.invoke('session:save', data),

  // ── Shell history ──────────────────────────────────────────────────────────
  /** Read last 50 unique commands from ~/.bash_history — returns string[]. */
  loadHistory: () => ipcRenderer.invoke('history:load'),

  // ── Window Controls ────────────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow:    () => ipcRenderer.send('window:close'),
  setOpacity:     (opacity) => ipcRenderer.send('window:opacity', opacity),

  // ── Settings ──────────────────────────────────────────────────────────────
  saveSettings: (overrides) => ipcRenderer.invoke('settings:save', overrides),

  // ── Help ──────────────────────────────────────────────────────────────────
  openHelp: () => ipcRenderer.send('help:open'),

  // ── Auto-updater ───────────────────────────────────────────────────────────
  onUpdaterStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});
