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
  keyDeck:   [],
  turnToken: 0,
  chain:     { handling: false },
  pendingChainTimers: [],
  usedFx:    {},
  // 게임 기록: 상대 패턴 파악에 활용
  gameLog:   [], // [{ turn, actor, action, detail }]
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
  window.AI.keyDeck   = [];
  window.AI.gameLog   = [];
  (window.AI.pendingChainTimers || []).forEach(clearTimeout);
  window.AI.pendingChainTimers = [];
}

/** 게임 로그에 행동 기록 */
function _logAction(actor, action, detail) {
  window.AI.gameLog.push({ turn: G.turn, actor: actor, action: action, detail: detail });
  // 최근 20개만 유지 (토큰 절약)
  if (window.AI.gameLog.length > 20) window.AI.gameLog.shift();
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
  var keyBase = [];
  if (source) {
    if (source.main) base = base.concat(source.main);
    if (source.key)  keyBase = keyBase.concat(source.key);
  }
  base = base.filter(function(id) { return !!CARDS[id] && !CARDS[id].isKeyCard; });
  keyBase = keyBase.filter(function(id) { return !!CARDS[id] && CARDS[id].isKeyCard; });

  if (!base.length) {
    base = Object.keys(CARDS).filter(function(id) {
      var th = CARDS[id] && CARDS[id].theme;
      return th === '크툴루' || th === '올드 원' || th === '올드원';
    });
    pickedTheme = '올드원';
  }

  window.AI.deckTheme = pickedTheme;
  window.AI.keyDeck = keyBase.map(function(id) { return { id: id, name: CARDS[id].name }; });
  var pads = ['구사일생','눈에는 눈','출입통제'].filter(function(id) { return !!CARDS[id] && !CARDS[id].isKeyCard; });
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

  // G.opField에 직접 추가 (localApplied:true → handleOpponentAction 중복 추가 방지)
  G.opField.push({ id: cardId, name: cd.name, atk: cd.atk || 0, atkBase: cd.atk || 0, summonedFrom: 'hand' });
  log('🤖 소환: ' + cd.name + (cd.atk !== undefined ? ' (ATK ' + cd.atk + ')' : ''), 'opponent');
  _emit({ type: 'summon', cardId: cardId, localApplied: true });

  // 소환 유발 효과 트리거 — AI 컨텍스트로 전역 교체 후 onSummoned 실행
  var th = cd.theme;
  if (th && window.THEME_EFFECT_HANDLERS && window.THEME_EFFECT_HANDLERS[th]) {
    var handler = window.THEME_EFFECT_HANDLERS[th];
    if (typeof handler.onSummoned === 'function') {
      var prevRole = myRole, prevTurn = isMyTurn;
      var s = { hand: G.myHand, field: G.myField, grave: G.myGrave, exile: G.myExile,
                opHand: G.opHand, opField: G.opField, opGrave: G.opGrave, opExile: G.opExile };
      myRole = window.AI.role; isMyTurn = true;
      G.myHand = s.opHand; G.myField = s.opField; G.myGrave = s.opGrave; G.myExile = s.opExile;
      G.opHand = s.hand;   G.opField = s.field;   G.opGrave = s.grave;   G.opExile = s.exile;
      try { handler.onSummoned(cardId); }
      finally {
        myRole = prevRole; isMyTurn = prevTurn;
        G.myHand = s.hand;   G.myField = s.field;   G.myGrave = s.grave;   G.myExile = s.exile;
        G.opHand = s.opHand; G.opField = s.opField; G.opGrave = s.opGrave; G.opExile = s.opExile;
      }
    }
  }

  renderAll();
  return true;
}

function _discardOppHand(n, reason) {
  for (var i = 0; i < n && G.opHand.length; i++) {
    var idx = Math.floor(Math.random() * G.opHand.length);
    var c = G.opHand.splice(idx, 1)[0];
    G.opGrave.push({ id: c.id, name: c.name });
    log('🤖 버림: ' + c.name + (reason ? ' (' + reason + ')' : ''), 'opponent');
  }
  // AI 손패 0장 → 플레이어 승리
  if (!window.AI.gameOver && G.opHand.length === 0) {
    window.AI.gameOver = true;
    log('🤖 AI 손패 0장!', 'system');
    setTimeout(function() { showGameOver(true); }, 200);
  }
}

