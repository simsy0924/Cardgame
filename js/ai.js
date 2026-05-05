// ============================================================
// ai.js — AI 대전 모듈 (v2)
//
// 설계 원칙:
//   - AI는 "보이지 않는 원격 상대"로 동작
//   - handleOpponentAction / forceDiscard 등 대인전 엔진을 그대로 재사용
//   - roomRef = null 이므로 로컬 체인 해결(executeChainLocally) 경로 활용
//   - AI 전용 상태(opDeck, attacked, usedFx)만 window.AI에서 관리
//
// 수정된 버그 목록:
//   BUG-01: _setupAI() 이중 호출 → enterGameWithDeck 훅에서 _pendingSetup 취소
//   BUG-02: _aiAttack() 동점 판정 오류 → 동점 시 양쪽 묘지 처리 추가
//   BUG-03: checkWinCondition 훅 원본 미호출 → 모든 경로에서 원본 호출
//   BUG-04: _fallback() 미소환 카드로 공격 플랜 → 실제 필드 기준으로만
//   BUG-05: advancePhase('deploy') 이중 호출 → setTimeout 블록 제거
//   BUG-06: _aiTurn() 드로우 페이즈 강제 진입
//   BUG-07: _chainSignature()에 priority 포함 → 링크 내용만으로 시그니처 구성
//   BUG-08: 체인 상태 얕은 복사 → links 배열 딥카피
//   BUG-09: _buildAIDeck() 패딩 카드 유효성 검사 추가
//   BUG-10: _playerCanRespondInChain() collectChainOptions 인자 누락 수정
//   BUG-11: 수문장 펭귄 reduce() 빈 배열 크래시 → 가드 추가
//   BUG-12: _lobby() 중복 삽입 → 불필요한 setTimeout 중복 제거
// ============================================================
'use strict';

// ★ Cloudflare Worker URL
var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

// ─────────────────────────────────────────────────────────────
// AI 전역 상태
// ─────────────────────────────────────────────────────────────
window.AI = {
  active:      false,
  thinking:    false,
  opDeck:      [],
  deckPreset:  null,
  usedFx:      {},
  attacked:    new Set(),
  chainMemory: { respondedSig: null },
  chainTimer:  null,
  chainWatcher: null,
};

function _resetAIRuntime() {
  if (window.AI.chainTimer)   clearTimeout(window.AI.chainTimer);
  if (window.AI.chainWatcher) clearInterval(window.AI.chainWatcher);
  window.AI.thinking    = false;
  window.AI.usedFx      = {};
  window.AI.attacked    = new Set();
  window.AI.chainMemory = { respondedSig: null };
  window.AI.chainTimer  = null;
  window.AI.chainWatcher = null;
}

var _s = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

function _safeHook(name, wrapper) {
  var orig = window[name];
  if (typeof orig !== 'function') return false;
  window[name] = wrapper(orig);
  return true;
}

function _playerRole() { return myRole || 'host'; }
function _aiRole()     { return _playerRole() === 'host' ? 'guest' : 'host'; }


// ─────────────────────────────────────────────────────────────
// 훅 등록
// ─────────────────────────────────────────────────────────────

// [BUG-01 FIX] _setupAI 이중 호출 방지:
// enterGameWithDeck 훅에서 _pendingSetup 플래그를 즉시 해제해
// setInterval 쪽이 중복으로 _setupAI()를 호출하지 못하도록 막음
_safeHook('enterGameWithDeck', function(_origEGWD) {
  return function() {
    _origEGWD.apply(this, arguments);
    if (!window.AI.active) return;
    window.AI._pendingSetup = false; // setInterval 중복 방지
    _setupAI();
  };
});

_safeHook('endTurn', function(_origET) {
  return function() {
    _origET.apply(this, arguments);
    if (!window.AI.active) return;
    if (isMyTurn) return;
    setTimeout(function() {
      if (!window.AI.active || isMyTurn) return;
      _aiTurn();
    }, 500);
  };
});

// [BUG-03 FIX] checkWinCondition: 모든 분기에서 원본 호출
_safeHook('checkWinCondition', function(_origCWC) {
  return function() {
    if (!window.AI.active) {
      _origCWC.apply(this, arguments);
      return;
    }
    // 플레이어 패 0 → 패배
    if (G.myHand.length === 0) {
      _origCWC.apply(this, arguments);
      return;
    }
    // AI 패 0 → 승리
    if (G.opHand.length === 0) {
      _origCWC.apply(this, arguments); // 원본 정리 로직 실행
      showGameOver(true);
      return;
    }
    // 그 외 (덱아웃 등 다른 승리 조건도 원본에서 체크)
    _origCWC.apply(this, arguments);
  };
});


// ─────────────────────────────────────────────────────────────
// AI 모드 진입
// ─────────────────────────────────────────────────────────────
window.startAIMode = function() {
  _resetAIRuntime();
  window.AI.active = true;
  window.roomRef   = null;   // roomRef=null → 로컬 체인 경로 사용
  window.myRole    = 'host'; // 플레이어=선공(host), AI=후공(guest)

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display      = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool    === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};


// ─────────────────────────────────────────────────────────────
// AI 덱 빌드
// ─────────────────────────────────────────────────────────────
function _buildAIDeck() {
  // 플레이어 덱의 주요 테마 분석해서 카운터 덱 선택
  var pd = window._confirmedDeck || [];
  var tc = {};
  pd.forEach(function(id) {
    var t = CARDS[id] && CARDS[id].theme;
    if (t) tc[t] = (tc[t] || 0) + 1;
  });
  var top = '펭귄', topN = 0;
  Object.keys(tc).forEach(function(t) {
    if (tc[t] > topN) { topN = tc[t]; top = t; }
  });
  var cm = {
    '펭귄':     '크툴루',
    '올드원':   '펭귄',
    '라이온':   '타이거',
    '타이거':   '라이온',
    '라이거':   '펭귄',
    '지배자':   '크툴루',
    '마피아':   '펭귄',
    '불가사의': '펭귄',
  };
  window.AI.deckPreset = cm[top] || '크툴루';

  // [BUG-09 FIX] 패딩 카드 유효성 검사: CARDS에 존재하는 카드만 사용
  var PADDING_CARDS = ['구사일생', '눈에는 눈', '출입통제'];
  var validPadding  = PADDING_CARDS.filter(function(id) { return !!CARDS[id]; });

  var list = _aiDeckList(window.AI.deckPreset).filter(function(id) { return !!CARDS[id]; });
  var pi = 0;
  while (list.length < 40 && validPadding.length > 0) {
    list.push(validPadding[pi % validPadding.length]);
    pi++;
  }

  window.AI.opDeck = shuffle(list.map(function(id) {
    return { id: id, name: CARDS[id].name };
  }));
  window.AI.usedFx      = {};
  window.AI.attacked    = new Set();
  window.AI.chainMemory = { respondedSig: null };
}


