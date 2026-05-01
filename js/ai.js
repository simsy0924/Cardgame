// ============================================================
// ai.js — AI 대전 모듈 v3.0 (완전 재설계)
// 로드 순서: patch.js → ai.js (맨 마지막)
//
// 변경 핵심:
//  1. 이중 훅 제거 → 단일 통합 훅 (_setupChainHooks 1회만)
//  2. AI 효과를 실제 CHAIN_RESOLVERS / handleOpponentAction 경로로 실행
//  3. 체인 흐름을 단방향 상태머신으로 재설계 (타이머 경쟁 없음)
//  4. Groq 프롬프트에 실제 카드 효과 텍스트 + 전황 분석 포함
//  5. 소환 유발효과 → 실제 게임 엔진 함수 위임 (opponenet action 경로)
// ============================================================
'use strict';

/* ── Worker URL (Cloudflare) ── */
var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

/* ══════════════════════════════════════════════════════════
   AI 글로벌 상태
═══════════════════════════════════════════════════════════ */
window.AI = {
  active:      false,
  thinking:    false,
  opDeck:      [],
  deckPreset:  null,
  usedFx:      {},       // { 'cardId_n': true }
  attacked:    new Set(),
  // 체인 상태머신 — 단일 진입점
  chain: {
    handling:  false,    // AI가 현재 체인을 처리 중
    timer:     null,     // 폴백 타이머 (단 하나)
    watcher:   null,     // setInterval 감시자
    lastSig:   null,     // 중복 처리 방지 시그니처
  },
};

/* 슬립 유틸 */
var _s = ms => new Promise(r => setTimeout(r, ms));

/* ══════════════════════════════════════════════════════════
   안전 훅 유틸 — 동일 함수 2중 래핑 방지
═══════════════════════════════════════════════════════════ */
var _hookedSet = new Set();
function _safeHook(name, wrapper) {
  if (_hookedSet.has(name)) return false; // 이미 훅됨 → 스킵
  var orig = window[name];
  if (typeof orig !== 'function') return false;
  window[name] = wrapper(orig);
  _hookedSet.add(name);
  return true;
}

/* ══════════════════════════════════════════════════════════
   핵심 훅 등록 (ai.js 로드 시 1회)
═══════════════════════════════════════════════════════════ */

// enterGameWithDeck → AI 세팅
_safeHook('enterGameWithDeck', orig => function() {
  orig.apply(this, arguments);
  if (window.AI.active) _setupAI();
});

// endTurn → AI 턴 트리거
_safeHook('endTurn', orig => function() {
  orig.apply(this, arguments);
  if (window.AI.active && !isMyTurn) setTimeout(_aiTurn, 700);
});

// checkWinCondition → AI 패 0장 감지
_safeHook('checkWinCondition', orig => function() {
  if (!window.AI.active) { orig.apply(this, arguments); return; }
  if (G.myHand.length === 0) { orig.apply(this, arguments); return; }
  if (G.opHand.length === 0) showGameOver(true);
});

/* ══════════════════════════════════════════════════════════
   체인 훅 — 단일 통합 (IIFE 별도 훅 없음)
═══════════════════════════════════════════════════════════ */
function _setupChainHooks() {
  // beginChain — 플레이어가 체인1 시작 → AI 응답 기회
  _safeHook('beginChain', orig => function(effect) {
    orig.apply(this, arguments);
    if (window.AI.active) _onChainUpdated('beginChain');
  });

  // addChainLink — 플레이어가 링크 추가 → AI 응답 기회
  _safeHook('addChainLink', orig => function(effect, opts) {
    orig.apply(this, arguments);
    if (window.AI.active) _onChainUpdated('addChainLink');
  });

  // passChainPriority — 플레이어 패스 → AI 응답 트리거
  // [수정] orig.apply() 후 항상 _onChainUpdated를 호출.
  //        원본 passChainPriority가 AI 모드일 때 priority를 'guest'로 바꾸고 return하므로
  //        래퍼에서 _onChainUpdated를 이어서 호출해야 AI가 반응함.
  _safeHook('passChainPriority', orig => function() {
    if (!window.AI.active) { orig.apply(this, arguments); return; }

    // 원본 실행 (AI 모드면 priority를 guest로 바꾸고 return)
    orig.apply(this, arguments);

    // 원본 실행 후 체인이 여전히 활성이면 AI 응답 트리거
    var live = activeChainState;
    if (live && live.active && live.priority === 'guest') {
      _onChainUpdated('passChainPriority');
    }
  });

  // resolveChain → AI 체인 상태 초기화
  _safeHook('resolveChain', orig => function(chainState) {
    _clearAIChainTimer();
    // 자동 패스 타이머도 클리어
    if (window._chainAutoPassTimer) {
      clearTimeout(window._chainAutoPassTimer);
      window._chainAutoPassTimer = null;
    }
    window.AI.chain.handling = false;
    window.AI.chain.lastSig  = null;
    return orig.apply(this, arguments);
  });
}

/* ── 체인 업데이트 단일 진입점 ── */
function _onChainUpdated(source) {
  var live = activeChainState;
  if (!live || !live.active) return;
  if (live.priority !== 'guest') return; // AI 차례가 아님

  var sig = _chainSig(live);
  if (sig === window.AI.chain.lastSig) return; // 이미 처리한 상태

  // 기존 타이머 정리 후 단일 타이머로만 스케줄
  _clearAIChainTimer();
  var delay = (source === 'passChainPriority') ? 450 : 380;
  window.AI.chain.timer = setTimeout(() => _runAIChainResponse(), delay);
}

/* ── 체인 시그니처 (중복 방지) ── */
function _chainSig(state) {
  if (!state || !state.active) return '';
  var links = (state.links || []).map(l => `${l.by}:${l.type}`).join('|');
  return `${state.chainId || ''}|${links}#${state.priority}#${state.passCount}`;
}

function _clearAIChainTimer() {
  if (window.AI.chain.timer) {
    clearTimeout(window.AI.chain.timer);
    window.AI.chain.timer = null;
  }
}

/* ── 체인 감시자 (폴백) ── */
function _startChainWatcher() {
  if (window.AI.chain.watcher) return;
  window.AI.chain.watcher = setInterval(() => {
    if (!window.AI.active) return;
    var live = activeChainState;
    if (!live || !live.active) return;
    if (live.priority !== 'guest') return;
    var sig = _chainSig(live);
    if (sig === window.AI.chain.lastSig) return;
    if (window.AI.chain.timer) return; // 이미 예약됨
    // 500ms 내에 아무것도 없으면 폴백 트리거
    window.AI.chain.timer = setTimeout(() => _runAIChainResponse(), 500);
  }, 600);
}

