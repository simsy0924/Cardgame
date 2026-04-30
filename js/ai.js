// ============================================================
// ai.js — AI 대전 모듈 (Cloudflare Worker 프록시 버전)
// ============================================================
// 훅은 patch.js 맨 아래에 등록됨 — 이 파일은 순수 AI 로직만
// ============================================================
'use strict';

// ★ Cloudflare Worker URL 입력
var _WORKER_URL = 'https://workers-ai.simsy0924.workers.dev';

// ─────────────────────────────────────────────────────────────
window.AI = {
  active:     false,
  thinking:   false,
  opDeck:     [],
  deckPreset: null,
  usedFx:     {},
  attacked:   new Set(),
};

var _sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

// ─────────────────────────────────────────────────────────────
// AI 모드 진입
// ─────────────────────────────────────────────────────────────
window.startAIMode = function() {
  window.AI.active = true;
  window.roomRef   = null;
  window.myRole    = 'host'; // 플레이어=선공, AI=후공

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool    === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
};

// ─────────────────────────────────────────────────────────────
// AI 덱 빌드 (patch.js의 confirmDeck 훅에서 호출)
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

  var cm = { '펭귄':'크툴루','올드원':'펭귄','라이온':'타이거','타이거':'라이온',
             '라이거':'펭귄','지배자':'크툴루','마피아':'펭귄','불가사의':'펭귄' };
  window.AI.deckPreset = cm[top] || '크툴루';

  var list = _presetMain(window.AI.deckPreset).filter(function(id) { return CARDS[id]; });
  while (list.length < 40) list.push('구사일생');

  window.AI.opDeck   = shuffle(list.map(function(id) {
    return { id: id, name: (CARDS[id] ? CARDS[id].name : id) };
  }));
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();
}

// ─────────────────────────────────────────────────────────────
// _startNewGame 완료 후 AI 상태 세팅 (patch.js에서 동기 호출)
// ─────────────────────────────────────────────────────────────
function _setupAI() {
  if (!window.AI.active) return;
  if (!window.AI.opDeck || !window.AI.opDeck.length) _buildAIDeck();

  // op 존 덮어쓰기
  G.opHand      = [];
  G.opField     = [];
  G.opGrave     = [];
  G.opExile     = [];
  G.opFieldCard = null;
  G.opKeyDeck   = _presetKey(window.AI.deckPreset);
  G.opDeckCount = window.AI.opDeck.length;

  // AI 초기 드로우 7장 (후공)
  _aiDraw(7);

  // 헤더
  document.getElementById('hdrOpName').textContent   = '🤖 AI (' + window.AI.deckPreset + ')';
  document.getElementById('opNameLabel').textContent = '🤖 AI';

  // 시간은 roomRef 없을 때도 돌아가도록 클럭 강제 시작
  gameClock = { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() };

  _injectBanner();
  log('🤖 AI (' + window.AI.deckPreset + ') 후공 참전! 패 ' + G.opHand.length + '장', 'system');
  renderAll();
}

