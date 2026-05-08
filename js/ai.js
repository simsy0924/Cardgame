'use strict';

// ─────────────────────────────────────────────────────────────
// ai.js — AI 대전 모드
//
// 설계 원칙:
//   1. AI는 roomRef 없는 "원격 상대"처럼 동작한다.
//   2. AI의 모든 행동은 _emit()을 통해 handleOpponentAction()으로 전달된다.
//      → 대인전의 Firebase 수신 콜백과 완전히 동일한 파이프라인.
//   3. 체인 응답도 대인전의 _onLocalChainStateChanged / collectChainOptions와
//      동일한 레지스트리를 사용한다. AI 전용 체인 코드는 없다.
//   4. 상태 변경(sendGameState 등)은 플레이어 측 코드가 담당한다.
//      AI는 액션 신호만 emit한다.
// ─────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
// 0. 전역 AI 상태
// ═══════════════════════════════════════════════════════════════
var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

window.AI = {
  active:     false,   // AI전 진행 중 여부
  thinking:   false,   // 턴 처리 중 여부 (중복 실행 방지)
  role:       'guest', // AI의 역할 ('host' | 'guest') — 플레이어의 반대
  opDeck:     [],      // AI 덱 (남은 카드 배열)
  deckTheme:  '',      // 선택된 덱 테마명 (UI 표시용)
  turnToken:  0,       // 턴 무효화 토큰 (턴 도중 종료 시 사용)
  chain:      { handling: false }, // 체인 처리 중 여부
  pendingChainTimers: [],          // 잔여 타이머 추적
  usedFx:     {},      // AI 효과 사용 추적 (markEffectUsed 대응)
};

// ═══════════════════════════════════════════════════════════════
// 1. 유틸
// ═══════════════════════════════════════════════════════════════

function _sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/** 현재 myRole의 반대 = AI 역할 */
function _aiRole() {
  return myRole === 'host' ? 'guest' : 'host';
}

/**
 * AI 행동을 대인전 파이프라인(handleOpponentAction)으로 전달.
 * Firebase roomRef.lastAction 수신과 완전히 동일한 경로.
 */
function _emit(action) {
  handleOpponentAction(
    Object.assign({ by: window.AI.role, ts: Date.now() }, action)
  );
}

function _resetAI() {
  window.AI.thinking  = false;
  window.AI.turnToken = 0;
  window.AI.chain     = { handling: false };
  window.AI.usedFx    = {};
  // 잔여 체인 타이머 정리
  (window.AI.pendingChainTimers || []).forEach(function (id) { clearTimeout(id); });
  window.AI.pendingChainTimers = [];
}

// ═══════════════════════════════════════════════════════════════
// 2. AI 덱 구성
// ═══════════════════════════════════════════════════════════════

function _buildAIDeck() {
  // 사용 가능한 스타터 테마 목록
  var presets = Array.isArray(window.STARTER_THEME_PRESETS)
    ? window.STARTER_THEME_PRESETS.slice()
    : ['펭귄', '올드원', '라이온', '타이거', '라이거', '지배자', '마피아', '불가사의', '엘리멘츠'];

  // 테마를 무작위 순서로 시도 → 유효한 덱이 있는 첫 테마 선택
  var shuffledThemes = shuffle(presets.slice());
  var pickedTheme = shuffledThemes[0] || '올드원';
  var source = null;

  if (typeof window.createStarterDeckFromTheme === 'function') {
    for (var t = 0; t < shuffledThemes.length; t++) {
      var candidate = window.createStarterDeckFromTheme(shuffledThemes[t]);
      if (candidate && Array.isArray(candidate.main) && candidate.main.length) {
        source    = candidate;
        pickedTheme = shuffledThemes[t];
        break;
      }
    }
  }

  // 메인 + 키카드를 합쳐 유효한 카드만 추출
  var fromStarter = [];
  if (source) {
    if (Array.isArray(source.main)) fromStarter = fromStarter.concat(source.main);
    if (Array.isArray(source.key))  fromStarter = fromStarter.concat(source.key);
  }
  var base = fromStarter.filter(function (id) { return !!CARDS[id]; });

  // 폴백: 올드원 카드
  if (!base.length) {
    base = Object.keys(CARDS).filter(function (id) {
      var th = CARDS[id] && CARDS[id].theme;
      return th === '크툴루' || th === '올드 원' || th === '올드원';
    });
    pickedTheme = '올드원';
  }

  window.AI.deckTheme = pickedTheme;

  // 패드 카드로 40장 이상 확보
  var pads = ['구사일생', '눈에는 눈', '출입통제'].filter(function (id) { return !!CARDS[id]; });
  var i = 0;
  while (base.length < 40 && base.length && i < 120) {
    base.push(base[i % base.length]);
    i++;
  }
  while (base.length < 40 && pads.length) {
    base.push(pads[(base.length + i) % pads.length]);
    i++;
  }

  return shuffle(base.map(function (id) { return { id: id, name: CARDS[id].name }; }));
}

