// HAND BATTLE — Engine Adapter: Zone Access
// 신규 엔진 코드는 G.myField/G.opField 같은 직접 접근 대신 이 파일의 함수를 통과한다.
// 이 파일은 기존 script 로딩 환경에 맞춰 window.HB_ZONE_ACCESS 전역 네임스페이스를 만든다.
(function initZoneAccess(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const ZONES = rules.ZONES || {
    DECK: 'deck',
    HAND: 'hand',
    PUBLIC_HAND: 'publicHand',
    FIELD: 'field',
    FIELD_ZONE: 'fieldZone',
    GRAVE: 'grave',
    EXILE: 'exile',
    KEY_DECK: 'keyDeck',
  };

  const CONTROLLERS = Object.freeze({
    ME: 'me',
    OPPONENT: 'opponent',
  });

  const ARRAY_ZONE_KEYS = Object.freeze({
    me: Object.freeze({
      deck: 'myDeck',
      hand: 'myHand',
      field: 'myField',
      grave: 'myGrave',
      exile: 'myExile',
      keyDeck: 'myKeyDeck',
    }),
    opponent: Object.freeze({
      deck: 'opDeck',
      hand: 'opHand',
      field: 'opField',
      grave: 'opGrave',
      exile: 'opExile',
      keyDeck: 'opKeyDeck',
    }),
  });

  const FIELD_ZONE_KEYS = Object.freeze({
    me: 'myFieldCard',
    opponent: 'opFieldCard',
  });

  const COUNT_FALLBACK_KEYS = Object.freeze({
    opponent: Object.freeze({
      deck: 'opDeckCount',
      keyDeck: 'opKeyDeckCount',
    }),
    me: Object.freeze({
      deck: 'myDeckCount',
      keyDeck: 'myKeyDeckCount',
    }),
  });

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    throw new Error('[zone-access] gameState가 없습니다. getZoneArray(G, ...)처럼 명시적으로 전달하세요.');
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function normalizeController(controller) {
    if (controller === CONTROLLERS.ME || controller === 'my' || controller === 'mine' || controller === 'self') {
      return CONTROLLERS.ME;
    }
    if (controller === CONTROLLERS.OPPONENT || controller === 'op' || controller === 'enemy') {
      return CONTROLLERS.OPPONENT;
    }
    throw new Error(`[zone-access] 알 수 없는 controller: ${String(controller)}`);
  }

  function normalizeZone(zone) {
    if (!zone) throw new Error('[zone-access] zone이 비어 있습니다.');

    const normalized = String(zone);
    if (normalized === ZONES.OPPONENT_FIELD || normalized === 'opponentField' || normalized === 'opField') {
      return ZONES.FIELD;
    }
    if (normalized === ZONES.OPPONENT_FIELD_ZONE || normalized === 'opponentFieldZone' || normalized === 'opFieldCard') {
      return ZONES.FIELD_ZONE;
    }
    if (normalized === 'myField') return ZONES.FIELD;
    if (normalized === 'myFieldCard') return ZONES.FIELD_ZONE;

    const allowed = [
      ZONES.DECK,
      ZONES.HAND,
      ZONES.PUBLIC_HAND,
      ZONES.FIELD,
      ZONES.FIELD_ZONE,
      ZONES.GRAVE,
      ZONES.EXILE,
      ZONES.KEY_DECK,
    ];

    if (!allowed.includes(normalized)) {
      throw new Error(`[zone-access] 알 수 없는 zone: ${String(zone)}`);
    }
    return normalized;
  }

  function assertArrayZone(zone) {
    if (zone === ZONES.FIELD_ZONE) {
      throw new Error('[zone-access] fieldZone은 배열 존이 아닙니다. getFieldZoneCard/setFieldZoneCard/clearFieldZoneCard를 사용하세요.');
    }
  }

  function getArrayKey(controller, zone) {
    return ARRAY_ZONE_KEYS[controller] && ARRAY_ZONE_KEYS[controller][zone];
  }

  function getCountFallbackKey(controller, zone) {
    return COUNT_FALLBACK_KEYS[controller] && COUNT_FALLBACK_KEYS[controller][zone];
  }

  function isCountOnlyZone(state, controller, zone) {
    const key = getArrayKey(controller, zone);
    const countKey = getCountFallbackKey(controller, zone);
    return !!(key && !Array.isArray(state[key]) && countKey && typeof state[countKey] === 'number');
  }

  function assertWritableArrayZone(state, controller, zone) {
    if (isCountOnlyZone(state, controller, zone)) {
      throw new Error(`[zone-access] ${controller}/${zone}은 실제 배열 없이 count만 있는 비공개 존입니다. 이 단계에서는 직접 조작할 수 없습니다.`);
    }
  }

  function getZoneArray(gameState, controller, zone) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    const normalizedZone = normalizeZone(zone);

    if (normalizedZone === ZONES.FIELD_ZONE) {
      const card = getFieldZoneCard(state, owner);
      return card ? [card] : [];
    }

    if (normalizedZone === ZONES.PUBLIC_HAND) {
      const hand = getZoneArray(state, owner, ZONES.HAND);
      return hand.filter(card => card && card.isPublic);
    }

    const key = getArrayKey(owner, normalizedZone);
    if (!key) throw new Error(`[zone-access] ${owner}/${normalizedZone} 배열 키를 찾을 수 없습니다.`);

    // 상대 덱처럼 실제 배열 없이 count만 있는 존은 읽기용 빈 배열을 반환한다.
    // 실제 비공개 존 조작은 네트워크 동기화 단계에서 별도 정책으로 처리해야 한다.
    if (!Array.isArray(state[key])) {
      const countKey = getCountFallbackKey(owner, normalizedZone);
      if (countKey && typeof state[countKey] === 'number') return [];
      state[key] = [];
    }
    return state[key];
  }

  function getZoneSize(gameState, controller, zone) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    const normalizedZone = normalizeZone(zone);

    if (normalizedZone === ZONES.FIELD_ZONE) return getFieldZoneCard(state, owner) ? 1 : 0;
    if (normalizedZone === ZONES.PUBLIC_HAND) return getZoneArray(state, owner, normalizedZone).length;

    const key = getArrayKey(owner, normalizedZone);
    if (key && Array.isArray(state[key])) return state[key].length;

    const countKey = getCountFallbackKey(owner, normalizedZone);
    if (countKey && typeof state[countKey] === 'number') return state[countKey];

    return getZoneArray(state, owner, normalizedZone).length;
  }

  function getCardFromZone(gameState, controller, zone, index) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    const normalizedZone = normalizeZone(zone);

    if (normalizedZone === ZONES.FIELD_ZONE) return getFieldZoneCard(state, owner);

    const arr = getZoneArray(state, owner, normalizedZone);
    return arr[index] || null;
  }

  function getFieldZoneCard(gameState, controller) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    return state[FIELD_ZONE_KEYS[owner]] || null;
  }

  function setFieldZoneCard(gameState, controller, card) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    state[FIELD_ZONE_KEYS[owner]] = card || null;
    return state[FIELD_ZONE_KEYS[owner]];
  }

  function clearFieldZoneCard(gameState, controller) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    const key = FIELD_ZONE_KEYS[owner];
    const removed = state[key] || null;
    state[key] = null;
    return removed;
  }

  function findCardIndex(arr, cardIdOrPredicate) {
    if (typeof cardIdOrPredicate === 'function') return arr.findIndex(cardIdOrPredicate);
    return arr.findIndex(card => card && card.id === cardIdOrPredicate);
  }

  function removeCardFromZone(gameState, controller, zone, cardIdOrPredicate) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    const normalizedZone = normalizeZone(zone);

    if (normalizedZone === ZONES.FIELD_ZONE) {
      const current = getFieldZoneCard(state, owner);
      const matched = typeof cardIdOrPredicate === 'function'
        ? cardIdOrPredicate(current)
        : current && current.id === cardIdOrPredicate;
      return matched ? clearFieldZoneCard(state, owner) : null;
    }

    const sourceZone = normalizedZone === ZONES.PUBLIC_HAND ? ZONES.HAND : normalizedZone;
    assertWritableArrayZone(state, owner, sourceZone);
    const arr = getZoneArray(state, owner, sourceZone);
    const idx = normalizedZone === ZONES.PUBLIC_HAND
      ? arr.findIndex(card => card && card.isPublic && (typeof cardIdOrPredicate === 'function' ? cardIdOrPredicate(card) : card.id === cardIdOrPredicate))
      : findCardIndex(arr, cardIdOrPredicate);

    if (idx < 0) return null;
    return arr.splice(idx, 1)[0] || null;
  }

  function insertCardToZone(gameState, controller, zone, card, index) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    const normalizedZone = normalizeZone(zone);

    if (!card) throw new Error('[zone-access] insertCardToZone에 card가 없습니다.');

    if (normalizedZone === ZONES.FIELD_ZONE) {
      return setFieldZoneCard(state, owner, card);
    }

    const targetZone = normalizedZone === ZONES.PUBLIC_HAND ? ZONES.HAND : normalizedZone;
    assertWritableArrayZone(state, owner, targetZone);
    const arr = getZoneArray(state, owner, targetZone);
    const cardToInsert = normalizedZone === ZONES.PUBLIC_HAND
      ? Object.assign({}, card, { isPublic: true })
      : card;

    if (typeof index === 'number' && index >= 0 && index <= arr.length) {
      arr.splice(index, 0, cardToInsert);
    } else {
      arr.push(cardToInsert);
    }
    return cardToInsert;
  }

  function findCardLocation(gameState, cardIdOrPredicate) {
    const state = resolveGameState(gameState);
    const controllers = [CONTROLLERS.ME, CONTROLLERS.OPPONENT];
    const zonesToSearch = [
      ZONES.HAND,
      ZONES.FIELD,
      ZONES.FIELD_ZONE,
      ZONES.GRAVE,
      ZONES.EXILE,
      ZONES.DECK,
      ZONES.KEY_DECK,
    ];

    for (const owner of controllers) {
      for (const zone of zonesToSearch) {
        if (zone === ZONES.FIELD_ZONE) {
          const card = getFieldZoneCard(state, owner);
          const matched = typeof cardIdOrPredicate === 'function'
            ? cardIdOrPredicate(card)
            : card && card.id === cardIdOrPredicate;
          if (matched) return { controller: owner, zone, index: null, card };
          continue;
        }

        const arr = getZoneArray(state, owner, zone);
        const idx = findCardIndex(arr, cardIdOrPredicate);
        if (idx >= 0) return { controller: owner, zone, index: idx, card: arr[idx] };
      }
    }

    return null;
  }

  function hasCardInZone(gameState, controller, zone, cardIdOrPredicate) {
    const normalizedZone = normalizeZone(zone);
    if (normalizedZone === ZONES.FIELD_ZONE) {
      const card = getFieldZoneCard(gameState, controller);
      return !!(typeof cardIdOrPredicate === 'function' ? cardIdOrPredicate(card) : card && card.id === cardIdOrPredicate);
    }
    return findCardIndex(getZoneArray(gameState, controller, normalizedZone), cardIdOrPredicate) >= 0;
  }

  function getControllerPrefix(controller) {
    const owner = normalizeController(controller);
    return owner === CONTROLLERS.ME ? 'my' : 'op';
  }

  global.HB_ZONE_ACCESS = Object.freeze({
    CONTROLLERS,
    normalizeController,
    normalizeZone,
    getControllerPrefix,
    getZoneArray,
    getZoneSize,
    getCardFromZone,
    findCardLocation,
    hasCardInZone,
    removeCardFromZone,
    insertCardToZone,
    getFieldZoneCard,
    setFieldZoneCard,
    clearFieldZoneCard,
  });
})(window);
