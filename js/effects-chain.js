
// effects-chain.js — 체인/유발/퀵 이펙트 처리
function beginChain(effect) {
  const chainState = {
    active: true,
    startedBy: myRole,
    // 발동자 본인에게 먼저 우선권 — 추가 체인 여부 결정 후 상대에게 넘김
    priority: myRole,
    passCount: 0,
    links: [{ ...effect, by: myRole }],
  };
  activeChainState = chainState;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 1: ${effect.label} 발동`, 'mine');

  if (!roomRef) {
    // 로컬/AI: 발동자(플레이어)에게 응답 기회 부여
    // renderChainActions()로 응답/패스 버튼 표시 → 플레이어가 패스하면 AI로 넘어감
    renderChainActions();
    renderAll();
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


// ─────────────────────────────────────────────────────────────
// 체인 응답 레지스트리 — 패에서 체인에 응답 가능한 카드 등록
// 각 테마 파일에서 registerChainHandResponse()로 등록
// ─────────────────────────────────────────────────────────────
window.CHAIN_HAND_RESPONSES = window.CHAIN_HAND_RESPONSES || {};

/**
 * registerChainHandResponse(cardId, entries)
 * entries: [{ effectNum, label, condition(), activate(handIdx) }, ...]
 *
 * condition(): 현재 체인 상태/패/필드를 보고 발동 가능 여부 반환
 * activate(handIdx): 실제 발동 함수 호출
 */
function registerChainHandResponse(cardId, entries) {
  window.CHAIN_HAND_RESPONSES[cardId] = entries;
}

/**
 * collectChainOptions()
 * 현재 패를 순회하며 체인에 응답 가능한 모든 옵션을 반환
 * returns: [{ label, cardId, handIdx, activate }]
 */
function collectChainOptions() {
  const options = [];

  // 1) 키카드 가져오기 (기존)
  if (!usedKeyFetchInChain[myRole]) {
    (G.myKeyDeck || []).forEach(c => {
      let canFetch = true;
      if (c.id === '펭귄 용사'   && G.opField.length === 0) canFetch = false;
      if (c.id === '펭귄의 전설' && G.myField.length === 0) canFetch = false;
      if (!canFetch) return;
      options.push({
        label:   `[키카드] ${c.name} 가져오기`,
        cardId:  c.id,
        handIdx: -1,
        activate() {
          addChainLink({ type: 'keyFetch', label: `키 카드 가져오기 (${c.name})`, cardId: c.id });
        },
      });
    });
  }

  // 2) 패의 카드 — 레지스트리 기반
  G.myHand.forEach((handCard, handIdx) => {
    const entries = window.CHAIN_HAND_RESPONSES[handCard.id];
    if (!entries) return;
    entries.forEach(entry => {
      if (!canUseEffect(handCard.id, entry.effectNum)) return;
      if (entry.condition && !entry.condition(handIdx)) return;
      options.push({
        label:   `[패] ${handCard.name} ${entry.label}`,
        cardId:  handCard.id,
        handIdx,
        activate() { entry.activate(handIdx); },
      });
    });
  });

  return options;
}

function openChainResponse() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;

  const options = collectChainOptions();

  if (options.length === 0) {
    notify('응답 가능한 카드가 없습니다. 패스하세요.');
    return;
  }

  // 선택지가 1개면 바로 발동 확인
  if (options.length === 1) {
    gameConfirm(`체인 응답: ${options[0].label}\n발동하시겠습니까?`, (yes) => {
      if (yes) options[0].activate();
    });
    return;
  }

  // 여러 선택지 — 카드 픽커로 표시
  const displayList = options.map(o => ({ id: o.cardId, name: o.label }));
  openCardPicker(displayList, '체인 응답 — 발동할 효과를 선택하세요', 1, (sel) => {
    if (!sel || sel.length === 0) return;
    options[sel[0]].activate();
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
    // 로컬/AI 모드: 상대(AI)에게 우선권 넘기고 AI 응답 트리거
    // AI 응답 후 AI도 패스하면 다시 플레이어에게 → passCount 2 → resolve
    activeChainState = next;
    renderChainActions();
    // ai.js의 passChainPriority 훅이 AI 응답을 처리함
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
  // 추가한 본인에게 먼저 우선권 → 추가 체인 여부 결정 후 상대에게 넘김
  next.priority = myRole;
  next.passCount = 0;
  activeChainState = next;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 ${next.links.length}: ${effect.label}`, 'mine');

  if (!roomRef) {
    renderChainActions();
    renderAll();
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

  // 로컬/Firebase 모두 beginChain 경로를 타도록 통일
  // roomRef 없으면 beginChain 내부에서 _resolveLocalChainWithAI가 호출되므로
  // 체인블록이 형성된 후 즉시 해결됨 (유발효과도 정식 체인블록을 형성)
  beginChain(queued[0]);
  queued.slice(1).forEach(e => addChainLink(e));
}

