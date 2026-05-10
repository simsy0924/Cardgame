// HAND BATTLE — Engine: Continuous Effects
// 필드에 존재하는 동안 자동 적용되는 지속 효과 전용 엔진.
// 이 파일은 버튼/체인/유발 큐를 만들지 않고, 보호·내성·공격력·존 수 보정만 담당한다.
(function initContinuousEngine(global) {
  'use strict';

  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!zoneAccess) {
    throw new Error('[continuous-engine] HB_ZONE_ACCESS가 필요합니다. zone-access.js를 먼저 로드하세요.');
  }

  const registry = global.HB_EFFECT_REGISTRY;
  if (!registry) {
    throw new Error('[continuous-engine] HB_EFFECT_REGISTRY가 필요합니다. effect-registry.js를 먼저 로드하세요.');
  }

  const effectDefinition = global.HB_EFFECT_DEFINITION;
  if (!effectDefinition) {
    throw new Error('[continuous-engine] HB_EFFECT_DEFINITION이 필요합니다. effect-definition.js를 먼저 로드하세요.');
  }

  const contextBuilder = global.HB_EFFECT_CONTEXT;
  if (!contextBuilder) {
    throw new Error('[continuous-engine] HB_EFFECT_CONTEXT가 필요합니다. effect-context.js를 먼저 로드하세요.');
  }

  const rules = global.HB_RULES || {};
  const ZONES = rules.ZONES || Object.freeze({ FIELD: 'field', FIELD_ZONE: 'fieldZone' });
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({ CONTINUOUS: 'continuous' });
  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const BASE_MONSTER_ZONE_COUNT = 5;

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    throw new Error('[continuous-engine] gameState가 없습니다. applyContinuousEffects(G)처럼 명시적으로 전달하세요.');
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function normalizeController(controller) {
    return zoneAccess.normalizeController(controller || CONTROLLERS.ME);
  }

  function getOpponent(controller) {
    return normalizeController(controller) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || cardOrId.name || '';
  }

  function getCardDatabase() {
    // cards.js의 const CARDS는 전역 lexical binding일 수 있어서 typeof를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function getCardDef(cardOrId) {
    const cardId = getCardId(cardOrId);
    const cards = getCardDatabase();
    return cards && cardId ? (cards[cardId] || null) : null;
  }

  function getCardName(cardOrId) {
    if (cardOrId && typeof cardOrId === 'object' && cardOrId.name) return cardOrId.name;
    const def = getCardDef(cardOrId);
    return (def && def.name) || getCardId(cardOrId);
  }

  function getBaseAttack(card) {
    if (!card) return 0;
    if (typeof card.atkBase === 'number') return card.atkBase;
    if (typeof card.baseAtk === 'number') return card.baseAtk;
    if (typeof card._hbBaseAtk === 'number') return card._hbBaseAtk;
    const def = getCardDef(card.id || card.cardId || card.name);
    if (def && typeof def.atk === 'number') return def.atk;
    if (typeof card.atk === 'number') return card.atk;
    return 0;
  }

  function ensureCardBaseAttack(card) {
    if (!card) return 0;
    const base = getBaseAttack(card);
    if (typeof card.atkBase !== 'number') card.atkBase = base;
    if (typeof card._hbBaseAtk !== 'number') card._hbBaseAtk = base;
    return base;
  }

  function eachMonsterOnField(gameState, callback) {
    const state = resolveGameState(gameState);
    [CONTROLLERS.ME, CONTROLLERS.OPPONENT].forEach(controller => {
      const field = zoneAccess.getZoneArray(state, controller, ZONES.FIELD);
      field.forEach((card, index) => {
        if (!card) return;
        callback(card, controller, index, field);
      });
    });
  }

  function eachContinuousSourceSlot(gameState, callback) {
    const state = resolveGameState(gameState);

    [CONTROLLERS.ME, CONTROLLERS.OPPONENT].forEach(controller => {
      const field = zoneAccess.getZoneArray(state, controller, ZONES.FIELD);
      field.forEach((card, index) => {
        if (!card) return;
        callback({ card, controller, zone: ZONES.FIELD, index });
      });

      const fieldCard = zoneAccess.getFieldZoneCard(state, controller);
      if (fieldCard) {
        callback({ card: fieldCard, controller, zone: ZONES.FIELD_ZONE, index: null });
      }
    });
  }

  function effectCanApplyFromZone(effect, zone) {
    const zones = asArray(effect && effect.zones && effect.zones.length ? effect.zones : effect && effect.zone);
    if (zones.length === 0) return true;
    return zones.indexOf(String(zone)) !== -1;
  }

  function makeSourceContext(gameState, slot, effect, options) {
    const opts = options || {};
    const controller = slot.controller || slot.sourceController || CONTROLLERS.ME;
    const zone = slot.zone || slot.sourceZone;
    const index = Object.prototype.hasOwnProperty.call(slot, 'index') ? slot.index : slot.sourceIndex;
    return contextBuilder.createEffectContext({
      gameState,
      controller,
      opponent: getOpponent(controller),
      card: slot.card,
      source: { controller, zone, index },
      sourceZone: zone,
      sourceIndex: index,
      effect,
      authority: opts.authority === true,
      silentLog: opts.silentLog !== false,
    });
  }

  function isContinuousEffect(effect) {
    return !!(effect && (effectDefinition.isContinuousEffect(effect) || effect.type === EFFECT_TYPES.CONTINUOUS));
  }

  function getRule(effect, ctx, helpers) {
    if (!effect) return null;
    const rawRule = effect.continuousRule;
    if (typeof rawRule === 'function') {
      const result = rawRule(ctx, helpers || createNoopHelpers(ctx));
      if (result && typeof result === 'object') return result;
      if (typeof result === 'number') return { attackModifier: result };
      return null;
    }
    if (rawRule && typeof rawRule === 'object') return rawRule;
    return null;
  }

  function callPredicate(predicate, checkCtx, sourceCtx, fallback) {
    if (predicate == null) return fallback === undefined ? false : fallback;
    if (typeof predicate === 'function') return predicate(checkCtx, sourceCtx) !== false;
    if (typeof predicate === 'boolean') return predicate;
    if (typeof predicate === 'number') return predicate !== 0;
    if (typeof predicate === 'object') return objectRuleMatches(predicate, checkCtx, sourceCtx);
    return !!predicate;
  }

  function callValue(value, checkCtx, sourceCtx, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'function') return value(checkCtx, sourceCtx);
    return value;
  }

  function objectRuleMatches(rule, checkCtx, sourceCtx) {
    if (!rule || typeof rule !== 'object') return !!rule;

    if (rule.controller && normalizeController(rule.controller) !== normalizeController(checkCtx.targetController || checkCtx.controller || sourceCtx.controller)) {
      return false;
    }
    if (rule.targetController && normalizeController(rule.targetController) !== normalizeController(checkCtx.targetController || checkCtx.controller || sourceCtx.controller)) {
      return false;
    }
    if (rule.sourceController && normalizeController(rule.sourceController) !== normalizeController(sourceCtx.controller)) {
      return false;
    }
    if (rule.actorController && normalizeController(rule.actorController) !== normalizeController(checkCtx.actorController || checkCtx.controller || sourceCtx.opponent)) {
      return false;
    }
    if (rule.byOpponentOnly) {
      const actor = normalizeController(checkCtx.actorController || checkCtx.controller || sourceCtx.opponent);
      if (actor === normalizeController(sourceCtx.controller)) return false;
    }
    if (rule.ownCardsOnly || rule.sameControllerOnly) {
      const targetController = normalizeController(checkCtx.targetController || checkCtx.controller || sourceCtx.controller);
      if (targetController !== normalizeController(sourceCtx.controller)) return false;
    }
    if (rule.opponentCardsOnly) {
      const targetController = normalizeController(checkCtx.targetController || checkCtx.controller || sourceCtx.opponent);
      if (targetController === normalizeController(sourceCtx.controller)) return false;
    }
    if (rule.theme) {
      const target = checkCtx.target || checkCtx.card;
      const def = getCardDef(target);
      const theme = (target && target.theme) || (def && def.theme) || '';
      if (theme !== rule.theme) return false;
    }
    if (rule.cardId) {
      const target = checkCtx.target || checkCtx.card;
      if (getCardId(target) !== String(rule.cardId)) return false;
    }
    if (typeof rule.when === 'function' && rule.when(checkCtx, sourceCtx) === false) return false;
    if (typeof rule.condition === 'function' && rule.condition(checkCtx, sourceCtx) === false) return false;

    return true;
  }

  function buildCheckContext(input, sourceEntry) {
    const raw = input || {};
    const state = resolveGameState(raw.gameState || (sourceEntry && sourceEntry.context && sourceEntry.context.gameState));
    const target = raw.target || raw.card || raw.monster || null;
    const targetLocation = raw.targetLocation || raw.location || null;
    const targetController = normalizeController(
      raw.targetController
      || (targetLocation && targetLocation.controller)
      || raw.controller
      || (sourceEntry && sourceEntry.controller)
      || CONTROLLERS.ME
    );
    const actorController = normalizeController(
      raw.actorController
      || raw.effectController
      || raw.controller
      || (raw.effect && raw.effect.controller)
      || (raw.chainLink && raw.chainLink.controller)
      || getOpponent(targetController)
    );

    return Object.assign({}, raw, {
      gameState: state,
      target,
      card: target || raw.card || null,
      targetController,
      actorController,
      controller: actorController,
      sourceEntry: sourceEntry || null,
      sourceContext: sourceEntry ? sourceEntry.context : null,
      sourceEffect: sourceEntry ? sourceEntry.effect : null,
      sourceCard: sourceEntry ? sourceEntry.card : null,
      sourceController: sourceEntry ? sourceEntry.controller : null,
    });
  }

  function createNoopHelpers(ctx) {
    return Object.freeze({
      modifyAttack() { return null; },
      modifyMonsterZoneCount() { return null; },
      markTargetProtected() { return null; },
      markEffectImmune() { return null; },
      markCannotBeSentToGrave() { return null; },
      markCannotAttack() { return null; },
      markCannotBeAttackTarget() { return null; },
      limitAttacks() { return null; },
      getOpponent,
      getCardDef,
      getCardName,
      context: ctx,
    });
  }

  function ensureContinuousState(gameState) {
    const state = resolveGameState(gameState);
    if (!state._hbContinuous || typeof state._hbContinuous !== 'object') {
      state._hbContinuous = {};
    }
    if (!state._hbContinuous.fieldSlotModifiers) {
      state._hbContinuous.fieldSlotModifiers = { me: 0, opponent: 0 };
    }
    if (!state._hbContinuous.attackLimits) {
      state._hbContinuous.attackLimits = { me: [], opponent: [] };
    }
    if (!Array.isArray(state._hbContinuous.appliedEffects)) {
      state._hbContinuous.appliedEffects = [];
    }
    return state._hbContinuous;
  }

  function resetContinuousCardState(card) {
    if (!card) return;
    const base = ensureCardBaseAttack(card);
    card.atk = base;
    card._hbContinuous = {
      appliedEffects: [],
      attackModifier: 0,
      targetProtected: [],
      effectImmune: [],
      cannotBeSentToGrave: [],
      cannotAttack: [],
      cannotBeAttackTarget: [],
    };
  }

  function resetContinuousState(gameState) {
    const state = resolveGameState(gameState);
    eachMonsterOnField(state, resetContinuousCardState);

    const continuousState = ensureContinuousState(state);
    continuousState.appliedEffects = [];
    continuousState.fieldSlotModifiers = { me: 0, opponent: 0 };
    continuousState.attackLimits = { me: [], opponent: [] };
    continuousState.lastAppliedAt = 0;
    continuousState.activeEffectIds = [];
    continuousState.errors = [];
    return continuousState;
  }

  function addCardFlag(card, flagName, entry) {
    if (!card) return null;
    if (!card._hbContinuous) resetContinuousCardState(card);
    if (!Array.isArray(card._hbContinuous[flagName])) card._hbContinuous[flagName] = [];
    const frozen = Object.freeze(Object.assign({}, entry || {}));
    card._hbContinuous[flagName].push(frozen);
    return frozen;
  }

  function makeApplyHelpers(gameState, sourceCtx, effect) {
    const state = resolveGameState(gameState);
    const continuousState = ensureContinuousState(state);

    function normalizeTarget(targetOrOptions) {
      if (!targetOrOptions) return sourceCtx.card;
      if (targetOrOptions.card || targetOrOptions.target || targetOrOptions.monster) return targetOrOptions.card || targetOrOptions.target || targetOrOptions.monster;
      return targetOrOptions;
    }

    function makeReason(extra) {
      return Object.assign({
        effectId: effect.id,
        cardId: effect.cardId,
        sourceCardId: getCardId(sourceCtx.card),
        sourceCardName: getCardName(sourceCtx.card),
        sourceController: sourceCtx.controller,
      }, extra || {});
    }

    return Object.freeze({
      modifyAttack(targetOrOptions, amount, reason) {
        let target = normalizeTarget(targetOrOptions);
        let delta = amount;
        let detail = reason;
        if (targetOrOptions && typeof targetOrOptions === 'object' && (targetOrOptions.card || targetOrOptions.target || targetOrOptions.monster)) {
          delta = targetOrOptions.amount != null ? targetOrOptions.amount : targetOrOptions.delta;
          detail = targetOrOptions.reason || reason;
        }
        delta = Number(delta || 0);
        if (!target || !Number.isFinite(delta) || delta === 0) return null;
        if (!target._hbContinuous) resetContinuousCardState(target);
        target._hbContinuous.attackModifier += delta;
        target.atk = getBaseAttack(target) + target._hbContinuous.attackModifier;
        const entry = makeReason({ amount: delta, reason: detail || 'attackModifier' });
        target._hbContinuous.appliedEffects.push(Object.freeze(entry));
        return entry;
      },

      modifyMonsterZoneCount(controller, delta, reason) {
        const owner = normalizeController(controller || sourceCtx.controller);
        const value = Number(delta || 0);
        if (!Number.isFinite(value) || value === 0) return null;
        continuousState.fieldSlotModifiers[owner] = Number(continuousState.fieldSlotModifiers[owner] || 0) + value;
        const entry = makeReason({ controller: owner, amount: value, reason: reason || 'monsterZoneModifier' });
        continuousState.appliedEffects.push(Object.freeze(entry));
        return entry;
      },

      markTargetProtected(targetOrOptions, reason) {
        const target = normalizeTarget(targetOrOptions);
        return addCardFlag(target, 'targetProtected', makeReason({ reason: reason || 'targetProtection' }));
      },

      markEffectImmune(targetOrOptions, reason) {
        const target = normalizeTarget(targetOrOptions);
        return addCardFlag(target, 'effectImmune', makeReason({ reason: reason || 'effectImmunity' }));
      },

      markCannotBeSentToGrave(targetOrOptions, reason) {
        const target = normalizeTarget(targetOrOptions);
        return addCardFlag(target, 'cannotBeSentToGrave', makeReason({ reason: reason || 'cannotBeSentToGrave' }));
      },

      markCannotAttack(targetOrOptions, reason) {
        const target = normalizeTarget(targetOrOptions);
        return addCardFlag(target, 'cannotAttack', makeReason({ reason: reason || 'cannotAttack' }));
      },

      markCannotBeAttackTarget(targetOrOptions, reason) {
        const target = normalizeTarget(targetOrOptions);
        return addCardFlag(target, 'cannotBeAttackTarget', makeReason({ reason: reason || 'cannotBeAttackTarget' }));
      },

      limitAttacks(controller, max, reason) {
        const owner = normalizeController(controller || sourceCtx.controller);
        const limit = Math.max(0, Number(max || 0));
        const entry = makeReason({ controller: owner, max: limit, reason: reason || 'attackLimit' });
        continuousState.attackLimits[owner].push(Object.freeze(entry));
        continuousState.appliedEffects.push(Object.freeze(entry));
        return entry;
      },

      getOpponent,
      getCardDef,
      getCardName,
      context: sourceCtx,
    });
  }

  function isContinuousEffectActive(effect, ctx) {
    if (!isContinuousEffect(effect)) return false;
    if (ctx && ctx.sourceZone && !effectCanApplyFromZone(effect, ctx.sourceZone)) return false;

    try {
      if (typeof effect.condition === 'function' && effect.condition(ctx) === false) return false;
    } catch (err) {
      console.error('[continuous-engine] condition 확인 중 오류:', effect.id, err);
      return false;
    }

    const rule = getRule(effect, ctx, createNoopHelpers(ctx));
    if (rule) {
      try {
        if (callPredicate(rule.condition, ctx, ctx, true) === false) return false;
        if (callPredicate(rule.isActive, ctx, ctx, true) === false) return false;
        if (callPredicate(rule.active, ctx, ctx, true) === false) return false;
      } catch (err) {
        console.error('[continuous-engine] continuousRule 활성 조건 확인 중 오류:', effect.id, err);
        return false;
      }
    }

    return true;
  }

  function getActiveContinuousEffects(gameState) {
    const state = resolveGameState(gameState);
    const active = [];

    eachContinuousSourceSlot(state, slot => {
      const cardId = getCardId(slot.card);
      if (!cardId) return;
      const effects = registry.getEffectsByCardId(cardId).filter(isContinuousEffect);
      effects.forEach(effect => {
        if (!effectCanApplyFromZone(effect, slot.zone)) return;
        const ctx = makeSourceContext(state, slot, effect, { authority: false });
        if (!isContinuousEffectActive(effect, ctx)) return;
        active.push(Object.freeze({
          effect,
          effectId: effect.id,
          card: slot.card,
          cardId,
          controller: slot.controller,
          sourceController: slot.controller,
          sourceZone: slot.zone,
          sourceIndex: slot.index,
          source: Object.freeze({ controller: slot.controller, zone: slot.zone, index: slot.index }),
          context: ctx,
        }));
      });
    });

    return active;
  }

  function collectAttackModifierFromRule(rule, target, checkCtx, sourceCtx) {
    if (!rule) return 0;
    let total = 0;

    function add(value) {
      const amount = Number(value || 0);
      if (Number.isFinite(amount)) total += amount;
    }

    add(callValue(rule.attackModifier, checkCtx, sourceCtx, 0));
    add(callValue(rule.getAttackModifier, checkCtx, sourceCtx, 0));

    const modifiers = asArray(callValue(rule.attackModifiers, checkCtx, sourceCtx, []));
    modifiers.forEach(item => {
      if (typeof item === 'number') add(item);
      else if (item && objectRuleMatches(item, checkCtx, sourceCtx)) add(item.amount != null ? item.amount : item.delta);
    });

    return total;
  }

  function applyRuleObject(rule, helpers, sourceCtx) {
    if (!rule) return;

    if (typeof rule.apply === 'function') {
      rule.apply(sourceCtx, helpers);
    }

    const sourceCard = sourceCtx.card;
    const attackDelta = Number(callValue(rule.attackModifier, { target: sourceCard, card: sourceCard, targetController: sourceCtx.controller }, sourceCtx, 0) || 0)
      + Number(callValue(rule.getAttackModifier, { target: sourceCard, card: sourceCard, targetController: sourceCtx.controller }, sourceCtx, 0) || 0);
    if (attackDelta) helpers.modifyAttack(sourceCard, attackDelta, 'attackModifier');

    const fieldDelta = callValue(rule.fieldSlotDelta != null ? rule.fieldSlotDelta : rule.monsterZoneDelta, sourceCtx, sourceCtx, null);
    if (fieldDelta != null) {
      if (typeof fieldDelta === 'number') helpers.modifyMonsterZoneCount(sourceCtx.controller, fieldDelta, 'monsterZoneDelta');
      else if (fieldDelta && typeof fieldDelta === 'object') {
        helpers.modifyMonsterZoneCount(fieldDelta.controller || sourceCtx.controller, fieldDelta.amount != null ? fieldDelta.amount : fieldDelta.delta, fieldDelta.reason || 'monsterZoneDelta');
      }
    }

    const attackLimit = callValue(rule.attackLimit, sourceCtx, sourceCtx, null);
    if (attackLimit != null) {
      if (typeof attackLimit === 'number') helpers.limitAttacks(sourceCtx.controller, attackLimit, 'attackLimit');
      else if (attackLimit && typeof attackLimit === 'object') helpers.limitAttacks(attackLimit.controller || sourceCtx.controller, attackLimit.max, attackLimit.reason || 'attackLimit');
    }
  }

  function applyContinuousEffects(gameState) {
    const state = resolveGameState(gameState);
    const continuousState = resetContinuousState(state);
    const active = getActiveContinuousEffects(state);

    active.forEach(entry => {
      const sourceCtx = makeSourceContext(state, entry, entry.effect, { authority: true });
      const helpers = makeApplyHelpers(state, sourceCtx, entry.effect);
      try {
        const rule = getRule(entry.effect, sourceCtx, helpers);
        applyRuleObject(rule, helpers, sourceCtx);
        continuousState.appliedEffects.push(Object.freeze({
          effectId: entry.effect.id,
          cardId: entry.cardId,
          controller: entry.controller,
          sourceZone: entry.sourceZone,
        }));
      } catch (err) {
        continuousState.errors.push(Object.freeze({ effectId: entry.effect.id, message: err.message }));
        console.error('[continuous-engine] 지속 효과 적용 중 오류:', entry.effect.id, err);
      }
    });

    // 모든 지속 효과의 공격력 보정 값을 한 번 더 계산해, apply()를 쓰지 않은 선언형 rule도 반영한다.
    eachMonsterOnField(state, (card, controller, index) => {
      const modifier = getAttackModifier(card, {
        gameState: state,
        target: card,
        card,
        targetController: controller,
        targetZone: ZONES.FIELD,
        targetIndex: index,
      });
      const base = getBaseAttack(card);
      if (modifier !== 0) {
        if (!card._hbContinuous) resetContinuousCardState(card);
        card._hbContinuous.attackModifier = modifier;
        card.atk = base + modifier;
      }
    });

    continuousState.lastAppliedAt = Date.now();
    continuousState.activeEffectIds = active.map(entry => entry.effect.id);
    return Object.freeze({
      ok: true,
      activeCount: active.length,
      activeEffectIds: continuousState.activeEffectIds.slice(),
      fieldSlotModifiers: Object.assign({}, continuousState.fieldSlotModifiers),
      errors: continuousState.errors.slice(),
    });
  }

  function getRuleCheck(rule, names, checkCtx, sourceCtx) {
    const keys = asArray(names);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (rule && Object.prototype.hasOwnProperty.call(rule, key)) {
        if (callPredicate(rule[key], checkCtx, sourceCtx, false)) return key;
      }
    }
    return null;
  }

  function hasAppliedCardFlag(card, flagName, checkCtx) {
    if (!card || !card._hbContinuous || !Array.isArray(card._hbContinuous[flagName])) return null;
    const actor = normalizeController(checkCtx.actorController || checkCtx.controller || CONTROLLERS.OPPONENT);
    for (let i = 0; i < card._hbContinuous[flagName].length; i += 1) {
      const entry = card._hbContinuous[flagName][i];
      if (!entry) continue;
      if (entry.byOpponentOnly && entry.sourceController && normalizeController(entry.sourceController) === actor) continue;
      return entry;
    }
    return null;
  }

  function findBlockingContinuousEffect(gameState, input, ruleNames, flagName) {
    const state = resolveGameState(gameState || (input && input.gameState));
    const active = getActiveContinuousEffects(state);

    for (let i = 0; i < active.length; i += 1) {
      const entry = active[i];
      const sourceCtx = entry.context;
      const checkCtx = buildCheckContext(Object.assign({}, input || {}, { gameState: state }), entry);
      const rule = getRule(entry.effect, sourceCtx, createNoopHelpers(sourceCtx));
      const matchedKey = getRuleCheck(rule, ruleNames, checkCtx, sourceCtx);
      if (matchedKey) {
        return Object.freeze({ entry, matchedKey, checkCtx });
      }
    }

    const target = input && (input.target || input.card || input.monster);
    const checkCtx = buildCheckContext(Object.assign({}, input || {}, { gameState: state }), null);
    const applied = hasAppliedCardFlag(target, flagName, checkCtx);
    if (applied) {
      return Object.freeze({ entry: null, matchedKey: flagName, applied, checkCtx });
    }

    return null;
  }

  function makeBlockResult(kind, block) {
    const blocked = !!block;
    const entry = block && block.entry;
    const sourceEffect = entry && entry.effect;
    const sourceCard = entry && entry.card;
    const result = {
      ok: !blocked,
      blocked,
      kind,
      reason: blocked ? (block.matchedKey || kind) : null,
      effectId: sourceEffect ? sourceEffect.id : (block && block.applied && block.applied.effectId) || null,
      cardId: sourceCard ? getCardId(sourceCard) : (block && block.applied && block.applied.cardId) || null,
      cardName: sourceCard ? getCardName(sourceCard) : null,
      sourceController: entry ? entry.controller : (block && block.applied && block.applied.sourceController) || null,
    };

    if (kind === 'targetProtection') result.protected = blocked;
    if (kind === 'effectImmunity') result.immune = blocked;
    if (kind === 'cannotBeSentToGrave') result.cannotBeSentToGrave = blocked;
    return Object.freeze(result);
  }

  function checkTargetProtection(ctx) {
    const input = ctx || {};
    const state = resolveGameState(input.gameState);
    const block = findBlockingContinuousEffect(state, input, ['targetProtection', 'checkTargetProtection', 'cannotBeTargeted'], 'targetProtected');
    return makeBlockResult('targetProtection', block);
  }

  function checkEffectImmunity(ctx) {
    const input = ctx || {};
    const state = resolveGameState(input.gameState);
    const block = findBlockingContinuousEffect(state, input, ['effectImmunity', 'checkEffectImmunity', 'unaffectedByEffects'], 'effectImmune');
    return makeBlockResult('effectImmunity', block);
  }

  function checkCannotBeSentToGrave(ctx) {
    const input = ctx || {};
    const state = resolveGameState(input.gameState);
    const block = findBlockingContinuousEffect(state, input, ['cannotBeSentToGrave', 'checkCannotBeSentToGrave', 'graveProtection'], 'cannotBeSentToGrave');
    return makeBlockResult('cannotBeSentToGrave', block);
  }

  function getAttackModifier(card, ctx) {
    const input = ctx || {};
    const state = resolveGameState(input.gameState);
    const target = card || input.target || input.card;
    if (!target) return 0;

    let total = 0;
    const active = getActiveContinuousEffects(state);
    active.forEach(entry => {
      const sourceCtx = entry.context;
      const checkCtx = buildCheckContext(Object.assign({}, input, {
        gameState: state,
        target,
        card: target,
        targetController: input.targetController || input.controller || entry.controller,
      }), entry);
      const rule = getRule(entry.effect, sourceCtx, createNoopHelpers(sourceCtx));
      const delta = collectAttackModifierFromRule(rule, target, checkCtx, sourceCtx);
      if (Number.isFinite(delta)) total += delta;
    });
    return total;
  }

  function normalizeZoneDeltaValue(value, sourceCtx, requestedController) {
    if (value == null) return 0;
    if (typeof value === 'number') return normalizeController(sourceCtx.controller) === normalizeController(requestedController) ? value : 0;
    if (typeof value === 'object') {
      const owner = normalizeController(value.controller || sourceCtx.controller);
      if (owner !== normalizeController(requestedController)) return 0;
      return Number(value.amount != null ? value.amount : value.delta || 0) || 0;
    }
    return 0;
  }

  function getBaseMonsterZoneCount(gameState, controller) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(controller);
    const extraKey = owner === CONTROLLERS.ME ? 'myExtraSlots' : 'opExtraSlots';
    return BASE_MONSTER_ZONE_COUNT + Number(state[extraKey] || 0);
  }

  function getAvailableMonsterZoneCount(player, gameState) {
    const state = resolveGameState(gameState);
    const owner = normalizeController(player || CONTROLLERS.ME);
    let total = getBaseMonsterZoneCount(state, owner);

    const active = getActiveContinuousEffects(state);
    active.forEach(entry => {
      const sourceCtx = entry.context;
      const rule = getRule(entry.effect, sourceCtx, createNoopHelpers(sourceCtx));
      if (!rule) return;
      total += normalizeZoneDeltaValue(callValue(rule.fieldSlotDelta, { controller: owner, gameState: state }, sourceCtx, null), sourceCtx, owner);
      total += normalizeZoneDeltaValue(callValue(rule.monsterZoneDelta, { controller: owner, gameState: state }, sourceCtx, null), sourceCtx, owner);
      total += normalizeZoneDeltaValue(callValue(rule.getMonsterZoneDelta, { controller: owner, gameState: state }, sourceCtx, null), sourceCtx, owner);
    });

    return Math.max(0, Math.floor(total));
  }

  function canAttackWithMonster(ctx) {
    const input = ctx || {};
    const state = resolveGameState(input.gameState);
    const attacker = input.attacker || input.monster || input.card;
    const attackerController = normalizeController(input.attackerController || input.controller || CONTROLLERS.ME);

    if (!attacker) {
      return Object.freeze({ ok: false, canAttack: false, reason: 'noAttacker' });
    }

    const active = getActiveContinuousEffects(state);
    for (let i = 0; i < active.length; i += 1) {
      const entry = active[i];
      const sourceCtx = entry.context;
      const checkCtx = buildCheckContext(Object.assign({}, input, {
        gameState: state,
        target: input.target || null,
        card: attacker,
        attacker,
        attackerController,
        controller: attackerController,
      }), entry);
      const rule = getRule(entry.effect, sourceCtx, createNoopHelpers(sourceCtx));
      if (!rule) continue;

      if (callPredicate(rule.cannotAttack, checkCtx, sourceCtx, false) || callPredicate(rule.checkCannotAttack, checkCtx, sourceCtx, false)) {
        return Object.freeze({ ok: false, canAttack: false, reason: 'cannotAttack', effectId: entry.effect.id, cardId: entry.cardId });
      }
      if (Object.prototype.hasOwnProperty.call(rule, 'canAttackWithMonster') && callPredicate(rule.canAttackWithMonster, checkCtx, sourceCtx, true) === false) {
        return Object.freeze({ ok: false, canAttack: false, reason: 'canAttackWithMonster', effectId: entry.effect.id, cardId: entry.cardId });
      }
      if (input.target && (callPredicate(rule.cannotBeAttackTarget, checkCtx, sourceCtx, false) || callPredicate(rule.checkCannotBeAttackTarget, checkCtx, sourceCtx, false))) {
        return Object.freeze({ ok: false, canAttack: false, reason: 'cannotBeAttackTarget', effectId: entry.effect.id, cardId: entry.cardId });
      }
    }

    const appliedCannotAttack = hasAppliedCardFlag(attacker, 'cannotAttack', { actorController: attackerController, controller: attackerController });
    if (appliedCannotAttack) {
      return Object.freeze({ ok: false, canAttack: false, reason: 'cannotAttack', effectId: appliedCannotAttack.effectId || null, cardId: appliedCannotAttack.cardId || null });
    }

    if (input.target) {
      const appliedNoTarget = hasAppliedCardFlag(input.target, 'cannotBeAttackTarget', { actorController: attackerController, controller: attackerController });
      if (appliedNoTarget) {
        return Object.freeze({ ok: false, canAttack: false, reason: 'cannotBeAttackTarget', effectId: appliedNoTarget.effectId || null, cardId: appliedNoTarget.cardId || null });
      }
    }

    return Object.freeze({ ok: true, canAttack: true, reason: null });
  }

  const api = Object.freeze({
    BASE_MONSTER_ZONE_COUNT,
    getActiveContinuousEffects,
    isContinuousEffectActive,
    applyContinuousEffects,
    resetContinuousState,
    checkTargetProtection,
    checkEffectImmunity,
    checkCannotBeSentToGrave,
    getAttackModifier,
    getAvailableMonsterZoneCount,
    canAttackWithMonster,
  });

  global.HB_CONTINUOUS_ENGINE = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.continuous = api;
})(window);
