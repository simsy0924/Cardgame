// patch.js — 라이온/타이거/라이거/크툴루 공통 패치
// ─────────────────────────────────────────────
// 1. CHAIN_RESOLVERS에 themeEffect 등록 (effects-chain.js에 이미 있지만 보강)
// 2. handleOpponentAction 확장
// 3. summonFromDeck/summonFromGrave 소환 트리거
// 4. enterGame/resetTurnEffects 초기화
// 5. 덱 프리셋
// ─────────────────────────────────────────────

// 1. CHAIN_RESOLVERS.themeEffect 등록 확인
// (effects-chain.js에 이미 themeEffect → resolveThemeEffect 가 있으므로 중복 불필요)
// theme-common.js의 resolveThemeEffect가 handler.resolveLink를 호출함

// 2. handleOpponentAction 확장
(function _patchHandleOp() {
  const _orig = typeof handleOpponentAction === 'function' ? handleOpponentAction : null;
  if (!_orig) return;
  handleOpponentAction = function(action) {
    // 테마 핸들러 위임
    const handlers = Object.values(window.THEME_EFFECT_HANDLERS || {});
    for (const h of handlers) { if (typeof h.handleOpAction === 'function') h.handleOpAction(action); }

    switch(action.type) {
      case 'forceReturnHand': {
        const count = Math.min(action.count||1, G.myHand.length);
        if (!count) break;
        openCardPicker([...G.myHand], `${action.reason||'효과'}: 패 ${count}장 덱으로`, count, (sel) => {
          sel.sort((a,b)=>b-a).forEach(i=>{ if(G.myHand[i]) G.myDeck.push(G.myHand.splice(i,1)[0]); });
          log(`${action.reason||'효과'}: 패 ${sel.length}장 덱으로`,'opponent');
          sendGameState(); renderAll();
        });
        return;
      }
      case 'forceExileHandCard': {
        const count = Math.min(action.count||1, G.myHand.length);
        if (!count) break;
        openCardPicker([...G.myHand], `${action.reason||'효과'}: 패 ${count}장 제외`, count, (sel) => {
          sel.sort((a,b)=>b-a).forEach(i=>{ if(G.myHand[i]) G.myExile.push(G.myHand.splice(i,1)[0]); });
          log(`${action.reason||'효과'}: 패 ${sel.length}장 제외됨`,'opponent');
          sendGameState(); renderAll();
        });
        return;
      }
      case 'opDraw': {
        const n = action.count||1;
        for (let i=0;i<n;i++) { if(typeof drawOne==='function') drawOne(); }
        log(`상대 효과: ${n}장 드로우`,'opponent');
        sendGameState(); renderAll();
        return;
      }
      case 'opDeckTopExile':
      case 'opGraveMassExile':
      case 'tigerZoneBan':
      case 'opExtraSlots':
        // 각 테마 핸들러에서 처리
        return;
      default:
        break;
    }
    _orig.apply(this, arguments);
  };
})();

// 라이온 opExtraSlots 수신
(function _patchLionOpSlots() {
  const _orig = typeof handleOpponentAction === 'function' ? handleOpponentAction : null;
  if (!_orig) return;
  handleOpponentAction = function(action) {
    if (action.type === 'opExtraSlots') { G.opExtraSlots = action.slots||0; renderAll(); return; }
    _orig.apply(this, arguments);
  };
})();

// opGraveMassExile 처리
(function _patchOpGraveMassExile() {
  const _orig = typeof handleOpponentAction === 'function' ? handleOpponentAction : null;
  if (!_orig) return;
  handleOpponentAction = function(action) {
    if (action.type === 'opGraveMassExile') {
      while (G.myGrave.length) G.myExile.push(G.myGrave.pop());
      log('라이거 킹 ④: 내 묘지 전부 제외됨','opponent');
      renderAll(); return;
    }
    _orig.apply(this, arguments);
  };
})();

// 3. summonFromDeck/summonFromGrave 소환 트리거 브로드캐스트
(function _patchSummonTriggers() {
  const _fire = (cardId) => {
    const card = CARDS[cardId];
    if (!card?.theme) return;
    const handler = window.THEME_EFFECT_HANDLERS?.[card.theme];
    if (handler?.onSummoned) setTimeout(() => handler.onSummoned(cardId), 50);
  };
  const _origFromDeck = typeof summonFromDeck === 'function' ? summonFromDeck : null;
  if (_origFromDeck) {
    summonFromDeck = function(cardId) {
      if (G.ligerKingBanSummon) { notify('라이거 킹 ④: 이 턴 소환 불가'); return; }
      _origFromDeck(cardId); _fire(cardId);
    };
  }
  const _origFromGrave = typeof summonFromGrave === 'function' ? summonFromGrave : null;
  if (_origFromGrave) {
    summonFromGrave = function(cardId) {
      if (G.ligerKingBanSummon) { notify('라이거 킹 ④: 이 턴 소환 불가'); return; }
      _origFromGrave(cardId); _fire(cardId);
    };
  }
})();

// 4. enterGame / resetTurnEffects 초기화
(function _patchEnterGame() {
  const _orig = typeof enterGame === 'function' ? enterGame : null;
  if (!_orig) return;
  enterGame = function() {
    _orig.apply(this, arguments);
    G.tigerZoneBanned    = false;
    G.tigerZonePermanent = false;
    G.ligerKingBanSummon = false;
    G.myExtraSlots       = G.myExtraSlots || 0;
    // ★ AI 모드: enterGame 완료 직후 AI 세팅
    if (window.AI && window.AI.active) {
      window.AI._pendingSetup = true;
    }
  };
})();

