// ============================================================
// PENGUIN EFFECT ENGINE
// 펭귄 테마 카드 효과 자동 처리 모듈
// ============================================================
// 이 파일은 index.html의 G, sendAction, renderAll, log, notify,
// openCardPicker, drawCards, forceDiscard 등 전역 함수에 의존합니다.

// ─────────────────────────────────────────────
// 턴제 발동 횟수 추적
// ─────────────────────────────────────────────
const effectUsed = {};  // { "카드명_효과번호": 횟수 }

function resetEffectUsed() {
  Object.keys(effectUsed).forEach(k => delete effectUsed[k]);
}

function checkEffectLimit(cardName, effectNum, limit = 1) {
  const key = `${cardName}_${effectNum}`;
  const used = effectUsed[key] || 0;
  if (used >= limit) {
    notify(`${cardName}의 ${effectNum}효과는 이미 이번 턴에 ${limit}번 사용했습니다.`);
    return false;
  }
  effectUsed[key] = used + 1;
  return true;
}

// ─────────────────────────────────────────────
// 헬퍼: 덱에서 특정 카드 찾기
// ─────────────────────────────────────────────
function findInDeck(filter) {
  // filter: (cardId) => bool
  return G.myDeck.filter(filter);
}

function removeFromDeck(cardId) {
  const idx = G.myDeck.findIndex(c => c.id === cardId);
  if (idx >= 0) { G.myDeck.splice(idx, 1); return true; }
  return false;
}

function findInGrave(filter) {
  return G.myGrave.filter(filter);
}

function isPenguin(cardId) {
  const c = CARDS[cardId];
  return c && (c.theme === '펭귄' || cardId.includes('펭귄'));
}

function isPenguinMonster(cardId) {
  const c = CARDS[cardId];
  return isPenguin(cardId) && c && c.cardType === 'monster';
}

function isPenguinMagic(cardId) {
  const c = CARDS[cardId];
  return isPenguin(cardId) && c && (c.cardType === 'magic');
}

function hasPenguinMaul() {
  // 펭귄 마을이 공개 상태로 필드에 존재하는지
  return G.myFieldCard && G.myFieldCard.id === '펭귄 마을' && G.myFieldCard.isPublic;
}

function hasPenguinOnField() {
  return G.myField.some(m => isPenguinMonster(m.id));
}

// ─────────────────────────────────────────────
// 카드를 덱에서 패로 가져오기 (공개패)
// ─────────────────────────────────────────────
function searchFromDeck(filter, count, callback) {
  const matches = G.myDeck.filter(c => filter(c.id));
  if (matches.length === 0) {
    notify('덱에 해당하는 카드가 없습니다.');
    callback([]);
    return;
  }
  const pickCount = Math.min(count, matches.length);
  if (pickCount === 1 && matches.length === 1) {
    // 자동 선택
    removeFromDeck(matches[0].id);
    const card = { ...matches[0], isPublic: true };
    G.myHand.push(card);
    callback([card]);
    return;
  }
  openCardPicker(
    matches,
    `덱에서 카드 ${pickCount}장 선택`,
    pickCount,
    (selectedIdxs) => {
      const chosen = selectedIdxs.map(i => matches[i]);
      chosen.forEach(c => {
        removeFromDeck(c.id);
        G.myHand.push({ ...c, isPublic: true });
      });
      callback(chosen);
    }
  );
}

// ─────────────────────────────────────────────
// 덱에서 소환하기
// ─────────────────────────────────────────────
function summonFromDeck(filter, callback) {
  const matches = G.myDeck.filter(c => filter(c.id));
  if (matches.length === 0) { notify('덱에 소환할 카드가 없습니다.'); callback(null); return; }
  if (G.myField.length >= 5 + (G.myExtraSlots || 0)) { notify('몬스터 존이 가득 찼습니다.'); callback(null); return; }

  const pick = (chosen) => {
    removeFromDeck(chosen.id);
    const card = CARDS[chosen.id];
    const mon = { id: chosen.id, name: card.name, atk: card.atk || 0 };
    G.myField.push(mon);
    log(`덱에서 소환: ${card.name} (ATK ${card.atk})`, 'mine');
    sendAction({ type: 'summon', cardId: chosen.id, from: 'deck' });
    callback(mon);
  };

  if (matches.length === 1) { pick(matches[0]); return; }

  openCardPicker(matches, '덱에서 소환할 몬스터 선택', 1, (idxs) => {
    if (idxs.length === 0) { callback(null); return; }
    pick(matches[idxs[0]]);
  });
}