// ─────────────────────────────────────────────────────────────
// enterGameWithDeck 완료 직후 실행
// ─────────────────────────────────────────────────────────────
function _setupAI() {
  if (!window.AI.active) return;
  _resetAIRuntime();
  _buildAIDeck();

  // AI의 게임 존 초기화 (대인전에서 opHand/opField 등을 사용하는 구조와 동일)
  G.opHand      = [];
  G.opField     = [];
  G.opGrave     = [];
  G.opExile     = [];
  G.opFieldCard = null;
  G.opKeyDeck   = _aiKeyList(window.AI.deckPreset);
  G.opDeckCount = window.AI.opDeck.length;

  // AI 초기 드로우 7장 (후공 guest 기준)
  for (var i = 0; i < 7; i++) _aiDrawOne();

  document.getElementById('hdrOpName').textContent   = '🤖 AI (' + window.AI.deckPreset + ')';
  document.getElementById('opNameLabel').textContent = '🤖 AI';

  // roomRef 없이도 동작하는 로컬 클럭
  gameClock = {
    host:        500,
    guest:       500,
    runningFor:  'host',
    lastUpdated: Date.now(),
  };

  _aiBanner();
  log('🤖 AI (' + window.AI.deckPreset + ') 후공 참전! 패 ' + G.opHand.length + '장', 'system');

  G.turn = 1;
  G.activePlayer = 'host';
  currentPhase   = 'deploy';
  isMyTurn       = true;
  // [BUG-05 FIX] advancePhase 단 1회만 호출 (이중 호출 제거)
  advancePhase('deploy');
  renderAll();

  _startAIChainWatcher();
}


// ─────────────────────────────────────────────────────────────
// AI 내부 조작 헬퍼
// ─────────────────────────────────────────────────────────────
function _aiDrawOne() {
  if (!window.AI.opDeck.length) {
    log('🤖 AI 덱 아웃!', 'system');
    showGameOver(true);
    return false;
  }
  var c = window.AI.opDeck.shift();
  G.opHand.push({ id: c.id, name: c.name });
  G.opDeckCount = window.AI.opDeck.length;
  return true;
}

function _aiDrawN(n) {
  for (var i = 0; i < n; i++) if (!_aiDrawOne()) return false;
  return true;
}

function _aiRemHand(cardId) {
  var i = G.opHand.findIndex(function(c) { return c.id === cardId; });
  if (i >= 0) G.opHand.splice(i, 1);
}

function _aiSummon(cardId) {
  var card = CARDS[cardId];
  if (!card || card.cardType !== 'monster') return false;
  if (G.opField.length >= maxFieldSlots()) {
    log('🤖 몬스터 존 가득 — 소환 불가', 'opponent');
    return false;
  }
  _aiRemHand(cardId);
  G.opField.push({
    id:      cardId,
    name:    card.name,
    atk:     card.atk != null ? card.atk : 0,
    atkBase: card.atk != null ? card.atk : 0,
  });
  log('🤖 소환: ' + card.name + ' ATK' + (card.atk != null ? card.atk : 0), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: _aiRole(), ts: Date.now(), localApplied: true });
  return true;
}

function _aiSummonDeck(cardId) {
  var idx = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  if (G.opField.length >= maxFieldSlots()) {
    log('🤖 몬스터 존 가득 — 덱소환 불가', 'opponent');
    return false;
  }
  window.AI.opDeck.splice(idx, 1);
  G.opDeckCount = window.AI.opDeck.length;
  var card = CARDS[cardId] || {};
  G.opField.push({
    id:      cardId,
    name:    card.name || cardId,
    atk:     card.atk != null ? card.atk : 0,
    atkBase: card.atk != null ? card.atk : 0,
  });
  log('🤖 덱→소환: ' + (card.name || cardId), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: _aiRole(), ts: Date.now(), localApplied: true });
  return true;
}
// alias (CHAIN_RESOLVERS에서 _aiSummonFromDeck으로 참조)
var _aiSummonFromDeck = _aiSummonDeck;

function _aiSendOwnFieldToGrave(cardId) {
  var idx = G.opField.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  var card = G.opField.splice(idx, 1)[0];
  G.opGrave.push(card);
  log('🤖 ' + (card.name || cardId) + ' 묘지로', 'opponent');
  handleOpponentAction({ type: 'toGrave', cardId: cardId, from: 'field', by: _aiRole(), ts: Date.now(), localApplied: true });
  return true;
}

function _aiDiscard(cardId) {
  var before = G.opHand.length;
  _aiRemHand(cardId);
  if (G.opHand.length === before) return false;
  G.opGrave.push({ id: cardId, name: CARDS[cardId] ? CARDS[cardId].name : cardId });
  handleOpponentAction({ type: 'discard', cardId: cardId, by: _aiRole(), ts: Date.now() });
  return true;
}

function _aiSearch(cardId) {
  var idx = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opHand.push({ id: cardId, name: CARDS[cardId] ? CARDS[cardId].name : cardId });
  G.opDeckCount = window.AI.opDeck.length;
  log('🤖 서치: ' + (CARDS[cardId] ? CARDS[cardId].name : cardId), 'opponent');
  handleOpponentAction({ type: 'search', cardName: CARDS[cardId] ? CARDS[cardId].name : cardId, by: _aiRole(), ts: Date.now() });
  return true;
}

// [BUG-02 FIX] 전투 판정: 동점 시 양쪽 묘지, ATK=0 예외 제거
function _aiAttack(atkId, defIdx) {
  if (window.AI.attacked.has(atkId)) return false;
  var fi = G.opField.findIndex(function(c) { return c.id === atkId; });
  if (fi < 0 || !G.myField[defIdx]) return false;
  window.AI.attacked.add(atkId);

  var atk  = G.opField[fi];
  var def  = G.myField[defIdx];
  var diff = (atk.atk || 0) - (def.atk || 0);

  log('🤖 공격: ' + atk.name + '(' + atk.atk + ') → ' + def.name + '(' + def.atk + ')', 'opponent');
  handleOpponentAction({
    type:    'combat',
    atkCard: { id: atk.id, name: atk.name, atk: atk.atk },
    defCard: { id: def.id, name: def.name, atk: def.atk },
    by:      _aiRole(),
    ts:      Date.now(),
  });

  if (diff < 0) {
    // AI 몬스터만 묘지
    var ri = G.opField.findIndex(function(c) { return c.id === atkId; });
    if (ri >= 0) G.opGrave.push(G.opField.splice(ri, 1)[0]);
  } else if (diff === 0 && (atk.atk || 0) !== 0) {
    // 동점(양쪽 묘지) — ATK=0 무승부는 유지
    var ri2 = G.opField.findIndex(function(c) { return c.id === atkId; });
    if (ri2 >= 0) G.opGrave.push(G.opField.splice(ri2, 1)[0]);
    // 플레이어 측은 handleOpponentAction의 combat 처리에 위임
  }
  return true;
}

