/**
 * terminal.js
 *
 * Multi-tab terminal manager with per-tab split panes and session restore.
 * Each tab owns its own left/right pane pair and runs independent shell sessions.
 *
 * Globals provided by <script> tags in index.html (xterm v4 UMD builds):
 *   Terminal, FitAddon, WebLinksAddon, SearchAddon
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

function cwdLabel(fullPath) {
  if (!fullPath || fullPath === '~') return '~';
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || fullPath;
}

// Stable element ID helpers so tab-scoped IDs are never mis-typed
const elId = {
  tabContent:  (t)    => `tab-content-${t}`,
  pane:        (t, s) => `pane-${s}-${t}`,
  terminal:    (t, s) => `terminal-${s}-${t}`,
  cwd:         (t, s) => `cwd-${s}-${t}`,
  divider:     (t)    => `divider-${t}`,
  searchBar:   (t, s) => `search-bar-${s}-${t}`,
  searchInput: (t, s) => `search-input-${s}-${t}`,
};

// ── Application state ─────────────────────────────────────────────────────────

/**
 * @typedef {{ term: Terminal, fitAddon: FitAddon, sessionId: string,
 *             unsubData: ()=>void, unsubExit: ()=>void, cwd: string }} PaneState
 * @typedef {{ id: string, panes: {left: PaneState|null, right: PaneState|null},
 *             activePaneId: string, isSplit: boolean }} TabState
 */

const state = {
  /** @type {TabState[]} */
  tabs: [],
  /** @type {string|null} */
  activeTabId: null,
  fontSize: 14,
  /** @type {object|null} */
  config: null,
  broadcast:    false,
  opacityIndex: 0,
  /** @type {Array<{name:string,command:string}>} */
  teamSnippets: [],
};

const OPACITY_LEVELS = [1.0, 0.85, 0.70];

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

// ── Per-project profile ───────────────────────────────────────────────────────

async function checkProjectProfile(pane, newCwd) {
  if (pane._lastCheckedCwd === newCwd) return;

  // Skip the IPC call if we already know this dir has no profile and there is
  // currently no active profile to unload — avoids a redundant round-trip every
  // time the user returns to a directory that has no .superbash file.
  if (pane.projectProfile === null && pane._lastNullCwd === newCwd) return;

  pane._lastCheckedCwd = newCwd;

  const profile = await window.electronAPI.checkProfile(newCwd);

  if (profile) {
    pane._lastNullCwd = null; // this dir has a profile — clear any null cache
    if (pane.projectProfileDir === newCwd) return; // already loaded for this dir
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
  } else {
    pane._lastNullCwd = newCwd; // remember: this dir returned no profile
    if (pane.projectProfile) unloadProfile(pane);
  }
}

