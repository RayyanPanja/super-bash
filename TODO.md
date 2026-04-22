# Super Bash — Improvement Backlog

> Ordered by impact. Work through Tier 1 first — these are the things users will notice within the first five minutes.

---

## Tier 1 — Daily Pain (fix these first)

- [ ] **Ctrl+L — clear screen**
  Add `Ctrl+L` to `handleGlobalKeydown`. Send `\x0c` to the active pane's PTY or call `pane.term.clear()`. Single-digit lines of code, zero risk.

- [ ] **Wire up SearchAddon — in-terminal search**
  `searchAddon` is already loaded on every pane but nothing uses it. Add a `Ctrl+F` keybinding that opens a small inline search bar above the terminal wrapper. Use `searchAddon.findNext(query)` / `findPrevious(query)`. Add an `Escape` handler to close and return focus to the terminal.

- [ ] **New tab opens in current pane's CWD**
  `createTab()` always starts in `$HOME`. Pass `tab.panes[tab.activePaneId]?.cwd` as the `restoreCwd` argument when `Ctrl+T` is pressed from an active pane. One-liner change in the keyboard handler.

- [x] **Show errors from git bar and team sync to the user**
  `syncTeamSnippets()` receives `{ ok: false, error }` but silently discards it. The git bar buttons write commands that may fail while the user is on another tab. Add a small toast / status message somewhere visible — even writing the error into the active terminal with a red prefix is better than silence.

- [x] **Right-click context menu**
  No right-click → paste / copy. Use Electron's `Menu.buildFromTemplate` + `webContents.on('context-menu')` in `main.js` to show a minimal menu: Copy (if selection), Paste, separator, Clear. This is the first thing non-keyboard users will try.

- [x] **Visual activity indicator on background tabs**
  If output arrives on a tab that is not active, flash or dot-badge its tab button. Store an `hasActivity` flag per tab, set it in `onShellData` when `state.activeTabId !== tabId`, clear it on `switchTab`. Style the tab button with a subtle amber dot.

---

## Tier 2 — Expected Features

- [x] **Copy-on-select**
  Set `copyOnSelect: true` in the xterm `Terminal` constructor options. Large portion of terminal users expect this. One config key, zero other changes needed.

- [x] **Tab renaming**
  Double-click a tab label to enter an edit mode (replace `.tab-cwd` span with an `<input>`). On blur or Enter, save the custom name to `tab.customName`. If set, use it instead of `cwdLabel(pane.cwd)` in `updateTabLabel()`.

- [x] **Tab reordering via drag**
  Add `draggable="true"` to tab elements. Implement `dragstart`, `dragover`, `drop` handlers on `#tabs-list`. Reorder `state.tabs` array and re-insert DOM nodes to match. Call `saveSession()` after drop.

- [x] **Configurable font family**
  Add `fontFamily` to `DEFAULT_CONFIG` in `configLoader.js` (default `"JetBrains Mono, Courier New, monospace"`). Pass `state.config.fontFamily` to the xterm `Terminal` constructor and to the CSS variable `--font-family`. Users can then set it in `personal.json`.

- [x] **Bundle JetBrains Mono locally — remove CDN dependency**
  Download the WOFF2 file (~90 KB) into `renderer/fonts/`. Replace the Google Fonts `<link>` tags in `index.html` with a `@font-face` rule in `styles.css`. App then works fully offline and loads faster on first launch.

- [x] **Auto-update via electron-updater**
  Install `electron-updater`. Add `autoUpdater.checkForUpdatesAndNotify()` call in `main.js` after `createWindow()`. Add a `publish` config block to `package.json` (GitHub Releases is the simplest target). Users will get updates without manual downloads.

- [x] **Terminal bell handling**
  Set `bellStyle: 'visual'` (or `'sound'`) in the xterm constructor. Optionally: on BEL (`\x07`), flash the tab label or badge it — especially useful for long-running commands that ring when done.

