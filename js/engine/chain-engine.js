// HAND BATTLE — Engine: Chain Engine
// 신규 EffectDefinition 발동 효과 전용 체인 엔진.
// 기존 effects-chain.js의 beginChain/resolveChain을 덮어쓰지 않고 window.HB_CHAIN_ENGINE으로만 제공한다.
(function initChainEngine(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({
    ACTIVATION: 'activation',
    QUICK: 'quick',
    TRIGGER: 'trigger',
    CONTINUOUS: 'continuous',
    PROCEDURE: 'procedure',
    PROCESSING_NEGATE: 'processingNegate',
  });
  const EVENTS = rules.EVENTS || Object.freeze({
    CHAIN_LINK_RESOLVED: 'chainLinkResolved',
    EFFECT_NEGATED: 'effectNegated',
  });
  const TIMING = rules.TIMING || Object.freeze({ NONE: 'none', EITHER_TURN: 'eitherTurn' });
  const PHASES = rules.PHASES || Object.freeze({ DRAW: 'draw', DEPLOY: 'deploy', BATTLE: 'battle', END: 'end' });
  const ZONES = rules.ZONES || Object.freeze({ HAND: 'hand', PUBLIC_HAND: 'publicHand', GRAVE: 'grave' });

  const definition = global.HB_EFFECT_DEFINITION;
  if (!definition) {
    throw new Error('[chain-engine] HB_EFFECT_DEFINITION이 필요합니다. effect-definition.js를 먼저 로드하세요.');
  }

  const registry = global.HB_EFFECT_REGISTRY;
  if (!registry) {
    throw new Error('[chain-engine] HB_EFFECT_REGISTRY가 필요합니다. effect-registry.js를 먼저 로드하세요.');
  }

  const contextFactory = global.HB_EFFECT_CONTEXT;
  if (!contextFactory) {
    throw new Error('[chain-engine] HB_EFFECT_CONTEXT가 필요합니다. effect-context.js를 먼저 로드하세요.');
  }

  const CONTROLLERS = (global.HB_ZONE_ACCESS && global.HB_ZONE_ACCESS.CONTROLLERS) || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });

  const chainState = {
    active: false,
    links: [],
    responding: false,
    priority: null,
    passCount: 0,
    resolving: false,
    createdAt: 0,
    resolvedAt: 0,
  };

  const usageCounters = new Map();
  let nextChainSequence = 1;
  let nextLinkSequence = 1;

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    return null;
  }

  function getCardDatabase() {
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function getCardDef(cardOrId) {
    if (!cardOrId) return null;
    const id = typeof cardOrId === 'string' ? cardOrId : (cardOrId.id || cardOrId.cardId || cardOrId.name || '');
    const cards = getCardDatabase();
    return cards && id ? (cards[id] || null) : (typeof cardOrId === 'object' ? cardOrId : null);
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function getCurrentPhase(gameState) {
    const state = resolveGameState(gameState);
    if (state && state.phase) return state.phase;
    // eslint-disable-next-line no-undef
    if (typeof currentPhase !== 'undefined' && currentPhase) return currentPhase;
    return null;
  }

  function getCurrentTurn(gameState) {
    const state = resolveGameState(gameState);
    return state && state.turn != null ? state.turn : 0;
  }

  function getLocalRole() {
    // eslint-disable-next-line no-undef
    if (typeof myRole !== 'undefined' && myRole) return myRole;
    return global.myRole || null;
  }

  function getRemoteRole() {
    // eslint-disable-next-line no-undef
    if (typeof opRole !== 'undefined' && opRole) return opRole;
    const localRole = getLocalRole();
    if (localRole === 'host') return 'guest';
    if (localRole === 'guest') return 'host';
    return global.opRole || null;
  }

  function roleToController(role) {
    const localRole = getLocalRole();
    if (!role || !localRole) return role === 'opponent' ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
    return role === localRole ? CONTROLLERS.ME : CONTROLLERS.OPPONENT;
  }

  function controllerToRole(controller) {
    const owner = controller === CONTROLLERS.OPPONENT || controller === 'op' || controller === 'opponent'
      ? CONTROLLERS.OPPONENT
      : CONTROLLERS.ME;
    if (owner === CONTROLLERS.ME) return getLocalRole() || 'host';
    return getRemoteRole() || 'guest';
  }

  function normalizeChainController(controllerOrRole) {
    if (controllerOrRole === CONTROLLERS.ME || controllerOrRole === CONTROLLERS.OPPONENT || controllerOrRole === 'op' || controllerOrRole === 'opponent') {
      return controllerOrRole === 'op' ? CONTROLLERS.OPPONENT : controllerOrRole;
    }
    return roleToController(controllerOrRole);
  }

  function normalizeEffect(effectOrId) {
    if (!effectOrId) throw new Error('[chain-engine] effect가 없습니다.');
    if (typeof effectOrId === 'string') {
      const found = registry.getEffectById(effectOrId);
      if (!found) throw new Error(`[chain-engine] 등록되지 않은 effect id입니다: ${effectOrId}`);
      return found;
    }
    if (effectOrId.id && registry.hasEffect && registry.hasEffect(effectOrId.id)) {
      return registry.getEffectById(effectOrId.id);
    }
    return definition.normalizeEffectDefinition(effectOrId);
  }

  function normalizeContext(ctxOrOptions, effect) {
    const base = ctxOrOptions || {};
    if (base.gameState && base.move && base.controller) {
      if (!base.effect && effect && typeof base.with === 'function') return base.with({ effect });
      return base;
    }
    return contextFactory.createEffectContext(Object.assign({}, base, { effect: effect || base.effect || null }));
  }

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function resultOk(result) {
    return result !== false && !(result && result.ok === false);
  }

  function makeFail(message, payload) {
    return Object.freeze(Object.assign({ ok: false, error: message }, payload || {}));
  }

  function makeOk(payload) {
    return Object.freeze(Object.assign({ ok: true }, payload || {}));
  }

  function makeChainId() {
    return `new_chain_${Date.now()}_${nextChainSequence++}`;
  }

  function makeChainLinkId(sequence) {
    return `new_chain_link_${Date.now()}_${sequence}`;
  }

  function isMyTurnForController(ctx) {
    // 이 프로젝트의 신엔진 controller는 me/opponent이고, 레거시는 host/guest를 쓴다.
    // 정확한 매핑이 불가능한 테스트 환경에서는 timing을 막지 않도록 null을 반환한다.
    // eslint-disable-next-line no-undef
    if (typeof isMyTurn !== 'undefined') {
      return ctx.controller === CONTROLLERS.ME ? !!isMyTurn : !isMyTurn;
    }
    const state = ctx.gameState;
    // 선택적으로 이후 네트워크 정리 단계에서 activeController를 심을 수 있도록 열어둔다.
    if (state && state.activeController) return state.activeController === ctx.controller;
    return null;
  }

  function timingMatches(ctx, effect) {
    const timing = effect.timing || TIMING.NONE;
    if (!timing || timing === TIMING.NONE) return true;
    if (timing === TIMING.EITHER_TURN) return true;

    const phase = getCurrentPhase(ctx.gameState);
    const myTurn = isMyTurnForController(ctx);

    if (timing === TIMING.MY_TURN) return myTurn == null ? true : myTurn;
    if (timing === TIMING.OPPONENT_TURN) return myTurn == null ? true : !myTurn;

    if (timing === TIMING.MY_DEPLOY) {
      if (phase && phase !== PHASES.DEPLOY) return false;
      return myTurn == null ? true : myTurn;
    }
    if (timing === TIMING.OPPONENT_DEPLOY) {
      if (phase && phase !== PHASES.DEPLOY) return false;
      return myTurn == null ? true : !myTurn;
    }

    // onSummon/onSentToGrave 같은 이벤트 타이밍은 유발 큐 단계에서 event와 함께 검사한다.
    return true;
  }

  function zoneMatches(ctx, effect) {
    if (!effect.zones || effect.zones.length === 0) return true;
    const zone = ctx.sourceZone || (ctx.source && ctx.source.zone) || null;
    if (!zone) return true;
    return definition.effectHasZone(effect, zone);
  }

  function isChainableEffect(effect) {
    if (definition.isContinuousEffect(effect)) return false;
    if (definition.isProcedureEffect(effect)) return false;
    return definition.isActivatedEffect(effect);
  }

  function getOncePerTurnConfig(effect) {
    return effect && effect.oncePerTurn ? effect.oncePerTurn : null;
  }

  function makeUsageKey(ctx, effect) {
    const once = getOncePerTurnConfig(effect);
    if (!once) return null;
    const turn = getCurrentTurn(ctx.gameState);
    const scope = once.scope || 'turn';
    const rawKey = once.key || effect.id;
    if (scope === 'duel' || scope === 'game') return `${ctx.controller}:${scope}:${rawKey}`;
    if (scope === 'controller') return `${ctx.controller}:${rawKey}`;
    return `${ctx.controller}:${turn}:${scope}:${rawKey}`;
  }

  function getUsageCount(ctx, effect) {
    const key = makeUsageKey(ctx, effect);
    if (!key) return 0;
    return usageCounters.get(key) || 0;
  }

  function markEffectUsedForChain(ctx, effect) {
    const once = getOncePerTurnConfig(effect);
    const key = makeUsageKey(ctx, effect);
    if (!key || !once) return null;
    const count = usageCounters.get(key) || 0;
    usageCounters.set(key, count + 1);

    // 레거시 effectUsed와도 느슨하게 동기화한다. 실패해도 신엔진 카운터는 유지한다.
    try {
      // eslint-disable-next-line no-undef
      if (typeof markEffectUsed === 'function') markEffectUsed(effect.cardId, effect.effectNo);
    } catch (err) {
      console.warn('[chain-engine] 레거시 markEffectUsed 동기화 실패:', err);
    }

    return Object.freeze({ key, before: count, after: count + 1, limit: once.limit || 1 });
  }

  function oncePerTurnAvailable(ctx, effect) {
    const once = getOncePerTurnConfig(effect);
    if (!once) return true;
    const limit = Math.max(1, Number(once.limit || 1));
    return getUsageCount(ctx, effect) < limit;
  }

  function canActivateEffect(ctxOrOptions, effectOrId) {
    let effect;
    let ctx;
    try {
      effect = normalizeEffect(effectOrId || (ctxOrOptions && ctxOrOptions.effect));
      ctx = normalizeContext(ctxOrOptions, effect);
    } catch (err) {
      return makeFail(err.message);
    }

    if (!isChainableEffect(effect)) {
      return makeFail('지속 효과/소환 절차/비발동 효과는 체인에 올릴 수 없습니다.', { effectId: effect.id });
    }

    if (!zoneMatches(ctx, effect)) {
      return makeFail('현재 존에서는 이 효과를 발동할 수 없습니다.', { effectId: effect.id, sourceZone: ctx.sourceZone });
    }

    if (!timingMatches(ctx, effect)) {
      return makeFail('현재 타이밍에는 이 효과를 발동할 수 없습니다.', { effectId: effect.id, timing: effect.timing });
    }

    if (!oncePerTurnAvailable(ctx, effect)) {
      return makeFail('이 효과는 사용 횟수 제한에 걸렸습니다.', { effectId: effect.id, oncePerTurn: effect.oncePerTurn });
    }

    try {
      const conditionResult = effect.condition(ctx);
      if (!resultOk(conditionResult)) {
        return makeFail('효과 조건을 만족하지 않습니다.', { effectId: effect.id, conditionResult });
      }
    } catch (err) {
      return makeFail(`condition 실행 중 오류: ${err.message}`, { effectId: effect.id, errorObject: err });
    }

    try {
      const canResolveResult = effect.canResolve(ctx);
      if (!resultOk(canResolveResult)) {
        return makeFail('효과 처리를 할 수 없어 발동할 수 없습니다.', { effectId: effect.id, canResolveResult });
      }
    } catch (err) {
      return makeFail(`canResolve 실행 중 오류: ${err.message}`, { effectId: effect.id, errorObject: err });
    }

    return makeOk({ effect, ctx });
  }

  function isCardActivationCostEffect(ctx, effect) {
    if (!effect || effect.cardActivationCost !== true) return false;
    const sourceZone = ctx.sourceZone || (ctx.source && ctx.source.zone);
    if (sourceZone !== ZONES.HAND && sourceZone !== ZONES.PUBLIC_HAND) return false;
    const rawCard = (ctx && ctx.card) || null;
    const card = rawCard && rawCard.cardType ? rawCard : getCardDef((rawCard && (rawCard.id || rawCard.cardId)) || effect.cardId);
    return !!(card && ['normal', 'magic', 'trap'].indexOf(card.cardType) !== -1);
  }

  function payCardActivationCost(ctxOrOptions, effectOrId) {
    let effect;
    let ctx;
    try {
      effect = normalizeEffect(effectOrId || (ctxOrOptions && ctxOrOptions.effect));
      ctx = normalizeContext(ctxOrOptions, effect);
    } catch (err) {
      return makeFail(err.message);
    }

    if (!isCardActivationCostEffect(ctx, effect)) {
      return makeOk({ effect, ctx, paidCost: false, skippedCardActivationCost: true });
    }

    if (!ctx.move || typeof ctx.move.sendToGrave !== 'function') {
      return makeFail('카드 발동 코스트를 처리할 이동 엔진이 없습니다.', { effectId: effect.id });
    }

    const sourceZone = ctx.sourceZone || (ctx.source && ctx.source.zone) || ZONES.HAND;
    const result = ctx.move.sendToGrave({
      gameState: ctx.gameState,
      cardId: effect.cardId || (ctx.card && ctx.card.id),
      controller: ctx.controller,
      from: {
        controller: ctx.sourceController || ctx.controller,
        zone: sourceZone === ZONES.PUBLIC_HAND ? ZONES.PUBLIC_HAND : ZONES.HAND,
        index: typeof ctx.sourceIndex === 'number' ? ctx.sourceIndex : null,
      },
      reason: 'cardActivationCost',
      eventData: { tag: 'cardActivationCost', effectId: effect.id },
    });

    if (!resultOk(result)) {
      return makeFail('카드 발동 코스트를 지불할 수 없습니다.', { effectId: effect.id, result });
    }
    return makeOk({ effect, ctx, paidCost: result, cardActivationCost: true });
  }

  function payCost(ctxOrOptions, effectOrId) {
    let effect;
    let ctx;
    try {
      effect = normalizeEffect(effectOrId || (ctxOrOptions && ctxOrOptions.effect));
      ctx = normalizeContext(ctxOrOptions, effect);
    } catch (err) {
      return makeFail(err.message);
    }

    try {
      const result = effect.cost(ctx);
      if (!resultOk(result)) {
        return makeFail('코스트를 지불할 수 없습니다.', { effectId: effect.id, result });
      }
      return makeOk({ effect, ctx, paidCost: result === undefined ? true : result });
    } catch (err) {
      return makeFail(`cost 실행 중 오류: ${err.message}`, { effectId: effect.id, errorObject: err });
    }
  }

  function selectTargets(ctxOrOptions, effectOrId) {
    let effect;
    let ctx;
    try {
      effect = normalizeEffect(effectOrId || (ctxOrOptions && ctxOrOptions.effect));
      ctx = normalizeContext(ctxOrOptions, effect);
    } catch (err) {
      return makeFail(err.message);
    }

    try {
      const result = effect.target(ctx);
      if (!resultOk(result)) {
        return makeFail('대상 지정에 실패했습니다.', { effectId: effect.id, result });
      }

      const explicitTargets = result && result.targets != null ? result.targets : null;
      if (explicitTargets) ctx.setTargets(explicitTargets);

      return makeOk({ effect, ctx, targets: ctx.targets.slice(), targetResult: result === undefined ? true : result });
    } catch (err) {
      return makeFail(`target 실행 중 오류: ${err.message}`, { effectId: effect.id, errorObject: err });
    }
  }

  function copySourceInfo(ctx) {
    const source = ctx.source || {};
    return Object.freeze({
      controller: source.controller || ctx.sourceController || ctx.controller,
      zone: source.zone || ctx.sourceZone || null,
      index: typeof source.index === 'number' ? source.index : (typeof ctx.sourceIndex === 'number' ? ctx.sourceIndex : null),
    });
  }

  function createChainLink(ctxOrOptions, effectOrId, activationData) {
    const data = activationData || {};
    let effect;
    let ctx;
    try {
      effect = normalizeEffect(effectOrId || data.effect || (ctxOrOptions && ctxOrOptions.effect));
      ctx = normalizeContext(Object.assign({}, ctxOrOptions || {}, data.contextOverrides || {}), effect);
    } catch (err) {
      return makeFail(err.message);
    }

    const source = copySourceInfo(ctx);
    const sequence = nextLinkSequence++;
    const chainLink = Object.freeze({
      id: data.id || makeChainLinkId(sequence),
      chainId: chainState.id || data.chainId || null,
      effectId: effect.id,
      cardId: effect.cardId || (ctx.card && ctx.card.id) || null,
      cardName: (ctx.card && ctx.card.name) || null,
      controller: ctx.controller,
      sourceZone: source.zone,
      sourceController: source.controller,
      sourceIndex: source.index,
      source,
      targets: Object.freeze(asArray(data.targets != null ? data.targets : ctx.targets)),
      paidCost: data.paidCost == null ? null : data.paidCost,
      tags: Object.freeze(asArray(effect.tags)),
      negated: data.negated === true,
      negateReason: data.negateReason || null,
      createdAtPhase: getCurrentPhase(ctx.gameState),
      createdAtTurn: getCurrentTurn(ctx.gameState),
      createdAt: Date.now(),
      sequence,
      activationData: Object.freeze(Object.assign({}, data, { effect: undefined, contextOverrides: undefined })),
    });

    return makeOk({ chainLink, effect, ctx });
  }

  function ensureChainOpen() {
    if (chainState.active) return;
    chainState.id = makeChainId();
    chainState.active = true;
    chainState.responding = false;
    chainState.priority = null;
    chainState.passCount = 0;
    chainState.createdAt = Date.now();
    chainState.resolvedAt = 0;
  }

  function addChainLink(chainLink) {
    if (!chainLink || typeof chainLink !== 'object') {
      return makeFail('chainLink 객체가 필요합니다.');
    }

    ensureChainOpen();
    const normalized = Object.freeze(Object.assign({}, chainLink, {
      chainId: chainLink.chainId || chainState.id,
      order: chainState.links.length + 1,
    }));

    chainState.links.push(normalized);
    chainState.responding = true;
    chainState.passCount = 0;
    chainState.priority = normalized.controller === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
    const legacyMirror = syncLegacyChainMirror();

    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('hb:chain-link-added', { detail: { chainLink: normalized, chain: getChainState(), legacyMirror } }));
    }

    return makeOk({ chainLink: normalized, chain: getChainState(), legacyMirror });
  }

  function openChainResponseWindow(ctxOrOptions) {
    const ctx = normalizeContext(ctxOrOptions || {}, (ctxOrOptions && ctxOrOptions.effect) || null);
    if (!chainState.active || chainState.links.length === 0) {
      return makeOk({ open: false, reason: 'noActiveChain', chain: getChainState() });
    }

    chainState.responding = true;
    if (!chainState.priority) chainState.priority = ctx.opponent || (ctx.controller === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME);
    const legacyMirror = syncLegacyChainMirror();

    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('hb:chain-response-window', { detail: { ctx, chain: getChainState(), legacyMirror } }));
    }

    return makeOk({ open: true, priority: chainState.priority, chain: getChainState(), legacyMirror });
  }

  function findProcessingNegateCandidates(ctx, chainLink, effect) {
    const processingNegate = global.HB_PROCESSING_NEGATE_ENGINE || global.HB_PROCESSING_NEGATE;
    if (processingNegate && typeof processingNegate.findProcessingNegateCandidates === 'function') {
      return asArray(processingNegate.findProcessingNegateCandidates(chainLink, ctx && ctx.gameState, ctx));
    }
    if (processingNegate && typeof processingNegate.findCandidates === 'function') {
      return asArray(processingNegate.findCandidates(ctx, chainLink, effect));
    }

    // 12단계 엔진이 로드되지 않은 테스트 환경을 위한 최소 fallback.
    // tags가 없는 링크는 처리 시 무효 후보로 보지 않는다.
    if (!chainLink || !chainLink.tags || chainLink.tags.length === 0) return [];

    return registry.getEffectsByType(EFFECT_TYPES.PROCESSING_NEGATE)
      .filter(candidate => {
        if (candidate.id === effect.id) return false;
        try {
          const candidateCtx = ctx.with ? ctx.with({ effect: candidate, chainLink }) : normalizeContext({ gameState: ctx.gameState, controller: ctx.controller, effect: candidate, chainLink });
          return candidate.condition(candidateCtx) !== false;
        } catch (err) {
          console.error('[chain-engine] 처리 시 무효 후보 condition 오류:', candidate.id, err);
          return false;
        }
      });
  }

  function applyProcessingNegate(ctx, chainLink, effect) {
    const processingNegate = global.HB_PROCESSING_NEGATE_ENGINE || global.HB_PROCESSING_NEGATE;
    if (processingNegate && typeof processingNegate.applyFirstProcessingNegate === 'function') {
      return processingNegate.applyFirstProcessingNegate(chainLink, ctx && ctx.gameState, ctx);
    }
    if (processingNegate && typeof processingNegate.apply === 'function') {
      return processingNegate.apply(ctx, chainLink, effect);
    }

    const candidates = findProcessingNegateCandidates(ctx, chainLink, effect);
    if (!candidates.length) return makeOk({ negated: false, candidates: [] });

    const applied = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const negateEffect = candidates[i];
      const negateCtx = ctx.with ? ctx.with({ effect: negateEffect, chainLink }) : normalizeContext({ gameState: ctx.gameState, controller: ctx.controller, effect: negateEffect, chainLink });
      try {
        const result = negateEffect.resolve(negateCtx);
        if (resultOk(result)) {
          applied.push({ effectId: negateEffect.id, result: result === undefined ? true : result });
          return makeOk({ negated: true, candidates, applied, reason: 'processingNegate' });
        }
      } catch (err) {
        console.error('[chain-engine] 처리 시 무효 적용 중 오류:', negateEffect.id, err);
      }
    }

    return makeOk({ negated: false, candidates, applied });
  }

  function emitChainLinkResolved(ctx, chainLink, result, skipped) {
    if (!global.HB_EVENTS || typeof global.HB_EVENTS.emitGameEvent !== 'function') return null;
    return global.HB_EVENTS.emitGameEvent({
      type: EVENTS.CHAIN_LINK_RESOLVED || 'chainLinkResolved',
      effectId: chainLink.effectId,
      cardId: chainLink.cardId,
      controller: chainLink.controller,
      chainLinkId: chainLink.id,
      chainId: chainLink.chainId || chainState.id,
      skipped: !!skipped,
      negated: !!chainLink.negated || !!(result && result.negated),
      result,
    });
  }

  function resolveChainLink(ctxOrOptions, chainLink) {
    if (!chainLink || typeof chainLink !== 'object') {
      return makeFail('chainLink 객체가 필요합니다.');
    }

    let effect;
    let ctx;
    try {
      effect = normalizeEffect(chainLink.effectId);
      ctx = normalizeContext(Object.assign({}, ctxOrOptions || {}, {
        effect,
        chainLink,
        cardId: chainLink.cardId,
        controller: chainLink.controller,
        source: chainLink.source || {
          controller: chainLink.sourceController || chainLink.controller,
          zone: chainLink.sourceZone || null,
          index: typeof chainLink.sourceIndex === 'number' ? chainLink.sourceIndex : null,
        },
        targets: chainLink.targets,
      }), effect);
    } catch (err) {
      return makeFail(err.message, { chainLink });
    }

    if (chainLink.negated) {
      const skippedResult = makeOk({ chainLink, effect, skipped: true, negated: true, reason: chainLink.negateReason || 'preNegated' });
      emitChainLinkResolved(ctx, chainLink, skippedResult, true);
      return skippedResult;
    }

    const transformEngine = global.HB_EFFECT_TRANSFORM_ENGINE || global.HB_EFFECT_TRANSFORM;
    if (transformEngine && typeof transformEngine.consumeTransformedChainLink === 'function') {
      const transformed = transformEngine.consumeTransformedChainLink(chainLink, ctx, effect);
      if (transformed && transformed.ok !== false && transformed.skipOriginal) {
        const skippedResult = makeOk({ chainLink, effect, skipped: true, transformed: true, reason: transformed.reason || 'effectTransformed', transformResult: transformed });
        emitChainLinkResolved(ctx, chainLink, skippedResult, true);
        return skippedResult;
      }
    }

    const negateResult = applyProcessingNegate(ctx, chainLink, effect);
    if (negateResult.ok && negateResult.negated) {
      const skippedResult = makeOk({ chainLink, effect, skipped: true, negated: true, reason: negateResult.reason, negateResult });
      emitChainLinkResolved(ctx, chainLink, skippedResult, true);
      return skippedResult;
    }

    try {
      const resolveResult = effect.resolve(ctx);
      if (!resultOk(resolveResult)) {
        const failed = makeFail('효과 해결에 실패했습니다.', { chainLink, effect, result: resolveResult });
        emitChainLinkResolved(ctx, chainLink, failed, false);
        return failed;
      }

      const ok = makeOk({ chainLink, effect, result: resolveResult === undefined ? true : resolveResult });
      emitChainLinkResolved(ctx, chainLink, ok, false);
      return ok;
    } catch (err) {
      const failed = makeFail(`resolve 실행 중 오류: ${err.message}`, { chainLink, effect, errorObject: err });
      emitChainLinkResolved(ctx, chainLink, failed, false);
      return failed;
    }
  }

  function resolveChain(ctxOrOptions) {
    const ctx = normalizeContext(ctxOrOptions || {}, (ctxOrOptions && ctxOrOptions.effect) || null);
    const networkSync = global.HB_NETWORK_SYNC;
    if (networkSync && typeof networkSync.isAuthority === 'function' && !networkSync.isAuthority({ authority: ctx.authority })) {
      return makeFail('비권위 클라이언트에서는 체인을 실제 해결하지 않습니다. 권위 상태/diff를 기다립니다.');
    }
    const beforeNetworkState = networkSync && typeof networkSync.captureLocalState === 'function' ? networkSync.captureLocalState() : null;
    const links = chainState.links.slice();
    if (links.length === 0) {
      clearChain();
      return makeOk({ resolved: [], count: 0, errors: [] });
    }

    chainState.resolving = true;
    global._chainResolving = true;
    chainState.responding = false;
    chainState.priority = null;

    const resolved = [];
    const errors = [];
    for (let i = links.length - 1; i >= 0; i -= 1) {
      const result = resolveChainLink(ctx, links[i]);
      resolved.push(result);
      if (!result.ok) errors.push(result);
    }

    const chainBeforeClear = getChainState();
    clearChain();

    if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') {
      global.HB_EVENTS.dispatchEvents(ctx.gameState);
    }
    global._chainResolving = false;

    if (networkSync && typeof networkSync.sendStateDiff === 'function' && typeof networkSync.createStateDiff === 'function' && networkSync.hasNetworkRoom && networkSync.hasNetworkRoom()) {
      const afterNetworkState = networkSync.captureLocalState ? networkSync.captureLocalState() : null;
      const diff = networkSync.createStateDiff(beforeNetworkState, afterNetworkState);
      if (diff && diff.ops && diff.ops.length > 0) networkSync.sendStateDiff(diff);
    }

    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('hb:chain-resolved', { detail: { chain: chainBeforeClear, resolved, errors } }));
    }

    return makeOk({ resolved, count: resolved.length, errors, chain: chainBeforeClear });
  }

  function clearChain() {
    const previous = getChainState();
    chainState.active = false;
    chainState.links.length = 0;
    chainState.responding = false;
    chainState.priority = null;
    chainState.passCount = 0;
    chainState.resolving = false;
    global._chainResolving = false;
    chainState.resolvedAt = Date.now();
    chainState.id = null;
    syncLegacyChainMirror();
    return previous;
  }

  function getChainState() {
    return Object.freeze({
      id: chainState.id || null,
      active: !!chainState.active,
      links: Object.freeze(chainState.links.slice()),
      responding: !!chainState.responding,
      priority: chainState.priority,
      passCount: chainState.passCount,
      resolving: !!chainState.resolving,
      createdAt: chainState.createdAt,
      resolvedAt: chainState.resolvedAt,
    });
  }

  function setLegacyChainMirror(mirror) {
    try {
      // eslint-disable-next-line no-undef
      if (typeof activeChainState !== 'undefined') activeChainState = mirror;
    } catch (_) {}
    global.activeChainState = mirror;
    return mirror;
  }

  function mirrorChainLinkForLegacy(link) {
    const legacy = link && link.activationData && link.activationData.legacyLink
      ? Object.assign({}, link.activationData.legacyLink)
      : {};
    return Object.freeze(Object.assign({}, legacy, {
      hbEngine: true,
      hbEffectId: link.effectId,
      hbChainLinkId: link.id,
      chainId: link.chainId || chainState.id || null,
      by: controllerToRole(link.controller),
      cardId: legacy.cardId || link.cardId,
      cardName: legacy.cardName || link.cardName,
      sourceZone: legacy.sourceZone || link.sourceZone,
      sourceController: legacy.sourceController || controllerToRole(link.sourceController || link.controller),
      targets: legacy.targets || link.targets || [],
    }));
  }

  function getLegacyChainMirrorState() {
    const snapshot = getChainState();
    return Object.freeze({
      hbEngine: true,
      id: snapshot.id,
      active: snapshot.active,
      links: Object.freeze(snapshot.links.map(mirrorChainLinkForLegacy)),
      priority: snapshot.priority ? controllerToRole(snapshot.priority) : null,
      passCount: snapshot.passCount,
      responding: snapshot.responding,
      resolving: snapshot.resolving,
      createdAt: snapshot.createdAt,
      resolvedAt: snapshot.resolvedAt,
    });
  }

  function syncLegacyChainMirror() {
    return setLegacyChainMirror(chainState.active ? getLegacyChainMirrorState() : null);
  }

  function getChainLinks() {
    return chainState.links.slice();
  }

  function hasActiveChain() {
    return chainState.active && chainState.links.length > 0;
  }

  function passChainResponse(controller) {
    if (!chainState.active) return makeFail('활성 체인이 없습니다.');
    const passer = normalizeChainController(controller || chainState.priority);
    chainState.passCount += 1;
    // [BUG-1 FIX] passCount >= 2 체크를 priority 전환 전에 수행한다.
    // 기존 코드는 priority를 먼저 뒤집은 뒤 resolveChain에 뒤집힌 값을 넘겨
    // "패스한 쪽"이 아니라 "상대"를 resolver controller로 전달하는 버그가 있었다.
    if (chainState.passCount >= 2) {
      // [BUG-6 FIX] 전역 resolveChain(레거시)이 아닌 신엔진 내부 함수를 직접 호출
      return resolveChain({ controller: passer });
    }
    chainState.priority = passer === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
    return makeOk({ chain: getChainState(), legacyMirror: syncLegacyChainMirror() });
  }

  function pauseMoveEventDispatchForActivation() {
    global._hbActivatingChainEffect = Number(global._hbActivatingChainEffect || 0) + 1;
    return function releaseMoveEventDispatchForActivation() {
      global._hbActivatingChainEffect = Math.max(0, Number(global._hbActivatingChainEffect || 0) - 1);
    };
  }

  function activateEffect(options) {
    const opts = options || {};
    let effect;
    let ctx;
    try {
      effect = normalizeEffect(opts.effect || opts.effectId);
      ctx = normalizeContext(opts.ctx || opts, effect);
    } catch (err) {
      return makeFail(err.message);
    }

    const can = canActivateEffect(ctx, effect);
    if (!can.ok) return can;

    const releaseMoveEventDispatch = pauseMoveEventDispatchForActivation();
    try {
    const cardActivationCost = payCardActivationCost(ctx, effect);
    if (!cardActivationCost.ok) return cardActivationCost;

    const cost = payCost(ctx, effect);
    if (!cost.ok) return cost;

    const target = selectTargets(ctx, effect);
    if (!target.ok) return target;

    const linkResult = createChainLink(ctx, effect, Object.assign({}, opts.activationData || {}, {
      paidCost: cost.paidCost,
      cardActivationCost: cardActivationCost.cardActivationCost === true ? cardActivationCost.paidCost : false,
      targets: target.targets,
    }));
    if (!linkResult.ok) return linkResult;

    const addResult = addChainLink(linkResult.chainLink);
    if (!addResult.ok) return addResult;

    const usage = markEffectUsedForChain(ctx, effect);
    const response = openChainResponseWindow(ctx);

    if (opts.autoResolve === true || opts.resolveImmediately === true) {
      // [BUG-6 FIX] 신엔진 내부 resolveChain(클로저 스코프)을 직접 호출 — 전역 함수와 혼용 금지
      const resolved = resolveChain(ctx);
      return makeOk({ effect, ctx, chainLink: addResult.chainLink, cardActivationCost, paidCost: cost.paidCost, targets: target.targets, usage, response, resolved });
    }

    return makeOk({ effect, ctx, chainLink: addResult.chainLink, cardActivationCost, paidCost: cost.paidCost, targets: target.targets, usage, response, chain: getChainState() });
    } finally {
      releaseMoveEventDispatch();
    }
  }

  function resetUsageCounters() {
    const before = Array.from(usageCounters.entries());
    usageCounters.clear();
    return before;
  }

  function getUsageSnapshot() {
    return Object.freeze(Array.from(usageCounters.entries()).map(([key, count]) => Object.freeze({ key, count })));
  }

  // [BUG-6 FIX] 신엔진 내부에서 resolveChain을 local 변수로 캡처해두어
  // 나중에 로드되는 engine.js / effects-chain.js의 동명 전역 함수가
  // 클로저 내부 참조를 덮어쓰지 못하도록 보호한다.
  // passChainResponse, activateEffect 내부의 resolveChain 호출은
  // 모두 이 localResolveChain을 통해 실행된다.
  const localResolveChain = resolveChain;

  const api = Object.freeze({
    canActivateEffect,
    payCardActivationCost,
    payCost,
    selectTargets,
    createChainLink,
    addChainLink,
    openChainResponseWindow,
    resolveChain: localResolveChain,
    resolveChainLink,
    clearChain,

    // 안전한 신규 효과 진입점. 레거시 beginChain을 대체하지 않고 신엔진 효과만 사용한다.
    activateEffect,
    passChainResponse,
    getChainState,
    getChainLinks,
    hasActiveChain,
    roleToController,
    controllerToRole,
    getLegacyChainMirrorState,
    syncLegacyChainMirror,
    getUsageSnapshot,
    resetUsageCounters,
  });

  global.HB_CHAIN_ENGINE = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.chain = api;
})(window);