function _aiDirect(atkId) {
  if (G.myField.length > 0 || window.AI.attacked.has(atkId)) return false;
  var fi = G.opField.findIndex(function(c) { return c.id === atkId; });
  if (fi < 0) return false;
  var atk = G.opField[fi];
  window.AI.attacked.add(atkId);
  log('🤖 직접공격: ' + atk.name + '(' + atk.atk + ')', 'opponent');
  handleOpponentAction({
    type: 'directAttack',
    card: { id: atk.id, name: atk.name, atk: atk.atk },
    by:   _aiRole(),
    ts:   Date.now(),
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// 플레이어 필드 조작 (AI 효과로 인한)
// ─────────────────────────────────────────────────────────────
function _aiGraveFromPlayerField(n) {
  var count = Math.min(n, G.myField.length);
  // ATK가 낮은 순으로 제거 (AI에게 유리)
  var sorted = G.myField.slice().sort(function(a, b) { return (a.atk || 0) - (b.atk || 0); });
  for (var i = 0; i < count; i++) {
    var target = sorted[i];
    var idx    = G.myField.findIndex(function(c) { return c === target; });
    if (idx >= 0) {
      var removed = G.myField.splice(idx, 1)[0];
      G.myGrave.push(removed);
      log('🤖 AI 효과: ' + removed.name + ' 묘지로', 'opponent');
    }
  }
}

function _aiExileFromPlayerField(n) {
  var count = Math.min(n, G.myField.length);
  var sorted = G.myField.slice().sort(function(a, b) { return (b.atk || 0) - (a.atk || 0); });
  for (var i = 0; i < count; i++) {
    var target = sorted[i];
    var idx    = G.myField.findIndex(function(c) { return c === target; });
    if (idx >= 0) {
      var removed = G.myField.splice(idx, 1)[0];
      G.myExile.push(removed);
      log('🤖 AI 효과: ' + removed.name + ' 제외', 'opponent');
    }
  }
}

function _aiReturnToPlayerHand(n) {
  var count = Math.min(n, G.myField.length);
  for (var i = 0; i < count; i++) {
    if (!G.myField.length) break;
    var removed = G.myField.pop();
    G.myHand.push({ id: removed.id, name: removed.name });
    log('🤖 AI 효과: ' + removed.name + ' 패로 되돌림', 'opponent');
  }
}


// ─────────────────────────────────────────────────────────────
// AI 턴
// ─────────────────────────────────────────────────────────────
// [BUG-06 FIX] 드로우 단계 강제 진입 — currentPhase와 무관하게 드로우
async function _aiTurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true;
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();
  _setBanner('🤖 드로우 중...');

  try {
    // 항상 드로우 (페이즈 무관 — AI 턴 시작이면 반드시 드로우)
    if (!_aiDrawOne()) { window.AI.thinking = false; return; }
    log('🤖 드로우 (패:' + G.opHand.length + ' 덱:' + window.AI.opDeck.length + ')', 'opponent');
    gameClock.runningFor  = _aiRole();
    gameClock.lastUpdated = Date.now();
    advancePhase('deploy');
    await _s(400);
    renderAll();

    // 전략 수립
    _setBanner('🤖 전략 계산 중...');
    await _s(200);
    var plan;
    try   { plan = await _groq(); }
    catch (e) { console.warn('[AI]', e.message); plan = _fallback(); }
    if (plan.thinking) { log('🤖 "' + plan.thinking + '"', 'opponent'); await _s(300); }

    // 전개
    _setBanner('🤖 전개 중...');
    await _deploy(plan.deploy || []);

    // 공격
    advancePhase('attack');
    await _s(300);
    renderAll();

    // [BUG-04 FIX] 공격 플랜은 실제 G.opField 기준으로만 생성
    var attackPlan = (plan.attack && plan.attack.length > 0) ? plan.attack : _buildAttackPlan();
    _setBanner('🤖 공격 중...');
    await _attack(attackPlan);
    advancePhase('end');
    await _s(200);
    _aiEnd();

  } catch (e) {
    console.error('[AI]', e);
    try { advancePhase('end'); } catch(_) {}
    _aiEnd();
  }
}


// ─────────────────────────────────────────────────────────────
// Groq API (Cloudflare Worker 경유)
// ─────────────────────────────────────────────────────────────
async function _groq() {
  if (!_WORKER_URL) throw new Error('Worker URL 없음');

  function cardDetail(c) {
    var cd = CARDS[c.id] || {};
    return {
      id:        c.id,
      name:      c.name || cd.name,
      cardType:  cd.cardType,
      atk:       c.atk != null ? c.atk : cd.atk,
      theme:     cd.theme,
      isKeyCard: cd.isKeyCard || false,
      effects:   cd.effects ? cd.effects.replace(/\n/g, ' ') : '',
    };
  }

  var state = {
    turn:  G.turn,
    phase: currentPhase,
    ai: {
      hand:      G.opHand.map(cardDetail),
      field:     G.opField.map(cardDetail),
      grave:     G.opGrave.map(function(c) { return { id: c.id, name: c.name }; }),
      exile:     G.opExile.map(function(c) { return { id: c.id, name: c.name }; }),
      keyDeck:   (G.opKeyDeck || []).map(function(c) { return { id: c.id, name: c.name }; }),
      fieldCard: G.opFieldCard ? { id: G.opFieldCard.id, name: G.opFieldCard.name } : null,
      deckCount: window.AI.opDeck.length,
    },
    player: {
      handCount:    G.myHand.length,
      publicHand:   G.myHand.filter(function(c) { return c.isPublic; }).map(cardDetail),
      field:        G.myField.map(cardDetail),
      grave:        G.myGrave.map(function(c) { return { id: c.id, name: c.name }; }),
      exile:        G.myExile.map(function(c) { return { id: c.id, name: c.name }; }),
      fieldCard:    G.myFieldCard ? { id: G.myFieldCard.id, name: G.myFieldCard.name } : null,
      keyDeckCount: G.myKeyDeck ? G.myKeyDeck.length : 0,
      deckCount:    G.myDeck ? G.myDeck.length : 0,
    },
    winCondition: '패 0장이 되면 패배. 전투: 공격ATK > 방어ATK → 패 차이만큼 손실. 직접공격 → ATK만큼 손실.',
  };

  var systemPrompt = `당신은 핸드 배틀 TCG의 전략적 AI 플레이어입니다.

【게임 규칙】
- 승리: 상대의 패를 0장으로 만들기
- 패배: 자신의 패가 0장이 되면 즉시 패배
- 전투: 내 몬스터ATK > 상대ATK → 상대 몬스터 묘지 + 패 차이만큼 손실
- 직접공격: 상대 필드 비어있을 때 → 상대 패 ATK장 손실
- ATK 동일(≠0) → 양쪽 묘지 (무승부, 패 손실 없음)
- ATK 0 동점 → 양쪽 유지

【전략 원칙】
1. 상대 패가 적으면 공격적으로, 많으면 필드를 구축
2. ATK가 낮은 내 몬스터는 상대 ATK와 비교 후 공격 결정
3. 이길 수 없는 전투는 피하고 직접공격 기회를 노릴 것
4. 소환 유발효과(②)가 있는 카드를 우선 소환 고려
5. 묘지/제외 카드를 활용하는 효과도 고려
6. 상대 공개 패를 파악해 위협적인 효과에 대비

【응답 형식】JSON만 반환 (마크다운 금지):
{
  "thinking": "현재 상황 분석과 전략 (50자 이내)",
  "deploy": [
    {"action": "summonFromHand", "cardId": "카드ID", "reason": "이유"}
  ],
  "attack": [
    {"action": "attack", "attackerId": "내몬스터ID", "targetIdx": 0, "reason": "이유"},
    {"action": "directAttack", "attackerId": "내몬스터ID", "reason": "이유"}
  ]
}

주의: summonFromHand는 monster 타입만 가능. 필드가 가득 차면(5장) 소환 불가. 이미 필드에 있는 몬스터는 다시 소환 불가.`;

  var resp = await fetch(_WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:           'llama-3.3-70b-versatile',
      temperature:     0.3,
      max_tokens:      600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: JSON.stringify(state) },
      ],
    }),
  });
  if (!resp.ok) throw new Error('Worker ' + resp.status);
  var d = await resp.json();
  var t = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '{}';
  var m = t.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : '{}');
}


