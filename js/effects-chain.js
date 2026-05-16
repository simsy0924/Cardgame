// effects-chain.js — 체인/유발/퀵 이펙트 처리
function nextChainId() {
  window._CHAIN_SEQ = (window._CHAIN_SEQ || 0) + 1;
  return 'chain_' + String(window._CHAIN_SEQ);
}

function getOpponentRole(role) {
  return role === 'host' ? 'guest' : 'host';
}

// ─────────────────────────────────────────────────────────────
// 로컬(AI전/데모) 체인 상태 변경 핸들러
// 대인전의 listenChainState Firebase 콜백과 완전히 동일한 로직
// ─────────────────────────────────────────────────────────────
function _onLocalChainStateChanged(data) {
  const wasActive = !!(activeChainState && activeChainState.active);

  if (_isHbEngineChainState(data)) {
    _importHbEngineChainState(data);
    if (!data.active) {
      activeChainState = null;
      renderChainActions();
      if (wasActive && pendingTriggerEffects.length > 0) setTimeout(flushTriggeredEffects, 0);
      return;
    }
    activeChainState = data;
    renderChainActions();
    renderAll();
    if (data.priority === myRole) {
      notify(`체인 우선권: ${data.links?.length || 0}체인. 응답 또는 패스를 선택하세요.`);
    }
    return;
  }

  if (!data || !data.active) {
    if (activeChainState && activeChainState.active) {
      activeChainState = null;
    } else {
      activeChainState = data;
    }
  } else {
    activeChainState = data;
  }

  renderChainActions();

  if (!data) return;

  // 체인 해결 후 유발효과 처리 (대인전 listenChainState와 동일)
  if (wasActive && !data.active && pendingTriggerEffects.length > 0) {
    setTimeout(flushTriggeredEffects, 0);
  }
  if (!data.active && data.resolvedLinks && data.resolvedAt) {
    activeChainState = null;
    executeChainLocally([...data.resolvedLinks].reverse());
    renderChainActions();
    // 데모 모드면 즉시 종료
    if (!window.AI || !window.AI.active) return;
    return;
  }

  if (!data.active) return;

  renderAll();

  // 우선권 처리
  if (data.priority === myRole) {
    // 플레이어 차례: 응답 요청
    if (data.links && data.links.length > 0) {
      notify(`체인 우선권: ${data.links.length}체인. 응답 또는 패스를 선택하세요.`);
    }
  } else {
    // 상대(AI) 차례
    if (!window.AI || !window.AI.active) {
      // 데모 모드: 즉시 패스 → resolve
      resolveChain({ ...data, passCount: 2 });
      return;
    }
    // AI 모드: AI에게 응답 요청
    setTimeout(() => {
      if (!activeChainState || !activeChainState.active) return;
      if (activeChainState.priority === myRole) return; // 이미 플레이어 차례로 바뀜
      if (typeof window._aiChainResponse === 'function') {
        window._aiChainResponse(activeChainState);
      }
    }, 300);
  }
}


function beginChain(effect) {
  // 이전 체인 잔여 타이머 clear
  if (typeof _clearAIChainTimer === 'function') _clearAIChainTimer();
  if (window.AI && window.AI.pendingChainTimers) {
    window.AI.pendingChainTimers.forEach(function(id) { clearTimeout(id); });
    window.AI.pendingChainTimers = [];
  }

  const actorRole = myRole;
  const result = _activateLegacyLinkInHbChain(effect, { role: actorRole });
  if (result && result.ok === false) {
    notify(result.error || '체인을 시작할 수 없습니다.');
    return;
  }
  log(`체인 1: ${(effect && effect.label) || (effect && effect.type) || '효과'} 발동`, actorRole === myRole ? 'mine' : 'opponent');
}

// 상대가 체인을 열었을 때 사원소 ③ 자동 트리거
function _checkSaWonsoCounterOnOpponentChain() {
  if (typeof tryActivateSaWonsoJibaeryong3 === 'function') tryActivateSaWonsoJibaeryong3();
  if (typeof tryActivateSaWonsoJibaeja3    === 'function') tryActivateSaWonsoJibaeja3();
}


// ─────────────────────────────────────────────────────────────
// 체인 응답 레지스트리 — 패에서 체인에 응답 가능한 카드 등록
// 각 테마 파일에서 registerChainHandResponse()로 등록
// ─────────────────────────────────────────────────────────────
window.CHAIN_HAND_RESPONSES = window.CHAIN_HAND_RESPONSES || {};

/**
 * registerChainHandResponse(cardId, entries)
 * entries: [{ effectNum, label, condition(), activate(handIdx) }, ...]
 *
 * condition(handIdx): 현재 체인 상태/패/필드를 보고 발동 가능 여부 반환
 *   - activeChainState가 활성 중임은 collectChainOptions()가 보장
 *   - "상대 링크가 있어야 한다" 같은 추가 조건만 작성할 것
 * activate(handIdx): 실제 발동 함수 호출
 */
function registerChainHandResponse(cardId, entries) {
  window.CHAIN_HAND_RESPONSES[cardId] = entries;
}

// ─────────────────────────────────────────────────────────────
// 체인 발동자 판별 헬퍼
// ─────────────────────────────────────────────────────────────

/** 체인에 상대(myRole 기준)가 발동한 링크가 하나라도 있는가 */
function _chainHasOpponentLink() {
  if (!activeChainState || !activeChainState.active) return false;
  return (activeChainState.links || []).some(l => l.by !== myRole);
}

/** 체인에 상대가 발동한 서치계 링크가 있는가 (눈에는 눈 조건) */
function _chainHasOpponentSearchLink() {
  if (!activeChainState || !activeChainState.active) return false;
  return (activeChainState.links || []).some(l => {
    if (l.by === myRole) return false; // 내 링크 제외
    const t = String(l.type || '');
    return t === 'keyFetch' || t.includes('search') || t.includes('Search')
        || t === 'aiSearch' || t === 'themeEffect';
  });
}

/**
 * collectChainOptions()
 * 현재 패를 순회하며 체인에 응답 가능한 모든 옵션을 반환
 * returns: [{ label, cardId, handIdx, activate }]
 *
 * [수정] 체인이 활성 중이면 레지스트리 condition을 실행.
 * condition은 "상대 링크 존재" 같은 추가 조건만 담당.
 * "체인이 활성 중인가"는 여기서 일괄 체크하므로 condition에서 중복 체크 불필요.
 */
/**
 * collectChainOptions(aiCtx?)
 *
 * aiCtx가 없으면 플레이어 컨텍스트로 동작.
 * aiCtx가 있으면 전역 변수(G.myHand, G.myField 등)를 AI 데이터로 임시 교체 후
 * 동일한 레지스트리(CHAIN_HAND_RESPONSES, CHAIN_FIELD_RESPONSES)를 실행.
 * 이 방식 덕분에 카드를 아무리 추가해도 별도 AI 전용 코드가 필요 없음.
 *
 * aiCtx = {
 *   hand: G.opHand,   field: G.opField,
 *   grave: G.opGrave, exile: G.opExile,
 *   keyDeck: G.opKeyDeck,
 *   role: 'guest',
 *   usedFx: window.AI.usedFx,  // AI usedFx
 * }
 */
