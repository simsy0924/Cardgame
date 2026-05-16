// effects-theme.js — 테마 카드 공용 처리 및 activateCard 정의

// ─────────────────────────────────────────────
// 게임 입장 / 초기화
// ─────────────────────────────────────────────
function enterGame() {
  opName = myRole === 'host' ? '게스트' : '호스트';
  myName = document.getElementById('playerName').value.trim() || (myRole === 'host' ? '호스트' : '게스트');

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'flex';

  document.getElementById('hdrMyName').textContent = myName;
  document.getElementById('hdrOpName').textContent = opName;
  document.getElementById('hdrRoomCode').textContent = roomCode;
  document.getElementById('myNameLabel').textContent = myName;
  document.getElementById('opNameLabel').textContent = opName;

  timeoutHandled = false;
  _gameOverDeclared = false;
  _gameOverShown = false;
  lastSyncedClockRunner = null;
  lastHandledActionTs = 0;
  lastLogTs = 0;
  gameActionListenerActive = false;
  gameClock = { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() };
  G.myExtraSlots = 0;
  G.opExtraSlots = 0;
  G.penguinHeroAtkBuff = false;
  attackedMonstersThisTurn.clear();

  listenOpponentState();
  listenChainState();
  listenClockState();
  listenGameActions();
  if (window.HB_NETWORK_SYNC && typeof window.HB_NETWORK_SYNC.listenStateDiffs === "function") {
    window.HB_NETWORK_SYNC.listenStateDiffs();
  }
  listenOpponentLog();
  startClockTicker();

  if (!roomRef) {
    // DEMO 모드: 항상 새 게임
    _startNewGame();
    return;
  }

  // Firebase에 내 상태가 있는지 먼저 확인
  const myPath = myRole === 'host' ? 'hostState' : 'guestState';
  roomRef.child(myPath).once('value').then(snap => {
    const data = snap.val();
    if (data && data.ts && data.hand && data.hand.length > 0) {
      // ★ 재접속: Firebase 상태 복원 (새 패 뽑지 않음, initDecks 호출 안 함)
      G.myHand = data.hand.map(c => ({ id: c.id, name: c.name, isPublic: c.isPublic || false }));
      G.myField = data.field || [];
      G.myGrave = data.grave || [];
      G.myExile = data.exile || [];
      G.myFieldCard = data.fieldCard || null;
      G.myKeyDeck = (data.keyDeck || []).map(c => ({ id: c.id, name: c.name }));

      // 덱은 저장된 deckList로 재구성 (없으면 기본 펭귄 덱)
      const deckList = data.deckList || window._confirmedDeck || null;
      if (deckList) {
        G.myDeck = shuffle(deckList.map(id => ({ id, name: CARDS[id]?.name || id })));
      } else {
        G.myDeck = []; // 덱 소진 시 묘지로 복구됨
      }
      G.myDeckCount = G.myDeck.length;

      // 페이즈/턴 복원
      roomRef.child('roomPhase').once('value').then(phSnap => {
        const ph = phSnap.val();
        if (ph) {
          isMyTurn = (ph.activePlayer === myRole);
          advancePhase(ph.phase || 'deploy');
        } else {
          isMyTurn = (myRole === 'host');
          advancePhase('deploy');
        }
        log('재접속: 이전 게임 상태 복원!', 'system');
        notify('재접속: 이전 상태를 복원했습니다.');
        renderAll();
      });
    } else {
      // ★ 새 게임
      _startNewGame();
    }
  });
}

function _startNewGame() {
  initDecks();
  const startCards = (myRole === 'host') ? 6 : 7;
  drawCards(startCards);
  isMyTurn = (myRole === 'host');
  // [BUG-5 FIX] 게임 시작 시 선공 1턴 공격 건너뜀 플래그 초기화
  G._hostFirstTurnDone = false;

  if (myRole === 'host') {
    advancePhase('deploy');
    log('선공 첫 턴: 드로우 없이 전개 단계 시작', 'system');
    if (roomRef) {
      roomRef.child('clock').set({
        host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now()
      });
      // 페이즈 상태 저장
      roomRef.child('roomPhase').set({ activePlayer: 'host', phase: 'deploy' });
    }
  } else {
    advancePhase('draw');
    if (roomRef) {
      roomRef.child('roomPhase').set({ activePlayer: 'host', phase: 'draw' });
    }
  }

  sendGameState();
  log('게임 시작!', 'system');
  renderAll();
}

