/**
 * Tests for shell/ptyManager.js, shell/utils.js
 *
 * node-pty is mocked so no real PTY processes are spawned.
 */

const os   = require('os');
const fs   = require('fs');
const path = require('path');

// ── Mock node-pty ─────────────────────────────────────────────────────────────

const mockPtyProcess = {
  onData:  jest.fn(),
  onExit:  jest.fn(),
  write:   jest.fn(),
  resize:  jest.fn(),
  kill:    jest.fn(),
};

jest.mock('node-pty', () => ({
  spawn: jest.fn(() => mockPtyProcess),
}));

const pty        = require('node-pty');
const PtyManager = require('../shell/ptyManager');

// ── PtyManager.create() ───────────────────────────────────────────────────────

describe('PtyManager.create()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPtyProcess.onData.mockClear();
    mockPtyProcess.onExit.mockClear();
  });

  test('returns a non-empty sessionId string', () => {
    const mgr = new PtyManager();
    const id = mgr.create({});
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('different calls return different session IDs', () => {
    const mgr = new PtyManager();
    const a = mgr.create({});
    const b = mgr.create({});
    expect(a).not.toBe(b);
  });

  test('spawns a PTY process', () => {
    const mgr = new PtyManager();
    mgr.create({ cols: 100, rows: 30 });
    expect(pty.spawn).toHaveBeenCalledTimes(1);
    const spawnArgs = pty.spawn.mock.calls[0];
    expect(spawnArgs[2]).toMatchObject({ cols: 100, rows: 30 });
  });

  test('registers onData and onExit callbacks', () => {
    const onData = jest.fn();
    const onExit = jest.fn();
    const mgr = new PtyManager();
    mgr.create({ onData, onExit });
    expect(mockPtyProcess.onData).toHaveBeenCalledWith(onData);
    expect(mockPtyProcess.onExit).toHaveBeenCalledTimes(1);
  });

  test('writes an alias init file when aliases are provided (bash shell)', () => {
    const mgr = new PtyManager();
    mgr.create({
      shellPath: '/usr/bin/bash',
      aliases: { gs: 'git status', gp: 'git push' },
    });
    const spawnArgs = pty.spawn.mock.calls[0];
    const args = spawnArgs[1]; // argv passed to bash
    expect(args[0]).toBe('--init-file');
    const tmpFile = args[1];
    expect(fs.existsSync(tmpFile)).toBe(true);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain("alias gs='git status'");
    expect(content).toContain("alias gp='git push'");
    fs.unlinkSync(tmpFile); // cleanup
  });

  test('skips init file when no aliases', () => {
    const mgr = new PtyManager();
    mgr.create({ shellPath: '/usr/bin/bash', aliases: {} });
    const args = pty.spawn.mock.calls[0][1];
    expect(args).toEqual([]);
  });

  test('skips unsafe alias keys', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    const mgr = new PtyManager();
    mgr.create({
      shellPath: '/usr/bin/bash',
      aliases: { 'safe': 'echo ok', 'rm -rf /': 'dangerous' },
    });
    const args = pty.spawn.mock.calls[0][1];
    if (args.length > 0) {
      const content = fs.readFileSync(args[1], 'utf8');
      expect(content).toContain("alias safe='echo ok'");
      expect(content).not.toContain('rm -rf');
      fs.unlinkSync(args[1]);
    }
    stderrSpy.mockRestore();
  });
});

// ── PtyManager.destroy() ──────────────────────────────────────────────────────

describe('PtyManager.destroy()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('kills the PTY process', () => {
    const mgr = new PtyManager();
    const id = mgr.create({});
    mgr.destroy(id);
    expect(mockPtyProcess.kill).toHaveBeenCalledTimes(1);
  });

  test('removes session from internal map', () => {
    const mgr = new PtyManager();
    const id = mgr.create({});
    mgr.destroy(id);
    // Calling destroy again should be a no-op (session already gone)
    expect(() => mgr.destroy(id)).not.toThrow();
    expect(mockPtyProcess.kill).toHaveBeenCalledTimes(1); // not called again
  });

  test('deletes the alias temp file if one was created', () => {
    const mgr = new PtyManager();
    const id = mgr.create({
      shellPath: '/usr/bin/bash',
      aliases: { gs: 'git status' },
    });
    const tmpFile = pty.spawn.mock.calls[0][1][1];
    expect(fs.existsSync(tmpFile)).toBe(true);
    mgr.destroy(id);
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  test('destroyAll kills every session', () => {
    const mgr = new PtyManager();
    mgr.create({});
    mgr.create({});
    mgr.destroyAll();
    expect(mockPtyProcess.kill).toHaveBeenCalledTimes(2);
  });
});
