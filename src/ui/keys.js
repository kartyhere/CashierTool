'use strict';
// The keyboard engine: one key listener for the whole page, the way Tally works.
//
//   Enter       next field (on the last field: submit)       Backspace on an empty field: previous field
//   Up / Down   move through a menu                          Home / End: first / last line
//   a letter    jump to the menu line with that letter       Esc: back one screen
//   F-keys and Ctrl/Alt combinations: the screen's own shortcuts
//
// A screen registers itself with Keys.setScreen({...}). A dialog (Yes/No, lock screen) registers with
// Keys.setModal({ onKey }) and then receives every key; nothing reaches the screen behind it.
(function () {
  const Nav = window.CashDeskNav;
  const { visible } = window.CashDeskDom;

  const state = { screen: null, modal: null };

  function setScreen(spec) { state.screen = spec; }
  function setModal(spec) { state.modal = spec; }

  const fieldsIn = (root) => [...root.querySelectorAll('[data-field]')].filter(visible);
  const itemsIn = (menu) => [...menu.root.querySelectorAll(menu.items || '[data-menu-item]')].filter(visible);

  function focusFirst(root) {
    const field = fieldsIn(root)[0];
    if (field) { field.focus(); if (field.select) field.select(); return; }
    const item = root.querySelector('[data-menu-item]');
    if (item) item.focus();
  }

  function moveField(screen, target, direction) {
    const fields = fieldsIn(screen.root);
    const move = Nav.fieldMove(fields.indexOf(target), fields.length, direction);
    if (move.type === 'focus') { const next = fields[move.index]; next.focus(); if (next.select) next.select(); }
    else if (move.type === 'submit' && screen.onSubmit) screen.onSubmit();
  }

  function onKeyDown(event) {
    if (event.isComposing || event.repeat && event.key === 'Enter') return;
    const name = Nav.combo(event);

    if (state.modal) {
      if (state.modal.onKey(name, event)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const screen = state.screen;
    if (!screen) return;

    if (screen.hotkeys && screen.hotkeys[name]) {
      const handled = screen.hotkeys[name](event);
      if (handled !== false) { event.preventDefault(); return; } // a shortcut can return false to step aside (e.g. a letter typed in a box)
    }

    const target = event.target;
    const inField = target.matches && target.matches('input, textarea, select');

    if (name === 'Escape') { if (screen.onEsc) { event.preventDefault(); screen.onEsc(); } return; }

    if (inField) {
      if (!target.matches('[data-field]')) return;
      if (name === 'Enter') { event.preventDefault(); moveField(screen, target, 1); }
      else if (name === 'Backspace' && Nav.backspaceGoesBack(target.value, target.selectionStart, target.selectionEnd)) {
        event.preventDefault(); moveField(screen, target, -1);
      }
      return;
    }

    if (screen.menu) {
      const items = itemsIn(screen.menu);
      const current = items.indexOf(document.activeElement);
      const to = Nav.menuMove(current, items.length, name);
      if (to !== null) { event.preventDefault(); if (items[to]) items[to].focus(); return; }
      const hot = Nav.findHotkey(items.map((i) => i.dataset.key || ''), name);
      if (hot >= 0) { event.preventDefault(); items[hot].focus(); items[hot].click(); }
    }
  }

  document.addEventListener('keydown', onKeyDown, true);

  window.CashDeskKeys = { setScreen, setModal, focusFirst };
})();
