// cthulhu.js — 크툴루/올드원 테마 효과 엔진
// ─────────────────────────────────────────────
// 설계 원칙:
//   효과를 실행할 수 없는 상태면 발동 자체 불가 (발동 전 사전 체크)
//   코스트 지불 후 효과는 무조건 발동 (gameConfirm 없음)
//   예외: 원문에 "할 수 있다", "원한다면" 명시된 선택만 confirm 유지
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 술어 헬퍼
// ─────────────────────────────────────────────
const _isGOO      = id => id.startsWith('그레이트 올드 원-');
const _isElderGod = id => id.startsWith('엘더 갓-');
const _isOuterGod = id => id.startsWith('아우터 갓');
const _isOldOne   = dc => ['올드원', '올드 원', '크툴루'].includes(CARDS[dc.id]?.theme);

// ─────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────
function _cthulhuSummon(cardId, from) {
  const cd = CARDS[cardId];
  if (!cd) { notify(`${cardId}: 카드 데이터 없음`); return false; }
  let src = null;
  if (from === 'hand')  { const i = G.myHand.findIndex(h => h.id === cardId);  if (i < 0) { notify(`패에 ${cd.name}이 없습니다.`);     return false; } src = G.myHand.splice(i, 1)[0]; }
  if (from === 'grave') { const i = G.myGrave.findIndex(g => g.id === cardId); if (i < 0) { notify(`묘지에 ${cd.name}이 없습니다.`);  return false; } src = G.myGrave.splice(i, 1)[0]; }
  if (from === 'exile') { const i = G.myExile.findIndex(e => e.id === cardId); if (i < 0) { notify(`제외 존에 ${cd.name}이 없습니다.`); return false; } src = G.myExile.splice(i, 1)[0]; }
  if (from === 'deck')  { const i = G.myDeck.findIndex(d => d.id === cardId);  if (i < 0) { notify(`덱에 ${cd.name}이 없습니다.`);     return false; } src = G.myDeck.splice(i, 1)[0]; }
  if (!src) return false;
  G.myField.push({ id: cardId, name: cd.name, atk: cd.atk ?? 0, atkBase: cd.atk ?? 0 });
  log(`${cd.name} 소환 (${from}에서)`, 'mine');
  return true;
}

// 자신이 직접 패 1장 선택해서 버리기
function _selfDiscard(label, done) {
  if (G.myHand.length === 0) { log(`${label}: 패가 없어 버리기 스킵`, 'mine'); done(); return; }
  openCardPicker([...G.myHand], `${label}: 패 1장 버리기 (의무)`, 1, (sel) => {
    if (sel.length > 0) {
      G.myGrave.push(G.myHand.splice(sel[0], 1)[0]);
      log(`${label}: ${G.myGrave[G.myGrave.length-1].name} 버림`, 'mine');
    }
    done();
  });
}

// ─────────────────────────────────────────────
// 태평양 속 르뤼에 (필드 마법)
// ─────────────────────────────────────────────

function activateRlyeh1() {
  if (!canUseEffect('태평양 속 르뤼에', 1)) { notify('이미 사용했습니다.'); return; }
  if (!isMyTurn || currentPhase !== 'deploy') { notify('자신 전개 단계에만 발동 가능합니다.'); return; }
  if (!G.myFieldCard || G.myFieldCard.id !== '태평양 속 르뤼에') { notify('태평양 속 르뤼에가 필드에 없습니다.'); return; }
  const targets = G.myGrave.filter(g => _isGOO(g.id));
  if (targets.length === 0) { notify('발동 불가: 묘지에 GOO 몬스터가 없습니다.'); return; }
  markEffectUsed('태평양 속 르뤼에', 1);
  openCardPicker(targets, '르뤼에 ①: 묘지에서 GOO 소환', 1, (sel) => {
    if (sel.length > 0) {
      const t = targets[sel[0]];
      const gi = G.myGrave.findIndex(g => g === t);
      if (gi >= 0) {
        const mon = G.myGrave.splice(gi, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 4, atkBase: CARDS[mon.id]?.atk ?? 4 });
        log(`르뤼에 ①: ${mon.name} 소환`, 'mine');
      }
    }
    sendGameState(); renderAll();
  });
}