function initDecks() {
  // 덱빌더에서 확정한 덱 우선, 없으면 펭귄 기본덱으로 폴백
  const penguinDeck = [
    '펭귄 마을','펭귄 마을','펭귄 마을','펭귄 마을',
    '꼬마 펭귄','꼬마 펭귄','꼬마 펭귄','꼬마 펭귄',
    '펭귄 부부','펭귄 부부','펭귄 부부','펭귄 부부',
    '현자 펭귄','현자 펭귄','현자 펭귄','현자 펭귄',
    '수문장 펭귄','수문장 펭귄','수문장 펭귄','수문장 펭귄',
    '펭귄!돌격!','펭귄!돌격!','펭귄!돌격!','펭귄!돌격!',
    '펭귄의 영광','펭귄의 영광','펭귄의 영광','펭귄의 영광',
    '펭귄이여 영원하라','펭귄이여 영원하라','펭귄이여 영원하라','펭귄이여 영원하라',
    '펭귄 마법사','펭귄 마법사','펭귄 마법사','펭귄 마법사',
    '구사일생','구사일생','눈에는 눈','눈에는 눈',
  ];
  const keyDeck = ['펭귄 용사', '펭귄의 일격', '펭귄의 전설', '일격필살', '단 한번의 기회'];

  const baseDeck = window._confirmedDeck || penguinDeck;
  const baseKeyDeck = window._confirmedKeyDeck || keyDeck;
  G.myDeck = shuffle(baseDeck.map(id => ({ id, name: CARDS[id]?.name || id })));
  G.myKeyDeck = baseKeyDeck.map(id => ({ id, name: CARDS[id]?.name || id }));
  G.myHand = [];
  G.myField = [];
  G.myGrave = [];
  G.myExile = [];
  G.myFieldCard = null;
  G.myDeckCount = G.myDeck.length;
  G.opHand = [];
  G.opField = [];
  G.opGrave = [];
  G.opExile = [];
  G.opFieldCard = null;
  G.opKeyDeck = Array.from({ length: baseKeyDeck.length }, () => ({ id: 'unknown', name: '?' }));
  G.opDeckCount = 40;
}

