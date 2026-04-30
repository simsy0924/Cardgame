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
    _resolveLocalChainWithAI(chainState);
    return;
  }

  roomRef.child('chainState').set(chainState);
  syncClockRunState(chainState.priority);
}

// 상대가 체인을 열었을 때 사원소 ③ 자동 트리거
function _checkSaWonsoCounterOnOpponentChain() {
  if (typeof tryActivateSaWonsoJibaeryong3 === 'function') tryActivateSaWonsoJibaeryong3();
  if (typeof tryActivateSaWonsoJibaeja3    === 'function') tryActivateSaWonsoJibaeja3();
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
    _resolveLocalChainWithAI(next);
    return;
  }
  roomRef.child('chainState').set(next);
  syncClockRunState(next.priority);
}

function enqueueTriggeredEffect(effect) {
  const normalized = normalizeTriggeredEffect(effect);
  if (!normalized) return;
  if (normalized.optional) {
    gameConfirm(`${normalized.label}\n이 유발효과를 발동하시겠습니까?`, (yes) => {
      if (!yes) return;
      pendingTriggerEffects.push(normalized);
      setTimeout(flushTriggeredEffects, 0);
    });
    return;
  }
  pendingTriggerEffects.push(normalized);
  setTimeout(flushTriggeredEffects, 0);
}

