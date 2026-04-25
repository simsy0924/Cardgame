// engine.js — 게임 상태, 유틸, 소환/드로우, 클럭
// Firebase Setup
// ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyC-Qi2mzllnzwQKetxLy9BnepVEaugbUzA",
  authDomain: "cardgame-1b151.firebaseapp.com",
  databaseURL: "https://cardgame-1b151-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cardgame-1b151",
  storageBucket: "cardgame-1b151.firebasestorage.app",
  messagingSenderId: "179779519297",
  appId: "1:179779519297:web:634cdc2de3c866e09e57c0"
};

// ─────────────────────────────────────────────
// LOCAL DEMO MODE (Firebase 없이 같은 화면에서 테스트)
// Firebase 설정 전에 URL에 ?demo=true 붙이면 로컬 시뮬레이션 모드
// ─────────────────────────────────────────────
const DEMO_MODE = new URLSearchParams(location.search).get('demo') === 'true';

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
let db = null;
let roomRef = null;
let roomCode = '';
let myRole = ''; // 'host' | 'guest'
let myName = '';
let opName = '';
let isMyTurn = false;
let currentPhase = ''; // draw | deploy | attack | end

// Local game state (synced from Firebase)
let G = {
  myHand: [],         // {id, name, isPublic}
  opHand: [],         // opponent visible cards
  myField: [],        // [{id, name, atk}] up to 5
  opField: [],
  myGrave: [],
  opGrave: [],
  myExile: [],
  opExile: [],
  myFieldCard: null,
  opFieldCard: null,
  myKeyDeck: [],
  opKeyDeck: [],
  myDeckCount: 0,
  opDeckCount: 0,
  turn: 1,
  phase: 'draw',
  activePlayer: 'host', // 'host' | 'guest'
};

