'use strict';

// ─────────────────────────────────────────────────────────────
// ai.js — AI 대전 모드
//
// 원칙: AI는 대인전 상대방과 완전히 동일하게 동작한다.
//   - AI의 모든 행동은 handleOpponentAction()으로 emit
//   - AI는 절대 advancePhase()를 직접 호출하지 않는다
//   - 페이즈 전환은 phaseChange 신호로 emit → handleOpponentAction이 처리
//   - 드로우는 _drawOpp()로 G.opHand에 추가 후 draw 신호 emit
// ─────────────────────────────────────────────────────────────

var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

window.AI = {
  active:    false,
  thinking:  false,
  role:      'guest',
  opDeck:    [],
  deckTheme: '',
  turnToken: 0,
  chain:     { handling: false },
  pendingChainTimers: [],
  usedFx:    {},
};

// ─── 유틸 ───────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// 대인전에서 Firebase로 오는 상대 신호와 완전히 동일한 경로
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

// ─── AI 덱 ──────────────────────────────────────────────────

function _buildAIDeck() {
  var presets = Array.isArray(window.STARTER_THEME_PRESETS)
    ? window.STARTER_THEME_PRESETS.slice()
    : ['펭귄','올드원','라이온','타이거','라이거','지배자','마피아','불가사의','엘리멘츠'];

  var source = null, pickedTheme = '올드원';
  if (typeof window.createStarterDeckFromTheme === 'function') {
    shuffle(presets.slice()).some(function(theme) {
      var c = window.createStarterDeckFromTheme(theme);
      if (c && Array.isArray(c.main) && c.main.length) { source = c; pickedTheme = theme; return true; }
    });
  }

  var base = [];
  if (source) {
    if (source.main) base = base.concat(source.main);
    if (source.key)  base = base.concat(source.key);
  }
  base = base.filter(function(id) { return !!CARDS[id]; });

  if (!base.length) {
    base = Object.keys(CARDS).filter(function(id) {
      var th = CARDS[id] && CARDS[id].theme;
      return th === '크툴루' || th === '올드 원' || th === '올드원';
    });
    pickedTheme = '올드원';
  }

  window.AI.deckTheme = pickedTheme;
  var pads = ['구사일생','눈에는 눈','출입통제'].filter(function(id) { return !!CARDS[id]; });
  var i = 0;
  while (base.length < 40 && base.length && i < 120) { base.push(base[i++ % base.length]); }
  while (base.length < 40 && pads.length) { base.push(pads[i++ % pads.length]); }
  return shuffle(base.map(function(id) { return { id: id, name: CARDS[id].name }; }));
}

// ─── AI 패 조작 ─────────────────────────────────────────────

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

function _removeOppHand(cardId) {
  var idx = G.opHand.findIndex(function(c) { return c.id === cardId; });
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

// ─── 게임 상태 요약 ─────────────────────────────────────────

function _buildGameContext() {
  return {
    turn:  G.turn,
    phase: currentPhase,
    ai: {
      hand:      G.opHand.map(function(c) { return { id: c.id, name: c.name }; }),
      field:     G.opField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      grave:     G.opGrave.map(function(c) { return { id: c.id, name: c.name }; }),
      deckCount: window.AI.opDeck.length,
    },
    player: {
      field:     G.myField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      handCount: G.myHand.length,
      deckCount: G.myDeck ? G.myDeck.length : 0,
    },
  };
}

// ─── Groq Worker ────────────────────────────────────────────

async function _groqTurnPlan() {
  if (!_WORKER_URL) return null;
  var systemPrompt = [
    '너는 카드게임 AI다. 반드시 JSON만 응답해라.',
    '규칙: deploy페이즈에 패에서 몬스터 소환 가능(필드 최대5칸). attack페이즈에 내 몬스터로 공격.',
    '선공 1턴(turn===1)은 attack 없음.',
    '형식: {"deploy":[{"action":"summonFromHand","cardId":"ID"}],"attack":[{"action":"attack","attackerId":"ID","targetIdx":숫자}|{"action":"directAttack","attackerId":"ID"}]}',
    '공격 안 하면 attack:[]'
  ].join(' ');
  try {
    var resp = await fetch(_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: JSON.stringify(_buildGameContext()) },
        ],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    var txt = data.content || data.response || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    var m = String(txt).match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : '{}');
  } catch(_) { return null; }
}

