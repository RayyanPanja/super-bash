# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Launch Electron app (development)
npm test           # Run Jest tests
npm run rebuild    # Rebuild native node-pty after Electron version changes
npm run build      # Package into NSIS installer (Windows) / DMG (Mac) via electron-builder
```

Run a single Jest test file:
```bash
npx jest tests/configLoader.test.js
```

## Architecture

Super Bash is a frameless Electron desktop app — a Git Bash replacement with split-pane terminals, PTY support, and team/personal config merging.

### Process Boundary

The app follows the standard Electron security model:
- **Main process** (`main.js`) owns all PTY sessions via `PtyManager` and handles IPC
- **Renderer** (`renderer/terminal.js`) communicates exclusively through `window.electronAPI`, exposed via contextBridge in `preload.js` (contextIsolation=true, nodeIntegration=false)

### PTY & Shell (`shell/ptyManager.js`)

`PtyManager` wraps `node-pty`. Each session gets a UUID key. Bash aliases from config are injected by writing a temp `--init-file` script that sources `.bashrc`/`.bash_profile` then registers the aliases. `destroyAll()` is called on app quit to prevent zombie PTY processes.

On Windows, the default shell is `C:/Program Files/Git/bin/bash.exe`.

### Config (`config/configLoader.js`)

Three-layer merge (lowest → highest priority):
1. `DEFAULT_CONFIG` (hardcoded fallback)
2. `team.config.json` (committed, shared defaults — aliases, env vars, startup message)
3. `~/.superbash/personal.json` (user overrides, not committed)

`deepMerge` is recursive for objects; arrays replace entirely (no concat). See `examples/personal.json` for the personal config format.

### Renderer (`renderer/terminal.js`)

Manages xterm.js v4 (loaded as UMD scripts in `index.html`). State is a plain `state` object tracking left/right panes, active pane, font size, and config. Panes are created with `createPane(paneId)` which wires keystrokes → PTY and PTY output → terminal.

Key flows:
- **Ctrl+Shift+T**: Unhides right pane, creates second PTY, refits both terminals
- **Ctrl+Shift+W**: Destroys focused pane's PTY, removes listeners; closing left also closes right
- **Divider drag**: Adjusts left pane flex-basis as a percentage, then calls `fitAll()` to recalculate xterm columns/rows
- **Font zoom** (Ctrl+=/−): Applies new `fontSize` to all active xterm instances, range 8–32px

PTY data/exit events are relayed from main → renderer via named IPC channels (`shell:data:${sessionId}`, `shell:exit:${sessionId}`).

### UI

`renderer/index.html` defines the frameless custom titlebar and two-pane flex layout. `renderer/styles.css` drives the gold-on-black theme (background `#0d0d0d`, accent `#f0a500`). The titlebar is `-webkit-app-region: drag`; window control buttons opt out with `no-drag`.
