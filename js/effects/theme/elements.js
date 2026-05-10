// HAND BATTLE — Theme Effects: Elements
// 16-3단계: 엘리멘츠 테마를 EffectDefinition 기반으로 이식한다.
// 핵심 원칙:
// - 정령/궁극신/궁극 창조신의 자체 소환은 체인에 올라가지 않는 procedure다.
// - 카운터는 카드 객체의 counters 맵에 저장하고, 변경 후 권위 상태 동기화를 요청한다.
// - 서치/소환/카운터 배치가 실제로 불가능하면 canResolve에서 발동 자체를 막는다.
(function initElementsEffectDefinitions(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({ ACTIVATION: 'activation', QUICK: 'quick', TRIGGER: 'trigger', CONTINUOUS: 'continuous', PROCEDURE: 'procedure', REPLACEMENT: 'replacement' });
  const ZONES = rules.ZONES || Object.freeze({ DECK: 'deck', HAND: 'hand', PUBLIC_HAND: 'publicHand', FIELD: 'field', FIELD_ZONE: 'fieldZone', GRAVE: 'grave', EXILE: 'exile', KEY_DECK: 'keyDeck' });
  const EVENTS = rules.EVENTS || Object.freeze({ SUMMON: 'summon', SENT_TO_GRAVE: 'sentToGrave', EXILED: 'exiled', ADDED_TO_HAND: 'addedToHand' });
  const TIMING = rules.TIMING || Object.freeze({ MY_DEPLOY: 'myDeploy', OPPONENT_TURN: 'opponentTurn', EITHER_TURN: 'eitherTurn', ON_SUMMON: 'onSummon', ON_SENT_TO_GRAVE: 'onSentToGrave', NONE: 'none' });
  const TAGS = rules.EFFECT_TAGS || Object.freeze({ DECK_SEARCH: 'deckSearch', DECK_SUMMON: 'deckSummon', HAND_SUMMON: 'handSummon', GRAVE_SUMMON: 'graveSummon', EXILE_SUMMON: 'exileSummon', DRAW: 'draw', DISCARD_HAND: 'discardHand', NEGATE_EFFECT: 'negateEffect', COST_BANISH: 'costBanish', COST_SEND_TO_GRAVE: 'costSendToGrave', FIELD_CARD_ACTIVATION: 'fieldCardActivation', FIELD_ZONE_EFFECT: 'fieldZoneEffect' });

  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry) throw new Error('[elements-effects] HB_EFFECT_REGISTRY가 필요합니다.');
  if (!zoneAccess) throw new Error('[elements-effects] HB_ZONE_ACCESS가 필요합니다.');

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const COUNTERS = Object.freeze({ FIRE: '화염', WATER: '물', ELECTRIC: '전기', WIND: '바람', ULTIMATE: '궁극' });
  const BASIC_COUNTER_TYPES = Object.freeze([COUNTERS.FIRE, COUNTERS.WATER, COUNTERS.ELECTRIC, COUNTERS.WIND]);
  const SPIRIT_IDS = Object.freeze(['엘리멘츠의 불꽃정령', '엘리멘츠의 물정령', '엘리멘츠의 전기정령', '엘리멘츠의 바람정령']);
  const SPIRIT_COUNTER = Object.freeze({
    '엘리멘츠의 불꽃정령': COUNTERS.FIRE,
    '엘리멘츠의 물정령': COUNTERS.WATER,
    '엘리멘츠의 전기정령': COUNTERS.ELECTRIC,
    '엘리멘츠의 바람정령': COUNTERS.WIND,
  });

  function getDefaultGameState() { if (typeof G !== 'undefined') return G; return global.G || null; } // eslint-disable-line no-undef
  function getCardDatabase() { if (typeof CARDS !== 'undefined' && CARDS) return CARDS; return global.CARDS || null; } // eslint-disable-line no-undef
  function getCardId(cardOrId) { if (!cardOrId) return ''; if (typeof cardOrId === 'string') return cardOrId; return cardOrId.id || cardOrId.cardId || cardOrId.name || ''; }
  function getCardDef(cardOrId) { const cards = getCardDatabase(); const id = getCardId(cardOrId); return cards && id ? cards[id] || null : null; }
  function getCardName(cardOrId) { const def = getCardDef(cardOrId); return (cardOrId && cardOrId.name) || (def && def.name) || getCardId(cardOrId); }
  function normalizeController(controller) { return zoneAccess.normalizeController(controller || CONTROLLERS.ME); }
  function opponentOf(controller) { return normalizeController(controller) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME; }
  function stateOf(ctxOrState) { return (ctxOrState && ctxOrState.gameState) || ctxOrState || getDefaultGameState(); }
  function zoneArray(ctxOrState, controller, zone) { return zoneAccess.getZoneArray(stateOf(ctxOrState), normalizeController(controller || CONTROLLERS.ME), zone); }
  function my(ctx) { return normalizeController(ctx && ctx.controller); }
  function opp(ctx) { return opponentOf(my(ctx)); }
  function isElementsCard(cardOrId) { const def = getCardDef(cardOrId); const id = getCardId(cardOrId); return !!(def && def.theme === '엘리멘츠') || id.indexOf('엘리멘츠') === 0 || id === '궁극의 엘리멘츠'; }
  function isElementsMonster(cardOrId) { const def = getCardDef(cardOrId); return !!(def && def.theme === '엘리멘츠' && def.cardType === 'monster'); }
  function isElementsNonSelfRainbow(cardOrId) { return isElementsCard(cardOrId) && getCardId(cardOrId) !== '엘리멘츠 in rainbow forest'; }
  function isSpirit(cardOrId) { return SPIRIT_IDS.indexOf(getCardId(cardOrId)) !== -1; }
  function counterTypeOf(cardOrId) { return SPIRIT_COUNTER[getCardId(cardOrId)] || (String(getCardId(cardOrId)).indexOf('궁극') !== -1 ? COUNTERS.ULTIMATE : null); }
  function hasFieldSpace(ctx, controller) { return ctx && ctx.move && typeof ctx.move.hasFieldSpace === 'function' ? ctx.move.hasFieldSpace(controller || ctx.controller) : zoneArray(ctx, controller || my(ctx), ZONES.FIELD).length < 5; }
  function fieldSpaceCount(ctx, controller) { const owner = normalizeController(controller || my(ctx)); const field = zoneArray(ctx, owner, ZONES.FIELD); const limit = ctx && ctx.move && typeof ctx.move.getFieldSlotLimit === 'function' ? ctx.move.getFieldSlotLimit(owner) : 5; return Math.max(0, limit - field.length); }
  function logSafe(msg, type) { try { if (typeof log === 'function') log(msg, type || 'mine'); else if (global.console) global.console.log('[elements-effects]', msg); } catch (_) {} } // eslint-disable-line no-undef
  function notifySafe(msg) { try { if (typeof notify === 'function') notify(msg); else if (global.console) global.console.warn('[elements-effects]', msg); } catch (_) {} } // eslint-disable-line no-undef
  function renderAndSync() { try { if (typeof sendGameState === 'function') sendGameState(); } catch (_) {} try { if (typeof renderAll === 'function') renderAll(); } catch (_) {} } // eslint-disable-line no-undef
  function dispatchPending(ctx) { if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') global.HB_EVENTS.dispatchEvents(ctx.gameState); renderAndSync(); }
  function firstOrSelected(ctx, candidates) { const list = candidates.slice(); if (!list.length) return null; const selected = (ctx && (ctx.selectedCards || ctx.selectedCardIds || ctx.targets)) || []; for (const item of selected) { const id = typeof item === 'number' ? null : getCardId(item.card || item); if (typeof item === 'number' && list[item]) return list[item]; if (id) { const found = list.find(c => getCardId(c.card || c) === id || getCardId(c) === id); if (found) return found; } } return list[0]; }
  function findInZone(ctx, controller, zone, pred) { return zoneArray(ctx, controller, zone).filter(c => c && (!pred || pred(c))); }
  function findDeck(ctx, pred) { return findInZone(ctx, my(ctx), ZONES.DECK, pred); }
  function findGrave(ctx, pred) { return findInZone(ctx, my(ctx), ZONES.GRAVE, pred); }
  function findExile(ctx, pred) { return findInZone(ctx, my(ctx), ZONES.EXILE, pred); }
  function findHand(ctx, pred) { return findInZone(ctx, my(ctx), ZONES.HAND, pred); }
  function findPublicHand(ctx, pred) { return findInZone(ctx, my(ctx), ZONES.PUBLIC_HAND, pred); }
  function findField(ctx, controller, pred) { return findInZone(ctx, controller, ZONES.FIELD, pred); }
  function hasDeckTarget(ctx, pred) { return findDeck(ctx, pred).length > 0; }
  function ensureCounters(mon) { if (!mon.counters || typeof mon.counters !== 'object') mon.counters = {}; return mon.counters; }
  function counterCount(mon, type) { return (mon && mon.counters && mon.counters[type]) || 0; }
  function allCountersOn(controller, ctx) { const out = []; findField(ctx, controller, m => m && m.counters).forEach((m, index) => { Object.keys(m.counters || {}).forEach(type => { for (let i = 0; i < (m.counters[type] || 0); i += 1) out.push({ card: m, index, type }); }); }); return out; }
  function opponentCounters(ctx, types) { const set = new Set(types || BASIC_COUNTER_TYPES); return allCountersOn(opp(ctx), ctx).filter(c => set.has(c.type)); }
  function countersByTypeOnOpponent(ctx, type) { return opponentCounters(ctx, [type]); }
  function canRemoveBasicCounters(ctx, count) { return opponentCounters(ctx).length >= count; }
  function canRemoveOwnNamedCounters(ctx, count) { const types = new Set(allCountersOn(my(ctx), ctx).map(c => c.type)); return types.size >= count; }
  function removeCounters(ctx, controller, requirements) {
    const req = Object.assign({}, requirements || {});
    const owner = normalizeController(controller || opp(ctx));
    const fields = findField(ctx, owner);
    const removed = [];
    Object.keys(req).forEach(type => {
      let need = req[type];
      fields.forEach((m, index) => {
        if (need <= 0 || !m || !m.counters || !m.counters[type]) return;
        const n = Math.min(need, m.counters[type]);
        m.counters[type] -= n;
        if (m.counters[type] <= 0) delete m.counters[type];
        need -= n;
        for (let i = 0; i < n; i += 1) removed.push({ card: m, index, type });
      });
    });
    return removed;
  }
  function removeUpToBasicCounters(ctx, maxCount) {
    const choices = opponentCounters(ctx).slice(0, Math.max(0, maxCount || 0));
    choices.forEach(choice => { if (choice.card && choice.card.counters && choice.card.counters[choice.type]) { choice.card.counters[choice.type] -= 1; if (choice.card.counters[choice.type] <= 0) delete choice.card.counters[choice.type]; } });
    return choices;
  }
  function removeOwnDistinctCounters(ctx, count) {
    const seen = new Set();
    const chosen = [];
    allCountersOn(my(ctx), ctx).forEach(choice => { if (chosen.length >= count || seen.has(choice.type)) return; seen.add(choice.type); chosen.push(choice); });
    chosen.forEach(choice => { choice.card.counters[choice.type] -= 1; if (choice.card.counters[choice.type] <= 0) delete choice.card.counters[choice.type]; });
    return chosen;
  }
  function canMeetUltimateRequirement(ctx, perType) { return BASIC_COUNTER_TYPES.every(type => opponentCounters(ctx, [type]).length >= perType); }
  function addCounter(ctx, mon, type, amount, sourceEffectId) {
    if (!mon || !type || amount <= 0) return 0;
    const map = ensureCounters(mon);
    const prev = map[type] || 0;
    map[type] = prev + amount;
    if (type === COUNTERS.FIRE) mon.atk = (mon.atk ?? getCardDef(mon.id)?.atk ?? 0) - amount;
    if (type === COUNTERS.ULTIMATE) mon.atk = (mon.atk ?? getCardDef(mon.id)?.atk ?? 0) + amount;
    if (type === COUNTERS.ELECTRIC) {
      const before = Math.floor(prev / 2); const after = Math.floor(map[type] / 2); const times = Math.max(0, after - before);
      const opHand = zoneArray(ctx, opp(ctx), ZONES.HAND);
      for (let i = 0; i < times && opHand.length; i += 1) { const discarded = opHand.shift(); zoneAccess.insertCardToZone(ctx.gameState, opp(ctx), ZONES.GRAVE, discarded); }
    }
    if (type === COUNTERS.WIND) {
      const before = Math.floor(prev / 2); const after = Math.floor(map[type] / 2); const times = Math.max(0, after - before);
      for (let i = 0; i < times; i += 1) { const deck = zoneArray(ctx, my(ctx), ZONES.DECK); if (!deck.length) break; const card = deck.shift(); zoneAccess.insertCardToZone(ctx.gameState, my(ctx), ZONES.HAND, card); }
    }
    if (sourceEffectId) {
      ctx.gameState._elements = ctx.gameState._elements || {};
      ctx.gameState._elements.counterPlacedByEffect = ctx.gameState._elements.counterPlacedByEffect || {};
      ctx.gameState._elements.counterPlacedByEffect[sourceEffectId] = (ctx.gameState._elements.counterPlacedByEffect[sourceEffectId] || 0) + amount;
    }
    return amount;
  }
  function addCounterToFirstOpponentMonster(ctx, type, amount, sourceEffectId) { const target = firstOrSelected(ctx, findField(ctx, opp(ctx))); if (!target) return 0; return addCounter(ctx, target, type, amount || 1, sourceEffectId); }
  function addCounterToAllOpponentMonsters(ctx, type, amount, sourceEffectId) { let n = 0; findField(ctx, opp(ctx)).forEach(mon => { n += addCounter(ctx, mon, type, amount || 1, sourceEffectId); }); return n; }
  function searchToHand(ctx, predicate, label) { const target = firstOrSelected(ctx, findDeck(ctx, predicate)); if (!target) return false; const r = ctx.move.addToHand({ cardId: target.id, from: { controller: my(ctx), zone: ZONES.DECK }, reason: label || 'elementsSearch' }); return !!(r && r.ok !== false); }
  function sendDeckToGrave(ctx, predicate, label) { const target = firstOrSelected(ctx, findDeck(ctx, predicate)); if (!target) return false; const r = ctx.move.sendToGrave({ cardId: target.id, from: { controller: my(ctx), zone: ZONES.DECK }, reason: label || 'elementsSendDeckToGrave' }); return !!(r && r.ok !== false); }
  function banishFrom(ctx, cardId, zone, label) { const r = ctx.move.banishCard({ cardId, from: { controller: my(ctx), zone }, reason: label || 'elementsCostBanish' }); return !!(r && r.ok !== false); }
  function summonFromZone(ctx, card, zone, label, ignoreFieldSpace) { if (!ignoreFieldSpace && !hasFieldSpace(ctx, my(ctx))) return false; const r = ctx.move.summonCard({ cardId: getCardId(card), from: { controller: my(ctx), zone }, reason: label || 'elementsSummon' }); return !!(r && r.ok !== false); }
  function addToHandFromZone(ctx, card, zone, label) { const r = ctx.move.addToHand({ cardId: getCardId(card), from: { controller: my(ctx), zone }, reason: label || 'elementsRecover' }); return !!(r && r.ok !== false); }
  function sourceZone(ctx) { return ctx.sourceZone || (ctx.source && ctx.source.zone) || ZONES.HAND; }
  function sourceCardId(ctx) { return getCardId((ctx && ctx.card) || (ctx && ctx.cardId) || (ctx && ctx.effect && ctx.effect.cardId)); }
  function sourceInZone(ctx, zone) { return sourceZone(ctx) === zone || (ctx.source && ctx.source.zone === zone); }
  function isDeployPhase(ctx) { const phase = (ctx && ctx.gameState && ctx.gameState.phase) || (typeof currentPhase !== 'undefined' ? currentPhase : null); return !phase || phase === 'deploy' || phase === '전개' || phase === 'main'; } // eslint-disable-line no-undef
  function isOpponentTurn(ctx) { if (ctx && ctx.gameState && ctx.gameState.activeController) return ctx.gameState.activeController === opp(ctx); if (typeof isMyTurn !== 'undefined') return !isMyTurn; return true; } // eslint-disable-line no-undef
  function noActiveChain() { return !(global.HB_CHAIN_ENGINE && global.HB_CHAIN_ENGINE.hasActiveChain && global.HB_CHAIN_ENGINE.hasActiveChain()); }
  function basicSpiritSummonCondition(ctx) { const field = findField(ctx, my(ctx)); return field.length === 0 || field.some(isElementsCard); }
  function canSpiritSummon(ctx) { return basicSpiritSummonCondition(ctx) && hasFieldSpace(ctx, my(ctx)); }
  function canSpiritSummonTriggerResolve(ctx) { return findField(ctx, opp(ctx)).length > 0 || hasDeckTarget(ctx, isElementsCard); }
  function resolveSpiritSummonTrigger(ctx) { const type = counterTypeOf(ctx.effect.cardId); if (findField(ctx, opp(ctx)).length > 0) addCounterToFirstOpponentMonster(ctx, type, 1, ctx.effect.id); else searchToHand(ctx, isElementsCard, 'elementsSpiritSearch'); dispatchPending(ctx); }
  function canRecoverOrSummon(ctx, card) { const def = getCardDef(card); return def && def.cardType === 'monster' ? hasFieldSpace(ctx, my(ctx)) : true; }
  function recoverOrSummon(ctx, card, zone, label) { const def = getCardDef(card); if (def && def.cardType === 'monster') return summonFromZone(ctx, card, zone, label); return addToHandFromZone(ctx, card, zone, label); }
  function bounceCardToHand(ctx, controller, zone, card) { return ctx.move.addToHand({ cardId: getCardId(card), from: { controller: normalizeController(controller), zone }, reason: 'elementsBounceToHand' }); }
  function negateCurrentChainLink(ctx) { if (ctx.chainLink) { ctx.chainLink.negated = true; ctx.chainLink.isNegated = true; ctx.chainLink.negatedBy = ctx.effect.id; } logSafe(`${getCardName(ctx.effect.cardId)}: 효과를 무효로 했습니다.`, 'mine'); dispatchPending(ctx); return true; }
  function removeSelfAsCost(ctx) { const z = sourceZone(ctx); if (z === ZONES.FIELD) return ctx.move.sendToGrave({ cardId: sourceCardId(ctx), from: { controller: my(ctx), zone: ZONES.FIELD }, reason: 'elementsCostSendSelf' }); if (z === ZONES.HAND) return ctx.move.sendToGrave({ cardId: sourceCardId(ctx), from: { controller: my(ctx), zone: ZONES.HAND }, reason: 'elementsCostSendSelf' }); return { ok: false, error: '코스트로 보낼 수 있는 위치가 아닙니다.' }; }

  const effects = [];
  function add(effect) { effects.push(effect); return effect; }

  SPIRIT_IDS.forEach(id => {
    const type = SPIRIT_COUNTER[id];
    add({ id: `${id}-1-procedure-summon`, cardId: id, effectNo: 1, type: EFFECT_TYPES.PROCEDURE, zones: [ZONES.HAND], timing: TIMING.MY_DEPLOY, isActivated: false, summonProcedure: true, label: '자체 소환', text: '자신 몬스터존이 비어 있거나 엘리멘츠 카드가 있을 경우 이 카드를 소환한다.', condition: ctx => isDeployPhase(ctx) && noActiveChain() && basicSpiritSummonCondition(ctx), canResolve: canSpiritSummon, resolve(ctx) { const ok = summonFromZone(ctx, id, ZONES.HAND, 'elementsSpiritProcedure'); if (ok) dispatchPending(ctx); return ok; } });
    add({ id: `${id}-2-on-summon-counter-or-search`, cardId: id, effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD], events: [EVENTS.SUMMON], timing: TIMING.ON_SUMMON, optional: true, tags: ['counterPlace', TAGS.DECK_SEARCH], text: '소환했을 경우 상대 몬스터에 카운터를 놓거나 엘리멘츠 카드를 서치한다.', condition: ctx => ctx.event && ctx.event.cardId === id, canResolve: canSpiritSummonTriggerResolve, resolve: resolveSpiritSummonTrigger });
    if (id === '엘리멘츠의 불꽃정령') add({ id: 'elements-fire-spirit-3-remove-counters-search', cardId: id, effectNo: 3, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], timing: TIMING.MY_DEPLOY, tags: [TAGS.DECK_SEARCH], text: '패의 이 카드를 보여주고 상대 필드 카운터를 2개까지 제거하여 그 수만큼 서치한다.', condition: () => true, canResolve: ctx => opponentCounters(ctx).length > 0 && hasDeckTarget(ctx, isElementsCard), resolve(ctx) { const removed = removeUpToBasicCounters(ctx, 2); for (let i = 0; i < removed.length; i += 1) searchToHand(ctx, isElementsCard, 'elementsFireCounterSearch'); dispatchPending(ctx); return removed.length > 0; } });
    if (id === '엘리멘츠의 물정령') add({ id: 'elements-water-spirit-3-public-hand-convert', cardId: id, effectNo: 3, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.PUBLIC_HAND], events: [EVENTS.ADDED_TO_HAND], timing: TIMING.NONE, optional: true, tags: [TAGS.DECK_SEARCH], text: '공개 패에 넣어졌을 경우 덱에서 엘리멘츠 카드 1장을 묘지로 보내고 일반 패로 넣는다.', condition: ctx => ctx.event && ctx.event.cardId === id && (ctx.event.reveal || ctx.event.to?.zone === ZONES.PUBLIC_HAND), canResolve: ctx => hasDeckTarget(ctx, isElementsCard) && findPublicHand(ctx, c => getCardId(c) === id).length > 0, resolve(ctx) { sendDeckToGrave(ctx, isElementsCard, 'elementsWaterSendDeck'); addToHandFromZone(ctx, id, ZONES.PUBLIC_HAND, 'elementsWaterPublicToHand'); dispatchPending(ctx); return true; } });
    if (id === '엘리멘츠의 전기정령') add({ id: 'elements-electric-spirit-3-send-self-counter-all', cardId: id, effectNo: 3, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND, ZONES.FIELD], timing: TIMING.MY_DEPLOY, tags: [TAGS.COST_SEND_TO_GRAVE, 'counterPlace'], text: '패/필드의 이 카드를 묘지로 보내고 상대 필드 몬스터 전부에 전기 카운터를 놓는다.', condition: () => true, canResolve: ctx => findField(ctx, opp(ctx)).length > 0, cost(ctx) { return removeSelfAsCost(ctx); }, resolve(ctx) { const n = addCounterToAllOpponentMonsters(ctx, COUNTERS.ELECTRIC, 1, ctx.effect.id); dispatchPending(ctx); return n > 0; } });
    if (id === '엘리멘츠의 바람정령') add({ id: 'elements-wind-spirit-3-search-rainbow', cardId: id, effectNo: 3, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.GRAVE], events: [EVENTS.SENT_TO_GRAVE], timing: TIMING.ON_SENT_TO_GRAVE, optional: true, tags: [TAGS.DECK_SEARCH], text: '묘지로 보내졌을 경우 rainbow forest를 서치한다.', condition: ctx => ctx.event && ctx.event.cardId === id, canResolve: ctx => hasDeckTarget(ctx, c => getCardId(c) === '엘리멘츠 in rainbow forest'), resolve(ctx) { const ok = searchToHand(ctx, c => getCardId(c) === '엘리멘츠 in rainbow forest', 'elementsWindSearchRainbow'); dispatchPending(ctx); return ok; } });
  });

  add({ id: 'elements-rainbow-1-activation-search-monster', cardId: '엘리멘츠 in rainbow forest', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.FIELD_ZONE], timing: TIMING.NONE, tags: [TAGS.FIELD_CARD_ACTIVATION, TAGS.DECK_SEARCH], meta: { fieldCardActivation: true }, text: '발동 시 효과 처리로서 덱에서 엘리멘츠 몬스터 1장을 패에 넣을 수 있다.', condition: () => true, canResolve: ctx => hasDeckTarget(ctx, isElementsMonster), resolve(ctx) { const ok = searchToHand(ctx, isElementsMonster, 'elementsRainbowActivationSearch'); dispatchPending(ctx); return ok; } });
  add({ id: 'elements-rainbow-2-counter-effects-immune', cardId: '엘리멘츠 in rainbow forest', effectNo: 2, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD_ZONE], timing: TIMING.NONE, tags: ['protectCounterEffects'], text: '자신이 발동한 카운터를 올리는 효과는 무효화되지 않는다.', continuousRule: { protectOwnCounterPlaceEffects: true } });
  add({ id: 'elements-rainbow-3-grave-recover', cardId: '엘리멘츠 in rainbow forest', effectNo: 3, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.GRAVE], events: [EVENTS.SENT_TO_GRAVE], timing: TIMING.ON_SENT_TO_GRAVE, optional: true, tags: ['recover'], text: '묘지로 보내졌을 경우 자신 묘지의 다른 엘리멘츠 카드를 패에 넣는다.', condition: ctx => ctx.event && ctx.event.cardId === '엘리멘츠 in rainbow forest', canResolve: ctx => findGrave(ctx, isElementsNonSelfRainbow).length > 0, resolve(ctx) { const target = firstOrSelected(ctx, findGrave(ctx, isElementsNonSelfRainbow)); const ok = target && addToHandFromZone(ctx, target, ZONES.GRAVE, 'elementsRainbowRecover'); dispatchPending(ctx); return !!ok; } });

  add({ id: 'elements-fairy-1-send-countered-monsters', cardId: '엘리멘츠 is fairy!!!', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], timing: TIMING.MY_DEPLOY, tags: ['sendCounteredMonstersToGrave'], text: '덱/묘지의 엘리멘츠 몬스터를 2장까지 확인하고 그 카운터가 놓인 몬스터들을 묘지로 보낸다.', condition: () => true, canResolve: ctx => (findDeck(ctx, isElementsMonster).length + findGrave(ctx, isElementsMonster).length) > 0 && opponentCounters(ctx).length > 0, resolve(ctx) { const types = new Set((findDeck(ctx, isElementsMonster).concat(findGrave(ctx, isElementsMonster))).slice(0, 2).map(counterTypeOf).filter(Boolean)); let n = 0; findField(ctx, opp(ctx), m => m && Object.keys(m.counters || {}).some(t => types.has(t))).slice().forEach(m => { const r = ctx.move.sendToGrave({ cardId: m.id, from: { controller: opp(ctx), zone: ZONES.FIELD }, controller: opp(ctx), reason: 'elementsFairySendCountered' }); if (r && r.ok !== false) n += 1; }); dispatchPending(ctx); return n > 0; } });
  add({ id: 'elements-fairy-2-grave-banish-place-all', cardId: '엘리멘츠 is fairy!!!', effectNo: 2, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.GRAVE], timing: TIMING.MY_DEPLOY, tags: [TAGS.COST_BANISH, 'counterPlace'], text: '전개 단계에 묘지의 이 카드를 제외하고 카드명이 다른 엘리멘츠 몬스터 4장을 보여주어 상대 몬스터 전부에 카운터를 놓는다.', condition: ctx => isDeployPhase(ctx), canResolve: ctx => findField(ctx, opp(ctx)).length > 0 && new Set(findDeck(ctx, isElementsMonster).concat(findGrave(ctx, isElementsMonster)).map(getCardId)).size >= 4, cost: ctx => banishFrom(ctx, '엘리멘츠 is fairy!!!', ZONES.GRAVE, 'elementsFairyCost'), resolve(ctx) { SPIRIT_IDS.forEach(id => addCounterToAllOpponentMonsters(ctx, counterTypeOf(id), 1, ctx.effect.id)); dispatchPending(ctx); return true; } });

  add({ id: 'elements-magic-1-banish-send', cardId: '엘리멘츠의 MAGIC', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], timing: TIMING.MY_DEPLOY, tags: [TAGS.COST_BANISH, TAGS.COST_SEND_TO_GRAVE], text: '덱에서 엘리멘츠 카드 1장을 제외하고 덱에서 엘리멘츠 카드 1장을 묘지로 보낸다.', condition: () => true, canResolve: ctx => findDeck(ctx, isElementsCard).length >= 2, cost(ctx) { const target = firstOrSelected(ctx, findDeck(ctx, isElementsCard)); return target && ctx.move.banishCard({ cardId: target.id, from: { controller: my(ctx), zone: ZONES.DECK }, reason: 'elementsMagicBanishDeckCost' }); }, resolve(ctx) { const ok = sendDeckToGrave(ctx, isElementsCard, 'elementsMagicSendDeck'); dispatchPending(ctx); return ok; } });
  add({ id: 'elements-magic-2-grave-banish-recover-exiled', cardId: '엘리멘츠의 MAGIC', effectNo: 2, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.GRAVE], timing: TIMING.MY_DEPLOY, tags: [TAGS.COST_BANISH, 'recover', TAGS.EXILE_SUMMON], text: '묘지의 이 카드를 제외하고 제외된 엘리멘츠 카드 2장까지를 패에 넣거나 소환한다.', condition: () => true, canResolve: ctx => findExile(ctx, isElementsCard).some(c => canRecoverOrSummon(ctx, c)), cost: ctx => banishFrom(ctx, '엘리멘츠의 MAGIC', ZONES.GRAVE, 'elementsMagicCost'), resolve(ctx) { let count = 0; findExile(ctx, isElementsCard).slice(0, 2).forEach(card => { if (canRecoverOrSummon(ctx, card) && recoverOrSummon(ctx, card, ZONES.EXILE, 'elementsMagicRecoverOrSummon')) count += 1; }); dispatchPending(ctx); return count > 0; } });

  add({ id: 'elements-trap-1-negate-opponent-effect', cardId: '엘리멘츠의 TR∀P', effectNo: 1, type: EFFECT_TYPES.QUICK, zones: [ZONES.HAND, ZONES.FIELD], timing: TIMING.OPPONENT_TURN, tags: [TAGS.NEGATE_EFFECT], text: '상대 턴에 상대 효과가 발동했을 때 자신 필드의 이름이 다른 카운터 4개를 제거하고 그 효과를 무효로 한다.', condition: ctx => isOpponentTurn(ctx) && !!ctx.chainLink, canResolve: ctx => canRemoveOwnNamedCounters(ctx, 4), cost(ctx) { const removed = removeOwnDistinctCounters(ctx, 4); return { ok: removed.length >= 4, removed }; }, resolve: negateCurrentChainLink });
  add({ id: 'elements-trap-2-grave-banish-place-all', cardId: '엘리멘츠의 TR∀P', effectNo: 2, type: EFFECT_TYPES.QUICK, zones: [ZONES.GRAVE], timing: TIMING.OPPONENT_TURN, tags: [TAGS.COST_BANISH, 'counterPlace'], text: '상대 턴에 묘지의 이 카드를 제외하고 상대 몬스터 전부에 4종 카운터를 놓는다.', condition: ctx => isOpponentTurn(ctx), canResolve: ctx => findField(ctx, opp(ctx)).length > 0 && new Set(findDeck(ctx, isElementsMonster).concat(findGrave(ctx, isElementsMonster)).map(getCardId)).size >= 4, cost: ctx => banishFrom(ctx, '엘리멘츠의 TR∀P', ZONES.GRAVE, 'elementsTrapCost'), resolve(ctx) { SPIRIT_IDS.forEach(id => addCounterToAllOpponentMonsters(ctx, counterTypeOf(id), 1, ctx.effect.id)); dispatchPending(ctx); return true; } });

  add({ id: 'elements-suits-1-quick-deck-summon-counter-all', cardId: '엘리멘츠의 ♤♡◇♧', effectNo: 1, type: EFFECT_TYPES.QUICK, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: [TAGS.DECK_SUMMON, 'counterPlace'], text: '덱에서 엘리멘츠 몬스터 1장을 소환하고 상대 몬스터 전부에 그 카운터를 놓는다.', condition: () => true, canResolve: ctx => hasFieldSpace(ctx, my(ctx)) && hasDeckTarget(ctx, isElementsMonster), resolve(ctx) { const target = firstOrSelected(ctx, findDeck(ctx, isElementsMonster)); if (!target) return false; const type = counterTypeOf(target); const ok = summonFromZone(ctx, target, ZONES.DECK, 'elementsSuitsDeckSummon'); if (ok) addCounterToAllOpponentMonsters(ctx, type, 1, ctx.effect.id); dispatchPending(ctx); return ok; } });
  add({ id: 'elements-suits-2-grave-banish-draw-discard', cardId: '엘리멘츠의 ♤♡◇♧', effectNo: 2, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.GRAVE], timing: TIMING.MY_DEPLOY, tags: [TAGS.COST_BANISH, TAGS.DRAW, TAGS.DISCARD_HAND], text: '묘지에서 제외하고 1효과로 놓은 카운터 수만큼 드로우 후 패 1장 버린다.', condition: () => true, canResolve: ctx => (ctx.gameState?._elements?.counterPlacedByEffect?.['elements-suits-1-quick-deck-summon-counter-all'] || 0) > 0 && zoneArray(ctx, my(ctx), ZONES.DECK).length > 0, cost: ctx => banishFrom(ctx, '엘리멘츠의 ♤♡◇♧', ZONES.GRAVE, 'elementsSuitsCost'), resolve(ctx) { const n = Math.min(zoneArray(ctx, my(ctx), ZONES.DECK).length, ctx.gameState._elements.counterPlacedByEffect['elements-suits-1-quick-deck-summon-counter-all'] || 0); for (let i = 0; i < n; i += 1) { const card = zoneArray(ctx, my(ctx), ZONES.DECK).shift(); zoneAccess.insertCardToZone(ctx.gameState, my(ctx), ZONES.HAND, card); } const hand = zoneArray(ctx, my(ctx), ZONES.HAND); if (hand.length) zoneAccess.insertCardToZone(ctx.gameState, my(ctx), ZONES.GRAVE, hand.shift()); dispatchPending(ctx); return n > 0; } });

  function ultimateProcedure(cardId, perType) { return { id: `${cardId}-procedure-counter-summon`, cardId, effectNo: 1, type: EFFECT_TYPES.PROCEDURE, zones: [ZONES.HAND, ZONES.GRAVE], timing: TIMING.MY_DEPLOY, isActivated: false, summonProcedure: true, label: '카운터 제거 소환', text: `상대 필드의 카운터 4종류를 ${perType}개씩 제거했을 경우에만 패/묘지에서 소환한다.`, condition: ctx => isDeployPhase(ctx) && noActiveChain(), canResolve: ctx => hasFieldSpace(ctx, my(ctx)) && canMeetUltimateRequirement(ctx, perType), resolve(ctx) { const req = {}; BASIC_COUNTER_TYPES.forEach(t => { req[t] = perType; }); removeCounters(ctx, opp(ctx), req); const ok = summonFromZone(ctx, cardId, sourceZone(ctx), 'elementsUltimateProcedure'); dispatchPending(ctx); return ok; } }; }
  add(ultimateProcedure('엘리멘츠의 궁극신', 2));
  add({ id: 'elements-ultimate-god-1-on-summon-bounce-all-other', cardId: '엘리멘츠의 궁극신', effectNo: 1, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD], events: [EVENTS.SUMMON], mandatory: true, optional: false, timing: TIMING.ON_SUMMON, text: '소환했을 경우 필드의 다른 몬스터를 전부 패로 되돌린다.', condition: ctx => ctx.event && ctx.event.cardId === '엘리멘츠의 궁극신', canResolve: ctx => findField(ctx, my(ctx)).concat(findField(ctx, opp(ctx))).some(c => getCardId(c) !== '엘리멘츠의 궁극신'), resolve(ctx) { findField(ctx, my(ctx)).filter(c => getCardId(c) !== '엘리멘츠의 궁극신').slice().forEach(c => bounceCardToHand(ctx, my(ctx), ZONES.FIELD, c)); findField(ctx, opp(ctx)).slice().forEach(c => bounceCardToHand(ctx, opp(ctx), ZONES.FIELD, c)); dispatchPending(ctx); return true; } });
  add({ id: 'elements-ultimate-god-2-deploy-summon-four', cardId: '엘리멘츠의 궁극신', effectNo: 2, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.FIELD], timing: TIMING.MY_DEPLOY, tags: [TAGS.HAND_SUMMON], text: '전개 단계에 패의 카드명이 다른 엘리멘츠 몬스터를 4장까지 소환하고 궁극 카운터를 놓는다.', condition: ctx => isDeployPhase(ctx), canResolve: ctx => fieldSpaceCount(ctx, my(ctx)) > 0 && findHand(ctx, isElementsMonster).length > 0, resolve(ctx) { const seen = new Set(); let n = 0; findHand(ctx, isElementsMonster).slice().forEach(c => { if (n >= 4 || seen.has(c.id) || !hasFieldSpace(ctx, my(ctx))) return; seen.add(c.id); if (summonFromZone(ctx, c, ZONES.HAND, 'elementsUltimateSummonHand')) n += 1; }); const self = findField(ctx, my(ctx), c => getCardId(c) === '엘리멘츠의 궁극신')[0]; if (self) addCounter(ctx, self, COUNTERS.ULTIMATE, 1, ctx.effect.id); dispatchPending(ctx); return n > 0; } });
  add({ id: 'elements-ultimate-god-3-negate-opponent-effect', cardId: '엘리멘츠의 궁극신', effectNo: 3, type: EFFECT_TYPES.QUICK, zones: [ZONES.FIELD], timing: TIMING.EITHER_TURN, tags: [TAGS.NEGATE_EFFECT], text: '상대 효과가 발동했을 때 그 효과를 무효로 한다.', condition: ctx => !!ctx.chainLink, canResolve: () => true, resolve: negateCurrentChainLink });
  add({ id: 'elements-ultimate-god-4-exiled-recover-disrupt', cardId: '엘리멘츠의 궁극신', effectNo: 4, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.EXILE], events: [EVENTS.EXILED], optional: true, timing: TIMING.NONE, text: '제외되었을 경우 이 카드를 패에 넣고 상대 패를 1장 제외한다.', condition: ctx => ctx.event && ctx.event.cardId === '엘리멘츠의 궁극신', canResolve: ctx => findExile(ctx, c => getCardId(c) === '엘리멘츠의 궁극신').length > 0, resolve(ctx) { addToHandFromZone(ctx, '엘리멘츠의 궁극신', ZONES.EXILE, 'elementsUltimateRecover'); const h = zoneArray(ctx, opp(ctx), ZONES.HAND); if (h.length) zoneAccess.insertCardToZone(ctx.gameState, opp(ctx), ZONES.EXILE, h.shift()); dispatchPending(ctx); return true; } });

  add({ id: 'elements-magic-card-1-recover-then-deck-summon-counter', cardId: '엘리멘츠의 마법', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], timing: TIMING.MY_DEPLOY, tags: ['recover', TAGS.DECK_SUMMON, 'counterPlace'], text: '묘지/제외 엘리멘츠 카드 1장을 몬스터면 소환, 아니면 패에 넣고 덱에서 엘리멘츠 몬스터를 소환해 카운터 2개를 놓는다.', condition: () => true, canResolve: ctx => findGrave(ctx, isElementsCard).concat(findExile(ctx, isElementsCard)).some(c => canRecoverOrSummon(ctx, c)) && hasFieldSpace(ctx, my(ctx)) && hasDeckTarget(ctx, isElementsMonster) && findField(ctx, opp(ctx)).length > 0, resolve(ctx) { const pool = findGrave(ctx, isElementsCard).map(c => ({ c, z: ZONES.GRAVE })).concat(findExile(ctx, isElementsCard).map(c => ({ c, z: ZONES.EXILE }))).filter(x => canRecoverOrSummon(ctx, x.c)); const target = firstOrSelected(ctx, pool); if (target) recoverOrSummon(ctx, target.c, target.z, 'elementsMagicCardRecover'); const deckMon = firstOrSelected(ctx, findDeck(ctx, isElementsMonster)); if (deckMon) { summonFromZone(ctx, deckMon, ZONES.DECK, 'elementsMagicCardDeckSummon'); addCounterToFirstOpponentMonster(ctx, counterTypeOf(deckMon), 2, ctx.effect.id); } dispatchPending(ctx); return !!target && !!deckMon; } });

  add(ultimateProcedure('엘리멘츠의 궁극 창조신', 4));
  add({ id: 'elements-creator-1-on-summon-bounce-seven', cardId: '엘리멘츠의 궁극 창조신', effectNo: 1, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD], events: [EVENTS.SUMMON], optional: true, timing: TIMING.ON_SUMMON, text: '소환했을 경우 상대 필드와 자신 묘지의 카드를 합계 7장까지 패로 되돌린다. 상대 필드 3장 이상 포함.', condition: ctx => ctx.event && ctx.event.cardId === '엘리멘츠의 궁극 창조신', canResolve: ctx => findField(ctx, opp(ctx)).length >= 3, resolve(ctx) { let n = 0; findField(ctx, opp(ctx)).slice(0, 7).forEach(c => { if (n < 7) { bounceCardToHand(ctx, opp(ctx), ZONES.FIELD, c); n += 1; } }); findGrave(ctx, () => true).slice(0, Math.max(0, 7 - n)).forEach(c => { bounceCardToHand(ctx, my(ctx), ZONES.GRAVE, c); n += 1; }); dispatchPending(ctx); return n >= 3; } });
  add({ id: 'elements-creator-2-deploy-summon-four-place-counters', cardId: '엘리멘츠의 궁극 창조신', effectNo: 2, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.FIELD], timing: TIMING.MY_DEPLOY, tags: [TAGS.HAND_SUMMON, 'counterPlace'], text: '전개 단계에 패의 카드명이 다른 엘리멘츠 몬스터를 4장까지 소환하고 카운터를 놓는다.', condition: ctx => isDeployPhase(ctx), canResolve: ctx => fieldSpaceCount(ctx, my(ctx)) > 0 && findHand(ctx, isElementsMonster).length > 0, resolve(ctx) { const summoned = []; const seen = new Set(); findHand(ctx, isElementsMonster).slice().forEach(c => { if (summoned.length >= 4 || seen.has(c.id) || !hasFieldSpace(ctx, my(ctx))) return; seen.add(c.id); if (summonFromZone(ctx, c, ZONES.HAND, 'elementsCreatorSummonHand')) summoned.push(c); }); summoned.forEach(c => addCounterToAllOpponentMonsters(ctx, counterTypeOf(c), 2, ctx.effect.id)); const self = findField(ctx, my(ctx), c => getCardId(c) === '엘리멘츠의 궁극 창조신')[0]; if (self) addCounter(ctx, self, COUNTERS.ULTIMATE, 1, ctx.effect.id); dispatchPending(ctx); return summoned.length > 0; } });
  add({ id: 'elements-creator-3-continuous-lock-protect', cardId: '엘리멘츠의 궁극 창조신', effectNo: 3, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD], timing: TIMING.NONE, tags: ['opponentCannotDiscardEffect', 'targetProtection'], text: '상대는 자신의 패를 버리는 효과를 포함하는 효과를 발동할 수 없으며, 이 카드는 상대 효과의 대상이 되지 않는다.', continuousRule: { targetProtection: { againstOpponentEffects: true }, opponentCannotActivateDiscardHandEffects: true } });
  add({ id: 'elements-creator-4-exiled-summon-self', cardId: '엘리멘츠의 궁극 창조신', effectNo: 4, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.EXILE], events: [EVENTS.EXILED], optional: true, timing: TIMING.NONE, text: '제외되었을 경우 이 카드를 소환하고 궁극 카운터 1개를 놓는다.', condition: ctx => ctx.event && ctx.event.cardId === '엘리멘츠의 궁극 창조신', canResolve: ctx => hasFieldSpace(ctx, my(ctx)) && findExile(ctx, c => getCardId(c) === '엘리멘츠의 궁극 창조신').length > 0, resolve(ctx) { const ok = summonFromZone(ctx, '엘리멘츠의 궁극 창조신', ZONES.EXILE, 'elementsCreatorExiledSummon'); const self = findField(ctx, my(ctx), c => getCardId(c) === '엘리멘츠의 궁극 창조신')[0]; if (self) addCounter(ctx, self, COUNTERS.ULTIMATE, 1, ctx.effect.id); dispatchPending(ctx); return ok; } });
  add({ id: 'elements-creator-5-remove-ultimate-buff-sticky', cardId: '엘리멘츠의 궁극 창조신', effectNo: 5, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.FIELD], timing: TIMING.MY_DEPLOY, text: '전개 단계에 필드의 궁극 카운터 3개를 제거하고 공격력을 7 올리며 이 턴 필드를 벗어나지 않는다.', condition: ctx => isDeployPhase(ctx), canResolve: ctx => allCountersOn(my(ctx), ctx).concat(allCountersOn(opp(ctx), ctx)).filter(c => c.type === COUNTERS.ULTIMATE).length >= 3, cost(ctx) { let need = 3; [my(ctx), opp(ctx)].forEach(controller => { findField(ctx, controller).forEach(mon => { if (need <= 0 || !mon.counters?.[COUNTERS.ULTIMATE]) return; const n = Math.min(need, mon.counters[COUNTERS.ULTIMATE]); mon.counters[COUNTERS.ULTIMATE] -= n; if (mon.counters[COUNTERS.ULTIMATE] <= 0) delete mon.counters[COUNTERS.ULTIMATE]; need -= n; }); }); return { ok: need === 0 }; }, resolve(ctx) { const self = findField(ctx, my(ctx), c => getCardId(c) === '엘리멘츠의 궁극 창조신')[0]; if (!self) return false; self.atk = (self.atk ?? getCardDef(self.id)?.atk ?? 0) + 7; self.cannotLeaveFieldThisTurn = true; dispatchPending(ctx); return true; } });

  add({ id: 'ultimate-elements-1-summon-ultimate-god-from-key-deck', cardId: '궁극의 엘리멘츠', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], timing: TIMING.MY_DEPLOY, tags: [TAGS.KEY_DECK_SUMMON], text: '궁극 창조신이 존재할 경우 키 카드 덱의 궁극신 1장을 소환조건을 무시하고 소환한다.', condition: ctx => findField(ctx, my(ctx), c => getCardId(c) === '엘리멘츠의 궁극 창조신').length > 0, canResolve: ctx => hasFieldSpace(ctx, my(ctx)) && findInZone(ctx, my(ctx), ZONES.KEY_DECK, c => getCardId(c) === '엘리멘츠의 궁극신').length > 0, resolve(ctx) { const ok = summonFromZone(ctx, '엘리멘츠의 궁극신', ZONES.KEY_DECK, 'ultimateElementsSummonKeyGod'); dispatchPending(ctx); return ok; } });
  add({ id: 'ultimate-elements-2-sent-to-grave-search-discard', cardId: '궁극의 엘리멘츠', effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.GRAVE], events: [EVENTS.SENT_TO_GRAVE], optional: true, timing: TIMING.ON_SENT_TO_GRAVE, tags: [TAGS.DECK_SEARCH, TAGS.DISCARD_HAND], text: '묘지로 보내졌을 경우 덱에서 엘리멘츠 카드 1장을 패에 넣고 패 1장을 버린다.', condition: ctx => ctx.event && ctx.event.cardId === '궁극의 엘리멘츠', canResolve: ctx => hasDeckTarget(ctx, isElementsCard), resolve(ctx) { const ok = searchToHand(ctx, isElementsCard, 'ultimateElementsSearch'); const hand = zoneArray(ctx, my(ctx), ZONES.HAND); if (hand.length) zoneAccess.insertCardToZone(ctx.gameState, my(ctx), ZONES.GRAVE, hand.shift()); dispatchPending(ctx); return ok; } });

  const registered = registry.registerEffects(effects);
  registry.syncEffectIdsToCards();

  global.HB_ELEMENTS_EFFECTS = Object.freeze({
    effects: registered,
    COUNTERS,
    BASIC_COUNTER_TYPES,
    SPIRIT_IDS,
    counterTypeOf,
    addCounter,
    addCounterToAllOpponentMonsters,
    canMeetUltimateRequirement,
    getElementsEffectIds: () => effects.map(e => e.id),
    getElementsCards: () => { const cards = getCardDatabase() || {}; return Object.keys(cards).filter(id => cards[id] && cards[id].theme === '엘리멘츠'); },
    getElementsImplementationSpec: () => Object.freeze({
      theme: '엘리멘츠',
      registeredEffectCount: effects.length,
      procedures: effects.filter(e => e.type === EFFECT_TYPES.PROCEDURE).map(e => e.id),
      counterTypes: BASIC_COUNTER_TYPES.concat([COUNTERS.ULTIMATE]),
      notes: ['정령/궁극신/궁극 창조신 자체 소환은 procedure', '서치/소환/카운터 배치 불가능 시 canResolve에서 발동 차단', '카운터는 card.counters에 저장'],
    }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
