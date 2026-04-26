// effects-theme.js — 입장/덱 초기화/테마 카드 공용 처리
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

function activateCard(handIdx) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];

  // ── 펭귄 테마 카드: 전용 라우터로 위임 ──
  if (card && card.theme === '펭귄') {
    if (typeof activatePenguinCard === 'function') {
      activatePenguinCard(handIdx, 1);
    }
    return;
  }

  // ── 동적 테마 핸들러 (올드원, 라이온, 타이거, 라이거, 마피아, 불가사의 등) ──
  if (card && activateRegisteredThemeCardEffect(handIdx, 1)) {
    return;
  }

  switch(c.id) {
    case '구사일생':
      notify('구사일생은 전투 시 자동으로 발동 여부를 물어봅니다.');
      return;

    case '눈에는 눈':
      // 상대 서치 시 자동 트리거 — 수동으로도 발동 가능
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      drawN(2);
      log('눈에는 눈: 드로우 2장!', 'mine');
      sendGameState(); renderAll();
      return;

    case '출입통제':
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      log('출입통제 발동! 상대 소환 효과 무효', 'mine');
      sendAction({ type: 'negate', reason: '출입통제', cardId: c.id });
      sendGameState(); renderAll();
      return;

    case '단단한 카드 자물쇠':
      if (G.opField.length === 0 && !G.opFieldCard) { notify('대상으로 할 카드가 없습니다.'); return; }
      openCardPicker(
        [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])],
        '단단한 카드 자물쇠: 상대 필드 카드 1장 효과 무효',
        1,
        (selected) => {
          const targets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
          if (selected.length > 0) {
            const t = targets[selected[0]];
            log(`단단한 카드 자물쇠: ${t.name} 효과 턴 종료시까지 무효`, 'mine');
            sendAction({ type: 'negateField', cardId: t.id });
          }
          G.myHand.splice(handIdx, 1);
          G.myGrave.push({ id: c.id, name: c.name });
          sendGameState(); renderAll();
        }
      );
      return;

    case '서치 봉인의 항아리':
      // ① 덱으로 되돌리고 드로우  ② 버려서 서치 봉인
      gameConfirm('서치 봉인의 항아리\n확인 = ① 덱으로 되돌리고 1장 드로우\n취소 = ② 버려서 이 턴 서치 봉인', (choice) => {
        if (choice) {
          G.myHand.splice(handIdx, 1);
          G.myDeck.push({ id: c.id, name: c.name });
          G.myDeck = shuffle(G.myDeck);
          drawOne();
          log('서치 봉인의 항아리 ①: 덱으로 + 드로우', 'mine');
        } else {
          G.myHand.splice(handIdx, 1);
          G.myGrave.push({ id: c.id, name: c.name });
          log('서치 봉인의 항아리 ②: 이 턴 서치 봉인!', 'mine');
          sendAction({ type: 'searchBan', reason: '서치 봉인의 항아리' });
        }
        sendGameState(); renderAll();
      });
      return;

    case '유혹의 황금사과':
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      G.goldenAppleActive = true;
      log('유혹의 황금사과 발동! 이 턴 상대 소환 시마다 1장 드로우', 'mine');
      sendGameState(); renderAll();
      return;

    case '수호의 빛':
      // 필드 마법
      if (G.myFieldCard) G.myGrave.push(G.myFieldCard);
      G.myHand.splice(handIdx, 1);
      G.myFieldCard = { id: c.id, name: c.name };
      // 발동 시 제외된 카드 패에 넣기
      if (G.myExile.length > 0) {
        openCardPicker(
          G.myExile,
          '수호의 빛: 제외된 카드 1장 패에 넣기 (선택)',
          1,
          (selected) => {
            if (selected.length > 0) {
              const ec = G.myExile.splice(selected[0], 1)[0];
              G.myHand.push({ id: ec.id, name: ec.name, isPublic: true });
              log(`수호의 빛: ${ec.name} 패로`, 'mine');
            }
            sendGameState(); renderAll();
          }
        );
      }
      log('수호의 빛 필드 발동!', 'mine');
      sendGameState(); renderAll();
      return;

    case '신성한 수호자':
      // ① 패에서 제외 → 이 턴 제외 불가
      G.myHand.splice(handIdx, 1);
      G.myExile.push({ id: c.id, name: c.name });
      G.exileBanActive = true;
      log('신성한 수호자 ①: 이 턴 서로 카드 제외 불가!', 'mine');
      sendAction({ type: 'exileBan' });
      // ② 제외됐으면 수호의 빛 서치 자동
      const lightIdx = G.myDeck.findIndex(dc => dc.id === '수호의 빛');
      if (lightIdx >= 0) {
        G.myDeck.splice(lightIdx, 1);
        G.myHand.push({ id: '수호의 빛', name: '수호의 빛', isPublic: true });
        log('신성한 수호자 ②: 수호의 빛 서치!', 'mine');
      }
      sendGameState(); renderAll();
      return;

    case '일격필살':
      // 키카드 — 상대 패 1장 버리기
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      log('일격필살: 상대 패 1장 버리기!', 'mine');
      sendAction({ type: 'forceDiscard', count: 1, reason: '일격필살', attackerPicks: true });
      sendGameState(); renderAll();
      return;

    case '단 한번의 기회':
      // 키카드 — 드로우 1장
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      drawOne();
      log('단 한번의 기회: 드로우!', 'mine');
      sendGameState(); renderAll();
      return;

    default:
      // 기본 처리
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
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