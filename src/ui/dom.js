'use strict';
// Tiny element builder. Everything shown from data is added as text nodes, never as HTML.
//   h('button', { class: 'btn', data: { key: 'V' }, on: { click: fn } }, 'Voucher', otherElement)
(function () {
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') el.className = value;
      else if (name === 'text') el.textContent = value;
      else if (name === 'on') for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
      else if (name === 'data') for (const [key, v] of Object.entries(value)) el.dataset[key] = v;
      else if (value === true) el.setAttribute(name, '');
      else el.setAttribute(name, String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const visible = (el) => !el.hidden && !el.disabled && el.getClientRects().length > 0;

  window.CashDeskDom = { h, visible };
})();
