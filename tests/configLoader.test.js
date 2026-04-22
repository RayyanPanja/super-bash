const path = require('path');
const os = require('os');
const fs = require('fs');
const { deepMerge, loadJson } = require('../config/configLoader');

describe('deepMerge', () => {
  test('returns base when override is empty', () => {
    const base = { a: 1, b: { c: 2 } };
    expect(deepMerge(base, {})).toEqual(base);
  });

  test('override scalar replaces base scalar', () => {
    expect(deepMerge({ fontSize: 14 }, { fontSize: 18 })).toEqual({ fontSize: 18 });
  });

  test('deeply merges nested objects', () => {
    const base = { theme: { background: '#000', accent: '#f0a500' } };
    const override = { theme: { accent: '#fff' } };
    expect(deepMerge(base, override)).toEqual({
      theme: { background: '#000', accent: '#fff' },
    });
  });

  test('override wins for top-level keys not in base', () => {
    expect(deepMerge({}, { shellPath: '/bin/zsh' })).toEqual({ shellPath: '/bin/zsh' });
  });

  test('merges aliases from both configs', () => {
    const base = { aliases: { gs: 'git status' } };
    const override = { aliases: { gp: 'git push' } };
    expect(deepMerge(base, override)).toEqual({
      aliases: { gs: 'git status', gp: 'git push' },
    });
  });
});

describe('loadJson', () => {
  test('returns empty object when file does not exist', () => {
    expect(loadJson('/nonexistent/path/file.json')).toEqual({});
  });

  test('parses valid JSON file', () => {
    const tmpFile = path.join(os.tmpdir(), `test_${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify({ fontSize: 16 }));
    expect(loadJson(tmpFile)).toEqual({ fontSize: 16 });
    fs.unlinkSync(tmpFile);
  });

  test('returns empty object on malformed JSON', () => {
    const tmpFile = path.join(os.tmpdir(), `bad_${Date.now()}.json`);
    fs.writeFileSync(tmpFile, '{ invalid json }');
    expect(loadJson(tmpFile)).toEqual({});
    fs.unlinkSync(tmpFile);
  });
});
