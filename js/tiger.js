// tiger.js — 타이거 테마 효과 엔진
// ─────────────────────────────────────────────
// 존 슬롯 관리
// 젊은 타이거, 에이스 타이거, 타이거 킹 중 어느 하나라도 필드에 있으면
// 왼쪽 2칸 봉인 (중복 적용 없음 — 하나만 있어도 봉인)
// ─────────────────────────────────────────────
const TIGER_ZONE_CARDS = new Set(['젊은 타이거', '에이스 타이거', '타이거 킹']);

function _updateTigerZone() {
  const shouldBan = G.myField.some(m => TIGER_ZONE_CARDS.has(m.id));
  if (shouldBan && !G.tigerZoneBanned) {
    G.tigerZoneBanned = true;
    renderAll();
  } else if (!shouldBan && G.tigerZoneBanned && !G.tigerZonePermanent) {
    // 타이거 킹 소환 후엔 영구 봉인이라 해제 불가
    G.tigerZoneBanned = false;
    renderAll();
  }
}

// sendToGrave 후킹 — 타이거 퇴장 시 존 재계산
(function _hookTigerGrave() {
  const _prev = sendToGrave;
  sendToGrave = function (cardId, from) {
    _prev(cardId, from);
    if (TIGER_ZONE_CARDS.has(cardId)) setTimeout(_updateTigerZone, 0);
  };
})();

// renderMyField 후킹 — tigerZoneBanned 시 왼쪽 2칸을 봉인 슬롯으로 표시
(function _patchRenderMyFieldForTiger() {
  const _orig = renderMyField;
  renderMyField = function () {
    if (!G.tigerZoneBanned) { _orig(); return; }

    const container = document.getElementById('myField');
    container.innerHTML = '';
    const totalSlots = 5 + (G.myExtraSlots || 0);

    // 봉인 2칸
    for (let i = 0; i < 2; i++) {
      const slot = document.createElement('div');
      slot.className = 'zone-slot';
      slot.style.cssText = 'opacity:.25;background:#c8484818;border-color:#c84848;cursor:not-allowed;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:.5rem;color:#c84848;text-align:center;';
      lbl.textContent = '봉인';
      slot.appendChild(lbl);
      container.appendChild(slot);
    }

    // 나머지 실제 슬롯
    for (let i = 0; i < totalSlots - 2; i++) {
      const slot = document.createElement('div');
      slot.className = 'zone-slot';
      const mon = G.myField[i];
      if (mon) {
        const card = CARDS[mon.id] || {};
        slot.classList.add('active');
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:.55rem;text-align:center;padding:3px;word-break:keep-all;color:var(--text)';
        nameEl.textContent = mon.name;
        const atkEl = document.createElement('div');
        atkEl.style.cssText = 'font-size:.65rem;color:var(--accent);font-family:Black Han Sans,sans-serif';
        atkEl.textContent = `ATK ${mon.atk ?? (card.atk ?? '?')}`;
        slot.appendChild(nameEl);
        slot.appendChild(atkEl);
        slot.addEventListener('click', () => onMyFieldClick(i));
      }
      container.appendChild(slot);
    }
  };
})();

// ─────────────────────────────────────────────
// 고유 효과
// ─────────────────────────────────────────────

