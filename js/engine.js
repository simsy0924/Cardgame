// engine.js — 게임 상태, 유틸, 소환/드로우, 클럭
// ─────────────────────────────────────────────
// Firebase 설정 (API Key는 환경변수 또는 별도 config 파일로 분리 권장)
// 프로덕션: 아래 값을 .env 또는 서버사이드 설정에서 주입하세요.
// Firebase Security Rules에서 읽기/쓰기 범위를 반드시 제한하세요.
// ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            window.__FB_API_KEY__            || "AIzaSyC-Qi2mzllnzwQKetxLy9BnepVEaugbUzA",
  authDomain:        window.__FB_AUTH_DOMAIN__        || "cardgame-1b151.firebaseapp.com",
  databaseURL:       window.__FB_DATABASE_URL__       || "https://cardgame-1b151-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         window.__FB_PROJECT_ID__         || "cardgame-1b151",
  storageBucket:     window.__FB_STORAGE_BUCKET__     || "cardgame-1b151.firebasestorage.app",
  messagingSenderId: window.__FB_MESSAGING_SENDER_ID__|| "179779519297",
  appId:             window.__FB_APP_ID__             || "1:179779519297:web:634cdc2de3c866e09e57c0",
};

// ─────────────────────────────────────────────
// LOCAL DEMO MODE (?demo=true)
// ─────────────────────────────────────────────
const DEMO_MODE = new URLSearchParams(location.search).get('demo') === 'true';

// ─────────────────────────────────────────────
// FIREBASE HANDLES
// ─────────────────────────────────────────────
let db      = null;
let roomRef = null;
let roomCode = '';
let myRole   = ''; // 'host' | 'guest'
let myName   = '';
let opName   = '';
let isMyTurn      = false;
let currentPhase  = ''; // draw | deploy | attack | end

// ─────────────────────────────────────────────
// GAME STATE (G)
// ─────────────────────────────────────────────
// 모든 변경은 G의 프로퍼티를 직접 수정합니다.
// 외부에서 G 자체를 교체하지 마세요 (참조 공유 손상).
let G = {
  myHand:    [],  // { id, name, isPublic }
  opHand:    [],  // { id, name, isPublic }
  myField:   [],  // { id, name, atk, atkBase, summonedFrom }
  opField:   [],
  myGrave:   [],
  opGrave:   [],
  myExile:   [],
  opExile:   [],
  myFieldCard:  null,
  opFieldCard:  null,
  myKeyDeck: [],
  opKeyDeck: [],
  myDeckCount:  0,
  opDeckCount:  0,
  myExtraSlots: 0,
  opExtraSlots: 0,
  turn:     1,
  phase:    'draw',
  activePlayer: 'host', // 'host' | 'guest'
  penguinHeroAtkBuff:    false,
  goldenAppleActive:     false,
  exileBanActive:        false,
  attackPhaseProtected:  false,
  saWonsoJibaejaReturning: false,
};

// ─────────────────────────────────────────────
// UI / INTERACTION STATE
// ─────────────────────────────────────────────
let selectedCardIdx  = -1;   // 내 패에서 선택한 인덱스
let selectedFieldIdx = -1;   // 내 필드에서 선택한 인덱스

// 카드 픽커 큐
let pickerQueue        = [];  // { cards, title, maxPick, callback, forced }
let pickerRunning      = false;
let pickerSelected     = [];
let pickerCurrentCards = [];

// 체인
let activeChainState     = null;
let lastResolvedChainAt  = 0;
let pendingTriggerEffects = [];
let usedKeyFetchInChain   = {};

// 전투
let attackedMonstersThisTurn = new Set();

// 클락
let gameClock = { host: 500, guest: 500, runningFor: null, lastUpdated: Date.now() };
let clockTicker        = null;
let timeoutHandled     = false;
let lastSyncedClockRunner = null;

// 로그 중복 방지
let lastLogTs = 0;

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
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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

// ── 브라우저 confirm() 대체 커스텀 다이얼로그 ──
let _gcPending = null;