async function _groqChainDecision(chainState, options) {
  if (!_WORKER_URL || !options.length) return { action: 'pass' };
  try {
    var resp = await fetch(_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'JSON만 응답: {"action":"pass"} 또는 {"action":"activate","index":숫자}' },
          { role: 'user',   content: JSON.stringify({
            chain: { links: (chainState.links||[]).map(function(l){return{by:l.by,type:l.type,label:l.label};}) },
            game:  _buildGameContext(),
            options: options.map(function(o,i){return{index:i,label:o.label,cardId:o.cardId};})
          })},
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
  } catch(_) { return { action: 'pass' }; }
}

// ─── 공격 폴백 ──────────────────────────────────────────────

function _bestAttackPlan() {
  var plan = [], remaining = G.myField.map(function(c, i) { return { i: i, atk: c.atk||0 }; });
  G.opField.forEach(function(mon) {
    if (!remaining.length) { plan.push({ action: 'directAttack', attackerId: mon.id }); return; }
    remaining.sort(function(a,b) { return a.atk - b.atk; });
    plan.push({ action: 'attack', attackerId: mon.id, targetIdx: remaining[0].i });
    if ((mon.atk||0) >= remaining[0].atk) remaining.shift();
  });
  return plan;
}

// ─── AI 체인 응답 ────────────────────────────────────────────

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
  renderChainActions();

  try {
    await _sleep(300);
    if (!activeChainState || !activeChainState.active || activeChainState.priority !== window.AI.role) return;

    var aiCtx = {
      role: window.AI.role, hand: G.opHand, field: G.opField,
      grave: G.opGrave, exile: G.opExile, keyDeck: G.opKeyDeck||[],
      usedFx: window.AI.usedFx, isMyTurn: false,
    };
    var options = typeof collectChainOptions === 'function' ? collectChainOptions(aiCtx) : [];

    if (!options.length) { _aiPassChain(); return; }

    var decision = { action: 'pass' };
    try { decision = await _groqChainDecision(activeChainState, options); } catch(_) {}

    if (decision.action === 'activate') {
      var pick = options[decision.index];
      if (pick && typeof pick.activate === 'function') { pick.activate(); return; }
    }
    _aiPassChain();
  } finally {
    window.AI.chain.handling = false;
    renderChainActions();
  }
}

window._aiChainResponse = function(chainState) {
  if (window.AI.active && chainState && chainState.active && chainState.priority === window.AI.role) {
    setTimeout(_runAIChainWindow, 120);
  }
};

// ─── AI 턴 실행 ─────────────────────────────────────────────
//
// AI는 절대 advancePhase()를 직접 호출하지 않는다.
// 대신 phaseChange 신호를 emit하여 handleOpponentAction이 처리하게 한다.
// handleOpponentAction의 phaseChange 케이스가 advancePhase를 호출한다.

async function _runAITurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true;
  var token = ++window.AI.turnToken;

  try {
    await _sleep(300);
    if (token !== window.AI.turnToken) return;

    // ── Draw: 카드 뽑고 draw 신호 emit ──
    if (!_drawOpp()) return;
    _emit({ type: 'draw', count: 1 });
    await _sleep(200);
    if (token !== window.AI.turnToken) return;

    // ── Deploy 페이즈 진입: phaseChange 신호 emit ──
    _emit({ type: 'phaseChange', phase: 'deploy' });
    await _sleep(300);

    // Groq에 소환 계획 요청
    var plan = null;
    try { plan = await _groqTurnPlan(); } catch(_) {}

    var deploy = (plan && Array.isArray(plan.deploy)) ? plan.deploy : [];
    for (var d = 0; d < deploy.length; d++) {
      if (token !== window.AI.turnToken) return;
      if (deploy[d].action === 'summonFromHand' && deploy[d].cardId) {
        _summonFromOppHand(deploy[d].cardId);
        await _sleep(300);
      }
    }

    // ── Attack 페이즈 (선공 1턴 제외) ──
    if (!(G.turn === 1 && window.AI.role === 'host')) {
      _emit({ type: 'phaseChange', phase: 'attack' });
      await _sleep(300);

      var attacks = (plan && Array.isArray(plan.attack) && plan.attack.length)
        ? plan.attack : _bestAttackPlan();

      for (var a = 0; a < attacks.length; a++) {
        if (token !== window.AI.turnToken) return;
        var atk = attacks[a];
        if (atk.action === 'attack' && typeof atk.targetIdx === 'number') {
          var att = G.opField.find(function(c) { return c.id === atk.attackerId; });
          var def = G.myField[atk.targetIdx];
          if (att && def) _emit({ type: 'combat',
            atkCard: { id: att.id, name: att.name, atk: att.atk },
            defCard: { id: def.id, name: def.name, atk: def.atk },
          });
        } else if (atk.action === 'directAttack') {
          var dm = G.opField.find(function(c) { return c.id === atk.attackerId; });
          if (dm && G.myField.length === 0)
            _emit({ type: 'directAttack', card: { id: dm.id, name: dm.name, atk: dm.atk } });
        }
        await _sleep(300);
      }
    }

    // ── End 페이즈 → endTurn 신호 ──
    // endTurn 신호를 받으면 handleOpponentAction이 isMyTurn=true, advancePhase('draw') 처리
    _emit({ type: 'phaseChange', phase: 'end' });
    await _sleep(200);
    _emit({ type: 'endTurn' });

  } finally {
    window.AI.thinking = false;
  }
}

