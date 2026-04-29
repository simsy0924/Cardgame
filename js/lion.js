// lion.js — 라이온 테마 효과 엔진
// ─────────────────────────────────────────────
// 존 슬롯 관리
// 베이비/젊은/에이스 라이온의 ③ 효과: 존재하는 한 내 존 +1칸
// 라이온 킹은 해당 없음
// ─────────────────────────────────────────────
const LION_SLOT_CARDS = new Set(['베이비 라이온', '젊은 라이온', '에이스 라이온']);

function _updateLionSlots() {
  const hasSlotLion = G.myField.some(m => LION_SLOT_CARDS.has(m.id));
  const desired = hasSlotLion ? 1 : 0;
  if (G.myExtraSlots !== desired) {
    G.myExtraSlots = desired;
    sendAction({ type: 'opExtraSlots', slots: desired });
    renderAll();
  }
}

// sendToGrave 후킹 — 라이온 퇴장 시 슬롯 재계산
(function _hookLionGrave() {
  const _prev = sendToGrave;
  sendToGrave = function (cardId, from) {
    _prev(cardId, from);
    if (LION_SLOT_CARDS.has(cardId)) setTimeout(_updateLionSlots, 0);
  };
})();

// ─────────────────────────────────────────────
// 고유 효과
// ─────────────────────────────────────────────

function activateBabyLion1(handIdx) {
  if (!canUseEffect('베이비 라이온', 1)) { notify('이미 사용했습니다.'); return; }
  const c = G.myHand[handIdx];
  if (!c) return;

  gameConfirm('베이비 라이온 ①: 버리고 발동하겠습니까? (취소 = 공개만)', (discard) => {
    markEffectUsed('베이비 라이온', 1);
    if (discard) {
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
    } else {
      G.myHand[handIdx].isPublic = true;
    }

    const lionTargets = findAllInDeck(dc => CARDS[dc.id]?.theme === '라이온' && dc.id !== '베이비 라이온');
    const sajaTargets = findAllInDeck(dc => {
      const cd = CARDS[dc.id];
      return cd?.theme === '라이온' && (dc.id.includes('사자') || dc.id === '진정한 사자');
    });

    const doSummon = () => {
      const idx2 = G.myHand.findIndex(h => h.id === '베이비 라이온');
      if (idx2 >= 0) {
        const mon = G.myHand.splice(idx2, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 2, atkBase: CARDS[mon.id]?.atk ?? 2 });
        log('베이비 라이온 ①: 패에서 소환', 'mine');
        _updateLionSlots();
      }
      sendGameState(); renderAll();
    };

    const pickSaja = () => {
      if (sajaTargets.length === 0) { doSummon(); return; }
      openCardPicker(sajaTargets, '베이비 라이온 ①: 덱에서 사자 카드 선택', 1, (sel) => {
        if (sel.length > 0) searchToHand(sajaTargets[sel[0]].id);
        doSummon();
      });
    };

    if (lionTargets.length === 0) { pickSaja(); return; }
    openCardPicker(lionTargets, '베이비 라이온 ①: 덱에서 라이온 카드 선택', 1, (sel) => {
      if (sel.length > 0) searchToHand(lionTargets[sel[0]].id);
      pickSaja();
    });
  });
}

function activateYoungLion1(handIdx) {
  if (!canUseEffect('젊은 라이온', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('젊은 라이온', 1);
  const lionDeck = findAllInDeck(dc => CARDS[dc.id]?.theme === '라이온');

  const pickAndSummon = () => {
    const lionHand = G.myHand.filter(h => CARDS[h.id]?.theme === '라이온' && h.id !== '젊은 라이온');
    if (lionHand.length === 0) { sendGameState(); renderAll(); return; }
    openCardPicker(lionHand, '젊은 라이온 ①: 패에서 라이온 소환', 1, (sel) => {
      if (sel.length > 0) {
        const target = lionHand[sel[0]];
        // 참조 기반 인덱스 탐색 (filter 결과는 원본 참조 유지)
        const idx = G.myHand.findIndex(h => h === target);
        if (idx >= 0) {
          const mon = G.myHand.splice(idx, 1)[0];
          G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 3, atkBase: CARDS[mon.id]?.atk ?? 3 });
          log(`젊은 라이온 ①: ${mon.name} 소환`, 'mine');
          _updateLionSlots();
        }
      }
      sendGameState(); renderAll();
    });
  };

  if (lionDeck.length === 0) { pickAndSummon(); return; }
  openCardPicker(lionDeck, '젊은 라이온 ①: 덱에서 라이온 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(lionDeck[sel[0]].id);
    pickAndSummon();
  });
}