function loadProfile(pane, profile, dir) {
  pane.projectProfile    = profile;
  pane.projectProfileDir = dir;

  const cmds = [];
  for (const [k, v] of Object.entries(profile.aliases || {})) {
    cmds.push(`alias ${k}='${v.replace(/'/g, "'\\''")}'`);
  }
  for (const [k, v] of Object.entries(profile.env || {})) {
    cmds.push(`export ${k}='${v.replace(/'/g, "'\\''")}'`);
  }
  if (profile.startupMessage) {
    const msg = profile.startupMessage.replace(/'/g, "'\\''");
    cmds.push(`printf '\\033[38;2;240;165;0m[Super Bash] ${msg}\\033[0m\\n'`);
  }
  if (cmds.length > 0) {
    window.electronAPI.writeToShell(pane.sessionId, cmds.join('; ') + '\n');
  }
}

function unloadProfile(pane) {
  const profile = pane.projectProfile;
  pane.projectProfile    = null;
  pane.projectProfileDir = null;

  const cmds = [];
  const aliasNames = Object.keys(profile.aliases || {});
  const envNames   = Object.keys(profile.env   || {});
  if (aliasNames.length > 0) cmds.push(`unalias ${aliasNames.join(' ')}`);
  if (envNames.length   > 0) cmds.push(`unset ${envNames.join(' ')}`);
  if (cmds.length > 0) {
    window.electronAPI.writeToShell(pane.sessionId, cmds.join('; ') + '\n');
  }
}

// ── Git status bar ────────────────────────────────────────────────────────────

let _gitRefreshBusy = false;
let _gitBarInterval = null;

function initGitBar() {
  document.getElementById('git-branch').addEventListener('click', () =>
    writeToActivePane('git log --oneline -10\n')
  );
  document.getElementById('git-btn-fetch').addEventListener('click', () =>
    writeToActivePane('git fetch\n')
  );
  document.getElementById('git-btn-pull').addEventListener('click', () =>
    writeToActivePane('git pull\n')
  );
  document.getElementById('git-btn-push').addEventListener('click', () =>
    writeToActivePane('git push\n')
  );
  _gitBarInterval = setInterval(refreshGitBar, 3000);
}

function writeToActivePane(cmd) {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return;
  const pane = tab.panes[tab.activePaneId];
  if (pane) window.electronAPI.writeToShell(pane.sessionId, cmd);
}

async function refreshGitBar() {
  if (_gitRefreshBusy) return;
  _gitRefreshBusy = true;
  try {
    const tab  = state.tabs.find(t => t.id === state.activeTabId);
    const pane = tab?.panes[tab.activePaneId] || tab?.panes.left;
    if (!pane?.cwd) { updateGitBar(null); return; }
    const status = await window.electronAPI.getGitStatus(pane.cwd);
    updateGitBar(status);
  } finally {
    _gitRefreshBusy = false;
  }
}

function updateGitBar(status) {
  const bar = document.getElementById('git-bar');

  if (!status?.isRepo) {
    bar.classList.add('git-no-repo');
    return;
  }

  bar.classList.remove('git-no-repo');

  document.getElementById('git-branch-name').textContent = status.branch;

  const dirtyEl = document.getElementById('git-dirty');
  if (status.dirty > 0) {
    document.getElementById('git-dirty-count').textContent = status.dirty;
    dirtyEl.style.display = 'flex';
  } else {
    dirtyEl.style.display = 'none';
  }

  const abEl = document.getElementById('git-ahead-behind');
  const parts = [];
  if (status.ahead  > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  if (parts.length > 0) {
    abEl.textContent = parts.join(' ');
    abEl.style.display = '';
  } else {
    abEl.style.display = 'none';
  }
}

// ── Initialization ────────────────────────────────────────────────────────────

async function init() {
  state.config = await window.electronAPI.loadConfig();
  state.fontSize = state.config.fontSize || 14;
  if (state.config.fontFamily) {
    document.documentElement.style.setProperty('--font-family', state.config.fontFamily);
  }

  document.getElementById('btn-minimize').addEventListener('click', () =>
    window.electronAPI.minimizeWindow()
  );
  document.getElementById('btn-maximize').addEventListener('click', () =>
    window.electronAPI.maximizeWindow()
  );
  document.getElementById('btn-close').addEventListener('click', () =>
    window.electronAPI.closeWindow()
  );
  // #btn-settings click is handled by settings-modal.js (git profiles)
  document.getElementById('btn-help').addEventListener('click', () => window.electronAPI.openHelp());
  document.getElementById('btn-new-tab').addEventListener('click', () => createTab());
  document.getElementById('btn-broadcast').addEventListener('click', toggleBroadcast);

  const syncBtn = document.getElementById('btn-sync-snippets');
  if (state.config.teamSnippetsRepo) {
    syncBtn.addEventListener('click', syncTeamSnippets);
    state.teamSnippets = await window.electronAPI.loadTeamSnippets(state.config.teamSnippetsRepo);
  } else {
    syncBtn.style.display = 'none';
  }

  initPalette();
  initGitBar();
  initContextMenu();
  initTabDrag();

  window.electronAPI.onUpdaterStatus((status) => {
    if (status === 'update-available') {
      showToast('Update available — downloading in background…', 'info');
    } else if (status === 'update-downloaded') {
      showToast('Update downloaded — restart to apply.', 'success', 8000);
    }
  });

  // Capture phase so our shortcuts are handled before xterm sees the keystroke
  document.addEventListener('keydown', handleGlobalKeydown, { capture: true });

  window.addEventListener('resize', () => fitAll());
  window.addEventListener('beforeunload', () => {
    if (_gitBarInterval) clearInterval(_gitBarInterval);
  });

  const restored = await tryRestoreSession();
  if (!restored) {
    await createTab();
  }

  refreshGitBar();
}

// ── Session persistence ───────────────────────────────────────────────────────

const SESSION_VERSION = 1;

async function saveSession() {
  if (!state.config || state.config.restoreSession === false) return;
  const data = {
    version: SESSION_VERSION,
    activeTabIndex: Math.max(0, state.tabs.findIndex(t => t.id === state.activeTabId)),
    tabs: state.tabs.map(tab => ({
      cwd:        tab.panes.left?.cwd  || null,
      isSplit:    tab.isSplit,
      rightCwd:   tab.panes.right?.cwd || null,
      activePane: tab.activePaneId,
      customName: tab.customName || null,
    })),
  };
  await window.electronAPI.saveSession(data);
}

async function tryRestoreSession() {
  if (state.config.restoreSession === false) return false;

  const session = await window.electronAPI.loadSession();
  if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) return false;
  if (session.version !== SESSION_VERSION) {
    console.warn(`session.json version mismatch (got ${session.version}, expected ${SESSION_VERSION}) — discarding`);
    return false;
  }

  for (const saved of session.tabs) {
    const tabId = await createTab(saved.cwd || null);
    if (saved.customName) {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) { tab.customName = saved.customName; updateTabLabel(tabId); }
    }
    if (saved.isSplit) {
      await openSplit(tabId);
      if (saved.rightCwd) {
        const tab = state.tabs.find(t => t.id === tabId);
        const rightPane = tab?.panes.right;
        if (rightPane) setTimeout(() => cdPane(rightPane, saved.rightCwd), 500);
      }
    }
  }

  const activeIdx = Math.min(
    session.activeTabIndex || 0,
    state.tabs.length - 1
  );
  await switchTab(state.tabs[Math.max(0, activeIdx)].id);
  return true;
}

// ── Tab DOM ───────────────────────────────────────────────────────────────────