/* ══════════════════════════════════════════════════════════
   AI 체인 응답 메인 함수 (단일 진입점)
═══════════════════════════════════════════════════════════ */
function _runAIChainResponse() {
  _clearAIChainTimer();
  if (!window.AI.active) return;
  var live = activeChainState;
  if (!live || !live.active) return;
  if (live.priority !== 'guest') return;

  var sig = _chainSig(live);
  if (sig === window.AI.chain.lastSig) return;
  window.AI.chain.lastSig = sig; // 처리 마킹

  // 응답 가능 조건: 마지막 링크가 플레이어 것이거나 플레이어가 패스
  var links = live.links || [];
  var last  = links[links.length - 1] || {};
  var playerActedLast = (last.by === 'host' || last.by === myRole);
  var playerPassed    = (live.passCount || 0) > 0;
  if (!playerActedLast && !playerPassed) return;

  // 응답 옵션 수집
  var options = _collectAIChainOptions(live);
  options.sort((a, b) => (b.score || 0) - (a.score || 0));
  var best = options[0] || null;

  if (!best) {
    // 패스
    setTimeout(() => {
      var cur = activeChainState;
      if (!cur || !cur.active) return;
      var next = Object.assign({}, cur);
      next.passCount = (next.passCount || 0) + 1;
      next.priority  = myRole;
      activeChainState = next;
      window.AI.chain.lastSig = _chainSig(next);
      log('🤖 AI: 체인 패스', 'opponent');

      if (next.passCount >= 2) {
        resolveChain(next);
      } else {
        renderChainActions();
        if (!_playerHasChainResponse()) {
          // 플레이어 응답 불가 → 즉시 resolve
          var fin = Object.assign({}, next);
          fin.passCount = 2;
          resolveChain(fin);
        } else {
          // 플레이어에게 응답 기회 — 5초 내 반응 없으면 자동 패스
          notify('체인 패스 — 응답하거나 패스하세요.');
          var _autoPassT = setTimeout(() => {
            var cur = activeChainState;
            if (!cur || !cur.active) return;
            if (cur.priority !== myRole) return;
            log('⏱ 체인 자동 패스', 'system');
            passChainPriority();
          }, 5000);
          // resolveChain 훅에서 타이머 클리어 — window에 임시 저장
          window._chainAutoPassTimer = _autoPassT;
        }
      }
    }, 600);
    return;
  }

  // 카드 효과 발동
  // activate()가 _collectAIChainOptions의 래핑된 addChainLink를 호출해
  // 체인 상태를 이미 업데이트함 → 중복 업데이트 없이 후처리만
  setTimeout(() => {
    var cur = activeChainState;
    if (!cur || !cur.active) return;

    // activate 실행 — 내부에서 addChainLink(AI용)가 호출되어 체인 상태 갱신
    best.activate();

    // activate 후 체인 상태 확인
    var updated = activeChainState;
    if (!updated || !updated.active) return;

    log('🤖 ' + best.label + ' 체인 발동!', 'opponent');
    renderChainActions();
    renderAll();

    if (_playerHasChainResponse()) {
      notify('체인 ' + (updated.links || []).length + ': ' + best.label + '. 응답 또는 패스를 선택하세요.');
    } else {
      // 플레이어 응답 불가 → resolve
      setTimeout(() => {
        var fin = Object.assign({}, activeChainState || updated);
        fin.passCount = 2;
        resolveChain(fin);
      }, 300);
    }
  }, 420);
}

/* 플레이어가 현재 체인에 응답할 카드를 갖고 있는지 확인
 * collectChainOptions()를 그대로 사용 — 플레이어 레지스트리 기반으로 판단
 */
function _playerHasChainResponse() {
  if (!activeChainState || !activeChainState.active) return false;
  if (typeof collectChainOptions !== 'function') return false;
  return collectChainOptions().length > 0;
}