// ─────────────────────────────────────────────────────────────
// 폴백 플랜 (API 실패 시)
// ─────────────────────────────────────────────────────────────
function _fallback() {
  var plan = { deploy: [], attack: [] };
  var mons = G.opHand
    .filter(function(c) { return CARDS[c.id] && CARDS[c.id].cardType === 'monster'; })
    .map(function(c) { return { id: c.id, atk: CARDS[c.id].atk || 0 }; })
    .sort(function(a, b) { return b.atk - a.atk; })
    .slice(0, 3);
  mons.forEach(function(c) {
    plan.deploy.push({ action: 'summonFromHand', cardId: c.id });
  });

  // [BUG-04 FIX] 공격 플랜은 현재 G.opField 기준으로만 (미소환 카드 제외)
  if (G.myField.length === 0) {
    G.opField.forEach(function(c) {
      plan.attack.push({ action: 'directAttack', attackerId: c.id });
    });
  } else {
    G.opField.forEach(function(att) {
      var bI = -1, bG = 0;
      G.myField.forEach(function(def, di) {
        var g = (att.atk || 0) - (def.atk || 0);
        if (g > bG) { bG = g; bI = di; }
      });
      if (bI >= 0) plan.attack.push({ action: 'attack', attackerId: att.id, targetIdx: bI });
    });
  }
  return plan;
}


// ─────────────────────────────────────────────────────────────
// 공격 플랜 자동 생성
// ─────────────────────────────────────────────────────────────
function _buildAttackPlan() {
  var plan     = [];
  var attackers = G.opField.slice();
  if (G.myField.length === 0) {
    attackers.forEach(function(c) {
      plan.push({ action: 'directAttack', attackerId: c.id });
    });
  } else {
    attackers.forEach(function(att) {
      var bI = -1, bG = 0;
      G.myField.forEach(function(def, di) {
        var g = (att.atk || 0) - (def.atk || 0);
        if (g > bG) { bG = g; bI = di; }
      });
      if (bI >= 0) plan.push({ action: 'attack', attackerId: att.id, targetIdx: bI });
    });
  }
  return plan;
}


// ─────────────────────────────────────────────────────────────
// 플레이어 체인 응답 대기 (타임아웃 포함)
// ─────────────────────────────────────────────────────────────
function _waitForPlayerChainResponse() {
  return new Promise(function(resolve) {
    if (activeChainState && activeChainState.active) {
      var elapsed = 0;
      var poll = setInterval(function() {
        elapsed += 100;
        if (!activeChainState || !activeChainState.active) {
          clearInterval(poll);
          setTimeout(resolve, 200);
        } else if (elapsed >= 15000) {
          clearInterval(poll);
          console.warn('[AI] _waitForPlayerChainResponse: 타임아웃, 강제 resolve');
          resolve();
        }
      }, 100);
      return;
    }
    setTimeout(resolve, 300);
  });
}


// ─────────────────────────────────────────────────────────────
// 전개 실행
// ─────────────────────────────────────────────────────────────
async function _deploy(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act || act.action !== 'summonFromHand' || !act.cardId) continue;
    if (!G.opHand.find(function(c) { return c.id === act.cardId; })) continue;
    var cd = CARDS[act.cardId];
    if (!cd || cd.cardType !== 'monster') continue;

    _aiSummon(act.cardId);
    renderAll();
    await _s(400);

    await _trigger(act.cardId);
    await _waitForPlayerChainResponse();
    renderAll();

    if (!isMyTurn && G.myHand.length === 0) break;
  }
}


// ─────────────────────────────────────────────────────────────
// 공격 실행
// ─────────────────────────────────────────────────────────────
async function _attack(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act) continue;
    if (act.action === 'attack') {
      var di = typeof act.targetIdx === 'number' ? act.targetIdx : 0;
      if (di < G.myField.length && G.opField.find(function(c) { return c.id === act.attackerId; })) {
        _aiAttack(act.attackerId, di);
        await _s(800);
        renderAll();
      }
    } else if (act.action === 'directAttack') {
      if (G.myField.length === 0 && G.opField.find(function(c) { return c.id === act.attackerId; })) {
        _aiDirect(act.attackerId);
        await _s(800);
        renderAll();
      }
    }
    if (G.myHand.length === 0) break;
  }
}


// ─────────────────────────────────────────────────────────────
// AI 효과 체인 발동 — 대인전 체인 시스템과 동일한 구조 사용
// ─────────────────────────────────────────────────────────────
function _aiStartChainEffect(effect, afterResolve) {
  if (!window.AI.active) {
    if (typeof afterResolve === 'function') afterResolve();
    return;
  }

  var aiRole   = _aiRole();
  var aiEffect = Object.assign({}, effect, { by: aiRole });

  if (activeChainState && activeChainState.active) {
    // 기존 체인에 AI 링크 추가 — [BUG-08 FIX] links 딥카피
    var next   = Object.assign({}, activeChainState);
    next.links = (activeChainState.links || []).slice().concat([aiEffect]);
    next.passCount = 0;
    next.priority  = myRole; // 플레이어 우선 응답
    activeChainState = next;
    renderChainActions();
    if (_playerCanRespondInChain(next)) {
      notify('체인 ' + next.links.length + ': ' + aiEffect.label + '. 응답 또는 패스를 선택하세요.');
    } else {
      setTimeout(function() {
        if (!activeChainState || !activeChainState.active) return;
        _aiChainResponse(activeChainState);
      }, 180);
    }
  } else {
    // AI가 새 체인 1로 시작
    var chainState = {
      chainId:   'ai_chain_' + Date.now(),
      active:    true,
      startedBy: aiRole,
      priority:  myRole, // 플레이어 먼저
      passCount: 0,
      links:     [aiEffect],
    };
    activeChainState = chainState;
    log('체인 1: ' + aiEffect.label + ' (AI 발동)', 'opponent');
    renderChainActions();
    renderAll();
    if (_playerCanRespondInChain(chainState)) {
      notify('상대가 ' + aiEffect.label + ' 발동! 응답 또는 패스를 선택하세요.');
    } else {
      setTimeout(function() {
        if (!activeChainState || !activeChainState.active) return;
        _aiChainResponse(activeChainState);
      }, 220);
    }
  }

  if (typeof afterResolve === 'function') {
    var _wait = function() {
      if (activeChainState && activeChainState.active) { setTimeout(_wait, 150); return; }
      afterResolve();
    };
    setTimeout(_wait, 200);
  }
}


// ─────────────────────────────────────────────────────────────
// AI 소환 유발 레지스트리
// ─────────────────────────────────────────────────────────────
window.AI_SUMMON_TRIGGERS = window.AI_SUMMON_TRIGGERS || {};

function registerAISummonTrigger(cardId, fn) {
  window.AI_SUMMON_TRIGGERS[cardId] = fn;
}

