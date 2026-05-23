// HAND BATTLE — Engine: Legacy Bridge
// 새 EffectDefinition 엔진으로 이식된 카드와 아직 레거시 switch/테마 핸들러에 남은 카드를 분리한다.
// 핵심 규칙: effectIds/등록 효과가 있는 카드는 신엔진만 타고, 없는 카드는 기존 로직을 유지한다.
(function initLegacyBridge(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const ZONES = rules.ZONES || Object.freeze({
    HAND: 'hand',
    FIELD: 'field',
    FIELD_ZONE: 'fieldZone',
    GRAVE: 'grave',
    EXILE: 'exile',
  });
  const EVENTS = rules.EVENTS || Object.freeze({
    SUMMON: 'summon',
    SENT_TO_GRAVE: 'sentToGrave',
    EXILED: 'exiled',
  });

  const registry = global.HB_EFFECT_REGISTRY;
  const effectUi = global.HB_EFFECT_UI;
  const fieldZone = global.HB_FIELD_ZONE;
  const triggerQueue = global.HB_TRIGGER_QUEUE;
  const zoneAccess = global.HB_ZONE_ACCESS;

  const CONTROLLERS = (zoneAccess && zoneAccess.CONTROLLERS) || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });

  function getDefaultGameState() {
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    return null;
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function getCardDatabase() {
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || cardOrId.name || '';
  }

  function getCardDef(cardOrId) {
    const cardId = getCardId(cardOrId);
    if (!cardId) return null;
    const cards = getCardDatabase();
    if (cards && cards[cardId]) return cards[cardId];
    return typeof cardOrId === 'object' ? cardOrId : null;
  }

  function normalizeController(controller) {
    if (zoneAccess && typeof zoneAccess.normalizeController === 'function') return zoneAccess.normalizeController(controller || CONTROLLERS.ME);
    return controller === CONTROLLERS.OPPONENT || controller === 'op' || controller === 'opponent' ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
  }

  function makeOk(payload) {
    return Object.freeze(Object.assign({ ok: true }, payload || {}));
  }

  function makeFail(message, payload) {
    return Object.freeze(Object.assign({ ok: false, error: message }, payload || {}));
  }

  function hasEffectIds(cardOrId) {
    const card = getCardDef(cardOrId) || (typeof cardOrId === 'object' ? cardOrId : null);
    return !!(card && Array.isArray(card.effectIds) && card.effectIds.length > 0);
  }

  function hasRegisteredEffects(cardOrId) {
    const cardId = getCardId(cardOrId);
    if (!cardId) return false;
    if (hasEffectIds(cardOrId)) return true;
    if (effectUi && typeof effectUi.hasRegisteredEffects === 'function') return !!effectUi.hasRegisteredEffects(cardId);
    if (registry && typeof registry.getEffectsByCardId === 'function') return registry.getEffectsByCardId(cardId).length > 0;
    return false;
  }

  function getMigrationInfo(cardOrId) {
    const card = getCardDef(cardOrId) || (typeof cardOrId === 'object' ? cardOrId : null);
    return (card && (card.migration || card.engineMigration || card.hbMigration)) || null;
  }

  function isFullyMigratedCard(cardOrId) {
    const migration = getMigrationInfo(cardOrId);
    if (migration && migration.fullyMigrated === false) return false;
    if (migration && migration.fullyMigrated === true) return true;
    return hasRegisteredEffects(cardOrId);
  }

  function getRegisteredEffectsForCard(cardOrId) {
    const cardId = getCardId(cardOrId);
    if (!cardId || !registry || typeof registry.getEffectsByCardId !== 'function') return [];
    return registry.getEffectsByCardId(cardId);
  }

  function effectNoMatches(effect, effectNo) {
    if (effectNo == null) return true;
    return effect && effect.effectNo != null && String(effect.effectNo) === String(effectNo);
  }

  function migrationIncludesEffect(cardOrId, effectNo) {
    if (effectNo == null) return null;
    const migration = getMigrationInfo(cardOrId);
    if (!migration || !Array.isArray(migration.migratedEffects)) return null;
    return migration.migratedEffects.map(String).indexOf(String(effectNo)) !== -1;
  }

  function hasRegisteredEffect(cardOrId, effectNo, zone) {
    if (effectNo == null) return hasRegisteredEffects(cardOrId);
    const explicit = migrationIncludesEffect(cardOrId, effectNo);
    if (explicit === false) return false;
    const effects = getRegisteredEffectsForCard(cardOrId);
    return effects.some(effect => {
      if (!effectNoMatches(effect, effectNo)) return false;
      if (!zone) return true;
      const zones = effect.zones || (effect.zone ? [effect.zone] : []);
      return zones.length === 0 || zones.indexOf(zone) !== -1;
    }) || explicit === true;
  }

  function isNewEngineEffect(cardOrId, effectNo, zone) {
    return hasRegisteredEffect(cardOrId, effectNo, zone);
  }

  function isNewEngineCard(cardOrId) {
    return hasRegisteredEffects(cardOrId);
  }

  function shouldUseLegacyCard(cardOrId) {
    return !isFullyMigratedCard(cardOrId);
  }

  function shouldUseLegacyEffect(cardOrId, effectNo, zone) {
    return !isNewEngineEffect(cardOrId, effectNo, zone);
  }

  function inferHandIndex(ctx) {
    const c = ctx || {};
    if (typeof c.handIndex === 'number') return c.handIndex;
    if (typeof c.handIdx === 'number') return c.handIdx;
    if (typeof c.sourceIndex === 'number' && (c.sourceZone || c.zone) === ZONES.HAND) return c.sourceIndex;
    return null;
  }

  function inferSourceIndex(ctx) {
    const c = ctx || {};
    if (typeof c.sourceIndex === 'number') return c.sourceIndex;
    if (typeof c.handIndex === 'number') return c.handIndex;
    if (typeof c.handIdx === 'number') return c.handIdx;
    if (typeof c.fieldIndex === 'number') return c.fieldIndex;
    if (typeof c.fieldIdx === 'number') return c.fieldIdx;
    return null;
  }

  function notifyBridge(message) {
    // eslint-disable-next-line no-undef
    if (typeof notify === 'function') notify(message);
    else if (global.console && global.console.warn) console.warn('[legacy-bridge]', message);
  }

  function routeCardActivation(cardOrId, ctx) {
    const opts = ctx || {};
    const card = opts.card || getCardDef(cardOrId) || (typeof cardOrId === 'object' ? cardOrId : null);
    const cardId = getCardId(card || cardOrId);
    const zone = opts.zone || opts.sourceZone || ZONES.HAND;
    const preferredEffectNo = opts.effectNo != null ? String(opts.effectNo) : null;
    if (!cardId) return makeFail('카드 정보가 없습니다.', { usedNewEngine: false });

    if (preferredEffectNo && shouldUseLegacyEffect(card || cardId, preferredEffectNo, zone)) {
      return makeOk({ usedNewEngine: false, useLegacy: true, cardId, effectNo: preferredEffectNo });
    }

    if (!isNewEngineCard(card || cardId)) {
      return makeOk({ usedNewEngine: false, useLegacy: true, cardId });
    }

    const state = resolveGameState(opts.gameState);
    const controller = normalizeController(opts.controller || opts.player || CONTROLLERS.ME);
    const sourceIndex = inferSourceIndex(Object.assign({}, opts, { zone }));

    // 패에서 필드 카드 발동은 field-zone 엔진의 선처리 규칙을 반드시 탄다.
    if (zone === ZONES.HAND && card && card.cardType === 'field') {
      if (!fieldZone || typeof fieldZone.activateFieldCardFromHand !== 'function') {
        return makeFail('필드 존 엔진이 없어 신엔진 필드 카드를 발동할 수 없습니다.', { usedNewEngine: true, cardId });
      }
      const result = fieldZone.activateFieldCardFromHand({
        gameState: state,
        controller,
        handIndex: inferHandIndex(opts),
        cardId,
      });
      return result && result.ok === false
        ? makeFail(result.error || '필드 카드 발동 실패', { usedNewEngine: true, cardId, result })
        : makeOk({ usedNewEngine: true, cardId, result });
    }

    if (!effectUi || typeof effectUi.getAvailableEffects !== 'function' || typeof effectUi.activateAvailableEffect !== 'function') {
      return makeFail('Effect UI 라우터가 없어 신엔진 효과를 발동할 수 없습니다.', { usedNewEngine: true, cardId });
    }

    const entries = effectUi.getAvailableEffects({
      gameState: state,
      player: controller,
      controller,
      card,
      cardId,
      zone,
      sourceZone: zone,
      sourceIndex,
      handIndex: inferHandIndex(opts),
      handIdx: inferHandIndex(opts),
      fieldIndex: typeof opts.fieldIndex === 'number' ? opts.fieldIndex : opts.fieldIdx,
      fieldIdx: typeof opts.fieldIdx === 'number' ? opts.fieldIdx : opts.fieldIndex,
      event: opts.event || null,
    });

    if (!entries.length) {
      notifyBridge('현재 발동 가능한 신엔진 효과가 없습니다.');
      return makeFail('현재 발동 가능한 신엔진 효과가 없습니다.', { usedNewEngine: true, cardId, entries });
    }

    const selected = preferredEffectNo
      ? (entries.find(entry => entry.effect && String(entry.effect.effectNo) === preferredEffectNo) || entries[0])
      : entries[0];

    const result = effectUi.activateAvailableEffect(selected, opts);
    return result && result.ok === false
      ? makeFail(result.error || '신엔진 효과 발동 실패', { usedNewEngine: true, cardId, effectId: selected.effect && selected.effect.id, result })
      : makeOk({ usedNewEngine: true, cardId, effectId: selected.effect && selected.effect.id, result });
  }

  function normalizeTriggerEvent(type, eventOrCardId, extra) {
    const raw = typeof eventOrCardId === 'object' && eventOrCardId !== null ? eventOrCardId : Object.assign({}, extra || {}, { cardId: eventOrCardId });
    const cardId = getCardId(raw.card || raw.cardId || raw.id);
    const card = raw.card || getCardDef(cardId) || (cardId ? { id: cardId, name: cardId } : null);
    const controller = normalizeController(raw.controller || raw.player || raw.sourceController || CONTROLLERS.ME);
    return Object.assign({}, raw, {
      type,
      card,
      cardId,
      cardName: raw.cardName || (card && (card.name || card.id)) || cardId,
      controller,
      sourceController: normalizeController(raw.sourceController || controller),
      sourceZone: raw.sourceZone || raw.zone || (type === EVENTS.SENT_TO_GRAVE ? ZONES.GRAVE : ZONES.FIELD),
      from: raw.from,
    });
  }

  function routeTriggerEvent(type, eventOrCardId, options) {
    const opts = options || {};
    const event = normalizeTriggerEvent(type, eventOrCardId, opts);
    const state = resolveGameState(opts.gameState || event.gameState);
    const cardId = event.cardId;
    const sourceIsNew = isNewEngineCard(event.card || cardId);

    if (!triggerQueue || typeof triggerQueue.receiveEvent !== 'function') {
      return sourceIsNew
        ? makeFail('Trigger Queue가 없어 신엔진 유발 효과를 처리할 수 없습니다.', { usedNewEngine: true, event })
        : makeOk({ usedNewEngine: false, useLegacy: true, event });
    }

    let result;
    try {
      result = triggerQueue.receiveEvent(event, state, opts.triggerOptions || opts);
    } catch (err) {
      if (sourceIsNew) return makeFail(err.message, { usedNewEngine: true, event, errorObject: err });
      return makeOk({ usedNewEngine: false, useLegacy: true, event, errorObject: err });
    }

    const collectedCount = result && Array.isArray(result.collected) ? result.collected.length : 0;
    const usedNewEngine = sourceIsNew || collectedCount > 0;
    return makeOk({
      usedNewEngine,
      useLegacy: !usedNewEngine,
      event,
      result,
      collectedCount,
      sourceIsNew,
    });
  }

  function routeSummonTrigger(eventOrCardId, options) {
    return routeTriggerEvent(EVENTS.SUMMON || 'summon', eventOrCardId, options);
  }

  function routeSentToGraveTrigger(eventOrCardId, options) {
    return routeTriggerEvent(EVENTS.SENT_TO_GRAVE || 'sentToGrave', eventOrCardId, options);
  }

  function routeFieldZoneClick(cardOrId, ctx) {
    const opts = ctx || {};
    const card = opts.card || getCardDef(cardOrId) || (typeof cardOrId === 'object' ? cardOrId : null);
    const cardId = getCardId(card || cardOrId);
    if (!cardId) return makeFail('필드 존 카드 정보가 없습니다.', { usedNewEngine: false });

    if (!isNewEngineCard(card || cardId)) {
      return makeOk({ usedNewEngine: false, useLegacy: true, cardId });
    }

    if (!effectUi || typeof effectUi.renderFieldZoneEffectButtons !== 'function') {
      return makeFail('Effect UI가 없어 필드 존 효과 버튼을 만들 수 없습니다.', { usedNewEngine: true, cardId });
    }

    const result = effectUi.renderFieldZoneEffectButtons(card || { id: cardId, name: cardId }, {
      gameState: resolveGameState(opts.gameState),
      player: opts.player || opts.controller || CONTROLLERS.ME,
      controller: opts.controller || opts.player || CONTROLLERS.ME,
      actionsElement: opts.actionsElement,
    });

    return result && result.ok === false
      ? makeFail(result.error || '필드 존 라우팅 실패', { usedNewEngine: true, cardId, result })
      : makeOk({ usedNewEngine: true, cardId, result });
  }

  function shouldSuppressLegacyAction(cardOrId, reason) {
    const suppress = isNewEngineCard(cardOrId);
    return Object.freeze({ suppress, reason: reason || null, cardId: getCardId(cardOrId) });
  }

  const api = Object.freeze({
    isNewEngineCard,
    isNewEngineEffect,
    isFullyMigratedCard,
    hasRegisteredEffects,
    hasRegisteredEffect,
    shouldUseLegacyCard,
    shouldUseLegacyEffect,
    routeCardActivation,
    routeSummonTrigger,
    routeSentToGraveTrigger,
    routeFieldZoneClick,
    shouldSuppressLegacyAction,
  });

  global.HB_LEGACY_BRIDGE = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.legacyBridge = api;

  // 실행계획에 나온 이름을 디버그/테스트에서 바로 쓸 수 있게 노출한다.
  global.isNewEngineCard = isNewEngineCard;
  global.isNewEngineEffect = isNewEngineEffect;
  global.isFullyMigratedCard = isFullyMigratedCard;
  global.hasRegisteredEffects = hasRegisteredEffects;
  global.routeCardActivation = routeCardActivation;
  global.routeSummonTrigger = routeSummonTrigger;
  global.routeSentToGraveTrigger = routeSentToGraveTrigger;
  global.routeFieldZoneClick = routeFieldZoneClick;
})(window);