/* ══════════════════════════════════════════════════════════
   AI 모드 진입
═══════════════════════════════════════════════════════════ */
window.startAIMode = function() {
  window.AI.active = true;
  window.roomRef   = null;
  window.myRole    = 'host';

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool    === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

/* ══════════════════════════════════════════════════════════
   AI 덱 빌드
═══════════════════════════════════════════════════════════ */
function _buildAIDeck() {
  var pd = window._confirmedDeck || [];
  var tc = {};
  pd.forEach(id => {
    var t = CARDS[id] && CARDS[id].theme;
    if (t) tc[t] = (tc[t] || 0) + 1;
  });
  var top = '펭귄', topN = 0;
  Object.keys(tc).forEach(t => { if (tc[t] > topN) { topN = tc[t]; top = t; } });
  var cm = {
    '펭귄':'크툴루','올드원':'펭귄','라이온':'타이거',
    '타이거':'라이온','라이거':'펭귄','지배자':'크툴루',
    '마피아':'펭귄','불가사의':'펭귄',
  };
  window.AI.deckPreset = cm[top] || '크툴루';

  var list = _aiDeckList(window.AI.deckPreset).filter(id => !!CARDS[id]);
  while (list.length < 40) list.push('구사일생');

  window.AI.opDeck  = shuffle(list.map(id => ({ id, name: CARDS[id].name })));
  window.AI.usedFx  = {};
  window.AI.attacked = new Set();
  window.AI.chain    = { handling: false, timer: null, watcher: null, lastSig: null };
}

/* ══════════════════════════════════════════════════════════
   게임 세팅 (enterGameWithDeck 직후)
═══════════════════════════════════════════════════════════ */
function _setupAI() {
  if (!window.AI.active) return;
  _buildAIDeck();

  G.opHand      = [];
  G.opField     = [];
  G.opGrave     = [];
  G.opExile     = [];
  G.opFieldCard = null;
  G.opKeyDeck   = _aiKeyList(window.AI.deckPreset);
  G.opDeckCount = window.AI.opDeck.length;

  for (var i = 0; i < 7; i++) _aiDrawOne();

  document.getElementById('hdrOpName').textContent   = '🤖 AI (' + window.AI.deckPreset + ')';
  document.getElementById('opNameLabel').textContent = '🤖 AI';

  gameClock = { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() };

  _aiBanner();
  log('🤖 AI (' + window.AI.deckPreset + ') 후공 참전! 패 ' + G.opHand.length + '장', 'system');

  isMyTurn = true;
  advancePhase('deploy');
  renderAll();
  setTimeout(() => { if (window.AI.active) { isMyTurn = true; advancePhase('deploy'); renderAll(); } }, 150);

  // 훅 & 감시자 등록
  _setupChainHooks();
  _startChainWatcher();
}

/* ══════════════════════════════════════════════════════════
   AI 내부 조작 함수들
═══════════════════════════════════════════════════════════ */
function _aiDrawOne() {
  if (!window.AI.opDeck.length) { log('🤖 AI 덱 아웃!', 'system'); showGameOver(true); return false; }
  var c = window.AI.opDeck.shift();
  G.opHand.push({ id: c.id, name: c.name });
  G.opDeckCount = window.AI.opDeck.length;
  return true;
}
function _aiDrawN(n) { for (var i = 0; i < n; i++) if (!_aiDrawOne()) return false; return true; }

function _aiRemHand(cardId) {
  var i = G.opHand.findIndex(c => c.id === cardId);
  if (i >= 0) G.opHand.splice(i, 1);
}

function _aiSummon(cardId) {
  var card = CARDS[cardId];
  if (!card || card.cardType !== 'monster') return false;
  if (G.opField.length >= maxFieldSlots()) { log('🤖 몬스터 존 가득', 'opponent'); return false; }
  _aiRemHand(cardId);
  G.opField.push({ id: cardId, name: card.name, atk: card.atk ?? 0, atkBase: card.atk ?? 0 });
  log(`🤖 소환: ${card.name} ATK${card.atk ?? 0}`, 'opponent');
  handleOpponentAction({ type: 'summon', cardId, by: 'guest', ts: Date.now(), localApplied: true });
  return true;
}

function _aiSummonFromDeck(cardId) {
  var idx = window.AI.opDeck.findIndex(c => c.id === cardId);
  if (idx < 0) return false;
  if (G.opField.length >= maxFieldSlots()) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opDeckCount = window.AI.opDeck.length;
  var card = CARDS[cardId] || {};
  G.opField.push({ id: cardId, name: card.name || cardId, atk: card.atk ?? 0, atkBase: card.atk ?? 0 });
  log(`🤖 덱→소환: ${card.name || cardId}`, 'opponent');
  handleOpponentAction({ type: 'summon', cardId, by: 'guest', ts: Date.now(), localApplied: true });
  return true;
}

function _aiDiscard(cardId) {
  _aiRemHand(cardId);
  var name = CARDS[cardId] ? CARDS[cardId].name : cardId;
  G.opGrave.push({ id: cardId, name });
  handleOpponentAction({ type: 'discard', cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiSearch(cardId) {
  var idx = window.AI.opDeck.findIndex(c => c.id === cardId);
  if (idx < 0) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opDeckCount = window.AI.opDeck.length;
  var name = CARDS[cardId] ? CARDS[cardId].name : cardId;
  G.opHand.push({ id: cardId, name });
  log(`🤖 서치: ${name}`, 'opponent');
  handleOpponentAction({ type: 'search', cardName: name, by: 'guest', ts: Date.now() });
  return true;
}

function _aiSetFieldCard(cardId) {
  // 덱 또는 묘지에서 찾기
  var fromDeck  = window.AI.opDeck.findIndex(c => c.id === cardId);
  var fromGrave = G.opGrave.findIndex(c => c.id === cardId);
  if (fromDeck >= 0) { window.AI.opDeck.splice(fromDeck, 1); G.opDeckCount = window.AI.opDeck.length; }
  else if (fromGrave >= 0) { G.opGrave.splice(fromGrave, 1); }
  var card = CARDS[cardId] || {};
  G.opFieldCard = { id: cardId, name: card.name || cardId };
  handleOpponentAction({ type: 'fieldCard', cardId, by: 'guest', ts: Date.now() });
  log(`🤖 필드 발동: ${card.name || cardId}`, 'opponent');
  return true;
}

function _aiExileFromPlayerField(count) {
  for (var i = 0; i < count && G.myField.length > 0; i++) {
    var c = G.myField.shift();
    G.myExile.push(c);
    log(`🤖 상대 ${c.name} 제외`, 'opponent');
  }
}

function _aiGraveFromPlayerField(count) {
  for (var i = 0; i < count && G.myField.length > 0; i++) {
    var c = G.myField.shift();
    G.myGrave.push(c);
    log(`🤖 상대 ${c.name} 묘지`, 'opponent');
  }
}

function _aiReturnToPlayerHand(count) {
  for (var i = 0; i < count && G.myField.length > 0; i++) {
    var c = G.myField.shift();
    G.myHand.push({ id: c.id, name: c.name });
    log(`🤖 상대 ${c.name} 패로 되돌림`, 'opponent');
  }
}

function _aiForcePlayerDiscard(count) {
  // 플레이어 패에서 count장 강제 버리기 → forceDiscard 사용
  if (typeof forceDiscard === 'function') forceDiscard(count);
  else {
    for (var i = 0; i < count && G.myHand.length > 0; i++) {
      var c = G.myHand.splice(Math.floor(Math.random() * G.myHand.length), 1)[0];
      G.myGrave.push(c);
    }
  }
}

function _aiAttack(atkId, defIdx) {
  if (window.AI.attacked.has(atkId)) return false;
  var fi = G.opField.findIndex(c => c.id === atkId);
  if (fi < 0 || !G.myField[defIdx]) return false;
  window.AI.attacked.add(atkId);
  var atk = G.opField[fi], def = G.myField[defIdx];
  log(`🤖 공격: ${atk.name}(${atk.atk}) → ${def.name}(${def.atk})`, 'opponent');
  handleOpponentAction({ type: 'combat', atkCard: { id: atk.id, name: atk.name, atk: atk.atk }, defCard: { id: def.id, name: def.name, atk: def.atk }, by: 'guest', ts: Date.now() });
  if (atk.atk !== 0 && atk.atk - def.atk <= 0) {
    var ri = G.opField.findIndex(c => c.id === atkId);
    if (ri >= 0) G.opGrave.push(G.opField.splice(ri, 1)[0]);
  }
  return true;
}

function _aiDirect(atkId) {
  if (G.myField.length > 0 || window.AI.attacked.has(atkId)) return false;
  var fi = G.opField.findIndex(c => c.id === atkId);
  if (fi < 0) return false;
  var atk = G.opField[fi];
  window.AI.attacked.add(atkId);
  log(`🤖 직접공격: ${atk.name}(${atk.atk})`, 'opponent');
  handleOpponentAction({ type: 'directAttack', card: { id: atk.id, name: atk.name, atk: atk.atk }, by: 'guest', ts: Date.now() });
  return true;
}

/* ══════════════════════════════════════════════════════════
   AI 턴 메인
═══════════════════════════════════════════════════════════ */
async function _aiTurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true;
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();

  try {
    // ① 드로우
    _setBanner('🤖 드로우 중...');
    if (currentPhase === 'draw') {
      if (!_aiDrawOne()) { window.AI.thinking = false; return; }
      log(`🤖 드로우 (패:${G.opHand.length} 덱:${window.AI.opDeck.length})`, 'opponent');
      gameClock.runningFor = 'guest';
      gameClock.lastUpdated = Date.now();
      advancePhase('deploy');
      await _s(400);
      renderAll();
    }

    // ② Groq 전략 계산
    _setBanner('🤖 전황 분석 중...');
    await _s(200);
    var plan;
    try   { plan = await _groq(); }
    catch (e) { console.warn('[AI Groq]', e.message); plan = _fallback(); }

    if (plan.thinking) {
      log(`🤖 「${plan.thinking}」`, 'opponent');
      await _s(350);
    }

    // ③ 전개 (소환 + 효과)
    _setBanner('🤖 전개 중...');
    await _aiDeploy(plan.deploy || []);

    // ④ 공격
    advancePhase('attack');
    await _s(300);
    renderAll();
    var atkPlan = (plan.attack && plan.attack.length) ? plan.attack : _buildAttackPlan();
    _setBanner('🤖 공격 중...');
    await _aiAttackPhase(atkPlan);

    // ⑤ 엔드
    advancePhase('end');
    await _s(200);
    _aiEnd();

  } catch (e) {
    console.error('[AI턴 오류]', e);
    try { advancePhase('end'); } catch(_) {}
    _aiEnd();
  }
}

/* ── 전개 페이즈 ── */
async function _aiDeploy(actions) {
  for (var act of actions) {
    if (!act || act.action !== 'summonFromHand' || !act.cardId) continue;
    if (!G.opHand.find(c => c.id === act.cardId)) continue;
    var cd = CARDS[act.cardId];
    if (!cd || cd.cardType !== 'monster') continue;

    _aiSummon(act.cardId);
    renderAll();
    await _s(400);

    // 소환 유발효과
    await _fireSummonTrigger(act.cardId);
    await _waitChainClear();
    renderAll();

    if (!isMyTurn && G.myHand.length === 0) break;
  }
}

/* ── 공격 페이즈 ── */
async function _aiAttackPhase(actions) {
  for (var act of actions) {
    if (!act) continue;
    if (act.action === 'attack') {
      var di = typeof act.targetIdx === 'number' ? act.targetIdx : 0;
      if (di < G.myField.length && G.opField.find(c => c.id === act.attackerId)) {
        _aiAttack(act.attackerId, di);
        await _s(800);
        renderAll();
      }
    } else if (act.action === 'directAttack') {
      if (G.myField.length === 0 && G.opField.find(c => c.id === act.attackerId)) {
        _aiDirect(act.attackerId);
        await _s(800);
        renderAll();
      }
    }
    if (G.myHand.length === 0) break;
  }
}

/* ── 체인 해소 대기 (안전한 폴링) ── */
function _waitChainClear() {
  return new Promise(resolve => {
    var maxWait = 8000; // 최대 8초
    var elapsed = 0;
    var tick = 120;
    var poll = setInterval(() => {
      elapsed += tick;
      if (!activeChainState || !activeChainState.active || elapsed >= maxWait) {
        clearInterval(poll);
        setTimeout(resolve, 200);
      }
    }, tick);
  });
}

/* ── AI 소환 유발효과 실행 ── */
async function _fireSummonTrigger(cardId) {
  var fn = window.AI_SUMMON_TRIGGERS && window.AI_SUMMON_TRIGGERS[cardId];
  if (!fn) return;
  try { await fn(_buildAICtx()); }
  catch(e) { console.error('[AI소환유발]', cardId, e); }
  renderAll();
}

/* ── AI 컨텍스트 빌더 ── */
function _buildAICtx() {
  var AI = window.AI;
  var u  = (id, n) => !!AI.usedFx[id + '_' + n];
  var m  = (id, n) => { AI.usedFx[id + '_' + n] = 1; };
  var findInDeck = pred => AI.opDeck.find(pred);

  // 체인 효과를 실행하는 함수 — _aiStartChainEffect 대신 직접 체인 상태 생성
  var chain = effect => new Promise(done => {
    _aiFireEffect(effect, done);
  });

  return { ai: AI, u, m, findInDeck,
    deckToField:    id => _aiSummonFromDeck(id),
    deckToHand:     id => _aiSearch(id),
    deckToFieldCard:id => _aiSetFieldCard(id),
    chain,
  };
}

/* ── AI 효과 발동 (단일 진입점) ── */
function _aiFireEffect(effect, afterResolve) {
  if (!window.AI.active) { afterResolve && afterResolve(); return; }

  var aiRole = 'guest'; // AI = 후공 = guest
  var link   = Object.assign({}, effect, { by: aiRole });

  if (activeChainState && activeChainState.active) {
    // 기존 체인에 링크 추가
    var next = Object.assign({}, activeChainState);
    next.links    = (next.links || []).concat([link]);
    next.passCount = 0;
    next.priority  = myRole; // 플레이어에게 우선권
    activeChainState = next;
    window.AI.chain.lastSig = _chainSig(next);
    log(`체인 ${next.links.length}: ${link.label || link.type} (AI)`, 'opponent');
    renderChainActions();
    renderAll();

    if (_playerHasChainResponse()) {
      notify(`체인 ${next.links.length}: ${link.label}. 응답 또는 패스를 선택하세요.`);
    }
    // afterResolve: 체인 끝날 때까지 대기
    _waitChainClear().then(() => afterResolve && afterResolve());
    return;
  }

  // 새 체인 1 개시 (AI 발동)
  var chainState = {
    chainId:   typeof nextChainId === 'function' ? nextChainId() : ('c_' + Date.now()),
    active:    true,
    startedBy: aiRole,
    priority:  myRole, // 플레이어 먼저 응답
    passCount: 0,
    links:     [link],
  };
  activeChainState = chainState;
  window.AI.chain.lastSig = _chainSig(chainState);
  log(`체인 1: ${link.label || link.type} (AI 발동)`, 'opponent');
  renderChainActions();
  renderAll();

  if (_playerHasChainResponse()) {
    notify(`상대가 ${link.label} 발동! 응답 또는 패스를 선택하세요.`);
    // 플레이어가 8초 내에 반응 안 하면 자동 패스
    var autoPassTimer = setTimeout(() => {
      var cur = activeChainState;
      if (!cur || !cur.active) return;
      if (cur.priority !== myRole) return; // 이미 AI 차례면 스킵
      log('⏱ 체인 자동 패스 (타임아웃)', 'system');
      passChainPriority();
    }, 8000);
    _waitChainClear().then(() => {
      clearTimeout(autoPassTimer);
      afterResolve && afterResolve();
    });
  } else {
    // 플레이어 응답 불가 → 즉시 resolve
    setTimeout(() => {
      var cur = activeChainState;
      if (!cur || !cur.active) { afterResolve && afterResolve(); return; }
      var fin = Object.assign({}, cur);
      fin.passCount = 2;
      resolveChain(fin);
    }, 300);
    _waitChainClear().then(() => afterResolve && afterResolve());
  }
}

/* ══════════════════════════════════════════════════════════
   AI 체인 응답 — collectChainOptions 재사용
   별도 AI 전용 레지스트리 없음. 플레이어와 동일한 CHAIN_HAND_RESPONSES/
   CHAIN_FIELD_RESPONSES를 사용하되, 전역 컨텍스트를 AI 데이터로 교체해서 실행.
   카드를 추가할 때 registerChainHandResponse()만 등록하면 AI도 자동 작동.
═══════════════════════════════════════════════════════════ */

function _aiCanUse(id, n)  { return !window.AI.usedFx[id + '_' + n]; }
function _aiMarkUsed(id, n){ window.AI.usedFx[id + '_' + n] = 1; }

/**
 * AI용 체인 옵션 수집.
 * collectChainOptions(aiCtx)에 AI 컨텍스트를 넘겨 플레이어 레지스트리를 그대로 실행.
 * activate() 내부에서 G.myHand/G.myGrave/addChainLink 등을 호출하는데,
 * 컨텍스트 스왑 덕분에 AI 데이터를 가리키게 됨.
 * 단, activate()의 addChainLink는 AI용 버전(by:'guest')으로 래핑해서 실행.
 */
function _collectAIChainOptions(live) {
  if (!live || !live.active) return [];

  // AI 컨텍스트 생성
  var aiCtx = {
    hand:     G.opHand,
    field:    G.opField,
    grave:    G.opGrave,
    exile:    G.opExile,
    keyDeck:  G.opKeyDeck || [],
    isMyTurn: false,      // AI는 항상 "상대 턴" 입장
    usedFx:   window.AI.usedFx,
  };

  // activate() 내부의 addChainLink, G.myGrave.push 등이
  // 컨텍스트 스왑으로 AI 데이터를 가리키므로
  // 추가로 addChainLink를 AI용으로 래핑
  var origAddChainLink = window.addChainLink;
  // AI 체인 응답 시: addChainLink 대신 직접 체인 상태 조작
  window.addChainLink = function(effect, opts) {
    if (!activeChainState || !activeChainState.active) return;
    var aiLink = Object.assign({}, effect, { by: 'guest' });
    var next = Object.assign({}, activeChainState);
    next.links    = (next.links || []).concat([aiLink]);
    next.passCount = 0;
    next.priority  = myRole; // 플레이어에게 우선권
    activeChainState = next;
    window.AI.chain.lastSig = typeof _chainSig === 'function' ? _chainSig(next) : null;
    log('🤖 ' + (effect.label || effect.type) + ' 체인 발동!', 'opponent');
    renderChainActions();
    renderAll();
  };

  var options;
  try {
    options = collectChainOptions(aiCtx);
  } finally {
    window.addChainLink = origAddChainLink;
  }

  return options;
}

/* ══════════════════════════════════════════════════════════
   AI 소환 유발효과 레지스트리
═══════════════════════════════════════════════════════════ */
window.AI_SUMMON_TRIGGERS = window.AI_SUMMON_TRIGGERS || {};
function registerAISummonTrigger(cardId, fn) {
  window.AI_SUMMON_TRIGGERS[cardId] = fn;
}

var D = ms => new Promise(r => setTimeout(r, ms));

/* ── 펭귄 테마 ── */
registerAISummonTrigger('꼬마 펭귄', async ctx => {
  if (ctx.u('꼬마 펭귄', 2)) return;
  var t = ctx.findInDeck(x => CARDS[x.id] && CARDS[x.id].theme === '펭귄' && CARDS[x.id].cardType === 'monster');
  if (!t) return; ctx.m('꼬마 펭귄', 2);
  await ctx.chain({ type: 'aiSummonDeck', label: '꼬마 펭귄 ②', cardId: t.id }); await D(300);
});

registerAISummonTrigger('수문장 펭귄', async ctx => {
  if (ctx.u('수문장 펭귄', 1) || G.opHand.length === 0) return;
  var fi = G.opField.findIndex(x => x.id === '수문장 펭귄');
  if (fi < 0) return; ctx.m('수문장 펭귄', 1);
  G.opField[fi].atk += 1;
  var weakest = G.opHand.reduce((a, b) => (CARDS[a.id]?.atk || 0) <= (CARDS[b.id]?.atk || 0) ? a : b);
  _aiDiscard(weakest.id);
  await ctx.chain({ type: 'aiForceDiscard', label: '수문장 펭귄 ①', count: 1 }); await D(300);
});

registerAISummonTrigger('펭귄 용사', async ctx => {
  if (ctx.u('펭귄 용사', 1)) return; ctx.m('펭귄 용사', 1);
  var ph = ctx.findInDeck(x => CARDS[x.id] && CARDS[x.id].theme === '펭귄');
  var pm = ctx.findInDeck(x => CARDS[x.id] && CARDS[x.id].theme === '펭귄' && CARDS[x.id].cardType === 'monster' && x.id !== ph?.id);
  if (ph) { ctx.deckToHand(ph.id); log(`🤖 펭귄 용사 ①: 서치 ${ph.id}`, 'opponent'); }
  if (pm) { ctx.deckToField(pm.id); await D(300); }
  await D(200);
});

registerAISummonTrigger('펭귄의 전설', async ctx => {
  if (ctx.u('펭귄의 전설', 1)) return;
  var graves = G.opGrave.filter(x => x.id === '꼬마 펭귄').slice(0, 2);
  if (!graves.length) return; ctx.m('펭귄의 전설', 1);
  for (var g of graves) {
    var gi = G.opGrave.findIndex(x => x.id === g.id);
    if (gi >= 0) { var card = G.opGrave.splice(gi, 1)[0]; G.opField.push(Object.assign({ atk: CARDS[card.id]?.atk || 0, atkBase: CARDS[card.id]?.atk || 0 }, card)); }
  }
  log(`🤖 펭귄의 전설 ①: 묘지 부활`, 'opponent'); await D(300);
});

registerAISummonTrigger('펭귄 마법사', async ctx => {
  if (ctx.u('펭귄 마법사', 2) || G.opHand.length === 0 || G.myField.length === 0) return;
  ctx.m('펭귄 마법사', 2);
  var dc = Math.min(3, G.opHand.length, G.myField.length);
  for (var i = 0; i < dc; i++) if (G.opHand.length > 0) _aiDiscard(G.opHand[G.opHand.length - 1].id);
  await ctx.chain({ type: 'aiExileOpField', label: '펭귄 마법사 ②', count: dc }); await D(300);
});

/* ── 크툴루 테마 ── */
registerAISummonTrigger('그레이트 올드 원-크툴루', async ctx => {
  if (ctx.u('그레이트 올드 원-크툴루', 1) || G.opFieldCard) return;
  var t = ctx.findInDeck(x => x.id === '태평양 속 르뤼에');
  if (!t) return; ctx.m('그레이트 올드 원-크툴루', 1);
  await ctx.chain({ type: 'aiFieldCard', label: '크툴루 ①', cardId: '태평양 속 르뤼에' }); await D(300);
});

registerAISummonTrigger('그레이트 올드 원-크투가', async ctx => {
  if (ctx.u('그레이트 올드 원-크투가', 2)) return; ctx.m('그레이트 올드 원-크투가', 2);
  var t = ctx.findInDeck(x => CARDS[x.id]?.name?.startsWith('그레이트 올드 원'));
  if (t) { await ctx.chain({ type: 'aiSummonDeck', label: '크투가 ②', cardId: t.id }); await D(300); }
});

registerAISummonTrigger('그레이트 올드 원-크아이가', async ctx => {
  if (ctx.u('그레이트 올드 원-크아이가', 2) || G.myField.length === 0) return;
  ctx.m('그레이트 올드 원-크아이가', 2);
  await ctx.chain({ type: 'aiGraveOpField', label: '크아이가 ②', count: Math.min(2, G.myField.length) }); await D(300);
});

registerAISummonTrigger('엘더 갓-크타니트', async ctx => {
  if (ctx.u('엘더 갓-크타니트', 2)) return; ctx.m('엘더 갓-크타니트', 2);
  _aiDrawN(1);
  await ctx.chain({ type: 'aiForceDiscard', label: '크타니트 ②', count: 1 }); await D(300);
});

/* ── 라이온 테마 ── */
registerAISummonTrigger('젊은 라이온', async ctx => {
  if (ctx.u('젊은 라이온', 2)) return;
  var t = ctx.findInDeck(x => x.id.includes('사자') || CARDS[x.id]?.theme === '라이온');
  if (!t) return; ctx.m('젊은 라이온', 2);
  await ctx.chain({ type: 'aiSearch', label: '젊은 라이온 ②', cardId: t.id }); await D(300);
});

registerAISummonTrigger('에이스 라이온', async ctx => {
  if (ctx.u('에이스 라이온', 1) || G.myField.length === 0) return; ctx.m('에이스 라이온', 1);
  await ctx.chain({ type: 'aiGraveOpField', label: '에이스 라이온 ①', count: 1 }); await D(300);
});

registerAISummonTrigger('라이온 킹', async ctx => {
  if (ctx.u('라이온 킹', 2) || G.myField.length === 0) return; ctx.m('라이온 킹', 2);
  await ctx.chain({ type: 'aiGraveAllOpField', label: '라이온 킹 ②' }); await D(300);
});

/* ── 타이거 테마 ── */
registerAISummonTrigger('젊은 타이거', async ctx => {
  if (ctx.u('젊은 타이거', 2)) return;
  var t = ctx.findInDeck(x => CARDS[x.id]?.theme === '타이거' && CARDS[x.id]?.cardType === 'monster');
  if (!t) return; ctx.m('젊은 타이거', 2);
  await ctx.chain({ type: 'aiSummonDeck', label: '젊은 타이거 ②', cardId: t.id }); await D(400);
});

registerAISummonTrigger('에이스 타이거', async ctx => {
  if (ctx.u('에이스 타이거', 1)) return; ctx.m('에이스 타이거', 1);
  if (G.opField.length > 0) {
    var wk = G.opField.reduce((a, b) => (a.atk || 0) <= (b.atk || 0) ? a : b);
    if (typeof sendToGrave === 'function') sendToGrave(wk.id, 'field');
    else { var ri = G.opField.findIndex(c => c.id === wk.id); if (ri >= 0) G.opGrave.push(G.opField.splice(ri, 1)[0]); }
  }
  if (G.myField.length > 0) { await ctx.chain({ type: 'aiGraveOpField', label: '에이스 타이거 ①', count: 1 }); }
  await D(300);
});

registerAISummonTrigger('타이거 킹', async ctx => {
  if (ctx.u('타이거 킹', 2) || G.myField.length === 0) return; ctx.m('타이거 킹', 2);
  await ctx.chain({ type: 'aiExileOpField', label: '타이거 킹 ②', count: Math.min(3, G.myField.length) }); await D(300);
});

/* ── 라이거 테마 ── */
registerAISummonTrigger('베이비 라이거', async ctx => {
  if (ctx.u('베이비 라이거', 2)) return;
  var t = ctx.findInDeck(x => x.id === '모두의 자연');
  if (!t) return; ctx.m('베이비 라이거', 2);
  await ctx.chain({ type: 'aiFieldCard', label: '베이비 라이거 ②', cardId: '모두의 자연' }); await D(300);
});

registerAISummonTrigger('젊은 라이거', async ctx => {
  if (ctx.u('젊은 라이거', 2)) return;
  var t = ctx.findInDeck(x => CARDS[x.id]?.theme === '라이거');
  if (!t) return; ctx.m('젊은 라이거', 2);
  await ctx.chain({ type: 'aiSearch', label: '젊은 라이거 ②', cardId: t.id }); await D(300);
});

registerAISummonTrigger('에이스 라이거', async ctx => {
  if (ctx.u('에이스 라이거', 2)) return;
  var cnt = Math.min(G.opField.length, G.myHand.length);
  if (!cnt) return; ctx.m('에이스 라이거', 2);
  await ctx.chain({ type: 'aiReturnOpHand', label: '에이스 라이거 ②', count: cnt }); await D(300);
});

registerAISummonTrigger('라이거 킹', async ctx => {
  if (ctx.u('라이거 킹', 2) || G.myField.length === 0) return; ctx.m('라이거 킹', 2);
  await ctx.chain({ type: 'aiExileAllOpField', label: '라이거 킹 ②' }); await D(300);
});

/* ── 마피아 테마 ── */
registerAISummonTrigger('베이비 마피아', async ctx => {
  if (ctx.u('베이비 마피아', 2)) return;
  var hasOther = G.opField.some(x => x.id !== '베이비 마피아' && CARDS[x.id]?.theme === '마피아');
  if (!hasOther) return;
  var md = ctx.findInDeck(x => x.id === '마피아의 도시') || G.opGrave.find(x => x.id === '마피아의 도시');
  if (!md) return; ctx.m('베이비 마피아', 2);
  await ctx.chain({ type: 'aiFieldCard', label: '베이비 마피아 ②', cardId: '마피아의 도시' }); await D(300);
});

/* ══════════════════════════════════════════════════════════
   CHAIN_RESOLVERS 확장 — AI 효과 타입 실행
   executeChainLocally에서 link.by === 'guest'일 때 호출됨
═══════════════════════════════════════════════════════════ */
(function _extendChainResolvers() {
  function tryExtend() {
    if (typeof CHAIN_RESOLVERS === 'undefined') { setTimeout(tryExtend, 100); return; }

    // 기존 aiForceDiscard
    CHAIN_RESOLVERS.aiForceDiscard = link => {
      _aiForcePlayerDiscard(Math.max(1, Number(link.count) || 1));
      sendGameState(); renderAll();
    };

    // 기존 aiEyeForEye (AI 눈에는 눈)
    CHAIN_RESOLVERS.aiEyeForEye = () => {
      _aiDrawN(2);
      log('🤖 눈에는 눈: 드로우 2장', 'opponent');
      renderAll();
    };

    // 덱→소환
    CHAIN_RESOLVERS.aiSummonDeck = link => {
      if (link.cardId) { _aiSummonFromDeck(link.cardId); renderAll(); }
    };

    // 서치
    CHAIN_RESOLVERS.aiSearch = link => {
      if (link.cardId) { _aiSearch(link.cardId); renderAll(); }
    };

    // 필드 카드 발동
    CHAIN_RESOLVERS.aiFieldCard = link => {
      if (!link.cardId) return;
      _aiSetFieldCard(link.cardId);
      renderAll();
    };

    // 상대 필드 묘지로 (count장)
    CHAIN_RESOLVERS.aiGraveOpField = link => {
      _aiGraveFromPlayerField(Number(link.count) || 1);
      sendGameState(); renderAll();
    };

    // 상대 필드 전부 묘지로
    CHAIN_RESOLVERS.aiGraveAllOpField = () => {
      _aiGraveFromPlayerField(G.myField.length);
      sendGameState(); renderAll();
    };

    // 상대 필드 제외 (count장)
    CHAIN_RESOLVERS.aiExileOpField = link => {
      _aiExileFromPlayerField(Number(link.count) || 1);
      sendGameState(); renderAll();
    };

    // 상대 필드 전부 제외
    CHAIN_RESOLVERS.aiExileAllOpField = () => {
      _aiExileFromPlayerField(G.myField.length);
      sendGameState(); renderAll();
    };

    // 상대 필드 → 패로 되돌리기
    CHAIN_RESOLVERS.aiReturnOpHand = link => {
      _aiReturnToPlayerHand(Number(link.count) || 1);
      sendGameState(); renderAll();
    };

    // 펭귄 용사 ①: 서치 + 소환
    CHAIN_RESOLVERS.aiPenguinHero1 = link => {
      if (link.searchId) _aiSearch(link.searchId);
      if (link.summonId) _aiSummonFromDeck(link.summonId);
      sendGameState(); renderAll();
    };

    // 펭귄의 전설 ①: 묘지 부활 (aiSummonDeck과 다름 — opGrave에서)
    CHAIN_RESOLVERS.aiPenguinLegend1 = link => {
      var targets = link.targets || [];
      targets.forEach(id => {
        var gi = G.opGrave.findIndex(c => c.id === id);
        if (gi >= 0 && G.opField.length < maxFieldSlots()) {
          var c = G.opGrave.splice(gi, 1)[0];
          var cd = CARDS[c.id] || {};
          G.opField.push({ id: c.id, name: cd.name || c.id, atk: cd.atk || 0, atkBase: cd.atk || 0 });
          log(`🤖 묘지 부활: ${cd.name || c.id}`, 'opponent');
        }
      });
      sendGameState(); renderAll();
    };
  }
  tryExtend();
})();

/* ══════════════════════════════════════════════════════════
   Groq API — 풍부한 프롬프트 (실제 카드 효과 텍스트 포함)
═══════════════════════════════════════════════════════════ */
async function _groq() {
  if (!_WORKER_URL) throw new Error('Worker URL 없음');

  function cardInfo(c) {
    var cd = CARDS[c.id] || {};
    return {
      id:       c.id,
      name:     c.name || cd.name,
      cardType: cd.cardType,
      atk:      c.atk != null ? c.atk : cd.atk,
      theme:    cd.theme,
      isKey:    cd.isKeyCard || false,
      effect:   cd.effects ? cd.effects.replace(/\n/g, ' ').slice(0, 120) : '',
    };
  }

  // 전황 분석
  var myBestAtk  = G.myField.length  ? Math.max(...G.myField.map(c => c.atk || 0))  : 0;
  var aiBestAtk  = G.opField.length  ? Math.max(...G.opField.map(c => c.atk || 0))  : 0;
  var myHandSize = G.myHand.length;
  var aiHandSize = G.opHand.length;

  var state = {
    turn: G.turn,
    phase: currentPhase,
    situation: {
      myHandDiff: aiHandSize - myHandSize, // 양수 = AI가 유리
      fieldControl: G.opField.length - G.myField.length, // 양수 = AI 필드 우세
      aiCanWinBy1Attack: G.myField.length === 0 && aiBestAtk >= myHandSize,
      playerCanWinBy1Attack: G.opField.length === 0 && myBestAtk >= aiHandSize,
    },
    ai: {
      hand:      G.opHand.map(cardInfo),
      field:     G.opField.map(cardInfo),
      grave:     G.opGrave.map(c => ({ id: c.id, name: c.name })).slice(-8),
      exile:     G.opExile.map(c => ({ id: c.id, name: c.name })).slice(-5),
      keyDeck:   (G.opKeyDeck || []).map(c => ({ id: c.id, name: c.name })),
      fieldCard: G.opFieldCard || null,
      deckCount: window.AI.opDeck.length,
    },
    player: {
      handCount:  myHandSize,
      publicHand: G.myHand.filter(c => c.isPublic).map(cardInfo),
      field:      G.myField.map(cardInfo),
      grave:      G.myGrave.map(c => ({ id: c.id, name: c.name })).slice(-8),
      fieldCard:  G.myFieldCard || null,
      keyDeckCount: G.myKeyDeck ? G.myKeyDeck.length : 0,
    },
  };

  var systemPrompt = `당신은 핸드 배틀 TCG의 강력한 AI 플레이어입니다. 실제 사람처럼 전략적으로 플레이해야 합니다.

【게임 핵심 규칙】
- 승리: 상대 패를 0장으로 만들기 / 패배: 내 패 0장 즉시 패배
- 전투: 내 ATK > 상대 ATK → 상대 몬스터 묘지 + 패 (차이)장 손실
- 직접공격: 상대 필드 비어있을 때 → 상대 패 ATK장 손실  
- ATK 동일 → 양쪽 묘지, 패 손실 없음

【전략 판단 기준】
1. situation.aiCanWinBy1Attack=true → 반드시 직접공격 우선
2. situation.playerCanWinBy1Attack=true → 필드에 몬스터 세워 방어
3. 내 패(aiHandSize)가 적으면 생존 우선, 많으면 공격적으로
4. 소환 유발효과(②)가 있는 카드 우선 소환 → 필드 이점 극대화
5. ATK가 낮은 내 몬스터로는 강한 적 몬스터 공격 금지 (패 손실)
6. 묘지/키카드 효과를 활용할 수 있는 순서로 소환 계획

【카드 효과 확인】
ai.hand에 각 카드의 effect 필드가 있습니다. 이를 반드시 읽고 전략에 반영하세요.
예) 꼬마 펭귄 소환 시 ② 덱에서 펭귄 소환 → 소환 순서 조정 가능

【응답 형식】JSON만 (마크다운, 백틱 금지):
{
  "thinking": "전황 판단 한 문장 (40자 이내, 한국어)",
  "deploy": [
    {"action": "summonFromHand", "cardId": "카드ID", "reason": "이유 (15자 이내)"}
  ],
  "attack": [
    {"action": "attack", "attackerId": "내몬스터ID", "targetIdx": 0, "reason": "이유"},
    {"action": "directAttack", "attackerId": "내몬스터ID", "reason": "이유"}
  ]
}

제약: summonFromHand는 monster 타입만. 필드 최대 5장. 이미 필드에 있는 카드 재소환 불가. attack의 targetIdx는 0부터 시작.`;

  var resp = await fetch(_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.25,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: JSON.stringify(state) },
      ],
    }),
  });
  if (!resp.ok) throw new Error('Worker ' + resp.status);
  var d = await resp.json();
  var t = d?.choices?.[0]?.message?.content || '{}';
  var m = t.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : '{}');
}

