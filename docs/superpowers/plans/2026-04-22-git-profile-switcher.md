# Git Profile Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings modal to Super Bash with a Git Profiles panel that lets users switch git identities per-pane, with optional per-project auto-switch via `.superbash`.

**Architecture:** A `config/gitProfileManager.js` module handles all file I/O and git config execution (testable, no IPC coupling). Three new IPC handlers in `main.js` wrap it. A standalone `renderer/settings-modal.js` owns the modal UI and communicates back to `terminal.js` via a DOM custom event (`gitProfileSwitched`).

**Tech Stack:** Electron (main + renderer), Node.js `child_process.exec`, vanilla JS/HTML/CSS, Jest (unit tests), xterm.js v4 for amber terminal output.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `config/gitProfileManager.js` | load/save `git-profiles.json`, run `git config` |
| Create | `tests/gitProfileManager.test.js` | unit tests for gitProfileManager |
| Create | `renderer/settings-modal.js` | modal open/close, profile list, add form, delete |
| Create | `renderer/settings-modal.css` | styles for settings button + modal |
| Create | `examples/git-profiles.json` | 3 example profiles shipped with repo |
| Modify | `main.js` | add `gitProfile:list`, `gitProfile:save`, `gitProfile:switch` handlers |
| Modify | `preload.js` | expose `gitProfileList`, `gitProfileSave`, `gitProfileSwitch` |
| Modify | `renderer/index.html` | settings button in titlebar, modal HTML, script/style includes |
| Modify | `renderer/terminal.js` | listen for `gitProfileSwitched`, write amber output, auto-switch hook |

---

## Task 1: gitProfileManager — load and save

**Files:**
- Create: `config/gitProfileManager.js`
- Create: `tests/gitProfileManager.test.js`

- [ ] **Step 1: Create `config/gitProfileManager.js` with load and save**

```javascript
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');

let _profilesPath = path.join(os.homedir(), '.superbash', 'git-profiles.json');

// Test hook — lets tests redirect file I/O to a temp path
function _setProfilesPath(p) { _profilesPath = p; }

const DEFAULT_DATA = { active: null, lastScope: 'local', profiles: [] };

function load() {
  try {
    if (!fs.existsSync(_profilesPath)) return { ...DEFAULT_DATA };
    return JSON.parse(fs.readFileSync(_profilesPath, 'utf8'));
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function save(data) {
  const dir = path.dirname(_profilesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(_profilesPath, JSON.stringify(data, null, 2), 'utf8');
}

function switchProfile({ profileId, scope, cwd }) {
  // implemented in Task 2
}

module.exports = { load, save, switchProfile, _setProfilesPath };
```

- [ ] **Step 2: Write failing tests for load and save**

```javascript
// tests/gitProfileManager.test.js
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { load, save, _setProfilesPath } = require('../config/gitProfileManager');

let tmpPath;

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `gp_test_${Date.now()}.json`);
  _setProfilesPath(tmpPath);
});

afterEach(() => {
  try { fs.unlinkSync(tmpPath); } catch {}
  _setProfilesPath(path.join(os.homedir(), '.superbash', 'git-profiles.json'));
});

describe('load', () => {
  test('returns default data when file does not exist', () => {
    expect(load()).toEqual({ active: null, lastScope: 'local', profiles: [] });
  });

  test('parses existing file correctly', () => {
    const data = { active: 'personal', lastScope: 'local', profiles: [{ id: 'personal', name: 'Test', gitUser: 'u', gitEmail: 'u@e.com', signingKey: '' }] };
    fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
    expect(load()).toEqual(data);
  });

  test('returns default data on malformed JSON', () => {
    fs.writeFileSync(tmpPath, '{ bad json', 'utf8');
    expect(load()).toEqual({ active: null, lastScope: 'local', profiles: [] });
  });
});

describe('save', () => {
  test('writes data as formatted JSON', () => {
    const data = { active: 'p1', lastScope: 'global', profiles: [] };
    save(data);
    expect(JSON.parse(fs.readFileSync(tmpPath, 'utf8'))).toEqual(data);
  });

  test('round-trips: save then load returns same data', () => {
    const data = { active: 'x', lastScope: 'local', profiles: [{ id: 'x', name: 'X', gitUser: 'xu', gitEmail: 'x@e.com', signingKey: '' }] };
    save(data);
    expect(load()).toEqual(data);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail correctly**

```
npx jest tests/gitProfileManager.test.js -t "load|save" --no-coverage
```

Expected: tests for `load` return-default and `save` round-trip pass (load already implemented); `switchProfile` tests will be added in Task 2.

- [ ] **Step 4: Run all tests to check nothing is broken**

```
npm test
```

Expected: all existing tests pass, new load/save tests pass.

- [ ] **Step 5: Commit**

```bash
git add config/gitProfileManager.js tests/gitProfileManager.test.js
git commit -m "feat: add gitProfileManager load/save with tests"
```

---

## Task 2: gitProfileManager — switchProfile

**Files:**
- Modify: `config/gitProfileManager.js` (implement `switchProfile`)
- Modify: `tests/gitProfileManager.test.js` (add switchProfile tests)

- [ ] **Step 1: Write failing tests for switchProfile**

Add to `tests/gitProfileManager.test.js`:

```javascript
const { switchProfile } = require('../config/gitProfileManager');

