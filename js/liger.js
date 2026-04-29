// liger.js — 라이거 테마 효과 엔진

function _isLigerCard(dc) {
  return ['라이거', '라이온', '타이거'].includes(CARDS[dc.id]?.theme);
}
function _isSajaCard(dc) {
  return dc.id.includes('사자') || ['사자의 포효','사자의 사냥','사자의 발톱','사자의 일격','진정한 사자','고고한 사자'].includes(dc.id);
}
function _isHorangCard(dc) {
  return dc.id.includes('호랑이') || ['호랑이의 포효','호랑이의 사냥','호랑이의 발톱','호랑이의 일격','진정한 호랑이','고고한 호랑이'].includes(dc.id);
}
function _updateLionSlotsIfExists() {
  if (typeof _updateLionSlots === 'function') _updateLionSlots();
}

// ─────────────────────────────────────────────
// 화합의 시대의 라이거 ①
// ─────────────────────────────────────────────
function activateHwahapLiger1(handIdx) {
  if (!canUseEffect('화합의 시대의 라이거', 1)) { notify('이미 사용했습니다.'); return; }
  if (!isMyTurn || currentPhase !== 'deploy') { notify('자신 전개 단계에만 발동 가능합니다.'); return; }
  markEffectUsed('화합의 시대의 라이거', 1);
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);

  const deckLiger = findAllInDeck(dc => CARDS[dc.id]?.theme === '라이거' && CARDS[dc.id]?.cardType === 'monster');
  if (deckLiger.length === 0) { notify('덱에 라이거 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }

  openCardPicker(deckLiger, '화합의 시대의 라이거: 덱에서 라이거 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) summonFromDeck(deckLiger[sel[0]].id);

    const handLiger = G.myHand.filter(h => CARDS[h.id]?.theme === '라이거' && CARDS[h.id]?.cardType === 'monster');
    if (handLiger.length === 0) { sendGameState(); renderAll(); return; }
    gameConfirm('패에서 라이거 몬스터를 추가 소환하겠습니까? (ATK -1)', (yes) => {
      if (!yes) { sendGameState(); renderAll(); return; }
      openCardPicker(handLiger, '화합의 시대의 라이거: 패에서 라이거 소환 (ATK -1)', 1, (sel2) => {
        if (sel2.length > 0) {
          const target = handLiger[sel2[0]];
          const hi = G.myHand.findIndex(h => h === target);
          if (hi >= 0) {
            const mon = G.myHand.splice(hi, 1)[0];
            const baseAtk = CARDS[mon.id]?.atk ?? 4;
            G.myField.push({ id: mon.id, name: mon.name, atk: Math.max(0, baseAtk - 1), atkBase: baseAtk });
            log(`화합의 시대의 라이거: ${mon.name} 소환 (ATK ${Math.max(0, baseAtk - 1)})`, 'mine');
          }
        }
        sendGameState(); renderAll();
      });
    });
  });
}

// ─────────────────────────────────────────────
// 베이비 라이거 ①: handIdx 기반으로 버리기 처리
// ─────────────────────────────────────────────
function activateBabyLiger1(handIdx) {
  if (!canUseEffect('베이비 라이거', 1)) { notify('이미 사용했습니다.'); return; }
  if (!G.myHand[handIdx]) return;
  markEffectUsed('베이비 라이거', 1);

  gameConfirm('베이비 라이거 ①: 버리고 발동하겠습니까? (취소 = 공개만)', (discard) => {
    if (discard) {
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
    } else {
      G.myHand[handIdx].isPublic = true;
    }

    const lionDeck  = findAllInDeck(dc => CARDS[dc.id]?.theme === '라이온' && CARDS[dc.id]?.cardType === 'monster');
    const tigerDeck = findAllInDeck(dc => CARDS[dc.id]?.theme === '타이거' && CARDS[dc.id]?.cardType === 'monster');

    const doSelfSummon = () => {
      // 베이비 라이거가 아직 패에 있을 때만 소환 가능
      const idx2 = G.myHand.findIndex(h => h.id === '베이비 라이거');
      if (idx2 < 0) { sendGameState(); renderAll(); return; }
      gameConfirm('베이비 라이거 ①: 자신을 소환하겠습니까?', (yes) => {
        if (yes) {
          const mon = G.myHand.splice(idx2, 1)[0];
          G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 4, atkBase: CARDS[mon.id]?.atk ?? 4 });
          log('베이비 라이거 ①: 자신 소환', 'mine');
        }
        sendGameState(); renderAll();
      });
    };

    const pickTiger = () => {
      if (tigerDeck.length === 0) { doSelfSummon(); return; }
      openCardPicker(tigerDeck, '베이비 라이거 ①: 덱에서 타이거 몬스터 소환', 1, (sel) => {
        if (sel.length > 0) summonFromDeck(tigerDeck[sel[0]].id);
        doSelfSummon();
      });
    };

    if (lionDeck.length === 0) { pickTiger(); return; }
    openCardPicker(lionDeck, '베이비 라이거 ①: 덱에서 라이온 몬스터 소환', 1, (sel) => {
      if (sel.length > 0) summonFromDeck(lionDeck[sel[0]].id);
      pickTiger();
    });
  });
}

