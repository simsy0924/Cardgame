// ============================================================
// ai.js — 진짜 AI 대전 모듈 (Claude API 기반)
// ============================================================
// 설치 방법:
//   1. 이 파일을 js/ai.js 로 저장
//   2. index.html 의 <script src="js/patch.js"></script> 바로 뒤에 추가:
//      <script src="js/ai.js"></script>
// ============================================================
'use strict';

// ─────────────────────────────────────────────────────────────
// 전역 상태
// ─────────────────────────────────────────────────────────────
window.AI = {
  active:       false,   // AI 모드 ON/OFF
  thinking:     false,   // AI 생각 중
  turnCount:    0,       // AI 턴 횟수
  deckPreset:   null,    // AI 덱 프리셋 이름
  opDeck:       [],      // AI 메인덱 (셔플된 배열)
  usedEffects:  {},      // {cardId_effectNum: true} AI 사용 효과 추적
  attackedThis: new Set(), // 이번 AI 공격 단계 공격한 몬스터 id
};

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────
const _sleep = ms => new Promise(r => setTimeout(r, ms));

function _aiLog(msg) { log('🤖 ' + msg, 'opponent'); }

function _aiCanUseEffect(cardId, num) { return !window.AI.usedEffects[cardId + '_' + num]; }
function _aiMarkUsed(cardId, num)     { window.AI.usedEffects[cardId + '_' + num] = true; }

function _aiResetTurnEffects() {
  window.AI.usedEffects = {};
  window.AI.attackedThis = new Set();
}

// AI 덱에서 n장 드로우
function _aiDraw(n) {
  n = n || 1;
  for (let i = 0; i < n; i++) {
    if (window.AI.opDeck.length === 0) {
      _aiLog('덱 아웃!');
      showGameOver(true);
      return false;
    }
    var c = window.AI.opDeck.shift();
    G.opHand.push({ id: c.id, name: c.name });
    G.opDeckCount = window.AI.opDeck.length;
  }
  return true;
}

// AI 패에서 카드 제거
function _aiRemoveFromHand(cardId) {
  var i = G.opHand.findIndex(function(c) { return c.id === cardId; });
  if (i >= 0) G.opHand.splice(i, 1);
}

