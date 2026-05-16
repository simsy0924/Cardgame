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
  myDeck: [],         // {id, name}
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
  myExtraSlots: 0,
  opExtraSlots: 0,
  turn: 1,
  phase: 'draw',
  activePlayer: 'host', // 'host' | 'guest'
  penguinHeroAtkBuff: false,
  goldenAppleActive: false,
  exileBanActive: false,
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

// ─── 로그 타입별 아이콘 및 분류 ───
const LOG_META = {
  // 내 행동
  '서치':        { icon: '🔍', cls: 'mine' },
  '소환':        { icon: '✨', cls: 'mine' },
  '드로우':      { icon: '🃏', cls: 'mine' },
  '버림':        { icon: '🗑', cls: 'mine' },
  '발동':        { icon: '⚡', cls: 'mine' },
  '체인 1':      { icon: '⛓', cls: 'chain-open' },
  '체인 2':      { icon: '⛓', cls: 'chain-open' },
  '체인 3':      { icon: '⛓', cls: 'chain-open' },
  '체인 해제':   { icon: '✅', cls: 'chain-resolve' },
  '체인 패스':   { icon: '⏭', cls: 'system' },
  // 상대 행동
  '상대 소환':   { icon: '👾', cls: 'opponent' },
  '상대 서치':   { icon: '🔎', cls: 'opponent' },
  '상대 효과':   { icon: '💥', cls: 'opponent' },
  '🤖':          { icon: '',   cls: 'opponent' },
  // 전투
  '전투':        { icon: '⚔️', cls: 'system' },
  '직접 공격':   { icon: '🗡', cls: 'system' },
  '묘지':        { icon: '💀', cls: 'system' },
  // 시스템
  '턴':          { icon: '🔄', cls: 'system' },
  '게임':        { icon: '🎮', cls: 'system' },
  '드로우 단계': { icon: '📥', cls: 'system' },
};

function _classifyLog(msg, explicitType) {
  if (explicitType === 'mine')     return { icon: '▶', cls: 'mine' };
  if (explicitType === 'opponent') return { icon: '◀', cls: 'opponent' };
  if (explicitType === 'system')   return { icon: '◆', cls: 'system' };
  // 내용 기반 분류
  for (const [key, meta] of Object.entries(LOG_META)) {
    if (msg.includes(key)) return meta;
  }
  return { icon: '·', cls: '' };
}

// 카드명을 <span class="log-card">으로 감싸기
// 단일 정규식 alternation으로 처리 → 긴 이름이 먼저 매칭되어 부분 이름 이중래핑 방지
let _highlightRegex = null;
function _buildHighlightRegex() {
  if (_highlightRegex) return _highlightRegex;
  const names = Object.keys(CARDS || {}).sort((a, b) => b.length - a.length);
  if (!names.length) return null;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  _highlightRegex = new RegExp(`(${escaped.join('|')})`, 'g');
  return _highlightRegex;
}
function _highlightCardNames(msg) {
  const pattern = _buildHighlightRegex();
  if (!pattern) return msg;
  pattern.lastIndex = 0;
  return msg.replace(pattern, '<span class="log-card">$1</span>');
}

