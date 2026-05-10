// HAND BATTLE — Theme Effects: Lion
// 16-8단계: 라이온 테마를 EffectDefinition 기반으로 이식한다.
// 핵심: 몬스터 존 확장 지속효과, 사자/라이온 명칭 취급, 키 카드 절차 소환, 처리 불가 발동 차단.
(function initLionEffectDefinitions(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || { ACTIVATION: 'activation', QUICK: 'quick', TRIGGER: 'trigger', CONTINUOUS: 'continuous', PROCEDURE: 'procedure' };
  const ZONES = rules.ZONES || { DECK: 'deck', HAND: 'hand', PUBLIC_HAND: 'publicHand', FIELD: 'field', GRAVE: 'grave', EXILE: 'exile', KEY_DECK: 'keyDeck' };
  const EVENTS = rules.EVENTS || { SUMMON: 'summon', SENT_TO_GRAVE: 'sentToGrave', ADDED_TO_HAND: 'addedToHand' };
  const TIMING = rules.TIMING || { MY_DEPLOY: 'myDeploy', EITHER_TURN: 'eitherTurn', ON_SUMMON: 'onSummon', NONE: 'none' };
  const TAGS = rules.EFFECT_TAGS || {};
  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry || !zoneAccess) throw new Error('[lion-effects] registry/zone-access가 필요합니다.');
  const CONTROLLERS = zoneAccess.CONTROLLERS || { ME: 'me', OPPONENT: 'opponent' };
  const effects = [];
  const LION_IDS = ['베이비 라이온','젊은 라이온','에이스 라이온','사자의 포효','사자의 사냥','사자의 발톱','사자의 일격','진정한 사자','고고한 사자','라이온 킹'];

  function getState(ctx) { return (ctx && ctx.gameState) || (typeof G !== 'undefined' ? G : global.G); } // eslint-disable-line no-undef
  function cards() { return (typeof CARDS !== 'undefined' && CARDS) || global.CARDS || {}; } // eslint-disable-line no-undef
  function def(cardOrId) { return cards()[id(cardOrId)] || null; }
  function id(cardOrId) { return typeof cardOrId === 'string' ? cardOrId : (cardOrId && (cardOrId.id || cardOrId.cardId || cardOrId.name)) || ''; }
  function cardObj(cardId) { const d = def(cardId) || {}; return { id: cardId, name: d.name || cardId, atk: d.atk || 0, atkBase: d.atk || 0 }; }
  function ctrl(ctx) { return zoneAccess.normalizeController((ctx && ctx.controller) || CONTROLLERS.ME); }
  function opp(ctx) { return ctrl(ctx) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME; }
  function zone(ctx, controller, z) { return zoneAccess.getZoneArray(getState(ctx), controller || ctrl(ctx), z); }
  function deck(ctx) { return zone(ctx, ctrl(ctx), ZONES.DECK); }
  function hand(ctx) { return zone(ctx, ctrl(ctx), ZONES.HAND); }
  function field(ctx, controller) { return zone(ctx, controller || ctrl(ctx), ZONES.FIELD); }
  function grave(ctx) { return zone(ctx, ctrl(ctx), ZONES.GRAVE); }
  function isMonster(c) { const d = def(c); return !!(d && d.cardType === 'monster'); }
  function isLion(c) { const d = def(c); return !!(d && d.theme === '라이온'); }
  function isLionMonster(c) { return isLion(c) && isMonster(c); }
  function isSaja(c) { const x = id(c); return x.includes('사자') || x === '진정한 사자' || x === '고고한 사자'; }
  function isSajaMonster(c) { return isSaja(c) && isMonster(c); }
  function first(list, pred) { return (list || []).find(pred || (x => x)); }
  function selectedId(ctx) { return id(ctx && (ctx.selectedCard || ctx.target || ctx.selectedTarget || ctx.selectedCardId)); }
  function choose(ctx, list, pred) { const sid = selectedId(ctx); if (sid) { const hit = (list || []).find(c => id(c) === sid && (!pred || pred(c))); if (hit) return hit; } return first(list, pred); }
  function hasFieldSpace(ctx, controller) { return global.HB_CARD_MOVE && global.HB_CARD_MOVE.hasFieldSpace ? global.HB_CARD_MOVE.hasFieldSpace(getState(ctx), controller || ctrl(ctx)) : field(ctx, controller).length < 5; }
  function mv(ctx) { return ctx.move; }
  function addHand(ctx, c, from, reason, reveal) { return mv(ctx).addToHand({ cardId: id(c), controller: ctrl(ctx), from: { controller: ctrl(ctx), zone: from }, reason, reveal: !!reveal }); }
  function summon(ctx, c, from, reason) { return mv(ctx).summonCard({ cardId: id(c), controller: ctrl(ctx), from: { controller: ctrl(ctx), zone: from }, reason }); }
  function graveSend(ctx, c, from, controller, reason) { const owner = controller || ctrl(ctx); return mv(ctx).sendToGrave({ cardId: id(c), controller: owner, from: { controller: owner, zone: from }, reason }); }
  function banish(ctx, c, from, controller, reason) { const owner = controller || ctrl(ctx); return mv(ctx).banishCard({ cardId: id(c), controller: owner, from: { controller: owner, zone: from }, reason }); }
  function dispatch(ctx) { if (global.HB_EVENTS) global.HB_EVENTS.dispatchEvents(getState(ctx)); try { if (typeof sendGameState === 'function') sendGameState(); if (typeof renderAll === 'function') renderAll(); } catch (_) {} } // eslint-disable-line no-undef
  function canUseDeploy() { if (typeof currentPhase === 'undefined') return true; return currentPhase === 'deploy' || currentPhase === '전개'; } // eslint-disable-line no-undef
  function mk(o) { return Object.assign({ theme: '라이온', optional: true }, o); }
  function add(o) { effects.push(mk(o)); }

  // 이름 취급/존 확장/전투 보호 지속효과
  add({ id: 'lion-baby-2-zone-plus', cardId: '베이비 라이온', effectNo: 2, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD], continuousRule: { monsterZoneDelta: ctx => ({ controller: ctx.controller, amount: 1 }) } });
  add({ id: 'lion-young-3-zone-plus', cardId: '젊은 라이온', effectNo: 3, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD], continuousRule: { monsterZoneDelta: ctx => ({ controller: ctx.controller, amount: 1 }) } });
  add({ id: 'lion-ace-3-battle-protect', cardId: '에이스 라이온', effectNo: 3, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD], continuousRule: { cannotBeSentToGrave: (checkCtx, sourceCtx) => checkCtx.reason === 'battle' && checkCtx.targetController === sourceCtx.controller && isLion(checkCtx.target) } });
  add({ id: 'true-lion-name-treated-as-saja', cardId: '진정한 사자', effectNo: 0, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD, ZONES.HAND, ZONES.GRAVE, ZONES.EXILE], continuousRule: { nameTreatAs: ['사자'] } });
  add({ id: 'lonely-lion-name-treated-as-saja', cardId: '고고한 사자', effectNo: 0, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD, ZONES.HAND, ZONES.GRAVE, ZONES.EXILE], continuousRule: { nameTreatAs: ['사자'] } });

  add({ id: 'baby-lion-1-search-two-and-summon-self', cardId: '베이비 라이온', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND, ZONES.GRAVE], timing: TIMING.MY_DEPLOY, tags: [TAGS.DECK_SEARCH || 'deckSearch'], oncePerTurn: { key: '베이비 라이온_1', limit: 1 }, canResolve: ctx => deck(ctx).some(c => isLion(c) && id(c) !== '베이비 라이온') && deck(ctx).some(isSaja) && hasFieldSpace(ctx), resolve(ctx) { const l = choose(ctx, deck(ctx), c => isLion(c) && id(c) !== '베이비 라이온'); const s = choose(ctx, deck(ctx), isSaja); const r1 = l ? addHand(ctx, l, ZONES.DECK, 'babyLionSearchLion', true) : { ok:false }; const r2 = s ? addHand(ctx, s, ZONES.DECK, 'babyLionSearchSaja', true) : { ok:false }; const selfZone = hand(ctx).some(c => id(c)==='베이비 라이온') ? ZONES.HAND : ZONES.GRAVE; const r3 = hasFieldSpace(ctx) ? summon(ctx, '베이비 라이온', selfZone, 'babyLionSummonSelf') : { ok:false }; dispatch(ctx); return { ok: r1.ok && r2.ok && r3.ok, results: [r1,r2,r3] }; } });
  add({ id: 'young-lion-1-public-hand-search-and-summon', cardId: '젊은 라이온', effectNo: 1, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.PUBLIC_HAND], events: [EVENTS.ADDED_TO_HAND], oncePerTurn: { key: '젊은 라이온_1', limit: 1 }, condition: ctx => ctx.event && ctx.event.cardId === '젊은 라이온', canResolve: ctx => deck(ctx).some(isLion) && hand(ctx).some(isLionMonster) && hasFieldSpace(ctx), resolve(ctx) { const s = choose(ctx, deck(ctx), isLion); const h = choose(ctx, hand(ctx), isLionMonster); const r1 = addHand(ctx, s, ZONES.DECK, 'youngLionSearch', true); const r2 = summon(ctx, h, ZONES.HAND, 'youngLionSummon'); dispatch(ctx); return { ok: r1.ok && r2.ok, results: [r1,r2] }; } });
  add({ id: 'young-lion-2-on-summon-search-saja', cardId: '젊은 라이온', effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD], events: [EVENTS.SUMMON], timing: TIMING.ON_SUMMON, oncePerTurn: { key: '젊은 라이온_2', limit: 1 }, condition: ctx => ctx.event && ctx.event.cardId === '젊은 라이온', canResolve: ctx => deck(ctx).some(isSaja), resolve(ctx) { const r = addHand(ctx, choose(ctx, deck(ctx), isSaja), ZONES.DECK, 'youngLionSearchSaja', true); dispatch(ctx); return r; } });
  add({ id: 'ace-lion-1-hand-summon-send-one-field', cardId: '에이스 라이온', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], oncePerTurn: { key: '에이스 라이온_1', limit: 1 }, canResolve: ctx => field(ctx).some(isLionMonster) && hasFieldSpace(ctx) && (field(ctx).length + field(ctx, opp(ctx)).length > 0), resolve(ctx) { const r1 = summon(ctx, '에이스 라이온', ZONES.HAND, 'aceLionSummon'); const target = choose(ctx, field(ctx).concat(field(ctx, opp(ctx))), x => !!x); const owner = field(ctx).some(c => id(c) === id(target)) ? ctrl(ctx) : opp(ctx); const r2 = target ? graveSend(ctx, target, ZONES.FIELD, owner, 'aceLionSendField') : { ok: true }; dispatch(ctx); return { ok: r1.ok && r2.ok, results: [r1,r2] }; } });
  add({ id: 'ace-lion-2-sent-search-saja-and-lion', cardId: '에이스 라이온', effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.GRAVE], events: [EVENTS.SENT_TO_GRAVE], oncePerTurn: { key: '에이스 라이온_2', limit: 1 }, condition: ctx => ctx.event && ctx.event.cardId === '에이스 라이온', canResolve: ctx => deck(ctx).concat(grave(ctx)).some(isSaja) && deck(ctx).concat(grave(ctx)).some(isLion), resolve(ctx) { const poolS = deck(ctx).map(c=>Object.assign({_z:ZONES.DECK},c)).concat(grave(ctx).map(c=>Object.assign({_z:ZONES.GRAVE},c))); const s = choose(ctx, poolS, isSaja); const l = choose(ctx, poolS, c => isLion(c) && id(c)!==id(s)); const r1 = s ? addHand(ctx, s, s._z, 'aceLionSearchSaja', true) : {ok:false}; const r2 = l ? addHand(ctx, l, l._z, 'aceLionSearchLion', true) : {ok:false}; dispatch(ctx); return { ok: r1.ok && r2.ok, results: [r1,r2] }; } });

  add({ id: 'lion-roar-send-deck-lion-monsters', cardId: '사자의 포효', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], canResolve: ctx => deck(ctx).some(isLionMonster), resolve(ctx) { const targets = deck(ctx).filter(isLionMonster).slice(); const results = targets.map(c => graveSend(ctx, c, ZONES.DECK, ctrl(ctx), 'lionRoarDeckToGrave')); dispatch(ctx); return { ok: results.length > 0, results }; } });
  add({ id: 'lion-hunt-hand-summon-saja', cardId: '사자의 사냥', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], canResolve: ctx => hand(ctx).some(isSajaMonster) && hasFieldSpace(ctx), resolve(ctx) { const r = summon(ctx, choose(ctx, hand(ctx), isSajaMonster), ZONES.HAND, 'lionHuntSummon'); dispatch(ctx); return r; } });
  add({ id: 'lion-claw-grave-summon-saja', cardId: '사자의 발톱', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], canResolve: ctx => grave(ctx).some(isSajaMonster) && hasFieldSpace(ctx), resolve(ctx) { const r = summon(ctx, choose(ctx, grave(ctx), isSajaMonster), ZONES.GRAVE, 'lionClawSummon'); dispatch(ctx); return r; } });
  add({ id: 'lion-strike-op-hand-return', cardId: '사자의 일격', effectNo: 1, type: EFFECT_TYPES.QUICK, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, canResolve: ctx => field(ctx).some(isLionMonster), resolve(ctx) { try { if (typeof sendAction === 'function') sendAction({ type:'forceReturnHand', count: field(ctx).filter(isLionMonster).length, reason:'사자의 일격' }); } catch (_) {} dispatch(ctx); return { ok:true }; } });
  add({ id: 'true-lion-1-send-three-from-deck-and-summon-one', cardId: '진정한 사자', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], canResolve: ctx => ['베이비 라이온','젊은 라이온','에이스 라이온'].every(n => deck(ctx).some(c => id(c)===n)) && hasFieldSpace(ctx), resolve(ctx) { const names = ['베이비 라이온','젊은 라이온','에이스 라이온']; const picked = names.map(n => first(deck(ctx), c => id(c)===n)); const summonPick = choose(ctx, picked) || picked[0]; picked.forEach(c => { if (id(c)!==id(summonPick)) addHand(ctx, c, ZONES.DECK, 'trueLionRevealToHand', true); }); const r = summon(ctx, summonPick, ZONES.DECK, 'trueLionSummonSelected'); dispatch(ctx); return r; } });
  add({ id: 'lion-king-1-procedure-summon', cardId: '라이온 킹', effectNo: 1, type: EFFECT_TYPES.PROCEDURE, zones: [ZONES.HAND], summonProcedure: true, canResolve: ctx => field(ctx).filter(isMonster).length >= 4 && hasFieldSpace(ctx), resolve(ctx) { const mats = field(ctx).filter(isMonster).slice(0,4); const costs = mats.map(c => graveSend(ctx, c, ZONES.FIELD, ctrl(ctx), 'lionKingCost')); const r = summon(ctx, '라이온 킹', ZONES.HAND, 'lionKingProcedure'); dispatch(ctx); return { ok: r.ok && costs.every(x=>x.ok), costs, summon: r }; } });
  add({ id: 'lion-king-2-on-summon-send-op-field-all', cardId: '라이온 킹', effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD], events: [EVENTS.SUMMON], oncePerTurn: { key: '라이온 킹_2', limit: 1 }, condition: ctx => ctx.event && ctx.event.cardId === '라이온 킹', canResolve: ctx => field(ctx, opp(ctx)).length > 0, resolve(ctx) { const results = field(ctx, opp(ctx)).slice().map(c => graveSend(ctx, c, ZONES.FIELD, opp(ctx), 'lionKingSendAll')); dispatch(ctx); return { ok: results.length > 0, results }; } });
  add({ id: 'lion-king-3-grave-revive-banish-op-monster', cardId: '라이온 킹', effectNo: 3, type: EFFECT_TYPES.QUICK, zones: [ZONES.GRAVE], timing: TIMING.EITHER_TURN, oncePerTurn: { key: '라이온 킹_3', limit: 1 }, canResolve: ctx => field(ctx).filter(isMonster).length >= 5 && grave(ctx).some(c => id(c)==='라이온 킹') && hasFieldSpace(ctx), resolve(ctx) { const costs = field(ctx).filter(isMonster).slice(0,5).map(c => graveSend(ctx, c, ZONES.FIELD, ctrl(ctx), 'lionKing3Cost')); const r1 = summon(ctx, '라이온 킹', ZONES.GRAVE, 'lionKingRevive'); const op = choose(ctx, field(ctx, opp(ctx)), isMonster); const r2 = op ? banish(ctx, op, ZONES.FIELD, opp(ctx), 'lionKing3Banish') : { ok:true }; dispatch(ctx); return { ok: r1.ok && costs.every(x=>x.ok), costs, r1, r2 }; } });
  add({ id: 'lonely-lion-1-search', cardId: '고고한 사자', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], condition: canUseDeploy, canResolve: ctx => deck(ctx).some(c => isLion(c) || isSaja(c)), resolve(ctx) { const r = addHand(ctx, choose(ctx, deck(ctx), c => isLion(c) || isSaja(c)), ZONES.DECK, 'lonelyLionSearch', true); dispatch(ctx); return r; } });
  add({ id: 'lonely-lion-2-banish-op-field', cardId: '고고한 사자', effectNo: 2, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.HAND], condition: canUseDeploy, canResolve: ctx => field(ctx, opp(ctx)).length > 0, resolve(ctx) { const r = banish(ctx, choose(ctx, field(ctx, opp(ctx))), ZONES.FIELD, opp(ctx), 'lonelyLionBanish'); dispatch(ctx); return r; } });

  registry.registerEffects(effects); registry.syncEffectIdsToCards();
  const api = Object.freeze({ getLionEffectIds: () => effects.map(e=>e.id), isSajaCard: isSaja, isLionCard: isLion, getLionImplementationSpec: () => Object.freeze({ phase:'16-8', cards:LION_IDS, effectCount:effects.length, criticalChecks:['몬스터 존 확장 continuous','사자/라이온 명칭 취급','라이온 킹 procedure','처리 불가 발동 차단'] }) });
  global.HB_LION_EFFECTS = api;
})(window);
