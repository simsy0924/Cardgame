'use strict';

// ─────────────────────────────────────────────────────────────
// ai.js — AI 대전 모드
//
// 원칙: AI는 대인전 상대방과 완전히 동일하게 동작한다.
//   - 모든 AI 행동은 handleOpponentAction()으로 emit
//   - 게임 시작/진행 로직은 기존 코드를 그대로 사용
//   - AI는 상대방 자리에서 신호만 보낸다
// ─────────────────────────────────────────────────────────────

var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

window.AI = {
  active:   false,
  thinking: false,
  role:     'guest',
  opDeck:   [],
  deckTheme: '',
  turnToken: 0,
  chain:    { handling: false },
  pendingChainTimers: [],
  usedFx:   {},
};

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function _emit(action) {
  handleOpponentAction(Object.assign({ by: window.AI.role, ts: Date.now() }, action));
}

function _resetAI() {
  window.AI.thinking  = false;
  window.AI.turnToken = 0;
  window.AI.chain     = { handling: false };
  window.AI.usedFx    = {};
  (window.AI.pendingChainTimers || []).forEach(clearTimeout);
  window.AI.pendingChainTimers = [];
}

// ─────────────────────────────────────────────────────────────
// AI 덱
// ─────────────────────────────────────────────────────────────

function _buildAIDeck() {
  var presets = Array.isArray(window.STARTER_THEME_PRESETS)
    ? window.STARTER_THEME_PRESETS.slice()
    : ['펭귄', '올드원', '라이온', '타이거', '라이거', '지배자', '마피아', '불가사의', '엘리멘츠'];

  var source = null, pickedTheme = '올드원';
  if (typeof window.createStarterDeckFromTheme === 'function') {
    shuffle(presets.slice()).some(function (theme) {
      var c = window.createStarterDeckFromTheme(theme);
      if (c && Array.isArray(c.main) && c.main.length) { source = c; pickedTheme = theme; return true; }
    });
  }

  var base = [];
  if (source) {
    if (source.main) base = base.concat(source.main);
    if (source.key)  base = base.concat(source.key);
  }
  base = base.filter(function (id) { return !!CARDS[id]; });

  if (!base.length) {
    base = Object.keys(CARDS).filter(function (id) {
      var th = CARDS[id] && CARDS[id].theme;
      return th === '크툴루' || th === '올드 원' || th === '올드원';
    });
    pickedTheme = '올드원';
  }

  window.AI.deckTheme = pickedTheme;
  var pads = ['구사일생', '눈에는 눈', '출입통제'].filter(function (id) { return !!CARDS[id]; });
  var i = 0;
  while (base.length < 40 && base.length && i < 120) { base.push(base[i++ % base.length]); }
  while (base.length < 40 && pads.length) { base.push(pads[i++ % pads.length]); }
  return shuffle(base.map(function (id) { return { id: id, name: CARDS[id].name }; }));
}

// ─────────────────────────────────────────────────────────────
// AI 패 조작
// ─────────────────────────────────────────────────────────────

function _drawOpp() {
  if (!window.AI.opDeck.length) { log('🤖 AI 덱 아웃!', 'system'); showGameOver(true); return false; }
  var c = window.AI.opDeck.shift();
  G.opHand.push({ id: c.id, name: c.name, isPublic: false });
  G.opDeckCount = window.AI.opDeck.length;
  return true;
}

function _removeOppHand(cardId) {
  var idx = G.opHand.findIndex(function (c) { return c.id === cardId; });
  if (idx >= 0) { G.opHand.splice(idx, 1); return true; }
  return false;
}

function _summonFromOppHand(cardId) {
  var cd = CARDS[cardId];
  if (!cd || cd.cardType !== 'monster') return false;
  if (!_removeOppHand(cardId)) return false;
  _emit({ type: 'summon', cardId: cardId, localApplied: false });
  return true;
}

function _discardOppHand(n, reason) {
  for (var i = 0; i < n && G.opHand.length; i++) {
    var idx = Math.floor(Math.random() * G.opHand.length);
    var c = G.opHand.splice(idx, 1)[0];
    G.opGrave.push({ id: c.id, name: c.name });
    log('🤖 버림: ' + c.name + (reason ? ' (' + reason + ')' : ''), 'opponent');
  }
}

