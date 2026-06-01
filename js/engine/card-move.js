// HAND BATTLE — Engine: Card Move
// 모든 신규 효과 로직은 카드 이동 시 G.myField.push / splice 직접 조작 대신 이 파일을 통과한다.
// 이 파일은 아직 레거시 함수를 덮어쓰지 않고 window.HB_CARD_MOVE 전역 네임스페이스로만 제공한다.
(function initCardMove(global) {
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
  const EVENTS = rules.EVENTS || {
    SUMMON: 'summon',
    SENT_TO_GRAVE: 'sentToGrave',
    EXILED: 'exiled',
    ADDED_TO_HAND: 'addedToHand',
    DISCARDED: 'discarded',
    FIELD_CARD_PLACED: 'fieldCardPlaced',
    FIELD_CARD_LEFT: 'fieldCardLeft',
    CARD_ACTIVATED: 'cardActivated',
  };

  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!zoneAccess) {
    throw new Error('[card-move] HB_ZONE_ACCESS가 필요합니다. zone-access.js를 먼저 로드하세요.');
  }

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    throw new Error('[card-move] gameState가 없습니다. 함수 호출 시 gameState를 전달하세요.');
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function normalizeController(controller) {
    return zoneAccess.normalizeController(controller || CONTROLLERS.ME);
  }

  function normalizeZone(zone) {
    return zoneAccess.normalizeZone(zone);
  }

  function normalizeCardId(cardIdOrCard) {
    if (!cardIdOrCard) return '';
    if (typeof cardIdOrCard === 'string') return cardIdOrCard;
    return cardIdOrCard.id || '';
  }

  function getCardDef(cardId) {
    // cards.js가 const CARDS로 선언되어 있으면 window.CARDS에는 붙지 않는다.
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS && CARDS[cardId]) return CARDS[cardId];
    return (global.CARDS && global.CARDS[cardId]) || null;
  }

  function getCardName(cardId, fallbackCard) {
    const def = getCardDef(cardId);
    return (def && def.name) || (fallbackCard && fallbackCard.name) || cardId;
  }

  function clonePlainCard(card) {
    return card ? Object.assign({}, card) : null;
  }

  function normalizeLocation(location, defaultController, fieldName) {
    if (!location) {
      throw new Error(`[card-move] ${fieldName || 'location'}이 비어 있습니다.`);
    }

    if (typeof location === 'string') {
      return {
        controller: normalizeController(defaultController || CONTROLLERS.ME),
        zone: normalizeZone(location),
        index: null,
      };
    }

    return {
      controller: normalizeController(location.controller || defaultController || CONTROLLERS.ME),
      zone: normalizeZone(location.zone || location.name),
      index: typeof location.index === 'number' ? location.index : null,
    };
  }

  function locationForEvent(location) {
    if (!location) return null;
    return {
      controller: location.controller,
      zone: location.zone,
      index: typeof location.index === 'number' ? location.index : null,
    };
  }

  function makeCardForHand(card, reveal) {
    const cardId = normalizeCardId(card);
    return {
      id: cardId,
      name: getCardName(cardId, card),
      isPublic: !!reveal,
    };
  }

  function makeCardForPublicHand(card) {
    return makeCardForHand(card, true);
  }

  function makeCardForField(card, sourceZone) {
    const cardId = normalizeCardId(card);
    const def = getCardDef(cardId);
    const next = clonePlainCard(card) || { id: cardId };
    next.id = cardId;
    next.name = getCardName(cardId, card);
    next.atk = typeof next.atk === 'number' ? next.atk : ((def && typeof def.atk === 'number') ? def.atk : 0);
    next.atkBase = typeof next.atkBase === 'number' ? next.atkBase : next.atk;
    next.summonedFrom = sourceZone || next.summonedFrom || null;
    delete next.isPublic;
    return next;
  }

  function makeCardForSimpleZone(card) {
    const cardId = normalizeCardId(card);
    const next = clonePlainCard(card) || { id: cardId };
    next.id = cardId;
    next.name = getCardName(cardId, card);
    return next;
  }

  function prepareCardForZone(card, zone, options) {
    const normalizedZone = normalizeZone(zone);
    const opts = options || {};
    if (normalizedZone === ZONES.FIELD) return makeCardForField(card, opts.sourceZone);
    if (normalizedZone === ZONES.HAND) return makeCardForHand(card, !!opts.reveal);
    if (normalizedZone === ZONES.PUBLIC_HAND) return makeCardForPublicHand(card);
    return makeCardForSimpleZone(card);
  }

  function getFieldSlotLimit(gameState, controller) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);

    // continuous-engine.js가 로드된 뒤에는 몬스터 존 확장/축소 지속 효과까지 반영한다.
    const continuous = global.HB_CONTINUOUS_ENGINE;
    if (continuous && typeof continuous.getAvailableMonsterZoneCount === 'function') {
      try { return continuous.getAvailableMonsterZoneCount(owner, state); }
      catch (err) { console.warn('[card-move] 지속 효과 기반 몬스터 존 수 계산 실패:', err); }
    }

    const extraKey = owner === CONTROLLERS.ME ? 'myExtraSlots' : 'opExtraSlots';
    const extra = Number(state[extraKey] || 0);
    return Math.max(0, 5 + extra);
  }

  function hasFieldSpace(gameState, controller) {
    return zoneAccess.getZoneSize(gameState, controller, ZONES.FIELD) < getFieldSlotLimit(gameState, controller);
  }

  function makeEvent(type, payload) {
    const eventData = payload && payload.eventData ? payload.eventData : {};
    const event = Object.assign({}, eventData, {
      type,
      cardId: payload.cardId,
      cardName: payload.cardName || getCardName(payload.cardId, payload.card),
      controller: payload.controller,
      from: locationForEvent(payload.from),
      to: locationForEvent(payload.to),
      reason: payload.reason || 'unspecified',
      sourceZone: payload.sourceZone || (payload.from && payload.from.zone) || null,
      sourceController: payload.sourceController || (payload.from && payload.from.controller) || null,
      timestamp: Date.now(),
    });
    return event;
  }

  function makeDiff(kind, event, extra) {
    return Object.assign({
      kind,
      eventType: event && event.type,
      cardId: event && event.cardId,
      controller: event && event.controller,
      from: event && event.from,
      to: event && event.to,
      reason: event && event.reason,
      timestamp: event && event.timestamp,
    }, extra || {});
  }

  let moveOperationDepth = 0;

  function hasLegacyActiveChain() {
    try {
      // eslint-disable-next-line no-undef
      return !!(typeof activeChainState !== 'undefined' && activeChainState && activeChainState.active);
    } catch (_) {
      return false;
    }
  }

  function hasHbActiveChain() {
    const chain = global.HB_CHAIN_ENGINE;
    if (!chain || typeof chain.getChainState !== 'function') return false;
    try {
      const state = chain.getChainState();
      return !!(state && (state.active || state.resolving));
    } catch (err) {
      console.warn('[card-move] chain state check failed:', err);
      return false;
    }
  }

  function shouldDeferEventDispatch() {
    return !!(
      global._chainResolving ||
      global._hbActivatingChainEffect ||
      hasLegacyActiveChain() ||
      hasHbActiveChain()
    );
  }

  function flushPendingMoveEvents(gameState, options) {
    const opts = options || {};
    if (opts.deferDispatch === true || opts.dispatchEvents === false) return null;
    if (shouldDeferEventDispatch()) return null;
    if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') {
      return global.HB_EVENTS.dispatchEvents(gameState);
    }
    return null;
  }

  function runMoveOperation(gameState, options, work) {
    moveOperationDepth += 1;
    try {
      return work();
    } finally {
      moveOperationDepth -= 1;
      if (moveOperationDepth === 0) flushPendingMoveEvents(gameState, options);
    }
  }

  function dispatchMoveEvent(gameState, event) {
    const state = resolveGameState(gameState);

    if (global.HB_EVENTS && typeof global.HB_EVENTS.emitGameEvent === 'function') {
      return global.HB_EVENTS.emitGameEvent(event, state);
    }

    // event-bus.js가 없는 구버전 로딩 환경을 위한 최소 fallback.
    if (global.HB_TRIGGER_QUEUE && typeof global.HB_TRIGGER_QUEUE.receiveEvent === 'function') {
      global.HB_TRIGGER_QUEUE.receiveEvent(event, state);
    }

    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('hb:card-event', { detail: { event, gameState: state } }));
    }

    return event;
  }

  function okResult(payload) {
    return Object.assign({ ok: true }, payload || {});
  }

  function failResult(message, payload) {
    return Object.assign({ ok: false, error: message }, payload || {});
  }

  function inferMoveEventType(toZone) {
    const zone = normalizeZone(toZone);
    if (zone === ZONES.FIELD) return EVENTS.SUMMON;
    if (zone === ZONES.GRAVE) return EVENTS.SENT_TO_GRAVE;
    if (zone === ZONES.EXILE) return EVENTS.EXILED;
    if (zone === ZONES.HAND || zone === ZONES.PUBLIC_HAND) return EVENTS.ADDED_TO_HAND;
    if (zone === ZONES.FIELD_ZONE) return EVENTS.FIELD_CARD_PLACED;
    return 'cardMoved';
  }

  function moveCard(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    return runMoveOperation(state, opts, () => moveCardCore(Object.assign({}, opts, { gameState: state })));
  }

  function moveCardCore(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const cardId = normalizeCardId(opts.cardId || opts.card);
    if (!cardId) return failResult('cardId가 없습니다.');

    let from;
    try {
      from = opts.from
        ? normalizeLocation(opts.from, owner, 'from')
        : zoneAccess.findCardLocation(state, cardId);
      if (!from) return failResult(`${cardId}의 출발 존을 찾지 못했습니다.`);
    } catch (err) {
      return failResult(err.message);
    }

    let to;
    try {
      to = normalizeLocation(opts.to, opts.to && opts.to.controller ? opts.to.controller : owner, 'to');
    } catch (err) {
      return failResult(err.message);
    }

    if (to.zone === ZONES.FIELD && !hasFieldSpace(state, to.controller)) {
      return failResult('몬스터 존이 가득 찼습니다.', { cardId, controller: to.controller });
    }

    let removed;
    try {
      removed = zoneAccess.removeCardFromZone(state, from.controller, from.zone, cardId, from.index);
    } catch (err) {
      return failResult(err.message, { cardId, from: locationForEvent(from) });
    }

    if (!removed) return failResult(`${cardId}를 ${from.controller}/${from.zone}에서 찾지 못했습니다.`);

    const movedCard = prepareCardForZone(removed, to.zone, {
      reveal: !!opts.reveal || !!opts.faceUp,
      sourceZone: from.zone,
    });

    try {
      zoneAccess.insertCardToZone(state, to.controller, to.zone, movedCard, to.index);
    } catch (err) {
      // 삽입 실패 시 가능한 한 원위치 복구한다.
      try { zoneAccess.insertCardToZone(state, from.controller, from.zone, removed, from.index); } catch (_) {}
      return failResult(err.message, { cardId, from: locationForEvent(from), to: locationForEvent(to) });
    }

    const eventType = opts.eventType || inferMoveEventType(to.zone);
    const event = dispatchMoveEvent(state, makeEvent(eventType, {
      cardId,
      card: movedCard,
      controller: opts.eventController ? normalizeController(opts.eventController) : to.controller,
      from,
      to,
      reason: opts.reason,
      eventData: opts.eventData,
    }));

    return okResult({
      movedCard,
      event,
      events: [event],
      diff: makeDiff('moveCard', event),
    });
  }

  function summonCard(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const cardId = normalizeCardId(opts.cardId || opts.card);
    if (!cardId) return failResult('cardId가 없습니다.');

    const def = getCardDef(cardId);
    if (def && def.cardType && def.cardType !== 'monster') {
      return failResult('몬스터만 소환할 수 있습니다.', { cardId, cardType: def.cardType });
    }
    if (!hasFieldSpace(state, owner)) {
      return failResult('몬스터 존이 가득 찼습니다.', { cardId, controller: owner });
    }

    return moveCard({
      gameState: state,
      cardId,
      from: opts.from,
      to: { controller: owner, zone: ZONES.FIELD, index: opts.fieldIndex },
      controller: owner,
      reason: opts.reason || 'summon',
      eventType: EVENTS.SUMMON,
      eventData: Object.assign({}, opts.eventData || {}, {
        sourceZone: opts.eventData && opts.eventData.sourceZone,
        summonType: opts.summonType || 'effect',
      }),
    });
  }

  // 상대 효과가 카드를 제거하려 할 때 내성/보호(지속효과)를 조회하는 backstop.
  // 효과 기반(ctx.move → opts.effect 주입) 제거만 검사하고, 전투/룰/레거시 직접 호출은 통과시킨다.
  // 자기 효과(actor === owner)는 막지 않는다. 막혀야 하면 failResult를, 아니면 null을 반환한다.
  function checkRemovalImmunity(state, card, owner, opts, action) {
    const continuous = global.HB_CONTINUOUS_ENGINE;
    if (!continuous || !opts.effect || !card) return null;
    const ownerC = normalizeController(owner);
    const actor = normalizeController(opts.actorController || (opts.effect && opts.effect.controller) || ownerC);
    if (actor === ownerC) return null; // 자기 효과는 내성 대상 아님
    const checkInput = {
      gameState: state, target: card, card, monster: card,
      targetController: ownerC, actorController: actor,
      action, reason: opts.reason, effect: opts.effect, chainLink: opts.chainLink,
      isTargeting: opts.isTargeting === true,
    };
    const name = getCardName(normalizeCardId(card), card);
    if (typeof continuous.checkEffectImmunity === 'function') {
      const imm = continuous.checkEffectImmunity(checkInput);
      if (imm && imm.blocked) return failResult(`${name}는 효과를 받지 않습니다(내성).`, { blocked: true, immunity: imm, reason: imm.reason || 'effectImmunity' });
    }
    if (action === 'sendToGrave' && typeof continuous.checkCannotBeSentToGrave === 'function') {
      const g = continuous.checkCannotBeSentToGrave(checkInput);
      if (g && g.blocked) return failResult(`${name}는 묘지로 보낼 수 없습니다.`, { blocked: true, immunity: g, reason: g.reason || 'cannotBeSentToGrave' });
    }
    if (opts.isTargeting === true && typeof continuous.checkTargetProtection === 'function') {
      const tp = continuous.checkTargetProtection(checkInput);
      if (tp && tp.blocked) return failResult(`${name}는 대상으로 지정할 수 없습니다(대상 내성).`, { blocked: true, immunity: tp, reason: tp.reason || 'targetProtection' });
    }
    return null;
  }

  function findCardInZone(state, location, cardId) {
    if (!location) return null;
    return zoneAccess.getZoneArray(state, location.controller, location.zone)
      .find(c => normalizeCardId(c) === cardId) || null;
  }

  function sendToGrave(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const cardId = normalizeCardId(opts.cardId || opts.card);
    if (!cardId) return failResult('cardId가 없습니다.');

    let from;
    try {
      from = opts.from ? normalizeLocation(opts.from, owner, 'from') : zoneAccess.findCardLocation(state, cardId);
      if (!from) return failResult(`${cardId}의 출발 존을 찾지 못했습니다.`);
    } catch (err) {
      return failResult(err.message);
    }

    const immuneBlock = checkRemovalImmunity(state, findCardInZone(state, from, cardId), from.controller, opts, 'sendToGrave');
    if (immuneBlock) return immuneBlock;

    return moveCard({
      gameState: state,
      cardId,
      from,
      to: { controller: owner, zone: ZONES.GRAVE },
      controller: owner,
      reason: opts.reason || 'sendToGrave',
      eventType: EVENTS.SENT_TO_GRAVE,
      eventData: Object.assign({}, opts.eventData || {}, {
        sourceZone: from.zone,
        sourceController: from.controller,
      }),
    });
  }

  function banishCard(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const cardId = normalizeCardId(opts.cardId || opts.card);
    if (!cardId) return failResult('cardId가 없습니다.');

    let from;
    try {
      from = opts.from ? normalizeLocation(opts.from, owner, 'from') : zoneAccess.findCardLocation(state, cardId);
      if (!from) return failResult(`${cardId}의 출발 존을 찾지 못했습니다.`);
    } catch (err) {
      return failResult(err.message);
    }

    const immuneBlock = checkRemovalImmunity(state, findCardInZone(state, from, cardId), from.controller, opts, 'banish');
    if (immuneBlock) return immuneBlock;

    return moveCard({
      gameState: state,
      cardId,
      from,
      to: { controller: owner, zone: ZONES.EXILE },
      controller: owner,
      reason: opts.reason || 'banish',
      eventType: EVENTS.EXILED,
      eventData: Object.assign({}, opts.eventData || {}, {
        sourceZone: from.zone,
        sourceController: from.controller,
      }),
    });
  }

  function discardCard(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const cardId = normalizeCardId(opts.cardId || opts.card);
    if (!cardId) return failResult('cardId가 없습니다.');

    const from = {
      controller: owner,
      zone: ZONES.HAND,
      index: opts.from && typeof opts.from.index === 'number'
        ? opts.from.index
        : (typeof opts.index === 'number' ? opts.index : null),
    };

    const result = moveCard({
      gameState: state,
      cardId,
      from,
      to: { controller: owner, zone: ZONES.GRAVE },
      controller: owner,
      reason: opts.reason || 'discard',
      eventType: EVENTS.DISCARDED,
      eventData: Object.assign({}, opts.eventData || {}, {
        sourceZone: ZONES.HAND,
        sourceController: owner,
      }),
      deferDispatch: true,
    });

    if (!result.ok) return result;

    const sentEvent = dispatchMoveEvent(state, makeEvent(EVENTS.SENT_TO_GRAVE, {
      cardId,
      card: result.movedCard,
      controller: owner,
      from,
      to: { controller: owner, zone: ZONES.GRAVE },
      reason: opts.reason || 'discard',
      eventData: Object.assign({}, opts.eventData || {}, {
        sourceZone: ZONES.HAND,
        sourceController: owner,
        causedBy: EVENTS.DISCARDED,
      }),
    }));

    result.events = [result.event, sentEvent];
    result.diff = makeDiff('discardCard', result.event, { secondaryEventType: sentEvent.type });
    flushPendingMoveEvents(state, opts);
    return result;
  }

  function addToHand(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const cardId = normalizeCardId(opts.cardId || opts.card);
    if (!cardId) return failResult('cardId가 없습니다.');

    let from;
    try {
      from = opts.from ? normalizeLocation(opts.from, owner, 'from') : zoneAccess.findCardLocation(state, cardId);
      if (!from) return failResult(`${cardId}의 출발 존을 찾지 못했습니다.`);
    } catch (err) {
      return failResult(err.message);
    }

    return moveCard({
      gameState: state,
      cardId,
      from,
      to: { controller: owner, zone: opts.reveal ? ZONES.PUBLIC_HAND : ZONES.HAND },
      controller: owner,
      reason: opts.reason || 'addToHand',
      reveal: !!opts.reveal,
      eventType: EVENTS.ADDED_TO_HAND,
      eventData: Object.assign({}, opts.eventData || {}, {
        reveal: !!opts.reveal,
        sourceZone: from.zone,
        sourceController: from.controller,
      }),
    });
  }

  function removeFieldCard(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const target = normalizeLocation(opts.to || ZONES.GRAVE, owner, 'to');
    const current = zoneAccess.getFieldZoneCard(state, owner);
    if (!current) return failResult('필드 존에 카드가 없습니다.', { controller: owner });

    const cardId = normalizeCardId(current);
    const from = { controller: owner, zone: ZONES.FIELD_ZONE, index: null };
    const removed = zoneAccess.clearFieldZoneCard(state, owner);
    const movedCard = prepareCardForZone(removed, target.zone, {
      reveal: !!opts.reveal,
      sourceZone: ZONES.FIELD_ZONE,
    });

    try {
      zoneAccess.insertCardToZone(state, target.controller, target.zone, movedCard, target.index);
    } catch (err) {
      zoneAccess.setFieldZoneCard(state, owner, removed);
      return failResult(err.message, { cardId, from: locationForEvent(from), to: locationForEvent(target) });
    }

    const leftEvent = dispatchMoveEvent(state, makeEvent(EVENTS.FIELD_CARD_LEFT, {
      cardId,
      card: movedCard,
      controller: owner,
      from,
      to: target,
      reason: opts.reason || 'removeFieldCard',
      eventData: opts.eventData,
    }));

    const events = [leftEvent];
    if (target.zone === ZONES.GRAVE) {
      const graveEvent = dispatchMoveEvent(state, makeEvent(EVENTS.SENT_TO_GRAVE, {
        cardId,
        card: movedCard,
        controller: target.controller,
        from,
        to: target,
        reason: opts.reason || 'removeFieldCard',
        eventData: Object.assign({}, opts.eventData || {}, {
          sourceZone: ZONES.FIELD_ZONE,
          sourceController: owner,
          causedBy: EVENTS.FIELD_CARD_LEFT,
        }),
      }));
      events.push(graveEvent);
    }

    const dispatchResult = flushPendingMoveEvents(state, opts);
    return okResult({
      movedCard,
      removedCard: movedCard,
      event: leftEvent,
      events,
      dispatchResult,
      diff: makeDiff('removeFieldCard', leftEvent),
    });
  }

  function placeFieldCard(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const owner = normalizeController(opts.controller || CONTROLLERS.ME);
    const cardId = normalizeCardId(opts.cardId || opts.card);
    if (!cardId) return failResult('cardId가 없습니다.');

    const def = getCardDef(cardId);
    if (def && def.cardType && def.cardType !== 'field') {
      return failResult('필드 카드만 필드 존에 놓을 수 있습니다.', { cardId, cardType: def.cardType });
    }

    let source;
    try {
      source = opts.source || opts.from
        ? normalizeLocation(opts.source || opts.from, owner, 'source')
        : zoneAccess.findCardLocation(state, cardId);
      if (!source) return failResult(`${cardId}의 출발 존을 찾지 못했습니다.`);
    } catch (err) {
      return failResult(err.message);
    }

    let removedNewCard;
    try {
      removedNewCard = zoneAccess.removeCardFromZone(state, source.controller, source.zone, cardId, source.index);
    } catch (err) {
      return failResult(err.message, { cardId, source: locationForEvent(source) });
    }
    if (!removedNewCard) return failResult(`${cardId}를 ${source.controller}/${source.zone}에서 찾지 못했습니다.`);

    const events = [];
    const replacedCard = zoneAccess.getFieldZoneCard(state, owner);
    let replacementResult = null;
    if (replacedCard) {
      replacementResult = removeFieldCard({
        gameState: state,
        controller: owner,
        to: { controller: owner, zone: ZONES.GRAVE },
        reason: 'fieldCardReplace',
        eventData: Object.assign({}, opts.eventData || {}, { replacedBy: cardId }),
        deferDispatch: true,
      });
      if (!replacementResult.ok) {
        try { zoneAccess.insertCardToZone(state, source.controller, source.zone, removedNewCard, source.index); } catch (_) {}
        return replacementResult;
      }
      events.push.apply(events, replacementResult.events || [replacementResult.event]);
    }

    const placedCard = makeCardForSimpleZone(removedNewCard);
    zoneAccess.setFieldZoneCard(state, owner, placedCard);

    const to = { controller: owner, zone: ZONES.FIELD_ZONE, index: null };
    const placedEvent = dispatchMoveEvent(state, makeEvent(EVENTS.FIELD_CARD_PLACED, {
      cardId,
      card: placedCard,
      controller: owner,
      from: source,
      to,
      reason: opts.reason || (opts.activate ? 'fieldCardActivate' : 'placeFieldCard'),
      eventData: Object.assign({}, opts.eventData || {}, {
        activate: !!opts.activate,
        sourceZone: source.zone,
        sourceController: source.controller,
      }),
    }));
    events.push(placedEvent);

    let activation = null;
    if (opts.activate) {
      const activationEvent = dispatchMoveEvent(state, makeEvent(EVENTS.CARD_ACTIVATED, {
        cardId,
        card: placedCard,
        controller: owner,
        from: source,
        to,
        reason: opts.reason || 'fieldCardActivate',
        eventData: Object.assign({}, opts.eventData || {}, {
          activationType: 'fieldCardActivation',
          sourceZone: source.zone,
          sourceController: source.controller,
        }),
      }));
      events.push(activationEvent);

      // chain-engine.js가 생기기 전까지는 체인 링크 후보만 반환한다.
      activation = {
        type: 'fieldCardActivation',
        cardId,
        controller: owner,
        sourceZone: ZONES.FIELD_ZONE,
        reason: opts.reason || 'fieldCardActivate',
        event: activationEvent,
      };
    }

    const dispatchResult = flushPendingMoveEvents(state, opts);
    return okResult({
      placedCard,
      replacedCard: replacedCard || null,
      replacementResult,
      event: placedEvent,
      events,
      activation,
      dispatchResult,
      diff: makeDiff('placeFieldCard', placedEvent, {
        activate: !!opts.activate,
        replacedCardId: replacedCard ? replacedCard.id : null,
      }),
    });
  }

  global.HB_CARD_MOVE = Object.freeze({
    moveCard,
    summonCard,
    sendToGrave,
    banishCard,
    discardCard,
    addToHand,
    placeFieldCard,
    removeFieldCard,
    getFieldSlotLimit,
    hasFieldSpace,
    dispatchMoveEvent,
  });
})(window);