function activateYoungLion2() {
  if (!canUseEffect('젊은 라이온', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('젊은 라이온', 2);
  const sajaTargets = findAllInDeck(dc => dc.id.includes('사자') || dc.id === '진정한 사자');
  if (sajaTargets.length === 0) { notify('덱에 사자 카드가 없습니다.'); return; }
  openCardPicker(sajaTargets, '젊은 라이온 ②: 덱에서 사자 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(sajaTargets[sel[0]].id);
    sendGameState(); renderAll();
  });
}

function activateAceLion1(handIdx) {
  if (!canUseEffect('에이스 라이온', 1)) { notify('이미 사용했습니다.'); return; }
  if (!G.myField.some(m => CARDS[m.id]?.theme === '라이온')) { notify('에이스 라이온 ①: 자신 필드에 라이온 몬스터가 필요합니다.'); return; }
  markEffectUsed('에이스 라이온', 1);

  const c = G.myHand.splice(handIdx, 1)[0];
  G.myField.push({ id: c.id, name: c.name, atk: CARDS[c.id]?.atk ?? 4, atkBase: CARDS[c.id]?.atk ?? 4 });
  log('에이스 라이온 ①: 패에서 소환', 'mine');
  _updateLionSlots();

  // 스냅샷: 소환 직후 시점의 인덱스를 담은 객체 배열
  const allField = [
    ...G.myField.map((m, i) => ({ id: m.id, name: m.name, atk: m.atk, _src: 'mine', _i: i })),
    ...G.opField.map((m, i) => ({ id: m.id, name: m.name, atk: m.atk, _src: 'op',   _i: i })),
  ];
  if (allField.length === 0) { sendGameState(); renderAll(); return; }
  openCardPicker(allField, '에이스 라이온 ①: 필드 카드 1장 묘지로', 1, (sel) => {
    if (sel.length > 0) {
      const picked = allField[sel[0]];
      if (picked._src === 'mine') {
        const mon = G.myField.splice(picked._i, 1)[0];
        if (mon) { G.myGrave.push(mon); log(`에이스 라이온 ①: 내 ${mon.name} 묘지`, 'mine'); _updateLionSlots(); }
      } else {
        const mon = G.opField.splice(picked._i, 1)[0];
        if (mon) { G.opGrave.push(mon); sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' }); log(`에이스 라이온 ①: 상대 ${mon.name} 묘지`, 'mine'); }
      }
    }
    sendGameState(); renderAll();
  });
}

function activateAceLion2() {
  if (!canUseEffect('에이스 라이온', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('에이스 라이온', 2);

  const sajaPool = [
    ...findAllInDeck(dc => dc.id.includes('사자') || dc.id === '진정한 사자'),
    ...G.myGrave.filter(gc => gc.id.includes('사자') || gc.id === '진정한 사자'),
  ];
  const lionPool = [
    ...findAllInDeck(dc => CARDS[dc.id]?.theme === '라이온'),
    ...G.myGrave.filter(gc => CARDS[gc.id]?.theme === '라이온'),
  ];

  const _moveToHand = (card) => {
    const di = G.myDeck.findIndex(d => d.id === card.id);
    if (di >= 0) { G.myHand.push(G.myDeck.splice(di, 1)[0]); return; }
    const gi = G.myGrave.findIndex(g => g.id === card.id);
    if (gi >= 0) G.myHand.push(G.myGrave.splice(gi, 1)[0]);
  };

  const pickLion = () => {
    if (lionPool.length === 0) { sendGameState(); renderAll(); return; }
    openCardPicker(lionPool, '에이스 라이온 ②: 라이온 카드 패에', 1, (sel) => {
      if (sel.length > 0) { _moveToHand(lionPool[sel[0]]); log(`에이스 라이온 ②: ${lionPool[sel[0]].id} 패로`, 'mine'); }
      sendGameState(); renderAll();
    });
  };

  if (sajaPool.length === 0) { pickLion(); return; }
  openCardPicker(sajaPool, '에이스 라이온 ②: 사자 카드 패에', 1, (sel) => {
    if (sel.length > 0) { _moveToHand(sajaPool[sel[0]]); log(`에이스 라이온 ②: ${sajaPool[sel[0]].id} 패로`, 'mine'); }
    pickLion();
  });
}

function activateSajaPoryo(handIdx) {
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const targets = findAllInDeck(dc => CARDS[dc.id]?.theme === '라이온' && CARDS[dc.id]?.cardType === 'monster');
  targets.forEach(t => {
    removeFromDeck(t.id);
    G.myGrave.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
  });
  log(`사자의 포효: 덱에서 라이온 몬스터 ${targets.length}장 묘지`, 'mine');
  sendGameState(); renderAll();
}

function activateSajaSayang(handIdx) {
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const sajaMon = G.myHand.filter(h => h.id.includes('사자') && CARDS[h.id]?.cardType === 'monster');
  if (sajaMon.length === 0) { notify('패에 사자 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(sajaMon, '사자의 사냥: 패에서 사자 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) {
      const target = sajaMon[sel[0]];
      const idx = G.myHand.findIndex(h => h === target);
      if (idx >= 0) {
        const mon = G.myHand.splice(idx, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 2, atkBase: CARDS[mon.id]?.atk ?? 2 });
        log(`사자의 사냥: ${mon.name} 소환`, 'mine');
        _updateLionSlots();
      }
    }
    sendGameState(); renderAll();
  });
}

function activateSajaBaltop(handIdx) {
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const sajaGrave = G.myGrave.filter(g => g.id.includes('사자') && CARDS[g.id]?.cardType === 'monster');
  if (sajaGrave.length === 0) { notify('묘지에 사자 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(sajaGrave, '사자의 발톱: 묘지에서 사자 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) {
      const target = sajaGrave[sel[0]];
      const gi = G.myGrave.findIndex(g => g === target);
      if (gi >= 0) {
        const mon = G.myGrave.splice(gi, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 2, atkBase: CARDS[mon.id]?.atk ?? 2 });
        log(`사자의 발톱: ${mon.name} 묘지에서 소환`, 'mine');
        _updateLionSlots();
      }
    }
    sendGameState(); renderAll();
  });
}