// ─── 게임 상태 요약 ─────────────────────────────────────────

function _parseEffectNums(effectsText) {
  if (!effectsText) return [];
  var result = [];
  var bullets = ["①","②","③","④","⑤"];
  for (var i = 0; i < bullets.length; i++) {
    var idx = effectsText.indexOf(bullets[i]);
    if (idx < 0) continue;
    var nextIdx = effectsText.length;
    for (var j = i + 1; j < bullets.length; j++) {
      var ni = effectsText.indexOf(bullets[j]);
      if (ni > idx && ni < nextIdx) nextIdx = ni;
    }
    var text = effectsText.slice(idx + 1, nextIdx).trim();
    var parts = text.split(String.fromCharCode(10));
    result.push({ num: i + 1, summary: parts[0].trim().slice(0, 60) });
  }
  return result;
}

function _cardInfo(c) {
  var cd = CARDS[c.id] || {};
  return {
    id:       c.id,
    name:     c.name,
    cardType: cd.cardType || 'unknown',
    atk:      cd.atk,
    theme:    cd.theme,
    // 효과 텍스트 대신 번호별 요약 — 잘린 텍스트보다 구조화된 정보가 유리
    effectNums: _parseEffectNums(cd.effects),
  };
}

function _buildGameContext() {
  // 플레이어 공개 손패 (isPublic=true인 카드만 — 상대가 볼 수 있는 정보)
  var playerPublicHand = G.myHand
    .filter(function(c) { return c.isPublic; })
    .map(_cardInfo);

  return {
    turn:       G.turn,
    phase:      currentPhase,
    aiGoesFirst: (window.AI.role === 'host'), // AI가 선공인지

    // ── AI (자신) ──────────────────────────────────────────
    ai: {
      role:       window.AI.role,
      hand:       G.opHand.map(_cardInfo),         // 손패 전체 (자신의 정보이므로 전부 공개)
      field:      G.opField.map(function(c) {
        var cd = CARDS[c.id] || {};
        return { id: c.id, name: c.name, atk: c.atk, effectNums: _parseEffectNums(cd.effects) };
      }),
      grave:      G.opGrave.map(function(c) { return { id: c.id, name: c.name }; }),
      exile:      G.opExile.map(function(c) { return { id: c.id, name: c.name }; }),
      fieldCard:  G.opFieldCard ? { id: G.opFieldCard.id, name: G.opFieldCard.name } : null,
      keyDeck:    (G.opKeyDeck || []).map(function(c) { return { id: c.id, name: c.name }; }),
      deckCount:  window.AI.opDeck.length,
      fieldSlots: 5 + (G.opExtraSlots || 0),
    },

    // ── 게임 상황 요약 (Groq가 빠르게 파악하도록) ──────────
    summary: {
      aiHandCount:     G.opHand.length,
      aiFieldCount:    G.opField.length,
      aiTotalAtk:      G.opField.reduce(function(s,c){ return s + (c.atk||0); }, 0),
      playerHandCount: G.myHand.length,
      playerFieldCount:G.myField.length,
      playerTotalAtk:  G.myField.reduce(function(s,c){ return s + (c.atk||0); }, 0),
      handDiff:        G.opHand.length - G.myHand.length, // 양수면 AI가 패 많음
      deckLeft:        window.AI.opDeck.length,
    },

    // ── 최근 게임 기록 (상대 패턴 파악용) ─────────────────
    recentLog: window.AI.gameLog.slice(-10), // 최근 10개 행동

    // ── 플레이어 (상대) — 공개 정보만 ──────────────────────
    player: {
      role:            myRole,
      handCount:       G.myHand.length,           // 패 수는 항상 공개
      publicHand:      playerPublicHand,           // 공개된 패 (효과로 공개된 카드 등)
      field:           G.myField.map(function(c) {
        var cd = CARDS[c.id] || {};
        return { id: c.id, name: c.name, atk: c.atk, effectNums: _parseEffectNums(cd.effects) };
      }),
      grave:           G.myGrave.map(function(c) { return { id: c.id, name: c.name }; }),
      exile:           G.myExile.map(function(c) { return { id: c.id, name: c.name }; }),
      fieldCard:       G.myFieldCard ? { id: G.myFieldCard.id, name: G.myFieldCard.name } : null,
      deckCount:       G.myDeck ? G.myDeck.length : 0,
    },
  };
}