// ─────────────────────────────────────────────
// 패에서 소환하기
// ─────────────────────────────────────────────
function summonFromHand(filter, callback) {
  const matches = G.myHand.map((c, i) => ({ ...c, _idx: i })).filter(c => filter(c.id));
  if (matches.length === 0) { notify('패에 소환할 카드가 없습니다.'); callback(null); return; }
  if (G.myField.length >= 5 + (G.myExtraSlots || 0)) { notify('몬스터 존이 가득 찼습니다.'); callback(null); return; }

  const pick = (chosen) => {
    G.myHand.splice(chosen._idx, 1);
    const card = CARDS[chosen.id];
    const mon = { id: chosen.id, name: card.name, atk: card.atk || 0 };
    G.myField.push(mon);
    log(`패에서 소환: ${card.name} (ATK ${card.atk})`, 'mine');
    sendAction({ type: 'summon', cardId: chosen.id, from: 'hand' });
    callback(mon);
  };

  if (matches.length === 1) { pick(matches[0]); return; }

  openCardPicker(matches, '패에서 소환할 몬스터 선택', 1, (idxs) => {
    if (idxs.length === 0) { callback(null); return; }
    // re-find index after picker
    const target = matches[idxs[0]];
    const realIdx = G.myHand.findIndex(c => c.id === target.id);
    if (realIdx >= 0) {
      const card = CARDS[target.id];
      G.myHand.splice(realIdx, 1);
      const mon = { id: target.id, name: card.name, atk: card.atk || 0 };
      G.myField.push(mon);
      log(`패에서 소환: ${card.name} (ATK ${card.atk})`, 'mine');
      sendAction({ type: 'summon', cardId: target.id, from: 'hand' });
      callback(mon);
    }
  });
}

// ─────────────────────────────────────────────
// 묘지에서 소환하기
// ─────────────────────────────────────────────
function summonFromGrave(filter, callback) {
  const matches = G.myGrave.filter(c => filter(c.id));
  if (matches.length === 0) { notify('묘지에 소환할 카드가 없습니다.'); callback(null); return; }
  if (G.myField.length >= 5 + (G.myExtraSlots || 0)) { notify('몬스터 존이 가득 찼습니다.'); callback(null); return; }

  const pick = (chosen) => {
    const graveIdx = G.myGrave.findIndex(c => c.id === chosen.id);
    if (graveIdx >= 0) G.myGrave.splice(graveIdx, 1);
    const card = CARDS[chosen.id];
    const mon = { id: chosen.id, name: card.name, atk: card.atk || 0 };
    G.myField.push(mon);
    log(`묘지에서 소환: ${card.name} (ATK ${card.atk})`, 'mine');
    sendAction({ type: 'summon', cardId: chosen.id, from: 'grave' });
    callback(mon);
  };

  if (matches.length === 1) { pick(matches[0]); return; }

  openCardPicker(matches, '묘지에서 소환할 몬스터 선택', 1, (idxs) => {
    if (idxs.length === 0) { callback(null); return; }
    pick(matches[idxs[0]]);
  });
}

// ─────────────────────────────────────────────
// 자신이 패를 선택해서 버리기
// ─────────────────────────────────────────────
function selfDiscard(count, callback) {
  if (G.myHand.length === 0) { callback([]); return; }
  const actual = Math.min(count, G.myHand.length);
  openCardPicker(G.myHand, `패를 ${actual}장 버립니다`, actual, (idxs) => {
    const discarded = [];
    idxs.sort((a,b) => b-a).forEach(i => {
      const c = G.myHand.splice(i, 1)[0];
      G.myGrave.push(c);
      discarded.push(c);
      log(`패 버림: ${c.name}`, 'mine');
    });
    sendAction({ type: 'discard', cards: discarded.map(c => c.id) });
    callback(discarded);
    checkWinCondition();
  });
}

// ─────────────────────────────────────────────
// 상대 패에서 버리기 요청 (Firebase로 전송)
// ─────────────────────────────────────────────
function requestOpDiscard(count, isRandom = false) {
  log(`상대에게 패 ${count}장 버리기 요청`, 'mine');
  sendAction({ type: 'requestDiscard', count, isRandom });
  notify(`상대가 패 ${count}장을 버려야 합니다.`);
}

// ─────────────────────────────────────────────
// 몬스터를 필드에서 묘지로
// ─────────────────────────────────────────────
function sendFieldToGrave(fieldIdx, isMine = true) {
  if (isMine) {
    const mon = G.myField.splice(fieldIdx, 1)[0];
    if (mon) { G.myGrave.push(mon); log(`${mon.name} → 묘지`, 'mine'); }
    return mon;
  } else {
    const mon = G.opField.splice(fieldIdx, 1)[0];
    if (mon) { G.opGrave.push(mon); log(`상대의 ${mon.name} → 묘지`, 'mine'); }
    return mon;
  }
}

// ─────────────────────────────────────────────
// ────────────────────────────────────────────
// 펭귄 카드별 효과 구현
// ────────────────────────────────────────────
// ─────────────────────────────────────────────

// ── 펭귄 마을 (일반) ──
function effect_펭귄마을_1(handIdx) {
  if (!checkEffectLimit('펭귄 마을', 1)) return;
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }

  // 이 카드를 공개한다
  G.myHand[handIdx].isPublic = true;
  // 필드 존에 공개 마법으로 올림
  if (G.myFieldCard) G.myGrave.push(G.myFieldCard);
  const c = G.myHand.splice(handIdx, 1)[0];
  G.myFieldCard = { id: c.id, name: c.name, isPublic: true };
  log('펭귄 마을 공개! (필드에 배치)', 'mine');
  sendAction({ type: 'fieldCard', cardId: '펭귄 마을', isPublic: true });
  renderAll();
}