/* ── 폴백 전략 ── */
function _fallback() {
  var plan = { deploy: [], attack: [] };
  // 패에서 ATK 높은 몬스터 우선 소환
  var mons = G.opHand
    .filter(c => CARDS[c.id]?.cardType === 'monster')
    .map(c => ({ id: c.id, atk: CARDS[c.id]?.atk || 0 }))
    .sort((a, b) => b.atk - a.atk).slice(0, 3);
  mons.forEach(c => plan.deploy.push({ action: 'summonFromHand', cardId: c.id }));

  plan.attack = _buildAttackPlan();
  return plan;
}

function _buildAttackPlan() {
  var plan = [];
  var attackers = G.opField.slice();
  if (G.myField.length === 0) {
    attackers.forEach(c => plan.push({ action: 'directAttack', attackerId: c.id }));
  } else {
    attackers.forEach(att => {
      var bestIdx = -1, bestGain = 0;
      G.myField.forEach((def, di) => {
        var gain = (att.atk || 0) - (def.atk || 0);
        if (gain > bestGain) { bestGain = gain; bestIdx = di; }
      });
      if (bestIdx >= 0) plan.push({ action: 'attack', attackerId: att.id, targetIdx: bestIdx });
    });
  }
  return plan;
}

/* ══════════════════════════════════════════════════════════
   AI 턴 종료
═══════════════════════════════════════════════════════════ */
function _aiEnd() {
  if (isMyTurn) { window.AI.thinking = false; return; }
  if (typeof resetTurnEffects === 'function') resetTurnEffects();
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();
  G.turn++;
  isMyTurn = true;
  try { attackedMonstersThisTurn.clear(); } catch(e) {}
  gameClock.runningFor  = 'host';
  gameClock.lastUpdated = Date.now();
  advancePhase('draw');
  _setBanner('');
  window.AI.thinking = false;
  renderAll();
  notify('🎮 내 턴! 드로우 버튼을 눌러주세요.');
}

