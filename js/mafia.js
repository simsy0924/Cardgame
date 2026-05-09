// mafia.js — 마피아 테마 효과 라우팅 / 명령형 효과 변형 / 등록형 보조
window._mafiaChainReplaceCount = 0;
window._mafiaMagicActivatedThisTurn = window._mafiaMagicActivatedThisTurn || 0;
window._mafiaNoGraveByEffectTurn = false;
window._mafiaMagicOnlyTurn = false;
window._mafiaOwnChoiceUsed = window._mafiaOwnChoiceUsed || {};

const MAFIA_MAGIC_CARD_IDS = [
  '마피아의 제안', '마피아의 군림', '마피아의 대가', '마피아의 협상', '마피아의 명령',
  '마피아의 배신자 숙청', '마피아 집결', '마피아의 위용', '마피아의 위기'
];

function isMafiaCardId(cardId) { return CARDS[cardId]?.theme === '마피아'; }
function isMafiaMagicId(cardId) { return CARDS[cardId]?.theme === '마피아' && CARDS[cardId]?.cardType === 'magic'; }
function hasMafiaBossOnField() { return (G.myField || []).some(c => c && c.id === '대도시의 거물 마피아'); }
function mafiaCanChooseOwnOption(cardId) {
  if (!hasMafiaBossOnField()) return false;
  const key = `${cardId || 'unknown'}_${window.turnId || window.turnCount || 'turn'}`;
  if (window._mafiaOwnChoiceUsed[key]) return false;
  window._mafiaOwnChoiceUsed[key] = true;
  return true;
}
function resetMafiaTurnFlags() {
  window._mafiaMagicActivatedThisTurn = 0;
  window._mafiaNoGraveByEffectTurn = false;
  window._mafiaMagicOnlyTurn = false;
  window._mafiaOwnChoiceUsed = {};
}
window.resetMafiaTurnFlags = resetMafiaTurnFlags;

function _isMafiaTransformLink(link) {
  if (!link) return false;
  const card = CARDS[link?.cardId] || {};
  const theme = link?.theme || card.theme;
  if (theme !== '마피아') return false;
  if (card.cardType !== 'magic') return false;
  if (link.type !== 'themeEffect' && link.type !== 'registeredEffect') return false;
  return String(link.mainText || link.text || '').includes('그 효과를');
}

function _mafiaSendOpCardToGrave(target, onlyMonster = false) {
  if (!target) return false;
  if (onlyMonster && CARDS[target.id]?.cardType !== 'monster') return false;
  const oi = G.opField.findIndex(c => c.id === target.id);
  if (oi >= 0) {
    const rm = G.opField.splice(oi, 1)[0];
    if (rm) { G.opGrave.push(rm); sendAction({ type: 'opFieldRemove', cardId: rm.id, to: 'grave' }); }
    return true;
  }
  if (!onlyMonster && G.opFieldCard && G.opFieldCard.id === target.id) {
    if (typeof sendOpponentFieldCardToGrave === 'function') sendOpponentFieldCardToGrave('마피아 효과');
    else {
      G.opGrave.push(G.opFieldCard);
      sendAction({ type: 'opFieldCardRemove', cardId: target.id, to: 'grave' });
      G.opFieldCard = null;
    }
    return true;
  }
  return false;
}

function _mafiaForceOpponentDiscard(n = 1) {
  const k = Math.min(n, G.opHand.length);
  for (let i = 0; i < k; i++) G.opHand.shift();
  if (k > 0) sendAction({ type: 'opDiscardRandom', count: k });
  return k;
}

function _mafiaRecoverMyFromGrave(pred, max = 1, makePublic = false) {
  const targets = (G.myGrave || []).filter(c => pred(c));
  const count = Math.min(max, targets.length);
  if (count <= 0) return false;
  openCardPicker(targets, `마피아: 묘지에서 ${count}장까지 패에 넣기`, count, (sel) => {
    const picked = sel.map(i => targets[i]).filter(Boolean).slice(0, count);
    picked.forEach(pc => {
      const gi = G.myGrave.findIndex(x => x === pc || x.id === pc.id);
      if (gi >= 0) {
        const z = G.myGrave.splice(gi, 1)[0];
        G.myHand.push({ id: z.id, name: z.name || CARDS[z.id]?.name || z.id, isPublic: !!makePublic });
      }
    });
    sendGameState(); renderAll();
  }, true);
  return true;
}