function _buildAICtx(AI) {
  var u           = function(id, n) { return !!AI.usedFx[id + '_' + n]; };
  var m           = function(id, n) { AI.usedFx[id + '_' + n] = 1; };
  var findInDeck  = function(pred) { return AI.opDeck.find(pred); };

  var deckToField = function(cId) {
    var idx = AI.opDeck.findIndex(function(c) { return c.id === cId; });
    if (idx < 0 || G.opField.length >= maxFieldSlots()) return false;
    AI.opDeck.splice(idx, 1);
    G.opDeckCount = AI.opDeck.length;
    var cd = CARDS[cId] || {};
    G.opField.push({ id: cId, name: cd.name || cId, atk: cd.atk || 0, atkBase: cd.atk || 0 });
    log('🤖 덱→소환: ' + (cd.name || cId), 'opponent');
    handleOpponentAction({ type: 'summon', cardId: cId, by: _aiRole(), ts: Date.now(), localApplied: true });
    return true;
  };

  var deckToHand = function(cId) {
    var idx = AI.opDeck.findIndex(function(c) { return c.id === cId; });
    if (idx < 0) return false;
    AI.opDeck.splice(idx, 1);
    G.opDeckCount = AI.opDeck.length;
    var cd = CARDS[cId] || {};
    G.opHand.push({ id: cId, name: cd.name || cId });
    log('🤖 서치: ' + (cd.name || cId), 'opponent');
    return true;
  };

  var deckToFieldCard = function(cId) {
    var fi = AI.opDeck.findIndex(function(c) { return c.id === cId; });
    if (fi >= 0) {
      AI.opDeck.splice(fi, 1);
      G.opDeckCount = AI.opDeck.length;
    } else {
      var gi = G.opGrave.findIndex(function(c) { return c.id === cId; });
      if (gi >= 0) G.opGrave.splice(gi, 1);
      else return false;
    }
    var cd = CARDS[cId] || {};
    G.opFieldCard = { id: cId, name: cd.name || cId };
    handleOpponentAction({ type: 'fieldCard', cardId: cId, by: _aiRole(), ts: Date.now() });
    log('🤖 필드 발동: ' + (cd.name || cId), 'opponent');
    return true;
  };

  var chain = function(effect) {
    return new Promise(function(done) { _aiStartChainEffect(effect, done); });
  };

  return { ai: AI, u: u, m: m, findInDeck: findInDeck, deckToField: deckToField, deckToHand: deckToHand, deckToFieldCard: deckToFieldCard, chain: chain };
}

async function _trigger(cardId) {
  var fn = window.AI_SUMMON_TRIGGERS[cardId];
  if (fn) await fn(_buildAICtx(window.AI));
  renderAll();
}


// ─────────────────────────────────────────────────────────────
// AI 소환 유발 효과 등록
// ─────────────────────────────────────────────────────────────
(function() {
  var D = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

  registerAISummonTrigger('꼬마 펭귄', async function(c) {
    if (c.u('꼬마 펭귄', 2)) return;
    var t = c.findInDeck(function(x) { var cd = CARDS[x.id]; return cd && cd.theme === '펭귄' && cd.cardType === 'monster'; });
    if (!t) return;
    c.m('꼬마 펭귄', 2);
    await c.chain({ type: 'aiSummonDeck', label: '꼬마 펭귄 ②', cardId: t.id });
    await D(300);
  });

  // [BUG-11 FIX] 수문장 펭귄 reduce 빈 배열 크래시 방지
  registerAISummonTrigger('수문장 펭귄', async function(c) {
    if (c.u('수문장 펭귄', 's1') || G.opHand.length === 0) return;
    var fi = G.opField.findIndex(function(x) { return x.id === '수문장 펭귄'; });
    if (fi < 0) return;
    c.ai.usedFx['수문장 펭귄_s1'] = 1;
    G.opField[fi].atk += 1;
    // reduce 전에 배열이 비어있는지 재확인
    if (G.opHand.length === 0) return;
    var wk = G.opHand.reduce(function(a, b) {
      return (CARDS[a.id] && CARDS[a.id].atk || 0) <= (CARDS[b.id] && CARDS[b.id].atk || 0) ? a : b;
    });
    _aiDiscard(wk.id);
    await c.chain({ type: 'aiForceDiscard', label: '수문장 펭귄 ①', count: 1 });
    await D(300);
  });

  registerAISummonTrigger('펭귄 용사', async function(c) {
    if (c.u('펭귄 용사', 1)) return;
    c.m('펭귄 용사', 1);
    var ph = c.findInDeck(function(x) { var cd = CARDS[x.id]; return cd && cd.theme === '펭귄'; });
    var pm = c.findInDeck(function(x) { var cd = CARDS[x.id]; return cd && cd.theme === '펭귄' && cd.cardType === 'monster' && (!ph || x.id !== ph.id); });
    await c.chain({ type: 'aiPenguinHero1', label: '펭귄 용사 ①', searchId: ph && ph.id, summonId: pm && pm.id });
    await D(300);
  });

  registerAISummonTrigger('펭귄의 전설', async function(c) {
    if (c.u('펭귄의 전설', 1)) return;
    var g = G.opGrave.filter(function(x) { return x.id === '꼬마 펭귄'; }).slice(0, 2);
    if (!g.length) return;
    c.m('펭귄의 전설', 1);
    await c.chain({ type: 'aiPenguinLegend1', label: '펭귄의 전설 ①', targets: g.map(function(x) { return x.id; }) });
    await D(300);
  });

  registerAISummonTrigger('펭귄 마법사', async function(c) {
    if (c.u('펭귄 마법사', 2) || G.opHand.length === 0 || G.myField.length === 0) return;
    c.m('펭귄 마법사', 2);
    var dc = Math.min(3, G.opHand.length, G.myField.length);
    for (var i = 0; i < dc; i++) {
      if (G.opHand.length > 0) _aiDiscard(G.opHand[G.opHand.length - 1].id);
    }
    await c.chain({ type: 'aiExileOpField', label: '펭귄 마법사 ②', count: dc });
    await D(300);
  });

  registerAISummonTrigger('그레이트 올드 원-크툴루', async function(c) {
    if (c.u('그레이트 올드 원-크툴루', 1) || G.opFieldCard) return;
    var t = c.findInDeck(function(x) { return x.id === '태평양 속 르뤼에'; });
    if (!t) return;
    c.m('그레이트 올드 원-크툴루', 1);
    await c.chain({ type: 'aiFieldCard', label: '크툴루 ①', cardId: '태평양 속 르뤼에' });
    await D(300);
  });

  registerAISummonTrigger('그레이트 올드 원-크투가', async function(c) {
    if (c.u('그레이트 올드 원-크투가', 2)) return;
    c.m('그레이트 올드 원-크투가', 2);
    var t = c.findInDeck(function(x) { var cd = CARDS[x.id]; return cd && cd.name && cd.name.startsWith('그레이트 올드 원'); });
    if (t) { await c.chain({ type: 'aiSummonDeck', label: '크투가 ②', cardId: t.id }); await D(300); }
  });

  registerAISummonTrigger('그레이트 올드 원-크아이가', async function(c) {
    if (c.u('그레이트 올드 원-크아이가', 2) || G.myField.length === 0) return;
    c.m('그레이트 올드 원-크아이가', 2);
    await c.chain({ type: 'aiGraveOpField', label: '크아이가 ②', count: Math.min(2, G.myField.length) });
    await D(300);
  });

  registerAISummonTrigger('엘더 갓-크타니트', async function(c) {
    if (c.u('엘더 갓-크타니트', 2)) return;
    c.m('엘더 갓-크타니트', 2);
    _aiDrawN(1);
    await c.chain({ type: 'aiForceDiscard', label: '크타니트 ②', count: 1 });
    await D(300);
  });

  registerAISummonTrigger('젊은 라이온', async function(c) {
    if (c.u('젊은 라이온', 2)) return;
    var t = c.findInDeck(function(x) { return x.id.includes('사자') || (CARDS[x.id] && CARDS[x.id].theme === '라이온'); });
    if (!t) return;
    c.m('젊은 라이온', 2);
    await c.chain({ type: 'aiSearch', label: '젊은 라이온 ②', cardId: t.id });
    await D(300);
  });

  registerAISummonTrigger('에이스 라이온', async function(c) {
    if (c.u('에이스 라이온', 1) || G.myField.length === 0) return;
    c.m('에이스 라이온', 1);
    await c.chain({ type: 'aiGraveOpField', label: '에이스 라이온 ①', count: 1 });
    await D(300);
  });

  registerAISummonTrigger('라이온 킹', async function(c) {
    if (c.u('라이온 킹', 2) || G.myField.length === 0) return;
    c.m('라이온 킹', 2);
    await c.chain({ type: 'aiGraveAllOpField', label: '라이온 킹 ②' });
    await D(300);
  });

  registerAISummonTrigger('젊은 타이거', async function(c) {
    if (c.u('젊은 타이거', 2)) return;
    var t = c.findInDeck(function(x) { var cd = CARDS[x.id]; return cd && cd.theme === '타이거' && cd.cardType === 'monster'; });
    if (!t) return;
    c.m('젊은 타이거', 2);
    await c.chain({ type: 'aiSummonDeck', label: '젊은 타이거 ②', cardId: t.id });
    await D(400);
  });

  registerAISummonTrigger('에이스 타이거', async function(c) {
    if (c.u('에이스 타이거', 1)) return;
    c.m('에이스 타이거', 1);
    if (G.opField.length > 0) {
      var wk = G.opField.reduce(function(a, b) { return (a.atk || 0) <= (b.atk || 0) ? a : b; });
      _aiSendOwnFieldToGrave(wk.id);
    }
    if (G.myField.length > 0) await c.chain({ type: 'aiGraveOpField', label: '에이스 타이거 ①', count: 1 });
    await D(300);
  });

  registerAISummonTrigger('타이거 킹', async function(c) {
    if (c.u('타이거 킹', 2) || G.myField.length === 0) return;
    c.m('타이거 킹', 2);
    await c.chain({ type: 'aiExileOpField', label: '타이거 킹 ②', count: Math.min(3, G.myField.length) });
    await D(300);
  });

  registerAISummonTrigger('베이비 라이거', async function(c) {
    if (c.u('베이비 라이거', 2)) return;
    var t = c.findInDeck(function(x) { return x.id === '모두의 자연'; });
    if (!t) return;
    c.m('베이비 라이거', 2);
    await c.chain({ type: 'aiFieldCard', label: '베이비 라이거 ②', cardId: '모두의 자연' });
    await D(300);
  });

  registerAISummonTrigger('젊은 라이거', async function(c) {
    if (c.u('젊은 라이거', 2)) return;
    var t = c.findInDeck(function(x) { var cd = CARDS[x.id]; return cd && cd.theme === '라이거'; });
    if (!t) return;
    c.m('젊은 라이거', 2);
    await c.chain({ type: 'aiSearch', label: '젊은 라이거 ②', cardId: t.id });
    await D(300);
  });

  registerAISummonTrigger('에이스 라이거', async function(c) {
    if (c.u('에이스 라이거', 2)) return;
    var cnt = Math.min(G.opField.length, G.myHand.length);
    if (!cnt) return;
    c.m('에이스 라이거', 2);
    await c.chain({ type: 'aiReturnOpHand', label: '에이스 라이거 ②', count: cnt });
    await D(300);
  });

  registerAISummonTrigger('라이거 킹', async function(c) {
    if (c.u('라이거 킹', 2) || G.myField.length === 0) return;
    c.m('라이거 킹', 2);
    await c.chain({ type: 'aiExileAllOpField', label: '라이거 킹 ②' });
    await D(300);
  });

  registerAISummonTrigger('베이비 마피아', async function(c) {
    if (c.u('베이비 마피아', 2)) return;
    var other = G.opField.some(function(x) { return x.id !== '베이비 마피아' && CARDS[x.id] && CARDS[x.id].theme === '마피아'; });
    if (!other) return;
    var md = c.findInDeck(function(x) { return x.id === '마피아의 도시'; }) ||
             G.opGrave.find(function(x) { return x.id === '마피아의 도시'; });
    if (!md) return;
    c.m('베이비 마피아', 2);
    await c.chain({ type: 'aiFieldCard', label: '베이비 마피아 ②', cardId: '마피아의 도시' });
    await D(300);
  });
})();