// 펭귄 마을 ②: 공개 상태에서 버려질 때 대신 펭귄 몬스터를 묘지로
// → 이 효과는 버리기 처리 시 자동으로 체크 (interceptDiscard 참고)
function interceptPenguinMaul_2(discardCallback) {
  if (!hasPenguinMaul()) { discardCallback(false); return; }
  const penguins = G.myField.filter(m => isPenguinMonster(m.id));
  if (penguins.length === 0) { discardCallback(false); return; }

  if (confirm(`펭귄 마을 효과: 패 버리는 대신 필드의 펭귄 몬스터를 묘지로 보낼까요?`)) {
    openCardPicker(penguins, '묘지로 보낼 펭귄 몬스터 선택', 1, (idxs) => {
      if (idxs.length === 0) { discardCallback(false); return; }
      const chosen = penguins[idxs[0]];
      const fieldIdx = G.myField.findIndex(m => m.id === chosen.id);
      if (fieldIdx >= 0) sendFieldToGrave(fieldIdx, true);
      log(`펭귄 마을 ②: ${chosen.name}을 대신 묘지로`, 'mine');
      sendAction({ type: 'penguinMaul2', cardId: chosen.id });
      discardCallback(true); // 버리기 대체 성공
      renderAll();
    });
  } else {
    discardCallback(false);
  }
}

// ── 꼬마 펭귄 (몬스터) ──
function effect_꼬마펭귄_1(handIdx) {
  if (!checkEffectLimit('꼬마 펭귄', 1, 2)) return;
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (G.myField.length >= 5 + (G.myExtraSlots || 0)) { notify('몬스터 존이 가득 찼습니다.'); return; }

  const c = G.myHand.splice(handIdx, 1)[0];
  G.myField.push({ id: c.id, name: '꼬마 펭귄', atk: 1 });
  log('꼬마 펭귄 소환!', 'mine');
  sendAction({ type: 'summon', cardId: '꼬마 펭귄', from: 'hand' });

  // ②효과 자동 연계: 덱에서 펭귄 몬스터 소환
  if (checkEffectLimit('꼬마 펭귄', 2, 2)) {
    setTimeout(() => {
      if (confirm('꼬마 펭귄 ②: 덱에서 펭귄 몬스터 1장을 소환할까요?')) {
        summonFromDeck(isPenguinMonster, (mon) => {
          if (mon) renderAll();
        });
      }
    }, 100);
  }
  renderAll();
}

// ── 펭귄 부부 (몬스터) ──
function effect_펭귄부부_1(handIdx) {
  // ①: 덱에서 소환됐을 경우 자동 발동 (summonFromDeck 후 콜백에서 호출)
  if (!checkEffectLimit('펭귄 부부', 1)) return;
  searchFromDeck(isPenguin, 2, (chosen) => {
    if (chosen.length > 0) {
      selfDiscard(1, () => { renderAll(); });
    }
    renderAll();
  });
}

function effect_펭귄부부_2(handIdx) {
  // ②: 패의 이 카드를 보여주고 — 2드로우 후 1버림, 덱으로 되돌림
  if (!checkEffectLimit('펭귄 부부', 2)) return;

  G.myHand[handIdx].isPublic = true;
  log('펭귄 부부 ②: 공개 후 2드로우', 'mine');
  drawCards(2);
  selfDiscard(1, () => {
    // 덱으로 되돌리기
    const idx = G.myHand.findIndex(c => c.id === '펭귄 부부');
    if (idx >= 0) {
      const c = G.myHand.splice(idx, 1)[0];
      G.myDeck.push(c);
      G.myDeck = shuffle(G.myDeck);
      log('펭귄 부부 → 덱으로 되돌림', 'mine');
    }
    sendAction({ type: 'penguinBubu2' });
    renderAll();
  });
}

// ── 현자 펭귄 (몬스터) ──
function effect_현자펭귄_1() {
  // ①: 펭귄 마을이 공개 상태일 때 — 1드로우 후 1버림
  if (!checkEffectLimit('현자 펭귄', 1)) return;
  if (!hasPenguinMaul()) { notify('펭귄 마을이 공개 상태로 존재하지 않습니다.'); return; }

  drawCards(1);
  log('현자 펭귄 ①: 1드로우', 'mine');
  selfDiscard(1, () => { renderAll(); });
}

function effect_현자펭귄_2(fieldIdx) {
  // ②: 자신 전개 단계 — 덱에서 펭귄 카드 1장을 패에 넣기 (공개패)
  if (!checkEffectLimit('현자 펭귄', 2)) return;
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }

  searchFromDeck(isPenguin, 1, (chosen) => {
    if (chosen.length > 0) {
      log(`현자 펭귄 ②: ${chosen[0].name} 서치`, 'mine');
      sendAction({ type: 'search', cardId: chosen[0].id });
    }
    renderAll();
  });
}

// ── 수문장 펭귄 (몬스터) ──
function effect_수문장펭귄_1(fieldIdx) {
  // ①: 펭귄 마을 공개 상태 — 이 카드 공격력 +1, 서로 패 1장 버림
  if (!checkEffectLimit('수문장 펭귄', 1)) return;
  if (!hasPenguinMaul()) { notify('펭귄 마을이 공개 상태로 존재하지 않습니다.'); return; }

  G.myField[fieldIdx].atk += 1;
  log(`수문장 펭귄 ①: ATK → ${G.myField[fieldIdx].atk}`, 'mine');
  sendAction({ type: 'atkBuff', cardId: '수문장 펭귄', amount: 1 });

  // 서로 패 1장 버리기
  selfDiscard(1, () => {
    requestOpDiscard(1);
    renderAll();
  });
}

