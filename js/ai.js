// ============================================================
// ai.js — AI 대전 모듈 (engine.js 구조 기반)
// ============================================================
// 설치: index.html 의 <script src="js/patch.js"></script> 뒤에
//       <script src="js/ai.js"></script> 추가
// ============================================================
'use strict';

window.AI = {
  active:      false,
  thinking:    false,
  opDeck:      [],   // AI 메인덱 (shuffled)
  deckPreset:  null,
  usedFx:      {},   // {cardId_n: count}
  attacked:    new Set(),
};

// ─────────────────────────────────────────────────────────────
// 훅 등록 — DOM 로드 전에 선언해서 나중에 연결
// ─────────────────────────────────────────────────────────────

// 1) initDecks 훅 — AI 모드일 때 op쪽 초기화를 막는다
(function() {
  // initDecks 는 engine.js에서 전역으로 선언되어 있음
  // effects-theme.js 로드 후에도 같은 함수가 쓰임
  // → DOM 완전 로드 후 덮어쓰기
  function _patchInitDecks() {
    var _orig = window.initDecks;
    if (!_orig) return;
    window.initDecks = function() {
      _orig.apply(this, arguments);
      // AI 모드면 op 존 초기화를 되돌린다
      if (window.AI.active) {
        G.opHand      = [];
        G.opField     = [];
        G.opGrave     = [];
        G.opExile     = [];
        G.opFieldCard = null;
        G.opKeyDeck   = [];
        G.opDeckCount = window.AI.opDeck ? window.AI.opDeck.length : 0;
      }
    };
    window._initDeckPatched = true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_patchInitDecks, 0); });
  } else {
    setTimeout(_patchInitDecks, 0);
  }
})();

// 2) enterGame 훅 — AI 게임 초기화를 enterGame() 완료 직후에 실행
(function() {
  function _patchEnterGame() {
    var _orig = window.enterGame;
    if (!_orig) return;
    window.enterGame = function() {
      _orig.apply(this, arguments);
      if (window.AI.active) {
        // enterGame/_startNewGame/initDecks 가 모두 끝난 뒤
        // (drawN 호출까지 동기 완료) 실행
        setTimeout(_setupAIAfterEnterGame, 0);
      }
    };
    window._enterGamePatched = true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_patchEnterGame, 50); });
  } else {
    setTimeout(_patchEnterGame, 50);
  }
})();

// 3) endTurn 훅
(function() {
  function _patchEndTurn() {
    var _orig = window.endTurn;
    if (!_orig) return;
    window.endTurn = function() {
      _orig.apply(this, arguments);
      // endTurn 안에서 isMyTurn = false 가 설정된 뒤
      if (window.AI.active && !isMyTurn) {
        setTimeout(_aiStartTurn, 700);
      }
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_patchEndTurn, 100); });
  } else {
    setTimeout(_patchEndTurn, 100);
  }
})();

// 4) checkWinCondition 훅 — AI 패 0 = 플레이어 승리
(function() {
  function _patchCheckWin() {
    var _orig = window.checkWinCondition;
    if (!_orig) return;
    window.checkWinCondition = function() {
      _orig.apply(this, arguments);
      if (!window.AI.active) return;
      if (G.opHand.length === 0 && !isMyTurn) {
        setTimeout(function() {
          if (typeof showGameOver === 'function') showGameOver(true);
        }, 300);
      }
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_patchCheckWin, 100); });
  } else {
    setTimeout(_patchCheckWin, 100);
  }
})();