// ─────────────────────────────────────────────────────────────
// 게임 상태 요약 — Groq에 넘기는 공통 컨텍스트
// ─────────────────────────────────────────────────────────────

function _buildGameContext() {
  return {
    turn:    G.turn,
    phase:   currentPhase,
    ai: {
      hand:       G.opHand.map(function(c) { return { id: c.id, name: c.name }; }),
      field:      G.opField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      grave:      G.opGrave.map(function(c) { return { id: c.id, name: c.name }; }),
      deckCount:  window.AI.opDeck.length,
      handCount:  G.opHand.length,
    },
    player: {
      hand:       G.myHand.map(function(c) { return { id: c.id, name: c.name, isPublic: c.isPublic }; }),
      field:      G.myField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      grave:      G.myGrave.map(function(c) { return { id: c.id, name: c.name }; }),
      deckCount:  G.myDeck ? G.myDeck.length : 0,
      handCount:  G.myHand.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Groq Worker — 턴 전체 계획
//
// AI가 한 번에 결정하는 것:
//   - deploy: 어떤 카드를 소환할지
//   - attack: 누구를 어떻게 공격할지 (또는 공격 안 함)
//   - endTurn: 각 페이즈를 언제 종료할지 (항상 true, 순서만 결정)
//
// Groq가 deploy/attack 배열을 비워서 반환하면 아무 행동도 하지 않음.
// ─────────────────────────────────────────────────────────────

async function _groqTurnPlan() {
  if (!_WORKER_URL) return null;
  var ctx = _buildGameContext();
  var systemPrompt = [
    '너는 카드게임 AI다. 반드시 JSON만 응답해라. 다른 텍스트 없이 JSON만.',
    '게임 규칙:',
    '- deploy 페이즈: 패에서 몬스터를 소환할 수 있다. 필드는 최대 5칸.',
    '- attack 페이즈: 내 필드 몬스터로 상대 몬스터를 공격하거나 직접공격.',
    '  전투: 공격자 ATK > 수비자 ATK면 수비자 묘지, 상대 패 손실.',
    '  직접공격: 상대 필드가 비었을 때만 가능.',
    '- 선공 1턴(turn===1)은 attack 페이즈 없음.',
    '응답 형식: {"deploy":[{"action":"summonFromHand","cardId":"카드ID"}],"attack":[{"action":"attack","attackerId":"내카드ID","targetIdx":상대필드인덱스번호}|{"action":"directAttack","attackerId":"내카드ID"}]}',
    '공격 안 하려면 attack:[]로 반환.',
  ].join('\n');

  try {
    var resp = await fetch(_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: JSON.stringify(ctx) },
        ],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    var txt = data.content || data.response || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    var m = String(txt).match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : '{}');
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────────────────────
// Groq Worker — 체인 응답 판단
//
// AI에게 넘기는 정보:
//   - 현재 체인 스택 (링크 타입, 발동자, 레이블)
//   - 응답 가능한 옵션 목록 (레이블, 카드명)
//   - AI/플레이어 필드·패 상황
//
// Groq가 응답: {"action":"pass"} 또는 {"action":"activate","index":N}
// ─────────────────────────────────────────────────────────────

async function _groqChainDecision(chainState, options) {
  if (!_WORKER_URL || !options.length) return { action: 'pass' };
  var ctx = _buildGameContext();
  var chainInfo = {
    links: (chainState.links || []).map(function(l) {
      return { by: l.by, type: l.type, label: l.label || l.type };
    }),
    passCount: chainState.passCount || 0,
  };
  var optionList = options.map(function(o, i) {
    return { index: i, label: o.label, cardId: o.cardId };
  });
  var systemPrompt = [
    '너는 카드게임 AI다. 체인에 응답할지 판단해라. 반드시 JSON만 응답.',
    '체인 링크 by:"guest"는 AI 자신, by:"host"는 상대.',
    '응답 형식: {"action":"pass"} 또는 {"action":"activate","index":숫자}',
    'index는 options 배열의 번호. 유리하면 activate, 아니면 pass.',
  ].join('\n');

  try {
    var resp = await fetch(_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: JSON.stringify({ game: ctx, chain: chainInfo, options: optionList }) },
        ],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) return { action: 'pass' };
    var data = await resp.json();
    var txt = data.content || data.response || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    var m = String(txt).match(/\{[\s\S]*\}/);
    var p = JSON.parse(m ? m[0] : '{}');
    return (p.action === 'activate' && Number.isInteger(p.index)) ? p : { action: 'pass' };
  } catch (_) { return { action: 'pass' }; }
}

// ─────────────────────────────────────────────────────────────
// 공격 플랜 폴백 (Groq 실패 시)
// ─────────────────────────────────────────────────────────────

function _bestAttackPlan() {
  var plan = [], remaining = G.myField.map(function (c, i) { return { i: i, atk: c.atk || 0 }; });
  G.opField.forEach(function (mon) {
    if (!remaining.length) { plan.push({ action: 'directAttack', attackerId: mon.id }); return; }
    remaining.sort(function (a, b) { return a.atk - b.atk; });
    plan.push({ action: 'attack', attackerId: mon.id, targetIdx: remaining[0].i });
    if ((mon.atk || 0) >= remaining[0].atk) remaining.shift();
  });
  return plan;
}

// ─────────────────────────────────────────────────────────────
// AI 체인 응답
// collectChainOptions(aiCtx)를 통해 대인전 레지스트리를 AI 관점으로 실행.
// 결과를 Groq에 넘겨 응답/패스 결정.
// ─────────────────────────────────────────────────────────────

function _aiPassChain() {
  var prev = myRole;
  myRole = window.AI.role;
  try { if (typeof passChainPriority === 'function') passChainPriority(); }
  finally { myRole = prev; }
}

async function _runAIChainWindow() {
  if (!window.AI.active || !activeChainState || !activeChainState.active) return;
  if (activeChainState.priority !== window.AI.role || window.AI.chain.handling) return;

  window.AI.chain.handling = true;
  renderChainActions(); // "AI가 체인 고민 중..." 표시

  try {
    await _sleep(300);
    if (!activeChainState || !activeChainState.active || activeChainState.priority !== window.AI.role) return;

    // 대인전 레지스트리(CHAIN_HAND_RESPONSES, CHAIN_FIELD_RESPONSES)를 AI 관점으로 실행
    var aiCtx = {
      role:    window.AI.role,
      hand:    G.opHand,
      field:   G.opField,
      grave:   G.opGrave,
      exile:   G.opExile,
      keyDeck: G.opKeyDeck || [],
      usedFx:  window.AI.usedFx,
      isMyTurn: false,
    };
    var options = typeof collectChainOptions === 'function' ? collectChainOptions(aiCtx) : [];

    if (!options.length) { _aiPassChain(); return; }

    // Groq에 체인 상황 + 옵션 전달 → 응답 판단
    var decision = { action: 'pass' };
    try { decision = await _groqChainDecision(activeChainState, options); } catch (_) {}

    if (decision.action === 'activate') {
      var pick = options[decision.index];
      if (pick && typeof pick.activate === 'function') {
        pick.activate();
        return;
      }
    }
    _aiPassChain();

  } finally {
    window.AI.chain.handling = false;
    renderChainActions();
  }
}

// effects-chain.js의 _onLocalChainStateChanged가 직접 호출
window._aiChainResponse = function (chainState) {
  if (window.AI.active && chainState && chainState.active && chainState.priority === window.AI.role) {
    setTimeout(_runAIChainWindow, 120);
  }
};

// ─────────────────────────────────────────────────────────────
// AI 턴 실행
//
// Groq가 deploy/attack 계획을 반환하면 그대로 실행.
// 실패하면 폴백 로직 사용.
// 각 페이즈는 계획 실행 후 AI가 직접 종료 신호를 보냄.
// ─────────────────────────────────────────────────────────────

async function _runAITurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true;
  var token = ++window.AI.turnToken;

  try {
    await _sleep(250);
    if (token !== window.AI.turnToken) return;

    // ── Draw ──
    if (!_drawOpp()) return;
    _emit({ type: 'draw', count: 1 });
    advancePhase('deploy');
    renderAll();

    // ── Groq에 턴 전체 계획 요청 ──
    var plan = null;
    try { plan = await _groqTurnPlan(); } catch (_) {}

    // ── Deploy ──
    var deploy = (plan && Array.isArray(plan.deploy)) ? plan.deploy : [];
    for (var d = 0; d < deploy.length; d++) {
      if (token !== window.AI.turnToken) return;
      var step = deploy[d];
      if (step.action === 'summonFromHand' && step.cardId) {
        _summonFromOppHand(step.cardId);
        await _sleep(300);
      }
    }

    // ── Attack (선공 1턴은 스킵) ──
    if (!(G.turn === 1 && window.AI.role === 'host')) {
      advancePhase('attack');
      renderAll();
      await _sleep(300);

      var attacks = (plan && Array.isArray(plan.attack) && plan.attack.length)
        ? plan.attack
        : _bestAttackPlan();

      for (var a = 0; a < attacks.length; a++) {
        if (token !== window.AI.turnToken) return;
        var atk = attacks[a];
        if (atk.action === 'attack' && typeof atk.targetIdx === 'number') {
          var att = G.opField.find(function (c) { return c.id === atk.attackerId; });
          var def = G.myField[atk.targetIdx];
          if (att && def) {
            _emit({ type: 'combat',
              atkCard: { id: att.id, name: att.name, atk: att.atk },
              defCard: { id: def.id, name: def.name, atk: def.atk },
            });
          }
        } else if (atk.action === 'directAttack') {
          var dm = G.opField.find(function (c) { return c.id === atk.attackerId; });
          if (dm && G.myField.length === 0) {
            _emit({ type: 'directAttack', card: { id: dm.id, name: dm.name, atk: dm.atk } });
          }
        }
        await _sleep(300);
      }
    }

    // ── End → endTurn 신호 (대인전 상대방과 동일) ──
    advancePhase('end');
    await _sleep(200);
    _emit({ type: 'endTurn' });

  } finally {
    window.AI.thinking = false;
  }
}