function effect_수문장펭귄_2(fieldIdx) {
  // ②: 자신 펭귄 몬스터가 펭귄 마을 효과로 묘지로 보내졌을 경우
  // → 상대 필드의 몬스터 1장을 묘지로
  if (!checkEffectLimit('수문장 펭귄', 2)) return;
  if (G.opField.length === 0) { notify('상대 필드에 몬스터가 없습니다.'); return; }

  openCardPicker(G.opField, '묘지로 보낼 상대 몬스터 선택', 1, (idxs) => {
    if (idxs.length === 0) return;
    const mon = sendFieldToGrave(idxs[0], false);
    log(`수문장 펭귄 ②: ${mon.name} → 묘지`, 'mine');
    sendAction({ type: 'opFieldToGrave', cardId: mon.id });
    renderAll();
  });
}

// ── 펭귄!돌격! (일반) ──
function effect_펭귄돌격_1(handIdx) {
  // ①: 전개 단계 — 덱에서 펭귄 몬스터 소환
  if (!checkEffectLimit('펭귄!돌격!', 1)) return;
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }

  const c = G.myHand.splice(handIdx, 1)[0];
  G.myGrave.push(c);

  summonFromDeck(isPenguinMonster, (mon) => {
    if (mon) {
      // 덱에서 소환된 펭귄 부부 효과 체크
      if (mon.id === '펭귄 부부') {
        setTimeout(() => {
          if (confirm('펭귄 부부 ①: 덱에서 펭귄 카드 2장까지 패에 넣고 1장 버릴까요?')) {
            effect_펭귄부부_1(-1);
          }
        }, 200);
      }
    }
    renderAll();
  });
}

function effect_펭귄돌격_2() {
  // ②: 묘지의 이 카드를 제외하고 — 패에서 펭귄 몬스터 소환
  const graveIdx = G.myGrave.findIndex(c => c.id === '펭귄!돌격!');
  if (graveIdx < 0) { notify('묘지에 펭귄!돌격!이 없습니다.'); return; }
  if (!checkEffectLimit('펭귄!돌격! 묘지', 2)) return;

  G.myGrave.splice(graveIdx, 1);
  G.myExile.push({ id: '펭귄!돌격!', name: '펭귄!돌격!' });
  log('펭귄!돌격! ②: 묘지에서 제외', 'mine');

  summonFromHand(isPenguinMonster, (mon) => {
    if (mon) log(`패에서 ${mon.name} 소환`, 'mine');
    renderAll();
  });
}

// ── 펭귄의 영광 (마법) ──
function effect_펭귄의영광_1(handIdx) {
  // ①: 자신/상대 전개 단계 — 패에서 펭귄 용사 소환, 상대 패 전부 공개
  if (!checkEffectLimit('펭귄의 영광', 1)) return;

  const heroInHand = G.myHand.findIndex(c => c.id === '펭귄 용사' || c.id === '펭귄의 전설');
  if (heroInHand < 0) { notify('패에 펭귄 용사(또는 전설)가 없습니다.'); return; }

  const c = G.myHand.splice(handIdx, 1)[0]; // 영광 카드 묘지로
  G.myGrave.push(c);

  const hero = G.myHand.splice(heroInHand > handIdx ? heroInHand - 1 : heroInHand, 1)[0];
  const heroCard = CARDS[hero.id];
  G.myField.push({ id: hero.id, name: heroCard.name, atk: heroCard.atk || 4 });
  log(`펭귄의 영광: ${heroCard.name} 소환!`, 'mine');

  // 상대 패 전부 공개
  G.opHand.forEach(c => c.isPublic = true);
  log('상대 패 전부 공개!', 'system');
  sendAction({ type: 'penguinGlory1', heroId: hero.id, revealOpHand: true });

  // 용사 소환 효과 연계
  setTimeout(() => triggerOnSummon(hero.id, G.myField.length - 1), 200);
  renderAll();
}

function effect_펭귄의영광_2() {
  // ②: 묘지의 이 카드를 제외하고 — 1드로우
  const graveIdx = G.myGrave.findIndex(c => c.id === '펭귄의 영광');
  if (graveIdx < 0) { notify('묘지에 펭귄의 영광이 없습니다.'); return; }
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }

  G.myGrave.splice(graveIdx, 1);
  G.myExile.push({ id: '펭귄의 영광', name: '펭귄의 영광' });
  drawCards(1);
  log('펭귄의 영광 ②: 1드로우', 'mine');
  sendAction({ type: 'penguinGlory2' });
  renderAll();
}

// ── 펭귄 용사 (몬스터/키카드) ──
function effect_펭귄용사_1(fieldIdx) {
  // ①: 소환했을 경우 — 덱에서 펭귄 카드 1장 패에, 펭귄 몬스터 1장 소환, 패 1장 버림
  if (!checkEffectLimit('펭귄 용사', 1)) return;

  searchFromDeck(isPenguin, 1, (chosen) => {
    if (chosen.length > 0) {
      log(`펭귄 용사 ①: ${chosen[0].name} 서치`, 'mine');
      summonFromHand(isPenguinMonster, (mon) => {
        if (mon) {
          selfDiscard(1, () => { renderAll(); });
        } else {
          selfDiscard(1, () => { renderAll(); });
        }
      });
    }
    renderAll();
  });
}

