// continuous_effects.js
// ─────────────────────────────────────────────
// 지속효과 / 잔존효과 레이어 + 대상/비대상 구분
//
// 지속효과 (G.continuousEffects[]):
//   - 카드가 필드에 존재하는 한 유지
//   - 언제든 체인으로 무효화 가능 (무효화 시점 제한 없음)
//   - 카드가 필드를 떠나면 자동 제거
//
// 잔존효과 (G.lingering[]):
//   - 발동 시점이 지나면 무효 불가
//   - 턴 종료 시 만료 (duration: 'turn') 또는 게임 종료까지 (duration: 'game')
//   - 예: 황금사과, exileBan, tigerZonePermanent, ligerKingBanSummon
//
// 대상 지정 여부:
//   - sendAction에 isTargeting: true/false 추가
//   - opFieldRemove/opFieldExile 수신 시 내성 체크에 사용
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// G 초기화 확장
// ─────────────────────────────────────────────
(function _initEffectLayers() {
  const _origEnterGame = typeof enterGame === 'function' ? enterGame : null;
  if (!_origEnterGame) { console.warn('continuous_effects: enterGame not found'); return; }
  enterGame = function () {
    _origEnterGame.apply(this, arguments);
    G.continuousEffects = []; // { cardId, sourceId, effect, negated }
    G.lingering         = []; // { id, effect, duration, owner }
  };
})();

// ─────────────────────────────────────────────
// 지속효과 등록 / 해제
// ─────────────────────────────────────────────

// effect: 문자열 키 (아래 CONTINUOUS_EFFECT_CHECKS에서 처리)
function registerContinuousEffect(cardId, effect) {
  if (!G.continuousEffects) G.continuousEffects = [];
  // 중복 방지
  if (G.continuousEffects.some(e => e.cardId === cardId && e.effect === effect)) return;
  G.continuousEffects.push({ cardId, effect, negated: false });
  log(`지속효과 등록: ${cardId} — ${effect}`, 'mine');
}

function removeContinuousEffect(cardId, effect = null) {
  if (!G.continuousEffects) return;
  G.continuousEffects = effect
    ? G.continuousEffects.filter(e => !(e.cardId === cardId && e.effect === effect))
    : G.continuousEffects.filter(e => e.cardId !== cardId);
}

function negateContinuousEffect(cardId, effect = null) {
  if (!G.continuousEffects) return;
  G.continuousEffects.forEach(e => {
    if (e.cardId === cardId && (!effect || e.effect === effect)) e.negated = true;
  });
  log(`지속효과 무효: ${cardId}${effect ? ' — ' + effect : ''}`, 'mine');
}

function unnegateContinuousEffect(cardId, effect = null) {
  if (!G.continuousEffects) return;
  G.continuousEffects.forEach(e => {
    if (e.cardId === cardId && (!effect || e.effect === effect)) e.negated = false;
  });
}

function hasContinuousEffect(effect, onMyField = true) {
  if (!G.continuousEffects) return false;
  const field = onMyField ? G.myField : G.opField;
  return G.continuousEffects.some(e =>
    e.effect === effect &&
    !e.negated &&
    field.some(m => m.id === e.cardId)
  );
}

// 카드가 필드를 떠날 때 자동으로 지속효과 제거
(function _hookContinuousEffectCleanup() {
  // myField.splice 후킹은 복잡하므로, sendToGrave/opFieldRemove 처리 후에 정리
  const _origSendToGrave = typeof sendToGrave === 'function' ? sendToGrave : null;
  if (!_origSendToGrave) return;
  sendToGrave = function (cardId, from) {
    _origSendToGrave.apply(this, arguments);
    removeContinuousEffect(cardId);
  };
})();

// ─────────────────────────────────────────────
// 잔존효과 등록 / 해제
// ─────────────────────────────────────────────

function registerLingering(id, effect, duration = 'turn') {
  if (!G.lingering) G.lingering = [];
  if (G.lingering.some(l => l.id === id && l.effect === effect)) return;
  G.lingering.push({ id, effect, duration, owner: myRole });
}

