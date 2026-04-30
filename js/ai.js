// ============================================================
// ai.js — AI 대전 모듈
// index.html 로드 순서: patch.js → ai.js (맨 마지막)
// ============================================================
'use strict';

// ★ Cloudflare Worker URL
var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

window.AI = {
  active:     false,
  thinking:   false,
  opDeck:     [],
  deckPreset: null,
  usedFx:     {},
  attacked:   new Set(),
};

var _s = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };


function _safeHook(name, wrapper) {
  var orig = window[name];
  if (typeof orig !== 'function') return false;
  window[name] = wrapper(orig);
  return true;
}


// ─────────────────────────────────────────────────────────────
// 훅 — ai.js가 맨 마지막 로드되므로 즉시 등록 가능
// ─────────────────────────────────────────────────────────────

// ★ 핵심: enterGameWithDeck 훅
// confirmDeck() → enterGameWithDeck() → enterGame() → _startNewGame()
// 이 전체 흐름이 동기적으로 완료된 뒤 _setupAI() 실행
_safeHook('enterGameWithDeck', function(_origEGWD) {
  return function() {
    _origEGWD.apply(this, arguments);
    if (window.AI.active) _setupAI();
  };
});

_safeHook('endTurn', function(_origET) {
  return function() {
    _origET.apply(this, arguments);
    if (window.AI.active && !isMyTurn) setTimeout(_aiTurn, 700);
  };
});

_safeHook('checkWinCondition', function(_origCWC) {
  return function() {
    _origCWC.apply(this, arguments);
    if (!window.AI.active) return;
    if (G.opHand.length === 0 && !isMyTurn) {
      setTimeout(function() { showGameOver(true); }, 300);
    }
  };
});

// ─────────────────────────────────────────────────────────────
// AI 모드 진입
// ─────────────────────────────────────────────────────────────
window.startAIMode = function() {
  window.AI.active = true;
  window.roomRef   = null;   // !roomRef → confirmDeck에서 enterGameWithDeck 직행
  window.myRole    = 'host'; // 플레이어=선공, AI=후공

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool    === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

// ─────────────────────────────────────────────────────────────
// AI 덱 빌드 — confirmDeck() 전에 미리 준비
// confirmDeck()의 원본 로직이 window._confirmedDeck을 세팅하기 전에
// 호출되므로, AI 덱은 플레이어 덱 확정 후 _setupAI()에서 빌드
// ─────────────────────────────────────────────────────────────
function _buildAIDeck() {
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
    '펭귄':'크툴루', '올드원':'펭귄', '라이온':'타이거',
    '타이거':'라이온', '라이거':'펭귄', '지배자':'크툴루',
    '마피아':'펭귄', '불가사의':'펭귄',
  };
  window.AI.deckPreset = cm[top] || '크툴루';

  var list = _aiDeckList(window.AI.deckPreset).filter(function(id) { return !!CARDS[id]; });
  while (list.length < 40) list.push('구사일생');

  window.AI.opDeck = shuffle(list.map(function(id) {
    return { id: id, name: CARDS[id].name };
  }));
  window.AI.usedFx  = {};
  window.AI.attacked = new Set();
}

