'use strict';

window.AI = {
  active: false,
  thinking: false,
  opDeck: [],
  deckPreset: null,
  attacked: new Set(),
  usedFx: {},
  pendingChainTimers: [],
  _pendingSetup: false,
};

function _playerRole() { return myRole || 'host'; }
function _aiRole() { return _playerRole() === 'host' ? 'guest' : 'host'; }
function _sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

function _resetAIState() {
  window.AI.thinking = false;
  window.AI.attacked = new Set();
  window.AI.usedFx = {};
  (window.AI.pendingChainTimers || []).forEach(function(t){ clearTimeout(t); });
  window.AI.pendingChainTimers = [];
}

window.startAIMode = function() {
  _resetAIState();
  window.AI.active = true;
  roomRef = null;
  myRole = 'host';

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

function _buildAIDeck() {
  var playerDeck = window._confirmedDeck || [];
  var themeCount = {};
  playerDeck.forEach(function(id){ var t = CARDS[id] && CARDS[id].theme; if (t) themeCount[t] = (themeCount[t] || 0) + 1; });
  var topTheme = '펭귄', topN = 0;
  Object.keys(themeCount).forEach(function(t){ if (themeCount[t] > topN) { topN = themeCount[t]; topTheme = t; } });
  var counter = { '펭귄':'크툴루','올드원':'펭귄','라이온':'타이거','타이거':'라이온','라이거':'펭귄','지배자':'크툴루','마피아':'펭귄','불가사의':'펭귄' };
  window.AI.deckPreset = counter[topTheme] || '크툴루';
  window.AI.opDeck = shuffle(_aiDeckList(window.AI.deckPreset).filter(function(id){ return !!CARDS[id]; }).map(function(id){ return { id:id, name:CARDS[id].name }; }));
}

function _setupAI() {
  if (!window.AI.active) return;
  _resetAIState();
  _buildAIDeck();

  G.opHand = []; G.opField = []; G.opGrave = []; G.opExile = []; G.opFieldCard = null;
  G.opKeyDeck = _aiKeyList(window.AI.deckPreset);
  G.opDeckCount = window.AI.opDeck.length;
  for (var i=0;i<7;i++) _aiDrawOne();

  G.turn = 1; G.activePlayer = 'host'; currentPhase = 'deploy'; isMyTurn = true;
  advancePhase('deploy');
  renderAll();
}

function _aiDrawOne() {
  if (!window.AI.opDeck.length) { showGameOver(true); return false; }
  var c = window.AI.opDeck.shift();
  G.opHand.push({ id:c.id, name:c.name });
  G.opDeckCount = window.AI.opDeck.length;
  return true;
}

function _aiSummon(cardId) {
  var card = CARDS[cardId];
  if (!card || card.cardType !== 'monster' || G.opField.length >= maxFieldSlots()) return false;
  var idx = G.opHand.findIndex(function(c){ return c.id === cardId; });
  if (idx < 0) return false;
  G.opHand.splice(idx,1);
  G.opField.push({ id:cardId, name:card.name, atk:card.atk||0, atkBase:card.atk||0 });
  handleOpponentAction({ type:'summon', cardId:cardId, by:_aiRole(), ts:Date.now(), localApplied:true });
  return true;
}

function _aiAttack(attackerId, targetIdx) {
  if (window.AI.attacked.has(attackerId)) return false;
  if (!G.myField[targetIdx]) return false;
  var at = G.opField.find(function(c){ return c.id === attackerId; });
  if (!at) return false;
  window.AI.attacked.add(attackerId);
  handleOpponentAction({ type:'combat', atkCard:{id:at.id,name:at.name,atk:at.atk}, defCard:{id:G.myField[targetIdx].id,name:G.myField[targetIdx].name,atk:G.myField[targetIdx].atk}, by:_aiRole(), ts:Date.now() });
  return true;
}

function _aiDirect(attackerId) {
  if (G.myField.length > 0 || window.AI.attacked.has(attackerId)) return false;
  var at = G.opField.find(function(c){ return c.id === attackerId; });
  if (!at) return false;
  window.AI.attacked.add(attackerId);
  handleOpponentAction({ type:'directAttack', card:{id:at.id,name:at.name,atk:at.atk}, by:_aiRole(), ts:Date.now() });
  return true;
}

function _aiPressEffectButton(cardId) {
  var prevRole = myRole, prevTurn = isMyTurn;
  var fired = false;
  try {
    myRole = _aiRole(); isMyTurn = false;
    var hRegs = (window.CHAIN_HAND_RESPONSES && window.CHAIN_HAND_RESPONSES[cardId]) || [];
    var hIdx = G.opHand.findIndex(function(c){ return c.id === cardId; });
    for (var i=0; i<hRegs.length && hIdx>=0; i++) {
      var h = hRegs[i];
      if (typeof h.activate !== 'function') continue;
      if (typeof h.condition === 'function' && !h.condition()) continue;
      h.activate(hIdx); fired = true; break;
    }
    var fRegs = (window.CHAIN_FIELD_RESPONSES && window.CHAIN_FIELD_RESPONSES[cardId]) || [];
    var fIdx = G.opField.findIndex(function(c){ return c.id === cardId; });
    for (var j=0; j<fRegs.length && fIdx>=0; j++) {
      var f = fRegs[j];
      if (typeof f.activate !== 'function') continue;
      if (typeof f.condition === 'function' && !f.condition(fIdx)) continue;
      f.activate(fIdx); fired = true; break;
    }
  } finally {
    myRole = prevRole; isMyTurn = prevTurn;
  }
  return fired;
}

async function _aiTurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true; window.AI.attacked = new Set();
  try {
    if (!_aiDrawOne()) return;
    advancePhase('deploy'); renderAll();
    await _sleep(200);

    var summons = G.opHand.filter(function(c){ return CARDS[c.id] && CARDS[c.id].cardType === 'monster'; }).sort(function(a,b){ return (CARDS[b.id].atk||0) - (CARDS[a.id].atk||0); });
    for (var i=0; i<summons.length && G.opField.length<maxFieldSlots(); i++) {
      if (_aiSummon(summons[i].id)) {
        _aiPressEffectButton(summons[i].id);
        await _sleep(150);
      }
    }

    advancePhase('attack'); renderAll();
    await _sleep(200);
    var attackers = G.opField.slice();
    for (var k=0; k<attackers.length; k++) {
      if (G.myField.length === 0) _aiDirect(attackers[k].id);
      else {
        var best = 0;
        for (var d=1; d<G.myField.length; d++) if ((G.myField[d].atk||0) < (G.myField[best].atk||0)) best = d;
        _aiAttack(attackers[k].id, best);
      }
      await _sleep(200);
    }

    advancePhase('end');
    endTurn();
  } finally {
    window.AI.thinking = false;
    renderAll();
  }
}

