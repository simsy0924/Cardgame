// HAND BATTLE — Theme Effects: Circusmare
// 16-2단계: 서커스메어 테마를 EffectDefinition 기반으로 이식한다.
// 핵심 원칙:
// - 카드 이동은 HB_CARD_MOVE/ctx.move만 사용한다.
// - 키 카드 몬스터 소환 소재는 효과별 허용 존과 소환 조건으로만 고른다.
// - 메드 키메라 ① 같은 지속 효과는 trigger/activation 후보에 절대 올리지 않는다.
(function initCircusmareEffectDefinitions(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({
    ACTIVATION: 'activation', QUICK: 'quick', TRIGGER: 'trigger', CONTINUOUS: 'continuous', PROCEDURE: 'procedure', REPLACEMENT: 'replacement',
  });
  const ZONES = rules.ZONES || Object.freeze({
    DECK: 'deck', HAND: 'hand', PUBLIC_HAND: 'publicHand', FIELD: 'field', FIELD_ZONE: 'fieldZone', GRAVE: 'grave', EXILE: 'exile', KEY_DECK: 'keyDeck',
  });
  const EVENTS = rules.EVENTS || Object.freeze({
    SUMMON: 'summon', SENT_TO_GRAVE: 'sentToGrave', EXILED: 'exiled', ADDED_TO_HAND: 'addedToHand', CARD_ACTIVATED: 'cardActivated',
  });
  const TIMING = rules.TIMING || Object.freeze({
    MY_DEPLOY: 'myDeploy', OPPONENT_TURN: 'opponentTurn', EITHER_TURN: 'eitherTurn', ON_SUMMON: 'onSummon', ON_SENT_TO_GRAVE: 'onSentToGrave', NONE: 'none',
  });
  const TAGS = rules.EFFECT_TAGS || Object.freeze({
    DECK_SEARCH: 'deckSearch', DECK_SUMMON: 'deckSummon', HAND_SUMMON: 'handSummon', GRAVE_SUMMON: 'graveSummon', EXILE_SUMMON: 'exileSummon', KEY_DECK_SUMMON: 'keyDeckSummon',
    SEND_OPPONENT_FIELD_TO_GRAVE: 'sendOpponentFieldToGrave', SEND_OPPONENT_MONSTERS_TO_GRAVE: 'sendOpponentMonstersToGrave',
    DRAW: 'draw', DISCARD_HAND: 'discardHand', COST_BANISH: 'costBanish', COST_SEND_TO_GRAVE: 'costSendToGrave', COST_DISCARD: 'costDiscard',
    NEGATE_EFFECT: 'negateEffect', FIELD_ZONE_EFFECT: 'fieldZoneEffect',
  });

  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry) throw new Error('[circusmare-effects] HB_EFFECT_REGISTRY가 필요합니다.');
  if (!zoneAccess) throw new Error('[circusmare-effects] HB_ZONE_ACCESS가 필요합니다.');

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const MED_IDS = Object.freeze(['서커스메어 메드 울프', '서커스메어 메드 베어', '서커스메어 메드 이글', '서커스메어 메드 씰']);
  const GENERIC_KEY_IDS = Object.freeze(['서커스메어 스프링 제스터', '서커스메어 메드 키메라', '서커스메어 퍼핏 마스터']);
  const SELF_EFFECT_ONLY_KEY_IDS = Object.freeze(['서커스메어 코인 제스터', '서커스메어 마스크 제스터']);
  const KEY_SUMMON_RULES = Object.freeze({
    '서커스메어 스프링 제스터': Object.freeze({
      materialMode: 'anyCircusmareMonsters',
      requiredCount: 3,
      materialPredicateName: '서커스메어 몬스터 3장',
      allowedGenericSources: Object.freeze(['서커스메어 일반/마법/함정/필드 효과']),
    }),
    '서커스메어 메드 키메라': Object.freeze({
      materialMode: 'exactMedFour',
      requiredIds: MED_IDS,
      materialPredicateName: '메드 울프/베어/이글/씰 각각 1장',
      allowedGenericSources: Object.freeze(['서커스메어 일반/마법/함정/필드 효과']),
    }),
    '서커스메어 퍼핏 마스터': Object.freeze({
      materialMode: 'anyCircusmareMonstersWithGraveExile12',
      requiredCount: 5,
      materialPredicateName: '묘지/제외 서커스메어 12장 이상 + 서커스메어 몬스터 5장',
      allowedGenericSources: Object.freeze(['서커스메어 일반/마법/함정/필드 효과']),
    }),
    '서커스메어 코인 제스터': Object.freeze({ materialMode: 'selfEffectOnly' }),
    '서커스메어 마스크 제스터': Object.freeze({ materialMode: 'selfEffectOnly' }),
  });


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

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || cardOrId.name || '';
  }

  function getCardDef(cardOrId) {
    const id = getCardId(cardOrId);
    const cards = getCardDatabase();
    return cards && id ? cards[id] || null : null;
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

  function isCircusmareCard(cardOrId) {
    const id = getCardId(cardOrId);
    const def = getCardDef(id);
    return !!(id && ((def && def.theme === '서커스메어') || id === '악몽의 서커스장' || id === '악몽 융합' || id === '광란의 서커스'));
  }

  function isCircusmareMonster(cardOrId) {
    const def = getCardDef(cardOrId);
    return !!(def && def.theme === '서커스메어' && def.cardType === 'monster');
  }

  function isCircusmareNonMonsterCard(cardOrId) {
    const def = getCardDef(cardOrId);
    return !!(def && def.theme === '서커스메어' && def.cardType && def.cardType !== 'monster');
  }

  function isMedMonster(cardOrId) { return MED_IDS.indexOf(getCardId(cardOrId)) !== -1; }
  function isMonster(cardOrId) { const def = getCardDef(cardOrId); return !!(def && def.cardType === 'monster'); }
  function isKeyCircusmareMonster(cardOrId) { const def = getCardDef(cardOrId); return !!(def && def.theme === '서커스메어' && def.cardType === 'monster' && def.isKeyCard); }
  function isGenericSummonableKey(cardOrId) { return GENERIC_KEY_IDS.indexOf(getCardId(cardOrId)) !== -1; }

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

  function isMyTurnFallback(ctx) {
    if (ctx && ctx.gameState && ctx.gameState.activeController) return ctx.gameState.activeController === normalizeController(ctx.controller);
    // eslint-disable-next-line no-undef
    if (typeof isMyTurn !== 'undefined') return !!isMyTurn;
    return true;
  }

  function hasFieldSpace(ctx, controller) {
    if (ctx && ctx.move && typeof ctx.move.hasFieldSpace === 'function') return ctx.move.hasFieldSpace(controller || ctx.controller);
    const field = zoneArray(ctx, controller || (ctx && ctx.controller) || CONTROLLERS.ME, ZONES.FIELD);
    return field.length < 5;
  }

  function fieldSpaceCount(ctx, controller) {
    const owner = normalizeController(controller || (ctx && ctx.controller) || CONTROLLERS.ME);
    const field = zoneArray(ctx, owner, ZONES.FIELD);
    const limit = ctx && ctx.move && typeof ctx.move.getFieldSlotLimit === 'function' ? ctx.move.getFieldSlotLimit(owner) : 5;
    return Math.max(0, limit - field.length);
  }

  function notifySafe(message) {
    // eslint-disable-next-line no-undef
    if (typeof notify === 'function') notify(message);
    else if (global.console && global.console.log) global.console.log('[circusmare-effects]', message);
  }

  function logSafe(message, type) {
    // eslint-disable-next-line no-undef
    if (typeof log === 'function') log(message, type || 'mine');
    else if (global.console && global.console.log) global.console.log('[circusmare-effects]', message);
  }

  function renderAndSync() {
    try { if (typeof sendGameState === 'function') sendGameState(); } catch (_) {} // eslint-disable-line no-undef
    try { if (typeof renderAll === 'function') renderAll(); } catch (_) {} // eslint-disable-line no-undef
  }

  function dispatchPending(ctx) {
    if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') global.HB_EVENTS.dispatchEvents(ctx.gameState);
  }

  function firstOrSelected(ctx, candidates) {
    const selected = (ctx && ctx.selectedCards) || [];
    const list = candidates.slice();
    if (!list.length) return null;
    if (selected.length) {
      const first = selected[0];
      if (typeof first === 'number') return list[first] || null;
      const id = getCardId(first);
      const found = list.find(card => getCardId(card) === id || getCardId(card.card) === id);
      if (found) return found;
    }
    return list[0];
  }

  function findInZone(ctx, controller, zone, predicate) {
    return zoneArray(ctx, controller || ctx.controller, zone).filter(card => card && (!predicate || predicate(card)));
  }

  function findDeck(ctx, predicate) { return findInZone(ctx, ctx.controller, ZONES.DECK, predicate); }
  function findGrave(ctx, predicate) { return findInZone(ctx, ctx.controller, ZONES.GRAVE, predicate); }
  function findExile(ctx, predicate) { return findInZone(ctx, ctx.controller, ZONES.EXILE, predicate); }
  function findHand(ctx, predicate) { return findInZone(ctx, ctx.controller, ZONES.HAND, predicate); }
  function findField(ctx, predicate, controller) { return findInZone(ctx, controller || ctx.controller, ZONES.FIELD, predicate); }

  function cardMatchesEvent(ctx, cardId) {
    const e = ctx.event || {};
    return getCardId(e.card || e.cardId || e.id) === cardId;
  }

  function sourceWas(ctx, zone) {
    const e = ctx.event || {};
    const fromZone = (e.from && e.from.zone) || e.sourceZone || (e.eventData && e.eventData.sourceZone);
    return fromZone === zone;
  }

  function canDraw(ctx, count) {
    return zoneArray(ctx, ctx.controller, ZONES.DECK).length >= Math.max(0, Number(count || 0));
  }

  function drawOne(ctx) {
    const deck = zoneArray(ctx, ctx.controller, ZONES.DECK);
    if (!deck.length) return { ok: false, error: '덱에 드로우할 카드가 없습니다.' };
    const cardId = deck[0].id;
    return ctx.move.addToHand({ cardId, controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.DECK }, reason: 'circusmareDraw' });
  }

  function drawN(ctx, n) {
    const results = [];
    for (let i = 0; i < n; i += 1) {
      const r = drawOne(ctx);
      results.push(r);
      if (!r.ok) break;
    }
    return { ok: results.every(r => r.ok), results, count: results.filter(r => r.ok).length };
  }

  function addDeckCardToHand(ctx, cardId, reason) {
    return ctx.move.addToHand({ cardId, controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.DECK }, reason: reason || 'circusmareDeckSearch' });
  }

  function summonFromZone(ctx, zone, cardId, reason, sourceController) {
    return ctx.move.summonCard({
      cardId,
      controller: ctx.controller,
      from: { controller: sourceController || ctx.controller, zone },
      reason: reason || 'circusmareSummon',
      eventData: { sourceZone: zone, summonType: 'effect', theme: '서커스메어' },
    });
  }

  function canAffectMonsterWithOpponentSend(ctx, target, targetController, reason) {
    const continuous = global.HB_CONTINUOUS_ENGINE;
    if (!target || !isMonster(target)) return false;
    if (!continuous) return true;
    const input = {
      gameState: ctx.gameState,
      target,
      card: target,
      targetController,
      actorController: ctx.controller,
      effect: ctx.effect,
      reason: reason || 'circusmareSendToGrave',
    };
    try {
      const immune = continuous.checkEffectImmunity && continuous.checkEffectImmunity(input);
      if (immune && immune.blocked) return false;
      const cannot = continuous.checkCannotBeSentToGrave && continuous.checkCannotBeSentToGrave(input);
      if (cannot && cannot.blocked) return false;
    } catch (err) {
      console.warn('[circusmare-effects] 내성 확인 실패:', err);
    }
    return true;
  }

  function sendableOpponentMonsters(ctx, reason) {
    const opponent = opponentOf(ctx.controller);
    return findField(ctx, isMonster, opponent).filter(card => canAffectMonsterWithOpponentSend(ctx, card, opponent, reason));
  }

  function sendOpponentMonsterToGrave(ctx, reason) {
    const opponent = opponentOf(ctx.controller);
    const target = firstOrSelected(ctx, sendableOpponentMonsters(ctx, reason));
    if (!target) return { ok: false, error: '묘지로 보낼 수 있는 상대 몬스터가 없습니다.' };
    return ctx.move.sendToGrave({ cardId: target.id, controller: opponent, from: { controller: opponent, zone: ZONES.FIELD }, reason: reason || 'circusmareSendOpponentMonster' });
  }

  function sendAllOpponentMonstersToGrave(ctx, reason) {
    const opponent = opponentOf(ctx.controller);
    const targets = sendableOpponentMonsters(ctx, reason).slice();
    const results = [];
    targets.forEach(card => {
      results.push(ctx.move.sendToGrave({ cardId: card.id, controller: opponent, from: { controller: opponent, zone: ZONES.FIELD }, reason: reason || 'circusmareSendAllOpponentMonsters' }));
    });
    if (results.length) logSafe(`서커스메어: 상대 몬스터 ${results.filter(r => r.ok).length}장을 묘지로 보냈습니다.`, 'mine');
    return { ok: results.every(r => r.ok), count: results.filter(r => r.ok).length, results };
  }

  function discardOpponentRandom(ctx, count, reason) {
    const opponent = opponentOf(ctx.controller);
    const hand = zoneArray(ctx, opponent, ZONES.HAND);
    const n = Math.min(Math.max(0, Number(count || 0)), hand.length);
    const results = [];
    for (let i = 0; i < n; i += 1) {
      const card = hand[0];
      if (!card) break;
      results.push(ctx.move.discardCard({ cardId: card.id, controller: opponent, reason: reason || 'circusmareOpponentDiscard' }));
    }
    if (n < count && typeof global.sendAction === 'function') {
      try { global.sendAction({ type: 'opDiscardRandom', count: count - n, reason: reason || '서커스메어 효과' }); } catch (_) {}
    }
    return { ok: true, count: n, results, requestedHiddenCount: Math.max(0, count - n) };
  }

  function discardOwnHand(ctx, count, reason) {
    const hand = zoneArray(ctx, ctx.controller, ZONES.HAND);
    const n = Math.min(count, hand.length);
    const results = [];
    for (let i = 0; i < n; i += 1) {
      const card = hand[0];
      if (!card) break;
      results.push(ctx.move.discardCard({ cardId: card.id, controller: ctx.controller, reason: reason || 'circusmareDiscard' }));
    }
    return { ok: results.every(r => r.ok), count: n, results };
  }

  function coinToss(ctx, n, label) {
    let heads = 0;
    const results = [];
    for (let i = 0; i < n; i += 1) {
      const head = ctx.random ? ctx.random() < 0.5 : Math.random() < 0.5;
      if (head) heads += 1;
      results.push(head ? '앞' : '뒤');
    }
    logSafe(`${label || '서커스메어'} 코인 ${n}회 → [${results.join(', ')}]`, 'mine');
    return { heads, tails: n - heads, results };
  }

  function adjustAtk(card, amount) {
    if (!card) return false;
    const base = Number(card.atk ?? getCardDef(card)?.atk ?? 0);
    card.atk = base + Number(amount || 0);
    return true;
  }

  function boostOwnField(ctx, amount, reason) {
    const field = findField(ctx, isMonster, ctx.controller);
    field.forEach(card => adjustAtk(card, amount));
    if (field.length) logSafe(`${reason || '서커스메어'}: 자신 필드 몬스터 공격력 +${amount}`, 'mine');
    renderAndSync();
    return { ok: true, count: field.length, amount };
  }

  function collectMaterialCandidates(ctx, zones, predicate) {
    const out = [];
    zones.forEach(zone => {
      zoneArray(ctx, ctx.controller, zone).forEach((card, index) => {
        if (!card || (predicate && !predicate(card))) return;
        out.push({ card, cardId: card.id, controller: ctx.controller, zone, index });
      });
    });
    return out;
  }

  function findExactMedMaterials(ctx, zones) {
    const candidates = collectMaterialCandidates(ctx, zones, isMedMonster);
    const selected = [];
    const used = new Set();
    for (let i = 0; i < MED_IDS.length; i += 1) {
      const id = MED_IDS[i];
      const foundIndex = candidates.findIndex((entry, index) => !used.has(index) && entry.cardId === id);
      if (foundIndex < 0) return null;
      used.add(foundIndex);
      selected.push(candidates[foundIndex]);
    }
    return selected;
  }

  function graveExileCircusmareCount(ctx) {
    return findGrave(ctx, isCircusmareCard).length + findExile(ctx, isCircusmareCard).length;
  }

  function getSelectedCardIds(ctx) {
    const out = [];
    const selected = (ctx && (ctx.selectedCards || ctx.selectedCardIds || ctx.materials)) || [];
    selected.forEach(item => {
      const id = typeof item === 'string' ? item : getCardId(item && (item.card || item));
      if (id) out.push(id);
    });
    return out;
  }

  function applySelectedMaterialPreference(ctx, materials, keyId) {
    const selectedIds = getSelectedCardIds(ctx);
    if (!selectedIds.length || !materials || !materials.length) return materials;
    const picked = [];
    const pool = materials.slice();
    selectedIds.forEach(id => {
      const index = pool.findIndex(entry => entry && entry.cardId === id);
      if (index >= 0) picked.push(pool.splice(index, 1)[0]);
    });
    const rule = KEY_SUMMON_RULES[keyId];
    if (!rule) return materials;
    if (rule.materialMode === 'exactMedFour') {
      const ids = picked.map(entry => entry.cardId).sort().join('|');
      const need = MED_IDS.slice().sort().join('|');
      return ids === need ? picked : materials;
    }
    if (rule.requiredCount && picked.length >= rule.requiredCount) return picked.slice(0, rule.requiredCount);
    return materials;
  }

  function materialsForKey(ctx, keyId, zones) {
    const key = getCardId(keyId);
    const rule = KEY_SUMMON_RULES[key];
    if (!rule || rule.materialMode === 'selfEffectOnly') return null;
    if (rule.materialMode === 'exactMedFour') {
      const exact = findExactMedMaterials(ctx, zones);
      return exact ? applySelectedMaterialPreference(ctx, exact, key) : null;
    }
    if (rule.materialMode === 'anyCircusmareMonsters') {
      const any = collectMaterialCandidates(ctx, zones, isCircusmareMonster).slice(0, rule.requiredCount);
      return any.length >= rule.requiredCount ? applySelectedMaterialPreference(ctx, any, key) : null;
    }
    if (rule.materialMode === 'anyCircusmareMonstersWithGraveExile12') {
      if (graveExileCircusmareCount(ctx) < 12) return null;
      const any = collectMaterialCandidates(ctx, zones, isCircusmareMonster).slice(0, rule.requiredCount);
      return any.length >= rule.requiredCount ? applySelectedMaterialPreference(ctx, any, key) : null;
    }
    return null;
  }

  function getKeySummonOptions(input) {
    const ctx = input && input.gameState ? global.HB_EFFECT_CONTEXT.createEffectContext(input) : input;
    if (!ctx) return [];
    const zones = (input && input.materialZones) || [ZONES.FIELD, ZONES.GRAVE, ZONES.HAND, ZONES.DECK, ZONES.EXILE];
    const allowSelfOnly = !!(input && input.allowSelfOnly);
    const keyDeck = zoneArray(ctx, ctx.controller, ZONES.KEY_DECK);
    return keyDeck
      .filter(card => isKeyCircusmareMonster(card) && (isGenericSummonableKey(card) || (allowSelfOnly && SELF_EFFECT_ONLY_KEY_IDS.indexOf(card.id) !== -1)))
      .map(card => ({ keyCard: card, keyCardId: card.id, materials: materialsForKey(ctx, card.id, zones) }))
      .filter(option => option.materials && option.materials.length > 0 && hasFieldSpace(ctx))
      .map(option => Object.freeze(option));
  }

  function chooseKeyOption(ctx, zones, preferredKeyId, allowSelfOnly) {
    const options = getKeySummonOptions(Object.assign({}, ctx, { materialZones: zones, allowSelfOnly: !!allowSelfOnly }));
    if (!options.length) return null;
    if (preferredKeyId) return options.find(opt => opt.keyCardId === preferredKeyId) || null;
    const selectedKeyId = ctx && (ctx.selectedKeyCardId || ctx.keyCardId);
    if (selectedKeyId) {
      const byExplicitKey = options.find(opt => opt.keyCardId === selectedKeyId);
      if (byExplicitKey) return byExplicitKey;
    }
    const selectedIds = getSelectedCardIds(ctx);
    if (selectedIds.length) {
      const bySelectedCard = options.find(opt => selectedIds.indexOf(opt.keyCardId) !== -1);
      if (bySelectedCard) return bySelectedCard;
    }
    return options[0];
  }

  function moveMaterial(ctx, material, destination, reason) {
    if (!material) return { ok: false, error: '소재가 없습니다.' };
    if (destination === ZONES.GRAVE) return ctx.move.sendToGrave({ cardId: material.cardId, controller: material.controller, from: { controller: material.controller, zone: material.zone }, reason });
    if (destination === ZONES.EXILE) return ctx.move.banishCard({ cardId: material.cardId, controller: material.controller, from: { controller: material.controller, zone: material.zone }, reason });
    if (destination === ZONES.DECK) {
      return ctx.move.moveCard({ cardId: material.cardId, controller: material.controller, from: { controller: material.controller, zone: material.zone }, to: { controller: material.controller, zone: ZONES.DECK }, reason });
    }
    return { ok: false, error: `지원하지 않는 소재 이동 목적지: ${destination}` };
  }

  function performKeySummon(ctx, option, materialDestination, reason) {
    if (!option || !option.keyCardId) return { ok: false, error: '소환 가능한 서커스메어 키 카드가 없습니다.' };
    const materialResults = option.materials.map(material => moveMaterial(ctx, material, materialDestination, reason || 'circusmareKeyMaterial'));
    if (!materialResults.every(r => r.ok)) return { ok: false, materialResults };
    const summon = ctx.move.summonCard({
      cardId: option.keyCardId,
      controller: ctx.controller,
      from: { controller: ctx.controller, zone: ZONES.KEY_DECK },
      reason: reason || 'circusmareKeySummon',
      eventData: { sourceZone: ZONES.KEY_DECK, summonType: 'keyCard', materials: option.materials.map(m => m.cardId) },
    });
    dispatchPending(ctx);
    return { ok: !!(summon && summon.ok), keyCardId: option.keyCardId, materials: option.materials.map(m => m.cardId), materialResults, summon };
  }

  function summonExactMedChimera(ctx, zones, destination, reason) {
    const option = chooseKeyOption(ctx, zones, '서커스메어 메드 키메라');
    return option ? performKeySummon(ctx, option, destination, reason || 'circusmareMedChimeraKeySummon') : { ok: false, error: '메드 키메라 소환 소재가 부족합니다.' };
  }

  function summonAllCircusmareFromZones(ctx, zones, reason, maxCount) {
    const limit = Math.min(maxCount == null ? 999 : maxCount, fieldSpaceCount(ctx));
    const results = [];
    if (limit <= 0) return { ok: false, error: '몬스터 존이 가득 찼습니다.' };
    for (let zi = 0; zi < zones.length; zi += 1) {
      const zone = zones[zi];
      const snapshot = zoneArray(ctx, ctx.controller, zone).filter(isCircusmareMonster).slice();
      for (let i = 0; i < snapshot.length && results.length < limit; i += 1) {
        const card = snapshot[i];
        if (!card || !zoneArray(ctx, ctx.controller, zone).some(c => c && c.id === card.id)) continue;
        results.push(summonFromZone(ctx, zone, card.id, reason || 'circusmareMassSummon'));
      }
      if (results.length >= limit) break;
    }
    dispatchPending(ctx);
    return { ok: results.length > 0 && results.every(r => r.ok), count: results.filter(r => r.ok).length, results };
  }

  function makeEffect(raw) { return Object.assign({ theme: '서커스메어', optional: true }, raw); }

  const effects = [
    // ── 메드 4종 ─────────────────────────────────────────────
    makeEffect({ id: 'cm-med-wolf-1-on-summon-search-bear', cardId: '서커스메어 메드 울프', effectNo: 1, text: '소환했을 경우 덱에서 메드 베어 1장을 패에 넣는다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SUMMON, timing: TIMING.ON_SUMMON, zone: ZONES.FIELD, tags: [TAGS.DECK_SEARCH], oncePerTurn: { key: '서커스메어 메드 울프_1', limit: 1 }, condition: ctx => cardMatchesEvent(ctx, '서커스메어 메드 울프'), canResolve: ctx => findDeck(ctx, c => c.id === '서커스메어 메드 베어').length > 0, resolve: ctx => addDeckCardToHand(ctx, '서커스메어 메드 베어', 'cmMedWolf1') }),
    makeEffect({ id: 'cm-med-wolf-2-boost-other', cardId: '서커스메어 메드 울프', effectNo: 2, text: '자신 전개 단계에 다른 서커스메어 몬스터 1장의 공격력을 3 올린다.', type: EFFECT_TYPES.ACTIVATION, timing: TIMING.MY_DEPLOY, zone: ZONES.FIELD, oncePerTurn: { key: '서커스메어 메드 울프_2', limit: 1 }, condition: ctx => isDeployPhase(ctx), canResolve: ctx => findField(ctx, c => isCircusmareMonster(c) && c.id !== '서커스메어 메드 울프').length > 0, resolve(ctx) { const target = firstOrSelected(ctx, findField(ctx, c => isCircusmareMonster(c) && c.id !== '서커스메어 메드 울프')); if (!target) return { ok: false, error: '대상 없음' }; adjustAtk(target, 3); renderAndSync(); return { ok: true, target: target.id, amount: 3 }; } }),

    makeEffect({ id: 'cm-med-bear-1-on-summon-search-eagle', cardId: '서커스메어 메드 베어', effectNo: 1, text: '소환했을 경우 덱에서 메드 이글 1장을 패에 넣는다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SUMMON, timing: TIMING.ON_SUMMON, zone: ZONES.FIELD, tags: [TAGS.DECK_SEARCH], oncePerTurn: { key: '서커스메어 메드 베어_1', limit: 1 }, condition: ctx => cardMatchesEvent(ctx, '서커스메어 메드 베어'), canResolve: ctx => findDeck(ctx, c => c.id === '서커스메어 메드 이글').length > 0, resolve: ctx => addDeckCardToHand(ctx, '서커스메어 메드 이글', 'cmMedBear1') }),
    makeEffect({ id: 'cm-med-bear-2-deck-summon', cardId: '서커스메어 메드 베어', effectNo: 2, text: '자신 전개 단계에 덱에서 서커스메어 몬스터 1장을 소환한다.', type: EFFECT_TYPES.ACTIVATION, timing: TIMING.MY_DEPLOY, zone: ZONES.FIELD, tags: [TAGS.DECK_SUMMON], oncePerTurn: { key: '서커스메어 메드 베어_2', limit: 1 }, condition: ctx => isDeployPhase(ctx), canResolve: ctx => hasFieldSpace(ctx) && findDeck(ctx, isCircusmareMonster).length > 0, resolve(ctx) { const target = firstOrSelected(ctx, findDeck(ctx, isCircusmareMonster)); return target ? summonFromZone(ctx, ZONES.DECK, target.id, 'cmMedBear2') : { ok: false, error: '덱에 서커스메어 몬스터 없음' }; } }),

    makeEffect({ id: 'cm-med-eagle-1-on-summon-search-seal', cardId: '서커스메어 메드 이글', effectNo: 1, text: '소환했을 경우 덱에서 메드 씰 1장을 패에 넣는다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SUMMON, timing: TIMING.ON_SUMMON, zone: ZONES.FIELD, tags: [TAGS.DECK_SEARCH], oncePerTurn: { key: '서커스메어 메드 이글_1', limit: 1 }, condition: ctx => cardMatchesEvent(ctx, '서커스메어 메드 이글'), canResolve: ctx => findDeck(ctx, c => c.id === '서커스메어 메드 씰').length > 0, resolve: ctx => addDeckCardToHand(ctx, '서커스메어 메드 씰', 'cmMedEagle1') }),
    makeEffect({ id: 'cm-med-eagle-2-grave-summon-two', cardId: '서커스메어 메드 이글', effectNo: 2, text: '자신/상대 전개 단계에 묘지의 서커스메어 몬스터를 2장까지 소환한다.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.FIELD, tags: [TAGS.GRAVE_SUMMON], oncePerTurn: { key: '서커스메어 메드 이글_2', limit: 1 }, condition: ctx => isDeployPhase(ctx), canResolve: ctx => fieldSpaceCount(ctx) > 0 && findGrave(ctx, isCircusmareMonster).length > 0, resolve: ctx => summonAllCircusmareFromZones(ctx, [ZONES.GRAVE], 'cmMedEagle2', Math.min(2, fieldSpaceCount(ctx))) }),

    makeEffect({ id: 'cm-med-seal-1-on-summon-search-wolf', cardId: '서커스메어 메드 씰', effectNo: 1, text: '소환했을 경우 덱에서 메드 울프 1장을 패에 넣는다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SUMMON, timing: TIMING.ON_SUMMON, zone: ZONES.FIELD, tags: [TAGS.DECK_SEARCH], oncePerTurn: { key: '서커스메어 메드 씰_1', limit: 1 }, condition: ctx => cardMatchesEvent(ctx, '서커스메어 메드 씰'), canResolve: ctx => findDeck(ctx, c => c.id === '서커스메어 메드 울프').length > 0, resolve: ctx => addDeckCardToHand(ctx, '서커스메어 메드 울프', 'cmMedSeal1') }),
    makeEffect({ id: 'cm-med-seal-2-public-hand-summon-three', cardId: '서커스메어 메드 씰', effectNo: 2, text: '공개 패에 넣어졌을 경우 패의 서커스메어 몬스터를 3장까지 소환한다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.ADDED_TO_HAND, timing: TIMING.NONE, zone: ZONES.PUBLIC_HAND, tags: [TAGS.HAND_SUMMON], oncePerTurn: { key: '서커스메어 메드 씰_2', limit: 1 }, condition(ctx) { const e = ctx.event || {}; return cardMatchesEvent(ctx, '서커스메어 메드 씰') && !!(e.eventData && e.eventData.reveal); }, canResolve: ctx => fieldSpaceCount(ctx) > 0 && findHand(ctx, isCircusmareMonster).length > 0, resolve: ctx => summonAllCircusmareFromZones(ctx, [ZONES.HAND], 'cmMedSeal2', Math.min(3, fieldSpaceCount(ctx))) }),

    // ── 일반 몬스터/키 카드 몬스터 ─────────────────────────────
    makeEffect({ id: 'cm-crown-dragon-1-coin-effect', cardId: '서커스메어 크라운 드래곤', effectNo: 1, text: '자신 전개 단계에 코인 토스를 실행해 앞면이면 상대 패 3장 버림, 뒷면이면 자신 몬스터 ATK+3.', type: EFFECT_TYPES.ACTIVATION, timing: TIMING.MY_DEPLOY, zone: ZONES.FIELD, tags: [TAGS.DISCARD_HAND], oncePerTurn: { key: '서커스메어 크라운 드래곤_1', limit: 2 }, condition: ctx => isDeployPhase(ctx), canResolve: () => true, resolve(ctx) { const toss = coinToss(ctx, 1, '크라운 드래곤 ①'); return toss.heads ? discardOpponentRandom(ctx, 3, 'cmCrownDragon1') : boostOwnField(ctx, 3, '크라운 드래곤 ①'); } }),
    makeEffect({ id: 'cm-crown-dragon-2-rewrite-opponent-effect', cardId: '서커스메어 크라운 드래곤', effectNo: 2, text: '상대가 효과를 발동했을 때 그 효과를 상대는 2장 드로우한다로 변형한다.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.FIELD, tags: ['rewriteEffect', TAGS.DRAW], oncePerTurn: { key: '서커스메어 크라운 드래곤_2', limit: 2 }, condition: ctx => !!ctx.chainLink || !!(global.HB_CHAIN_ENGINE && global.HB_CHAIN_ENGINE.hasActiveChain && global.HB_CHAIN_ENGINE.hasActiveChain()), canResolve: () => true, resolve(ctx) { try { if (typeof global.sendAction === 'function') global.sendAction({ type: 'opDraw', count: 2, reason: '크라운 드래곤 ②' }); } catch (_) {} logSafe('크라운 드래곤 ②: 상대 효과를 2장 드로우로 변형합니다.', 'mine'); return { ok: true, rewritten: true }; } }),
    makeEffect({ id: 'cm-crown-dragon-3-sent-to-grave-mass-summon', cardId: '서커스메어 크라운 드래곤', effectNo: 3, text: '묘지로 보내졌을 경우 패/덱/묘지/제외의 서커스메어 몬스터를 가능한 한 소환한다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SENT_TO_GRAVE, timing: TIMING.ON_SENT_TO_GRAVE, zone: ZONES.GRAVE, tags: [TAGS.HAND_SUMMON, TAGS.DECK_SUMMON, TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON], oncePerTurn: { key: '서커스메어 크라운 드래곤_3', limit: 2 }, condition: ctx => cardMatchesEvent(ctx, '서커스메어 크라운 드래곤'), canResolve: ctx => fieldSpaceCount(ctx) > 0 && collectMaterialCandidates(ctx, [ZONES.HAND, ZONES.DECK, ZONES.GRAVE, ZONES.EXILE], isCircusmareMonster).length > 0, resolve: ctx => summonAllCircusmareFromZones(ctx, [ZONES.HAND, ZONES.DECK, ZONES.GRAVE, ZONES.EXILE], 'cmCrownDragon3') }),

    makeEffect({ id: 'cm-spring-jester-procedure', cardId: '서커스메어 스프링 제스터', effectNo: 0, text: '서커스메어 일반/마법/함정/필드 카드 효과로 서커스메어 몬스터 3장을 소재 처리한 경우에만 키 카드 덱에서 소환할 수 있다.', type: EFFECT_TYPES.PROCEDURE, zone: ZONES.KEY_DECK, summonProcedure: { materialCount: 3, materialPredicate: 'circusmareMonster' } }),
    makeEffect({ id: 'cm-spring-jester-1-on-summon-send-opponent-only', cardId: '서커스메어 스프링 제스터', effectNo: 1, text: '소환했을 경우 상대 필드의 몬스터를 전부 묘지로 보낸다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SUMMON, timing: TIMING.ON_SUMMON, zone: ZONES.FIELD, tags: [TAGS.SEND_OPPONENT_MONSTERS_TO_GRAVE, 'noResponse'], oncePerTurn: { key: '서커스메어 스프링 제스터_1', limit: 1 }, condition: ctx => cardMatchesEvent(ctx, '서커스메어 스프링 제스터'), canResolve: ctx => sendableOpponentMonsters(ctx, 'cmSpringJester1').length > 0, resolve: ctx => sendAllOpponentMonstersToGrave(ctx, 'cmSpringJester1') }),
    makeEffect({ id: 'cm-spring-jester-2-grave-attack-up', cardId: '서커스메어 스프링 제스터', effectNo: 2, text: '자신 묘지의 서커스메어 몬스터 1장당 공격력 1 상승.', type: EFFECT_TYPES.CONTINUOUS, zone: ZONES.FIELD, continuousRule(ctx) { return { attackModifier(checkCtx) { const targetId = getCardId(checkCtx.target || checkCtx.card); if (targetId !== '서커스메어 스프링 제스터') return 0; return findGrave(ctx, isCircusmareMonster).length; } }; } }),
    makeEffect({ id: 'cm-spring-jester-3-grave-banish-summon-crown', cardId: '서커스메어 스프링 제스터', effectNo: 3, text: '묘지로 보내졌을 경우 이 카드를 제외하고 크라운 드래곤 1장을 소환한다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SENT_TO_GRAVE, timing: TIMING.ON_SENT_TO_GRAVE, zone: ZONES.GRAVE, tags: [TAGS.COST_BANISH, TAGS.HAND_SUMMON, TAGS.DECK_SUMMON, TAGS.GRAVE_SUMMON], condition: ctx => cardMatchesEvent(ctx, '서커스메어 스프링 제스터'), canResolve: ctx => hasFieldSpace(ctx) && ['hand', 'deck', 'grave'].some(z => zoneArray(ctx, ctx.controller, z).some(c => c && c.id === '서커스메어 크라운 드래곤')), cost: ctx => ctx.move.banishCard({ cardId: '서커스메어 스프링 제스터', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'cmSpringJester3Cost' }), resolve(ctx) { const zones = [ZONES.HAND, ZONES.DECK, ZONES.GRAVE]; for (let i = 0; i < zones.length; i += 1) { if (zoneArray(ctx, ctx.controller, zones[i]).some(c => c && c.id === '서커스메어 크라운 드래곤')) return summonFromZone(ctx, zones[i], '서커스메어 크라운 드래곤', 'cmSpringJester3'); } return { ok: false, error: '크라운 드래곤 없음' }; } }),
    makeEffect({ id: 'cm-spring-jester-4-opponent-effect-immunity', cardId: '서커스메어 스프링 제스터', effectNo: 4, text: '이 카드는 상대가 발동한 효과를 받지 않는다.', type: EFFECT_TYPES.CONTINUOUS, zone: ZONES.FIELD, continuousRule: { effectImmunity: { cardId: '서커스메어 스프링 제스터', byOpponentOnly: true } } }),

    makeEffect({ id: 'cm-med-chimera-procedure-exact-med-four', cardId: '서커스메어 메드 키메라', effectNo: 0, text: '메드 울프/베어/이글/씰을 소재 처리한 경우에만 키 카드 덱에서 소환할 수 있다.', type: EFFECT_TYPES.PROCEDURE, zone: ZONES.KEY_DECK, summonProcedure: { exactMaterialIds: MED_IDS.slice() } }),
    makeEffect({ id: 'cm-med-chimera-1-continuous-protection', cardId: '서커스메어 메드 키메라', effectNo: 1, text: '자신 필드의 서커스메어 몬스터는 상대 효과의 대상이 되지 않고 효과로 묘지로 보내지지 않는다.', type: EFFECT_TYPES.CONTINUOUS, zone: ZONES.FIELD, continuousRule: { targetProtection: { theme: '서커스메어', ownCardsOnly: true, byOpponentOnly: true }, cannotBeSentToGrave: { theme: '서커스메어', ownCardsOnly: true, byOpponentOnly: true } } }),
    makeEffect({ id: 'cm-med-chimera-2-quick-attack-gain', cardId: '서커스메어 메드 키메라', effectNo: 2, text: '자신/상대 턴에 서커스메어 몬스터 1장의 원래 공격력만큼 이 카드의 공격력을 올린다.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.FIELD, oncePerTurn: { key: '서커스메어 메드 키메라_2', limit: 1 }, condition: () => true, canResolve: ctx => findField(ctx, isCircusmareMonster).length > 0, resolve(ctx) { const target = firstOrSelected(ctx, findField(ctx, isCircusmareMonster)); const self = findField(ctx, c => c.id === '서커스메어 메드 키메라')[0]; if (!target || !self) return { ok: false, error: '대상 또는 키메라 없음' }; const amount = Number((target.atkBase ?? getCardDef(target)?.atk ?? target.atk) || 0); adjustAtk(self, amount); renderAndSync(); return { ok: true, amount, target: target.id }; } }),
    makeEffect({ id: 'cm-med-chimera-3-sent-to-grave-revive-med-four', cardId: '서커스메어 메드 키메라', effectNo: 3, text: '묘지로 보내졌을 경우 묘지/제외의 메드 4종을 소환한다.', type: EFFECT_TYPES.TRIGGER, event: EVENTS.SENT_TO_GRAVE, timing: TIMING.ON_SENT_TO_GRAVE, zone: ZONES.GRAVE, tags: [TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON], condition: ctx => cardMatchesEvent(ctx, '서커스메어 메드 키메라'), canResolve(ctx) { return fieldSpaceCount(ctx) > 0 && MED_IDS.some(id => findGrave(ctx, c => c.id === id).length || findExile(ctx, c => c.id === id).length); }, resolve(ctx) { const results = []; MED_IDS.forEach(id => { if (results.length >= fieldSpaceCount(ctx)) return; if (findGrave(ctx, c => c.id === id).length) results.push(summonFromZone(ctx, ZONES.GRAVE, id, 'cmMedChimera3')); else if (findExile(ctx, c => c.id === id).length) results.push(summonFromZone(ctx, ZONES.EXILE, id, 'cmMedChimera3')); }); return { ok: results.length > 0 && results.every(r => r.ok), results }; } }),

    makeEffect({ id: 'cm-coin-jester-procedure-self-effect-only', cardId: '서커스메어 코인 제스터', effectNo: 0, text: '이 카드의 효과로만 키 카드 덱에서 소환할 수 있다.', type: EFFECT_TYPES.PROCEDURE, zone: ZONES.KEY_DECK }),
    makeEffect({ id: 'cm-coin-jester-1-chain-summon-coin', cardId: '서커스메어 코인 제스터', effectNo: 1, text: '상대 효과 발동 시 이 카드를 소환하고 코인 3회 효과를 적용한다.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.KEY_DECK, tags: [TAGS.KEY_DECK_SUMMON], oncePerTurn: { key: '서커스메어 코인 제스터_1', limit: 1 }, condition: ctx => !!ctx.chainLink || !!(global.HB_CHAIN_ENGINE && global.HB_CHAIN_ENGINE.hasActiveChain && global.HB_CHAIN_ENGINE.hasActiveChain()), canResolve: ctx => hasFieldSpace(ctx) && zoneArray(ctx, ctx.controller, ZONES.KEY_DECK).some(c => c.id === '서커스메어 코인 제스터'), resolve(ctx) { const summon = summonFromZone(ctx, ZONES.KEY_DECK, '서커스메어 코인 제스터', 'cmCoinJester1'); const toss = coinToss(ctx, 3, '코인 제스터 ①'); for (let i = 0; i < toss.heads; i += 1) sendOpponentMonsterToGrave(ctx, 'cmCoinJester1'); if (toss.heads === 3) ctx.gameState._cmCoinJesterLock = true; return { ok: summon.ok, summon, toss }; } }),
    makeEffect({ id: 'cm-coin-jester-2-field-coin', cardId: '서커스메어 코인 제스터', effectNo: 2, text: '자신/상대 턴에 코인 토스 1회. 앞면이면 상대 몬스터 1장 효과 무효, 뒷면이면 1장 드로우.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.FIELD, oncePerTurn: { key: '서커스메어 코인 제스터_2', limit: 1 }, condition: () => true, canResolve: ctx => canDraw(ctx, 1) || findField(ctx, isMonster, opponentOf(ctx.controller)).length > 0, resolve(ctx) { const toss = coinToss(ctx, 1, '코인 제스터 ②'); if (toss.heads) { const target = firstOrSelected(ctx, findField(ctx, isMonster, opponentOf(ctx.controller))); if (target) target.negatedUntilEnd = true; renderAndSync(); return { ok: true, toss, negated: target && target.id }; } return drawOne(ctx); } }),

    makeEffect({ id: 'cm-mask-jester-procedure-self-effect-only', cardId: '서커스메어 마스크 제스터', effectNo: 0, text: '이 카드의 효과로만 키 카드 덱에서 소환할 수 있다.', type: EFFECT_TYPES.PROCEDURE, zone: ZONES.KEY_DECK }),
    makeEffect({ id: 'cm-mask-jester-1-chain-summon-coin', cardId: '서커스메어 마스크 제스터', effectNo: 1, text: '상대 효과 발동 시 이 카드를 소환하고 앞면 수만큼 덱 덤핑, 뒷면 수까지 묘지 회수.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.KEY_DECK, tags: [TAGS.KEY_DECK_SUMMON], oncePerTurn: { key: '서커스메어 마스크 제스터_1', limit: 1 }, condition: ctx => !!ctx.chainLink || !!(global.HB_CHAIN_ENGINE && global.HB_CHAIN_ENGINE.hasActiveChain && global.HB_CHAIN_ENGINE.hasActiveChain()), canResolve: ctx => hasFieldSpace(ctx) && zoneArray(ctx, ctx.controller, ZONES.KEY_DECK).some(c => c.id === '서커스메어 마스크 제스터'), resolve(ctx) { const summon = summonFromZone(ctx, ZONES.KEY_DECK, '서커스메어 마스크 제스터', 'cmMaskJester1'); const toss = coinToss(ctx, 3, '마스크 제스터 ①'); const dumps = []; for (let i = 0; i < toss.heads; i += 1) { const target = findDeck(ctx, isCircusmareCard)[0]; if (target) dumps.push(ctx.move.sendToGrave({ cardId: target.id, controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.DECK }, reason: 'cmMaskJester1Dump' })); } const recovers = []; for (let i = 0; i < toss.tails; i += 1) { const target = findGrave(ctx, isCircusmareCard)[0]; if (target) recovers.push(ctx.move.addToHand({ cardId: target.id, controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'cmMaskJester1Recover' })); } return { ok: summon.ok, summon, toss, dumps, recovers }; } }),
    makeEffect({ id: 'cm-mask-jester-2-name-change-negate', cardId: '서커스메어 마스크 제스터', effectNo: 2, text: '상대 몬스터 1장의 이름을 희생자로 취급하고 효과를 무효화한다.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.FIELD, oncePerTurn: { key: '서커스메어 마스크 제스터_2', limit: 1 }, condition: () => true, canResolve: ctx => findField(ctx, isMonster, opponentOf(ctx.controller)).length > 0, resolve(ctx) { const target = firstOrSelected(ctx, findField(ctx, isMonster, opponentOf(ctx.controller))); if (!target) return { ok: false, error: '상대 몬스터 없음' }; target.originalName = target.originalName || target.name || target.id; target.name = '서커스메어의 희생자'; target.negatedUntilEnd = true; renderAndSync(); return { ok: true, target: target.id }; } }),

    makeEffect({ id: 'cm-puppet-master-procedure', cardId: '서커스메어 퍼핏 마스터', effectNo: 0, text: '묘지/제외 서커스메어 12장 이상, 서커스메어 몬스터 5장 소재 처리 시 소환 가능.', type: EFFECT_TYPES.PROCEDURE, zone: ZONES.KEY_DECK, summonProcedure: { materialCount: 5, graveExileCircusmareCountAtLeast: 12 } }),
    makeEffect({ id: 'cm-puppet-master-1-send-field-apply', cardId: '서커스메어 퍼핏 마스터', effectNo: 1, text: '필드 몬스터를 원하는 수만큼 묘지로 보내고 수에 따라 효과 적용.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.FIELD, tags: [TAGS.COST_SEND_TO_GRAVE], oncePerTurn: { key: '서커스메어 퍼핏 마스터_1', limit: 1 }, condition: () => true, canResolve: ctx => findField(ctx, isMonster).length > 0, cost(ctx) { const materials = findField(ctx, isMonster).slice(0, Math.min(5, findField(ctx, isMonster).length)); const results = materials.map(card => ctx.move.sendToGrave({ cardId: card.id, controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.FIELD }, reason: 'cmPuppetMaster1Cost' })); ctx._cmPuppetMasterSentCount = results.filter(r => r.ok).length; return { ok: results.every(r => r.ok), count: ctx._cmPuppetMasterSentCount, results }; }, resolve(ctx) { const count = ctx._cmPuppetMasterSentCount || 0; const results = []; if (count >= 1) results.push(discardOpponentRandom(ctx, 1, 'cmPuppetMaster1')); if (count >= 3) { const option = chooseKeyOption(ctx, [ZONES.FIELD], null, false); if (option) results.push(performKeySummon(ctx, option, ZONES.DECK, 'cmPuppetMaster1KeySummon')); } if (count >= 5) { const opponent = opponentOf(ctx.controller); const banished = []; [ZONES.FIELD, ZONES.GRAVE].forEach(zone => zoneArray(ctx, opponent, zone).slice().forEach(card => banished.push(ctx.move.banishCard({ cardId: card.id, controller: opponent, from: { controller: opponent, zone }, reason: 'cmPuppetMaster1BanishAll' })))); results.push({ ok: true, banished }); } return { ok: true, count, results }; } }),
    makeEffect({ id: 'cm-puppet-master-2-left-field-revive', cardId: '서커스메어 퍼핏 마스터', effectNo: 2, text: '필드에서 벗어났을 경우 묘지의 퍼핏 마스터 이외 서커스메어 몬스터를 가능한 한 소환한다.', type: EFFECT_TYPES.TRIGGER, event: [EVENTS.SENT_TO_GRAVE, EVENTS.EXILED], timing: TIMING.ON_SENT_TO_GRAVE, zone: [ZONES.GRAVE, ZONES.EXILE], condition(ctx) { const e = ctx.event || {}; const fromZone = (e.from && e.from.zone) || e.sourceZone || (e.eventData && e.eventData.sourceZone); return cardMatchesEvent(ctx, '서커스메어 퍼핏 마스터') && fromZone === ZONES.FIELD; }, canResolve: ctx => fieldSpaceCount(ctx) > 0 && findGrave(ctx, c => isCircusmareMonster(c) && c.id !== '서커스메어 퍼핏 마스터').length > 0, resolve: ctx => summonAllCircusmareFromZones(ctx, [ZONES.GRAVE], 'cmPuppetMaster2') }),

    // ── 필드/마법/함정/일반 ───────────────────────────────────
    makeEffect({ id: 'cm-nightmare-circus-1-field-protection', cardId: '악몽의 서커스장', effectNo: 1, text: '필드 존의 이 카드는 상대 효과로 묘지로 보내지지 않는다.', type: EFFECT_TYPES.CONTINUOUS, zone: ZONES.FIELD_ZONE, continuousRule: { cannotBeSentToGrave: { cardId: '악몽의 서커스장', byOpponentOnly: true } } }),
    makeEffect({ id: 'cm-nightmare-circus-2-field-search', cardId: '악몽의 서커스장', effectNo: 2, text: '자신 전개 단계에 덱에서 서커스메어 카드 1장을 패에 넣는다.', type: EFFECT_TYPES.ACTIVATION, timing: TIMING.MY_DEPLOY, zone: ZONES.FIELD_ZONE, tags: [TAGS.DECK_SEARCH, TAGS.FIELD_ZONE_EFFECT], oncePerTurn: { key: '악몽의 서커스장_2', limit: 1 }, condition: ctx => isDeployPhase(ctx), canResolve: ctx => findDeck(ctx, isCircusmareCard).length > 0, resolve(ctx) { const target = firstOrSelected(ctx, findDeck(ctx, isCircusmareCard)); return target ? addDeckCardToHand(ctx, target.id, 'cmNightmareCircus2') : { ok: false, error: '덱에 서커스메어 카드 없음' }; } }),
    makeEffect({ id: 'cm-nightmare-circus-3-mill-draw', cardId: '악몽의 서커스장', effectNo: 3, text: '자신 전개 단계에 덱 위 3장을 묘지로 보내고 그 중 서커스메어 수까지 드로우.', type: EFFECT_TYPES.ACTIVATION, timing: TIMING.MY_DEPLOY, zone: ZONES.FIELD_ZONE, tags: [TAGS.DRAW, TAGS.FIELD_ZONE_EFFECT], oncePerTurn: { key: '악몽의 서커스장_3', limit: 1 }, condition: ctx => isDeployPhase(ctx), canResolve: ctx => zoneArray(ctx, ctx.controller, ZONES.DECK).length >= 3, resolve(ctx) { const milled = []; for (let i = 0; i < 3; i += 1) { const top = zoneArray(ctx, ctx.controller, ZONES.DECK)[0]; if (top) { milled.push(top); ctx.move.sendToGrave({ cardId: top.id, controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.DECK }, reason: 'cmNightmareCircus3Mill' }); } } const drawCount = milled.filter(isCircusmareCard).length; const draw = drawN(ctx, Math.min(drawCount, zoneArray(ctx, ctx.controller, ZONES.DECK).length)); return { ok: true, milled: milled.map(getCardId), draw }; } }),
    makeEffect({ id: 'cm-nightmare-circus-4-key-summon-exile', cardId: '악몽의 서커스장', effectNo: 4, text: '자신/상대 전개 단계에 필드/묘지의 소재를 제외하고 서커스메어 키 카드 몬스터 1장을 소환한다.', type: EFFECT_TYPES.QUICK, timing: TIMING.EITHER_TURN, zone: ZONES.FIELD_ZONE, tags: [TAGS.KEY_DECK_SUMMON, TAGS.COST_BANISH, TAGS.FIELD_ZONE_EFFECT], oncePerTurn: { key: '악몽의 서커스장_4', limit: 1 }, condition: ctx => isDeployPhase(ctx), canResolve: ctx => chooseKeyOption(ctx, [ZONES.FIELD, ZONES.GRAVE]) != null, resolve(ctx) { const option = chooseKeyOption(ctx, [ZONES.FIELD, ZONES.GRAVE]); return performKeySummon(ctx, option, ZONES.EXILE, 'cmNightmareCircus4'); } }),

    makeEffect({ id: 'cm-fusion-1-hand-field-grave-key-summon', cardId: '서커스메어 퓨전', effectNo: 1, text: '자신/상대 전개 턴에 패/필드 소재를 묘지로 보내고 키 카드 몬스터를 소환한다.', type: EFFECT_TYPES.QUICK, cardActivationCost: true, timing: TIMING.EITHER_TURN, zone: ZONES.HAND, tags: [TAGS.KEY_DECK_SUMMON, TAGS.COST_SEND_TO_GRAVE], condition: ctx => isDeployPhase(ctx), canResolve: ctx => chooseKeyOption(ctx, [ZONES.HAND, ZONES.FIELD]) != null, resolve(ctx) { const option = chooseKeyOption(ctx, [ZONES.HAND, ZONES.FIELD]); const result = performKeySummon(ctx, option, ZONES.GRAVE, 'cmFusion1'); if (result.ok) ctx.move.sendToGrave({ cardId: '서커스메어 퓨전', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.HAND }, reason: 'cmFusion1Resolved' }); return result; } }),
    makeEffect({ id: 'cm-fusion-2-grave-banish-three-recover', cardId: '서커스메어 퓨전', effectNo: 2, text: '묘지의 서커스메어 몬스터 3장을 제외하고 이 카드를 패에 넣는다.', type: EFFECT_TYPES.ACTIVATION, zone: ZONES.GRAVE, tags: [TAGS.COST_BANISH], oncePerTurn: { key: '서커스메어 퓨전_2', limit: 2 }, condition: () => true, canResolve: ctx => findGrave(ctx, isCircusmareMonster).length >= 3 && findGrave(ctx, c => c.id === '서커스메어 퓨전').length > 0, cost(ctx) { const mats = findGrave(ctx, isCircusmareMonster).slice(0, 3); const results = mats.map(card => ctx.move.banishCard({ cardId: card.id, controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'cmFusion2Cost' })); return { ok: results.every(r => r.ok), results }; }, resolve: ctx => ctx.move.addToHand({ cardId: '서커스메어 퓨전', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'cmFusion2Recover' }) }),

    makeEffect({ id: 'cm-med-parade-1-exact-med-exile-summon-chimera', cardId: '서커스메어 메드 퍼레이드', effectNo: 1, text: '메드 4종을 각각 1장씩 제외하고 키 카드 덱에서 메드 키메라 1장을 소환한다.', type: EFFECT_TYPES.ACTIVATION, cardActivationCost: true, timing: TIMING.MY_DEPLOY, zone: ZONES.HAND, tags: [TAGS.KEY_DECK_SUMMON, TAGS.COST_BANISH], oncePerTurn: { key: '서커스메어 메드 퍼레이드_1', limit: 1 }, condition: ctx => isDeployPhase(ctx), canResolve: ctx => findExactMedMaterials(ctx, [ZONES.HAND, ZONES.DECK, ZONES.FIELD, ZONES.GRAVE]) && hasFieldSpace(ctx) && zoneArray(ctx, ctx.controller, ZONES.KEY_DECK).some(c => c.id === '서커스메어 메드 키메라'), resolve(ctx) { const result = summonExactMedChimera(ctx, [ZONES.HAND, ZONES.DECK, ZONES.FIELD, ZONES.GRAVE], ZONES.EXILE, 'cmMedParade1'); if (result.ok) ctx.move.sendToGrave({ cardId: '서커스메어 메드 퍼레이드', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.HAND }, reason: 'cmMedParade1Resolved' }); return result; } }),
    makeEffect({ id: 'cm-med-parade-2-grave-replacement', cardId: '서커스메어 메드 퍼레이드', effectNo: 2, text: '상대 효과로 자신 필드 몬스터가 묘지로 보내질 시기에 대신 묘지의 이 카드를 제외할 수 있다.', type: EFFECT_TYPES.REPLACEMENT, zone: ZONES.GRAVE, tags: ['replacement', TAGS.COST_BANISH], oncePerTurn: { key: '서커스메어 메드 퍼레이드_2', limit: 1 }, condition: ctx => findGrave(ctx, c => c.id === '서커스메어 메드 퍼레이드').length > 0, resolve: ctx => ctx.move.banishCard({ cardId: '서커스메어 메드 퍼레이드', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'cmMedParade2Replacement' }) }),

    makeEffect({ id: 'cm-nightmare-fusion-1-deck-material-key-summon', cardId: '악몽 융합', effectNo: 1, text: '덱의 소재를 묘지로 보내고 키 카드 덱의 서커스메어 몬스터 1장을 소환한다.', type: EFFECT_TYPES.ACTIVATION, cardActivationCost: true, zone: ZONES.HAND, tags: [TAGS.KEY_DECK_SUMMON, TAGS.COST_SEND_TO_GRAVE], oncePerTurn: { scope: 'game', key: '악몽 융합_1', limit: 2 }, condition: () => true, canResolve: ctx => chooseKeyOption(ctx, [ZONES.DECK]) != null, resolve(ctx) { const option = chooseKeyOption(ctx, [ZONES.DECK]); const result = performKeySummon(ctx, option, ZONES.GRAVE, 'cmNightmareFusion1'); if (result.ok) ctx.move.sendToGrave({ cardId: '악몽 융합', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.HAND }, reason: 'cmNightmareFusion1Resolved' }); return result; } }),

    makeEffect({ id: 'cm-wild-circus-1-opponent-turn-key-summon', cardId: '광란의 서커스', effectNo: 1, text: '상대 턴에 묘지/제외 소재를 덱으로 되돌리고 키 카드 몬스터를 소환한다.', type: EFFECT_TYPES.QUICK, cardActivationCost: true, timing: TIMING.OPPONENT_TURN, zone: ZONES.HAND, tags: [TAGS.KEY_DECK_SUMMON], oncePerTurn: { key: '광란의 서커스_1', limit: 1 }, condition: ctx => !isMyTurnFallback(ctx), canResolve: ctx => chooseKeyOption(ctx, [ZONES.GRAVE, ZONES.EXILE]) != null, resolve(ctx) { const option = chooseKeyOption(ctx, [ZONES.GRAVE, ZONES.EXILE]); const result = performKeySummon(ctx, option, ZONES.DECK, 'cmWildCircus1'); if (result.ok) ctx.move.sendToGrave({ cardId: '광란의 서커스', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.HAND }, reason: 'cmWildCircus1Resolved' }); return result; } }),
    makeEffect({ id: 'cm-wild-circus-2-grave-banish-draw', cardId: '광란의 서커스', effectNo: 2, text: '묘지의 이 카드를 제외하고 1장 드로우한다.', type: EFFECT_TYPES.ACTIVATION, zone: ZONES.GRAVE, tags: [TAGS.COST_BANISH, TAGS.DRAW], condition: () => true, canResolve: ctx => findGrave(ctx, c => c.id === '광란의 서커스').length > 0 && canDraw(ctx, 1), cost: ctx => ctx.move.banishCard({ cardId: '광란의 서커스', controller: ctx.controller, from: { controller: ctx.controller, zone: ZONES.GRAVE }, reason: 'cmWildCircus2Cost' }), resolve: ctx => drawOne(ctx) }),
  ];

  const registered = registry.registerEffects(effects);
  registry.syncEffectIdsToCards();

  function getCircusmareEffectIds() { return effects.map(effect => effect.id); }
  function getCircusmareCards() { const cards = getCardDatabase() || {}; return Object.keys(cards).filter(id => isCircusmareCard(id)); }
  function getMedMaterialIds() { return MED_IDS.slice(); }
  function getKeySummonRules() { return KEY_SUMMON_RULES; }

  function getCircusmareImplementationSpec() {
    return Object.freeze({
      phase: '16-2 clarified',
      keyRules: KEY_SUMMON_RULES,
      criticalChecks: Object.freeze([
        '스프링 제스터 ①은 상대 필드 몬스터만 묘지로 보낸다.',
        '메드 키메라 ①은 continuous이며 버튼/유발 후보가 아니다.',
        '메드 키메라 소재는 메드 울프/베어/이글/씰 각각 1장으로 고정한다.',
        '처리 불가능한 서치/소환/묘지 이동 효과는 canResolve에서 발동 전 차단한다.',
        '악몽의 서커스장 ②/③/④만 필드 존 버튼으로 보이고 ①은 지속 효과로 숨긴다.',
      ]),
      cards: Object.freeze({
        '서커스메어 메드 울프': Object.freeze(['cm-med-wolf-1-on-summon-search-bear', 'cm-med-wolf-2-boost-other']),
        '서커스메어 메드 베어': Object.freeze(['cm-med-bear-1-on-summon-search-eagle', 'cm-med-bear-2-deck-summon']),
        '서커스메어 메드 이글': Object.freeze(['cm-med-eagle-1-on-summon-search-seal', 'cm-med-eagle-2-grave-summon-two']),
        '서커스메어 메드 씰': Object.freeze(['cm-med-seal-1-on-summon-search-wolf', 'cm-med-seal-2-public-hand-summon-three']),
        '서커스메어 스프링 제스터': Object.freeze(['cm-spring-jester-procedure', 'cm-spring-jester-1-on-summon-send-opponent-only', 'cm-spring-jester-2-grave-atk-continuous', 'cm-spring-jester-3-grave-exile-summon-crown', 'cm-spring-jester-4-effect-immunity']),
        '서커스메어 메드 키메라': Object.freeze(['cm-med-chimera-procedure', 'cm-med-chimera-1-continuous-protection', 'cm-med-chimera-2-boost-self', 'cm-med-chimera-3-revive-med-four']),
        '악몽의 서커스장': Object.freeze(['cm-nightmare-circus-1-field-protection', 'cm-nightmare-circus-2-field-search', 'cm-nightmare-circus-3-mill-draw', 'cm-nightmare-circus-4-key-summon-exile']),
      }),
    });
  }

  global.HB_CIRCUSMARE_EFFECTS = Object.freeze({
    effects: registered,
    getCircusmareEffectIds,
    getCircusmareCards,
    getMedMaterialIds,
    getKeySummonRules,
    getCircusmareImplementationSpec,
    isCircusmareCard,
    isCircusmareMonster,
    isMedMonster,
    getKeySummonOptions,
    materialsForKey,
    findExactMedMaterials,
    sendableOpponentMonsters,
    dispatchPending,
  });
})(window);