// ─────────────────────────────────────────────
// activateCard — 패 카드 발동 진입점
// 테마별로 전용 핸들러에 위임 후, 범용 switch로 처리
//
// [규칙] 발동하는 모든 효과는 반드시 beginChain/activateIgnitionEffect/
//        activateQuickEffect를 통해 체인 블록을 형성해야 한다.
//        코스트(패 버리기, 제외 등)는 체인 발동 직전에 처리한다.
// ─────────────────────────────────────────────
function activateCard(handIdx) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];

  // 15단계: EffectDefinition으로 이식된 카드는 레거시 switch/테마 핸들러를 타지 않는다.
  if (window.HB_LEGACY_BRIDGE && window.HB_LEGACY_BRIDGE.isNewEngineCard(c)) {
    const routed = window.HB_LEGACY_BRIDGE.routeCardActivation(c, {
      gameState: G,
      controller: 'me',
      player: 'me',
      card,
      handIndex: handIdx,
      handIdx,
      sourceZone: 'hand',
      zone: 'hand',
    });
    if (routed && routed.ok === false) notify(routed.error || '신엔진 효과를 발동할 수 없습니다.');
    return;
  }

  // ── 체인 중 우선권 체크 (기동효과는 체인 불가, 퀵효과는 허용) ──
  // 개별 케이스에서 처리하므로 여기선 통과

  // ── 공통 필드 카드 처리 ──
  // 필드 카드는 기동효과로 발동 → 체인 블록 형성
  // (수호의 빛은 추가 효과가 있어 별도 처리)
  if (card && card.cardType === 'field' && c.id !== '수호의 빛') {
    if (window.HB_FIELD_ZONE && typeof window.HB_FIELD_ZONE.activateFieldCardFromHand === 'function') {
      window.HB_FIELD_ZONE.activateFieldCardFromHand({
        gameState: G,
        controller: 'me',
        handIndex: handIdx,
        cardId: c.id,
        sync: false,
        render: false,
      });
      return;
    }

    // fallback: field-zone.js가 로드되지 않은 구버전 환경
    if (!isMyTurn || currentPhase !== 'deploy') {
      notify('필드 카드는 자신 전개 단계에만 발동할 수 있습니다.');
      return;
    }
    if (activeChainState && activeChainState.active) {
      notify('필드 카드(기동효과)는 체인에 추가할 수 없습니다.');
      return;
    }
    const prevField = G.myFieldCard ? { ...G.myFieldCard } : null;
    if (prevField) G.myGrave.push(prevField);
    G.myFieldCard = { id: c.id, name: c.name };
    G.myHand.splice(handIdx, 1);
    log(`필드 발동: ${c.name}`, 'mine');
    sendAction({ type: 'fieldCard', cardId: c.id });
    window.beginChain({ type: 'fieldActivate', label: `필드: ${c.name}`, cardId: c.id });
    return;
  }

  // ── 펭귄 테마 카드 ──
  if (card && card.theme === '펭귄') {
    if (typeof activatePenguinCard === 'function') activatePenguinCard(handIdx, 1);
    return;
  }

  // ── 동적 테마 핸들러 (엘리멘츠, 올드원, 라이온, 타이거, 라이거, 마피아, 불가사의 등) ──
  if (card && typeof activateRegisteredThemeCardEffect === 'function') {
    if (activateRegisteredThemeCardEffect(handIdx, 1)) return;
  }

  switch (c.id) {
    case '구사일생':
      notify('구사일생은 전투 시 자동으로 발동 여부를 물어봅니다.');
      return;

    case '눈에는 눈':
      notify('눈에는 눈은 상대 서치 계열 효과에 체인으로만 발동할 수 있습니다.');
      return;

    case '출입통제':
      notify('출입통제는 상대 효과에 체인으로만 발동할 수 있습니다.');
      return;

    case '영웅의 탄생':
      notify('영웅의 탄생은 상대의 서치/묘지이동/묘지·제외 활용 효과에 체인으로 발동할 수 있습니다.');
      return;

    // ── 특수 소환 몬스터들 (소환 자체는 체인 없음, 소환 후 유발효과는 enqueue) ──
    case '카드의 흑기사': {
      if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 소환할 수 있습니다.'); return; }
      if (activeChainState && activeChainState.active) { notify('체인 중에는 소환할 수 없습니다.'); return; }
      if (G.myField.length < 2) { notify('소환 불가: 필드 몬스터 2장 이상이 필요합니다.'); return; }
      const targets = [...G.myField];
      openCardPicker(targets, '카드의 흑기사 소환 코스트: 공격력 합계 10 이상이 되도록 몬스터 선택', Math.min(5, targets.length), (sel) => {
        if (!sel.length) return;
        const picked = sel.map(i => targets[i]);
        const sumAtk = picked.reduce((a,m) => a + ((m && m.atk) || 0), 0);
        if (picked.length < 2 || sumAtk < 10) { notify('소환 불가: 2장 이상, 공격력 합계 10 이상이 필요합니다.'); return; }
        for (const m of picked) { const idx = G.myField.findIndex(x => x === m || (x.id === m.id && x.atk === m.atk)); if (idx >= 0) G.myGrave.push(G.myField.splice(idx, 1)[0]); }
        G.myField.push({ id: c.id, name: c.name, atk: 5, summonedFrom: 'keyDeck' });
        G.myHand.splice(handIdx, 1);
        log('카드의 흑기사 소환!', 'mine');
        sendAction({ type: 'summon', cardId: c.id });
        sendGameState(); renderAll();
      });
      return;
    }

    case '풀려난 항아리의 마귀': {
      if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 소환할 수 있습니다.'); return; }
      if (activeChainState && activeChainState.active) { notify('체인 중에는 소환할 수 없습니다.'); return; }
      if (G.myField.length < 3) { notify('소환 불가: 필드 몬스터 3장이 필요합니다.'); return; }
      const targets = [...G.myField];
      openCardPicker(targets, '풀려난 항아리의 마귀 소환 코스트: 몬스터 3장 선택', 3, (sel) => {
        if (sel.length !== 3) return;
        sel.sort((a, b) => b - a).forEach(i => G.myGrave.push(G.myField.splice(i, 1)[0]));
        G.myField.push({ id: c.id, name: c.name, atk: 5, summonedFrom: 'keyDeck' });
        G.myHand.splice(handIdx, 1);
        log('풀려난 항아리의 마귀 소환!', 'mine');
        sendAction({ type: 'summon', cardId: c.id });
        sendGameState(); renderAll();
      });
      return;
    }

    case '카드 세계의 영웅': {
      if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 소환할 수 있습니다.'); return; }
      if (activeChainState && activeChainState.active) { notify('체인 중에는 소환할 수 없습니다.'); return; }
      const hasPot = G.myField.some(m => m.id === '풀려난 항아리의 마귀');
      if (!hasPot || G.myField.length < 2) { notify('소환 불가: 필드의 풀려난 항아리의 마귀 1장과 다른 몬스터 1장이 필요합니다.'); return; }
      const potIdx = G.myField.findIndex(m => m.id === '풀려난 항아리의 마귀');
      const otherIdx = G.myField.findIndex((m, i) => i !== potIdx);
      G.myGrave.push(G.myField.splice(Math.max(potIdx, otherIdx), 1)[0]);
      G.myGrave.push(G.myField.splice(Math.min(potIdx, otherIdx), 1)[0]);
      G.myField.push({ id: c.id, name: c.name, atk: 5, summonedFrom: 'keyDeck' });
      G.myHand.splice(handIdx, 1);
      const addHero = () => {
        const d = G.myDeck.findIndex(x => x.id === '영웅의 탄생'); if (d >= 0) { const z = G.myDeck.splice(d, 1)[0]; G.myHand.push({ id: z.id, name: z.name, isPublic: true }); return true; }
        const g = G.myGrave.findIndex(x => x.id === '영웅의 탄생'); if (g >= 0) { const z = G.myGrave.splice(g, 1)[0]; G.myHand.push({ id: z.id, name: z.name, isPublic: true }); return true; }
        const e = G.myExile.findIndex(x => x.id === '영웅의 탄생'); if (e >= 0) { const z = G.myExile.splice(e, 1)[0]; G.myHand.push({ id: z.id, name: z.name, isPublic: true }); return true; }
        return false;
      };
      if (addHero()) log('카드 세계의 영웅 ①: 영웅의 탄생을 패에 추가', 'mine');
      log('카드 세계의 영웅 소환!', 'mine');
      sendAction({ type: 'summon', cardId: c.id });
      sendGameState(); renderAll();
      return;
    }

    // ── 기동효과 카드들 (자신 전개 단계, 체인 1) ──
    case '단단한 카드 자물쇠': {
      if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
      if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
      if (G.opField.length === 0 && !G.opFieldCard) { notify('대상으로 할 카드가 없습니다.'); return; }
      const allTargets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
      openCardPicker(allTargets, '단단한 카드 자물쇠: 무효화할 상대 필드 카드 1장 선택', 1, (selected) => {
        if (!selected.length) return;
        const t = allTargets[selected[0]];
        // 코스트: 이 카드를 묘지로
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        log(`단단한 카드 자물쇠: ${t.name} 효과 무효화 발동`, 'mine');
        sendAction({ type: 'negateField', cardId: t.id });
        activateIgnitionEffect({ type: 'fieldNegate', label: `단단한 카드 자물쇠 → ${t.name}`, targetId: t.id });
      });
      return;
    }

    case '서치 봉인의 항아리':
      // ①: 퀵효과(자/상대 턴) — 덱으로 되돌리고 드로우
      // ②: 기동효과 — 버리고 이 턴 서치 봉인
      if (activeChainState && activeChainState.active) {
        // 체인 응답 중: ①만 가능 (퀵효과)
        if (activeChainState.priority !== myRole) { notify('현재 체인 우선권은 상대에게 있습니다.'); return; }
        G.myHand.splice(handIdx, 1);
        G.myDeck.push({ id: c.id, name: c.name });
        G.myDeck = shuffle(G.myDeck);
        log('서치 봉인의 항아리 ①: 덱으로 되돌리고', 'mine');
        addChainLink({ type: 'jarDraw1', label: '서치 봉인의 항아리 ①(드로우)' });
        sendGameState(); renderAll();
        return;
      }
      gameConfirm(
        '서치 봉인의 항아리\n확인 = ① 덱으로 되돌리고 1장 드로우 (퀵효과)\n취소 = ② 버려서 이 턴 서치 봉인 (기동효과)',
        (choice) => {
          if (choice) {
            // ① 퀵효과 — 체인 블록 형성
            G.myHand.splice(handIdx, 1);
            G.myDeck.push({ id: c.id, name: c.name });
            G.myDeck = shuffle(G.myDeck);
            log('서치 봉인의 항아리 ①: 덱으로 되돌리고 발동', 'mine');
            window.beginChain({ type: 'jarDraw1', label: '서치 봉인의 항아리 ①(드로우)' });
          } else {
            // ② 기동효과 — 체인 블록 형성
            if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
            G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
            log('서치 봉인의 항아리 ②: 이 턴 서치 봉인 발동', 'mine');
            sendAction({ type: 'searchBan', reason: '서치 봉인의 항아리' });
            activateIgnitionEffect({ type: 'jarSearchBan', label: '서치 봉인의 항아리 ②(서치 봉인)' });
          }
        }
      );
      return;

    case '유혹의 황금사과':
      // 기동효과
      if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
      if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      log('유혹의 황금사과 발동! 이 턴 상대 소환 시마다 1장 드로우', 'mine');
      activateIgnitionEffect({ type: 'goldenApple', label: '유혹의 황금사과' });
      return;

    case '수호의 빛':
      // 필드 카드이지만 추가 효과(제외 패 회수)가 있음 → 퀵효과로 처리
      if (activeChainState && activeChainState.active) {
        if (activeChainState.priority !== myRole) { notify('현재 체인 우선권은 상대에게 있습니다.'); return; }
      }
      if (G.myFieldCard) G.myGrave.push(G.myFieldCard);
      G.myFieldCard = { id: c.id, name: c.name };
      G.myHand.splice(handIdx, 1);
      log('수호의 빛 필드 발동!', 'mine');
      sendAction({ type: 'fieldCard', cardId: c.id });
      // 체인 블록 형성 후, 체인 해결 시 제외 패 회수 처리
      if (activeChainState && activeChainState.active) {
        addChainLink({ type: 'sacredLight', label: '수호의 빛', exileCount: G.myExile.length });
      } else {
        window.beginChain({ type: 'sacredLight', label: '수호의 빛', exileCount: G.myExile.length });
      }
      return;

    case '신성한 수호자': {
      // 기동효과
      if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
      if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
      // 코스트: 이 카드를 제외
      G.myExile.push(G.myHand.splice(handIdx, 1)[0]);
      log('신성한 수호자 ①: 이 턴 서로 카드 제외 불가 발동', 'mine');
      sendAction({ type: 'exileBan' });
      const lightIdx = G.myDeck.findIndex(dc => dc.id === '수호의 빛');
      const searchedLight = lightIdx >= 0;
      if (searchedLight) {
        G.myDeck.splice(lightIdx, 1);
        G.myHand.push({ id: '수호의 빛', name: '수호의 빛', isPublic: true });
        log('신성한 수호자 ②: 수호의 빛 서치!', 'mine');
      }
      activateIgnitionEffect({ type: 'holyGuardian', label: '신성한 수호자', searchedLight });
      return;
    }

    case '일격필살':
      // 기동효과 (자신 전개 단계)
      if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
      if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      log('일격필살 발동!', 'mine');
      activateIgnitionEffect({ type: 'oneHitKill', label: '일격필살' });
      return;

    case '단 한번의 기회':
      // 퀵효과 (자/상대 턴 전개·공격·엔드)
      if (currentPhase === 'draw') { notify('드로우 단계에는 발동할 수 없습니다.'); return; }
      if (activeChainState && activeChainState.active) {
        if (activeChainState.priority !== myRole) { notify('현재 체인 우선권은 상대에게 있습니다.'); return; }
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        log('단 한번의 기회 체인 발동!', 'mine');
        addChainLink({ type: 'onceDraw', label: '단 한번의 기회' });
        sendGameState(); renderAll();
        return;
      }
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      log('단 한번의 기회 발동!', 'mine');
      window.beginChain({ type: 'onceDraw', label: '단 한번의 기회' });
      return;

    default:
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      log(`발동: ${c.name}`, 'mine');
      notify(`${c.name} 발동! (효과를 수동으로 처리하세요)`);
      sendGameState(); renderAll();
  }
}