// ─────────────────────────────────────────────────────────────
// 로비 진입
// ─────────────────────────────────────────────────────────────
window.startAIMode = function() {
  window.AI.active = true;
  // Firebase 사용 안 함
  window.roomRef  = null;
  window.myRole   = 'host';

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool  === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

// ─────────────────────────────────────────────────────────────
// AI 덱 빌드 (enterGame 전에 호출)
// ─────────────────────────────────────────────────────────────
function _buildAIDeck() {
  var pd = window._confirmedDeck || [];
  var tc = {};
  pd.forEach(function(id) {
    var t = CARDS[id] && CARDS[id].theme;
    if (t) tc[t] = (tc[t] || 0) + 1;
  });
  var top = '펭귄', topN = 0;
  Object.keys(tc).forEach(function(t) { if (tc[t] > topN) { topN = tc[t]; top = t; } });

  var cm = { '펭귄':'크툴루', '올드원':'펭귄', '라이온':'타이거', '타이거':'라이온',
             '라이거':'펭귄', '지배자':'크툴루', '마피아':'펭귄', '불가사의':'펭귄' };
  window.AI.deckPreset = cm[top] || '펭귄';

  var list = _presetMain(window.AI.deckPreset).filter(function(id) { return CARDS[id]; });
  while (list.length < 40) list.push('구사일생');
  list = list.slice(0, 60);

  // shuffle — engine.js의 shuffle() 사용
  window.AI.opDeck = shuffle(list.map(function(id) {
    return { id: id, name: (CARDS[id] ? CARDS[id].name : id) };
  }));
  window.AI.usedFx  = {};
  window.AI.attacked = new Set();
}

function _presetMain(theme) {
  var r = function(id, n) { var a = []; for (var i = 0; i < n; i++) a.push(id); return a; };
  var p = {
    '펭귄':   r('펭귄 마을',4).concat(r('꼬마 펭귄',4),r('펭귄 부부',4),r('현자 펭귄',4),
              r('수문장 펭귄',4),r('펭귄!돌격!',4),r('펭귄의 영광',4),
              r('펭귄이여 영원하라',4),r('펭귄 마법사',4),
              ['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '크툴루': r('그레이트 올드 원-크툴루',4).concat(r('그레이트 올드 원-크투가',4),
              r('그레이트 올드 원-크아이가',4),r('그레이트 올드 원-과타노차',4),
              r('엘더 갓-노덴스',4),r('엘더 갓-크타니트',4),r('엘더 갓-히프노스',4),
              r('올드_원의 멸망',4),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '라이온': r('베이비 라이온',4).concat(r('젊은 라이온',4),r('에이스 라이온',4),
              r('사자의 포효',4),r('사자의 사냥',4),r('사자의 발톱',4),
              r('사자의 일격',4),r('진정한 사자',4),
              ['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '타이거': r('베이비 타이거',4).concat(r('젊은 타이거',4),r('에이스 타이거',4),
              r('호랑이의 포효',4),r('호랑이의 사냥',4),r('호랑이의 발톱',4),
              r('진정한 호랑이',4),r('호랑이의 일격',4),
              ['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '지배자': r('수원소의 지배자',4).concat(r('화원소의 지배자',4),r('전원소의 지배자',4),
              r('풍원소의 지배자',4),r('수원소의 지배룡',4),r('화원소의 지배룡',4),
              r('전원소의 지배룡',4),r('풍원소의 지배룡',4),
              ['지배의 사슬','지배의 사슬','지배룡과 지배자','지배룡과 지배자',
               '눈에는 눈','눈에는 눈','출입통제','출입통제']),
  };
  return (p[theme] || p['펭귄']).slice();
}

function _presetKey(theme) {
  var k = {
    '펭귄':   ['펭귄 용사','펭귄의 일격','펭귄의 전설','일격필살','단 한번의 기회'],
    '크툴루': ['아우터 갓 니알라토텝','아우터 갓-아자토스','아우터 갓 슈브 니구라스','일격필살','단 한번의 기회'],
    '라이온': ['라이온 킹','고고한 사자','일격필살','단 한번의 기회'],
    '타이거': ['타이거 킹','고고한 호랑이','일격필살','단 한번의 기회'],
    '지배자': ['사원소의 지배룡','사원소의 지배자','일격필살','단 한번의 기회'],
  };
  return (k[theme] || k['펭귄']).filter(function(id) { return CARDS[id]; });
}

// ─────────────────────────────────────────────────────────────
// confirmDeck → enterGameWithDeck 직전에 AI 덱 빌드
// ─────────────────────────────────────────────────────────────
(function() {
  function _patchConfirmDeck() {
    var _orig = window.confirmDeck;
    if (!_orig) return;
    window.confirmDeck = function() {
      if (window.AI.active) _buildAIDeck(); // 덱 빌드 먼저
      _orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_patchConfirmDeck, 50); });
  } else {
    setTimeout(_patchConfirmDeck, 50);
  }
})();

// ─────────────────────────────────────────────────────────────
// enterGame 완료 후 AI 상태 세팅
// (_startNewGame → initDecks → drawN 이 모두 끝난 다음)
// ─────────────────────────────────────────────────────────────
function _setupAIAfterEnterGame() {
  if (!window.AI.active) return;

  // 혹시 덱이 아직 안 만들어졌으면 지금 만든다
  if (!window.AI.opDeck || window.AI.opDeck.length === 0) _buildAIDeck();

  // op 상태 덮어쓰기
  G.opHand      = [];
  G.opField     = [];
  G.opGrave     = [];
  G.opExile     = [];
  G.opFieldCard = null;
  G.opKeyDeck   = _presetKey(window.AI.deckPreset).map(function(id) {
    return { id: id, name: (CARDS[id] ? CARDS[id].name : id) };
  });
  G.opDeckCount = window.AI.opDeck.length;

  // AI 초기 드로우 7장 (guest 기준)
  _aiDraw(7);

  // 헤더 이름
  document.getElementById('hdrOpName').textContent   = '🤖 AI (' + window.AI.deckPreset + ')';
  document.getElementById('opNameLabel').textContent = '🤖 AI';

  // 배너
  _injectBanner();
  log('🤖 AI (' + window.AI.deckPreset + ') 참전! 패 ' + G.opHand.length + '장', 'system');

  renderAll();
}

// ─────────────────────────────────────────────────────────────
// AI 카드 조작 (모두 handleOpponentAction 경유로 플레이어 화면 갱신)
// ─────────────────────────────────────────────────────────────

function _aiDraw(n) {
  for (var i = 0; i < n; i++) {
    if (!window.AI.opDeck.length) {
      log('🤖 AI 덱 아웃!', 'system');
      if (typeof showGameOver === 'function') showGameOver(true);
      return false;
    }
    var c = window.AI.opDeck.shift();
    G.opHand.push({ id: c.id, name: c.name });
    G.opDeckCount = window.AI.opDeck.length;
  }
  return true;
}

function _aiRemoveHand(cardId) {
  var i = G.opHand.findIndex(function(c) { return c.id === cardId; });
  if (i >= 0) G.opHand.splice(i, 1);
}

// 몬스터 소환 — handleOpponentAction('summon')을 호출해서
// 플레이어 화면의 goldenApple 드로우 등 부수 효과까지 자동 처리
function _aiSummonMonster(cardId) {
  var card = CARDS[cardId];
  if (!card || card.cardType !== 'monster') return false;
  _aiRemoveHand(cardId);
  G.opField.push({ id: cardId, name: card.name,
                   atk: card.atk != null ? card.atk : 0,
                   atkBase: card.atk != null ? card.atk : 0 });
  log('🤖 소환: ' + card.name + ' ATK' + (card.atk != null ? card.atk : 0), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiSummonFromDeck(cardId) {
  var idx = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opDeckCount = window.AI.opDeck.length;
  var card = CARDS[cardId] || {};
  G.opField.push({ id: cardId, name: card.name || cardId,
                   atk: card.atk != null ? card.atk : 0,
                   atkBase: card.atk != null ? card.atk : 0 });
  log('🤖 덱에서 소환: ' + (card.name || cardId), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiSummonFromGrave(cardId) {
  var idx = G.opGrave.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  G.opGrave.splice(idx, 1);
  var card = CARDS[cardId] || {};
  G.opField.push({ id: cardId, name: card.name || cardId,
                   atk: card.atk != null ? card.atk : 0,
                   atkBase: card.atk != null ? card.atk : 0 });
  log('🤖 묘지에서 소환: ' + (card.name || cardId), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiDiscard(cardId) {
  _aiRemoveHand(cardId);
  G.opGrave.push({ id: cardId, name: (CARDS[cardId] ? CARDS[cardId].name : cardId) });
  handleOpponentAction({ type: 'discard', cardId: cardId, by: 'guest', ts: Date.now() });
}

function _aiSearchDeck(cardId) {
  var idx = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opHand.push({ id: cardId, name: (CARDS[cardId] ? CARDS[cardId].name : cardId) });
  G.opDeckCount = window.AI.opDeck.length;
  log('🤖 서치: ' + (CARDS[cardId] ? CARDS[cardId].name : cardId), 'opponent');
  // 눈에는 눈 트리거
  handleOpponentAction({ type: 'search', cardName: (CARDS[cardId] ? CARDS[cardId].name : cardId), by: 'guest', ts: Date.now() });
  return true;
}

// 전투 — handleOpponentAction('combat')으로 위임
// → handleOpponentCombat이 플레이어 피해(forceDiscard, 구사일생 등)를 자동 처리
function _aiAttack(atkId, defIdx) {
  if (window.AI.attacked.has(atkId)) return false;
  var atkFI = G.opField.findIndex(function(c) { return c.id === atkId; });
  if (atkFI < 0) return false;
  var def = G.myField[defIdx];
  if (!def) return false;

  window.AI.attacked.add(atkId);
  var atk = G.opField[atkFI];
  var diff = atk.atk - def.atk;

  log('🤖 공격: ' + atk.name + '(' + atk.atk + ') → ' + def.name + '(' + def.atk + ')', 'opponent');

  // 플레이어 화면 피해 처리 (forceDiscard, 구사일생 포함)
  handleOpponentAction({
    type: 'combat',
    atkCard: { id: atk.id, name: atk.name, atk: atk.atk },
    defCard: { id: def.id, name: def.name, atk: def.atk },
    by: 'guest', ts: Date.now(),
  });

  // AI 몬스터 패배 처리
  if (atk.atk !== 0) {
    if (diff <= 0) {
      var ri = G.opField.findIndex(function(c) { return c.id === atkId; });
      if (ri >= 0) G.opGrave.push(G.opField.splice(ri, 1)[0]);
    }
  }
  return true;
}

function _aiDirectAttack(atkId) {
  if (G.myField.length > 0 || window.AI.attacked.has(atkId)) return false;
  var fi = G.opField.findIndex(function(c) { return c.id === atkId; });
  if (fi < 0) return false;
  var atk = G.opField[fi];
  window.AI.attacked.add(atkId);
  log('🤖 직접 공격: ' + atk.name + '(' + atk.atk + ')', 'opponent');
  handleOpponentAction({
    type: 'directAttack',
    card: { id: atk.id, name: atk.name, atk: atk.atk },
    by: 'guest', ts: Date.now(),
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// AI 턴 흐름
// ─────────────────────────────────────────────────────────────
var _sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

async function _aiStartTurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true;
  window.AI.usedFx  = {};
  window.AI.attacked = new Set();
  _setBanner('🤖 드로우 중...');

  try {
    // ── 드로우 단계 ──
    if (currentPhase === 'draw') {
      if (!_aiDraw(1)) { window.AI.thinking = false; return; }
      log('🤖 드로우 (패:' + G.opHand.length + ' 덱:' + window.AI.opDeck.length + ')', 'opponent');
      advancePhase('deploy');
      await _sleep(400);
      renderAll();
    }

    // ── Claude API 전략 ──
    _setBanner('🤖 전략 계산 중...');
    await _sleep(200);
    var plan;
    try { plan = await _claudePlan(); }
    catch(e) {
      console.warn('[AI] Claude API 실패:', e.message);
      plan = _fallback();
    }
    if (plan.thinking) { log('🤖 "' + plan.thinking + '"', 'opponent'); await _sleep(300); }

    // ── 전개 단계 ──
    _setBanner('🤖 전개 중...');
    await _execDeploy(plan.deploy || []);
    advancePhase('attack');
    await _sleep(300);
    renderAll();

    // ── 선공 1턴 공격 없음 ──
    if (G.turn <= 2 && myRole === 'host') {
      log('🤖 선공 1턴 — 공격 없음', 'opponent');
      advancePhase('end');
      await _sleep(200);
      _aiEndTurn();
      return;
    }

    // ── 공격 단계 ──
    _setBanner('🤖 공격 중...');
    await _execAttack(plan.attack || []);
    advancePhase('end');
    await _sleep(200);
    _aiEndTurn();

  } catch(e) {
    console.error('[AI] 턴 오류:', e);
    try { advancePhase('end'); } catch(_) {}
    _aiEndTurn();
  }
}

// ─────────────────────────────────────────────────────────────
// Claude API
// ─────────────────────────────────────────────────────────────
async function _claudePlan() {
  var state = {
    turn: G.turn,
    ai: {
      hand: G.opHand.map(function(c) {
        var cd = CARDS[c.id] || {};
        return { id: c.id, name: c.name, cardType: cd.cardType, atk: cd.atk,
                 theme: cd.theme, effects: cd.effects };
      }),
      field: G.opField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      grave: G.opGrave.map(function(c) { return c.id; }),
      deckCount: window.AI.opDeck.length,
    },
    player: {
      handCount: G.myHand.length,
      field: G.myField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      deckCount: G.myDeckCount,
    },
  };

  var sys = [
    '당신은 카드 게임 "핸드 배틀 TCG"의 AI 플레이어입니다.',
    '목표: 상대(플레이어)의 패(hand)를 0장으로 만들기.',
    '',
    '전투 규칙:',
    '- 내ATK > 상대ATK: 상대 몬스터 제거 + 차이만큼 상대 패 손실',
    '- 내ATK < 상대ATK: 내 몬스터 제거 + 차이만큼 내 패 손실',
    '- 상대 필드 비었을 때 직접 공격: ATK만큼 상대 패 손실',
    '',
    '전략 원칙:',
    '1. ATK 높은 몬스터를 최대한 소환',
    '2. 상대 필드가 비면 전원 직접 공격',
    '3. 이길 수 있는(ATK 우위) 전투만 선택',
    '4. summonFromHand는 monster 카드만 가능',
    '',
    '중요: 아래 JSON만 응답. 마크다운 없이.',
    '{',
    '  "thinking": "전략 한 줄 (한국어)",',
    '  "deploy": [',
    '    { "action": "summonFromHand", "cardId": "카드ID" }',
    '  ],',
    '  "attack": [',
    '    { "action": "attack", "attackerId": "내필드ID", "targetIdx": 0 },',
    '    { "action": "directAttack", "attackerId": "내필드ID" }',
    '  ]',
    '}',
    '',
    '주의:',
    '- deploy.cardId: ai.hand에 있는 monster 카드 id만',
    '- attack.attackerId: ai.field 또는 deploy 후 필드에 있을 id',
    '- attack.targetIdx: player.field 인덱스 (0~)',
    '- 상대 필드 비었으면 attack 아닌 directAttack 사용',
  ].join('\n');

  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: sys,
      messages: [{ role: 'user', content: JSON.stringify(state) }],
    }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  var data = await resp.json();
  var text = (data.content || []).map(function(b) { return b.text || ''; }).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ─────────────────────────────────────────────────────────────
// 폴백 (API 실패)
// ─────────────────────────────────────────────────────────────
function _fallback() {
  var plan = { thinking: '기본 전략: 강한 몬스터 소환 후 공격', deploy: [], attack: [] };

  // ATK 높은 몬스터 최대 3장 소환
  var mons = G.opHand
    .filter(function(c) { return CARDS[c.id] && CARDS[c.id].cardType === 'monster'; })
    .map(function(c) { return { id: c.id, atk: CARDS[c.id].atk || 0 }; })
    .sort(function(a, b) { return b.atk - a.atk; })
    .slice(0, 3);
  mons.forEach(function(c) {
    plan.deploy.push({ action: 'summonFromHand', cardId: c.id });
  });

  // 공격 계획 (예상 필드 = 현재 opField + 지금 소환할 것들)
  var expectedField = G.opField.concat(mons.map(function(c) {
    return { id: c.id, atk: CARDS[c.id] ? (CARDS[c.id].atk || 0) : 0 };
  }));

  if (G.myField.length === 0) {
    expectedField.forEach(function(c) {
      plan.attack.push({ action: 'directAttack', attackerId: c.id });
    });
  } else {
    expectedField.forEach(function(att) {
      var bestIdx = -1, bestGain = 0;
      G.myField.forEach(function(def, di) {
        var gain = (att.atk || 0) - (def.atk || 0);
        if (gain > bestGain) { bestGain = gain; bestIdx = di; }
      });
      if (bestIdx >= 0) {
        plan.attack.push({ action: 'attack', attackerId: att.id, targetIdx: bestIdx });
      }
    });
  }
  return plan;
}

// ─────────────────────────────────────────────────────────────
// 전개 실행
// ─────────────────────────────────────────────────────────────
async function _execDeploy(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act || !act.action || !act.cardId) continue;

    if (act.action === 'summonFromHand') {
      // 패에 있는지 확인
      if (!G.opHand.find(function(c) { return c.id === act.cardId; })) continue;
      var cd = CARDS[act.cardId];
      if (!cd || cd.cardType !== 'monster') continue;

      _aiSummonMonster(act.cardId);
      await _sleep(500);
      // 소환 유발 효과
      await _aiSummonTrigger(act.cardId);
      renderAll();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 공격 실행
// ─────────────────────────────────────────────────────────────
async function _execAttack(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'attack') {
      var di = typeof act.targetIdx === 'number' ? act.targetIdx : 0;
      if (di >= G.myField.length) continue;
      if (!G.opField.find(function(c) { return c.id === act.attackerId; })) continue;
      _aiAttack(act.attackerId, di);
      await _sleep(800);
      renderAll();

    } else if (act.action === 'directAttack') {
      if (G.myField.length > 0) continue;
      if (!G.opField.find(function(c) { return c.id === act.attackerId; })) continue;
      _aiDirectAttack(act.attackerId);
      await _sleep(800);
      renderAll();
    }

    if (G.myHand.length === 0) break; // 이미 승리
  }
}

// ─────────────────────────────────────────────────────────────
// 소환 유발 효과
// ─────────────────────────────────────────────────────────────
async function _aiSummonTrigger(cardId) {
  var AI = window.AI;

  // 꼬마 펭귄 ②: 소환 시 덱에서 펭귄 몬스터 소환
  if (cardId === '꼬마 펭귄' && !(AI.usedFx['꼬마 펭귄_2'])) {
    var t = AI.opDeck.find(function(c) {
      return CARDS[c.id] && CARDS[c.id].theme === '펭귄' && CARDS[c.id].cardType === 'monster';
    });
    if (t) {
      AI.usedFx['꼬마 펭귄_2'] = 1;
      _aiSummonFromDeck(t.id);
      await _sleep(400);
      renderAll();
    }
  }

  // 수문장 펭귄 ①: ATK+1, 서로 패 1장 버리기
  if (cardId === '수문장 펭귄' && !(AI.usedFx['수문장 펭귄_1'])) {
    var fi = G.opField.findIndex(function(c) { return c.id === '수문장 펭귄'; });
    if (fi >= 0 && G.opHand.length > 0) {
      AI.usedFx['수문장 펭귄_1'] = 1;
      G.opField[fi].atk += 1;
      log('🤖 수문장 펭귄 ①: ATK+1', 'opponent');
      // AI 패 1장 버리기 (제일 낮은 ATK)
      var wk = G.opHand.reduce(function(a, b) {
        return (CARDS[a.id] ? (CARDS[a.id].atk || 0) : 0) <= (CARDS[b.id] ? (CARDS[b.id].atk || 0) : 0) ? a : b;
      });
      _aiDiscard(wk.id);
      // 플레이어도 1장 버리게
      handleOpponentAction({ type: 'forceDiscard', count: 1, reason: '수문장 펭귄 ①', by: 'guest', ts: Date.now() });
      await _sleep(300);
    }
  }

  // 젊은 라이온 ②: 사자 카드 서치
  if (cardId === '젊은 라이온' && !(AI.usedFx['젊은 라이온_2'])) {
    var t2 = AI.opDeck.find(function(c) {
      return c.id.includes('사자') || (CARDS[c.id] && CARDS[c.id].theme === '라이온');
    });
    if (t2) {
      AI.usedFx['젊은 라이온_2'] = 1;
      _aiSearchDeck(t2.id);
      await _sleep(300);
    }
  }

  // 베이비 라이온 ①: 서치 + 소환
  if (cardId === '베이비 라이온' && !(AI.usedFx['베이비 라이온_1'])) {
    var tL = AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '라이온'; });
    var tS = AI.opDeck.find(function(c) { return c.id.includes('사자'); });
    if (tL || tS) {
      AI.usedFx['베이비 라이온_1'] = 1;
      if (tL) _aiSearchDeck(tL.id);
      if (tS) _aiSearchDeck(tS.id);
      await _sleep(300);
    }
  }

  // 젊은 타이거 ②: 덱에서 타이거 몬스터 소환
  if (cardId === '젊은 타이거' && !(AI.usedFx['젊은 타이거_2'])) {
    var t3 = AI.opDeck.find(function(c) {
      return CARDS[c.id] && CARDS[c.id].theme === '타이거' && CARDS[c.id].cardType === 'monster';
    });
    if (t3) {
      AI.usedFx['젊은 타이거_2'] = 1;
      _aiSummonFromDeck(t3.id);
      await _sleep(400);
      renderAll();
    }
  }

  // 베이비 타이거 ①: 서치 + 상대 패 1장 버리기
  if (cardId === '베이비 타이거' && !(AI.usedFx['베이비 타이거_1'])) {
    AI.usedFx['베이비 타이거_1'] = 1;
    var t4 = AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '타이거'; });
    var t5 = AI.opDeck.find(function(c) { return c.id.includes('호랑이'); });
    if (t4) _aiSearchDeck(t4.id);
    if (t5) _aiSearchDeck(t5.id);
    // 자신 제외
    var bti = G.opField.findIndex(function(c) { return c.id === '베이비 타이거'; });
    if (bti >= 0) { G.opExile.push(G.opField.splice(bti, 1)[0]); }
    // 상대 패 1장 버리기
    handleOpponentAction({ type: 'forceDiscard', count: 1, reason: '베이비 타이거 ②', by: 'guest', ts: Date.now() });
    await _sleep(400);
    renderAll();
  }

  // 크툴루: r뤼에 필드 발동
  if (cardId === '그레이트 올드 원-크툴루' && !(AI.usedFx['크툴루_1']) && !G.opFieldCard) {
    var rl = AI.opDeck.find(function(c) { return c.id === '태평양 속 르뤼에'; });
    if (rl) {
      AI.usedFx['크툴루_1'] = 1;
      var rli = AI.opDeck.findIndex(function(c) { return c.id === '태평양 속 르뤼에'; });
      AI.opDeck.splice(rli, 1);
      G.opDeckCount = AI.opDeck.length;
      G.opFieldCard = { id: '태평양 속 르뤼에', name: '태평양 속 르뤼에' };
      handleOpponentAction({ type: 'fieldCard', cardId: '태평양 속 르뤼에', by: 'guest', ts: Date.now() });
      log('🤖 태평양 속 르뤼에 필드 발동', 'opponent');
      await _sleep(300);
      renderAll();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// AI 턴 종료
// ─────────────────────────────────────────────────────────────
function _aiEndTurn() {
  if (isMyTurn) { window.AI.thinking = false; return; }

  // engine.js의 resetTurnEffects 사용
  if (typeof resetTurnEffects === 'function') resetTurnEffects();
  window.AI.usedFx  = {};
  window.AI.attacked = new Set();

  G.turn++;
  isMyTurn = true;
  if (typeof attackedMonstersThisTurn !== 'undefined') {
    try { attackedMonstersThisTurn.clear(); } catch(e) {}
  }
  if (typeof advancePhase === 'function') advancePhase('draw');

  _setBanner('');
  window.AI.thinking = false;

  if (typeof renderAll === 'function') renderAll();
  if (typeof notify  === 'function')  notify('🎮 내 턴! 드로우 버튼을 눌러주세요.');
}

// ─────────────────────────────────────────────────────────────
// 배너 UI
// ─────────────────────────────────────────────────────────────
function _injectBanner() {
  if (document.getElementById('_aiBanner')) return;
  var el = document.createElement('div');
  el.id = '_aiBanner';
  el.style.cssText = [
    'position:fixed', 'top:0', 'left:50%', 'transform:translateX(-50%)',
    'background:linear-gradient(90deg,#12003a,#2a007a,#12003a)',
    'color:#c8a96e', 'padding:.35rem 1.6rem',
    'border:1px solid #7c5cbf', 'border-top:none',
    'border-radius:0 0 10px 10px',
    'font-family:Black Han Sans,sans-serif', 'font-size:.8rem',
    'letter-spacing:.1em', 'z-index:3000',
    'box-shadow:0 4px 20px #7c5cbf55',
    'pointer-events:none', 'transition:opacity .25s', 'opacity:0',
  ].join(';');
  document.body.appendChild(el);
}

function _setBanner(msg) {
  var el = document.getElementById('_aiBanner');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = msg ? '1' : '0';
}

// ─────────────────────────────────────────────────────────────
// 로비 패치 — "AI와 대전하기" 카드 삽입
// ─────────────────────────────────────────────────────────────
function _patchLobby() {
  var lobby = document.getElementById('lobby');
  if (!lobby || document.getElementById('_aiCard')) return;

  var card = document.createElement('div');
  card.id = '_aiCard';
  card.className = 'lobby-card';
  card.style.cssText = 'border-color:#7c5cbf;background:linear-gradient(160deg,#0e0e1f,#1a0a35);';
  card.innerHTML =
    '<h2 style="color:#9c7cdf;display:flex;align-items:center;gap:.5rem">' +
      '🤖 AI 대전 <span style="font-size:.65rem;color:#7c5cbf;border:1px solid #7c5cbf;padding:.1rem .4rem;border-radius:3px">Claude AI</span>' +
    '</h2>' +
    '<p style="font-size:.82rem;color:#9090b0;line-height:1.65;margin:.25rem 0 .8rem">' +
      'Claude AI가 카드 효과와 전황을 분석해 전략적으로 플레이합니다.<br>' +
      '내 덱을 구성하면 AI가 카운터 덱을 자동 선택합니다.' +
    '</p>' +
    '<button style="width:100%;padding:.8rem;' +
      'background:linear-gradient(135deg,#2a0060,#5a10b0);' +
      'color:#e0c8ff;border:1px solid #7c5cbf;border-radius:6px;' +
      'font-family:Black Han Sans,sans-serif;font-size:1rem;' +
      'letter-spacing:.12em;cursor:pointer;box-shadow:0 0 20px #7c5cbf33;" ' +
      'onmouseover="this.style.background=\'linear-gradient(135deg,#3a0080,#7a20d0)\'" ' +
      'onmouseout="this.style.background=\'linear-gradient(135deg,#2a0060,#5a10b0)\'" ' +
      'onclick="startAIMode()">' +
      '⚔️ AI와 대전하기' +
    '</button>';

  var all = lobby.querySelectorAll('.lobby-card');
  var last = all[all.length - 1];
  if (last) last.after(card);
  else lobby.appendChild(card);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _patchLobby);
} else {
  _patchLobby();
}
setTimeout(_patchLobby, 500);
setTimeout(_patchLobby, 2000);