// Mock child_process so no real git commands run
jest.mock('child_process', () => ({ exec: jest.fn() }));
const { exec } = require('child_process');

describe('switchProfile', () => {
  const baseData = {
    active: null,
    lastScope: 'local',
    profiles: [
      { id: 'personal', name: 'Me', gitUser: 'me', gitEmail: 'me@e.com', signingKey: '' },
      { id: 'signed',   name: 'Signed', gitUser: 'su', gitEmail: 's@e.com', signingKey: 'ABC123' },
    ],
  };

  beforeEach(() => {
    save(baseData);
    exec.mockReset();
  });

  test('returns not-found when profileId does not exist', async () => {
    const result = await switchProfile({ profileId: 'ghost', scope: 'local', cwd: '/tmp' });
    expect(result).toEqual({ ok: false, error: 'not-found' });
    expect(exec).not.toHaveBeenCalled();
  });

  test('calls git config with --local flag for local scope', async () => {
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));
    const result = await switchProfile({ profileId: 'personal', scope: 'local', cwd: '/tmp' });
    expect(result.ok).toBe(true);
    expect(exec.mock.calls[0][0]).toContain('--local');
    expect(exec.mock.calls[0][0]).toContain('user.name "me"');
    expect(exec.mock.calls[0][0]).toContain('user.email "me@e.com"');
  });

  test('calls git config with --global flag for global scope', async () => {
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));
    await switchProfile({ profileId: 'personal', scope: 'global', cwd: '/tmp' });
    expect(exec.mock.calls[0][0]).toContain('--global');
  });

  test('includes signingkey command when signingKey is set', async () => {
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));
    await switchProfile({ profileId: 'signed', scope: 'local', cwd: '/tmp' });
    expect(exec.mock.calls[0][0]).toContain('user.signingkey "ABC123"');
    expect(exec.mock.calls[0][0]).toContain('gpg.program gpg');
  });

  test('returns not-a-git-repo when stderr contains "not a git repository"', async () => {
    exec.mockImplementation((cmd, opts, cb) =>
      cb(new Error('exit 128'), '', 'fatal: not a git repository')
    );
    const result = await switchProfile({ profileId: 'personal', scope: 'local', cwd: '/tmp' });
    expect(result).toEqual({ ok: false, error: 'not-a-git-repo' });
  });

  test('returns raw stderr on other git errors', async () => {
    exec.mockImplementation((cmd, opts, cb) =>
      cb(new Error('exit 1'), '', 'some other error')
    );
    const result = await switchProfile({ profileId: 'personal', scope: 'local', cwd: '/tmp' });
    expect(result).toEqual({ ok: false, error: 'some other error' });
  });

  test('updates active and lastScope in the saved file on success', async () => {
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));
    await switchProfile({ profileId: 'personal', scope: 'global', cwd: '/tmp' });
    const saved = load();
    expect(saved.active).toBe('personal');
    expect(saved.lastScope).toBe('global');
  });

  test('returns profile and scope on success', async () => {
    exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));
    const result = await switchProfile({ profileId: 'personal', scope: 'local', cwd: '/tmp' });
    expect(result).toMatchObject({ ok: true, scope: 'local', profile: { id: 'personal' } });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest tests/gitProfileManager.test.js -t "switchProfile" --no-coverage