(function _patchResetTurnEffects() {
  const _orig = typeof resetTurnEffects === 'function' ? resetTurnEffects : null;
  if (!_orig) return;
  resetTurnEffects = function() {
    _orig.apply(this, arguments);
    G.ligerKingBanSummon = false;
  };
})();

// 5. 덱 프리셋
(function _patchLoadPreset() {
  const _orig = typeof loadPreset === 'function' ? loadPreset : null;
  if (!_orig) return;
  loadPreset = function(theme) {
    if (theme === '라이온') {
      builderMainDeck = {
        '베이비 라이온':4,'젊은 라이온':4,'에이스 라이온':4,
        '사자의 포효':4,'사자의 사냥':4,'사자의 발톱':4,
        '사자의 일격':4,'진정한 사자':4,'고고한 사자':4,
        '구사일생':2,'눈에는 눈':2,'출입통제':2,
      };
      builderKeyDeck = { '라이온 킹':1,'일격필살':1,'단 한번의 기회':1 };
      notify('라이온 기본 덱 로드! (메인 42장)');
    } else if (theme === '타이거') {
      builderMainDeck = {
        '베이비 타이거':4,'젊은 타이거':4,'에이스 타이거':4,
        '호랑이의 포효':4,'호랑이의 사냥':4,'호랑이의 발톱':4,
        '호랑이의 일격':4,'진정한 호랑이':4,'고고한 호랑이':4,
        '구사일생':2,'눈에는 눈':2,'출입통제':2,
      };
      builderKeyDeck = { '타이거 킹':1,'일격필살':1,'단 한번의 기회':1 };
      notify('타이거 기본 덱 로드! (메인 42장)');
    } else if (theme === '라이거') {
      builderMainDeck = {
        '화합의 시대의 라이거':4,'베이비 라이거':4,'젊은 라이거':4,'에이스 라이거':4,
        '모두의 자연':4,'베이비 라이온':2,'젊은 라이온':2,
        '베이비 타이거':2,'젊은 타이거':2,'사자의 일격':2,'호랑이의 일격':2,
        '눈에는 눈':2,'구사일생':2,'출입통제':2,
      };
      builderKeyDeck = { '라이거 킹':1,'라이온 킹':1,'타이거 킹':1,'일격필살':1,'단 한번의 기회':1 };
      notify('라이거 기본 덱 로드! (메인 40장)');
    } else if (theme === '크툴루' || theme === '올드원') {
      builderMainDeck = {
        '그레이트 올드 원-크툴루':4,'그레이트 올드 원-크투가':4,
        '그레이트 올드 원-크아이가':4,'그레이트 올드 원-과타노차':4,
        '엘더 갓-노덴스':4,'엘더 갓-크타니트':4,'엘더 갓-히프노스':4,
        '올드_원의 멸망':4,'눈에는 눈':2,'구사일생':2,'출입통제':2,'유혹의 황금사과':2,
      };
      builderKeyDeck = {
        '아우터 갓 니알라토텝':1,'아우터 갓-아자토스':1,'아우터 갓 슈브 니구라스':1,
        '일격필살':1,'단 한번의 기회':1,
      };
      notify('크툴루 기본 덱 로드! (메인 40장)');
    } else {
      _orig(theme); return;
    }
    renderBuilderDeck(); filterDeckPool(currentPoolFilter);
  };
})();

// ─────────────────────────────────────────────
// 6. AI 훅 — patch.js 마지막에서 등록 (가장 나중에 실행 보장)
// ─────────────────────────────────────────────
(function _patchAI() {

  // confirmDeck: AI 덱 빌드
  const _origConfirm = typeof confirmDeck === 'function' ? confirmDeck : null;
  if (_origConfirm) {
    confirmDeck = function() {
      if (window.AI && window.AI.active) {
        if (typeof _buildAIDeck === 'function') _buildAIDeck();
      }
      _origConfirm.apply(this, arguments);
    };
  }

  // _startNewGame: 완료 직후 AI 세팅 (가장 중요)
  const _origSNG = typeof _startNewGame === 'function' ? _startNewGame : null;
  if (_origSNG) {
    _startNewGame = function() {
      _origSNG.apply(this, arguments);
      if (window.AI && window.AI.active) {
        // 동기적으로 즉시 실행 — setTimeout 없이
        if (typeof _setupAI === 'function') _setupAI();
      }
    };
  }

  // endTurn: AI 턴 시작
  const _origEndTurn = typeof endTurn === 'function' ? endTurn : null;
  if (_origEndTurn) {
    endTurn = function() {
      _origEndTurn.apply(this, arguments);
      if (window.AI && window.AI.active && !isMyTurn) {
        setTimeout(function() {
          if (typeof _aiStartTurn === 'function') _aiStartTurn();
        }, 700);
      }
    };
  }

  // checkWinCondition: AI 패 0 = 플레이어 승리
  const _origCheckWin = typeof checkWinCondition === 'function' ? checkWinCondition : null;
  if (_origCheckWin) {
    checkWinCondition = function() {
      _origCheckWin.apply(this, arguments);
      if (!window.AI || !window.AI.active) return;
      if (G.opHand.length === 0 && !isMyTurn) {
        setTimeout(function() { showGameOver(true); }, 300);
      }
    };
  }

})();