function _buildChainActivate(entry, idx, aiCtx) {
  if (!aiCtx) return () => entry.activate(idx);
  return () => {
    const s2 = {
      hand: G.myHand, field: G.myField,
      grave: G.myGrave, exile: G.myExile,
      keyDeck: G.myKeyDeck,
      opHand: G.opHand, opField: G.opField,
      opGrave: G.opGrave, opExile: G.opExile,
      isMyTurn_val: isMyTurn,
      myRole_val: myRole,
      addChainLink: window.addChainLink,
      markEffectUsed: window.markEffectUsed,
    };

    G.myHand = aiCtx.hand; G.myField = aiCtx.field;
    G.myGrave = aiCtx.grave; G.myExile = aiCtx.exile;
    G.myKeyDeck = aiCtx.keyDeck || [];
    G.opHand = s2.hand; G.opField = s2.field;
    G.opGrave = s2.grave; G.opExile = s2.exile;
    isMyTurn = aiCtx.isMyTurn || false;
    myRole = aiCtx.role || 'guest';

    window.addChainLink = function(effect) {
      if (!activeChainState || !activeChainState.active) return;
      const aiBy = aiCtx.role || 'guest';
      const aiOpponent = getOpponentRole(aiBy);
      const aiEffect = Object.assign({}, effect, { by: aiBy });
      const next = Object.assign({}, activeChainState);
      next.links = (next.links || []).concat([aiEffect]);
      next.passCount = 0;
      next.priority = aiOpponent;
      activeChainState = next;
      log('🤖 ' + (effect.label || effect.type) + ' 체인 발동!', 'opponent');
    };

    if (aiCtx.usedFx) {
      window.markEffectUsed = function(id, n) {
        aiCtx.usedFx[id + '_' + n] = 1;
      };
    }

    try {
      entry.activate(idx);
    } finally {
      G.myHand = s2.hand; G.myField = s2.field;
      G.myGrave = s2.grave; G.myExile = s2.exile;
      G.myKeyDeck = s2.keyDeck;
      G.opHand = s2.opHand; G.opField = s2.opField;
      G.opGrave = s2.opGrave; G.opExile = s2.opExile;
      isMyTurn = s2.isMyTurn_val;
      myRole = s2.myRole_val || 'host';
      window.addChainLink = s2.addChainLink;
      window.markEffectUsed = s2.markEffectUsed;
    }
  };
}

function collectHbEngineChainOptions(aiCtx) {
  const options = [];
  if (!activeChainState || !activeChainState.active || activeChainState.hbEngine !== true) return options;

  // HB_CHAIN_ENGINE 체인은 레거시 addChainLink와 섞이면 내부 chainState와
  // 화면 mirror/Firebase chainState가 서로 다른 링크 목록을 갖게 된다.
  // 따라서 신엔진 체인에서는 신엔진 QUICK/TRIGGER 응답만 수집한다.
  // AI 응답은 ai.js의 _collectAIEngineActions('chain')가 opponent 컨트롤러로 별도 수집한다.
  if (aiCtx) return options;

  _collectNewEngineChainOptionsForZone(options, G.myHand, 'hand', null);
  _collectNewEngineChainOptionsForZone(options, G.myField, 'field', null);
  _collectNewEngineChainOptionsForZone(options, G.myGrave, 'grave', null);
  _collectNewEngineChainOptionsForZone(options, G.myExile, 'exile', null);
  _collectNewEngineFieldZoneChainOptions(options);
  return options;
}

