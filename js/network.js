// network.js — Firebase 연결, 방 생성/참가, 게임 상태 동기화
// FIREBASE GAME STATE SYNC
// ─────────────────────────────────────────────
let localStateRevision = 0;
let opponentStateRevision = 0;
let restoredStateSavedAt = 0;
let lastHandledActionKey = null;
let gameActionQuery = null;
let processingNetworkAction = false;
const pendingNetworkActions = [];
let choiceRequestQuery = null;
let choiceRequestListenerActive = false;
let processingChoiceRequest = false;
const pendingRemoteChoiceRequests = [];

function captureExactGameState() {
  if (!window.HB_STATE_STORE) return null;
  G.phase = currentPhase || G.phase || 'draw';
  G.activePlayer = isMyTurn ? myRole : (myRole === 'host' ? 'guest' : 'host');
  return window.HB_STATE_STORE.captureLegacyState(G, {
    revision: localStateRevision,
    role: myRole,
    roomCode,
    playerName: myName,
    deckList: window._confirmedDeck || null,
    keyDeckList: window._confirmedKeyDeck || null,
    attackedMonsterIds: attackedMonstersThisTurn,
    pendingTriggers: window.HB_TRIGGER_QUEUE && typeof window.HB_TRIGGER_QUEUE.exportQueueState === 'function'
      ? window.HB_TRIGGER_QUEUE.exportQueueState()
      : [],
    chainUsage: window.HB_CHAIN_ENGINE && typeof window.HB_CHAIN_ENGINE.getUsageSnapshot === 'function'
      ? window.HB_CHAIN_ENGINE.getUsageSnapshot()
      : [],
    lastActionKey,
    lastActionTs: lastHandledActionTs,
  });
}

function rememberCurrentSession(patch) {
  if (!window.HB_SESSION || !roomCode || !myRole) return null;
  return window.HB_SESSION.remember(Object.assign({
    roomCode,
    role: myRole,
    playerName: myName,
    deckList: window._confirmedDeck || null,
    keyDeckList: window._confirmedKeyDeck || null,
    lastActionKey,
    lastActionTs: lastHandledActionTs,
  }, patch || {}));
}

function sendGameState() {
  const snapshot = captureExactGameState();
  if (!snapshot) return Promise.resolve({ ok: false, error: '상태 저장 엔진이 없습니다.' });
  rememberCurrentSession({ stage: 'playing', lastLocalSnapshotAt: snapshot.savedAt });
  if (!roomRef) return Promise.resolve({ ok: true, local: true, snapshot });
  const path = myRole === 'host' ? 'hostState' : 'guestState';
  return roomRef.child(path).transaction(current => {
    const currentRevision = Math.max(0, Number(current && current.revision || 0));
    snapshot.revision = currentRevision + 1;
    snapshot.savedAt = Date.now();
    return snapshot;
  }).then(result => {
    if (result && result.committed) {
      const saved = result.snapshot && result.snapshot.val();
      localStateRevision = Math.max(localStateRevision, Number(saved && saved.revision || 0));
      return { ok: true, snapshot: saved };
    }
    return { ok: false, error: '상태 저장 트랜잭션이 취소되었습니다.' };
  });
}

function listenOpponentState() {
  if (!roomRef) return;
  const opPath = myRole === 'host' ? 'guestState' : 'hostState';
  roomRef.child(opPath).on('value', snap => {
    const raw = snap.val();
    if (!raw) return;
    const isExact = raw.schema === 2 && raw.data;
    const data = isExact ? raw.data : raw;
    const incomingRevision = Math.max(0, Number(raw.revision || 0));
    if (incomingRevision && incomingRevision < opponentStateRevision) return;
    opponentStateRevision = Math.max(opponentStateRevision, incomingRevision);
    // 상대 패: 공개/비공개 상태 정확히 반영
    const remoteHand = isExact ? (data.myHand || []) : (data.hand || []);
    G.opHand = remoteHand.map(c => ({
      id: c.isPublic ? c.id : 'unknown',  // 비공개 카드는 id도 숨김
      name: c.isPublic ? c.name : '?',
      isPublic: c.isPublic || false,
      _iid: c._iid || null,
    }));
    G.opField = isExact ? (data.myField || []) : (data.field || []);
    G.opGrave = isExact ? (data.myGrave || []) : (data.grave || []);
    G.opExile = isExact ? (data.myExile || []) : (data.exile || []);
    G.opFieldCard = isExact ? (data.myFieldCard || null) : (data.fieldCard || null);
    const remoteKeyDeck = isExact ? (data.myKeyDeck || []) : (data.keyDeck || []);
    G.opKeyDeck = remoteKeyDeck.map(c => ({ id: 'unknown', name: '키카드', _iid: c._iid || null }));
    G.opDeckCount = isExact ? (data.myDeck || []).length : (data.deckCount || 0);
    G.opExtraSlots = isExact ? Number(data.myExtraSlots || 0) : Number(data.extraSlots || 0);
    G.turnStats = G.turnStats || { me: { drawn: 0 }, opponent: { drawn: 0 } };
    const remoteTurnStats = isExact && data.turnStats && data.turnStats.me;
    if (remoteTurnStats) G.turnStats.opponent = window.HB_STATE_STORE.clone(remoteTurnStats);
    renderAll();
  });
}