function _mafiaSetCardPublic(cardId, handIdx) {
  let idx = Number.isInteger(handIdx) ? handIdx : -1;
  if (idx < 0 || !G.myHand[idx] || G.myHand[idx].id !== cardId) {
    idx = G.myHand.findIndex(c => c && c.id === cardId && !c.isPublic);
  }
  if (idx >= 0) {
    G.myHand[idx].isPublic = true;
    if (window.GameEvents && typeof window.GameEvents.emit === 'function') {
      window.GameEvents.emit('addedToPublicHand', { cardId, card: G.myHand[idx], player: 'mine', source: 'mafiaDrawTrigger' });
    }
    return true;
  }
  return false;
}

function _resolveMafiaTransformChoice(picked) {
  const myMafiaMons = () => G.myField.filter(c => CARDS[c.id]?.theme === '마피아');
  const opFieldAll = () => [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
  const forceSendOpFieldToGrave = _mafiaSendOpCardToGrave;
  const forceOpponentDiscard = _mafiaForceOpponentDiscard;
  const recoverMyMafiaFromGrave = () => _mafiaRecoverMyFromGrave(c => CARDS[c.id]?.theme === '마피아', 1, false);

  if (picked.includes('서로 1장 드로우')) {
    drawN(1);
    if (typeof _aiDrawN === 'function') _aiDrawN(1);
    if (picked.includes('상대 필드의 몬스터 전부의 공격력을 각각 2씩 올린다')) {
      G.opField.forEach(c => { c.atk = (c.atkBase || CARDS[c.id]?.atk || 0) + 2; });
      sendAction({ type: 'opFieldBuff', amount: 2 });
    }
    return true;
  }
  if (picked.includes("덱에서 '마피아'마법 카드 1장을 패에 넣")) {
    const targets = findAllInDeck(d => CARDS[d.id]?.theme === '마피아' && CARDS[d.id]?.cardType === 'magic');
    if (targets.length > 0) searchToHand(targets[0].id);
    return true;
  }
  if (picked.includes("덱에서 '대도시의 거물 마피아' 1장을 패에 넣")) {
    if (findAllInDeck(d => d.id === '대도시의 거물 마피아').length > 0) searchToHand('대도시의 거물 마피아');
    return true;
  }
  if (picked.includes("덱에서 '마피아의 최측근' 1장을 패에 넣")) {
    if (findAllInDeck(d => d.id === '마피아의 최측근').length > 0) searchToHand('마피아의 최측근');
    return true;
  }
  if (picked.includes('상대는 덱에서 카드 1장을 패에 넣고, 패를 2장 버린다')) {
    if (typeof _aiDrawN === 'function') _aiDrawN(1);
    forceOpponentDiscard(2);
    return true;
  }
  if (picked.includes('상대 패 1장을 버린다')) {
    forceOpponentDiscard(1);
    return true;
  }
  if (picked.includes('상대 필드의 몬스터 1장을 고르고 묘지로 보낸다')) {
    const mons = G.opField.slice();
    if (mons.length > 0) {
      openCardPicker(mons, '마피아 변형 효과: 묘지로 보낼 상대 몬스터 선택', 1, (sel) => {
        if (!sel.length) return;
        forceSendOpFieldToGrave(mons[sel[0]], true);
        sendGameState(); renderAll();
      }, true);
    }
    return true;
  }
  if (picked.includes('상대 필드의 카드 1장을 고르고 묘지로 보낸다')) {
    const all = opFieldAll();
    if (all.length > 0) {
      openCardPicker(all, '마피아 변형 효과: 묘지로 보낼 상대 필드 카드 선택', 1, (sel) => {
        if (!sel.length) return;
        forceSendOpFieldToGrave(all[sel[0]], false);
        sendGameState(); renderAll();
      }, true);
    }
    return true;
  }
  if (picked.includes("상대는 묘지에서 '마피아'카드 1장을 패에 넣는다")) {
    recoverMyMafiaFromGrave();
    return true;
  }
  if (picked.includes("자신 묘지의 '마피아'몬스터 1장을 소환한다")) {
    const mm = G.myGrave.find(c => CARDS[c.id]?.theme === '마피아' && CARDS[c.id]?.cardType === 'monster');
    if (mm) summonFromGrave(mm.id);
    return true;
  }
  if (picked.includes("자신 필드의 '마피아'몬스터 1장의 공격력을 3 올린다")) {
    const targets = myMafiaMons();
    if (targets.length > 0) {
      openCardPicker(targets, '마피아 변형 효과: 공격력 +3 할 몬스터 선택', 1, (sel) => {
        if (!sel.length) return;
        const t = targets[sel[0]];
        t.atk = (t.atk || t.atkBase || CARDS[t.id]?.atk || 0) + 3;
        sendGameState(); renderAll();
      }, true);
    }
    return true;
  }
  if (picked.includes('자신 필드의 몬스터를 1장 묘지로 보내야 한다')) {
    if (G.myField.length > 0) {
      openCardPicker([...G.myField], '마피아 변형 효과: 묘지로 보낼 내 몬스터 선택', 1, (sel) => {
        if (!sel.length) return;
        sendToGrave(G.myField[sel[0]].id, 'field');
      }, true);
    }
    return true;
  }
  if (picked.includes('2장 드로우하고, 패를 4장 고르고 버린다')) {
    drawN(2);
    const cnt = Math.min(4, G.myHand.length);
    openCardPicker([...G.myHand], `마피아 변형 효과: 버릴 패 ${cnt}장 선택`, cnt, (sel) => {
      sel.sort((a, b) => b - a).forEach(i => {
        if (G.myHand[i]) {
          const z = G.myHand.splice(i, 1)[0];
          G.myGrave.push(z);
          if (window.GameEvents) window.GameEvents.emit('discard', { cardId: z.id, card: z, player: 'mine', source: 'mafiaTransform' });
        }
      });
      sendGameState(); renderAll();
    }, true);
    return true;
  }
  return false;
}

function _resolveMafiaPublicChoice(cardId, picked) {
  if (picked.includes('1장 드로우')) { drawN(1); return true; }
  if (picked.includes('상대 패 1장을 버린다')) return !!_mafiaForceOpponentDiscard(1);
  if (picked.includes('자신의 공개 패를 2장까지 일반 패로 한다')) {
    const pubs = G.myHand.filter(c => c.isPublic);
    if (!pubs.length) return true;
    openCardPicker(pubs, '마피아: 일반 패로 되돌릴 공개 패 선택', Math.min(2, pubs.length), (sel) => {
      sel.map(i => pubs[i]).filter(Boolean).forEach(pc => {
        const h = G.myHand.find(x => x === pc || x.id === pc.id);
        if (h) h.isPublic = false;
      });
      sendGameState(); renderAll();
    }, true);
    return true;
  }
  if (picked.includes('상대 필드의 카드 1장을 고르고 묘지로 보낸다')) {
    const all = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
    if (all.length) openCardPicker(all, '마피아: 묘지로 보낼 상대 필드 카드 선택', 1, sel => { if (sel.length) _mafiaSendOpCardToGrave(all[sel[0]], false); sendGameState(); renderAll(); }, true);
    return true;
  }
  if (picked.includes('상대 필드의 몬스터 1장을 고르고 묘지로 보낸다')) {
    const mons = G.opField.slice();
    if (mons.length) openCardPicker(mons, '마피아: 묘지로 보낼 상대 몬스터 선택', 1, sel => { if (sel.length) _mafiaSendOpCardToGrave(mons[sel[0]], true); sendGameState(); renderAll(); }, true);
    return true;
  }
  if (picked.includes("자신 필드의 '마피아'몬스터 1장의 공격력을 3 올린다")) return _resolveMafiaTransformChoice(picked);
  if (picked.includes("자신 묘지의 '마피아'몬스터 1장을 소환한다")) return _resolveMafiaTransformChoice(picked);
  if (picked.includes("효과로 묘지로 보내지지 않는다")) { window._mafiaNoGraveByEffectTurn = true; log('마피아: 이 턴 마피아 몬스터 효과 묘지 보호', 'mine'); return true; }
  if (picked.includes("'대도시의 거물 마피아'") && picked.includes('공격력을 원하는만큼')) {
    const boss = G.myField.find(c => c.id === '대도시의 거물 마피아' && (c.atk || CARDS[c.id]?.atk || 0) > 0);
    if (boss) { boss.atk = Math.max(0, (boss.atk || CARDS[boss.id]?.atk || 0) - 1); drawN(1); }
    return true;
  }
  return false;
}

window.tryResolveMafiaChainTransform = function(link) {
  if (!_isMafiaTransformLink(link)) return false;
  const card = CARDS[link.cardId] || { name: link.cardId };
  const opts = ((link.mainText || link.text || '').match(/-\s*(.+)/g) || []).map(s => s.replace(/^\-\s*/, '').trim()).filter(Boolean);
  const optionCards = opts.map((txt, i) => ({ id: `_mafia_opt_${i}`, name: txt }));
  if (optionCards.length === 0) optionCards.push({ id: '_mafia_opt_default', name: '서로 1장 드로우한다.' });

  const chooseByMe = mafiaCanChooseOwnOption(link.cardId);
  const title = chooseByMe
    ? `${card.name}: 대도시의 거물 마피아 ②로 적용할 효과 선택`
    : `${card.name}: 변형할 효과 선택`;

  const applyPicked = (picked) => {
    if (!picked) return;
    window._mafiaChainReplaceCount += 1;
    log(`${card.name}: 상대 효과를 변형 → ${picked}`, 'mine');
    _resolveMafiaTransformChoice(picked);
  };

  if (chooseByMe || !window.OpponentChoice) {
    openCardPicker(optionCards, title, 1, (sel) => {
      if (!sel.length) return;
      applyPicked(optionCards[sel[0]].name);
    }, true);
  } else {
    window.OpponentChoice.request({
      purpose: 'mafia.chainTransform',
      title: `${card.name}: 적용할 효과 선택`,
      options: optionCards,
      maxPick: 1,
      forced: true,
      context: { cardId: link.cardId, mode: 'chainTransform' },
    }, (selected) => {
      const picked = selected && selected[0] && (selected[0].name || selected[0].text);
      applyPicked(picked);
    }, () => applyPicked(optionCards[0]?.name));
  }
  return true;
};

window.consumeMafiaChainReplacement = function(link) {
  if (window._mafiaChainReplaceCount <= 0 || link.by === myRole) return false;
  window._mafiaChainReplaceCount -= 1;
  log(`마피아 명령형 변형: ${link.label || link.type} 효과는 원효과 대신 대체 적용`, 'system');
  return true;
};

window.mafiaBuildTransformMainText = function(cardId) {
  const text = String(CARDS[cardId]?.effects || '');
  const start = text.indexOf('①');
  const end = text.indexOf('②', start + 1);
  return (end >= 0 ? text.slice(start, end) : text.slice(start)).trim();
};

window.mafiaResolvePublicDrawEffect = function(cardId, handIdx) {
  const card = CARDS[cardId] || { name: cardId };
  _mafiaSetCardPublic(cardId, handIdx);
  const text = String(card.effects || '');
  const start = text.indexOf('②');
  const chunk = start >= 0 ? text.slice(start) : text;
  const opts = (chunk.match(/-\s*(.+)/g) || []).map(s => s.replace(/^\-\s*/, '').trim()).filter(Boolean);
  const optionCards = opts.map((txt, i) => ({ id: `_mafia_public_${i}`, name: txt }));
  if (!optionCards.length) optionCards.push({ id: '_mafia_public_draw', name: '1장 드로우한다.' });
  const chooseByMe = mafiaCanChooseOwnOption(cardId);
  const applyPicked = (picked) => {
    if (!picked) return;
    log(`${card.name} ②: ${picked}`, 'mine');
    _resolveMafiaPublicChoice(cardId, picked);
  };

  if (chooseByMe || !window.OpponentChoice) {
    openCardPicker(optionCards, `${card.name} ②: 적용할 효과 선택`, 1, (sel) => {
      if (!sel.length) return;
      applyPicked(optionCards[sel[0]].name);
    }, true);
  } else {
    window.OpponentChoice.request({
      purpose: 'mafia.publicDraw',
      title: `${card.name} ②: 적용할 효과 선택`,
      options: optionCards,
      maxPick: 1,
      forced: true,
      context: { cardId, mode: 'publicDraw' },
    }, (selected) => {
      const picked = selected && selected[0] && (selected[0].name || selected[0].text);
      applyPicked(picked);
    }, () => applyPicked(optionCards[0]?.name));
  }
};

window.mafiaActivateMagicFromHand = function(handIdx, effectNum = 1) {
  const c = G.myHand[handIdx];
  if (!c || !isMafiaMagicId(c.id)) return false;
  if (!window.EffectEngine) return activateThemeCardEffectFromHand(handIdx, effectNum);
  const ids = window.EffectEngine.getCardEffectIds(c.id) || [];
  const id = ids.find(x => x.endsWith('_1_chain')) || ids[0];
  if (!id) return false;
  return window.EffectEngine.activateEffect(id, { handIdx, cardId: c.id });
};

function patchMafiaMagicRestriction() {
  if (typeof window.activateCard !== 'function') { setTimeout(patchMafiaMagicRestriction, 50); return; }
  if (window.activateCard.__mafiaRestrictionPatched) return;
  const old = window.activateCard;
  window.activateCard = function mafiaRestrictionActivateCard(handIdx) {
    const c = G.myHand && G.myHand[handIdx];
    const def = c && CARDS[c.id];
    if (window._mafiaMagicOnlyTurn && def && def.cardType === 'magic' && def.theme !== '마피아') {
      notify('이 턴에는 마피아 카드 이외의 마법 카드를 발동할 수 없습니다.');
      return;
    }
    return old.apply(this, arguments);
  };
  window.activateCard.__mafiaRestrictionPatched = true;
}

patchMafiaMagicRestriction();

registerThemeEffectHandler('마피아', {
  activateFromHand: function(handIdx, effectNum) {
    if (effectNum === 1 && window.mafiaActivateMagicFromHand(handIdx, effectNum)) return;
    return activateThemeCardEffectFromHand(handIdx, effectNum);
  },
  resolveLink: resolveThemeEffectGeneric,
});