// ═══════════════════════════════════════════════════════════════
// 3. AI 패/덱 조작 (내부용)
//    — G.opHand / G.opDeck 을 직접 수정.
//    — 상대 시점에서의 "내 패"이므로 handleOpponentAction을 거치지 않음.
// ═══════════════════════════════════════════════════════════════

/** AI 덱에서 1장 드로우 → G.opHand에 추가. 덱아웃 시 false 반환. */
function _drawOpp() {
  if (!window.AI.opDeck.length) {
    log('🤖 AI 덱 아웃!', 'system');
    showGameOver(true);
    return false;
  }
  var c = window.AI.opDeck.shift();
  G.opHand.push({ id: c.id, name: c.name, isPublic: false });
  G.opDeckCount = window.AI.opDeck.length;
  return true;
}

/** G.opHand에서 카드 제거. 성공 시 true. */
function _removeOppHand(cardId) {
  var idx = G.opHand.findIndex(function (c) { return c.id === cardId; });
  if (idx >= 0) { G.opHand.splice(idx, 1); return true; }
  return false;
}

/**
 * AI가 손패에서 몬스터를 소환.
 * handleOpponentAction('summon') 을 _emit하여 대인전 파이프라인과 동일하게 처리.
 */
function _summonFromOppHand(cardId) {
  var cd = CARDS[cardId];
  if (!cd || cd.cardType !== 'monster') return false;
  if (!_removeOppHand(cardId)) return false;
  _emit({ type: 'summon', cardId: cardId, localApplied: false });
  return true;
}

/** AI 손패를 무작위로 n장 버림 (대인전의 _discardOpponentHandRandomly와 동일 역할). */
function _discardOppHand(n, reason) {
  var count = 0;
  for (var i = 0; i < n && G.opHand.length; i++) {
    var idx = Math.floor(Math.random() * G.opHand.length);
    var c   = G.opHand.splice(idx, 1)[0];
    G.opGrave.push({ id: c.id, name: c.name });
    log('🤖 버림: ' + c.name + (reason ? ' (' + reason + ')' : ''), 'opponent');
    count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════
// 4. AI 초기 상태 세팅 (enterGameWithDeck 직후 호출)
// ═══════════════════════════════════════════════════════════════

function _setupAIState() {
  _resetAI();
  window.AI.role   = _aiRole();
  window.AI.opDeck = _buildAIDeck();

  // 상대(AI) 게임 상태 초기화
  G.opHand      = [];
  G.opField     = [];
  G.opGrave     = [];
  G.opExile     = [];
  G.opFieldCard = null;
  G.opKeyDeck   = [];
  G.opDeckCount = window.AI.opDeck.length;

  // 초기 패 7장
  for (var i = 0; i < 7; i++) _drawOpp();

  // UI 이름 갱신
  var aiName = window.AI.deckTheme
    ? ('🤖 AI (' + window.AI.deckTheme + ')')
    : '🤖 AI';
  var hdrOp = document.getElementById('hdrOpName');
  var opLabel = document.getElementById('opNameLabel');
  if (hdrOp)   hdrOp.textContent   = aiName;
  if (opLabel) opLabel.textContent = aiName;

  renderAll();
}

// ═══════════════════════════════════════════════════════════════
// 5. Groq Worker 호출 (턴 계획)
// ═══════════════════════════════════════════════════════════════

/**
 * AI 턴 계획 요청.
 * 반환: { deploy: [{action, cardId}], attack: [{action, attackerId, targetIdx?}] }
 * 실패 시 null.
 */
async function _groqTurnPlan() {
  if (!_WORKER_URL) return null;
  var state = {
    turn:    G.turn,
    phase:   currentPhase,
    ai:      { hand: G.opHand, field: G.opField, deckCount: window.AI.opDeck.length },
    player:  { handCount: G.myHand.length, field: G.myField },
  };
  try {
    var resp = await fetch(_WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'JSON만 응답. deploy/attack 배열만 사용. deploy: [{action:"summonFromHand",cardId}], attack: [{action:"attack",attackerId,targetIdx}|{action:"directAttack",attackerId}]' },
          { role: 'user',   content: JSON.stringify(state) },
        ],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    var txt  = data.content || data.response || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    var m    = String(txt).match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : '{}');
  } catch (_) {
    return null;
  }
}

