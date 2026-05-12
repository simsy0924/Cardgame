// HAND BATTLE — Theme Effects: Bulgasaui
// 16-6단계: 불가사의 테마를 EffectDefinition 기반으로 이식한다.
// 핵심 원칙:
// - 불가사의는 불가사의한 밤의 대도시에 의존한다.
// - “발동” 문구가 없는 도시 의존 소환은 procedure이며 체인을 만들지 않는다.
// - “처리 시 무효”는 일반 체인 응답이 아니라 processingNegate다.
// - 처리 불가능한 서치/소환/제외/묘지 보내기는 canResolve에서 발동 전 차단한다.
(function initBulgasauiEffectDefinitions(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({ ACTIVATION: 'activation', QUICK: 'quick', TRIGGER: 'trigger', CONTINUOUS: 'continuous', PROCEDURE: 'procedure', PROCESSING_NEGATE: 'processingNegate' });
  const ZONES = rules.ZONES || Object.freeze({ DECK: 'deck', HAND: 'hand', PUBLIC_HAND: 'publicHand', FIELD: 'field', FIELD_ZONE: 'fieldZone', GRAVE: 'grave', EXILE: 'exile', KEY_DECK: 'keyDeck' });
  const EVENTS = rules.EVENTS || Object.freeze({ SUMMON: 'summon', SENT_TO_GRAVE: 'sentToGrave', EXILED: 'exiled', CARD_ACTIVATED: 'cardActivated' });
  const TIMING = rules.TIMING || Object.freeze({ MY_DEPLOY: 'myDeploy', OPPONENT_DEPLOY: 'opponentDeploy', EITHER_TURN: 'eitherTurn', ON_SUMMON: 'onSummon', ON_SENT_TO_GRAVE: 'onSentToGrave', NONE: 'none' });
  const TAGS = rules.EFFECT_TAGS || Object.freeze({ DECK_SEARCH: 'deckSearch', DECK_SUMMON: 'deckSummon', GRAVE_SUMMON: 'graveSummon', EXILE_SUMMON: 'exileSummon', KEY_DECK_SUMMON: 'keyDeckSummon', COST_DISCARD: 'costDiscard', COST_BANISH: 'costBanish', COST_SEND_TO_GRAVE: 'costSendToGrave', DRAW: 'draw', DISCARD_HAND: 'discardHand', BANISH_FIELD: 'banishField', PLACE_FIELD_CARD: 'placeFieldCard', FIELD_ZONE_EFFECT: 'fieldZoneEffect', TARGET_MY_FIELD: 'targetMyField', SEND_MY_FIELD_TO_GRAVE: 'sendMyFieldToGrave', NEGATE_EFFECT: 'negateEffect' });

  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry) throw new Error('[bulgasaui-effects] HB_EFFECT_REGISTRY가 필요합니다.');
  if (!zoneAccess) throw new Error('[bulgasaui-effects] HB_ZONE_ACCESS가 필요합니다.');

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const CITY_ID = '불가사의한 밤의 대도시';
  const BULGASAUI_IDS = Object.freeze([
    '불가사의한 귀신 헬리콥터',
    '불가사의한 망태 할아버지',
    '불가사의한 빨간 마스크',
    '불가사의한 장산범',
    '불가사의한 밤의 대도시',
    '불가사의한 화폐 속 암호',
    '불가사의한 분신사바',
    '불가사의한 숨바꼭질 인형',
    '불가사의한 13일의 금요일',
    '불가사의한 적월',
    '불가사의한 지배',
    '불가사의한 원흉',
    '불가사의한 일루미나티',
  ]);
  const BULGASAUI_MONSTERS = Object.freeze([
    '불가사의한 망태 할아버지',
    '불가사의한 빨간 마스크',
    '불가사의한 장산범',
    '불가사의한 숨바꼭질 인형',
    '불가사의한 원흉',
  ]);

  function getDefaultGameState() { if (typeof G !== 'undefined') return G; return global.G || null; } // eslint-disable-line no-undef
  function getCardDatabase() { if (typeof CARDS !== 'undefined' && CARDS) return CARDS; return global.CARDS || null; } // eslint-disable-line no-undef
  function stateOf(ctxOrState) { return (ctxOrState && ctxOrState.gameState) || ctxOrState || getDefaultGameState(); }
  function getCardId(cardOrId) { if (!cardOrId) return ''; if (typeof cardOrId === 'string') return cardOrId; return cardOrId.id || cardOrId.cardId || ''; }
  function getCardDef(cardOrId) { const cards = getCardDatabase(); const id = getCardId(cardOrId); return cards && id ? cards[id] || null : null; }
  function cardObj(cardId) { const def = getCardDef(cardId) || {}; return { id: cardId, name: def.name || cardId, atk: def.atk || 0, atkBase: def.atk || 0 }; }
  function normalizeController(controller) { return zoneAccess.normalizeController(controller || CONTROLLERS.ME); }
  function my(ctx) { return normalizeController(ctx && ctx.controller); }
  function opp(ctx) { return my(ctx) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME; }
  function zoneArray(ctx, controller, zone) { return zoneAccess.getZoneArray(stateOf(ctx), normalizeController(controller || CONTROLLERS.ME), zone); }
  function field(ctx, controller) { return zoneArray(ctx, controller, ZONES.FIELD); }
  function hand(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.HAND); }
  function handAfterActivationCost(ctx) {
    const h = hand(ctx);
    if (ctx && ctx.sourceZone === ZONES.HAND && typeof ctx.sourceIndex === 'number') {
      return h.filter((_, index) => index !== ctx.sourceIndex);
    }
    return h.slice();
  }
  function grave(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.GRAVE); }
  function exile(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.EXILE); }
  function deck(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.DECK); }
  function keyDeck(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.KEY_DECK); }
  function publicHand(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.PUBLIC_HAND); }
  function isBulgasaui(c) { const def = getCardDef(c); return !!(def && def.theme === '불가사의'); }
  function isBulgasauiMonster(c) { const def = getCardDef(c); return !!(def && def.theme === '불가사의' && def.cardType === 'monster'); }
  function isBulgasauiNonMonster(c) { const def = getCardDef(c); return !!(def && def.theme === '불가사의' && def.cardType !== 'monster'); }
  function isMonster(c) { const def = getCardDef(c); return !!(def && def.cardType === 'monster'); }
  function isFieldCard(c) { const def = getCardDef(c); return !!(def && def.cardType === 'field'); }
  function hasFieldSpace(ctx, controller) { return ctx.move && ctx.move.hasFieldSpace ? ctx.move.hasFieldSpace(controller || my(ctx)) : field(ctx, controller || my(ctx)).length < 5; }
  function hasCity(ctx) { const st = stateOf(ctx); const c = zoneAccess.getFieldZoneCard(st, my(ctx)); return !!(c && getCardId(c) === CITY_ID); }
  function first(list, pred) { return (list || []).find(pred || (x => x)); }
  function findIndexById(list, id) { return (list || []).findIndex(c => getCardId(c) === id); }
  function removeFrom(list, cardOrId) { const id = getCardId(cardOrId); const i = findIndexById(list, id); return i >= 0 ? list.splice(i, 1)[0] : null; }
  function selectedId(ctx) { return getCardId((ctx && (ctx.selectedCard || ctx.selectedTarget || ctx.target)) || (ctx && ctx.selectedCardId)); }
  function choose(ctx, list, pred) { const sid = selectedId(ctx); if (sid) { const hit = (list || []).find(c => getCardId(c) === sid && (!pred || pred(c))); if (hit) return hit; } return first(list, pred); }
  function notifySafe(msg) { try { if (typeof notify === 'function') notify(msg); } catch (_) {} } // eslint-disable-line no-undef
  function logSafe(msg, type) { try { if (typeof log === 'function') log(msg, type || 'mine'); } catch (_) {} } // eslint-disable-line no-undef
  function sync() { try { if (typeof sendGameState === 'function') sendGameState(); } catch (_) {} try { if (typeof renderAll === 'function') renderAll(); } catch (_) {} } // eslint-disable-line no-undef
  function dispatch(ctx) { if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') global.HB_EVENTS.dispatchEvents(ctx.gameState); sync(); }
  function draw(ctx, n) { let count = 0; for (let i = 0; i < (n || 1); i += 1) { const d = deck(ctx); if (!d.length) break; hand(ctx).push(d.shift()); count += 1; } if (count) logSafe(`불가사의: ${count}장 드로우`, 'mine'); return count; }
  function canDraw(ctx, n) { return deck(ctx).length >= (n || 1); }
  function searchToHand(ctx, pred, reason) { const target = choose(ctx, deck(ctx), pred); if (!target) return false; const r = ctx.move.addToHand({ cardId: getCardId(target), from: { controller: my(ctx), zone: ZONES.DECK }, reason: reason || 'bulgasauiSearch' }); return !!(r && r.ok !== false); }
  function sendDeckToGrave(ctx, pred, reason) { const target = choose(ctx, deck(ctx), pred); if (!target) return false; const r = ctx.move.sendToGrave({ cardId: getCardId(target), from: { controller: my(ctx), zone: ZONES.DECK }, reason: reason || 'bulgasauiSendDeckToGrave' }); return !!(r && r.ok !== false); }
  function addToHandFromZone(ctx, card, zone, reason) { const r = ctx.move.addToHand({ cardId: getCardId(card), from: { controller: my(ctx), zone }, reason: reason || 'bulgasauiRecover' }); return !!(r && r.ok !== false); }
  function summonFromZone(ctx, card, zone, reason) { if (!hasFieldSpace(ctx, my(ctx))) return false; const r = ctx.move.summonCard({ cardId: getCardId(card), from: { controller: my(ctx), zone }, reason: reason || 'bulgasauiSummon' }); return !!(r && r.ok !== false); }
  function banishFromZone(ctx, controller, zone, card, reason) { const r = ctx.move.banishCard({ cardId: getCardId(card), from: { controller: controller || my(ctx), zone }, reason: reason || 'bulgasauiBanish' }); return !!(r && r.ok !== false); }
  function sendFieldToGrave(ctx, controller, card, reason) { const r = ctx.move.sendToGrave({ cardId: getCardId(card), from: { controller: controller || my(ctx), zone: ZONES.FIELD }, reason: reason || 'bulgasauiSendFieldToGrave' }); return !!(r && r.ok !== false); }
  function discardOne(ctx, reason) { if (!hand(ctx).length) return false; const c = hand(ctx).shift(); grave(ctx).push(c); logSafe(`${reason || '불가사의'}: ${getCardId(c)} 버림`, 'mine'); return true; }
  function discardSelfAndOne(ctx, cardId, reason) { const h = hand(ctx); const self = removeFrom(h, cardId); if (!self || !h.length) { if (self) h.push(self); return false; } grave(ctx).push(self); const other = h.shift(); grave(ctx).push(other); logSafe(`${reason || cardId}: ${cardId}와 패 1장을 버림`, 'mine'); return true; }
  function placeCityFromDeck(ctx) { if (!deck(ctx).some(c => getCardId(c) === CITY_ID)) return false; const r = ctx.move.placeFieldCard({ cardId: CITY_ID, controller: my(ctx), from: { controller: my(ctx), zone: ZONES.DECK }, reason: 'bulgasauiPlaceCityByEffect', activate: false }); return !!(r && r.ok !== false); }
  function graveExileBulgasaui(ctx, pred) { return grave(ctx).concat(exile(ctx)).filter(c => isBulgasaui(c) && (!pred || pred(c))); }
  function graveExileBulgasauiMonsters(ctx) { return graveExileBulgasaui(ctx, isBulgasauiMonster); }
  function reviveBulgasaui(ctx, pred, reason) { const target = choose(ctx, graveExileBulgasaui(ctx, c => isBulgasauiMonster(c) && (!pred || pred(c)))); if (!target) return false; const from = grave(ctx).some(c => getCardId(c) === getCardId(target)) ? ZONES.GRAVE : ZONES.EXILE; return summonFromZone(ctx, target, from, reason || 'bulgasauiRevive'); }
  function canReviveBulgasaui(ctx, pred) { return hasCity(ctx) && hasFieldSpace(ctx, my(ctx)) && graveExileBulgasaui(ctx, c => isBulgasauiMonster(c) && (!pred || pred(c))).length > 0; }
  function banishOpponentOneEach(ctx) { let n = 0; const oh = hand(ctx, opp(ctx)); if (oh.length) { const c = oh.shift(); exile(ctx, opp(ctx)).push(c); n += 1; }
    const of = field(ctx, opp(ctx)); if (of.length) { const c = of[0]; if (banishFromZone(ctx, opp(ctx), ZONES.FIELD, c, 'originBanishOpponentField')) n += 1; }
    const og = grave(ctx, opp(ctx)); if (og.length) { const c = og.shift(); exile(ctx, opp(ctx)).push(c); n += 1; }
    return n; }
  function fieldAndFieldZoneTargets(ctx, controller) { const list = field(ctx, controller).slice(); const fz = zoneAccess.getFieldZoneCard(stateOf(ctx), controller); if (fz) list.push(Object.assign({ _fieldZone: true }, fz)); return list; }
  function banishFieldOrFieldZone(ctx, controller, card) { if (!card) return false; if (card._fieldZone) { const fz = zoneAccess.getFieldZoneCard(stateOf(ctx), controller); if (fz && getCardId(fz) === getCardId(card)) { zoneAccess.clearFieldZoneCard(stateOf(ctx), controller); exile(ctx, controller).push(fz); return true; } return false; } return banishFromZone(ctx, controller, ZONES.FIELD, card, 'bulgasauiBanishField'); }
  function uniqueById(cards) { const seen = new Set(); const out = []; (cards || []).forEach(c => { const id = getCardId(c); if (!id || seen.has(id)) return; seen.add(id); out.push(c); }); return out; }
  function noActiveChain() { return !(global.HB_CHAIN_ENGINE && global.HB_CHAIN_ENGINE.hasActiveChain && global.HB_CHAIN_ENGINE.hasActiveChain()); }
  function currentPhaseValue(ctx) { return (ctx && ctx.gameState && ctx.gameState.phase) || (typeof currentPhase !== 'undefined' ? currentPhase : null); } // eslint-disable-line no-undef
  function isDeployPhase(ctx) { const phase = currentPhaseValue(ctx); return !phase || phase === 'deploy' || phase === '전개' || phase === 'main'; }
  function isOpponentTurn(ctx) { if (ctx && ctx.gameState && ctx.gameState.activeController) return ctx.gameState.activeController === opp(ctx); if (typeof isMyTurn !== 'undefined') return !isMyTurn; return true; } // eslint-disable-line no-undef

  const effects = [];
  function add(effect) { effects.push(Object.assign({ theme: '불가사의' }, effect)); return effect; }

  // 공통: 도시가 있으면 묘지/제외의 불가사의 몬스터는 소환 절차로 나온다.
  BULGASAUI_MONSTERS.forEach(id => {
    add({ id: `bulgasaui-${id}-1-city-grave-exile-procedure`, cardId: id, effectNo: 1, type: EFFECT_TYPES.PROCEDURE, zones: [ZONES.GRAVE, ZONES.EXILE], timing: TIMING.MY_DEPLOY, isActivated: false, summonProcedure: true, label: '도시 소환', tags: [TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON], text: '불가사의한 밤의 대도시가 존재할 경우 묘지/제외 상태에서 소환할 수 있다.', condition: ctx => hasCity(ctx) && noActiveChain() && isDeployPhase(ctx), canResolve: ctx => canReviveBulgasaui(ctx, c => getCardId(c) === id), resolve(ctx) { const source = grave(ctx).some(c => getCardId(c) === id) ? ZONES.GRAVE : ZONES.EXILE; const ok = summonFromZone(ctx, id, source, 'bulgasauiCityProcedure'); if (ok) dispatch(ctx); return ok; } });
  });

  // 마법/필드/키 카드 발동형
  add({ id: 'bulgasaui-ghost-helicopter-1-search-draw', cardId: '불가사의한 귀신 헬리콥터', effectNo: 1, type: EFFECT_TYPES.QUICK, cardActivationCost: true, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: [TAGS.DECK_SEARCH, TAGS.DRAW], text: '덱에서 불가사의 카드 1장을 패에 넣고 1장 드로우한다.', canResolve: ctx => deck(ctx).some(isBulgasaui) && canDraw(ctx, 1), resolve(ctx) { const ok = searchToHand(ctx, isBulgasaui, '귀신 헬리콥터①'); if (ok) draw(ctx, 1); dispatch(ctx); return ok; } });

  add({ id: 'bulgasaui-grandpa-2-discard-place-city-draw', cardId: '불가사의한 망태 할아버지', effectNo: 2, type: EFFECT_TYPES.QUICK, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: [TAGS.COST_DISCARD, TAGS.PLACE_FIELD_CARD, TAGS.DRAW], text: '이 카드와 패 1장을 버리고 덱에서 도시를 필드 존에 놓고 1장 드로우한다.', canResolve: ctx => hand(ctx).some(c => getCardId(c) === '불가사의한 망태 할아버지') && hand(ctx).length >= 2 && deck(ctx).some(c => getCardId(c) === CITY_ID) && canDraw(ctx, 1), cost(ctx) { const ok = discardSelfAndOne(ctx, '불가사의한 망태 할아버지', '망태 할아버지② cost'); return ok ? { ok: true } : { ok: false, error: '이 카드와 버릴 패 1장이 필요합니다.' }; }, resolve(ctx) { const ok = placeCityFromDeck(ctx); if (ok) draw(ctx, 1); dispatch(ctx); return ok; } });

  add({ id: 'bulgasaui-red-mask-2-search-nonmonster', cardId: '불가사의한 빨간 마스크', effectNo: 2, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.FIELD], timing: TIMING.MY_DEPLOY, tags: [TAGS.DECK_SEARCH], text: '자신 전개 단계에 덱에서 몬스터 이외의 불가사의 카드 1장을 패에 넣는다.', condition: isDeployPhase, canResolve: ctx => deck(ctx).some(isBulgasauiNonMonster), resolve(ctx) { const ok = searchToHand(ctx, isBulgasauiNonMonster, '빨간 마스크②'); dispatch(ctx); return ok; } });

  add({ id: 'bulgasaui-jangsanbeom-2-summon-from-grave-exile-draw', cardId: '불가사의한 장산범', effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD], events: [EVENTS.SUMMON], timing: TIMING.ON_SUMMON, optional: true, tags: [TAGS.DRAW], text: '묘지/제외 상태에서 몬스터가 소환됐을 경우 불가사의 몬스터 종류 수만큼 드로우한다.', condition: ctx => ctx.event && ctx.event.type === EVENTS.SUMMON && (ctx.event.from?.zone === ZONES.GRAVE || ctx.event.from?.zone === ZONES.EXILE), canResolve: ctx => canDraw(ctx, Math.max(1, uniqueById(field(ctx, my(ctx)).filter(isBulgasauiMonster)).length)), resolve(ctx) { const n = Math.max(1, uniqueById(field(ctx, my(ctx)).filter(isBulgasauiMonster)).length); const drew = draw(ctx, n); dispatch(ctx); return drew > 0; } });

  add({ id: 'bulgasaui-city-1-discard-send-monster', cardId: CITY_ID, effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.FIELD_ZONE], timing: TIMING.MY_DEPLOY, tags: [TAGS.FIELD_ZONE_EFFECT, TAGS.COST_DISCARD, TAGS.COST_SEND_TO_GRAVE], text: '패를 1장 버리고 덱에서 불가사의 몬스터 1장을 묘지로 보낸다.', canResolve: ctx => hand(ctx).length > 0 && deck(ctx).some(isBulgasauiMonster), cost(ctx) { const ok = discardOne(ctx, '도시① cost'); return ok ? { ok: true } : { ok: false, error: '버릴 패가 없습니다.' }; }, resolve(ctx) { const ok = sendDeckToGrave(ctx, isBulgasauiMonster, '도시①'); dispatch(ctx); return ok; } });

  add({ id: 'bulgasaui-city-2-attack-atk-zero', cardId: CITY_ID, effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD_ZONE], events: ['attackDeclared'], timing: TIMING.NONE, optional: true, tags: [TAGS.FIELD_ZONE_EFFECT], text: '불가사의 몬스터가 전투를 실행하는 공격 선언 시 상대 몬스터 공격력을 0으로 한다.', condition: ctx => ctx.event && ctx.event.attacker && isBulgasauiMonster(ctx.event.attacker), canResolve: ctx => field(ctx, opp(ctx)).length > 0, resolve(ctx) { const target = choose(ctx, field(ctx, opp(ctx))); if (target) target.atk = 0; dispatch(ctx); return !!target; } });

  add({ id: 'bulgasaui-money-code-1-discard-search-recover', cardId: '불가사의한 화폐 속 암호', effectNo: 1, type: EFFECT_TYPES.QUICK, cardActivationCost: true, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: [TAGS.COST_DISCARD, TAGS.DECK_SEARCH, TAGS.DISCARD_HAND], text: '패를 1장 버리고 덱에서 불가사의 몬스터를 패에 넣는다. 그 후 묘지/제외 불가사의 카드를 회수할 수 있다.', canResolve: ctx => handAfterActivationCost(ctx).length > 0 && deck(ctx).some(isBulgasauiMonster), cost(ctx) { const ok = discardOne(ctx, '화폐 속 암호① cost'); return ok ? { ok: true } : { ok: false }; }, resolve(ctx) { const ok = searchToHand(ctx, isBulgasauiMonster, '화폐 속 암호①'); const recoverable = graveExileBulgasaui(ctx); if (ok && recoverable.length > 0 && hand(ctx).length > 0) { const target = choose(ctx, recoverable); const from = grave(ctx).some(c => getCardId(c) === getCardId(target)) ? ZONES.GRAVE : ZONES.EXILE; addToHandFromZone(ctx, target, from, '화폐 속 암호① recover'); discardOne(ctx, '화폐 속 암호① additional'); } dispatch(ctx); return ok; } });

  add({ id: 'bulgasaui-bunsinsaba-1-end-send-all-summon-trap', cardId: '불가사의한 분신사바', effectNo: 1, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.HAND, ZONES.GRAVE], events: ['endPhase'], timing: TIMING.NONE, optional: true, tags: [TAGS.SEND_MY_FIELD_TO_GRAVE, 'sendOpponentFieldToGrave', 'monsterSummon'], text: '상대 엔드 단계에 도시가 있으면 서로 필드의 몬스터를 전부 묘지로 보내고 이 카드를 상대 필드에 몬스터로 소환한다.', condition: ctx => hasCity(ctx) && isOpponentTurn(ctx), canResolve: ctx => hasFieldSpace(ctx, opp(ctx)) && (hand(ctx).some(c => getCardId(c) === '불가사의한 분신사바') || grave(ctx).some(c => getCardId(c) === '불가사의한 분신사바')), resolve(ctx) { field(ctx, my(ctx)).slice().forEach(c => sendFieldToGrave(ctx, my(ctx), c, '분신사바①')); field(ctx, opp(ctx)).slice().forEach(c => sendFieldToGrave(ctx, opp(ctx), c, '분신사바①')); const source = hand(ctx).some(c => getCardId(c) === '불가사의한 분신사바') ? ZONES.HAND : ZONES.GRAVE; const r = ctx.move.summonCard({ cardId: '불가사의한 분신사바', from: { controller: my(ctx), zone: source }, to: { controller: opp(ctx), zone: ZONES.FIELD }, reason: 'bunsinsabaSummonToOpponent' }); const summoned = first(field(ctx, opp(ctx)), c => getCardId(c) === '불가사의한 분신사바'); if (summoned) { summoned.atk = 77; summoned.atkBase = 77; summoned.treatedAsMonster = true; } dispatch(ctx); return !!(r && r.ok !== false); } });

  add({ id: 'bulgasaui-hide-doll-2-continuous-atk', cardId: '불가사의한 숨바꼭질 인형', effectNo: 2, type: EFFECT_TYPES.CONTINUOUS, zones: [ZONES.FIELD], timing: TIMING.NONE, text: '이 카드의 공격력은 자신 필드 몬스터 수 × 2만큼 오른다.', continuousRule: { attackModifier: { perOwnMonster: 2 } } });

  add({ id: 'bulgasaui-friday-13-1-game-once-search-grandpa', cardId: '불가사의한 13일의 금요일', effectNo: 1, type: EFFECT_TYPES.ACTIVATION, cardActivationCost: true, zones: [ZONES.HAND], timing: TIMING.MY_DEPLOY, oncePerGame: true, tags: [TAGS.DECK_SEARCH], text: '덱에서 불가사의한 망태 할아버지 1장을 패에 넣는다. 처리 후 상대는 퀵 타이밍에 효과를 발동할 수 없다.', canResolve: ctx => deck(ctx).some(c => getCardId(c) === '불가사의한 망태 할아버지'), resolve(ctx) { const ok = searchToHand(ctx, c => getCardId(c) === '불가사의한 망태 할아버지', '13일의 금요일①'); if (ok) ctx.gameState._suppressOpponentQuickTiming = true; dispatch(ctx); return ok; } });

  add({ id: 'bulgasaui-red-moon-1-banish-equal-fields', cardId: '불가사의한 적월', effectNo: 1, type: EFFECT_TYPES.QUICK, cardActivationCost: true, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: [TAGS.BANISH_FIELD], text: '자신 필드 불가사의 몬스터 수까지 서로 필드 카드를 같은 수만큼 제외한다.', canResolve: ctx => field(ctx, my(ctx)).some(isBulgasauiMonster) && fieldAndFieldZoneTargets(ctx, my(ctx)).length > 0 && fieldAndFieldZoneTargets(ctx, opp(ctx)).length > 0, resolve(ctx) { const max = field(ctx, my(ctx)).filter(isBulgasauiMonster).length; const myTargets = fieldAndFieldZoneTargets(ctx, my(ctx)); const opTargets = fieldAndFieldZoneTargets(ctx, opp(ctx)); const count = Math.min(max, myTargets.length, opTargets.length); for (let i = 0; i < count; i += 1) { banishFieldOrFieldZone(ctx, opp(ctx), opTargets[i]); banishFieldOrFieldZone(ctx, my(ctx), myTargets[i]); } dispatch(ctx); return count > 0; } });

  add({ id: 'bulgasaui-control-1-send-up-to-4-monsters', cardId: '불가사의한 지배', effectNo: 1, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.HAND], events: ['drawPhase'], timing: TIMING.NONE, optional: true, tags: [TAGS.COST_SEND_TO_GRAVE], text: '상대 드로우 단계에 도시가 있으면 덱에서 불가사의 몬스터를 4장까지 묘지로 보낸다.', condition: ctx => hasCity(ctx) && isOpponentTurn(ctx), canResolve: ctx => deck(ctx).some(isBulgasauiMonster), resolve(ctx) { let n = 0; while (n < 4 && deck(ctx).some(isBulgasauiMonster)) { if (!sendDeckToGrave(ctx, isBulgasauiMonster, '지배①')) break; n += 1; } dispatch(ctx); return n > 0; } });

  add({ id: 'bulgasaui-control-2-grave-return-revive-different', cardId: '불가사의한 지배', effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.GRAVE], events: ['deployPhase'], timing: TIMING.NONE, optional: true, tags: [TAGS.COST_BANISH, TAGS.GRAVE_SUMMON], text: '상대 전개 단계에 묘지의 이 카드를 키덱으로 되돌리고 카드명이 다른 불가사의 몬스터를 가능한 한 소환한다.', condition: ctx => hasCity(ctx) && isOpponentTurn(ctx), canResolve: ctx => grave(ctx).some(c => getCardId(c) === '불가사의한 지배') && graveExileBulgasauiMonsters(ctx).length > 0 && hasFieldSpace(ctx, my(ctx)), cost(ctx) { const c = removeFrom(grave(ctx), '불가사의한 지배'); if (!c) return { ok: false }; keyDeck(ctx).push(c); return { ok: true }; }, resolve(ctx) { const used = new Set(); let n = 0; while (hasFieldSpace(ctx, my(ctx))) { const target = graveExileBulgasauiMonsters(ctx).find(c => !used.has(getCardId(c))); if (!target) break; used.add(getCardId(target)); const from = grave(ctx).some(c => getCardId(c) === getCardId(target)) ? ZONES.GRAVE : ZONES.EXILE; if (summonFromZone(ctx, target, from, '지배②')) n += 1; else break; } dispatch(ctx); return n > 0; } });

  add({ id: 'bulgasaui-origin-2-opponent-turn-moved-banish-each', cardId: '불가사의한 원흉', effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.GRAVE, ZONES.EXILE], events: [EVENTS.SENT_TO_GRAVE, EVENTS.EXILED], timing: TIMING.NONE, optional: true, tags: ['banishOpponentHand', TAGS.BANISH_FIELD], text: '상대 턴에 이 카드가 묘지로 보내지거나 제외되었을 경우 상대 패/필드/묘지의 카드를 각각 1장까지 제외한다.', condition: ctx => isOpponentTurn(ctx) && ctx.event && ctx.event.cardId === '불가사의한 원흉', canResolve: ctx => hand(ctx, opp(ctx)).length + field(ctx, opp(ctx)).length + grave(ctx, opp(ctx)).length > 0, resolve(ctx) { const n = banishOpponentOneEach(ctx); dispatch(ctx); return n > 0; } });

  add({ id: 'bulgasaui-origin-3-replace-key-search-public-summon', cardId: '불가사의한 원흉', effectNo: 3, type: EFFECT_TYPES.REPLACEMENT || 'replacement', zones: [ZONES.KEY_DECK], timing: TIMING.NONE, isActivated: false, tags: [TAGS.KEY_DECK_SUMMON, TAGS.COST_DISCARD], text: '키 카드 덱에서 일반 패에 넣는 효과 대신 공개 패에 넣고 패 2장을 버려 소환한다.', canResolve: ctx => keyDeck(ctx).some(c => getCardId(c) === '불가사의한 원흉') && hand(ctx).length >= 2 && hasFieldSpace(ctx, my(ctx)), resolve(ctx) { const target = removeFrom(keyDeck(ctx), '불가사의한 원흉'); if (!target) return false; publicHand(ctx).push(Object.assign({}, target, { isPublic: true })); discardOne(ctx, '원흉③ cost'); discardOne(ctx, '원흉③ cost'); const ok = summonFromZone(ctx, '불가사의한 원흉', ZONES.PUBLIC_HAND, 'originReplacementSummon'); dispatch(ctx); return ok; } });

  add({ id: 'bulgasaui-illuminati-1-send-types-apply', cardId: '불가사의한 일루미나티', effectNo: 1, type: EFFECT_TYPES.QUICK, cardActivationCost: true, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: [TAGS.COST_SEND_TO_GRAVE, TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON, TAGS.DRAW, TAGS.PLACE_FIELD_CARD], text: '덱에서 불가사의 카드를 카드 종류별로 1장까지 묘지로 보내고 보낸 수에 따라 효과를 적용한다.', canResolve: ctx => deck(ctx).some(isBulgasaui), resolve(ctx) { const sentTypes = new Set(); let sent = 0; ['monster', 'magic', 'trap', 'field', 'normal'].forEach(type => { const t = first(deck(ctx), c => isBulgasaui(c) && getCardDef(c).cardType === type && !sentTypes.has(type)); if (t) { if (sendDeckToGrave(ctx, c => getCardId(c) === getCardId(t), '일루미나티①')) { sentTypes.add(type); sent += 1; } } }); if (sent >= 5) { const f = first(grave(ctx).concat(exile(ctx)), isFieldCard); if (f) { const from = grave(ctx).some(c => getCardId(c) === getCardId(f)) ? ZONES.GRAVE : ZONES.EXILE; ctx.move.placeFieldCard({ cardId: getCardId(f), controller: my(ctx), from: { controller: my(ctx), zone: from }, activate: false, reason: 'illuminatiPlaceField' }); } }
      if (sent >= 4) { const t = first(grave(ctx).concat(exile(ctx)), isBulgasaui); if (t) { const fromList = grave(ctx).some(c => getCardId(c) === getCardId(t)) ? grave(ctx) : exile(ctx); const rm = removeFrom(fromList, t); if (rm) deck(ctx).push(rm); } }
      if (sent >= 3) { const mon = first(field(ctx, my(ctx)), isBulgasauiMonster); if (mon) mon.atk = (mon.atk || 0) + Math.max(1, sentTypes.size); }
      if (sent >= 2 && hasFieldSpace(ctx, my(ctx))) reviveBulgasaui(ctx, null, '일루미나티① revive');
      if (sent >= 1) { const t = first(grave(ctx).concat(exile(ctx)), isBulgasaui); if (t) { const from = grave(ctx).some(c => getCardId(c) === getCardId(t)) ? ZONES.GRAVE : ZONES.EXILE; addToHandFromZone(ctx, t, from, '일루미나티① recover'); } if (canDraw(ctx, 1)) draw(ctx, 1); }
      dispatch(ctx); return sent > 0; } });

  // 처리 시 무효. 불가사의 테마의 “발동한다”가 없는 효과는 버튼/체인에 올라가지 않는다.
  add({ id: 'bulgasaui-grandpa-3-processing-negate-send-my-field', cardId: '불가사의한 망태 할아버지', effectNo: 3, type: EFFECT_TYPES.PROCESSING_NEGATE, zones: [ZONES.FIELD], timing: TIMING.NONE, isActivated: false, tags: [TAGS.NEGATE_EFFECT, TAGS.SEND_MY_FIELD_TO_GRAVE], negateTags: [TAGS.SEND_MY_FIELD_TO_GRAVE, TAGS.COST_SEND_TO_GRAVE], text: '자신 필드 카드를 묘지로 보내는 효과의 처리 시 그 효과를 무효로 할 수 있다.', condition: ctx => !!(ctx.chainLink && ctx.chainLink.controller === my(ctx)) });
  add({ id: 'bulgasaui-red-mask-3-processing-negate-target-my-field', cardId: '불가사의한 빨간 마스크', effectNo: 3, type: EFFECT_TYPES.PROCESSING_NEGATE, zones: [ZONES.FIELD], timing: TIMING.NONE, isActivated: false, tags: [TAGS.NEGATE_EFFECT, TAGS.TARGET_MY_FIELD], negateTags: [TAGS.TARGET_MY_FIELD], text: '자신 필드 카드를 대상으로 하는 효과의 처리 시 그 효과를 무효로 할 수 있다.' });
  add({ id: 'bulgasaui-jangsanbeom-3-processing-negate-search-summon', cardId: '불가사의한 장산범', effectNo: 3, type: EFFECT_TYPES.PROCESSING_NEGATE, zones: [ZONES.FIELD], timing: TIMING.NONE, isActivated: false, tags: [TAGS.NEGATE_EFFECT, TAGS.DECK_SEARCH, TAGS.DECK_SUMMON, TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON], negateTags: [TAGS.DECK_SEARCH, TAGS.DECK_SUMMON, TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON, TAGS.KEY_DECK_SUMMON], text: '덱에서 패에 넣거나 몬스터를 소환하는 효과의 처리 시 그 효과를 무효로 할 수 있다.' });
  add({ id: 'bulgasaui-hide-doll-3-processing-negate-discard', cardId: '불가사의한 숨바꼭질 인형', effectNo: 3, type: EFFECT_TYPES.PROCESSING_NEGATE, zones: [ZONES.FIELD], timing: TIMING.NONE, isActivated: false, tags: [TAGS.NEGATE_EFFECT, TAGS.DISCARD_HAND], negateTags: [TAGS.DISCARD_HAND, TAGS.COST_DISCARD], text: '패를 버리게 하는 효과의 처리 시 그 효과를 무효로 할 수 있다.' });
  add({ id: 'bulgasaui-origin-4-processing-negate-opponent-effect', cardId: '불가사의한 원흉', effectNo: 4, type: EFFECT_TYPES.PROCESSING_NEGATE, zones: [ZONES.FIELD], timing: TIMING.NONE, isActivated: false, tags: [TAGS.NEGATE_EFFECT, TAGS.DECK_SEARCH, TAGS.DECK_SUMMON, TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON, TAGS.SEND_MY_FIELD_TO_GRAVE, TAGS.TARGET_MY_FIELD, TAGS.DISCARD_HAND, TAGS.BANISH_FIELD, TAGS.DRAW, TAGS.PLACE_FIELD_CARD], negateTags: [TAGS.DECK_SEARCH, TAGS.DECK_SUMMON, TAGS.GRAVE_SUMMON, TAGS.EXILE_SUMMON, TAGS.KEY_DECK_SUMMON, TAGS.SEND_MY_FIELD_TO_GRAVE, TAGS.TARGET_MY_FIELD, TAGS.DISCARD_HAND, TAGS.BANISH_FIELD, TAGS.DRAW, TAGS.PLACE_FIELD_CARD, TAGS.NEGATE_EFFECT], text: '상대 효과의 처리 시 그 효과를 무효로 할 수 있다.', condition: ctx => !!(ctx.chainLink && ctx.chainLink.controller === opp(ctx)) });

  const registered = registry.registerEffects(effects);
  registry.syncEffectIdsToCards();

  global.HB_BULGASAUI_EFFECTS = Object.freeze({
    effects: registered,
    CITY_ID,
    BULGASAUI_IDS,
    BULGASAUI_MONSTERS,
    hasCity,
    isBulgasaui,
    isBulgasauiMonster,
    getBulgasauiEffectIds: () => effects.map(e => e.id),
    getBulgasauiImplementationSpec: () => Object.freeze({
      theme: '불가사의',
      registeredEffectCount: effects.length,
      cityDependentProcedures: effects.filter(e => e.type === EFFECT_TYPES.PROCEDURE).map(e => e.id),
      processingNegates: effects.filter(e => e.type === EFFECT_TYPES.PROCESSING_NEGATE).map(e => e.id),
      fieldZoneEffects: effects.filter(e => (e.zones || []).indexOf(ZONES.FIELD_ZONE) !== -1 || e.zone === ZONES.FIELD_ZONE).map(e => e.id),
      notes: ['도시가 필요한 효과는 condition/canResolve에 도시 조건을 포함한다.', '처리 시 무효는 processingNegate로 등록하여 일반 체인 응답과 분리한다.', '발동 문구가 없는 공격력/소환/무효 계열은 버튼으로 뜨지 않는다.', '처리 불가능한 서치/소환/제외/묘지 보내기는 canResolve에서 발동 전 차단한다.'],
    }),
  });
})(typeof window !== 'undefined' ? window : globalThis);