// ─────────────────────────────────────────────────────────────
// enterGameWithDeck 완료 직후 실행
// 이 시점:
//   ✓ initDecks() 완료 → G 초기화됨
//   ✓ drawCards(6) 완료 → G.myHand 6장
//   ✓ advancePhase('deploy') → currentPhase='deploy', isMyTurn=true
//   ✓ renderAll() 완료
// ─────────────────────────────────────────────────────────────
function _setupAI() {
  if (!window.AI.active) return;

  // 이 시점에서 _confirmedDeck이 세팅되어 있음
  _buildAIDeck();

  // op 존 AI 전용으로 교체 (initDecks가 초기화한 것 덮어씀)
  G.opHand      = [];
  G.opField     = [];
  G.opGrave     = [];
  G.opExile     = [];
  G.opFieldCard = null;
  G.opKeyDeck   = _aiKeyList(window.AI.deckPreset);
  G.opDeckCount = window.AI.opDeck.length;

  // AI 초기 드로우 7장 (후공 guest 기준)
  for (var i = 0; i < 7; i++) _aiDrawOne();

  // 헤더
  document.getElementById('hdrOpName').textContent   = '🤖 AI (' + window.AI.deckPreset + ')';
  document.getElementById('opNameLabel').textContent = '🤖 AI';

  // 로컬 클럭 — roomRef 없어도 동작하도록
  gameClock = {
    host: 500, guest: 500,
    runningFor: 'host', lastUpdated: Date.now(),
  };

  _aiBanner();
  log('🤖 AI (' + window.AI.deckPreset + ') 후공 참전! 패 ' + G.opHand.length + '장', 'system');

  // 플레이어=host=선공 → 즉시 + 100ms 후 이중 강제 세팅
  // sendGameState() 등 비동기 콜백이 덮어쓸 수 있으므로 두 번 세팅
  isMyTurn = true;
  advancePhase('deploy');
  renderAll();

  setTimeout(function() {
    if (!window.AI.active) return;
    isMyTurn = true;
    advancePhase('deploy');
    renderAll();
  }, 150);
}

