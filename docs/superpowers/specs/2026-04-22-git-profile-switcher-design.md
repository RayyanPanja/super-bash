# Git Profile Switcher — Design Spec
**Date:** 2026-04-22  
**Status:** Approved

---

## Overview

A quick-switch system for git identities in Super Bash. Users working across personal, client, and team projects often need different `user.name` / `user.email` / signing keys. This feature adds a Settings modal (panel-style, extensible) with a Git Profiles panel as its first and only initial section.

---

## Architecture

### Layer responsibilities

| Layer | Responsibility |
|---|---|
| `main.js` | IPC handlers: `gitProfile:list`, `gitProfile:save`, `gitProfile:switch`. Runs all `git config` commands via `child_process.exec`. Reads/writes `~/.superbash/git-profiles.json`. |
| `preload.js` | Exposes `electronAPI.gitProfileList()`, `electronAPI.gitProfileSave(profile)`, `electronAPI.gitProfileSwitch({ profileId, scope, cwd })` via contextBridge. |
| `renderer/terminal.js` | Settings button in titlebar. Opens/closes settings modal. Handles profile selection clicks, add form, delete. Writes amber confirmation to active pane. Tracks active profile id in renderer state. |
| `~/.superbash/git-profiles.json` | Persistent profile storage. Read/written by main process only — never from renderer. |

### New IPC channels

- `gitProfile:list` → returns full `git-profiles.json` contents
- `gitProfile:save` → writes updated profiles array (add/delete/edit)
- `gitProfile:switch` → runs `git config` commands, updates `active` field, returns `{ ok, error? }`

### Auto-switch integration

Hooked into the existing `checkProjectProfile()` flow in `terminal.js`. When a loaded `.superbash` file contains a `gitProfile` key, the renderer fires `gitProfile:switch` automatically for that pane using `--local` scope. No changes to the existing profile loading logic for aliases/env vars.

---

## Storage Schema

**`~/.superbash/git-profiles.json`**

```json
{
  "active": "personal",
  "lastScope": "local",
  "profiles": [
    {
      "id": "personal",
      "name": "Rayyan – Personal",
      "gitUser": "rayyan",
      "gitEmail": "rayyan@example.com",
      "signingKey": ""
    },
    {
      "id": "vyxo",
      "name": "Rayyan – Vyxo",
      "gitUser": "rayyan-vyxo",
      "gitEmail": "rayyan@vyxo.in",
      "signingKey": ""
    }
  ]
}
```

- `active`: id of the currently active profile (updated on every switch)
- `lastScope`: persists the user's last-used scope toggle (`"local"` or `"global"`)
- `signingKey`: optional — if non-empty, also sets `user.signingkey` and `gpg.program gpg`

**`.superbash` project file extension**

```json
{
  "gitProfile": "vyxo"
}
```

Added alongside existing keys (`aliases`, `env`, `startupMessage`). Fully optional.

**`examples/git-profiles.json`** — shipped with the repo, 3 example profiles: personal, agency (vyxo), client-template (placeholder).

---

## UI

### Titlebar button

- Text label: active profile name (e.g. `Rayyan – Personal`), prefixed with a small git icon or `⚙` symbol
- Styled as a small amber-outlined pill, `-webkit-app-region: no-drag`
- Positioned in top-right titlebar, left of minimize/maximize/close buttons
- Falls back to `Settings` label if no profiles are loaded yet

### Settings modal

- Full-screen dim overlay (same pattern as command palette)
- Two-column layout: narrow left nav + content area
- Left nav: single item `Git Profiles` (amber highlight when active); empty rows below reserved for future settings categories
- Opened by titlebar button click, closed by Escape or clicking outside

### Git Profiles panel

- **Header:** "Git Profiles" title + amber `+` button (right-aligned)
- **Profile list:** each row shows profile name, git username, email
  - Active profile: amber left-border, amber text
  - Non-active rows: trash icon on right (hover-reveal); one-click switches
- **Scope toggle** (bottom of panel): `● Local  ○ Global` — defaults to Local, persists as `lastScope`
- **Add form** (inline, expands below list on `+` click):
  - Fields: Name, Git Username, Email, Signing Key (optional, placeholder "optional")
  - Save button + Escape to cancel
  - On save: profile added to list, NOT auto-activated
- **Delete:** cannot delete the active profile (trash icon hidden on active row)

---

## Switching Behavior

### Manual switch

1. User clicks a non-active profile row
2. Renderer calls `electronAPI.gitProfileSwitch({ profileId, scope, cwd })`
   - `cwd` is the active pane's current working directory
   - `scope` is `"local"` or `"global"` per the toggle
3. Main process runs sequentially:
   ```
   git config [--local|--global] user.name "<gitUser>"
   git config [--local|--global] user.email "<gitEmail>"
   git config [--local|--global] user.signingkey "<signingKey>"  // only if non-empty
   ```
4. On success: updates `active` in `git-profiles.json`, returns `{ ok: true }`
5. Renderer:
   - Closes the modal
   - Prints amber line to active pane: `Git profile switched to: Rayyan – Vyxo (rayyan@vyxo.in) [local]`
   - Updates titlebar button label

### Auto-switch (per-project)

- Triggered inside `checkProjectProfile()` when `.superbash` contains `gitProfile`
- Always uses `--local` scope (global makes no sense for a per-repo config)
- Same amber confirmation printed to that pane
- Does not update the scope toggle (which reflects the last manual switch scope)

---

## Error Handling

| Condition | Behavior |
|---|---|
| `--local` in a non-git directory | Main returns `{ ok: false, error: 'not-a-git-repo' }` → amber warning: `Git profile: not a git repo, profile not applied [local]` |
| `gitProfile` id in `.superbash` not found | Amber warning: `Git profile "vyxo" not found — check git-profiles.json` |
| `git config` command fails (other) | Amber warning with raw stderr message |
| `git-profiles.json` missing on first launch | Main creates it with an empty `profiles: []` array; titlebar shows `Settings` |

---

## What This Feature Does NOT Touch

- Tabs system
- Command palette
- Git status bar
- Broadcast mode
- Opacity toggle
- Snippet sync
- Session restore
- PTY / shell init logic (aliases, env injection)

---

## Example File

`examples/git-profiles.json`:

```json
{
  "active": "personal",
  "lastScope": "local",
  "profiles": [
    {
      "id": "personal",
      "name": "Rayyan – Personal",
      "gitUser": "rayyan",
      "gitEmail": "rayyan@personal.dev",
      "signingKey": ""
    },
    {
      "id": "vyxo",
      "name": "Rayyan – Vyxo (Agency)",
      "gitUser": "rayyan-vyxo",
      "gitEmail": "rayyan@vyxo.in",
      "signingKey": ""
    },
    {
      "id": "client-template",
      "name": "Client – Placeholder",
      "gitUser": "your-username",
      "gitEmail": "you@client.com",
      "signingKey": ""
    }
  ]
}
```