// ─────────────────────────────────────────────────────────────
// AI 턴 종료
// ─────────────────────────────────────────────────────────────
function _aiEnd() {
  if (isMyTurn) { window.AI.thinking = false; return; }
  if (typeof resetTurnEffects === 'function') resetTurnEffects();
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();
  G.turn++;
  G.activePlayer = 'host';
  isMyTurn       = true;
  try { attackedMonstersThisTurn.clear(); } catch(e) {}
  gameClock.runningFor  = 'host';
  gameClock.lastUpdated = Date.now();
  advancePhase('draw');
  _setBanner('');
  window.AI.thinking = false;
  renderAll();
  notify('🎮 내 턴! 드로우 버튼을 눌러주세요.');
}


// ─────────────────────────────────────────────────────────────
// 덱 프리셋
// ─────────────────────────────────────────────────────────────
function _aiDeckList(theme) {
  var r = function(id, n) { var a = []; for (var i = 0; i < n; i++) a.push(id); return a; };
  var p = {
    '펭귄':     r('펭귄 마을', 4).concat(r('꼬마 펭귄', 4), r('펭귄 부부', 4), r('현자 펭귄', 4), r('수문장 펭귄', 4), r('펭귄!돌격!', 4), r('펭귄의 영광', 4), r('펭귄이여 영원하라', 4), r('펭귄 마법사', 4), ['구사일생', '구사일생', '눈에는 눈', '눈에는 눈']),
    '크툴루':   r('그레이트 올드 원-크툴루', 4).concat(r('그레이트 올드 원-크투가', 4), r('그레이트 올드 원-크아이가', 4), r('그레이트 올드 원-과타노차', 4), r('엘더 갓-노덴스', 4), r('엘더 갓-크타니트', 4), r('엘더 갓-히프노스', 4), r('올드_원의 멸망', 4), ['구사일생', '구사일생', '눈에는 눈', '눈에는 눈']),
    '라이온':   r('베이비 라이온', 4).concat(r('젊은 라이온', 4), r('에이스 라이온', 4), r('사자의 포효', 4), r('사자의 사냥', 4), r('사자의 발톱', 4), r('사자의 일격', 4), r('진정한 사자', 4), ['구사일생', '구사일생', '눈에는 눈', '눈에는 눈', '출입통제', '출입통제']),
    '타이거':   r('베이비 타이거', 4).concat(r('젊은 타이거', 4), r('에이스 타이거', 4), r('호랑이의 포효', 4), r('호랑이의 사냥', 4), r('호랑이의 발톱', 4), r('진정한 호랑이', 4), r('호랑이의 일격', 4), ['구사일생', '구사일생', '눈에는 눈', '눈에는 눈', '출입통제', '출입통제']),
    '지배자':   r('수원소의 지배자', 4).concat(r('화원소의 지배자', 4), r('전원소의 지배자', 4), r('풍원소의 지배자', 4), r('수원소의 지배룡', 4), r('화원소의 지배룡', 4), r('전원소의 지배룡', 4), r('풍원소의 지배룡', 4), ['지배의 사슬', '지배의 사슬', '지배룡과 지배자', '지배룡과 지배자', '눈에는 눈', '눈에는 눈', '출입통제', '출입통제']),
    '불가사의': r('불가사의한 귀신 헬리콥터', 4).concat(r('불가사의한 망태 할아버지', 4), r('불가사의한 빨간 마스크', 4), r('불가사의한 장산범', 4), r('불가사의한 밤의 대도시', 4), r('불가사의한 화폐 속 암호', 4), r('불가사의한 분신사바', 4), r('불가사의한 숨바꼭질 인형', 4), r('불가사의한 일루미나티', 4), ['구사일생', '구사일생', '눈에는 눈', '눈에는 눈', '출입통제', '출입통제']),
  };
  return (p[theme] || p['크툴루']).slice();
}

