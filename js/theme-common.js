// theme-common.js — 동적 테마(크툴루/올드원/라이온/타이거/라이거/마피아/불가사의) 공용 처리

window.THEME_EFFECT_HANDLERS = window.THEME_EFFECT_HANDLERS || {};

function registerThemeEffectHandler(theme, handler) {
  if (!theme || !handler) return;
  window.THEME_EFFECT_HANDLERS[theme] = handler;
}

function activateRegisteredThemeCardEffect(handIdx, effectNum = 1) {
  const c = G.myHand[handIdx];
  if (!c) return false;
  const card = CARDS[c.id];
  if (!card || !card.theme) return false;
  const handler = window.THEME_EFFECT_HANDLERS[card.theme];
  if (!handler || typeof handler.activateFromHand !== 'function') return false;
  handler.activateFromHand(handIdx, effectNum);
  return true;
}

function _extractEffectText(card, effectNum) {
  const raw = (card?.effects || '').split('\n').map(s => s.trim()).filter(Boolean);
  const bullet = ['①', '②', '③'][effectNum - 1];
  const found = raw.find(line => line.startsWith(bullet));
  return found || '';
}

function _inferThemePredicate(theme) {
  if (!theme) return () => true;
  if (theme === '라이거') {
    return c => ['라이거', '라이온', '타이거'].includes(CARDS[c.id]?.theme);
  }
  if (theme === '올드 원' || theme === '올드원') {
    return c => ['올드 원', '올드원', '크툴루'].includes(CARDS[c.id]?.theme);
  }
  return c => CARDS[c.id]?.theme === theme;
}

function _readCount(text, fallback = 1) {
  const m = text.match(/(\d+)장/);
  return m ? Math.max(1, parseInt(m[1], 10)) : fallback;
}

function _splitCostAndMain(effectText) {
  const marker = '발동할 수 있다.';
  const idx = effectText.indexOf(marker);
  if (idx < 0) return { costText: '', mainText: effectText };
  return {
    costText: effectText.slice(0, idx + marker.length).trim(),
    mainText: effectText.slice(idx + marker.length).trim(),
  };
}

function _isExileCostBlocked(costText) {
  if (!G.exileBanActive) return false;
  if (!costText) return false;
  return costText.includes('제외');
}

function _sendCardFromHandToZone(handIdx, zone = 'grave') {
  const card = G.myHand[handIdx];
  if (!card) return false;
  if (zone === 'grave') G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  else if (zone === 'exile') G.myExile.push(G.myHand.splice(handIdx, 1)[0]);
  return true;
}

function _payThemeCost(card, handIdx, costText, done) {
  if (!costText) { done(true); return; }
  if (_isExileCostBlocked(costText)) {
    notify('신성한 수호자 효과로 제외 코스트를 지불할 수 없어 발동할 수 없습니다.');
    done(false);
    return;
  }

  if (costText.includes('이 카드를') && costText.includes('버리')) {
    const idx = G.myHand.findIndex(h => h.id === card.id);
    if (idx < 0) { done(false); return; }
    _sendCardFromHandToZone(idx, 'grave');
  } else if (costText.includes('이 카드를') && costText.includes('제외')) {
    const idx = G.myHand.findIndex(h => h.id === card.id);
    if (idx < 0) { done(false); return; }
    _sendCardFromHandToZone(idx, 'exile');
  } else if (['magic', 'trap', 'normal'].includes(card.cardType)) {
    const idx = G.myHand.findIndex(h => h.id === card.id);
    if (idx >= 0) _sendCardFromHandToZone(idx, 'grave');
  }

  if (costText.includes('패') && costText.includes('버리') && !costText.includes('이 카드를')) {
    _forcedDiscardOne(`${card.name}: 코스트로 패 1장 버리기`, () => done(true));
    return;
  }

  if (costText.includes('덱') && costText.includes('제외')) {
    const themePredicate = _inferThemePredicate(card.theme);
    const targets = findAllInDeck(dc => themePredicate(dc));
    if (targets.length === 0) { notify('덱 제외 코스트를 지불할 카드가 없습니다.'); done(false); return; }
    openCardPicker(targets, `${card.name}: 코스트로 덱 카드 제외`, 1, (sel) => {
      if (sel.length === 0) { done(false); return; }
      const picked = targets[sel[0]];
      if (!removeFromDeck(picked.id)) { done(false); return; }
      G.myExile.push({ id: picked.id, name: picked.name || CARDS[picked.id]?.name || picked.id });
      done(true);
    });
    return;
  }

  done(true);
}

