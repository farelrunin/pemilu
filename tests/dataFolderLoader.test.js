const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listDataFiles, normalizeTpsName } = require('../utils/dataFolderLoader');

test('listDataFiles finds nested Excel and CSV files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pemilu-data-'));
  const nestedDir = path.join(tempDir, 'nested');
  fs.mkdirSync(nestedDir, { recursive: true });

  fs.writeFileSync(path.join(tempDir, 'a.xlsx'), 'x');
  fs.writeFileSync(path.join(nestedDir, 'b.csv'), 'x');
  fs.writeFileSync(path.join(tempDir, 'ignore.txt'), 'x');

  const files = listDataFiles(tempDir);
  assert.equal(files.length, 2);
  assert.ok(files.some(file => file.endsWith('a.xlsx')));
  assert.ok(files.some(file => file.endsWith('b.csv')));
});

test('normalizeTpsName sanitizes file names', () => {
  assert.equal(normalizeTpsName('TPS 01.xlsx'), 'TPS 01');
  assert.equal(normalizeTpsName('tps_02  '), 'TPS_02');
  assert.equal(normalizeTpsName('  nama tps / 03 '), 'NAMA TPS 03');
});