// AI 몬스터 필드 소환
function _aiSummon(cardId) {
  var card = CARDS[cardId];
  if (!card || card.cardType !== 'monster') return false;
  _aiRemoveFromHand(cardId);
  G.opField.push({ id: cardId, name: card.name, atk: card.atk != null ? card.atk : 0, atkBase: card.atk != null ? card.atk : 0 });
  _aiLog('소환: ' + card.name + ' (ATK ' + (card.atk != null ? card.atk : 0) + ')');
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

// AI 패 버리기
function _aiDiscard(cardId) {
  _aiRemoveFromHand(cardId);
  G.opGrave.push({ id: cardId, name: (CARDS[cardId] ? CARDS[cardId].name : cardId) });
  handleOpponentAction({ type: 'discard', cardId: cardId, by: 'guest', ts: Date.now() });
}

// AI 덱에서 서치 → opHand
function _aiSearchFromDeck(cardId) {
  var i = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (i < 0) return false;
  window.AI.opDeck.splice(i, 1);
  G.opHand.push({ id: cardId, name: (CARDS[cardId] ? CARDS[cardId].name : cardId) });
  G.opDeckCount = window.AI.opDeck.length;
  _aiLog('서치: ' + (CARDS[cardId] ? CARDS[cardId].name : cardId));
  handleOpponentAction({ type: 'search', cardName: (CARDS[cardId] ? CARDS[cardId].name : cardId), by: 'guest', ts: Date.now() });
  return true;
}

// AI 덱에서 소환
function _aiSummonFromDeck(cardId) {
  var i = window.AI.opDeck.findIndex(function(c) { return c.id === cardId; });
  if (i < 0) return false;
  window.AI.opDeck.splice(i, 1);
  G.opDeckCount = window.AI.opDeck.length;
  var card = CARDS[cardId] || {};
  G.opField.push({ id: cardId, name: card.name || cardId, atk: card.atk != null ? card.atk : 0, atkBase: card.atk != null ? card.atk : 0 });
  _aiLog('덱에서 소환: ' + (card.name || cardId));
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

// AI 묘지에서 소환
function _aiSummonFromGrave(cardId) {
  var i = G.opGrave.findIndex(function(c) { return c.id === cardId; });
  if (i < 0) return false;
  G.opGrave.splice(i, 1);
  var card = CARDS[cardId] || {};
  G.opField.push({ id: cardId, name: card.name || cardId, atk: card.atk != null ? card.atk : 0, atkBase: card.atk != null ? card.atk : 0 });
  _aiLog('묘지에서 소환: ' + (card.name || cardId));
  handleOpponentAction({ type: 'summon', cardId: cardId, by: 'guest', ts: Date.now() });
  return true;
}

// AI 공격
function _aiAttack(atkCardId, defIdx) {
  var atkIdx = G.opField.findIndex(function(c) { return c.id === atkCardId; });
  if (atkIdx < 0 || window.AI.attackedThis.has(atkCardId)) return false;
  var defender = G.myField[defIdx];
  if (!defender) return false;

  window.AI.attackedThis.add(atkCardId);
  var attacker = G.opField[atkIdx];
  var diff = attacker.atk - defender.atk;

  _aiLog('공격: ' + attacker.name + '(' + attacker.atk + ') → ' + defender.name + '(' + defender.atk + ')');

  handleOpponentAction({
    type: 'combat',
    atkCard: { id: attacker.id, name: attacker.name, atk: attacker.atk },
    defCard: { id: defender.id, name: defender.name, atk: defender.atk },
    by: 'guest', ts: Date.now(),
  });

  // AI 몬스터가 진 경우 opField에서 제거
  if (diff < 0 && attacker.atk !== 0) {
    var di = G.opField.findIndex(function(c) { return c.id === atkCardId; });
    if (di >= 0) { G.opGrave.push(G.opField.splice(di, 1)[0]); }
  } else if (diff === 0 && attacker.atk !== 0) {
    var di2 = G.opField.findIndex(function(c) { return c.id === atkCardId; });
    if (di2 >= 0) { G.opGrave.push(G.opField.splice(di2, 1)[0]); }
  }
  return true;
}

// AI 직접 공격
function _aiDirectAttack(atkCardId) {
  if (G.myField.length > 0) return false;
  var atkIdx = G.opField.findIndex(function(c) { return c.id === atkCardId; });
  if (atkIdx < 0 || window.AI.attackedThis.has(atkCardId)) return false;

  window.AI.attackedThis.add(atkCardId);
  var attacker = G.opField[atkIdx];
  _aiLog('직접 공격: ' + attacker.name + '(' + attacker.atk + ')');

  handleOpponentAction({
    type: 'directAttack',
    card: { id: attacker.id, name: attacker.name, atk: attacker.atk },
    by: 'guest', ts: Date.now(),
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// AI 모드 진입
// ─────────────────────────────────────────────────────────────
function startAIMode() {
  window.AI.active = true;
  window.roomRef   = null;
  window.myRole    = 'host';

  var btn = document.getElementById('dbConfirmBtn');
  if (btn) btn.textContent = 'AI 대전 시작 →';

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  if (typeof filterDeckPool === 'function') filterDeckPool('전체');
  if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
}

// confirmDeck → enterGameWithDeck 훅
(function() {
  var _orig = window.enterGameWithDeck;
  window.enterGameWithDeck = function() {
    if (typeof _orig === 'function') _orig.apply(this, arguments);
    if (window.AI.active) setTimeout(_initAIGame, 150);
  };
})();

// ─────────────────────────────────────────────────────────────
// AI 게임 초기화
// ─────────────────────────────────────────────────────────────
function _initAIGame() {
  // 플레이어 테마 분석 → 카운터 덱 선택
  var playerDeck = window._confirmedDeck || [];
  var themeCount = {};
  playerDeck.forEach(function(id) {
    var t = CARDS[id] && CARDS[id].theme;
    if (t) themeCount[t] = (themeCount[t] || 0) + 1;
  });
  var topTheme = '펭귄';
  var topCount = 0;
  Object.keys(themeCount).forEach(function(t) { if (themeCount[t] > topCount) { topCount = themeCount[t]; topTheme = t; } });

  var counterMap = { '펭귄':'크툴루','올드원':'펭귄','라이온':'타이거','타이거':'라이온','라이거':'펭귄','지배자':'크툴루','마피아':'펭귄','불가사의':'펭귄' };
  window.AI.deckPreset = counterMap[topTheme] || '펭귄';

  // 덱 구성
  var deckList = _getAIPresetDeck(window.AI.deckPreset);
  window.AI.opDeck = shuffle(deckList.map(function(id) { return { id: id, name: (CARDS[id] ? CARDS[id].name : id) }; }));
  window.AI.usedEffects = {};
  window.AI.turnCount = 0;

  // G 상태 초기화
  G.opHand      = [];
  G.opField     = [];
  G.opGrave     = [];
  G.opExile     = [];
  G.opFieldCard = null;
  G.opKeyDeck   = _getAIPresetKeyDeck(window.AI.deckPreset).map(function(id) { return { id: id, name: (CARDS[id] ? CARDS[id].name : id) }; });
  G.opDeckCount = window.AI.opDeck.length;

  // AI 초기 드로우 (guest: 7장)
  _aiDraw(7);

  document.getElementById('hdrOpName').textContent  = '🤖 AI (' + window.AI.deckPreset + ')';
  document.getElementById('opNameLabel').textContent = '🤖 AI';

  _injectAIBanner();
  _aiLog(window.AI.deckPreset + ' 덱으로 참전! 패 ' + G.opHand.length + '장');
  renderAll();
}

// ─────────────────────────────────────────────────────────────
// AI 덱 프리셋
// ─────────────────────────────────────────────────────────────
function _getAIPresetDeck(theme) {
  var x4 = function(id) { return [id,id,id,id]; };
  var presets = {
    '펭귄': x4('펭귄 마을').concat(x4('꼬마 펭귄'),x4('펭귄 부부'),x4('현자 펭귄'),x4('수문장 펭귄'),x4('펭귄!돌격!'),x4('펭귄의 영광'),x4('펭귄이여 영원하라'),x4('펭귄 마법사'),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '크툴루': x4('그레이트 올드 원-크툴루').concat(x4('그레이트 올드 원-크투가'),x4('그레이트 올드 원-크아이가'),x4('그레이트 올드 원-과타노차'),x4('엘더 갓-노덴스'),x4('엘더 갓-크타니트'),x4('엘더 갓-히프노스'),x4('올드_원의 멸망'),['구사일생','구사일생','눈에는 눈','눈에는 눈']),
    '라이온': x4('베이비 라이온').concat(x4('젊은 라이온'),x4('에이스 라이온'),x4('사자의 포효'),x4('사자의 사냥'),x4('사자의 발톱'),x4('사자의 일격'),x4('진정한 사자'),['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '타이거': x4('베이비 타이거').concat(x4('젊은 타이거'),x4('에이스 타이거'),x4('호랑이의 포효'),x4('호랑이의 사냥'),x4('호랑이의 발톱'),x4('진정한 호랑이'),x4('호랑이의 일격'),['구사일생','구사일생','눈에는 눈','눈에는 눈','출입통제','출입통제']),
    '지배자': x4('수원소의 지배자').concat(x4('화원소의 지배자'),x4('전원소의 지배자'),x4('풍원소의 지배자'),x4('수원소의 지배룡'),x4('화원소의 지배룡'),x4('전원소의 지배룡'),x4('풍원소의 지배룡'),['지배의 사슬','지배의 사슬','지배룡과 지배자','지배룡과 지배자','눈에는 눈','눈에는 눈','출입통제','출입통제']),
  };
  var raw = [].concat(presets[theme] || presets['펭귄']).filter(function(id) { return CARDS[id]; });
  while (raw.length < 40) raw.push('구사일생');
  return raw.slice(0, 60);
}

function _getAIPresetKeyDeck(theme) {
  var keys = {
    '펭귄':   ['펭귄 용사','펭귄의 일격','펭귄의 전설','일격필살','단 한번의 기회'],
    '크툴루': ['아우터 갓 니알라토텝','아우터 갓-아자토스','아우터 갓 슈브 니구라스','일격필살','단 한번의 기회'],
    '라이온': ['라이온 킹','고고한 사자','일격필살','단 한번의 기회'],
    '타이거': ['타이거 킹','고고한 호랑이','일격필살','단 한번의 기회'],
    '지배자': ['사원소의 지배룡','사원소의 지배자','사원소의 기적','일격필살','단 한번의 기회'],
  };
  return (keys[theme] || keys['펭귄']).filter(function(id) { return CARDS[id]; });
}

// ─────────────────────────────────────────────────────────────
// endTurn 훅 — 플레이어 턴 종료 감지
// ─────────────────────────────────────────────────────────────
(function() {
  var _orig = window.endTurn;
  window.endTurn = function() {
    if (typeof _orig === 'function') _orig.apply(this, arguments);
    if (window.AI.active && !isMyTurn) {
      setTimeout(_aiStartTurn, 600);
    }
  };
})();

// ─────────────────────────────────────────────────────────────
// AI 턴 메인 흐름
// ─────────────────────────────────────────────────────────────
async function _aiStartTurn() {
  if (!window.AI.active || isMyTurn) return;
  if (window.AI.thinking) return;

  window.AI.thinking = true;
  window.AI.turnCount++;
  _aiResetTurnEffects();
  _updateBanner('🤖 AI 드로우 중...');

  // ── 1. 드로우 ──
  if (currentPhase === 'draw') {
    var ok = _aiDraw(1);
    if (!ok) { window.AI.thinking = false; return; }
    _aiLog('드로우 (패: ' + G.opHand.length + '장, 덱: ' + window.AI.opDeck.length + '장)');
    advancePhase('deploy');
    await _sleep(500);
    renderAll();
  }

  // ── 2. Claude API로 전략 계산 ──
  _updateBanner('🤖 AI 전략 계산 중...');
  await _sleep(300);

  var plan;
  try {
    plan = await _askClaudeForPlan();
  } catch(e) {
    console.warn('[AI] Claude API 실패, 폴백:', e);
    plan = _buildFallbackPlan();
  }

  if (plan.thinking) {
    _aiLog('"' + plan.thinking + '"');
    await _sleep(400);
  }

  // ── 3. 전개 단계 ──
  _updateBanner('🤖 AI 전개 중...');
  await _executeDeployPlan(plan.deploy || []);
  advancePhase('attack');
  await _sleep(400);
  renderAll();

  // ── 4. 선공 1턴 공격 없음 ──
  if (G.turn <= 2 && myRole === 'host') {
    _aiLog('선공 1턴 — 공격 없음');
    advancePhase('end');
    await _sleep(300);
    _aiEndTurn();
    return;
  }

  // ── 5. 공격 단계 ──
  _updateBanner('🤖 AI 공격 중...');
  await _executeAttackPlan(plan.attack || []);
  advancePhase('end');
  await _sleep(300);

  _aiEndTurn();
}

// ─────────────────────────────────────────────────────────────
// Claude API 호출 — 전략 계획 수립
// ─────────────────────────────────────────────────────────────
async function _askClaudeForPlan() {
  // 게임 상태 스냅샷
  var state = {
    turn: G.turn,
    ai: {
      hand: G.opHand.map(function(c) {
        var cd = CARDS[c.id] || {};
        return { id: c.id, name: c.name, cardType: cd.cardType, atk: cd.atk, theme: cd.theme, effects: cd.effects };
      }),
      field: G.opField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      grave: G.opGrave.map(function(c) { return c.id; }),
      keyDeck: G.opKeyDeck.map(function(c) { return c.id; }),
      deckCount: window.AI.opDeck.length,
    },
    player: {
      handCount: G.myHand.length,
      field: G.myField.map(function(c) { return { id: c.id, name: c.name, atk: c.atk }; }),
      grave: G.myGrave.map(function(c) { return c.id; }),
      deckCount: G.myDeckCount,
    },
  };

  var systemPrompt = `당신은 카드 게임 "핸드 배틀 TCG"의 최강 AI 플레이어입니다.

목표: 상대(플레이어)의 패(hand)를 0장으로 만들기.

핵심 규칙:
- 패가 0장 = 패배
- 전투: 내 ATK > 상대 ATK → 상대 몬스터 제거 + 차이만큼 상대 패 손실
- 전투: 내 ATK < 상대 ATK → 내 몬스터 제거 + 차이만큼 내 패 손실  
- 직접 공격(상대 필드 비었을 때): ATK만큼 상대 패 손실
- 전개 단계: 카드 효과로 몬스터 소환

전략 원칙:
1. ATK 높은 몬스터를 최대한 많이 소환해서 필드 장악
2. 상대 필드 비면 전체 직접 공격으로 패를 대량 털기
3. ATK 불리한 전투는 피하기 (내 패도 손실됨)
4. 유리한 전투(이길 수 있는 것)만 선택적 공격

반드시 아래 JSON 형식으로만 응답 (설명 없이, 마크다운 없이):
{
  "thinking": "이번 턴 핵심 전략 한 줄 (한국어)",
  "deploy": [
    { "action": "summonFromHand", "cardId": "카드ID", "reason": "이유" }
  ],
  "attack": [
    { "action": "attack", "attackerId": "내필드카드ID", "targetIdx": 0, "reason": "이유" },
    { "action": "directAttack", "attackerId": "내필드카드ID", "reason": "이유" }
  ]
}

주의사항:
- deploy의 cardId는 반드시 ai.hand에 있는 카드의 id여야 함
- attack의 attackerId는 반드시 ai.field(전개 후)에 있을 카드의 id여야 함
- targetIdx는 player.field 배열의 인덱스 (0부터 시작)
- 상대 필드가 비었으면 attack 대신 directAttack 사용
- 몬스터만 summonFromHand 가능`;

  var userContent = '현재 게임 상태 (AI 시점):\n' + JSON.stringify(state, null, 2) + '\n\n최적의 전략을 JSON으로 알려주세요.';

  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!resp.ok) throw new Error('API ' + resp.status);
  var data = await resp.json();
  var raw  = (data.content || []).map(function(b) { return b.text || ''; }).join('');
  var clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────
// 폴백 전략 (API 실패 시)
// ─────────────────────────────────────────────────────────────
function _buildFallbackPlan() {
  var plan = { thinking: '기본 전략: 강한 몬스터 소환 후 공격', deploy: [], attack: [] };

  // ATK 높은 몬스터 최대 3장 소환
  var monsters = G.opHand
    .filter(function(c) { return CARDS[c.id] && CARDS[c.id].cardType === 'monster'; })
    .map(function(c) { return { id: c.id, atk: CARDS[c.id] ? (CARDS[c.id].atk || 0) : 0 }; })
    .sort(function(a,b) { return b.atk - a.atk; })
    .slice(0, 3);

  monsters.forEach(function(c) { plan.deploy.push({ action: 'summonFromHand', cardId: c.id, reason: 'ATK 순위' }); });

  // 공격 계획
  var willField = G.opField.concat(monsters).filter(function(c) { return c.id; });
  if (G.myField.length === 0) {
    willField.forEach(function(c) { plan.attack.push({ action: 'directAttack', attackerId: c.id }); });
  } else {
    willField.forEach(function(att) {
      var bestIdx = -1, bestGain = 0;
      G.myField.forEach(function(def, di) {
        var gain = (att.atk || 0) - (def.atk || 0);
        if (gain > bestGain) { bestGain = gain; bestIdx = di; }
      });
      if (bestIdx >= 0) plan.attack.push({ action: 'attack', attackerId: att.id, targetIdx: bestIdx });
    });
  }

  return plan;
}

// ─────────────────────────────────────────────────────────────
// 전개 계획 실행
// ─────────────────────────────────────────────────────────────
async function _executeDeployPlan(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'summonFromHand') {
      if (!G.opHand.find(function(c) { return c.id === act.cardId; })) continue;
      var card = CARDS[act.cardId];
      if (!card) continue;

      if (card.cardType === 'monster') {
        _aiSummon(act.cardId);
        await _sleep(500);
        renderAll();
        await _handleAISummonTrigger(act.cardId);
      } else {
        await _handleAIActivate(act.cardId);
        await _sleep(400);
        renderAll();
      }
    } else if (act.action === 'discardFromHand') {
      if (G.opHand.find(function(c) { return c.id === act.cardId; })) {
        _aiDiscard(act.cardId);
        await _sleep(300);
        renderAll();
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 공격 계획 실행
// ─────────────────────────────────────────────────────────────
async function _executeAttackPlan(actions) {
  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'attack') {
      var defIdx = typeof act.targetIdx === 'number' ? act.targetIdx : 0;
      if (defIdx >= G.myField.length) continue;
      if (!G.opField.find(function(c) { return c.id === act.attackerId; })) continue;
      _aiAttack(act.attackerId, defIdx);
      await _sleep(700);
      renderAll();
    } else if (act.action === 'directAttack') {
      if (G.myField.length > 0) continue;
      if (!G.opField.find(function(c) { return c.id === act.attackerId; })) continue;
      _aiDirectAttack(act.attackerId);
      await _sleep(700);
      renderAll();
    }

    if (G.myHand.length === 0) break;
  }
}

// ─────────────────────────────────────────────────────────────
// AI 소환 유발 효과 (핵심 카드)
// ─────────────────────────────────────────────────────────────
async function _handleAISummonTrigger(cardId) {
  // 꼬마 펭귄 ②: 덱에서 펭귄 몬스터 소환
  if (cardId === '꼬마 펭귄' && _aiCanUseEffect(cardId, 2)) {
    var t = window.AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '펭귄' && CARDS[c.id].cardType === 'monster'; });
    if (t) {
      _aiMarkUsed(cardId, 2);
      _aiLog('꼬마 펭귄 ②: 덱에서 소환');
      _aiSummonFromDeck(t.id);
      await _sleep(400);
      renderAll();
    }
  }
  // 수문장 펭귄 ①: ATK+1 + 서로 패 1장 버리기
  if (cardId === '수문장 펭귄' && _aiCanUseEffect(cardId, 1)) {
    var fi = G.opField.findIndex(function(c) { return c.id === '수문장 펭귄'; });
    if (fi >= 0 && G.opHand.length > 0) {
      _aiMarkUsed(cardId, 1);
      G.opField[fi].atk += 1;
      _aiLog('수문장 펭귄 ①: ATK+1');
      var lowest = G.opHand.reduce(function(a,b) { return (CARDS[a.id] ? (CARDS[a.id].atk||99) : 99) < (CARDS[b.id] ? (CARDS[b.id].atk||99) : 99) ? a : b; });
      _aiDiscard(lowest.id);
      handleOpponentAction({ type: 'forceDiscard', count: 1, reason: '수문장 펭귄 ①', by: 'guest', ts: Date.now() });
      await _sleep(300);
    }
  }
  // 젊은 라이온 ②: 사자 카드 서치
  if (cardId === '젊은 라이온' && _aiCanUseEffect(cardId, 2)) {
    var tt = window.AI.opDeck.find(function(c) { return c.id.includes('사자') || (CARDS[c.id] && CARDS[c.id].theme === '라이온'); });
    if (tt) { _aiMarkUsed(cardId, 2); _aiSearchFromDeck(tt.id); await _sleep(300); }
  }
  // 젊은 타이거 ②: 타이거 몬스터 소환
  if (cardId === '젊은 타이거' && _aiCanUseEffect(cardId, 2)) {
    var tt2 = window.AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '타이거' && CARDS[c.id].cardType === 'monster'; });
    if (tt2) {
      _aiMarkUsed(cardId, 2);
      _aiLog('젊은 타이거 ②: 덱에서 소환');
      _aiSummonFromDeck(tt2.id);
      await _sleep(400);
      renderAll();
    }
  }
  // 베이비 타이거 ①: 서치 + 소환 + 제외
  if (cardId === '베이비 타이거' && _aiCanUseEffect(cardId, 1)) {
    var t1 = window.AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '타이거'; });
    var t2 = window.AI.opDeck.find(function(c) { return c.id.includes('호랑이'); });
    if (t1) { _aiMarkUsed(cardId, 1); _aiSearchFromDeck(t1.id); }
    if (t2) _aiSearchFromDeck(t2.id);
    // 자신 제외
    var bi = G.opField.findIndex(function(c) { return c.id === '베이비 타이거'; });
    if (bi >= 0) { G.opExile.push(G.opField.splice(bi, 1)[0]); }
    // 제외 효과 ②: 상대 패 1장 버리기
    handleOpponentAction({ type: 'forceDiscard', count: 1, reason: '베이비 타이거 ②', by: 'guest', ts: Date.now() });
    await _sleep(400);
    renderAll();
  }
  // 그레이트 올드 원-크툴루 ①: 소환 시 르뤼에 필드 세팅
  if (cardId === '그레이트 올드 원-크툴루' && _aiCanUseEffect(cardId, 1)) {
    if (!G.opFieldCard) {
      _aiMarkUsed(cardId, 1);
      var rlyeh = window.AI.opDeck.find(function(c) { return c.id === '태평양 속 르뤼에'; });
      if (rlyeh) {
        var ri = window.AI.opDeck.findIndex(function(c) { return c.id === '태평양 속 르뤼에'; });
        window.AI.opDeck.splice(ri, 1);
        G.opFieldCard = { id: '태평양 속 르뤼에', name: '태평양 속 르뤼에' };
        handleOpponentAction({ type: 'fieldCard', cardId: '태평양 속 르뤼에', by: 'guest', ts: Date.now() });
        _aiLog('르뤼에 필드 발동!');
        G.opDeckCount = window.AI.opDeck.length;
        await _sleep(300);
        renderAll();
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// AI 마법/함정 발동 처리
// ─────────────────────────────────────────────────────────────
async function _handleAIActivate(cardId) {
  var card = CARDS[cardId];
  if (!card) return;

  if (cardId === '펭귄!돌격!') {
    var t = window.AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '펭귄' && CARDS[c.id].cardType === 'monster' && (CARDS[c.id].atk || 0) >= 3; });
    if (!t) t = window.AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '펭귄' && CARDS[c.id].cardType === 'monster'; });
    if (t) {
      _aiDiscard(cardId);
      _aiSummonFromDeck(t.id);
      _aiLog('펭귄!돌격! ①: ' + (CARDS[t.id] ? CARDS[t.id].name : t.id) + ' 소환');
    }
  } else if (cardId === '올드_원의 멸망') {
    var exile = window.AI.opDeck.find(function(c) { return c.id.includes('엘더 갓'); });
    var target = window.AI.opDeck.find(function(c) { return c.id.includes('그레이트 올드 원'); });
    if (exile && target) {
      _aiDiscard(cardId);
      var ei = window.AI.opDeck.findIndex(function(c) { return c.id === exile.id; });
      if (ei >= 0) { window.AI.opDeck.splice(ei, 1); G.opExile.push(exile); }
      _aiSummonFromDeck(target.id);
      _aiLog('올드_원의 멸망: ' + (CARDS[target.id] ? CARDS[target.id].name : target.id) + ' 소환');
    }
  } else if (cardId === '사자의 포효') {
    // 덱에서 라이온 몬스터 묘지로
    var t2 = window.AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '라이온' && CARDS[c.id].cardType === 'monster' && (CARDS[c.id].atk || 0) >= 4; });
    if (t2) {
      _aiDiscard(cardId);
      var ti = window.AI.opDeck.findIndex(function(c) { return c.id === t2.id; });
      if (ti >= 0) { window.AI.opDeck.splice(ti, 1); G.opGrave.push(t2); }
      G.opDeckCount = window.AI.opDeck.length;
      _aiLog('사자의 포효: ' + t2.name + ' 묘지로');
    }
  } else if (cardId === '호랑이의 포효') {
    // 덱에서 타이거 묘지로
    var t3 = window.AI.opDeck.find(function(c) { return CARDS[c.id] && CARDS[c.id].theme === '타이거' && CARDS[c.id].cardType === 'monster'; });
    if (t3) {
      _aiDiscard(cardId);
      var ti2 = window.AI.opDeck.findIndex(function(c) { return c.id === t3.id; });
      if (ti2 >= 0) { window.AI.opDeck.splice(ti2, 1); G.opGrave.push(t3); }
      G.opDeckCount = window.AI.opDeck.length;
      _aiLog('호랑이의 포효: ' + t3.name + ' 묘지로');
    }
  } else {
    // 그 외 일반/마법: 발동 처리 (버리기)
    _aiDiscard(cardId);
    _aiLog(card.name + ' 발동');
  }
}