function activateSajaIlgyeok1(handIdx) {
  if (!canUseEffect('사자의 일격', 1)) { notify('이미 사용했습니다.'); return; }
  if (currentPhase !== 'deploy' || isMyTurn) { notify('사자의 일격: 상대 전개 단계에만 발동 가능합니다.'); return; }
  markEffectUsed('사자의 일격', 1);
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const count = Math.min(G.myField.filter(m => CARDS[m.id]?.theme === '라이온').length, G.opHand.length);
  if (count === 0) { notify('반환할 상대 패가 없습니다.'); sendGameState(); renderAll(); return; }
  sendAction({ type: 'forceReturnHand', count, reason: '사자의 일격' });
  log(`사자의 일격 ①: 상대 패 ${count}장 덱으로`, 'mine');
  sendGameState(); renderAll();
}

function activateJinSaja1(handIdx) {
  if (!canUseEffect('진정한 사자', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('진정한 사자', 1);
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const names = ['베이비 라이온', '젊은 라이온', '에이스 라이온'];
  const found = names.map(n => findAllInDeck(dc => dc.id === n)[0]).filter(Boolean);
  if (found.length < 3) { notify(`진정한 사자: 덱에 세 종류 모두 필요합니다. (현재 ${found.length}/3)`); sendGameState(); renderAll(); return; }
  found.forEach(t => removeFromDeck(t.id));
  openCardPicker(found, '진정한 사자: 소환할 카드 선택 (나머지 2장 패)', 1, (sel) => {
    const summonIdx = sel.length > 0 ? sel[0] : 0;
    found.forEach((t, i) => {
      if (i === summonIdx) {
        G.myField.push({ id: t.id, name: CARDS[t.id]?.name || t.id, atk: CARDS[t.id]?.atk ?? 2, atkBase: CARDS[t.id]?.atk ?? 2 });
        log(`진정한 사자 ①: ${t.id} 소환`, 'mine');
        _updateLionSlots();
      } else {
        G.myHand.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
      }
    });
    sendGameState(); renderAll();
  });
}

function activateLionKing1(handIdx) {
  if (!canUseEffect('라이온 킹', 1)) { notify('이미 사용했습니다.'); return; }
  if (G.myField.length < 4) { notify('라이온 킹 ①: 필드에 몬스터 4장이 필요합니다.'); return; }
  markEffectUsed('라이온 킹', 1);
  openCardPicker([...G.myField], '라이온 킹 ①: 묘지로 보낼 몬스터 4장 선택', 4, (sel) => {
    if (sel.length < 4) { notify('4장을 선택해야 합니다.'); return; }
    sel.sort((a, b) => b - a).forEach(i => G.myGrave.push(G.myField.splice(i, 1)[0]));
    log('라이온 킹 ①: 몬스터 4장 묘지 → 라이온 킹 소환', 'mine');
    _updateLionSlots();
    const c = G.myHand.splice(handIdx, 1)[0];
    G.myField.push({ id: c.id, name: c.name, atk: CARDS[c.id]?.atk ?? 5, atkBase: CARDS[c.id]?.atk ?? 5 });
    if (canUseEffect('라이온 킹', 2) && G.opField.length > 0) {
      gameConfirm('라이온 킹 ②: 상대 필드 전부 묘지?', (yes) => {
        if (yes) {
          markEffectUsed('라이온 킹', 2);
          while (G.opField.length > 0) {
            const mon = G.opField.pop();
            G.opGrave.push(mon);
            sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' });
          }
          log('라이온 킹 ②: 상대 필드 전부 묘지', 'mine');
        }
        sendGameState(); renderAll();
      });
    } else { sendGameState(); renderAll(); }
  });
}

function activateLionKing3() {
  if (!canUseEffect('라이온 킹', 3)) { notify('이미 사용했습니다.'); return; }
  if (G.myField.length < 5) { notify('라이온 킹 ③: 필드 몬스터 5장이 필요합니다.'); return; }
  if (!G.myGrave.some(g => g.id === '라이온 킹')) { notify('라이온 킹 ③: 묘지에 라이온 킹이 없습니다.'); return; }
  openCardPicker([...G.myField], '라이온 킹 ③: 묘지로 보낼 몬스터 5장', 5, (sel) => {
    if (sel.length < 5) { notify('5장을 선택해야 합니다.'); return; }
    markEffectUsed('라이온 킹', 3);
    sel.sort((a, b) => b - a).forEach(i => G.myGrave.push(G.myField.splice(i, 1)[0]));
    _updateLionSlots();
    const gi = G.myGrave.findIndex(g => g.id === '라이온 킹');
    if (gi >= 0) {
      const mon = G.myGrave.splice(gi, 1)[0];
      G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 5, atkBase: CARDS[mon.id]?.atk ?? 5 });
      log('라이온 킹 ③: 묘지에서 소환', 'mine');
    }
    if (G.opField.length > 0) {
      openCardPicker([...G.opField], '라이온 킹 ③: 상대 몬스터 1장 제외', 1, (sel2) => {
        if (sel2.length > 0) {
          const mon = G.opField.splice(sel2[0], 1)[0];
          G.opExile.push(mon);
          sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
          log(`라이온 킹 ③: ${mon.name} 제외`, 'mine');
        }
        sendGameState(); renderAll();
      });
    } else { sendGameState(); renderAll(); }
  });
}

