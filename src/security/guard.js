'use strict';
// Window and IPC hardening (the same rules BOH has used since 1.0.65):
//  - only the app's own page, in its main frame, may call the main process;
//  - nothing from the page is trusted: payloads are checked for shape and size;
//  - no popups, no navigation away, no webviews, no permissions, no network, no developer tools in packaged builds.
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_DEPTH = 12;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Allows only plain JSON data. Throws on anything else, so handlers can rely on what they receive.
function assertPlain(value) {
  let json;
  try { json = JSON.stringify(value); } catch { throw new Error('Request data is not valid.'); }
  if (json !== undefined && Buffer.byteLength(json) > MAX_PAYLOAD_BYTES) throw new Error('Request data is too large.');
  (function walk(v, depth) {
    if (depth > MAX_DEPTH) throw new Error('Request data is nested too deeply.');
    if (v !== null && typeof v === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw new Error('Request data is not valid.');
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(k)) throw new Error('Request data is not valid.');
        walk(v[k], depth + 1);
      }
    }
  })(value, 0);
  return value;
}

function createGuard({ appRoot, page = 'ui/index.html' }) {
  const root = path.resolve(appRoot);

  const relativePage = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'file:' || u.search) return '';
      return path.relative(root, fileURLToPath(u)).split(path.sep).join('/');
    } catch { return ''; }
  };

  function assertSender(event) {
    const frame = event && event.senderFrame;
    const ok = event && event.sender && !event.sender.isDestroyed()
      && frame && frame === event.sender.mainFrame
      && relativePage(frame.url || '') === page;
    if (!ok) throw new Error('Unauthorized window or frame.');
  }

  function protectContents(contents, { isPackaged }) {
    if (isPackaged) {
      // No console in a signed-in window: it could read or change anything.
      contents.on('devtools-opened', () => contents.closeDevTools());
      contents.on('before-input-event', (event, input) => {
        const key = String(input.key || '').toLowerCase();
        if (input.type === 'keyDown' && (key === 'f12' || ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key)))) event.preventDefault();
      });
    }
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  }

  const protectedSessions = new WeakSet();
  function protectSession(session) {
    if (protectedSessions.has(session)) return;
    protectedSessions.add(session);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeRequest((details, callback) => {
      let protocol = '';
      try { protocol = new URL(details.url).protocol; } catch { callback({ cancel: true }); return; }
      let allowed = ['data:', 'blob:', 'devtools:'].includes(protocol);
      if (protocol === 'file:') {
        try {
          const rel = path.relative(root, fileURLToPath(details.url));
          allowed = rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
        } catch { allowed = false; }
      }
      callback({ cancel: !allowed });
    });
  }

  return { assertSender, protectContents, protectSession, relativePage };
}

module.exports = { createGuard, assertPlain };