// ─── Groq Worker ────────────────────────────────────────────

// ─── 로컬 유효 행동 계산 ──────────────────────────────────────
// Groq에게 규칙 판단을 맡기지 않는다.
// 로컬에서 유효한 행동 목록을 먼저 계산 → Groq는 그 중에서만 고른다.

/** 소환 가능한 몬스터 목록 (슬롯·cardType 조건 로컬 검증) */
function _isNewEngineCardId(cardId) {
  try {
    if (window.HB_LEGACY_BRIDGE && typeof window.HB_LEGACY_BRIDGE.isNewEngineCard === 'function') {
      return !!window.HB_LEGACY_BRIDGE.isNewEngineCard(cardId);
    }
    if (window.HB_EFFECT_UI && typeof window.HB_EFFECT_UI.hasRegisteredEffects === 'function') {
      return !!window.HB_EFFECT_UI.hasRegisteredEffects(cardId);
    }
  } catch (_) {}
  return false;
}

function _validSummons() {
  var slotsLeft = (5 + (G.opExtraSlots || 0)) - G.opField.length;
  if (slotsLeft <= 0) return [];
  return G.opHand
    .map(function(c, i) { return { idx: i, id: c.id, cd: CARDS[c.id] || {} }; })
    // 신엔진 등록 카드의 소환/발동은 EffectDefinition으로만 판단한다.
    // 여기서는 아직 이식되지 않은 레거시 일반 몬스터만 최후 폴백으로 직접 소환한다.
    .filter(function(x) { return x.cd.cardType === 'monster' && !_isNewEngineCardId(x.id); })
    .slice(0, slotsLeft) // 슬롯 초과 소환 방지
    .map(function(x) { return { action: 'summonFromHand', cardId: x.id, atk: x.cd.atk || 0 }; });
}

/** 가능한 공격 목록 (필드에 있는 카드만, 존재 확인) */
function _validAttacks() {
  var attacks = [];
  var isFirstTurn = (G.turn === 1 && window.AI.role === 'host');
  if (isFirstTurn) return [];

  G.opField.forEach(function(mon) {
    if (G.myField.length === 0) {
      attacks.push({ action: 'directAttack', attackerId: mon.id, atkVal: mon.atk || 0 });
    } else {
      G.myField.forEach(function(def, di) {
        attacks.push({ action: 'attack', attackerId: mon.id, targetIdx: di,
          atkVal: mon.atk || 0, defVal: def.atk || 0, net: (mon.atk||0) - (def.atk||0) });
      });
    }
  });
  return attacks;
}

/** Groq 없이 로컬 로직만으로 소환 계획 (ATK 높은 순) */
function _bestDeployPlan() {
  return _validSummons().sort(function(a,b){ return b.atk - a.atk; });
}


// ─── EffectDefinition 기반 AI 행동 계산 ─────────────────────
// AI도 플레이어와 같은 신엔진을 사용한다. 직접 G.opField.push로 "막 소환"하지 않고,
// getAvailableEffects → activateEffect → 체인/절차/유발 처리 경로를 탄다.

function _engineReady() {
  return !!(window.HB_EFFECT_UI && typeof window.HB_EFFECT_UI.getAvailableEffects === 'function'
    && window.HB_CHAIN_ENGINE && typeof window.HB_CHAIN_ENGINE.activateEffect === 'function'
    && window.HB_ZONE_ACCESS);
}

function _aiController() { return 'opponent'; }
function _playerController() { return 'me'; }

function _aiZoneArray(zone) {
  if (window.HB_ZONE_ACCESS && typeof window.HB_ZONE_ACCESS.getZoneArray === 'function') {
    try { return window.HB_ZONE_ACCESS.getZoneArray(G, _aiController(), zone); } catch (_) {}
  }
  if (zone === 'hand') return G.opHand || [];
  if (zone === 'field') return G.opField || [];
  if (zone === 'grave') return G.opGrave || [];
  if (zone === 'exile') return G.opExile || [];
  if (zone === 'keyDeck') return G.opKeyDeck || [];
  if (zone === 'fieldZone') return G.opFieldCard ? [G.opFieldCard] : [];
  return [];
}