function collectChainOptions(aiCtx) {
  const options = [];
  if (!activeChainState || !activeChainState.active) return options;

  if (activeChainState.hbEngine === true) {
    return collectHbEngineChainOptions(aiCtx);
  }

  // ── AI 컨텍스트 스왑 ──
  // condition/activate 내부가 참조하는 전역 변수를 AI 데이터로 임시 교체.
  // 실행 후 반드시 복원.
  let _swap = null;
  if (aiCtx) {
    _swap = {
      hand:  G.myHand,  field:  G.myField,
      grave: G.myGrave, exile:  G.myExile,
      keyDeck: G.myKeyDeck,
      opHand:  G.opHand, opField: G.opField,
      opGrave: G.opGrave, opExile: G.opExile,
      isMyTurn_val: isMyTurn,
      myRole_val: myRole,
    };
    // AI 패/필드 → "내" 것처럼 교체
    G.myHand  = aiCtx.hand;
    G.myField = aiCtx.field;
    G.myGrave = aiCtx.grave;
    G.myExile = aiCtx.exile;
    G.myKeyDeck = aiCtx.keyDeck || [];
    // 플레이어 패/필드 → "상대" 것처럼 교체
    G.opHand  = _swap.hand;
    G.opField = _swap.field;
    G.opGrave = _swap.grave;
    G.opExile = _swap.exile;
    isMyTurn  = aiCtx.isMyTurn || false;
    // ★ 핵심: myRole을 AI 역할로 교체해야 _chainHasOpponentLink() 등이 올바르게 동작
    // condition 내부의 l.by !== myRole 기준이 AI 실제 역할과 일치해야
    // 플레이어 링크를 올바르게 "상대 링크"로 인식함
    myRole = aiCtx.role || 'guest';
  }

  const _restore = () => {
    if (!_swap) return;
    G.myHand  = _swap.hand;  G.myField = _swap.field;
    G.myGrave = _swap.grave; G.myExile = _swap.exile;
    G.myKeyDeck = _swap.keyDeck;
    G.opHand  = _swap.opHand; G.opField = _swap.opField;
    G.opGrave = _swap.opGrave; G.opExile = _swap.opExile;
    isMyTurn  = _swap.isMyTurn_val;
    myRole    = _swap.myRole_val;
    _swap = null;
  };

  try {
    // 1) 키카드 가져오기 (플레이어 전용 — AI는 키카드 별도 처리)
    if (!aiCtx && !usedKeyFetchInChain[myRole]) {
      const noHandFetchKeyMonsters = new Set(['카드의 흑기사', '풀려난 항아리의 마귀', '카드 세계의 영웅']);
      (G.myKeyDeck || []).forEach(c => {
        let canFetch = true;
        if (noHandFetchKeyMonsters.has(c.id)) canFetch = false;
        if (c.id === '펭귄 용사'   && G.opField.length === 0) canFetch = false;
        if (c.id === '펭귄의 전설' && G.myField.length === 0) canFetch = false;
        if (!canFetch) return;
        options.push({
          label:   `[키카드] ${c.name} 가져오기`,
          cardId:  c.id,
          handIdx: -1,
          activate() {
            addChainLink({ type: 'keyFetch', label: `키 카드 가져오기 (${c.name})`, cardId: c.id });
          },
        });
      });
    }

    // 2) 신엔진 퀵 효과 — 플레이어는 이 경로로 수집한다.
    // AI는 js/ai.js의 _collectAIEngineActions('chain')에서 opponent 컨트롤러로 별도 수집한다.
    // 여기서 aiCtx 스왑 상태의 entry를 저장하면 복원 후 controller/source가 플레이어 쪽으로 틀어질 수 있다.
    const hand = aiCtx ? aiCtx.hand : G.myHand;
    if (!aiCtx) {
      _collectNewEngineChainOptionsForZone(options, hand, 'hand', aiCtx);
      _collectNewEngineChainOptionsForZone(options, G.myField, 'field', aiCtx);
      _collectNewEngineChainOptionsForZone(options, G.myGrave, 'grave', aiCtx);
      _collectNewEngineChainOptionsForZone(options, G.myExile, 'exile', aiCtx);
      _collectNewEngineFieldZoneChainOptions(options);
    }

    // 3) 패의 카드 — 레지스트리 기반 (플레이어/AI 공용)
    hand.forEach((handCard, handIdx) => {
      // EffectDefinition으로 이식된 카드는 위 신엔진 공통 수집만 사용한다.
      if (window.HB_LEGACY_BRIDGE && typeof window.HB_LEGACY_BRIDGE.isNewEngineCard === 'function' && window.HB_LEGACY_BRIDGE.isNewEngineCard(handCard)) return;
      const entries = window.CHAIN_HAND_RESPONSES[handCard.id];
      if (!entries) return;
      entries.forEach(entry => {
        // 사용 횟수 체크 — AI는 usedFx, 플레이어는 effectUsed
        if (aiCtx) {
          const key = handCard.id + '_' + entry.effectNum;
          if (aiCtx.usedFx && aiCtx.usedFx[key]) return;
        } else {
          if (!canUseEffect(handCard.id, entry.effectNum)) return;
        }
        // condition 실행 (전역 변수가 이미 교체된 상태)
        if (entry.condition && !entry.condition(handIdx)) return;


        options.push({
          label:   `[패] ${handCard.name} ${entry.label}`,
          cardId:  handCard.id,
          handIdx,
          activate: _buildChainActivate(entry, handIdx, aiCtx),
        });
      });
    });

    // 3) 필드의 카드 — CHAIN_FIELD_RESPONSES (플레이어/AI 공용)
    const field = aiCtx ? aiCtx.field : G.myField;
    field.forEach((fieldCard, fieldIdx) => {
      // 16단계: EffectDefinition으로 이식된 카드는 레거시 필드 체인 응답을 다시 띄우지 않는다.
      if (window.HB_LEGACY_BRIDGE && typeof window.HB_LEGACY_BRIDGE.isNewEngineCard === 'function' && window.HB_LEGACY_BRIDGE.isNewEngineCard(fieldCard)) return;
      const entries = window.CHAIN_FIELD_RESPONSES && window.CHAIN_FIELD_RESPONSES[fieldCard.id];
      if (!entries) return;
      entries.forEach(entry => {
        if (aiCtx) {
          const key = fieldCard.id + '_' + entry.effectNum;
          if (aiCtx.usedFx && aiCtx.usedFx[key]) return;
        } else {
          if (!canUseEffect(fieldCard.id, entry.effectNum)) return;
        }
        if (entry.condition && !entry.condition(fieldIdx)) return;
        options.push({
          label:   `[필드] ${fieldCard.name} ${entry.label}`,
          cardId:  fieldCard.id,
          handIdx: -3,
          fieldIdx,
          activate: _buildChainActivate(entry, fieldIdx, aiCtx),
        });
      });
    });

  } finally {
    _restore();
  }

  return options;
}

// ─────────────────────────────────────────────────────────────
// 필드 카드 체인 응답 레지스트리
// "패로 가져올 수 없는" 카드들의 필드 발동 효과 등록
// registerChainFieldResponse(cardId, entries)
// entries: [{ effectNum, label, condition(fieldIdx), activate(fieldIdx) }, ...]
// ─────────────────────────────────────────────────────────────
window.CHAIN_FIELD_RESPONSES = window.CHAIN_FIELD_RESPONSES || {};

function registerChainFieldResponse(cardId, entries) {
  window.CHAIN_FIELD_RESPONSES[cardId] = entries;
}


// ─────────────────────────────────────────────────────────────
// Legacy Chain → HB_CHAIN_ENGINE adapter
// ─────────────────────────────────────────────────────────────
// 완전 이식 원칙:
//   beginChain/addChainLink/flushTriggeredEffects가 만드는 구형 링크도
//   더 이상 별도 activeChainState에서 해결하지 않는다.
//   레거시 링크를 EffectDefinition 래퍼로 감싸 HB_CHAIN_ENGINE의 단일
//   chainState, 우선권, passCount, 역순 resolve, 네트워크 publish를 탄다.
function _legacyChainEngineAvailable() {
  return !!(window.HB_CHAIN_ENGINE && window.HB_EFFECT_REGISTRY && window.HB_EFFECT_DEFINITION);
}

function _sanitizeLegacyEffectType(type) {
  return String(type || 'unknown')
    .replace(/\s+/g, '_')
    .replace(/[^0-9A-Za-z_\-가-힣]/g, '');
}

function _legacyChainEffectId(link) {
  return `legacy-chain-${_sanitizeLegacyEffectType(link && link.type)}`;
}

function _cloneLegacyLinkForEngine(effect, actorRole) {
  const link = Object.assign({}, effect || {});
  link.type = link.type || 'legacyUnknown';
  link.label = link.label || link.type;
  link.by = actorRole || link.by || myRole;
  link.legacyChain = true;
  return link;
}

function _ensureLegacyChainEffect(link) {
  if (!_legacyChainEngineAvailable()) return null;
  const id = _legacyChainEffectId(link);
  const existing = window.HB_EFFECT_REGISTRY.getEffectById(id);
  if (existing) return existing;

  const EFFECT_TYPES = (window.HB_RULES && window.HB_RULES.EFFECT_TYPES) || { QUICK: 'quick' };
  const TIMING = (window.HB_RULES && window.HB_RULES.TIMING) || { EITHER_TURN: 'eitherTurn' };
  return window.HB_EFFECT_REGISTRY.registerEffect({
    id,
    cardId: '__legacy_chain__',
    effectNo: null,
    text: `레거시 체인 링크: ${link.type}`,
    type: EFFECT_TYPES.QUICK || 'quick',
    timing: TIMING.EITHER_TURN || 'eitherTurn',
    zones: [],
    tags: ['legacyChain'],
    condition: () => true,
    canResolve: () => true,
    cost: () => ({ ok: true }),
    target: () => ({ ok: true }),
    resolve(ctx) {
      const legacyLink = ctx && ctx.chainLink && ctx.chainLink.activationData && ctx.chainLink.activationData.legacyLink;
      if (!legacyLink) return { ok: false, error: '레거시 체인 링크 정보가 없습니다.' };
      if (!window.HB_LEGACY_CHAIN_ADAPTER || typeof window.HB_LEGACY_CHAIN_ADAPTER.resolveLegacyLink !== 'function') {
        return { ok: false, error: 'HB_LEGACY_CHAIN_ADAPTER가 없습니다.' };
      }
      return window.HB_LEGACY_CHAIN_ADAPTER.resolveLegacyLink(legacyLink, ctx);
    },
  }, { replace: true });
}