function _resolveLocalChainWithAI(chainState) {
  if (!window.AI || !window.AI.active) {
    const localState = { ...chainState, passCount: 2 };
    resolveChain(localState);
    return;
  }

  activeChainState = { ...chainState, priority: 'guest' };
  renderChainActions();

  setTimeout(() => {
    if (typeof window._aiRespondToChain === 'function') {
      window._aiRespondToChain();
      return;
    }
    if (typeof window._aiChainResponse === 'function') {
      window._aiChainResponse(activeChainState);
      return;
    }

    // 안전장치: AI 응답 함수가 없는 경우 로컬 체인이 멈추지 않도록 즉시 해결
    resolveChain({ ...activeChainState, passCount: 2 });
  }, 800);
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
  // AI 눈에는 눈 — 체인 해결 시 AI 드로우 실행
  aiEyeForEye:               ()     => { _aiDrawN(2); log('🤖 눈에는 눈: 드로우 2장', 'opponent'); renderAll(); },
  // 플레이어 눈에는 눈 — 상대 서치에 대응, 체인 해결 시 드로우
  eyeForEyePlayer:           ()     => { drawN(2); log('눈에는 눈: 드로우 2장!', 'mine'); sendGameState(); renderAll(); },
  // 펭귄 마을
  penguinVillage1:           ()     => resolvePenguinVillage1(),
  // 꼬마 펭귄
  ignitionKkomaPenguin1:     (link) => resolveKkomaPenguin1(link.cardId),
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
  triggerPenguinStrike2:     ()     => resolvePenguinStrike2(),
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

// 체인 링크를 역순으로 실행
// - 내 링크: CHAIN_RESOLVERS로 실행
// - 상대 링크: sendAction으로 상대 화면에서 실행 (로컬/AI 모드는 handleOpponentAction 직접 호출)
// - negate/genericNegate 링크: 바로 다음(숫자 낮은) 링크를 무효화
function executeChainLocally(links) {
  const negatedIndices = new Set();

  // 역순(높은 체인 번호 → 낮은 번호)으로 무효 대상 마킹
  links.forEach((link, i) => {
    if (link.type === 'quickPenguinStrike1' || link.type === 'genericNegate') {
      // 이 링크 바로 다음(원래 체인에서 하나 낮은) 링크 무효
      // links는 이미 역순이므로 i+1이 원래 체인에서 하나 낮은 링크
      if (i + 1 < links.length) negatedIndices.add(i + 1);
    }
  });

  links.forEach((link, i) => {
    if (negatedIndices.has(i)) {
      log(`무효: ${link.label || link.type}`, 'system');
      return; // 무효된 링크 스킵
    }

    if (link.by === myRole) {
      // 내 링크 — 로컬 실행
      const resolver = CHAIN_RESOLVERS[link.type];
      if (resolver) resolver(link);
      else console.warn('[Chain] 알 수 없는 링크 타입:', link.type);
    } else {
      // 상대 링크 — AI/로컬 모드에서 직접 처리
      if (window.AI && window.AI.active) {
        _executeAIChainLink(link);
      }
      // Firebase 모드에서는 상대 클라이언트가 자기 링크를 직접 실행하므로 여기서 실행 안 함
    }
  });

  sendGameState();
  renderAll();
  usedKeyFetchInChain = {};
}

// AI 체인 링크 실행 — AI(상대) 측 효과를 로컬에서 처리
function _executeAIChainLink(link) {
  switch (link.type) {
    case 'aiEyeForEye':
      _aiDrawN(2);
      log('🤖 눈에는 눈: 드로우 2장', 'opponent');
      break;
    case 'aiForceDiscard':
      // AI가 버려야 하는 경우 — sendAction 경로에서 처리됨
      break;
    case 'themeEffect':
    case 'keyFetch':
      // 상대 키카드 가져오기는 sendGameState로 동기화됨
      break;
    default:
      // 알 수 없는 AI 링크 — 무시
      break;
  }
}


// ─────────────────────────────────────────────────────────────
// 펭귄 마을 ② 지속효과 — 버려지는 카드가 공개된 펭귄 마을일 때만 가로챔
// 체인 없이 즉시 물어봄 (지속효과)
// callback(true)  = 마을 ②로 대체됨 → 실제 버리기 취소
// callback(false) = 대체 안 함 → 정상 버리기 진행
// ─────────────────────────────────────────────────────────────
function _checkVillageOnDiscard(cardId, callback) {
  if (cardId !== '펭귄 마을') { callback(false); return; }
  const villageCard   = G.myHand.find(c => c.id === '펭귄 마을' && c.isPublic);
  const fieldPenguins = G.myField.filter(c => isPenguinMonster(c.id));
  if (!villageCard || fieldPenguins.length === 0) { callback(false); return; }

  gameConfirm(
    `펭귄 마을 ②\n버리는 대신 필드의 펭귄 몬스터를 묘지로 보냅니까?`,
    (yes) => {
      if (!yes) { callback(false); return; }
      openCardPicker(fieldPenguins, '펭귄 마을 ②: 대신 묘지로 보낼 펭귄 몬스터', 1, (sel) => {
        if (sel.length > 0) {
          const mon = fieldPenguins[sel[0]];
          sendToGrave(mon.id, 'field');
          log(`펭귄 마을 ②: ${mon.name} 대신 묘지`, 'mine');
          if (mon.id === '수문장 펭귄') triggerSummonerPenguin2();
          _tryRecoverPenguinStrikeFromGrave();
          sendGameState(); renderAll();
        }
        callback(true); // 대체 완료 → 마을 자체는 버리지 않음
      }, true);
    }
  );
}

function manualDiscard(handIdx) {
  if (handIdx < 0 || !G.myHand[handIdx]) return;
  const c = G.myHand[handIdx];
  selectedCardIdx = -1;

  _checkVillageOnDiscard(c.id, (replaced) => {
    if (replaced) return; // 마을 ②로 대체 — 실제 버리기 없음
    G.myHand.splice(handIdx, 1);
    G.myGrave.push({ id: c.id, name: c.name });
    log(`패를 버림: ${c.name}`, 'mine');
    sendAction({ type: 'discard', cardId: c.id });
    onJibaeryongDiscarded(c.id);
    onHandDiscarded_jibaeSasl();
    sendGameState(); renderAll(); checkWinCondition();
  });
}

// _forcedDiscardOne: 코스트용 강제 1장 버리기
function _forcedDiscardOne(title, callback) {
  if (G.myHand.length === 0) { callback(); return; }
  openCardPicker(G.myHand, title, 1, (sel) => {
    if (sel.length === 0) { callback(); return; }
    const c = G.myHand[sel[0]];
    _checkVillageOnDiscard(c.id, (replaced) => {
      if (!replaced) {
        G.myHand.splice(sel[0], 1);
        G.myGrave.push({ id: c.id, name: c.name });
        log(`버림(코스트): ${c.name}`, 'mine');
        onJibaeryongDiscarded(c.id);
        onHandDiscarded_jibaeSasl();
      }
      callback();
    });
  }, true);
}

function _doForcedDiscardOne(title, callback) {
  _forcedDiscardOne(title, callback);
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

// ─────────────────────────────────────────────────────────────
// 체인 응답 레지스트리 — 범용 카드 등록
// ─────────────────────────────────────────────────────────────
(function _registerGenericChainResponses() {
  if (typeof registerChainHandResponse !== 'function') {
    setTimeout(_registerGenericChainResponses, 50);
    return;
  }

  // 출입통제: 상대 소환 효과를 체인으로 무효
  registerChainHandResponse('출입통제', [
    {
      effectNum: 1,
      label: '① 상대 소환 효과 무효',
      condition: () => {
        if (!activeChainState || !activeChainState.active) return false;
        // 체인에 상대 링크가 있을 때
        return (activeChainState.links || []).some(l => l.by !== myRole);
      },
      activate: (handIdx) => {
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        log('출입통제 발동!', 'mine');
        sendAction({ type: 'negate', reason: '출입통제' });
        addChainLink({ type: 'genericNegate', label: '출입통제' });
        sendGameState(); renderAll();
      },
    },
  ]);

  // 눈에는 눈 (범용): 이미 penguin.js에 등록되어 있으나
  // 키카드 없는 경우도 대비해 여기서도 등록 (중복 방지: 등록 안 된 경우만)
  if (!window.CHAIN_HAND_RESPONSES?.['눈에는 눈']) {
    registerChainHandResponse('눈에는 눈', [
      {
        effectNum: 1,
        label: '① 버리고 드로우 2장',
        condition: () => {
          if (!activeChainState || !activeChainState.active) return false;
          return (activeChainState.links || []).some(l => l.by !== myRole);
        },
        activate: (handIdx) => {
          G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
          markEffectUsed('눈에는 눈', 1);
          addChainLink({ type: 'eyeForEyePlayer', label: '눈에는 눈' });
          sendGameState(); renderAll();
        },
      },
    ]);
  }
})();

// CHAIN_RESOLVERS에 genericNegate 추가
if (typeof CHAIN_RESOLVERS !== 'undefined') {
  CHAIN_RESOLVERS.genericNegate = () => {
    log('출입통제: 효과 무효!', 'mine');
    sendGameState(); renderAll();
  };
}
