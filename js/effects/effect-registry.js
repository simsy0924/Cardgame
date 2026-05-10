// HAND BATTLE — Effects: Effect Registry
// EffectDefinition을 카드별/존별/타입별/이벤트별로 조회하기 위한 중앙 등록소.
// 이 파일은 기존 텍스트 파싱 효과를 실행하지 않고, 새 효과 엔진의 데이터 통로만 제공한다.
(function initEffectRegistry(global) {
  'use strict';

  const definition = global.HB_EFFECT_DEFINITION;
  if (!definition) {
    throw new Error('[effect-registry] HB_EFFECT_DEFINITION이 필요합니다. effect-definition.js를 먼저 로드하세요.');
  }

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({
    TRIGGER: 'trigger',
    CONTINUOUS: 'continuous',
    PROCEDURE: 'procedure',
  });

  const effectsById = new Map();
  const effectIdsByCardId = new Map();
  const effectIdsByType = new Map();
  const effectIdsByZone = new Map();
  const effectIdsByEvent = new Map();
  const continuousEffectIds = new Set();
  const procedureEffectIdsByCardId = new Map();

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function getOrCreateSet(map, key) {
    const normalizedKey = String(key);
    if (!map.has(normalizedKey)) map.set(normalizedKey, new Set());
    return map.get(normalizedKey);
  }

  function addToIndex(map, key, effectId) {
    if (key == null || key === '') return;
    getOrCreateSet(map, key).add(effectId);
  }

  function removeFromIndex(map, key, effectId) {
    if (key == null || key === '') return;
    const normalizedKey = String(key);
    const set = map.get(normalizedKey);
    if (!set) return;
    set.delete(effectId);
    if (set.size === 0) map.delete(normalizedKey);
  }

  function idsToEffects(ids) {
    return Array.from(ids || [])
      .map(id => effectsById.get(id))
      .filter(Boolean);
  }

  function indexEffect(effect) {
    addToIndex(effectIdsByCardId, effect.cardId, effect.id);
    addToIndex(effectIdsByType, effect.type, effect.id);

    (effect.zones || asArray(effect.zone)).forEach(zone => addToIndex(effectIdsByZone, zone, effect.id));
    (effect.events || asArray(effect.event)).forEach(eventType => addToIndex(effectIdsByEvent, eventType, effect.id));

    if (definition.isContinuousEffect(effect)) continuousEffectIds.add(effect.id);
    if (definition.isProcedureEffect(effect)) addToIndex(procedureEffectIdsByCardId, effect.cardId, effect.id);
  }

  function unindexEffect(effect) {
    if (!effect) return;
    removeFromIndex(effectIdsByCardId, effect.cardId, effect.id);
    removeFromIndex(effectIdsByType, effect.type, effect.id);

    (effect.zones || asArray(effect.zone)).forEach(zone => removeFromIndex(effectIdsByZone, zone, effect.id));
    (effect.events || asArray(effect.event)).forEach(eventType => removeFromIndex(effectIdsByEvent, eventType, effect.id));

    continuousEffectIds.delete(effect.id);
    removeFromIndex(procedureEffectIdsByCardId, effect.cardId, effect.id);
  }

  function registerEffect(effectDefinition, options) {
    const opts = options || {};
    const effect = definition.normalizeEffectDefinition(effectDefinition);
    const existing = effectsById.get(effect.id);

    if (existing && !opts.replace) {
      throw new Error(`[effect-registry] 이미 등록된 effect id입니다: ${effect.id}`);
    }

    if (existing) {
      unindexEffect(existing);
      unsyncCardEffectId(existing.cardId, existing.id);
    }

    effectsById.set(effect.id, effect);
    indexEffect(effect);
    syncCardEffectId(effect.cardId, effect.id);

    return effect;
  }

  function registerEffects(effectDefinitions, options) {
    if (!Array.isArray(effectDefinitions)) {
      throw new Error('[effect-registry] registerEffects에는 배열이 필요합니다.');
    }
    const registered = [];
    effectDefinitions.forEach(raw => {
      registered.push(registerEffect(raw, options));
    });
    return Object.freeze(registered);
  }

  function unregisterEffect(effectId) {
    const id = String(effectId);
    const effect = effectsById.get(id);
    if (!effect) return false;
    unindexEffect(effect);
    effectsById.delete(id);
    unsyncCardEffectId(effect.cardId, id);
    return true;
  }

  function getEffectById(effectId) {
    if (!effectId) return null;
    return effectsById.get(String(effectId)) || null;
  }

  function getEffectsByCardId(cardId) {
    if (!cardId) return [];
    return idsToEffects(effectIdsByCardId.get(String(cardId)));
  }

  function getEffectsByCardAndZone(cardId, zone) {
    return getEffectsByCardId(cardId).filter(effect => definition.effectHasZone(effect, zone));
  }

  function getEffectsByType(type) {
    if (!type) return [];
    return idsToEffects(effectIdsByType.get(String(type)));
  }

  function getTriggerEffectsByEvent(eventType) {
    if (!eventType) return getEffectsByType(EFFECT_TYPES.TRIGGER);
    const byEvent = idsToEffects(effectIdsByEvent.get(String(eventType)));
    return byEvent.filter(effect => definition.isTriggerEffect(effect));
  }

  function getContinuousEffects() {
    return idsToEffects(continuousEffectIds);
  }

  function getProcedureEffectsByCard(cardId) {
    if (!cardId) return [];
    return idsToEffects(procedureEffectIdsByCardId.get(String(cardId)));
  }

  function getActivatedEffectsByCardAndZone(cardId, zone) {
    return getEffectsByCardAndZone(cardId, zone).filter(effect => definition.isActivatedEffect(effect));
  }

  function getEffectCandidates(query) {
    const q = query || {};
    let candidates;

    if (q.cardId) candidates = getEffectsByCardId(q.cardId);
    else if (q.type) candidates = getEffectsByType(q.type);
    else candidates = listEffects();

    if (q.zone) candidates = candidates.filter(effect => definition.effectHasZone(effect, q.zone));
    if (q.eventType || q.event) candidates = candidates.filter(effect => definition.effectHasEvent(effect, q.eventType || q.event));
    if (q.type) candidates = candidates.filter(effect => effect.type === q.type);
    if (q.activatedOnly) candidates = candidates.filter(effect => definition.isActivatedEffect(effect));
    if (q.tag) candidates = candidates.filter(effect => definition.effectHasTag(effect, q.tag));

    if (q.context && q.checkCondition) {
      candidates = candidates.filter(effect => {
        try { return effect.condition(q.context) !== false; }
        catch (err) {
          console.error('[effect-registry] condition 확인 중 오류:', effect.id, err);
          return false;
        }
      });
    }

    return candidates;
  }

  function listEffects() {
    return Array.from(effectsById.values());
  }

  function hasEffect(effectId) {
    return effectsById.has(String(effectId));
  }

  function clearRegistry() {
    const removed = listEffects();
    effectsById.clear();
    effectIdsByCardId.clear();
    effectIdsByType.clear();
    effectIdsByZone.clear();
    effectIdsByEvent.clear();
    continuousEffectIds.clear();
    procedureEffectIdsByCardId.clear();

    removed.forEach(effect => unsyncCardEffectId(effect.cardId, effect.id));
    return removed;
  }

  function getCardDatabase() {
    // cards.js의 const CARDS는 전역 lexical binding일 수 있어서 typeof를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function syncCardEffectId(cardId, effectId) {
    const cards = getCardDatabase();
    const card = cards && cards[cardId];
    if (!card) return false;
    if (!Array.isArray(card.effectIds)) card.effectIds = [];
    if (card.effectIds.indexOf(effectId) === -1) card.effectIds.push(effectId);
    return true;
  }

  function unsyncCardEffectId(cardId, effectId) {
    const cards = getCardDatabase();
    const card = cards && cards[cardId];
    if (!card || !Array.isArray(card.effectIds)) return false;
    const index = card.effectIds.indexOf(effectId);
    if (index === -1) return false;
    card.effectIds.splice(index, 1);
    return true;
  }

  function syncEffectIdsToCards(cardsDb) {
    const cards = cardsDb || getCardDatabase();
    if (!cards) return Object.freeze({ ok: false, updated: 0, reason: 'CARDS를 찾지 못했습니다.' });

    let updated = 0;
    effectsById.forEach(effect => {
      const card = cards[effect.cardId];
      if (!card) return;
      if (!Array.isArray(card.effectIds)) card.effectIds = [];
      if (card.effectIds.indexOf(effect.id) === -1) {
        card.effectIds.push(effect.id);
        updated += 1;
      }
    });

    return Object.freeze({ ok: true, updated });
  }

  function getRegistryStats() {
    return Object.freeze({
      total: effectsById.size,
      cards: effectIdsByCardId.size,
      types: effectIdsByType.size,
      zones: effectIdsByZone.size,
      events: effectIdsByEvent.size,
      continuous: continuousEffectIds.size,
      procedures: Array.from(procedureEffectIdsByCardId.values()).reduce((sum, set) => sum + set.size, 0),
    });
  }

  global.HB_EFFECT_REGISTRY = Object.freeze({
    registerEffect,
    registerEffects,
    unregisterEffect,
    getEffectById,
    getEffectsByCardId,
    getEffectsByCardAndZone,
    getEffectsByType,
    getTriggerEffectsByEvent,
    getContinuousEffects,
    getProcedureEffectsByCard,
    getActivatedEffectsByCardAndZone,
    getEffectCandidates,
    listEffects,
    hasEffect,
    clearRegistry,
    syncEffectIdsToCards,
    getRegistryStats,
  });
})(window);