function _activateLegacyLinkInHbChain(effect, options) {
  const opts = options || {};
  if (!_legacyChainEngineAvailable()) return { ok: false, error: 'HB_CHAIN_ENGINE을 사용할 수 없습니다.' };

  const actorRole = opts.role || (effect && effect.by) || myRole;
  const link = _cloneLegacyLinkForEngine(effect, actorRole);
  const wrappedEffect = _ensureLegacyChainEffect(link);
  if (!wrappedEffect) return { ok: false, error: '레거시 체인 래퍼 효과를 등록할 수 없습니다.' };

  const controller = typeof window.HB_CHAIN_ENGINE.roleToController === 'function'
    ? window.HB_CHAIN_ENGINE.roleToController(actorRole)
    : (actorRole === myRole ? 'me' : 'opponent');

  const sourceCardId = link.cardId || '__legacy_chain__';
  const sourceCardName = link.cardName || link.label || link.type;
  const result = window.HB_CHAIN_ENGINE.activateEffect({
    gameState: G,
    controller,
    player: controller,
    card: { id: sourceCardId, name: sourceCardName },
    cardId: sourceCardId,
    source: { controller, zone: 'hand', index: null },
    sourceZone: 'hand',
    sourceIndex: null,
    effect: wrappedEffect,
    activationData: {
      legacy: true,
      legacyLink: link,
      source: 'legacy-chain-adapter',
    },
    autoResolve: false,
    resolveImmediately: false,
    authority: true,
    ignorePriority: opts.force === true,
  });

  if (result && result.ok === false) return result;
  if (link.type === 'keyFetch') usedKeyFetchInChain[actorRole] = true;
  return result || { ok: true };
}

function _isHbEngineChainState(data) {
  return !!(data && data.hbEngine === true);
}

function _importHbEngineChainState(data) {
  if (!_isHbEngineChainState(data)) return false;
  if (window.HB_CHAIN_ENGINE && typeof window.HB_CHAIN_ENGINE.importChainState === 'function') {
    window.HB_CHAIN_ENGINE.importChainState(data);
  }
  return true;
}

function _activateNewEngineChainEntry(entry, opts) {
  const options = opts || {};
  if (!entry || !window.HB_EFFECT_UI || typeof window.HB_EFFECT_UI.activateAvailableEffect !== 'function') return;
  const result = window.HB_EFFECT_UI.activateAvailableEffect(entry, Object.assign({}, options, { autoResolve: false }));
  if (result && result.ok === false) notify(result.error || '효과를 발동할 수 없습니다.');
}

function _collectNewEngineChainOptionsForZone(options, cards, zone, aiCtx) {
  if (!window.HB_EFFECT_UI || typeof window.HB_EFFECT_UI.getAvailableEffects !== 'function') return;
  const list = Array.isArray(cards) ? cards : [];
  list.forEach((card, index) => {
    if (!card || !card.id) return;
    if (!window.HB_LEGACY_BRIDGE || typeof window.HB_LEGACY_BRIDGE.isNewEngineCard !== 'function' || !window.HB_LEGACY_BRIDGE.isNewEngineCard(card)) return;

    const entries = window.HB_EFFECT_UI.getAvailableEffects({
      gameState: G,
      controller: 'me',
      player: 'me',
      card,
      cardId: card.id,
      zone,
      sourceZone: zone,
      sourceIndex: index,
      skipChainCheck: !!aiCtx,
    }).filter(entry => entry && entry.effect && entry.effect.type === 'quick');

    entries.forEach(entry => {
      options.push({
        label: `[신엔진] ${card.name || card.id} ${entry.label || entry.effect.label || entry.effect.effectNo || ''}`,
        cardId: card.id,
        handIdx: zone === 'hand' ? index : -4,
        fieldIdx: zone === 'field' ? index : -1,
        zone,
        hbEntry: entry,
        activate: () => _activateNewEngineChainEntry(entry, { controller: 'me', player: 'me', ignorePriority: !!aiCtx }),
      });
    });
  });
}

function _collectNewEngineFieldZoneChainOptions(options) {
  if (!G.myFieldCard || !window.HB_EFFECT_UI || typeof window.HB_EFFECT_UI.getAvailableEffects !== 'function') return;
  if (!window.HB_LEGACY_BRIDGE || typeof window.HB_LEGACY_BRIDGE.isNewEngineCard !== 'function' || !window.HB_LEGACY_BRIDGE.isNewEngineCard(G.myFieldCard)) return;
  const entries = window.HB_EFFECT_UI.getAvailableEffects({
    gameState: G,
    controller: 'me',
    player: 'me',
    card: G.myFieldCard,
    cardId: G.myFieldCard.id,
    zone: 'fieldZone',
    sourceZone: 'fieldZone',
    sourceIndex: null,
  }).filter(entry => entry && entry.effect && entry.effect.type === 'quick');

  entries.forEach(entry => {
    options.push({
      label: `[신엔진/필드존] ${G.myFieldCard.name || G.myFieldCard.id} ${entry.label || ''}`,
      cardId: G.myFieldCard.id,
      handIdx: -5,
      fieldIdx: -1,
      zone: 'fieldZone',
      hbEntry: entry,
      activate: () => _activateNewEngineChainEntry(entry, { controller: 'me', player: 'me', ignorePriority: false }),
    });
  });
}

function openChainResponse() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;

  const options = collectChainOptions();

  if (options.length === 0) {
    notify('응답 가능한 카드가 없습니다. 패스하세요.');
    return;
  }

  // 선택지가 1개면 바로 발동 확인
  if (options.length === 1) {
    gameConfirm(`체인 응답: ${options[0].label}\n발동하시겠습니까?`, (yes) => {
      if (yes) options[0].activate();
    });
    return;
  }

  // 여러 선택지 — 카드 픽커로 표시
  const displayList = options.map(o => ({ id: o.cardId, name: o.label }));
  openCardPicker(displayList, '체인 응답 — 발동할 효과를 선택하세요', 1, (sel) => {
    if (!sel || sel.length === 0) return;
    options[sel[0]].activate();
  });
}

function passChainPriority() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;

  if (!window.HB_CHAIN_ENGINE || typeof window.HB_CHAIN_ENGINE.passChainResponse !== 'function') {
    notify('체인 엔진을 사용할 수 없습니다.');
    return;
  }

  const controller = (typeof window.HB_CHAIN_ENGINE.roleToController === 'function')
    ? window.HB_CHAIN_ENGINE.roleToController(myRole)
    : 'me';
  const result = window.HB_CHAIN_ENGINE.passChainResponse(controller);
  if (result && result.ok === false) notify(result.error || '체인 패스에 실패했습니다.');

  const hbState = window.HB_CHAIN_ENGINE.getChainState && window.HB_CHAIN_ENGINE.getChainState();
  if (hbState && !hbState.active) {
    activeChainState = null;
    usedKeyFetchInChain = {};
    renderChainActions();
  }
}