function activateGogoganSaja1(handIdx) {
  if (!canUseEffect('고고한 사자', 1)) { notify('이미 사용했습니다.'); return; }
  if (!isMyTurn || currentPhase !== 'deploy') { notify('고고한 사자 ①: 자신 전개 단계에만 발동 가능합니다.'); return; }
  if (!G.myField.some(m => CARDS[m.id]?.theme === '라이온')) { notify('고고한 사자 ①: 필드에 라이온 몬스터가 필요합니다.'); return; }
  markEffectUsed('고고한 사자', 1);
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const targets = findAllInDeck(dc => !!CARDS[dc.id]);
  if (targets.length === 0) { notify('덱이 비어있습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(targets, '고고한 사자 ①: 덱에서 카드 1장 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    sendGameState(); renderAll();
  });
}

function activateGogoganSaja2(handIdx) {
  if (!canUseEffect('고고한 사자', 2)) { notify('이미 사용했습니다.'); return; }
  if (!isMyTurn || currentPhase !== 'deploy') { notify('고고한 사자 ②: 자신 전개 단계에만 발동 가능합니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 카드를 제외할 수 없습니다.'); return; }
  if (G.opField.length === 0) { notify('상대 필드에 카드가 없습니다.'); return; }
  markEffectUsed('고고한 사자', 2);
  G.myExile.push(G.myHand.splice(handIdx, 1)[0]);
  openCardPicker([...G.opField], '고고한 사자 ②: 상대 필드 1장 제외', 1, (sel) => {
    if (sel.length > 0) {
      const mon = G.opField.splice(sel[0], 1)[0];
      G.opExile.push(mon);
      sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
      log(`고고한 사자 ②: ${mon.name} 제외`, 'mine');
    }
    sendGameState(); renderAll();
  });
}

