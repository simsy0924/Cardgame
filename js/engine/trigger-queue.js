// HAND BATTLE — Engine: Trigger Queue
// 이벤트 발생 후 trigger 효과만 수집하고, 강제/임의 유발을 분리해 체인 엔진으로 넘긴다.
// continuous/procedure/replacement는 여기서 처리하지 않는다.
(function initTriggerQueue(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({
    TRIGGER: 'trigger',
    CONTINUOUS: 'continuous',
    PROCEDURE: 'procedure',
    REPLACEMENT: 'replacement',
  });
  const ZONES = rules.ZONES || Object.freeze({
    DECK: 'deck',
    HAND: 'hand',
    PUBLIC_HAND: 'publicHand',
    FIELD: 'field',
    FIELD_ZONE: 'fieldZone',
    GRAVE: 'grave',
    EXILE: 'exile',
    KEY_DECK: 'keyDeck',
  });

  const zoneAccess = global.HB_ZONE_ACCESS;
  const effectContext = global.HB_EFFECT_CONTEXT;
  const effectDefinition = global.HB_EFFECT_DEFINITION;
  const registry = global.HB_EFFECT_REGISTRY;

  if (!zoneAccess) throw new Error('[trigger-queue] HB_ZONE_ACCESS가 필요합니다.');
  if (!effectContext) throw new Error('[trigger-queue] HB_EFFECT_CONTEXT가 필요합니다.');
  if (!registry) throw new Error('[trigger-queue] HB_EFFECT_REGISTRY가 필요합니다.');

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const ANY_EVENT = '*';
  const mandatoryQueue = [];
  const optionalQueue = [];
  const triggerHistory = [];
  const MAX_HISTORY = 300;
  let nextTriggerSequence = 1;

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    throw new Error('[trigger-queue] gameState가 없습니다. 함수 호출 시 gameState를 전달하세요.');
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function makeOk(payload) {
    return Object.freeze(Object.assign({ ok: true }, payload || {}));
  }

  function makeFail(message, payload) {
    return Object.freeze(Object.assign({ ok: false, error: message }, payload || {}));
  }

  function resultOk(result) {
    return result === undefined || result === true || (result && result.ok !== false);
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || cardOrId.name || '';
  }

  function getCardName(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.name || cardOrId.id || cardOrId.cardId || '';
  }

  function cardMatchesEffect(card, effect) {
    if (!card || !effect) return false;
    const effectCardId = String(effect.cardId || '');
    if (!effectCardId) return false;
    return [card.id, card.cardId, card.name, card.originalId]
      .filter(value => value != null && value !== '')
      .map(String)
      .includes(effectCardId);
  }

  function normalizeEvent(eventOrType) {
    if (!eventOrType) throw new Error('[trigger-queue] event가 필요합니다.');
    if (typeof eventOrType === 'string') return Object.freeze({ type: eventOrType });
    if (!eventOrType.type) throw new Error('[trigger-queue] event.type이 필요합니다.');
    return eventOrType;
  }

  function eventMatchesEffect(effect, event) {
    if (!effect || !event) return false;
    const events = asArray(effect.events && effect.events.length ? effect.events : effect.event);
    return events.length === 0 || events.indexOf(event.type) !== -1 || events.indexOf(ANY_EVENT) !== -1;
  }

  function isTriggerEffect(effect) {
    if (!effect) return false;
    if (effectDefinition && typeof effectDefinition.isTriggerEffect === 'function') {
      return effectDefinition.isTriggerEffect(effect);
    }
    return effect.type === EFFECT_TYPES.TRIGGER;
  }

  function isContinuousEffect(effect) {
    if (!effect) return false;
    if (effectDefinition && typeof effectDefinition.isContinuousEffect === 'function') {
      return effectDefinition.isContinuousEffect(effect);
    }
    return effect.type === EFFECT_TYPES.CONTINUOUS || !!effect.continuousRule;
  }

  function isProcedureEffect(effect) {
    if (!effect) return false;
    if (effectDefinition && typeof effectDefinition.isProcedureEffect === 'function') {
      return effectDefinition.isProcedureEffect(effect);
    }
    return effect.type === EFFECT_TYPES.PROCEDURE || !!effect.summonProcedure;
  }

  function isQueueEligibleEffect(effect, event) {
    if (!effect) return false;
    if (!isTriggerEffect(effect)) return false;
    if (isContinuousEffect(effect)) return false;
    if (isProcedureEffect(effect)) return false;
    if (effect.type === EFFECT_TYPES.REPLACEMENT) return false;
    return eventMatchesEffect(effect, event);
  }

  function effectZones(effect) {
    return asArray(effect && effect.zones && effect.zones.length ? effect.zones : (effect && effect.zone));
  }

  function zoneAllowed(effect, zone) {
    const zones = effectZones(effect);
    return zones.length === 0 || zones.indexOf(zone) !== -1;
  }

  function defaultZonesForEffect(effect) {
    const zones = effectZones(effect);
    if (zones.length > 0) return zones;
    return [ZONES.FIELD, ZONES.FIELD_ZONE, ZONES.GRAVE, ZONES.EXILE, ZONES.HAND, ZONES.PUBLIC_HAND, ZONES.DECK, ZONES.KEY_DECK];
  }

  function makeLocation(controller, zone, index, card) {
    return Object.freeze({
      controller,
      zone,
      index: typeof index === 'number' ? index : null,
      card,
    });
  }

  function scanArrayZone(state, controller, zone, effect, locations, seen) {
    let arr;
    try {
      arr = zoneAccess.getZoneArray(state, controller, zone);
    } catch (err) {
      return;
    }
    arr.forEach((card, index) => {
      if (!cardMatchesEffect(card, effect)) return;
      const key = `${controller}:${zone}:${index}:${getCardId(card)}`;
      if (seen.has(key)) return;
      seen.add(key);
      locations.push(makeLocation(controller, zone, index, card));
    });
  }

  function findEffectSourceLocations(effect, gameState) {
    const state = resolveGameState(gameState);
    const locations = [];
    const seen = new Set();
    const zones = defaultZonesForEffect(effect);
    const controllers = [CONTROLLERS.ME, CONTROLLERS.OPPONENT];

    controllers.forEach(controller => {
      zones.forEach(rawZone => {
        let zone;
        try { zone = zoneAccess.normalizeZone(rawZone); }
        catch (err) { return; }

        if (!zoneAllowed(effect, zone)) return;

        if (zone === ZONES.FIELD_ZONE) {
          let card = null;
          try { card = zoneAccess.getFieldZoneCard(state, controller); }
          catch (err) { card = null; }
          if (!cardMatchesEffect(card, effect)) return;
          const key = `${controller}:${zone}:fieldZone:${getCardId(card)}`;
          if (seen.has(key)) return;
          seen.add(key);
          locations.push(makeLocation(controller, zone, null, card));
          return;
        }

        scanArrayZone(state, controller, zone, effect, locations, seen);
      });
    });

    return locations;
  }

  function getTriggerEffectsForEvent(event) {
    const byEvent = registry && typeof registry.getTriggerEffectsByEvent === 'function'
      ? registry.getTriggerEffectsByEvent(event.type)
      : [];

    // event가 없는 범용 trigger를 위해 전체 목록에서도 한 번 더 확인한다.
    const allEffects = registry && typeof registry.listEffects === 'function' ? registry.listEffects() : [];
    const seen = new Set();
    const result = [];

    byEvent.concat(allEffects).forEach(effect => {
      if (!effect || seen.has(effect.id)) return;
      seen.add(effect.id);
      if (isQueueEligibleEffect(effect, event)) result.push(effect);
    });

    return result;
  }

  function createTriggerEntry(effect, ctx, event, options) {
    const opts = options || {};
    const mandatory = effect.mandatory === true || effect.optional === false;
    const optional = !mandatory;
    const sequence = nextTriggerSequence++;
    const source = ctx.source || null;
    const entry = {
      id: opts.id || `trg_${Date.now()}_${sequence}`,
      sequence,
      effectId: effect.id,
      cardId: effect.cardId,
      cardName: getCardName(ctx.card) || effect.cardId,
      controller: ctx.controller,
      sourceController: ctx.sourceController || ctx.controller,
      sourceZone: ctx.sourceZone || null,
      sourceIndex: typeof ctx.sourceIndex === 'number' ? ctx.sourceIndex : null,
      source,
      effect,
      ctx,
      event,
      optional,
      mandatory,
      status: 'pending',
      createdAt: Date.now(),
    };
    return Object.freeze(entry);
  }

  function compareTriggerEntries(a, b) {
    const mandatoryDelta = Number(b.mandatory === true) - Number(a.mandatory === true);
    if (mandatoryDelta) return mandatoryDelta;
    const eventDelta = Number((a.event && a.event.sequence) || 0) - Number((b.event && b.event.sequence) || 0);
    if (eventDelta) return eventDelta;
    const sourceDelta = String(a.sourceController || '').localeCompare(String(b.sourceController || ''));
    if (sourceDelta) return sourceDelta;
    const indexDelta = Number(a.sourceIndex == null ? 9999 : a.sourceIndex) - Number(b.sourceIndex == null ? 9999 : b.sourceIndex);
    if (indexDelta) return indexDelta;
    return a.sequence - b.sequence;
  }

  function runCondition(effect, ctx) {
    try {
      const conditionResult = effect.condition(ctx);
      if (!resultOk(conditionResult)) {
        return makeFail('조건을 만족하지 않습니다.', { effectId: effect.id, conditionResult });
      }

      const canResolveResult = effect.canResolve ? effect.canResolve(ctx) : true;
      if (!resultOk(canResolveResult)) {
        return makeFail('효과 처리를 할 수 없어 유발 후보에 올릴 수 없습니다.', { effectId: effect.id, conditionResult, canResolveResult });
      }

      return makeOk({ conditionResult, canResolveResult });
    } catch (err) {
      return makeFail(`condition/canResolve 실행 중 오류: ${err.message}`, { effectId: effect.id, errorObject: err });
    }
  }

  function makeContextForLocation(effect, event, gameState, location, options) {
    const opts = options || {};
    return effectContext.createEffectContext({
      gameState,
      controller: location.controller,
      card: location.card,
      source: location,
      sourceZone: location.zone,
      sourceIndex: location.index,
      effect,
      event,
      authority: opts.authority,
      networkMode: opts.networkMode,
      isAI: opts.isAI,
      askPlayer: opts.askPlayer,
      silentLog: opts.silentLog !== false,
    });
  }

  function collectTriggers(eventOrType, gameState, options) {
    const event = normalizeEvent(eventOrType);
    const state = resolveGameState(gameState);
    const opts = options || {};
    const triggers = [];
    const rejected = [];
    const effects = getTriggerEffectsForEvent(event);

    effects.forEach(effect => {
      const locations = findEffectSourceLocations(effect, state);
      if (locations.length === 0) {
        rejected.push(Object.freeze({ effectId: effect.id, reason: 'sourceNotFound' }));
        return;
      }

      locations.forEach(location => {
        let ctx;
        try {
          ctx = makeContextForLocation(effect, event, state, location, opts);
        } catch (err) {
          rejected.push(Object.freeze({ effectId: effect.id, reason: 'contextError', error: err.message }));
          return;
        }

        const condition = runCondition(effect, ctx);
        if (!condition.ok) {
          rejected.push(Object.freeze({ effectId: effect.id, reason: 'conditionFailed', detail: condition }));
          return;
        }

        triggers.push(createTriggerEntry(effect, ctx, event));
      });
    });

    triggers.sort(compareTriggerEntries);
    return Object.freeze(triggers.map(entry => Object.freeze(entry)));
  }

  function normalizeTriggerInput(effectOrEntry, ctxOrOptions) {
    if (effectOrEntry && effectOrEntry.effect && effectOrEntry.ctx) return effectOrEntry;
    const effect = effectOrEntry && effectOrEntry.id ? effectOrEntry : (registry.getEffectById && registry.getEffectById(effectOrEntry));
    if (!effect) throw new Error('[trigger-queue] 등록할 effect를 찾지 못했습니다.');
    const ctx = ctxOrOptions && ctxOrOptions.gameState ? effectContext.createEffectContext(Object.assign({}, ctxOrOptions, { effect })) : ctxOrOptions;
    if (!ctx) throw new Error('[trigger-queue] enqueueTrigger에는 ctx가 필요합니다.');
    return createTriggerEntry(effect, ctx, ctx.event || (ctxOrOptions && ctxOrOptions.event) || { type: ANY_EVENT });
  }

  function remember(entry, action, result) {
    const item = Object.freeze({
      triggerId: entry && entry.id,
      effectId: entry && entry.effectId,
      controller: entry && entry.controller,
      action,
      result: result || null,
      timestamp: Date.now(),
    });
    triggerHistory.push(item);
    if (triggerHistory.length > MAX_HISTORY) triggerHistory.splice(0, triggerHistory.length - MAX_HISTORY);
    return item;
  }

  function enqueueTrigger(effectOrEntry, ctxOrOptions) {
    let entry;
    try { entry = normalizeTriggerInput(effectOrEntry, ctxOrOptions); }
    catch (err) { return makeFail(err.message); }

    if (!isQueueEligibleEffect(entry.effect, entry.event || {})) {
      return makeFail('trigger queue에 들어갈 수 없는 효과입니다.', { effectId: entry.effectId, type: entry.effect && entry.effect.type });
    }

    const targetQueue = entry.mandatory ? mandatoryQueue : optionalQueue;
    targetQueue.push(entry);
    targetQueue.sort(compareTriggerEntries);
    remember(entry, entry.mandatory ? 'enqueueMandatory' : 'enqueueOptional');
    return makeOk({ trigger: entry, queue: entry.mandatory ? 'mandatory' : 'optional' });
  }

  function enqueueMandatoryTriggers(triggers) {
    const enqueued = [];
    const skipped = [];
    asArray(triggers).forEach(trigger => {
      if (!trigger) return;
      if (trigger.mandatory !== true) {
        skipped.push(trigger);
        return;
      }
      mandatoryQueue.push(trigger);
      enqueued.push(trigger);
      remember(trigger, 'enqueueMandatory');
    });
    mandatoryQueue.sort(compareTriggerEntries);
    return makeOk({ enqueued: Object.freeze(enqueued), skipped: Object.freeze(skipped), count: enqueued.length });
  }

  function enqueueOptionalTriggers(triggers) {
    const enqueued = [];
    const skipped = [];
    asArray(triggers).forEach(trigger => {
      if (!trigger) return;
      if (trigger.optional !== true) {
        skipped.push(trigger);
        return;
      }
      optionalQueue.push(trigger);
      enqueued.push(trigger);
      remember(trigger, 'enqueueOptional');
    });
    optionalQueue.sort(compareTriggerEntries);
    return makeOk({ enqueued: Object.freeze(enqueued), skipped: Object.freeze(skipped), count: enqueued.length });
  }

  function triggerSummary(trigger) {
    return Object.freeze({
      id: trigger.id,
      effectId: trigger.effectId,
      cardId: trigger.cardId,
      cardName: trigger.cardName,
      controller: trigger.controller,
      sourceController: trigger.sourceController,
      sourceZone: trigger.sourceZone,
      sourceIndex: trigger.sourceIndex,
      eventType: trigger.event && trigger.event.type,
      optional: trigger.optional,
      mandatory: trigger.mandatory,
      text: trigger.effect && trigger.effect.text,
    });
  }

  function getOptionalTriggersForPlayer(player, triggers) {
    const controller = player ? zoneAccess.normalizeController(player) : null;
    return asArray(triggers || optionalQueue).filter(trigger => !controller || trigger.controller === controller);
  }

  function showOptionalTriggerChoices(player, triggers) {
    const controller = player ? zoneAccess.normalizeController(player) : CONTROLLERS.ME;

    // 로컬 UI는 항상 내 optional trigger만 물어본다.
    // 상대/AI optional trigger는 processNonLocalOptionalTriggers에서 자동 처리/스킵한다.
    if (controller !== CONTROLLERS.ME && global.HB_DEBUG_SHOW_REMOTE_OPTIONAL !== true) {
      return makeOk({ controller, choices: Object.freeze([]), count: 0, suppressedRemote: true });
    }

    const choices = getOptionalTriggersForPlayer(CONTROLLERS.ME, triggers).map(triggerSummary);
    const detail = Object.freeze({ controller: CONTROLLERS.ME, choices, count: choices.length });

    if (choices.length > 0 && typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      try {
        global.dispatchEvent(new global.CustomEvent('hb:optional-triggers', { detail }));
      } catch (err) {
        console.warn('[trigger-queue] optional trigger DOM 이벤트 전달 중 오류:', err);
      }
    }

    return makeOk(detail);
  }

  function findQueuedOptional(selection) {
    const selectedId = typeof selection === 'string' ? selection : (selection && (selection.triggerId || selection.id));
    const selectedEffectId = selection && selection.effectId;
    const selectedController = selection && selection.controller;

    const index = optionalQueue.findIndex(trigger => {
      if (selectedId && trigger.id === selectedId) return true;
      if (selectedEffectId && trigger.effectId === selectedEffectId) {
        return !selectedController || trigger.controller === zoneAccess.normalizeController(selectedController);
      }
      return trigger === selection;
    });

    if (index < 0) return null;
    return Object.freeze({ index, trigger: optionalQueue[index] });
  }

  function removeOptionalTrigger(selection, reason) {
    const found = findQueuedOptional(selection);
    if (!found) return makeFail('제거할 optional trigger를 찾지 못했습니다.', { selection });
    optionalQueue.splice(found.index, 1);
    remember(found.trigger, reason || 'removeOptional');
    return makeOk({ trigger: found.trigger, reason: reason || 'removeOptional' });
  }

  function processNonLocalOptionalTriggers(gameState, options) {
    const opts = options || {};
    if (opts.showOpponentOptional === true || opts.keepRemoteOptional === true) {
      return makeOk({ skipped: [], activated: [], kept: true });
    }

    const remote = optionalQueue.filter(trigger => trigger && trigger.controller !== CONTROLLERS.ME);
    const skipped = [];
    const activated = [];
    let activatedOne = false;

    remote.forEach(trigger => {
      let shouldActivate = false;
      if (!activatedOne && global.AI && global.AI.active && trigger.controller === CONTROLLERS.OPPONENT) {
        if (typeof global._aiShouldUseOptionalTrigger === 'function') {
          try { shouldActivate = !!global._aiShouldUseOptionalTrigger(triggerSummary(trigger), trigger, gameState); }
          catch (_) { shouldActivate = false; }
        }
      }

      if (shouldActivate) {
        removeOptionalTrigger(trigger, 'aiSelectOptional');
        const activation = activateTriggerEntry(trigger, Object.assign({}, opts, {
          activationData: Object.assign({}, opts.activationData || {}, { source: 'ai-optional-trigger' }),
          autoResolve: false,
          resolveImmediately: false,
        }));
        activated.push(activation);
        activatedOne = true;
        return;
      }

      const removed = removeOptionalTrigger(trigger, 'skipRemoteOptional');
      skipped.push(removed.ok ? removed.trigger : trigger);
    });

    return makeOk({ skipped: Object.freeze(skipped), activated: Object.freeze(activated), count: remote.length });
  }

  function activateTriggerEntry(trigger, options) {
    if (!trigger) return makeFail('trigger가 없습니다.');
    const chain = global.HB_CHAIN_ENGINE || (global.HB_ENGINE && global.HB_ENGINE.chain);
    if (!chain || typeof chain.activateEffect !== 'function') {
      return makeFail('HB_CHAIN_ENGINE.activateEffect가 없습니다.');
    }

    const opts = options || {};
    const activation = chain.activateEffect({
      effect: trigger.effect,
      ctx: trigger.ctx,
      activationData: Object.assign({}, opts.activationData || {}, {
        triggerId: trigger.id,
        eventId: trigger.event && trigger.event.eventId,
        eventType: trigger.event && trigger.event.type,
        mandatory: trigger.mandatory,
        optional: trigger.optional,
      }),
      // 유발 효과 선택 버튼도 기본 즉시 해결.
      // false를 명시한 테스트/후속 체인 통합 코드만 체인에 남기도록 한다.
      autoResolve: opts.autoResolve === true,
      resolveImmediately: opts.resolveImmediately === true,
    });

    remember(trigger, activation.ok ? 'activate' : 'activateFailed', activation);
    return activation.ok ? makeOk({ trigger, activation }) : makeFail(activation.error || '유발 효과 발동에 실패했습니다.', { trigger, activation });
  }

  function activateSelectedTrigger(selection, options) {
    const found = findQueuedOptional(selection);
    if (!found) return makeFail('선택한 임의 유발 효과를 optionalQueue에서 찾지 못했습니다.', { selection });

    const opts = options || {};
    if (found.trigger.controller !== CONTROLLERS.ME && opts.allowRemote !== true) {
      return makeFail('상대/AI의 임의 유발 효과는 로컬 플레이어가 선택할 수 없습니다.', {
        selection,
        trigger: triggerSummary(found.trigger),
      });
    }

    optionalQueue.splice(found.index, 1);
    const trigger = found.trigger;
    const result = activateTriggerEntry(trigger, options);
    if (!result.ok) {
      // 발동 실패 시 선택권을 잃지 않도록 다시 큐 앞쪽에 복구한다.
      optionalQueue.splice(found.index, 0, trigger);
      optionalQueue.sort(compareTriggerEntries);
    }
    return result;
  }

  function processTriggerQueue(gameState, options) {
    const opts = options || {};
    const state = resolveGameState(gameState);
    const mandatoryActivated = [];
    const mandatoryFailed = [];

    while (mandatoryQueue.length > 0) {
      const trigger = mandatoryQueue.shift();
      const activation = activateTriggerEntry(trigger, opts);
      if (activation.ok) mandatoryActivated.push(activation);
      else mandatoryFailed.push(activation);
    }

    const nonLocalOptionalResult = processNonLocalOptionalTriggers(state, opts);

    const players = opts.showOpponentOptional === true ? [CONTROLLERS.ME, CONTROLLERS.OPPONENT] : [CONTROLLERS.ME];
    const optionalChoices = players
      .map(player => showOptionalTriggerChoices(player, optionalQueue))
      .filter(result => result.count > 0);

    if (opts.autoShowAllOptional === true && optionalChoices.length === 0 && optionalQueue.length > 0) {
      optionalChoices.push(showOptionalTriggerChoices(CONTROLLERS.ME, optionalQueue));
    }

    return makeOk({
      gameState: state,
      mandatoryActivated: Object.freeze(mandatoryActivated),
      mandatoryFailed: Object.freeze(mandatoryFailed),
      nonLocalOptionalResult,
      optionalChoices: Object.freeze(optionalChoices),
      pendingOptional: optionalQueue.slice(),
      mandatoryCount: mandatoryActivated.length,
      optionalCount: optionalQueue.length,
    });
  }

  function receiveEvent(eventOrType, gameState, options) {
    let event;
    let state;
    try {
      event = normalizeEvent(eventOrType);
      state = resolveGameState(gameState);
    } catch (err) {
      return makeFail(err.message);
    }

    const triggers = collectTriggers(event, state, options);
    const mandatory = triggers.filter(trigger => trigger.mandatory);
    const optional = triggers.filter(trigger => trigger.optional);
    const mandatoryResult = enqueueMandatoryTriggers(mandatory);
    const optionalResult = enqueueOptionalTriggers(optional);
    const processResult = options && options.process === false ? null : processTriggerQueue(state, options);

    return makeOk({
      event,
      collected: triggers,
      mandatory,
      optional,
      mandatoryResult,
      optionalResult,
      processResult,
    });
  }

  function clearTriggerQueue() {
    const cleared = Object.freeze({
      mandatory: mandatoryQueue.splice(0),
      optional: optionalQueue.splice(0),
    });
    return cleared;
  }

  function getQueueState() {
    return Object.freeze({
      mandatory: mandatoryQueue.slice(),
      optional: optionalQueue.slice(),
      mandatoryCount: mandatoryQueue.length,
      optionalCount: optionalQueue.length,
    });
  }

  function getTriggerHistory() {
    return triggerHistory.slice();
  }

  const api = Object.freeze({
    collectTriggers,
    enqueueTrigger,
    enqueueMandatoryTriggers,
    enqueueOptionalTriggers,
    showOptionalTriggerChoices,
    activateSelectedTrigger,
    removeOptionalTrigger,
    processTriggerQueue,

    // event-bus.js가 자동 전달할 때 사용하는 이름.
    receiveEvent,
    enqueueEvent: receiveEvent,

    // 테스트/디버그 편의 함수.
    clearTriggerQueue,
    getQueueState,
    getTriggerHistory,
  });

  global.HB_TRIGGER_QUEUE = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.triggers = api;
})(window);