function _lastOpponentChainLinkForAI() {
  try {
    var links = window.HB_CHAIN_ENGINE && window.HB_CHAIN_ENGINE.getChainLinks
      ? window.HB_CHAIN_ENGINE.getChainLinks()
      : [];
    for (var i = links.length - 1; i >= 0; i--) {
      if (links[i] && links[i].controller !== _aiController()) return links[i];
    }
  } catch (_) {}
  if (activeChainState && activeChainState.links) {
    for (var j = activeChainState.links.length - 1; j >= 0; j--) {
      var l = activeChainState.links[j];
      if (l && l.by !== window.AI.role) return l;
    }
  }
  return null;
}

function _effectType(effect) { return effect && String(effect.type || ''); }
function _effectTags(effect) { return (effect && Array.isArray(effect.tags)) ? effect.tags : []; }
function _hasTag(effect, tag) { return _effectTags(effect).indexOf(tag) !== -1; }
function _hasAnyTag(effect, list) { return list.some(function(t) { return _hasTag(effect, t); }); }

function _scoreAIEngineEntry(entry, mode) {
  var effect = entry.effect || {};
  var score = 10;
  var tags = _effectTags(effect);
  var text = String(effect.text || '');

  if (mode === 'chain') {
    if (_hasTag(effect, 'negateEffect') || /무효/.test(text)) score += 120;
    if (/변형|바꾼다|적용한다/.test(text)) score += 95;
    if (_hasAnyTag(effect, ['keyDeckSummon', 'deckSummon', 'handSummon', 'graveSummon', 'exileSummon'])) score += 70;
  } else {
    if (effect.summonProcedure || (effect.meta && effect.meta.summonProcedure)) score += 85;
    if (_hasAnyTag(effect, ['keyDeckSummon', 'deckSummon', 'graveSummon', 'exileSummon'])) score += 80;
    if (_hasTag(effect, 'handSummon')) score += 65;
    if (_hasTag(effect, 'deckSearch')) score += 60;
    if (_hasTag(effect, 'draw') || /드로우/.test(text)) score += 55;
  }

  if (/상대.*묘지|상대.*제외|상대.*무효|상대 필드/.test(text)) score += 45;
  if (/패를.*버린다/.test(text) && !/상대/.test(text)) score -= 12;
  if (tags.indexOf('costDiscard') !== -1 || tags.indexOf('costBanish') !== -1) score -= 8;

  // 필드 슬롯이 부족하면 소환 계열 우선도를 낮춘다.
  if ((G.opField || []).length >= (5 + (G.opExtraSlots || 0))
      && _hasAnyTag(effect, ['keyDeckSummon', 'deckSummon', 'handSummon', 'graveSummon', 'exileSummon'])) {
    score -= 120;
  }
  return score;
}

function _collectAIEngineActions(mode) {
  if (!_engineReady()) return [];
  var actions = [];
  var zones = ['hand', 'field', 'grave', 'exile', 'keyDeck', 'fieldZone'];
  var chainLink = mode === 'chain' ? _lastOpponentChainLinkForAI() : null;

  zones.forEach(function(zone) {
    var cards = _aiZoneArray(zone);
    cards.forEach(function(card, index) {
      if (!card || !card.id || !_isNewEngineCardId(card.id)) return;
      var query = {
        gameState: G,
        player: _aiController(),
        controller: _aiController(),
        card: CARDS[card.id] || card,
        cardId: card.id,
        zone: zone,
        sourceZone: zone,
        sourceIndex: zone === 'fieldZone' ? null : index,
        chainLink: chainLink,
        activationData: { source: 'ai-engine' },
      };
      var entries = [];
      try { entries = window.HB_EFFECT_UI.getAvailableEffects(query) || []; }
      catch (err) { console.warn('[AI] 신엔진 효과 후보 수집 실패:', card.id, err); }

      entries.forEach(function(entry) {
        if (!entry || !entry.effect) return;
        var t = _effectType(entry.effect);
        if (mode === 'chain' && t !== 'quick') return;
        if (mode !== 'chain' && activeChainState && activeChainState.active) return;
        var score = _scoreAIEngineEntry(entry, mode);
        if (score <= 0) return;
        actions.push({
          entry: entry,
          cardId: card.id,
          cardName: card.name || (CARDS[card.id] && CARDS[card.id].name) || card.id,
          zone: zone,
          sourceIndex: query.sourceIndex,
          score: score,
          label: entry.label || (entry.effect && entry.effect.text) || card.id,
        });
      });
    });
  });

  actions.sort(function(a, b) { return b.score - a.score; });
  return actions;
}