/* ══════════════════════════════════════════════════════════
   덱 프리셋
═══════════════════════════════════════════════════════════ */
function _aiDeckList(theme) {
  var r = (id, n) => Array(n).fill(id);
  var p = {
    '펭귄':   [...r('펭귄 마을',4), ...r('꼬마 펭귄',4), ...r('펭귄 부부',4), ...r('현자 펭귄',4), ...r('수문장 펭귄',4), ...r('펭귄!돌격!',4), ...r('펭귄의 영광',4), ...r('펭귄이여 영원하라',4), ...r('펭귄 마법사',4), '구사일생','구사일생','눈에는 눈','눈에는 눈'],
    '크툴루': [...r('그레이트 올드 원-크툴루',4), ...r('그레이트 올드 원-크투가',4), ...r('그레이트 올드 원-크아이가',4), ...r('그레이트 올드 원-과타노차',4), ...r('엘더 갓-노덴스',4), ...r('엘더 갓-크타니트',4), ...r('엘더 갓-히프노스',4), ...r('올드_원의 멸망',4), '구사일생','구사일생','눈에는 눈','눈에는 눈'],
    '라이온': [...r('베이비 라이온',4), ...r('젊은 라이온',4), ...r('에이스 라이온',4), ...r('사자의 포효',4), ...r('사자의 사냥',4), ...r('사자의 발톱',4), ...r('사자의 일격',4), ...r('진정한 사자',4), '구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제'],
    '타이거': [...r('베이비 타이거',4), ...r('젊은 타이거',4), ...r('에이스 타이거',4), ...r('호랑이의 포효',4), ...r('호랑이의 사냥',4), ...r('호랑이의 발톱',4), ...r('진정한 호랑이',4), ...r('호랑이의 일격',4), '구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제'],
    '지배자': [...r('수원소의 지배자',4), ...r('화원소의 지배자',4), ...r('전원소의 지배자',4), ...r('풍원소의 지배자',4), ...r('수원소의 지배룡',4), ...r('화원소의 지배룡',4), ...r('전원소의 지배룡',4), ...r('풍원소의 지배룡',4), '지배의 사슬','지배의 사슬','지배룡과 지배자','지배룡과 지배자','눈에는 눈','눈에는 눈','출입통제','출입통제'],
  };
  return (p[theme] || p['크툴루']).slice();
}

