// HAND BATTLE — Engine: Effect Definition
// 카드 텍스트 파싱 대신 명시적인 EffectDefinition 객체로 효과를 처리하기 위한 표준 구조.
// 이 파일은 효과를 실행하지 않고, 효과 정의의 생성/검증/정규화만 담당한다.
(function initEffectDefinition(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({
    ACTIVATION: 'activation',
    QUICK: 'quick',
    TRIGGER: 'trigger',
    CONTINUOUS: 'continuous',
    PROCEDURE: 'procedure',
    REPLACEMENT: 'replacement',
    PROCESSING_NEGATE: 'processingNegate',
  });
  const TIMING = rules.TIMING || Object.freeze({ NONE: 'none' });

  const NOOP_OK = Object.freeze({ ok: true });
  const FUNCTION_FIELDS = Object.freeze(['condition', 'canResolve', 'cost', 'target', 'resolve']);

  function noopCondition() { return true; }
  function noopStep() { return NOOP_OK; }
  function noopResolve() { return NOOP_OK; }

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

  function cloneOncePerTurn(value, effectId) {
    if (value === true) {
      return Object.freeze({ scope: 'turn', key: effectId, limit: 1 });
    }
    if (value === false || value == null) return null;
    if (typeof value === 'number') {
      return Object.freeze({ scope: 'turn', key: effectId, limit: Math.max(1, value) });
    }
    if (typeof value === 'string') {
      return Object.freeze({ scope: 'turn', key: value, limit: 1 });
    }
    if (typeof value === 'object') {
      const scope = value.scope || 'turn';
      const key = value.key || effectId;
      const limit = Math.max(1, Number(value.limit || 1));
      return Object.freeze(Object.assign({}, value, { scope, key, limit }));
    }
    return null;
  }

  function getCardDatabase() {
    // cards.js의 const CARDS는 전역 lexical binding일 수 있으므로 typeof를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function getCardDef(cardId) {
    const cards = getCardDatabase();
    const id = String(cardId || '');
    return cards && id ? (cards[id] || null) : null;
  }

  function getEffectTheme(raw, cardId) {
    if (raw && raw.theme) return String(raw.theme);
    if (raw && raw.card && raw.card.theme) return String(raw.card.theme);
    const def = getCardDef(cardId);
    return def && def.theme ? String(def.theme) : '';
  }

  function getEffectCardType(raw, cardId) {
    if (raw && raw.cardType) return String(raw.cardType);
    if (raw && raw.card && raw.card.cardType) return String(raw.card.cardType);
    const def = getCardDef(cardId);
    return def && def.cardType ? String(def.cardType) : '';
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function hasActivationWord(text) {
    return /발동/.test(normalizeText(text));
  }

  function isBulgasauiTheme(raw, cardId) {
    return getEffectTheme(raw, cardId) === '불가사의';
  }

  function isBulgasauiProcessingNegateText(text) {
    const normalized = normalizeText(text);
    return /처리\s*시/.test(normalized) && /무효/.test(normalized);
  }

  function isBulgasauiSummonProcedureText(text, raw, cardId) {
    const normalized = normalizeText(text);
    const cardType = getEffectCardType(raw || {}, cardId);

    // 불가사의 몬스터들의 ①: “이 카드는 ... 묘지/제외 상태에서 소환할 수 있다.”
    // 이는 지속 효과가 아니라 소환 절차/조건이다.
    if (cardType === 'monster' && /이\s*카드는/.test(normalized) && /소환할 수 있다/.test(normalized)) {
      return true;
    }

    return false;
  }

  function inferEffectType(raw, cardId) {
    if (raw && raw.type) return raw.type;

    const text = normalizeText(raw && raw.text);

    if (isBulgasauiTheme(raw || {}, cardId)) {
      if (isBulgasauiProcessingNegateText(text)) return EFFECT_TYPES.PROCESSING_NEGATE;
      if (isBulgasauiSummonProcedureText(text, raw || {}, cardId)) return EFFECT_TYPES.PROCEDURE;
      if (text && !hasActivationWord(text)) return EFFECT_TYPES.CONTINUOUS;
    }

    return EFFECT_TYPES.ACTIVATION;
  }

  function inferIsActivated(type, explicitValue) {
    if (typeof explicitValue === 'boolean') return explicitValue;
    return type !== EFFECT_TYPES.CONTINUOUS
      && type !== EFFECT_TYPES.PROCEDURE
      && type !== EFFECT_TYPES.REPLACEMENT
      && type !== EFFECT_TYPES.PROCESSING_NEGATE;
  }

  function normalizeCallable(value, fallback, fieldName, effectId) {
    if (typeof value === 'function') return value;
    if (value == null) return fallback;
    throw new Error(`[effect-definition] ${effectId || '(unknown)'}의 ${fieldName}은 함수여야 합니다.`);
  }

  function validateBaseShape(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('[effect-definition] EffectDefinition 객체가 필요합니다.');
    }
    if (!raw.id) throw new Error('[effect-definition] effect.id가 필요합니다.');
    if (!raw.cardId) throw new Error(`[effect-definition] ${raw.id}의 cardId가 필요합니다.`);
  }

  function normalizeEffectDefinition(raw) {
    validateBaseShape(raw);

    const id = String(raw.id);
    const cardId = String(raw.cardId);
    const type = inferEffectType(raw, cardId);
    const zones = uniqueStrings(raw.zones || raw.zone);
    const events = uniqueStrings(raw.events || raw.event);
    const tags = uniqueStrings(raw.tags);
    const processingNegate = raw.processingNegate && typeof raw.processingNegate === 'object'
      ? Object.assign({}, raw.processingNegate)
      : null;
    const negateTags = uniqueStrings(raw.negateTags || raw.negates || raw.targetTags
      || (processingNegate && (processingNegate.negateTags || processingNegate.targetTags || processingNegate.tags))
      || (raw.meta && (raw.meta.negateTags || raw.meta.processingNegateTags)));
    const timing = raw.timing == null ? (TIMING.NONE || 'none') : raw.timing;

    const normalized = {
      id,
      cardId,
      effectNo: raw.effectNo == null ? null : raw.effectNo,
      text: raw.text || '',

      type,
      speed: raw.speed == null ? null : raw.speed,
      timing,
      zone: zones.length === 1 ? zones[0] : (raw.zone == null ? null : raw.zone),
      zones: Object.freeze(zones),
      event: events.length === 1 ? events[0] : (raw.event == null ? null : raw.event),
      events: Object.freeze(events),

      isActivated: inferIsActivated(type, raw.isActivated),
      optional: raw.optional !== false,
      mandatory: raw.mandatory === true,
      oncePerTurn: cloneOncePerTurn(raw.oncePerTurn, id),

      condition: normalizeCallable(raw.condition, noopCondition, 'condition', id),
      canResolve: normalizeCallable(raw.canResolve || raw.canApply || raw.playable, noopCondition, 'canResolve', id),
      cost: normalizeCallable(raw.cost, noopStep, 'cost', id),
      target: normalizeCallable(raw.target, noopStep, 'target', id),
      resolve: normalizeCallable(raw.resolve, noopResolve, 'resolve', id),

      tags: Object.freeze(tags),
      negateTags: Object.freeze(negateTags),
      processingNegate: processingNegate ? Object.freeze(processingNegate) : null,
      summonProcedure: raw.summonProcedure || null,
      continuousRule: raw.continuousRule || null,
      meta: Object.freeze(Object.assign({}, raw.meta || {}, {
        inferredType: !raw.type,
        theme: getEffectTheme(raw, cardId) || undefined,
      })),
    };

    if (normalized.mandatory) normalized.optional = false;

    return Object.freeze(normalized);
  }

  function createEffectDefinition(raw) {
    return normalizeEffectDefinition(raw);
  }

  function validateEffectDefinition(raw) {
    try {
      const effect = normalizeEffectDefinition(raw);
      return Object.freeze({ ok: true, effect, errors: Object.freeze([]) });
    } catch (err) {
      return Object.freeze({ ok: false, effect: null, errors: Object.freeze([err.message]) });
    }
  }

  function effectHasZone(effect, zone) {
    if (!effect || !zone) return false;
    const zones = effect.zones || uniqueStrings(effect.zone);
    return zones.length > 0 && zones.indexOf(String(zone)) !== -1;
  }

  function effectHasEvent(effect, eventType) {
    if (!effect || !eventType) return false;
    const events = effect.events || uniqueStrings(effect.event);
    return events.indexOf(String(eventType)) !== -1;
  }

  function effectHasTag(effect, tag) {
    if (!effect || !tag) return false;
    const tags = effect.tags || [];
    return tags.indexOf(String(tag)) !== -1;
  }

  function isActivatedEffect(effect) {
    return !!(effect && effect.isActivated);
  }

  function isTriggerEffect(effect) {
    return !!(effect && effect.type === EFFECT_TYPES.TRIGGER);
  }

  function isContinuousEffect(effect) {
    return !!(effect && (effect.type === EFFECT_TYPES.CONTINUOUS || effect.continuousRule));
  }

  function isProcedureEffect(effect) {
    return !!(effect && (effect.type === EFFECT_TYPES.PROCEDURE || effect.summonProcedure));
  }

  function makeEffectId(cardId, effectNo, suffix) {
    const base = String(cardId || '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^0-9A-Za-z_\-가-힣]/g, '')
      .toLowerCase();
    const no = effectNo == null ? 'effect' : String(effectNo);
    return suffix ? `${base}_${no}_${suffix}` : `${base}_${no}`;
  }

  global.HB_EFFECT_DEFINITION = Object.freeze({
    FUNCTION_FIELDS,
    createEffectDefinition,
    normalizeEffectDefinition,
    validateEffectDefinition,
    effectHasZone,
    effectHasEvent,
    effectHasTag,
    isActivatedEffect,
    isTriggerEffect,
    isContinuousEffect,
    isProcedureEffect,
    makeEffectId,
    inferEffectType,
    hasActivationWord,
    isBulgasauiTheme,
    isBulgasauiProcessingNegateText,
    isBulgasauiSummonProcedureText,
  });
})(window);