function _activateAIEngineAction(action) {
  if (!action || !action.entry || !window.HB_EFFECT_UI) return false;
  var opts = {
    gameState: G,
    player: _aiController(),
    controller: _aiController(),
    card: action.entry.card || CARDS[action.cardId] || { id: action.cardId, name: action.cardName },
    cardId: action.cardId,
    zone: action.zone,
    sourceZone: action.zone,
    sourceIndex: action.sourceIndex,
    chainLink: _lastOpponentChainLinkForAI(),
    activationData: { source: 'ai-engine', ai: true },
    autoResolve: false,
    resolveImmediately: false,
  };

  try {
    var result = window.HB_EFFECT_UI.activateAvailableEffect(action.entry, opts);
    if (result && result.ok === false) {
      console.warn('[AI] 효과 발동 실패:', action.cardId, result.error || result);
      return false;
    }
    log('🤖 효과 발동: ' + action.cardName + ' — ' + String(action.label).replace(/\s+/g, ' ').slice(0, 50), 'opponent');
    _logAction('ai', 'effect', action.cardId + ':' + (action.entry.effect && action.entry.effect.effectNo));
    return true;
  } catch (err) {
    console.warn('[AI] 효과 발동 오류:', action.cardId, err);
    return false;
  }
}

function _activeHbChain() {
  return !!(window.HB_CHAIN_ENGINE && window.HB_CHAIN_ENGINE.hasActiveChain && window.HB_CHAIN_ENGINE.hasActiveChain());
}

async function _waitForChainToFinish(token, maxMs) {
  var start = Date.now();
  while (window.AI.active && token === window.AI.turnToken && activeChainState && activeChainState.active) {
    if (Date.now() - start > (maxMs || 30000)) {
      notify('AI 체인 응답 대기 중입니다. 패스 버튼을 눌러 진행할 수 있습니다.');
      return false;
    }
    await _sleep(150);
  }
  return true;
}

// 공통 시스템 프롬프트
var _SYSTEM_PROMPT = [
  '너는 카드게임 AI다. JSON만 응답해라.',
  '목표: 상대 손패(playerHandCount)를 0으로 만들면 승리.',
  '전투: net>0 → 유리(상대 카드 묘지+패 손실). net<0 → 불리(내 카드 묘지+패 손실) → 절대 하지 마라.',
  'net==0이고 atk>0 → 양쪽 묘지(내 필드 줄어듦, 신중히).',
  '카드 effectNums를 읽고 소환/묘지/회수 효과를 전략에 반영해라.',
  'player.field의 effectNums를 읽고 위협 카드를 우선 제거해라.',
  'recentLog로 상대 패턴을 파악해라.',
  'handDiff>0이면 공격적으로, <0이면 수비 우선.',
].join(' ');

/**
 * [Deploy] 다음 소환 1장을 결정한다.
 * 행동마다 현재 상황을 반영해 재질문.
 * 반환: { action: "summon", index: number } | { action: "stop" }
 */
async function _groqNextSummon(options) {
  if (!_WORKER_URL || !options.length) return { action: 'stop' };
  try {
    var resp = await fetch(_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 80,
        messages: [
          { role: 'system', content: _SYSTEM_PROMPT
            + ' 지금 소환 페이즈. 다음 행동을 하나만 결정해라.'
            + ' {"action":"summon","index":숫자} 또는 {"action":"stop"}(이번 턴 소환 그만).' },
          { role: 'user', content: JSON.stringify({
            game:    _buildGameContext(),
            options: options.map(function(o, i) {
              var cd = CARDS[o.cardId] || {};
              return { index: i, cardId: o.cardId, name: cd.name, atk: o.atk,
                effectNums: _parseEffectNums(cd.effects) };
            }),
          })},
        ],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) return { action: 'stop' };
    var data = await resp.json();
    var txt = data.content || data.response
      || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    var m = String(txt).match(/\{[\s\S]*\}/);
    var p = JSON.parse(m ? m[0] : '{}');
    if (p.action === 'summon' && Number.isInteger(p.index) && options[p.index]) return p;
    return { action: 'stop' };
  } catch(_) { return { action: 'stop' }; }
}