// ─────────────────────────────────────────────────────────────
// AI 내부 조작
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
  _aiRemHand(cardId);
  G.opField.push({ id: cardId, name: card.name,
    atk: card.atk != null ? card.atk : 0,
    atkBase: card.atk != null ? card.atk : 0 });
  log('🤖 소환: ' + card.name + ' ATK' + (card.atk != null ? card.atk : 0), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiSummonDeck(cardId) {
  var idx = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opDeckCount = window.AI.opDeck.length;
  var card = CARDS[cardId] || {};
  G.opField.push({ id: cardId, name: card.name || cardId,
    atk: card.atk != null ? card.atk : 0,
    atkBase: card.atk != null ? card.atk : 0 });
  log('🤖 덱→소환: ' + (card.name || cardId), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiDiscard(cardId) {
  _aiRemHand(cardId);
  G.opGrave.push({ id: cardId, name: CARDS[cardId] ? CARDS[cardId].name : cardId });
  handleOpponentAction({ type: 'discard', cardId: cardId, by: 'guest', ts: Date.now() });
}

function _aiSearch(cardId) {
  var idx = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opHand.push({ id: cardId, name: CARDS[cardId] ? CARDS[cardId].name : cardId });
  G.opDeckCount = window.AI.opDeck.length;
  log('🤖 서치: ' + (CARDS[cardId] ? CARDS[cardId].name : cardId), 'opponent');
  handleOpponentAction({ type: 'search', cardName: CARDS[cardId] ? CARDS[cardId].name : cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiAttack(atkId, defIdx) {
  if (window.AI.attacked.has(atkId)) return false;
  var fi = G.opField.findIndex(function(c) { return c.id === atkId; });
  if (fi < 0 || !G.myField[defIdx]) return false;
  window.AI.attacked.add(atkId);
  var atk = G.opField[fi], def = G.myField[defIdx];
  log('🤖 공격: ' + atk.name + '(' + atk.atk + ') → ' + def.name + '(' + def.atk + ')', 'opponent');
  handleOpponentAction({
    type: 'combat',
    atkCard: { id: atk.id, name: atk.name, atk: atk.atk },
    defCard: { id: def.id, name: def.name, atk: def.atk },
    by: 'guest', ts: Date.now(),
  });
  if (atk.atk !== 0 && atk.atk - def.atk <= 0) {
    var ri = G.opField.findIndex(function(c) { return c.id === atkId; });
    if (ri >= 0) G.opGrave.push(G.opField.splice(ri, 1)[0]);
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
  handleOpponentAction({ type: 'directAttack',
    card: { id: atk.id, name: atk.name, atk: atk.atk },
    by: 'guest', ts: Date.now() });
  return true;
}

// ─────────────────────────────────────────────────────────────
// AI 턴
// ─────────────────────────────────────────────────────────────
async function _aiTurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;
  window.AI.thinking = true;
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();
  _setBanner('🤖 드로우 중...');

  try {
    // 드로우
    if (currentPhase === 'draw') {
      if (!_aiDrawOne()) { window.AI.thinking = false; return; }
      log('🤖 드로우 (패:' + G.opHand.length + ' 덱:' + window.AI.opDeck.length + ')', 'opponent');
      gameClock.runningFor  = 'guest';
      gameClock.lastUpdated = Date.now();
      advancePhase('deploy');
      await _s(400);
      renderAll();
    }

    // 전략
    _setBanner('🤖 전략 계산 중...');
    await _s(200);
    var plan;
    try   { plan = await _groq(); }
    catch (e) { console.warn('[AI]', e.message); plan = _fallback(); }
    if (plan.thinking) { log('🤖 "' + plan.thinking + '"', 'opponent'); await _s(300); }

    // 전개
    _setBanner('🤖 전개 중...');
    await _deploy(plan.deploy || []);
    advancePhase('attack');
    await _s(300);
    renderAll();

    // 공격
    _setBanner('🤖 공격 중...');
    await _attack(plan.attack || []);
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
// Groq API
// ─────────────────────────────────────────────────────────────
async function _groq() {
  if (!_WORKER_URL) throw new Error('Worker URL 없음');
  var state = {
    turn: G.turn,
    ai: {
      hand: G.opHand.map(function(c) {
        var cd = CARDS[c.id] || {};
        return { id: c.id, name: c.name, cardType: cd.cardType, atk: cd.atk, theme: cd.theme };
      }),
      field: G.opField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      deckCount: window.AI.opDeck.length,
    },
    player: {
      handCount: G.myHand.length,
      field: G.myField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
    },
  };
  var resp = await fetch(_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant', temperature: 0.2, max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '당신은 카드게임 AI. 목표: 상대 패 0장. 전투: 내ATK>상대ATK→상대 몬스터 제거+차이만큼 상대패 손실. 직접공격→ATK만큼 상대패 손실. summonFromHand는 monster만. JSON만 반환:\n{"thinking":"전략","deploy":[{"action":"summonFromHand","cardId":"ID"}],"attack":[{"action":"attack","attackerId":"ID","targetIdx":0},{"action":"directAttack","attackerId":"ID"}]}' },
        { role: 'user', content: JSON.stringify(state) },
      ],
    }),
  });
  if (!resp.ok) throw new Error('Worker ' + resp.status);
  var d = await resp.json();
  var t = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '{}';
  var m = t.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : '{}');
}

// ─────────────────────────────────────────────────────────────
// 폴백
// ─────────────────────────────────────────────────────────────
function _fallback() {
  var plan = { deploy: [], attack: [] };
  var mons = G.opHand
    .filter(function(c) { return CARDS[c.id] && CARDS[c.id].cardType === 'monster'; })
    .map(function(c) { return { id: c.id, atk: CARDS[c.id].atk || 0 }; })
    .sort(function(a,b) { return b.atk - a.atk; }).slice(0, 3);
  mons.forEach(function(c) { plan.deploy.push({ action:'summonFromHand', cardId:c.id }); });

  var ef = G.opField.concat(mons.map(function(c) { return { id:c.id, atk:CARDS[c.id]?CARDS[c.id].atk||0:0 }; }));
  if (G.myField.length === 0) {
    ef.forEach(function(c) { plan.attack.push({ action:'directAttack', attackerId:c.id }); });
  } else {
    ef.forEach(function(att) {
      var bI=-1, bG=0;
      G.myField.forEach(function(def,di){ var g=(att.atk||0)-(def.atk||0); if(g>bG){bG=g;bI=di;} });
      if (bI>=0) plan.attack.push({ action:'attack', attackerId:att.id, targetIdx:bI });
    });
  }
  return plan;
}

// ─────────────────────────────────────────────────────────────
// 전개/공격 실행
// ─────────────────────────────────────────────────────────────
async function _deploy(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act || act.action !== 'summonFromHand' || !act.cardId) continue;
    if (!G.opHand.find(function(c) { return c.id === act.cardId; })) continue;
    var cd = CARDS[act.cardId];
    if (!cd || cd.cardType !== 'monster') continue;
    _aiSummon(act.cardId);
    await _s(500);
    await _trigger(act.cardId);
    renderAll();
  }
}

async function _attack(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act) continue;
    if (act.action === 'attack') {
      var di = typeof act.targetIdx === 'number' ? act.targetIdx : 0;
      if (di < G.myField.length && G.opField.find(function(c) { return c.id === act.attackerId; })) {
        _aiAttack(act.attackerId, di); await _s(800); renderAll();
      }
    } else if (act.action === 'directAttack') {
      if (G.myField.length === 0 && G.opField.find(function(c) { return c.id === act.attackerId; })) {
        _aiDirect(act.attackerId); await _s(800); renderAll();
      }
    }
    if (G.myHand.length === 0) break;
  }
}