function buildTabDOM(tabId) {
  // Tab button
  const btn = document.createElement('button');
  btn.className = 'tab';
  btn.dataset.tabId = tabId;
  btn.draggable = true;
  btn.innerHTML =
    `<span class="tab-activity-dot" title="New output"></span>` +
    `<span class="tab-cwd">~</span>` +
    `<span class="tab-close" title="Close tab (Ctrl+W)">&#x2715;</span>`;
  btn.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });
  btn.addEventListener('click', () => switchTab(tabId));

  btn.querySelector('.tab-cwd').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startTabRename(tabId, btn);
  });

  document.getElementById('tabs-list').appendChild(btn);

  // Tab content: left pane + divider + right pane
  const content = document.createElement('div');
  content.id = elId.tabContent(tabId);
  content.className = 'tab-content';
  const bc = state.broadcast ? 'broadcast-banner' : 'broadcast-banner hidden';
  const searchBar = (side) => `
    <div class="pane-search-bar hidden" id="${elId.searchBar(tabId, side)}">
      <input class="pane-search-input" id="${elId.searchInput(tabId, side)}"
        type="text" placeholder="Search…" autocomplete="off" spellcheck="false" />
      <button class="search-btn" data-dir="prev" title="Previous (Shift+Enter)">&#x2191;</button>
      <button class="search-btn" data-dir="next" title="Next (Enter)">&#x2193;</button>
      <button class="search-btn search-close-btn" data-dir="close" title="Close (Esc)">&#x2715;</button>
    </div>`;
  content.innerHTML = `
    <div class="terminal-pane active" id="${elId.pane(tabId, 'left')}">
      <div class="pane-titlebar">
        <span class="pane-cwd" id="${elId.cwd(tabId, 'left')}">~</span>
      </div>
      <div class="${bc}">&#x229B; BROADCAST ON</div>
      ${searchBar('left')}
      <div class="terminal-wrapper" id="${elId.terminal(tabId, 'left')}"></div>
    </div>
    <div id="${elId.divider(tabId)}" class="pane-divider hidden"></div>
    <div class="terminal-pane hidden" id="${elId.pane(tabId, 'right')}">
      <div class="pane-titlebar">
        <span class="pane-cwd" id="${elId.cwd(tabId, 'right')}">~</span>
      </div>
      <div class="${bc}">&#x229B; BROADCAST ON</div>
      ${searchBar('right')}
      <div class="terminal-wrapper" id="${elId.terminal(tabId, 'right')}"></div>
    </div>
  `;
  document.getElementById('tabs-content').appendChild(content);

  initDividerDrag(tabId);
}

function removeTabDOM(tabId) {
  document.querySelector(`.tab[data-tab-id="${tabId}"]`)?.remove();
  document.getElementById(elId.tabContent(tabId))?.remove();
}

// ── Tab lifecycle ─────────────────────────────────────────────────────────────

async function createTab(restoreCwd = null) {
  const tabId = uid();
  /** @type {TabState} */
  const tab = { id: tabId, panes: { left: null, right: null }, activePaneId: 'left', isSplit: false };
  state.tabs.push(tab);
  buildTabDOM(tabId);

  await switchTab(tabId);
  await createPane(tabId, 'left');

  if (restoreCwd) {
    setTimeout(() => cdPane(tab.panes.left, restoreCwd), 500);
  }

  saveSession();
  return tabId;
}

async function closeTab(tabId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return;

  for (const side of ['left', 'right']) {
    if (tab.panes[side]) destroyPane(tab, side);
  }

  const idx = state.tabs.findIndex(t => t.id === tabId);
  state.tabs.splice(idx, 1);
  removeTabDOM(tabId);

  if (state.tabs.length === 0) {
    window.electronAPI.closeWindow();
    return;
  }

  const nextIdx = Math.min(idx, state.tabs.length - 1);
  await switchTab(state.tabs[nextIdx].id);
  saveSession();
}

async function switchTab(tabId) {
  // Hide all tab contents and deactivate all tab buttons
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('tab-active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));

  const content = document.getElementById(elId.tabContent(tabId));
  if (content) content.classList.add('tab-active');

  const btn = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.classList.remove('has-activity');
  }

  state.activeTabId = tabId;

  const tab = state.tabs.find(t => t.id === tabId);
  if (tab) {
    // Let the browser complete the display change before fitting
    await new Promise(resolve => requestAnimationFrame(resolve));
    fitAllInTab(tab);
    setActivePaneFocus(tabId, tab.activePaneId);
  }
}

// ── Pane creation ─────────────────────────────────────────────────────────────