// ─────────────────────────────────────────────────────────────
// AI 턴 종료
// ─────────────────────────────────────────────────────────────
function _aiEndTurn() {
  if (isMyTurn) { window.AI.thinking = false; return; }

  if (typeof resetTurnEffects === 'function') resetTurnEffects();
  _aiResetTurnEffects();

  G.turn++;
  isMyTurn = true;
  if (typeof attackedMonstersThisTurn !== 'undefined') attackedMonstersThisTurn.clear();
  advancePhase('draw');

  _aiLog('턴 종료 — 플레이어 턴');
  _updateBanner('');
  window.AI.thinking = false;

  renderAll();
  notify('🎮 당신의 턴! 드로우 버튼을 눌러주세요.');
}

// ─────────────────────────────────────────────────────────────
// 승패 체크 훅
// ─────────────────────────────────────────────────────────────
(function() {
  var _orig = window.checkWinCondition;
  window.checkWinCondition = function() {
    if (typeof _orig === 'function') _orig.apply(this, arguments);
    if (!window.AI.active) return;
    if (G.opHand.length === 0 && !isMyTurn) {
      setTimeout(function() { showGameOver(true); }, 300);
    }
  };
})();

// ─────────────────────────────────────────────────────────────
// AI 상태 배너
// ─────────────────────────────────────────────────────────────
function _injectAIBanner() {
  if (document.getElementById('_aiBanner')) return;
  var el = document.createElement('div');
  el.id = '_aiBanner';
  el.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#12003a,#2a007a,#12003a);color:#c8a96e;padding:.35rem 1.6rem;border:1px solid #7c5cbf;border-top:none;border-radius:0 0 10px 10px;font-family:Black Han Sans,sans-serif;font-size:.8rem;letter-spacing:.1em;z-index:3000;box-shadow:0 4px 20px #7c5cbf55;pointer-events:none;transition:opacity .25s;opacity:0;';
  document.body.appendChild(el);
}