function hasLingering(effect) {
  if (!G.lingering) return false;
  return G.lingering.some(l => l.effect === effect);
}

function removeLingering(id, effect = null) {
  if (!G.lingering) return;
  G.lingering = effect
    ? G.lingering.filter(l => !(l.id === id && l.effect === effect))
    : G.lingering.filter(l => l.id !== id);
}

// ─────────────────────────────────────────────
// resetTurnEffects 통합 후킹
// 잔존효과 중 duration:'turn'인 것을 모두 만료
// ─────────────────────────────────────────────
(function _patchResetTurnEffects() {
  const _orig = typeof resetTurnEffects === 'function' ? resetTurnEffects : null;
  if (!_orig) { console.warn('continuous_effects: resetTurnEffects not found'); return; }
  resetTurnEffects = function () {
    _orig.apply(this, arguments);

    // 잔존효과 만료
    if (G.lingering) {
      G.lingering = G.lingering.filter(l => l.duration !== 'turn');
    }

    // 턴 제한 플래그들 (기존 코드와 중복 방지를 위해 조건부로만 리셋)
    // goldenAppleActive — 잔존효과이므로 lingering으로 관리, 여기서 리셋
    if (!hasLingering('goldenApple')) G.goldenAppleActive = false;
    if (!hasLingering('exileBan'))    G.exileBanActive    = false;
    if (!hasLingering('ligerKingBanSummon')) G.ligerKingBanSummon = false;
    if (!hasLingering('nyarlathotepLimit'))  G.nyarlathotepSummonLimit = false;

    // ligerKingBanSummon은 턴 종료 리셋
    G.ligerKingBanSummon = false;

    log('[잔존효과 만료] 턴 종료', 'system');
  };
})();

// ─────────────────────────────────────────────
// 대상/비대상 구분 — opFieldRemove/opFieldExile에 isTargeting 추가
// ─────────────────────────────────────────────

// 대상 지정 효과로 필드 카드 제거 (기존 sendAction wrapper)
function sendTargetedRemove(cardId, to = 'grave') {
  sendAction({ type: 'opFieldRemove', cardId, to, isTargeting: true });
}

// 비대상 효과로 필드 카드 제거 (AoE, 일괄 등)
function sendUntargetedRemove(cardId, to = 'grave') {
  sendAction({ type: 'opFieldRemove', cardId, to, isTargeting: false });
}

// ─────────────────────────────────────────────
// 내성 체크 시스템
// handleOpponentAction의 opFieldRemove/opFieldExile 앞에서 체크
// ─────────────────────────────────────────────

// 반환값: true = 내성으로 차단됨, false = 정상 처리
function checkFieldRemoveImmunity(cardId, isTargeting) {
  const card = CARDS[cardId];
  if (!card) return false;

  // 아자토스: 다른 카드의 효과를 받지 않음 (대상/비대상 모두 차단)
  if (cardId === '아우터 갓-아자토스' && G.myField.some(m => m.id === cardId)) {
    if (!hasContinuousEffect('azathothImmunity', true)) {
      // 지속효과가 무효화됐으면 차단 안 함
    } else {
      log('아자토스 ①: 다른 카드의 효과를 받지 않음 — 무효!', 'mine');
      notify('아우터 갓-아자토스는 다른 카드의 효과를 받지 않습니다.');
      return true;
    }
  }

  // 슈브 니구라스: 상대 카드의 효과를 받지 않음 (대상/비대상 모두)
  if (cardId === '아우터 갓 슈브 니구라스' && G.myField.some(m => m.id === cardId)) {
    if (hasContinuousEffect('shubImmunity', true)) {
      log('슈브 니구라스 ③: 상대 카드의 효과를 받지 않음 — 무효!', 'mine');
      notify('아우터 갓 슈브 니구라스는 상대 카드의 효과를 받지 않습니다.');
      return true;
    }
  }

  // 펭귄의 전설 ③: "대상으로 하지 않는 효과를 받지 않는다"
  // → 비대상 효과만 차단, 대상 지정 효과는 정상 처리
  if (cardId === '펭귄의 전설' && G.myField.some(m => m.id === cardId)) {
    if (!isTargeting) {
      log('펭귄의 전설 ③: 비대상 효과 차단!', 'mine');
      notify('펭귄의 전설 ③: 대상으로 하지 않는 효과를 받지 않습니다.');
      return true;
    }
    // 대상 지정 효과는 정상 처리 (기존 checkPenguinLegendImmunity는 오류였음)
  }

  // 히프노스 ②: 상대는 자신 필드의 다른 카드를 대상으로 할 수 없음
  // (히프노스 자신은 제외 — 다른 카드 보호)
  if (isTargeting && cardId !== '엘더 갓-히프노스' && G.myField.some(m => m.id === cardId)) {
    if (hasContinuousEffect('hypnosProtect', true)) {
      log(`히프노스 ②: ${CARDS[cardId]?.name || cardId}는 대상 지정 불가!`, 'mine');
      notify(`히프노스 ②: 이 카드를 대상으로 하는 효과는 발동할 수 없습니다.`);
      return true;
    }
  }

  return false;
}

