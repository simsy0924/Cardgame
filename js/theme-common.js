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
  // "~ 하고 발동할 수 있다." 패턴 전부를 코스트+발동 선언으로 인식.
  // 효과 내에 이 표현이 여러 번 나올 수 있으므로 **마지막 등장** 기준으로 분리한다.
  // 마지막 기준을 써야 "소환하고 발동할 수 있다. ...할 수 있다." 형태에서 앞쪽 전체가
  // costText에, 뒤쪽 선택 드로우 등이 mainText에 올바르게 들어간다.
  const MARKERS = [
    '발동할 수 있다.',   // 기본형
    '발동한다.',         // "~하고 발동한다" (강제 발동)
  ];

  let bestIdx = -1;
  let bestMarker = '';
  for (const marker of MARKERS) {
    let pos = -1;
    let cur = effectText.indexOf(marker);
    // 마지막 등장 위치를 찾는다
    while (cur >= 0) {
      pos = cur;
      cur = effectText.indexOf(marker, cur + 1);
    }
    // 효과 텍스트의 첫 번째 문장 내 등장이어야 costText로 인식
    // (불릿 ① 직후 첫 문장 = 첫 마침표까지)
    if (pos > bestIdx) {
      bestIdx = pos;
      bestMarker = marker;
    }
  }

  // 분리 가능한 위치가 없으면 전체가 mainText
  if (bestIdx < 0) return { costText: '', mainText: effectText };

  const splitEnd = bestIdx + bestMarker.length;

  // "발동할 수 있다." 가 효과 텍스트의 유일한 문장이면 → costText만 있고 mainText 없음
  // 즉, 텍스트 전체가 발동 선언이고 실제 효과는 resolve에서 카드별로 처리
  const remainder = effectText.slice(splitEnd).trim();
  return {
    costText: effectText.slice(0, splitEnd).trim(),
    mainText: remainder,
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

function canResolveThemeEffectFromText(mainText, card, opts = {}) {
  const text = String(mainText || '');
  const count = _readCount(text, 1);
  const themePredicate = _inferThemePredicate(card?.theme);

  // 수치 변화/무효/보호 계열은 타깃 없이도 처리 가능하므로 허용
  if (text.includes('무효') || text.includes('공격력') || text.includes('카운터')) return true;

  if (text.includes('드로우')) return true;

  if (text.includes('덱') && (text.includes('서치') || text.includes('패에 넣'))) {
    return findAllInDeck(dc => themePredicate(dc)).length >= Math.min(1, count);
  }

  if (text.includes('덱') && text.includes('소환')) {
    return findAllInDeck(dc => CARDS[dc.id]?.cardType === 'monster' && themePredicate(dc)).length >= 1;
  }

  if (text.includes('묘지') && text.includes('소환')) {
    return G.myGrave.some(gc => CARDS[gc.id]?.cardType === 'monster' && themePredicate(gc));
  }

  if (text.includes('상대') && text.includes('묘지')) {
    return G.opField.length > 0;
  }

  // 규칙 적용 범위 밖의 문장은 기존 카드별 체크/해결 로직에 위임
  return true;
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

  if (!canResolveThemeEffectFromText(mainText, card)) {
    notify('효과를 처리할 수 없어 발동할 수 없습니다.');
    return;
  }

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
    else window.beginChain(chainEffect);
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
    // [BUG FIX] 상대 필드 마법(opFieldCard)도 대상에 포함
    const opTargets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
    if (opTargets.length === 0) return;
    openCardPicker(opTargets, `${card.name}: 상대 필드 카드 묘지로`, 1, (sel) => {
      if (sel.length > 0) {
        const t = opTargets[sel[0]];
        const oi = G.opField.findIndex(c => c.id === t.id);
        if (oi >= 0) {
          const mon = G.opField.splice(oi, 1)[0];
          if (mon) { G.opGrave.push(mon); sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' }); }
        } else if (G.opFieldCard && G.opFieldCard.id === t.id) {
          G.opGrave.push(G.opFieldCard);
          sendAction({ type: 'opFieldCardRemove', cardId: t.id, to: 'grave' });
          G.opFieldCard = null;
        }
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

// ─────────────────────────────────────────────────────────────
// 자동 체인 응답 등록 — 카드 텍스트 파싱 기반
// "자신/상대 턴에 발동할 수 있다" 패턴이 있는 카드를 전부 자동 등록
// ─────────────────────────────────────────────────────────────
(function _autoRegisterThemeChainResponses() {
  if (typeof registerChainHandResponse !== 'function') {
    setTimeout(_autoRegisterThemeChainResponses, 50);
    return;
  }

  const QUICK_THEMES = ['크툴루', '올드원', '올드 원', '라이온', '타이거', '라이거', '마피아', '불가사의', '지배자', '엘리멘츠'];
  // 지배자는 jibaeja.js에서 별도 등록하므로 여기선 제외
  const AUTO_THEMES  = ['크툴루', '올드원', '올드 원', '라이온', '타이거', '라이거', '마피아', '불가사의', '엘리멘츠'];

  // "이 효과가 상대 턴에도 발동 가능한지" 판별
  // 효과 텍스트에 아래 패턴 중 하나가 있으면 퀵효과로 간주
  const QUICK_PATTERNS = [
    '자신/상대 턴에',
    '상대 턴에 발동할 수 있다',
    '상대턴에도 발동할 수 있다',
    '상대 효과가 발동했을 때',
    '상대가 효과를 발동했을 때',
  ];

  function _isQuickEffect(effectText) {
    return QUICK_PATTERNS.some(p => effectText.includes(p));
  }

  // 각 카드 순회
  Object.values(CARDS || {}).forEach(card => {
    if (!AUTO_THEMES.includes(card.theme)) return;
    const effects = (card.effects || '').split('\n').filter(Boolean);
    const entries = [];

    [1, 2, 3].forEach(effectNum => {
      const bullet = ['①', '②', '③'][effectNum - 1];
      const line = effects.find(l => l.startsWith(bullet));
      if (!line) return;
      if (!_isQuickEffect(line)) return;

      entries.push({
        effectNum,
        label: `${bullet} 퀵 효과 발동`,
        condition: (handIdx) => {
          // 현재 체인이 활성이고 내 우선권일 때, 또는 상대 턴일 때
          if (activeChainState && activeChainState.active) return true;
          if (!isMyTurn) return true;
          return false;
        },
        activate: (handIdx) => {
          activateThemeCardEffectFromHand(handIdx, effectNum);
        },
      });
    });

    if (entries.length > 0) {
      registerChainHandResponse(card.id, entries);
    }
  });
})();