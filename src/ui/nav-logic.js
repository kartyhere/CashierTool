'use strict';
// Keyboard rules that need no page: which key was pressed, where focus moves next, when Backspace goes back.
// Kept free of the DOM so it can be tested in Node. Works in Node (require) and in the page (window.CashDeskNav).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashDeskNav = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Turns a key event into one text name: "Enter", "Escape", "F5", "Ctrl+L", "Alt+C", "V", "ArrowDown".
  // Letters are upper-case whatever Shift or Caps Lock says. Shift is only named for non-letter keys (Shift+Tab).
  function combo(e) {
    const key = e.key === ' ' ? 'Space' : String(e.key || '');
    const single = key.length === 1;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey && !single) parts.push('Shift');
    parts.push(single ? key.toUpperCase() : key);
    return parts.join('+');
  }

  // Index after moving delta places in a list of count items. Wraps around by default (menus), or stops at the ends.
  function stepIndex(index, count, delta, wrap = true) {
    if (count <= 0) return -1;
    const next = index + delta;
    if (wrap) return ((next % count) + count) % count;
    return Math.min(count - 1, Math.max(0, next));
  }

  // Enter / Backspace in a form. direction +1 = Enter, -1 = Backspace on an empty field.
  //   a field after this one  -> { type: 'focus', index }
  //   Enter on the last field -> { type: 'submit' }
  //   Backspace on the first  -> { type: 'stay' }
  function fieldMove(index, count, direction) {
    if (count <= 0) return { type: 'stay' };
    const next = index + direction;
    if (next >= count) return { type: 'submit' };
    if (next < 0) return { type: 'stay' };
    return { type: 'focus', index: next };
  }

  // Backspace goes back a field only when there is nothing left to delete: the field is empty.
  function backspaceGoesBack(value, selectionStart, selectionEnd) {
    if (value !== '') return false;
    return (selectionStart || 0) === 0 && (selectionEnd || 0) === 0;
  }

  // Menu movement for a combo name. Returns the new index, or null when the key is not a menu key.
  function menuMove(index, count, name) {
    switch (name) {
      case 'ArrowDown': return stepIndex(index, count, 1);
      case 'ArrowUp': return stepIndex(index, count, -1);
      case 'Home': return count > 0 ? 0 : -1;
      case 'End': return count - 1;
      default: return null;
    }
  }

  // keys = ['V', 'I', 'D', ...] (one letter per menu line). Returns the index for a pressed letter, or -1.
  function findHotkey(keys, name) {
    if (typeof name !== 'string' || name.length !== 1) return -1;
    return keys.findIndex((k) => String(k).toUpperCase() === name);
  }

  return { combo, stepIndex, fieldMove, backspaceGoesBack, menuMove, findHotkey };
});
