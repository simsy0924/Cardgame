
// effects-chain.js — 체인/유발/퀵 이펙트 처리
function nextChainId() {
  window._CHAIN_SEQ = (window._CHAIN_SEQ || 0) + 1;
  return 'chain_' + String(window._CHAIN_SEQ);
}

function getOpponentRole(role) {
  return role === 'host' ? 'guest' : 'host';
}

function beginChain(effect) {
  const chainState = {
    chainId: nextChainId(),
    active: true,
    startedBy: myRole,
    // 마지막 발동자의 상대에게 우선권
    priority: getOpponentRole(myRole),
    passCount: 0,
    links: [{ ...effect, by: myRole }],
  };
  activeChainState = chainState;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 1: ${effect.label} 발동`, 'mine');

  if (!roomRef) {
    renderChainActions();
    renderAll();
    // AI 모드: ai.js 훅(beginChain 래퍼)이 _onChainUpdated를 호출하므로
    // 여기선 렌더만 하고 return. 훅이 없으면(비AI 로컬) 즉시 resolve.
    if (!window.AI || !window.AI.active) {
      // 비AI 데모 모드: 즉시 resolve
      resolveChain({ ...chainState, passCount: 2 });
    }
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
 * condition(handIdx): 현재 체인 상태/패/필드를 보고 발동 가능 여부 반환
 *   - activeChainState가 활성 중임은 collectChainOptions()가 보장
 *   - "상대 링크가 있어야 한다" 같은 추가 조건만 작성할 것
 * activate(handIdx): 실제 발동 함수 호출
 */
function registerChainHandResponse(cardId, entries) {
  window.CHAIN_HAND_RESPONSES[cardId] = entries;
}

// ─────────────────────────────────────────────────────────────
// 체인 발동자 판별 헬퍼
// ─────────────────────────────────────────────────────────────

/** 체인에 상대(myRole 기준)가 발동한 링크가 하나라도 있는가 */
function _chainHasOpponentLink() {
  if (!activeChainState || !activeChainState.active) return false;
  return (activeChainState.links || []).some(l => l.by !== myRole);
}

/** 체인에 상대가 발동한 서치계 링크가 있는가 (눈에는 눈 조건) */
function _chainHasOpponentSearchLink() {
  if (!activeChainState || !activeChainState.active) return false;
  return (activeChainState.links || []).some(l => {
    if (l.by === myRole) return false; // 내 링크 제외
    const t = String(l.type || '');
    return t === 'keyFetch' || t.includes('search') || t.includes('Search')
        || t === 'aiSearch' || t === 'themeEffect';
  });
}

/**
 * collectChainOptions()
 * 현재 패를 순회하며 체인에 응답 가능한 모든 옵션을 반환
 * returns: [{ label, cardId, handIdx, activate }]
 *
 * [수정] 체인이 활성 중이면 레지스트리 condition을 실행.
 * condition은 "상대 링크 존재" 같은 추가 조건만 담당.
 * "체인이 활성 중인가"는 여기서 일괄 체크하므로 condition에서 중복 체크 불필요.
 */
/**
 * collectChainOptions(aiCtx?)
 *
 * aiCtx가 없으면 플레이어 컨텍스트로 동작.
 * aiCtx가 있으면 전역 변수(G.myHand, G.myField 등)를 AI 데이터로 임시 교체 후
 * 동일한 레지스트리(CHAIN_HAND_RESPONSES, CHAIN_FIELD_RESPONSES)를 실행.
 * 이 방식 덕분에 카드를 아무리 추가해도 별도 AI 전용 코드가 필요 없음.
 *
 * aiCtx = {
 *   hand: G.opHand,   field: G.opField,
 *   grave: G.opGrave, exile: G.opExile,
 *   keyDeck: G.opKeyDeck,
 *   role: 'guest',
 *   usedFx: window.AI.usedFx,  // AI usedFx
 * }
 */
function collectChainOptions(aiCtx) {
  const options = [];
  if (!activeChainState || !activeChainState.active) return options;

  // ── AI 컨텍스트 스왑 ──
  // condition/activate 내부가 참조하는 전역 변수를 AI 데이터로 임시 교체.
  // 실행 후 반드시 복원.
  let _swap = null;
  if (aiCtx) {
    _swap = {
      hand:  G.myHand,  field:  G.myField,
      grave: G.myGrave, exile:  G.myExile,
      keyDeck: G.myKeyDeck,
      opHand:  G.opHand, opField: G.opField,
      opGrave: G.opGrave, opExile: G.opExile,
      isMyTurn_val: isMyTurn,
      myRole_val: myRole,
    };
    // AI 패/필드 → "내" 것처럼 교체
    G.myHand  = aiCtx.hand;
    G.myField = aiCtx.field;
    G.myGrave = aiCtx.grave;
    G.myExile = aiCtx.exile;
    G.myKeyDeck = aiCtx.keyDeck || [];
    // 플레이어 패/필드 → "상대" 것처럼 교체
    G.opHand  = _swap.hand;
    G.opField = _swap.field;
    G.opGrave = _swap.grave;
    G.opExile = _swap.exile;
    isMyTurn  = aiCtx.isMyTurn || false;
    // ★ 핵심: myRole을 'guest'로 교체해야 _chainHasOpponentLink() 등이 올바르게 동작
    // condition 내부의 l.by !== myRole 에서 myRole='guest'여야
    // 플레이어(host) 링크를 "상대 링크"로 인식함
    myRole = 'guest';
  }

  const _restore = () => {
    if (!_swap) return;
    G.myHand  = _swap.hand;  G.myField = _swap.field;
    G.myGrave = _swap.grave; G.myExile = _swap.exile;
    G.myKeyDeck = _swap.keyDeck;
    G.opHand  = _swap.opHand; G.opField = _swap.opField;
    G.opGrave = _swap.opGrave; G.opExile = _swap.opExile;
    isMyTurn  = _swap.isMyTurn_val;
    myRole    = _swap.myRole_val;
    _swap = null;
  };

  try {
    // 1) 키카드 가져오기 (플레이어 전용 — AI는 키카드 별도 처리)
    if (!aiCtx && !usedKeyFetchInChain[myRole]) {
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

    // 2) 패의 카드 — 레지스트리 기반 (플레이어/AI 공용)
    const hand = aiCtx ? aiCtx.hand : G.myHand;
    hand.forEach((handCard, handIdx) => {
      const entries = window.CHAIN_HAND_RESPONSES[handCard.id];
      if (!entries) return;
      entries.forEach(entry => {
        // 사용 횟수 체크 — AI는 usedFx, 플레이어는 effectUsed
        if (aiCtx) {
          const key = handCard.id + '_' + entry.effectNum;
          if (aiCtx.usedFx && aiCtx.usedFx[key]) return;
        } else {
          if (!canUseEffect(handCard.id, entry.effectNum)) return;
        }
        // condition 실행 (전역 변수가 이미 교체된 상태)
        if (entry.condition && !entry.condition(handIdx)) return;

        // activate 클로저: aiCtx가 있으면 실행 시점에도 스왑을 다시 적용
        // (condition은 수집 시점, activate는 나중에 실행되므로 별도 처리 필요)
        const _makeActivate = (capturedCtx, capturedEntry, capturedIdx) => {
          if (!capturedCtx) return () => capturedEntry.activate(capturedIdx);
          return () => {
            // 실행 시점에 전역 변수 스왑 + addChainLink를 AI용으로 래핑
            const s2 = {
              hand: G.myHand, field: G.myField,
              grave: G.myGrave, exile: G.myExile,
              keyDeck: G.myKeyDeck,
              opHand: G.opHand, opField: G.opField,
              opGrave: G.opGrave, opExile: G.opExile,
              isMyTurn_val: isMyTurn,
              myRole_val: myRole,
              addChainLink: window.addChainLink,
              markEffectUsed: window.markEffectUsed,
            };
            // AI 데이터 → "내" 것처럼
            G.myHand = capturedCtx.hand; G.myField = capturedCtx.field;
            G.myGrave = capturedCtx.grave; G.myExile = capturedCtx.exile;
            G.myKeyDeck = capturedCtx.keyDeck || [];
            // 플레이어 데이터 → "상대" 것처럼
            G.opHand = s2.hand; G.opField = s2.field;
            G.opGrave = s2.grave; G.opExile = s2.exile;
            isMyTurn = capturedCtx.isMyTurn || false;
            myRole = 'guest'; // ★ condition/_chainHasOpponentLink가 올바로 동작하도록
            // addChainLink → AI용 (by:'guest')
            window.addChainLink = function(effect, opts) {
              if (!activeChainState || !activeChainState.active) return;
              const aiEffect = Object.assign({}, effect, { by: 'guest' });
              const next = Object.assign({}, activeChainState);
              next.links = (next.links || []).concat([aiEffect]);
              next.passCount = 0;
              next.priority = 'host'; // 플레이어에게 우선권 (myRole이 교체됐을 수 있으므로 하드코딩)
              activeChainState = next;
              log('🤖 ' + (effect.label || effect.type) + ' 체인 발동!', 'opponent');
            };
            // markEffectUsed → AI usedFx로
            if (capturedCtx.usedFx) {
              window.markEffectUsed = function(id, n) {
                capturedCtx.usedFx[id + '_' + n] = 1;
              };
            }
            try {
              capturedEntry.activate(capturedIdx);
            } finally {
              G.myHand = s2.hand; G.myField = s2.field;
              G.myGrave = s2.grave; G.myExile = s2.exile;
              G.myKeyDeck = s2.keyDeck;
              G.opHand = s2.opHand; G.opField = s2.opField;
              G.opGrave = s2.opGrave; G.opExile = s2.opExile;
              isMyTurn = s2.isMyTurn_val;
              myRole = s2.myRole_val || 'host';
              window.addChainLink = s2.addChainLink;
              window.markEffectUsed = s2.markEffectUsed;
            }
          };
        };

        options.push({
          label:   `[패] ${handCard.name} ${entry.label}`,
          cardId:  handCard.id,
          handIdx,
          activate: _makeActivate(aiCtx, entry, handIdx),
        });
      });
    });

    // 3) 필드의 카드 — CHAIN_FIELD_RESPONSES (플레이어/AI 공용)
    const field = aiCtx ? aiCtx.field : G.myField;
    field.forEach((fieldCard, fieldIdx) => {
      const entries = window.CHAIN_FIELD_RESPONSES && window.CHAIN_FIELD_RESPONSES[fieldCard.id];
      if (!entries) return;
      entries.forEach(entry => {
        if (aiCtx) {
          const key = fieldCard.id + '_' + entry.effectNum;
          if (aiCtx.usedFx && aiCtx.usedFx[key]) return;
        } else {
          if (!canUseEffect(fieldCard.id, entry.effectNum)) return;
        }
        if (entry.condition && !entry.condition(fieldIdx)) return;
        options.push({
          label:   `[필드] ${fieldCard.name} ${entry.label}`,
          cardId:  fieldCard.id,
          handIdx: -3,
          fieldIdx,
          activate: _makeActivate ? _makeActivate(aiCtx, entry, fieldIdx) : () => entry.activate(fieldIdx),
        });
      });
    });

  } finally {
    _restore();
  }

  return options;
}

// ─────────────────────────────────────────────────────────────
// 필드 카드 체인 응답 레지스트리
// "패로 가져올 수 없는" 카드들의 필드 발동 효과 등록
// registerChainFieldResponse(cardId, entries)
// entries: [{ effectNum, label, condition(fieldIdx), activate(fieldIdx) }, ...]
// ─────────────────────────────────────────────────────────────
window.CHAIN_FIELD_RESPONSES = window.CHAIN_FIELD_RESPONSES || {};

function registerChainFieldResponse(cardId, entries) {
  window.CHAIN_FIELD_RESPONSES[cardId] = entries;
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
  next.priority = getOpponentRole(myRole);
  log('체인 패스', 'system');

  if (next.passCount >= 2) {
    resolveChain(next);
    return;
  }

  if (!roomRef) {
    if (!window.AI || !window.AI.active) {
      // 비AI 로컬 모드: 상대도 즉시 패스 → resolve
      next.passCount = 2;
      resolveChain(next);
      return;
    }
    // AI 모드: 상태를 guest 우선권으로 업데이트하고 렌더.
    // ai.js의 passChainPriority 훅 래퍼가 이어서 _onChainUpdated()를 호출한다.
    activeChainState = next;
    renderChainActions();
    return;
  }

  activeChainState = next;
  roomRef.child('chainState').set(next);
  syncClockRunState(next.priority);
}

function addChainLink(effect, options = {}) {
  const force = !!options.force;
  if (!activeChainState || !activeChainState.active) return;
  if (!force && activeChainState.priority !== myRole) {
    notify('현재 체인 우선권은 상대에게 있습니다.');
    return;
  }
  if (effect.type === 'keyFetch' && usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }
  const next = { ...activeChainState };
  next.links = [...(next.links || []), { ...effect, by: myRole }];
  // 링크를 추가한 직후에는 상대에게 우선권
  next.priority = getOpponentRole(myRole);
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

  beginChain(queued[0]);
  queued.slice(1).forEach(e => addChainLink(e, { force: true }));
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
  // AI 효과 리졸버
  aiForceDiscard:            (link) => forceDiscard(Math.max(1, Number(link.count) || 1)),
  aiEyeForEye:               ()     => { _aiDrawN(2); log('🤖 눈에는 눈: 드로우 2장', 'opponent'); renderAll(); },
  aiSummonDeck:              (link) => { if (link.cardId) { _aiSummonFromDeck(link.cardId); renderAll(); } },
  aiSearch:                  (link) => { if (link.cardId) { _aiSearch(link.cardId); renderAll(); } },
  aiFieldCard:               (link) => {
    if (!link.cardId) return;
    var card = CARDS[link.cardId] || { name: link.cardId };
    G.opFieldCard = { id: link.cardId, name: card.name };
    handleOpponentAction({ type:'fieldCard', cardId: link.cardId, by:'guest', ts: Date.now() });
    log('🤖 ' + card.name + ' 발동', 'opponent');
    renderAll();
  },
  aiGraveOpField:            (link) => { _aiGraveFromPlayerField(Number(link.count) || 1); sendGameState(); renderAll(); },
  aiGraveAllOpField:         ()     => { _aiGraveFromPlayerField(G.myField.length); sendGameState(); renderAll(); },
  aiExileOpField:            (link) => { _aiExileFromPlayerField(Number(link.count) || 1); sendGameState(); renderAll(); },
  aiExileAllOpField:         ()     => { _aiExileFromPlayerField(G.myField.length); sendGameState(); renderAll(); },
  aiReturnOpHand:            (link) => { _aiReturnToPlayerHand(Number(link.count) || 1); sendGameState(); renderAll(); },
  aiPenguinHero1:            (link) => { if (link.searchId) _aiSearch(link.searchId); if (link.summonId) _aiSummonFromDeck(link.summonId); sendGameState(); renderAll(); },
  aiPenguinLegend1:          (link) => {
    (link.targets || []).forEach(id => {
      var gi = G.opGrave.findIndex(c => c.id === id);
      if (gi >= 0 && G.opField.length < maxFieldSlots()) {
        var c = G.opGrave.splice(gi, 1)[0];
        var cd = CARDS[c.id] || {};
        G.opField.push({ id: c.id, name: cd.name || c.id, atk: cd.atk || 0, atkBase: cd.atk || 0 });
        log('🤖 묘지 부활: ' + (cd.name || c.id), 'opponent');
      }
    });
    sendGameState(); renderAll();
  },
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
  // 체인 무효
  genericNegate:             ()     => { log('효과 무효!', 'system'); sendGameState(); renderAll(); },
  // 아자토스 ③: 필드 효과 무효 + 서로 필드 제외
  azatothEffect3: (link) => {
    const maxExile = Number(link.maxExile) || 0;
    if (maxExile <= 0) { sendGameState(); renderAll(); return; }
    // 서로 필드에서 같은 수만큼 제외
    const myTargets  = G.myField.slice();
    const opTargets  = G.opField.slice();
    if (!myTargets.length && !opTargets.length) { sendGameState(); renderAll(); return; }
    openCardPicker(myTargets, `아자토스 ③: 내 필드에서 ${maxExile}장까지 제외`, maxExile, (sel1) => {
      sel1.sort((a,b)=>b-a).forEach(i => {
        const c = G.myField.splice(i, 1)[0];
        if (c) G.myExile.push(c);
      });
      const exileCount = sel1.length;
      if (!exileCount || !opTargets.length) { sendGameState(); renderAll(); return; }
      const opExileCount = Math.min(exileCount, opTargets.length);
      openCardPicker([...G.opField], `아자토스 ③: 상대 필드에서 ${opExileCount}장 제외`, opExileCount, (sel2) => {
        sel2.sort((a,b)=>b-a).forEach(i => {
          const c = G.opField.splice(i, 1)[0];
          if (c) { G.opExile.push(c); sendAction({ type: 'opFieldRemove', cardId: c.id, to: 'exile' }); }
        });
        log(`아자토스 ③: 서로 필드 ${exileCount}장씩 제외!`, 'mine');
        sendGameState(); renderAll();
      });
    });
  },
};

// 체인 링크를 역순으로 실행
function executeChainLocally(links) {
  const negatedIndices = new Set();

  links.forEach((link, i) => {
    if (link.type === 'quickPenguinStrike1' || link.type === 'genericNegate') {
      if (i + 1 < links.length) negatedIndices.add(i + 1);
    }
  });

  links.forEach((link, i) => {
    if (negatedIndices.has(i)) {
      log(`무효: ${link.label || link.type}`, 'system');
      return;
    }

    if (link.by === myRole) {
      const resolver = CHAIN_RESOLVERS[link.type];
      if (resolver) resolver(link);
      else console.warn('[Chain] 알 수 없는 링크 타입:', link.type);
    } else {
      // 상대(AI) 링크 — CHAIN_RESOLVERS로 통일 실행
      if (window.AI && window.AI.active) {
        const resolver = CHAIN_RESOLVERS[link.type];
        if (resolver) resolver(link);
        else _executeAIChainLink(link); // 폴백
      }
    }
  });

  sendGameState();
  renderAll();
  usedKeyFetchInChain = {};
}

// AI 체인 링크 실행 폴백 (CHAIN_RESOLVERS에 없는 레거시 타입용)
function _executeAIChainLink(link) {
  switch (link.type) {
    case 'aiEyeForEye':
      if (typeof _aiDrawN === 'function') _aiDrawN(2);
      log('🤖 눈에는 눈: 드로우 2장', 'opponent');
      break;
    default:
      console.warn('[AI Chain] 알 수 없는 타입:', link.type);
      break;
  }
}


// ─────────────────────────────────────────────────────────────
// 펭귄 마을 ② 지속효과
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
        callback(true);
      }, true);
    }
  );
}

function manualDiscard(handIdx) {
  if (handIdx < 0 || !G.myHand[handIdx]) return;
  const c = G.myHand[handIdx];
  selectedCardIdx = -1;

  _checkVillageOnDiscard(c.id, (replaced) => {
    if (replaced) return;
    G.myHand.splice(handIdx, 1);
    G.myGrave.push({ id: c.id, name: c.name });
    log(`패를 버림: ${c.name}`, 'mine');
    sendAction({ type: 'discard', cardId: c.id });
    onJibaeryongDiscarded(c.id);
    onHandDiscarded_jibaeSasl();
    sendGameState(); renderAll(); checkWinCondition();
  });
}

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

  if (cardId === '펭귄 용사') {
    if (G.opField.length === 0) {
      notify('펭귄 용사: 상대 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
      return;
    }
  }
  if (cardId === '펭귄의 전설') {
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

  // 출입통제: 체인이 활성 중이고 상대 링크가 있을 때 무효
  registerChainHandResponse('출입통제', [
    {
      effectNum: 1,
      label: '① 상대 효과 무효',
      // [수정] 체인 활성은 collectChainOptions()가 보장.
      // 여기선 "상대 링크가 있어야" 조건만 체크.
      condition: () => _chainHasOpponentLink(),
      activate: (handIdx) => {
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        log('출입통제 발동!', 'mine');
        sendAction({ type: 'negate', reason: '출입통제' });
        addChainLink({ type: 'genericNegate', label: '출입통제' });
        sendGameState(); renderAll();
      },
    },
  ]);

  // 눈에는 눈: 상대가 서치계 효과를 체인에 넣었을 때 응답
  if (!window.CHAIN_HAND_RESPONSES?.['눈에는 눈']) {
    registerChainHandResponse('눈에는 눈', [
      {
        effectNum: 1,
        label: '① 버리고 드로우 2장',
        // [수정] 상대 서치 링크가 체인에 있어야 함
        condition: () => _chainHasOpponentSearchLink(),
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
