const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('all HTML dependencies exist and are included in the offline cache', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'coi-serviceworker.js'), 'utf8');
  const assets = vm.runInNewContext(worker.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    assert(fs.existsSync(path.join(root, match[1])), `${match[1]} exists`);
    assert(assets.includes(match[1]), `${match[1]} cached offline`);
  }
  const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g), match => match[1]);
  assert(scripts.indexOf('position-store.js') < scripts.indexOf('app.js'));
});