// 베이비 타이거 ①: 보여주거나 버리고 → 덱에서 타이거+호랑이 각 1장 패, 패에서 타이거 1장 소환, 이 카드 제외
// 제외 후 ②: 상대 패 1장 버리기
function activateBabyTiger1(handIdx) {
  if (!canUseEffect('베이비 타이거', 1)) { notify('이미 사용했습니다.'); return; }
  const c = G.myHand[handIdx];
  if (!c) return;

  gameConfirm('베이비 타이거 ①: 버리고 발동하겠습니까? (취소 = 공개만)', (discard) => {
    markEffectUsed('베이비 타이거', 1);
    if (discard) {
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
    } else {
      G.myHand[handIdx].isPublic = true;
    }

    const tigerDeck  = findAllInDeck(dc => CARDS[dc.id]?.theme === '타이거' && dc.id !== '베이비 타이거');
    const horangDeck = findAllInDeck(dc => dc.id.includes('호랑이') && CARDS[dc.id]?.theme === '타이거');

    const tryEffect2 = () => {
      if (canUseEffect('베이비 타이거', 2)) {
        gameConfirm('베이비 타이거 ②: 상대 패 1장 버리겠습니까?', (yes) => {
          if (yes) {
            markEffectUsed('베이비 타이거', 2);
            sendAction({ type: 'forceDiscard', count: 1, reason: '베이비 타이거 ②', attackerPicks: true });
            log('베이비 타이거 ②: 상대 패 1장 버리기', 'mine');
          }
          sendGameState(); renderAll();
        });
      } else { sendGameState(); renderAll(); }
    };

    const doSummonFromHand = () => {
      const tigerHand = G.myHand.filter(h => CARDS[h.id]?.theme === '타이거');
      const doExile = () => {
        // 자신을 제외
        const ei = G.myHand.findIndex(h => h.id === '베이비 타이거');
        if (ei >= 0) { G.myExile.push(G.myHand.splice(ei, 1)[0]); log('베이비 타이거 ①: 자신 제외', 'mine'); }
        tryEffect2();
      };

      if (tigerHand.length === 0) { doExile(); return; }
      openCardPicker(tigerHand, '베이비 타이거 ①: 패에서 타이거 소환', 1, (sel) => {
        if (sel.length > 0) {
          const target = tigerHand[sel[0]];
          const idx = G.myHand.findIndex(h => h === target);
          if (idx >= 0) {
            const mon = G.myHand.splice(idx, 1)[0];
            G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 3, atkBase: CARDS[mon.id]?.atk ?? 3 });
            log(`베이비 타이거 ①: ${mon.name} 소환`, 'mine');
            _updateTigerZone();
          }
        }
        doExile();
      });
    };

    const pickHorang = () => {
      if (horangDeck.length === 0) { doSummonFromHand(); return; }
      openCardPicker(horangDeck, '베이비 타이거 ①: 덱에서 호랑이 카드 패에', 1, (sel) => {
        if (sel.length > 0) searchToHand(horangDeck[sel[0]].id);
        doSummonFromHand();
      });
    };

    if (tigerDeck.length === 0) { pickHorang(); return; }
    openCardPicker(tigerDeck, '베이비 타이거 ①: 덱에서 타이거 카드 패에', 1, (sel) => {
      if (sel.length > 0) searchToHand(tigerDeck[sel[0]].id);
      pickHorang();
    });
  });
}