```

Expected: all switchProfile tests fail with "is not a function" or similar.

- [ ] **Step 3: Implement switchProfile in gitProfileManager.js**

Replace the placeholder `switchProfile` with:

```javascript
function switchProfile({ profileId, scope, cwd }) {
  return new Promise((resolve) => {
    const data = load();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile) return resolve({ ok: false, error: 'not-found' });

    const flag = scope === 'global' ? '--global' : '--local';
    const cmds = [
      `git config ${flag} user.name "${profile.gitUser}"`,
      `git config ${flag} user.email "${profile.gitEmail}"`,
    ];
    if (profile.signingKey) {
      cmds.push(`git config ${flag} user.signingkey "${profile.signingKey}"`);
      cmds.push(`git config ${flag} gpg.program gpg`);
    }

    exec(cmds.join(' && '), { cwd, timeout: 5000, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        const isNotRepo = (stderr || '').toLowerCase().includes('not a git repository');
        return resolve({ ok: false, error: isNotRepo ? 'not-a-git-repo' : (stderr.trim() || err.message) });
      }
      data.active    = profileId;
      data.lastScope = scope;
      save(data);
      resolve({ ok: true, profile, scope });
    });
  });
}
```

- [ ] **Step 4: Run all tests**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add config/gitProfileManager.js tests/gitProfileManager.test.js
git commit -m "feat: implement gitProfileManager switchProfile with tests"
```

---

## Task 3: IPC Handlers in main.js

**Files:**
- Modify: `main.js` (add require + 3 handlers after the `profile:check` handler)

- [ ] **Step 1: Add require and handlers to main.js**

After line 16 (`const ConfigLoader = require('./config/configLoader');`), add:

```javascript
const GitProfileManager = require('./config/gitProfileManager');
```

After the `profile:check` handler block (after line 120), add:

```javascript
// ── IPC: Git profiles ─────────────────────────────────────────────────────────

ipcMain.handle('gitProfile:list', () => GitProfileManager.load());

ipcMain.handle('gitProfile:save', (_event, data) => {
  GitProfileManager.save(data);
  return { ok: true };
});

ipcMain.handle('gitProfile:switch', (_event, { profileId, scope, cwd }) => {
  return GitProfileManager.switchProfile({ profileId, scope, cwd: resolveShellPath(cwd) });
});
```

- [ ] **Step 2: Run the app to verify no startup errors**

```
npm start
```

Expected: app launches, no console errors. (No UI for profiles yet — just confirming handlers register without crashing.)

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add gitProfile IPC handlers to main process"
```

---

## Task 4: Preload API

**Files:**
- Modify: `preload.js` (add 3 methods before the closing `}`  of `contextBridge.exposeInMainWorld`)

- [ ] **Step 1: Add three methods to preload.js**

After the `getGitStatus` line (line 70), add:

```javascript
  // ── Git profiles ───────────────────────────────────────────────────────────
  /** Load all profiles from ~/.superbash/git-profiles.json */
  gitProfileList:   ()     => ipcRenderer.invoke('gitProfile:list'),
  /** Overwrite entire profiles file. */
  gitProfileSave:   (data) => ipcRenderer.invoke('gitProfile:save', data),
  /** Run git config commands for the chosen profile. Returns { ok, profile?, scope?, error? } */
  gitProfileSwitch: (args) => ipcRenderer.invoke('gitProfile:switch', args),
