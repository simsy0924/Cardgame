// HAND BATTLE — Engine: Processing Negate Engine
// “효과 처리 시 그 효과를 무효로 한다” 계열 효과를 일반 체인 응답과 분리해서 처리한다.
(function initProcessingNegateEngine(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({ PROCESSING_NEGATE: 'processingNegate' });
  const EFFECT_TAGS = rules.EFFECT_TAGS || Object.freeze({ NEGATE_EFFECT: 'negateEffect' });
  const EVENTS = rules.EVENTS || Object.freeze({ EFFECT_NEGATED: 'effectNegated' });

  const registry = global.HB_EFFECT_REGISTRY;
  if (!registry) {
    throw new Error('[processing-negate-engine] HB_EFFECT_REGISTRY가 필요합니다. effect-registry.js를 먼저 로드하세요.');
  }

  const definition = global.HB_EFFECT_DEFINITION;
  if (!definition) {
    throw new Error('[processing-negate-engine] HB_EFFECT_DEFINITION이 필요합니다. effect-definition.js를 먼저 로드하세요.');
  }

  const contextFactory = global.HB_EFFECT_CONTEXT;
  if (!contextFactory) {
    throw new Error('[processing-negate-engine] HB_EFFECT_CONTEXT가 필요합니다. effect-context.js를 먼저 로드하세요.');
  }

  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!zoneAccess) {
    throw new Error('[processing-negate-engine] HB_ZONE_ACCESS가 필요합니다. zone-access.js를 먼저 로드하세요.');
  }

  const CONTROLLERS = (zoneAccess && zoneAccess.CONTROLLERS) || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const ZONES = (global.HB_RULES && global.HB_RULES.ZONES) || Object.freeze({
    HAND: 'hand',
    PUBLIC_HAND: 'publicHand',
    FIELD: 'field',
    FIELD_ZONE: 'fieldZone',
    GRAVE: 'grave',
    EXILE: 'exile',
    KEY_DECK: 'keyDeck',
  });

  const REQUIRED_NEGATABLE_TAGS = Object.freeze([
    'deckSearch',
    'monsterSummon',
    'deckSummon',
    'handSummon',
    'graveSummon',
    'exileSummon',
    'keyDeckSummon',
    'sendMyFieldToGrave',
    'targetMyField',
    'discardHand',
    'banishField',
    'draw',
    'placeFieldCard',
    'negateEffect',
  ]);

  const negateHistory = [];

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    asArray(values).forEach(value => {
      if (value == null || value === '') return;
      const text = String(value);
      if (seen.has(text)) return;
      seen.add(text);
      result.push(text);
    });
    return result;
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || cardOrId.name || '';
  }

  function candidateZones(candidate) {
    const zones = uniqueStrings(candidate && (candidate.zones && candidate.zones.length ? candidate.zones : candidate.zone));
    return zones.length ? zones : [ZONES.FIELD, ZONES.FIELD_ZONE];
  }

  function cardMatchesCandidate(card, candidate) {
    if (!card || !candidate || !candidate.cardId) return false;
    const want = String(candidate.cardId);
    return [card.id, card.cardId, card.name, card.originalId]
      .filter(value => value != null && value !== '')
      .map(String)
      .indexOf(want) !== -1;
  }

  function makeCandidateLocation(controller, zone, index, card) {
    return Object.freeze({
      controller,
      zone,
      index: typeof index === 'number' ? index : null,
      card,
    });
  }

  function attachCandidateLocation(candidate, location) {
    return Object.assign({}, candidate, {
      controller: location.controller,
      sourceController: location.controller,
      sourceZone: location.zone,
      sourceIndex: location.index,
      source: location,
      card: location.card,
    });
  }

  function findCandidateSourceLocations(candidate, gameState) {
    const state = gameState || getDefaultGameState();
    const locations = [];
    const seen = new Set();
    const zones = candidateZones(candidate);
    const controllers = [CONTROLLERS.ME, CONTROLLERS.OPPONENT];

    controllers.forEach(controller => {
      zones.forEach(rawZone => {
        let zone;
        try { zone = zoneAccess.normalizeZone(rawZone); }
        catch (_) { return; }

        if (zone === ZONES.FIELD_ZONE) {
          let card = null;
          try { card = zoneAccess.getFieldZoneCard(state, controller); }
          catch (_) { card = null; }
          if (!cardMatchesCandidate(card, candidate)) return;
          const key = `${controller}:${zone}:fieldZone:${getCardId(card)}`;
          if (seen.has(key)) return;
          seen.add(key);
          locations.push(makeCandidateLocation(controller, zone, null, card));
          return;
        }

        let arr;
        try { arr = zoneAccess.getZoneArray(state, controller, zone); }
        catch (_) { return; }
        arr.forEach((card, index) => {
          if (!cardMatchesCandidate(card, candidate)) return;
          const key = `${controller}:${zone}:${index}:${getCardId(card)}`;
          if (seen.has(key)) return;
          seen.add(key);
          locations.push(makeCandidateLocation(controller, zone, index, card));
        });
      });
    });

    return locations;
  }

  function isLocalController(controller) {
    try { return zoneAccess.normalizeController(controller || CONTROLLERS.ME) === CONTROLLERS.ME; }
    catch (_) { return false; }
  }

  function intersects(a, b) {
    const set = new Set(uniqueStrings(a));
    return uniqueStrings(b).some(value => set.has(value));
  }

  function getChainLinkTags(chainLink) {
    const tags = uniqueStrings(chainLink && chainLink.tags);
    return tags.filter(tag => REQUIRED_NEGATABLE_TAGS.indexOf(tag) !== -1);
  }

  function getCandidateNegateTags(candidate) {
    if (!candidate) return [];
    const meta = candidate.meta || {};
    const processingNegate = candidate.processingNegate || meta.processingNegate || {};

    const explicit = uniqueStrings([
      ...asArray(candidate.negateTags),
      ...asArray(candidate.negates),
      ...asArray(candidate.targetTags),
      ...asArray(meta.negateTags),
      ...asArray(meta.negates),
      ...asArray(meta.targetTags),
      ...asArray(meta.processingNegateTags),
      ...asArray(processingNegate.negateTags),
      ...asArray(processingNegate.targetTags),
      ...asArray(processingNegate.tags),
    ]);

    if (explicit.length > 0) return explicit.filter(tag => REQUIRED_NEGATABLE_TAGS.indexOf(tag) !== -1);

    // 수동 등록 편의를 위해 processingNegate 효과 자체의 tags 중 negateEffect가 아닌 태그는
    // “이 태그가 붙은 체인 링크를 처리 시 무효할 수 있다”는 의미로도 허용한다.
    return uniqueStrings(candidate.tags)
      .filter(tag => tag !== EFFECT_TAGS.NEGATE_EFFECT)
      .filter(tag => REQUIRED_NEGATABLE_TAGS.indexOf(tag) !== -1);
  }

  function makeFail(message, payload) {
    return Object.freeze(Object.assign({ ok: false, error: message }, payload || {}));
  }

  function makeOk(payload) {
    return Object.freeze(Object.assign({ ok: true }, payload || {}));
  }

  function isPromiseLike(value) {
    return !!(value && typeof value.then === 'function');
  }

  function getDefaultGameState() {
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    return null;
  }

  function createCandidateContext(candidate, chainLink, baseCtx, gameState) {
    const controller = (candidate && candidate.controller)
      || (candidate && candidate.sourceController)
      || (baseCtx && baseCtx.controller)
      || (chainLink && chainLink.controller)
      || CONTROLLERS.ME;

    const source = (candidate && candidate.source) || {
      controller: candidate && (candidate.sourceController || candidate.controller || controller),
      zone: candidate && (candidate.sourceZone || candidate.zone || (candidate.zones && candidate.zones[0]) || null),
      index: candidate && typeof candidate.sourceIndex === 'number' ? candidate.sourceIndex : null,
      card: candidate && candidate.card,
    };

    const options = {
      gameState: gameState || (baseCtx && baseCtx.gameState) || getDefaultGameState(),
      controller,
      card: candidate && candidate.card,
      cardId: candidate && candidate.cardId,
      effect: candidate,
      chainLink,
      event: {
        type: 'chainLinkResolving',
        chainLinkId: chainLink && chainLink.id,
        chainLink,
        tags: chainLink && chainLink.tags,
      },
      source,
      sourceZone: source && source.zone,
      sourceController: source && source.controller,
      sourceIndex: source && typeof source.index === 'number' ? source.index : null,
      targets: [chainLink],
      authority: baseCtx && typeof baseCtx.authority === 'boolean' ? baseCtx.authority : undefined,
      askPlayer: baseCtx && baseCtx.askPlayer,
      random: baseCtx && baseCtx.random,
      logEntries: baseCtx && baseCtx.log && baseCtx.log.entries,
      silentLog: baseCtx && baseCtx.silentLog,
    };

    if (baseCtx && typeof baseCtx.with === 'function') {
      return baseCtx.with(options);
    }
    return contextFactory.createEffectContext(options);
  }

  function getProcessingNegateEffects() {
    if (typeof registry.getEffectsByType === 'function') {
      return registry.getEffectsByType(EFFECT_TYPES.PROCESSING_NEGATE || 'processingNegate');
    }
    if (typeof registry.getEffectCandidates === 'function') {
      return registry.getEffectCandidates({ type: EFFECT_TYPES.PROCESSING_NEGATE || 'processingNegate' });
    }
    return [];
  }

  function isProcessingNegateEffect(candidate) {
    return !!(candidate && candidate.type === (EFFECT_TYPES.PROCESSING_NEGATE || 'processingNegate'));
  }

  function canApplyProcessingNegate(candidate, chainLink, ctx) {
    if (!candidate || !chainLink) return makeFail('candidate와 chainLink가 필요합니다.');
    if (!isProcessingNegateEffect(candidate)) {
      return makeFail('processingNegate 타입 효과가 아닙니다.', { candidate });
    }

    if (!candidate.sourceController || !candidate.sourceZone || !candidate.card) {
      return makeFail('processingNegate 효과의 실제 소스 카드가 필드/지정 존에 없습니다.', { candidateId: candidate.id, cardId: candidate.cardId });
    }

    if (candidate.id && chainLink.effectId && candidate.id === chainLink.effectId) {
      return makeFail('자기 자신을 처리 시 무효할 수 없습니다.', { candidateId: candidate.id, chainLinkId: chainLink.id });
    }

    const chainTags = getChainLinkTags(chainLink);
    if (chainTags.length === 0) {
      return makeFail('태그 없는 효과는 처리 시 무효 후보가 되지 않습니다.', { chainLinkId: chainLink.id });
    }

    const negateTags = getCandidateNegateTags(candidate);
    if (negateTags.length === 0) {
      return makeFail('processingNegate 효과에 무효 대상 태그가 없습니다.', { candidateId: candidate.id });
    }

    if (!intersects(chainTags, negateTags)) {
      return makeFail('체인 링크 태그와 무효 가능 태그가 맞지 않습니다.', {
        candidateId: candidate.id,
        chainLinkId: chainLink.id,
        chainTags,
        negateTags,
      });
    }

    const candidateCtx = createCandidateContext(candidate, chainLink, ctx, ctx && ctx.gameState);
    try {
      const conditionResult = candidate.condition(candidateCtx);
      if (conditionResult === false || (conditionResult && conditionResult.ok === false)) {
        return makeFail('processingNegate 조건을 만족하지 않습니다.', { candidateId: candidate.id, conditionResult });
      }
    } catch (err) {
      return makeFail(`processingNegate condition 오류: ${err.message}`, { candidateId: candidate.id, errorObject: err });
    }

    return makeOk({ candidate, chainLink, ctx: candidateCtx, chainTags, negateTags });
  }

  function askProcessingNegateActivation(candidate, chainLink, ctx) {
    const candidateCtx = createCandidateContext(candidate, chainLink, ctx, ctx && ctx.gameState);

    if (!isLocalController(candidateCtx.controller)) {
      const aiCanDecide = !!(global.AI && global.AI.active && candidateCtx.controller === CONTROLLERS.OPPONENT);
      if (aiCanDecide) {
        let useByAI = false;
        if (typeof global._aiShouldUseProcessingNegate === 'function') {
          try { useByAI = !!global._aiShouldUseProcessingNegate(candidate, chainLink, candidateCtx); }
          catch (_) { useByAI = false; }
        } else {
          useByAI = !!(chainLink && chainLink.controller !== candidateCtx.controller);
        }
        return makeOk({ activate: useByAI, autoAI: true, candidate, ctx: candidateCtx, reason: useByAI ? 'aiAccepted' : 'aiDeclined' });
      }
      return makeOk({ activate: false, skipped: true, candidate, ctx: candidateCtx, reason: 'remoteController' });
    }

    if (candidate.mandatory === true || candidate.optional === false) {
      return makeOk({ activate: true, mandatory: true, candidate, ctx: candidateCtx });
    }

    if (candidateCtx.autoConfirmProcessingNegate === true || candidate.autoConfirm === true || (candidate.meta && candidate.meta.autoConfirm === true)) {
      return makeOk({ activate: true, autoConfirm: true, candidate, ctx: candidateCtx });
    }

    const question = {
      type: 'processingNegate',
      message: `${candidate.cardId || candidate.id}의 처리 시 무효 효과를 적용할까요?`,
      candidate,
      chainLink,
    };

    try {
      const answer = candidateCtx.askPlayer(question);
      if (isPromiseLike(answer)) {
        if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
          global.dispatchEvent(new global.CustomEvent('hb:processing-negate-choice-needed', { detail: { candidate, chainLink, ctx: candidateCtx } }));
        }
        return makeOk({ activate: false, pending: true, candidate, ctx: candidateCtx, reason: 'asyncChoiceNotResolved' });
      }
      return makeOk({ activate: !!answer, candidate, ctx: candidateCtx });
    } catch (err) {
      return makeFail(`processingNegate 선택 확인 오류: ${err.message}`, { candidateId: candidate.id, errorObject: err });
    }
  }

  function markChainLinkNegated(chainLink, negateData) {
    const patch = {
      negated: true,
      negateReason: 'processingNegate',
      negatedByEffectId: negateData && negateData.effectId,
      negatedAt: Date.now(),
    };

    if (chainLink && !Object.isFrozen(chainLink)) {
      Object.assign(chainLink, patch);
      return chainLink;
    }

    return Object.freeze(Object.assign({}, chainLink || {}, patch));
  }

  function emitEffectNegated(candidate, chainLink, result) {
    if (!global.HB_EVENTS || typeof global.HB_EVENTS.emitGameEvent !== 'function') return null;
    return global.HB_EVENTS.emitGameEvent({
      type: EVENTS.EFFECT_NEGATED || 'effectNegated',
      effectId: chainLink && chainLink.effectId,
      cardId: chainLink && chainLink.cardId,
      controller: chainLink && chainLink.controller,
      chainLinkId: chainLink && chainLink.id,
      chainId: chainLink && chainLink.chainId,
      tags: chainLink && chainLink.tags,
      reason: 'processingNegate',
      negatedByEffectId: candidate && candidate.id,
      negatedByCardId: candidate && candidate.cardId,
      result,
    });
  }

  function findProcessingNegateCandidates(chainLink, gameState, ctx) {
    if (!chainLink) return [];
    const chainTags = getChainLinkTags(chainLink);
    if (chainTags.length === 0) return [];

    const baseCtx = ctx || contextFactory.createEffectContext({
      gameState: gameState || getDefaultGameState(),
      controller: chainLink.controller || 'me',
      chainLink,
      targets: [chainLink],
      event: { type: 'chainLinkResolving', chainLinkId: chainLink.id, chainLink, tags: chainLink.tags },
    });

    const located = [];
    getProcessingNegateEffects().forEach(candidate => {
      const locations = findCandidateSourceLocations(candidate, gameState || (baseCtx && baseCtx.gameState));
      locations.forEach(location => {
        const withLocation = attachCandidateLocation(candidate, location);
        if (canApplyProcessingNegate(withLocation, chainLink, baseCtx).ok) located.push(withLocation);
      });
    });
    return located;
  }

  function applyProcessingNegate(candidate, chainLink, ctx) {
    const can = canApplyProcessingNegate(candidate, chainLink, ctx);
    if (!can.ok) return can;

    const ask = askProcessingNegateActivation(candidate, chainLink, can.ctx);
    if (!ask.ok) return ask;
    if (!ask.activate) {
      return makeOk({ negated: false, skipped: true, pending: !!ask.pending, reason: ask.reason || 'declined', candidate, chainLink });
    }

    try {
      const resolveResult = candidate.resolve(ask.ctx || can.ctx);
      if (resolveResult === false || (resolveResult && resolveResult.ok === false)) {
        return makeFail('processingNegate resolve가 실패했습니다.', { candidateId: candidate.id, result: resolveResult });
      }

      const negatedChainLink = markChainLinkNegated(chainLink, { effectId: candidate.id });
      const historyEntry = Object.freeze({
        candidateId: candidate.id,
        candidateCardId: candidate.cardId,
        chainLinkId: chainLink && chainLink.id,
        effectId: chainLink && chainLink.effectId,
        cardId: chainLink && chainLink.cardId,
        tags: Object.freeze(uniqueStrings(chainLink && chainLink.tags)),
        result: resolveResult === undefined ? true : resolveResult,
        timestamp: Date.now(),
      });
      negateHistory.push(historyEntry);
      emitEffectNegated(candidate, chainLink, historyEntry.result);

      return makeOk({
        negated: true,
        candidate,
        chainLink: negatedChainLink,
        originalChainLink: chainLink,
        result: historyEntry.result,
        historyEntry,
        reason: 'processingNegate',
      });
    } catch (err) {
      return makeFail(`processingNegate resolve 오류: ${err.message}`, { candidateId: candidate.id, errorObject: err });
    }
  }

  function applyFirstProcessingNegate(chainLink, gameState, ctx) {
    const candidates = findProcessingNegateCandidates(chainLink, gameState, ctx);
    const checked = [];

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const result = applyProcessingNegate(candidate, chainLink, ctx);
      checked.push(result);
      if (result.ok && result.negated) {
        return makeOk({ negated: true, candidate, candidates, checked, result, reason: 'processingNegate' });
      }
    }

    return makeOk({ negated: false, candidates, checked });
  }

  function clearHistory() {
    const before = negateHistory.slice();
    negateHistory.length = 0;
    return before;
  }

  function getHistory() {
    return negateHistory.slice();
  }

  const api = Object.freeze({
    REQUIRED_NEGATABLE_TAGS,
    findProcessingNegateCandidates,
    canApplyProcessingNegate,
    askProcessingNegateActivation,
    applyProcessingNegate,
    applyFirstProcessingNegate,
    getCandidateNegateTags,
    getChainLinkTags,
    getHistory,
    clearHistory,

    // 기존 8단계 chain-engine 임시 훅과의 호환 alias.
    findCandidates: function findCandidates(ctx, chainLink) {
      return findProcessingNegateCandidates(chainLink, ctx && ctx.gameState, ctx);
    },
    apply: function apply(ctx, chainLink) {
      return applyFirstProcessingNegate(chainLink, ctx && ctx.gameState, ctx);
    },
  });

  global.HB_PROCESSING_NEGATE = api;
  global.HB_PROCESSING_NEGATE_ENGINE = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.processingNegate = api;
})(window);