function _updateBanner(msg) {
  var el = document.getElementById('_aiBanner');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = msg ? '1' : '0';
}

// ─────────────────────────────────────────────────────────────
// 로비에 AI 대전 카드 추가
// ─────────────────────────────────────────────────────────────
function _patchLobby() {
  var lobby = document.getElementById('lobby');
  if (!lobby || document.getElementById('_aiLobbyCard')) return;

  var card = document.createElement('div');
  card.id = '_aiLobbyCard';
  card.className = 'lobby-card';
  card.style.borderColor = '#7c5cbf';
  card.style.background = 'linear-gradient(160deg,#0e0e1f 0%,#1a0a35 100%)';
  card.innerHTML =
    '<h2 style="color:#9c7cdf;display:flex;align-items:center;gap:.5rem">' +
      '<span style="font-size:1.2rem">🤖</span> AI 대전 ' +
      '<span style="font-size:.65rem;color:#7c5cbf;border:1px solid #7c5cbf;padding:.1rem .4rem;border-radius:3px;letter-spacing:.06em">Claude AI</span>' +
    '</h2>' +
    '<p style="font-size:.82rem;color:#9090b0;line-height:1.65;margin:.25rem 0 .8rem">' +
      'Claude AI가 카드 효과를 분석하고 전략적으로 플레이합니다.<br>' +
      '내 덱을 구성하면 AI가 카운터 덱으로 상대합니다.' +
    '</p>' +
    '<button id="_aiStartBtn" ' +
      'style="width:100%;padding:.8rem;background:linear-gradient(135deg,#2a0060,#5a10b0);color:#e0c8ff;border:1px solid #7c5cbf;border-radius:6px;font-family:Black Han Sans,sans-serif;font-size:1rem;letter-spacing:.12em;cursor:pointer;transition:all .2s;box-shadow:0 0 20px #7c5cbf33;" ' +
      'onmouseover="this.style.background=\'linear-gradient(135deg,#3a0080,#7a20d0)\';this.style.boxShadow=\'0 0 30px #9c7cdf55\'" ' +
      'onmouseout="this.style.background=\'linear-gradient(135deg,#2a0060,#5a10b0)\';this.style.boxShadow=\'0 0 20px #7c5cbf33\'" ' +
      'onclick="startAIMode()"' +
    '>⚔️ AI와 대전하기</button>';

  var cards = lobby.querySelectorAll('.lobby-card');
  var last  = cards[cards.length - 1];
  if (last) last.after(card);
  else lobby.appendChild(card);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _patchLobby);
} else {
  _patchLobby();
}
setTimeout(_patchLobby, 500);
setTimeout(_patchLobby, 1500);
