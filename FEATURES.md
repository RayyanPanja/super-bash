# Super Bash — Feature Reference

> A frameless Electron terminal built as a Git Bash replacement.  
> Gold-on-black theme · PTY-backed shells · Zero restart config.

---

## Table of Contents

1. [Multi-Tab Terminal](#1-multi-tab-terminal)
2. [Split Panes](#2-split-panes)
3. [Session Restore](#3-session-restore)
4. [Command Palette](#4-command-palette)
5. [Config System](#5-config-system)
6. [Per-Project Profiles](#6-per-project-profiles)
7. [Git Status Bar](#7-git-status-bar)
8. [Broadcast Mode](#8-broadcast-mode)
9. [Window Opacity](#9-window-opacity)
10. [Team Snippet Sync](#10-team-snippet-sync)
11. [Keyboard Shortcuts](#11-keyboard-shortcuts)

---

## 1. Multi-Tab Terminal

Open as many shell sessions as you need, each in its own tab.

| Action | How |
|--------|-----|
| New tab | `Ctrl+T` or the **+** button |
| Close tab | `Ctrl+W` or the **×** on the tab |
| Switch to tab N | `Ctrl+1` … `Ctrl+9` |

Each tab has its own independent PTY session. The tab label shows the current working directory (last path segment). Tabs persist across splits and survive pane closures.

---

## 2. Split Panes

Every tab can be split into a **left** and **right** pane, each running its own separate shell.

| Action | How |
|--------|-----|
| Split active tab | `Ctrl+Shift+T` |
| Close focused pane | `Ctrl+Shift+W` |
| Toggle focus left ↔ right | `Ctrl+Tab` |
| Resize | Drag the gold divider |

Closing the **left** pane closes the right one too (no orphaned panes). The divider snaps to a minimum of 100 px on each side.

---

## 3. Session Restore

When you reopen the app, your previous tabs and split layout are restored — including the working directory of each pane.

- Persisted to `~/.superbash/session.json`
- Restore CWD by sending `cd "<path>"` into each recreated pane
- Disable by setting `"restoreSession": false` in `personal.json`

---

## 4. Command Palette

A fuzzy-search launcher for aliases, snippets, and shell history.

**Open with `Ctrl+P`**

```
> deploy stag_____________
  [alias]  pa        php artisan
  [snip]   Deploy staging    git push staging main
  [team]   Clear Laravel cache   php artisan cache:clear …
  [hist]   docker-compose up -d
```

| Badge | Source |
|-------|--------|
| `alias` | Aliases from `team.config.json` / `personal.json` |
| `snip`  | Personal snippets array in config |
| `team`  | Snippets pulled from the shared team repo |
| `hist`  | Last 50 unique commands from `~/.bash_history` |

- **Arrow keys** navigate, **Enter** runs, **Esc** closes
- Multi-line commands are sent with a 120 ms delay between lines
- Fuzzy scoring: exact → prefix → contains → subsequence

---

## 5. Config System

Three-layer merge — lower layers are overridden by higher ones:

```
DEFAULT_CONFIG  →  team.config.json  →  ~/.superbash/personal.json
  (built-in)       (committed, shared)     (local, not committed)
```

**`personal.json` full example:**

```json
{
  "aliases": {
    "gs": "git status",
    "gp": "git push"
  },
  "env": {
    "EDITOR": "nano"
  },
  "snippets": [
    { "name": "My deploy", "command": "git push origin main" }
  ],
  "startupMessage": "Welcome back!",
  "fontSize": 15,
  "restoreSession": true,
  "teamSnippetsRepo": "~/dev/team/team-snippets.json"
}
```

Aliases are injected into the shell at PTY creation via a temporary `--init-file` script, so they work exactly like `.bashrc` aliases — no wrapper needed.

---

## 6. Per-Project Profiles

Place a `.superbash` file in any project root. Super Bash detects it automatically when you `cd` into that directory and unloads it when you leave.

**`.superbash` schema:**

```json
{
  "profile": "laravel",
  "aliases": {
    "pa":   "php artisan",
    "pam":  "php artisan migrate",
    "pamf": "php artisan migrate:fresh",
    "pams": "php artisan migrate --seed",
    "nrd":  "npm run dev",
    "nrb":  "npm run build"
  },
  "env": {
    "APP_ENV": "local"
  },
  "startupMessage": "Laravel project loaded"
}
```

**How it works:**

- CWD is tracked via `PROMPT_COMMAND` → OSC title escape (fires on every prompt)
- On directory change → reads `<cwd>/.superbash` via main-process IPC (no renderer Node access)
- **Load:** injects aliases + env into the running PTY with a single compound command; prints the `startupMessage` in amber
- **Unload:** runs `unalias …` and `unset …` to restore the base config
- Each pane tracks its own profile independently

Ready-to-use examples in `examples/laravel.superbash.json` and `examples/node.superbash.json`.

---

## 7. Git Status Bar

A 24 px bar pinned to the bottom of the window showing live git state for the **active pane's working directory**.

```
 ⎇ main   ● 3   ↑2 ↓1          [fetch]  [pull]  [push]
```

| Element | Meaning |
|---------|---------|
| `⎇ main` | Current branch name — **click** to run `git log --oneline -10` |
| `● 3` | Number of modified + untracked files (hidden when clean) |
| `↑2 ↓1` | Commits ahead / behind `origin` (hidden when even) |
| `fetch / pull / push` | Fires the git command into the active terminal |

- Refreshes every **3 seconds** automatically
- Also refreshes after every shell command (via PROMPT_COMMAND)
- Also refreshes when you switch tabs or panes
- Hidden (content invisible) when the active directory is not a git repo
- Uses `child_process.exec` in the main process — no shell pollution

---

## 8. Broadcast Mode

**Toggle with `Ctrl+Shift+B`** or the **⊛** button in the titlebar.

When active:
- Every keystroke typed in the focused pane is **simultaneously sent to all other open panes** across all tabs
- An amber **`⊛ BROADCAST ON`** banner appears at the top of every pane
- The titlebar button glows amber

Use cases: running the same command on multiple servers, seeding multiple test environments, demonstrating a sequence to multiple sessions.

Turning broadcast off removes the banners and restores isolated input. Each pane's terminal height is re-fitted automatically when the banner appears/disappears.

---

## 9. Window Opacity

**`Ctrl+Shift+O`** cycles through three opacity levels:

| Level | Opacity |
|-------|---------|
| 1 | 100% — fully opaque (default) |
| 2 | 85% — slightly transparent |
| 3 | 70% — see-through |

Useful for referencing documentation or designs behind the terminal without switching windows. Uses Electron's native `BrowserWindow.setOpacity()` — no CSS filter or backdrop tricks.

---

## 10. Team Snippet Sync

Share a snippet library with your whole team via a git repo.

**Setup — add one line to `~/.superbash/personal.json`:**

```json
{
  "teamSnippetsRepo": "~/dev/team/team-snippets.json"
}
```

**`team-snippets.json` schema** (committed to your shared repo):

```json
{
  "snippets": [
    { "name": "Deploy staging",       "command": "git push staging main" },
    { "name": "Clear Laravel cache",  "command": "php artisan cache:clear && php artisan config:clear" },
    { "name": "Docker restart",       "command": "docker-compose down && docker-compose up -d" }
  ]
}
```

**Sync button (↻) in the titlebar:**

1. Runs `git pull` in the directory containing the snippets file
2. Re-reads the file
3. Updates the command palette live — no restart needed

Team snippets appear with a **blue `team` badge** in the palette, visually distinct from personal snippets (green) and aliases (amber).

The sync button is hidden automatically if `teamSnippetsRepo` is not configured.

A full example is available at `examples/team-snippets.json`.

---

## 11. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close active tab |
| `Ctrl+1`–`9` | Switch to tab N |
| `Ctrl+Shift+T` | Split active tab |
| `Ctrl+Shift+W` | Close focused pane |
| `Ctrl+Tab` | Toggle pane focus left ↔ right |
| `Ctrl+P` | Open command palette |
| `Ctrl+Shift+C` | Copy selection |
| `Ctrl+Shift+V` | Paste from clipboard |
| `Ctrl+=` / `Ctrl++` | Increase font size |
| `Ctrl+-` | Decrease font size |
| `Ctrl+Shift+B` | Toggle broadcast mode |
| `Ctrl+Shift+O` | Cycle window opacity |

---

## Config File Locations

| File | Purpose |
|------|---------|
| `team.config.json` | Shared team defaults (committed to repo) |
| `~/.superbash/personal.json` | Personal overrides (not committed) |
| `~/.superbash/session.json` | Saved tab/pane layout (auto-managed) |
| `<project>/.superbash` | Per-project profile (committed per-project) |
| `<path>/team-snippets.json` | Shared snippet library (in a team repo) |

---

*Super Bash — built with Electron, xterm.js, and node-pty.*