window._aiChainResponse = function() {
  if (!window.AI.active || !activeChainState || !activeChainState.active) return;
  if (activeChainState.priority !== _aiRole()) return;
  var opts = (typeof collectChainOptions === 'function') ? collectChainOptions({ hand:G.opHand, field:G.opField, grave:G.opGrave, exile:G.opExile, keyDeck:G.opKeyDeck, role:_aiRole(), usedFx:window.AI.usedFx, isMyTurn:false }) : [];
  if (opts && opts.length > 0) {
    try { opts[0].activate(); return; } catch(e) {}
  }
  passChainPriority();
};
window._notifyAIChainOpened = function() { setTimeout(function(){ window._aiChainResponse(); }, 150); };
window._aiRespondToChain = function(){ window._aiChainResponse(); };

(function _hooks(){
  var origEnter = window.enterGameWithDeck;
  if (typeof origEnter === 'function') {
    window.enterGameWithDeck = function(){ origEnter.apply(this, arguments); if (window.AI.active) _setupAI(); };
  }
  var origEndTurn = window.endTurn;
  if (typeof origEndTurn === 'function') {
    window.endTurn = function(){ origEndTurn.apply(this, arguments); if (window.AI.active && !isMyTurn) setTimeout(_aiTurn, 400); };
  }
})();

function _aiDeckList(theme) { var r=function(id,n){var a=[];for(var i=0;i<n;i++)a.push(id);return a;}; var p={
'펭귄':r('펭귄 마을',4).concat(r('꼬마 펭귄',4),r('펭귄 부부',4),r('현자 펭귄',4),r('수문장 펭귄',4),r('펭귄!돌격!',4),r('펭귄의 영광',4),r('펭귄이여 영원하라',4),r('펭귄 마법사',4),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
'크툴루':r('그레이트 올드 원-크툴루',4).concat(r('그레이트 올드 원-크투가',4),r('그레이트 올드 원-크아이가',4),r('그레이트 올드 원-과타노차',4),r('엘더 갓-노덴스',4),r('엘더 갓-크타니트',4),r('엘더 갓-히프노스',4),r('올드_원의 멸망',4),['구사일생','구사일생','눈에는 눈','눈에는 눈'])
}; return (p[theme]||p['크툴루']).slice(); }

function _aiKeyList(theme) { var k={ '펭귄':['펭귄 용사','펭귄의 일격','펭귄의 전설','일격필살','단 한번의 기회'], '크툴루':['아우터 갓 니알라토텝','아우터 갓-아자토스','아우터 갓 슈브 니구라스','일격필살','단 한번의 기회']}; return (k[theme]||k['크툴루']).filter(function(id){return !!CARDS[id];}).map(function(id){return {id:id,name:CARDS[id].name};}); }

(function _lobby(){
  function add() {
    var lobby=document.getElementById('lobby');
    if(!lobby||document.getElementById('_aiCard')) return;
    var card=document.createElement('div'); card.id='_aiCard'; card.className='lobby-card';
    card.innerHTML='<h2>🤖 AI 대전</h2><button onclick="startAIMode()">⚔️ AI와 대전하기 (내가 선공)</button>';
    lobby.appendChild(card);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