function activateThemeCardEffectFromHand(handIdx, effectNum = 1) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!card) return;
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }

  const effectText = _extractEffectText(card, effectNum);
  if (!effectText) { notify('효과 텍스트를 찾을 수 없습니다.'); return; }
  const { costText, mainText } = _splitCostAndMain(effectText);

  const chainEffect = {
    type: 'themeEffect',
    label: `${c.name} ${effectNum}`,
    cardId: c.id,
    effectNum,
    theme: card.theme,
    mainText,
  };

  if (activeChainState && activeChainState.active && activeChainState.priority !== myRole) {
    notify('현재 체인 우선권은 상대에게 있습니다. (체인 시작 직후에는 상대가 먼저 응답)');
    return;
  }

  _payThemeCost(card, handIdx, costText, (paid) => {
    if (!paid) return;
    if (activeChainState && activeChainState.active && activeChainState.priority !== myRole) {
      notify('코스트 지불 후 우선권이 변경되어 발동할 수 없습니다.');
      return;
    }
    markEffectUsed(c.id, effectNum);
    if (activeChainState && activeChainState.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState();
    renderAll();
  });
}

function resolveThemeEffectGeneric(link) {
  const mainText = link.mainText || '';
  const cardId = link.cardId;
  const card = CARDS[cardId] || { name: cardId, theme: link.theme };
  const count = _readCount(mainText, 1);
  const themePredicate = _inferThemePredicate(card.theme);

  if (mainText.includes('드로우')) {
    drawN(count);
    log(`${card.name}: ${count}장 드로우`, 'mine');
    return;
  }
  if (mainText.includes('덱') && mainText.includes('서치')) {
    const targets = findAllInDeck(dc => themePredicate(dc));
    if (targets.length === 0) return;
    openCardPicker(targets, `${card.name}: 덱에서 서치`, Math.min(count, targets.length), (sel) => {
      sel.map(i => targets[i]?.id).filter(Boolean).forEach(id => searchToHand(id));
      renderAll();
    });
    return;
  }
  if (mainText.includes('덱') && mainText.includes('소환')) {
    const targets = findAllInDeck(dc => CARDS[dc.id]?.cardType === 'monster' && themePredicate(dc));
    if (targets.length === 0) return;
    openCardPicker(targets, `${card.name}: 덱에서 소환`, 1, (sel) => {
      if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
      renderAll();
    });
    return;
  }
  if (mainText.includes('묘지') && mainText.includes('소환')) {
    const targets = G.myGrave.filter(gc => CARDS[gc.id]?.cardType === 'monster' && themePredicate(gc));
    if (targets.length === 0) return;
    openCardPicker(targets, `${card.name}: 묘지에서 소환`, 1, (sel) => {
      if (sel.length > 0) summonFromGrave(targets[sel[0]].id);
      renderAll();
    });
    return;
  }
  if (mainText.includes('상대') && mainText.includes('묘지')) {
    if (G.opField.length === 0) return;
    openCardPicker(G.opField, `${card.name}: 상대 몬스터 묘지로`, 1, (sel) => {
      if (sel.length > 0) {
        const mon = G.opField.splice(sel[0], 1)[0];
        if (!mon) return;
        G.opGrave.push(mon);
        sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' });
      }
      renderAll();
    });
    return;
  }
  log(`${card.name}: 메인 효과 해제`, 'mine');
}

function resolveThemeEffect(link) {
  const theme = link?.theme || CARDS[link?.cardId]?.theme;
  const handler = window.THEME_EFFECT_HANDLERS[theme];
  if (handler && typeof handler.resolveLink === 'function') {
    handler.resolveLink(link);
    return;
  }
  resolveThemeEffectGeneric(link);
}