function normalizeTriggeredEffect(effect) {
  if (!effect || !effect.type) return null;
  const speed = effect.speed || (String(effect.type).startsWith('quick') ? 'quick' : 'trigger');
  const timing = effect.timing || (speed === 'quick' ? 'response' : 'queued');
  return { mandatory: false, optional: false, ...effect, speed, timing };
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

function _resolveLocalChainWithAI(chainState) {
  const next = { ...chainState, links: [...(chainState.links || [])] };
  const isAIMode = !!(window.AI && window.AI.active);
  const aiRole = 'guest';
  const aiHasPriority = next.priority === aiRole;
  const aiCanChainKeyFetch = !!(isAIMode && aiHasPriority && !usedKeyFetchInChain[aiRole]);
  if (aiCanChainKeyFetch) {
    const aiKeyDeck = (G.opKeyDeck || []).filter(c => c && c.id);
    if (aiKeyDeck.length > 0) {
      const picked = aiKeyDeck[0];
      next.links.push({
        type: 'keyFetch',
        label: `키 카드 가져오기 (${picked.name || picked.id})`,
        cardId: picked.id,
        by: aiRole,
      });

      const opDeck = Array.isArray(G.opKeyDeck) ? [...G.opKeyDeck] : [];
      const deckIdx = opDeck.findIndex(c => c && c.id === picked.id);
      if (deckIdx >= 0) {
        const [fetchedCard] = opDeck.splice(deckIdx, 1);
        G.opKeyDeck = opDeck;
        G.opHand = [...(G.opHand || []), fetchedCard];
      }

      usedKeyFetchInChain[aiRole] = true;
      log(`체인 ${next.links.length}: 🤖 키 카드 가져오기 (${picked.name || picked.id})`, 'opponent');
    }
  }
  next.passCount = 2;
  resolveChain(next);
}

function activateQuickEffect(effect) {
  // 퀵 효과: 자신/상대 턴 전개·공격·엔드 단계에 발동 가능. 체인에 응답으로 추가 가능.
  if (currentPhase === 'draw') {
    notify('드로우 단계에는 효과를 발동할 수 없습니다.');
    return;
  }
  if (activeChainState && activeChainState.active) {
    if (activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다.');
      return;
    }
    addChainLink(effect);
    return;
  }
  beginChain(effect);
}

function activateIgnitionEffect(effect) {
  // 기동효과: 자신 전개 단계, 체인 1로만 발동 가능
  if (!isMyTurn || currentPhase !== 'deploy') {
    notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.');
    return;
  }
  if (activeChainState && activeChainState.active) {
    notify('기동효과는 체인 1로만 발동할 수 있습니다.');
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

// ─────────────────────────────────────────────
// CHAIN RESOLVERS — 체인 링크 타입별 실행 함수 매핑
// ─────────────────────────────────────────────
const CHAIN_RESOLVERS = {
  // 공용
  keyFetch:                  (link) => resolveKeyFetch(link.cardId),
  aiForceDiscard:            (link) => forceDiscard(Math.max(1, Number(link.count) || 1)),
  // 펭귄 마을
  penguinVillage1:           ()     => resolvePenguinVillage1(),
  // 꼬마 펭귄
  triggerKkomaPenguin:       ()     => resolveKkomaPenguin(),
  // 펭귄 부부
  triggerPenguinBubu1:       ()     => resolvePenguinBubu1(),
  ignitionPenguinBubu2:      ()     => resolvePenguinBubu2(),
  // 현자 펭귄
  ignitionSagePenguin1:      ()     => resolveSagePenguin1(),
  ignitionSagePenguin2:      ()     => resolveSagePenguin2(),
  // 수문장 펭귄
  ignitionSummonerPenguin1:  (link) => resolveSummonerPenguin1(link.sourceInstanceId),
  // 펭귄!돌격!
  ignitionPenguinCharge1:    (link) => resolvePenguinCharge1(link.sourceInstanceId),
  ignitionPenguinCharge2:    ()     => resolvePenguinCharge2(),
  // 펭귄의 영광
  ignitionPenguinGlory1:     (link) => resolvePenguinGlory1(link.sourceInstanceId),
  ignitionPenguinGlory2:     ()     => resolvePenguinGlory2(),
  // 펭귄 용사
  triggerPenguinHero1:       ()     => resolvePenguinHero1(),
  quickPenguinHero2:         ()     => resolvePenguinHero2(),
  triggerPenguinHero3:       ()     => resolvePenguinHero3(),
  // 펭귄의 일격
  quickPenguinStrike1:       ()     => resolvePenguinStrike1(),
  triggerPenguinStrike2:     ()     => _tryRecoverPenguinStrikeFromGrave(),
  // 펭귄이여 영원하라
  ignitionPenguinForever1:   ()     => resolvePenguinForever1(),
  quickPenguinForever2:      ()     => resolvePenguinForever2(),
  // 펭귄의 전설
  triggerPenguinLegend1:     ()     => resolvePenguinLegend1(),
  quickPenguinLegend2:       ()     => resolvePenguinLegend2(),
  // 펭귄 마법사
  ignitionPenguinWizard1:    ()     => resolvePenguinWizard1(),
  triggerPenguinWizard2:     ()     => resolvePenguinWizard2(),
  ignitionPenguinWizard3:    ()     => resolvePenguinWizard3(),
  // 동적 테마 (theme-common.js)
  themeEffect:               (link) => resolveThemeEffect(link),
  // 지배자 ① — 코스트 후 체인 해결
  jibaeShui1:                ()     => resolveJibaeShui1(),
  jibaeHwa1:                 ()     => resolveJibaeHwa1(),
  jibaeJeon1:                ()     => resolveJibaeJeon1(),
  jibaeFung1:                ()     => resolveJibaeFung1(),
};

// 체인 링크를 역순으로 로컬 실행 (Firebase 없이 해결하거나 resolvedLinks 처리 시)
function executeChainLocally(links) {
  links.forEach(link => {
    if (link.by !== myRole) return;
    const resolver = CHAIN_RESOLVERS[link.type];
    if (resolver) {
      resolver(link);
    } else {
      console.warn('[Chain] 알 수 없는 링크 타입:', link.type);
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

// ★ 강제 패 버리기 1장 — 코스트용, 취소 불가
// 펭귄 마을 ②: 버리는 대신 필드 펭귄 묘지 가능
function _forcedDiscardOne(title, callback) {
  if (G.myHand.length === 0) { callback(); return; }

  // 펭귄 마을 ② 체크
  const villageIdx    = G.myHand.findIndex(c => c.id === '펭귄 마을' && c.isPublic);
  const fieldPenguins = G.myField.filter(c => isPenguinMonster(c.id));

  if (villageIdx >= 0 && fieldPenguins.length > 0) {
    gameConfirm(
      `펭귄 마을 ② 발동?\n패 1장 버리는 대신 필드 펭귄 몬스터를 묘지로 보냅니다.`,
      (yes) => {
        if (yes) {
          openCardPicker(fieldPenguins, '펭귄 마을 ②: 묘지로 보낼 펭귄 몬스터', 1, (sel) => {
            if (sel.length > 0) {
              const mon = fieldPenguins[sel[0]];
              sendToGrave(mon.id, 'field');
              if (mon.id === '수문장 펭귄') triggerSummonerPenguin2();
              _tryRecoverPenguinStrikeFromGrave();
            }
            callback();
          }, true);
        } else {
          // 마을 거부 → 일반 강제 버리기
          _doForcedDiscardOne(title, callback);
        }
      }
    );
  } else {
    _doForcedDiscardOne(title, callback);
  }
}

function _doForcedDiscardOne(title, callback) {
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
  }, true);
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
