// HAND BATTLE — canonical local state snapshots
// The legacy UI still reads G.my*/G.op*, but persistence and validation live here.
(function initStateStore(global) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const ARRAY_KEYS = Object.freeze([
    'myHand', 'opHand',
    'myDeck', 'opDeck',
    'myField', 'opField',
    'myGrave', 'opGrave',
    'myExile', 'opExile',
    'myKeyDeck', 'opKeyDeck',
  ]);
  const CARD_ZONE_KEYS = Object.freeze([
    'myHand', 'myDeck', 'myField', 'myGrave', 'myExile', 'myKeyDeck',
    'opHand', 'opDeck', 'opField', 'opGrave', 'opExile', 'opKeyDeck',
  ]);
  const SCALAR_KEYS = Object.freeze([
    'myDeckCount', 'opDeckCount',
    'myExtraSlots', 'opExtraSlots',
    'turn', 'phase', 'activePlayer',
    'turnStats',
    'goldenAppleActive', 'exileBanActive',
    '_hostFirstTurnDone',
  ]);

  let instanceSequence = 1;

  function clone(value) {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {}
    return JSON.parse(JSON.stringify(value));
  }

  function makeInstanceId(card) {
    const id = card && (card.id || card.cardId || card.name) || 'card';
    const safe = String(id).replace(/[^0-9A-Za-z가-힣_-]/g, '_').slice(0, 32);
    const random = Math.random().toString(36).slice(2, 8);
    return `hb_${safe}_${Date.now().toString(36)}_${instanceSequence++}_${random}`;
  }

  function ensureCardInstance(card) {
    if (!card || typeof card !== 'object') return card;
    if (!card._iid) card._iid = makeInstanceId(card);
    return card;
  }

  function ensureInstances(state) {
    if (!state || typeof state !== 'object') return state;
    CARD_ZONE_KEYS.forEach(key => {
      if (!Array.isArray(state[key])) state[key] = [];
      state[key].forEach(ensureCardInstance);
    });
    if (state.myFieldCard) ensureCardInstance(state.myFieldCard);
    if (state.opFieldCard) ensureCardInstance(state.opFieldCard);
    return state;
  }

  function normalizeLegacyState(input) {
    const state = input || {};
    ARRAY_KEYS.forEach(key => {
      if (!Array.isArray(state[key])) state[key] = [];
    });
    if (!Object.prototype.hasOwnProperty.call(state, 'myFieldCard')) state.myFieldCard = null;
    if (!Object.prototype.hasOwnProperty.call(state, 'opFieldCard')) state.opFieldCard = null;
    if (!Number.isFinite(state.myExtraSlots)) state.myExtraSlots = 0;
    if (!Number.isFinite(state.opExtraSlots)) state.opExtraSlots = 0;
    if (!Number.isFinite(state.turn) || state.turn < 1) state.turn = 1;
    if (!state.phase) state.phase = 'draw';
    if (!state.activePlayer) state.activePlayer = 'host';
    if (!state.turnStats || typeof state.turnStats !== 'object') state.turnStats = {};
    ['me', 'opponent'].forEach(controller => {
      if (!state.turnStats[controller] || typeof state.turnStats[controller] !== 'object') {
        state.turnStats[controller] = {};
      }
      state.turnStats[controller].drawn = Math.max(0, Number(state.turnStats[controller].drawn || 0));
    });
    state.myDeckCount = state.myDeck.length;
    state.opDeckCount = Array.isArray(state.opDeck) && state.opDeck.length
      ? state.opDeck.length
      : Math.max(0, Number(state.opDeckCount || 0));
    ensureInstances(state);
    return state;
  }

  function recordDraw(state, controller, count) {
    const target = normalizeLegacyState(state);
    const key = controller === 'opponent' ? 'opponent' : 'me';
    target.turnStats[key].drawn += Math.max(0, Number(count || 1));
    return target.turnStats[key].drawn;
  }

  function getDrawCount(state, controller) {
    const target = normalizeLegacyState(state);
    const key = controller === 'opponent' ? 'opponent' : 'me';
    return Math.max(0, Number(target.turnStats[key].drawn || 0));
  }

  function resetTurnStats(state) {
    const target = normalizeLegacyState(state);
    target.turnStats.me.drawn = 0;
    target.turnStats.opponent.drawn = 0;
    return target.turnStats;
  }

  function validateLegacyState(input) {
    const state = normalizeLegacyState(input);
    const errors = [];
    const seen = new Map();
    CARD_ZONE_KEYS.forEach(key => {
      state[key].forEach((card, index) => {
        if (!card || typeof card !== 'object') {
          errors.push(`${key}[${index}] 카드가 올바른 객체가 아닙니다.`);
          return;
        }
        if (!card.id) errors.push(`${key}[${index}] 카드 id가 없습니다.`);
        if (!card._iid) errors.push(`${key}[${index}] 카드 인스턴스 id가 없습니다.`);
        if (card._iid && seen.has(card._iid)) {
          errors.push(`카드 인스턴스가 중복되었습니다: ${card._iid} (${seen.get(card._iid)}, ${key}[${index}])`);
        } else if (card._iid) {
          seen.set(card._iid, `${key}[${index}]`);
        }
      });
    });
    [['myFieldCard', state.myFieldCard], ['opFieldCard', state.opFieldCard]].forEach(([key, card]) => {
      if (!card) return;
      if (!card._iid) errors.push(`${key} 카드 인스턴스 id가 없습니다.`);
      if (card._iid && seen.has(card._iid)) errors.push(`카드 인스턴스가 중복되었습니다: ${card._iid}`);
      else if (card._iid) seen.set(card._iid, key);
    });
    if (state.myField.length > 5 + state.myExtraSlots) errors.push('내 필드 카드 수가 슬롯 제한을 초과했습니다.');
    if (state.opField.length > 5 + state.opExtraSlots) errors.push('상대 필드 카드 수가 슬롯 제한을 초과했습니다.');
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }

  function captureLegacyState(input, options) {
    const opts = options || {};
    const state = normalizeLegacyState(input);
    const data = {};
    ARRAY_KEYS.forEach(key => { data[key] = clone(state[key]); });
    SCALAR_KEYS.forEach(key => { data[key] = clone(state[key]); });
    data.myFieldCard = clone(state.myFieldCard || null);
    data.opFieldCard = clone(state.opFieldCard || null);
    data.myDeckCount = data.myDeck.length;
    data.opDeckCount = data.opDeck.length || Math.max(0, Number(state.opDeckCount || 0));
    data.attackedMonsterIds = opts.attackedMonsterIds
      ? Array.from(opts.attackedMonsterIds)
      : [];
    data.pendingTriggerIds = Array.isArray(opts.pendingTriggerIds)
      ? clone(opts.pendingTriggerIds)
      : [];
    data.pendingTriggers = Array.isArray(opts.pendingTriggers)
      ? clone(opts.pendingTriggers)
      : [];
    data.chainUsage = Array.isArray(opts.chainUsage) ? clone(opts.chainUsage) : [];

    const validation = validateLegacyState(state);
    return {
      schema: SCHEMA_VERSION,
      revision: Math.max(0, Number(opts.revision || 0)),
      savedAt: Number(opts.savedAt || Date.now()),
      role: opts.role || null,
      roomCode: opts.roomCode || null,
      playerName: opts.playerName || null,
      deckList: clone(opts.deckList || null),
      keyDeckList: clone(opts.keyDeckList || null),
      lastActionKey: opts.lastActionKey || null,
      lastActionTs: Math.max(0, Number(opts.lastActionTs || 0)),
      data,
      validation: { ok: validation.ok, errors: validation.errors.slice() },
    };
  }

  function applyLegacySnapshot(target, snapshot) {
    if (!target || !snapshot || snapshot.schema !== SCHEMA_VERSION || !snapshot.data) {
      return { ok: false, error: '지원하지 않는 게임 상태 스냅샷입니다.' };
    }
    const data = clone(snapshot.data);
    ARRAY_KEYS.forEach(key => { target[key] = Array.isArray(data[key]) ? data[key] : []; });
    SCALAR_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(data, key)) target[key] = data[key];
    });
    target.myFieldCard = data.myFieldCard || null;
    target.opFieldCard = data.opFieldCard || null;
    normalizeLegacyState(target);
    const validation = validateLegacyState(target);
    return {
      ok: validation.ok,
      errors: validation.errors.slice(),
      attackedMonsterIds: Array.isArray(data.attackedMonsterIds) ? data.attackedMonsterIds.slice() : [],
      pendingTriggerIds: Array.isArray(data.pendingTriggerIds) ? data.pendingTriggerIds.slice() : [],
      pendingTriggers: Array.isArray(data.pendingTriggers) ? data.pendingTriggers.slice() : [],
      chainUsage: Array.isArray(data.chainUsage) ? data.chainUsage.slice() : [],
      snapshot,
    };
  }

  function maskCard(card, forcePublic) {
    if (!card) return null;
    if (forcePublic || card.isPublic) return clone(card);
    return { id: 'unknown', name: '?', isPublic: false, _iid: card._iid || null };
  }

  function makeOpponentView(snapshot) {
    if (!snapshot || snapshot.schema !== SCHEMA_VERSION || !snapshot.data) return null;
    const data = snapshot.data;
    return {
      schema: SCHEMA_VERSION,
      revision: snapshot.revision || 0,
      savedAt: snapshot.savedAt || 0,
      hand: (data.myHand || []).map(card => maskCard(card, false)),
      handCount: (data.myHand || []).length,
      field: clone(data.myField || []),
      grave: clone(data.myGrave || []),
      exile: clone(data.myExile || []),
      fieldCard: clone(data.myFieldCard || null),
      deckCount: (data.myDeck || []).length,
      keyDeckCount: (data.myKeyDeck || []).length,
      extraSlots: Number(data.myExtraSlots || 0),
    };
  }

  const api = Object.freeze({
    SCHEMA_VERSION,
    clone,
    ensureCardInstance,
    ensureInstances,
    normalizeLegacyState,
    validateLegacyState,
    recordDraw,
    getDrawCount,
    resetTurnStats,
    captureLegacyState,
    applyLegacySnapshot,
    makeOpponentView,
  });

  global.HB_STATE_STORE = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.state = api;
})(window);
