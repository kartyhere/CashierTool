'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('src/ui/theme/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('Block design: no animation, blur, shadow, or rounded corners', () => {
  for (const bad of [/transition\s*:/, /animation\s*:/, /@keyframes/, /blur\(/, /box-shadow\s*:/, /text-shadow\s*:/, /border-radius\s*:\s*[1-9]/, /(^|[;{\s])transform\s*:/]) {
    assert.ok(!bad.test(css), String(bad));
  }
});
test('page: CSP meta present (script run by the build), no inline handlers or scripts', () => {
  const html = read('src/ui/index.html');
  assert.ok(!/\son[a-z]+\s*=/.test(html));
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html));
  assert.ok(!/https?:\/\//.test(html + css));
});
test('app code never uses innerHTML or eval', () => {
  for (const f of ['app.js', 'dom.js', 'keys.js', 'nav-logic.js', 'screens/shared.js', 'screens/opening.js', 'screens/cashin.js', 'screens/entries.js', 'screens/lists.js', 'screens/voucher.js', 'screens/people.js', 'screens/settle.js', 'screens/deposit.js', 'screens/exchange.js', 'screens/tally.js', 'screens/dayclose.js']) {
    const s = read('src/ui/' + f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(s), f);
  }
});
test('window is hardened', () => {
  const m = read('src/main.js');
  assert.match(m, /contextIsolation:\s*true/);
  assert.match(m, /sandbox:\s*true/);
  assert.match(m, /nodeIntegration:\s*false/);
  assert.match(m, /app\.isPackaged/);
});
test('fonts referenced by the theme exist', () => {
  for (const m of css.matchAll(/url\('([^']+)'\)/g)) assert.ok(fs.existsSync(path.join(root, 'src/ui/theme', m[1])), m[1]);
});