function _aiKeyList(theme) {
  var k = {
    '펭귄':     ['펭귄 용사', '펭귄의 일격', '펭귄의 전설', '일격필살', '단 한번의 기회'],
    '크툴루':   ['아우터 갓 니알라토텝', '아우터 갓-아자토스', '아우터 갓 슈브 니구라스', '일격필살', '단 한번의 기회'],
    '라이온':   ['라이온 킹', '고고한 사자', '일격필살', '단 한번의 기회'],
    '타이거':   ['타이거 킹', '고고한 호랑이', '일격필살', '단 한번의 기회'],
    '지배자':   ['사원소의 지배룡', '사원소의 지배자', '일격필살', '단 한번의 기회'],
    '불가사의': ['불가사의한 13일의 금요일', '불가사의한 적월', '불가사의한 지배', '불가사의한 원흉', '일격필살'],
  };
  return (k[theme] || k['크툴루'])
    .filter(function(id) { return !!CARDS[id]; })
    .map(function(id) { return { id: id, name: CARDS[id].name }; });
}


// ─────────────────────────────────────────────────────────────
// 배너 UI
// ─────────────────────────────────────────────────────────────
function _aiBanner() {
  if (document.getElementById('_aiBanner')) return;
  var el = document.createElement('div');
  el.id = '_aiBanner';
  el.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#1a0a00,#7c3400,#1a0a00);color:#fb923c;padding:.35rem 1.6rem;border:1px solid #ea580c;border-top:none;border-radius:0 0 10px 10px;font-family:Black Han Sans,sans-serif;font-size:.8rem;letter-spacing:.1em;z-index:3000;box-shadow:0 4px 20px #ea580c44;pointer-events:none;transition:opacity .25s;opacity:0;';
  document.body.appendChild(el);
}

function _setBanner(msg) {
  var el = document.getElementById('_aiBanner');
  if (!el) return;
  el.textContent  = msg;
  el.style.opacity = msg ? '1' : '0';
}


// ─────────────────────────────────────────────────────────────
// _pendingSetup 폴백 (patch.js 연동, 이중 호출 안전)
// ─────────────────────────────────────────────────────────────
setInterval(function() {
  if (!window.AI || !window.AI.active) return;
  if (!window.AI._pendingSetup) return;
  if (!window.G || !Array.isArray(G.myHand) || typeof advancePhase !== 'function') return;
  window.AI._pendingSetup = false;
  _setupAI();
}, 200);


// ─────────────────────────────────────────────────────────────
// 로비 카드 삽입
// [BUG-12 FIX] 불필요한 중복 setTimeout 제거, 한 번만 등록
// ─────────────────────────────────────────────────────────────
function _lobby() {
  var lobby = document.getElementById('lobby');
  if (!lobby || document.getElementById('_aiCard')) return;
  var card = document.createElement('div');
  card.id        = '_aiCard';
  card.className = 'lobby-card';
  card.style.cssText = 'border-color:#ea580c;background:linear-gradient(160deg,#1a0a00,#2d1500);';
  card.innerHTML =
    '<h2 style="color:#fb923c;display:flex;align-items:center;gap:.5rem">🤖 AI 대전 <span style="font-size:.65rem;color:#ea580c;border:1px solid #ea580c;padding:.1rem .4rem;border-radius:3px">Groq AI</span></h2>' +
    '<p style="font-size:.82rem;color:#9090b0;line-height:1.65;margin:.25rem 0 .8rem">Groq AI가 전황을 분석해 전략적으로 플레이합니다.<br>내가 선공, AI가 후공으로 시작합니다.</p>' +
    '<button style="width:100%;padding:.8rem;background:linear-gradient(135deg,#431407,#9a3412);color:#fed7aa;border:1px solid #ea580c;border-radius:6px;font-family:Black Han Sans,sans-serif;font-size:1rem;letter-spacing:.12em;cursor:pointer;" ' +
    'onmouseover="this.style.background=\'linear-gradient(135deg,#7c2d12,#c2410c)\'" ' +
    'onmouseout="this.style.background=\'linear-gradient(135deg,#431407,#9a3412)\'" ' +
    'onclick="startAIMode()">⚔️ AI와 대전하기 (내가 선공)</button>';
  var all  = lobby.querySelectorAll('.lobby-card');
  var last = all[all.length - 1];
  if (last) last.after(card);
  else lobby.appendChild(card);
}

// [BUG-12 FIX] 최대 2번만 시도 (즉시 + DOMContentLoaded 대비)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _lobby);
} else {
  _lobby();
}
setTimeout(_lobby, 800); // SPA 동적 렌더링 대비 1회만


// ─────────────────────────────────────────────────────────────
// 체인 훅 (beginChain / addChainLink / passChainPriority / resolveChain)
// ─────────────────────────────────────────────────────────────
_safeHook('beginChain', function(_origBeginChain) {
  return function(effect) {
    _origBeginChain.apply(this, arguments);
    if (!window.AI.active || roomRef) return;
    var live = activeChainState;
    if (!live || !live.active || live.priority !== _aiRole()) return;
    setTimeout(function() {
      if (!activeChainState || !activeChainState.active) return;
      _aiChainResponse(activeChainState);
    }, 350);
  };
});

_safeHook('addChainLink', function(_origAddChainLink) {
  return function(effect) {
    _origAddChainLink.apply(this, arguments);
    if (!window.AI.active || roomRef) return;
    var live = activeChainState;
    if (!live || !live.active || live.priority !== _aiRole()) return;
    setTimeout(function() {
      if (!activeChainState || !activeChainState.active) return;
      _aiChainResponse(activeChainState);
    }, 350);
  };
});

_safeHook('passChainPriority', function(_origPassChainPriority) {
  return function() {
    if (!window.AI.active) {
      _origPassChainPriority.apply(this, arguments);
      return;
    }
    var liveBefore = activeChainState;
    // AI 모드 + roomRef 없음 + 플레이어 우선권일 때 직접 처리
    var shouldHandleLocal = !roomRef && liveBefore && liveBefore.active && liveBefore.priority === myRole;
    if (shouldHandleLocal) {
      // [BUG-08 FIX] links 딥카피
      var next       = Object.assign({}, liveBefore);
      next.links     = (liveBefore.links || []).slice();
      next.passCount = (next.passCount || 0) + 1;
      next.priority  = _aiRole();
      activeChainState = next;
      log('체인 패스', 'system');
      renderChainActions();
      if (next.passCount >= 2) {
        resolveChain(next);
      } else {
        setTimeout(function() {
          if (!activeChainState || !activeChainState.active) return;
          _aiChainResponse(activeChainState);
        }, 400);
      }
    } else {
      _origPassChainPriority.apply(this, arguments);
    }
  };
});

_safeHook('resolveChain', function(_origResolveChain) {
  return function(chainState) {
    _clearAIChainTimer();
    if (window.AI && window.AI.chainMemory) window.AI.chainMemory.respondedSig = null;
    return _origResolveChain.apply(this, arguments);
  };
});


