'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/ui/nav-logic');

test('combo names', () => {
  assert.equal(N.combo({ key: 'v' }), 'V');
  assert.equal(N.combo({ key: 'V', shiftKey: true }), 'V');
  assert.equal(N.combo({ key: 'l', ctrlKey: true }), 'Ctrl+L');
  assert.equal(N.combo({ key: 'Tab', shiftKey: true }), 'Shift+Tab');
  assert.equal(N.combo({ key: 'F5' }), 'F5');
  assert.equal(N.combo({ key: ' ' }), 'Space');
});
test('menu wraps', () => {
  assert.equal(N.stepIndex(0, 10, -1), 9);
  assert.equal(N.stepIndex(9, 10, 1), 0);
  assert.equal(N.stepIndex(0, 10, -1, false), 0);
  assert.equal(N.menuMove(2, 10, 'ArrowDown'), 3);
  assert.equal(N.menuMove(2, 10, 'Home'), 0);
  assert.equal(N.menuMove(2, 10, 'End'), 9);
  assert.equal(N.menuMove(2, 10, 'x'), null);
});
test('Enter and Backspace in forms', () => {
  assert.deepEqual(N.fieldMove(0, 3, 1), { type: 'focus', index: 1 });
  assert.deepEqual(N.fieldMove(2, 3, 1), { type: 'submit' });
  assert.deepEqual(N.fieldMove(0, 3, -1), { type: 'stay' });
  assert.equal(N.backspaceGoesBack('', 0, 0), true);
  assert.equal(N.backspaceGoesBack('a', 1, 1), false);
});
test('hotkeys', () => {
  assert.equal(N.findHotkey(['V', 'I', 'D'], 'D'), 2);
  assert.equal(N.findHotkey(['V'], 'Enter'), -1);
});
