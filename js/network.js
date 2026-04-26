// network.js — Firebase 연결, 방 생성/참가, 게임 상태 동기화
// FIREBASE GAME STATE SYNC
// ─────────────────────────────────────────────
function sendGameState() {
  if (!roomRef) return;
  const myState = {
    // 패: id, name, isPublic 모두 저장
    hand: G.myHand.map(c => ({ id: c.id, name: c.name, isPublic: c.isPublic || false })),
    field: G.myField,
    grave: G.myGrave,
    exile: G.myExile,
    fieldCard: G.myFieldCard,
    keyDeck: G.myKeyDeck.map(c => ({ id: c.id, name: c.name })),
    deckCount: G.myDeck ? G.myDeck.length : 0,
    deckList: window._confirmedDeck || null, // 재접속 시 덱 복원용
    ts: Date.now(),
  };
  const path = myRole === 'host' ? 'hostState' : 'guestState';
  roomRef.child(path).set(myState);
}

function listenOpponentState() {
  if (!roomRef) return;
  const opPath = myRole === 'host' ? 'guestState' : 'hostState';
  roomRef.child(opPath).on('value', snap => {
    const data = snap.val();
    if (!data) return;
    // 상대 패: 공개/비공개 상태 정확히 반영
    G.opHand = (data.hand || []).map(c => ({
      id: c.isPublic ? c.id : 'unknown',  // 비공개 카드는 id도 숨김
      name: c.isPublic ? c.name : '?',
      isPublic: c.isPublic || false,
    }));
    G.opField = (data.field || []);
    G.opGrave = (data.grave || []);
    G.opExile = (data.exile || []);
    G.opFieldCard = data.fieldCard || null;
    G.opKeyDeck = (data.keyDeck || []).map(c => ({ id: 'unknown', name: '키카드' }));
    G.opDeckCount = data.deckCount || 0;
    renderAll();
  });
}

// 재접속 시 내 상태 복원
function restoreMyState() {
  if (!roomRef) return;
  const myPath = myRole === 'host' ? 'hostState' : 'guestState';
  roomRef.child(myPath).once('value').then(snap => {
    const data = snap.val();
    if (!data || !data.ts) return; // 저장된 상태 없으면 스킵
    // 패 복원 (공개 상태 포함)
    if (data.hand && data.hand.length > 0) {
      G.myHand = data.hand.map(c => ({ id: c.id, name: c.name, isPublic: c.isPublic || false }));
    }
    if (data.field) G.myField = data.field;
    if (data.grave) G.myGrave = data.grave;
    if (data.exile) G.myExile = data.exile;
    if (data.fieldCard) G.myFieldCard = data.fieldCard;
    if (data.keyDeck) G.myKeyDeck = data.keyDeck;
    log('이전 상태 복원 완료', 'system');
    notify('재접속: 이전 게임 상태를 복원했습니다.');
    renderAll();
  });
}

function listenChainState() {
  if (!roomRef) return;
  roomRef.child('chainState').on('value', snap => {
    const wasActive = !!(activeChainState && activeChainState.active);
    const data = snap.val();

    // 체인이 끝났으면 null로 명시 초기화
    if (!data || !data.active) {
      if (activeChainState && activeChainState.active) {
        activeChainState = null;
      } else {
        activeChainState = data; // resolved 데이터 유지 (resolvedLinks 참조용)
      }
    } else {
      activeChainState = data;
    }

    renderChainActions();

    if (!data) return;
    if (wasActive && !data.active && pendingTriggerEffects.length > 0) {
      setTimeout(flushTriggeredEffects, 0);
    }
    if (!data.active && data.resolvedLinks && data.resolvedAt && data.resolvedAt !== lastResolvedChainAt) {
      lastResolvedChainAt = data.resolvedAt;
      activeChainState = null; // 처리 후 확실히 null
      executeChainLocally([...data.resolvedLinks].reverse());
      renderChainActions();
      return;
    }
    syncClockRunState(getPriorityOwner());
    if (!data.active) return;
    if (data.priority === myRole) {
      notify(`체인 우선권: ${data.links?.length || 0}체인. 응답 또는 패스를 선택하세요.`);
    }
  });
}

