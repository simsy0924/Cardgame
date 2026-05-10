// HAND BATTLE — Engine: Field Zone
// 필드 카드의 “패에서 발동”, “효과로 필드 존에 놓기”, “발동 무효”, “필드 존 효과 버튼”을 분리한다.
// 신규 로직은 필드 카드를 직접 G.myFieldCard에 대입하지 말고 이 파일을 통과한다.
(function initFieldZoneEngine(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const ZONES = rules.ZONES || Object.freeze({ HAND: 'hand', FIELD_ZONE: 'fieldZone', GRAVE: 'grave' });
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({ ACTIVATION: 'activation', QUICK: 'quick', CONTINUOUS: 'continuous' });
  const EFFECT_TAGS = rules.EFFECT_TAGS || Object.freeze({ FIELD_CARD_ACTIVATION: 'fieldCardActivation', FIELD_ZONE_EFFECT: 'fieldZoneEffect' });
  const EVENTS = rules.EVENTS || Object.freeze({ CARD_ACTIVATED: 'cardActivated', FIELD_CARD_PLACED: 'fieldCardPlaced' });

  const zoneAccess = global.HB_ZONE_ACCESS;
  const cardMove = global.HB_CARD_MOVE;
  const contextFactory = global.HB_EFFECT_CONTEXT;
  const registry = global.HB_EFFECT_REGISTRY;

  if (!zoneAccess) throw new Error('[field-zone] HB_ZONE_ACCESS가 필요합니다. zone-access.js를 먼저 로드하세요.');
  if (!cardMove) throw new Error('[field-zone] HB_CARD_MOVE가 필요합니다. card-move.js를 먼저 로드하세요.');
  if (!contextFactory) throw new Error('[field-zone] HB_EFFECT_CONTEXT가 필요합니다. effect-context.js를 먼저 로드하세요.');
  if (!registry) throw new Error('[field-zone] HB_EFFECT_REGISTRY가 필요합니다. effect-registry.js를 먼저 로드하세요.');

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const activationRecords = new Map();
  let nextActivationSeq = 1;

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    throw new Error('[field-zone] gameState가 없습니다. 함수 호출 시 gameState를 전달하세요.');
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function normalizeController(controller) {
    return zoneAccess.normalizeController(controller || CONTROLLERS.ME);
  }

  function getOpponent(controller) {
    return normalizeController(controller) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
  }

  function getCardDatabase() {
    // cards.js의 const CARDS는 전역 lexical binding일 수 있어서 typeof를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function getCardDef(cardId) {
    const cards = getCardDatabase();
    return cards && cardId ? (cards[cardId] || null) : null;
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || '';
  }

  function getCardName(cardId, fallback) {
    const def = getCardDef(cardId);
    return (def && def.name) || (fallback && fallback.name) || cardId;
  }

  function isFieldCard(cardId) {
    const def = getCardDef(cardId);
    return !def || def.cardType === 'field';
  }

  function resultOk(result) {
    return result == null || result === true || (typeof result === 'object' && result.ok !== false);
  }

  function makeOk(payload) {
    return Object.assign({ ok: true }, payload || {});
  }

  function makeFail(message, payload) {
    return Object.assign({ ok: false, error: message }, payload || {});
  }

  function getCurrentPhase(gameState) {
    const state = gameState || null;
    if (state && state.phase) return state.phase;
    // eslint-disable-next-line no-undef
    if (typeof currentPhase !== 'undefined' && currentPhase) return currentPhase;
    return null;
  }

  function isCurrentlyMyTurn(gameState, controller) {
    const state = gameState || null;
    if (state && state.turnPlayer) return state.turnPlayer === controller;
    if (state && state.currentPlayer) return state.currentPlayer === controller;
    // eslint-disable-next-line no-undef
    if (typeof isMyTurn !== 'undefined') {
      return controller === CONTROLLERS.ME ? !!isMyTurn : !isMyTurn;
    }
    return true;
  }

  function hasLegacyActiveChain() {
    // eslint-disable-next-line no-undef
    if (typeof activeChainState !== 'undefined' && activeChainState && activeChainState.active) return true;
    return false;
  }

  function hasActiveChain() {
    const chain = global.HB_CHAIN_ENGINE;
    if (chain && typeof chain.hasActiveChain === 'function' && chain.hasActiveChain()) return true;
    return hasLegacyActiveChain();
  }

  function maybeNotify(message) {
    // eslint-disable-next-line no-undef
    if (typeof notify === 'function') notify(message);
    else if (global.console && global.console.warn) global.console.warn('[field-zone]', message);
  }

  function maybeLog(message, kind) {
    // eslint-disable-next-line no-undef
    if (typeof log === 'function') log(message, kind || 'mine');
    else if (global.console && global.console.log) global.console.log('[field-zone]', message);
  }

  function maybeSendAction(action) {
    // eslint-disable-next-line no-undef
    if (typeof sendAction === 'function') sendAction(action);
  }

  function maybeSyncAndRender(options) {
    const opts = options || {};
    if (opts.sync === false) return;
    // eslint-disable-next-line no-undef
    if (typeof sendGameState === 'function') sendGameState();
    if (opts.render === false) return;
    // eslint-disable-next-line no-undef
    if (typeof renderAll === 'function') renderAll();
  }

  function buildContext(options, effect) {
    const opts = options || {};
    const controller = normalizeController(opts.controller || (opts.ctx && opts.ctx.controller) || CONTROLLERS.ME);
    const state = resolveGameState(opts.gameState || (opts.ctx && opts.ctx.gameState));
    const source = opts.source || (opts.ctx && opts.ctx.source) || { controller, zone: ZONES.FIELD_ZONE, index: null };
    const cardId = opts.cardId || (opts.card && getCardId(opts.card)) || (opts.ctx && opts.ctx.card && getCardId(opts.ctx.card));
    const card = opts.card || (cardId ? (zoneAccess.getFieldZoneCard(state, controller) || { id: cardId, name: getCardName(cardId) }) : null);
    return contextFactory.createEffectContext(Object.assign({}, opts.ctx || {}, opts, {
      gameState: state,
      controller,
      opponent: getOpponent(controller),
      card,
      cardId: cardId || getCardId(card),
      source,
      sourceZone: source.zone || ZONES.FIELD_ZONE,
      sourceController: source.controller || controller,
      sourceIndex: typeof source.index === 'number' ? source.index : null,
      effect: effect || opts.effect || (opts.ctx && opts.ctx.effect) || null,
    }));
  }

  function getHandIndex(state, controller, cardId, explicitIndex) {
    const hand = zoneAccess.getZoneArray(state, controller, ZONES.HAND);
    if (typeof explicitIndex === 'number' && hand[explicitIndex] && hand[explicitIndex].id === cardId) return explicitIndex;
    return hand.findIndex(card => card && card.id === cardId);
  }

  function validateFieldActivationFromHand(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState || (opts.ctx && opts.ctx.gameState));
    const controller = normalizeController(opts.controller || (opts.ctx && opts.ctx.controller) || CONTROLLERS.ME);
    const cardId = getCardId(opts.cardId || opts.card || (opts.ctx && opts.ctx.card));
    if (!cardId) return makeFail('발동할 필드 카드 ID가 없습니다.');
    if (!isFieldCard(cardId)) return makeFail('필드 카드만 필드 카드 발동을 할 수 있습니다.', { cardId });

    if (opts.ignoreTiming !== true) {
      if (!isCurrentlyMyTurn(state, controller) || getCurrentPhase(state) !== 'deploy') {
        return makeFail('필드 카드는 자신 전개 단계에만 발동할 수 있습니다.', { cardId, phase: getCurrentPhase(state) });
      }
      if (hasActiveChain() && opts.allowChain !== true) {
        return makeFail('필드 카드 발동은 체인 1로만 시작할 수 있습니다.', { cardId });
      }
    }

    const handIndex = getHandIndex(state, controller, cardId, opts.handIndex);
    if (handIndex < 0) return makeFail('패에서 해당 필드 카드를 찾지 못했습니다.', { cardId });
    return makeOk({ gameState: state, controller, cardId, handIndex });
  }

  function makeActivationId(cardId) {
    const id = `field_activation_${Date.now()}_${nextActivationSeq++}`;
    return `${id}_${String(cardId).replace(/\s+/g, '_')}`;
  }

  function rememberActivation(record) {
    activationRecords.set(record.activationId, record);
    if (record.legacyChainType) activationRecords.set(record.legacyChainType, record);
    if (record.cardId) activationRecords.set(record.cardId, record);
    return record;
  }

  function forgetActivation(recordOrKey) {
    const record = typeof recordOrKey === 'object' ? recordOrKey : activationRecords.get(recordOrKey);
    if (!record) return false;
    activationRecords.delete(record.activationId);
    if (record.legacyChainType) activationRecords.delete(record.legacyChainType);
    if (record.cardId) activationRecords.delete(record.cardId);
    return true;
  }

  function findActivationRecord(linkOrOptions) {
    const link = linkOrOptions || {};
    if (link.activationId && activationRecords.has(link.activationId)) return activationRecords.get(link.activationId);
    if (link.id && activationRecords.has(link.id)) return activationRecords.get(link.id);
    if (link.type && activationRecords.has(link.type)) return activationRecords.get(link.type);
    if (link.cardId && activationRecords.has(link.cardId)) return activationRecords.get(link.cardId);
    return null;
  }

  function startLegacyFieldActivationChain(record, options) {
    const opts = options || {};
    if (opts.createChain === false) return makeOk({ chainStarted: false, reason: 'disabled' });
    if (typeof global.beginChain === 'function') {
      global.beginChain({
        type: 'fieldActivate',
        label: `필드: ${record.cardName}`,
        cardId: record.cardId,
        controller: record.controller,
        activationId: record.activationId,
        sourceZone: ZONES.FIELD_ZONE,
      });
      return makeOk({ chainStarted: true, mode: 'legacy' });
    }
    return makeOk({ chainStarted: false, reason: 'beginChainUnavailable' });
  }

  function activateFieldCardFromHand(options) {
    const validation = validateFieldActivationFromHand(options || {});
    if (!validation.ok) {
      maybeNotify(validation.error);
      return validation;
    }

    const opts = options || {};
    const state = validation.gameState;
    const controller = validation.controller;
    const cardId = validation.cardId;
    const handIndex = validation.handIndex;
    const card = zoneAccess.getZoneArray(state, controller, ZONES.HAND)[handIndex];
    const cardName = getCardName(cardId, card);

    const placeResult = cardMove.placeFieldCard({
      gameState: state,
      controller,
      cardId,
      source: { controller, zone: ZONES.HAND, index: handIndex },
      activate: true,
      reason: 'fieldCardActivate',
      eventData: Object.assign({}, opts.eventData || {}, {
        fieldActivationFromHand: true,
      }),
    });

    if (!placeResult.ok) {
      maybeNotify(placeResult.error);
      return placeResult;
    }

    const activationId = makeActivationId(cardId);
    const record = rememberActivation(Object.freeze({
      activationId,
      legacyChainType: 'fieldActivate',
      cardId,
      cardName,
      controller,
      source: { controller, zone: ZONES.HAND, index: handIndex },
      placedAt: Date.now(),
      placeResult,
      resolved: false,
      negated: false,
    }));

    maybeLog(`필드 발동: ${cardName}`, 'mine');
    if (opts.broadcast !== false) maybeSendAction({ type: 'fieldCard', cardId, activationId });
    const chainResult = startLegacyFieldActivationChain(record, opts);
    if (opts.autoSync !== false) maybeSyncAndRender(opts);

    return makeOk({
      activationId,
      record,
      placeResult,
      chainResult,
      placedCard: placeResult.placedCard,
      replacedCard: placeResult.replacedCard || null,
    });
  }

  function replaceFieldCard(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState || (opts.ctx && opts.ctx.gameState));
    const controller = normalizeController(opts.controller || (opts.ctx && opts.ctx.controller) || CONTROLLERS.ME);
    const cardId = getCardId(opts.cardId || opts.card || (opts.ctx && opts.ctx.card));
    if (!cardId) return makeFail('필드 존에 놓을 카드 ID가 없습니다.');
    if (!isFieldCard(cardId)) return makeFail('필드 카드만 필드 존에 놓을 수 있습니다.', { cardId });

    const source = opts.source || opts.from || { controller, zone: opts.sourceZone || ZONES.DECK, index: opts.sourceIndex == null ? null : opts.sourceIndex };
    return cardMove.placeFieldCard({
      gameState: state,
      controller,
      cardId,
      source,
      activate: opts.activate === true,
      reason: opts.reason || (opts.activate ? 'fieldCardActivate' : 'placeFieldCardByEffect'),
      eventData: Object.assign({}, opts.eventData || {}, {
        placedByFieldZoneEngine: true,
        activationEffectShouldResolve: opts.activate === true,
      }),
    });
  }

  function findCardInZones(state, controller, cardId, zones) {
    const searchZones = zones && zones.length ? zones : [ZONES.DECK, ZONES.GRAVE, ZONES.EXILE, ZONES.HAND];
    for (let i = 0; i < searchZones.length; i += 1) {
      const zone = searchZones[i];
      try {
        const list = zoneAccess.getZoneArray(state, controller, zone);
        const index = list.findIndex(card => card && card.id === cardId);
        if (index >= 0) return { controller, zone, index };
      } catch (err) {
        // count-only zone 등은 건너뛴다.
      }
    }
    return null;
  }

  function placeFieldCardByEffect(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState || (opts.ctx && opts.ctx.gameState));
    const controller = normalizeController(opts.controller || (opts.ctx && opts.ctx.controller) || CONTROLLERS.ME);
    const cardId = getCardId(opts.cardId || opts.card || (opts.ctx && opts.ctx.card));
    if (!cardId) return makeFail('효과로 놓을 필드 카드 ID가 없습니다.');
    if (!isFieldCard(cardId)) return makeFail('필드 카드만 필드 존에 놓을 수 있습니다.', { cardId });

    const source = opts.source || opts.from || findCardInZones(state, controller, cardId, opts.searchZones);
    if (!source) return makeFail('해당 필드 카드를 찾지 못했습니다.', { cardId });

    const result = replaceFieldCard({
      gameState: state,
      controller,
      cardId,
      source,
      activate: false,
      reason: opts.reason || 'placeFieldCardByEffect',
      eventData: Object.assign({}, opts.eventData || {}, {
        placedByEffect: true,
        skipActivationEffect: true,
      }),
    });

    if (result.ok) {
      const cardName = getCardName(cardId, result.placedCard);
      maybeLog(`효과 처리: ${cardName}을 필드 존에 놓음`, 'mine');
      if (opts.broadcast !== false) maybeSendAction({ type: 'fieldCard', cardId, placedByEffect: true });
      if (opts.autoSync) maybeSyncAndRender(opts);
    }

    return result;
  }

  function isFieldActivationEffect(effect) {
    if (!effect) return false;
    const tags = effect.tags || [];
    if (tags.indexOf(EFFECT_TAGS.FIELD_CARD_ACTIVATION) >= 0) return true;
    if (effect.meta && effect.meta.fieldCardActivation) return true;
    if (effect.activationType === 'fieldCardActivation') return true;
    return false;
  }

  function getFieldCardActivationEffects(cardId) {
    return registry.getEffectsByCardAndZone(cardId, ZONES.FIELD_ZONE)
      .filter(effect => effect.type === EFFECT_TYPES.ACTIVATION || effect.type === EFFECT_TYPES.QUICK)
      .filter(isFieldActivationEffect);
  }

  function runActivationEffect(effect, baseCtx) {
    const ctx = baseCtx.with ? baseCtx.with({ effect }) : buildContext(baseCtx, effect);
    try {
      const conditionResult = effect.condition(ctx);
      if (!resultOk(conditionResult)) return makeOk({ skipped: true, effectId: effect.id, reason: 'conditionFalse' });
      const targetResult = effect.target(ctx);
      if (!resultOk(targetResult)) return makeFail('필드 카드 발동 시 대상 지정에 실패했습니다.', { effectId: effect.id, result: targetResult });
      const resolveResult = effect.resolve(ctx);
      if (!resultOk(resolveResult)) return makeFail('필드 카드 발동 시 효과 처리에 실패했습니다.', { effectId: effect.id, result: resolveResult });
      return makeOk({ effectId: effect.id, result: resolveResult === undefined ? true : resolveResult });
    } catch (err) {
      return makeFail(`필드 카드 발동 시 효과 처리 중 오류: ${err.message}`, { effectId: effect.id, errorObject: err });
    }
  }

  function resolveFieldCardActivation(options) {
    const opts = options || {};
    const record = findActivationRecord(opts) || (opts.record || null);
    const state = resolveGameState(opts.gameState || (record && record.placeResult && record.placeResult.gameState));
    const controller = normalizeController(opts.controller || (record && record.controller) || CONTROLLERS.ME);
    const cardId = getCardId(opts.cardId || (record && record.cardId));
    if (!cardId) return makeFail('해결할 필드 카드 발동 정보가 없습니다.');

    const current = zoneAccess.getFieldZoneCard(state, controller);
    if (!current || current.id !== cardId) {
      forgetActivation(record || cardId);
      return makeFail('발동한 필드 카드가 더 이상 필드 존에 없습니다.', { cardId, controller });
    }

    if (opts.negated === true || (record && record.negated)) {
      return negateFieldCardActivation(Object.assign({}, opts, { record, gameState: state, controller, cardId }));
    }

    const ctx = buildContext({
      gameState: state,
      controller,
      cardId,
      card: current,
      source: { controller, zone: ZONES.FIELD_ZONE, index: null },
      event: opts.event || (record && record.placeResult && record.placeResult.activation && record.placeResult.activation.event),
      chainLink: opts.chainLink || opts,
      authority: opts.authority,
    });

    const activationEffects = getFieldCardActivationEffects(cardId);
    const resolvedEffects = [];
    const errors = [];
    activationEffects.forEach(effect => {
      const result = runActivationEffect(effect, ctx);
      resolvedEffects.push(result);
      if (!result.ok) errors.push(result);
    });

    if (record) {
      const updatedRecord = Object.freeze(Object.assign({}, record, { resolved: true, resolvedAt: Date.now() }));
      forgetActivation(record);
      rememberActivation(updatedRecord);
      forgetActivation(updatedRecord);
    } else {
      forgetActivation(cardId);
    }

    if (global.HB_EVENTS && typeof global.HB_EVENTS.emitGameEvent === 'function') {
      global.HB_EVENTS.emitGameEvent({
        type: 'fieldCardActivationResolved',
        cardId,
        controller,
        resolvedEffectIds: activationEffects.map(effect => effect.id),
        errorCount: errors.length,
      }, state);
    }

    maybeLog(`필드 카드 발동 해결: ${getCardName(cardId, current)}`, 'mine');
    maybeSyncAndRender({ sync: opts.sync !== false, render: opts.render !== false });
    return makeOk({ cardId, controller, activationEffects, resolvedEffects, errors, noActivationEffect: activationEffects.length === 0 });
  }

  function negateFieldCardActivation(options) {
    const opts = options || {};
    const record = findActivationRecord(opts) || (opts.record || null);
    const state = resolveGameState(opts.gameState || (opts.ctx && opts.ctx.gameState));
    const controller = normalizeController(opts.controller || (record && record.controller) || CONTROLLERS.ME);
    const cardId = getCardId(opts.cardId || (record && record.cardId));
    if (!cardId) return makeFail('무효로 할 필드 카드 발동 정보가 없습니다.');

    const current = zoneAccess.getFieldZoneCard(state, controller);
    if (!current || current.id !== cardId) {
      forgetActivation(record || cardId);
      return makeOk({ cardId, controller, alreadyLeft: true, movedToGrave: false });
    }

    const moveResult = cardMove.removeFieldCard({
      gameState: state,
      controller,
      to: { controller, zone: ZONES.GRAVE },
      reason: 'fieldCardActivationNegated',
      eventData: Object.assign({}, opts.eventData || {}, {
        activationId: record && record.activationId,
        negated: true,
      }),
    });

    if (record) forgetActivation(record);
    else forgetActivation(cardId);

    if (moveResult.ok) {
      maybeLog(`필드 카드 발동 무효: ${getCardName(cardId, current)} → 묘지`, 'system');
      if (opts.broadcast !== false) maybeSendAction({ type: 'opFieldCardRemove', cardId, to: 'grave', reason: 'fieldCardActivationNegated' });
      maybeSyncAndRender({ sync: opts.sync !== false, render: opts.render !== false });
    }

    return Object.assign({}, moveResult, { cardId, controller, movedToGrave: !!moveResult.ok });
  }

  function effectTypeCanActivateFromFieldZone(effect) {
    return !!effect && (effect.type === EFFECT_TYPES.ACTIVATION || effect.type === EFFECT_TYPES.QUICK);
  }

  function canActivateFieldZoneEffect(ctxOrOptions, effectOrId) {
    let effect = effectOrId;
    if (typeof effectOrId === 'string') effect = registry.getEffectById(effectOrId);
    if (!effect) return makeFail('효과를 찾지 못했습니다.');
    if (!effectTypeCanActivateFromFieldZone(effect)) return makeFail('발동형/퀵 효과만 필드 존에서 발동할 수 있습니다.', { effectId: effect.id });
    if (!effect.zones || effect.zones.indexOf(ZONES.FIELD_ZONE) === -1) return makeFail('이 효과는 필드 존 효과가 아닙니다.', { effectId: effect.id });
    if (isFieldActivationEffect(effect)) return makeFail('필드 카드 발동 시 처리 효과는 버튼으로 발동하지 않습니다.', { effectId: effect.id });

    const ctx = ctxOrOptions && ctxOrOptions.gameState ? buildContext(ctxOrOptions, effect) : (ctxOrOptions && ctxOrOptions.ctx ? buildContext(ctxOrOptions, effect) : ctxOrOptions);
    const state = resolveGameState((ctx && ctx.gameState) || (ctxOrOptions && ctxOrOptions.gameState));
    const controller = normalizeController((ctx && ctx.controller) || (ctxOrOptions && ctxOrOptions.controller) || CONTROLLERS.ME);
    const card = zoneAccess.getFieldZoneCard(state, controller);
    if (!card || card.id !== effect.cardId) return makeFail('해당 카드가 필드 존에 존재하지 않습니다.', { effectId: effect.id, cardId: effect.cardId });

    const finalCtx = ctx && ctx.gameState ? ctx : buildContext({ gameState: state, controller, cardId: effect.cardId, card }, effect);
    try {
      const conditionResult = effect.condition(finalCtx);
      if (!resultOk(conditionResult)) return makeFail('효과 조건을 만족하지 않습니다.', { effectId: effect.id, conditionResult });

      const canResolveResult = effect.canResolve ? effect.canResolve(finalCtx) : true;
      if (!resultOk(canResolveResult)) return makeFail('효과 처리를 할 수 없어 발동할 수 없습니다.', { effectId: effect.id, conditionResult, canResolveResult });
    } catch (err) {
      return makeFail(`condition/canResolve 실행 중 오류: ${err.message}`, { effectId: effect.id, errorObject: err });
    }

    return makeOk({ effect, ctx: finalCtx });
  }

  function getFieldZoneEffects(player, gameState) {
    const state = resolveGameState(gameState);
    const controller = normalizeController(player || CONTROLLERS.ME);
    const card = zoneAccess.getFieldZoneCard(state, controller);
    if (!card) return [];

    return registry.getEffectsByCardAndZone(card.id, ZONES.FIELD_ZONE)
      .filter(effectTypeCanActivateFromFieldZone)
      .filter(effect => !isFieldActivationEffect(effect))
      .filter(effect => {
        const check = canActivateFieldZoneEffect({ gameState: state, controller, cardId: card.id, card }, effect);
        return check.ok;
      });
  }

  function getFieldZoneContinuousDescriptions(player, gameState) {
    const state = resolveGameState(gameState);
    const controller = normalizeController(player || CONTROLLERS.ME);
    const card = zoneAccess.getFieldZoneCard(state, controller);
    if (!card) return [];

    return registry.getEffectsByCardAndZone(card.id, ZONES.FIELD_ZONE)
      .filter(effect => effect.type === EFFECT_TYPES.CONTINUOUS)
      .map(effect => ({ effectId: effect.id, text: effect.text || '지속 효과' }));
  }

  function activateSelectedFieldZoneEffect(options) {
    const opts = options || {};
    const effect = typeof opts.effect === 'string' ? registry.getEffectById(opts.effect) : (opts.effect || registry.getEffectById(opts.effectId));
    const check = canActivateFieldZoneEffect(opts, effect);
    if (!check.ok) {
      maybeNotify(check.error);
      return check;
    }

    const chain = global.HB_CHAIN_ENGINE;
    if (!chain || typeof chain.activateEffect !== 'function') {
      return makeFail('HB_CHAIN_ENGINE.activateEffect를 사용할 수 없습니다.', { effectId: effect.id });
    }

    return chain.activateEffect({
      gameState: check.ctx.gameState,
      controller: check.ctx.controller,
      card: check.ctx.card,
      cardId: effect.cardId,
      source: { controller: check.ctx.controller, zone: ZONES.FIELD_ZONE, index: null },
      sourceZone: ZONES.FIELD_ZONE,
      effect,
      reason: 'fieldZoneEffect',
    });
  }

  function labelForEffect(effect, index) {
    if (effect.label) return effect.label;
    if (effect.effectNo != null) return `${effect.effectNo} 효과 발동`;
    const text = String(effect.text || '').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 22 ? `${text.slice(0, 22)}…` : text;
    return `${index + 1}번 효과 발동`;
  }

  function renderFieldZoneActionButtons(options) {
    const opts = options || {};
    const state = resolveGameState(opts.gameState);
    const controller = normalizeController(opts.player || opts.controller || CONTROLLERS.ME);
    const actions = opts.actionsElement || (global.document && global.document.getElementById && global.document.getElementById('mdCardActions'));
    if (!actions) return makeFail('필드 존 효과 버튼을 넣을 actionsElement가 없습니다.');

    const effects = controller === CONTROLLERS.ME ? getFieldZoneEffects(controller, state) : [];
    const continuous = getFieldZoneContinuousDescriptions(controller, state);
    const inserted = [];

    function addButton(label, className, handler, disabled) {
      const b = global.document.createElement('button');
      b.className = `btn ${className || 'btn-secondary'}`;
      b.textContent = label;
      if (disabled) b.disabled = true;
      b.onclick = function onFieldZoneButtonClick() {
        // eslint-disable-next-line no-undef
        if (typeof closeModal === 'function') closeModal('cardDetailModal');
        try { handler(); } catch (err) { console.error(err); maybeNotify(`필드 존 효과 처리 오류: ${err.message}`); }
      };
      const closeButton = Array.from(actions.children).find(el => el && el.textContent === '닫기');
      if (closeButton) actions.insertBefore(b, closeButton);
      else actions.appendChild(b);
      inserted.push(b);
      return b;
    }

    effects.forEach((effect, index) => {
      addButton(`[필드 존] ${labelForEffect(effect, index)}`, 'btn-primary', () => activateSelectedFieldZoneEffect({ gameState: state, controller, effect }));
    });

    continuous.forEach(item => {
      const label = item.text.length > 28 ? `${item.text.slice(0, 28)}…` : item.text;
      addButton(`[지속] ${label}`, 'btn-secondary', () => maybeNotify(item.text), true);
    });

    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('hb:field-zone-effects-rendered', { detail: { controller, effects, continuous, inserted } }));
    }

    return makeOk({ controller, effects, continuous, inserted });
  }

  function getPendingActivationRecords() {
    const unique = [];
    const seen = new Set();
    activationRecords.forEach(record => {
      if (!record || seen.has(record.activationId)) return;
      seen.add(record.activationId);
      unique.push(record);
    });
    return unique;
  }

  global.HB_FIELD_ZONE = Object.freeze({
    activateFieldCardFromHand,
    placeFieldCardByEffect,
    replaceFieldCard,
    resolveFieldCardActivation,
    negateFieldCardActivation,
    getFieldZoneEffects,
    canActivateFieldZoneEffect,
    activateSelectedFieldZoneEffect,
    renderFieldZoneActionButtons,
    getFieldZoneContinuousDescriptions,
    getPendingActivationRecords,
    _findActivationRecord: findActivationRecord,
  });

  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.fieldZone = global.HB_FIELD_ZONE;
})(window);
