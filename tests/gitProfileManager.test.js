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

describe('switchProfile', () => {
  const baseData = {
    active: null,
    lastScope: 'local',
    profiles: [
      { id: 'personal', name: 'Me', gitUser: 'me', gitEmail: 'me@e.com', signingKey: '' },
      { id: 'signed',   name: 'Signed', gitUser: 'su', gitEmail: 's@e.com', signingKey: 'ABC123' },
    ],
  };

  const { switchProfile } = require('../config/gitProfileManager');

  jest.mock('child_process', () => ({ exec: jest.fn() }));
  const { exec } = require('child_process');

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