// ─────────────────────────────────────────────────────────────
// AI 체인 응답 판단
// ─────────────────────────────────────────────────────────────
function _collectAIChainOptions(chainState) {
  var liveChain = chainState || activeChainState;
  if (!liveChain || !liveChain.active) return [];
  if (typeof collectChainOptions !== 'function') return [];

  var commonOptions = collectChainOptions({
    hand:    G.opHand,
    field:   G.opField,
    grave:   G.opGrave,
    exile:   G.opExile,
    keyDeck: G.opKeyDeck,
    role:    _aiRole(),
    usedFx:  window.AI.usedFx,
    isMyTurn: false,
  }) || [];

  return commonOptions.map(function(opt) {
    var score = 50;
    var label = String((opt && opt.label) || '');
    var links = (liveChain && liveChain.links) || [];
    var last  = links.length ? links[links.length - 1] : null;
    var lastType = String((last && last.type) || '');
    if (label.indexOf('무효') >= 0 || label.indexOf('출입통제') >= 0) score += 20;
    if (label.indexOf('눈에는 눈') >= 0 && (lastType.indexOf('search') >= 0 || lastType === 'keyFetch' || lastType === 'aiSearch')) score += 15;
    if (label.indexOf('묘지') >= 0 || label.indexOf('제외') >= 0) score += 10;
    if (G.opHand.length <= 2) score -= 8;

    return {
      id:          opt.cardId || opt.label || 'unknown',
      label:       opt.label || opt.cardId || '체인 응답',
      score:       score,
      rawActivate: function() { opt.activate(); },
    };
  });
}

function _canAIRespondNow(state) {
  if (!state || !state.active) return false;
  if (state.priority !== _aiRole()) return false;
  var links = state.links || [];
  if (!links.length) return false;
  var last = links[links.length - 1] || {};
  return last.by === _playerRole() || (state.passCount || 0) > 0;
}

// [BUG-07 FIX] 시그니처에서 priority 제거 — 링크 내용만으로 구성
function _chainSignature(state) {
  if (!state || !state.active) return '';
  var chainId = String(state.chainId || '');
  var links   = (state.links || []).map(function(l) {
    return String((l && l.by) || '') + ':' + String((l && l.type) || '');
  }).join('|');
  return chainId + '|' + links;
}

function _markAIChainHandled(state) {
  if (!window.AI || !window.AI.chainMemory) return;
  window.AI.chainMemory.respondedSig = _chainSignature(state);
}

function _clearAIChainTimer() {
  if (!window.AI || !window.AI.chainTimer) return;
  clearTimeout(window.AI.chainTimer);
  window.AI.chainTimer = null;
}

function _startAIChainWatcher() {
  if (!window.AI || !window.AI.active) return;
  if (window.AI.chainWatcher) return;
  window.AI.chainWatcher = setInterval(function() {
    if (!window.AI.active) return;
    var live = activeChainState;
    if (!live || !live.active) return;
    if (live.priority !== _aiRole()) return;
    _scheduleAIChainFallback();
  }, 500);
}

function _scheduleAIChainFallback() {
  if (!window.AI || !window.AI.active) return;
  _clearAIChainTimer();
  window.AI.chainTimer = setTimeout(function() {
    if (!window.AI.active) return;
    var live = activeChainState;
    if (!live || !live.active) return;
    if (live.priority !== _aiRole()) return;
    _aiChainResponse(live);
  }, 1800);
}

function _alreadyHandledChainState(state) {
  if (!window.AI || !window.AI.chainMemory) return false;
  return window.AI.chainMemory.respondedSig === _chainSignature(state);
}


// ─────────────────────────────────────────────────────────────
// AI 체인 응답 실행
// ─────────────────────────────────────────────────────────────
function _aiChainResponse(chainState) {
  if (!window.AI.active) return;
  _clearAIChainTimer();
  if (!activeChainState || !activeChainState.active) return;
  if (!_canAIRespondNow(activeChainState)) return;
  if (_alreadyHandledChainState(activeChainState)) return;

  var options = _collectAIChainOptions(activeChainState || chainState);
  options.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
  var picked = options[0] || null;

  if (!picked) {
    // AI 패스
    setTimeout(function() {
      if (!activeChainState || !activeChainState.active) return;
      // [BUG-08 FIX] links 딥카피
      var next       = Object.assign({}, activeChainState);
      next.links     = (activeChainState.links || []).slice();
      next.passCount = (next.passCount || 0) + 1;
      next.priority  = _playerRole();
      log('🤖 AI: 패스', 'opponent');
      activeChainState = next;
      _markAIChainHandled(next);

      if (next.passCount >= 2) {
        resolveChain(next);
      } else {
        renderChainActions();
        if (!_playerCanRespondInChain(next)) {
          next.passCount = 2;
          activeChainState = next;
          resolveChain(next);
        } else {
          notify('🤖 AI가 패스했습니다. 응답하거나 패스해주세요.');
        }
      }
    }, 600);
    return;
  }

  // AI가 카드 발동
  setTimeout(function() {
    if (!activeChainState || !activeChainState.active) return;
    picked.rawActivate();
    log('🤖 ' + picked.id + ' 체인 발동!', 'opponent');

    var next = activeChainState;
    if (!next || !next.active) return;
    _markAIChainHandled(next);
    renderChainActions();
    renderAll();

    if (_playerCanRespondInChain(next)) {
      var lastLink = (next.links || [])[(next.links || []).length - 1] || {};
      notify('체인 ' + next.links.length + ': ' + (lastLink.label || picked.id) + '. 응답 또는 패스를 선택하세요.');
    } else {
      // [BUG-08 FIX] links 딥카피
      next = Object.assign({}, next, { links: (next.links || []).slice(), passCount: 1 });
      activeChainState = next;
      setTimeout(function() {
        if (!activeChainState || !activeChainState.active) return;
        var final = Object.assign({}, activeChainState, { passCount: 2 });
        resolveChain(final);
      }, 300);
    }
  }, 400);
}

// [BUG-10 FIX] collectChainOptions에 플레이어 컨텍스트를 명시적으로 전달
function _playerCanRespondInChain(state) {
  if (!state || !state.active) return false;
  if (state.priority !== _playerRole()) return false;
  if (typeof collectChainOptions === 'function') {
    var opts = collectChainOptions({
      hand:    G.myHand,
      field:   G.myField,
      grave:   G.myGrave,
      exile:   G.myExile,
      keyDeck: G.myKeyDeck,
      role:    myRole,
      isMyTurn: isMyTurn,
    });
    return opts.length > 0;
  }
  return Array.isArray(G.myKeyDeck) && G.myKeyDeck.length > 0;
}


// ─────────────────────────────────────────────────────────────
// _notifyAIChainOpened — effects-chain.js에서 호출
// ─────────────────────────────────────────────────────────────
function _notifyAIChainOpened() {
  if (!window.AI || !window.AI.active) return;
  var live = activeChainState;
  if (!live || !live.active) return;
  if (live.priority !== _aiRole()) return;
  setTimeout(function() {
    if (!activeChainState || !activeChainState.active) return;
    _aiChainResponse(activeChainState);
  }, 350);
}
window._notifyAIChainOpened  = _notifyAIChainOpened;
window._aiChainResponse      = _aiChainResponse;
window._aiRespondToChain     = function() { _aiChainResponse(activeChainState); };
