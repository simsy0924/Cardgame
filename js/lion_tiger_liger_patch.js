// lion_tiger_liger_patch.js
// enterGame 초기화, handleOpponentAction 확장, summon 트리거, loadPreset 패치
// ─────────────────────────────────────────────

// 1. G 초기화 — enterGame 후킹
(function _patchEnterGame() {
  const _orig = typeof enterGame === 'function' ? enterGame : null;
  if (!_orig) { console.warn('lion_tiger_liger_patch: enterGame not found'); return; }
  enterGame = function () {
    _orig.apply(this, arguments);
    G.tigerZoneBanned    = false;
    G.tigerZonePermanent = false;
    G.ligerKingBanSummon = false;
  };
})();

// 2. resetTurnEffects 후킹 — 엔드 단계에 ligerKingBanSummon 해제
(function _patchResetTurnEffects() {
  const _orig = typeof resetTurnEffects === 'function' ? resetTurnEffects : null;
  if (!_orig) { console.warn('lion_tiger_liger_patch: resetTurnEffects not found'); return; }
  resetTurnEffects = function () {
    _orig.apply(this, arguments);
    G.ligerKingBanSummon = false;
  };
})();

// 3. handleOpponentAction 단일 후킹 — 새 액션 타입 추가 + 테마 핸들러 위임
// (2번 IIFE와 3번 IIFE를 하나로 통합하여 이중 후킹 경쟁 조건 제거)
(function _patchHandleOpponentAction() {
  const _orig = typeof handleOpponentAction === 'function' ? handleOpponentAction : null;
  if (!_orig) { console.warn('lion_tiger_liger_patch: handleOpponentAction not found'); return; }

  handleOpponentAction = function (action) {
    // 테마 핸들러에 먼저 위임 (각 테마가 자신의 액션을 처리)
    const handlers = Object.values(window.THEME_EFFECT_HANDLERS || {});
    for (const h of handlers) {
      if (typeof h.handleOpAction === 'function') h.handleOpAction(action);
    }

    // 새 액션 타입 처리
    switch (action.type) {
      case 'forceReturnHand': {
        // 상대가 내 패를 덱으로 되돌림 — 내가 선택
        const count = Math.min(action.count || 1, G.myHand.length);
        if (count === 0) break;
        openCardPicker([...G.myHand], `${action.reason || '효과'}: 패 ${count}장 덱으로`, count, (sel) => {
          sel.sort((a, b) => b - a).forEach(i => {
            if (G.myHand[i]) {
              const c = G.myHand.splice(i, 1)[0];
              G.myDeck.push({ id: c.id, name: c.name });
            }
          });
          log(`${action.reason || '효과'}: 패 ${sel.length}장 덱으로`, 'opponent');
          sendGameState(); renderAll();
        });
        return; // 원본 핸들러 스킵
      }
      case 'forceExileHandCard': {
        // 상대가 내 패를 제외 (호랑이의 발톱/일격)
        const count = Math.min(action.count || 1, G.myHand.length);
        if (count === 0) break;
        openCardPicker([...G.myHand], `${action.reason || '효과'}: 패 ${count}장 제외`, count, (sel) => {
          sel.sort((a, b) => b - a).forEach(i => {
            if (G.myHand[i]) G.myExile.push(G.myHand.splice(i, 1)[0]);
          });
          log(`${action.reason || '효과'}: 패 ${sel.length}장 제외됨`, 'opponent');
          sendGameState(); renderAll();
        });
        return;
      }
      case 'opDraw': {
        // 상대 효과로 내가 드로우 (에이스 라이거 ②)
        const n = action.count || 1;
        for (let i = 0; i < n; i++) { if (typeof drawOne === 'function') drawOne(); }
        log(`상대 효과: ${n}장 드로우`, 'opponent');
        sendGameState(); renderAll();
        return;
      }
      case 'opExtraSlots':
        // lion.js handleLionOpAction에서 처리됨 — 여기선 중복 방지를 위해 스킵
        return;
      case 'tigerZoneBan':
        // tiger.js handleTigerOpAction에서 처리됨
        return;
      case 'opGraveMassExile':
        // liger.js handleLigerOpAction에서 처리됨
        return;
      default:
        break;
    }

    // 나머지는 원본 핸들러에 위임
    _orig.apply(this, arguments);
  };
})();