/**
 * [Attack] 다음 공격 1번을 결정한다.
 * 행동마다 현재 상황을 반영해 재질문.
 * 반환: { action: "attack"|"directAttack"|"stop", index: number }
 */
async function _groqNextAttack(options) {
  if (!_WORKER_URL || !options.length) return { action: 'stop' };
  try {
    var resp = await fetch(_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 80,
        messages: [
          { role: 'system', content: _SYSTEM_PROMPT
            + ' 지금 공격 페이즈. 다음 공격을 하나만 결정해라.'
            + ' {"action":"attack","index":숫자} 또는 {"action":"stop"}(공격 그만).'
            + ' net<0인 공격은 절대 고르지 마라.' },
          { role: 'user', content: JSON.stringify({
            game:    _buildGameContext(),
            options: options.map(function(o, i) {
              var atkCd = CARDS[o.attackerId] || {};
              var defCd = o.targetIdx !== undefined
                ? (CARDS[(G.myField[o.targetIdx] || {}).id] || {}) : {};
              return {
                index: i,
                action: o.action,
                attackerName: atkCd.name || o.attackerId,
                attackerAtk:  o.atkVal,
                targetName:   defCd.name,
                targetAtk:    o.defVal,
                net:          o.net,
              };
            }),
          })},
        ],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) return { action: 'stop' };
    var data = await resp.json();
    var txt = data.content || data.response
      || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    var m = String(txt).match(/\{[\s\S]*\}/);
    var p = JSON.parse(m ? m[0] : '{}');
    if (p.action === 'attack' && Number.isInteger(p.index) && options[p.index]) return p;
    return { action: 'stop' };
  } catch(_) { return { action: 'stop' }; }
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
          { role: 'system', content: '너는 카드게임 AI다. 체인 응답 판단. JSON만 응답. '
            + '체인 links에서 상대(by!=ai.role)가 유리한 효과를 발동했고 options에 대응 카드 있으면 activate. '
            + '내가 손해 볼 상황이 아니면 pass (패 아끼기). '
            + '상대 publicHand·grave·field를 고려해 판단해라. '
            + '{"action":"pass"} 또는 {"action":"activate","index":숫자}' },
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
  if (activeChainState && activeChainState.hbEngine && window.HB_CHAIN_ENGINE
      && typeof window.HB_CHAIN_ENGINE.passChainResponse === 'function') {
    window.HB_CHAIN_ENGINE.passChainResponse(_aiController());
    return;
  }
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

    var engineOptions = _collectAIEngineActions('chain');
    var legacyOptions = [];
    var aiCtx = {
      role: window.AI.role, hand: G.opHand, field: G.opField,
      grave: G.opGrave, exile: G.opExile, keyDeck: G.opKeyDeck||[],
      usedFx: window.AI.usedFx, isMyTurn: false,
    };
    if (typeof collectChainOptions === 'function') legacyOptions = collectChainOptions(aiCtx) || [];
    var options = engineOptions.concat(legacyOptions);

    if (!options.length) { _aiPassChain(); return; }

    var decision = { action: 'pass' };
    try { decision = await _groqChainDecision(activeChainState, options); } catch(_) {}

    if (decision.action === 'activate') {
      var pick = options[decision.index];
      if (pick && pick.entry) { if (_activateAIEngineAction(pick)) return; }
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

    // ── Deploy 페이즈 진입 ──
    _emit({ type: 'phaseChange', phase: 'deploy' });
    await _sleep(300);

    // ── Deploy: EffectDefinition 효과를 우선 사용 ──
    var deployedCount = 0;
    var effectActionCount = 0;
    var MAX_ACTIONS = 6; // 무한루프 방지
    while (effectActionCount < MAX_ACTIONS) {
      if (token !== window.AI.turnToken) return;
      if (activeChainState && activeChainState.active) {
        await _waitForChainToFinish(token, 30000);
        if (activeChainState && activeChainState.active) return;
      }

      var engineActions = _collectAIEngineActions('deploy');
      if (!engineActions.length) break;

      var pickedAction = engineActions[0];
      if (!_activateAIEngineAction(pickedAction)) break;
      effectActionCount++;
      if (_hasAnyTag(pickedAction.entry.effect, ['handSummon','deckSummon','keyDeckSummon','graveSummon','exileSummon'])
          || pickedAction.entry.effect.summonProcedure) deployedCount++;

      if (activeChainState && activeChainState.active) {
        await _waitForChainToFinish(token, 30000);
        if (activeChainState && activeChainState.active) return;
      }
      await _sleep(300);
    }

    // 폴백: 신엔진에 아직 이식되지 않은 레거시 몬스터만 직접 소환
    if (deployedCount === 0 && effectActionCount === 0) {
      var summonOptions = _validSummons();
      while (summonOptions.length && deployedCount < 5) {
        if (token !== window.AI.turnToken) return;
        var summonDecision = await _groqNextSummon(summonOptions);
        if (summonDecision.action === 'stop') break;
        var chosen = summonOptions[summonDecision.index];
        if (!chosen) break;
        _summonFromOppHand(chosen.cardId);
        _logAction('ai', 'summon', chosen.cardId);
        deployedCount++;
        await _sleep(300);
        summonOptions = _validSummons();
      }
    }

    // ── Attack 페이즈 (선공 1턴 제외) ──
    if (!(G.turn === 1 && window.AI.role === 'host')) {
      _emit({ type: 'phaseChange', phase: 'attack' });
      await _sleep(300);

      // 공격 1번마다 Groq에 재질문 (전투 결과로 필드가 바뀌므로)
      var attackedIds = new Set(); // 이미 공격한 몬스터 추적
      var MAX_ATTACKS = 10;
      var attackCount = 0;
      while (attackCount < MAX_ATTACKS) {
        if (token !== window.AI.turnToken) return;

        // 현재 필드 기준으로 공격 옵션 재계산 (전투로 카드가 묘지 갔을 수 있음)
        var attackOptions = _validAttacks().filter(function(a) {
          return !attackedIds.has(a.attackerId); // 이미 공격한 몬스터 제외
        });
        if (!attackOptions.length) break;

        // Groq에 다음 공격 1번 결정 요청
        var attackDecision = await _groqNextAttack(attackOptions);
        if (attackDecision.action === 'stop') break;

        var chosenAtk = attackOptions[attackDecision.index];
        if (!chosenAtk) break;

        if (chosenAtk.action === 'attack') {
          var att = G.opField.find(function(c) { return c.id === chosenAtk.attackerId; });
          var def = G.myField[chosenAtk.targetIdx];
          if (att && def) {
            _emit({ type: 'combat',
              atkCard: { id: att.id, name: att.name, atk: att.atk },
              defCard: { id: def.id, name: def.name, atk: def.atk },
            });
            _logAction('ai', 'attack', att.id + ' vs ' + def.id + '(net:' + (att.atk - def.atk) + ')');
            attackedIds.add(chosenAtk.attackerId);
          }
        } else if (chosenAtk.action === 'directAttack') {
          var dm = G.opField.find(function(c) { return c.id === chosenAtk.attackerId; });
          if (dm && G.myField.length === 0) {
            _emit({ type: 'directAttack', card: { id: dm.id, name: dm.name, atk: dm.atk } });
            _logAction('ai', 'directAttack', dm.id + '(atk:' + dm.atk + ')');
            attackedIds.add(chosenAtk.attackerId);
          }
        }
        attackCount++;
        await _sleep(300);
      }
      // 폴백: Groq가 아무 공격도 안 했으면 로컬 최선 공격
      if (attackCount === 0) {
        var fallbackAttacks = _bestAttackPlan().sort(function(a, b) {
          if (a.action === 'directAttack') return -1;
          if (b.action === 'directAttack') return 1;
          return (b.net || 0) - (a.net || 0);
        });
        for (var fa = 0; fa < fallbackAttacks.length; fa++) {
          if (token !== window.AI.turnToken) return;
          var fatk = fallbackAttacks[fa];
          if (fatk.action === 'attack') {
            var fatt = G.opField.find(function(c) { return c.id === fatk.attackerId; });
            var fdef = G.myField[fatk.targetIdx];
            if (fatt && fdef && !attackedIds.has(fatk.attackerId)) {
              _emit({ type: 'combat',
                atkCard: { id: fatt.id, name: fatt.name, atk: fatt.atk },
                defCard: { id: fdef.id, name: fdef.name, atk: fdef.atk },
              });
              attackedIds.add(fatk.attackerId);
            }
          } else if (fatk.action === 'directAttack') {
            var fdm = G.opField.find(function(c) { return c.id === fatk.attackerId; });
            if (fdm && G.myField.length === 0 && !attackedIds.has(fatk.attackerId)) {
              _emit({ type: 'directAttack', card: { id: fdm.id, name: fdm.name, atk: fdm.atk } });
              attackedIds.add(fatk.attackerId);
            }
          }
          await _sleep(300);
        }
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

    // 플레이어 행동을 게임 로그에 기록 (AI가 상대 패턴 파악용)
    if (window.AI && window.AI.active && action.by && action.by !== window.AI.role) {
      if (action.type === 'summon') _logAction('player', 'summon', action.cardId);
      else if (action.type === 'draw') _logAction('player', 'draw', '');
      else if (action.type === 'combat') _logAction('player', 'attack', (action.atkCard && action.atkCard.id) + ' vs ' + (action.defCard && action.defCard.id));
      else if (action.type === 'directAttack') _logAction('player', 'directAttack', action.card && action.card.id);
      else if (action.type === 'activate' || action.type === 'discard') _logAction('player', action.type, action.cardId);
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
      G.opFieldCard = null; G.opKeyDeck = (window.AI.keyDeck || []).map(function(c) { return { id: c.id, name: c.name }; });
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

  // ── 버그 2 수정: _onLocalChainStateChanged 훅 ──────────────
  // effects-chain.js의 _onLocalChainStateChanged가 호출될 때
  // AI 우선권이면 _runAIChainWindow를 트리거한다.
  // (window._aiChainResponse는 이미 정의되어 있으나
  //  effects-chain.js 코드가 직접 호출하므로 훅 불필요.
  //  단, 안전을 위해 _onLocalChainStateChanged도 래핑한다.)
  var origLocalChain = window._onLocalChainStateChanged;
  if (typeof origLocalChain === 'function') {
    window._onLocalChainStateChanged = function(data) {
      origLocalChain.apply(this, arguments);
      if (!window.AI.active) return;
      if (data && data.active && data.priority === window.AI.role) {
        setTimeout(_runAIChainWindow, 150);
      }
    };
  }

  // 신엔진 체인에서 플레이어가 패스해 AI에게 우선권이 넘어오면 자동 응답/패스한다.
  var origPassChainPriority = window.passChainPriority;
  if (typeof origPassChainPriority === 'function') {
    window.passChainPriority = function() {
      var result = origPassChainPriority.apply(this, arguments);
      if (window.AI.active && activeChainState && activeChainState.active && activeChainState.priority === window.AI.role) {
        setTimeout(_runAIChainWindow, 150);
      }
      return result;
    };
  }

  // ── 버그 3 수정: AI 패배 감지 ──────────────────────────────
  // 전투/직접공격으로 AI 손패가 0이 되면 showGameOver를 호출한다.
  // handleOpponentAction이 전투 결과로 G.opHand를 줄인 후
  // renderAll()이 호출되는 시점에 체크한다.
  var origRenderAll = window.renderAll;
  if (typeof origRenderAll === 'function') {
    window.renderAll = function() {
      origRenderAll.apply(this, arguments);
      if (!window.AI.active || window.AI.gameOver) return;
      if (G.opHand && G.opHand.length === 0 && G.opDeckCount === 0 && window.AI.opDeck.length === 0) return; // 덱아웃은 _drawOpp에서 처리
      if (G.opHand && G.opHand.length === 0 && (G.opField.length > 0 || window.AI.opDeck.length > 0)) {
        // AI 손패 0장 → 플레이어 승리
        window.AI.gameOver = true;
        setTimeout(function() { showGameOver(true); }, 100); // true = 플레이어 승리
      }
      if (G.myHand && G.myHand.length === 0 && !window.AI.gameOver) {
        // 플레이어 손패 0장 → AI 승리
        window.AI.gameOver = true;
        setTimeout(function() { showGameOver(false); }, 100); // false = 플레이어 패배(AI 승리)
      }
    };
  }

})();

window._clearAIChainTimer = function() {
  (window.AI.pendingChainTimers || []).forEach(clearTimeout);
  window.AI.pendingChainTimers = [];
};