function _aiStartChainEffect(effect, afterResolve) {
  if (!window.AI.active) { if (typeof afterResolve === 'function') afterResolve(); return; }
  var localEffect = (!roomRef && effect) ? { ...effect, by: myRole } : effect;
  if (activeChainState && activeChainState.active) {
    if (typeof addChainLink === 'function') addChainLink(localEffect);
    if (typeof afterResolve === 'function') setTimeout(afterResolve, 200);
    return;
  }
  if (typeof beginChain === 'function') beginChain(localEffect);
  setTimeout(function waitChainDone() {
    if (activeChainState && activeChainState.active) { setTimeout(waitChainDone, 150); return; }
    if (typeof afterResolve === 'function') afterResolve();
  }, 200);
}

// ─────────────────────────────────────────────────────────────
// 소환 유발
// ─────────────────────────────────────────────────────────────
async function _trigger(cardId) {
  var AI = window.AI;
  var u = function(id,n){ return !!AI.usedFx[id+'_'+n]; };
  var m = function(id,n){ AI.usedFx[id+'_'+n]=1; };

  if (cardId==='꼬마 펭귄' && !u(cardId,2)) {
    var t=AI.opDeck.find(function(c){ return CARDS[c.id]&&CARDS[c.id].theme==='펭귄'&&CARDS[c.id].cardType==='monster'; });
    if(t){ m(cardId,2); _aiSummonDeck(t.id); await _s(400); renderAll(); }
  }
  if (cardId==='수문장 펭귄' && !u(cardId,1) && G.opHand.length>0) {
    var fi=G.opField.findIndex(function(c){ return c.id==='수문장 펭귄'; });
    if(fi>=0){ m(cardId,1); G.opField[fi].atk+=1;
      var wk=G.opHand.reduce(function(a,b){ return (CARDS[a.id]?CARDS[a.id].atk||0:0)<=(CARDS[b.id]?CARDS[b.id].atk||0:0)?a:b; });
      _aiDiscard(wk.id);
      await new Promise(function(done){
        _aiStartChainEffect({ type:'aiForceDiscard', label:'수문장 펭귄 ①', count:1, by:'guest' }, done);
      });
      await _s(300);
    }
  }
  if (cardId==='젊은 라이온' && !u(cardId,2)) {
    var t2=AI.opDeck.find(function(c){ return c.id.includes('사자')||(CARDS[c.id]&&CARDS[c.id].theme==='라이온'); });
    if(t2){ m(cardId,2); _aiSearch(t2.id); await _s(300); }
  }
  if (cardId==='젊은 타이거' && !u(cardId,2)) {
    var t3=AI.opDeck.find(function(c){ return CARDS[c.id]&&CARDS[c.id].theme==='타이거'&&CARDS[c.id].cardType==='monster'; });
    if(t3){ m(cardId,2); _aiSummonDeck(t3.id); await _s(400); renderAll(); }
  }
  if (cardId==='베이비 타이거' && !u(cardId,1)) {
    m(cardId,1);
    var t4=AI.opDeck.find(function(c){ return CARDS[c.id]&&CARDS[c.id].theme==='타이거'; });
    var t5=AI.opDeck.find(function(c){ return c.id.includes('호랑이'); });
    if(t4) _aiSearch(t4.id); if(t5) _aiSearch(t5.id);
    var bti=G.opField.findIndex(function(c){ return c.id==='베이비 타이거'; });
    if(bti>=0) G.opExile.push(G.opField.splice(bti,1)[0]);
    await new Promise(function(done){
      _aiStartChainEffect({ type:'aiForceDiscard', label:'베이비 타이거 ②', count:1, by:'guest' }, done);
    });
    await _s(400); renderAll();
  }
  if (cardId==='그레이트 올드 원-크툴루' && !u(cardId,1) && !G.opFieldCard) {
    var rl=AI.opDeck.find(function(c){ return c.id==='태평양 속 르뤼에'; });
    if(rl){
      m(cardId,1);
      AI.opDeck.splice(AI.opDeck.findIndex(function(c){ return c.id==='태평양 속 르뤼에'; }),1);
      G.opDeckCount=AI.opDeck.length;
      G.opFieldCard={id:'태평양 속 르뤼에',name:'태평양 속 르뤼에'};
      handleOpponentAction({type:'fieldCard',cardId:'태평양 속 르뤼에',by:'guest',ts:Date.now()});
      log('🤖 태평양 속 르뤼에 발동','opponent');
      await _s(300); renderAll();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// AI 턴 종료
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 덱 프리셋
// ─────────────────────────────────────────────────────────────
function _aiDeckList(theme) {
  var r=function(id,n){ var a=[]; for(var i=0;i<n;i++) a.push(id); return a; };
  var p={
    '펭귄':   r('펭귄 마을',4).concat(r('꼬마 펭귄',4),r('펭귄 부부',4),r('현자 펭귄',4),r('수문장 펭귄',4),r('펭귄!돌격!',4),r('펭귄의 영광',4),r('펭귄이여 영원하라',4),r('펭귄 마법사',4),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '크툴루': r('그레이트 올드 원-크툴루',4).concat(r('그레이트 올드 원-크투가',4),r('그레이트 올드 원-크아이가',4),r('그레이트 올드 원-과타노차',4),r('엘더 갓-노덴스',4),r('엘더 갓-크타니트',4),r('엘더 갓-히프노스',4),r('올드_원의 멸망',4),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '라이온': r('베이비 라이온',4).concat(r('젊은 라이온',4),r('에이스 라이온',4),r('사자의 포효',4),r('사자의 사냥',4),r('사자의 발톱',4),r('사자의 일격',4),r('진정한 사자',4),['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '타이거': r('베이비 타이거',4).concat(r('젊은 타이거',4),r('에이스 타이거',4),r('호랑이의 포효',4),r('호랑이의 사냥',4),r('호랑이의 발톱',4),r('진정한 호랑이',4),r('호랑이의 일격',4),['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '지배자': r('수원소의 지배자',4).concat(r('화원소의 지배자',4),r('전원소의 지배자',4),r('풍원소의 지배자',4),r('수원소의 지배룡',4),r('화원소의 지배룡',4),r('전원소의 지배룡',4),r('풍원소의 지배룡',4),['지배의 사슬','지배의 사슬','지배룡과 지배자','지배룡과 지배자','눈에는 눈','눈에는 눈','출입통제','출입통제']),
  };
  return (p[theme]||p['크툴루']).slice();
}

function _aiKeyList(theme) {
  var k={
    '펭귄':   ['펭귄 용사','펭귄의 일격','펭귄의 전설','일격필살','단 한번의 기회'],
    '크툴루': ['아우터 갓 니알라토텝','아우터 갓-아자토스','아우터 갓 슈브 니구라스','일격필살','단 한번의 기회'],
    '라이온': ['라이온 킹','고고한 사자','일격필살','단 한번의 기회'],
    '타이거': ['타이거 킹','고고한 호랑이','일격필살','단 한번의 기회'],
    '지배자': ['사원소의 지배룡','사원소의 지배자','일격필살','단 한번의 기회'],
  };
  return (k[theme]||k['크툴루'])
    .filter(function(id){ return !!CARDS[id]; })
    .map(function(id){ return { id:id, name:CARDS[id].name }; });
}

// ─────────────────────────────────────────────────────────────
// 배너
// ─────────────────────────────────────────────────────────────
function _aiBanner() {
  if (document.getElementById('_aiBanner')) return;
  var el=document.createElement('div'); el.id='_aiBanner';
  el.style.cssText='position:fixed;top:0;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#1a0a00,#7c3400,#1a0a00);color:#fb923c;padding:.35rem 1.6rem;border:1px solid #ea580c;border-top:none;border-radius:0 0 10px 10px;font-family:Black Han Sans,sans-serif;font-size:.8rem;letter-spacing:.1em;z-index:3000;box-shadow:0 4px 20px #ea580c44;pointer-events:none;transition:opacity .25s;opacity:0;';
  document.body.appendChild(el);
}
function _setBanner(msg) {
  var el=document.getElementById('_aiBanner'); if(!el) return;
  el.textContent=msg; el.style.opacity=msg?'1':'0';
}


// enterGame 직후 플래그 기반 안전 세팅 (patch.js 연동)
setInterval(function() {
  if (!window.AI || !window.AI.active) return;
  if (!window.AI._pendingSetup) return;
  if (!window.G || !Array.isArray(G.myHand) || typeof advancePhase !== 'function') return;
  window.AI._pendingSetup = false;
  _setupAI();
}, 200);

// ─────────────────────────────────────────────────────────────
// 로비 패치
// ─────────────────────────────────────────────────────────────
function _lobby() {
  var lobby=document.getElementById('lobby');
  if(!lobby||document.getElementById('_aiCard')) return;
  var card=document.createElement('div'); card.id='_aiCard'; card.className='lobby-card';
  card.style.cssText='border-color:#ea580c;background:linear-gradient(160deg,#1a0a00,#2d1500);';
  card.innerHTML=
    '<h2 style="color:#fb923c;display:flex;align-items:center;gap:.5rem">🤖 AI 대전 <span style="font-size:.65rem;color:#ea580c;border:1px solid #ea580c;padding:.1rem .4rem;border-radius:3px">Groq AI</span></h2>'+
    '<p style="font-size:.82rem;color:#9090b0;line-height:1.65;margin:.25rem 0 .8rem">Groq AI가 전황을 분석해 전략적으로 플레이합니다.<br>내가 선공, AI가 후공으로 시작합니다.</p>'+
    '<button style="width:100%;padding:.8rem;background:linear-gradient(135deg,#431407,#9a3412);color:#fed7aa;border:1px solid #ea580c;border-radius:6px;font-family:Black Han Sans,sans-serif;font-size:1rem;letter-spacing:.12em;cursor:pointer;" '+
    'onmouseover="this.style.background=\'linear-gradient(135deg,#7c2d12,#c2410c)\'" '+
    'onmouseout="this.style.background=\'linear-gradient(135deg,#431407,#9a3412)\'" '+
    'onclick="startAIMode()">⚔️ AI와 대전하기 (내가 선공)</button>';
  var all=lobby.querySelectorAll('.lobby-card');
  var last=all[all.length-1];
  if(last) last.after(card); else lobby.appendChild(card);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',_lobby);
else _lobby();
setTimeout(_lobby,500);
setTimeout(_lobby,2000);

// ─────────────────────────────────────────────────────────────
// beginChain 훅 — AI 모드 체인 처리
// ─────────────────────────────────────────────────────────────
(function() {
  var _orig = window.beginChain;
  window.beginChain = function(effect) {
    if (!window.AI.active) { _orig.apply(this, arguments); return; }

    var starter = (effect && effect.by) ? effect.by : myRole;
    var chainState = {
      active: true,
      startedBy: starter,
      priority: getOtherRole(starter),
      passCount: 0,
      links: [Object.assign({}, effect, { by: starter })],
    };
    activeChainState = chainState;
    if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
    log('체인 1: ' + effect.label + ' 발동', 'mine');
    renderChainActions();

    if (chainState.priority === 'guest') {
      setTimeout(function() { _aiChainResponse(chainState); }, 500);
    }
  };
})();

// passChainPriority 훅 — 플레이어 패스 시 AI도 자동 패스
(function() {
  var _orig = window.passChainPriority;
  window.passChainPriority = function() {
    if (!window.AI.active) { _orig.apply(this, arguments); return; }
    if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;

    var next = Object.assign({}, activeChainState);
    next.passCount = (next.passCount || 0) + 1;
    next.priority  = getOtherRole(myRole);
    log('체인 패스', 'system');
    activeChainState = next;
    renderChainActions();

    if (next.passCount >= 2) {
      resolveChain(next);
      return;
    }
    // AI 차례 → 응답 가능 여부 판단 후 패스/응답
    setTimeout(function() {
      if (!activeChainState || !activeChainState.active) return;
      _aiChainResponse(activeChainState);
    }, 600);
  };
})();

// ─────────────────────────────────────────────────────────────
// AI 체인 응답 판단
// ─────────────────────────────────────────────────────────────
function _aiChainResponse(chainState) {
  if (!window.AI.active) return;
  if (!activeChainState || !activeChainState.active) return;

  // AI가 응답할 수 있는 카드 확인
  // 1. 구사일생: 전투 피해 시 자동 (별도 처리)
  // 2. 눈에는 눈: 플레이어 서치 시 자동 트리거
  // 3. 키카드 중 응답 가능한 것

  // 현재 체인에서 AI가 응답할 카드 없으면 패스
  var canRespond = false;

  // 눈에는 눈 체크
  // - 기존: keyFetch(서치) 체인에서만 응답
  // - 개선: 상대가 체인 1을 열었을 때도 즉시 반응 후보로 검토
  //   (응답 카드가 없으면 명시적으로 Pass 처리)
  var liveChain = activeChainState || chainState;
  var eyeIdx = G.opHand.findIndex(function(c) { return c.id === '눈에는 눈'; });
  var hasHostChain = (liveChain.links || []).some(function(l) {
    var by = l && l.by;
    return by === myRole || by === 'host';
  });
  if (eyeIdx >= 0 && _aiCanUse('눈에는 눈', 1) && hasHostChain) canRespond = true;

  if (!canRespond) {
    // 패스
    setTimeout(function() {
      if (!activeChainState || !activeChainState.active) return;
      var next = Object.assign({}, activeChainState);
      next.passCount = (next.passCount || 0) + 1;
      next.priority = 'host'; // 플레이어에게 다시
      log('🤖 AI: "응답 없음(Pass)"', 'opponent');
      activeChainState = next;

      if (next.passCount >= 2) {
        resolveChain(next);
      } else {
        // 플레이어가 응답 수단이 없으면 체인이 멈춘 것처럼 보일 수 있어 즉시 해결
        if (!_playerCanRespondInChain(next)) {
          next.passCount = 2;
          activeChainState = next;
          resolveChain(next);
          return;
        }
        renderChainActions();
        if (typeof openChainResponse === 'function') openChainResponse();
      }
    }, 600);
    return;
  }

  // AI가 응답 결정
  log('🤖 체인 응답!', 'opponent');
  var next = Object.assign({}, activeChainState);
  // 눈에는 눈 발동
  var eyeIdx = G.opHand.findIndex(function(c) { return c.id === '눈에는 눈'; });
  if (eyeIdx >= 0) {
    _aiMarkUsed('눈에는 눈', 1);
    _aiDiscard('눈에는 눈');
    _aiDrawN(2);
    log('🤖 눈에는 눈: 드로우 2장', 'opponent');
    next.links.push({ type: 'aiEye', label: '눈에는 눈', by: getOtherRole(myRole) });
    next.passCount = 0;
    next.priority = myRole;
    activeChainState = next;
    renderChainActions();
    renderAll();

    // 플레이어 응답 기회
    // 플레이어가 패스하면 resolveChain
  }
}


function _playerCanRespondInChain(state) {
  if (!state || !state.active) return false;
  if (state.priority !== 'host') return false;
  if (usedKeyFetchInChain && usedKeyFetchInChain.host) return false;
  return Array.isArray(G.myKeyDeck) && G.myKeyDeck.length > 0;
}

function _aiCanUse(id, n) { return !window.AI.usedFx[id+'_'+n]; }
function _aiMarkUsed(id, n) { window.AI.usedFx[id+'_'+n] = 1; }
window._aiChainResponse = _aiChainResponse;
window._aiRespondToChain = function() {
  _aiChainResponse(activeChainState);
};