// 4. 소환 트리거 브로드캐스트 — summonFromDeck / summonFromGrave 후킹
// ligerKingBanSummon 소환 차단도 여기서 처리
(function _patchSummonTriggers() {
  const _fireOnSummoned = (cardId) => {
    const card = CARDS[cardId];
    if (!card || !card.theme) return;
    const handler = window.THEME_EFFECT_HANDLERS?.[card.theme];
    if (handler && typeof handler.onSummoned === 'function') {
      // 약간 딜레이를 줘서 소환 처리가 완료된 후 트리거
      setTimeout(() => handler.onSummoned(cardId), 50);
    }
  };

  const _origFromDeck = typeof summonFromDeck === 'function' ? summonFromDeck : null;
  if (_origFromDeck) {
    summonFromDeck = function (cardId) {
      if (G.ligerKingBanSummon) { notify('라이거 킹 ④: 이 턴에는 소환할 수 없습니다.'); return; }
      _origFromDeck(cardId);
      _fireOnSummoned(cardId);
    };
  }

  const _origFromGrave = typeof summonFromGrave === 'function' ? summonFromGrave : null;
  if (_origFromGrave) {
    summonFromGrave = function (cardId) {
      if (G.ligerKingBanSummon) { notify('라이거 킹 ④: 이 턴에는 소환할 수 없습니다.'); return; }
      _origFromGrave(cardId);
      _fireOnSummoned(cardId);
    };
  }
})();

// 5. loadPreset 패치 — 라이온/타이거/라이거 기본 덱 추가
(function _patchLoadPreset() {
  const _orig = typeof loadPreset === 'function' ? loadPreset : null;
  if (!_orig) { console.warn('lion_tiger_liger_patch: loadPreset not found'); return; }

  loadPreset = function (theme) {
    if (theme === '라이온') {
      builderMainDeck = {
        '베이비 라이온': 4, '젊은 라이온': 4, '에이스 라이온': 4,
        '사자의 포효': 4, '사자의 사냥': 4, '사자의 발톱': 4,
        '사자의 일격': 4, '진정한 사자': 4,
        '구사일생': 2, '눈에는 눈': 2, '출입통제': 2,
      };
      builderKeyDeck = {
        '라이온 킹': 1, '고고한 사자': 1,
        '일격필살': 1, '단 한번의 기회': 1,
      };
      notify('라이온 기본 덱 로드!');
    } else if (theme === '타이거') {
      builderMainDeck = {
        '베이비 타이거': 4, '젊은 타이거': 4, '에이스 타이거': 4,
        '호랑이의 포효': 4, '호랑이의 사냥': 4, '호랑이의 발톱': 4,
        '호랑이의 일격': 4, '진정한 호랑이': 4,
        '구사일생': 2, '눈에는 눈': 2, '출입통제': 2,
      };
      builderKeyDeck = {
        '타이거 킹': 1, '고고한 호랑이': 1,
        '일격필살': 1, '단 한번의 기회': 1,
      };
      notify('타이거 기본 덱 로드!');
    } else if (theme === '라이거') {
      builderMainDeck = {
        '화합의 시대의 라이거': 4,
        '베이비 라이거': 4, '젊은 라이거': 4, '에이스 라이거': 4,
        '모두의 자연': 4,               // 베이비 라이거 ②의 핵심 카드
        '베이비 라이온': 2, '젊은 라이온': 2,
        '베이비 타이거': 2, '젊은 타이거': 2,
        '사자의 일격': 2, '호랑이의 일격': 2,
        '눈에는 눈': 2, '구사일생': 2,
      };
      builderKeyDeck = {
        '라이거 킹': 1, '라이온 킹': 1, '타이거 킹': 1,
        '일격필살': 1, '단 한번의 기회': 1,
      };
      notify('라이거 기본 덱 로드!');
    } else {
      _orig(theme);
      return;
    }
    renderBuilderDeck();
    filterDeckPool(currentPoolFilter);
  };
})();