// handleOpponentAction 후킹 — 내성 체크 레이어 삽입
(function _patchHandleOpponentActionImmunity() {
  const _orig = typeof handleOpponentAction === 'function' ? handleOpponentAction : null;
  if (!_orig) { console.warn('continuous_effects: handleOpponentAction not found'); return; }

  handleOpponentAction = function (action) {
    if (action.type === 'opFieldRemove' || action.type === 'opFieldExile') {
      const isTargeting = action.isTargeting !== false; // 기본값 true (기존 코드 호환)
      if (checkFieldRemoveImmunity(action.cardId, isTargeting)) return;
    }
    _orig.apply(this, arguments);
  };
})();

// ─────────────────────────────────────────────
// 공격 대상 내성 체크
// executeCombat 앞에서 슈브 니구라스/히프노스 체크
// ─────────────────────────────────────────────
(function _patchExecuteCombatImmunity() {
  const _orig = typeof executeCombat === 'function' ? executeCombat : null;
  if (!_orig) return;

  executeCombat = function (atkIdx, defIdx) {
    const defender = G.opField[defIdx];
    if (defender) {
      // 슈브 니구라스: 공격 대상이 되지 않음 (상대 필드의 슈브 니구라스를 공격하려 할 때)
      // 여기서 G.opField는 상대 필드이므로, 상대가 슈브 니구라스를 가지고 있고
      // 상대의 지속효과를 우리가 알 수 없으므로 sendAction으로 확인 요청
      // → 간소화: 단순히 로그 경고만 (양측이 각자 판단)
    }
    _orig.apply(this, arguments);
  };
})();

// ─────────────────────────────────────────────
// 지속효과 자동 등록 — 카드가 필드에 올라올 때
// ─────────────────────────────────────────────