async function createPane(tabId, side) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const container = document.getElementById(elId.terminal(tabId, side));

  const term = new Terminal({
    fontFamily: state.config.fontFamily,
    fontSize: state.fontSize,
    theme: XTERM_THEME,
    scrollback: 5000,
    cursorBlink: true,
    copyOnSelect: true,
    bellStyle: 'visual',
    windowsMode: navigator.platform.startsWith('Win'),
    allowTransparency: false,
    allowProposedApi: true,
  });

  const fitAddon    = new FitAddon.FitAddon();
  const webLinks    = new WebLinksAddon.WebLinksAddon();
  const searchAddon = new SearchAddon.SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(webLinks);
  term.loadAddon(searchAddon);

  term.open(container);

  // WebGL renderer — enables font ligatures (=>  !=  ->  ===).
  // Wrapped in try/catch: falls back to the default canvas renderer silently.
  if (typeof WebglAddon !== 'undefined') {
    try {
      const webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch { /* WebGL unavailable — continue with canvas renderer */ }
  }

  fitAddon.fit();

  // Inject PROMPT_COMMAND to track CWD via OSC 0 title changes.
  // User's config.env can override this; .bashrc will take priority at runtime.
  const userEnv = state.config.env || {};
  const trackCmd = `printf '\\033]0;%s\\007' "$PWD"`;
  const promptCmd = userEnv.PROMPT_COMMAND
    ? `${userEnv.PROMPT_COMMAND}; ${trackCmd}`
    : trackCmd;

  const sessionId = await window.electronAPI.createShell({
    cols:      term.cols,
    rows:      term.rows,
    env:       { ...userEnv, PROMPT_COMMAND: promptCmd },
    shellPath: state.config.shellPath || null,
    aliases:   state.config.aliases || {},
  });

  term.onData((data) => {
    window.electronAPI.writeToShell(sessionId, data);
    if (state.broadcast) broadcastToOthers(sessionId, data);
  });

  const unsubData = window.electronAPI.onShellData(sessionId, (data) => {
    term.write(data);
    if (state.activeTabId !== tabId) {
      const tabBtn = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
      if (tabBtn) tabBtn.classList.add('has-activity');
    }
  });
  const unsubExit = window.electronAPI.onShellExit(sessionId, () => {
    term.write('\r\n\x1b[33m[Process exited — press any key to close pane]\x1b[0m\r\n');
  });

  if (state.config.startupMessage) {
    term.write(`\x1b[33m${state.config.startupMessage}\x1b[0m\r\n`);
  }

  // Build pane state before registering the title-change handler so the
  // closure can write back into the same object.
  const pane = {
    term, fitAddon, searchAddon, sessionId, unsubData, unsubExit, cwd: '~',
    projectProfile: null, projectProfileDir: null, _lastCheckedCwd: null, _lastNullCwd: null,
    _broadcastQueue: [], _broadcastDraining: false,
  };
  tab.panes[side] = pane;

  // ── Wire search bar ────────────────────────────────────────────────────────
  const searchBarEl   = document.getElementById(elId.searchBar(tabId, side));
  const searchInputEl = document.getElementById(elId.searchInput(tabId, side));

  searchInputEl.addEventListener('input', () => {
    if (searchInputEl.value) {
      pane.searchAddon.findNext(searchInputEl.value, { incremental: true });
    } else {
      pane.term.clearSelection();
    }
  });

  searchInputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (ev.shiftKey) pane.searchAddon.findPrevious(searchInputEl.value);
      else             pane.searchAddon.findNext(searchInputEl.value);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      closeSearch(tabId, side);
    }
  });

  searchBarEl.querySelectorAll('.search-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); // keep focus on the input
      const dir = btn.dataset.dir;
      if (dir === 'next')  pane.searchAddon.findNext(searchInputEl.value);
      if (dir === 'prev')  pane.searchAddon.findPrevious(searchInputEl.value);
      if (dir === 'close') closeSearch(tabId, side);
    });
  });

  term.onTitleChange((title) => {
    if (!title) return;
    pane.cwd = title;
    const cwdEl = document.getElementById(elId.cwd(tabId, side));
    if (cwdEl) cwdEl.textContent = title;
    if (state.activeTabId === tabId && tab.activePaneId === side) {
      updateTabLabel(tabId);
      refreshGitBar();
    }
    checkProjectProfile(pane, title);
  });

  term.onBell(() => {
    const tabBtn = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (!tabBtn) return;
    tabBtn.classList.remove('bell-flash');
    // Force reflow so re-adding the class re-triggers the animation
    void tabBtn.offsetWidth;
    tabBtn.classList.add('bell-flash');
  });

  container.addEventListener('mousedown', () => {
    if (state.activeTabId === tabId) setActivePaneFocus(tabId, side);
  });

  container.addEventListener('contextmenu', (e) => openContextMenu(e, pane));
}

// ── Pane destruction ──────────────────────────────────────────────────────────

function destroyPane(tab, side) {
  const pane = tab.panes[side];
  if (!pane) return;
  pane.unsubData();
  pane.unsubExit();
  window.electronAPI.destroyShell(pane.sessionId);
  pane.term.dispose();
  tab.panes[side] = null;
}

// ── Split open / close ────────────────────────────────────────────────────────

async function openSplit(tabId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || tab.isSplit) return;
  tab.isSplit = true;

  document.getElementById(elId.pane(tabId, 'right')).classList.remove('hidden');
  document.getElementById(elId.divider(tabId)).classList.remove('hidden');

  await new Promise(resolve => requestAnimationFrame(resolve));
  await createPane(tabId, 'right');
  fitAllInTab(tab);
  setActivePaneFocus(tabId, 'right');
}

function closePane(tabId, side) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || !tab.panes[side]) return;

  destroyPane(tab, side);

  if (side === 'right') {
    tab.isSplit = false;
    document.getElementById(elId.pane(tabId, 'right')).classList.add('hidden');
    document.getElementById(elId.divider(tabId)).classList.add('hidden');
    document.getElementById(elId.pane(tabId, 'left')).style.flex = '';
    setActivePaneFocus(tabId, 'left');
  } else {
    // Closing left pane closes right too (no orphans)
    if (tab.panes.right) closePane(tabId, 'right');
    closeTab(tabId);
    return;
  }
  saveSession();
}

// ── Focus management ──────────────────────────────────────────────────────────

function setActivePaneFocus(tabId, side) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || !tab.panes[side]) return;
  tab.activePaneId = side;

  if (state.activeTabId !== tabId) return;

  const content = document.getElementById(elId.tabContent(tabId));
  content?.querySelectorAll('.terminal-pane').forEach(el => el.classList.remove('active'));
  document.getElementById(elId.pane(tabId, side))?.classList.add('active');
  tab.panes[side].term.focus();
  updateTabLabel(tabId);
  refreshGitBar();
}

// ── Tab label ─────────────────────────────────────────────────────────────────

function updateTabLabel(tabId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const pane = tab.panes[tab.activePaneId] || tab.panes.left;
  const label = tab.customName || cwdLabel(pane?.cwd || '~');
  const btn = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (!btn) return;
  const cwdEl = btn.querySelector('.tab-cwd');
  // Don't overwrite while the user is actively editing
  if (cwdEl && !btn.querySelector('.tab-rename-input')) cwdEl.textContent = label;
}

// ── Tab drag-to-reorder ───────────────────────────────────────────────────────