function _aiKeyList(theme) {
  var k = {
    '펭귄':   ['펭귄 용사','펭귄의 일격','펭귄의 전설','일격필살','단 한번의 기회'],
    '크툴루': ['아우터 갓 니알라토텝','아우터 갓-아자토스','아우터 갓 슈브 니구라스','일격필살','단 한번의 기회'],
    '라이온': ['라이온 킹','고고한 사자','일격필살','단 한번의 기회'],
    '타이거': ['타이거 킹','고고한 호랑이','일격필살','단 한번의 기회'],
    '지배자': ['사원소의 지배룡','사원소의 지배자','일격필살','단 한번의 기회'],
  };
  return (k[theme] || k['크툴루']).filter(id => !!CARDS[id]).map(id => ({ id, name: CARDS[id].name }));
}

/* ══════════════════════════════════════════════════════════
   배너 UI
═══════════════════════════════════════════════════════════ */
function _aiBanner() {
  if (document.getElementById('_aiBanner')) return;
  var el = document.createElement('div'); el.id = '_aiBanner';
  el.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#1a0a00,#7c3400,#1a0a00);color:#fb923c;padding:.35rem 1.6rem;border:1px solid #ea580c;border-top:none;border-radius:0 0 10px 10px;font-family:Black Han Sans,sans-serif;font-size:.8rem;letter-spacing:.1em;z-index:3000;box-shadow:0 4px 20px #ea580c44;pointer-events:none;transition:opacity .25s;opacity:0;';
  document.body.appendChild(el);
}
function _setBanner(msg) {
  var el = document.getElementById('_aiBanner'); if (!el) return;
  el.textContent = msg; el.style.opacity = msg ? '1' : '0';
}

