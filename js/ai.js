'use strict';

// ai.js — AI 모드: 대인전 액션 파이프라인 재사용
// 원칙:
// 1) AI는 roomRef 없는 "원격 상대"처럼 동작
// 2) 상대 행동 반영은 모두 handleOpponentAction 으로 통일
// 3) UI 진입/Worker(Groq) 연동은 유지

var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

window.AI = {
  active: false,
  thinking: false,
  opDeck: [],
  role: 'guest',
  turnToken: 0,
};

function _sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function _aiRole() { return (myRole === 'host') ? 'guest' : 'host'; }

function _emit(action) {
  handleOpponentAction(Object.assign({ by: window.AI.role, ts: Date.now() }, action));
}

function _resetAI() {
  window.AI.thinking = false;
  window.AI.turnToken = 0;
}

function _buildAIDeck() {
  var presets = Array.isArray(window.STARTER_THEME_PRESETS) ? window.STARTER_THEME_PRESETS.slice() : [];
  if (!presets.length) presets = ['펭귄','올드원','라이온','타이거','라이거','지배자','마피아','불가사의','엘리멘츠'];

  var shuffledThemes = shuffle(presets.slice());
  var pickedTheme = shuffledThemes[0] || '올드원';
  var source = null;
  if (typeof window.createStarterDeckFromTheme === 'function') {
    for (var t = 0; t < shuffledThemes.length; t++) {
      var theme = shuffledThemes[t];
      var candidate = window.createStarterDeckFromTheme(theme);
      if (candidate && Array.isArray(candidate.main) && candidate.main.length) {
        source = candidate;
        pickedTheme = theme;
        break;
      }
    }
  }

  var fromStarter = [];
  if (source && Array.isArray(source.main)) fromStarter = fromStarter.concat(source.main);
  if (source && Array.isArray(source.key)) fromStarter = fromStarter.concat(source.key);

  var base = fromStarter.filter(function(id) { return !!CARDS[id]; });
  if (!base.length) {
    base = Object.keys(CARDS).filter(function(id) {
      var theme = CARDS[id] && CARDS[id].theme;
      return theme === '크툴루' || theme === '올드 원' || theme === '올드원';
    });
    pickedTheme = '올드원';
  }

  window.AI.deckTheme = pickedTheme;
  var pads = ['구사일생', '눈에는 눈', '출입통제'].filter(function(id) { return !!CARDS[id]; });
  var i = 0;
  while (base.length < 40 && base.length && i < 120) {
    base.push(base[i % base.length]);
    i++;
  }
  while (base.length < 40 && pads.length) {
    base.push(pads[(base.length + i) % pads.length]);
    i++;
  }
  return shuffle(base.map(function(id) { return { id: id, name: CARDS[id].name }; }));
}


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
  if (idx >= 0) G.opHand.splice(idx, 1);
  return idx >= 0;
}

function _summonFromOppHand(cardId) {
  var cd = CARDS[cardId];
  if (!cd || cd.cardType !== 'monster') return false;
  if (!_removeOppHand(cardId)) return false;
  _emit({ type: 'summon', cardId: cardId });
  return true;
}



function _buildAIChainCtx() {
  return { role: window.AI.role, hand: G.opHand, field: G.opField, usedFx: {} };
}

async function _groqChainDecision(chainState, options) {
  if (!_WORKER_URL || !chainState || !Array.isArray(options)) return { action: 'pass' };
  var choiceView = options.map(function(opt, i) {
    return {
      index: i,
      label: opt.label || '',
      cardId: opt.cardId || '',
      from: (opt.handIdx === -3 ? 'field' : 'hand')
    };
  });
  var state = {
    turn: G.turn,
    phase: currentPhase,
    priority: chainState.priority,
    chainLinks: (chainState.links || []).map(function(l) {
      return { by: l.by, type: l.type, label: l.label };
    }),
    ai: { handCount: G.opHand.length, field: G.opField, graveCount: G.opGrave.length },
    player: { handCount: G.myHand.length, field: G.myField },
    options: choiceView
  };
  var resp = await fetch(_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [
      { role: 'system', content: '너는 카드게임 AI다. 체인 응답 여부를 판단한다. 반드시 JSON으로만 응답: {"action":"pass"} 또는 {"action":"activate","index":number}. index는 options 배열의 index를 사용.' },
      { role: 'user', content: JSON.stringify(state) }
    ], temperature: 0.1 })
  });
  if (!resp.ok) throw new Error('AI chain decision 실패');
  var data = await resp.json();
  var txt = data.content || data.response || data.choices?.[0]?.message?.content || '{}';
  var m = String(txt).match(/\{[\s\S]*\}/);
  var parsed = JSON.parse(m ? m[0] : '{}');
  if (parsed && parsed.action === 'activate' && Number.isInteger(parsed.index)) return parsed;
  return { action: 'pass' };
}

async function _runAIChainWindow() {
  if (!window.AI.active || !activeChainState || !activeChainState.active) return;
  if (activeChainState.priority !== window.AI.role) return;
  window.AI.chain = window.AI.chain || {};
  if (window.AI.chain.handling) return;
  window.AI.chain.handling = true;
  try {
    await _sleep(180);
    if (!activeChainState || !activeChainState.active || activeChainState.priority !== window.AI.role) return;
    var ctx = _buildAIChainCtx();
    var options = (typeof collectChainOptions === 'function') ? collectChainOptions(ctx) : [];
    if (!options || !options.length) {
      var prev = myRole;
      myRole = window.AI.role;
      try { passChainPriority(); } finally { myRole = prev; }
      return;
    }
    var decision = null;
    try {
      decision = await _groqChainDecision(activeChainState, options);
    } catch (_) {
      decision = { action: 'pass' };
    }
    if (!decision || decision.action !== 'activate') {
      var prevPass = myRole;
      myRole = window.AI.role;
      try { passChainPriority(); } finally { myRole = prevPass; }
      return;
    }
    var pick = options[decision.index];
    if (!pick) {
      var prevInvalid = myRole;
      myRole = window.AI.role;
      try { passChainPriority(); } finally { myRole = prevInvalid; }
      return;
    }
    if (pick && typeof pick.activate === 'function') pick.activate();
  } finally {
    window.AI.chain.handling = false;
  }
}