function onLionSummoned(cardId) {
  _updateLionSlots();
  if (cardId === '젊은 라이온' && canUseEffect('젊은 라이온', 2)) {
    gameConfirm('젊은 라이온 ②: 덱에서 사자 카드 서치?', (yes) => { if (yes) activateYoungLion2(); });
  }
}

function activateLionCardFromHand(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  switch (c.id) {
    case '베이비 라이온':  if (effectNum === 1) activateBabyLion1(handIdx); break;
    case '젊은 라이온':   if (effectNum === 1) activateYoungLion1(handIdx); break;
    case '에이스 라이온': if (effectNum === 1) activateAceLion1(handIdx); break;
    case '사자의 포효':   activateSajaPoryo(handIdx); break;
    case '사자의 사냥':   activateSajaSayang(handIdx); break;
    case '사자의 발톱':   activateSajaBaltop(handIdx); break;
    case '사자의 일격':   if (effectNum === 1) activateSajaIlgyeok1(handIdx); break;
    case '진정한 사자':   if (effectNum === 1) activateJinSaja1(handIdx); break;
    case '라이온 킹':     if (effectNum === 1) activateLionKing1(handIdx); break;
    case '고고한 사자':
      if (effectNum === 1) activateGogoganSaja1(handIdx);
      else if (effectNum === 2) activateGogoganSaja2(handIdx);
      break;
    default: activateThemeCardEffectFromHand(handIdx, effectNum);
  }
}

function activateLionGraveEffect(cardId) {
  switch (cardId) {
    case '에이스 라이온': activateAceLion2(); break;
    case '라이온 킹':     activateLionKing3(); break;
    default: notify('이 카드는 묘지 효과가 없습니다.');
  }
}

function handleLionOpAction(action) {
  if (action.type === 'opExtraSlots') { G.opExtraSlots = action.slots || 0; renderAll(); }
}

registerThemeEffectHandler('라이온', {
  activateFromHand: activateLionCardFromHand,
  resolveLink: resolveThemeEffectGeneric,
  onSummoned: onLionSummoned,
  activateGraveEffect: activateLionGraveEffect,
  handleOpAction: handleLionOpAction,
});
