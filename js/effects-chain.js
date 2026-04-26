// effects-chain.js — 체인/유발/퀵 이펙트 처리
function beginChain(effect) {
  const chainState = {
    active: true,
    startedBy: myRole,
    priority: myRole === 'host' ? 'guest' : 'host',
    passCount: 0,
    links: [{ ...effect, by: myRole }],
  };
  activeChainState = chainState;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 1: ${effect.label} 발동`, 'mine');

  if (!roomRef) {
    // 로컬/데모: 상대 자동 패스 → 즉시 해결
    const localState = { ...chainState, passCount: 2 };
    resolveChain(localState);
    return;
  }

  roomRef.child('chainState').set(chainState);
  syncClockRunState(chainState.priority);
}

function openChainResponse() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;
  if (usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }
  const options = (G.myKeyDeck || []).map(c => ({ id: c.id, name: c.name }));
  if (options.length === 0) {
    notify('키 카드 덱에 발동 가능한 카드가 없습니다. 패스하세요.');
    return;
  }
  openCardPicker(options, '체인 응답: 키 카드 가져오기 (유발 즉시)', 1, (sel) => {
    if (!sel || sel.length === 0) return; // 취소 시 무시
    const picked = options[sel[0]];
    if (!picked) return;
    addChainLink({
      type: 'keyFetch',
      label: `키 카드 가져오기 (${picked.name})`,
      cardId: picked.id,
    });
  });
}

function passChainPriority() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;

  const next = { ...activeChainState };
  next.passCount = (next.passCount || 0) + 1;
  next.priority = myRole === 'host' ? 'guest' : 'host';
  log('체인 패스', 'system');

  if (next.passCount >= 2) {
    resolveChain(next);
    return;
  }

  if (!roomRef) {
    // 로컬/데모: 상대도 자동 패스 → 즉시 해결
    next.passCount = 2;
    resolveChain(next);
    return;
  }

  activeChainState = next;
  roomRef.child('chainState').set(next);
  syncClockRunState(next.priority);
}

function addChainLink(effect) {
  if (!activeChainState || !activeChainState.active) return;
  if (effect.type === 'keyFetch' && usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }
  const next = { ...activeChainState };
  next.links = [...(next.links || []), { ...effect, by: myRole }];
  next.priority = myRole === 'host' ? 'guest' : 'host';
  next.passCount = 0;
  activeChainState = next;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 ${next.links.length}: ${effect.label}`, 'mine');

  if (!roomRef) {
    // 로컬: 상대 패스 자동 처리 → 즉시 해결
    next.passCount = 2;
    resolveChain(next);
    return;
  }
  roomRef.child('chainState').set(next);
  syncClockRunState(next.priority);
}

function enqueueTriggeredEffect(effect) {
  pendingTriggerEffects.push(effect);
  setTimeout(flushTriggeredEffects, 0);
}

function flushTriggeredEffects() {
  if (pendingTriggerEffects.length === 0) return;
  if (activeChainState && activeChainState.active) return;

  const queued = [...pendingTriggerEffects];
  pendingTriggerEffects = [];

  if (!roomRef) {
    const links = queued.map(e => ({ ...e, by: myRole }));
    executeChainLocally(links.reverse());
    return;
  }

  beginChain(queued[0]);
  queued.slice(1).forEach(e => addChainLink(e));
}

function activateQuickEffect(effect) {
  if (activeChainState && activeChainState.active) {
    if (activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다. (체인 시작 직후에는 상대가 먼저 응답)');
      return;
    }
    addChainLink(effect);
    return;
  }
  beginChain(effect);
}

function activateIgnitionEffect(effect) {
  if (activeChainState && activeChainState.active) {
    if (activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다. (체인 시작 직후에는 상대가 먼저 응답)');
      return;
    }
    addChainLink(effect);
    return;
  }
  beginChain(effect);
}

function ensureCardInstanceId(card) {
  if (!card) return null;
  if (!card._iid) {
    ensureCardInstanceId._seq = (ensureCardInstanceId._seq || 0) + 1;
    card._iid = `cid_${Date.now()}_${ensureCardInstanceId._seq}`;
  }
  return card._iid;
}

function findCardIndexByInstanceId(zone, instanceId) {
  if (!Array.isArray(zone) || !instanceId) return -1;
  return zone.findIndex(c => c && c._iid === instanceId);
}

function resolveChain(chainState) {
  const links = [...(chainState.links || [])];
  const resolvedAt = Date.now();
  usedKeyFetchInChain = {};
  activeChainState = null; // ★ 즉시 초기화 → 버튼 정상화
  renderChainActions();
  if (roomRef) {
    roomRef.child('chainState').set({ active: false, links: [], priority: null, passCount: 0, resolvedLinks: links, resolvedAt });
  } else {
    executeChainLocally(links.slice().reverse());
  }
}