function addChainLink(effect, options = {}) {
  const force = !!options.force;
  if (!activeChainState || !activeChainState.active) return;
  if (!force && activeChainState.priority !== myRole) {
    notify('현재 체인 우선권은 상대에게 있습니다.');
    return;
  }
  if (effect && effect.type === 'keyFetch' && usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }

  const actorRole = options.role || (effect && effect.by) || myRole;
  const result = _activateLegacyLinkInHbChain(effect, { role: actorRole, force });
  if (result && result.ok === false) {
    notify(result.error || '체인 링크를 추가할 수 없습니다.');
    return;
  }
  log(`체인 추가: ${(effect && effect.label) || (effect && effect.type) || '효과'}`, actorRole === myRole ? 'mine' : 'opponent');
}

function enqueueTriggeredEffect(effect) {
  const normalized = normalizeTriggeredEffect(effect);
  if (!normalized) return;

  pendingTriggerEffects.push(normalized);

  // 체인 활성 중이거나 체인 해결 진행 중이면 대기
  // — 해결 완료 후 executeChainLocally 또는 _onLocalChainStateChanged에서 flush 호출
  if ((activeChainState && activeChainState.active) || window._chainResolving) {
    return;
  }
  setTimeout(flushTriggeredEffects, 0);
}

function normalizeTriggeredEffect(effect) {
  if (!effect || !effect.type) return null;
  const speed = effect.speed || (String(effect.type).startsWith('quick') ? 'quick' : 'trigger');
  const timing = effect.timing || (speed === 'quick' ? 'response' : 'queued');
  return { mandatory: false, optional: false, ...effect, speed, timing };
}

function flushTriggeredEffects() {
  if (pendingTriggerEffects.length === 0) return;
  if (activeChainState && activeChainState.active) return;

  const queued = [...pendingTriggerEffects];
  pendingTriggerEffects = [];

  // optional 효과가 큐 첫 번째라면 발동 여부를 확인한 후 체인 시작
  const first = queued[0];
  const rest  = queued.slice(1);

  const _doChain = () => {
    window.beginChain(first); // window 경유 → ai.js 훅 적용
    rest.forEach(e => addChainLink(e, { force: true }));
  };

  if (first.optional) {
    gameConfirm(`${first.label || first.type}\n이 유발효과를 발동하시겠습니까?`, (yes) => {
      if (!yes) {
        // 취소 시 나머지 큐 복구 후 다음 효과로
        pendingTriggerEffects.unshift(...rest);
        setTimeout(flushTriggeredEffects, 0);
        return;
      }
      _doChain();
    });
  } else {
    _doChain();
  }
}

function activateQuickEffect(effect) {
  // 퀵 효과: 자신/상대 턴 전개·공격·엔드 단계에 발동 가능. 체인에 응답으로 추가 가능.
  if (currentPhase === 'draw') {
    notify('드로우 단계에는 효과를 발동할 수 없습니다.');
    return;
  }
  if (activeChainState && activeChainState.active) {
    if (activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다.');
      return;
    }
    addChainLink(effect);
    return;
  }
  // [BUG FIX] window.beginChain으로 호출 — ai.js의 _safeHook 패치가 적용되도록
  window.beginChain(effect);
}

function activateIgnitionEffect(effect) {
  // 기동효과: 자신 전개 단계, 체인 1로만 발동 가능
  if (!isMyTurn || currentPhase !== 'deploy') {
    notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.');
    return;
  }
  if (activeChainState && activeChainState.active) {
    notify('기동효과는 체인 1로만 발동할 수 있습니다.');
    return;
  }
  // [BUG FIX] window.beginChain으로 호출 — ai.js의 _safeHook 패치가 적용되도록
  window.beginChain(effect);
}

function ensureCardInstanceId(card) {
  if (!card) return null;
  if (!card._iid) {
    ensureCardInstanceId._seq = (ensureCardInstanceId._seq || 0) + 1;
    card._iid = `cid_${Date.now()}_${ensureCardInstanceId._seq}`;
  }
  return card._iid;
}

function findCardIndexByInstanceId(zone, instanceId) {
  if (!Array.isArray(zone) || !instanceId) return -1;
  return zone.findIndex(c => c && c._iid === instanceId);
}

function resolveChain(chainState) {
  if (chainState && chainState.hbEngine !== true) {
    // 완전 이식 후 구형 activeChainState를 직접 해결하지 않는다.
    // 혹시 오래된 세션의 레거시 상태가 들어오면 같은 순서로 HB_CHAIN_ENGINE에 재주입한다.
    const links = Array.isArray(chainState.links) ? chainState.links.slice() : [];
    activeChainState = null;
    links.forEach((link, index) => {
      _activateLegacyLinkInHbChain(link, { role: link.by || myRole, force: index > 0 });
    });
  }

  if (window.HB_CHAIN_ENGINE && typeof window.HB_CHAIN_ENGINE.resolveChain === 'function') {
    const controller = (typeof window.HB_CHAIN_ENGINE.roleToController === 'function')
      ? window.HB_CHAIN_ENGINE.roleToController(myRole)
      : 'me';
    const result = window.HB_CHAIN_ENGINE.resolveChain({ controller });
    if (result && result.ok === false) notify(result.error || '체인 해결에 실패했습니다.');
    usedKeyFetchInChain = {};
    return result;
  }

  notify('체인 엔진을 사용할 수 없습니다.');
  return { ok: false, error: 'HB_CHAIN_ENGINE unavailable' };
}