function _bestAttackPlan() {
  var plan = [];
  var remaining = G.myField.map(function(c, i) { return { i: i, atk: c.atk || 0 }; });
  G.opField.forEach(function(mon) {
    if (!remaining.length) {
      plan.push({ action: 'directAttack', attackerId: mon.id });
      return;
    }
    remaining.sort(function(a, b) { return a.atk - b.atk; });
    var target = remaining[0];
    plan.push({ action: 'attack', attackerId: mon.id, targetIdx: target.i });
    if ((mon.atk || 0) >= target.atk) remaining.shift();
  });
  return plan;
}

async function _runAITurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true;
  var token = ++window.AI.turnToken;

  try {
    await _sleep(250);
    if (token !== window.AI.turnToken) return;
    if (!_drawOpp()) return;
    _emit({ type: 'draw', count: 1 });
    advancePhase('deploy');
    renderAll();

    var plan = null;
    try { plan = await _groq(); } catch (_) { plan = null; }
    var deploy = (plan && Array.isArray(plan.deploy)) ? plan.deploy : [];

    for (var d = 0; d < deploy.length; d++) {
      if (token !== window.AI.turnToken) return;
      var step = deploy[d];
      if (step.action === 'summonFromHand') {
        _summonFromOppHand(step.cardId);
        await _sleep(200);
      }
    }

    advancePhase('attack');
    renderAll();
    await _sleep(250);

    var attack = (plan && Array.isArray(plan.attack) && plan.attack.length) ? plan.attack : _bestAttackPlan();
    for (var a = 0; a < attack.length; a++) {
      if (token !== window.AI.turnToken) return;
      var atk = attack[a];
      if (atk.action === 'attack' && typeof atk.targetIdx === 'number') {
        var me = G.opField.find(function(c) { return c.id === atk.attackerId; });
        var you = G.myField[atk.targetIdx];
        if (me && you) _emit({ type: 'combat', atkCard: { id: me.id, name: me.name, atk: me.atk }, defCard: { id: you.id, name: you.name, atk: you.atk } });
      }
      if (atk.action === 'directAttack') {
        var dm = G.opField.find(function(c) { return c.id === atk.attackerId; });
        if (dm && G.myField.length === 0) _emit({ type: 'directAttack', card: { id: dm.id, name: dm.name, atk: dm.atk } });
      }
      await _sleep(180);
    }

    advancePhase('end');
    endTurn();
  } finally {
    window.AI.thinking = false;
  }
}

function _setupAIState() {
  _resetAI();
  window.AI.role = _aiRole();
  window.AI.opDeck = _buildAIDeck();

  G.opHand = [];
  G.opField = [];
  G.opGrave = [];
  G.opExile = [];
  G.opFieldCard = null;
  G.opDeckCount = window.AI.opDeck.length;

  for (var i = 0; i < 7; i++) _drawOpp();

  var aiName = window.AI.deckTheme ? ('🤖 AI (' + window.AI.deckTheme + ')') : '🤖 AI';
  document.getElementById('hdrOpName').textContent = aiName;
  document.getElementById('opNameLabel').textContent = aiName;
  renderAll();
}

window.startAIMode = function() {
  _resetAI();
  window.AI.active = true;
  window.roomRef = null;
  window.myRole = 'host';

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

(function registerAIHooks() {
  var origEnter = window.enterGameWithDeck;
  if (typeof origEnter === 'function') {
    window.enterGameWithDeck = function() {
      origEnter.apply(this, arguments);
      if (!window.AI.active) return;
      _setupAIState();
    };
  }



  var origOnLocalChainStateChanged = window._onLocalChainStateChanged;
  if (typeof origOnLocalChainStateChanged === 'function') {
    window._onLocalChainStateChanged = function(next) {
      origOnLocalChainStateChanged.apply(this, arguments);
      if (!window.AI.active) return;
      if (next && next.active && next.priority === window.AI.role) {
        setTimeout(_runAIChainWindow, 120);
      }
    };
  }

  var origEndTurn = window.endTurn;
  if (typeof origEndTurn === 'function') {
    window.endTurn = function() {
      origEndTurn.apply(this, arguments);
      if (!window.AI.active || isMyTurn) return;
      setTimeout(_runAITurn, 300);
    };
  }
})();

async function _groq() {
  if (!_WORKER_URL) throw new Error('Worker URL 없음');
  var state = {
    turn: G.turn,
    phase: currentPhase,
    ai: { hand: G.opHand, field: G.opField, deckCount: window.AI.opDeck.length },
    player: { handCount: G.myHand.length, field: G.myField }
  };

  var resp = await fetch(_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [
      { role: 'system', content: 'JSON만 응답. deploy/attack 배열만 사용.' },
      { role: 'user', content: JSON.stringify(state) }
    ], temperature: 0.2 })
  });
  if (!resp.ok) throw new Error('AI 요청 실패');
  var data = await resp.json();
  var txt = data.content || data.response || data.choices?.[0]?.message?.content || '{}';
  var m = String(txt).match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : '{}');
}