// ─────────────────────────────────────────────
// LOBBY → DECK BUILDER 연결
// ─────────────────────────────────────────────
// createRoom/joinRoom 후 덱 빌더로 이동하도록 startGame 수정
const _origStartGame = typeof startGame === 'function' ? startGame : null;

function goToDeckBuilder() {
  document.getElementById('lobby').style.display = 'none';
  // 혹시 남아있는 대기 오버레이 제거
  const existing = document.getElementById('waitingOverlay');
  if (existing) existing.remove();
  document.getElementById('deckBuilder').style.display = 'flex';
  filterDeckPool('전체');
  renderBuilderDeck();
  // 게스트에게 "게임 시작됨" 알림
  if (myRole === 'guest') notify('게임이 시작됐습니다! 덱을 구성해주세요.');
}

// ─────────────────────────────────────────────
// 화면 오류 표시 (디버깅용)
// ─────────────────────────────────────────────
window.onerror = function(msg, src, line, col, err) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#c84848;color:#fff;padding:8px;font-size:11px;z-index:9999;word-break:break-all;max-height:30vh;overflow-y:auto;';
  div.textContent = `오류 [${line}:${col}]: ${msg}`;
  document.body.appendChild(div);
  return false;
};

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.getElementById('playerName').focus();

if (DEMO_MODE) {
  document.getElementById('createStatus').textContent = 'DEMO 모드 활성화';
}