// 기존 onCthulhuSummoned, onLionSummoned, onTigerSummoned 등에서
// 해당 카드의 지속효과를 등록
(function _patchOnSummonedForContinuous() {
  const CONTINUOUS_ON_SUMMON = {
    '아우터 갓-아자토스':       ['azathothImmunity'],
    '아우터 갓 슈브 니구라스':  ['shubImmunity'],
    '엘더 갓-히프노스':         ['hypnosProtect'],
    '타이거 킹':                ['tigerZoneBlock'],
    '젊은 타이거':              ['tigerZoneBlock'],
    '에이스 타이거':            ['tigerZoneBlock'],
  };

  // patch.js의 _fireOnSummoned 이후에도 여기서 처리
  const _origFireOnSummoned = window._fireOnSummoned;

  // summonFromDeck/summonFromGrave/패에서 소환 모두 커버하기 위해
  // G.myField.push를 후킹
  const origPush = G.myField.push.bind(G.myField);
  G.myField.push = function (...items) {
    const result = origPush(...items);
    items.forEach(item => {
      if (!item?.id) return;
      const effects = CONTINUOUS_ON_SUMMON[item.id];
      if (effects) effects.forEach(e => registerContinuousEffect(item.id, e));

      // 젊은 라이거 ③: 라이온 킹/타이거 킹/라이거 킹 ATK +1
      if (item.id === '젊은 라이거') _applyYoungLigerBonus();

      // 타이거 킹 ④: 다른 몬스터 없으면 묘지로 보내지지 않음
      // → 지속효과로 등록, sendToGrave 차단에서 처리
    });
    return result;
  };

  // myField.splice 후킹 — 카드 퇴장 시 지속효과 제거
  const origSplice = G.myField.splice.bind(G.myField);
  G.myField.splice = function (start, deleteCount, ...items) {
    // 제거될 카드들의 지속효과 정리
    const removed = G.myField.slice(start, start + (deleteCount ?? G.myField.length));
    const result = origSplice(start, deleteCount, ...items);
    removed.forEach(item => {
      if (!item?.id) return;
      removeContinuousEffect(item.id);
      // 젊은 라이거 ③ 보너스 재계산
      if (item.id === '젊은 라이거') _revertYoungLigerBonus(item.id);
    });
    return result;
  };
})();

// ─────────────────────────────────────────────
// 젊은 라이거 ③: 라이온 킹/타이거 킹/라이거 킹 ATK +1 (지속효과)
// ─────────────────────────────────────────────
const YOUNG_LIGER_BONUS_TARGETS = new Set(['라이온 킹', '타이거 킹', '라이거 킹']);
const _youngLigerBoosted = new Set(); // 이미 보너스 받은 카드 id

function _applyYoungLigerBonus() {
  G.myField.forEach(m => {
    if (YOUNG_LIGER_BONUS_TARGETS.has(m.id) && !_youngLigerBoosted.has(m.id)) {
      m.atk = (m.atk || 0) + 1;
      _youngLigerBoosted.add(m.id);
      log(`젊은 라이거 ③: ${m.name} ATK +1 → ${m.atk}`, 'mine');
    }
  });
  renderAll();
}

function _revertYoungLigerBonus() {
  // 젊은 라이거가 필드를 떠날 때: 아직 필드에 남은 카드에서 보너스 제거
  const stillYoungLiger = G.myField.some(m => m.id === '젊은 라이거');
  if (stillYoungLiger) return; // 아직 다른 젊은 라이거가 있으면 유지
  G.myField.forEach(m => {
    if (YOUNG_LIGER_BONUS_TARGETS.has(m.id) && _youngLigerBoosted.has(m.id)) {
      m.atk = Math.max(0, (m.atk || 0) - 1);
      _youngLigerBoosted.delete(m.id);
      log(`젊은 라이거 ③ 해제: ${m.name} ATK -1 → ${m.atk}`, 'mine');
    }
  });
  renderAll();
}

// ─────────────────────────────────────────────
// 타이거 킹 ④: 다른 몬스터 없으면 묘지로 보내지지 않음
// ─────────────────────────────────────────────
(function _patchTigerKingImmortality() {
  const _prev = typeof sendToGrave === 'function' ? sendToGrave : null;
  if (!_prev) return;
  sendToGrave = function (cardId, from) {
    if (cardId === '타이거 킹' && from !== 'exile') {
      const otherMons = G.myField.filter(m => m.id !== '타이거 킹');
      if (otherMons.length === 0 && G.myField.some(m => m.id === '타이거 킹')) {
        log('타이거 킹 ④: 다른 몬스터 없음 — 묘지로 보내지지 않는다!', 'mine');
        notify('타이거 킹 ④: 다른 몬스터가 없으므로 묘지로 보낼 수 없습니다.');
        return; // 차단
      }
    }
    _prev.apply(this, arguments);
  };
})();