function listenClockState() {
  if (!roomRef) return;
  roomRef.child('clock').on('value', snap => {
    const data = snap.val();
    if (!data) return;
    gameClock = {
      host: typeof data.host === 'number' ? data.host : 500,
      guest: typeof data.guest === 'number' ? data.guest : 500,
      runningFor: data.runningFor || null,
      lastUpdated: data.lastUpdated || Date.now(),
    };
    renderClock();
  });
}

// ─────────────────────────────────────────────
// FIREBASE / MULTIPLAYER
// ─────────────────────────────────────────────
let firebaseLoaded = false;
let isJoiningRoom = false;

function loadFirebase(callback) {
  if (firebaseLoaded) { callback(); return; }

  // 순서대로 로드할 모든 Firebase SDK
  const scripts = [
    'https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.1/firebase-database-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore-compat.js',
  ];

  const loadScriptInOrder = (idx) => {
    if (idx >= scripts.length) {
      firebaseLoaded = true;
      initAuth();   // Auth 초기화 (중복 방지는 initAuth 내부에서 처리)
      callback();
      return;
    }
    const src = scripts[idx];
    // 이미 로드된 스크립트는 건너뜀
    if (document.querySelector(`script[src="${src}"]`)) {
      loadScriptInOrder(idx + 1);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => loadScriptInOrder(idx + 1);
    s.onerror = () => notify('Firebase SDK 로드 실패. 네트워크 상태를 확인하세요.');
    document.head.appendChild(s);
  };

  loadScriptInOrder(0);
}

function initFirebase() {
  if (!window.firebase || typeof firebase.database !== 'function') {
    throw new Error('Firebase Database SDK가 초기화되지 않았습니다.');
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  db = firebase.database();
}

function createRoom() {
  const createBtn = document.getElementById('createRoomBtn');
  if (createBtn && createBtn.disabled) return;
  if (createBtn) createBtn.disabled = true;

  myName = document.getElementById('playerName').value.trim() || '플레이어1';
  const statusEl = document.getElementById('createStatus');
  statusEl.textContent = 'Firebase 연결 중...';
  statusEl.classList.remove('hidden');

  function _resetCreateState(msg) {
    if (createBtn) createBtn.disabled = false;
    if (msg) statusEl.textContent = msg;
  }

  if (DEMO_MODE) {
    roomCode = generateCode();
    myRole = 'host';
    document.getElementById('roomCodeText').textContent = roomCode;
    document.getElementById('roomCodeBlock').classList.remove('hidden');
    document.getElementById('startGameBtn').classList.remove('hidden');
    statusEl.textContent = 'DEMO 모드: 같은 화면에서 테스트';
    return;
  }

  const loadTimeout = setTimeout(() => {
    _resetCreateState('연결 시간 초과. 다시 시도해주세요.');
  }, 15000);

  loadFirebase(() => {
    clearTimeout(loadTimeout);
    try {
      initFirebase();
    } catch (e) {
      _resetCreateState('Firebase 오류: ' + e.message);
      return;
    }
    roomCode = generateCode();
    myRole = 'host';
    roomRef = db.ref(`rooms/${roomCode}`);
    roomRef.set({
      host: myName,
      guest: null,
      status: 'waiting',
      turn: 0,
      actions: null,
      chainState: { active: false, links: [], priority: null, passCount: 0 },
      clock: { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() },
    }).then(() => {
      document.getElementById('roomCodeText').textContent = roomCode;
      document.getElementById('roomCodeBlock').classList.remove('hidden');
      document.getElementById('startGameBtn').classList.remove('hidden');
      statusEl.textContent = '방 생성 완료! 상대를 기다리는 중...';
      document.getElementById('hdrRoomCode').textContent = roomCode;
      listenRoom();
    }).catch(e => { _resetCreateState('오류: ' + e.message); });
  });
}

function joinRoom() {
  if (isJoiningRoom) return;
  isJoiningRoom = true;

  // 버튼 비활성화 (중복 클릭 방지)
  const joinBtn = document.getElementById('joinRoomBtn');
  if (joinBtn) joinBtn.disabled = true;

  function _resetJoinState(msg) {
    isJoiningRoom = false;
    if (joinBtn) joinBtn.disabled = false;
    if (msg) { statusEl.textContent = msg; statusEl.classList.remove('hidden'); }
  }

  myName = document.getElementById('playerName').value.trim() || '플레이어2';
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  const statusEl = document.getElementById('joinStatus');

  if (code.length !== 4) {
    _resetJoinState('');
    alert('4자리 코드를 입력하세요.');
    return;
  }

  statusEl.textContent = '연결 중...';
  statusEl.classList.remove('hidden');

  if (DEMO_MODE) {
    roomCode = code;
    myRole = 'guest';
    statusEl.textContent = 'DEMO 모드로 참가';
    enterGame();
    _resetJoinState(null);
    return;
  }

  // Firebase 로드 타임아웃 (15초)
  const loadTimeout = setTimeout(() => {
    _resetJoinState('연결 시간 초과. 다시 시도해주세요.');
  }, 15000);

  loadFirebase(() => {
    clearTimeout(loadTimeout);
    try {
      initFirebase();
    } catch (e) {
      _resetJoinState('Firebase 오류: ' + e.message);
      return;
    }

    roomCode = code;
    myRole = 'guest';
    roomRef = db.ref(`rooms/${roomCode}`);

    // 방 존재 여부 먼저 확인
    roomRef.child('host').once('value').then(hostSnap => {
      if (!hostSnap.val()) {
        _resetJoinState('존재하지 않는 방 코드입니다.');
        roomRef = null;
        return;
      }
      return roomRef.child('guest').set(myName).then(() => {
        statusEl.textContent = '참가 완료! 호스트의 시작을 기다리는 중...';
        document.getElementById('hdrRoomCode').textContent = roomCode;
        listenRoom();
        return roomRef.child('status').once('value');
      }).then(statusSnap => {
        if (statusSnap && statusSnap.val() === 'playing' && document.getElementById('lobby').style.display !== 'none') {
          goToDeckBuilder();
        }
        _resetJoinState(null);
      });
    }).catch(e => {
      _resetJoinState('오류: ' + e.message);
    });
  });
}

function startGame() {
  if (!db && !DEMO_MODE) { alert('Firebase가 연결되지 않았습니다.'); return; }
  if (DEMO_MODE) { goToDeckBuilder(); return; }
  // Firebase에 playing 상태 업데이트만 — goToDeckBuilder는 listenRoom이 감지해서 호출
  roomRef.update({
    status: 'playing',
    activePlayer: 'host',
    clock: { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() },
  });
  // 호스트는 바로 덱 빌더로
  goToDeckBuilder();
}

let _deckBuilderOpened = false; // 덱 빌더 중복 진입 방지

let lastHandledActionTs = 0; // 중복 처리 방지
let gameActionListenerActive = false;

function listenRoom() {
  if (!roomRef) return;
  roomRef.on('value', snap => {
    const data = snap.val();
    if (!data) return;

    if (data.guest && myRole === 'host') {
      opName = data.guest;
      document.getElementById('hdrOpName').textContent = opName;
      document.getElementById('opNameLabel').textContent = opName;
      document.getElementById('startGameBtn').disabled = false;
    }

    if (data.status === 'playing' && myRole === 'guest' && !_deckBuilderOpened) {
      _deckBuilderOpened = true;
      goToDeckBuilder();
    }
  });
}

// 게임 전용 액션 리스너 — enterGame 이후에만 등록
function listenGameActions() {
  if (!roomRef || gameActionListenerActive) return;
  gameActionListenerActive = true;

  roomRef.child('lastAction').on('value', snap => {
    const action = snap.val();
    if (!action) return;
    if (action.by === myRole) return; // 내가 보낸 것
    if (action.ts <= lastHandledActionTs) return; // 이미 처리한 것
    lastHandledActionTs = action.ts;
    handleOpponentAction(action);
  });
}

function sendAction(action) {
  if (!roomRef) return;
  action.by = myRole;
  action.ts = Date.now();
  roomRef.update({ lastAction: action });
}

function handleOpponentAction(action) {
  switch (action.type) {
    case 'draw':
      log('상대 드로우', 'opponent');
      break;
    case 'search':
      // 상대가 서치 → 눈에는 눈 자동 체크
      log(`상대 서치: ${action.cardName || ''}`, 'opponent');
      { const eyeIdx = G.myHand.findIndex(c => c.id === '눈에는 눈');
        if (eyeIdx >= 0 && canUseEffect('눈에는 눈', 1)) {
          gameConfirm('눈에는 눈 발동? (드로우 2장)', (yes) => {
            if (!yes) return;
            markEffectUsed('눈에는 눈', 1);
            G.myHand.splice(eyeIdx, 1);
            G.myGrave.push({ id: '눈에는 눈', name: '눈에는 눈' });
            drawN(2);
            log('눈에는 눈: 드로우 2장!', 'mine');
            sendGameState(); renderAll();
          });
        }
      }
      break;
    case 'summon': {
      const sc = CARDS[action.cardId] || {};
      // Remove from opponent hand
      const publicIdx = G.opHand.findIndex(c => c.id === action.cardId);
      if (publicIdx >= 0) G.opHand.splice(publicIdx, 1);
      else if (G.opHand.length > 0) G.opHand.pop();
      G.opField.push({ id: action.cardId, name: sc.name || action.cardId, atk: sc.atk || 0 });
      log(`상대 소환: ${sc.name || action.cardId}`, 'opponent');
      // 유혹의 황금사과: 상대 소환 시 내가 드로우
      if (G.goldenAppleActive) {
        drawOne();
        log('유혹의 황금사과: 상대 소환으로 드로우!', 'mine');
        sendGameState();
      }
      renderAll();
      break;
    }
    case 'activate':
    case 'discard': {
      const ac = CARDS[action.cardId] || { name: action.cardId };
      const ahi = G.opHand.findIndex(c => c.id === action.cardId);
      if (ahi >= 0) G.opHand.splice(ahi, 1);
      else if (G.opHand.length > 0) G.opHand.pop();
      G.opGrave.push({ id: action.cardId, name: ac.name });
      log(`상대 ${action.type === 'discard' ? '버림' : '발동'}: ${ac.name}`, 'opponent');
      renderAll();
      break;
    }
    case 'fieldCard': {
      const fc = CARDS[action.cardId] || { name: action.cardId };
      const fhi = G.opHand.findIndex(c => c.id === action.cardId);
      if (fhi >= 0) G.opHand.splice(fhi, 1);
      else if (G.opHand.length > 0) G.opHand.pop();
      G.opFieldCard = { id: action.cardId, name: fc.name };
      log(`상대 필드 카드: ${fc.name}`, 'opponent');
      renderAll();
      break;
    }
    case 'combat':
      handleOpponentCombat(action);
      break;
    case 'directAttack':
      log(`상대 직접 공격! 패 ${action.card.atk}장 손실`, 'opponent');
      notify(`직접 공격 당함! 패 ${action.card.atk}장 버려야 합니다`);
      forceDiscard(action.card.atk, true); // 상대가 공격자 → 공개패 우선
      break;
    case 'forceDiscard':
      // 상대가 내 패를 버리게 함 (상대가 공격자일 때)
      if (action.attackerPicks) {
        log(`상대 효과로 패 ${action.count}장 버리기`, 'opponent');
        notify(`패 ${action.count}장을 버려야 합니다!`);
        forceDiscard(action.count, true);
      }
      break;
    case 'revealAllHand':
      // 상대가 내 패를 전부 공개
      G.myHand.forEach(c => { c.isPublic = true; });
      log('상대 효과로 내 패가 전부 공개됨!', 'opponent');
      notify('내 패가 전부 공개됐습니다!');
      renderAll();
      break;
    case 'returnToHand':
      // 내 필드 카드가 패로 돌아옴
      { const idx = G.myField.findIndex(c => c.id === action.cardId);
        if (idx >= 0) { const mon = G.myField.splice(idx,1)[0]; G.myHand.push({id:mon.id,name:mon.name,isPublic:true}); renderAll(); } }
      break;
    case 'opFieldRemove':
      // 내 필드 카드가 제거됨 (묘지 또는 제외)
      {
        const idx = G.myField.findIndex(c => c.id === action.cardId);
        if (idx >= 0) {
          // 펭귄의 전설 ③: 대상 지정 효과 무효
          if (typeof checkPenguinLegendImmunity === 'function' &&
              checkPenguinLegendImmunity(action.cardId, true)) {
            // 전설 내성 — 효과 무효, 카드 유지
            renderAll();
            break;
          }
          const mon = G.myField.splice(idx, 1)[0];
          if (action.to === 'grave') G.myGrave.push(mon);
          else G.myExile.push(mon);
          renderAll();
        }
      }
      break;
    case 'opFieldExile':
      // 내 필드 카드가 제외됨 (펭귄 마법사 ② 등)
      {
        const idx = G.myField.findIndex(c => c.id === action.cardId);
        if (idx >= 0) {
          // 펭귄의 전설 ③: 대상 지정 효과 무효
          if (typeof checkPenguinLegendImmunity === 'function' &&
              checkPenguinLegendImmunity(action.cardId, true)) {
            renderAll();
            break;
          }
          const mon = G.myField.splice(idx, 1)[0];
          G.myExile.push(mon);
          log(`상대 효과로 ${mon.name} 제외됨`, 'opponent');
          renderAll();
        }
      }
      break;
    case 'negate':
      log(`상대 효과 무효: ${action.reason || ''}`, 'opponent');
      notify(`내 효과가 무효됐습니다! (${action.reason || ''})`);
      break;
    case 'endTurn':
      isMyTurn = true;
      attackedMonstersThisTurn.clear();
      advancePhase('draw');
      log(`상대 턴 종료 — 내 턴 (드로우 단계)`, 'system');
      notify('내 턴! 드로우 버튼을 눌러 드로우하세요.');
      renderPhase();
      break;
    case 'phaseEnd':
      // Opponent ended a phase
      break;
    case 'gameOver': {
      const win = (action.winner === myRole);
      showGameOver(win);
      if (action.reason === 'timeout') {
        log('시간 제한 500초 초과로 게임 종료', 'system');
      }
      break;
    }
    default:
      // 펭귄 관련 상대 액션
      if (typeof handlePenguinOpAction === 'function') handlePenguinOpAction(action);
  }
}

function handleOpponentCombat(action) {
  // action.atkCard attacks action.defCard
  const atkCard = action.atkCard; // opponent's monster
  const defCard = action.defCard; // my monster
  const diff = atkCard.atk - defCard.atk;

  log(`상대 전투: ${atkCard.name}(${atkCard.atk}) vs ${defCard.name}(${defCard.atk})`, 'opponent');

  if (diff > 0) {
    // Opponent wins — my monster goes to grave, I lose diff cards
    const myIdx = G.myField.findIndex(c => c.id === defCard.id);
    if (myIdx >= 0) { G.myGrave.push(G.myField.splice(myIdx, 1)[0]); }
    // 상대 공격 피해: 공개패는 상대가 고르고, 일반패는 무작위
    forceDiscard(diff, true);
    log(`내 ${defCard.name} 묘지. 패 ${diff}장 잃음`, 'opponent');
  } else if (diff < 0) {
    // I win — opponent's monster goes to grave
    const opIdx = G.opField.findIndex(c => c.id === atkCard.id);
    if (opIdx >= 0) { G.opGrave.push(G.opField.splice(opIdx, 1)[0]); }
    log(`상대 ${atkCard.name} 묘지`, 'mine');
  } else {
    if (atkCard.atk !== 0) {
      const myIdx = G.myField.findIndex(c => c.id === defCard.id);
      const opIdx = G.opField.findIndex(c => c.id === atkCard.id);
      if (myIdx >= 0) G.myGrave.push(G.myField.splice(myIdx, 1)[0]);
      if (opIdx >= 0) G.opGrave.push(G.opField.splice(opIdx, 1)[0]);
    }
  }
  renderAll();
}

// ─────────────────────────────────────────────