// 젊은 타이거 ①: 공개 패에 넣어졌을 때 → 덱에서 호랑이 카드 2장 서치
function activateYoungTiger1() {
  if (!canUseEffect('젊은 타이거', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('젊은 타이거', 1);
  const horangDeck = findAllInDeck(dc => dc.id.includes('호랑이') && CARDS[dc.id]?.theme === '타이거');
  if (horangDeck.length === 0) { notify('덱에 호랑이 카드가 없습니다.'); return; }
  const pickCount = Math.min(2, horangDeck.length);
  openCardPicker(horangDeck, `젊은 타이거 ①: 덱에서 호랑이 카드 ${pickCount}장 서치`, pickCount, (sel) => {
    sel.forEach(i => searchToHand(horangDeck[i].id));
    sendGameState(); renderAll();
  });
}

// 젊은 타이거 ②: 소환 시 덱에서 타이거 몬스터 1장 소환
function activateYoungTiger2() {
  if (!canUseEffect('젊은 타이거', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('젊은 타이거', 2);
  const targets = findAllInDeck(dc => CARDS[dc.id]?.theme === '타이거' && CARDS[dc.id]?.cardType === 'monster' && dc.id !== '젊은 타이거');
  if (targets.length === 0) { notify('덱에 타이거 몬스터가 없습니다.'); return; }
  openCardPicker(targets, '젊은 타이거 ②: 덱에서 타이거 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
    sendGameState(); renderAll();
  });
}

// 에이스 타이거 ①: 필드에 타이거 있으면 소환 + 서로 1장씩 묘지
function activateAceTiger1(handIdx) {
  if (!canUseEffect('에이스 타이거', 1)) { notify('이미 사용했습니다.'); return; }
  if (!G.myField.some(m => CARDS[m.id]?.theme === '타이거')) { notify('에이스 타이거 ①: 자신 필드에 타이거 몬스터가 필요합니다.'); return; }
  markEffectUsed('에이스 타이거', 1);
  const c = G.myHand.splice(handIdx, 1)[0];
  G.myField.push({ id: c.id, name: c.name, atk: CARDS[c.id]?.atk ?? 5, atkBase: CARDS[c.id]?.atk ?? 5 });
  log('에이스 타이거 ①: 소환', 'mine');
  _updateTigerZone();

  const pickMine = () => {
    if (G.myField.length === 0) { sendGameState(); renderAll(); return; }
    openCardPicker([...G.myField], '에이스 타이거 ①: 자신 필드 1장 묘지', 1, (sel) => {
      if (sel.length > 0) {
        const mon = G.myField.splice(sel[0], 1)[0];
        G.myGrave.push(mon);
        log(`에이스 타이거 ①: 내 ${mon.name} 묘지`, 'mine');
        _updateTigerZone();
      }
      sendGameState(); renderAll();
    });
  };

  if (G.opField.length === 0) { pickMine(); return; }
  openCardPicker([...G.opField], '에이스 타이거 ①: 상대 필드 1장 묘지', 1, (sel) => {
    if (sel.length > 0) {
      const mon = G.opField.splice(sel[0], 1)[0];
      G.opGrave.push(mon);
      sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' });
      log(`에이스 타이거 ①: 상대 ${mon.name} 묘지`, 'mine');
    }
    pickMine();
  });
}

// 에이스 타이거 ②: 묘지로 보내졌을 때 → 덱에서 타이거+호랑이 각 1장 서치
function activateAceTiger2() {
  if (!canUseEffect('에이스 타이거', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('에이스 타이거', 2);
  const tigerDeck  = findAllInDeck(dc => CARDS[dc.id]?.theme === '타이거');
  const horangDeck = findAllInDeck(dc => dc.id.includes('호랑이'));
  const pickHorang = () => {
    if (horangDeck.length === 0) { sendGameState(); renderAll(); return; }
    openCardPicker(horangDeck, '에이스 타이거 ②: 호랑이 카드 서치', 1, (sel) => {
      if (sel.length > 0) searchToHand(horangDeck[sel[0]].id);
      sendGameState(); renderAll();
    });
  };
  if (tigerDeck.length === 0) { pickHorang(); return; }
  openCardPicker(tigerDeck, '에이스 타이거 ②: 타이거 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(tigerDeck[sel[0]].id);
    pickHorang();
  });
}

function activateHorangPoryo(handIdx) {
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const targets = findAllInDeck(dc => CARDS[dc.id]?.theme === '타이거' && CARDS[dc.id]?.cardType === 'monster');
  if (targets.length === 0) { notify('덱에 타이거 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(targets, '호랑이의 포효: 덱에서 타이거 몬스터 묘지로', 1, (sel) => {
    if (sel.length > 0) {
      const t = targets[sel[0]];
      removeFromDeck(t.id);
      G.myGrave.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
      log(`호랑이의 포효: ${t.id} 묘지로`, 'mine');
    }
    sendGameState(); renderAll();
  });
}

function activateHorangSayang(handIdx) {
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const targets = findAllInDeck(dc => CARDS[dc.id]?.theme === '타이거' && CARDS[dc.id]?.cardType === 'monster');
  if (targets.length === 0) { notify('덱에 타이거 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(targets, '호랑이의 사냥: 덱에서 타이거 몬스터 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    _forcedDiscardOne('호랑이의 사냥: 패 1장 버리기', () => { sendGameState(); renderAll(); });
  });
}

function activateHorangBaltop(handIdx) {
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const tigerGrave = G.myGrave.filter(g => CARDS[g.id]?.theme === '타이거');
  if (tigerGrave.length === 0) { notify('묘지에 타이거 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(tigerGrave, '호랑이의 발톱: 묘지 타이거 카드 제외', 1, (sel) => {
    if (sel.length > 0) {
      const target = tigerGrave[sel[0]];
      const gi = G.myGrave.findIndex(g => g === target);
      if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
      sendAction({ type: 'forceExileHandCard', count: 1, reason: '호랑이의 발톱' });
      log('호랑이의 발톱: 묘지 타이거 제외 → 상대 패 1장 제외', 'mine');
    }
    sendGameState(); renderAll();
  });
}

function activateHorangIlgyeok1(handIdx) {
  if (!canUseEffect('호랑이의 일격', 1)) { notify('이미 사용했습니다.'); return; }
  if (currentPhase !== 'deploy' || isMyTurn) { notify('호랑이의 일격: 상대 전개 단계에만 발동 가능합니다.'); return; }
  markEffectUsed('호랑이의 일격', 1);
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const count = Math.min(G.myField.filter(m => CARDS[m.id]?.theme === '타이거').length + 1, G.opHand.length);
  if (count === 0) { notify('상대 패가 없습니다.'); sendGameState(); renderAll(); return; }
  sendAction({ type: 'forceExileHandCard', count, reason: '호랑이의 일격' });
  log(`호랑이의 일격 ①: 상대 패 ${count}장 제외`, 'mine');
  sendGameState(); renderAll();
}

function activateJinHorang1(handIdx) {
  if (!canUseEffect('진정한 호랑이', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('진정한 호랑이', 1);
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const names = ['베이비 타이거', '젊은 타이거', '에이스 타이거'];
  const found = names.map(n => findAllInDeck(dc => dc.id === n)[0]).filter(Boolean);
  if (found.length < 3) { notify(`진정한 호랑이: 덱에 세 종류 모두 필요합니다. (${found.length}/3)`); sendGameState(); renderAll(); return; }
  found.forEach(t => removeFromDeck(t.id));
  openCardPicker(found, '진정한 호랑이: 소환할 1장 선택 (나머지 2장 패)', 1, (sel) => {
    const summonIdx = sel.length > 0 ? sel[0] : 0;
    found.forEach((t, i) => {
      if (i === summonIdx) {
        G.myField.push({ id: t.id, name: CARDS[t.id]?.name || t.id, atk: CARDS[t.id]?.atk ?? 3, atkBase: CARDS[t.id]?.atk ?? 3 });
        log(`진정한 호랑이: ${t.id} 소환`, 'mine');
        _updateTigerZone();
      } else {
        G.myHand.push({ id: t.id, name: CARDS[t.id]?.name || t.id });
      }
    });
    sendGameState(); renderAll();
  });
}

// 타이거 킹 ①: 타이거 1장 묻고 소환 + 게임 전체 왼쪽 2칸 영구 봉인
function activateTigerKing1(handIdx) {
  if (!canUseEffect('타이거 킹', 1)) { notify('이미 사용했습니다.'); return; }
  const tigerOnField = G.myField.filter(m => CARDS[m.id]?.theme === '타이거');
  if (tigerOnField.length === 0) { notify('타이거 킹 ①: 필드에 타이거 몬스터가 필요합니다.'); return; }
  markEffectUsed('타이거 킹', 1);

  openCardPicker(tigerOnField, '타이거 킹 ①: 묘지로 보낼 타이거 선택', 1, (sel) => {
    if (sel.length > 0) {
      const target = tigerOnField[sel[0]];
      // 참조 기반 인덱스 탐색
      const idx = G.myField.findIndex(m => m === target);
      if (idx >= 0) {
        const mon = G.myField.splice(idx, 1)[0];
        G.myGrave.push(mon);
        log(`타이거 킹 ①: ${mon.name} 묘지`, 'mine');
      }
    }
    const c = G.myHand.splice(handIdx, 1)[0];
    G.myField.push({ id: c.id, name: c.name, atk: CARDS[c.id]?.atk ?? 6, atkBase: CARDS[c.id]?.atk ?? 6 });

    // 영구 봉인 플래그
    G.tigerZoneBanned   = true;
    G.tigerZonePermanent = true;
    sendAction({ type: 'tigerZoneBan' });
    log('타이거 킹 ①: 이 게임 동안 왼쪽 존 2칸 영구 봉인', 'mine');

    if (canUseEffect('타이거 킹', 2) && G.opField.length > 0) {
      gameConfirm('타이거 킹 ②: 상대 필드 3장까지 제외?', (yes) => {
        if (yes) {
          markEffectUsed('타이거 킹', 2);
          const count = Math.min(3, G.opField.length);
          openCardPicker([...G.opField], `타이거 킹 ②: 제외할 카드 최대 ${count}장`, count, (sel2) => {
            sel2.sort((a, b) => b - a).forEach(i => {
              const mon = G.opField.splice(i, 1)[0];
              G.opExile.push(mon);
              sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
            });
            log(`타이거 킹 ②: 상대 ${sel2.length}장 제외`, 'mine');
            sendGameState(); renderAll();
          });
        } else { sendGameState(); renderAll(); }
      });
    } else { sendGameState(); renderAll(); }
  });
}

// 타이거 킹 ③: 상대 필드 2장까지 제외 (자신/상대 턴)
function activateTigerKing3() {
  if (!canUseEffect('타이거 킹', 3)) { notify('이미 사용했습니다.'); return; }
  if (G.opField.length === 0) { notify('상대 필드가 비어있습니다.'); return; }
  markEffectUsed('타이거 킹', 3);
  const count = Math.min(2, G.opField.length);
  openCardPicker([...G.opField], `타이거 킹 ③: 제외할 카드 최대 ${count}장`, count, (sel) => {
    sel.sort((a, b) => b - a).forEach(i => {
      const mon = G.opField.splice(i, 1)[0];
      G.opExile.push(mon);
      sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
    });
    log(`타이거 킹 ③: ${sel.length}장 제외`, 'mine');
    sendGameState(); renderAll();
  });
}

// 고고한 호랑이 ①: 상대 전개 단계 + 타이거 있음 → 묘지 1장 패로
function activateGogoganHorang1(handIdx) {
  if (!canUseEffect('고고한 호랑이', 1)) { notify('이미 사용했습니다.'); return; }
  if (currentPhase !== 'deploy' || isMyTurn) { notify('고고한 호랑이 ①: 상대 전개 단계에만 발동 가능합니다.'); return; }
  if (!G.myField.some(m => CARDS[m.id]?.theme === '타이거')) { notify('고고한 호랑이 ①: 필드에 타이거 몬스터가 필요합니다.'); return; }
  // 버리기 전에 묘지 체크
  const graveBeforeDiscard = G.myGrave.filter(g => g.id !== '고고한 호랑이');
  if (graveBeforeDiscard.length === 0) { notify('묘지에 회수할 카드가 없습니다.'); return; }
  markEffectUsed('고고한 호랑이', 1);
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  const graveTargets = G.myGrave.filter(g => g.id !== '고고한 호랑이');
  openCardPicker(graveTargets, '고고한 호랑이 ①: 묘지 카드 1장 패로', 1, (sel) => {
    if (sel.length > 0) {
      const target = graveTargets[sel[0]];
      const gi = G.myGrave.findIndex(g => g === target);
      if (gi >= 0) {
        const card = G.myGrave.splice(gi, 1)[0];
        G.myHand.push(card);
        log(`고고한 호랑이 ①: ${card.name} 패로`, 'mine');
      }
    }
    sendGameState(); renderAll();
  });
}

// 고고한 호랑이 ②: 상대 전개 단계 + 패에서 제외 → 상대 필드 1장 제외
function activateGogoganHorang2(handIdx) {
  if (!canUseEffect('고고한 호랑이', 2)) { notify('이미 사용했습니다.'); return; }
  if (currentPhase !== 'deploy' || isMyTurn) { notify('고고한 호랑이 ②: 상대 전개 단계에만 발동 가능합니다.'); return; }
  if (G.exileBanActive) { notify('이 턴은 카드를 제외할 수 없습니다.'); return; }
  if (G.opField.length === 0) { notify('상대 필드에 카드가 없습니다.'); return; }
  markEffectUsed('고고한 호랑이', 2);
  G.myExile.push(G.myHand.splice(handIdx, 1)[0]);
  openCardPicker([...G.opField], '고고한 호랑이 ②: 상대 필드 1장 제외', 1, (sel) => {
    if (sel.length > 0) {
      const mon = G.opField.splice(sel[0], 1)[0];
      G.opExile.push(mon);
      sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
      log(`고고한 호랑이 ②: ${mon.name} 제외`, 'mine');
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 소환 시 트리거
// ─────────────────────────────────────────────
function onTigerSummoned(cardId) {
  // 존 봉인 체크 (젊은/에이스 타이거 ③ 효과)
  _updateTigerZone();
  if (cardId === '젊은 타이거' && canUseEffect('젊은 타이거', 2)) {
    gameConfirm('젊은 타이거 ②: 덱에서 타이거 몬스터 소환?', (yes) => { if (yes) activateYoungTiger2(); });
  }
}

// ─────────────────────────────────────────────
// 패 메뉴 라우터
// ─────────────────────────────────────────────
function activateTigerCardFromHand(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  switch (c.id) {
    case '베이비 타이거':   if (effectNum === 1) activateBabyTiger1(handIdx); break;
    case '젊은 타이거':    if (effectNum === 1) activateYoungTiger1(); break;
    case '에이스 타이거':  if (effectNum === 1) activateAceTiger1(handIdx); break;
    case '호랑이의 포효':  activateHorangPoryo(handIdx); break;
    case '호랑이의 사냥':  activateHorangSayang(handIdx); break;
    case '호랑이의 발톱':  activateHorangBaltop(handIdx); break;
    case '호랑이의 일격':  if (effectNum === 1) activateHorangIlgyeok1(handIdx); break;
    case '진정한 호랑이':  if (effectNum === 1) activateJinHorang1(handIdx); break;
    case '타이거 킹':      if (effectNum === 1) activateTigerKing1(handIdx); break;
    case '고고한 호랑이':
      if (effectNum === 1) activateGogoganHorang1(handIdx);
      else if (effectNum === 2) activateGogoganHorang2(handIdx);
      break;
    default: activateThemeCardEffectFromHand(handIdx, effectNum);
  }
}

function activateTigerGraveEffect(cardId) {
  switch (cardId) {
    case '에이스 타이거': activateAceTiger2(); break;
    case '타이거 킹':     activateTigerKing3(); break;
    default: notify('이 카드는 묘지 효과가 없습니다.');
  }
}

function handleTigerOpAction(action) {
  if (action.type === 'tigerZoneBan') {
    log('상대: 타이거 킹 소환 — 상대 왼쪽 존 2칸 봉인', 'opponent');
  }
}

registerThemeEffectHandler('타이거', {
  activateFromHand: activateTigerCardFromHand,
  resolveLink: resolveThemeEffectGeneric,
  onSummoned: onTigerSummoned,
  activateGraveEffect: activateTigerGraveEffect,
  handleOpAction: handleTigerOpAction,
});