function effect_펭귄용사_2(fieldIdx) {
  // ②: 상대 턴에 — 이 카드를 패로, 묘지/제외의 펭귄 마법 1장을 패에 넣기
  if (!checkEffectLimit('펭귄 용사', 2)) return;
  if (isMyTurn) { notify('상대 턴에만 발동 가능합니다.'); return; }

  // 필드에서 패로
  const mon = G.myField.splice(fieldIdx, 1)[0];
  G.myHand.push({ id: mon.id, name: mon.name, isPublic: false });
  log('펭귄 용사 ②: 패로 되돌림', 'mine');

  // 묘지 또는 제외에서 펭귄 마법 서치
  const graveMagics = G.myGrave.filter(c => isPenguinMagic(c.id));
  const exileMagics = G.myExile.filter(c => isPenguinMagic(c.id));
  const allMagics = [...graveMagics, ...exileMagics];

  if (allMagics.length === 0) { notify('묘지/제외에 펭귄 마법이 없습니다.'); renderAll(); return; }

  openCardPicker(allMagics, '패에 넣을 펭귄 마법 선택', 1, (idxs) => {
    if (idxs.length === 0) { renderAll(); return; }
    const chosen = allMagics[idxs[0]];
    // 묘지 또는 제외에서 제거
    const gi = G.myGrave.findIndex(c => c.id === chosen.id);
    if (gi >= 0) G.myGrave.splice(gi, 1);
    else {
      const ei = G.myExile.findIndex(c => c.id === chosen.id);
      if (ei >= 0) G.myExile.splice(ei, 1);
    }
    G.myHand.push({ id: chosen.id, name: chosen.name, isPublic: true });
    log(`펭귄 용사 ②: ${chosen.name} 패에 넣음 (공개)`, 'mine');
    sendAction({ type: 'penguinHero2', cardId: chosen.id });
    renderAll();
  });
}

function effect_펭귄용사_3(fieldIdx) {
  // ③: 묘지로 보내졌을 경우 — 소환 + 펭귄 몬스터 공격력 +1 (턴 종료까지)
  // 이 효과는 묘지로 보내지는 시점에 자동 트리거됨
  if (!checkEffectLimit('펭귄 용사', 3)) return;

  if (G.myField.length >= 5 + (G.myExtraSlots || 0)) { notify('몬스터 존이 가득 찼습니다.'); return; }
  G.myField.push({ id: '펭귄 용사', name: '펭귄 용사', atk: 4 });
  log('펭귄 용사 ③: 묘지에서 소환!', 'mine');

  // 펭귄 몬스터 전체 공격력 +1 (임시)
  G.myField.forEach(m => {
    if (isPenguinMonster(m.id)) m.atk += 1;
  });
  log('펭귄 몬스터 전체 ATK +1 (턴 종료까지)', 'system');
  sendAction({ type: 'penguinHero3' });
  renderAll();

  // 턴 종료시 원복 예약
  G._penguinHero3Active = true;
}

// ── 펭귄의 일격 (마법/키카드) ──
function effect_펭귄의일격_1(cardId_triggerId) {
  // ①: 상대 몬스터 효과 발동 시 — 패 1장 버리고 무효
  // 이 효과는 상대 액션에 반응하는 형태 (대응 버튼으로 처리)
  if (!checkEffectLimit('펭귄의 일격', 1)) return;
  if (!hasPenguinOnField()) { notify('자신 필드에 펭귄 몬스터가 없습니다.'); return; }

  // 패에서 일격 카드 찾기
  const idx = G.myHand.findIndex(c => c.id === '펭귄의 일격');
  if (idx < 0) { notify('패에 펭귄의 일격이 없습니다.'); return; }

  selfDiscard(1, (discarded) => {
    if (discarded.length > 0) {
      G.myHand.splice(idx, 1);
      G.myGrave.push({ id: '펭귄의 일격', name: '펭귄의 일격' });
      log('펭귄의 일격 ①: 상대 효과 무효!', 'mine');
      sendAction({ type: 'negate', source: '펭귄의 일격' });
      renderAll();
    }
  });
}

// ②는 수문장 펭귄 ②와 연동 — 펭귄 마을 효과로 묘지로 보내졌을 때 자동 발동
function autoTrigger_펭귄의일격_2() {
  const graveIdx = G.myGrave.findIndex(c => c.id === '펭귄의 일격');
  if (graveIdx < 0) return;
  if (!checkEffectLimit('펭귄의 일격 묘지', 2)) return;

  G.myGrave.splice(graveIdx, 1);
  G.myHand.push({ id: '펭귄의 일격', name: '펭귄의 일격', isPublic: true });
  log('펭귄의 일격 ②: 묘지에서 패로 회수 (공개)', 'mine');
  sendAction({ type: 'recover', cardId: '펭귄의 일격' });
  renderAll();
}