// ─────────────────────────────────────────────
// CHAIN RESOLVERS — 체인 링크 타입별 실행 함수 매핑
// ─────────────────────────────────────────────
const CHAIN_RESOLVERS = {
  // 공용
  keyFetch:                  (link) => resolveKeyFetch(link.cardId),
  // 필드 카드 발동: 발동이 무효되지 않았으면 필드 존에 유지하고, 발동 시 처리 효과만 해결한다.
  fieldActivate:             (link) => {
    if (window.HB_FIELD_ZONE && typeof window.HB_FIELD_ZONE.resolveFieldCardActivation === 'function') {
      window.HB_FIELD_ZONE.resolveFieldCardActivation(Object.assign({}, link || {}, { gameState: G, controller: 'me', sync: false, render: false }));
    } else {
      log('필드 카드 발동 해결', 'system');
      sendGameState(); renderAll();
    }
  },
  // AI 효과 리졸버
  aiForceDiscard:            (link) => forceDiscard(Math.max(1, Number(link.count) || 1)),
  aiEyeForEye:               ()     => { _aiDrawN(2); log('🤖 눈에는 눈: 드로우 2장', 'opponent'); renderAll(); },
  aiSummonDeck:              (link) => { if (link.cardId) { _aiSummonFromDeck(link.cardId); renderAll(); } },
  aiSearch:                  (link) => { if (link.cardId) { _aiSearch(link.cardId); renderAll(); } },
  aiFieldCard:               (link) => {
    if (!link.cardId) return;
    var card = CARDS[link.cardId] || { name: link.cardId };
    G.opFieldCard = { id: link.cardId, name: card.name };
    handleOpponentAction({ type:'fieldCard', cardId: link.cardId, by:'guest', ts: Date.now() });
    log('🤖 ' + card.name + ' 발동', 'opponent');
    renderAll();
  },
  aiGraveOpField:            (link) => { _aiGraveFromPlayerField(Number(link.count) || 1); sendGameState(); renderAll(); },
  aiGraveAllOpField:         ()     => { _aiGraveFromPlayerField(G.myField.length); sendGameState(); renderAll(); },
  aiExileOpField:            (link) => { _aiExileFromPlayerField(Number(link.count) || 1); sendGameState(); renderAll(); },
  aiExileAllOpField:         ()     => { _aiExileFromPlayerField(G.myField.length); sendGameState(); renderAll(); },
  aiReturnOpHand:            (link) => { _aiReturnToPlayerHand(Number(link.count) || 1); sendGameState(); renderAll(); },
  aiPenguinHero1:            (link) => { if (link.searchId) _aiSearch(link.searchId); if (link.summonId) _aiSummonFromDeck(link.summonId); sendGameState(); renderAll(); },
  aiPenguinLegend1:          (link) => {
    (link.targets || []).forEach(id => {
      var gi = G.opGrave.findIndex(c => c.id === id);
      if (gi >= 0 && G.opField.length < maxFieldSlots()) {
        var c = G.opGrave.splice(gi, 1)[0];
        var cd = CARDS[c.id] || {};
        G.opField.push({ id: c.id, name: cd.name || c.id, atk: cd.atk || 0, atkBase: cd.atk || 0 });
        log('🤖 묘지 부활: ' + (cd.name || c.id), 'opponent');
      }
    });
    sendGameState(); renderAll();
  },
  // 플레이어 눈에는 눈 — 상대 서치에 대응, 체인 해결 시 드로우
  eyeForEyePlayer:           ()     => { drawN(2); log('눈에는 눈: 드로우 2장!', 'mine'); sendGameState(); renderAll(); },
  // 펭귄 마을
  penguinVillage1:           ()     => resolvePenguinVillage1(),
  // 꼬마 펭귄
  ignitionKkomaPenguin1:     (link) => resolveKkomaPenguin1(link.cardId),
  triggerKkomaPenguin:       ()     => resolveKkomaPenguin(),
  // 펭귄 부부
  triggerPenguinBubu1:       ()     => resolvePenguinBubu1(),
  ignitionPenguinBubu2:      ()     => resolvePenguinBubu2(),
  // 현자 펭귄
  ignitionSagePenguin1:      ()     => resolveSagePenguin1(),
  ignitionSagePenguin2:      ()     => resolveSagePenguin2(),
  // 수문장 펭귄
  ignitionSummonerPenguin1:  (link) => resolveSummonerPenguin1(link.sourceInstanceId),
  // 수문장 펭귄 ②
  triggerSummonerPenguin2:   ()     => resolveSummonerPenguin2(),
  // 펭귄!돌격!
  ignitionPenguinCharge1:    (link) => resolvePenguinCharge1(link.sourceInstanceId),
  ignitionPenguinCharge2:    ()     => resolvePenguinCharge2(),
  // 펭귄의 영광
  ignitionPenguinGlory1:     (link) => resolvePenguinGlory1(link.sourceInstanceId),
  ignitionPenguinGlory2:     ()     => resolvePenguinGlory2(),
  // 펭귄 용사
  triggerPenguinHero1:       ()     => resolvePenguinHero1(),
  quickPenguinHero2:         ()     => resolvePenguinHero2(),
  triggerPenguinHero3:       ()     => resolvePenguinHero3(),
  // 펭귄의 일격
  quickPenguinStrike1:       ()     => resolvePenguinStrike1(),
  triggerPenguinStrike2:     ()     => resolvePenguinStrike2(),
  // 펭귄이여 영원하라
  ignitionPenguinForever1:   ()     => resolvePenguinForever1(),
  quickPenguinForever2:      ()     => resolvePenguinForever2(),
  // 펭귄의 전설
  triggerPenguinLegend1:     ()     => resolvePenguinLegend1(),
  quickPenguinLegend2:       ()     => resolvePenguinLegend2(),
  // 펭귄 마법사
  ignitionPenguinWizard1:    ()     => resolvePenguinWizard1(),
  triggerPenguinWizard2:     ()     => resolvePenguinWizard2(),
  ignitionPenguinWizard3:    ()     => resolvePenguinWizard3(),
  // 동적 테마 (theme-common.js)
  themeEffect:               (link) => resolveThemeEffect(link),
  // 슈브 니구라스 ① — GOO 소환 후 덱에서 GOO 묘지
  shubniggurath1:            ()     => { if (typeof window._resolveShubniggurath1 === 'function') window._resolveShubniggurath1(); },
  // 지배자 ① — 코스트 후 체인 해결
  jibaeShui1:                ()     => resolveJibaeShui1(),
  jibaeHwa1:                 ()     => resolveJibaeHwa1(),
  jibaeJeon1:                ()     => resolveJibaeJeon1(),
  jibaeFung1:                ()     => resolveJibaeFung1(),
  // 체인 무효
  genericNegate:             ()     => { log('효과 무효!', 'system'); sendGameState(); renderAll(); },
  // 구사일생: 전투 데미지 0 + 드로우
  guSaIlSaeng:               ()     => { drawOne(); log('구사일생: 전투 데미지 0 + 드로우!', 'mine'); sendGameState(); renderAll(); },
  // 단단한 카드 자물쇠 — 필드 효과 무효 (리졸버에서 실제 negateField 적용)
  fieldNegate:               (link) => {
    if (link.targetId) {
      log(`단단한 카드 자물쇠: ${link.targetId} 효과 턴 종료시까지 무효`, 'system');
      // negateField는 sendAction으로 이미 전송됨. 여기선 로컬 상태 갱신만.
    }
    sendGameState(); renderAll();
  },
  // 서치 봉인의 항아리 ①: 덱→드로우
  jarDraw1:                  ()     => { drawOne(); log('서치 봉인의 항아리 ①: 드로우!', 'mine'); sendGameState(); renderAll(); },
  // 서치 봉인의 항아리 ②: 서치 봉인 (코스트 처리 완료, 상태 적용만)
  jarSearchBan:              ()     => { G.searchBanActive = true; log('서치 봉인의 항아리 ②: 이 턴 서치 봉인!', 'system'); sendGameState(); renderAll(); },
  // 유혹의 황금사과
  goldenApple:               ()     => { G.goldenAppleActive = true; log('유혹의 황금사과: 상대 소환마다 드로우 발동!', 'mine'); sendGameState(); renderAll(); },
  // 수호의 빛: 제외 존 패 회수 (선택)
  sacredLight:               (link) => {
    if ((link.exileCount || 0) > 0 && G.myExile.length > 0) {
      openCardPicker(G.myExile, '수호의 빛: 제외된 카드 1장 패에 넣기 (선택)', 1, (selected) => {
        if (selected.length > 0) {
          const ec = G.myExile.splice(selected[0], 1)[0];
          G.myHand.push({ id: ec.id, name: ec.name, isPublic: true });
          log(`수호의 빛: ${ec.name} 패로`, 'mine');
        }
        sendGameState(); renderAll();
      });
    } else {
      sendGameState(); renderAll();
    }
  },
  // 신성한 수호자: 제외 봉인 적용
  holyGuardian:              ()     => { G.exileBanActive = true; log('신성한 수호자: 이 턴 서로 카드 제외 불가!', 'system'); sendGameState(); renderAll(); },
  // 일격필살: 상대 패 1장 버리기
  oneHitKill:                ()     => { log('일격필살: 상대 패 1장 버리기!', 'mine'); sendAction({ type: 'forceDiscard', count: 1, reason: '일격필살', attackerPicks: true }); sendGameState(); renderAll(); },
  // 단 한번의 기회: 드로우
  onceDraw:                  ()     => { drawOne(); log('단 한번의 기회: 드로우!', 'mine'); sendGameState(); renderAll(); },
  // 아자토스 ③: 필드 효과 무효 + 서로 필드 제외
  azatothEffect3: (link) => {
    const maxExile = Number(link.maxExile) || 0;
    if (maxExile <= 0) { sendGameState(); renderAll(); return; }
    // 서로 필드에서 같은 수만큼 제외
    const myTargets  = G.myField.slice();
    const opTargets  = G.opField.slice();
    if (!myTargets.length && !opTargets.length) { sendGameState(); renderAll(); return; }
    openCardPicker(myTargets, `아자토스 ③: 내 필드에서 ${maxExile}장까지 제외`, maxExile, (sel1) => {
      sel1.sort((a,b)=>b-a).forEach(i => {
        const c = G.myField.splice(i, 1)[0];
        if (c) G.myExile.push(c);
      });
      const exileCount = sel1.length;
      if (!exileCount || !opTargets.length) { sendGameState(); renderAll(); return; }
      const opExileCount = Math.min(exileCount, opTargets.length);
      openCardPicker([...G.opField], `아자토스 ③: 상대 필드에서 ${opExileCount}장 제외`, opExileCount, (sel2) => {
        sel2.sort((a,b)=>b-a).forEach(i => {
          const c = G.opField.splice(i, 1)[0];
          if (c) { G.opExile.push(c); sendAction({ type: 'opFieldRemove', cardId: c.id, to: 'exile' }); }
        });
        log(`아자토스 ③: 서로 필드 ${exileCount}장씩 제외!`, 'mine');
        sendGameState(); renderAll();
      });
    });
  },

};

