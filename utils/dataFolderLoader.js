const fs = require('fs');
const path = require('path');

function listDataFiles(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return [];

  const results = [];
  const stack = [rootDir];
  const extSet = new Set(['.xlsx', '.xls', '.csv']);

  while (stack.length) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && extSet.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

function normalizeTpsName(value) {
  if (value == null) return '';
  const cleaned = String(value).trim().replace(/\.[^.]+$/, '').replace(/[_/\\-]+/g, ' ');
  const compact = cleaned.replace(/\s+/g, ' ').trim().toUpperCase();
  return compact || '';
}

module.exports = { listDataFiles, normalizeTpsName };
