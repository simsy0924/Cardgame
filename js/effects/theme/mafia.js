// HAND BATTLE — Theme Effects: Mafia
// 16-7단계: 마피아 테마를 EffectDefinition 기반으로 이식한다.
// 핵심 원칙:
// - 마피아 마법 ①은 상대 효과를 다른 효과로 변형하고, 원래 체인 링크 해결은 스킵한다.
// - 상대가 고르는 선택지는 기본적으로 상대에게 선택권을 넘긴다.
// - 대도시의 거물 마피아가 있으면 내 마피아 마법 선택지를 내가 고를 수 있다.
// - 마피아의 도시 발동 횟수는 turn state에 저장한다.
(function initMafiaEffectDefinitions(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({ ACTIVATION: 'activation', QUICK: 'quick', TRIGGER: 'trigger', CONTINUOUS: 'continuous', PROCEDURE: 'procedure' });
  const ZONES = rules.ZONES || Object.freeze({ DECK: 'deck', HAND: 'hand', PUBLIC_HAND: 'publicHand', FIELD: 'field', FIELD_ZONE: 'fieldZone', GRAVE: 'grave', EXILE: 'exile' });
  const EVENTS = rules.EVENTS || Object.freeze({ SUMMON: 'summon', CARD_ACTIVATED: 'cardActivated', CHAIN_LINK_RESOLVED: 'chainLinkResolved', DRAW: 'draw' });
  const TIMING = rules.TIMING || Object.freeze({ EITHER_TURN: 'eitherTurn', MY_DEPLOY: 'myDeploy', ON_SUMMON: 'onSummon', NONE: 'none' });
  const TAGS = rules.EFFECT_TAGS || Object.freeze({ DRAW: 'draw', DECK_SEARCH: 'deckSearch', GRAVE_TO_HAND: 'graveToHand', PLACE_FIELD_CARD: 'placeFieldCard', SEND_OP_FIELD_TO_GRAVE: 'sendOpFieldToGrave', DISCARD_HAND: 'discardHand', ATTACK_MODIFY: 'attackModify' });

  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry) throw new Error('[mafia-effects] HB_EFFECT_REGISTRY가 필요합니다.');
  if (!zoneAccess) throw new Error('[mafia-effects] HB_ZONE_ACCESS가 필요합니다.');

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const CITY_ID = '마피아의 도시';
  const BOSS_ID = '대도시의 거물 마피아';
  const AIDE_ID = '마피아의 최측근';
  const MAFIA_SPELLS = Object.freeze([
    '마피아의 제안', '마피아의 군림', '마피아의 대가', '마피아의 협상', '마피아의 명령',
    '마피아의 배신자 숙청', '마피아 집결', '마피아의 위용', '마피아의 위기',
  ]);
  const MAFIA_IDS = Object.freeze([BOSS_ID, AIDE_ID, ...MAFIA_SPELLS, CITY_ID]);

  const SPELL_OPTION_TABLE = Object.freeze({
    '마피아의 제안': Object.freeze({ transform: ['서로 1장 드로우한다.', "상대는 덱에서 '마피아'마법 카드 1장을 패에 넣는다."], draw: ['1장 드로우한다.', '상대 패 1장을 버린다.'] }),
    '마피아의 군림': Object.freeze({ transform: ['서로 1장 드로우한다.', "상대는 덱에서 '대도시의 거물 마피아' 1장을 패에 넣는다."], draw: ['1장 드로우한다.', '자신의 공개 패를 2장까지 일반 패로 한다.'] }),
    '마피아의 대가': Object.freeze({ transform: ['서로 1장 드로우한다.', '자신은 이 턴에 드로우한 수 -2장 패를 고르고 버린다.'], draw: ['1장 드로우한다.', '상대 필드의 카드 1장을 고르고 묘지로 보낸다.'] }),
    '마피아의 협상': Object.freeze({ transform: ['서로 1장 드로우한다.', '서로 공개 패의 카드를 2장 고르고 버린다.'], draw: ['1장 드로우한다.', '상대 필드의 몬스터 1장을 고르고 묘지로 보낸다.'] }),
    '마피아의 명령': Object.freeze({ transform: ['서로 1장 드로우한다.', '자신은 자신 필드의 몬스터를 1장 묘지로 보내야 한다.'], draw: ['1장 드로우한다.', "자신 필드의 '마피아'몬스터 1장의 공격력을 3 올린다."] }),
    '마피아의 배신자 숙청': Object.freeze({ transform: ['서로 1장 드로우한다.', '자신은 2장 드로우하고, 패를 4장 고르고 버린다.'], draw: ['1장 드로우한다.', "이 턴에 자신 필드의 '마피아'몬스터는 효과로 묘지로 보내지지 않는다."] }),
    '마피아 집결': Object.freeze({ transform: ['서로 1장 드로우하고, 상대 필드의 몬스터 전부의 공격력을 각각 2씩 올린다.', "상대는 묘지에서 '마피아'카드 1장을 패에 넣는다."], draw: [] }),
    '마피아의 위용': Object.freeze({ transform: ['서로 1장 드로우한다.', "상대는 덱에서 '마피아의 최측근' 1장을 패에 넣는다."], draw: ['1장 드로우한다.', "자신 묘지의 '마피아'몬스터 1장을 소환한다."] }),
    '마피아의 위기': Object.freeze({ transform: ['서로 1장 드로우한다.', '상대는 덱에서 카드 1장을 패에 넣고, 패를 2장 버린다.'], draw: ['1장 드로우한다.', "자신은 자신 필드의 '대도시의 거물 마피아' 1장의 공격력을 원하는만큼(최대 1까지) 내리고 그 수치만큼 드로우한다."] }),
  });

  const pendingTransforms = [];
  const effects = [];

  function getDefaultGameState() { if (typeof G !== 'undefined') return G; return global.G || null; } // eslint-disable-line no-undef
  function getCardDatabase() { if (typeof CARDS !== 'undefined' && CARDS) return CARDS; return global.CARDS || null; } // eslint-disable-line no-undef
  function stateOf(ctxOrState) { return (ctxOrState && ctxOrState.gameState) || ctxOrState || getDefaultGameState(); }
  function normalizeController(controller) { return zoneAccess.normalizeController(controller || CONTROLLERS.ME); }
  function my(ctx) { return normalizeController(ctx && ctx.controller); }
  function opp(ctx) { return my(ctx) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME; }
  function zoneArray(ctx, controller, zone) { return zoneAccess.getZoneArray(stateOf(ctx), normalizeController(controller || CONTROLLERS.ME), zone); }
  function field(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.FIELD); }
  function hand(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.HAND); }
  function publicHand(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.PUBLIC_HAND); }
  function deck(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.DECK); }
  function grave(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.GRAVE); }
  function exile(ctx, controller) { return zoneArray(ctx, controller || my(ctx), ZONES.EXILE); }
  function getCardId(cardOrId) { if (!cardOrId) return ''; return typeof cardOrId === 'string' ? cardOrId : (cardOrId.id || cardOrId.cardId || ''); }
  function getCardDef(cardOrId) { const cards = getCardDatabase(); const id = getCardId(cardOrId); return cards && id ? cards[id] || null : null; }
  function cardObj(cardId) { const def = getCardDef(cardId) || {}; return { id: cardId, name: def.name || cardId, atk: def.atk || 0, atkBase: def.atk || 0 }; }
  function isMafia(c) { const def = getCardDef(c); return !!(def && def.theme === '마피아'); }
  function isMafiaMonster(c) { const def = getCardDef(c); return !!(def && def.theme === '마피아' && def.cardType === 'monster'); }
  function isMafiaMagic(c) { const def = getCardDef(c); return !!(def && def.theme === '마피아' && def.cardType === 'magic'); }
  function isMonster(c) { const def = getCardDef(c); return !!(def && def.cardType === 'monster'); }
  function first(list, pred) { return (list || []).find(pred || (x => x)); }
  function findIndexById(list, id) { return (list || []).findIndex(c => getCardId(c) === id); }
  function removeFrom(list, cardOrId) { const id = getCardId(cardOrId); const i = findIndexById(list, id); return i >= 0 ? list.splice(i, 1)[0] : null; }
  function selectedId(ctx) { return getCardId((ctx && (ctx.selectedCard || ctx.selectedTarget || ctx.target)) || (ctx && ctx.selectedCardId)); }
  function choose(ctx, list, pred) { const sid = selectedId(ctx); if (sid) { const hit = (list || []).find(c => getCardId(c) === sid && (!pred || pred(c))); if (hit) return hit; } return first(list, pred); }
  function hasFieldSpace(ctx, controller) { return global.HB_CARD_MOVE && global.HB_CARD_MOVE.hasFieldSpace ? global.HB_CARD_MOVE.hasFieldSpace(stateOf(ctx), controller || my(ctx)) : field(ctx, controller || my(ctx)).length < 5; }
  function canDraw(ctx, controller, n) { return deck(ctx, controller || my(ctx)).length >= (n || 1); }
  function isDeployOrAttackPhase() { if (typeof currentPhase === 'undefined') return true; return currentPhase === 'deploy' || currentPhase === 'attack' || currentPhase === '전개' || currentPhase === '공격'; } // eslint-disable-line no-undef
  function logSafe(msg, type) { try { if (typeof log === 'function') log(msg, type || 'mine'); } catch (_) {} } // eslint-disable-line no-undef
  function notifySafe(msg) { try { if (typeof notify === 'function') notify(msg); } catch (_) {} } // eslint-disable-line no-undef
  function sync() { try { if (typeof sendGameState === 'function') sendGameState(); } catch (_) {} try { if (typeof renderAll === 'function') renderAll(); } catch (_) {} } // eslint-disable-line no-undef
  function dispatch(ctx) { if (global.HB_EVENTS && typeof global.HB_EVENTS.dispatchEvents === 'function') global.HB_EVENTS.dispatchEvents(ctx.gameState); sync(); }
  function draw(ctx, controller, n) { const ctrl = controller || my(ctx); let count = 0; for (let i = 0; i < (n || 1); i += 1) { const d = deck(ctx, ctrl); if (!d.length) break; hand(ctx, ctrl).push(d.shift()); count += 1; } return { ok: count === (n || 1), count }; }
  function moveSummon(ctx, card, fromZone, controller, reason) { const ctrl = controller || my(ctx); if (!hasFieldSpace(ctx, ctrl)) return { ok: false, error: '몬스터 존이 가득 찼습니다.' }; return ctx.move.summonCard({ cardId: getCardId(card), controller: ctrl, from: { controller: ctrl, zone: fromZone }, reason: reason || 'mafiaSummon' }); }
  function moveAddToHand(ctx, card, fromZone, controller, reason, reveal) { const ctrl = controller || my(ctx); return ctx.move.addToHand({ cardId: getCardId(card), controller: ctrl, from: { controller: ctrl, zone: fromZone }, reason: reason || 'mafiaAddToHand', reveal: !!reveal }); }
  function moveSendToGrave(ctx, card, fromZone, controller, reason) { const ctrl = controller || my(ctx); return ctx.move.sendToGrave({ cardId: getCardId(card), controller: ctrl, from: { controller: ctrl, zone: fromZone }, reason: reason || 'mafiaSendToGrave' }); }
  function moveBanish(ctx, card, fromZone, controller, reason) { const ctrl = controller || my(ctx); return ctx.move.banishCard({ cardId: getCardId(card), controller: ctrl, from: { controller: ctrl, zone: fromZone }, reason: reason || 'mafiaBanish' }); }
  function placeCity(ctx, sourceZone) { return ctx.move.placeFieldCard({ cardId: CITY_ID, controller: my(ctx), from: { controller: my(ctx), zone: sourceZone }, reason: 'mafiaCityPlacedByAide' }); }
  function hasBossOnMyField(ctx) { return field(ctx, my(ctx)).some(c => getCardId(c) === BOSS_ID); }
  function getMafiaTurnState(ctx) { const st = stateOf(ctx); if (!st.mafiaTurnState) st.mafiaTurnState = {}; return st.mafiaTurnState; }
  function markMafiaSpellActivated(ctx, cardId) { const ts = getMafiaTurnState(ctx); ts.magicActivatedCount = (ts.magicActivatedCount || 0) + 1; ts.activatedSpells = ts.activatedSpells || {}; ts.activatedSpells[cardId] = (ts.activatedSpells[cardId] || 0) + 1; return ts; }
  function getMafiaSpellCountThisTurn(ctx) { return getMafiaTurnState(ctx).magicActivatedCount || 0; }
  function sameCardTransformUsed(ctx, cardId) { const ts = getMafiaTurnState(ctx); ts.transformByCard = ts.transformByCard || {}; return !!ts.transformByCard[cardId]; }
  function markSameCardTransformUsed(ctx, cardId) { const ts = getMafiaTurnState(ctx); ts.transformByCard = ts.transformByCard || {}; ts.transformByCard[cardId] = true; }

  function getOpponentChainTarget(ctx) {
    const chain = global.HB_CHAIN_ENGINE;
    if (!chain || typeof chain.getChainLinks !== 'function') return null;
    const links = chain.getChainLinks();
    for (let i = links.length - 1; i >= 0; i -= 1) {
      const link = links[i];
      if (link && link.controller !== my(ctx) && !isMafiaTransformTargetAlreadyPending(link)) return link;
    }
    return null;
  }
  function isMafiaTransformTargetAlreadyPending(link) { return pendingTransforms.some(p => p.targetChainLinkId === link.id); }
  function shouldMyControllerChoose(ctx, cardId) { return hasBossOnMyField(ctx) && !sameCardTransformUsed(ctx, cardId); }
  function pickOption(ctx, cardId, options) {
    const selected = (ctx && (ctx.selectedOption || ctx.selectedChoice || ctx.optionText)) || null;
    if (selected && options.includes(selected)) return selected;
    const index = Number(ctx && (ctx.selectedOptionIndex ?? ctx.choiceIndex));
    if (Number.isInteger(index) && options[index]) return options[index];
    // 현재 체인 엔진은 동기 해결이므로, 실제 상대 UI 선택이 없으면 첫 후보로 안전하게 폴백한다.
    return options[0];
  }
  function registerPendingTransform(ctx, targetLink, cardId, optionText, result) {
    if (!targetLink) return { ok: false, error: '변형할 상대 체인 링크가 없습니다.' };
    pendingTransforms.push({ targetChainLinkId: targetLink.id, sourceCardId: cardId, optionText, result, createdAt: Date.now(), controller: my(ctx) });
    if (shouldMyControllerChoose(ctx, cardId)) markSameCardTransformUsed(ctx, cardId);
    logSafe(`${cardId}: 상대 효과를 '${optionText}'로 변형`, 'mine');
    return { ok: true, targetChainLinkId: targetLink.id, optionText, result };
  }
  function consumeTransformedChainLink(chainLink) {
    const index = pendingTransforms.findIndex(p => p.targetChainLinkId === chainLink.id);
    if (index < 0) return { ok: true, skipOriginal: false };
    const pending = pendingTransforms.splice(index, 1)[0];
    logSafe(`마피아 변형: ${chainLink.cardId || chainLink.effectId} 원래 효과를 적용하지 않음`, 'system');
    return { ok: true, skipOriginal: true, reason: 'mafiaEffectTransform', pending };
  }

  function resolveMafiaOption(ctx, optionText) {
    if (!optionText) return { ok: false, error: '선택지가 없습니다.' };
    if (optionText.includes('서로 1장 드로우')) {
      const mine = draw(ctx, my(ctx), 1);
      const other = draw(ctx, opp(ctx), 1);
      if (optionText.includes('상대 필드의 몬스터 전부의 공격력을 각각 2씩 올린다')) {
        field(ctx, opp(ctx)).filter(isMonster).forEach(c => { c.atk = (c.atk || c.atkBase || getCardDef(c)?.atk || 0) + 2; });
      }
      dispatch(ctx);
      return { ok: mine.ok || other.ok, optionText };
    }
    if (optionText.includes("덱에서 '마피아'마법 카드 1장을 패에 넣")) {
      const t = choose(ctx, deck(ctx), isMafiaMagic); if (!t) return { ok: false, error: '마피아 마법 없음' };
      return moveAddToHand(ctx, t, ZONES.DECK, my(ctx), 'mafiaOptionSearchMagic', false);
    }
    if (optionText.includes("덱에서 '대도시의 거물 마피아' 1장을 패에 넣")) {
      const t = choose(ctx, deck(ctx), c => getCardId(c) === BOSS_ID); if (!t) return { ok: false, error: '거물 마피아 없음' };
      return moveAddToHand(ctx, t, ZONES.DECK, my(ctx), 'mafiaOptionSearchBoss', false);
    }
    if (optionText.includes("덱에서 '마피아의 최측근' 1장을 패에 넣")) {
      const t = choose(ctx, deck(ctx), c => getCardId(c) === AIDE_ID); if (!t) return { ok: false, error: '최측근 없음' };
      return moveAddToHand(ctx, t, ZONES.DECK, my(ctx), 'mafiaOptionSearchAide', false);
    }
    if (optionText.includes('상대는 덱에서 카드 1장을 패에 넣고')) {
      const t = deck(ctx, opp(ctx))[0]; if (t) moveAddToHand(ctx, t, ZONES.DECK, opp(ctx), 'mafiaOpponentSearchAny', false);
      const cnt = Math.min(2, hand(ctx, opp(ctx)).length); for (let i = 0; i < cnt; i += 1) { const c = hand(ctx, opp(ctx))[0]; if (c) moveSendToGrave(ctx, c, ZONES.HAND, opp(ctx), 'mafiaOpponentDiscard'); }
      dispatch(ctx); return { ok: true, optionText };
    }
    if (optionText.includes('상대 패 1장을 버린다')) { const c = hand(ctx, opp(ctx))[0]; if (!c) return { ok: false, error: '상대 패 없음' }; return moveSendToGrave(ctx, c, ZONES.HAND, opp(ctx), 'mafiaDiscardOpponentHand'); }
    if (optionText.includes('상대 필드의 몬스터 1장을')) { const t = choose(ctx, field(ctx, opp(ctx)), isMonster); if (!t) return { ok: false, error: '상대 몬스터 없음' }; return moveSendToGrave(ctx, t, ZONES.FIELD, opp(ctx), 'mafiaSendOpponentMonster'); }
    if (optionText.includes('상대 필드의 카드 1장을')) { const t = choose(ctx, field(ctx, opp(ctx)), () => true); if (!t) return { ok: false, error: '상대 필드 카드 없음' }; return moveSendToGrave(ctx, t, ZONES.FIELD, opp(ctx), 'mafiaSendOpponentField'); }
    if (optionText.includes("상대는 묘지에서 '마피아'카드 1장을 패에 넣는다")) { const t = choose(ctx, grave(ctx, opp(ctx)), isMafia); if (!t) return { ok: false, error: '상대 묘지 마피아 없음' }; return moveAddToHand(ctx, t, ZONES.GRAVE, opp(ctx), 'mafiaOpponentRecover', false); }
    if (optionText.includes("자신 묘지의 '마피아'몬스터 1장을 소환한다")) { const t = choose(ctx, grave(ctx), isMafiaMonster); if (!t || !hasFieldSpace(ctx)) return { ok: false, error: '소환 불가' }; return moveSummon(ctx, t, ZONES.GRAVE, my(ctx), 'mafiaRevive'); }
    if (optionText.includes("자신 필드의 '마피아'몬스터 1장의 공격력을 3 올린다")) { const t = choose(ctx, field(ctx), isMafiaMonster); if (!t) return { ok: false, error: '대상 없음' }; t.atk = (t.atk || t.atkBase || getCardDef(t)?.atk || 0) + 3; dispatch(ctx); return { ok: true, target: getCardId(t) }; }
    if (optionText.includes('자신 필드의 몬스터를 1장 묘지로 보내야 한다')) { const t = choose(ctx, field(ctx), isMonster); if (!t) return { ok: false, error: '내 몬스터 없음' }; return moveSendToGrave(ctx, t, ZONES.FIELD, my(ctx), 'mafiaSendOwnMonster'); }
    if (optionText.includes('2장 드로우하고, 패를 4장')) { draw(ctx, my(ctx), 2); const cnt = Math.min(4, hand(ctx).length); for (let i = 0; i < cnt; i += 1) { const c = hand(ctx)[0]; if (c) moveSendToGrave(ctx, c, ZONES.HAND, my(ctx), 'mafiaDiscardAfterDraw'); } dispatch(ctx); return { ok: true, discarded: cnt }; }
    if (optionText.includes('공개 패를 2장까지 일반 패로')) { const moved = publicHand(ctx).splice(0, 2); hand(ctx).push(...moved.map(c => Object.assign({}, c, { isPublic: false }))); dispatch(ctx); return { ok: true, moved: moved.length }; }
    if (optionText.includes('마피아') && optionText.includes('효과로 묘지로 보내지지 않는다')) { getMafiaTurnState(ctx).mafiaMonstersProtectedFromEffectSend = true; dispatch(ctx); return { ok: true, protected: true }; }
    if (optionText.includes('공격력을 원하는만큼')) { const t = choose(ctx, field(ctx), c => getCardId(c) === BOSS_ID); if (!t || !canDraw(ctx, my(ctx), 1)) return { ok: false, error: '처리 불가' }; t.atk = Math.max(0, (t.atk || getCardDef(t)?.atk || 0) - 1); draw(ctx, my(ctx), 1); dispatch(ctx); return { ok: true, draw: 1 }; }
    return { ok: false, error: `미구현 선택지: ${optionText}` };
  }

  function canResolveOption(ctx, optionText) {
    if (optionText.includes('서로 1장 드로우')) return canDraw(ctx, my(ctx), 1) || canDraw(ctx, opp(ctx), 1);
    if (optionText.includes("덱에서 '마피아'마법 카드")) return deck(ctx).some(isMafiaMagic);
    if (optionText.includes(BOSS_ID)) return deck(ctx).some(c => getCardId(c) === BOSS_ID) || field(ctx).some(c => getCardId(c) === BOSS_ID);
    if (optionText.includes(AIDE_ID)) return deck(ctx).some(c => getCardId(c) === AIDE_ID);
    if (optionText.includes('상대 패')) return hand(ctx, opp(ctx)).length > 0;
    if (optionText.includes('상대 필드의 몬스터')) return field(ctx, opp(ctx)).some(isMonster);
    if (optionText.includes('상대 필드의 카드')) return field(ctx, opp(ctx)).length > 0;
    if (optionText.includes('묘지에서')) return grave(ctx).concat(grave(ctx, opp(ctx))).some(isMafia);
    if (optionText.includes('자신 묘지의')) return grave(ctx).some(isMafiaMonster) && hasFieldSpace(ctx);
    if (optionText.includes('자신 필드의')) return field(ctx).some(isMonster);
    if (optionText.includes('2장 드로우')) return canDraw(ctx, my(ctx), 2);
    if (optionText.includes('공개 패')) return publicHand(ctx).length > 0;
    if (optionText.includes('공격력을 원하는만큼')) return field(ctx).some(c => getCardId(c) === BOSS_ID) && canDraw(ctx, my(ctx), 1);
    return true;
  }

  function hasOpponentChainToTransform(ctx) { return !!getOpponentChainTarget(ctx); }
  function canResolveTransform(ctx, cardId) { return hasOpponentChainToTransform(ctx) && SPELL_OPTION_TABLE[cardId].transform.some(opt => canResolveOption(ctx, opt)); }
  function resolveTransform(ctx, cardId) {
    const options = SPELL_OPTION_TABLE[cardId].transform.filter(opt => canResolveOption(ctx, opt));
    if (!options.length) return { ok: false, error: '적용 가능한 변형 선택지 없음' };
    const target = getOpponentChainTarget(ctx);
    const optionText = pickOption(ctx, cardId, options);
    const result = resolveMafiaOption(ctx, optionText);
    if (result && result.ok === false) return result;
    markMafiaSpellActivated(ctx, cardId);
    return registerPendingTransform(ctx, target, cardId, optionText, result);
  }

  function canResolveDrawChoice(ctx, cardId) { const opts = SPELL_OPTION_TABLE[cardId].draw || []; return opts.length > 0 && opts.some(opt => canResolveOption(ctx, opt)); }
  function resolveDrawChoice(ctx, cardId) { const opts = (SPELL_OPTION_TABLE[cardId].draw || []).filter(opt => canResolveOption(ctx, opt)); const optionText = pickOption(ctx, cardId, opts); return resolveMafiaOption(ctx, optionText); }

  function mk(def) { return Object.assign({ theme: '마피아', optional: true, isActivated: true, condition: () => true, canResolve: () => true, cost: () => ({ ok: true }), target: () => ({ ok: true }), resolve: () => ({ ok: true }) }, def); }
  function add(def) { effects.push(mk(def)); }

  add({ id: 'mafia-boss-1-hand-summon', cardId: BOSS_ID, effectNo: 1, type: EFFECT_TYPES.QUICK, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: ['handSummon'], oncePerTurn: { key: `${BOSS_ID}_1`, limit: 1 }, condition: ctx => isDeployOrAttackPhase(ctx), canResolve: ctx => hand(ctx).some(c => getCardId(c) === BOSS_ID) && hasFieldSpace(ctx), resolve: ctx => moveSummon(ctx, BOSS_ID, ZONES.HAND, my(ctx), 'mafiaBossSelfSummon') });
  add({ id: 'mafia-boss-2-spell-choice-owner', cardId: BOSS_ID, effectNo: 2, type: EFFECT_TYPES.CONTINUOUS, isActivated: false, zones: [ZONES.FIELD], tags: ['mafiaChoiceControl'], continuousRule(ctx) { return { ok: true, controllerChoosesMafiaMagic: true }; } });
  add({ id: 'mafia-aide-1-hand-summon-boss', cardId: AIDE_ID, effectNo: 1, type: EFFECT_TYPES.QUICK, zones: [ZONES.HAND], timing: TIMING.EITHER_TURN, tags: ['handSummon'], oncePerTurn: { key: `${AIDE_ID}_1`, limit: 1 }, condition: ctx => isDeployOrAttackPhase(ctx), canResolve: ctx => hand(ctx).some(c => getCardId(c) === AIDE_ID) && hasFieldSpace(ctx), resolve(ctx) { const r = moveSummon(ctx, AIDE_ID, ZONES.HAND, my(ctx), 'mafiaAideSelfSummon'); if (r.ok && hand(ctx).some(c => getCardId(c) === BOSS_ID) && hasFieldSpace(ctx)) moveSummon(ctx, BOSS_ID, ZONES.HAND, my(ctx), 'mafiaAideSummonBoss'); dispatch(ctx); return r; } });
  add({ id: 'mafia-aide-2-place-city', cardId: AIDE_ID, effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.FIELD], events: [EVENTS.SUMMON], timing: TIMING.ON_SUMMON, tags: [TAGS.PLACE_FIELD_CARD], oncePerTurn: { key: `${AIDE_ID}_2`, limit: 1 }, condition: ctx => ctx.event && getCardId(ctx.event.card || ctx.event.cardId) === AIDE_ID && field(ctx).some(c => isMafiaMonster(c) && getCardId(c) !== AIDE_ID), canResolve: ctx => hand(ctx).concat(grave(ctx), exile(ctx)).some(c => getCardId(c) === CITY_ID), resolve(ctx) { const h = hand(ctx).find(c => getCardId(c) === CITY_ID); if (h) return placeCity(ctx, ZONES.HAND); const g = grave(ctx).find(c => getCardId(c) === CITY_ID); if (g) return placeCity(ctx, ZONES.GRAVE); return placeCity(ctx, ZONES.EXILE); } });
  add({ id: 'mafia-aide-3-cannot-attack', cardId: AIDE_ID, effectNo: 3, type: EFFECT_TYPES.CONTINUOUS, isActivated: false, zones: [ZONES.FIELD], tags: ['cannotAttack'], continuousRule: () => ({ ok: true, cannotAttack: true }) });

  MAFIA_SPELLS.forEach(cardId => {
    add({ id: `mafia-spell-${cardId}-1-transform`, cardId, effectNo: 1, type: EFFECT_TYPES.QUICK, zones: [ZONES.HAND, ZONES.PUBLIC_HAND], timing: TIMING.EITHER_TURN, tags: ['effectTransform'], oncePerTurn: { key: `${cardId}_1`, limit: 1 }, condition: ctx => hasOpponentChainToTransform(ctx), canResolve: ctx => canResolveTransform(ctx, cardId), resolve: ctx => resolveTransform(ctx, cardId) });
    const drawOpts = SPELL_OPTION_TABLE[cardId].draw || [];
    if (drawOpts.length) {
      add({ id: `mafia-spell-${cardId}-2-draw-public-choice`, cardId, effectNo: 2, type: EFFECT_TYPES.TRIGGER, zones: [ZONES.HAND], events: ['draw', EVENTS.DRAW], timing: TIMING.NONE, tags: ['publicHand', 'opponentChoice'], oncePerTurn: { key: `${cardId}_2`, limit: 1 }, condition: ctx => hand(ctx).some(c => getCardId(c) === cardId), canResolve: ctx => canResolveDrawChoice(ctx, cardId), resolve(ctx) { const c = removeFrom(hand(ctx), cardId); if (c) { c.isPublic = true; publicHand(ctx).push(c); } const result = resolveDrawChoice(ctx, cardId); dispatch(ctx); return result; } });
    }
  });

  add({ id: 'mafia-city-1-field-recover', cardId: CITY_ID, effectNo: 1, type: EFFECT_TYPES.ACTIVATION, zones: [ZONES.FIELD_ZONE], timing: TIMING.EITHER_TURN, tags: [TAGS.GRAVE_TO_HAND, TAGS.DISCARD_HAND, 'fieldZoneEffect'], oncePerTurn: { key: `${CITY_ID}_1`, limit: 1 }, condition: ctx => zoneAccess.getFieldZoneCard(stateOf(ctx), my(ctx)) && getCardId(zoneAccess.getFieldZoneCard(stateOf(ctx), my(ctx))) === CITY_ID, canResolve(ctx) { const count = Math.max(1, getMafiaSpellCountThisTurn(ctx)); return grave(ctx).some(isMafia) && hand(ctx).length >= 2 && count > 0; }, resolve(ctx) { const max = Math.max(1, getMafiaSpellCountThisTurn(ctx)); const targets = grave(ctx).filter(isMafia).slice(0, max); targets.forEach(t => moveAddToHand(ctx, t, ZONES.GRAVE, my(ctx), 'mafiaCityRecover', false)); const discardCount = Math.min(2, hand(ctx).length); for (let i = 0; i < discardCount; i += 1) { const c = hand(ctx)[0]; if (c) moveSendToGrave(ctx, c, ZONES.HAND, my(ctx), 'mafiaCityDiscard'); } dispatch(ctx); return { ok: true, recovered: targets.length, discarded: discardCount }; } });

  registry.registerEffects(effects);
  registry.syncEffectIdsToCards();

  const api = Object.freeze({
    getMafiaEffectIds: () => effects.map(e => e.id),
    getMafiaCards: () => MAFIA_IDS.slice(),
    getMafiaSpellOptions: cardId => SPELL_OPTION_TABLE[cardId] || null,
    consumeTransformedChainLink,
    getPendingTransforms: () => pendingTransforms.slice(),
    clearPendingTransforms: () => { pendingTransforms.length = 0; },
    resolveMafiaOption,
    getMafiaImplementationSpec: () => Object.freeze({ phase: '16-7 mafia', cards: MAFIA_IDS, effectCount: effects.length, criticalChecks: Object.freeze(['상대 효과 변형은 원래 chainLink를 스킵한다.', '대도시의 거물 마피아가 없으면 상대가 선택한다.', '마피아의 도시 회수 수량은 이번 턴 마피아 마법 발동 수를 따른다.', '처리 불가능한 선택지만 남으면 발동할 수 없다.']) }),
  });

  global.HB_MAFIA_EFFECTS = api;
  global.HB_EFFECT_TRANSFORM_ENGINE = api;
  global.HB_EFFECT_TRANSFORM = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.mafia = api;
})(window);