- [x] **Ligature support**
  Enable the WebGL renderer addon (`xterm-addon-webgl`) or set `allowProposedApi: true` and use the canvas renderer with `fontLigatures: true`. JetBrains Mono's ligatures (`=>`, `!=`, `->`, `===`) will then render correctly.

- [x] **Global hotkey — Quake-style bring-to-front**
  Register a global shortcut in `main.js` via `globalShortcut.register('CommandOrControl+\`', ...)` that calls `mainWindow.show()` / `mainWindow.focus()` (or toggles visibility). This is the single feature that makes a terminal feel "always available."

---

## Tier 3 — Polish & Robustness

- [x] **Settings UI panel**
  Add a minimal settings overlay (similar to the command palette) accessible via a gear icon or `Ctrl+,`. Fields: font size slider, font family input, default shell path, opacity default, restoreSession toggle. Writes changes directly to `~/.superbash/personal.json` via a new `settings:save` IPC handler.

- [x] **Help button — open FEATURES.md in browser**
  Add a `?` button to the titlebar. On click, call `shell.openExternal('file:///.../FEATURES.md')` from main process. Surfaces docs without users having to find the file manually.

- [x] **Version field in session.json**
  Add `"version": 1` to the object written by `saveSession()`. On load, check the version and discard (with a `console.warn`) if it doesn't match. Prevents silent misbehavior after format-changing updates.

- [x] **Clear the git bar interval on app close**
  `setInterval(refreshGitBar, 3000)` runs forever. Store the return value and call `clearInterval()` in the `window-all-closed` handler (or on `beforeunload` in the renderer). Minor CPU/memory hygiene.

- [x] **Short-circuit profile:check IPC for same CWD**
  `checkProjectProfile` already has `_lastCheckedCwd` but still calls `window.electronAPI.checkProfile()` for new directories regardless. Cache the last `null` result too — if `_lastCheckedCwd === newCwd && pane.projectProfile === null`, skip the IPC call entirely.

- [x] **Tray icon — minimize to tray**
  Create a `Tray` instance in `main.js` with a small icon and a context menu (Show, Quit). Override the `close` event on `mainWindow` to `hide()` instead of quitting. Add a "Close to tray" toggle in settings.

- [x] **Test coverage — ptyManager and IPC handlers**
  Add Jest tests (with mocked `node-pty` and `child_process`) for:
  - `ptyManager.create()` — verifies alias file generation, session ID returned
  - `ptyManager.destroy()` — verifies cleanup and temp file deletion
  - `resolveShellPath()` — Windows path conversion cases
  - `readTeamSnippets()` — valid file, missing file, malformed JSON
  - `git:status` handler — parses ahead/behind output correctly

- [x] **Remove dead CSS — `#terminal-container` rule**
  The element doesn't exist in the HTML. Delete the `#terminal-container` block from `styles.css`.

- [x] **IME / CJK input validation**
  Test with a Japanese / Chinese IME on Windows. xterm v4 has known composition event quirks. If broken, set `windowsMode: true` in the xterm constructor (helps on Windows) and file upstream issues as needed. Document the result either way.

- [x] **Broadcast write queue per pane**
  In `broadcastToOthers`, if a target pane's PTY is under load, rapid keystrokes can flood it. Maintain a small per-pane queue that drains via `setImmediate` rather than writing synchronously to all PTYs in the same tick.

---

## Done

- [x] Multi-tab terminal with split panes
- [x] Session restore (tabs + CWD)
- [x] Command palette with fuzzy search (aliases, snippets, history)
- [x] Three-layer config merge (default → team → personal)
- [x] Per-project profiles via `.superbash`
- [x] Git status bar (branch, dirty, ahead/behind, fetch/pull/push)
- [x] Broadcast mode across all panes
- [x] Window opacity cycling
- [x] Team snippet sync via shared git repo
- [x] Windows Git Bash path conversion
- [x] Divider drag-to-resize
- [x] Font size zoom (Ctrl+= / Ctrl+-)