```

- [ ] **Step 2: Run the app and confirm no CSP or preload errors**

```
npm start
```

Expected: app launches cleanly. Open DevTools (Ctrl+Shift+I), run `window.electronAPI.gitProfileList()` in the console — should return `{ active: null, lastScope: 'local', profiles: [] }`.

- [ ] **Step 3: Commit**

```bash
git add preload.js
git commit -m "feat: expose gitProfile API methods in preload"
```

---

## Task 5: Example file

**Files:**
- Create: `examples/git-profiles.json`

- [ ] **Step 1: Create examples/git-profiles.json**

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

- [ ] **Step 2: Commit**

```bash
git add examples/git-profiles.json
git commit -m "feat: add example git-profiles.json with 3 profiles"
```

---

## Task 6: Modal HTML in index.html + settings button

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: Add settings button to the titlebar**

In `renderer/index.html`, inside `<div id="window-controls">`, add the settings button as the **first** child (before `#btn-sync-snippets`):

```html
<button id="btn-settings" class="settings-pill no-drag" title="Git Profiles &amp; Settings">⚙ Settings</button>
```

- [ ] **Step 2: Add the settings modal HTML**

After the `palette-overlay` div (after line 91, before the xterm script tags), add:

```html
<!-- ── Settings modal ──────────────────────────────────────────────── -->
<div id="settings-overlay" class="hidden">
  <div id="settings-modal">
    <nav id="settings-nav">
      <div class="settings-nav-item active" data-panel="git-profiles">Git Profiles</div>
    </nav>
    <div id="settings-content">

      <!-- Git Profiles panel -->
      <div id="panel-git-profiles" class="settings-panel">
        <div class="settings-panel-header">
          <span class="settings-panel-title">Git Profiles</span>
          <button id="btn-add-profile" title="Add profile">+</button>
        </div>

        <div id="profile-list">
          <!-- rows injected by settings-modal.js -->
        </div>

        <!-- Inline add form (hidden by default) -->
        <div id="add-profile-form" class="hidden">
          <input id="add-profile-name"  type="text" placeholder="Profile name (e.g. Rayyan – Personal)" autocomplete="off" />
          <input id="add-profile-user"  type="text" placeholder="Git username" autocomplete="off" />
          <input id="add-profile-email" type="text" placeholder="Git email" autocomplete="off" />
          <input id="add-profile-key"   type="text" placeholder="Signing key (optional)" autocomplete="off" />
          <div class="add-profile-actions">
            <button id="btn-save-profile">Save</button>
            <button id="btn-cancel-profile">Cancel</button>
          </div>
        </div>

        <!-- Scope toggle -->
        <div id="scope-toggle">
          <label class="scope-label">
            <input type="radio" name="scope" value="local" /> Local
          </label>
          <label class="scope-label">
            <input type="radio" name="scope" value="global" /> Global
          </label>
        </div>
      </div>

    </div>
  </div>
</div>
```

- [ ] **Step 3: Add settings-modal.css and settings-modal.js script tags**

After `<link rel="stylesheet" href="styles.css" />` (line 21), add:

```html
<link rel="stylesheet" href="settings-modal.css" />
```

After `<script src="terminal.js"></script>` (last line before `</body>`), add:

```html
<script src="settings-modal.js"></script>
```

- [ ] **Step 4: Verify app still loads with no errors**

```
npm start
```

Expected: app loads normally. The settings button appears in the titlebar (unstyled). No JS errors.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html
git commit -m "feat: add settings button and modal HTML structure"
```

---

## Task 7: Settings modal CSS

**Files:**
- Create: `renderer/settings-modal.css`

- [ ] **Step 1: Create renderer/settings-modal.css**

```css
/* ── Settings pill button in titlebar ──────────────────────────────────────── */
.settings-pill {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-family: inherit;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 3px;
  cursor: pointer;
  margin: 0 8px;
  height: 22px;
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-pill:hover {
  background: var(--accent-dim);
}

/* ── Settings overlay ────────────────────────────────────────────────────────── */
#settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

#settings-overlay.hidden {
  display: none;
}

/* ── Settings modal container ────────────────────────────────────────────────── */
#settings-modal {
  background: var(--bg-secondary);
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  width: 680px;
  max-width: 90vw;
  height: 440px;
  max-height: 80vh;
  display: flex;
  overflow: hidden;
}

/* ── Left nav ────────────────────────────────────────────────────────────────── */
#settings-nav {
  width: 160px;
  flex-shrink: 0;
  background: var(--bg-primary);
  border-right: 1px solid #1f1f1f;
  padding: 12px 0;
}

