// HAND BATTLE — Engine: Network Sync
// 권위 클라이언트만 실제 효과 해결을 실행하고, 비권위 클라이언트는 스냅샷/diff만 반영한다.
(function initNetworkSync(global) {
  'use strict';

  const STATE_MUTATING_ACTIONS = new Set([
    'summon',
    'activate',
    'discard',
    'fieldCard',
    'combat',
    'directAttack',
    'returnToHand',
    'opFieldRemove',
    'opFieldExile',
    'opFieldCardRemove',
    'opGraveExile',
    'opGraveMassExile',
    'opAtkChange',
    'opDeckTopExile',
    'opDiscard',
    'opDiscardRandom',
    'opDraw',
    'forceReturnHand',
    'forceDiscard',
    'revealAllHand',
    'searchBan',
    'exileBan',
    'negateField',
  ]);

  const PUBLIC_ACTIONS = new Set([
    'draw',
    'search',
    'negate',
    'endTurn',
    'phaseEnd',
    'gameOver',
  ]);

  let lastAppliedDiffId = null;
  let lastAppliedSnapshotId = null;
  let lastResolvedChainAt = 0;
  let choiceSeq = 1;
  const pendingChoiceRequests = new Map();

  function getGameState() {
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    return global.G || null;
  }

  function getRoomRef() {
    // eslint-disable-next-line no-undef
    if (typeof roomRef !== 'undefined') return roomRef;
    return global.roomRef || null;
  }

  function getMyRole() {
    // eslint-disable-next-line no-undef
    if (typeof myRole !== 'undefined' && myRole) return myRole;
    return global.myRole || null;
  }

  function getOpponentRole(role) {
    if (role === 'host') return 'guest';
    if (role === 'guest') return 'host';
    return 'opponent';
  }

  function hasNetworkRoom() {
    return !!getRoomRef();
  }

  function isAIMode() {
    return !!(global.AI && global.AI.active);
  }

  function isAuthority(options) {
    const opts = options || {};
    if (opts.authority === true) return true;
    if (opts.authority === false) return false;
    if (!hasNetworkRoom()) return true;
    const role = getMyRole();
    if (!role) return true;
    if (opts.resolvedBy) return opts.resolvedBy === role;
    if (opts.ownerRole) return opts.ownerRole === role;
    if (opts.chainState && opts.chainState.resolvedBy) return opts.chainState.resolvedBy === role;
    return true;
  }

  function clone(value) {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (err) {}
    return JSON.parse(JSON.stringify(value));
  }

  function cardSummary(card, options) {
    if (!card) return null;
    const opts = options || {};
    const isPublic = !!card.isPublic || !!opts.forcePublic;
    if (opts.maskPrivate && !isPublic) {
      return { id: 'unknown', name: '?', isPublic: false };
    }
    const out = {
      id: card.id || 'unknown',
      name: card.name || card.id || '?',
      isPublic,
    };
    if (card.atk != null) out.atk = card.atk;
    if (card.baseAtk != null) out.baseAtk = card.baseAtk;
    if (card.effectNegatedUntilEndTurn) out.effectNegatedUntilEndTurn = true;
    if (card._iid) out._iid = card._iid;
    return out;
  }

  function serializeHand(hand, options) {
    const arr = Array.isArray(hand) ? hand : [];
    return arr.map(c => cardSummary(c, options));
  }

  function serializeZone(zone) {
    return clone(Array.isArray(zone) ? zone : []);
  }

  function serializeFieldCard(card) {
    return card ? clone(card) : null;
  }

  function captureLocalState() {
    const state = getGameState();
    if (!state) return null;
    return {
      my: {
        hand: clone(state.myHand || []),
        field: clone(state.myField || []),
        grave: clone(state.myGrave || []),
        exile: clone(state.myExile || []),
        fieldCard: clone(state.myFieldCard || null),
        deckCount: state.myDeck ? state.myDeck.length : (state.myDeckCount || 0),
        keyDeck: clone(state.myKeyDeck || []),
      },
      opponent: {
        hand: clone(state.opHand || []),
        field: clone(state.opField || []),
        grave: clone(state.opGrave || []),
        exile: clone(state.opExile || []),
        fieldCard: clone(state.opFieldCard || null),
        deckCount: state.opDeckCount || 0,
        keyDeck: clone(state.opKeyDeck || []),
      },
      flags: {
        exileBanActive: !!state.exileBanActive,
        goldenAppleActive: !!state.goldenAppleActive,
      },
    };
  }

  function createAuthoritativeState(options) {
    const opts = options || {};
    const state = getGameState();
    const role = opts.authorityRole || getMyRole() || 'local';
    if (!state) return null;
    const snapshotId = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      schema: 1,
      snapshotId,
      authorityRole: role,
      opponentRole: getOpponentRole(role),
      createdAt: Date.now(),
      self: {
        hand: serializeHand(state.myHand, { maskPrivate: true }),
        handCount: Array.isArray(state.myHand) ? state.myHand.length : 0,
        field: serializeZone(state.myField),
        grave: serializeZone(state.myGrave),
        exile: serializeZone(state.myExile),
        fieldCard: serializeFieldCard(state.myFieldCard),
        deckCount: state.myDeck ? state.myDeck.length : (state.myDeckCount || 0),
        keyDeckCount: state.myKeyDeck ? state.myKeyDeck.length : 0,
      },
      opponent: {
        hand: serializeHand(state.opHand, { maskPrivate: true }),
        handCount: Array.isArray(state.opHand) ? state.opHand.length : 0,
        field: serializeZone(state.opField),
        grave: serializeZone(state.opGrave),
        exile: serializeZone(state.opExile),
        fieldCard: serializeFieldCard(state.opFieldCard),
        deckCount: state.opDeckCount || 0,
        keyDeckCount: state.opKeyDeck ? state.opKeyDeck.length : 0,
      },
      flags: {
        exileBanActive: !!state.exileBanActive,
        goldenAppleActive: !!state.goldenAppleActive,
      },
    };
  }

  function makeUnknownHandCard() {
    return { id: 'unknown', name: '?', isPublic: false };
  }

  function reconcileHandCount(hand, targetCount, options) {
    const opts = options || {};
    const arr = Array.isArray(hand) ? hand.slice() : [];
    const count = Math.max(0, Number(targetCount || 0));
    while (arr.length > count) arr.pop();
    while (arr.length < count) arr.push(opts.unknownFactory ? opts.unknownFactory() : makeUnknownHandCard());
    return arr;
  }

  function mergeOwnHandFromAuthorityView(currentHand, authorityHand, handCount) {
    const current = Array.isArray(currentHand) ? currentHand.slice() : [];
    const publicById = new Map();
    (Array.isArray(authorityHand) ? authorityHand : []).forEach(c => {
      if (c && c.id && c.id !== 'unknown' && c.isPublic) publicById.set(c.id, c);
    });
    const merged = current.map(c => {
      if (!c || !c.id) return c;
      const pub = publicById.get(c.id);
      return pub ? Object.assign({}, c, { isPublic: true }) : c;
    });
    return reconcileHandCount(merged, handCount, { unknownFactory: makeUnknownHandCard });
  }

  function applyAuthoritativeState(snapshot, options) {
    if (!snapshot || !snapshot.schema) return { ok: false, error: '권위 스냅샷이 없습니다.' };
    const state = getGameState();
    if (!state) return { ok: false, error: '게임 상태가 없습니다.' };
    if (snapshot.snapshotId && snapshot.snapshotId === lastAppliedSnapshotId) return { ok: true, skipped: true };
    const role = getMyRole();
    const fromSelf = snapshot.self || {};
    const fromOpponent = snapshot.opponent || {};

    if (snapshot.authorityRole && role && snapshot.authorityRole === role) {
      lastAppliedSnapshotId = snapshot.snapshotId || lastAppliedSnapshotId;
      return { ok: true, skipped: true, reason: '내가 만든 권위 스냅샷입니다.' };
    }

    // 상대 권위자의 self는 내 화면의 상대 영역이다. 패는 비공개 정보를 마스킹한 상태만 반영한다.
    state.opHand = reconcileHandCount(
      serializeHand(fromSelf.hand || [], { maskPrivate: true }),
      fromSelf.handCount,
      { unknownFactory: makeUnknownHandCard }
    );
    state.opField = serializeZone(fromSelf.field);
    state.opGrave = serializeZone(fromSelf.grave);
    state.opExile = serializeZone(fromSelf.exile);
    state.opFieldCard = serializeFieldCard(fromSelf.fieldCard);
    state.opDeckCount = fromSelf.deckCount || 0;
    state.opKeyDeck = new Array(Math.max(0, Number(fromSelf.keyDeckCount || 0))).fill(null).map(() => ({ id: 'unknown', name: '키카드' }));

    // 상대 권위자의 opponent는 내 영역이다. 내 패의 실제 내용은 보존하고, 공개 여부/장수만 맞춘다.
    state.myHand = mergeOwnHandFromAuthorityView(state.myHand, fromOpponent.hand, fromOpponent.handCount);
    state.myField = serializeZone(fromOpponent.field);
    state.myGrave = serializeZone(fromOpponent.grave);
    state.myExile = serializeZone(fromOpponent.exile);
    state.myFieldCard = serializeFieldCard(fromOpponent.fieldCard);

    if (snapshot.flags) {
      state.exileBanActive = !!snapshot.flags.exileBanActive;
      state.goldenAppleActive = !!snapshot.flags.goldenAppleActive;
    }

    lastAppliedSnapshotId = snapshot.snapshotId || lastAppliedSnapshotId;
    if (!options || options.render !== false) {
      try { if (typeof renderAll === 'function') renderAll(); } catch (err) {}
    }
    return { ok: true, appliedSnapshotId: lastAppliedSnapshotId };
  }

  function stableStringify(value) {
    return JSON.stringify(value == null ? null : value);
  }

  function createStateDiff(before, after) {
    const diffId = `diff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ops = [];
    const b = before || {};
    const a = after || captureLocalState() || {};
    const paths = [
      ['my', 'hand'], ['my', 'field'], ['my', 'grave'], ['my', 'exile'], ['my', 'fieldCard'], ['my', 'deckCount'], ['my', 'keyDeck'],
      ['opponent', 'hand'], ['opponent', 'field'], ['opponent', 'grave'], ['opponent', 'exile'], ['opponent', 'fieldCard'], ['opponent', 'deckCount'], ['opponent', 'keyDeck'],
      ['flags', 'exileBanActive'], ['flags', 'goldenAppleActive'],
    ];
    paths.forEach(([group, key]) => {
      const oldValue = b[group] ? b[group][key] : undefined;
      const newValue = a[group] ? a[group][key] : undefined;
      if (stableStringify(oldValue) !== stableStringify(newValue)) {
        ops.push({ op: 'replace', path: `/${group}/${key}`, value: clone(newValue) });
      }
    });
    return {
      schema: 1,
      diffId,
      by: getMyRole() || 'local',
      createdAt: Date.now(),
      ops,
    };
  }

  function setByPath(root, path, value) {
    if (!root || !path) return false;
    const parts = String(path).split('/').filter(Boolean);
    if (!parts.length) return false;
    let obj = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!obj[p] || typeof obj[p] !== 'object') obj[p] = {};
      obj = obj[p];
    }
    obj[parts[parts.length - 1]] = clone(value);
    return true;
  }

  function applyStateDiff(diff, options) {
    if (!diff || !Array.isArray(diff.ops)) return { ok: false, error: 'diff가 없습니다.' };
    if (diff.diffId && diff.diffId === lastAppliedDiffId) return { ok: true, skipped: true };
    if (diff.by && diff.by === getMyRole()) return { ok: true, skipped: true, reason: '내 diff입니다.' };
    if (diff.authoritativeState) {
      const result = applyAuthoritativeState(diff.authoritativeState, options);
      lastAppliedDiffId = diff.diffId || lastAppliedDiffId;
      return result;
    }
    const before = captureLocalState() || {};
    diff.ops.forEach(op => {
      if (!op || op.op !== 'replace') return;
      setByPath(before, op.path, op.value);
    });
    // diff는 권위자 관점의 my/opponent 구조라서 스냅샷 형태로 변환해 적용한다.
    const snapshot = {
      schema: 1,
      snapshotId: diff.diffId,
      authorityRole: diff.by,
      self: before.my || {},
      opponent: before.opponent || {},
      flags: before.flags || {},
    };
    const result = applyAuthoritativeState(snapshot, options);
    lastAppliedDiffId = diff.diffId || lastAppliedDiffId;
    return result;
  }

  function sendStateDiff(diff) {
    const ref = getRoomRef();
    if (!ref || !diff) return Promise.resolve({ ok: false, offline: true });
    const payload = Object.assign({}, diff, {
      by: getMyRole() || diff.by || 'unknown',
      ts: Date.now(),
      authoritativeState: diff.authoritativeState || createAuthoritativeState({ authorityRole: getMyRole() || diff.by || 'unknown' }),
    });
    return ref.child('lastStateDiff').set(payload).then(() => ({ ok: true, diff: payload }));
  }

  function sendLogAction(action) {
    const ref = getRoomRef();
    const payload = Object.assign({ type: 'log', by: getMyRole(), ts: Date.now() }, action || {});
    if (!ref) {
      if (payload.message && typeof log === 'function') log(payload.message, payload.logType || 'system');
      return Promise.resolve({ ok: true, local: true });
    }
    return ref.child('lastAction').set(payload).then(() => ({ ok: true, action: payload }));
  }

  function sendAnimationAction(action) {
    const ref = getRoomRef();
    const payload = Object.assign({ type: 'animation', by: getMyRole(), ts: Date.now() }, action || {});
    if (!ref) return Promise.resolve({ ok: true, local: true });
    return ref.child('lastAction').set(payload).then(() => ({ ok: true, action: payload }));
  }

  function requestOpponentChoice(request) {
    const ref = getRoomRef();
    const role = getMyRole();
    const requestId = `choice_${Date.now()}_${choiceSeq++}`;
    const payload = Object.assign({}, request || {}, {
      requestId,
      by: role,
      to: getOpponentRole(role),
      ts: Date.now(),
      status: 'pending',
    });
    if (!ref) return Promise.resolve({ ok: false, offline: true, requestId });
    ref.child('choiceRequests').child(requestId).set(payload);
    return new Promise(resolve => {
      pendingChoiceRequests.set(requestId, resolve);
      const timeoutId = setTimeout(() => {
        if (!pendingChoiceRequests.has(requestId)) return;
        pendingChoiceRequests.delete(requestId);
        resolve({ ok: false, timeout: true, requestId });
      }, request && request.timeoutMs ? request.timeoutMs : 30000);
      ref.child('choiceResponses').child(requestId).on('value', snap => {
        const response = snap.val();
        if (!response || response.to !== role) return;
        clearTimeout(timeoutId);
        ref.child('choiceResponses').child(requestId).off();
        pendingChoiceRequests.delete(requestId);
        resolve(Object.assign({ ok: true }, response));
      });
    });
  }

  function handleOpponentChoiceResponse(response) {
    if (!response || !response.requestId) return { ok: false, error: 'requestId가 없습니다.' };
    const resolver = pendingChoiceRequests.get(response.requestId);
    if (resolver) {
      pendingChoiceRequests.delete(response.requestId);
      resolver(Object.assign({ ok: true }, response));
    }
    return { ok: true };
  }

  function shouldSuppressLegacyAction(action) {
    if (!action || !action.type) return false;
    if (!hasNetworkRoom()) return false;
    if (action.authoritative === true || action.sync === 'authoritative') return false;
    if (PUBLIC_ACTIONS.has(action.type)) return false;
    return STATE_MUTATING_ACTIONS.has(action.type);
  }

  function describeSuppressedAction(action) {
    if (!action) return '상대 상태 변경 액션';
    if (action.cardId) {
      const name = global.CARDS && global.CARDS[action.cardId] ? global.CARDS[action.cardId].name : action.cardId;
      return `${action.type}: ${name}`;
    }
    if (action.reason) return `${action.type}: ${action.reason}`;
    return action.type || 'state action';
  }

  function consumeResolvedChainState(data, handlers) {
    if (!data || data.active || !data.resolvedAt || !data.resolvedLinks) return false;
    if (data.resolvedAt === lastResolvedChainAt) return true;
    lastResolvedChainAt = data.resolvedAt;

    const role = getMyRole();
    const resolvedBy = data.resolvedBy || data.authorityRole || null;
    if (resolvedBy && role && resolvedBy === role) {
      // 내가 이미 resolveLegacyChain에서 실제 해결을 끝낸 체인이다.
      return true;
    }

    if (data.authoritativeState) {
      applyAuthoritativeState(data.authoritativeState);
      return true;
    }

    if (data.diff) {
      applyStateDiff(data.diff);
      return true;
    }

    // 예전 방/예전 클라이언트와 호환: 권위 정보가 없으면 기존 실행으로 fallback.
    if (handlers && typeof handlers.execute === 'function') {
      handlers.execute([...(data.resolvedLinks || [])].reverse());
      return true;
    }
    return false;
  }

  function resolveLegacyChain(chainState, handlers) {
    const links = [...((chainState && chainState.links) || [])];
    const resolvedAt = Date.now();
    const before = captureLocalState();
    const execute = handlers && handlers.execute;

    if (typeof execute === 'function') {
      execute([...links].reverse());
    }

    const after = captureLocalState();
    const diff = createStateDiff(before, after);
    const authoritativeState = createAuthoritativeState({ authorityRole: getMyRole() || 'local' });
    const payload = {
      active: false,
      links: [],
      priority: null,
      passCount: 0,
      resolvedLinks: links,
      resolvedAt,
      resolvedBy: getMyRole() || 'local',
      authorityMode: 'snapshot',
      authoritativeState,
      diff,
    };

    const ref = getRoomRef();
    if (ref) {
      ref.child('chainState').set(payload);
      return payload;
    }

    // AI/로컬은 한 번만 실행한다. _onLocalChainStateChanged로 넘기면 중복 실행되므로 넘기지 않는다.
    return payload;
  }

  function listenStateDiffs() {
    const ref = getRoomRef();
    if (!ref) return;
    ref.child('lastStateDiff').on('value', snap => {
      const diff = snap.val();
      if (!diff || diff.by === getMyRole()) return;
      applyStateDiff(diff);
    });
  }

  const api = Object.freeze({
    isAuthority,
    hasAuthority: isAuthority,
    hasNetworkRoom,
    isAIMode,
    captureLocalState,
    createAuthoritativeState,
    applyAuthoritativeState,
    createStateDiff,
    sendStateDiff,
    applyStateDiff,
    sendLogAction,
    sendAnimationAction,
    requestOpponentChoice,
    handleOpponentChoiceResponse,
    shouldSuppressLegacyAction,
    describeSuppressedAction,
    consumeResolvedChainState,
    resolveLegacyChain,
    listenStateDiffs,
    STATE_MUTATING_ACTIONS,
    PUBLIC_ACTIONS,
  });

  global.HB_NETWORK_SYNC = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.network = api;
})(window);