function gameConfirm(msg, callback) {
  const overlay = document.getElementById('gameConfirmOverlay');
  const msgEl   = document.getElementById('gameConfirmMsg');
  const titleEl = document.getElementById('gameConfirmTitle');
  const yesBtn  = document.getElementById('gcYesBtn');
  const noBtn   = document.getElementById('gcNoBtn');

  if (!overlay) {
    callback(window.confirm(msg));
    return;
  }

  // 이미 대기 중이면 이전 것을 false로 닫음
  if (_gcPending) {
    _gcPending(false);
    _gcPending = null;
  }

  const lines = msg.split('\n');
  titleEl.textContent = lines[0] || '효과 발동 확인';
  msgEl.textContent   = lines.slice(1).join('\n').trim();
  overlay.classList.remove('hidden');

  function close(result) {
    overlay.classList.add('hidden');
    yesBtn.onclick  = null;
    noBtn.onclick   = null;
    overlay.onclick = null;
    _gcPending = null;
    callback(result);
  }

  _gcPending     = (r) => close(r);
  yesBtn.onclick = () => close(true);
  noBtn.onclick  = () => close(false);
  overlay.onclick = (e) => { if (e.target === overlay) close(false); };
}

// ─────────────────────────────────────────────
// ROLE HELPERS
// ─────────────────────────────────────────────
function getOtherRole(role) {
  return role === 'host' ? 'guest' : 'host';
}

function getPriorityOwner() {
  if (activeChainState && activeChainState.active && activeChainState.priority) {
    return activeChainState.priority;
  }
  return isMyTurn ? myRole : getOtherRole(myRole);
}

// ─────────────────────────────────────────────
// CLOCK
// ─────────────────────────────────────────────
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

  const c      = getEffectiveClock();
  const opRole = getOtherRole(myRole);
  myChip.textContent = `내 시간 ${formatSeconds(c[myRole] ?? 0)}`;
  opChip.textContent = `상대 시간 ${formatSeconds(c[opRole] ?? 0)}`;
  myChip.classList.toggle('running', c.runningFor === myRole);
  opChip.classList.toggle('running', c.runningFor === opRole);
}

function handleTimeOut(winnerRole) {
  if (timeoutHandled) return;
  timeoutHandled = true;
  showGameOver(winnerRole === myRole);
  const loser     = getOtherRole(winnerRole);
  const loserName = loser === myRole ? myName : opName;
  log(`시간 초과: ${loserName || (loser === 'host' ? '호스트' : '게스트')} 패배`, 'system');
  if (roomRef) {
    sendAction({ type: 'gameOver', winner: winnerRole, reason: 'timeout' });
  }
}

function tickClockUI() {
  renderClock();
  const c = getEffectiveClock();
  if      (c.host  <= 0) handleTimeOut('guest');
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
    const base    = curr || { host: 500, guest: 500, runningFor: null, lastUpdated: now };
    const elapsed = base.runningFor
      ? Math.max(0, (now - (base.lastUpdated || now)) / 1000)
      : 0;
    if (base.runningFor) {
      base[base.runningFor] = Math.max(0, (base[base.runningFor] ?? 500) - elapsed);
    }
    base.runningFor  = newRunningFor;
    base.lastUpdated = now;
    return base;
  });
}

// ─────────────────────────────────────────────
// LOG
// ─────────────────────────────────────────────
function log(msg, type = '') {
  const el = document.createElement('div');
  el.className = `log-entry ${type}`;
  el.textContent = msg;
  const container = document.getElementById('logEntries');
  container.prepend(el);
  // 최대 50개 유지
  while (container.children.length > 50) container.lastChild.remove();

  if ((type === 'mine' || type === 'system') && roomRef) {
    roomRef.child('lastLog').set({ msg, type, ts: Date.now() });
  }
}