.settings-nav-item {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease;
}

.settings-nav-item.active {
  color: var(--accent);
  background: var(--accent-dim);
  border-left: 2px solid var(--accent);
  padding-left: 14px;
}

/* ── Content area ────────────────────────────────────────────────────────────── */
#settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.settings-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
}

/* ── Panel header ────────────────────────────────────────────────────────────── */
.settings-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.settings-panel-title {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.settings-panel-header button {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 16px;
  width: 26px;
  height: 26px;
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease;
}

.settings-panel-header button:hover {
  background: var(--accent-dim);
}

/* ── Profile list ────────────────────────────────────────────────────────────── */
#profile-list {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 12px;
}

.profile-row {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s ease;
  gap: 10px;
  position: relative;
}

.profile-row:hover {
  background: var(--bg-tertiary);
}

.profile-row.active {
  border-left: 2px solid var(--accent);
  padding-left: 8px;
  background: rgba(240, 165, 0, 0.07);
}

.profile-row-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.profile-row-name {
  font-size: 12px;
  color: var(--text-primary);
}

.profile-row.active .profile-row-name {
  color: var(--accent);
}

.profile-row-meta {
  font-size: 10px;
  color: var(--text-dim);
}

.profile-row.active .profile-row-meta {
  color: rgba(240, 165, 0, 0.7);
}

.profile-row-delete {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 2px;
  opacity: 0;
  transition: opacity 0.1s ease, color 0.1s ease;
}

.profile-row:hover .profile-row-delete {
  opacity: 1;
}

.profile-row-delete:hover {
  color: #e06c75;
}

/* ── Add profile form ────────────────────────────────────────────────────────── */
#add-profile-form {
  border-top: 1px solid #1f1f1f;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

#add-profile-form.hidden {
  display: none;
}

#add-profile-form input {
  background: var(--bg-primary);
  border: 1px solid #2a2a2a;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 11px;
  padding: 5px 8px;
  border-radius: 3px;
  outline: none;
  transition: border-color 0.12s ease;
}

#add-profile-form input:focus {
  border-color: var(--accent);
}

.add-profile-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.add-profile-actions button {
  background: transparent;
  border: 1px solid #2a2a2a;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 11px;
  padding: 4px 14px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.add-profile-actions button:first-child {
  border-color: var(--accent);
  color: var(--accent);
}

.add-profile-actions button:first-child:hover {
  background: var(--accent-dim);
}

.add-profile-actions button:last-child:hover {
  background: var(--bg-tertiary);
}

/* ── Scope toggle ────────────────────────────────────────────────────────────── */
#scope-toggle {
  display: flex;
  gap: 16px;
  padding-top: 10px;
  border-top: 1px solid #1f1f1f;
  margin-top: auto;
}

.scope-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}

.scope-label input[type="radio"] {
  accent-color: var(--accent);
  cursor: pointer;
}
```

- [ ] **Step 2: Verify styles load without errors**

```
npm start
```

Expected: settings pill button is visible in titlebar (amber-outlined), modal overlay not visible yet.

- [ ] **Step 3: Commit**

```bash
git add renderer/settings-modal.css
git commit -m "feat: add settings modal and profile switcher CSS"
```

---

## Task 8: settings-modal.js — open/close and profile list

**Files:**
- Create: `renderer/settings-modal.js`

- [ ] **Step 1: Create renderer/settings-modal.js with init, open, close, and render**

```javascript
/**
 * settings-modal.js
 *
 * Manages the settings modal: open/close, Git Profiles panel rendering,
 * profile switching, add form, and delete.
 *
 * Communicates with terminal.js via a DOM CustomEvent:
 *   document.dispatchEvent(new CustomEvent('gitProfileSwitched', { detail: { profile, scope, error } }))
 */