function activateRlyeh2() {
  if (!canUseEffect('태평양 속 르뤼에', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.myFieldCard || G.myFieldCard.id !== '태평양 속 르뤼에') { notify('태평양 속 르뤼에가 필드에 없습니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  const gooGrave  = G.myGrave.filter(g => _isGOO(g.id));
  const elderDeck = findAllInDeck(dc => _isElderGod(dc.id));
  if (gooGrave.length === 0)  { notify('발동 불가: 묘지에 GOO가 없습니다.'); return; }
  if (elderDeck.length === 0) { notify('발동 불가: 덱에 엘더 갓이 없습니다.'); return; }
  markEffectUsed('태평양 속 르뤼에', 2);
  openCardPicker(gooGrave, '르뤼에 ②: 묘지 GOO 패로 (코스트)', 1, (sel) => {
    if (sel.length > 0) {
      const gi = G.myGrave.findIndex(g => g === gooGrave[sel[0]]);
      if (gi >= 0) G.myHand.push(G.myGrave.splice(gi, 1)[0]);
    }
    openCardPicker(elderDeck, '르뤼에 ②: 덱에서 엘더 갓 제외 (의무)', 1, (sel2) => {
      if (sel2.length > 0) {
        const t = elderDeck[sel2[0]];
        removeFromDeck(t.id);
        G.myExile.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
        log(`르뤼에 ②: ${t.id} 제외`, 'mine');
      }
      sendGameState(); renderAll();
    });
  });
}

// ─────────────────────────────────────────────
// 크툴루 ①②③
// ─────────────────────────────────────────────

// ①: 덱에 르뤼에 있어야 발동 가능 (이득 효과이므로 없으면 발동 불가)
function activateCthulhu1(handIdx) {
  if (!canUseEffect('그레이트 올드 원-크툴루', 1)) { notify('이미 사용했습니다.'); return; }
  const hasRlyeh = findAllInDeck(dc => dc.id === '태평양 속 르뤼에').length > 0;
  if (!hasRlyeh) { notify('발동 불가: 덱에 태평양 속 르뤼에가 없습니다.'); return; }
  markEffectUsed('그레이트 올드 원-크툴루', 1);
  if (!_cthulhuSummon('그레이트 올드 원-크툴루', 'hand')) { return; }
  removeFromDeck('태평양 속 르뤼에');
  G.myFieldCard = { id: '태평양 속 르뤼에', name: '태평양 속 르뤼에' };
  log('크툴루 ①: 태평양 속 르뤼에 배치', 'mine');
  sendGameState(); renderAll();
}

// ②: 자신 필드에 묻을 카드가 있어야 발동 가능
function activateCthulhu2(fieldIdx) {
  if (!canUseEffect('그레이트 올드 원-크툴루', 2)) { notify('이미 사용했습니다.'); return; }
  // 전체 필드 (코스트 대상)
  const allField = [
    ...G.myField.map((m, i) => ({ id: m.id, name: m.name, atk: m.atk, _src: 'mine', _i: i })),
    ...G.opField.map((m, i) => ({ id: m.id, name: m.name, atk: m.atk, _src: 'op',   _i: i })),
  ];
  if (allField.length === 0) { notify('발동 불가: 코스트로 보낼 필드 카드가 없습니다.'); return; }
  // 패널티 대상: 자신 필드 (코스트 1장 제거 후에도 남아있어야 함)
  // 최소 2장(코스트 1 + 패널티 1) 또는 코스트가 상대 필드면 1장으로 충분
  // 여기선 발동 시점에 자신 필드가 1장이라도 있으면 허용 (코스트로 자신 것을 쓸 수도 있으므로)
  if (G.myField.length === 0) { notify('발동 불가: 패널티로 보낼 자신 필드 카드가 없습니다.'); return; }
  openCardPicker(allField, '크툴루 ②: [코스트] 필드 카드 1장 묘지', 1, (sel) => {
    if (sel.length === 0) return;
    markEffectUsed('그레이트 올드 원-크툴루', 2);
    const picked = allField[sel[0]];
    if (picked._src === 'mine') {
      const mon = G.myField.splice(picked._i, 1)[0];
      if (mon) G.myGrave.push(mon);
    } else {
      const mon = G.opField.splice(picked._i, 1)[0];
      if (mon) { G.opGrave.push(mon); sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' }); }
    }
    log('크툴루 ②: [코스트] 묘지', 'mine');
    // 의무 패널티: 자신 필드 카드 1장 묘지
    if (G.myField.length === 0) { log('크툴루 ②: 자신 필드 비어 패널티 스킵', 'mine'); sendGameState(); renderAll(); return; }
    openCardPicker([...G.myField].map((m, i) => ({ id: m.id, name: m.name, atk: m.atk, _i: i })),
      '크툴루 ②: [패널티] 자신 필드 카드 1장 묘지 (의무)', 1, (sel2) => {
      if (sel2.length > 0) {
        const snap = G.myField.map((m, i) => i);
        const actualIdx = sel2[0]; // openCardPicker에 넘긴 배열 인덱스 = myField 인덱스
        const mon = G.myField.splice(actualIdx, 1)[0];
        if (mon) { G.myGrave.push(mon); log(`크툴루 ②: [패널티] ${mon.name} 묘지`, 'mine'); }
      }
      sendGameState(); renderAll();
    });
  });
}

function activateCthulhu3() {
  if (!canUseEffect('그레이트 올드 원-크툴루', 3)) { notify('이미 사용했습니다.'); return; }
  const targets = findAllInDeck(dc => _isGOO(dc.id));
  if (targets.length === 0) { notify('발동 불가: 덱에 GOO가 없습니다.'); return; }
  markEffectUsed('그레이트 올드 원-크툴루', 3);
  openCardPicker(targets, '크툴루 ③: 덱에서 GOO 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 크투가 ①②③
// ─────────────────────────────────────────────

// ①: 필드 존에 카드 있어야 발동 가능
function activateKtuga1(handIdx) {
  if (!canUseEffect('그레이트 올드 원-크투가', 1)) { notify('이미 사용했습니다.'); return; }
  const fieldCards = [];
  if (G.myFieldCard) fieldCards.push({ id: G.myFieldCard.id, name: G.myFieldCard.name, _who: 'me' });
  if (G.opFieldCard) fieldCards.push({ id: G.opFieldCard.id, name: G.opFieldCard.name, _who: 'op' });
  if (fieldCards.length === 0) { notify('발동 불가: 보낼 필드 존 카드가 없습니다.'); return; }
  markEffectUsed('그레이트 올드 원-크투가', 1);
  if (!_cthulhuSummon('그레이트 올드 원-크투가', 'hand')) { return; }
  sendGameState(); renderAll();
  openCardPicker(fieldCards, '크투가 ①: [패널티] 필드 존 카드 1장 묘지 (의무)', 1, (sel) => {
    if (sel.length > 0) {
      const p = fieldCards[sel[0]];
      if (p._who === 'me') { G.myGrave.push(G.myFieldCard); G.myFieldCard = null; log(`크투가 ①: 내 ${p.name} 필드 존 묘지`, 'mine'); }
      else { G.opGrave.push(G.opFieldCard); sendAction({ type: 'opFieldCardRemove', cardId: p.id, to: 'grave' }); G.opFieldCard = null; log(`크투가 ①: 상대 ${p.name} 필드 존 묘지`, 'mine'); }
    }
    sendGameState(); renderAll();
  });
}

// ②: 자신 필드에 카드가 있어야 발동 가능
function activateKtuga2(handIdx) {
  if (!canUseEffect('그레이트 올드 원-크투가', 2)) { notify('이미 사용했습니다.'); return; }
  if (G.myField.length === 0) { notify('발동 불가: 패널티로 보낼 자신 필드 카드가 없습니다.'); return; }
  const monsters = G.myHand.filter((h, i) => i !== handIdx && CARDS[h.id]?.cardType === 'monster');
  if (monsters.length === 0) { notify('발동 불가: 코스트로 소환할 패 몬스터가 없습니다.'); return; }
  openCardPicker(monsters, '크투가 ②: [코스트] 패에서 몬스터 소환', 1, (sel) => {
    if (sel.length === 0) return;
    markEffectUsed('그레이트 올드 원-크투가', 2);
    const target = monsters[sel[0]];
    const mi = G.myHand.findIndex(h => h === target);
    if (mi >= 0) {
      const mon = G.myHand.splice(mi, 1)[0];
      G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
      log(`크투가 ②: [코스트] ${mon.name} 소환`, 'mine');
    }
    sendGameState(); renderAll();
    openCardPicker([...G.myField].map((m, i) => ({ id: m.id, name: m.name, atk: m.atk, _i: i })),
      '크투가 ②: [패널티] 자신 필드 카드 1장 묘지 (의무)', 1, (sel2) => {
      if (sel2.length > 0) {
        const mon2 = G.myField.splice(sel2[0], 1)[0];
        if (mon2) { G.myGrave.push(mon2); log(`크투가 ②: [패널티] ${mon2.name} 묘지`, 'mine'); }
      }
      sendGameState(); renderAll();
    });
  });
}

function activateKtuga3() {
  if (!canUseEffect('그레이트 올드 원-크투가', 3)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('그레이트 올드 원-크투가', 3);
  const pool = [
    ...G.myGrave.map(g => ({ ...g, _src: 'mine' })),
    ...G.opGrave.map(g => ({ ...g, _src: 'op' })),
  ];
  if (pool.length === 0) { sendGameState(); renderAll(); return; }
  const count = Math.min(2, pool.length);
  openCardPicker(pool, `크투가 ③: 묘지 ${count}장 제외`, count, (sel) => {
    sel.sort((a, b) => b - a).forEach(i => {
      const p = pool[i];
      if (p._src === 'mine') {
        const gi = G.myGrave.findIndex(g => g.id === p.id);
        if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
      } else {
        const gi = G.opGrave.findIndex(g => g.id === p.id);
        if (gi >= 0) { G.opExile.push(G.opGrave.splice(gi, 1)[0]); sendAction({ type: 'opGraveExile', cardId: p.id }); }
      }
    });
    log(`크투가 ③: ${sel.length}장 제외`, 'mine');
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 크아이가 ①②③④
// ─────────────────────────────────────────────

// 공통: 패가 없으면 발동 불가 (패 버리기가 의무 패널티)
function _kraigaCanActivate(label) {
  if (G.myHand.length === 0) { notify(`발동 불가: ${label}의 패 버리기 패널티를 지불할 패가 없습니다.`); return false; }
  return true;
}

// ①: [코스트] 소환 → [패널티] 자신 패 1장 버리기
function activateKraiga1(handIdx) {
  if (!canUseEffect('그레이트 올드 원-크아이가', 1)) { notify('이미 사용했습니다.'); return; }
  // 소환 후 패가 줄어들므로, 소환 전 패에 2장 이상 필요 (이 카드 + 버릴 카드)
  if (G.myHand.length < 2) { notify('발동 불가: 소환 후 버릴 패가 없습니다.'); return; }
  markEffectUsed('그레이트 올드 원-크아이가', 1);
  if (!_cthulhuSummon('그레이트 올드 원-크아이가', 'hand')) { return; }
  sendGameState(); renderAll();
  _selfDiscard('크아이가 ①', () => { sendGameState(); renderAll(); });
}

// ②: [코스트] 상대 필드 1장 묘지 → [패널티] 자신 패 1장 버리기
function activateKraiga2(fieldIdx) {
  const KEY = '그레이트 올드 원-크아이가_23';
  if (!canUseEffect(KEY, 1)) { notify('이미 사용했습니다. (2,3효과 합산 1턴 1번)'); return; }
  if (G.opField.length === 0) { notify('발동 불가: 코스트로 보낼 상대 필드 카드가 없습니다.'); return; }
  if (G.myHand.length === 0) { notify('발동 불가: 패 버리기 패널티를 지불할 패가 없습니다.'); return; }
  openCardPicker([...G.opField], '크아이가 ②: [코스트] 상대 필드 1장 묘지', 1, (sel) => {
    if (sel.length === 0) return;
    markEffectUsed(KEY, 1);
    const mon = G.opField.splice(sel[0], 1)[0];
    G.opGrave.push(mon);
    sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' });
    log(`크아이가 ②: [코스트] 상대 ${mon.name} 묘지`, 'mine');
    _selfDiscard('크아이가 ②', () => { sendGameState(); renderAll(); });
  });
}

// ③: 묘지로 보내졌을 때 → [코스트] 상대 필드 2장까지 묘지 → [패널티] 자신 패 1장 버리기
function activateKraiga3() {
  const KEY = '그레이트 올드 원-크아이가_23';
  if (!canUseEffect(KEY, 1)) { notify('이미 사용했습니다.'); return; }
  if (G.myHand.length === 0) { notify('발동 불가: 패 버리기 패널티를 지불할 패가 없습니다.'); return; }
  markEffectUsed(KEY, 1);
  if (G.opField.length === 0) {
    log('크아이가 ③: 상대 필드 비어있음, 패널티만 진행', 'mine');
    _selfDiscard('크아이가 ③', () => { sendGameState(); renderAll(); });
    return;
  }
  const count = Math.min(2, G.opField.length);
  openCardPicker([...G.opField], `크아이가 ③: [코스트] 상대 필드 최대 ${count}장 묘지`, count, (sel) => {
    sel.sort((a, b) => b - a).forEach(i => {
      const mon = G.opField.splice(i, 1)[0];
      if (mon) { G.opGrave.push(mon); sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' }); }
    });
    log(`크아이가 ③: 상대 ${sel.length}장 묘지`, 'mine');
    _selfDiscard('크아이가 ③', () => { sendGameState(); renderAll(); });
  });
}

function activateKraiga4() {
  if (!canUseEffect('그레이트 올드 원-크아이가', 4)) { notify('이미 사용했습니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  const gi = G.myGrave.findIndex(g => g.id === '그레이트 올드 원-크아이가');
  if (gi < 0) { notify('묘지에 크아이가가 없습니다.'); return; }
  const elderDeck = findAllInDeck(dc => _isElderGod(dc.id));
  if (elderDeck.length === 0) { notify('발동 불가: 덱에 엘더 갓이 없습니다.'); return; }
  markEffectUsed('그레이트 올드 원-크아이가', 4);
  G.myExile.push(G.myGrave.splice(gi, 1)[0]);
  openCardPicker(elderDeck, '크아이가 ④: 덱에서 엘더 갓 제외', 1, (sel) => {
    if (sel.length > 0) {
      const t = elderDeck[sel[0]];
      removeFromDeck(t.id);
      G.myExile.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
      log(`크아이가 ④: ${t.id} 제외`, 'mine');
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 과타노차 ①②
// ─────────────────────────────────────────────

// ①: 패에 GOO가 있어야 (소환 의무), 필드에 GOO 있어야 (코스트)
function activateGatanother1(handIdx) {
  if (!canUseEffect('그레이트 올드 원-과타노차', 1)) { notify('이미 사용했습니다.'); return; }
  const gooOnField = G.myField.filter(m => _isGOO(m.id));
  if (gooOnField.length === 0) { notify('발동 불가: 코스트로 보낼 자신 필드 GOO가 없습니다.'); return; }
  // 과타노차 자신이 패에 있어야 소환 가능
  if (!G.myHand.some(h => h.id === '그레이트 올드 원-과타노차')) { notify('발동 불가: 패에 과타노차가 없습니다.'); return; }
  openCardPicker(gooOnField, '과타노차 ①: [코스트] 자신 필드 GOO 1장 묘지', 1, (sel) => {
    if (sel.length === 0) return;
    markEffectUsed('그레이트 올드 원-과타노차', 1);
    const target = gooOnField[sel[0]];
    const fi = G.myField.findIndex(m => m === target);
    if (fi >= 0) G.myGrave.push(G.myField.splice(fi, 1)[0]);
    log('과타노차 ①: [코스트] GOO 묘지', 'mine');
    if (!_cthulhuSummon('그레이트 올드 원-과타노차', 'hand')) { sendGameState(); renderAll(); return; }
    sendGameState(); renderAll();
    // 선택 보너스 ("할 수 있다")
    gameConfirm('과타노차 ①: 1장 드로우하겠습니까? (선택)', (yes) => {
      if (yes) drawOne();
      sendGameState(); renderAll();
    });
  });
}

// ②: 패에 GOO 있어야, 상대 패/필드에 카드 있어야
function activateGatanother2(fieldIdx) {
  if (!canUseEffect('그레이트 올드 원-과타노차', 2)) { notify('이미 사용했습니다.'); return; }
  const mon = G.myField[fieldIdx];
  if (!mon || mon.id !== '그레이트 올드 원-과타노차') { notify('필드에 과타노차가 없습니다.'); return; }
  const gooHand = G.myHand.filter(h => _isGOO(h.id));
  if (gooHand.length === 0) { notify('발동 불가: 소환할 GOO가 패에 없습니다.'); return; }
  const opTargets = [
    ...G.opHand.filter(h => h.isPublic).map(h => ({ id: h.id, name: h.name, _src: 'hand_pub' })),
    ...(G.opHand.some(h => !h.isPublic) ? [{ id: '_unknown', name: '상대 패 (비공개)', _src: 'hand_any' }] : []),
    ...G.opField.map((m2, i) => ({ id: m2.id, name: m2.name, _src: 'field', _i: i })),
  ];
  if (opTargets.length === 0) { notify('발동 불가: 코스트로 보낼 상대 패/필드가 없습니다.'); return; }
  openCardPicker(opTargets, '과타노차 ②: [코스트] 이 카드 + 상대 패/필드 1장 묘지', 1, (sel) => {
    if (sel.length === 0) return;
    markEffectUsed('그레이트 올드 원-과타노차', 2);
    G.myGrave.push(G.myField.splice(fieldIdx, 1)[0]);
    const picked = opTargets[sel[0]];
    if (picked._src === 'hand_pub' || picked._src === 'hand_any') {
      sendAction({ type: 'forceDiscard', count: 1, reason: '과타노차 ②', attackerPicks: false });
    } else {
      const fi = picked._i;
      if (fi !== undefined) {
        const m2 = G.opField.splice(fi, 1)[0];
        if (m2) { G.opGrave.push(m2); sendAction({ type: 'opFieldRemove', cardId: m2.id, to: 'grave' }); }
      }
    }
    log('과타노차 ②: [코스트] 이 카드 + 상대 묘지', 'mine');
    openCardPicker(gooHand, '과타노차 ②: [의무] 패에서 GOO 소환', 1, (sel2) => {
      if (sel2.length > 0) {
        const target = gooHand[sel2[0]];
        const hi = G.myHand.findIndex(h => h === target);
        if (hi >= 0) {
          const s = G.myHand.splice(hi, 1)[0];
          G.myField.push({ id: s.id, name: s.name, atk: CARDS[s.id]?.atk ?? 4, atkBase: CARDS[s.id]?.atk ?? 4 });
          log(`과타노차 ②: ${s.name} 소환`, 'mine');
        }
      }
      sendGameState(); renderAll();
    });
  });
}

// ─────────────────────────────────────────────
// 노덴스 ①②
// ─────────────────────────────────────────────

// ①: 소환 후 GOO 묻기 의무 → 필드에 GOO 있어야 발동 가능
function activateNodens1(from) {
  if (!canUseEffect('엘더 갓-노덴스', 1)) { notify('이미 사용했습니다. (2번까지)'); return; }
  const gooOnField = G.myField.filter(m => _isGOO(m.id));
  if (gooOnField.length === 0) { notify('발동 불가: 패널티로 보낼 자신 필드 GOO가 없습니다.'); return; }
  markEffectUsed('엘더 갓-노덴스', 1);
  if (!_cthulhuSummon('엘더 갓-노덴스', from)) { return; }
  sendGameState(); renderAll();
  // 의무 패널티: 1장 이상 선택 (최소 1, 최대 전부)
  openCardPicker(gooOnField, '노덴스 ①: [패널티] 자신 필드 GOO 1장 이상 묘지 (의무, 최소 1장)', gooOnField.length, (sel) => {
    if (sel.length === 0) sel = [0]; // 최소 1장 강제
    sel.sort((a, b) => b - a).forEach(i => {
      const fi = G.myField.findIndex(m => m === gooOnField[i]);
      if (fi >= 0) G.myGrave.push(G.myField.splice(fi, 1)[0]);
    });
    log(`노덴스 ①: [패널티] GOO ${sel.length}장 묘지`, 'mine');
    sendGameState(); renderAll();
  });
}

// ②: 덱에 GOO 있어야, 묘지에 GOO 있어야 발동 가능
function activateNodens2() {
  if (!canUseEffect('엘더 갓-노덴스', 2)) { notify('이미 사용했습니다. (2번까지)'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  const gooGrave = G.myGrave.filter(g => _isGOO(g.id));
  const gooDeck  = findAllInDeck(dc => _isGOO(dc.id));
  if (gooGrave.length === 0) { notify('발동 불가: 코스트로 제외할 묘지 GOO가 없습니다.'); return; }
  if (gooDeck.length === 0)  { notify('발동 불가: 덱에 보낼 GOO가 없습니다.'); return; }
  markEffectUsed('엘더 갓-노덴스', 2);
  openCardPicker(gooGrave, '노덴스 ②: [코스트] 묘지 GOO 제외', 1, (sel) => {
    if (sel.length > 0) {
      const gi = G.myGrave.findIndex(g => g === gooGrave[sel[0]]);
      if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
    }
    openCardPicker(gooDeck, '노덴스 ②: [의무] 덱에서 GOO 묘지로', 1, (sel2) => {
      if (sel2.length > 0) {
        const t = gooDeck[sel2[0]];
        removeFromDeck(t.id);
        G.myGrave.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
        log(`노덴스 ②: ${t.id} 덱→묘지`, 'mine');
      }
      sendGameState(); renderAll();
    });
  });
}

// ─────────────────────────────────────────────
// 크타니트 ①②③
// ─────────────────────────────────────────────

// ①: 서로 드로우 (상대 드로우 = 패널티 가능성, 발동 조건 없음)
function activateKthanid1(from) {
  if (!canUseEffect('엘더 갓-크타니트', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('엘더 갓-크타니트', 1);
  if (!_cthulhuSummon('엘더 갓-크타니트', from)) { return; }
  drawOne();
  sendAction({ type: 'opDraw', count: 1 });
  log('크타니트 ①: 서로 1장 드로우 (의무)', 'mine');
  sendGameState(); renderAll();
}

// ②: 상대 패 버리기 → 자신 드로우 (발동 조건: 크타니트가 이 턴 소환됐어야)
function activateKthanid2(fieldIdx) {
  const KEY = '엘더 갓-크타니트_23';
  if (!canUseEffect(KEY, 1)) { notify('이미 사용했습니다. (2,3효과 합산 1턴 1번)'); return; }
  if (G.opHand.length === 0) { notify('발동 불가: 상대 패가 없습니다.'); return; }
  markEffectUsed(KEY, 1);
  sendAction({ type: 'forceDiscard', count: 1, reason: '크타니트 ②', attackerPicks: false });
  log('크타니트 ②: 상대 패 1장 버리기 (의무)', 'mine');
  drawOne();
  log('크타니트 ②: 자신 드로우', 'mine');
  sendGameState(); renderAll();
}

// ③: [코스트] 상대 덱 맨 위 제외 → [선택] 서로 패 몬스터 소환
function activateKthanid3(fieldIdx) {
  const KEY = '엘더 갓-크타니트_23';
  if (!canUseEffect(KEY, 1)) { notify('이미 사용했습니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  if (G.opDeck.length === 0) { notify('발동 불가: 상대 덱이 비어있습니다.'); return; }
  markEffectUsed(KEY, 1);
  sendAction({ type: 'opDeckTopExile', reason: '크타니트 ③' });
  log('크타니트 ③: [코스트] 상대 덱 맨 위 제외', 'mine');
  const myMons = G.myHand.filter(h => CARDS[h.id]?.cardType === 'monster');
  if (myMons.length === 0) { sendGameState(); renderAll(); return; }
  // "할 수 있다" — 선택
  gameConfirm('크타니트 ③: 패에서 몬스터 1장 소환하겠습니까? (선택)', (yes) => {
    if (!yes) { sendGameState(); renderAll(); return; }
    openCardPicker(myMons, '크타니트 ③: 패에서 몬스터 소환', 1, (sel) => {
      if (sel.length > 0) {
        const target = myMons[sel[0]];
        const hi = G.myHand.findIndex(h => h === target);
        if (hi >= 0) {
          const mon = G.myHand.splice(hi, 1)[0];
          G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
          log(`크타니트 ③: ${mon.name} 소환`, 'mine');
        }
      }
      sendGameState(); renderAll();
    });
  });
}

// ─────────────────────────────────────────────
// 히프노스 ①③
// ─────────────────────────────────────────────

// ①: 제외됐을 때 → 소환 + 드로우 → [선택] GOO 버리면 추가 드로우
function activateHypnos1() {
  if (!canUseEffect('엘더 갓-히프노스', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('엘더 갓-히프노스', 1);
  if (!_cthulhuSummon('엘더 갓-히프노스', 'exile')) { return; }
  drawOne();
  log('히프노스 ①: 드로우', 'mine');
  sendGameState(); renderAll();
  const gooHand = G.myHand.filter(h => _isGOO(h.id));
  if (gooHand.length === 0) { return; }
  // "원한다면" — 선택
  gameConfirm('히프노스 ①: GOO 1장 버리고 추가 드로우? (선택)', (yes) => {
    if (!yes) { sendGameState(); renderAll(); return; }
    openCardPicker(gooHand, '히프노스 ①: GOO 버리기', 1, (sel) => {
      if (sel.length > 0) {
        const hi = G.myHand.findIndex(h => h === gooHand[sel[0]]);
        if (hi >= 0) G.myGrave.push(G.myHand.splice(hi, 1)[0]);
        drawOne();
        log('히프노스 ①: 추가 드로우', 'mine');
      }
      sendGameState(); renderAll();
    });
  });
}

// ③: 공격 단계 → 묘지 몬스터 소환
function activateHypnos3(fieldIdx) {
  if (!canUseEffect('엘더 갓-히프노스', 3)) { notify('이미 사용했습니다.'); return; }
  if (!isMyTurn || currentPhase !== 'attack') { notify('자신 공격 단계에만 발동 가능합니다.'); return; }
  const targets = G.myGrave.filter(g => CARDS[g.id]?.cardType === 'monster');
  if (targets.length === 0) { notify('발동 불가: 묘지에 몬스터가 없습니다.'); return; }
  markEffectUsed('엘더 갓-히프노스', 3);
  openCardPicker(targets, '히프노스 ③: 묘지에서 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) {
      const t = targets[sel[0]];
      const gi = G.myGrave.findIndex(g => g === t);
      if (gi >= 0) {
        const mon = G.myGrave.splice(gi, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
        log(`히프노스 ③: ${mon.name} 소환`, 'mine');
      }
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 올드_원의 멸망 ①②
// ─────────────────────────────────────────────

function activateOldOneRuin1(handIdx) {
  if (!canUseEffect('올드_원의 멸망', 1)) { notify('이미 사용했습니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  const elderDeck = findAllInDeck(dc => _isElderGod(dc.id));
  if (elderDeck.length === 0) { notify('발동 불가: 코스트로 제외할 덱 엘더 갓이 없습니다.'); return; }
  const gooPool = [
    ...findAllInDeck(dc => _isGOO(dc.id)).map(d => ({ ...d, _from: 'deck' })),
    ...G.myGrave.filter(g => _isGOO(g.id)).map(g => ({ ...g, _from: 'grave' })),
  ];
  if (gooPool.length === 0) { notify('발동 불가: 소환할 GOO가 덱/묘지에 없습니다.'); return; }
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  openCardPicker(elderDeck, '멸망 ①: [코스트] 덱에서 엘더 갓 제외', 1, (sel) => {
    if (sel.length === 0) { sendGameState(); renderAll(); return; }
    markEffectUsed('올드_원의 멸망', 1);
    const t = elderDeck[sel[0]];
    removeFromDeck(t.id);
    G.myExile.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
    log(`멸망 ①: [코스트] ${t.id} 제외`, 'mine');
    openCardPicker(gooPool, '멸망 ①: [의무] 덱/묘지에서 GOO 소환', 1, (sel2) => {
      if (sel2.length > 0) {
        const picked = gooPool[sel2[0]];
        if (picked._from === 'deck') {
          summonFromDeck(picked.id);
        } else {
          const gi = G.myGrave.findIndex(g => g.id === picked.id);
          if (gi >= 0) {
            const mon = G.myGrave.splice(gi, 1)[0];
            G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 4, atkBase: CARDS[mon.id]?.atk ?? 4 });
            log(`멸망 ①: ${mon.name} 묘지에서 소환`, 'mine');
          }
        }
      }
      sendGameState(); renderAll();
    });
  });
}

function activateOldOneRuin2() {
  if (!canUseEffect('올드_원의 멸망', 2)) { notify('이미 사용했습니다.'); return; }
  if (isMyTurn) { notify('발동 불가: 상대 턴에만 발동 가능합니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  const gi = G.myGrave.findIndex(g => g.id === '올드_원의 멸망');
  if (gi < 0) { notify('묘지에 올드_원의 멸망이 없습니다.'); return; }
  const targets = findAllInDeck(dc => _isOldOne(dc));
  if (targets.length === 0) { notify('발동 불가: 덱에 올드원 카드가 없습니다.'); return; }
  markEffectUsed('올드_원의 멸망', 2);
  G.myExile.push(G.myGrave.splice(gi, 1)[0]);
  openCardPicker(targets, '멸망 ②: 덱에서 올드원 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 니알라토텝 ①②
// ─────────────────────────────────────────────

function activateNyarlathotep1() {
  if (!canUseEffect('아우터 갓 니알라토텝', 1)) { notify('이미 사용했습니다.'); return; }
  if (G.opField.length < 1) { notify('발동 불가: 코스트로 보낼 상대 필드 카드가 없습니다.'); return; }
  const gooOnField   = G.myField.filter(m => _isGOO(m.id));
  const elderOnField = G.myField.filter(m => _isElderGod(m.id));
  if (gooOnField.length < 2)   { notify(`발동 불가: 자신 필드에 GOO 2장 필요 (현재 ${gooOnField.length}장)`); return; }
  if (elderOnField.length < 2) { notify(`발동 불가: 자신 필드에 엘더 갓 2장 필요 (현재 ${elderOnField.length}장)`); return; }
  markEffectUsed('아우터 갓 니알라토텝', 1);
  openCardPicker([...G.opField], '니알라토텝 ①: [코스트] 상대 필드 1장 묘지', 1, (selOp) => {
    if (selOp.length > 0) {
      const mon = G.opField.splice(selOp[0], 1)[0];
      G.opGrave.push(mon);
      sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' });
    }
    openCardPicker(gooOnField, '니알라토텝 ①: [코스트] 자신 GOO 2장 묘지', 2, (selGoo) => {
      selGoo.sort((a, b) => b - a).forEach(i => {
        const fi = G.myField.findIndex(m => m === gooOnField[i]);
        if (fi >= 0) G.myGrave.push(G.myField.splice(fi, 1)[0]);
      });
      openCardPicker(elderOnField, '니알라토텝 ①: [코스트] 자신 엘더 갓 2장 묘지', 2, (selElder) => {
        selElder.sort((a, b) => b - a).forEach(i => {
          const fi = G.myField.findIndex(m => m === elderOnField[i]);
          if (fi >= 0) G.myGrave.push(G.myField.splice(fi, 1)[0]);
        });
        const ki = G.myKeyDeck.findIndex(k => k.id === '아우터 갓 니알라토텝');
        if (ki >= 0) {
          const kc = G.myKeyDeck.splice(ki, 1)[0];
          G.myField.push({ id: kc.id, name: kc.name, atk: CARDS[kc.id]?.atk ?? 6, atkBase: CARDS[kc.id]?.atk ?? 6 });
          log('니알라토텝 ①: 소환', 'mine');
        }
        G.nyarlathotepSummonLimit = true;
        log('니알라토텝 ①: 이 턴 추가 소환 1회 제한', 'mine');
        sendGameState(); renderAll();
      });
    });
  });
}

function activateNyarlathotep2(fieldIdx) {
  if (!canUseEffect('아우터 갓 니알라토텝', 2)) { notify('이미 사용했습니다.'); return; }
  if (G.opField.length === 0) { notify('발동 불가: 대상으로 할 상대 몬스터가 없습니다.'); return; }
  markEffectUsed('아우터 갓 니알라토텝', 2);
  openCardPicker([...G.opField], '니알라토텝 ②: 상대 몬스터 효과 무효 + 정보 획득', 1, (sel) => {
    if (sel.length > 0) {
      const mon = G.opField[sel[0]];
      const fi = G.myField.findIndex(m => m.id === '아우터 갓 니알라토텝');
      if (fi >= 0 && CARDS[mon.id]) {
        G.myField[fi].atk = CARDS[mon.id]?.atk ?? G.myField[fi].atk;
        G.myField[fi].copiedFrom = mon.id;
        log(`니알라토텝 ②: ${mon.name} 무효 + ATK ${CARDS[mon.id]?.atk ?? '?'} 획득`, 'mine');
      }
      sendAction({ type: 'negateField', cardId: mon.id });
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 아자토스 ②③④
// ─────────────────────────────────────────────

// ②: 아우터 갓이 상대 효과로 필드에서 벗어났을 때 → [코스트] 그 카드 덱으로 → 소환 + 패 3장까지 버리기
function activateAzathoth2(exiledCardId) {
  if (!canUseEffect('아우터 갓-아자토스', 2)) { notify('이미 사용했습니다.'); return; }
  // 코스트: 벗어난 아우터 갓이 공개 패/묘지/제외에 있어야
  const outerGodCard =
    G.myHand.find(h => h.id === exiledCardId && h.isPublic) ||
    G.myGrave.find(g => g.id === exiledCardId) ||
    G.myExile.find(e => e.id === exiledCardId);
  if (!outerGodCard) { notify('발동 불가: 해당 카드가 공개 패/묘지/제외에 없습니다.'); return; }
  const ki = G.myKeyDeck.findIndex(k => k.id === '아우터 갓-아자토스');
  if (ki < 0) { notify('발동 불가: 키카드 덱에 아자토스가 없습니다.'); return; }
  markEffectUsed('아우터 갓-아자토스', 2);
  // 코스트: 그 카드를 덱으로
  const returnCard = (arr, pred) => {
    const i = arr.findIndex(pred);
    if (i >= 0) { G.myDeck.push(arr.splice(i, 1)[0]); }
  };
  if (G.myHand.find(h => h.id === exiledCardId && h.isPublic))  returnCard(G.myHand,  h => h.id === exiledCardId && h.isPublic);
  else if (G.myGrave.find(g => g.id === exiledCardId))          returnCard(G.myGrave, g => g.id === exiledCardId);
  else if (G.myExile.find(e => e.id === exiledCardId))          returnCard(G.myExile, e => e.id === exiledCardId);
  log(`아자토스 ②: [코스트] ${exiledCardId} 덱으로`, 'mine');
  // 소환
  const kc = G.myKeyDeck.splice(ki, 1)[0];
  G.myField.push({ id: kc.id, name: kc.name, atk: CARDS[kc.id]?.atk ?? 10, atkBase: CARDS[kc.id]?.atk ?? 10 });
  log('아자토스 ②: 소환', 'mine');
  // 의무 패널티: 패를 3장 남을 때까지 버리기
  const tooMany = G.myHand.length - 3;
  if (tooMany <= 0) { log('아자토스 ②: 패 3장 이하이므로 버리기 없음', 'mine'); sendGameState(); renderAll(); return; }
  openCardPicker([...G.myHand], `아자토스 ②: [패널티] 패를 3장 남을 때까지 ${tooMany}장 버리기 (의무)`, tooMany, (sel) => {
    if (sel.length < tooMany) {
      // 강제: 부족하면 앞에서부터 채움
      const needed = tooMany - sel.length;
      for (let i = 0; i < G.myHand.length && sel.length < tooMany; i++) {
        if (!sel.includes(i)) sel.push(i);
      }
    }
    sel.sort((a, b) => b - a).forEach(i => {
      if (G.myHand[i]) G.myGrave.push(G.myHand.splice(i, 1)[0]);
    });
    log(`아자토스 ②: [패널티] ${tooMany}장 버림`, 'mine');
    sendGameState(); renderAll();
  });
}

// ③: [코스트] 필드 카드 3장까지 효과 무효 → [의무] 서로 필드 2장씩 같은 수 제외
function activateAzathoth3(fieldIdx) {
  if (!canUseEffect('아우터 갓-아자토스', 3)) { notify('이미 사용했습니다.'); return; }
  const allFieldCount = G.myField.length + G.opField.length;
  if (allFieldCount === 0) { notify('발동 불가: 필드에 카드가 없습니다.'); return; }
  markEffectUsed('아우터 갓-아자토스', 3);
  // 코스트: 최대 3장 무효 선택
  const allField = [
    ...G.myField.map((m, i) => ({ id: m.id, name: m.name, _src: 'mine', _i: i })),
    ...G.opField.map((m, i) => ({ id: m.id, name: m.name, _src: 'op',   _i: i })),
  ];
  const negCount = Math.min(3, allField.length);
  openCardPicker(allField, `아자토스 ③: [코스트] 필드 카드 최대 ${negCount}장 효과 무효`, negCount, (selNeg) => {
    selNeg.forEach(i => {
      const p = allField[i];
      sendAction({ type: 'negateField', cardId: p.id });
      log(`아자토스 ③: ${p.id} 효과 무효`, 'mine');
    });
    // 의무: 서로 최대 2장씩 같은 수 제외
    const myCount  = Math.min(2, G.myField.length);
    const opCount  = Math.min(2, G.opField.length);
    const exCount  = Math.min(myCount, opCount); // 같은 수
    if (exCount === 0) { log('아자토스 ③: 한쪽 필드가 비어 제외 스킵', 'mine'); sendGameState(); renderAll(); return; }
    openCardPicker([...G.myField].map((m, i) => ({ id: m.id, name: m.name, _i: i })),
      `아자토스 ③: [의무] 자신 필드 ${exCount}장 제외`, exCount, (selMy) => {
      selMy.sort((a, b) => b - a).forEach(i => {
        const mon = G.myField.splice(i, 1)[0];
        if (mon) G.myExile.push(mon);
      });
      openCardPicker([...G.opField].map((m, i) => ({ id: m.id, name: m.name, _i: i })),
        `아자토스 ③: [의무] 상대 필드 ${exCount}장 제외`, exCount, (selOp) => {
        selOp.sort((a, b) => b - a).forEach(i => {
          const mon = G.opField.splice(i, 1)[0];
          if (mon) { G.opExile.push(mon); sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' }); }
        });
        log(`아자토스 ③: 서로 ${exCount}장씩 제외`, 'mine');
        sendGameState(); renderAll();
      });
    });
  });
}

// ④: 아자토스가 자신 효과로 필드에서 벗어났을 때 → 소환 + 서로 패 1장 제외
function activateAzathoth4() {
  if (!canUseEffect('아우터 갓-아자토스', 4)) { notify('이미 사용했습니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  markEffectUsed('아우터 갓-아자토스', 4);
  // 키카드 덱에서 소환
  const ki = G.myKeyDeck.findIndex(k => k.id === '아우터 갓-아자토스');
  if (ki >= 0) {
    const kc = G.myKeyDeck.splice(ki, 1)[0];
    G.myField.push({ id: kc.id, name: kc.name, atk: CARDS[kc.id]?.atk ?? 10, atkBase: CARDS[kc.id]?.atk ?? 10 });
    log('아자토스 ④: 소환', 'mine');
  }
  // 서로 패 1장 제외
  if (G.myHand.length > 0) {
    openCardPicker([...G.myHand], '아자토스 ④: 자신 패 1장 제외 (의무)', 1, (sel) => {
      if (sel.length > 0) G.myExile.push(G.myHand.splice(sel[0], 1)[0]);
      sendAction({ type: 'forceExileHandCard', count: 1, reason: '아자토스 ④' });
      log('아자토스 ④: 서로 패 1장 제외', 'mine');
      sendGameState(); renderAll();
    });
  } else {
    sendAction({ type: 'forceExileHandCard', count: 1, reason: '아자토스 ④' });
    sendGameState(); renderAll();
  }
}

// ─────────────────────────────────────────────
// 슈브 니구라스 ①②
// ─────────────────────────────────────────────

// ①: GOO 소환됐을 때 자동 소환 → 덱에서 GOO 묘지로
function activateShub1() {
  if (!canUseEffect('아우터 갓 슈브 니구라스', 1)) { notify('이미 사용했습니다.'); return; }
  const gooDeck = findAllInDeck(dc => _isGOO(dc.id));
  if (gooDeck.length === 0) { notify('발동 불가: 덱에 GOO가 없습니다.'); return; }
  markEffectUsed('아우터 갓 슈브 니구라스', 1);
  // 키카드 덱에서 소환
  const ki = G.myKeyDeck.findIndex(k => k.id === '아우터 갓 슈브 니구라스');
  if (ki >= 0) {
    const kc = G.myKeyDeck.splice(ki, 1)[0];
    G.myField.push({ id: kc.id, name: kc.name, atk: CARDS[kc.id]?.atk ?? 0, atkBase: CARDS[kc.id]?.atk ?? 0 });
    log('슈브 니구라스 ①: 소환', 'mine');
  }
  // 의무: 덱에서 GOO 묘지
  openCardPicker(gooDeck, '슈브 니구라스 ①: [의무] 덱에서 GOO 묘지로', 1, (sel) => {
    if (sel.length > 0) {
      const t = gooDeck[sel[0]];
      removeFromDeck(t.id);
      G.myGrave.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
      log(`슈브 니구라스 ①: ${t.id} 덱→묘지`, 'mine');
    }
    sendGameState(); renderAll();
  });
}

// ②: 상대가 효과 발동 시 → [코스트] 덱에서 엘더 갓 제외 → [의무] 그 효과 무효
function activateShub2() {
  if (!canUseEffect('아우터 갓 슈브 니구라스', 2)) { notify('이미 사용했습니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 제외할 수 없습니다.'); return; }
  const elderDeck = findAllInDeck(dc => _isElderGod(dc.id));
  if (elderDeck.length === 0) { notify('발동 불가: 코스트로 제외할 덱 엘더 갓이 없습니다.'); return; }
  markEffectUsed('아우터 갓 슈브 니구라스', 2);
  openCardPicker(elderDeck, '슈브 니구라스 ②: [코스트] 덱에서 엘더 갓 제외', 1, (sel) => {
    if (sel.length > 0) {
      const t = elderDeck[sel[0]];
      removeFromDeck(t.id);
      G.myExile.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
      log(`슈브 니구라스 ②: [코스트] ${t.id} 제외 → 상대 효과 무효`, 'mine');
    }
    // 무효 처리는 체인 시스템에 연동 (상대에게 알림)
    sendAction({ type: 'effectNegated', reason: '슈브 니구라스 ②' });
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// sendToGrave / exile 후킹
// ─────────────────────────────────────────────
// 아자토스 절대 내성 체크
// 반환값: true = 아자토스가 차단 (묘지/제외 불가), false = 정상 진행
function checkAzathothImmunity(cardId) {
  if (cardId !== '아우터 갓-아자토스') return false;
  if (!G.myField.some(m => m.id === '아우터 갓-아자토스')) return false;
  log('아자토스 ①: 묘지로 보내지지 않는다 — 무효!', 'mine');
  notify('아우터 갓-아자토스는 묘지로 보낼 수 없습니다.');
  return true;
}

(function _hookCthulhuGrave() {
  const _prev = sendToGrave;
  sendToGrave = function (cardId, from) {
    // 아자토스는 어떤 경로로도 묘지로 갈 수 없음
    if (checkAzathothImmunity(cardId)) return;
    _prev(cardId, from);
    if (cardId === '그레이트 올드 원-크툴루' && from !== 'hand' && canUseEffect('그레이트 올드 원-크툴루', 3)) {
      gameConfirm('크툴루 ③: 덱에서 GOO 서치?', (yes) => { if (yes) activateCthulhu3(); });
    }
    if (cardId === '그레이트 올드 원-크투가' && from !== 'hand' && canUseEffect('그레이트 올드 원-크투가', 3)) {
      gameConfirm('크투가 ③: 발동?', (yes) => { if (yes) activateKtuga3(); });
    }
    if (cardId === '그레이트 올드 원-크아이가' && from === 'field' && canUseEffect('그레이트 올드 원-크아이가_23', 1)) {
      gameConfirm('크아이가 ③: 발동?', (yes) => { if (yes) activateKraiga3(); });
    }
    if (cardId === '엘더 갓-노덴스' && from !== 'hand' && canUseEffect('엘더 갓-노덴스', 1)) {
      gameConfirm('노덴스 ①: 묘지에서 소환 + GOO 묻기?', (yes) => { if (yes) activateNodens1('grave'); });
    }
    // 슈브 니구라스: GOO 소환됐을 때 자동 소환 트리거
    if (_isGOO(cardId) === false && from !== 'hand') { /* GOO 소환은 필드로 가는 경우라 여기선 해당 없음 */ }
  };
})();

// GOO가 필드에 올라올 때 슈브 니구라스 트리거
(function _hookGooSummonForShub() {
  const _prev = sendToGrave; // 이미 후킹됨, 대신 onSummoned 방식 사용
  // summonFromDeck/summonFromGrave 이후 트리거는 patch.js의 _fireOnSummoned가 처리
  // 여기선 직접 _cthulhuSummon에 hook 추가
  const _origCthulhuSummon = _cthulhuSummon;
  // _cthulhuSummon은 이미 정의됐으므로 wrapper 불필요 — onSummoned에서 처리
})();

(function _hookCthulhuExile() {
  const origPush = G.myExile.push.bind(G.myExile);
  G.myExile.push = function (...items) {
    const result = origPush(...items);
    items.forEach(item => {
      if (!item?.id) return;
      if (item.id === '엘더 갓-노덴스' && canUseEffect('엘더 갓-노덴스', 1)) {
        gameConfirm('노덴스 ①: 제외됐습니다. 소환?', (yes) => { if (yes) activateNodens1('exile'); });
      }
      if (item.id === '엘더 갓-히프노스' && canUseEffect('엘더 갓-히프노스', 1)) {
        gameConfirm('히프노스 ①: 제외됐습니다. 소환?', (yes) => { if (yes) activateHypnos1(); });
      }
      if (item.id === '엘더 갓-크타니트' && canUseEffect('엘더 갓-크타니트', 1)) {
        gameConfirm('크타니트 ①: 제외됐습니다. 소환?', (yes) => { if (yes) activateKthanid1('exile'); });
      }
    });
    return result;
  };
})();

// ─────────────────────────────────────────────
// 소환 트리거 (onSummoned)
// ─────────────────────────────────────────────
function onCthulhuSummoned(cardId) {
  // GOO가 소환됐을 때 슈브 니구라스 트리거
  if (_isGOO(cardId) && canUseEffect('아우터 갓 슈브 니구라스', 1)) {
    // 슈브 니구라스가 키카드 덱에 있어야
    const ki = G.myKeyDeck.findIndex(k => k.id === '아우터 갓 슈브 니구라스');
    if (ki >= 0) {
      gameConfirm(`슈브 니구라스 ①: ${CARDS[cardId]?.name || cardId} 소환됨. 슈브 니구라스 소환 + GOO 덱→묘지?`, (yes) => {
        if (yes) activateShub1();
      });
    }
  }
}

// ─────────────────────────────────────────────
// 라우터
// ─────────────────────────────────────────────
function activateCthulhuCardFromHand(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  switch (c.id) {
    case '그레이트 올드 원-크툴루':   if (effectNum === 1) activateCthulhu1(handIdx); break;
    case '그레이트 올드 원-크투가':
      if (effectNum === 1) activateKtuga1(handIdx);
      else if (effectNum === 2) activateKtuga2(handIdx);
      break;
    case '그레이트 올드 원-크아이가': if (effectNum === 1) activateKraiga1(handIdx); break;
    case '그레이트 올드 원-과타노차': if (effectNum === 1) activateGatanother1(handIdx); break;
    case '엘더 갓-크타니트':         if (effectNum === 1) activateKthanid1('hand'); break;
    case '올드_원의 멸망':           if (effectNum === 1) activateOldOneRuin1(handIdx); break;
    default: activateThemeCardEffectFromHand(handIdx, effectNum);
  }
}

function activateCthulhuFieldEffect(fieldIdx, effectNum) {
  const mon = G.myField[fieldIdx];
  if (!mon) return;
  switch (mon.id) {
    case '그레이트 올드 원-크툴루':   if (effectNum === 2) activateCthulhu2(fieldIdx); break;
    case '그레이트 올드 원-크투가':   if (effectNum === 2) activateKtuga2(fieldIdx); break;
    case '그레이트 올드 원-크아이가': if (effectNum === 2) activateKraiga2(fieldIdx); break;
    case '그레이트 올드 원-과타노차': if (effectNum === 2) activateGatanother2(fieldIdx); break;
    case '엘더 갓-노덴스':           if (effectNum === 2) activateNodens2(); break;
    case '엘더 갓-크타니트':
      if (effectNum === 2) activateKthanid2(fieldIdx);
      else if (effectNum === 3) activateKthanid3(fieldIdx);
      break;
    case '엘더 갓-히프노스':         if (effectNum === 3) activateHypnos3(fieldIdx); break;
    case '아우터 갓 니알라토텝':     if (effectNum === 2) activateNyarlathotep2(fieldIdx); break;
    case '아우터 갓-아자토스':
      if (effectNum === 3) activateAzathoth3(fieldIdx);
      break;
    case '아우터 갓 슈브 니구라스':  if (effectNum === 2) activateShub2(); break;
    default: notify(`${mon.name}: 수동 발동 가능한 필드 효과가 없습니다.`);
  }
}

function activateCthulhuGraveEffect(cardId) {
  switch (cardId) {
    case '그레이트 올드 원-크아이가': activateKraiga4(); break;
    case '엘더 갓-노덴스':           activateNodens2(); break;
    case '올드_원의 멸망':           activateOldOneRuin2(); break;
    default: notify('이 카드는 묘지 효과가 없습니다.');
  }
}

function handleCthulhuOpAction(action) {
  if (action.type === 'opDeckTopExile') {
    if (G.myDeck.length > 0) {
      const top = G.myDeck.shift();
      G.myExile.push(top);
      log(`상대 크타니트 ③: 내 덱 맨 위 ${CARDS[top.id]?.name || top.id} 제외`, 'opponent');
      sendGameState(); renderAll();
    }
  }
  if (action.type === 'effectNegated') {
    log(`상대 슈브 니구라스 ②: 내 효과 무효됨 (${action.reason || ''})`, 'opponent');
  }
}

['크툴루', '올드원', '올드 원'].forEach(theme => {
  registerThemeEffectHandler(theme, {
    activateFromHand:    activateCthulhuCardFromHand,
    resolveLink:         resolveThemeEffectGeneric,
    onSummoned:          onCthulhuSummoned,
    activateFieldEffect: activateCthulhuFieldEffect,
    activateGraveEffect: activateCthulhuGraveEffect,
    handleOpAction:      handleCthulhuOpAction,
  });
});