// 상대 로그 수신
function listenOpponentLog() {
  if (!roomRef) return;
  roomRef.child('lastLog').on('value', snap => {
    const data = snap.val();
    if (!data || data.ts <= lastLogTs) return;
    lastLogTs = data.ts;

    const displayType = data.type === 'system' ? 'system' : 'opponent';
    const el = document.createElement('div');
    el.className  = `log-entry ${displayType}`;
    el.textContent = data.type === 'system' ? data.msg : '[상대] ' + data.msg;
    const container = document.getElementById('logEntries');
    container.prepend(el);
    while (container.children.length > 50) container.lastChild.remove();
  });
}

// ─────────────────────────────────────────────
// EFFECT USAGE TRACKING
// ─────────────────────────────────────────────
let effectUsed = {};

function resetEffectUsed() {
  effectUsed = {};
}

function canUseEffect(cardId, effectNum, maxTimes = 1) {
  const key = `${cardId}_${effectNum}`;
  return (effectUsed[key] || 0) < maxTimes;
}

function markEffectUsed(cardId, effectNum) {
  const key = `${cardId}_${effectNum}`;
  effectUsed[key] = (effectUsed[key] || 0) + 1;
}

// ─────────────────────────────────────────────
// PENGUIN HELPERS
// ─────────────────────────────────────────────
function isPenguinVillageRevealed() {
  return G.myHand.some(c => c.id === '펭귄 마을' && c.isPublic);
}

function isPenguinCard(cardId) {
  return cardId.includes('펭귄');
}

function isPenguinMonster(cardId) {
  const card = CARDS[cardId];
  return card && card.cardType === 'monster' && isPenguinCard(cardId);
}

// ─────────────────────────────────────────────
// DECK HELPERS
// ─────────────────────────────────────────────
function findAllInDeck(predicate) {
  return G.myDeck.filter(predicate);
}

function removeFromDeck(cardId) {
  const idx = G.myDeck.findIndex(c => c.id === cardId);
  if (idx >= 0) {
    G.myDeck.splice(idx, 1);
    return true;
  }
  return false;
}

function searchToHand(cardId) {
  if (!removeFromDeck(cardId)) return false;
  const card = CARDS[cardId];
  G.myHand.push({ id: cardId, name: card.name, isPublic: true });
  log(`서치: ${card.name} → 공개패`, 'mine');
  sendAction({ type: 'search', cardName: card.name });
  sendGameState();
  return true;
}

function maxFieldSlots() {
  return 5;
}

// ─────────────────────────────────────────────
// SUMMON HELPERS
// ─────────────────────────────────────────────
function summonFromDeck(cardId) {
  if (G.myField.length >= maxFieldSlots()) {
    notify('몬스터 존이 가득 찼습니다.');
    return false;
  }
  if (!removeFromDeck(cardId)) return false;
  const card = CARDS[cardId];
  G.myField.push({
    id: cardId, name: card.name,
    atk: card.atk || 0, atkBase: card.atk || 0,
    summonedFrom: 'deck',
  });
  log(`덱에서 소환: ${card.name}`, 'mine');
  sendGameState();
  onSummon(cardId, 'deck');
  return true;
}

function summonFromHand(handIdx) {
  if (G.myField.length >= maxFieldSlots()) {
    notify('몬스터 존이 가득 찼습니다.');
    return false;
  }
  const c    = G.myHand[handIdx];
  const card = CARDS[c.id];
  if (!card || card.cardType !== 'monster') return false;
  G.myHand.splice(handIdx, 1);
  G.myField.push({
    id: c.id, name: card.name,
    atk: card.atk || 0, atkBase: card.atk || 0,
    summonedFrom: 'hand',
  });
  log(`패에서 소환: ${card.name}`, 'mine');
  selectedCardIdx = -1;
  sendGameState();
  onSummon(c.id, 'hand');
  return true;
}

function summonFromGrave(cardId) {
  if (G.myField.length >= maxFieldSlots()) {
    notify('몬스터 존이 가득 찼습니다.');
    return false;
  }
  const idx = G.myGrave.findIndex(c => c.id === cardId);
  if (idx < 0) return false;
  const c    = G.myGrave.splice(idx, 1)[0];
  const card = CARDS[cardId];
  G.myField.push({
    id: cardId, name: card.name,
    atk: card.atk || 0, atkBase: card.atk || 0,
    summonedFrom: 'grave',
  });
  log(`묘지에서 소환: ${card.name}`, 'mine');
  sendGameState();
  onSummon(cardId, 'grave');
  return true;
}