function initTabDrag() {
  const list = document.getElementById('tabs-list');
  let dragSrcId = null;

  list.addEventListener('dragstart', (e) => {
    const tab = e.target.closest('.tab[data-tab-id]');
    if (!tab) return;
    dragSrcId = tab.dataset.tabId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcId);
    tab.classList.add('drag-source');
  });

  list.addEventListener('dragend', (e) => {
    const tab = e.target.closest('.tab[data-tab-id]');
    if (tab) tab.classList.remove('drag-source');
    list.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    dragSrcId = null;
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.tab[data-tab-id]');
    list.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    if (target && target.dataset.tabId !== dragSrcId) target.classList.add('drag-over');
  });

  list.addEventListener('dragleave', (e) => {
    const target = e.target.closest('.tab[data-tab-id]');
    if (target) target.classList.remove('drag-over');
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.tab[data-tab-id]');
    if (!target || !dragSrcId || target.dataset.tabId === dragSrcId) return;

    const dstId = target.dataset.tabId;

    // Reorder state.tabs array
    const srcIdx = state.tabs.findIndex(t => t.id === dragSrcId);
    const dstIdx = state.tabs.findIndex(t => t.id === dstId);
    if (srcIdx === -1 || dstIdx === -1) return;
    const [moved] = state.tabs.splice(srcIdx, 1);
    state.tabs.splice(dstIdx, 0, moved);

    // Reorder DOM to match
    const srcBtn = list.querySelector(`.tab[data-tab-id="${dragSrcId}"]`);
    if (srcBtn) {
      if (srcIdx < dstIdx) target.after(srcBtn);
      else                 target.before(srcBtn);
    }

    target.classList.remove('drag-over');
    saveSession();
  });
}

function startTabRename(tabId, btn) {
  const tab    = state.tabs.find(t => t.id === tabId);
  const cwdEl  = btn.querySelector('.tab-cwd');
  if (!tab || !cwdEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-rename-input';
  input.draggable = false;
  input.value = tab.customName || cwdEl.textContent;
  input.maxLength = 40;

  cwdEl.replaceWith(input);
  input.select();

  const commit = () => {
    const name = input.value.trim();
    tab.customName = name || null;
    const restored = document.createElement('span');
    restored.className = 'tab-cwd';
    input.replaceWith(restored);
    updateTabLabel(tabId);
    saveSession();
  };

  const cancel = () => {
    const restored = document.createElement('span');
    restored.className = 'tab-cwd';
    input.replaceWith(restored);
    updateTabLabel(tabId);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    e.stopPropagation(); // prevent global shortcuts during rename
  });
  input.addEventListener('blur', commit);
  input.addEventListener('click', (e) => e.stopPropagation()); // don't trigger switchTab
}

// ── Fit ───────────────────────────────────────────────────────────────────────

function fitAllInTab(tab) {
  for (const pane of Object.values(tab.panes)) {
    if (!pane) continue;
    pane.fitAddon.fit();
    window.electronAPI.resizeShell(pane.sessionId, pane.term.cols, pane.term.rows);
  }
}

function fitAll() {
  // Only the active tab is visible; inactive tabs fit when switched to.
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (tab) fitAllInTab(tab);
}

// ── CWD restore helper ────────────────────────────────────────────────────────

