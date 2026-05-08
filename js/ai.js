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


function _ensureAILobbyEntry() {
  var lobby = document.getElementById('lobby');
  if (!lobby || document.getElementById('aiMatchBtn')) return;

  var card = document.createElement('div');
  card.className = 'lobby-card';
  card.id = 'aiLobbyCard';
  card.innerHTML = [
    '<h2><span class="icon">🤖</span>AI 대전</h2>',
    '<p style="font-size:.8rem;color:var(--text-dim)">오프라인으로 즉시 시작합니다.</p>',
    '<button id="aiMatchBtn" class="btn btn-primary">AI 대전 시작</button>'
  ].join('');

  var shopCard = Array.from(lobby.querySelectorAll('.lobby-card')).pop();
  if (shopCard && shopCard.parentNode === lobby) lobby.insertBefore(card, shopCard);
  else lobby.appendChild(card);

  var btn = document.getElementById('aiMatchBtn');
  if (btn) btn.onclick = function() { window.startAIMode(); };
}

function _buildAIDeck() {
  var base = _aiDeckList('크툴루').filter(function(id) { return !!CARDS[id]; });
  var pads = ['구사일생', '눈에는 눈', '출입통제'].filter(function(id) { return !!CARDS[id]; });
  var i = 0;
  while (base.length < 40 && pads.length) {
    base.push(pads[i % pads.length]);
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

  document.getElementById('hdrOpName').textContent = '🤖 AI';
  document.getElementById('opNameLabel').textContent = '🤖 AI';
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _ensureAILobbyEntry);
} else {
  _ensureAILobbyEntry();
}
