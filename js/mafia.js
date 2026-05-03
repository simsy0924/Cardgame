// mafia.js — 마피아 테마 효과 라우팅 / 명령형 효과 변형
window._mafiaChainReplaceCount = 0;

function _isMafiaTransformLink(link) {
  if (link?.type !== 'themeEffect') return false;
  if ((link?.theme || CARDS[link?.cardId]?.theme) !== '마피아') return false;
  const card = CARDS[link.cardId] || {};
  if (card.cardType !== 'magic') return false;
  return (link.mainText || '').includes('그 효과를');
}

function _resolveMafiaTransformChoice(picked) {
  const myMafiaMons = () => G.myField.filter(c => CARDS[c.id]?.theme === '마피아');
  const opFieldAll = () => [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
  const forceSendOpFieldToGrave = (target, onlyMonster = false) => {
    if (!target) return false;
    if (onlyMonster && CARDS[target.id]?.cardType !== 'monster') return false;
    const oi = G.opField.findIndex(c => c.id === target.id);
    if (oi >= 0) {
      const rm = G.opField.splice(oi, 1)[0];
      if (rm) { G.opGrave.push(rm); sendAction({ type: 'opFieldRemove', cardId: rm.id, to: 'grave' }); }
      return true;
    }
    if (!onlyMonster && G.opFieldCard && G.opFieldCard.id === target.id) {
      G.opGrave.push(G.opFieldCard);
      sendAction({ type: 'opFieldCardRemove', cardId: target.id, to: 'grave' });
      G.opFieldCard = null;
      return true;
    }
    return false;
  };
  const forceOpponentDiscard = (n = 1) => {
    const k = Math.min(n, G.opHand.length);
    for (let i = 0; i < k; i++) G.opHand.shift();
    if (k > 0) sendAction({ type: 'opDiscardRandom', count: k });
  };
  const recoverMyMafiaFromGrave = () => {
    const gi = G.myGrave.findIndex(c => CARDS[c.id]?.theme === '마피아');
    if (gi < 0) return false;
    const c = G.myGrave.splice(gi, 1)[0];
    G.myHand.push({ id: c.id, name: c.name || CARDS[c.id]?.name || c.id, isPublic: false });
    return true;
  };

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
  if (picked.includes("상대는 덱에서 카드 1장을 패에 넣고, 패를 2장 버린다")) {
    if (typeof _aiDrawN === 'function') _aiDrawN(1);
    if (typeof forceOpponentDiscard === 'function') forceOpponentDiscard(2);
    return true;
  }
  if (picked.includes('상대 패 1장을 버린다')) {
    if (typeof forceOpponentDiscard === 'function') forceOpponentDiscard(1);
    return true;
  }
  if (picked.includes('상대 필드의 몬스터 1장을 고르고 묘지로 보낸다')) {
    const mons = G.opField.slice();
    if (mons.length > 0) forceSendOpFieldToGrave(mons[Math.floor(Math.random() * mons.length)], true);
    return true;
  }
  if (picked.includes('상대 필드의 카드 1장을 고르고 묘지로 보낸다')) {
    const all = opFieldAll();
    if (all.length > 0) forceSendOpFieldToGrave(all[Math.floor(Math.random() * all.length)], false);
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
    const t = myMafiaMons()[0];
    if (t) t.atk = (t.atk || t.atkBase || CARDS[t.id]?.atk || 0) + 3;
    return true;
  }
  if (picked.includes('자신 필드의 몬스터를 1장 묘지로 보내야 한다')) {
    if (G.myField.length > 0) sendToGrave(G.myField[0].id, 'field');
    return true;
  }
  if (picked.includes('2장 드로우하고, 패를 4장 고르고 버린다')) {
    drawN(2);
    const cnt = Math.min(4, G.myHand.length);
    for (let i = 0; i < cnt; i++) {
      const c = G.myHand.shift();
      if (c) G.myGrave.push({ id: c.id, name: c.name || CARDS[c.id]?.name || c.id });
    }
    return true;
  }
  return false;
}

window.tryResolveMafiaChainTransform = function(link) {
  if (!_isMafiaTransformLink(link)) return false;
  const card = CARDS[link.cardId] || { name: link.cardId };
  const opts = ((link.mainText || '').match(/-\s*(.+)/g) || []).map(s => s.replace(/^\-\s*/, '').trim()).filter(Boolean);
  const picked = opts.length > 0 ? opts[Math.floor(Math.random() * opts.length)] : '서로 1장 드로우한다.';
  window._mafiaChainReplaceCount += 1;
  log(`${card.name}: 상대 효과를 변형 → ${picked}`, 'mine');
  _resolveMafiaTransformChoice(picked);
  return true;
};

window.consumeMafiaChainReplacement = function(link) {
  if (window._mafiaChainReplaceCount <= 0 || link.by === myRole) return false;
  window._mafiaChainReplaceCount -= 1;
  log(`마피아 명령형 변형: ${link.label || link.type} 효과는 원효과 대신 대체 적용`, 'system');
  return true;
};

registerThemeEffectHandler('마피아', {
  activateFromHand: activateThemeCardEffectFromHand,
  resolveLink: resolveThemeEffectGeneric,
});