/**
 * AI 체인 응답 판단 요청.
 * 반환: { action: 'pass' } | { action: 'activate', index: number }
 */
async function _groqChainDecision(chainState, options) {
  if (!_WORKER_URL || !chainState || !options.length) return { action: 'pass' };
  var choiceView = options.map(function (opt, i) {
    return { index: i, label: opt.label || '', cardId: opt.cardId || '' };
  });
  var state = {
    turn:       G.turn,
    phase:      currentPhase,
    chainLinks: (chainState.links || []).map(function (l) {
      return { by: l.by, type: l.type, label: l.label };
    }),
    ai:      { handCount: G.opHand.length, field: G.opField },
    player:  { handCount: G.myHand.length, field: G.myField },
    options: choiceView,
  };
  try {
    var resp = await fetch(_WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: '너는 카드게임 AI다. 체인 응답 여부를 판단한다. 반드시 JSON만 응답: {"action":"pass"} 또는 {"action":"activate","index":number}. index는 options 배열의 index.' },
          { role: 'user',   content: JSON.stringify(state) },
        ],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) return { action: 'pass' };
    var data = await resp.json();
    var txt  = data.content || data.response || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    var m    = String(txt).match(/\{[\s\S]*\}/);
    var parsed = JSON.parse(m ? m[0] : '{}');
    if (parsed && parsed.action === 'activate' && Number.isInteger(parsed.index)) return parsed;
    return { action: 'pass' };
  } catch (_) {
    return { action: 'pass' };
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. 공격 플랜 (Groq 실패 시 폴백)
// ═══════════════════════════════════════════════════════════════

/**
 * 최선의 공격 플랜을 로컬에서 계산.
 * AI 필드(G.opField)가 공격자, 플레이어 필드(G.myField)가 수비자.
 */
function _bestAttackPlan() {
  var plan      = [];
  // 플레이어 필드 카드를 (idx, atk) 형태로 복사
  var remaining = G.myField.map(function (c, i) { return { i: i, atk: c.atk || 0 }; });

  G.opField.forEach(function (mon) {
    if (!remaining.length) {
      // 상대 필드 비었으면 직접 공격
      plan.push({ action: 'directAttack', attackerId: mon.id });
      return;
    }
    // 가장 약한 상대 몬스터를 우선 공격 (ATK 오름차순)
    remaining.sort(function (a, b) { return a.atk - b.atk; });
    var target = remaining[0];
    plan.push({ action: 'attack', attackerId: mon.id, targetIdx: target.i });
    // 공격자가 수비자를 이기면 해당 수비자 제거
    if ((mon.atk || 0) >= target.atk) remaining.shift();
  });

  return plan;
}

// ═══════════════════════════════════════════════════════════════
// 7. AI 체인 응답 처리
//    대인전: _onLocalChainStateChanged → 상대 우선권 → passChainPriority()
//    AI전:   동일 흐름 + AI가 체인 응답 여부를 판단
// ═══════════════════════════════════════════════════════════════

/**
 * AI 체인 컨텍스트 생성.
 * collectChainOptions(aiCtx) 가 전역 변수를 AI 관점으로 교체하는 데 사용.
 */
function _buildAIChainCtx() {
  return {
    role:    window.AI.role,
    hand:    G.opHand,
    field:   G.opField,
    grave:   G.opGrave,
    exile:   G.opExile,
    keyDeck: G.opKeyDeck || [],
    usedFx:  window.AI.usedFx,
    isMyTurn: !isMyTurn, // AI 관점에서 isMyTurn
  };
}

/**
 * AI 체인 우선권 처리.
 * - 대인전에서는 상대방이 Firebase를 통해 passChainPriority() 또는 addChainLink()를 전송.
 * - AI전에서는 이 함수가 동일한 결정을 내리고 직접 실행.
 */
async function _runAIChainWindow() {
  if (!window.AI.active)                                   return;
  if (!activeChainState || !activeChainState.active)       return;
  if (activeChainState.priority !== window.AI.role)        return;
  if (window.AI.chain.handling)                            return;

  window.AI.chain.handling = true;
  renderChainActions(); // "AI가 체인 고민 중..." 표시

  try {
    await _sleep(180);
    // 상태 재검증
    if (!activeChainState || !activeChainState.active)            return;
    if (activeChainState.priority !== window.AI.role)             return;

    // 현재 체인에 AI가 응답할 수 있는 옵션 수집 (대인전 레지스트리 재사용)
    var ctx     = _buildAIChainCtx();
    var options = (typeof collectChainOptions === 'function')
      ? collectChainOptions(ctx)
      : [];

    if (!options || !options.length) {
      // 응답 불가 → 패스 (대인전에서 상대가 패스하는 것과 동일)
      _aiPassChain();
      return;
    }

    // Groq에 판단 요청
    var decision;
    try {
      decision = await _groqChainDecision(activeChainState, options);
    } catch (_) {
      decision = { action: 'pass' };
    }

    if (!decision || decision.action !== 'activate') {
      _aiPassChain();
      return;
    }

    var pick = options[decision.index];
    if (!pick || typeof pick.activate !== 'function') {
      _aiPassChain();
      return;
    }

    // 체인 응답 실행 (activate 내부에서 addChainLink가 호출됨)
    pick.activate();

  } finally {
    window.AI.chain.handling = false;
    renderChainActions();
  }
}

/**
 * AI 체인 패스.
 * 대인전에서 상대가 passChainPriority()를 호출하는 것과 동일한 효과.
 * myRole을 AI 역할로 교체 후 passChainPriority() 호출.
 */
function _aiPassChain() {
  var prev = myRole;
  myRole = window.AI.role;
  try {
    if (typeof passChainPriority === 'function') passChainPriority();
  } finally {
    myRole = prev;
  }
}

// _aiChainResponse: effects-chain.js의 _onLocalChainStateChanged가 호출하는 진입점
window._aiChainResponse = function (chainState) {
  if (!window.AI.active) return;
  if (!chainState || !chainState.active) return;
  if (chainState.priority !== window.AI.role) return;
  setTimeout(_runAIChainWindow, 120);
};

// ═══════════════════════════════════════════════════════════════
// 8. AI 턴 실행
//    대인전: endTurn → Firebase → 상대방 클라이언트가 drawPhase, deploy, attack, endTurn
//    AI전:   endTurn → _runAITurn() 이 동일 흐름을 재현
// ═══════════════════════════════════════════════════════════════

async function _runAITurn() {
  if (!window.AI.active)  return;
  if (isMyTurn)           return; // 아직 내 턴이면 스킵
  if (window.AI.thinking) return; // 이미 처리 중

  window.AI.thinking = true;
  var token = ++window.AI.turnToken; // 이 턴의 고유 토큰

  try {
    await _sleep(250);
    if (token !== window.AI.turnToken) return;

    // ── Draw 페이즈 ──
    if (!_drawOpp()) return; // 덱아웃 → 게임 종료
    _emit({ type: 'draw', count: 1 });

    advancePhase('deploy');
    renderAll();

    // ── Deploy 페이즈: Groq에 소환 계획 요청 ──
    var plan = null;
    try { plan = await _groqTurnPlan(); } catch (_) { plan = null; }

    var deploy = (plan && Array.isArray(plan.deploy)) ? plan.deploy : [];
    for (var d = 0; d < deploy.length; d++) {
      if (token !== window.AI.turnToken) return;
      var step = deploy[d];
      if (step.action === 'summonFromHand' && step.cardId) {
        _summonFromOppHand(step.cardId);
        await _sleep(200);
      }
    }

    // ── Attack 페이즈 ──
    advancePhase('attack');
    renderAll();
    await _sleep(250);

    var attacks = (plan && Array.isArray(plan.attack) && plan.attack.length)
      ? plan.attack
      : _bestAttackPlan();

    for (var a = 0; a < attacks.length; a++) {
      if (token !== window.AI.turnToken) return;
      var atk = attacks[a];

      if (atk.action === 'attack' && typeof atk.targetIdx === 'number') {
        var attacker = G.opField.find(function (c) { return c.id === atk.attackerId; });
        var defender = G.myField[atk.targetIdx];
        if (attacker && defender) {
          // 대인전의 combat 액션과 동일한 형태로 emit
          _emit({
            type:    'combat',
            atkCard: { id: attacker.id, name: attacker.name, atk: attacker.atk },
            defCard: { id: defender.id, name: defender.name, atk: defender.atk },
          });
        }
      } else if (atk.action === 'directAttack') {
        var dm = G.opField.find(function (c) { return c.id === atk.attackerId; });
        if (dm && G.myField.length === 0) {
          // 대인전의 directAttack 액션과 동일한 형태로 emit
          _emit({
            type: 'directAttack',
            card: { id: dm.id, name: dm.name, atk: dm.atk },
          });
        }
      }

      await _sleep(180);
    }

    // ── End 페이즈 ──
    advancePhase('end');

    // 대인전에서 상대방이 endTurn을 Firebase로 보내는 것과 동일하게 emit
    _emit({ type: 'endTurn' });

  } finally {
    window.AI.thinking = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 9. AI전 진입 (로비 버튼)
// ═══════════════════════════════════════════════════════════════

window.startAIMode = function () {
  _resetAI();
  window.AI.active = true;
  window.roomRef   = null;   // roomRef = null → 로컬 모드 (대인전과 분기)
  window.myRole    = 'host'; // 플레이어는 항상 host, AI는 guest

  // 덱 빌더 확인 버튼 텍스트 변경
  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display      = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool    === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

// ═══════════════════════════════════════════════════════════════
// 10. 훅 등록 (대인전 함수들을 AI전에서도 올바르게 동작하도록)
// ═══════════════════════════════════════════════════════════════

(function _registerAIHooks() {

  // ── enterGameWithDeck 훅: 덱 확정 직후 AI 상태 초기화 ──
  var origEnterWithDeck = window.enterGameWithDeck;
  if (typeof origEnterWithDeck === 'function') {
    window.enterGameWithDeck = function () {
      origEnterWithDeck.apply(this, arguments);
      if (!window.AI.active) return;
      _setupAIState();
    };
  }

  // ── endTurn 훅: 플레이어가 턴을 종료하면 AI 턴 시작 ──
  var origEndTurn = window.endTurn;
  if (typeof origEndTurn === 'function') {
    window.endTurn = function () {
      origEndTurn.apply(this, arguments);
      if (!window.AI.active || isMyTurn) return;
      // 플레이어 턴이 끝났고, 이제 AI 차례
      setTimeout(_runAITurn, 300);
    };
  }

  // ── _onLocalChainStateChanged 훅: AI 우선권 시 체인 응답 요청 ──
  // effects-chain.js 의 _onLocalChainStateChanged 내부에서
  // window._aiChainResponse 를 직접 호출하므로, 별도 훅 불필요.
  // (effects-chain.js 코드 확인: "window._aiChainResponse(activeChainState)")

  // ── sendAction 훅: AI전에서 forceDiscard 처리 ──
  // engine.js sendAction() 내부에서 roomRef 없을 때 forceDiscard를 처리하지만,
  // 그 함수는 _discardOpponentHandRandomly를 호출한다.
  // AI전에서는 _discardOppHand를 사용하도록 window._discardOpponentHandRandomly를 교체.
  if (typeof window._discardOpponentHandRandomly !== 'function') {
    // engine.js에 없으면 여기서 정의 (중복 정의 방지)
    window._discardOpponentHandRandomly = function (n, reason) {
      return _discardOppHand(n, reason);
    };
  } else {
    // 이미 있으면 래핑
    var _origDiscard = window._discardOpponentHandRandomly;
    window._discardOpponentHandRandomly = function (n, reason) {
      if (window.AI.active) return _discardOppHand(n, reason);
      return _origDiscard.apply(this, arguments);
    };
  }

})();

// ═══════════════════════════════════════════════════════════════
// 11. 체인 타이머 정리 유틸 (effects-chain.js에서 참조)
// ═══════════════════════════════════════════════════════════════

window._clearAIChainTimer = function () {
  (window.AI.pendingChainTimers || []).forEach(function (id) { clearTimeout(id); });
  window.AI.pendingChainTimers = [];
};