let selectedCardIdx = -1;     // index in myHand
let selectedFieldIdx = -1;    // index in myField
let pickerQueue = [];   // {cards, title, maxPick, callback} 대기열
let pickerRunning = false;
let pickerSelected = [];
let pickerCurrentCards = [];
let activeChainState = null; // Firebase chain state mirror
let lastResolvedChainAt = 0;
let pendingTriggerEffects = [];
let usedKeyFetchInChain = {};
let attackedMonstersThisTurn = new Set(); // 공격한 몬스터 id 저장
let gameClock = { host: 500, guest: 500, runningFor: null, lastUpdated: Date.now() };
let clockTicker = null;
let timeoutHandled = false;
let lastSyncedClockRunner = null;

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function notify(msg, duration = 2500) {
  const el = document.createElement('div');
  el.className = 'notification';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function formatSeconds(sec) {
  return `${Math.max(0, Math.ceil(sec))}초`;
}

// ── 브라우저 confirm() 대체 커스텀 다이얼로그 ──────────────
// 기존 코드에서 confirm()을 호출하는 모든 부분은 이 함수를 경유한다.
// callback(true/false) 형태로 결과를 반환한다.
let _gcPending = null; // 현재 대기 중인 콜백
function gameConfirm(msg, callback) {
  const overlay = document.getElementById('gameConfirmOverlay');
  const msgEl   = document.getElementById('gameConfirmMsg');
  const titleEl = document.getElementById('gameConfirmTitle');
  const yesBtn  = document.getElementById('gcYesBtn');
  const noBtn   = document.getElementById('gcNoBtn');
  if (!overlay) { callback(window.confirm(msg)); return; } // 폴백

  // 이미 대기 중인 confirm이 있으면 직전 것을 false로 닫음
  if (_gcPending) { _gcPending(false); _gcPending = null; }

  // 타이틀/메시지 분리 (첫 줄이 타이틀)
  const lines = msg.split('\n');
  titleEl.textContent = lines[0] || '효과 발동 확인';
  msgEl.textContent   = lines.slice(1).join('\n').trim();

  overlay.classList.remove('hidden');

  function close(result) {
    overlay.classList.add('hidden');
    yesBtn.onclick = null;
    noBtn.onclick  = null;
    _gcPending = null;
    callback(result);
  }

  _gcPending = (r) => close(r);
  yesBtn.onclick = () => close(true);
  noBtn.onclick  = () => close(false);

  // 오버레이 클릭 시 취소
  overlay.onclick = (e) => { if (e.target === overlay) close(false); };
}

function getOtherRole(role) {
  return role === 'host' ? 'guest' : 'host';
}

function getPriorityOwner() {
  if (activeChainState && activeChainState.active && activeChainState.priority) return activeChainState.priority;
  return isMyTurn ? myRole : getOtherRole(myRole);
}

function getEffectiveClock(now = Date.now()) {
  const c = { ...gameClock };
  if (c.runningFor && c.lastUpdated) {
    const elapsed = Math.max(0, (now - c.lastUpdated) / 1000);
    c[c.runningFor] = Math.max(0, (c[c.runningFor] ?? 0) - elapsed);
  }
  return c;
}

function renderClock() {
  const myChip = document.getElementById('myClockChip');
  const opChip = document.getElementById('opClockChip');
  if (!myChip || !opChip || !myRole) return;
  const c = getEffectiveClock();
  const myTime = c[myRole] ?? 0;
  const opRole = getOtherRole(myRole);
  const opTime = c[opRole] ?? 0;
  myChip.textContent = `내 시간 ${formatSeconds(myTime)}`;
  opChip.textContent = `상대 시간 ${formatSeconds(opTime)}`;
  myChip.classList.toggle('running', c.runningFor === myRole);
  opChip.classList.toggle('running', c.runningFor === opRole);
}

function handleTimeOut(winnerRole) {
  if (timeoutHandled) return;
  timeoutHandled = true;
  const iWon = winnerRole === myRole;
  showGameOver(iWon);
  const loser = getOtherRole(winnerRole);
  const loserName = loser === myRole ? myName : opName;
  log(`시간 초과: ${loserName || (loser === 'host' ? '호스트' : '게스트')} 패배`, 'system');
  if (roomRef) {
    sendAction({ type: 'gameOver', winner: winnerRole, reason: 'timeout' });
  }
}

function tickClockUI() {
  renderClock();
  const c = getEffectiveClock();
  if (c.host <= 0) handleTimeOut('guest');
  else if (c.guest <= 0) handleTimeOut('host');
}

function startClockTicker() {
  if (clockTicker) clearInterval(clockTicker);
  clockTicker = setInterval(tickClockUI, 250);
  tickClockUI();
}

function syncClockRunState(newRunningFor) {
  if (!newRunningFor) return;
  if (lastSyncedClockRunner === newRunningFor) return;
  lastSyncedClockRunner = newRunningFor;
  const now = Date.now();
  if (!roomRef) {
    const c = getEffectiveClock(now);
    gameClock = { host: c.host, guest: c.guest, runningFor: newRunningFor, lastUpdated: now };
    renderClock();
    return;
  }
  roomRef.child('clock').transaction(curr => {
    const base = curr || { host: 500, guest: 500, runningFor: null, lastUpdated: now };
    const elapsed = base.runningFor ? Math.max(0, (now - (base.lastUpdated || now)) / 1000) : 0;
    if (base.runningFor) base[base.runningFor] = Math.max(0, (base[base.runningFor] ?? 500) - elapsed);
    base.runningFor = newRunningFor;
    base.lastUpdated = now;
    return base;
  });
}

function log(msg, type = '') {
  const el = document.createElement('div');
  el.className = `log-entry ${type}`;
  el.textContent = msg;
  const container = document.getElementById('logEntries');
  container.prepend(el);
  while (container.children.length > 50) container.lastChild.remove();

  // 내 행동 로그(mine)는 상대한테도 전송
  // system 로그 중 일부도 전송 (턴 종료, 전투 결과 등)
  if ((type === 'mine' || type === 'system') && roomRef) {
    const ts = Date.now();
    roomRef.child('lastLog').set({ msg, type, ts });
  }
}

// 상대 로그 수신 리스너
let lastLogTs = 0;
function listenOpponentLog() {
  if (!roomRef) return;
  roomRef.child('lastLog').on('value', snap => {
    const data = snap.val();
    if (!data || data.ts <= lastLogTs) return;
    lastLogTs = data.ts;

    // 이미 handleOpponentAction이 처리하는 주요 액션은 중복 출력 방지
    // → lastAction의 ts와 비교해서 같은 시점이면 스킵
    // 대신 펭귄 효과 내부 동작(서치, 소환 등)은 새로 표시
    const displayType = data.type === 'system' ? 'system' : 'opponent';
    const el = document.createElement('div');
    el.className = `log-entry ${displayType}`;
    el.textContent = data.type === 'system' ? data.msg : '[상대] ' + data.msg;
    const container = document.getElementById('logEntries');
    container.prepend(el);
    while (container.children.length > 50) container.lastChild.remove();
  });
}

// ─────────────────────────────────────────────

// ── 코어 소환/드로우 헬퍼 ──

// ============================================================
// PENGUIN EFFECT ENGINE (인라인)
// ============================================================
let effectUsed = {};
function resetEffectUsed() { effectUsed = {}; }
function canUseEffect(cardId, effectNum, maxTimes = 1) { const key = `${cardId}_${effectNum}`; return (effectUsed[key] || 0) < maxTimes; }
function markEffectUsed(cardId, effectNum) { const key = `${cardId}_${effectNum}`; effectUsed[key] = (effectUsed[key] || 0) + 1; }
function isPenguinVillageRevealed() { return G.myHand.some(c => c.id === '펭귄 마을' && c.isPublic); }
function isPenguinCard(cardId) { return cardId.includes('펭귄'); }
function isPenguinMonster(cardId) { const card = CARDS[cardId]; return card && card.cardType === 'monster' && isPenguinCard(cardId); }
function findAllInDeck(predicate) { return G.myDeck.filter(predicate); }
function removeFromDeck(cardId) { const idx = G.myDeck.findIndex(c => c.id === cardId); if (idx >= 0) { G.myDeck.splice(idx, 1); return true; } return false; }
function searchToHand(cardId) { if (!removeFromDeck(cardId)) return false; const card = CARDS[cardId]; G.myHand.push({ id: cardId, name: card.name, isPublic: true }); log(`서치: ${card.name} → 공개패`, 'mine'); sendAction({ type: 'search', cardName: card.name }); sendGameState(); return true; }
function maxFieldSlots() { return 5; }

function summonFromDeck(cardId) {
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
  if (!removeFromDeck(cardId)) return false;
  const card = CARDS[cardId];
  G.myField.push({ id: cardId, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0, summonedFrom: 'deck' });
  log(`덱에서 소환: ${card.name}`, 'mine');
  sendGameState(); onSummon(cardId, 'deck'); return true;
}
function summonFromHand(handIdx) {
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
  const c = G.myHand[handIdx]; const card = CARDS[c.id];
  if (!card || card.cardType !== 'monster') return false;
  G.myHand.splice(handIdx, 1);
  G.myField.push({ id: c.id, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0, summonedFrom: 'hand' });
  log(`패에서 소환: ${card.name}`, 'mine'); selectedCardIdx = -1;
  sendGameState(); onSummon(c.id, 'hand'); return true;
}
function summonFromGrave(cardId) {
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
  const idx = G.myGrave.findIndex(c => c.id === cardId);
  if (idx < 0) return false;
  const c = G.myGrave.splice(idx, 1)[0]; const card = CARDS[cardId];
  G.myField.push({ id: cardId, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0, summonedFrom: 'grave' });
  log(`묘지에서 소환: ${card.name}`, 'mine'); sendGameState(); onSummon(cardId, 'grave'); return true;
}
function drawOne() {
  if (G.myDeck.length === 0) { G.myDeck = shuffle(G.myGrave.map(c => ({...c}))); G.myGrave = []; log('덱 소진! 묘지를 덱으로 되돌렸습니다.', 'system'); }
  if (G.myDeck.length === 0) { notify('덱이 비었습니다.'); return null; }
  const c = G.myDeck.shift(); G.myHand.push({ id: c.id, name: c.name, isPublic: false });
  log(`드로우: ${c.name}`, 'mine'); sendGameState(); return c;
}
function drawN(n) { for (let i = 0; i < n; i++) drawOne(); }
function sendToGrave(cardId, from = 'field') {
  if (from === 'field') { const idx = G.myField.findIndex(c => c.id === cardId); if (idx >= 0) { G.myGrave.push(G.myField.splice(idx, 1)[0]); log(`${CARDS[cardId]?.name || cardId} 묘지로`, 'mine'); onSentToGrave(cardId); } }
  else if (from === 'hand') { const idx = G.myHand.findIndex(c => c.id === cardId); if (idx >= 0) { G.myGrave.push(G.myHand.splice(idx, 1)[0]); } }
  sendGameState();
}
function onSummon(cardId, from) {
  // 황금사과 드로우는 handleOpponentAction('summon')에서 처리
  switch(cardId) {
    case '꼬마 펭귄': triggerKkomaPenguin(from); break;
    case '펭귄 부부': triggerPenguinBubu(from); break;
    case '펭귄 용사': triggerPenguinHero(from); break;
    case '펭귄의 전설': triggerPenguinLegend(from); break;
    case '펭귄 마법사': triggerPenguinWizard(from); break;
    case '전원소의 지배자': triggerJibaejaJeon2(); break;
  }
  renderAll();
}
function onSentToGrave(cardId) { if (cardId === '펭귄 용사') autoTriggerHeroGrave(); }
function resetTurnEffects() {
  resetEffectUsed();
  if (G.penguinHeroAtkBuff) { G.myField.forEach(c => { if (isPenguinMonster(c.id)) c.atk = c.atkBase || CARDS[c.id]?.atk || 0; }); G.penguinHeroAtkBuff = false; }
  G.myField.forEach(c => { if (c.id === '수문장 펭귄') c.atk = c.atkBase || 3; });
  resetJibaeEffects();
}
