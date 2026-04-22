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

  // Show pane before createPane so fitAddon.fit() inside createPane
  // measures the correct container dimensions
  document.getElementById('pane-right').classList.remove('hidden');
  document.getElementById('pane-divider').classList.remove('hidden');

  // Force a layout cycle so the browser computes pane dimensions
  // before xterm's fit addon measures the container
  await new Promise(resolve => requestAnimationFrame(resolve));

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