// ── 펭귄이여 영원하라 (마법) ──
function effect_펭귄이여영원하라_1(handIdx) {
  // ①: 서로 필드 카드 1장씩 패로 되돌림, 패에서 펭귄 몬스터 소환 가능
  if (!checkEffectLimit('펭귄이여 영원하라', 1)) return;

  if (G.myField.length === 0 && G.opField.length === 0 && !G.myFieldCard && !G.opFieldCard) {
    notify('필드에 카드가 없습니다.'); return;
  }

  const c = G.myHand.splice(handIdx, 1)[0];
  G.myGrave.push(c);

  // 내 필드에서 1장 선택
  const myFieldAll = [
    ...G.myField.map(m => ({ ...m, zone: 'monster' })),
    ...(G.myFieldCard ? [{ id: G.myFieldCard.id, name: G.myFieldCard.name, zone: 'field' }] : [])
  ];

  const returnMine = (myChosen) => {
    if (myChosen) {
      if (myChosen.zone === 'monster') {
        const fi = G.myField.findIndex(m => m.id === myChosen.id);
        if (fi >= 0) { G.myField.splice(fi, 1); G.myHand.push({ id: myChosen.id, name: myChosen.name, isPublic: false }); }
      } else {
        G.myHand.push({ id: G.myFieldCard.id, name: G.myFieldCard.name, isPublic: false });
        G.myFieldCard = null;
      }
    }

    // 상대 필드에서 1장 선택
    const opFieldAll = [
      ...G.opField.map(m => ({ ...m, zone: 'monster' })),
      ...(G.opFieldCard ? [{ id: G.opFieldCard.id, name: G.opFieldCard.name, zone: 'field' }] : [])
    ];

    if (opFieldAll.length > 0) {
      openCardPicker(opFieldAll, '상대 필드에서 패로 되돌릴 카드 선택', 1, (idxs) => {
        if (idxs.length > 0) {
          const chosen = opFieldAll[idxs[0]];
          sendAction({ type: 'penguinEternal1', myCard: myChosen?.id, opCard: chosen.id });
          // 상대쪽은 Firebase 통해 처리
        }

        // 패에서 펭귄 몬스터 소환 여부
        if (confirm('패에서 펭귄 몬스터를 소환할까요?')) {
          summonFromHand(isPenguinMonster, (mon) => { renderAll(); });
        } else {
          renderAll();
        }
      });
    } else {
      renderAll();
    }
  };

  if (myFieldAll.length > 0) {
    openCardPicker(myFieldAll, '내 필드에서 패로 되돌릴 카드 선택', 1, (idxs) => {
      returnMine(idxs.length > 0 ? myFieldAll[idxs[0]] : null);
    });
  } else {
    returnMine(null);
  }
}

function effect_펭귄이여영원하라_2() {
  // ②: 상대 턴, 묘지의 이 카드를 제외하고 — 패에서 펭귄 몬스터 소환
  const gi = G.myGrave.findIndex(c => c.id === '펭귄이여 영원하라');
  if (gi < 0) { notify('묘지에 없습니다.'); return; }
  if (isMyTurn) { notify('상대 턴에만 발동 가능합니다.'); return; }

  G.myGrave.splice(gi, 1);
  G.myExile.push({ id: '펭귄이여 영원하라', name: '펭귄이여 영원하라' });
  summonFromHand(isPenguinMonster, (mon) => {
    if (mon) log('펭귄이여 영원하라 ②: 패에서 소환', 'mine');
    renderAll();
  });
}

// ── 펭귄 마법사 (몬스터) ──
function effect_펭귄마법사_1(handIdx) {
  // ①: 일반 패인 이 카드를 보여주고 — 서치 후 덱으로
  if (!checkEffectLimit('펭귄 마법사', 1, 2)) return;
  const c = G.myHand[handIdx];
  if (c.isPublic) { notify('일반 패(비공개)인 경우에만 발동 가능합니다.'); return; }

  G.myHand[handIdx].isPublic = true; // 공개
  searchFromDeck(isPenguin, 1, (chosen) => {
    if (chosen.length > 0) log(`펭귄 마법사 ①: ${chosen[0].name} 서치`, 'mine');
    // 덱으로 되돌리기
    const idx2 = G.myHand.findIndex(c2 => c2.id === '펭귄 마법사');
    if (idx2 >= 0) {
      const back = G.myHand.splice(idx2, 1)[0];
      G.myDeck.push({ id: back.id, name: back.name });
      G.myDeck = shuffle(G.myDeck);
      log('펭귄 마법사 → 덱으로', 'mine');
    }
    renderAll();
  });
}

function effect_펭귄마법사_2(fieldIdx) {
  // ②: 소환했을 경우 — 패를 최대 3장 버리고, 그 수만큼 상대 몬스터 제외
  if (!checkEffectLimit('펭귄 마법사', 2, 2)) return;
  const maxDiscard = Math.min(3, G.myHand.length);
  if (maxDiscard === 0) { notify('버릴 패가 없습니다.'); return; }

  openCardPicker(G.myHand, `버릴 패 선택 (최대 3장)`, maxDiscard, (idxs) => {
    const count = idxs.length;
    idxs.sort((a,b)=>b-a).forEach(i => {
      const c = G.myHand.splice(i, 1)[0];
      G.myGrave.push(c);
    });
    log(`펭귄 마법사 ②: ${count}장 버림 → 상대 몬스터 ${count}장 제외`, 'mine');
    sendAction({ type: 'requestExile', count });
    checkWinCondition();
    renderAll();
  });
}