// ─── handleOpponentAction에 phaseChange 처리 추가 ────────────
// 대인전에서는 Firebase roomPhase를 listenPhase로 수신하지만,
// AI전(roomRef=null)에서는 phaseChange 신호로 대체한다.

(function _patchHandleOpponentActionForPhaseChange() {
  var _orig = handleOpponentAction;
  handleOpponentAction = function(action) {
    // AI전에서 phaseChange 신호 처리
    if (action.type === 'phaseChange' && window.AI && window.AI.active) {
      advancePhase(action.phase);
      renderAll();
      return;
    }
    _orig.apply(this, arguments);
  };
})();

// ─── AI전 진입 & 훅 ─────────────────────────────────────────

window.startAIMode = function() {
  window.AI.active = true;
  roomRef = null; // engine.js의 let 변수에 직접 할당

  // 선후공 랜덤 결정
  var playerIsHost = Math.random() < 0.5;
  myRole         = playerIsHost ? 'host' : 'guest';
  window.AI.role = playerIsHost ? 'guest' : 'host';

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
    window.enterGameWithDeck = function() {
      origEnterWithDeck.apply(this, arguments);
      if (!window.AI.active) return;

      // _startNewGame()이 완료된 후 AI 상태 초기화
      // window.AI.role은 startAIMode()에서 이미 결정됨
      _resetAI();
      window.AI.opDeck = _buildAIDeck();
      G.opHand = []; G.opField = []; G.opGrave = []; G.opExile = [];
      G.opFieldCard = null; G.opKeyDeck = [];
      G.opDeckCount = window.AI.opDeck.length;

      // 선공(host)은 6장, 후공(guest)은 7장
      var aiInitCards = (window.AI.role === 'host') ? 6 : 7;
      for (var i = 0; i < aiInitCards; i++) _drawOpp();

      var aiName = '🤖 AI' + (window.AI.deckTheme ? ' (' + window.AI.deckTheme + ')' : '');
      var hdrOp = document.getElementById('hdrOpName');
      var opLbl = document.getElementById('opNameLabel');
      if (hdrOp) hdrOp.textContent = aiName;
      if (opLbl) opLbl.textContent = aiName;

      // 선후공 로그
      var playerFirst = (myRole === 'host');
      log('━━━ 선후공 결정 ━━━', 'system');
      log((playerFirst ? '🎴 플레이어 선공!' : '🤖 AI 선공!'), 'system');

      renderAll();

      // AI가 선공이면 즉시 AI 턴 시작
      if (window.AI.role === 'host') {
        setTimeout(_runAITurn, 500);
      }
    };
  }

  // endTurn: 플레이어 턴 종료 → AI 턴 시작
  var origEndTurn = window.endTurn;
  if (typeof origEndTurn === 'function') {
    window.endTurn = function() {
      origEndTurn.apply(this, arguments);
      if (window.AI.active && !isMyTurn) setTimeout(_runAITurn, 400);
    };
  }

  // forceDiscard 처리
  window._discardOpponentHandRandomly = function(n, reason) { _discardOppHand(n, reason); };

})();

window._clearAIChainTimer = function() {
  (window.AI.pendingChainTimers || []).forEach(clearTimeout);
  window.AI.pendingChainTimers = [];
};