// 재접속 시 내 상태 복원
function restoreMyState() {
  if (!roomRef) return Promise.resolve({ ok: false, restored: false });
  const myPath = myRole === 'host' ? 'hostState' : 'guestState';
  return roomRef.child(myPath).once('value').then(snap => {
    const raw = snap.val();
    if (!raw) return { ok: true, restored: false };

    if (raw.schema === 2 && raw.data && window.HB_STATE_STORE) {
      const currentOpponentView = {
        opHand: window.HB_STATE_STORE.clone(G.opHand || []),
        opField: window.HB_STATE_STORE.clone(G.opField || []),
        opGrave: window.HB_STATE_STORE.clone(G.opGrave || []),
        opExile: window.HB_STATE_STORE.clone(G.opExile || []),
        opFieldCard: window.HB_STATE_STORE.clone(G.opFieldCard || null),
        opKeyDeck: window.HB_STATE_STORE.clone(G.opKeyDeck || []),
        opDeckCount: Number(G.opDeckCount || 0),
        opExtraSlots: Number(G.opExtraSlots || 0),
      };
      const applied = window.HB_STATE_STORE.applyLegacySnapshot(G, raw);
      // 상대 상태는 상대 전용 리스너가 권위자다. 이미 받은 최신 뷰를 내 과거
      // 스냅샷의 상대 복사본으로 덮어쓰지 않는다.
      if (currentOpponentView.opHand.length || currentOpponentView.opField.length ||
          currentOpponentView.opGrave.length || currentOpponentView.opExile.length ||
          currentOpponentView.opFieldCard || currentOpponentView.opDeckCount) {
        Object.assign(G, currentOpponentView);
      }
      if (!applied.ok) {
        console.warn('[state] 복원 검증 경고:', applied.errors);
      }
      localStateRevision = Math.max(0, Number(raw.revision || 0));
      restoredStateSavedAt = Math.max(0, Number(raw.savedAt || 0));
      lastHandledActionKey = raw.lastActionKey || null;
      lastHandledActionTs = Math.max(0, Number(raw.lastActionTs || 0));
      attackedMonstersThisTurn.clear();
      (applied.attackedMonsterIds || []).forEach(id => attackedMonstersThisTurn.add(id));
      if (window.HB_CHAIN_ENGINE && typeof window.HB_CHAIN_ENGINE.importUsageSnapshot === 'function') {
        window.HB_CHAIN_ENGINE.importUsageSnapshot(applied.chainUsage || []);
      }
      if (window.HB_TRIGGER_QUEUE && typeof window.HB_TRIGGER_QUEUE.importQueueState === 'function') {
        const triggerRestore = window.HB_TRIGGER_QUEUE.importQueueState(applied.pendingTriggers || [], G);
        if (!triggerRestore.ok || (triggerRestore.skipped && triggerRestore.skipped.length)) {
          console.warn('[state] pending trigger restore warning:', triggerRestore);
        }
        if (triggerRestore.count > 0 && typeof window.HB_TRIGGER_QUEUE.processTriggerQueue === 'function') {
          setTimeout(() => window.HB_TRIGGER_QUEUE.processTriggerQueue(G), 0);
        }
      }
      if (raw.deckList) window._confirmedDeck = raw.deckList.slice();
      if (raw.keyDeckList) window._confirmedKeyDeck = raw.keyDeckList.slice();
      currentPhase = G.phase || 'draw';
      isMyTurn = G.activePlayer === myRole;
      log('재접속: 정확한 게임 상태를 복원했습니다.', 'system');
      notify('재접속: 이전 게임으로 돌아왔습니다.');
      renderAll();
      return { ok: true, restored: true, snapshot: raw };
    }

    // 구버전 방을 한 번만 새 스키마로 승격한다.
    const data = raw;
    G.myHand = (data.hand || []).map(c => ({ id: c.id, name: c.name, isPublic: c.isPublic || false, _iid: c._iid }));
    G.myField = data.field || [];
    G.myGrave = data.grave || [];
    G.myExile = data.exile || [];
    G.myFieldCard = data.fieldCard || null;
    G.myKeyDeck = data.keyDeck || [];
    const deckList = data.deckList || window._confirmedDeck || [];
    G.myDeck = deckList.map(id => ({ id, name: CARDS[id]?.name || id }));
    window.HB_STATE_STORE && window.HB_STATE_STORE.ensureInstances(G);
    restoredStateSavedAt = Math.max(0, Number(data.ts || 0));
    lastHandledActionTs = Math.max(0, Number(data.lastActionTs || 0));
    renderAll();
    sendGameState();
    return { ok: true, restored: true, migrated: true };
  });
}