// ─────────────────────────────────────────────────────────────
// AI 카드 조작
// ─────────────────────────────────────────────────────────────
function _aiDraw(n) {
  for (var i = 0; i < n; i++) {
    if (!window.AI.opDeck.length) {
      log('🤖 AI 덱 아웃!', 'system');
      showGameOver(true);
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

function _aiSummon(cardId) {
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
  log('🤖 덱→소환: ' + (card.name || cardId), 'opponent');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

function _aiDiscard(cardId) {
  _aiRemoveHand(cardId);
  G.opGrave.push({ id: cardId, name: (CARDS[cardId] ? CARDS[cardId].name : cardId) });
  handleOpponentAction({ type: 'discard', cardId: cardId, by: 'guest', ts: Date.now() });
}

function _aiSearch(cardId) {
  var idx = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (idx < 0) return false;
  window.AI.opDeck.splice(idx, 1);
  G.opHand.push({ id: cardId, name: (CARDS[cardId] ? CARDS[cardId].name : cardId) });
  G.opDeckCount = window.AI.opDeck.length;
  log('🤖 서치: ' + (CARDS[cardId] ? CARDS[cardId].name : cardId), 'opponent');
  handleOpponentAction({ type: 'search', cardName: (CARDS[cardId] ? CARDS[cardId].name : cardId), by: 'guest', ts: Date.now() });
  return true;
}

function _aiAttack(atkId, defIdx) {
  if (window.AI.attacked.has(atkId)) return false;
  var atkFI = G.opField.findIndex(function(c) { return c.id === atkId; });
  if (atkFI < 0 || !G.myField[defIdx]) return false;
  window.AI.attacked.add(atkId);
  var atk  = G.opField[atkFI];
  var def  = G.myField[defIdx];
  var diff = atk.atk - def.atk;
  log('🤖 공격: ' + atk.name + '(' + atk.atk + ') → ' + def.name + '(' + def.atk + ')', 'opponent');
  handleOpponentAction({
    type: 'combat',
    atkCard: { id: atk.id, name: atk.name, atk: atk.atk },
    defCard: { id: def.id, name: def.name, atk: def.atk },
    by: 'guest', ts: Date.now(),
  });
  if (atk.atk !== 0 && diff <= 0) {
    var ri = G.opField.findIndex(function(c) { return c.id === atkId; });
    if (ri >= 0) G.opGrave.push(G.opField.splice(ri, 1)[0]);
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
  handleOpponentAction({ type: 'directAttack',
    card: { id: atk.id, name: atk.name, atk: atk.atk },
    by: 'guest', ts: Date.now() });
  return true;
}

// ─────────────────────────────────────────────────────────────
// AI 턴 메인 흐름 (patch.js의 endTurn 훅에서 호출)
// ─────────────────────────────────────────────────────────────
async function _aiStartTurn() {
  if (!window.AI.active || isMyTurn || window.AI.thinking) return;

  window.AI.thinking = true;
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();
  _setBanner('🤖 드로우 중...');

  try {
    // 드로우
    if (currentPhase === 'draw') {
      if (!_aiDraw(1)) { window.AI.thinking = false; return; }
      log('🤖 드로우 (패:' + G.opHand.length + ' 덱:' + window.AI.opDeck.length + ')', 'opponent');
      advancePhase('deploy');
      await _sleep(400);
      renderAll();
    }

    // Groq 전략
    _setBanner('🤖 전략 계산 중...');
    await _sleep(200);
    var plan;
    try   { plan = await _groqPlan(); }
    catch (e) { console.warn('[AI] Groq 실패:', e.message); plan = _fallback(); }
    if (plan.thinking) { log('🤖 "' + plan.thinking + '"', 'opponent'); await _sleep(300); }

    // 전개
    _setBanner('🤖 전개 중...');
    await _execDeploy(plan.deploy || []);
    advancePhase('attack');
    await _sleep(300);
    renderAll();

    // 공격
    _setBanner('🤖 공격 중...');
    await _execAttack(plan.attack || []);
    advancePhase('end');
    await _sleep(200);
    _aiEndTurn();

  } catch (e) {
    console.error('[AI] 턴 오류:', e);
    try { advancePhase('end'); } catch(_) {}
    _aiEndTurn();
  }
}

// ─────────────────────────────────────────────────────────────
// Groq API (Cloudflare Worker 경유)
// ─────────────────────────────────────────────────────────────
async function _groqPlan() {
  if (!_WORKER_URL) throw new Error('Worker URL 없음');

  var state = {
    turn: G.turn,
    ai: {
      hand: G.opHand.map(function(c) {
        var cd = CARDS[c.id] || {};
        return { id: c.id, name: c.name, cardType: cd.cardType,
                 atk: cd.atk, theme: cd.theme, effects: cd.effects };
      }),
      field: G.opField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      grave: G.opGrave.map(function(c) { return c.id; }),
      deckCount: window.AI.opDeck.length,
    },
    player: {
      handCount: G.myHand.length,
      field: G.myField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
    },
  };

  var systemPrompt = [
    '당신은 카드 게임 "핸드 배틀 TCG"의 AI 플레이어입니다.',
    '목표: 상대 패를 0장으로 만들기.',
    '전투: 내ATK > 상대ATK → 상대 몬스터 제거 + 차이만큼 상대 패 손실.',
    '전투: 내ATK < 상대ATK → 내 몬스터 제거 + 차이만큼 내 패 손실.',
    '상대 필드 비었을 때 직접 공격 → ATK만큼 상대 패 손실.',
    '전략: ATK 높은 몬스터 최대 소환 → 필드 비면 전원 직접 공격, 아니면 유리한 전투만.',
    'summonFromHand: monster 카드만 가능.',
    'deploy.cardId: ai.hand 에 있는 monster id 만 사용.',
    'attack.attackerId: ai.field 또는 deploy 후 필드에 있을 id.',
    'attack.targetIdx: player.field 인덱스 (0부터 시작).',
    '상대 필드 비었으면 attack 대신 directAttack 사용.',
    '반드시 JSON 만 반환. 마크다운 없이.',
  ].join('\n');

  var resp = await fetch(_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: '현재 게임 상태:\n' + JSON.stringify(state) +
            '\n\n최적의 행동을 JSON으로 반환:\n' +
            '{"thinking":"전략 한 줄 (한국어)",' +
            '"deploy":[{"action":"summonFromHand","cardId":"ID"}],' +
            '"attack":[{"action":"attack","attackerId":"ID","targetIdx":0}]}',
        },
      ],
    }),
  });

  if (!resp.ok) throw new Error('Worker ' + resp.status);
  var data = await resp.json();
  var text = data.choices && data.choices[0] &&
             data.choices[0].message && data.choices[0].message.content || '{}';
  var clean = text.replace(/```json|```/g, '').trim();
  var match = clean.match(/\{[\s\S]*\}/);
  if (match) clean = match[0];
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────
// 폴백
// ─────────────────────────────────────────────────────────────
function _fallback() {
  var plan = { thinking: '기본 전략', deploy: [], attack: [] };
  var mons = G.opHand
    .filter(function(c) { return CARDS[c.id] && CARDS[c.id].cardType === 'monster'; })
    .map(function(c) { return { id: c.id, atk: CARDS[c.id].atk || 0 }; })
    .sort(function(a, b) { return b.atk - a.atk; })
    .slice(0, 3);
  mons.forEach(function(c) { plan.deploy.push({ action: 'summonFromHand', cardId: c.id }); });

  var expField = G.opField.concat(mons.map(function(c) {
    return { id: c.id, atk: CARDS[c.id] ? (CARDS[c.id].atk || 0) : 0 };
  }));
  if (G.myField.length === 0) {
    expField.forEach(function(c) { plan.attack.push({ action: 'directAttack', attackerId: c.id }); });
  } else {
    expField.forEach(function(att) {
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
// 전개/공격 실행
// ─────────────────────────────────────────────────────────────
async function _execDeploy(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act || act.action !== 'summonFromHand' || !act.cardId) continue;
    if (!G.opHand.find(function(c) { return c.id === act.cardId; })) continue;
    var cd = CARDS[act.cardId];
    if (!cd || cd.cardType !== 'monster') continue;
    _aiSummon(act.cardId);
    await _sleep(500);
    await _aiTrigger(act.cardId);
    renderAll();
  }
}

async function _execAttack(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act) continue;
    if (act.action === 'attack') {
      var di = typeof act.targetIdx === 'number' ? act.targetIdx : 0;
      if (di < G.myField.length && G.opField.find(function(c) { return c.id === act.attackerId; })) {
        _aiAttack(act.attackerId, di);
        await _sleep(800);
        renderAll();
      }
    } else if (act.action === 'directAttack') {
      if (G.myField.length === 0 && G.opField.find(function(c) { return c.id === act.attackerId; })) {
        _aiDirectAttack(act.attackerId);
        await _sleep(800);
        renderAll();
      }
    }
    if (G.myHand.length === 0) break;
  }
}

// ─────────────────────────────────────────────────────────────
// 소환 유발 효과
// ─────────────────────────────────────────────────────────────
async function _aiTrigger(cardId) {
  var AI = window.AI;
  var used = function(id, n) { return !!AI.usedFx[id + '_' + n]; };
  var mark = function(id, n) { AI.usedFx[id + '_' + n] = 1; };

  if (cardId === '꼬마 펭귄' && !used(cardId, 2)) {
    var t = AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '펭귄' && CARDS[c.id].cardType === 'monster'; });
    if (t) { mark(cardId, 2); _aiSummonFromDeck(t.id); await _sleep(400); renderAll(); }
  }
  if (cardId === '수문장 펭귄' && !used(cardId, 1) && G.opHand.length > 0) {
    var fi = G.opField.findIndex(function(c) { return c.id === '수문장 펭귄'; });
    if (fi >= 0) {
      mark(cardId, 1);
      G.opField[fi].atk += 1;
      var wk = G.opHand.reduce(function(a, b) {
        return (CARDS[a.id] ? CARDS[a.id].atk || 0 : 0) <= (CARDS[b.id] ? CARDS[b.id].atk || 0 : 0) ? a : b;
      });
      _aiDiscard(wk.id);
      handleOpponentAction({ type: 'forceDiscard', count: 1, reason: '수문장 펭귄', by: 'guest', ts: Date.now() });
      await _sleep(300);
    }
  }
  if (cardId === '젊은 라이온' && !used(cardId, 2)) {
    var t2 = AI.opDeck.find(function(c) { return c.id.includes('사자') || (CARDS[c.id] && CARDS[c.id].theme === '라이온'); });
    if (t2) { mark(cardId, 2); _aiSearch(t2.id); await _sleep(300); }
  }
  if (cardId === '젊은 타이거' && !used(cardId, 2)) {
    var t3 = AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '타이거' && CARDS[c.id].cardType === 'monster'; });
    if (t3) { mark(cardId, 2); _aiSummonFromDeck(t3.id); await _sleep(400); renderAll(); }
  }
  if (cardId === '베이비 타이거' && !used(cardId, 1)) {
    mark(cardId, 1);
    var t4 = AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '타이거'; });
    var t5 = AI.opDeck.find(function(c) { return c.id.includes('호랑이'); });
    if (t4) _aiSearch(t4.id);
    if (t5) _aiSearch(t5.id);
    var bti = G.opField.findIndex(function(c) { return c.id === '베이비 타이거'; });
    if (bti >= 0) G.opExile.push(G.opField.splice(bti, 1)[0]);
    handleOpponentAction({ type: 'forceDiscard', count: 1, reason: '베이비 타이거 ②', by: 'guest', ts: Date.now() });
    await _sleep(400); renderAll();
  }
  if (cardId === '그레이트 올드 원-크툴루' && !used(cardId, 1) && !G.opFieldCard) {
    var rl = AI.opDeck.find(function(c) { return c.id === '태평양 속 르뤼에'; });
    if (rl) {
      mark(cardId, 1);
      AI.opDeck.splice(AI.opDeck.findIndex(function(c) { return c.id === '태평양 속 르뤼에'; }), 1);
      G.opDeckCount = AI.opDeck.length;
      G.opFieldCard = { id: '태평양 속 르뤼에', name: '태평양 속 르뤼에' };
      handleOpponentAction({ type: 'fieldCard', cardId: '태평양 속 르뤼에', by: 'guest', ts: Date.now() });
      log('🤖 태평양 속 르뤼에 발동', 'opponent');
      await _sleep(300); renderAll();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// AI 턴 종료
// ─────────────────────────────────────────────────────────────
function _aiEndTurn() {
  if (isMyTurn) { window.AI.thinking = false; return; }
  if (typeof resetTurnEffects === 'function') resetTurnEffects();
  window.AI.usedFx   = {};
  window.AI.attacked = new Set();
  G.turn++;
  isMyTurn = true;
  try { attackedMonstersThisTurn.clear(); } catch(e) {}
  advancePhase('draw');
  // 클럭을 플레이어 턴으로 전환
  gameClock = { host: gameClock.host, guest: gameClock.guest, runningFor: 'host', lastUpdated: Date.now() };
  _setBanner('');
  window.AI.thinking = false;
  renderAll();
  notify('🎮 내 턴! 드로우 버튼을 눌러주세요.');
}

// ─────────────────────────────────────────────────────────────
// 덱 프리셋
// ─────────────────────────────────────────────────────────────
function _presetMain(theme) {
  var r = function(id, n) { var a = []; for (var i = 0; i < n; i++) a.push(id); return a; };
  var p = {
    '펭귄':   r('펭귄 마을',4).concat(r('꼬마 펭귄',4),r('펭귄 부부',4),r('현자 펭귄',4),r('수문장 펭귄',4),r('펭귄!돌격!',4),r('펭귄의 영광',4),r('펭귄이여 영원하라',4),r('펭귄 마법사',4),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '크툴루': r('그레이트 올드 원-크툴루',4).concat(r('그레이트 올드 원-크투가',4),r('그레이트 올드 원-크아이가',4),r('그레이트 올드 원-과타노차',4),r('엘더 갓-노덴스',4),r('엘더 갓-크타니트',4),r('엘더 갓-히프노스',4),r('올드_원의 멸망',4),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '라이온': r('베이비 라이온',4).concat(r('젊은 라이온',4),r('에이스 라이온',4),r('사자의 포효',4),r('사자의 사냥',4),r('사자의 발톱',4),r('사자의 일격',4),r('진정한 사자',4),['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '타이거': r('베이비 타이거',4).concat(r('젊은 타이거',4),r('에이스 타이거',4),r('호랑이의 포효',4),r('호랑이의 사냥',4),r('호랑이의 발톱',4),r('진정한 호랑이',4),r('호랑이의 일격',4),['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '지배자': r('수원소의 지배자',4).concat(r('화원소의 지배자',4),r('전원소의 지배자',4),r('풍원소의 지배자',4),r('수원소의 지배룡',4),r('화원소의 지배룡',4),r('전원소의 지배룡',4),r('풍원소의 지배룡',4),['지배의 사슬','지배의 사슬','지배룡과 지배자','지배룡과 지배자','눈에는 눈','눈에는 눈','출입통제','출입통제']),
  };
  return (p[theme] || p['크툴루']).slice();
}

function _presetKey(theme) {
  var k = {
    '펭귄':   ['펭귄 용사','펭귄의 일격','펭귄의 전설','일격필살','단 한번의 기회'],
    '크툴루': ['아우터 갓 니알라토텝','아우터 갓-아자토스','아우터 갓 슈브 니구라스','일격필살','단 한번의 기회'],
    '라이온': ['라이온 킹','고고한 사자','일격필살','단 한번의 기회'],
    '타이거': ['타이거 킹','고고한 호랑이','일격필살','단 한번의 기회'],
    '지배자': ['사원소의 지배룡','사원소의 지배자','일격필살','단 한번의 기회'],
  };
  return (k[theme] || k['크툴루'])
    .filter(function(id) { return CARDS[id]; })
    .map(function(id) { return { id: id, name: CARDS[id].name }; });
}

// ─────────────────────────────────────────────────────────────
// 배너 UI
// ─────────────────────────────────────────────────────────────
function _injectBanner() {
  if (document.getElementById('_aiBanner')) return;
  var el = document.createElement('div');
  el.id = '_aiBanner';
  el.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#1a0a00,#7c3400,#1a0a00);color:#fb923c;padding:.35rem 1.6rem;border:1px solid #ea580c;border-top:none;border-radius:0 0 10px 10px;font-family:Black Han Sans,sans-serif;font-size:.8rem;letter-spacing:.1em;z-index:3000;box-shadow:0 4px 20px #ea580c44;pointer-events:none;transition:opacity .25s;opacity:0;';
  document.body.appendChild(el);
}
function _setBanner(msg) {
  var el = document.getElementById('_aiBanner');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = msg ? '1' : '0';
}

// ─────────────────────────────────────────────────────────────
// 로비 패치
// ─────────────────────────────────────────────────────────────
function _patchLobby() {
  var lobby = document.getElementById('lobby');
  if (!lobby || document.getElementById('_aiCard')) return;
  var card = document.createElement('div');
  card.id = '_aiCard';
  card.className = 'lobby-card';
  card.style.cssText = 'border-color:#ea580c;background:linear-gradient(160deg,#1a0a00,#2d1500);';
  card.innerHTML =
    '<h2 style="color:#fb923c;display:flex;align-items:center;gap:.5rem">🤖 AI 대전 <span style="font-size:.65rem;color:#ea580c;border:1px solid #ea580c;padding:.1rem .4rem;border-radius:3px">Groq AI</span></h2>' +
    '<p style="font-size:.82rem;color:#9090b0;line-height:1.65;margin:.25rem 0 .8rem">Groq AI가 전황을 분석해 전략적으로 플레이합니다.<br>내가 선공, AI가 후공으로 시작합니다.</p>' +
    '<button style="width:100%;padding:.8rem;background:linear-gradient(135deg,#431407,#9a3412);color:#fed7aa;border:1px solid #ea580c;border-radius:6px;font-family:Black Han Sans,sans-serif;font-size:1rem;letter-spacing:.12em;cursor:pointer;box-shadow:0 0 20px #ea580c33;" ' +
    'onmouseover="this.style.background=\'linear-gradient(135deg,#7c2d12,#c2410c)\'" ' +
    'onmouseout="this.style.background=\'linear-gradient(135deg,#431407,#9a3412)\'" ' +
    'onclick="startAIMode()">⚔️ AI와 대전하기 (내가 선공)</button>';
  var all = lobby.querySelectorAll('.lobby-card');
  var last = all[all.length - 1];
  if (last) last.after(card); else lobby.appendChild(card);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _patchLobby);
else _patchLobby();
setTimeout(_patchLobby, 500);
setTimeout(_patchLobby, 2000);