function effect_펭귄마법사_3() {
  // ③: 펭귄 마을 효과로 몬스터 묘지 시 — 자신/상대 제외 몬스터 1장 소환
  if (!checkEffectLimit('펭귄 마법사', 3, 2)) return;

  const myExileMonsters = G.myExile.filter(c => CARDS[c.id]?.cardType === 'monster');
  const opExileMonsters = G.opExile.filter(c => CARDS[c.id]?.cardType === 'monster');
  const all = [...myExileMonsters.map(c => ({ ...c, owner: 'me' })), ...opExileMonsters.map(c => ({ ...c, owner: 'op' }))];

  if (all.length === 0) { notify('제외된 몬스터가 없습니다.'); return; }

  openCardPicker(all, '제외 상태의 몬스터 선택 후 소환', 1, (idxs) => {
    if (idxs.length === 0) return;
    const chosen = all[idxs[0]];
    if (chosen.owner === 'me') {
      const ei = G.myExile.findIndex(c => c.id === chosen.id);
      if (ei >= 0) G.myExile.splice(ei, 1);
    } else {
      const ei = G.opExile.findIndex(c => c.id === chosen.id);
      if (ei >= 0) G.opExile.splice(ei, 1);
    }
    const card = CARDS[chosen.id];
    G.myField.push({ id: chosen.id, name: card.name, atk: card.atk || 0 });
    log(`펭귄 마법사 ③: ${card.name} 소환`, 'mine');
    sendAction({ type: 'summon', cardId: chosen.id, from: 'exile' });
    renderAll();
  });
}

// ─────────────────────────────────────────────
// 소환 시 효과 자동 트리거
// ─────────────────────────────────────────────
function triggerOnSummon(cardId, fieldIdx) {
  switch (cardId) {
    case '꼬마 펭귄':
      if (checkEffectLimit('꼬마 펭귄', 2, 2)) {
        if (confirm('꼬마 펭귄 ②: 덱에서 펭귄 몬스터 1장을 소환할까요?')) {
          summonFromDeck(isPenguinMonster, (mon) => {
            if (mon) {
              triggerOnSummon(mon.id, G.myField.length - 1);
              renderAll();
            }
          });
        }
      }
      break;
    case '펭귄 부부':
      if (confirm('펭귄 부부 ①: 덱에서 펭귄 카드 2장까지 패에 넣고 1장 버릴까요?')) {
        effect_펭귄부부_1(-1);
      }
      break;
    case '펭귄 용사':
      if (confirm('펭귄 용사 ①: 덱 서치 + 펭귄 소환 + 패 1장 버리기를 발동할까요?')) {
        effect_펭귄용사_1(fieldIdx);
      }
      break;
    case '펭귄 마법사':
      if (confirm('펭귄 마법사 ②: 패를 최대 3장 버리고 상대 몬스터를 제외할까요?')) {
        effect_펭귄마법사_2(fieldIdx);
      }
      break;
  }
}

// ─────────────────────────────────────────────
// 묘지로 보내졌을 때 자동 트리거
// ─────────────────────────────────────────────
function triggerOnGrave(cardId) {
  switch (cardId) {
    case '펭귄 용사':
      if (confirm('펭귄 용사 ③: 묘지에서 소환 + 펭귄 몬스터 ATK +1 발동할까요?')) {
        effect_펭귄용사_3(G.myField.length);
      }
      break;
  }
}

// ─────────────────────────────────────────────
// 턴 종료 시 리셋
// ─────────────────────────────────────────────
function onTurnEnd_penguin() {
  // 펭귄 용사 ③ 공격력 버프 원복
  if (G._penguinHero3Active) {
    G.myField.forEach(m => {
      if (isPenguinMonster(m.id)) m.atk = Math.max(0, m.atk - 1);
    });
    G._penguinHero3Active = false;
    log('펭귄 용사 ③ 버프 종료', 'system');
  }
  resetEffectUsed();
}