// ─────────────────────────────────────────────────────────────
// AI전 진입 & 훅
// ─────────────────────────────────────────────────────────────

window.startAIMode = function () {
  window.AI.active = true;
  window.roomRef   = null;
  window.myRole    = 'host'; // 플레이어=host(선공), AI=guest(후공)

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display       = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool    === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

(function _registerAIHooks() {

  // enterGameWithDeck: 기존 흐름(_startNewGame 포함) 그대로 실행 후 AI 상태만 추가 초기화
  var origEnterWithDeck = window.enterGameWithDeck;
  if (typeof origEnterWithDeck === 'function') {
    window.enterGameWithDeck = function () {
      origEnterWithDeck.apply(this, arguments);
      if (!window.AI.active) return;

      window.AI.role   = 'guest';
      _resetAI();
      window.AI.opDeck = _buildAIDeck();
      G.opHand = []; G.opField = []; G.opGrave = []; G.opExile = [];
      G.opFieldCard = null; G.opKeyDeck = [];
      G.opDeckCount = window.AI.opDeck.length;
      for (var i = 0; i < 7; i++) _drawOpp();

      var aiName = '🤖 AI' + (window.AI.deckTheme ? ' (' + window.AI.deckTheme + ')' : '');
      var hdrOp = document.getElementById('hdrOpName');
      var opLbl = document.getElementById('opNameLabel');
      if (hdrOp) hdrOp.textContent = aiName;
      if (opLbl) opLbl.textContent = aiName;
      renderAll();
    };
  }

  // endTurn: 플레이어 턴 종료 → AI 턴 시작
  var origEndTurn = window.endTurn;
  if (typeof origEndTurn === 'function') {
    window.endTurn = function () {
      origEndTurn.apply(this, arguments);
      if (window.AI.active && !isMyTurn) setTimeout(_runAITurn, 300);
    };
  }

  // forceDiscard 처리
  window._discardOpponentHandRandomly = function (n, reason) { _discardOppHand(n, reason); };

})();

window._clearAIChainTimer = function () {
  (window.AI.pendingChainTimers || []).forEach(clearTimeout);
  window.AI.pendingChainTimers = [];
};
