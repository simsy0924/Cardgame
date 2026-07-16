// HAND BATTLE — browser seat/session persistence
(function initSessionManager(global) {
  'use strict';

  const STORAGE_KEY = 'handbattle.activeSession.v2';
  const MAX_PROCESSED_ACTIONS = 200;

  function storage() {
    try {
      const s = global.localStorage;
      const probe = '__hb_session_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch (_) {
      return null;
    }
  }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function load() {
    const s = storage();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s.getItem(STORAGE_KEY) || 'null');
      if (!parsed || parsed.schema !== 2 || !parsed.roomCode || !parsed.role || !parsed.seatToken) return null;
      parsed.processedActionKeys = Array.isArray(parsed.processedActionKeys) ? parsed.processedActionKeys : [];
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function save(value) {
    const s = storage();
    if (!s || !value) return false;
    const next = Object.assign({
      schema: 2,
      updatedAt: Date.now(),
      processedActionKeys: [],
    }, clone(value));
    next.updatedAt = Date.now();
    next.processedActionKeys = (next.processedActionKeys || []).slice(-MAX_PROCESSED_ACTIONS);
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch (_) {
      return false;
    }
  }

  function remember(patch) {
    const current = load() || { schema: 2, processedActionKeys: [] };
    const next = Object.assign({}, current, clone(patch || {}), { schema: 2 });
    save(next);
    return next;
  }

  function clear() {
    const s = storage();
    if (!s) return false;
    try {
      s.removeItem(STORAGE_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function makeSeatToken() {
    try {
      if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(24);
        global.crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) {}
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }

  function hasProcessedAction(key) {
    if (!key) return false;
    const current = load();
    return !!(current && current.processedActionKeys.includes(key));
  }

  function markProcessedAction(key, ts) {
    if (!key) return load();
    const current = load() || { schema: 2, processedActionKeys: [] };
    const keys = current.processedActionKeys.filter(item => item !== key);
    keys.push(key);
    return remember({
      processedActionKeys: keys.slice(-MAX_PROCESSED_ACTIONS),
      lastActionKey: key,
      lastActionTs: Math.max(Number(current.lastActionTs || 0), Number(ts || 0)),
    });
  }

  const api = Object.freeze({
    STORAGE_KEY,
    load,
    save,
    remember,
    clear,
    makeSeatToken,
    hasProcessedAction,
    markProcessedAction,
  });

  global.HB_SESSION = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.session = api;
})(window);