// ─────────────────────────────────────────────
// 카드 효과 발동 메인 라우터
// ─────────────────────────────────────────────
function activatePenguinEffect(cardId, handIdx, fieldIdx) {
  switch (cardId) {
    // ── 패에서 발동 ──
    case '펭귄 마을':
      effect_펭귄마을_1(handIdx); break;
    case '꼬마 펭귄':
      effect_꼬마펭귄_1(handIdx); break;
    case '펭귄 부부':
      showEffectChoice('펭귄 부부', [
        { label: '①덱 서치 (소환됐을 때)', action: () => effect_펭귄부부_1(handIdx) },
        { label: '②패 공개 → 2드로우 → 1버림 → 덱 복귀', action: () => effect_펭귄부부_2(handIdx) },
      ]); break;
    case '현자 펭귄':
      showEffectChoice('현자 펭귄', [
        { label: '①드로우 → 버림 (펭귄 마을 필요)', action: () => effect_현자펭귄_1() },
        { label: '②덱에서 펭귄 카드 서치 (전개)', action: () => effect_현자펭귄_2(fieldIdx) },
      ]); break;
    case '수문장 펭귄':
      showEffectChoice('수문장 펭귄', [
        { label: '①ATK+1 + 서로 패 1장 버림 (펭귄 마을 필요)', action: () => effect_수문장펭귄_1(fieldIdx) },
        { label: '②상대 몬스터 묘지로 (펭귄 마을 효과 트리거)', action: () => effect_수문장펭귄_2(fieldIdx) },
      ]); break;
    case '펭귄!돌격!':
      showEffectChoice('펭귄!돌격!', [
        { label: '①덱에서 펭귄 몬스터 소환 (전개)', action: () => effect_펭귄돌격_1(handIdx) },
        { label: '②묘지에서 제외 → 패에서 펭귄 소환', action: () => effect_펭귄돌격_2() },
      ]); break;
    case '펭귄의 영광':
      showEffectChoice('펭귄의 영광', [
        { label: '①패에서 펭귄 용사 소환 + 상대 패 공개', action: () => effect_펭귄의영광_1(handIdx) },
        { label: '②묘지에서 제외 → 1드로우 (전개)', action: () => effect_펭귄의영광_2() },
      ]); break;
    case '펭귄 용사':
      if (fieldIdx >= 0) {
        showEffectChoice('펭귄 용사', [
          { label: '①서치 + 소환 + 버림 (소환 시)', action: () => effect_펭귄용사_1(fieldIdx) },
          { label: '②패로 + 펭귄 마법 회수 (상대 턴)', action: () => effect_펭귄용사_2(fieldIdx) },
        ]);
      }
      break;
    case '펭귄의 일격':
      effect_펭귄의일격_1(cardId); break;
    case '펭귄이여 영원하라':
      showEffectChoice('펭귄이여 영원하라', [
        { label: '①서로 필드 카드 패로 + 소환', action: () => effect_펭귄이여영원하라_1(handIdx) },
        { label: '②묘지에서 제외 → 패에서 소환 (상대 턴)', action: () => effect_펭귄이여영원하라_2() },
      ]); break;
    case '펭귄 마법사':
      if (fieldIdx >= 0) {
        showEffectChoice('펭귄 마법사', [
          { label: '①비공개패 공개 → 서치 → 덱 복귀', action: () => effect_펭귄마법사_1(handIdx) },
          { label: '②패 버림 → 상대 몬스터 제외 (소환 시)', action: () => effect_펭귄마법사_2(fieldIdx) },
          { label: '③제외 몬스터 소환 (펭귄 마을 트리거)', action: () => effect_펭귄마법사_3() },
        ]);
      } else {
        effect_펭귄마법사_1(handIdx);
      }
      break;
    default:
      return false; // 펭귄 카드가 아님
  }
  return true;
}

// ─────────────────────────────────────────────
// 효과 선택 UI (여러 효과 중 선택)
// ─────────────────────────────────────────────
function showEffectChoice(cardName, effects) {
  // 기존 모달 재활용
  const modal = document.getElementById('cardDetailModal');
  document.getElementById('mdCardName').textContent = `${cardName} — 효과 선택`;
  document.getElementById('mdCardEffects').textContent = '';
  document.getElementById('mdCardMeta').innerHTML = '';

  const actions = document.getElementById('mdCardActions');
  actions.innerHTML = '';

  effects.forEach(({ label, action }) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.style.fontSize = '.8rem';
    btn.textContent = label;
    btn.onclick = () => { closeModal('cardDetailModal'); action(); };
    actions.appendChild(btn);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = '취소';
  cancelBtn.onclick = () => closeModal('cardDetailModal');
  actions.appendChild(cancelBtn);

  modal.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// 상대방 Firebase 액션 처리 (펭귄 관련)
// ─────────────────────────────────────────────
function handlePenguinOpAction(action) {
  switch (action.type) {
    case 'requestDiscard':
      notify(`상대가 패 ${action.count}장 버리기를 요청했습니다.`);
      forceDiscard(action.count);
      break;
    case 'requestExile':
      if (G.opField.length === 0) { notify('제외할 상대 몬스터가 없습니다.'); break; }
      openCardPicker(G.opField, `상대가 ${action.count}장 제외합니다`, Math.min(action.count, G.opField.length), (idxs) => {
        idxs.sort((a,b)=>b-a).forEach(i => {
          const mon = G.opField.splice(i, 1)[0];
          G.opExile.push(mon);
          log(`상대의 ${mon.name} 제외됨`, 'opponent');
        });
        renderAll();
      });
      break;
    case 'penguinGlory1':
    case 'penguinEternal1':
      // 상대가 내 필드 카드를 패로 되돌리는 처리
      if (action.opCard) {
        const fi = G.myField.findIndex(m => m.id === action.opCard);
        if (fi >= 0) {
          const mon = G.myField.splice(fi, 1)[0];
          G.myHand.push({ id: mon.id, name: mon.name, isPublic: false });
          log(`${mon.name}이 상대 효과로 패로 되돌아옴`, 'opponent');
        }
      }
      if (action.revealOpHand) {
        G.myHand.forEach(c => c.isPublic = true);
        log('내 패가 전부 공개됨!', 'system');
      }
      renderAll();
      break;
    case 'negate':
      log(`상대가 ${action.source}로 효과를 무효로 했습니다.`, 'opponent');
      notify(`효과 무효! (${action.source})`);
      break;
  }
}