/* ══════════════════════════════════════════════════════════
   로비 카드 주입
═══════════════════════════════════════════════════════════ */
function _lobby() {
  var lobby = document.getElementById('lobby');
  if (!lobby || document.getElementById('_aiCard')) return;
  var card = document.createElement('div'); card.id = '_aiCard'; card.className = 'lobby-card';
  card.style.cssText = 'border-color:#ea580c;background:linear-gradient(160deg,#1a0a00,#2d1500);';
  card.innerHTML =
    '<h2 style="color:#fb923c;display:flex;align-items:center;gap:.5rem">🤖 AI 대전 <span style="font-size:.65rem;color:#ea580c;border:1px solid #ea580c;padding:.1rem .4rem;border-radius:3px">Groq AI</span></h2>' +
    '<p style="font-size:.82rem;color:#9090b0;line-height:1.65;margin:.25rem 0 .8rem">Groq AI가 실제 카드 효과를 사용하며 전략적으로 플레이합니다.<br>내가 선공, AI가 후공으로 시작합니다.</p>' +
    '<button style="width:100%;padding:.8rem;background:linear-gradient(135deg,#431407,#9a3412);color:#fed7aa;border:1px solid #ea580c;border-radius:6px;font-family:Black Han Sans,sans-serif;font-size:1rem;letter-spacing:.12em;cursor:pointer;" ' +
    'onmouseover="this.style.background=\'linear-gradient(135deg,#7c2d12,#c2410c)\'" ' +
    'onmouseout="this.style.background=\'linear-gradient(135deg,#431407,#9a3412)\'" ' +
    'onclick="startAIMode()">⚔️ AI와 대전하기 (내가 선공)</button>';
  var all = lobby.querySelectorAll('.lobby-card');
  var last = all[all.length - 1];
  if (last) last.after(card); else lobby.appendChild(card);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _lobby);
else _lobby();
setTimeout(_lobby, 500);
setTimeout(_lobby, 2000);

/* ══════════════════════════════════════════════════════════
   패치 연동 (enterGame 직후 플래그 기반 세팅)
═══════════════════════════════════════════════════════════ */
setInterval(() => {
  if (!window.AI?.active || !window.AI._pendingSetup) return;
  if (!window.G || !Array.isArray(G.myHand) || typeof advancePhase !== 'function') return;
  window.AI._pendingSetup = false;
  _setupAI();
}, 200);

/* 외부 노출 */
window._aiChainResponse  = _runAIChainResponse;
window._aiRespondToChain = () => _runAIChainResponse();