(function () {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const overlay      = document.getElementById('settings-overlay');
  const btnSettings  = document.getElementById('btn-settings');
  const profileList  = document.getElementById('profile-list');
  const addForm      = document.getElementById('add-profile-form');
  const btnAdd       = document.getElementById('btn-add-profile');
  const btnSave      = document.getElementById('btn-save-profile');
  const btnCancel    = document.getElementById('btn-cancel-profile');
  const inpName      = document.getElementById('add-profile-name');
  const inpUser      = document.getElementById('add-profile-user');
  const inpEmail     = document.getElementById('add-profile-email');
  const inpKey       = document.getElementById('add-profile-key');
  const scopeRadios  = document.querySelectorAll('input[name="scope"]');

  // ── State ─────────────────────────────────────────────────────────────────
  let _data = { active: null, lastScope: 'local', profiles: [] };

  // ── Open / close ──────────────────────────────────────────────────────────
  async function openModal() {
    _data = await window.electronAPI.gitProfileList();
    renderProfileList();
    restoreScopeToggle();
    addForm.classList.add('hidden');
    overlay.classList.remove('hidden');
    overlay.focus();
  }

  function closeModal() {
    overlay.classList.add('hidden');
  }

  // ── Render profile list ───────────────────────────────────────────────────
  function renderProfileList() {
    profileList.innerHTML = '';
    if (_data.profiles.length === 0) {
      profileList.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px 10px;">No profiles yet. Click + to add one.</div>';
      return;
    }
    for (const profile of _data.profiles) {
      const isActive = profile.id === _data.active;
      const row = document.createElement('div');
      row.className = 'profile-row' + (isActive ? ' active' : '');
      row.dataset.profileId = profile.id;

      const info = document.createElement('div');
      info.className = 'profile-row-info';
      info.innerHTML = `
        <div class="profile-row-name">${escHtml(profile.name)}</div>
        <div class="profile-row-meta">${escHtml(profile.gitUser)} · ${escHtml(profile.gitEmail)}</div>
      `;

      const del = document.createElement('button');
      del.className = 'profile-row-delete';
      del.title = 'Delete profile';
      del.textContent = '🗑';
      if (isActive) del.style.display = 'none';

      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteProfile(profile.id);
      });

      if (!isActive) {
        row.addEventListener('click', () => switchProfile(profile.id));
      }

      row.appendChild(info);
      row.appendChild(del);
      profileList.appendChild(row);
    }
  }

  // ── Scope toggle ──────────────────────────────────────────────────────────
  function restoreScopeToggle() {
    for (const r of scopeRadios) {
      r.checked = r.value === (_data.lastScope || 'local');
    }
  }

  function getSelectedScope() {
    for (const r of scopeRadios) {
      if (r.checked) return r.value;
    }
    return 'local';
  }

  // ── Switch profile ────────────────────────────────────────────────────────
  async function switchProfile(profileId) {
    const scope = getSelectedScope();

    // Retrieve active pane cwd via a custom event request to terminal.js
    const cwdEvent = new CustomEvent('requestActiveCwd', { bubbles: true, detail: { resolve: null } });
    let cwd = '';
    cwdEvent.detail.resolve = (v) => { cwd = v; };
    document.dispatchEvent(cwdEvent);

    const result = await window.electronAPI.gitProfileSwitch({ profileId, scope, cwd });

    if (result.ok) {
      _data.active    = profileId;
      _data.lastScope = scope;
      updateSettingsBtn(result.profile.name);
      renderProfileList();
    }

    document.dispatchEvent(new CustomEvent('gitProfileSwitched', { detail: result }));

    if (result.ok) closeModal();
  }

  // ── Delete profile ────────────────────────────────────────────────────────
  async function deleteProfile(profileId) {
    _data.profiles = _data.profiles.filter(p => p.id !== profileId);
    await window.electronAPI.gitProfileSave(_data);
    renderProfileList();
  }

  // ── Update titlebar button label ──────────────────────────────────────────
  function updateSettingsBtn(profileName) {
    btnSettings.textContent = profileName ? `⚙ ${profileName}` : '⚙ Settings';
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Event listeners ───────────────────────────────────────────────────────
  btnSettings.addEventListener('click', openModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
  });

  // ── Add form ──────────────────────────────────────────────────────────────
  btnAdd.addEventListener('click', () => {
    addForm.classList.toggle('hidden');
    if (!addForm.classList.contains('hidden')) inpName.focus();
  });

  btnCancel.addEventListener('click', () => {
    addForm.classList.add('hidden');
    clearAddForm();
  });

  btnSave.addEventListener('click', saveNewProfile);

  addForm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveNewProfile();
    if (e.key === 'Escape') {
      addForm.classList.add('hidden');
      clearAddForm();
    }
  });

  async function saveNewProfile() {
    const name  = inpName.value.trim();
    const user  = inpUser.value.trim();
    const email = inpEmail.value.trim();
    const key   = inpKey.value.trim();

    if (!name || !user || !email) return;

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const profile = { id, name, gitUser: user, gitEmail: email, signingKey: key };

    _data.profiles.push(profile);
    await window.electronAPI.gitProfileSave(_data);
    clearAddForm();
    addForm.classList.add('hidden');
    renderProfileList();
  }

  function clearAddForm() {
    inpName.value = inpUser.value = inpEmail.value = inpKey.value = '';
  }

  // ── Init: load active profile name into titlebar button ───────────────────
  window.electronAPI.gitProfileList().then((data) => {
    _data = data;
    const active = data.profiles.find(p => p.id === data.active);
    if (active) updateSettingsBtn(active.name);
  });

})();
```

- [ ] **Step 2: Verify modal opens, profiles load, and close works**

```
npm start
```

Expected:
- Click the `⚙ Settings` button → modal opens with "Git Profiles" panel
- If `~/.superbash/git-profiles.json` does not exist: shows "No profiles yet" message
- Clicking outside the modal or pressing Escape closes it

- [ ] **Step 3: Commit**

```bash
git add renderer/settings-modal.js
git commit -m "feat: implement settings modal open/close and profile list rendering"
```

---

## Task 9: settings-modal.js — wire add form and delete (verify)

This task is verification only — add and delete are already implemented in Task 8. Run through the flows manually.

- [ ] **Step 1: Verify add profile flow**

```
npm start
```

1. Open Settings modal
2. Click `+` → inline form appears
3. Fill in Name, Git Username, Email → click Save
4. New profile appears in the list (not activated)
5. Click `+` again → form hides (toggle)

- [ ] **Step 2: Verify delete profile flow**

1. Hover a non-active profile row → trash icon appears
2. Click trash → profile removed from list
3. Active profile row has no trash icon

- [ ] **Step 3: Commit (if any fixes needed)**

```bash
git add renderer/settings-modal.js
git commit -m "fix: settings modal add/delete edge cases"
```

---

## Task 10: terminal.js — amber confirmation + auto-switch

**Files:**
- Modify: `renderer/terminal.js`

- [ ] **Step 1: Add `activePaneCwd` helper and `gitProfileSwitched` event listener**

After the `state` object definition (after line 53), add a helper to retrieve the active pane and its cwd, then add the two event listeners:

```javascript
// ── Git profile helpers ───────────────────────────────────────────────────────