// ─────────────────────────────────────────────
// DRAW (통합 — drawOne / drawCards 단일 구현)
// ─────────────────────────────────────────────

/** 덱이 비었을 때 묘지를 셔플해서 덱으로 복구. 복구도 불가면 false 반환. */
function _recycleGraveIfNeeded() {
  if (G.myDeck.length > 0) return true;
  if (G.myGrave.length === 0) return false;
  G.myDeck  = shuffle(G.myGrave.map(c => ({ ...c })));
  G.myGrave = [];
  log('덱 소진! 묘지를 덱으로 되돌렸습니다.', 'system');
  return true;
}

/**
 * 1장 드로우. 덱·묘지 모두 비어있으면 null 반환.
 * 내부 상태만 변경하며 sendGameState는 호출하지 않음 → 호출자가 책임.
 */
function drawOne() {
  if (!_recycleGraveIfNeeded()) {
    notify('덱이 비었습니다.');
    return null;
  }
  const c = G.myDeck.shift();
  G.myHand.push({ id: c.id, name: c.name, isPublic: false });
  log(`드로우: ${c.name}`, 'mine');
  sendGameState();
  return c;
}

/** n장 드로우 */
function drawN(n) {
  for (let i = 0; i < n; i++) {
    if (!drawOne()) break; // 덱 소진 시 중단
  }
}

// ─────────────────────────────────────────────
// GRAVE / EXILE
// ─────────────────────────────────────────────
function sendToGrave(cardId, from = 'field') {
  if (from === 'field') {
    const idx = G.myField.findIndex(c => c.id === cardId);
    if (idx >= 0) {
      G.myGrave.push(G.myField.splice(idx, 1)[0]);
      log(`${CARDS[cardId]?.name || cardId} 묘지로`, 'mine');
      onSentToGrave(cardId);
    }
  } else if (from === 'hand') {
    const idx = G.myHand.findIndex(c => c.id === cardId);
    if (idx >= 0) {
      G.myGrave.push(G.myHand.splice(idx, 1)[0]);
    }
  }
  sendGameState();
}

// ─────────────────────────────────────────────
// SUMMON / GRAVE TRIGGER HOOKS
// ─────────────────────────────────────────────
function onSummon(cardId, from) {
  switch (cardId) {
    case '꼬마 펭귄':      triggerKkomaPenguin(from);   break;
    case '펭귄 부부':      triggerPenguinBubu(from);    break;
    case '펭귄 용사':      triggerPenguinHero(from);    break;
    case '펭귄의 전설':    triggerPenguinLegend(from);  break;
    case '펭귄 마법사':    triggerPenguinWizard(from);  break;
    case '전원소의 지배자': triggerJibaejaJeon2();      break;
    default: break;
  }
  renderAll();
}

function onSentToGrave(cardId) {
  if (cardId === '펭귄 용사') autoTriggerHeroGrave();
}

// ─────────────────────────────────────────────
// TURN RESET
// ─────────────────────────────────────────────
function resetTurnEffects() {
  resetEffectUsed();

  // 펭귄 용사 ATK 버프 해제
  if (G.penguinHeroAtkBuff) {
    G.myField.forEach(c => {
      if (isPenguinMonster(c.id)) c.atk = c.atkBase || CARDS[c.id]?.atk || 0;
    });
    G.penguinHeroAtkBuff = false;
  }

  // 수문장 펭귄 ATK 초기화
  G.myField.forEach(c => {
    if (c.id === '수문장 펭귄') c.atk = c.atkBase || 3;
  });

  resetJibaeEffects();
}

// ─────────────────────────────────────────────
// CARD INSTANCE ID (chain 소환 검증용)
// ─────────────────────────────────────────────
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