function executeChainLocally(links) {
  links.forEach(link => {
    if (link.by !== myRole) return;
    if (link.type === 'keyFetch') {
      resolveKeyFetch(link.cardId);
    } else if (link.type === 'penguinVillage1') {
      resolvePenguinVillage1();
    } else if (link.type === 'triggerKkomaPenguin') {
      resolveKkomaPenguin();
    } else if (link.type === 'triggerPenguinBubu1') {
      resolvePenguinBubu1();
    } else if (link.type === 'triggerPenguinHero1') {
      resolvePenguinHero1();
    } else if (link.type === 'triggerPenguinLegend1') {
      resolvePenguinLegend1();
    } else if (link.type === 'triggerPenguinWizard2') {
      resolvePenguinWizard2();
    } else if (link.type === 'triggerPenguinHero3') {
      resolvePenguinHero3();
    } else if (link.type === 'quickPenguinHero2') {
      resolvePenguinHero2();
    } else if (link.type === 'quickPenguinLegend2') {
      resolvePenguinLegend2();
    } else if (link.type === 'quickPenguinStrike1') {
      resolvePenguinStrike1();
    } else if (link.type === 'quickPenguinForever2') {
      resolvePenguinForever2();
    } else if (link.type === 'ignitionPenguinBubu2') {
      resolvePenguinBubu2();
    } else if (link.type === 'ignitionSagePenguin1') {
      resolveSagePenguin1();
    } else if (link.type === 'ignitionSagePenguin2') {
      resolveSagePenguin2();
    } else if (link.type === 'ignitionSummonerPenguin1') {
      resolveSummonerPenguin1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinCharge1') {
      resolvePenguinCharge1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinCharge2') {
      resolvePenguinCharge2();
    } else if (link.type === 'ignitionPenguinGlory1') {
      resolvePenguinGlory1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinGlory2') {
      resolvePenguinGlory2();
    } else if (link.type === 'ignitionPenguinForever1') {
      resolvePenguinForever1();
    } else if (link.type === 'ignitionPenguinWizard1') {
      resolvePenguinWizard1();
    } else if (link.type === 'ignitionPenguinWizard3') {
      resolvePenguinWizard3();
    } else if (link.type === 'themeEffect') {
      resolveThemeEffect(link);
    }
  });
  sendGameState();
  renderAll();
  usedKeyFetchInChain = {};
}


function manualDiscard(handIdx) {
  if (handIdx < 0 || !G.myHand[handIdx]) return;
  const c = G.myHand.splice(handIdx, 1)[0];
  G.myGrave.push({ id: c.id, name: c.name });
  selectedCardIdx = -1;
  log(`패를 버림: ${c.name}`, 'mine');
  sendAction({ type: 'discard', cardId: c.id });
  onJibaeryongDiscarded(c.id);
  onHandDiscarded_jibaeSasl();
  sendGameState();
  renderAll();
  checkWinCondition();
}

// ★ 강제 패 버리기 — 반드시 1장 선택해야 함, 취소 불가
function _forcedDiscardOne(title, callback) {
  if (G.myHand.length === 0) { callback(); return; }
  openCardPicker(G.myHand, title, 1, (sel) => {
    if (sel.length > 0) {
      const c = G.myHand.splice(sel[0], 1)[0];
      G.myGrave.push(c);
      log(`버림(코스트): ${c.name}`, 'mine');
      onJibaeryongDiscarded(c.id);
      onHandDiscarded_jibaeSasl();
    }
    callback();
  }, true); // forced=true: 반드시 선택, 취소 불가
}

function resolveKeyFetch(cardId) {
  const idx = G.myKeyDeck.findIndex(c => c.id === cardId);
  if (idx < 0) { notify(`키 카드 덱에 ${CARDS[cardId]?.name || cardId}가 없습니다.`); return; }

  // ★ 카드별 가져오기 조건 체크
  if (cardId === '펭귄 용사') {
    // "상대 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있다"
    if (G.opField.length === 0) {
      notify('펭귄 용사: 상대 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
      return;
    }
  }
  if (cardId === '펭귄의 전설') {
    // "자신 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있다"
    if (G.myField.length === 0) {
      notify('펭귄의 전설: 자신 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
      return;
    }
  }

  const c = G.myKeyDeck.splice(idx, 1)[0];
  G.myHand.push({ id: c.id, name: c.name, isPublic: true });
  log(`키 카드 가져오기: ${c.name} (공개패)`, 'mine');
  sendGameState(); renderAll();
}

function resolvePenguinVillage1() {
  const idx = G.myHand.findIndex(c => c.id === '펭귄 마을' && !c.isPublic);
  if (idx < 0) return;
  G.myHand[idx].isPublic = true;
  markEffectUsed('펭귄 마을', 1);
  log('체인 처리: 펭귄 마을 ① 공개', 'mine');
}

function renderFieldZones() {}