function resolveLegacyChainLink(link, ctx) {
  if (!link || !link.type) return { ok: false, error: '레거시 링크 타입이 없습니다.' };

  window._chainResolving = true;
  try {
    if (window.consumeMafiaChainReplacement && window.consumeMafiaChainReplacement(link)) {
      return { ok: true, skipped: true, reason: 'mafiaReplacement' };
    }
    if (link.by === myRole && window.tryResolveMafiaChainTransform && window.tryResolveMafiaChainTransform(link)) {
      return { ok: true, transformed: true, reason: 'mafiaTransform' };
    }

    const resolver = CHAIN_RESOLVERS[link.type];
    if (resolver) {
      resolver(link);
      return { ok: true, legacy: true, type: link.type };
    }
    if (window.AI && window.AI.active) {
      _executeAIChainLink(link);
      return { ok: true, legacy: true, fallback: 'ai', type: link.type };
    }
    console.warn('[Legacy Chain Adapter] 알 수 없는 링크 타입:', link.type, link);
    return { ok: false, error: `알 수 없는 레거시 링크 타입: ${link.type}` };
  } finally {
    window._chainResolving = false;
  }
}

window.HB_LEGACY_CHAIN_ADAPTER = Object.freeze({
  resolveLegacyLink: resolveLegacyChainLink,
});


if (window.addEventListener) {
  window.addEventListener('hb:chain-resolved', function onHbChainResolved() {
    usedKeyFetchInChain = {};
    if (pendingTriggerEffects.length > 0) setTimeout(flushTriggeredEffects, 0);
  });
}

// 체인 링크를 역순으로 실행
// links는 이미 역순(resolvedLinks.reverse())으로 넘어온 상태이므로
// 인덱스 i=0이 체인의 마지막 링크(최상위), i=last가 체인 1(최초 발동)
function executeChainLocally(links) {
  // ── 무효 인덱스 계산 ──────────────────────────────────────
  const negatedIndices = new Set();
  links.forEach((link, i) => {
    if (negatedIndices.has(i)) return;
    if (link.type === 'quickPenguinStrike1' || link.type === 'genericNegate') {
      if (i + 1 < links.length) negatedIndices.add(i + 1);
    }
  });

  // ── 실행 중 플래그 ─────────────────────────────────────────
  // resolve 함수 내부에서 enqueueTriggeredEffect가 호출될 때
  // activeChainState는 이미 null이므로 즉시 flush가 실행된다.
  // 이를 막기 위해 전역 플래그로 "체인 해결 진행 중" 상태를 표시한다.
  window._chainResolving = true;

  links.forEach((link, i) => {
    if (negatedIndices.has(i)) {
      log(`효과 무효: ${link.label || link.type}`, 'system');
      return;
    }
    if (window.consumeMafiaChainReplacement && window.consumeMafiaChainReplacement(link)) {
      return;
    }

    if (link.by === myRole) {
      if (window.tryResolveMafiaChainTransform && window.tryResolveMafiaChainTransform(link)) {
        return;
      }
      const resolver = CHAIN_RESOLVERS[link.type];
      if (resolver) resolver(link);
      else console.warn('[Chain] 알 수 없는 링크 타입:', link.type);
    } else {
      const resolver = CHAIN_RESOLVERS[link.type];
      if (resolver) {
        resolver(link);
      } else if (window.AI && window.AI.active) {
        _executeAIChainLink(link);
      } else {
        console.warn('[Chain] 상대 링크: 알 수 없는 타입', link.type);
      }
    }
  });

  window._chainResolving = false;
  sendGameState();
  renderAll();
  usedKeyFetchInChain = {};

  // 체인 해결 완료 후 쌓인 유발효과 처리
  if (pendingTriggerEffects.length > 0) {
    setTimeout(flushTriggeredEffects, 0);
  }
}

// AI 체인 링크 실행 폴백 (CHAIN_RESOLVERS에 없는 레거시 타입용)
function _executeAIChainLink(link) {
  switch (link.type) {
    case 'aiEyeForEye':
      if (typeof _aiDrawN === 'function') _aiDrawN(2);
      log('🤖 눈에는 눈: 드로우 2장', 'opponent');
      break;
    default:
      console.warn('[AI Chain] 알 수 없는 타입:', link.type);
      break;
  }
}