function log(msg, type = '') {
  const container = document.getElementById('logEntries');
  if (!container) return;

  const meta = _classifyLog(msg, type);
  const el = document.createElement('div');
  el.className = `log-entry ${meta.cls || type}`;

  // 아이콘
  const iconEl = document.createElement('span');
  iconEl.className = 'log-icon';
  iconEl.textContent = meta.icon || (type === 'mine' ? '▶' : type === 'opponent' ? '◀' : '◆');
  el.appendChild(iconEl);

  // 텍스트 (카드명 강조 포함)
  const textEl = document.createElement('span');
  textEl.className = 'log-text';
  textEl.innerHTML = _highlightCardNames(msg);
  el.appendChild(textEl);

  container.prepend(el);
  while (container.children.length > 80) container.lastChild.remove();

  // 내 행동(mine)과 시스템 로그는 상대에게 전송
  if ((type === 'mine' || type === 'system') && typeof roomRef !== 'undefined' && roomRef) {
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

    const container = document.getElementById('logEntries');
    if (!container) return;

    // system 로그는 그대로, mine 로그는 '[상대] ' 접두어 추가 후 opponent 타입으로
    const displayType = data.type === 'system' ? 'system' : 'opponent';
    const displayMsg  = data.type === 'system' ? data.msg : '[상대] ' + data.msg;

    // 리치 로그 형식으로 렌더링
    const meta = _classifyLog(displayMsg, displayType);
    const el = document.createElement('div');
    el.className = `log-entry ${meta.cls || displayType}`;

    const iconEl = document.createElement('span');
    iconEl.className = 'log-icon';
    iconEl.textContent = meta.icon || (displayType === 'opponent' ? '◀' : '◆');
    el.appendChild(iconEl);

    const textEl = document.createElement('span');
    textEl.className = 'log-text';
    textEl.innerHTML = typeof _highlightCardNames === 'function'
      ? _highlightCardNames(displayMsg)
      : displayMsg;
    el.appendChild(textEl);

    container.prepend(el);
    while (container.children.length > 80) container.lastChild.remove();
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
function maxFieldSlots(controller = 'me') {
  if (window.HB_CONTINUOUS_ENGINE && typeof window.HB_CONTINUOUS_ENGINE.getAvailableMonsterZoneCount === 'function') {
    try { return window.HB_CONTINUOUS_ENGINE.getAvailableMonsterZoneCount(controller, G); }
    catch (err) { console.warn('[engine] 지속 효과 기반 몬스터 존 수 계산 실패:', err); }
  }
  const owner = controller === 'opponent' || controller === 'op' || controller === 'enemy' ? 'opponent' : 'me';
  const extra = owner === 'opponent' ? (G.opExtraSlots || 0) : (G.myExtraSlots || 0);
  return Math.max(0, 5 + Number(extra || 0));
}

function summonFromDeck(cardId) {
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
  const card = CARDS[cardId];
  if (!card || card.cardType !== 'monster') { notify('몬스터만 소환할 수 있습니다.'); return false; }
  if (!removeFromDeck(cardId)) return false;
  G.myField.push({ id: cardId, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0, summonedFrom: 'deck' });
  log(`덱에서 소환: ${card.name}`, 'mine');
  sendGameState(); onSummon(cardId, 'deck'); return true;
}
function summonFromHand(handIdx) {
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
  const c = G.myHand[handIdx];
  if (!c) return false;
  const card = CARDS[c.id];
  if (!card || card.cardType !== 'monster') return false;
  G.myHand.splice(handIdx, 1);
  G.myField.push({ id: c.id, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0, summonedFrom: 'hand' });
  log(`패에서 소환: ${card.name}`, 'mine'); selectedCardIdx = -1;
  sendGameState(); onSummon(c.id, 'hand'); return true;
}
function summonFromGrave(cardId) {
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
  const card = CARDS[cardId];
  if (!card || card.cardType !== 'monster') { notify('몬스터만 소환할 수 있습니다.'); return false; }
  const idx = G.myGrave.findIndex(c => c.id === cardId);
  if (idx < 0) return false;
  const c = G.myGrave.splice(idx, 1)[0];
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

/**
 * sendToExile(card, from)
 * 내 카드를 제외 존으로 보내는 중앙 함수.
 * G.myExile.push 대신 이 함수를 써야 크툴루 제외 트리거가 작동한다.
 * card: { id, name } 객체 또는 cardId 문자열
 * from: 'field' | 'hand' | 'grave' | 'deck' (기본 'field')
 */
function sendToExile(card, from = 'field') {
  const cardObj = (typeof card === 'string') ? { id: card, name: CARDS[card]?.name || card } : card;
  if (!cardObj) return;
  G.myExile.push(cardObj);
  // 크툴루 제외 트리거
  if (typeof window._onCthulhuExiled === 'function') window._onCthulhuExiled(cardObj.id);
}
function onSummon(cardId, from) {
  // 15단계: 신엔진 카드/신엔진 유발 후보가 있으면 레거시 onSummon switch를 타지 않는다.
  if (window.HB_LEGACY_BRIDGE) {
    const routed = window.HB_LEGACY_BRIDGE.routeSummonTrigger({
      gameState: G,
      type: 'summon',
      cardId,
      card: { id: cardId, name: CARDS[cardId]?.name || cardId },
      controller: 'me',
      sourceController: 'me',
      sourceZone: 'field',
      from,
    }, { gameState: G });
    if (routed && routed.usedNewEngine) { renderAll(); return; }
  }

  // 황금사과 드로우는 handleOpponentAction('summon')에서 처리
  switch(cardId) {
    case '꼬마 펭귄': triggerKkomaPenguin(from); break;
    case '펭귄 부부': triggerPenguinBubu(from); break;
    case '펭귄 용사': triggerPenguinHero(from); break;
    case '펭귄의 전설': triggerPenguinLegend(from); break;
    case '펭귄 마법사': triggerPenguinWizard(from); break;
    case '전원소의 지배자': triggerJibaejaJeon2(); break;
    // ── 크툴루/올드원 소환 유발 ──
    case '엘더 갓-크타니트':
      // ①은 제외에서 소환 시 트리거(exile hook에서 처리)
      // ②: 이 카드를 소환했을 경우 — 패/제외에서 소환 모두 해당
      if (typeof _triggerCthulhuOnSummon === 'function') _triggerCthulhuOnSummon(cardId, from);
      break;
    case '아우터 갓 니알라토텝':
      // ②: 소환했을 경우 or 상대 턴에 — 소환 시 유발
      if (typeof _triggerCthulhuOnSummon === 'function') _triggerCthulhuOnSummon(cardId, from);
      break;
    case '아우터 갓 슈브 니구라스':
      // ①: GOO가 소환됐을 경우 이 카드를 소환하고 발동 → 별도 훅에서 처리
      if (typeof _triggerShubniggurath1 === 'function') _triggerShubniggurath1(cardId, from);
      break;
    case '그레이트 올드 원-크툴루':
    case '그레이트 올드 원-크투가':
    case '그레이트 올드 원-크아이가':
    case '그레이트 올드 원-과타노차':
      // GOO 소환 → 슈브 니구라스 ① 트리거 체크
      if (typeof _triggerShubniggurath1 === 'function') _triggerShubniggurath1(null, from);
      break;
    case '엘리멘츠의 불꽃정령':
    case '엘리멘츠의 물정령':
    case '엘리멘츠의 전기정령':
    case '엘리멘츠의 바람정령':
      if (window.THEME_EFFECT_HANDLERS?.['엘리멘츠']?.onElementsSummoned) {
        window.THEME_EFFECT_HANDLERS['엘리멘츠'].onElementsSummoned(cardId);
      }
      break;
  }
  renderAll();
}
function onSentToGrave(cardId) {
  // 15단계: 신엔진 카드/신엔진 묘지 유발 후보가 있으면 레거시 묘지 트리거를 타지 않는다.
  if (window.HB_LEGACY_BRIDGE) {
    const routed = window.HB_LEGACY_BRIDGE.routeSentToGraveTrigger({
      gameState: G,
      type: 'sentToGrave',
      cardId,
      card: { id: cardId, name: CARDS[cardId]?.name || cardId },
      controller: 'me',
      sourceController: 'me',
      sourceZone: 'grave',
    }, { gameState: G });
    if (routed && routed.usedNewEngine) return;
  }

  if (cardId === '펭귄 용사') autoTriggerHeroGrave();
  if (cardId === '엘리멘츠의 바람정령' && canUseEffect('엘리멘츠의 바람정령', 3)) {
    markEffectUsed('엘리멘츠의 바람정령', 3);
    const t = findAllInDeck(c => c.id === '엘리멘츠 in rainbow forest');
    if (t.length > 0) {
      searchToHand('엘리멘츠 in rainbow forest');
      log('엘리멘츠의 바람정령 ③: 엘리멘츠 in rainbow forest 서치', 'mine');
    }
  }
  // ── 크툴루/올드원 묘지 트리거 ──
  if (typeof _onCthulhuSentToGrave === 'function') _onCthulhuSentToGrave(cardId);
}

// ─────────────────────────────────────────────────────────────
// 중앙화된 내성 시스템
// checkImmunity(cardId, effectType, source)
//   cardId    : 효과를 받을 내 필드 카드 id
//   effectType: 'effect'(일반/비대상) | 'target'(대상 지정) | 'toGrave'(묘지로) | 'attack'(공격 대상)
//   source    : 'opponent'(상대) | 'mine'(자신) | 'combat'(전투)
// 반환: { immune: true, reason: '...' } | { immune: false }
// ─────────────────────────────────────────────────────────────
function checkImmunity(cardId, effectType, source = 'opponent') {
  // 아우터 갓-아자토스 ①: 모든 카드 효과 차단 + 묘지로 안 보내짐
  if (cardId === '아우터 갓-아자토스') {
    if (effectType === 'effect' || effectType === 'target' || effectType === 'toGrave') {
      return { immune: true, reason: '아자토스 ①: 다른 카드의 효과를 받지 않으며 묘지로 보내지지 않습니다.' };
    }
  }

  // 아우터 갓 슈브 니구라스 ③: 상대 카드 효과 차단 + 공격 대상 안 됨
  if (cardId === '아우터 갓 슈브 니구라스' && source === 'opponent') {
    if (effectType === 'effect' || effectType === 'target' || effectType === 'attack') {
      return { immune: true, reason: '슈브 니구라스 ③: 상대 카드의 효과를 받지 않습니다.' };
    }
  }

  // 히프노스 ②: 히프노스가 필드에 있는 한, 상대는 다른 카드를 효과 대상으로 지정 불가
  if (cardId !== '엘더 갓-히프노스' && source === 'opponent' && effectType === 'target') {
    if (G.myField.some(c => c.id === '엘더 갓-히프노스')) {
      return { immune: true, reason: '히프노스 ②: 상대는 히프노스 이외의 카드를 효과 대상으로 지정할 수 없습니다.' };
    }
  }
  if (cardId === '펭귄의 전설' && source === 'opponent') {
    if (effectType === 'effect') {
      if (G.myField.some(c => c.id === '펭귄의 전설')) {
        return { immune: true, reason: '펭귄의 전설 ③: 대상으로 하지 않는 효과를 받지 않습니다.' };
      }
    }
  }

  // 에이스 라이온 ③: 에이스 라이온이 필드에 있는 한, 라이온 카드는 전투로 묘지 안 감
  if (effectType === 'toGrave' && source === 'combat') {
    if (CARDS[cardId]?.theme === '라이온' && G.myField.some(c => c.id === '에이스 라이온')) {
      return { immune: true, reason: '에이스 라이온 ③: 라이온 카드는 전투로 묘지로 보내지지 않습니다.' };
    }
  }

  // 타이거 킹 ④: 자신 필드에 다른 몬스터가 없을 경우 묘지로 안 보내짐
  if (cardId === '타이거 킹' && effectType === 'toGrave') {
    if (G.myField.filter(c => c.id !== '타이거 킹').length === 0) {
      return { immune: true, reason: '타이거 킹 ④: 다른 몬스터가 없으면 묘지로 보내지지 않습니다.' };
    }
  }

  // 라이거 킹: 베이비 라이거 ③ 효과로 이 턴 내성 부여 (G.ligerKingImmune 플래그)
  if (cardId === '라이거 킹' && source === 'opponent' && G.ligerKingImmune) {
    if (effectType === 'effect' || effectType === 'target') {
      return { immune: true, reason: '라이거 킹: 이 턴 상대 효과를 받지 않습니다.' };
    }
  }

  return { immune: false };
}

// 내성 체크 후 묘지로 보내는 헬퍼
// 반환: true = 실제로 묘지로 보냄, false = 내성으로 차단
function sendToGraveWithImmunityCheck(cardId, from = 'field', source = 'opponent') {
  if (from === 'field') {
    const result = checkImmunity(cardId, 'toGrave', source);
    if (result.immune) {
      log(`내성: ${result.reason}`, 'system');
      notify(result.reason);
      return false;
    }
  }
  sendToGrave(cardId, from);
  return true;
}


function isMyFieldCardEffectNegated(cardId) {
  if (!cardId) return false;
  const mon = G.myField.find(c => c && c.id === cardId && c.effectNegatedUntilEndTurn);
  if (mon) return true;
  return !!(G.myFieldCard && G.myFieldCard.id === cardId && G.myFieldCard.effectNegatedUntilEndTurn);
}

function resetTurnEffects() {
  resetEffectUsed();
  if (G.penguinHeroAtkBuff) { G.myField.forEach(c => { if (isPenguinMonster(c.id)) c.atk = c.atkBase || CARDS[c.id]?.atk || 0; }); G.penguinHeroAtkBuff = false; }
  G.myField.forEach(c => { if (c.id === '수문장 펭귄') c.atk = c.atkBase || 3; });
  G.ligerKingImmune = false; // 라이거 킹 내성 턴 종료 시 해제
  G.myField.forEach(c => { if (c) c.effectNegatedUntilEndTurn = false; });
  if (G.myFieldCard) G.myFieldCard.effectNegatedUntilEndTurn = false;
  resetJibaeEffects();
}