// 베이비 라이거 ②: 소환 시 → 덱에서 모두의 자연 필드 존에
function activateBabyLiger2() {
  if (!canUseEffect('베이비 라이거', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('베이비 라이거', 2);
  const found = findAllInDeck(dc => dc.id === '모두의 자연');
  if (found.length > 0) {
    removeFromDeck('모두의 자연');
    G.myFieldCard = { id: '모두의 자연', name: '모두의 자연' };
    log('베이비 라이거 ②: 모두의 자연 필드 존에 배치', 'mine');
    sendGameState(); renderAll();
  } else {
    notify('덱에 모두의 자연이 없습니다.');
  }
}

// ─────────────────────────────────────────────
// 젊은 라이거
// ─────────────────────────────────────────────
function activateYoungLiger1() {
  if (!canUseEffect('젊은 라이거', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('젊은 라이거', 1);
  const sajaDeck   = findAllInDeck(_isSajaCard);
  const horangDeck = findAllInDeck(_isHorangCard);
  const pickHorang = () => {
    if (horangDeck.length === 0) { sendGameState(); renderAll(); return; }
    openCardPicker(horangDeck, '젊은 라이거 ①: 호랑이 카드 서치', 1, (sel) => {
      if (sel.length > 0) searchToHand(horangDeck[sel[0]].id);
      sendGameState(); renderAll();
    });
  };
  if (sajaDeck.length === 0) { pickHorang(); return; }
  openCardPicker(sajaDeck, '젊은 라이거 ①: 사자 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(sajaDeck[sel[0]].id);
    pickHorang();
  });
}

function activateYoungLiger2() {
  if (!canUseEffect('젊은 라이거', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('젊은 라이거', 2);
  const ligerDeck = findAllInDeck(dc => CARDS[dc.id]?.theme === '라이거');
  if (ligerDeck.length === 0) { notify('덱에 라이거 카드가 없습니다.'); return; }
  openCardPicker(ligerDeck, '젊은 라이거 ②: 덱에서 라이거 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(ligerDeck[sel[0]].id);
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 에이스 라이거
// ① 묘지로 보내졌을 때 발동 — 패에서는 발동 불가
// ─────────────────────────────────────────────
function activateAceLiger1FromGrave() {
  if (!canUseEffect('에이스 라이거', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('에이스 라이거', 1);
  const gi = G.myGrave.findIndex(g => g.id === '에이스 라이거');
  if (gi >= 0) {
    const mon = G.myGrave.splice(gi, 1)[0];
    G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 6, atkBase: CARDS[mon.id]?.atk ?? 6 });
    log('에이스 라이거 ①: 묘지에서 소환', 'mine');
  }
  if (G.opField.length === 0) { sendGameState(); renderAll(); return; }
  gameConfirm('에이스 라이거 ①: 상대 필드 1장 제외?', (yes) => {
    if (!yes) { sendGameState(); renderAll(); return; }
    openCardPicker([...G.opField], '에이스 라이거 ①: 제외할 상대 카드', 1, (sel) => {
      if (sel.length > 0) {
        const mon = G.opField.splice(sel[0], 1)[0];
        G.opExile.push(mon);
        sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
        log(`에이스 라이거 ①: ${mon.name} 제외`, 'mine');
      }
      sendGameState(); renderAll();
    });
  });
}

// ② 소환 시 → 자신 필드 몬스터 수만큼 상대 패 덱으로 + 상대 1장 드로우
function activateAceLiger2() {
  if (!canUseEffect('에이스 라이거', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('에이스 라이거', 2);
  const count = Math.min(G.myField.length, G.opHand.length);
  if (count > 0) {
    sendAction({ type: 'forceReturnHand', count, reason: '에이스 라이거 ②' });
    log(`에이스 라이거 ②: 상대 패 ${count}장 덱으로 + 드로우`, 'mine');
    sendAction({ type: 'opDraw', count: 1 });
  }
  sendGameState(); renderAll();
}

// ③ 자신/상대 전개 단계 — 묘지의 모두의 자연을 필드 존에
function activateAceLiger3() {
  if (!canUseEffect('에이스 라이거', 3)) { notify('이미 사용했습니다.'); return; }
  if (currentPhase !== 'deploy') { notify('에이스 라이거 ③: 전개 단계에만 발동 가능합니다.'); return; }
  const found = G.myGrave.findIndex(g => g.id === '모두의 자연');
  if (found < 0) { notify('묘지에 모두의 자연이 없습니다.'); return; }
  markEffectUsed('에이스 라이거', 3);
  G.myGrave.splice(found, 1);
  G.myFieldCard = { id: '모두의 자연', name: '모두의 자연' };
  log('에이스 라이거 ③: 묘지에서 모두의 자연 필드 존에 배치', 'mine');
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 모두의 자연
// 필드 마법 — 필드 존에 있을 때 효과 발동 (패 발동 아님)
// ① 전개 단계: 묘지/제외 라이거 카드 1장 패로, 상대 일반 패 1장 버리기
// ② 이 카드 묻고 → 사자/호랑이 함정 서치
// ─────────────────────────────────────────────
function activateModuJayeon1() {
  if (!canUseEffect('모두의 자연', 1)) { notify('이미 사용했습니다.'); return; }
  if (!isMyTurn || currentPhase !== 'deploy') { notify('자신 전개 단계에만 발동 가능합니다.'); return; }
  if (!G.myFieldCard || G.myFieldCard.id !== '모두의 자연') { notify('모두의 자연이 필드 존에 없습니다.'); return; }
  markEffectUsed('모두의 자연', 1);

  const pool = [
    ...G.myGrave.filter(g => CARDS[g.id]?.theme === '라이거'),
    ...G.myExile.filter(e => CARDS[e.id]?.theme === '라이거'),
  ];
  if (pool.length === 0) { notify('묘지/제외 상태의 라이거 카드가 없습니다.'); return; }

  openCardPicker(pool, '모두의 자연 ①: 묘지/제외 라이거 카드 패로', 1, (sel) => {
    if (sel.length > 0) {
      const card = pool[sel[0]];
      const gi = G.myGrave.findIndex(g => g === card);
      const ei = G.myExile.findIndex(e => e === card);
      if (gi >= 0) G.myHand.push(G.myGrave.splice(gi, 1)[0]);
      else if (ei >= 0) G.myHand.push(G.myExile.splice(ei, 1)[0]);
      log(`모두의 자연 ①: ${card.name} 패로`, 'mine');
    }
    sendAction({ type: 'forceDiscard', count: 1, reason: '모두의 자연 ①', attackerPicks: true });
    sendGameState(); renderAll();
  });
}

function activateModuJayeon2() {
  if (!canUseEffect('모두의 자연', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.myFieldCard || G.myFieldCard.id !== '모두의 자연') { notify('모두의 자연이 필드 존에 없습니다.'); return; }
  markEffectUsed('모두의 자연', 2);
  // 필드 존에서 묘지로
  const fc = G.myFieldCard;
  G.myFieldCard = null;
  G.myGrave.push(fc);
  log('모두의 자연 ②: 필드에서 묘지로', 'mine');

  const trapPool = findAllInDeck(dc => {
    const cd = CARDS[dc.id];
    return cd?.cardType === 'trap' && (_isSajaCard(dc) || _isHorangCard(dc));
  });
  if (trapPool.length === 0) { notify('덱에 사자/호랑이 함정 카드가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(trapPool, '모두의 자연 ②: 사자/호랑이 함정 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(trapPool[sel[0]].id);
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 라이거 킹
// ─────────────────────────────────────────────
function activateLigerKing1(handIdx) {
  if (!canUseEffect('라이거 킹', 1)) { notify('이미 사용했습니다.'); return; }
  const lionKing  = G.myField.find(m => m.id === '라이온 킹') || G.myGrave.find(g => g.id === '라이온 킹');
  const tigerKing = G.myField.find(m => m.id === '타이거 킹') || G.myGrave.find(g => g.id === '타이거 킹');
  if (!lionKing)  { notify('라이거 킹 ①: 라이온 킹이 필드/묘지에 필요합니다.'); return; }
  if (!tigerKing) { notify('라이거 킹 ①: 타이거 킹이 필드/묘지에 필요합니다.'); return; }
  markEffectUsed('라이거 킹', 1);

  // 필드에 있으면 묻기
  const lfi = G.myField.findIndex(m => m.id === '라이온 킹');
  if (lfi >= 0) { G.myGrave.push(G.myField.splice(lfi, 1)[0]); _updateLionSlotsIfExists(); }
  const tfi = G.myField.findIndex(m => m.id === '타이거 킹');
  if (tfi >= 0) { G.myGrave.push(G.myField.splice(tfi, 1)[0]); }
  log('라이거 킹 ①: 라이온 킹 + 타이거 킹 묘지 → 라이거 킹 소환', 'mine');

  const c = G.myHand.splice(handIdx, 1)[0];
  G.myField.push({ id: c.id, name: c.name, atk: CARDS[c.id]?.atk ?? 8, atkBase: CARDS[c.id]?.atk ?? 8 });

  if (canUseEffect('라이거 킹', 2) && G.opField.length > 0) {
    gameConfirm('라이거 킹 ②: 상대 필드 전부 제외?', (yes) => {
      if (yes) {
        markEffectUsed('라이거 킹', 2);
        while (G.opField.length > 0) {
          const mon = G.opField.pop();
          G.opExile.push(mon);
          sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
        }
        log('라이거 킹 ②: 상대 필드 전부 제외', 'mine');
      }
      sendGameState(); renderAll();
    });
  } else { sendGameState(); renderAll(); }
}

// ③ 자신/상대 턴 — 상대 필드 전부 제외
function activateLigerKing3() {
  if (!canUseEffect('라이거 킹', 3)) { notify('이미 사용했습니다.'); return; }
  if (G.opField.length === 0) { notify('상대 필드가 비어있습니다.'); return; }
  markEffectUsed('라이거 킹', 3);
  while (G.opField.length > 0) {
    const mon = G.opField.pop();
    G.opExile.push(mon);
    sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
  }
  log('라이거 킹 ③: 상대 필드 전부 제외', 'mine');
  sendGameState(); renderAll();
}

// ④ 필드에서 묘지로 보내졌을 때 → 서로 필드/묘지 전부 제외 + 이 턴 소환 불가
function activateLigerKing4() {
  const allMyField = [...G.myField];
  const allMyGrave = [...G.myGrave];
  const allOpField = [...G.opField];
  const allOpGrave = [...G.opGrave];

  G.myField = [];
  G.myGrave = [];
  allMyField.forEach(c => G.myExile.push(c));
  allMyGrave.forEach(c => G.myExile.push(c));

  allOpField.forEach(c => { G.opExile.push(c); sendAction({ type: 'opFieldRemove', cardId: c.id, to: 'exile' }); });
  allOpGrave.forEach(() => {}); // 상대 묘지는 opGraveMassExile로 처리
  G.opGrave = [];
  sendAction({ type: 'opGraveMassExile' });

  G.ligerKingBanSummon = true;
  log('라이거 킹 ④: 서로 필드/묘지 전부 제외, 턴 종료까지 소환 불가', 'mine');
  _updateLionSlotsIfExists();
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// sendToGrave 후킹: 에이스 라이거 ①, 라이거 킹 ④
// ─────────────────────────────────────────────
(function _hookLigerGrave() {
  const _prev = sendToGrave;
  sendToGrave = function (cardId, from) {
    _prev(cardId, from);
    if (cardId === '에이스 라이거' && from !== 'hand') {
      if (canUseEffect('에이스 라이거', 1)) {
        gameConfirm('에이스 라이거 ①: 묘지에서 소환?', (yes) => { if (yes) activateAceLiger1FromGrave(); });
      }
    }
    if (cardId === '라이거 킹' && from === 'field') {
      activateLigerKing4();
    }
  };
})();

// ─────────────────────────────────────────────
// 소환 트리거
// ─────────────────────────────────────────────
function onLigerSummoned(cardId) {
  if (cardId === '베이비 라이거' && canUseEffect('베이비 라이거', 2)) {
    gameConfirm('베이비 라이거 ②: 덱에서 모두의 자연 배치?', (yes) => { if (yes) activateBabyLiger2(); });
  }
  if (cardId === '젊은 라이거' && canUseEffect('젊은 라이거', 2)) {
    gameConfirm('젊은 라이거 ②: 덱에서 라이거 카드 서치?', (yes) => { if (yes) activateYoungLiger2(); });
  }
  if (cardId === '에이스 라이거' && canUseEffect('에이스 라이거', 2)) {
    gameConfirm('에이스 라이거 ②: 상대 패 덱으로 + 드로우?', (yes) => { if (yes) activateAceLiger2(); });
  }
}

// ─────────────────────────────────────────────
// 패 메뉴 라우터
// 에이스 라이거 ①은 패 발동 불가 — ②③만 패에서 사용
// 모두의 자연은 필드 존 클릭에서 별도 처리
// ─────────────────────────────────────────────
function activateLigerCardFromHand(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  switch (c.id) {
    case '화합의 시대의 라이거': if (effectNum === 1) activateHwahapLiger1(handIdx); break;
    case '베이비 라이거':       if (effectNum === 1) activateBabyLiger1(handIdx); break;
    case '젊은 라이거':        if (effectNum === 1) activateYoungLiger1(); break;
    case '에이스 라이거':
      // ①은 묘지 발동이므로 패에서 호출 불가
      if (effectNum === 1) { notify('에이스 라이거 ①은 묘지로 보내졌을 때 자동 발동합니다.'); break; }
      if (effectNum === 2) activateAceLiger2();
      else if (effectNum === 3) activateAceLiger3();
      break;
    case '라이거 킹': if (effectNum === 1) activateLigerKing1(handIdx); break;
    default: activateThemeCardEffectFromHand(handIdx, effectNum);
  }
}

// ─────────────────────────────────────────────
// 묘지 효과
// ─────────────────────────────────────────────
function activateLigerGraveEffect(cardId) {
  switch (cardId) {
    case '에이스 라이거': activateAceLiger1FromGrave(); break;
    case '라이거 킹':     activateLigerKing3(); break;
    default: notify('이 카드는 묘지 효과가 없습니다.');
  }
}

// ─────────────────────────────────────────────
// 필드 존 클릭 효과 (모두의 자연)
// ─────────────────────────────────────────────
function activateLigerFieldCardEffect(effectNum) {
  if (!G.myFieldCard || G.myFieldCard.id !== '모두의 자연') return;
  if (effectNum === 1) activateModuJayeon1();
  else if (effectNum === 2) activateModuJayeon2();
}

// ─────────────────────────────────────────────
// 상대 액션 처리
// ─────────────────────────────────────────────
function handleLigerOpAction(action) {
  if (action.type === 'opGraveMassExile') {
    while (G.myGrave.length > 0) G.myExile.push(G.myGrave.pop());
    log('라이거 킹 ④: 내 묘지 전부 제외됨', 'opponent');
    renderAll();
  }
}

registerThemeEffectHandler('라이거', {
  activateFromHand: activateLigerCardFromHand,
  resolveLink: resolveThemeEffectGeneric,
  onSummoned: onLigerSummoned,
  activateGraveEffect: activateLigerGraveEffect,
  handleOpAction: handleLigerOpAction,
});
