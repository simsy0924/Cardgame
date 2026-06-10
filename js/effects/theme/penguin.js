// HAND BATTLE — Theme Effects: Penguin
// 16단계: 펭귄 테마를 EffectDefinition 기반으로 이식한다.
// 카드 텍스트는 표시용이고, 실제 신규 효과 처리는 이 파일의 EffectDefinition을 기준으로 한다.
(function initPenguinEffectDefinitions(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({
    ACTIVATION: 'activation',
    QUICK: 'quick',
    TRIGGER: 'trigger',
    CONTINUOUS: 'continuous',
    PROCEDURE: 'procedure',
    REPLACEMENT: 'replacement',
  });
  const ZONES = rules.ZONES || Object.freeze({
    DECK: 'deck',
    HAND: 'hand',
    FIELD: 'field',
    GRAVE: 'grave',
    EXILE: 'exile',
    PUBLIC_HAND: 'publicHand',
  });
  const EVENTS = rules.EVENTS || Object.freeze({
    SUMMON: 'summon',
    SENT_TO_GRAVE: 'sentToGrave',
    DISCARDED: 'discarded',
  });
  const TIMING = rules.TIMING || Object.freeze({
    MY_DEPLOY: 'myDeploy',
    OPPONENT_TURN: 'opponentTurn',
    EITHER_TURN: 'eitherTurn',
    ON_SUMMON: 'onSummon',
    ON_SENT_TO_GRAVE: 'onSentToGrave',
    NONE: 'none',
  });
  const TAGS = rules.EFFECT_TAGS || Object.freeze({
    DECK_SUMMON: 'deckSummon',
    HAND_SUMMON: 'handSummon',
    GRAVE_SUMMON: 'graveSummon',
    EXILE_SUMMON: 'exileSummon',
    DECK_SEARCH: 'deckSearch',
    DISCARD_HAND: 'discardHand',
    DRAW: 'draw',
    NEGATE_EFFECT: 'negateEffect',
    COST_DISCARD: 'costDiscard',
    COST_BANISH: 'costBanish',
  });

  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry) throw new Error('[penguin-effects] HB_EFFECT_REGISTRY가 필요합니다.');
  if (!zoneAccess) throw new Error('[penguin-effects] HB_ZONE_ACCESS가 필요합니다.');

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });

  function getDefaultGameState() {
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
    const id = getCardId(cardOrId);
    const cards = getCardDatabase();
    return cards && id ? cards[id] || null : null;
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || cardOrId.name || '';
  }

  function getCardName(cardOrId) {
    if (cardOrId && typeof cardOrId === 'object' && cardOrId.name) return cardOrId.name;
    const def = getCardDef(cardOrId);
    return (def && def.name) || getCardId(cardOrId);
  }

  function normalizeController(controller) {
    return zoneAccess.normalizeController(controller || CONTROLLERS.ME);
  }

  function opponentOf(controller) {
    return normalizeController(controller) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
  }

  function zoneArray(ctxOrState, controller, zone) {
    const state = (ctxOrState && ctxOrState.gameState) || ctxOrState || getDefaultGameState();
    return zoneAccess.getZoneArray(state, normalizeController(controller || CONTROLLERS.ME), zone);
  }

  function hasFieldSpace(ctx, controller) {
    if (ctx && ctx.move && typeof ctx.move.hasFieldSpace === 'function') return ctx.move.hasFieldSpace(controller || ctx.controller);
    const state = ctx && ctx.gameState ? ctx.gameState : getDefaultGameState();
    const field = zoneAccess.getZoneArray(state, normalizeController(controller || CONTROLLERS.ME), ZONES.FIELD);
    return field.length < 5;
  }

  function isPenguinCard(cardOrId) {
    const id = getCardId(cardOrId);
    const def = getCardDef(id);
    return !!(id && (id.indexOf('펭귄') !== -1 || (def && def.theme === '펭귄')));
  }

  function isPenguinMonster(cardOrId) {
    const def = getCardDef(cardOrId);
    return !!(def && def.cardType === 'monster' && isPenguinCard(def.id));
  }

  function isPenguinMagic(cardOrId) {
    const def = getCardDef(cardOrId);
    return !!(def && def.cardType === 'magic' && isPenguinCard(def.id));
  }

  function isMonster(cardOrId) {
    const def = getCardDef(cardOrId);
    return !!(def && def.cardType === 'monster');
  }

  function isMyTurnFallback(ctx) {
    if (ctx && ctx.gameState && ctx.gameState.activeController) return ctx.gameState.activeController === normalizeController(ctx.controller);
    // eslint-disable-next-line no-undef
    if (typeof isMyTurn !== 'undefined') return !!isMyTurn;
    return true;
  }

  function currentPhaseFallback(ctx) {
    if (ctx && ctx.gameState && ctx.gameState.phase) return ctx.gameState.phase;
    // eslint-disable-next-line no-undef
    if (typeof currentPhase !== 'undefined') return currentPhase;
    return null;
  }

  function isDeployPhase(ctx) {
    const phase = currentPhaseFallback(ctx);
    return !phase || phase === 'deploy' || phase === '전개' || phase === 'main';
  }

  function hasPenguinVillageRevealed(ctx, controller) {
    const owner = normalizeController(controller || (ctx && ctx.controller) || CONTROLLERS.ME);
    const hand = zoneArray(ctx, owner, ZONES.HAND);
    return hand.some(card => card && card.id === '펭귄 마을' && card.isPublic);
  }

  function findDeckCards(ctx, predicate, controller) {
    return zoneArray(ctx, controller || ctx.controller, ZONES.DECK).filter(card => card && predicate(card));
  }

  function findZoneCards(ctx, zone, predicate, controller) {
    return zoneArray(ctx, controller || ctx.controller, zone).filter(card => card && (!predicate || predicate(card)));
  }

  function firstOrSelected(ctx, candidates, options) {
    const opts = options || {};
    const selected = (ctx && ctx.selectedCards) || [];
    if (opts.byId && selected.length) {
      const selectedId = getCardId(selected[0]);
      const found = candidates.find(card => getCardId(card) === selectedId);
      if (found) return found;
    }
    if (typeof opts.index === 'number') return candidates[opts.index] || null;
    if (selected.length && typeof selected[0] === 'number') return candidates[selected[0]] || null;
    if (selected.length && selected[0] && typeof selected[0] === 'object') {
      const selectedId = getCardId(selected[0]);
      return candidates.find(card => getCardId(card) === selectedId) || selected[0];
    }
    return candidates[0] || null;
  }

  function chooseCards(ctx, candidates, title, max, done) {
    const list = candidates.slice();
    const count = Math.max(0, Math.min(max || 1, list.length));
    if (count <= 0) {
      if (done) done([]);
      return [];
    }

    if (ctx && ctx.selectedCards && ctx.selectedCards.length) {
      const selected = ctx.selectedCards.slice(0, count).map(item => {
        if (typeof item === 'number') return list[item];
        const id = getCardId(item);
        return list.find(card => getCardId(card) === id) || item;
      }).filter(Boolean);
      if (done) done(selected);
      return selected;
    }

    // 브라우저 플레이에서는 기존 카드 선택 UI를 재사용한다. 체인 엔진은 반환값을 기다리지 않지만,
    // 기존 프로젝트도 같은 방식의 비동기 선택을 사용하므로 호환을 위해 resolve 내부에서 콜백 처리한다.
    // picker는 로컬 플레이어 컨트롤러일 때만 띄운다(상대/AI 해결은 자동 첫 후보).
    const isLocalHumanPick = normalizeController(ctx && ctx.controller) === CONTROLLERS.ME && !ctx._hbAutoPick && !ctx.isAI;
    // eslint-disable-next-line no-undef
    if (typeof openCardPicker === 'function' && isLocalHumanPick) {
      // eslint-disable-next-line no-undef
      openCardPicker(list, title, count, sel => {
        const selected = (sel || []).map(i => list[i]).filter(Boolean);
        if (done) done(selected);
      }, true);
      return null;
    }

    const auto = list.slice(0, count);
    if (done) done(auto);
    return auto;
  }

  function notifySafe(message) {
    // eslint-disable-next-line no-undef
    if (typeof notify === 'function') notify(message);
    else if (global.console && global.console.log) global.console.log('[penguin-effects]', message);
  }

  function logSafe(message, type) {
    // eslint-disable-next-line no-undef
    if (typeof log === 'function') log(message, type || 'mine');
    else if (global.console && global.console.log) global.console.log('[penguin-effects]', message);
  }

  function renderAndSync() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof sendGameState === 'function') sendGameState();
    } catch (_) {}
    try {
      // eslint-disable-next-line no-undef
      if (typeof renderAll === 'function') renderAll();
    } catch (_) {}
  }

  function dispatchPending(ctx) {
    if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') {
      global.HB_EVENTS.dispatchEvents(ctx.gameState);
    }
  }

  function moveSourceSpellToGrave(ctx, reason) {
    const def = getCardDef(ctx.cardId || (ctx.effect && ctx.effect.cardId));
    if (!def || def.cardType === 'monster') return { ok: true, skipped: true };
    const fromZone = ctx.sourceZone || (ctx.source && ctx.source.zone);
    if (fromZone !== ZONES.HAND && fromZone !== ZONES.PUBLIC_HAND) return { ok: true, skipped: true };
    return ctx.move.sendToGrave({
      cardId: def.id,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.HAND, index: ctx.sourceIndex },
      reason: reason || 'penguinSpellActivation',
    });
  }

  function drawOne(ctx) {
    const deck = zoneArray(ctx, ctx.controller, ZONES.DECK);
    if (!deck.length) return { ok: false, error: '덱에 카드가 없습니다.' };
    const cardId = deck[0].id;
    return ctx.move.moveCard({
      cardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.DECK, index: 0 },
      to: { controller: ctx.controller, zone: ZONES.HAND },
      reason: 'draw',
      eventData: { source: 'penguinEffect' },
    });
  }

  function drawN(ctx, count) {
    const results = [];
    for (let i = 0; i < count; i += 1) {
      const result = drawOne(ctx);
      results.push(result);
      if (!result.ok) break;
    }
    return { ok: results.every(r => r.ok), results };
  }


  function canDraw(ctx, count) {
    const need = Math.max(1, Number(count || 1));
    const deckCount = zoneArray(ctx, ctx.controller, ZONES.DECK).length;
    if (deckCount >= need) return true;
    return { ok: false, error: `덱에 카드가 ${need}장 이상 있어야 발동할 수 있습니다.` };
  }

  function canDiscardOneFromHand(ctx, options) {
    const opts = options || {};
    const pool = zoneArray(ctx, ctx.controller, ZONES.HAND).filter(card => card && (!opts.excludeCardId || card.id !== opts.excludeCardId));
    if (pool.length > 0) return true;
    return { ok: false, error: '버릴 패가 없어 발동할 수 없습니다.' };
  }

  function canSearchDeck(ctx, predicate, label) {
    if (findDeckCards(ctx, predicate).length > 0) return true;
    return { ok: false, error: `${label || '서치할 카드'}가 덱에 없어 발동할 수 없습니다.` };
  }

  function canSummonFromDeckForEffect(ctx, predicate, label) {
    if (!hasFieldSpace(ctx)) return { ok: false, error: '자신 몬스터 존이 가득 차 발동할 수 없습니다.' };
    if (findDeckCards(ctx, predicate).length > 0) return true;
    return { ok: false, error: `${label || '소환할 카드'}가 덱에 없어 발동할 수 없습니다.` };
  }

  function canHeroOneResolve(ctx) {
    if (!cardMatchesEvent(ctx, '펭귄 용사')) return true;
    if (!hasFieldSpace(ctx)) return { ok: false, error: '자신 몬스터 존이 가득 차 「펭귄 용사」 ①을 발동할 수 없습니다.' };
    const deck = zoneArray(ctx, ctx.controller, ZONES.DECK).filter(Boolean);
    const searchCandidates = deck.filter(card => isPenguinCard(card.id));
    if (!searchCandidates.length) return { ok: false, error: '서치할 「펭귄」 카드가 덱에 없어 「펭귄 용사」 ①을 발동할 수 없습니다.' };

    const hasValidSearchThenSummon = searchCandidates.some(searchCard => deck.some(card => card !== searchCard && isPenguinMonster(card.id)));
    if (!hasValidSearchThenSummon) {
      return { ok: false, error: '서치 후 소환할 「펭귄」 몬스터가 덱에 남지 않아 「펭귄 용사」 ①을 발동할 수 없습니다.' };
    }

    return true;
  }

  function canGatekeeperOneResolve(ctx) {
    const mine = canDiscardOneFromHand(ctx);
    if (mine !== true) return mine;

    const opponentHand = zoneArray(ctx, opponentOf(ctx.controller), ZONES.HAND);
    if (opponentHand.length === 0) return { ok: false, error: '상대가 버릴 패가 없어 「수문장 펭귄」 ①을 발동할 수 없습니다.' };
    return true;
  }

  function canSendOpponentMonsterToGraveForActivation(ctx, reason) {
    const opponent = opponentOf(ctx.controller);
    const opponentMonsters = zoneArray(ctx, opponent, ZONES.FIELD).filter(card => card && isMonster(card));
    if (!opponentMonsters.length) return { ok: false, error: '상대 필드에 몬스터가 없어 발동할 수 없습니다.' };
    const sendable = getSendableOpponentMonsters(ctx, reason);
    if (!sendable.length) return { ok: false, error: '상대 필드의 몬스터가 모두 효과 내성이 있거나 묘지로 보낼 수 없어 발동할 수 없습니다.' };
    return true;
  }

  function addDeckCardToHand(ctx, cardId, reveal) {
    return ctx.move.addToHand({
      cardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.DECK },
      reveal: reveal !== false,
      reason: 'penguinDeckSearch',
      eventData: { tag: TAGS.DECK_SEARCH },
    });
  }

  function summonFromDeck(ctx, cardId, reason) {
    return ctx.move.summonCard({
      cardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.DECK },
      reason: reason || 'penguinDeckSummon',
      eventData: { sourceZone: ZONES.DECK, summonType: 'effect', tag: TAGS.DECK_SUMMON },
    });
  }

  function summonFromHandById(ctx, cardId, reason) {
    return ctx.move.summonCard({
      cardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.HAND },
      reason: reason || 'penguinHandSummon',
      eventData: { sourceZone: ZONES.HAND, summonType: 'effect', tag: TAGS.HAND_SUMMON },
    });
  }

  function summonFromGraveOrExile(ctx, cardId, reason) {
    const grave = zoneArray(ctx, ctx.controller, ZONES.GRAVE);
    const exile = zoneArray(ctx, ctx.controller, ZONES.EXILE);
    const fromZone = grave.some(card => card && card.id === cardId) ? ZONES.GRAVE : (exile.some(card => card && card.id === cardId) ? ZONES.EXILE : null);
    if (!fromZone) return { ok: false, error: `${cardId}를 묘지/제외에서 찾지 못했습니다.` };
    return ctx.move.summonCard({
      cardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: fromZone },
      reason: reason || 'penguinGraveExileSummon',
      eventData: { sourceZone: fromZone, summonType: 'effect', tag: fromZone === ZONES.GRAVE ? TAGS.GRAVE_SUMMON : TAGS.EXILE_SUMMON },
    });
  }

  // ── 엔진 버리기 단계 ──
  // 패에서 count장을 '플레이어가 직접 골라' 버리는 단계.
  // resolve는 동기이고 picker는 비동기(openCardPicker 콜백)이므로, 로컬 플레이어가
  // 실제로 고를 여지가 있을 때만 picker를 띄우고 콜백에서 버린다(드로우/서치가 끝난
  // 최종 패에 picker가 뜨므로 후보 풀이 정확하다). 비-로컬/자동/단일 후보/사전 선택이
  // 있으면 동기적으로 처리한다. 이름취급·forceDiscard와 동일한 '콜백에서 적용' 패턴.
  function requestHandDiscard(ctx, options, onDone) {
    const opts = options || {};
    const controller = normalizeController(ctx.controller);
    const reason = opts.reason || 'penguinHandDiscard';
    const title = opts.title || '버릴 패를 선택하세요';
    const predicate = typeof opts.predicate === 'function' ? opts.predicate : null;
    const buildPool = () => zoneArray(ctx, controller, ZONES.HAND).filter(card =>
      card && (!opts.excludeCardId || card.id !== opts.excludeCardId) && (!predicate || predicate(card)));

    const pool = buildPool();
    if (pool.length === 0) {
      const empty = { ok: false, error: '버릴 패가 없습니다.', discarded: 0 };
      if (onDone) onDone(empty);
      return empty;
    }
    const count = Math.max(1, Math.min(opts.count || 1, pool.length));

    const applyDiscard = (cards) => {
      const results = cards.filter(Boolean).map(card => ctx.move.discardCard({
        cardId: card.id, controller, reason, eventData: { tag: TAGS.DISCARD_HAND },
      }));
      const ok = results.length > 0 && results.every(r => r && r.ok !== false);
      dispatchPending(ctx);
      renderAndSync();
      const out = { ok, results, discarded: results.length };
      if (onDone) onDone(out);
      return out;
    };

    // 펭귄 마을 ② 교체: 버릴 카드에 '공개된 펭귄 마을'이 있으면, 마을을 버리는 대신
    // 필드의 펭귄 몬스터를 묘지로 보낼지 묻는다(REPLACEMENT). 처리를 넘겨받으면 true.
    const tryVillageDiscardReplacement = (cards) => {
      const village = cards.find(c => c && c.id === '펭귄 마을' && c.isPublic);
      if (!village) return false;
      const hand = zoneArray(ctx, controller, ZONES.HAND);
      const villageIndex = hand.indexOf(village);
      if (villageIndex < 0) return false;
      const selectedIndices = cards.map(c => hand.indexOf(c)).filter(i => i >= 0);
      const res = handleVillageDiscardReplacement({
        gameState: ctx.gameState,
        controller,
        villageIndex,
        selectedIndices,
        after: () => { dispatchPending(ctx); renderAndSync(); if (onDone) onDone({ ok: true, discarded: cards.length, villageReplacement: true }); },
        onDecline: () => { applyDiscard(cards); },
      });
      return !!(res && (res.handled || res.pending));
    };

    // 사전 선택(ctx.selectedCards)이 충분하면 그대로 사용
    const preSelected = (ctx.selectedCards && ctx.selectedCards.length)
      ? ctx.selectedCards
        .map(sel => (typeof sel === 'number') ? pool[sel] : pool.find(c => getCardId(c) === getCardId(sel)))
        .filter(Boolean)
      : [];
    if (preSelected.length >= count) return applyDiscard(preSelected.slice(0, count));

    // opts.sync: 동기 while 루프(각성의 군단 등)에서 패가 즉시 줄어야 하므로 picker 금지.
    const isLocalHuman = controller === CONTROLLERS.ME && !ctx._hbAutoPick && !ctx.isAI;
    const canPick = !opts.sync && typeof openCardPicker === 'function' && isLocalHuman && pool.length > count;
    if (!canPick) {
      // 로컬 플레이어가 (선택 여지 없이) 공개 펭귄 마을을 버려야 하는 경우에도 ② 교체를 제안한다.
      if (isLocalHuman && !opts.sync && tryVillageDiscardReplacement(pool.slice(0, count)))
        return { ok: true, deferred: true, awaitingSelection: true };
      return applyDiscard(pool.slice(0, count)); // 선택 여지 없음/비-로컬/동기 → 첫 후보
    }

    // 로컬 플레이어 + 실제 선택지 → 비동기 picker (필수 버리기이므로 forced=true)
    // eslint-disable-next-line no-undef
    openCardPicker(pool, title, count, (indices) => {
      const picked = (indices || []).map(i => pool[i]).filter(Boolean);
      const finalPick = picked.length ? picked.slice(0, count) : pool.slice(0, count);
      if (tryVillageDiscardReplacement(finalPick)) return; // 펭귄 마을 ② 교체가 처리
      applyDiscard(finalPick);
    }, true);
    return { ok: true, deferred: true, awaitingSelection: true };
  }

  function discardOneFromHand(ctx, title, options) {
    const opts = options || {};
    return requestHandDiscard(ctx, {
      count: 1,
      excludeCardId: opts.excludeCardId,
      predicate: opts.predicate,
      sync: opts.sync,
      reason: title || 'penguinDiscard',
      title: title || '버릴 패 1장을 선택하세요',
    });
  }

  function returnOwnFieldCardToHand(ctx, cardId, reason) {
    return ctx.move.moveCard({
      cardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.FIELD },
      to: { controller: ctx.controller, zone: ZONES.HAND },
      reason: reason || 'penguinReturnOwnCard',
    });
  }

  function returnFieldCardToHand(ctx, controller, cardId, reason, options) {
    const owner = normalizeController(controller);
    return ctx.move.moveCard({
      cardId,
      controller: owner,
      from: { controller: owner, zone: ZONES.FIELD },
      to: { controller: owner, zone: ZONES.HAND },
      reason: reason || 'penguinReturnFieldCard',
      eventController: owner,
      // "대상으로 하고" 효과의 바운스는 isTargeting을 명시해 비대상 내성(전설 ③ 등)을 통과시킨다.
      isTargeting: !!(options && options.isTargeting),
    });
  }

  function recoverFromGraveOrExileToHand(ctx, predicate, reveal, reason) {
    const grave = zoneArray(ctx, ctx.controller, ZONES.GRAVE).filter(predicate);
    const exile = zoneArray(ctx, ctx.controller, ZONES.EXILE).filter(predicate);
    const target = firstOrSelected(ctx, grave.concat(exile), { byId: true });
    if (!target) return { ok: false, error: '회수할 카드가 없습니다.' };
    const zone = grave.some(card => card && card.id === target.id) ? ZONES.GRAVE : ZONES.EXILE;
    return ctx.move.addToHand({
      cardId: target.id,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone },
      reveal: reveal !== false,
      reason: reason || 'penguinRecover',
    });
  }

  function getContinuousEngine() {
    return global.HB_CONTINUOUS_ENGINE || (global.HB_ENGINE && global.HB_ENGINE.continuous) || null;
  }

  function getMonsterSendToGraveBlock(ctx, target, targetController, reason, action) {
    if (!target) return { blocked: true, reason: 'noTarget', message: '묘지로 보낼 몬스터가 없습니다.' };

    const continuous = getContinuousEngine();
    if (!continuous) return { blocked: false };

    const moveAction = action || 'sendToGrave';
    const checkInput = {
      gameState: ctx && ctx.gameState,
      target,
      card: target,
      monster: target,
      targetController: normalizeController(targetController),
      targetZone: ZONES.FIELD,
      actorController: normalizeController(ctx && ctx.controller),
      controller: normalizeController(ctx && ctx.controller),
      effect: ctx && ctx.effect,
      chainLink: ctx && ctx.chainLink,
      action: moveAction,
      reason: reason || 'penguinSendOpponentMonsterToGrave',
    };

    if (typeof continuous.checkEffectImmunity === 'function') {
      const immunity = continuous.checkEffectImmunity(checkInput);
      if (immunity && immunity.blocked) {
        return { blocked: true, reason: immunity.reason || 'effectImmunity', detail: immunity, message: `${getCardName(target)}는 효과 내성이 있어 처리할 수 없습니다.` };
      }
    }

    if (moveAction === 'sendToGrave' && typeof continuous.checkCannotBeSentToGrave === 'function') {
      const graveBlock = continuous.checkCannotBeSentToGrave(checkInput);
      if (graveBlock && graveBlock.blocked) {
        return { blocked: true, reason: graveBlock.reason || 'cannotBeSentToGrave', detail: graveBlock, message: `${getCardName(target)}는 묘지로 보낼 수 없습니다.` };
      }
    }

    return { blocked: false };
  }

  function getSendableOpponentMonsters(ctx, reason) {
    const opponent = opponentOf(ctx.controller);
    const monsters = zoneArray(ctx, opponent, ZONES.FIELD).filter(card => card && isMonster(card));
    return monsters.filter(card => !getMonsterSendToGraveBlock(ctx, card, opponent, reason).blocked);
  }

  function getAwakenedLegionStopReason(ctx) {
    const handPool = zoneArray(ctx, ctx.controller, ZONES.HAND).filter(Boolean);
    if (!handPool.length) return { code: 'noHandToDiscard', message: '패를 버릴 수 없어 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };

    const opponent = opponentOf(ctx.controller);
    const opponentMonsters = zoneArray(ctx, opponent, ZONES.FIELD).filter(card => card && isMonster(card));
    if (!opponentMonsters.length) return { code: 'noOpponentMonster', message: '상대 필드에 몬스터가 없어 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };

    const sendable = getSendableOpponentMonsters(ctx, 'awakenedPenguinLegion1SendOpponent');
    if (!sendable.length) return { code: 'onlyProtectedOpponentMonsters', message: '상대 필드의 몬스터가 모두 효과 내성이 있거나 묘지로 보낼 수 없어 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };

    // 소환 제한 카드(펭귄 용사 등)는 이 효과로 소생할 수 없으므로 후보에서 제외하고 판정한다.
    const gravePenguins = findZoneCards(ctx, ZONES.GRAVE, c => isPenguinMonster(c) && canSummonWithReason(ctx, c, 'awakenedPenguinLegion1Revive'));
    if (!gravePenguins.length) return { code: 'noGravePenguin', message: '소환할 묘지의 「펭귄」 몬스터가 없어 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };

    if (!hasFieldSpace(ctx)) return { code: 'noFieldSpace', message: '자신 몬스터 존이 가득 차 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };

    return null;
  }

  function askAwakenedLegionRepeat(ctx, repeatNo) {
    if (ctx && Array.isArray(ctx.repeatDecisions) && ctx.repeatDecisions.length) {
      return !!ctx.repeatDecisions.shift();
    }
    if (ctx && typeof ctx.askRepeat === 'function') {
      return ctx.askRepeat({ cardId: '각성의 펭귄 군단', effectNo: 1, repeatNo }) !== false;
    }
    // 현재 체인 엔진은 resolve 결과를 await하지 않으므로 Promise 기반 askPlayer는 사용하지 않는다.
    // 브라우저에서는 동기 confirm으로 반복 여부를 즉시 결정한다.
    if (typeof global.confirm === 'function') {
      return !!global.confirm(`${repeatNo}번째 「각성의 펭귄 군단」 반복 처리를 실행할까요?\n확인: 계속 / 취소: 종료`);
    }

    // 테스트/비브라우저 환경에서는 기존 자동 진행 호환을 유지한다.
    return true;
  }

  function sendOpponentMonsterToGrave(ctx, reason) {
    const opponent = opponentOf(ctx.controller);
    const allMonsters = zoneArray(ctx, opponent, ZONES.FIELD).filter(card => card && isMonster(card));
    if (!allMonsters.length) return { ok: false, error: '상대 필드에 몬스터가 없습니다.', reason: 'noOpponentMonster' };

    const monsters = getSendableOpponentMonsters(ctx, reason);
    if (!monsters.length) {
      return { ok: false, error: '상대 필드의 몬스터가 모두 효과 내성이 있거나 묘지로 보낼 수 없습니다.', reason: 'onlyProtectedOpponentMonsters' };
    }

    const target = firstOrSelected(ctx, monsters, { byId: true });
    if (!target) return { ok: false, error: '묘지로 보낼 수 있는 상대 몬스터가 없습니다.', reason: 'noSendableTarget' };

    const block = getMonsterSendToGraveBlock(ctx, target, opponent, reason);
    if (block.blocked) return { ok: false, error: block.message || '그 몬스터는 묘지로 보낼 수 없습니다.', reason: block.reason, block };

    return ctx.move.sendToGrave({
      cardId: target.id,
      controller: opponent,
      from: { controller: opponent, zone: ZONES.FIELD },
      reason: reason || 'penguinSendOpponentMonsterToGrave',
    });
  }

  function getBanishableOpponentMonsters(ctx, reason) {
    const opponent = opponentOf(ctx.controller);
    const monsters = zoneArray(ctx, opponent, ZONES.FIELD).filter(card => card && isMonster(card));
    return monsters.filter(card => !getMonsterSendToGraveBlock(ctx, card, opponent, reason, 'banish').blocked);
  }

  function banishOpponentMonsters(ctx, count, onDone) {
    const opponent = opponentOf(ctx.controller);
    const candidates = getBanishableOpponentMonsters(ctx, 'penguinWizardBanishOpponentMonster');
    const n = Math.min(Math.max(0, Number(count || 0)), candidates.length);
    if (n <= 0) {
      const empty = { ok: true, results: [], banished: 0 };
      if (onDone) onDone(empty);
      return empty;
    }
    const apply = (cards) => {
      const results = (cards || []).filter(Boolean).map(card => ctx.move.banishCard({
        cardId: card.id,
        controller: opponent,
        from: { controller: opponent, zone: ZONES.FIELD },
        reason: 'penguinWizardBanishOpponentMonster',
      }));
      const out = { ok: results.every(r => r.ok !== false), results, banished: results.filter(r => r.ok !== false).length };
      if (onDone) onDone(out);
      return out;
    };
    let syncResult = null;
    const picked = chooseCards(ctx, candidates, `상대 몬스터 ${n}장 제외`, n, cards => { syncResult = apply(cards); });
    // picker가 열린 경우(picked === null) 결과는 콜백에서 적용된다.
    return syncResult || { ok: true, deferred: true, awaitingSelection: picked === null };
  }

  function putHandCardOnDeck(ctx, cardId, reason) {
    return ctx.move.moveCard({
      cardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.HAND },
      to: { controller: ctx.controller, zone: ZONES.DECK },
      reason: reason || 'penguinReturnToDeck',
    });
  }

  function shuffleDeck(controller) {
    // 기존 프로젝트의 shuffle이 있으면 사용하고, 없으면 순서를 유지한다.
    try {
      const state = getDefaultGameState();
      const owner = normalizeController(controller || CONTROLLERS.ME);
      const deck = zoneAccess.getZoneArray(state, owner, ZONES.DECK);
      // eslint-disable-next-line no-undef
      if (typeof shuffle === 'function') {
        const shuffled = shuffle(deck.slice());
        deck.length = 0;
        deck.push.apply(deck, shuffled);
      }
    } catch (_) {}
  }

  function sourceWasSummonedFrom(event, zone) {
    if (!event) return false;
    const fromZone = (event.from && event.from.zone) || event.sourceZone || (event.eventData && event.eventData.sourceZone);
    return fromZone === zone;
  }

  function cardMatchesEvent(ctx, cardId) {
    return !!(ctx.event && ctx.event.cardId === cardId);
  }

  // "이 카드를 소환했을 경우/묘지로 보내졌을 경우" 류 자기-유발 판정.
  // cardId만 비교하면 상대 필드/묘지의 동명 카드까지 유발 후보가 되므로,
  // 이벤트 당사자(controller)와 이 효과 소스의 controller가 같은지도 확인한다.
  function selfEventMatches(ctx, cardId) {
    if (!cardMatchesEvent(ctx, cardId)) return false;
    const e = ctx.event || {};
    const eventController = e.controller || (e.to && e.to.controller) || null;
    if (!eventController) return true;
    return normalizeControllerSafe(eventController, ctx.controller) === normalizeController(ctx.controller);
  }

  // "이 카드는 ~의 효과로만 소환할 수 있다" 소환 제한(card-move가 reason으로 강제)을
  // 후보 수집 단계에서 미리 적용해, 고를 수 없는 카드가 picker에 뜨지 않게 한다.
  function canSummonWithReason(ctx, cardOrId, reason) {
    const move = global.HB_CARD_MOVE;
    if (!move || typeof move.canSummonWithReason !== 'function') return true;
    return move.canSummonWithReason(ctx && ctx.gameState, getCardId(cardOrId), reason);
  }

  function chainHasOpponentMonsterEffect(ctx) {
    const links = (ctx && ctx.gameState && ctx.gameState.chainLinks)
      || (global.HB_CHAIN_ENGINE && global.HB_CHAIN_ENGINE.getChainLinks && global.HB_CHAIN_ENGINE.getChainLinks())
      || [];
    if (!links.length && global.activeChainState && Array.isArray(global.activeChainState.links)) return global.activeChainState.links.some(l => l && l.by !== global.myRole);
    return links.some(link => {
      if (!link) return false;
      const controller = link.controller || link.by;
      if (controller === ctx.controller || controller === 'me' || controller === global.myRole) return false;
      const card = getCardDef(link.cardId);
      return !card || card.cardType === 'monster';
    });
  }

  function getActiveChainLinks(ctx) {
    return (ctx && ctx.gameState && Array.isArray(ctx.gameState.chainLinks) && ctx.gameState.chainLinks)
      || (global.HB_CHAIN_ENGINE && global.HB_CHAIN_ENGINE.getChainLinks && global.HB_CHAIN_ENGINE.getChainLinks())
      || (global.activeChainState && Array.isArray(global.activeChainState.links) && global.activeChainState.links)
      || [];
  }

  function normalizeControllerSafe(controller, fallback) {
    try {
      return normalizeController(controller);
    } catch (_) {
      if (controller && controller === global.myRole) return CONTROLLERS.ME;
      if (controller && controller === global.opRole) return CONTROLLERS.OPPONENT;
      return fallback || CONTROLLERS.OPPONENT;
    }
  }

  function chainHasOpponentEffect(ctx) {
    const links = getActiveChainLinks(ctx);
    const mine = normalizeControllerSafe(ctx && ctx.controller, CONTROLLERS.ME);
    return links.some(link => {
      if (!link) return false;
      const rawController = link.controller || link.by || link.actorController || link.sourceController;
      const controller = normalizeControllerSafe(rawController, rawController ? CONTROLLERS.OPPONENT : CONTROLLERS.OPPONENT);
      return controller !== mine;
    });
  }

  // "상대가 몬스터 효과를 발동했을 때 … 그 효과를 무효로 한다" — 응답 대상은
  // 체인의 마지막 링크(직전에 발동된 효과)이므로 그 링크만 검사한다.
  function lastChainLinkIsOpponentMonsterEffect(ctx) {
    const links = getActiveChainLinks(ctx);
    if (!links.length) return false;
    const last = links[links.length - 1];
    if (!last) return false;
    const rawController = last.controller || last.by || last.actorController || last.sourceController;
    const controller = normalizeControllerSafe(rawController, CONTROLLERS.OPPONENT);
    if (controller === normalizeControllerSafe(ctx && ctx.controller, CONTROLLERS.ME)) return false;
    const card = getCardDef(last.cardId);
    return !card || card.cardType === 'monster'; // 카드 정보를 모르는 레거시 링크는 몬스터로 간주(호환)
  }

  function getAttackValue(cardOrId) {
    const card = cardOrId && typeof cardOrId === 'object' ? cardOrId : null;
    const def = getCardDef(cardOrId);
    return Number((card && (card.atk ?? card.attack)) ?? (def && (def.atk ?? def.attack)) ?? 0);
  }

  // 발동/유발 효과의 일회성 공격력 버프.
  // card.atk 직접 수정은 지속 효과 재계산(renderAll → applyContinuousEffects)이
  // atk를 atkBase 기준으로 되돌릴 때 증발하므로, 보존 필드에 기록한다.
  // atkBuff = 영구("공격력을 N 올린다"), atkBuffTurn = "턴 종료시까지"(턴 경계에 해제).
  function applyOneShotAtkBuff(card, amount, untilEndOfTurn) {
    if (!card) return { ok: false, error: '버프 대상이 없습니다.' };
    const delta = Number(amount || 0);
    if (!Number.isFinite(delta) || delta === 0) return { ok: true, skipped: true };
    const key = untilEndOfTurn ? 'atkBuffTurn' : 'atkBuff';
    card[key] = Number(card[key] || 0) + delta;
    const def = getCardDef(card.id);
    const base = (typeof card.atkBase === 'number') ? card.atkBase : Number((def && def.atk) || 0);
    const continuous = Number((card._hbContinuous && card._hbContinuous.attackModifier) || 0);
    card.atk = base + Number(card.atkBuff || 0) + Number(card.atkBuffTurn || 0) + continuous;
    return { ok: true, cardId: card.id, atk: card.atk, amount: delta, untilEndOfTurn: !!untilEndOfTurn };
  }

  function increaseOwnPenguinAttack(ctx, amount, reason) {
    const buff = Math.max(0, Number(amount || 0));
    const results = [];
    zoneArray(ctx, ctx.controller, ZONES.FIELD).forEach(card => {
      if (!isPenguinMonster(card)) return;
      const applied = applyOneShotAtkBuff(card, buff, false);
      if (applied.ok && !applied.skipped) results.push({ cardId: card.id, atk: card.atk });
    });
    if (results.length) logSafe(`${reason || '펭귄 효과'}: 펭귄 몬스터 공격력 +${buff}`, 'mine');
    renderAndSync();
    return { ok: true, amount: buff, buffed: results };
  }

  function makeEffect(raw) {
    return Object.assign({
      theme: '펭귄',
      optional: true,
    }, raw);
  }

  const effects = [
    makeEffect({
      id: 'penguin-village-1-reveal',
      cardId: '펭귄 마을',
      effectNo: 1,
      text: '자신 전개 단계에 발동할 수 있다. 이 카드를 공개한다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.HAND,
      oncePerTurn: { key: '펭귄 마을_1', limit: 1 },
      condition(ctx) { return isDeployPhase(ctx) && ctx.card && ctx.card.id === '펭귄 마을' && !ctx.card.isPublic; },
      resolve(ctx) {
        const hand = zoneArray(ctx, ctx.controller, ZONES.HAND);
        const card = hand.find(c => c && c.id === '펭귄 마을' && !c.isPublic);
        if (!card) return { ok: false, error: '공개할 펭귄 마을이 없습니다.' };
        card.isPublic = true;
        logSafe('펭귄 마을 ①: 공개 상태가 되었습니다.', 'mine');
        renderAndSync();
        return { ok: true, revealed: true };
      },
    }),
    makeEffect({
      id: 'penguin-village-2-discard-replacement',
      cardId: '펭귄 마을',
      effectNo: 2,
      text: '이 카드가 공개 상태에서 버려질 경우, 대신 자신 몬스터 존의 펭귄 몬스터 1장을 묘지로 보낼 수 있다.',
      type: EFFECT_TYPES.REPLACEMENT,
      zone: ZONES.HAND,
      tags: ['penguinPublicHand', 'discardReplacement'],
      condition(ctx) {
        return hasPenguinVillageRevealed(ctx) && zoneArray(ctx, ctx.controller, ZONES.FIELD).some(isPenguinMonster);
      },
      resolve(ctx) {
        return handleVillageDiscardReplacement({ gameState: ctx.gameState, controller: ctx.controller, confirmChoice: true, autoPick: true });
      },
    }),

    makeEffect({
      id: 'kkoma-penguin-1-hand-summon',
      cardId: '꼬마 펭귄',
      effectNo: 1,
      text: '자신 전개 단계에 발동할 수 있다. 이 카드를 패에서 소환한다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.HAND,
      tags: [TAGS.HAND_SUMMON, 'penguinHandSummon'],
      oncePerTurn: { key: '꼬마 펭귄_1', limit: 2 },
      condition(ctx) { return isDeployPhase(ctx) && hasFieldSpace(ctx) && !!(ctx.card && ctx.card.id === '꼬마 펭귄'); },
      resolve(ctx) { return ctx.move.summonCard({ cardId: '꼬마 펭귄', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.HAND }, reason: 'kkomaPenguin1' }); },
    }),
    makeEffect({
      id: 'kkoma-penguin-2-on-summon-deck-summon',
      cardId: '꼬마 펭귄',
      effectNo: 2,
      text: '이 카드를 소환했을 경우에 발동할 수 있다. 덱에서 펭귄 몬스터 1장을 소환한다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SUMMON,
      timing: TIMING.ON_SUMMON,
      zone: ZONES.FIELD,
      tags: [TAGS.DECK_SUMMON, 'penguinSummonTrigger'],
      oncePerTurn: { key: '꼬마 펭귄_2', limit: 2 },
      condition(ctx) { return selfEventMatches(ctx, '꼬마 펭귄') && findDeckCards(ctx, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'kkomaPenguin2')).length > 0 && hasFieldSpace(ctx); },
      collectChoices(ctx) {
        return { candidates: findDeckCards(ctx, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'kkomaPenguin2')), title: '덱에서 소환할 펭귄 몬스터 선택', count: 1, emptyMessage: '덱에 펭귄 몬스터가 없습니다.' };
      },
      resolve(ctx) {
        const target = firstOrSelected(ctx, findDeckCards(ctx, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'kkomaPenguin2')), { byId: true });
        return target ? summonFromDeck(ctx, target.id, 'kkomaPenguin2') : { ok: false, error: '덱에 펭귄 몬스터가 없습니다.' };
      },
    }),

    makeEffect({
      id: 'penguin-couple-1-deck-summon-search',
      cardId: '펭귄 부부',
      effectNo: 1,
      text: '이 카드를 덱에서 소환했을 경우에 발동할 수 있다. 덱에서 펭귄 카드를 2장까지 패에 넣고, 그 후 패를 1장 버린다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SUMMON,
      timing: TIMING.ON_SUMMON,
      zone: ZONES.FIELD,
      tags: [TAGS.DECK_SEARCH, TAGS.DISCARD_HAND, 'penguinSummonTrigger'],
      oncePerTurn: { key: '펭귄 부부_1', limit: 1 },
      condition(ctx) { return selfEventMatches(ctx, '펭귄 부부') && sourceWasSummonedFrom(ctx.event, ZONES.DECK) && findDeckCards(ctx, c => isPenguinCard(c.id)).length > 0; },
      collectChoices(ctx) {
        const candidates = findDeckCards(ctx, c => isPenguinCard(c.id));
        return { candidates, title: '펭귄 부부 ①: 덱에서 패에 넣을 펭귄 카드 (최대 2장)', count: Math.min(2, candidates.length), emptyMessage: '덱에 펭귄 카드가 없습니다.' };
      },
      resolve(ctx) {
        const candidates = findDeckCards(ctx, c => isPenguinCard(c.id));
        const selected = (ctx.selectedCards && ctx.selectedCards.length) ? ctx.selectedCards : candidates.slice(0, Math.min(2, candidates.length));
        const chosen = selected.map(s => candidates.find(c => getCardId(c) === getCardId(s))).filter(Boolean);
        const results = chosen.map(card => addDeckCardToHand(ctx, card.id, true));
        const discard = discardOneFromHand(ctx, '펭귄 부부 ①: 패 1장 버리기');
        return { ok: results.every(r => r.ok) && discard.ok, searched: chosen.map(getCardId), discard };
      },
    }),
    makeEffect({
      id: 'penguin-couple-2-hand-draw-return',
      cardId: '펭귄 부부',
      effectNo: 2,
      text: '패의 이 카드를 보여주고 발동할 수 있다. 자신은 2장 드로우한 뒤 패를 1장 고르고 버린다. 그 후 이 카드를 덱으로 되돌린다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.HAND,
      tags: [TAGS.DRAW, TAGS.DISCARD_HAND, 'returnSelfToDeck'],
      // 카드 텍스트는 "1효과는 1턴에 1번"만 제한한다 — ②는 횟수 제한 없음.
      condition(ctx) { return !!(ctx.card && ctx.card.id === '펭귄 부부'); },
      canResolve(ctx) { return canDraw(ctx, 2); },
      resolve(ctx) {
        const draw = drawN(ctx, 2);
        const discard = discardOneFromHand(ctx, '펭귄 부부 ②: 패 1장 버리기', { excludeCardId: '펭귄 부부' });
        const returned = zoneArray(ctx, ctx.controller, ZONES.HAND).some(c => c && c.id === '펭귄 부부')
          ? putHandCardOnDeck(ctx, '펭귄 부부', 'penguinCouple2Return')
          : { ok: true, skipped: true };
        shuffleDeck(ctx.controller);
        return { ok: draw.ok && discard.ok && returned.ok, draw, discard, returned };
      },
    }),

    makeEffect({
      id: 'sage-penguin-1-village-draw-discard',
      cardId: '현자 펭귄',
      effectNo: 1,
      text: '펭귄 마을이 공개 상태로 존재할 경우에 발동할 수 있다. 자신은 1장 드로우한다. 그 후 패를 1장 버린다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.FIELD,
      tags: [TAGS.DRAW, TAGS.DISCARD_HAND],
      oncePerTurn: { key: '현자 펭귄_1', limit: 1 },
      condition(ctx) { return hasPenguinVillageRevealed(ctx); },
      canResolve(ctx) { return canDraw(ctx, 1); },
      resolve(ctx) {
        const draw = drawOne(ctx);
        const discard = discardOneFromHand(ctx, '현자 펭귄 ①: 패 1장 버리기');
        return { ok: draw.ok && discard.ok, draw, discard };
      },
    }),
    makeEffect({
      id: 'sage-penguin-2-deck-search',
      cardId: '현자 펭귄',
      effectNo: 2,
      text: '자신 전개 단계에 발동할 수 있다. 덱에서 펭귄 카드 1장을 패에 넣는다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.FIELD,
      tags: [TAGS.DECK_SEARCH],
      oncePerTurn: { key: '현자 펭귄_2', limit: 1 },
      condition(ctx) { return isDeployPhase(ctx) && findDeckCards(ctx, c => isPenguinCard(c.id)).length > 0; },
      collectChoices(ctx) {
        return { candidates: findDeckCards(ctx, c => isPenguinCard(c.id)), title: '덱에서 패에 넣을 펭귄 카드 선택', count: 1, emptyMessage: '덱에 펭귄 카드가 없습니다.' };
      },
      resolve(ctx) {
        const target = firstOrSelected(ctx, findDeckCards(ctx, c => isPenguinCard(c.id)), { byId: true });
        return target ? addDeckCardToHand(ctx, target.id, true) : { ok: false, error: '덱에 펭귄 카드가 없습니다.' };
      },
    }),

    makeEffect({
      id: 'gatekeeper-penguin-1-village-atk-discard',
      cardId: '수문장 펭귄',
      effectNo: 1,
      text: '펭귄 마을이 공개 상태로 존재할 경우에 발동할 수 있다. 이 카드의 공격력을 1 올린다. 그 후 서로 패를 1장 버린다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.FIELD,
      tags: [TAGS.DISCARD_HAND, 'attackUp'],
      oncePerTurn: { key: '수문장 펭귄_1', limit: 1 },
      condition(ctx) { return hasPenguinVillageRevealed(ctx); },
      canResolve(ctx) { return canGatekeeperOneResolve(ctx); },
      resolve(ctx) {
        const field = zoneArray(ctx, ctx.controller, ZONES.FIELD);
        // 발동한 카피 자신(sourceIndex)을 우선 지정하고, 없으면 첫 동명 카드.
        const self = (typeof ctx.sourceIndex === 'number' && field[ctx.sourceIndex] && field[ctx.sourceIndex].id === '수문장 펭귄')
          ? field[ctx.sourceIndex]
          : field.find(c => c && c.id === '수문장 펭귄');
        // 텍스트에 지속 제한이 없으므로 영구 버프(턴 종료 리셋 없음).
        const buff = self ? applyOneShotAtkBuff(self, 1, false) : { ok: false, error: '필드에 수문장 펭귄이 없습니다.' };
        const mine = discardOneFromHand(ctx, '수문장 펭귄 ①: 자신 패 1장 버리기');
        // 상대 패 조작은 공개 정보가 아닐 수 있으므로 실제 선택은 네트워크/상대 클라이언트가 처리한다.
        try { if (typeof global.sendAction === 'function') global.sendAction({ type: 'forceDiscard', count: 1, reason: '수문장 펭귄 ①' }); } catch (_) {}
        return { ok: mine.ok !== false && buff.ok !== false, atkUp: !!self, buff, discard: mine, opponentDiscardRequested: true };
      },
    }),
    makeEffect({
      id: 'gatekeeper-penguin-2-village-send-opponent',
      cardId: '수문장 펭귄',
      effectNo: 2,
      text: '자신 펭귄 몬스터가 펭귄 마을의 효과로 묘지로 보내졌을 경우 발동할 수 있다. 상대 필드의 몬스터 1장을 묘지로 보낸다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SENT_TO_GRAVE,
      timing: TIMING.ON_SENT_TO_GRAVE,
      zone: ZONES.FIELD,
      tags: ['penguinVillageSentToGrave', 'sendOpponentMonsterToGrave'],
      oncePerTurn: { key: '수문장 펭귄_2', limit: 1 },
      condition(ctx) {
        const e = ctx.event || {};
        return e.controller === ctx.controller && e.reason === 'penguinVillageDiscardReplacement' && isPenguinMonster(e.cardId);
      },
      canResolve(ctx) { return canSendOpponentMonsterToGraveForActivation(ctx, 'gatekeeperPenguin2'); },
      collectChoices(ctx) {
        return { candidates: getSendableOpponentMonsters(ctx, 'gatekeeperPenguin2'), title: '수문장 펭귄 ②: 묘지로 보낼 상대 몬스터 선택', count: 1, emptyMessage: '묘지로 보낼 수 있는 상대 몬스터가 없습니다.' };
      },
      resolve(ctx) { return sendOpponentMonsterToGrave(ctx, 'gatekeeperPenguin2'); },
    }),

    makeEffect({
      id: 'penguin-charge-1-deck-summon',
      cardId: '펭귄!돌격!',
      effectNo: 1,
      text: '자신 전개 단계에 발동할 수 있다. 덱에서 펭귄 몬스터 1장을 소환한다.',
      type: EFFECT_TYPES.ACTIVATION, cardActivationCost: true,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.HAND,
      tags: [TAGS.DECK_SUMMON],
      condition(ctx) { return findDeckCards(ctx, c => isPenguinMonster(c.id)).length > 0 && hasFieldSpace(ctx); },
      collectChoices(ctx) {
        return { candidates: findDeckCards(ctx, c => isPenguinMonster(c.id)), title: '덱에서 소환할 펭귄 몬스터 선택', count: 1, emptyMessage: '덱에 펭귄 몬스터가 없습니다.' };
      },
      resolve(ctx) {
        const target = firstOrSelected(ctx, findDeckCards(ctx, c => isPenguinMonster(c.id)), { byId: true });
        return target ? summonFromDeck(ctx, target.id, 'penguinCharge1') : { ok: false, error: '덱에 펭귄 몬스터가 없습니다.' };
      },
    }),
    makeEffect({
      id: 'penguin-charge-2-grave-banish-hand-summon',
      cardId: '펭귄!돌격!',
      effectNo: 2,
      text: '묘지의 이 카드를 제외하고 발동할 수 있다. 패에서 펭귄 몬스터 1장을 소환한다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.GRAVE,
      tags: [TAGS.COST_BANISH, TAGS.HAND_SUMMON],
      // 펭귄 용사/전설은 "영광의 효과 등으로만 소환" 제한이 있어 후보에서 제외된다.
      condition(ctx) { return findZoneCards(ctx, ZONES.HAND, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinCharge2')).length > 0 && hasFieldSpace(ctx); },
      cost(ctx) { return ctx.move.banishCard({ cardId: '펭귄!돌격!', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'penguinCharge2Cost' }); },
      collectChoices(ctx) {
        return { candidates: findZoneCards(ctx, ZONES.HAND, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinCharge2')), title: '패에서 소환할 펭귄 몬스터 선택', count: 1, emptyMessage: '패에 펭귄 몬스터가 없습니다.' };
      },
      resolve(ctx) {
        const target = firstOrSelected(ctx, findZoneCards(ctx, ZONES.HAND, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinCharge2')), { byId: true });
        return target ? summonFromHandById(ctx, target.id, 'penguinCharge2') : { ok: false, error: '패에 펭귄 몬스터가 없습니다.' };
      },
    }),

    makeEffect({
      id: 'penguin-glory-1-hand-summon-reveal-opponent',
      cardId: '펭귄의 영광',
      effectNo: 1,
      text: '자신/상대 전개 단계에 발동할 수 있다. 패에서 펭귄 용사를 소환하고, 상대 패를 전부 공개한다.',
      type: EFFECT_TYPES.QUICK, cardActivationCost: true,
      timing: TIMING.EITHER_TURN,
      zone: ZONES.HAND,
      tags: [TAGS.HAND_SUMMON, 'revealOpponentHand'],
      condition(ctx) {
        return isDeployPhase(ctx) && hasFieldSpace(ctx)
          && findZoneCards(ctx, ZONES.HAND, c => c.id === '펭귄 용사' || c.id === '펭귄의 전설').length > 0;
      },
      collectChoices(ctx) {
        return { candidates: findZoneCards(ctx, ZONES.HAND, c => c.id === '펭귄 용사' || c.id === '펭귄의 전설'), title: '소환할 카드 선택 (펭귄 용사/전설)', count: 1, emptyMessage: '패에 펭귄 용사/전설이 없습니다.' };
      },
      resolve(ctx) {
        const candidates = findZoneCards(ctx, ZONES.HAND, c => c.id === '펭귄 용사' || c.id === '펭귄의 전설');
        const target = firstOrSelected(ctx, candidates, { byId: true });
        const summon = target ? summonFromHandById(ctx, target.id, 'penguinGlory1') : { ok: false, error: '패에 펭귄 용사/전설이 없습니다.' };
        zoneArray(ctx, opponentOf(ctx.controller), ZONES.HAND).forEach(card => { if (card) card.isPublic = true; });
        try { if (typeof global.sendAction === 'function') global.sendAction({ type: 'revealAllHand' }); } catch (_) {}
        return { ok: summon.ok, summon, revealedOpponentHand: true };
      },
    }),
    makeEffect({
      id: 'penguin-glory-2-grave-banish-draw',
      cardId: '펭귄의 영광',
      effectNo: 2,
      text: '자신 전개 단계에 묘지의 이 카드를 제외하고 발동할 수 있다. 자신은 1장 드로우한다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.GRAVE,
      tags: [TAGS.COST_BANISH, TAGS.DRAW],
      condition(ctx) { return zoneArray(ctx, ctx.controller, ZONES.GRAVE).some(c => c && c.id === '펭귄의 영광'); },
      canResolve(ctx) { return canDraw(ctx, 1); },
      cost(ctx) {
        return ctx.move.banishCard({ cardId: '펭귄의 영광', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'penguinGlory2Cost' });
      },
      resolve(ctx) { return drawOne(ctx); },
    }),

    makeEffect({
      id: 'penguin-hero-procedure-key-fetch',
      cardId: '펭귄 용사',
      effectNo: null,
      text: '상대 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있으며, 펭귄의 영광의 효과나 이 카드의 효과로만 소환할 수 있다.',
      type: EFFECT_TYPES.PROCEDURE,
      tags: ['keyCardFetchCondition', 'summonRestriction'],
      // 텍스트: "'펭귄의 영광'의 효과나 이 카드의 효과로만 소환할 수 있다."
      // 일반/마법/함정은 발동 코스트로 묘지에 간 뒤 효과가 처리되므로,
      // '펭귄이여 영원하라'는 ①(패 발동)·②(묘지 발동) 모두 처리 시점에 묘지/제외 상태
      // = 카드명 '펭귄의 영광' 취급 → 영광의 효과로서 소환이 허용된다.
      summonProcedure: { requiresOpponentMonster: true, allowedSummonReasons: ['penguinGlory1', 'penguinHero1', 'penguinHero3', 'penguinForever1HandSummon', 'penguinForever2'] },
      condition(ctx) { return zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).some(isMonster); },
    }),
    makeEffect({
      id: 'penguin-hero-1-on-summon-search-summon-discard',
      cardId: '펭귄 용사',
      effectNo: 1,
      text: '소환했을 경우 발동할 수 있다. 덱에서 펭귄 카드 1장을 패에 넣고 펭귄 몬스터 1장을 소환한다. 그 후 패를 1장 버린다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SUMMON,
      timing: TIMING.ON_SUMMON,
      zone: ZONES.FIELD,
      tags: [TAGS.DECK_SEARCH, TAGS.DECK_SUMMON, TAGS.DISCARD_HAND],
      oncePerTurn: { key: '펭귄 용사_1', limit: 1 },
      condition(ctx) { return selfEventMatches(ctx, '펭귄 용사'); },
      canResolve(ctx) { return canHeroOneResolve(ctx); },
      resolve(ctx) {
        // 서치 → 소환 → 버리기 3단계 모두 플레이어 선택. 로컬 플레이어는 순차 picker,
        // 비로컬/자동 환경은 첫 후보로 진행한다(chooseCards가 분기).
        const out = { ok: true };
        const pickCtx = Object.assign({}, ctx, { selectedCards: [] });
        const finishWithDiscard = () => {
          out.discard = discardOneFromHand(ctx, '펭귄 용사 ①: 패 1장 버리기');
          dispatchPending(ctx);
          renderAndSync();
          out.ok = (out.search ? out.search.ok !== false : true)
            && (out.summon ? out.summon.ok !== false : true)
            && out.discard.ok !== false;
        };
        const summonStep = () => {
          const candidates = findDeckCards(ctx, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinHero1'));
          if (!candidates.length || !hasFieldSpace(ctx)) {
            out.summon = { ok: true, skipped: true };
            finishWithDiscard();
            return;
          }
          chooseCards(pickCtx, candidates, '펭귄 용사 ①: 덱에서 소환할 펭귄 몬스터 선택', 1, picked => {
            const target = picked && picked[0];
            out.summon = target ? summonFromDeck(ctx, target.id, 'penguinHero1') : { ok: true, skipped: true };
            finishWithDiscard();
          });
        };
        const searchCandidates = findDeckCards(ctx, c => isPenguinCard(c.id));
        if (!searchCandidates.length) {
          out.search = { ok: true, skipped: true };
          summonStep();
          return out;
        }
        chooseCards(pickCtx, searchCandidates, '펭귄 용사 ①: 덱에서 패에 넣을 펭귄 카드 선택', 1, picked => {
          const target = picked && picked[0];
          out.search = target ? addDeckCardToHand(ctx, target.id, true) : { ok: true, skipped: true };
          dispatchPending(ctx);
          renderAndSync();
          summonStep();
        });
        return out;
      },
    }),
    makeEffect({
      id: 'penguin-hero-2-quick-return-recover-magic',
      cardId: '펭귄 용사',
      effectNo: 2,
      text: '상대 턴에 발동할 수 있다. 이 카드를 패로 되돌리고, 묘지나 제외 상태의 펭귄 마법 카드 1장을 패에 넣는다.',
      type: EFFECT_TYPES.QUICK,
      timing: TIMING.OPPONENT_TURN,
      zone: ZONES.FIELD,
      tags: ['returnSelfToHand', 'recoverPenguinMagic'],
      oncePerTurn: { key: '펭귄 용사_2', limit: 1 },
      condition(ctx) { return !isMyTurnFallback(ctx) && findZoneCards(ctx, ZONES.GRAVE, isPenguinMagic).concat(findZoneCards(ctx, ZONES.EXILE, isPenguinMagic)).length > 0; },
      collectChoices(ctx) {
        const candidates = findZoneCards(ctx, ZONES.GRAVE, isPenguinMagic).concat(findZoneCards(ctx, ZONES.EXILE, isPenguinMagic));
        return { candidates, title: '펭귄 용사 ②: 패에 넣을 펭귄 마법 선택', count: 1, emptyMessage: '묘지/제외에 펭귄 마법이 없습니다.' };
      },
      resolve(ctx) {
        const returned = returnOwnFieldCardToHand(ctx, '펭귄 용사', 'penguinHero2Return');
        const recover = recoverFromGraveOrExileToHand(ctx, isPenguinMagic, true, 'penguinHero2Recover');
        return { ok: returned.ok && recover.ok, returned, recover };
      },
    }),
    makeEffect({
      id: 'penguin-hero-3-sent-to-grave-revive-buff',
      cardId: '펭귄 용사',
      effectNo: 3,
      text: '이 카드가 묘지로 보내졌을 경우에 발동할 수 있다. 이 카드를 소환하고, 자신 필드의 모든 펭귄 몬스터의 공격력을 턴 종료시까지 1씩 올린다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SENT_TO_GRAVE,
      timing: TIMING.ON_SENT_TO_GRAVE,
      zone: ZONES.GRAVE,
      tags: [TAGS.GRAVE_SUMMON, 'turnAttackBuff'],
      // 카드 텍스트는 "1,2효과는 각각 1턴에 1번"만 제한한다 — ③은 횟수 제한 없음.
      condition(ctx) { return selfEventMatches(ctx, '펭귄 용사') && hasFieldSpace(ctx); },
      resolve(ctx) {
        const summon = summonFromGraveOrExile(ctx, '펭귄 용사', 'penguinHero3');
        // "턴 종료시까지 1씩 올린다" — 턴 한정 버프(턴 경계에 clearEndOfTurnAtkBuffs가 해제).
        const buffed = [];
        zoneArray(ctx, ctx.controller, ZONES.FIELD).forEach(card => {
          if (!isPenguinMonster(card)) return;
          const applied = applyOneShotAtkBuff(card, 1, true);
          if (applied.ok && !applied.skipped) buffed.push({ cardId: card.id, atk: card.atk });
        });
        renderAndSync();
        return { ok: summon.ok, summon, buffed };
      },
    }),

    makeEffect({
      id: 'penguin-strike-1-negate-monster-effect',
      cardId: '펭귄의 일격',
      effectNo: 1,
      text: '상대가 몬스터 효과를 발동했을 때 자신 필드에 펭귄 몬스터가 존재할 경우, 패를 1장 버리고 발동할 수 있다. 그 효과를 무효로 한다.',
      type: EFFECT_TYPES.QUICK, cardActivationCost: true,
      timing: TIMING.EITHER_TURN,
      zone: ZONES.HAND,
      tags: [TAGS.NEGATE_EFFECT, TAGS.COST_DISCARD],
      condition(ctx) {
        return zoneArray(ctx, ctx.controller, ZONES.FIELD).some(isPenguinMonster)
          && zoneArray(ctx, ctx.controller, ZONES.HAND).filter(c => c && c.id !== '펭귄의 일격').length > 0
          && lastChainLinkIsOpponentMonsterEffect(ctx);
      },
      cost(ctx) {
        return discardOneFromHand(ctx, '펭귄의 일격 ① 코스트: 패 1장 버리기', { excludeCardId: '펭귄의 일격' });
      },
      resolve(ctx) {
        // 체인 링크 객체는 freeze이므로 직접 수정하지 않고, 체인 엔진이
        // negatePreviousLink를 해석해 이 링크가 응답한 직전 링크를 무효 처리한다.
        // negate 알림 액션은 발동자 클라이언트에서만 1회 송신한다(양측 모두 resolve를 실행하므로).
        if (normalizeController(ctx.controller) === CONTROLLERS.ME) {
          try { if (typeof global.sendAction === 'function') global.sendAction({ type: 'negate', reason: '펭귄의 일격' }); } catch (_) {}
        }
        logSafe('펭귄의 일격 ①: 상대 몬스터 효과를 무효로 합니다.', 'mine');
        return { ok: true, negated: true, negatePreviousLink: true, reason: 'penguinStrike1' };
      },
    }),
    makeEffect({
      id: 'penguin-strike-2-village-recover',
      cardId: '펭귄의 일격',
      effectNo: 2,
      text: '펭귄 마을의 효과로 몬스터가 묘지로 보내졌을 경우 발동할 수 있다. 묘지의 이 카드를 패에 넣는다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SENT_TO_GRAVE,
      timing: TIMING.ON_SENT_TO_GRAVE,
      zone: ZONES.GRAVE,
      tags: ['penguinVillageSentToGrave', 'recoverSelf'],
      oncePerTurn: { key: '펭귄의 일격_2', limit: 1 },
      condition(ctx) { return (ctx.event || {}).reason === 'penguinVillageDiscardReplacement' && zoneArray(ctx, ctx.controller, ZONES.GRAVE).some(c => c && c.id === '펭귄의 일격'); },
      resolve(ctx) { return ctx.move.addToHand({ cardId: '펭귄의 일격', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reveal: true, reason: 'penguinStrike2Recover' }); },
    }),

    makeEffect({
      id: 'awakened-penguin-legion-1-repeat-discard-send-revive',
      cardId: '각성의 펭귄 군단',
      effectNo: 1,
      text: '자신/상대 턴에 발동할 수 있다. 자신 패를 1장 버리고 상대 필드의 몬스터 1장을 묘지로 보낸 뒤, 묘지의 펭귄 몬스터 1장을 소환하는 처리를 원하는 만큼 반복한다.',
      type: EFFECT_TYPES.QUICK, cardActivationCost: true,
      timing: TIMING.EITHER_TURN,
      zone: ZONES.HAND,
      tags: [TAGS.DISCARD_HAND, 'sendOpponentMonsterToGrave', TAGS.GRAVE_SUMMON, 'repeatable'],
      condition(ctx) {
        return getAwakenedLegionStopReason(ctx) === null;
      },
      resolve(ctx) {
        const results = [];
        let guard = 0;
        let stopReason = null;
        while (guard < 20) {
          const impossible = getAwakenedLegionStopReason(ctx);
          if (impossible) {
            stopReason = impossible;
            notifySafe(impossible.message);
            break;
          }

          const nextNo = guard + 1;
          if (!askAwakenedLegionRepeat(ctx, nextNo)) {
            stopReason = { code: 'playerCancelled', message: '플레이어가 취소하여 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };
            notifySafe(stopReason.message);
            break;
          }

          guard = nextNo;
          // 동기 while 루프 — 패가 즉시 줄어야 정상 종료되므로 sync 강제(선택 picker는 후속 과제).
          const discarded = discardOneFromHand(ctx, `각성의 펭귄 군단 ① 반복 ${guard}: 패 1장 버리기`, { sync: true });
          if (!discarded.ok) {
            stopReason = { code: 'discardFailed', message: discarded.error || '패를 버릴 수 없어 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };
            notifySafe(stopReason.message);
            results.push({ ok: false, step: 'discard', discarded });
            break;
          }

          const sent = sendOpponentMonsterToGrave(ctx, 'awakenedPenguinLegion1SendOpponent');
          if (!sent.ok) {
            stopReason = { code: sent.reason || 'sendOpponentMonsterFailed', message: sent.error || '상대 몬스터를 묘지로 보낼 수 없어 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };
            notifySafe(stopReason.message);
            results.push({ ok: false, step: 'sendOpponentMonster', discarded, sent });
            break;
          }

          const target = firstOrSelected(ctx, findZoneCards(ctx, ZONES.GRAVE, c => isPenguinMonster(c) && canSummonWithReason(ctx, c, 'awakenedPenguinLegion1Revive')), { byId: true });
          const summon = target ? summonFromGraveOrExile(ctx, target.id, 'awakenedPenguinLegion1Revive') : { ok: false, error: '묘지에 펭귄 몬스터가 없습니다.' };
          results.push({ ok: !!summon.ok, discarded, sent, summon, revivedCardId: target && target.id });
          if (!summon.ok) {
            stopReason = { code: 'summonFailed', message: summon.error || '묘지의 「펭귄」 몬스터를 소환할 수 없어 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };
            notifySafe(stopReason.message);
            break;
          }
        }

        if (guard >= 20 && !stopReason) {
          stopReason = { code: 'safetyLimit', message: '안전 제한에 도달해 「각성의 펭귄 군단」 반복 처리를 종료합니다.' };
          notifySafe(stopReason.message);
        }

        return {
          ok: results.every(r => r.ok),
          repeatCount: results.length,
          stopped: !!stopReason,
          stopReason,
          results,
        };
      },
    }),
    makeEffect({
      id: 'awakened-penguin-legion-2-village-recover',
      cardId: '각성의 펭귄 군단',
      effectNo: 2,
      text: '자신 필드의 펭귄 몬스터가 펭귄 마을의 효과로 묘지로 보내졌을 경우 발동할 수 있다. 묘지의 이 카드를 패에 넣는다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SENT_TO_GRAVE,
      timing: TIMING.ON_SENT_TO_GRAVE,
      zone: ZONES.GRAVE,
      tags: ['penguinVillageSentToGrave', 'recoverSelf'],
      oncePerTurn: { key: '각성의 펭귄 군단_2', limit: 1 },
      condition(ctx) {
        const e = ctx.event || {};
        return e.controller === ctx.controller
          && e.reason === 'penguinVillageDiscardReplacement'
          && isPenguinMonster(e.cardId)
          && zoneArray(ctx, ctx.controller, ZONES.GRAVE).some(c => c && c.id === '각성의 펭귄 군단');
      },
      resolve(ctx) {
        return ctx.move.addToHand({
          cardId: '각성의 펭귄 군단',
          controller: ctx.controller,
          from: { controller: ctx.controller, zone: ZONES.GRAVE },
          reveal: true,
          reason: 'awakenedPenguinLegion2Recover',
        });
      },
    }),
    makeEffect({
      id: 'peaceful-penguin-1-chain-response-attack-buff',
      cardId: '평화의 펭귄',
      effectNo: 1,
      text: '상대가 효과를 발동했을 때 상대 필드의 몬스터 1장을 대상으로 발동할 수 있다. 자신 필드의 펭귄 몬스터 공격력을 각각 그 몬스터의 공격력 절반만큼 올린다.',
      type: EFFECT_TYPES.QUICK, cardActivationCost: true,
      timing: TIMING.EITHER_TURN,
      zone: ZONES.HAND,
      tags: ['chainResponse', 'attackUp'],
      oncePerTurn: { key: '평화의 펭귄_1', limit: 1 },
      condition(ctx) {
        return chainHasOpponentEffect(ctx)
          && zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).some(isMonster)
          && zoneArray(ctx, ctx.controller, ZONES.FIELD).some(isPenguinMonster);
      },
      collectChoices(ctx) {
        const opponentMonsters = zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(isMonster);
        return { candidates: opponentMonsters, title: '대상 상대 몬스터 선택', count: 1, emptyMessage: '상대 필드에 몬스터가 없습니다.' };
      },
      target(ctx) {
        const opponentMonsters = zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(isMonster);
        const target = firstOrSelected(ctx, opponentMonsters, { byId: true });
        if (target && ctx.addTarget) ctx.addTarget(target);
        return target ? { ok: true, targets: [target] } : { ok: false, error: '상대 필드에 몬스터가 없습니다.' };
      },
      resolve(ctx) {
        const opponentMonsters = zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(isMonster);
        const target = (ctx.targets && ctx.targets[0]) || firstOrSelected(ctx, opponentMonsters, { byId: true });
        if (!target) return { ok: false, error: '대상 몬스터가 없습니다.' };
        const amount = Math.ceil(getAttackValue(target) / 2);
        const buff = increaseOwnPenguinAttack(ctx, amount, '평화의 펭귄 ①');
        return Object.assign({ targetCardId: target.id, targetAttack: getAttackValue(target) }, buff);
      },
    }),
    makeEffect({
      id: 'peaceful-penguin-2-grave-banish-search-village',
      cardId: '평화의 펭귄',
      effectNo: 2,
      text: '묘지의 이 카드를 제외하고 발동할 수 있다. 덱에서 펭귄 마을 1장을 패에 넣는다. 그 후 패를 1장 버린다.',
      type: EFFECT_TYPES.QUICK,
      timing: TIMING.EITHER_TURN,
      zone: ZONES.GRAVE,
      tags: [TAGS.COST_BANISH, TAGS.DECK_SEARCH, TAGS.DISCARD_HAND],
      oncePerTurn: { key: '평화의 펭귄_2', limit: 1 },
      condition(ctx) { return findDeckCards(ctx, c => c.id === '펭귄 마을').length > 0; },
      cost(ctx) { return ctx.move.banishCard({ cardId: '평화의 펭귄', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'peacefulPenguin2Cost' }); },
      resolve(ctx) {
        const search = addDeckCardToHand(ctx, '펭귄 마을', true);
        const discard = discardOneFromHand(ctx, '평화의 펭귄 ②: 패 1장 버리기');
        return { ok: search.ok && discard.ok, search, discard };
      },
    }),

    makeEffect({
      id: 'penguin-forever-1-bounce-fields-hand-summon',
      cardId: '펭귄이여 영원하라',
      effectNo: 1,
      text: '서로의 필드의 카드를 1장씩 대상으로 하고 발동할 수 있다. 그 카드를 패로 되돌린다. 그 후, 패에서 펭귄 몬스터 1장을 소환할 수 있다.',
      type: EFFECT_TYPES.QUICK, cardActivationCost: true,
      timing: TIMING.EITHER_TURN,
      zone: ZONES.HAND,
      tags: ['bounceFieldCards', TAGS.HAND_SUMMON],
      oncePerTurn: { key: '펭귄이여 영원하라_1', limit: 1 },
      condition(ctx) { return zoneArray(ctx, ctx.controller, ZONES.FIELD).length > 0 && zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).length > 0; },
      resolve(ctx) {
        // 자신/상대 필드 카드 1장씩 대상 바운스(대상 지정) → 그 후 임의로 패의 펭귄 1장 소환.
        // 로컬 플레이어는 순차 picker + 소환 여부 확인, 비로컬/자동 환경은 첫 후보·자동 소환.
        const out = { ok: true, results: [] };
        const pickCtx = Object.assign({}, ctx, { selectedCards: [] });
        const optionalSummonStep = () => {
          const candidates = findZoneCards(ctx, ZONES.HAND, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinForever1HandSummon'));
          if (!candidates.length || !hasFieldSpace(ctx)) { renderAndSync(); return; }
          const doSummon = () => {
            chooseCards(pickCtx, candidates, '펭귄이여 영원하라 ①: 패에서 소환할 펭귄 몬스터 선택 (임의)', 1, picked => {
              const target = picked && picked[0];
              if (target) out.results.push(summonFromHandById(ctx, target.id, 'penguinForever1HandSummon'));
              dispatchPending(ctx);
              renderAndSync();
            });
          };
          // "소환할 수 있다" — 임의 효과이므로 로컬 플레이어에게 의사를 묻는다.
          if (typeof ctx.askPlayer === 'function' && normalizeController(ctx.controller) === CONTROLLERS.ME && !ctx._hbAutoPick && !ctx.isAI) {
            ctx.askPlayer('펭귄이여 영원하라 ①\n패에서 펭귄 몬스터 1장을 소환하시겠습니까? (임의)', yes => { if (yes) doSummon(); else renderAndSync(); });
          } else {
            doSummon();
          }
        };
        const bounceOpponentStep = () => {
          const opCards = zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(Boolean);
          chooseCards(pickCtx, opCards, '펭귄이여 영원하라 ①: 패로 되돌릴 상대 필드 카드 선택', 1, picked => {
            const target = picked && picked[0];
            if (target) out.results.push(returnFieldCardToHand(ctx, opponentOf(ctx.controller), target.id, 'penguinForever1ReturnOpponent', { isTargeting: true }));
            dispatchPending(ctx);
            renderAndSync();
            optionalSummonStep();
          });
        };
        const myCards = zoneArray(ctx, ctx.controller, ZONES.FIELD).filter(Boolean);
        chooseCards(pickCtx, myCards, '펭귄이여 영원하라 ①: 패로 되돌릴 자신 필드 카드 선택', 1, picked => {
          const target = picked && picked[0];
          if (target) out.results.push(returnFieldCardToHand(ctx, ctx.controller, target.id, 'penguinForever1ReturnMine', { isTargeting: true }));
          bounceOpponentStep();
        });
        return out;
      },
    }),
    makeEffect({
      id: 'penguin-forever-2-grave-banish-hand-summon',
      cardId: '펭귄이여 영원하라',
      effectNo: 2,
      text: '상대 턴에, 묘지의 이 카드를 제외하고 발동할 수 있다. 패에서 펭귄 몬스터 1장을 소환한다.',
      type: EFFECT_TYPES.QUICK,
      timing: TIMING.OPPONENT_TURN,
      zone: ZONES.GRAVE,
      tags: [TAGS.COST_BANISH, TAGS.HAND_SUMMON],
      // 이 카드는 묘지/제외 상태에서 카드명이 '펭귄의 영광' 취급이므로,
      // ②(묘지에서 발동)는 영광의 효과로서 펭귄 용사/전설도 소환할 수 있다(허용 목록에 포함).
      condition(ctx) { return !isMyTurnFallback(ctx) && hasFieldSpace(ctx) && findZoneCards(ctx, ZONES.HAND, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinForever2')).length > 0; },
      cost(ctx) { return ctx.move.banishCard({ cardId: '펭귄이여 영원하라', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'penguinForever2Cost' }); },
      collectChoices(ctx) {
        return { candidates: findZoneCards(ctx, ZONES.HAND, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinForever2')), title: '패에서 소환할 펭귄 몬스터 선택', count: 1, emptyMessage: '패에 펭귄 몬스터가 없습니다.' };
      },
      resolve(ctx) {
        const target = firstOrSelected(ctx, findZoneCards(ctx, ZONES.HAND, c => isPenguinMonster(c.id) && canSummonWithReason(ctx, c, 'penguinForever2')), { byId: true });
        return target ? summonFromHandById(ctx, target.id, 'penguinForever2') : { ok: false, error: '패에 펭귄 몬스터가 없습니다.' };
      },
    }),

    makeEffect({
      id: 'penguin-legend-procedure-key-fetch',
      cardId: '펭귄의 전설',
      text: '자신 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있고, 패에서 카드명을 펭귄 용사로 취급하며, 펭귄의 영광의 효과로만 소환할 수 있다.',
      type: EFFECT_TYPES.PROCEDURE,
      tags: ['keyCardFetchCondition', 'summonRestriction'],
      // "'펭귄의 영광'의 효과로만 소환" — 영원하라 ①/②는 처리 시점에 묘지/제외 상태
      // = 카드명 '펭귄의 영광' 취급이므로 허용된다.
      summonProcedure: { requiresOwnMonster: true, treatedAsInHand: '펭귄 용사', allowedSummonReasons: ['penguinGlory1', 'penguinForever1HandSummon', 'penguinForever2'] },
      condition(ctx) { return zoneArray(ctx, ctx.controller, ZONES.FIELD).some(isMonster); },
    }),
    makeEffect({
      id: 'penguin-legend-1-on-summon-revive-kkoma',
      cardId: '펭귄의 전설',
      effectNo: 1,
      text: '이 카드를 소환했을 경우에 발동할 수 있다. 묘지에서 꼬마 펭귄을 2장까지 소환한다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SUMMON,
      timing: TIMING.ON_SUMMON,
      zone: ZONES.FIELD,
      tags: [TAGS.GRAVE_SUMMON],
      oncePerTurn: { key: '펭귄의 전설_1', limit: 1 },
      condition(ctx) { return selfEventMatches(ctx, '펭귄의 전설') && findZoneCards(ctx, ZONES.GRAVE, c => c.id === '꼬마 펭귄').length > 0 && hasFieldSpace(ctx); },
      resolve(ctx) {
        const count = Math.min(2, findZoneCards(ctx, ZONES.GRAVE, c => c.id === '꼬마 펭귄').length);
        const results = [];
        for (let i = 0; i < count && hasFieldSpace(ctx); i += 1) results.push(summonFromGraveOrExile(ctx, '꼬마 펭귄', 'penguinLegend1'));
        return { ok: results.every(r => r.ok), results };
      },
    }),
    makeEffect({
      id: 'penguin-legend-2-quick-return-revive-monster',
      cardId: '펭귄의 전설',
      effectNo: 2,
      text: '상대 턴에 발동할 수 있다. 이 카드를 패로 되돌리고, 묘지나 제외 상태의 펭귄 몬스터 1장을 소환한다.',
      type: EFFECT_TYPES.QUICK,
      timing: TIMING.OPPONENT_TURN,
      zone: ZONES.FIELD,
      tags: ['returnSelfToHand', TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON],
      oncePerTurn: { key: '펭귄의 전설_2', limit: 1 },
      // 소환 제한 카드(펭귄 용사 등)는 이 효과로 소생할 수 없으므로 후보에서 제외한다.
      condition(ctx) { return !isMyTurnFallback(ctx) && hasFieldSpace(ctx) && findZoneCards(ctx, ZONES.GRAVE, c => isPenguinMonster(c) && canSummonWithReason(ctx, c, 'penguinLegend2Summon')).concat(findZoneCards(ctx, ZONES.EXILE, c => isPenguinMonster(c) && canSummonWithReason(ctx, c, 'penguinLegend2Summon'))).length > 0; },
      collectChoices(ctx) {
        const eligible = c => isPenguinMonster(c) && canSummonWithReason(ctx, c, 'penguinLegend2Summon');
        return { candidates: findZoneCards(ctx, ZONES.GRAVE, eligible).concat(findZoneCards(ctx, ZONES.EXILE, eligible)), title: '묘지/제외의 펭귄 몬스터 1장 선택 (소환)', count: 1, emptyMessage: '묘지/제외에 펭귄 몬스터가 없습니다.' };
      },
      resolve(ctx) {
        const returned = returnOwnFieldCardToHand(ctx, '펭귄의 전설', 'penguinLegend2Return');
        const eligible = c => isPenguinMonster(c) && canSummonWithReason(ctx, c, 'penguinLegend2Summon');
        const target = firstOrSelected(ctx, findZoneCards(ctx, ZONES.GRAVE, eligible).concat(findZoneCards(ctx, ZONES.EXILE, eligible)), { byId: true });
        const summon = target ? summonFromGraveOrExile(ctx, target.id, 'penguinLegend2Summon') : { ok: false, error: '묘지/제외에 펭귄 몬스터가 없습니다.' };
        return { ok: returned.ok && summon.ok, returned, summon };
      },
    }),
    makeEffect({
      id: 'penguin-legend-3-non-target-immunity',
      cardId: '펭귄의 전설',
      effectNo: 3,
      text: '이 카드는 이 카드를 대상으로 하지 않는 상대 카드의 효과를 받지 않는다.',
      type: EFFECT_TYPES.CONTINUOUS,
      zone: ZONES.FIELD,
      tags: ['effectImmunity', 'nonTargetImmunity'],
      continuousRule: {
        effectImmunity(checkCtx, sourceCtx) {
          const target = checkCtx.target || checkCtx.card;
          if (getCardId(target) !== '펭귄의 전설') return false;
          if (normalizeController(checkCtx.targetController || sourceCtx.controller) !== normalizeController(sourceCtx.controller)) return false;
          if (normalizeController(checkCtx.actorController || sourceCtx.opponent) === normalizeController(sourceCtx.controller)) return false;
          return checkCtx.isTargeting !== true && checkCtx.targeting !== true && checkCtx.targeted !== true;
        },
      },
    }),

    makeEffect({
      id: 'penguin-wizard-1-reveal-search-return',
      cardId: '펭귄 마법사',
      effectNo: 1,
      text: '일반 패인 이 카드를 보여주고 발동할 수 있다. 덱에서 펭귄 카드 1장을 패에 넣는다. 그 후, 이 카드를 덱으로 되돌린다.',
      type: EFFECT_TYPES.ACTIVATION,
      timing: TIMING.MY_DEPLOY,
      zone: ZONES.HAND,
      tags: [TAGS.DECK_SEARCH, 'returnSelfToDeck'],
      oncePerTurn: { key: '펭귄 마법사_1', limit: 2 },
      condition(ctx) { return ctx.card && ctx.card.id === '펭귄 마법사' && !ctx.card.isPublic && findDeckCards(ctx, c => isPenguinCard(c.id)).length > 0; },
      collectChoices(ctx) {
        return { candidates: findDeckCards(ctx, c => isPenguinCard(c.id)), title: '덱에서 패에 넣을 펭귄 카드 선택', count: 1, emptyMessage: '덱에 펭귄 카드가 없습니다.' };
      },
      resolve(ctx) {
        const target = firstOrSelected(ctx, findDeckCards(ctx, c => isPenguinCard(c.id)), { byId: true });
        const search = target ? addDeckCardToHand(ctx, target.id, true) : { ok: false, error: '덱에 펭귄 카드가 없습니다.' };
        const returned = putHandCardOnDeck(ctx, '펭귄 마법사', 'penguinWizard1Return');
        shuffleDeck(ctx.controller);
        return { ok: search.ok && returned.ok, search, returned };
      },
    }),
    makeEffect({
      id: 'penguin-wizard-2-on-summon-discard-banish',
      cardId: '펭귄 마법사',
      effectNo: 2,
      text: '이 카드를 소환했을 경우에 발동할 수 있다. 패를 3장까지 버리고, 그 수까지 상대 필드의 몬스터를 제외한다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SUMMON,
      timing: TIMING.ON_SUMMON,
      zone: ZONES.FIELD,
      tags: [TAGS.DISCARD_HAND, 'banishOpponentMonster'],
      oncePerTurn: { key: '펭귄 마법사_2', limit: 2 },
      condition(ctx) { return selfEventMatches(ctx, '펭귄 마법사') && zoneArray(ctx, opponentOf(ctx.controller), ZONES.FIELD).some(isMonster) && zoneArray(ctx, ctx.controller, ZONES.HAND).length > 0; },
      resolve(ctx) {
        // "패를 3장까지 버리고, 그 수까지 상대 필드의 몬스터를 제외한다"
        // — picker는 최대 3장에서 더 적게 골라도 되며(=까지), 제외는 실제 버린 수에 연동해
        //   버리기 완료 콜백에서 처리한다(텍스트 순서: 버리기 → 제외).
        const maxDiscard = Math.min(3, zoneArray(ctx, ctx.controller, ZONES.HAND).length);
        if (maxDiscard <= 0) return { ok: false, error: '버릴 패가 없습니다.' };
        const out = { ok: true };
        out.discard = requestHandDiscard(ctx, {
          count: maxDiscard,
          reason: '펭귄 마법사 ②: 패 버리기',
          title: '펭귄 마법사 ②: 버릴 패 선택 (최대 3장, 버린 수까지 상대 몬스터 제외)',
        }, res => {
          const discarded = (res && res.discarded) || 0;
          out.banish = banishOpponentMonsters(ctx, discarded, () => {
            dispatchPending(ctx);
            renderAndSync();
          });
        });
        return out;
      },
    }),
    makeEffect({
      id: 'penguin-wizard-3-village-revive-exiled-monster',
      cardId: '펭귄 마법사',
      effectNo: 3,
      text: '펭귄 마을의 효과로 몬스터가 묘지로 보내졌을 경우 발동할 수 있다. 자신/상대의 제외 상태의 몬스터 1장을 골라 소환한다.',
      type: EFFECT_TYPES.TRIGGER,
      event: EVENTS.SENT_TO_GRAVE,
      timing: TIMING.ON_SENT_TO_GRAVE,
      zone: ZONES.FIELD,
      tags: [TAGS.EXILE_SUMMON, 'penguinVillageSentToGrave'],
      oncePerTurn: { key: '펭귄 마법사_3', limit: 2 },
      condition(ctx) {
        const e = ctx.event || {};
        const eligible = c => isMonster(c) && canSummonWithReason(ctx, c, 'penguinWizard3ExileSummon');
        const myTargets = findZoneCards(ctx, ZONES.EXILE, eligible, ctx.controller);
        const opTargets = findZoneCards(ctx, ZONES.EXILE, eligible, opponentOf(ctx.controller));
        return e.reason === 'penguinVillageDiscardReplacement' && hasFieldSpace(ctx) && myTargets.concat(opTargets).length > 0;
      },
      collectChoices(ctx) {
        const eligible = c => isMonster(c) && canSummonWithReason(ctx, c, 'penguinWizard3ExileSummon');
        const myTargets = findZoneCards(ctx, ZONES.EXILE, eligible, ctx.controller).map(card => Object.assign({ _owner: ctx.controller }, card));
        const opTargets = findZoneCards(ctx, ZONES.EXILE, eligible, opponentOf(ctx.controller)).map(card => Object.assign({ _owner: opponentOf(ctx.controller) }, card));
        return { candidates: myTargets.concat(opTargets), title: '제외 상태의 몬스터 1장 선택 (소환)', count: 1, emptyMessage: '제외 상태의 몬스터가 없습니다.' };
      },
      resolve(ctx) {
        const eligible = c => isMonster(c) && canSummonWithReason(ctx, c, 'penguinWizard3ExileSummon');
        const myTargets = findZoneCards(ctx, ZONES.EXILE, eligible, ctx.controller).map(card => Object.assign({ _owner: ctx.controller }, card));
        const opTargets = findZoneCards(ctx, ZONES.EXILE, eligible, opponentOf(ctx.controller)).map(card => Object.assign({ _owner: opponentOf(ctx.controller) }, card));
        const target = firstOrSelected(ctx, myTargets.concat(opTargets), { byId: true });
        if (!target) return { ok: false, error: '제외 상태의 몬스터가 없습니다.' };
        return ctx.move.summonCard({
          cardId: target.id,
          controller: ctx.controller,
          from: { controller: target._owner || ctx.controller, zone: ZONES.EXILE },
          reason: 'penguinWizard3ExileSummon',
          eventData: { sourceZone: ZONES.EXILE, summonType: 'effect', originalController: target._owner || ctx.controller },
        });
      },
    }),
  ];

  function handleVillageDiscardReplacement(options) {
    const opts = options || {};
    const state = opts.gameState || getDefaultGameState();
    const controller = normalizeController(opts.controller || CONTROLLERS.ME);
    const fieldPenguins = zoneAccess.getZoneArray(state, controller, ZONES.FIELD).filter(isPenguinMonster);
    const hand = zoneAccess.getZoneArray(state, controller, ZONES.HAND);
    const villageIndex = typeof opts.villageIndex === 'number'
      ? opts.villageIndex
      : hand.findIndex(card => card && card.id === '펭귄 마을' && card.isPublic);

    if (villageIndex < 0 || !hand[villageIndex] || hand[villageIndex].id !== '펭귄 마을' || !hand[villageIndex].isPublic || fieldPenguins.length === 0) {
      return { ok: false, handled: false, reason: 'replacementUnavailable' };
    }

    const proceed = opts.confirmChoice === true || opts.autoPick === true;
    const run = (chosenTarget) => {
      const target = chosenTarget || opts.targetCard || fieldPenguins[0];
      if (!target) return { ok: false, handled: false, reason: 'noPenguinMonster' };
      const ctx = global.HB_EFFECT_CONTEXT && global.HB_EFFECT_CONTEXT.createEffectContext({ gameState: state, controller, cardId: '펭귄 마을', effect: registry.getEffectById('penguin-village-2-discard-replacement') });
      const result = ctx
        ? ctx.move.sendToGrave({ cardId: target.id, controller, from: { controller, zone: ZONES.FIELD }, reason: 'penguinVillageDiscardReplacement' })
        : { ok: false, error: 'HB_EFFECT_CONTEXT가 없습니다.' };
      if (!result.ok) return Object.assign({ handled: false }, result);

      const selectedIndices = Array.isArray(opts.selectedIndices) ? opts.selectedIndices.slice().sort((a, b) => b - a) : [];
      selectedIndices.forEach(index => {
        if (index === villageIndex) return;
        if (hand[index]) {
          ctx.move.discardCard({
            cardId: getCardId(hand[index]),
            controller,
            from: { controller, zone: ZONES.HAND, index },
            reason: 'penguinVillageDiscardReplacementExtra',
          });
        }
      });

      if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') global.HB_EVENTS.dispatchEvents(state);
      if (typeof opts.after === 'function') opts.after(result);
      logSafe(`펭귄 마을 ②: ${getCardName(target)}을 대신 묘지로 보냈습니다.`, 'mine');
      renderAndSync();
      return { ok: true, handled: true, replacement: result, targetCardId: target.id };
    };

    // "대신 자신 몬스터 존의 '펭귄'몬스터 1장을" — 보낼 펭귄은 플레이어가 고른다.
    // targetCard가 이미 지정됐거나(전투 피해 경로), autoPick/비로컬/후보 1장이면 자동 진행.
    const pickTargetAndRun = () => {
      const canPick = !opts.targetCard
        && opts.autoPick !== true
        && controller === CONTROLLERS.ME
        && fieldPenguins.length > 1
        && typeof global.openCardPicker === 'function';
      if (!canPick) return run(null);
      global.openCardPicker(fieldPenguins, '펭귄 마을 ②: 대신 묘지로 보낼 펭귄 몬스터 선택', 1, sel => {
        const mon = (sel && sel.length) ? fieldPenguins[sel[0]] : fieldPenguins[0];
        run(mon);
      }, true);
      return { ok: true, handled: true, pending: true };
    };

    if (proceed) return pickTargetAndRun();

    // eslint-disable-next-line no-undef
    if (typeof gameConfirm === 'function') {
      // eslint-disable-next-line no-undef
      gameConfirm('펭귄 마을 ②\n버리는 대신 필드의 펭귄 몬스터를 묘지로 보냅니까?', yes => {
        if (yes) pickTargetAndRun();
        else if (typeof opts.onDecline === 'function') opts.onDecline();
      });
      return { ok: true, handled: true, pending: true };
    }

    return { ok: true, handled: false, reason: 'notConfirmed' };
  }

  const registered = registry.registerEffects(effects);
  registry.syncEffectIdsToCards();

  function getPenguinEffectIds() {
    return effects.map(effect => effect.id);
  }

  function getPenguinCards() {
    const cards = getCardDatabase() || {};
    return Object.keys(cards).filter(id => cards[id] && cards[id].theme === '펭귄');
  }

  global.HB_PENGUIN_EFFECTS = Object.freeze({
    effects: registered,
    getPenguinEffectIds,
    getPenguinCards,
    isPenguinCard,
    isPenguinMonster,
    isPenguinMagic,
    hasPenguinVillageRevealed,
    handleVillageDiscardReplacement,
    dispatchPending,
    requestHandDiscard,
  });
})(window);