function listenChainState() {
  if (!roomRef) return;
  roomRef.child('chainState').on('value', snap => {
    const wasActive = !!(activeChainState && activeChainState.active);
    const data = snap.val();

    if (data && data.hbEngine === true && window.HB_CHAIN_ENGINE &&
        typeof window.HB_CHAIN_ENGINE.importChainState === 'function') {
      const imported = window.HB_CHAIN_ENGINE.importChainState(data);
      if (imported && imported.ok === false) {
        console.warn('[chain] 원격 체인 상태 가져오기 실패:', imported.error);
      }
    }

    // 체인이 끝났으면 null로 명시 초기화
    if (!data || !data.active) {
      if (activeChainState && activeChainState.active) {
        activeChainState = null;
      } else {
        activeChainState = data; // resolved 데이터 유지 (resolvedLinks 참조용)
      }
    } else {
      // [N2] 동시 발행으로 인한 stale 덮어쓰기 방어: 같은 체인(chainId)에서 링크 수가
      // 줄어드는 active 미러는 무시한다. 활성 체인의 링크는 해결/취소 전까지 단조 증가하므로
      // 줄어든 미러는 거의 항상 오래된(stale) 덮어쓰기이며, 이를 적용하면 응답 링크가 사라진다.
      // (wall-clock에 의존하지 않는 보수적 가드 — chainId가 같고 링크가 줄 때만 무시)
      const cur = activeChainState;
      const sameChain = !!(cur && cur.active && cur.chainId && data.chainId && cur.chainId === data.chainId);
      const incomingLen = data.links ? data.links.length : 0;
      const curLen = cur && cur.links ? cur.links.length : 0;
      if (!(sameChain && incomingLen < curLen)) {
        activeChainState = data;
      }
    }

    renderChainActions();

    if (!data) return;
    if (wasActive && !data.active && pendingTriggerEffects.length > 0) {
      setTimeout(flushTriggeredEffects, 0);
    }
    if (!data.active && data.resolvedLinks && data.resolvedAt && data.resolvedAt !== lastResolvedChainAt) {
      lastResolvedChainAt = data.resolvedAt;
      activeChainState = null; // 처리 후 확실히 null
      if (window.HB_NETWORK_SYNC && typeof window.HB_NETWORK_SYNC.consumeResolvedChainState === 'function') {
        window.HB_NETWORK_SYNC.consumeResolvedChainState(data, { execute: executeChainLocally });
      } else {
        executeChainLocally([...data.resolvedLinks].reverse());
      }
      renderChainActions();
      return;
    }
    syncClockRunState(getPriorityOwner());
    if (!data.active) return;
    if (data.priority === myRole) {
      notify(`체인 우선권: ${data.links?.length || 0}체인. 응답 또는 패스를 선택하세요.`);
      // 상대가 체인 1을 열었을 때 사원소의 지배룡/지배자 ③ 자동 발동 체크
      if (data.links?.length === 1 && data.startedBy !== myRole) {
        if (typeof _checkSaWonsoCounterOnOpponentChain === 'function') {
          _checkSaWonsoCounterOnOpponentChain();
        }
      }
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
let resumeInProgress = false;

function getRememberedSeatToken(role, code) {
  const saved = window.HB_SESSION && window.HB_SESSION.load();
  if (saved && saved.role === role && saved.roomCode === code && saved.seatToken) return saved.seatToken;
  return window.HB_SESSION ? window.HB_SESSION.makeSeatToken() : `${Date.now()}_${Math.random()}`;
}

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
    const seatToken = getRememberedSeatToken('host', roomCode);
    roomRef = db.ref(`rooms/${roomCode}`);
    roomRef.set({
      host: myName,
      guest: null,
      seats: { host: { name: myName, token: seatToken, joinedAt: Date.now() } },
      status: 'waiting',
      turn: 0,
      actions: null,
      chainState: { active: false, links: [], priority: null, passCount: 0 },
      clock: { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() },
    }).then(() => {
      window.HB_SESSION && window.HB_SESSION.remember({
        roomCode, role: myRole, playerName: myName, seatToken, stage: 'waiting',
      });
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
    const seatToken = getRememberedSeatToken('guest', roomCode);

    // 방 존재 여부 먼저 확인
    roomRef.once('value').then(roomSnap => {
      const room = roomSnap.val();
      if (!room || !room.host) {
        _resetJoinState('존재하지 않는 방 코드입니다.');
        roomRef = null;
        return;
      }
      const occupied = room.seats && room.seats.guest;
      if (occupied && occupied.token && occupied.token !== seatToken) {
        _resetJoinState('이미 다른 플레이어가 참가한 방입니다.');
        roomRef = null;
        return;
      }
      return roomRef.update({
        guest: myName,
        'seats/guest': { name: myName, token: seatToken, joinedAt: occupied?.joinedAt || Date.now(), rejoinedAt: Date.now() },
      }).then(() => {
        window.HB_SESSION && window.HB_SESSION.remember({
          roomCode, role: myRole, playerName: myName, seatToken, stage: 'waiting',
        });
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
  rememberCurrentSession({ stage: 'deckBuilder' });
  // 호스트는 바로 덱 빌더로
  goToDeckBuilder();
}

let _deckBuilderOpened = false; // 덱 빌더 중복 진입 방지

let lastHandledActionTs = 0; // 구버전 호환 및 복구 커서
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
  const saved = window.HB_SESSION && window.HB_SESSION.load();
  const cursorTs = Math.max(
    Number(lastHandledActionTs || 0),
    Number(saved && saved.lastActionTs || 0)
  );
  gameActionQuery = roomRef.child('actions').orderByChild('ts').startAt(cursorTs);
  gameActionQuery.on('child_added', snap => {
    const action = snap.val();
    if (!action) return;
    const actionKey = snap.key || action.id;
    if (action.by === myRole) {
      window.HB_SESSION && window.HB_SESSION.markProcessedAction(actionKey, action.ts);
      return;
    }
    if (window.HB_SESSION && window.HB_SESSION.hasProcessedAction(actionKey)) return;
    if (Number(action.ts || 0) < cursorTs) return;
    pendingNetworkActions.push({ key: actionKey, action });
    processNextNetworkAction();
  });
}

function listenChoiceRequests() {
  if (!roomRef || choiceRequestListenerActive) return;
  choiceRequestListenerActive = true;
  choiceRequestQuery = roomRef.child('choiceRequests').orderByChild('to').equalTo(myRole);
  choiceRequestQuery.on('child_added', snap => {
    const request = snap.val();
    if (!request || request.to !== myRole || request.by === myRole || request.status !== 'pending') return;
    pendingRemoteChoiceRequests.push({ key: snap.key, request });
    processNextChoiceRequest();
  });
}

function processNextChoiceRequest() {
  if (processingChoiceRequest || pendingRemoteChoiceRequests.length === 0) return;
  const entry = pendingRemoteChoiceRequests.shift();
  if (!entry || !entry.request) {
    setTimeout(processNextChoiceRequest, 0);
    return;
  }
  processingChoiceRequest = true;
  const request = entry.request;
  const candidates = Array.isArray(request.candidates) ? request.candidates : [];
  const count = Math.max(1, Math.min(Number(request.count || 1), candidates.length || 1));
  const finish = selectedIndices => {
    const indices = (selectedIndices || []).filter(i => Number.isInteger(i) && i >= 0 && i < candidates.length).slice(0, count);
    const response = {
      requestId: request.requestId || entry.key,
      by: myRole,
      to: request.by,
      selectedIndices: indices.length || request.allowEmpty === true
        ? indices
        : candidates.slice(0, count).map((_, i) => i),
      ts: Date.now(),
      status: 'answered',
    };
    const updates = {};
    updates[`choiceResponses/${response.requestId}`] = response;
    updates[`choiceRequests/${response.requestId}/status`] = 'answered';
    updates[`choiceRequests/${response.requestId}/answeredAt`] = response.ts;
    roomRef.update(updates).finally(() => {
      processingChoiceRequest = false;
      if (typeof window._notifyInteractionIdle === 'function') window._notifyInteractionIdle();
      setTimeout(processNextChoiceRequest, 0);
    });
  };

  if (!candidates.length) {
    finish([]);
    return;
  }
  if (candidates.length <= count || typeof openCardPicker !== 'function') {
    finish(candidates.slice(0, count).map((_, i) => i));
    return;
  }
  openCardPicker(
    candidates,
    request.title || '상대 효과의 적용 내용을 선택하세요',
    count,
    finish,
    request.forced !== false
  );
}

function isInteractionPending() {
  const confirmPending = typeof _gcPending !== 'undefined' && !!_gcPending;
  const pickerPending = (typeof pickerRunning !== 'undefined' && pickerRunning) ||
    (typeof pickerQueue !== 'undefined' && pickerQueue && pickerQueue.length > 0);
  return confirmPending || pickerPending;
}

function finishNetworkAction(entry) {
  if (!entry) return;
  lastHandledActionKey = entry.key;
  lastHandledActionTs = Math.max(lastHandledActionTs, Number(entry.action && entry.action.ts || 0));
  window.HB_SESSION && window.HB_SESSION.markProcessedAction(entry.key, entry.action && entry.action.ts);
  rememberCurrentSession();
  sendGameState();
  processingNetworkAction = false;
  setTimeout(processNextNetworkAction, 0);
}

function processNextNetworkAction() {
  if (processingNetworkAction || pendingNetworkActions.length === 0) return;
  const entry = pendingNetworkActions.shift();
  if (!entry || (window.HB_SESSION && window.HB_SESSION.hasProcessedAction(entry.key))) {
    setTimeout(processNextNetworkAction, 0);
    return;
  }
  processingNetworkAction = true;
  handleOpponentAction(entry.action);

  // 콜백이 같은 tick 또는 다음 tick에 picker/confirm을 열 수 있으므로
  // 한 tick 뒤 상호작용 상태를 판정한다.
  setTimeout(() => {
    if (!isInteractionPending()) {
      finishNetworkAction(entry);
      return;
    }
    const onIdle = () => {
      if (isInteractionPending()) return;
      window.removeEventListener('hb:interaction-idle', onIdle);
      finishNetworkAction(entry);
    };
    window.addEventListener('hb:interaction-idle', onIdle);
  }, 0);
}


function _discardMyHandByIndices(indices) {
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  sorted.forEach((i) => {
    if (Number.isInteger(i) && i >= 0 && i < G.myHand.length) {
      G.myGrave.push(G.myHand.splice(i, 1)[0]);
    }
  });
}

function _discardOpponentHandRandomly(n, reason) {
  const count = Math.max(0, Math.min(n || 0, G.opHand.length));
  if (count <= 0) return 0;
  log(`🤖 AI: 패 ${count}장 버리기 (${reason || '효과'})`, 'opponent');
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * G.opHand.length);
    const c = G.opHand.splice(idx, 1)[0];
    G.opGrave.push({ id: c.id, name: c.name || '?' });
    if (c.id && c.id !== 'unknown') log(`🤖 버림: ${c.name}`, 'opponent');
  }
  return count;
}

function _syncAfterOpponentAction() {
  sendGameState();
  renderAll();
  checkWinCondition();
}

function _discardMyHandRandomly(n, reason) {
  const count = Math.max(0, Math.min(n || 0, G.myHand.length));
  if (count <= 0) return 0;
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * G.myHand.length);
    const c = G.myHand.splice(idx, 1)[0];
    if (c) G.myGrave.push(c);
  }
  log(`상대 효과: 패 ${count}장 랜덤 버리기${reason ? ` (${reason})` : ''}`, 'opponent');
  _syncAfterOpponentAction();
  return count;
}

function _discardMyHandByCardId(cardId, reason) {
  if (!cardId) return 0;
  const idx = G.myHand.findIndex(c => c && c.id === cardId);
  if (idx < 0) return 0;
  const c = G.myHand.splice(idx, 1)[0];
  G.myGrave.push(c);
  log(`상대 효과: ${c.name || c.id} 버리기${reason ? ` (${reason})` : ''}`, 'opponent');
  _syncAfterOpponentAction();
  return 1;
}

function _returnMyFieldToHand(count, reason) {
  const actual = Math.max(0, Math.min(Number(count || 0), G.myField.length));
  if (actual <= 0) return;
  const finish = (indices) => {
    const sorted = [...new Set(indices)].sort((a, b) => b - a);
    sorted.forEach(i => {
      if (!Number.isInteger(i) || i < 0 || i >= G.myField.length) return;
      const c = G.myField.splice(i, 1)[0];
      if (c) G.myHand.push({ id: c.id, name: c.name, isPublic: true });
    });
    log(`상대 효과: 필드 카드 ${sorted.length}장을 패로 되돌림${reason ? ` (${reason})` : ''}`, 'opponent');
    _syncAfterOpponentAction();
  };
  if (actual >= G.myField.length) {
    finish(G.myField.map((_, i) => i));
    return;
  }
  openCardPicker(G.myField, `상대 효과: 패로 되돌릴 카드 ${actual}장 선택${reason ? ` (${reason})` : ''}`, actual, finish, true);
}

function sendAction(action) {
  if (!roomRef) {
    // AI 모드: forceDiscard는 AI가 직접 처리
    if (action.type === 'forceDiscard' && window.AI && window.AI.active) {
      const n = action.count || 1;
      _discardOpponentHandRandomly(n, action.reason);
      sendGameState(); renderAll(); checkWinCondition();
    }
    return;
  }
  const actionRef = roomRef.child('actions').push();
  const payload = Object.assign({}, action, {
    id: actionRef.key,
    by: myRole,
    ts: Date.now(),
  });
  actionRef.set(payload);
  // 구버전 클라이언트가 같은 방에 들어온 경우를 위한 읽기 전용 호환 미러.
  roomRef.child('lastAction').set(payload);
  return payload;
}

function showResumeStatus(message, failed) {
  const card = document.getElementById('resumeSessionCard');
  const status = document.getElementById('resumeSessionStatus');
  const cancel = document.getElementById('cancelResumeBtn');
  if (card) card.classList.remove('hidden');
  if (status) status.textContent = message;
  if (cancel) cancel.classList.toggle('hidden', !failed);
}

function cancelRememberedSession() {
  if (window.HB_SESSION) window.HB_SESSION.clear();
  resumeInProgress = false;
  const card = document.getElementById('resumeSessionCard');
  if (card) card.classList.add('hidden');
}

function resumeRememberedSession() {
  if (resumeInProgress || DEMO_MODE || !window.HB_SESSION) return;
  const saved = window.HB_SESSION.load();
  if (!saved) return;
  resumeInProgress = true;
  showResumeStatus('이전 게임의 자리를 확인하는 중...', false);
  const playerNameEl = document.getElementById('playerName');
  if (playerNameEl && saved.playerName) playerNameEl.value = saved.playerName;

  loadFirebase(() => {
    try { initFirebase(); }
    catch (err) {
      resumeInProgress = false;
      showResumeStatus(`복구 연결 실패: ${err.message}`, true);
      return;
    }
    roomCode = saved.roomCode;
    myRole = saved.role;
    myName = saved.playerName || (myRole === 'host' ? '호스트' : '게스트');
    roomRef = db.ref(`rooms/${roomCode}`);
    roomRef.once('value').then(snap => {
      const room = snap.val();
      const seat = room && room.seats && room.seats[myRole];
      if (!room || !seat || seat.token !== saved.seatToken) {
        cancelRememberedSession();
        notify('이전 게임이 종료되었거나 자리가 변경되었습니다.');
        return;
      }

      document.getElementById('hdrRoomCode').textContent = roomCode;
      if (saved.deckList) window._confirmedDeck = saved.deckList.slice();
      if (saved.keyDeckList) window._confirmedKeyDeck = saved.keyDeckList.slice();
      listenRoom();

      if (room.status === 'playing') {
        _deckBuilderOpened = true;
        const myPath = myRole === 'host' ? 'hostState' : 'guestState';
        return roomRef.child(myPath).once('value').then(stateSnap => {
          if (stateSnap.val()) {
            showResumeStatus('게임 상태를 복원하는 중...', false);
            enterGame();
          } else {
            showResumeStatus('덱 선택 화면으로 돌아가는 중...', false);
            goToDeckBuilder();
          }
        });
      }

      if (myRole === 'host') {
        document.getElementById('roomCodeText').textContent = roomCode;
        document.getElementById('roomCodeBlock').classList.remove('hidden');
        document.getElementById('startGameBtn').classList.remove('hidden');
        document.getElementById('startGameBtn').disabled = !room.guest;
        document.getElementById('createStatus').textContent = '이전 대기방을 복구했습니다.';
        document.getElementById('createStatus').classList.remove('hidden');
      } else {
        document.getElementById('joinCode').value = roomCode;
        document.getElementById('joinStatus').textContent = '이전 대기방을 복구했습니다. 호스트를 기다리는 중...';
        document.getElementById('joinStatus').classList.remove('hidden');
      }
      const card = document.getElementById('resumeSessionCard');
      if (card) card.classList.add('hidden');
      resumeInProgress = false;
    }).catch(err => {
      resumeInProgress = false;
      showResumeStatus(`게임 복구 실패: ${err.message}`, true);
    });
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => setTimeout(resumeRememberedSession, 0));
  window.addEventListener('beforeunload', () => {
    rememberCurrentSession({ stage: document.getElementById('game')?.style.display === 'flex' ? 'playing' : undefined });
    if (roomRef && document.getElementById('game')?.style.display === 'flex') sendGameState();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && roomRef && document.getElementById('game')?.style.display === 'flex') {
      sendGameState();
    }
  });
}

function handleOpponentAction(action) {
  if (window.HB_NETWORK_SYNC && window.HB_NETWORK_SYNC.shouldSuppressLegacyAction(action)) {
    const desc = window.HB_NETWORK_SYNC.describeSuppressedAction(action);
    log(`상대 행동 확인: ${desc}`, 'opponent');
    // 상태 변경은 sendGameState/authoritative snapshot/diff가 담당한다.
    renderAll();
    return;
  }
  switch (action.type) {
    case 'draw':
      log('상대 드로우', 'opponent');
      break;
    case 'search':
      // 상대가 서치 → 눈에는 눈은 체인 시스템(effects-chain.js)이 자동 처리
      // [BUG FIX] 여기서 직접 splice하던 중복 로직 제거 — 체인 응답 레지스트리에 위임
      log(`상대 서치: ${action.cardName || '(카드명 미공개)'}`, 'opponent');
      break;
    case 'summon': {
      const sc = CARDS[action.cardId] || {};
      if (!action.localApplied) {
        const publicIdx = G.opHand.findIndex(c => c.id === action.cardId);
        if (publicIdx >= 0) G.opHand.splice(publicIdx, 1);
        else if (G.opHand.length > 0) G.opHand.pop();
        if (G.opField.length < maxFieldSlots()) {
          G.opField.push({ id: action.cardId, name: sc.name || action.cardId, atk: sc.atk || 0 });
        }
      }
      log(`상대 소환: ${sc.name || action.cardId}${sc.atk !== undefined ? ` (ATK ${sc.atk})` : ''}`, 'opponent');
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
      log(`상대 ${action.type === 'discard' ? '패 버림' : '효과 발동'}: ${ac.name}`, 'opponent');
      renderAll();
      break;
    }
    case 'fieldCard': {
      const fc = CARDS[action.cardId] || { name: action.cardId };
      const fhi = G.opHand.findIndex(c => c.id === action.cardId);
      if (fhi >= 0) G.opHand.splice(fhi, 1);
      else if (G.opHand.length > 0) G.opHand.pop();
      G.opFieldCard = { id: action.cardId, name: fc.name };
      log(`상대 필드 마법 발동: ${fc.name}`, 'opponent');
      renderAll();
      break;
    }
    case 'combat':
      handleOpponentCombat(action);
      break;
    case 'directAttack':
      log(`상대 직접 공격! 내 패 ${action.card.atk}장 피해`, 'opponent');
      notify(`직접 공격 당함! 패 ${action.card.atk}장 버려야 합니다`);
      _resolveCombatDamage(action.card.atk);
      break;
    case 'forceDiscard':
      {
        const cnt = action.count || 0;
        const reason = action.reason ? ` (${action.reason})` : '';

        if (action.attackerPicks) {
          // 공격자(상대)가 내 패를 직접 고르는 경우
          // 내 패 전체를 보여주고 상대가 고름 (비공개 포함)
          log(`상대 효과: 내 패 ${cnt}장 선택 버리기${reason}`, 'opponent');
          notify(`상대가 내 패 ${cnt}장을 고릅니다!${reason}`);
          // 내 패를 공개 상태로 표시해서 picker 열기
          const handSnapshot = G.myHand.map((c, i) => ({ ...c, _handIdx: i }));
          openCardPicker(handSnapshot, `상대가 선택: 패 ${cnt}장 버리기${reason}`, cnt, (sel) => {
            const realIndices = sel
              .map(i => handSnapshot[i]?._handIdx)
              .filter(i => Number.isInteger(i));
            _discardMyHandByIndices(realIndices);
            sendGameState(); renderAll(); checkWinCondition();
          }, true);
        } else {
          // 상대 효과지만 내가 직접 고르는 경우 (기본)
          log(`상대 효과: 내 패 ${cnt}장 버리기 강제${reason}`, 'opponent');
          notify(`패 ${cnt}장을 골라 버려야 합니다!${reason}`);
          forceDiscard(cnt);
        }
      }
      break;
    case 'forceReturnHand':
      _returnMyFieldToHand(action.count || 1, action.reason || '');
      break;
    case 'opDraw':
      {
        const cnt = Math.max(0, Number(action.count || 1));
        for (let i = 0; i < cnt; i++) drawOne();
        log(`상대 효과: ${cnt}장 드로우${action.reason ? ` (${action.reason})` : ''}`, 'opponent');
        _syncAfterOpponentAction();
      }
      break;
    case 'opDiscardRandom':
      _discardMyHandRandomly(action.count || 1, action.reason || '');
      break;
    case 'opDiscard':
      _discardMyHandByCardId(action.cardId, action.reason || '');
      break;
    case 'revealAllHand':
      G.myHand.forEach(c => { c.isPublic = true; });
      log('상대 효과: 내 패 전부 공개됨!', 'opponent');
      notify('내 패가 전부 공개됐습니다!');
      _syncAfterOpponentAction();
      break;
    case 'returnToHand':
      // 내 필드 카드가 패로 돌아옴
      { const idx = G.myField.findIndex(c => c.id === action.cardId);
        if (idx >= 0) { const mon = G.myField.splice(idx,1)[0]; G.myHand.push({id:mon.id,name:mon.name,isPublic:true}); _syncAfterOpponentAction(); } }
      break;
    case 'opFieldRemove':
      // 내 필드 카드가 제거됨 (묘지 또는 제외)
      {
        const idx = G.myField.findIndex(c => c.id === action.cardId);
        if (idx >= 0) {
          // 펭귄의 전설 ③: 대상으로 하지 않는 상대 효과 차단.
          // 레거시 송신자가 대상 지정 효과면 action.targeting=true를 실어 보낸다(기본은 비대상).
          if (typeof checkPenguinLegendImmunity === 'function' &&
              checkPenguinLegendImmunity(action.cardId, action.targeting === true)) {
            // 전설 내성 — 효과 무효, 카드 유지
            renderAll();
            break;
          }
          const mon = G.myField.splice(idx, 1)[0];
          if (action.to === 'grave') G.myGrave.push(mon);
          else G.myExile.push(mon);
          _syncAfterOpponentAction();
        }
      }
      break;
    case 'opFieldExile':
      // 내 필드 카드가 제외됨 (펭귄 마법사 ② 등)
      {
        const idx = G.myField.findIndex(c => c.id === action.cardId);
        if (idx >= 0) {
          // 펭귄의 전설 ③: 대상으로 하지 않는 상대 효과 차단 (대상 지정이면 action.targeting=true)
          if (typeof checkPenguinLegendImmunity === 'function' &&
              checkPenguinLegendImmunity(action.cardId, action.targeting === true)) {
            renderAll();
            break;
          }
          const mon = G.myField.splice(idx, 1)[0];
          G.myExile.push(mon);
          log(`상대 효과로 ${mon.name} 제외됨`, 'opponent');
          _syncAfterOpponentAction();
        }
      }
      break;
    case 'negate':
      log(`상대 효과 무효: ${action.reason || ''}`, 'opponent');
      notify(`내 효과가 무효됐습니다! (${action.reason || ''})`);
      // 사원소의 지배룡 ③ / 사원소의 지배자 ③ 자동 트리거 체크
      if (typeof tryActivateSaWonsoJibaeryong3 === 'function') tryActivateSaWonsoJibaeryong3();
      if (typeof tryActivateSaWonsoJibaeja3    === 'function') tryActivateSaWonsoJibaeja3();
      break;
    case 'negateField': {
      // 상대 효과로 내 필드 카드 효과가 턴 종료까지 무효
      // 펭귄의 전설 ③: 대상으로 하지 않는 무효화는 받지 않는다 (대상 지정이면 action.targeting=true)
      if (typeof checkPenguinLegendImmunity === 'function' &&
          checkPenguinLegendImmunity(action.cardId, action.targeting === true)) {
        renderAll();
        break;
      }
      const nfName = CARDS[action.cardId]?.name || action.cardId;
      let applied = false;
      const mon = G.myField.find(c => c && c.id === action.cardId);
      if (mon) {
        mon.effectNegatedUntilEndTurn = true;
        applied = true;
      }
      if (G.myFieldCard && G.myFieldCard.id === action.cardId) {
        G.myFieldCard.effectNegatedUntilEndTurn = true;
        applied = true;
      }
      log(`상대 효과: ${nfName} 효과 무효 (턴 종료까지)`, 'opponent');
      notify(applied ? `${nfName}의 효과가 턴 종료시까지 무효화되었습니다.` : `${nfName}의 효과가 무효됐습니다!`);
      _syncAfterOpponentAction();
      break;
    }
    case 'opGraveExile': {
      // 상대가 내 묘지 카드를 제외 (풍원소의 지배자 ① 등)
      const idx = G.myGrave.findIndex(c => c.id === action.cardId);
      if (idx >= 0) {
        const c = G.myGrave.splice(idx, 1)[0];
        G.myExile.push(c);
        log(`상대 효과: 내 묘지 ${c.name} 제외됨`, 'opponent');
      }
      _syncAfterOpponentAction();
      break;
    }
    case 'opAtkChange': {
      // 상대가 내 필드 몬스터 공격력 변경 (지배룡과 지배자 ① 등)
      const fi = action.fieldIdx;
      if (fi !== undefined && G.myField[fi]) {
        // 펭귄의 전설 ③: 대상으로 하지 않는 공격력 변경 효과는 받지 않는다
        if (typeof checkPenguinLegendImmunity === 'function' &&
            checkPenguinLegendImmunity(G.myField[fi].id, action.targeting === true)) {
          renderAll();
          break;
        }
        // 효과로 받은 공격력 변동은 atkBuff에 기록해 지속 효과 재계산에도 보존한다.
        G.myField[fi].atkBuff = Number(G.myField[fi].atkBuff || 0) + (action.delta || 0);
        G.myField[fi].atk = Math.max(0, (G.myField[fi].atk || 0) + (action.delta || 0));
        log(`상대 효과: 내 ${G.myField[fi].name} ATK ${action.delta > 0 ? '+' : ''}${action.delta} → ${G.myField[fi].atk}`, 'opponent');
      }
      _syncAfterOpponentAction();
      break;
    }
    case 'opGraveMassExile': {
      const count = Math.max(0, Number(action.count || G.myGrave.length));
      const moved = G.myGrave.splice(0, Math.min(count, G.myGrave.length));
      moved.forEach(c => G.myExile.push(c));
      log(`상대 효과: 묘지 ${moved.length}장 제외${action.reason ? ` (${action.reason})` : ''}`, 'opponent');
      _syncAfterOpponentAction();
      break;
    }
    case 'opDeckTopExile': {
      const count = Math.max(0, Number(action.count || 1));
      const moved = G.myDeck.splice(0, Math.min(count, G.myDeck.length));
      moved.forEach(c => G.myExile.push(c));
      log(`상대 효과: 덱 위 ${moved.length}장 제외${action.reason ? ` (${action.reason})` : ''}`, 'opponent');
      _syncAfterOpponentAction();
      break;
    }
    case 'opFieldCardRemove': {
      // 상대가 내 필드 마법을 제거
      if (G.myFieldCard && G.myFieldCard.id === action.cardId) {
        const c = G.myFieldCard;
        G.myFieldCard = null;
        if (action.to === 'grave') G.myGrave.push(c);
        else G.myExile.push(c);
        log(`상대 효과: 내 필드 카드 ${c.name} 제거됨`, 'opponent');
      }
      _syncAfterOpponentAction();
      break;
    }
    case 'searchBan':
      log('서치 봉인: 이 턴 덱에서 카드를 패에 넣을 수 없습니다.', 'system');
      notify('서치 봉인의 항아리: 이 턴 서치 불가!');
      break;
    case 'exileBan':
      G.exileBanActive = true;
      _syncAfterOpponentAction();
      log('신성한 수호자: 이 턴 서로 카드 제외 불가!', 'system');
      notify('이 턴 카드를 제외할 수 없습니다!');
      break;
    case 'endTurn':
      isMyTurn = true;
      attackedMonstersThisTurn.clear();
      // [BUG FIX] 상대 턴 종료 시 내 턴 시작 — 턴 종료 효과 리셋
      G.exileBanActive  = false;
      G.goldenAppleActive = false;
      // "턴 종료시까지" 공격력 버프는 턴 경계마다 양쪽 클라이언트에서 해제한다.
      if (typeof clearEndOfTurnAtkBuffs === 'function') clearEndOfTurnAtkBuffs();
      // [BUG-4 FIX] 수신 측에서도 G.turn을 동기화한다.
      // 발신 측(endTurn 함수)이 G.turn++를 수행한 뒤 action.turn에 새 값을 포함해서 보내므로,
      // 수신 측은 그 값으로 덮어써 양측 turn 카운트를 일치시킨다.
      // action.turn이 없는 구버전 클라이언트와의 호환을 위해 undefined 시 ++로 폴백한다.
      if (typeof action.turn === 'number' && action.turn > 0) {
        G.turn = action.turn;
      } else {
        G.turn = (G.turn || 0) + 1;
      }
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
  const atkCard = action.atkCard;
  const defCard = action.defCard;
  const diff = atkCard.atk - defCard.atk;

  log(`상대 전투: ${atkCard.name}(${atkCard.atk}) vs ${defCard.name}(${defCard.atk})`, 'opponent');

  if (diff > 0) {
    // 상대 승리 — 내 몬스터 묘지, 패 피해
    const myIdx = G.myField.findIndex(c => c.id === defCard.id);
    if (myIdx >= 0) {
      const mon = G.myField.splice(myIdx, 1)[0];
      G.myGrave.push(mon);
      onSentToGrave(mon.id);
    }
    log(`내 ${defCard.name} 묘지. 패 ${diff}장 피해`, 'opponent');
    _syncAfterOpponentAction();
    // 펭귄 마을 ②, 구사일생 포함 피해 처리
    _resolveCombatDamage(diff);
  } else if (diff < 0) {
    // 내 몬스터 승리
    const opIdx = G.opField.findIndex(c => c.id === atkCard.id);
    if (opIdx >= 0) G.opGrave.push(G.opField.splice(opIdx, 1)[0]);
    log(`상대 ${atkCard.name} 묘지`, 'mine');
    _syncAfterOpponentAction();
  } else {
    if (atkCard.atk !== 0) {
      const myIdx = G.myField.findIndex(c => c.id === defCard.id);
      const opIdx = G.opField.findIndex(c => c.id === atkCard.id);
      if (myIdx >= 0) { G.myGrave.push(G.myField.splice(myIdx, 1)[0]); }
      if (opIdx >= 0) G.opGrave.push(G.opField.splice(opIdx, 1)[0]);
      log('공격력 동일 — 양쪽 묘지', 'system');
    }
    _syncAfterOpponentAction();
  }
}

// ─────────────────────────────────────────────
