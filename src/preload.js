'use strict';
// The only bridge between the page and the main process. The page gets window.cashdesk with named calls;
// it never gets ipcRenderer itself. A sandboxed preload cannot load other files, so this stays one file.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, payload) {
  const reply = await ipcRenderer.invoke(channel, payload);
  if (reply && reply.ok) return reply.data;
  // contextBridge keeps only the message of a thrown Error, so the code travels on a plain object instead.
  const error = { message: (reply && reply.message) || 'The request failed.', code: (reply && reply.code) || 'ERROR' };
  if (reply && reply.until) error.until = reply.until;
  if (reply && reply.triesLeft !== undefined) error.triesLeft = reply.triesLeft;
  throw error;
}

contextBridge.exposeInMainWorld('cashdesk', {
  app: {
    info: () => call('app.info'),
  },
  appearance: {
    get: () => call('appearance.get'),
    set: (theme) => call('appearance.set', { theme }),
  },
  auth: {
    status: () => call('auth.status'),
    setup: (username, password) => call('auth.setup', { username, password }),
    signIn: (username, password) => call('auth.signIn', { username, password }),
    signOut: () => call('auth.signOut'),
    lock: () => call('auth.lock'),
    unlock: (password) => call('auth.unlock', { password }),
    changePassword: (current, next) => call('auth.changePassword', { current, next }),
    touch: () => call('auth.touch'),
  },
  dashboard: { get: () => call('dashboard.get') },
  opening: { save: (pieces) => call('opening.save', { pieces }) },
  cashIn: { save: (data) => call('cashin.save', data) },
  entries: { list: (filter) => call('entries.list', filter || {}), delete: (id) => call('entry.delete', { id }) },
  people: { search: (q, limit, includeInactive) => call('people.search', { q, limit, includeInactive: Boolean(includeInactive) }), save: (data) => call('people.save', data), history: (id, limit) => call('people.history', { id, limit }) },
  voucher: { preview: (data) => call('voucher.preview', data), save: (data) => call('voucher.save', data) },
  settle: { save: (data) => call('settle.save', data) },
  deposit: { suggest: () => call('deposit.suggest'), save: (data) => call('deposit.save', data) },
  exchange: { save: (data) => call('exchange.save', data) },
  tally: { check: (data) => call('tally.check', data), list: (day) => call('tally.list', day ? { day } : {}) },
  day: { info: (day) => call('day.info', day ? { day } : {}), close: (data) => call('day.close', data), reopen: (day, reason) => call('day.reopen', { day, reason }) },
  morning: { status: () => call('morning.status'), done: (data) => call('morning.done', data), snooze: () => call('morning.snooze') },
  lists: { get: () => call('lists.get'), save: (data) => call('lists.save', data) },
  // The main process locks the app after idle time and tells the page. Returns a function that stops listening.
  onLocked(callback) {
    const listener = () => callback();
    ipcRenderer.on('cashdesk:locked', listener);
    return () => ipcRenderer.removeListener('cashdesk:locked', listener);
  },
});