function getActivePane() {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return null;
  return tab.panes[tab.activePaneId] || tab.panes.left || null;
}

function writeAmberToPane(pane, message) {
  if (!pane?.term) return;
  pane.term.write(`\r\n\x1b[38;2;240;165;0m${message}\x1b[0m\r\n`);
}

// Respond to settings-modal.js requesting the active pane's cwd
document.addEventListener('requestActiveCwd', (e) => {
  const pane = getActivePane();
  e.detail.resolve(pane?.cwd || '');
});

// Handle git profile switch result from settings-modal.js
document.addEventListener('gitProfileSwitched', (e) => {
  const { ok, profile, scope, error } = e.detail;
  const pane = getActivePane();
  if (!pane) return;

  if (ok) {
    writeAmberToPane(pane, `Git profile switched to: ${profile.name} (${profile.gitEmail}) [${scope}]`);
  } else if (error === 'not-a-git-repo') {
    writeAmberToPane(pane, `Git profile: not a git repo, profile not applied [${scope || 'local'}]`);
  } else if (error === 'not-found') {
    writeAmberToPane(pane, `Git profile: profile not found`);
  } else {
    writeAmberToPane(pane, `Git profile error: ${error}`);
  }
});
```

- [ ] **Step 2: Verify amber confirmation appears on profile switch**

```
npm start
```

1. Open Settings, add a profile (or switch to existing one)
2. Select a non-active profile and click it
3. Amber text appears in the active terminal: `Git profile switched to: …`
4. Modal closes

- [ ] **Step 3: Commit**

```bash
git add renderer/terminal.js
git commit -m "feat: write amber confirmation to terminal on git profile switch"
```

---

## Task 11: terminal.js — per-project auto-switch

**Files:**
- Modify: `renderer/terminal.js` (extend `checkProjectProfile`)

- [ ] **Step 1: Extend checkProjectProfile to handle gitProfile key**

The existing `checkProjectProfile` function (lines 77–90) calls `checkProfile` then `loadProfile`/`unloadProfile`. Extend it to also auto-switch git profile when the `.superbash` file has a `gitProfile` key.

Replace the body of `checkProjectProfile` with:

```javascript
async function checkProjectProfile(pane, newCwd) {
  if (pane._lastCheckedCwd === newCwd) return;
  pane._lastCheckedCwd = newCwd;

  const profile = await window.electronAPI.checkProfile(newCwd);

  if (profile) {
    if (pane.projectProfileDir === newCwd) return;
    if (pane.projectProfile) unloadProfile(pane);
    loadProfile(pane, profile, newCwd);

    // Auto-switch git profile if specified in .superbash
    if (profile.gitProfile) {
      const result = await window.electronAPI.gitProfileSwitch({
        profileId: profile.gitProfile,
        scope: 'local',
        cwd: newCwd,
      });

      if (result.ok) {
        writeAmberToPane(pane, `Git profile switched to: ${result.profile.name} (${result.profile.gitEmail}) [local]`);
        // Update titlebar button to reflect newly active profile
        const btn = document.getElementById('btn-settings');
        if (btn) btn.textContent = `⚙ ${result.profile.name}`;
      } else if (result.error === 'not-a-git-repo') {
        writeAmberToPane(pane, `Git profile: not a git repo, profile not applied [local]`);
      } else if (result.error === 'not-found') {
        writeAmberToPane(pane, `Git profile "${profile.gitProfile}" not found — check git-profiles.json`);
      } else {
        writeAmberToPane(pane, `Git profile error: ${result.error}`);
      }
    }
  } else if (pane.projectProfile) {
    unloadProfile(pane);
  }
}
```

- [ ] **Step 2: Verify auto-switch with a test .superbash file**

Create a temp `.superbash` in any directory with a git repo:

```json
{
  "gitProfile": "personal",
  "startupMessage": "Test project"
}
```

Then `cd` into that directory in Super Bash. Expected:
- Startup message appears in amber
- `Git profile switched to: … [local]` appears in amber
- Titlebar button label updates to the profile name

- [ ] **Step 3: Verify error case — unknown gitProfile id**

Change `.superbash` to use `"gitProfile": "ghost"`. `cd` into the directory. Expected:
- `Git profile "ghost" not found — check git-profiles.json` appears in amber

- [ ] **Step 4: Run all tests**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/terminal.js
git commit -m "feat: auto-switch git profile on project load via .superbash gitProfile key"
```

---

## Task 12: Final smoke test + cleanup

- [ ] **Step 1: Full smoke test**

```
npm start
```

Run through the complete user journey:

1. **No profiles file:** settings button shows `⚙ Settings`, modal shows "No profiles yet"
2. **Add 3 profiles:** personal, agency, client — all appear in list, none active
3. **Switch to personal (Local):** amber confirmation, modal closes, button label updates
4. **Open modal again:** personal row is amber-highlighted, trash not shown on active
5. **Switch to agency (Global):** amber confirmation with `[global]` label
6. **Delete client profile:** it disappears from list
7. **Scope toggle persists:** close and reopen modal — last used scope is pre-selected
8. **Auto-switch:** create `.superbash` with `"gitProfile": "personal"` in a git repo directory, `cd` into it — amber line appears, button label updates

- [ ] **Step 2: Run full test suite**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: git profile switcher — complete implementation"
```