// ─────────────────────────────────────────────────────────────
// 펭귄 마을 ② 지속효과
// ─────────────────────────────────────────────────────────────
function _checkVillageOnDiscard(cardId, callback) {
  if (cardId !== '펭귄 마을') { callback(false); return; }
  const villageCard   = G.myHand.find(c => c.id === '펭귄 마을' && c.isPublic);
  const fieldPenguins = G.myField.filter(c => isPenguinMonster(c.id));
  if (!villageCard || fieldPenguins.length === 0) { callback(false); return; }

  gameConfirm(
    `펭귄 마을 ②\n버리는 대신 필드의 펭귄 몬스터를 묘지로 보냅니까?`,
    (yes) => {
      if (!yes) { callback(false); return; }
      openCardPicker(fieldPenguins, '펭귄 마을 ②: 대신 묘지로 보낼 펭귄 몬스터', 1, (sel) => {
        if (sel.length > 0) {
          const mon = fieldPenguins[sel[0]];
          sendToGrave(mon.id, 'field');
          log(`펭귄 마을 ②: ${mon.name} 대신 묘지`, 'mine');
          if (mon.id === '수문장 펭귄') triggerSummonerPenguin2();
          _tryRecoverPenguinStrikeFromGrave();
          sendGameState(); renderAll();
        }
        callback(true);
      }, true);
    }
  );
}

function manualDiscard(handIdx) {
  if (handIdx < 0 || !G.myHand[handIdx]) return;
  const c = G.myHand[handIdx];
  selectedCardIdx = -1;

  _checkVillageOnDiscard(c.id, (replaced) => {
    if (replaced) return;
    G.myHand.splice(handIdx, 1);
    G.myGrave.push({ id: c.id, name: c.name });
    log(`패를 버림: ${c.name}`, 'mine');
    sendAction({ type: 'discard', cardId: c.id });
    onJibaeryongDiscarded(c.id);
    onHandDiscarded_jibaeSasl();
    sendGameState(); renderAll(); checkWinCondition();
  });
}

function _forcedDiscardOne(title, callback) {
  if (G.myHand.length === 0) { callback(); return; }
  openCardPicker(G.myHand, title, 1, (sel) => {
    if (sel.length === 0) { callback(); return; }
    const c = G.myHand[sel[0]];
    _checkVillageOnDiscard(c.id, (replaced) => {
      if (!replaced) {
        G.myHand.splice(sel[0], 1);
        G.myGrave.push({ id: c.id, name: c.name });
        log(`버림(코스트): ${c.name}`, 'mine');
        onJibaeryongDiscarded(c.id);
        onHandDiscarded_jibaeSasl();
      }
      callback();
    });
  }, true);
}

function _doForcedDiscardOne(title, callback) {
  _forcedDiscardOne(title, callback);
}

function resolveKeyFetch(cardId) {
  const idx = G.myKeyDeck.findIndex(c => c.id === cardId);
  if (idx < 0) { notify(`키 카드 덱에 ${CARDS[cardId]?.name || cardId}가 없습니다.`); return; }

  if (['카드의 흑기사','풀려난 항아리의 마귀','카드 세계의 영웅'].includes(cardId)) {
    notify(`${CARDS[cardId]?.name || cardId}는 키덱 버튼에서 [소환]으로 직접 소환해야 합니다.`);
    return;
  }

  if (cardId === '펭귄 용사' && G.opField.length === 0) {
    notify('펭귄 용사: 상대 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
    return;
  }
  if (cardId === '펭귄의 전설' && G.myField.length === 0) {
    notify('펭귄의 전설: 자신 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
    return;
  }

  const c = G.myKeyDeck.splice(idx, 1)[0];
  G.myHand.push({ id: c.id, name: c.name, isPublic: true });
  log(`키 카드 가져오기: ${c.name} (공개패)`, 'mine');
  sendGameState(); renderAll();
}

function resolvePenguinVillage1() {
  const idx = G.myHand.findIndex(c => c.id === '펭귄 마을' && !c.isPublic);
  if (idx < 0) return;
  G.myHand[idx].isPublic = true;
  markEffectUsed('펭귄 마을', 1);
  log('체인 처리: 펭귄 마을 ① 공개', 'mine');
}

// renderFieldZones는 ui.js에서 정의됩니다.

// ─────────────────────────────────────────────────────────────
// 체인 응답 레지스트리 — 범용 카드 등록
// ─────────────────────────────────────────────────────────────
(function _registerGenericChainResponses() {
  if (typeof registerChainHandResponse !== 'function') {
    setTimeout(_registerGenericChainResponses, 50);
    return;
  }

  // 출입통제: 체인이 활성 중이고 상대 링크가 있을 때 무효
  registerChainHandResponse('출입통제', [
    {
      effectNum: 1,
      label: '① 상대 효과 무효',
      // [수정] 체인 활성은 collectChainOptions()가 보장.
      // 여기선 "상대 링크가 있어야" 조건만 체크.
      condition: () => _chainHasOpponentLink(),
      activate: (handIdx) => {
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        log('출입통제 발동!', 'mine');
        sendAction({ type: 'negate', reason: '출입통제' });
        addChainLink({ type: 'genericNegate', label: '출입통제' });
        sendGameState(); renderAll();
      },
    },
  ]);


  registerChainHandResponse('영웅의 탄생', [
    {
      effectNum: 1,
      label: '① 상대 효과 무효',
      condition: () => _chainHasOpponentSearchLink() || _chainHasOpponentLink(),
      activate: (handIdx) => {
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        markEffectUsed('영웅의 탄생', 1);
        sendAction({ type: 'negate', reason: '영웅의 탄생' });
        addChainLink({ type: 'genericNegate', label: '영웅의 탄생' });
        sendGameState(); renderAll();
      },
    },
  ]);

  registerChainHandResponse('풀려난 항아리의 마귀', [
    {
      effectNum: 1,
      label: "① '서치 봉인의 항아리' 무효",
      condition: () => _chainHasOpponentLink(),
      activate: (handIdx) => {
        const hasJar = (window.chainLinks||[]).some(l => (l.label||'').includes('서치 봉인의 항아리'));
        if (!hasJar) { notify('체인에 서치 봉인의 항아리가 없습니다.'); return; }
        sendAction({ type: 'negate', reason: '풀려난 항아리의 마귀 ①' });
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        _doForcedDiscardOne('풀려난 항아리의 마귀 ①: 패 1장 버리기', ()=>{ sendGameState(); renderAll(); });
      },
    },
  ]);

  // 눈에는 눈: 상대가 서치계 효과를 체인에 넣었을 때 응답
  if (!window.CHAIN_HAND_RESPONSES?.['눈에는 눈']) {
    registerChainHandResponse('눈에는 눈', [
      {
        effectNum: 1,
        label: '① 버리고 드로우 2장',
        // [수정] 상대 서치 링크가 체인에 있어야 함
        condition: () => _chainHasOpponentSearchLink(),
        activate: (handIdx) => {
          G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
          markEffectUsed('눈에는 눈', 1);
          addChainLink({ type: 'eyeForEyePlayer', label: '눈에는 눈' });
          sendGameState(); renderAll();
        },
      },
    ]);
  }
})();