/**
 * Tests for shell/utils.js — resolveShellPath, readTeamSnippets, parseGitStatus
 * No mocking required: all functions are pure or use only fs.
 */

const os   = require('os');
const fs   = require('fs');
const path = require('path');
const { resolveShellPath, readTeamSnippets, parseGitStatus } = require('../shell/utils');

// ── resolveShellPath ──────────────────────────────────────────────────────────

describe('resolveShellPath()', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    Object.defineProperty(process, 'platform', origPlatform);
  });

  function setPlatform(val) {
    Object.defineProperty(process, 'platform', { value: val, configurable: true });
  }

  test('converts Git Bash path on Windows', () => {
    setPlatform('win32');
    const result = resolveShellPath('/c/Users/test/project');
    expect(result).toBe('C:' + path.sep + 'Users' + path.sep + 'test' + path.sep + 'project');
  });

  test('handles single-letter drive correctly', () => {
    setPlatform('win32');
    expect(resolveShellPath('/e/dev')).toBe('E:' + path.sep + 'dev');
  });

  test('leaves native Windows path unchanged', () => {
    setPlatform('win32');
    expect(resolveShellPath('C:\\Users\\test')).toBe('C:\\Users\\test');
  });

  test('returns unchanged path on non-Windows platform', () => {
    setPlatform('linux');
    expect(resolveShellPath('/home/user/project')).toBe('/home/user/project');
  });

  test('returns unchanged POSIX path on non-Windows even if it looks like a drive', () => {
    setPlatform('linux');
    expect(resolveShellPath('/c/Users/test')).toBe('/c/Users/test');
  });
});

// ── readTeamSnippets ──────────────────────────────────────────────────────────

describe('readTeamSnippets()', () => {
  const tmpDir = os.tmpdir();

  test('returns snippets array from valid file', () => {
    const file = path.join(tmpDir, `snippets_${Date.now()}.json`);
    const snippets = [
      { name: 'Deploy', command: 'git push origin main' },
      { name: 'Pull',   command: 'git pull' },
    ];
    fs.writeFileSync(file, JSON.stringify({ snippets }));
    expect(readTeamSnippets(file)).toEqual(snippets);
    fs.unlinkSync(file);
  });

  test('returns [] when file does not exist', () => {
    expect(readTeamSnippets('/nonexistent/path/snippets.json')).toEqual([]);
  });

  test('returns [] on malformed JSON', () => {
    const file = path.join(tmpDir, `bad_snippets_${Date.now()}.json`);
    fs.writeFileSync(file, '{ invalid json }');
    expect(readTeamSnippets(file)).toEqual([]);
    fs.unlinkSync(file);
  });

  test('returns [] when snippets key is missing', () => {
    const file = path.join(tmpDir, `no_snippets_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ other: 'data' }));
    expect(readTeamSnippets(file)).toEqual([]);
    fs.unlinkSync(file);
  });

  test('returns [] when snippets is not an array', () => {
    const file = path.join(tmpDir, `bad_type_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ snippets: 'not-an-array' }));
    expect(readTeamSnippets(file)).toEqual([]);
    fs.unlinkSync(file);
  });
});

// ── parseGitStatus ────────────────────────────────────────────────────────────

describe('parseGitStatus()', () => {
  test('returns { isRepo: false } when branch is null', () => {
    expect(parseGitStatus(null, null, null)).toEqual({ isRepo: false });
  });

  test('returns clean status when no dirty files and no upstream delta', () => {
    expect(parseGitStatus('main', '', null)).toEqual({
      isRepo: true, branch: 'main', dirty: 0, ahead: 0, behind: 0,
    });
  });

  test('counts dirty files from porcelain output', () => {
    const porcelain = ' M src/foo.js\n?? new.txt\n M src/bar.js';
    const result = parseGitStatus('main', porcelain, null);
    expect(result.dirty).toBe(3);
  });

  test('filters blank lines in porcelain output', () => {
    const porcelain = ' M foo.js\n\n M bar.js\n';
    const result = parseGitStatus('main', porcelain, null);
    expect(result.dirty).toBe(2);
  });

  test('parses ahead/behind from rev-list output', () => {
    const result = parseGitStatus('feature', '', '2\t3');
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(3);
  });

  test('handles ahead=0 behind=0 correctly', () => {
    const result = parseGitStatus('main', '', '0\t0');
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });

  test('handles tab-separated ahead/behind', () => {
    const result = parseGitStatus('main', null, '5\t1');
    expect(result.ahead).toBe(5);
    expect(result.behind).toBe(1);
  });

  test('preserves branch name exactly', () => {
    const result = parseGitStatus('feature/my-branch', '', null);
    expect(result.branch).toBe('feature/my-branch');
  });
});