function cdPane(pane, cwd) {
  if (!pane || !cwd) return;
  const safe = cwd.replace(/\\/g, '/').replace(/"/g, '\\"');
  window.electronAPI.writeToShell(pane.sessionId, `cd "${safe}"\n`);
}

// ── Divider drag-to-resize ────────────────────────────────────────────────────

function initDividerDrag(tabId) {
  const divider  = document.getElementById(elId.divider(tabId));
  const leftPane = document.getElementById(elId.pane(tabId, 'left'));
  const content  = document.getElementById(elId.tabContent(tabId));

  let dragging    = false;
  let startX      = 0;
  let startLeftPx = 0;

  divider.addEventListener('mousedown', (e) => {
    dragging    = true;
    startX      = e.clientX;
    startLeftPx = leftPane.getBoundingClientRect().width;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const totalWidth   = content.getBoundingClientRect().width;
    const dividerWidth = divider.getBoundingClientRect().width;
    const delta        = e.clientX - startX;
    const newLeft      = Math.max(100, Math.min(totalWidth - dividerWidth - 100, startLeftPx + delta));
    const pct          = (newLeft / totalWidth) * 100;
    leftPane.style.flex = `0 0 ${pct}%`;
    const rightPane = document.getElementById(elId.pane(tabId, 'right'));
    if (rightPane) rightPane.style.flex = '1 1 0';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) fitAllInTab(tab);
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function handleGlobalKeydown(e) {
  const { ctrlKey, shiftKey, key } = e;

  // ── Search bar is focused: let it handle its own keys ────────────────────────
  if (document.activeElement?.closest('.pane-search-bar')) {
    // Ctrl+ shortcuts must not fire while typing a search query
    if (ctrlKey) { e.preventDefault(); e.stopPropagation(); }
    return;
  }

  // ── Git profiles modal open: Escape closes it, other shortcuts blocked ──────
  if (!document.getElementById('settings-overlay').classList.contains('hidden')) {
    if (key === 'Escape') { e.preventDefault(); document.getElementById('settings-overlay').classList.add('hidden'); }
    // Let text-editing shortcuts through (cut/copy/paste/undo/select-all)
    if (ctrlKey && !['a', 'c', 'v', 'x', 'z'].includes(key.toLowerCase())) {
      e.preventDefault(); e.stopPropagation();
    }
    return;
  }

  // ── Context menu open: Escape closes it ──────────────────────────────────────
  if (!document.getElementById('context-menu').classList.contains('hidden')) {
    if (key === 'Escape') { e.preventDefault(); closeContextMenu(); }
    return;
  }

  // ── Palette is open: only Escape and text-editing ctrl shortcuts pass through ─
  if (palette.isOpen) {
    if (key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closePalette();
    } else if (ctrlKey && !['a', 'c', 'v', 'x', 'z'].includes(key.toLowerCase())) {
      // Block all terminal shortcuts while the palette input is active
      e.preventDefault(); e.stopPropagation();
    }
    return;
  }

  const activeTab = state.tabs.find(t => t.id === state.activeTabId);

  // Ctrl+P — open command palette
  if (ctrlKey && !shiftKey && key === 'p') {
    e.preventDefault(); e.stopPropagation();
    openPalette();
    return;
  }

  // Ctrl+, — open git profiles settings
  if (ctrlKey && !shiftKey && key === ',') {
    e.preventDefault(); e.stopPropagation();
    document.getElementById('btn-settings').click();
    return;
  }

  // Ctrl+T — new tab (inherit CWD from active pane if known)
  if (ctrlKey && !shiftKey && key === 't') {
    e.preventDefault(); e.stopPropagation();
    createTab(getActivePaneCwd());
    return;
  }

  // Ctrl+W — close active tab
  if (ctrlKey && !shiftKey && key === 'w') {
    e.preventDefault(); e.stopPropagation();
    if (state.activeTabId) closeTab(state.activeTabId);
    return;
  }

  // Ctrl+1-9 — switch to tab N
  if (ctrlKey && !shiftKey && key >= '1' && key <= '9') {
    const idx = parseInt(key, 10) - 1;
    if (idx < state.tabs.length) {
      e.preventDefault(); e.stopPropagation();
      switchTab(state.tabs[idx].id);
    }
    return;
  }

  // Ctrl+Shift+T — split active tab into two panes
  if (ctrlKey && shiftKey && key === 'T') {
    e.preventDefault(); e.stopPropagation();
    if (state.activeTabId) openSplit(state.activeTabId);
    return;
  }

  // Ctrl+Shift+W — close focused pane (or tab if only one pane)
  if (ctrlKey && shiftKey && key === 'W') {
    e.preventDefault(); e.stopPropagation();
    if (activeTab) closePane(state.activeTabId, activeTab.activePaneId);
    return;
  }

  // Ctrl+Tab — toggle focus between left / right pane
  if (ctrlKey && !shiftKey && key === 'Tab') {
    e.preventDefault(); e.stopPropagation();
    if (activeTab && activeTab.isSplit) {
      setActivePaneFocus(state.activeTabId, activeTab.activePaneId === 'left' ? 'right' : 'left');
    }
    return;
  }

  // Ctrl+Shift+C — copy selection to clipboard
  if (ctrlKey && shiftKey && key === 'C') {
    e.preventDefault(); e.stopPropagation();
    if (activeTab) {
      const pane = activeTab.panes[activeTab.activePaneId];
      if (pane) {
        const text = pane.term.getSelection();
        if (text) navigator.clipboard.writeText(text).catch(() => {});
      }
    }
    return;
  }

  // Ctrl+Shift+V — paste from clipboard
  if (ctrlKey && shiftKey && key === 'V') {
    e.preventDefault(); e.stopPropagation();
    if (activeTab) {
      const pane = activeTab.panes[activeTab.activePaneId];
      if (pane) {
        navigator.clipboard.readText().then(text => {
          if (text) window.electronAPI.writeToShell(pane.sessionId, text);
        }).catch(() => {});
      }
    }
    return;
  }

  // Ctrl+F — open in-pane search
  if (ctrlKey && !shiftKey && key === 'f') {
    e.preventDefault(); e.stopPropagation();
    if (activeTab) openSearch(state.activeTabId, activeTab.activePaneId);
    return;
  }

  // Ctrl+L — clear screen (send form-feed to PTY; bash readline handles the rest)
  if (ctrlKey && !shiftKey && key === 'l') {
    e.preventDefault(); e.stopPropagation();
    if (activeTab) {
      const pane = activeTab.panes[activeTab.activePaneId];
      if (pane) window.electronAPI.writeToShell(pane.sessionId, '\x0c');
    }
    return;
  }

  // Ctrl+= or Ctrl++ — increase font size
  if (ctrlKey && !shiftKey && (key === '=' || key === '+')) {
    e.preventDefault(); e.stopPropagation();
    adjustFontSize(+1);
    return;
  }

  // Ctrl+- — decrease font size
  if (ctrlKey && !shiftKey && key === '-') {
    e.preventDefault(); e.stopPropagation();
    adjustFontSize(-1);
    return;
  }

  // Ctrl+Shift+B — toggle broadcast mode
  if (ctrlKey && shiftKey && key === 'B') {
    e.preventDefault(); e.stopPropagation();
    toggleBroadcast();
    return;
  }

  // Ctrl+Shift+O — cycle window opacity
  if (ctrlKey && shiftKey && key === 'O') {
    e.preventDefault(); e.stopPropagation();
    cycleOpacity();
    return;
  }
}

// ── In-pane search ────────────────────────────────────────────────────────────

function openSearch(tabId, side) {
  const tab  = state.tabs.find(t => t.id === tabId);
  const pane = tab?.panes[side];
  if (!pane) return;

  const barEl   = document.getElementById(elId.searchBar(tabId, side));
  const inputEl = document.getElementById(elId.searchInput(tabId, side));
  if (!barEl || !inputEl) return;

  barEl.classList.remove('hidden');
  inputEl.select();
  inputEl.focus();

  // Refit so the terminal shrinks to make room for the bar
  pane.fitAddon.fit();
  window.electronAPI.resizeShell(pane.sessionId, pane.term.cols, pane.term.rows);
}

function closeSearch(tabId, side) {
  const tab  = state.tabs.find(t => t.id === tabId);
  const pane = tab?.panes[side];
  const barEl = document.getElementById(elId.searchBar(tabId, side));
  if (!barEl || barEl.classList.contains('hidden')) return;

  barEl.classList.add('hidden');
  pane?.term.clearSelection();

  // Refit to reclaim the bar's height
  if (pane) {
    pane.fitAddon.fit();
    window.electronAPI.resizeShell(pane.sessionId, pane.term.cols, pane.term.rows);
    pane.term.focus();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the active pane's cwd, or null if it hasn't reported one yet. */
function getActivePaneCwd() {
  const tab  = state.tabs.find(t => t.id === state.activeTabId);
  const pane = tab?.panes[tab.activePaneId] || tab?.panes.left;
  const cwd  = pane?.cwd;
  return (cwd && cwd !== '~') ? cwd : null;
}

// ── Broadcast mode ────────────────────────────────────────────────────────────

function broadcastToOthers(excludeSessionId, data) {
  for (const tab of state.tabs) {
    for (const pane of Object.values(tab.panes)) {
      if (!pane || pane.sessionId === excludeSessionId) continue;

      if (!pane._broadcastQueue) pane._broadcastQueue = [];
      pane._broadcastQueue.push(data);

      if (!pane._broadcastDraining) {
        pane._broadcastDraining = true;
        setImmediate(() => {
          if (!pane._broadcastQueue) return;
          const payload = pane._broadcastQueue.join('');
          pane._broadcastQueue = [];
          pane._broadcastDraining = false;
          if (payload) window.electronAPI.writeToShell(pane.sessionId, payload);
        });
      }
    }
  }
}

function toggleBroadcast() {
  state.broadcast = !state.broadcast;
  setBroadcastUI();
  fitAll(); // banner appears/disappears, so terminal height changes
}

function setBroadcastUI() {
  document.getElementById('btn-broadcast').classList.toggle('active', state.broadcast);
  document.querySelectorAll('.broadcast-banner').forEach(el => {
    el.classList.toggle('hidden', !state.broadcast);
  });
}

// ── Window opacity ────────────────────────────────────────────────────────────

function cycleOpacity() {
  state.opacityIndex = (state.opacityIndex + 1) % OPACITY_LEVELS.length;
  window.electronAPI.setOpacity(OPACITY_LEVELS[state.opacityIndex]);
}

function adjustFontSize(delta) {
  state.fontSize = Math.max(8, Math.min(32, state.fontSize + delta));
  for (const tab of state.tabs) {
    for (const pane of Object.values(tab.panes)) {
      if (!pane) continue;
      pane.term.options.fontSize = state.fontSize;
    }
  }
  fitAll();
}

// ── Command palette ───────────────────────────────────────────────────────────

/**
 * @typedef {{ type: 'alias'|'snippet'|'history', name: string,
 *             command: string, searchText: string }} PaletteEntry
 */

const palette = {
  isOpen:      false,
  /** @type {PaletteEntry[]} */
  allEntries:  [],
  /** @type {PaletteEntry[]} */
  filtered:    [],
  selectedIdx: 0,
  /** @type {string[]|null} null = not yet loaded */
  history:     null,
};

function initPalette() {
  const overlay = document.getElementById('palette-overlay');
  const input   = document.getElementById('palette-input');

  // Click on dim backdrop → close
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePalette();
  });

  input.addEventListener('input', () => {
    palette.selectedIdx = 0;
    palette.filtered = filterPaletteEntries(input.value.trim());
    renderPaletteList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      movePaletteSelection(+1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      movePaletteSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = palette.filtered[palette.selectedIdx];
      if (entry) executeAndClose(entry);
    }
  });
}

async function openPalette() {
  // Load history from ~/.bash_history on first open (cached for the session)
  if (palette.history === null) {
    palette.history = (await window.electronAPI.loadHistory()) || [];
  }

  palette.isOpen      = true;
  palette.selectedIdx = 0;
  palette.allEntries  = buildPaletteEntries();
  palette.filtered    = palette.allEntries.slice(0, 50);

  const overlay = document.getElementById('palette-overlay');
  const input   = document.getElementById('palette-input');
  overlay.classList.remove('hidden');
  input.value = '';
  renderPaletteList();
  requestAnimationFrame(() => input.focus());
}

function closePalette() {
  palette.isOpen = false;
  document.getElementById('palette-overlay').classList.add('hidden');
  // Return focus to the active terminal
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (tab) {
    const pane = tab.panes[tab.activePaneId];
    if (pane) pane.term.focus();
  }
}

function buildPaletteEntries() {
  /** @type {PaletteEntry[]} */
  const entries = [];

  // Aliases
  for (const [name, command] of Object.entries(state.config?.aliases || {})) {
    entries.push({ type: 'alias', name, command, searchText: `${name} ${command}` });
  }

  // Snippets (personal overrides team via deepMerge → arrays replace, so personal
  // snippets win; both are shown if only one config has snippets)
  for (const s of (state.config?.snippets || [])) {
    if (s && s.name && s.command) {
      entries.push({
        type:       'snippet',
        name:       s.name,
        command:    s.command,
        searchText: `${s.name} ${s.command}`,
      });
    }
  }

  // Team snippets
  for (const s of (state.teamSnippets || [])) {
    if (s && s.name && s.command) {
      entries.push({ type: 'team', name: s.name, command: s.command, searchText: `${s.name} ${s.command}` });
    }
  }

  // History — most-recent first
  const hist = palette.history || [];
  for (let i = hist.length - 1; i >= Math.max(0, hist.length - 50); i--) {
    entries.push({ type: 'history', name: hist[i], command: hist[i], searchText: hist[i] });
  }

  return entries;
}

function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  // Check for subsequence match
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 1 : 0;
}

function filterPaletteEntries(query) {
  if (!query) return palette.allEntries.slice(0, 50);
  return palette.allEntries
    .map(e => ({ e, score: fuzzyScore(query, e.searchText) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.e)
    .slice(0, 50);
}

const BADGE_LABEL = { alias: 'alias', snippet: 'snip', history: 'hist', team: 'team' };
const BADGE_CLASS = { alias: 'badge-alias', snippet: 'badge-snippet', history: 'badge-history', team: 'badge-team' };

function paletteEscHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paletteCmdPreview(command) {
  const lines = command.split('\n').filter(l => l.trim());
  if (lines.length === 0) return '';
  const first = lines[0].length > 58 ? lines[0].slice(0, 57) + '…' : lines[0];
  return lines.length > 1 ? `${first} <span style="color:#444">+${lines.length - 1} more</span>` : first;
}

function renderPaletteList() {
  const list = document.getElementById('palette-list');
  list.innerHTML = '';

  if (palette.filtered.length === 0) {
    list.innerHTML = '<div class="palette-empty">No matches</div>';
    return;
  }

  palette.filtered.forEach((entry, idx) => {
    const item = document.createElement('div');
    item.className = 'palette-item' + (idx === palette.selectedIdx ? ' selected' : '');
    item.dataset.idx = String(idx);

    const showCmd = entry.type !== 'history' && entry.command !== entry.name;
    item.innerHTML =
      `<span class="palette-badge ${BADGE_CLASS[entry.type]}">${BADGE_LABEL[entry.type]}</span>` +
      `<span class="palette-name">${paletteEscHtml(entry.name)}</span>` +
      (showCmd ? `<span class="palette-cmd">${paletteCmdPreview(entry.command)}</span>` : '');

    // Hover tracks keyboard selection so Enter always runs what's highlighted
    item.addEventListener('mouseenter', () => {
      list.querySelector('.palette-item.selected')?.classList.remove('selected');
      item.classList.add('selected');
      palette.selectedIdx = idx;
    });

    // mousedown (not click) so we act before the input loses focus
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      executeAndClose(entry);
    });

    list.appendChild(item);
  });
}

function movePaletteSelection(delta) {
  const list = document.getElementById('palette-list');
  if (!list || palette.filtered.length === 0) return;
  const newIdx = Math.max(0, Math.min(palette.selectedIdx + delta, palette.filtered.length - 1));
  if (newIdx === palette.selectedIdx) return;
  list.querySelector('.palette-item.selected')?.classList.remove('selected');
  palette.selectedIdx = newIdx;
  const next = list.querySelector(`.palette-item[data-idx="${newIdx}"]`);
  next?.classList.add('selected');
  next?.scrollIntoView({ block: 'nearest' });
}

async function executeAndClose(entry) {
  closePalette();

  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return;
  const pane = tab.panes[tab.activePaneId];
  if (!pane) return;

  const lines = entry.command.split('\n').filter(l => l.trim() !== '');
  if (lines.length <= 1) {
    window.electronAPI.writeToShell(pane.sessionId, (lines[0] ?? entry.command) + '\n');
  } else {
    for (let i = 0; i < lines.length; i++) {
      window.electronAPI.writeToShell(pane.sessionId, lines[i] + '\n');
      if (i < lines.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    }
  }
}


// ── Right-click context menu ──────────────────────────────────────────────────

let _ctxMenuPane = null;

function openContextMenu(e, pane) {
  e.preventDefault();
  _ctxMenuPane = pane;

  const menu     = document.getElementById('context-menu');
  const copyItem = document.getElementById('ctx-copy');
  copyItem.classList.toggle('disabled', !pane.term.getSelection());

  // Reveal off-screen first so offsetWidth/Height are real, then clamp into view
  menu.style.left = '-9999px';
  menu.style.top  = '-9999px';
  menu.classList.remove('hidden');

  const x = Math.min(e.clientX, window.innerWidth  - menu.offsetWidth  - 4);
  const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4);
  menu.style.left = Math.max(0, x) + 'px';
  menu.style.top  = Math.max(0, y) + 'px';
}

function closeContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
  _ctxMenuPane = null;
}

function initContextMenu() {
  document.getElementById('ctx-copy').addEventListener('click', () => {
    if (!_ctxMenuPane) return;
    const sel = _ctxMenuPane.term.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    closeContextMenu();
  });

  document.getElementById('ctx-paste').addEventListener('click', () => {
    if (!_ctxMenuPane) return;
    navigator.clipboard.readText().then(text => {
      if (text) window.electronAPI.writeToShell(_ctxMenuPane.sessionId, text);
    }).catch(() => {});
    closeContextMenu();
  });

  document.getElementById('ctx-clear').addEventListener('click', () => {
    if (!_ctxMenuPane) return;
    window.electronAPI.writeToShell(_ctxMenuPane.sessionId, '\x0c');
    closeContextMenu();
  });

  // Close on any click outside the menu
  document.addEventListener('mousedown', (e) => {
    if (!document.getElementById('context-menu').classList.contains('hidden')) {
      if (!e.target.closest('#context-menu')) closeContextMenu();
    }
  }, true);
}

// ── Toast notifications ───────────────────────────────────────────────────────

const TOAST_ICONS = { success: '✓', error: '✕', info: '●' };

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML =
    `<span class="toast-icon">${TOAST_ICONS[type] ?? TOAST_ICONS.info}</span>` +
    `<span>${message}</span>`;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('toast-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  setTimeout(remove, duration);
}

// ── Team snippet sync ─────────────────────────────────────────────────────────

async function syncTeamSnippets() {
  const btn = document.getElementById('btn-sync-snippets');
  btn.classList.add('syncing');
  try {
    const result = await window.electronAPI.syncTeamSnippets(state.config.teamSnippetsRepo);
    if (result.ok) {
      state.teamSnippets = result.snippets;
      showToast(`Synced ${result.snippets.length} team snippet${result.snippets.length !== 1 ? 's' : ''}`, 'success');
    } else {
      showToast(`Snippet sync failed: ${result.error || 'unknown error'}`, 'error', 5000);
    }
  } catch (err) {
    showToast(`Snippet sync failed: ${err.message}`, 'error', 5000);
  } finally {
    btn.classList.remove('syncing');
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