// ─────────────────────────────────────────────
// 황금사과 잔존효과 재등록 — 기존 코드와 연동
// activateCard에서 황금사과 발동 시 lingering에도 등록
// ─────────────────────────────────────────────
(function _patchGoldenAppleLingering() {
  // 황금사과는 index.html에서 G.goldenAppleActive = true로 세팅됨
  // G.goldenAppleActive setter를 Proxy로 후킹
  let _goldenAppleVal = false;
  Object.defineProperty(G, 'goldenAppleActive', {
    get() { return _goldenAppleVal; },
    set(v) {
      _goldenAppleVal = v;
      if (v) {
        registerLingering('goldenApple', 'goldenApple', 'turn');
        log('황금사과 잔존효과 등록 (턴 종료까지)', 'mine');
      } else {
        removeLingering('goldenApple', 'goldenApple');
      }
    },
    configurable: true,
  });
})();

// ─────────────────────────────────────────────
// exileBanActive 잔존효과 연동
// ─────────────────────────────────────────────
(function _patchExileBanLingering() {
  let _exileBanVal = false;
  Object.defineProperty(G, 'exileBanActive', {
    get() { return _exileBanVal; },
    set(v) {
      _exileBanVal = v;
      if (v) {
        registerLingering('exileBan', 'exileBan', 'turn');
        log('제외 봉인 잔존효과 등록 (턴 종료까지)', 'mine');
      } else {
        removeLingering('exileBan', 'exileBan');
      }
    },
    configurable: true,
  });
})();

// ─────────────────────────────────────────────
// 슈브 니구라스/아자토스 지속효과 sendToGrave 차단
// (cthulhu.js의 checkAzathothImmunity와 통합)
// ─────────────────────────────────────────────
(function _patchContinuousImmunityOnGrave() {
  const _prev = typeof sendToGrave === 'function' ? sendToGrave : null;
  if (!_prev) return;
  sendToGrave = function (cardId, from) {
    // 슈브 니구라스: 상대 카드의 효과를 받지 않음 (묘지로 보내는 건 전투 혹은 자신 효과만 허용)
    // from이 'opEffect'면 차단 — 현재 엔진엔 이 구분이 없어서 지속효과 체크로 대체
    if (cardId === '아우터 갓 슈브 니구라스' && hasContinuousEffect('shubImmunity', true)) {
      log('슈브 니구라스 ③: 상대 효과로 묘지 차단', 'mine');
      notify('아우터 갓 슈브 니구라스는 상대 카드의 효과를 받지 않습니다.');
      return;
    }
    _prev.apply(this, arguments);
  };
})();

// ─────────────────────────────────────────────
// 지속효과 무효화 액션 처리 (상대가 무효화했을 때)
// ─────────────────────────────────────────────
(function _patchContinuousNegateAction() {
  const _orig = typeof handleOpponentAction === 'function' ? handleOpponentAction : null;
  if (!_orig) return;
  handleOpponentAction = function (action) {
    if (action.type === 'negateContinuous') {
      negateContinuousEffect(action.cardId, action.effect || null);
      log(`상대가 ${action.cardId}의 지속효과 무효화`, 'opponent');
      renderAll();
      return;
    }
    if (action.type === 'unnegateContinuous') {
      unnegateContinuousEffect(action.cardId, action.effect || null);
      renderAll();
      return;
    }
    _orig.apply(this, arguments);
  };
})();

// ─────────────────────────────────────────────
// 내보내기 — 다른 파일에서 사용할 수 있도록
// ─────────────────────────────────────────────
window.registerContinuousEffect   = registerContinuousEffect;
window.removeContinuousEffect     = removeContinuousEffect;
window.negateContinuousEffect     = negateContinuousEffect;
window.unnegateContinuousEffect   = unnegateContinuousEffect;
window.hasContinuousEffect        = hasContinuousEffect;
window.registerLingering          = registerLingering;
window.hasLingering               = hasLingering;
window.removeLingering            = removeLingering;
window.sendTargetedRemove         = sendTargetedRemove;
window.sendUntargetedRemove       = sendUntargetedRemove;
window.checkFieldRemoveImmunity   = checkFieldRemoveImmunity;
