// cthulhu.js — 크툴루/올드원 테마
//
// ══ 코스트/효과 분리 원칙 ══════════════════════════════════════
// [코스트] activate 시점(체인 발동 선언 전)에 지불 → 무효화돼도 코스트는 돌아오지 않음
// [효과]   resolve 시점(체인 해결 후)에 처리
// ──────────────────────────────────────────────────────────────
// GOO ①/크타니트 ①처럼 "소환하고 발동"은 소환 자체가 코스트이므로
//   activate에서 소환 후 체인 등록, resolve에서 선택 효과만 처리.
// ══════════════════════════════════════════════════════════════

const _isGOO       = id => id.startsWith('그레이트 올드 원-');
const _isElderGod  = id => id.startsWith('엘더 갓-');
const _isAouterGod = id => id.startsWith('아우터 갓');
const _isOldOne    = dc => ['올드원','올드 원','크툴루'].includes(CARDS[dc.id]?.theme);

// ── 공용 헬퍼 ─────────────────────────────────────────────────

/** 패에서 꺼내 필드에 올리는 코스트 소환 */
function _gooSummonFromHand(cardId) {
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
  const hi = G.myHand.findIndex(h => h.id === cardId);
  if (hi < 0) { notify(`패에 ${CARDS[cardId]?.name || cardId}가 없습니다.`); return false; }
  const cd = CARDS[cardId];
  G.myHand.splice(hi, 1);
  G.myField.push({ id: cardId, name: cd.name, atk: cd.atk ?? 0, atkBase: cd.atk ?? 0 });
  log(`${cd.name} 소환 [코스트]`, 'mine');
  sendAction({ type: 'summon', cardId });
  return true;
}

/** 강제 패 버리기 1장 (체인 resolve 내부 헬퍼) */
function _cthulhuSelfDiscard(label, done) {
  if (!G.myHand.length) { log(`${label}: 패 없음 스킵`, 'mine'); done(); return; }
  _forcedDiscardOne(label, done);
}

/** 체인 등록 공통 헬퍼 */
function _beginOrAddChain(effect) {
  if (activeChainState && activeChainState.active) addChainLink(effect);
  else window.beginChain(effect);
}

// ── 발동 조건 체크 ─────────────────────────────────────────────
function _cthulhuCanActivate(cardId, effectNum) {
  switch (cardId) {
    case '그레이트 올드 원-크툴루':
      if (effectNum === 1) {
        if (!findAllInDeck(d => d.id === '태평양 속 르뤼에').length) {
          notify('발동 불가: 덱에 태평양 속 르뤼에가 없습니다.'); return false;
        }
      }
      if (effectNum === 2) {
        // 코스트: 필드 카드 1장 묘지. 효과: 자신 필드 1장 묘지(패널티)
        if (!G.myField.length && !G.opField.length) { notify('발동 불가: 필드에 카드가 없습니다.'); return false; }
        if (!G.myField.length) { notify('발동 불가: 패널티용 자신 필드 카드가 없습니다.'); return false; }
      }
      return true;
    case '그레이트 올드 원-크투가':
      if (effectNum === 1) {
        if (!G.myFieldCard && !G.opFieldCard) { notify('발동 불가: 필드 존에 카드가 없습니다.'); return false; }
      }
      if (effectNum === 2) {
        if (!G.myField.length) { notify('발동 불가: 패널티용 자신 필드 카드가 없습니다.'); return false; }
        const hasMon = G.myHand.some(h => CARDS[h.id]?.cardType === 'monster' && h.id !== cardId);
        if (!hasMon) { notify('발동 불가: 코스트로 소환할 패 몬스터가 없습니다.'); return false; }
      }
      return true;
    case '그레이트 올드 원-크아이가':
      if (effectNum === 1 || effectNum === 2) {
        // 소환 코스트 포함 → 소환 후 버릴 패가 있어야 함
        if (G.myHand.length < 2) { notify('발동 불가: 소환 후 버릴 패가 없습니다.'); return false; }
      }
      if (effectNum === 2) {
        if (!G.opField.length) { notify('발동 불가: 상대 필드에 카드가 없습니다.'); return false; }
      }
      return true;
    case '그레이트 올드 원-과타노차':
      if (effectNum === 1) {
        if (!G.myField.some(m => _isGOO(m.id))) { notify('발동 불가: 필드에 GOO 몬스터가 필요합니다.'); return false; }
        if (!G.myHand.some(h => h.id === '그레이트 올드 원-과타노차')) { notify('발동 불가: 패에 과타노차가 없습니다.'); return false; }
      }
      if (effectNum === 2) {
        if (!G.myField.some(m => m.id === '그레이트 올드 원-과타노차')) { notify('발동 불가: 필드에 과타노차가 없습니다.'); return false; }
        if (!G.myHand.some(h => _isGOO(h.id))) { notify('발동 불가: 패에 GOO가 없습니다.'); return false; }
        if (!G.opHand.length && !G.opField.length) { notify('발동 불가: 상대 패/필드에 카드가 없습니다.'); return false; }
      }
      return true;
    case '엘더 갓-노덴스':
      if (effectNum === 2) {
        const hasGOOinGrave = G.myGrave.some(g => _isGOO(g.id));
        if (!hasGOOinGrave) { notify('발동 불가: 묘지에 GOO가 없습니다.'); return false; }
        if (!findAllInDeck(d => _isGOO(d.id)).length) { notify('발동 불가: 덱에 GOO가 없습니다.'); return false; }
      }
      return true;
    case '엘더 갓-크타니트':
      // ②: 소환 유발이므로 activateFromHand로 직접 발동 불가
      if (effectNum === 2) { notify('크타니트 ②는 소환 유발효과입니다.'); return false; }
      return true;
    case '엘더 갓-히프노스':
      if (effectNum === 3) {
        if (!G.myGrave.some(g => CARDS[g.id]?.cardType === 'monster')) {
          notify('발동 불가: 묘지에 몬스터가 없습니다.'); return false;
        }
      }
      return true;
    default:
      return true;
  }
}

// ── 발동 함수 (코스트 처리 + 체인 등록) ───────────────────────
function _cthulhuActivate(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }
  if (!_cthulhuCanActivate(c.id, effectNum)) return;

  const effectText = _extractEffectText(card, effectNum);
  if (!effectText) { notify('효과 텍스트를 찾을 수 없습니다.'); return; }
  const { costText, mainText } = _splitCostAndMain(effectText);

  // ─ 카드별 코스트+체인 처리 ──────────────────────────────────

  // ── GOO ①: 자신을 소환(코스트) → 효과 발동 ──
  if (_isGOO(c.id) && effectNum === 1) {
    // 퀵효과 여부 (크아이가는 "자신/상대 턴에")
    const isQuick = costText.includes('자신/상대 턴에') || effectText.includes('자신/상대 턴에');
    if (!isQuick && (!isMyTurn || currentPhase !== 'deploy')) {
      notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return;
    }
    if (!isQuick && activeChainState && activeChainState.active) {
      notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return;
    }

    // [코스트] 자신을 소환
    if (!_gooSummonFromHand(c.id)) return;
    markEffectUsed(c.id, effectNum);
    sendGameState(); renderAll();

    const ef = { type: 'themeEffect', label: `${c.name} ①`, cardId: c.id, effectNum, theme: '올드원', mainText };
    if (isQuick) activateQuickEffect(ef);
    else activateIgnitionEffect(ef);
    return;
  }

  // ── 크타니트 ①: 패/제외에서 소환(코스트) → 효과 발동 ──
  if (c.id === '엘더 갓-크타니트' && effectNum === 1) {
    if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
    if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
    if (!_gooSummonFromHand('엘더 갓-크타니트')) return;
    markEffectUsed(c.id, effectNum);
    sendGameState(); renderAll();
    activateIgnitionEffect({ type: 'themeEffect', label: '크타니트 ①', cardId: c.id, effectNum, theme: '올드원', mainText });
    return;
  }

  // ── 크툴루 ②: [코스트] 필드 카드 1장 묘지 → [효과] 자신 필드 1장 묘지(패널티) ──
  if (c.id === '그레이트 올드 원-크툴루' && effectNum === 2) {
    if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
    if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
    const allField = [
      ...G.myField.map((m, i) => ({ ...m, _src: 'mine', _i: i })),
      ...G.opField.map((m, i) => ({ ...m, _src: 'op',   _i: i })),
    ];
    if (!allField.length) { notify('필드에 카드가 없습니다.'); return; }
    openCardPicker(allField, '크툴루 ②: [코스트] 필드 카드 1장 묘지로', 1, (sel) => {
      if (!sel.length) return;
      const p = allField[sel[0]];
      if (p._src === 'mine') { const m = G.myField.splice(p._i, 1)[0]; if (m) G.myGrave.push(m); }
      else { const m = G.opField.splice(p._i, 1)[0]; if (m) { G.opGrave.push(m); sendAction({ type: 'opFieldRemove', cardId: m.id, to: 'grave', isTargeting: true }); } }
      markEffectUsed(c.id, effectNum);
      activateIgnitionEffect({ type: 'themeEffect', label: `${c.name} ②`, cardId: c.id, effectNum, theme: '올드원', mainText });
      sendGameState(); renderAll();
    });
    return;
  }

  // ── 크투가 ②: [코스트] 패 몬스터 소환 → [효과] 자신 필드 1장 묘지(패널티) ──
  if (c.id === '그레이트 올드 원-크투가' && effectNum === 2) {
    if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
    if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
    const monsters = G.myHand.filter(h => CARDS[h.id]?.cardType === 'monster' && h.id !== c.id);
    if (!monsters.length) { notify('소환할 패 몬스터가 없습니다.'); return; }
    openCardPicker(monsters, '크투가 ②: [코스트] 패에서 몬스터 소환', 1, (sel) => {
      if (!sel.length) return;
      const t = monsters[sel[0]];
      const hi = G.myHand.findIndex(h => h === t);
      if (hi >= 0) {
        const mon = G.myHand.splice(hi, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
        log(`크투가 ②: ${mon.name} 소환 [코스트]`, 'mine');
        sendAction({ type: 'summon', cardId: mon.id });
      }
      markEffectUsed(c.id, effectNum);
      activateIgnitionEffect({ type: 'themeEffect', label: `${c.name} ②`, cardId: c.id, effectNum, theme: '올드원', mainText });
      sendGameState(); renderAll();
    });
    return;
  }

  // ── 과타노차 ①: [코스트] 자신 필드 GOO 1장 묘지 + 자신을 소환 → [효과] 드로우(선택) ──
  if (c.id === '그레이트 올드 원-과타노차' && effectNum === 1) {
    if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
    if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
    const gooOnField = G.myField.filter(m => _isGOO(m.id));
    openCardPicker(gooOnField, '과타노차 ①: [코스트] 자신 필드 GOO 1장 묘지', 1, (sel) => {
      if (!sel.length) return;
      const t = gooOnField[sel[0]];
      const fi = G.myField.findIndex(m => m === t);
      if (fi >= 0) G.myGrave.push(G.myField.splice(fi, 1)[0]);
      if (!_gooSummonFromHand('그레이트 올드 원-과타노차')) { sendGameState(); renderAll(); return; }
      markEffectUsed(c.id, effectNum);
      activateIgnitionEffect({ type: 'themeEffect', label: '과타노차 ①', cardId: c.id, effectNum, theme: '올드원', mainText });
      sendGameState(); renderAll();
    });
    return;
  }

  // ── 과타노차 ②: 필드의 이 카드를 사용하는 효과 (패에서는 발동 불가) ──
  if (c.id === '그레이트 올드 원-과타노차' && effectNum === 2) {
    notify('과타노차 ②는 필드에서 발동합니다. 패에서 직접 사용할 수 없습니다.'); return;
  }

  // ── 노덴스 ②: 퀵효과 (드로우/전개 단계에) — 패 발동 경로 ──
  if (c.id === '엘더 갓-노덴스' && effectNum === 2) {
    // "자신/상대 드로우 단계 또는 자신 전개 단계에"
    const validPhase = currentPhase === 'draw' || currentPhase === 'deploy';
    if (!validPhase) { notify('노덴스 ②는 드로우 단계 또는 전개 단계에만 발동할 수 있습니다.'); return; }
    if (activeChainState && activeChainState.active && activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다.'); return;
    }
    // [코스트] 묘지 GOO 제외
    const gg = G.myGrave.filter(g => _isGOO(g.id));
    if (!gg.length) { notify('묘지에 GOO가 없습니다.'); return; }
    openCardPicker(gg, '노덴스 ②: [코스트] 묘지 GOO 제외', 1, (sel) => {
      if (!sel.length) return;
      const gi = G.myGrave.findIndex(g => g === gg[sel[0]]);
      if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
      markEffectUsed(c.id, effectNum);
      const ef = { type: 'themeEffect', label: '노덴스 ②', cardId: c.id, effectNum, theme: '올드원', mainText };
      // 퀵효과: 체인에 추가하거나 새 체인 시작
      if (activeChainState && activeChainState.active) addChainLink(ef);
      else window.beginChain(ef);
      sendGameState(); renderAll();
    });
    return;
  }

  // ── 나머지: _payThemeCost 경유 (magic/trap/normal, 올드_원의 멸망 등) ──
  _payThemeCost(card, handIdx, costText, (paid) => {
    if (!paid) return;
    markEffectUsed(c.id, effectNum);
    const ef = { type: 'themeEffect', label: `${c.name} ${effectNum === 1 ? '①' : effectNum === 2 ? '②' : '③'}`, cardId: c.id, effectNum, theme: '올드원', mainText };
    // 퀵효과 패턴 감지
    if (costText.includes('자신/상대 턴에') || effectText.includes('자신/상대 턴에') ||
        costText.includes('상대 턴에') || effectText.includes('상대 턴에')) {
      if (activeChainState && activeChainState.active) addChainLink(ef);
      else window.beginChain(ef);
    } else {
      activateIgnitionEffect(ef);
    }
    sendGameState(); renderAll();
  });
}

// ── 해결 함수 (효과 처리) ──────────────────────────────────────
function _cthulhuResolve(link) {
  const { cardId, effectNum, mainText, extra = {} } = link;

  switch (cardId) {

    // ════ 그레이트 올드 원-크툴루 ════
    case '그레이트 올드 원-크툴루': {
      if (effectNum === 1) {
        // [효과] 덱에서 태평양 속 르뤼에를 필드 존에 배치
        if (!findAllInDeck(d => d.id === '태평양 속 르뤼에').length) { log('크툴루 ①: 덱에 르뤼에 없음', 'mine'); return; }
        removeFromDeck('태평양 속 르뤼에');
        G.myFieldCard = { id: '태평양 속 르뤼에', name: '태평양 속 르뤼에' };
        log('크툴루 ①: 태평양 속 르뤼에 배치', 'mine');
        sendAction({ type: 'fieldCard', cardId: '태평양 속 르뤼에' });
        sendGameState(); renderAll();
      } else if (effectNum === 2) {
        // [효과/패널티] 코스트는 activate에서 완료. 여기서는 자신 필드 1장 묘지(패널티)
        if (!G.myField.length) { sendGameState(); renderAll(); return; }
        openCardPicker([...G.myField], '크툴루 ②: [패널티] 자신 필드 카드 1장 묘지', 1, (sel) => {
          if (sel.length) { const m = G.myField.splice(sel[0], 1)[0]; if (m) { G.myGrave.push(m); onSentToGrave(m.id); } }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 3) {
        // [효과] 덱에서 GOO 1장 서치
        const td = findAllInDeck(d => _isGOO(d.id));
        if (!td.length) { notify('덱에 GOO가 없습니다.'); return; }
        openCardPicker(td, '크툴루 ③: 덱에서 GOO 서치', 1, (sel) => {
          if (sel.length) searchToHand(td[sel[0]].id);
          sendGameState(); renderAll();
        });
      }
      break;
    }

    // ════ 그레이트 올드 원-크투가 ════
    case '그레이트 올드 원-크투가': {
      if (effectNum === 1) {
        // [효과/패널티] 필드 존 카드 1장 묘지
        const fc = [];
        if (G.myFieldCard)  fc.push({ id: G.myFieldCard.id,  name: G.myFieldCard.name,  _who: 'me' });
        if (G.opFieldCard)  fc.push({ id: G.opFieldCard.id,  name: G.opFieldCard.name,  _who: 'op' });
        if (!fc.length) { sendGameState(); renderAll(); return; }
        openCardPicker(fc, '크투가 ①: [패널티] 필드 존 카드 1장 묘지', 1, (sel) => {
          if (sel.length) {
            const p = fc[sel[0]];
            if (p._who === 'me') { G.myGrave.push(G.myFieldCard); G.myFieldCard = null; }
            else { G.opGrave.push(G.opFieldCard); sendAction({ type: 'opFieldCardRemove', cardId: p.id, to: 'grave' }); G.opFieldCard = null; }
          }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // [효과/패널티] 코스트(몬스터 소환)는 activate 완료. 자신 필드 1장 묘지(패널티)
        if (!G.myField.length) { sendGameState(); renderAll(); return; }
        openCardPicker([...G.myField], '크투가 ②: [패널티] 자신 필드 카드 1장 묘지', 1, (sel) => {
          if (sel.length) { const m = G.myField.splice(sel[0], 1)[0]; if (m) { G.myGrave.push(m); onSentToGrave(m.id); } }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 3) {
        // [효과] 자신/상대 묘지 합계 2장 제외
        const pool = [
          ...G.myGrave.map(g => ({ ...g, _src: 'mine' })),
          ...G.opGrave.map(g => ({ ...g, _src: 'op' })),
        ];
        if (!pool.length) { sendGameState(); renderAll(); return; }
        const cnt = Math.min(2, pool.length);
        openCardPicker(pool, `크투가 ③: 묘지 ${cnt}장 제외`, cnt, (sel) => {
          sel.sort((a, b) => b - a).forEach(i => {
            const p = pool[i];
            if (p._src === 'mine') { const gi = G.myGrave.findIndex(g => g.id === p.id); if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]); }
            else { const gi = G.opGrave.findIndex(g => g.id === p.id); if (gi >= 0) { G.opExile.push(G.opGrave.splice(gi, 1)[0]); sendAction({ type: 'opGraveExile', cardId: p.id }); } }
          });
          sendGameState(); renderAll();
        });
      }
      break;
    }

    // ════ 그레이트 올드 원-크아이가 ════
    case '그레이트 올드 원-크아이가': {
      if (effectNum === 1) {
        // [효과/패널티] 패 1장 버리기 (소환 코스트는 activate에서 완료)
        _cthulhuSelfDiscard('크아이가 ①: [패널티] 패 1장 버리기', () => { sendGameState(); renderAll(); });
      } else if (effectNum === 2) {
        // [효과] 상대 필드 1장 묘지 (코스트는 activate에서 완료). [패널티] 패 1장 버리기
        if (!G.opField.length) { notify('상대 필드가 비어있습니다.'); sendGameState(); renderAll(); return; }
        openCardPicker([...G.opField], '크아이가 ②: [효과] 상대 필드 1장 묘지', 1, (sel) => {
          if (sel.length) { const mon = G.opField.splice(sel[0], 1)[0]; if (mon) { G.opGrave.push(mon); sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave', isTargeting: true }); } }
          _cthulhuSelfDiscard('크아이가 ②: [패널티] 패 1장 버리기', () => { sendGameState(); renderAll(); });
        });
      } else if (effectNum === 3) {
        // [효과] 상대 필드 최대 2장 묘지. [패널티] 패 1장 버리기
        const opTargets = [...G.opField];
        const cnt = Math.min(2, opTargets.length);
        if (!cnt) { _cthulhuSelfDiscard('크아이가 ③: [패널티] 패 1장 버리기', () => { sendGameState(); renderAll(); }); return; }
        openCardPicker(opTargets, `크아이가 ③: [효과] 상대 필드 최대 ${cnt}장 묘지`, cnt, (sel) => {
          sel.sort((a, b) => b - a).forEach(i => {
            const mon = G.opField.splice(i, 1)[0];
            if (mon) { G.opGrave.push(mon); sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave', isTargeting: true }); }
          });
          _cthulhuSelfDiscard('크아이가 ③: [패널티] 패 1장 버리기', () => { sendGameState(); renderAll(); });
        });
      } else if (effectNum === 4) {
        // [효과] 덱에서 엘더 갓 제외
        const egInDeck = findAllInDeck(d => _isElderGod(d.id));
        if (!egInDeck.length) { notify('덱에 엘더 갓이 없습니다.'); return; }
        openCardPicker(egInDeck, '크아이가 ④: 덱에서 엘더 갓 제외', 1, (sel) => {
          if (sel.length) {
            const picked = egInDeck[sel[0]];
            removeFromDeck(picked.id);
            G.myExile.push({ id: picked.id, name: CARDS[picked.id]?.name || picked.id });
            log(`크아이가 ④: ${picked.id} 덱에서 제외`, 'mine');
          }
          sendGameState(); renderAll();
        });
      }
      break;
    }

    // ════ 그레이트 올드 원-과타노차 ════
    case '그레이트 올드 원-과타노차': {
      if (effectNum === 1) {
        // [효과] 드로우 (선택) — gameConfirm으로 처리
        gameConfirm('과타노차 ①: 1장 드로우하시겠습니까?', (yes) => {
          if (yes) { drawOne(); log('과타노차 ①: 드로우', 'mine'); }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // [코스트] 필드의 이 카드 + 상대 패/필드 1장 묘지
        // [효과] 패에서 GOO 소환
        // ※ 이 케이스는 _cthulhuActivateFromField에서 진입
        const opTargets = [
          ...G.opHand.map(h => ({ id: h.id, name: h.isPublic ? h.name : '(비공개 패)', _src: 'hand' })),
          ...G.opField.map((m, i) => ({ ...m, _src: 'field', _i: i })),
        ];
        const gooHand = G.myHand.filter(h => _isGOO(h.id));
        if (!opTargets.length || !gooHand.length) { sendGameState(); renderAll(); return; }
        openCardPicker(opTargets, '과타노차 ②: [코스트] 상대 패/필드 1장 묘지', 1, (sel) => {
          if (sel.length) {
            const p = opTargets[sel[0]];
            if (p._src === 'hand') {
              sendAction({ type: 'forceDiscard', count: 1, reason: '과타노차 ②', attackerPicks: false });
            } else {
              const fi = p._i;
              if (fi !== undefined) { const m = G.opField.splice(fi, 1)[0]; if (m) { G.opGrave.push(m); sendAction({ type: 'opFieldRemove', cardId: m.id, to: 'grave', isTargeting: true }); } }
            }
          }
          openCardPicker(gooHand, '과타노차 ②: [효과] 패에서 GOO 소환', 1, (sel2) => {
            if (sel2.length) {
              const t = gooHand[sel2[0]];
              const hi = G.myHand.findIndex(h => h === t);
              if (hi >= 0) {
                const mon = G.myHand.splice(hi, 1)[0];
                G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 4, atkBase: CARDS[mon.id]?.atk ?? 4 });
                log(`과타노차 ②: ${mon.name} 소환`, 'mine');
                sendAction({ type: 'summon', cardId: mon.id });
                onSummon(mon.id, 'hand');
              }
            }
            sendGameState(); renderAll();
          });
        });
      }
      break;
    }

    // ════ 엘더 갓-노덴스 ════
    case '엘더 갓-노덴스': {
      if (effectNum === 1) {
        // [효과/패널티] 자신 필드 GOO 1장 이상 묘지 (소환은 트리거에서 완료)
        const gooField = G.myField.filter(m => _isGOO(m.id));
        if (!gooField.length) { sendGameState(); renderAll(); return; }
        openCardPicker(gooField, '노덴스 ①: [패널티] 자신 필드 GOO 1장 이상 묘지', gooField.length, (sel) => {
          if (!sel.length) return;
          sel.sort((a, b) => b - a).forEach(i => {
            const fi = G.myField.findIndex(m => m === gooField[i]);
            if (fi >= 0) { const m = G.myField.splice(fi, 1)[0]; G.myGrave.push(m); onSentToGrave(m.id); }
          });
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // [효과] 덱에서 GOO 1장 묘지 (코스트 제외는 activate에서 완료)
        const gd = findAllInDeck(d => _isGOO(d.id));
        if (!gd.length) { notify('덱에 GOO가 없습니다.'); return; }
        openCardPicker(gd, '노덴스 ②: [효과] 덱에서 GOO 묘지', 1, (sel2) => {
          if (sel2.length) {
            const picked = gd[sel2[0]];
            removeFromDeck(picked.id);
            G.myGrave.push({ id: picked.id, name: CARDS[picked.id]?.name || picked.id });
            log(`노덴스 ②: ${picked.id} 덱에서 묘지로`, 'mine');
            onSentToGrave(picked.id);
          }
          sendGameState(); renderAll();
        });
      }
      break;
    }

    // ════ 엘더 갓-크타니트 ════
    case '엘더 갓-크타니트': {
      if (effectNum === 1) {
        // [효과] 서로 1장 드로우 (소환은 제외 트리거에서 완료)
        drawOne();
        sendAction({ type: 'opDraw', count: 1 });
        log('크타니트 ①: 서로 1장 드로우', 'mine');
        sendGameState(); renderAll();
      } else if (effectNum === 2) {
        // [효과] 상대가 패 1장 버림 + 자신 1장 드로우 (소환 유발)
        sendAction({ type: 'forceDiscard', count: 1, reason: '크타니트 ②', attackerPicks: false });
        drawOne();
        log('크타니트 ②: 상대 패 1장 버리게 함 + 드로우', 'mine');
        sendGameState(); renderAll();
      } else if (effectNum === 3) {
        // [코스트] 상대 덱 맨 위 제외. [효과] 서로 패 몬스터 소환 (선택)
        sendAction({ type: 'opDeckTopExile', reason: '크타니트 ③' });
        log('크타니트 ③: 상대 덱 맨 위 제외', 'mine');
        const myMons = G.myHand.filter(h => CARDS[h.id]?.cardType === 'monster');
        if (!myMons.length) { sendGameState(); renderAll(); return; }
        gameConfirm(`크타니트 ③: 패의 몬스터를 소환하시겠습니까?\n(${myMons.map(m=>m.name).join(', ')})`, (yes) => {
          if (!yes) { sendGameState(); renderAll(); return; }
          openCardPicker(myMons, '크타니트 ③: [효과] 패에서 몬스터 소환', 1, (sel) => {
            if (sel.length) {
              const t = myMons[sel[0]];
              const hi = G.myHand.findIndex(h => h === t);
              if (hi >= 0) {
                const mon = G.myHand.splice(hi, 1)[0];
                G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
                log(`크타니트 ③: ${mon.name} 소환`, 'mine');
                sendAction({ type: 'summon', cardId: mon.id });
                onSummon(mon.id, 'hand');
              }
            }
            sendGameState(); renderAll();
          });
        });
      }
      break;
    }

    // ════ 엘더 갓-히프노스 ════
    case '엘더 갓-히프노스': {
      if (effectNum === 1) {
        // [효과] 1장 드로우. [선택] GOO 버리고 추가 드로우 (소환은 제외 트리거에서 완료)
        drawOne();
        log('히프노스 ①: 드로우', 'mine');
        const gh = G.myHand.filter(h => _isGOO(h.id));
        if (!gh.length) { sendGameState(); renderAll(); return; }
        gameConfirm(`히프노스 ①: GOO를 버리고 추가 드로우하시겠습니까?\n(${gh.map(m=>m.name).join(', ')})`, (yes) => {
          if (!yes) { sendGameState(); renderAll(); return; }
          openCardPicker(gh, '히프노스 ①: GOO 버리기 (선택)', 1, (sel) => {
            if (sel.length) {
              const hi = G.myHand.findIndex(h => h === gh[sel[0]]);
              if (hi >= 0) { G.myGrave.push(G.myHand.splice(hi, 1)[0]); drawOne(); log('히프노스 ①: 추가 드로우', 'mine'); }
            }
            sendGameState(); renderAll();
          });
        });
      } else if (effectNum === 3) {
        // [효과] 묘지에서 몬스터 1장 소환 (자신 공격 단계 기동효과)
        const targets = G.myGrave.filter(g => CARDS[g.id]?.cardType === 'monster');
        if (!targets.length) { notify('묘지에 몬스터가 없습니다.'); return; }
        openCardPicker(targets, '히프노스 ③: 묘지에서 몬스터 소환', 1, (sel) => {
          if (sel.length) {
            const t = targets[sel[0]];
            const gi = G.myGrave.findIndex(g => g === t);
            if (gi >= 0) {
              const mon = G.myGrave.splice(gi, 1)[0];
              G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
              log(`히프노스 ③: ${mon.name} 묘지→소환`, 'mine');
              sendAction({ type: 'summon', cardId: mon.id });
              onSummon(mon.id, 'grave');
            }
          }
          sendGameState(); renderAll();
        });
      }
      break;
    }

    // ════ 올드_원의 멸망 ════
    case '올드_원의 멸망': {
      if (effectNum === 1) {
        // [효과] 덱/묘지에서 GOO 소환 (코스트 엘더갓 덱 제외는 activate 완료)
        const gooPool = [
          ...findAllInDeck(d => _isGOO(d.id)).map(d => ({ ...d, _from: 'deck' })),
          ...G.myGrave.filter(g => _isGOO(g.id)).map(g => ({ ...g, _from: 'grave' })),
        ];
        if (!gooPool.length) { notify('덱/묘지에 GOO가 없습니다.'); return; }
        openCardPicker(gooPool, '멸망 ①: 덱/묘지에서 GOO 소환', 1, (sel) => {
          if (sel.length) {
            const p = gooPool[sel[0]];
            if (p._from === 'deck') summonFromDeck(p.id);
            else {
              const gi = G.myGrave.findIndex(g => g.id === p.id);
              if (gi >= 0) {
                const mon = G.myGrave.splice(gi, 1)[0];
                G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 4, atkBase: CARDS[mon.id]?.atk ?? 4 });
                log(`멸망 ①: ${mon.name} 묘지→소환`, 'mine');
                sendAction({ type: 'summon', cardId: mon.id });
                onSummon(mon.id, 'grave');
              }
            }
          }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // [효과] 덱에서 올드원 카드 서치 (코스트 묘지 이 카드 제외는 activate 완료)
        const td = findAllInDeck(d => _isOldOne(d));
        if (!td.length) { notify('덱에 올드원 카드가 없습니다.'); return; }
        openCardPicker(td, '멸망 ②: 덱에서 올드원 카드 서치', 1, (sel) => {
          if (sel.length) searchToHand(td[sel[0]].id);
          sendGameState(); renderAll();
        });
      }
      break;
    }

    // ════ 아우터 갓 니알라토텝 ════
    case '아우터 갓 니알라토텝': {
      if (effectNum === 2) {
        // [효과] 상대 몬스터 효과 무효 + 공격력/이름 복사
        if (!G.opField.length) { notify('상대 필드에 몬스터가 없습니다.'); return; }
        openCardPicker([...G.opField], '니알라토텝 ②: 상대 몬스터 효과 무효 + 정보 복사', 1, (sel) => {
          if (sel.length) {
            const mon = G.opField[sel[0]];
            const fi = G.myField.findIndex(m => m.id === '아우터 갓 니알라토텝');
            if (fi >= 0 && CARDS[mon.id]) {
              G.myField[fi].atk = CARDS[mon.id]?.atk ?? G.myField[fi].atk;
              G.myField[fi].copiedFrom = mon.id;
            }
            sendAction({ type: 'negateField', cardId: mon.id });
            log(`니알라토텝 ②: ${mon.name} 효과 무효 + 정보 복사`, 'mine');
          }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 3) {
        // [효과] 상대 효과를 "자신 필드의 니알라토텝 1장을 묘지로 보낸다"로 변환
        // → 실제로는 니알라토텝을 묘지로 보냄
        const fi = G.myField.findIndex(m => m.id === '아우터 갓 니알라토텝');
        if (fi >= 0) { const m = G.myField.splice(fi, 1)[0]; G.myGrave.push(m); onSentToGrave(m.id); }
        log('니알라토텝 ③: 자신 필드의 니알라토텝을 묘지로', 'mine');
        sendGameState(); renderAll();
      }
      break;
    }

    default:
      resolveThemeEffectGeneric(link);
  }
}

// ── 과타노차 ② 필드 발동 ──────────────────────────────────────
// 과타노차 ②는 필드에 있는 과타노차 카드를 코스트로 사용하므로
// _cthulhuActivate(패 발동)가 아닌 별도 필드 효과 진입점에서 처리
function _cthulhuActivateFromField(fieldIdx, effectNum) {
  const mon = G.myField[fieldIdx];
  if (!mon) return;
  if (mon.id === '그레이트 올드 원-과타노차' && effectNum === 2) {
    if (!isMyTurn || currentPhase !== 'deploy') { notify('기동효과는 자신 전개 단계에만 발동할 수 있습니다.'); return; }
    if (activeChainState && activeChainState.active) { notify('기동효과는 체인 1로만 발동할 수 있습니다.'); return; }
    if (!canUseEffect('그레이트 올드 원-과타노차', 2)) { notify('이미 사용했습니다.'); return; }
    if (!G.myHand.some(h => _isGOO(h.id))) { notify('발동 불가: 패에 GOO가 없습니다.'); return; }
    if (!G.opHand.length && !G.opField.length) { notify('발동 불가: 상대 패/필드에 카드가 없습니다.'); return; }
    // [코스트] 이 카드(필드) 를 묘지로
    G.myGrave.push(G.myField.splice(fieldIdx, 1)[0]);
    markEffectUsed('그레이트 올드 원-과타노차', 2);
    activateIgnitionEffect({ type: 'themeEffect', label: '과타노차 ②', cardId: '그레이트 올드 원-과타노차', effectNum: 2, theme: '올드원', mainText: '' });
    sendGameState(); renderAll();
  }
}

// ── 아우터 갓 소환 진입점 ─────────────────────────────────────
// 아우터 갓 3종은 특수 소환 조건이 있어 _summonKeyCardFromDeck에 연결됨
// 각 카드별 고유 소환 코스트를 여기서 처리
function _activateOuterGod(cardId) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 소환할 수 있습니다.'); return; }
  if (activeChainState && activeChainState.active) { notify('체인 중에는 소환할 수 없습니다.'); return; }
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return; }

  const card = CARDS[cardId];
  if (!card) { notify('카드 정보 없음'); return; }

  if (cardId === '아우터 갓 니알라토텝') {
    // [코스트] 상대 필드 1장 + 자신 필드 GOO/엘더갓 2장씩 묘지
    if (!G.opField.length) { notify('소환 불가: 상대 필드에 카드가 없습니다.'); return; }
    const myGOOorEG = G.myField.filter(m => _isGOO(m.id) || _isElderGod(m.id));
    if (myGOOorEG.length < 2) { notify('소환 불가: 자신 필드 GOO/엘더갓 2장 이상 필요'); return; }
    // 상대 필드 1장 선택
    openCardPicker([...G.opField], '니알라토텝: [코스트] 상대 필드 카드 1장 묘지', 1, (sel1) => {
      if (!sel1.length) return;
      const opMon = G.opField.splice(sel1[0], 1)[0];
      if (opMon) { G.opGrave.push(opMon); sendAction({ type: 'opFieldRemove', cardId: opMon.id, to: 'grave', isTargeting: true }); }
      // 자신 필드 GOO/엘더갓 2장 선택
      openCardPicker(myGOOorEG, '니알라토텝: [코스트] 자신 필드 GOO/엘더갓 2장 묘지', 2, (sel2) => {
        if (sel2.length < 2) return;
        sel2.sort((a, b) => b - a).forEach(i => {
          const fi = G.myField.findIndex(m => m === myGOOorEG[i]);
          if (fi >= 0) { const m = G.myField.splice(fi, 1)[0]; G.myGrave.push(m); onSentToGrave(m.id); }
        });
        // 키덱에서 꺼내 소환
        const ki = G.myKeyDeck.findIndex(c => c.id === cardId);
        if (ki >= 0) G.myKeyDeck.splice(ki, 1);
        G.myField.push({ id: cardId, name: card.name, atk: card.atk ?? 6, atkBase: card.atk ?? 6, summonedFrom: 'keyDeck' });
        log('아우터 갓 니알라토텝 소환!', 'mine');
        sendAction({ type: 'summon', cardId });
        onSummon(cardId, 'keyDeck');
        sendGameState(); renderAll();
      });
    });

  } else if (cardId === '아우터 갓-아자토스') {
    // [코스트] 자신 필드 아우터 갓 카드가 상대 효과로 필드를 벗어난 경우에 소환
    // → 트리거 발동이므로 직접 소환 버튼보다는 트리거로 처리해야 하나,
    //   수동 진입점으로는 "자신 필드에 아우터 갓이 있을 때"를 조건으로 허용
    const ki = G.myKeyDeck.findIndex(c => c.id === cardId);
    if (ki >= 0) G.myKeyDeck.splice(ki, 1);
    G.myField.push({ id: cardId, name: card.name, atk: card.atk ?? 10, atkBase: card.atk ?? 10, summonedFrom: 'keyDeck' });
    // [효과] 패를 3장 남을 때까지 버리기
    const discardTo3 = () => {
      if (G.myHand.length <= 3) { sendGameState(); renderAll(); return; }
      _cthulhuSelfDiscard('아자토스 ②: 패를 3장 남을 때까지 버리기', discardTo3);
    };
    log('아우터 갓-아자토스 소환!', 'mine');
    sendAction({ type: 'summon', cardId });
    discardTo3();

  } else if (cardId === '아우터 갓 슈브 니구라스') {
    // GOO 소환 시 자동 트리거 (_triggerShubniggurath1)로만 소환되는 카드
    // 수동 진입은 허용하지 않음
    notify('슈브 니구라스는 GOO 소환 시 자동으로 소환됩니다. 수동 소환 불가.');
  }
}

// ── 제외 트리거 (히프노스, 노덴스, 크타니트) ──────────────────
// G.myExile.push 훅 대신 onCardExiled를 engine.js의 exile 처리 시 호출하도록
// cthulhu.js에서 함수를 정의하고 engine.js에서 호출

window._onCthulhuExiled = function(cardId) {
  // 히프노스 ①: 제외되면 소환하고 드로우 효과 발동
  if (cardId === '엘더 갓-히프노스' && canUseEffect('엘더 갓-히프노스', 1)) {
    if (G.myField.length >= maxFieldSlots()) return;
    const cd = CARDS['엘더 갓-히프노스'];
    // 제외 존에 있는 카드를 필드로
    const ei = G.myExile.findIndex(c => c.id === '엘더 갓-히프노스');
    if (ei >= 0) G.myExile.splice(ei, 1);
    G.myField.push({ id: '엘더 갓-히프노스', name: cd.name, atk: cd.atk ?? 4, atkBase: cd.atk ?? 4 });
    markEffectUsed('엘더 갓-히프노스', 1);
    log('히프노스 ①: 제외→소환', 'mine');
    sendAction({ type: 'summon', cardId: '엘더 갓-히프노스' });
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '히프노스 ①', cardId: '엘더 갓-히프노스',
      effectNum: 1, theme: '올드원', mainText: '',
      optional: false,
    });
    renderAll();
  }

  // 크타니트 ①: 제외되면 소환하고 "서로 드로우" 발동
  if (cardId === '엘더 갓-크타니트' && canUseEffect('엘더 갓-크타니트', 1)) {
    if (G.myField.length >= maxFieldSlots()) return;
    const cd = CARDS['엘더 갓-크타니트'];
    const ei = G.myExile.findIndex(c => c.id === '엘더 갓-크타니트');
    if (ei >= 0) G.myExile.splice(ei, 1);
    G.myField.push({ id: '엘더 갓-크타니트', name: cd.name, atk: cd.atk ?? 5, atkBase: cd.atk ?? 5 });
    markEffectUsed('엘더 갓-크타니트', 1);
    log('크타니트 ①: 제외→소환', 'mine');
    sendAction({ type: 'summon', cardId: '엘더 갓-크타니트' });
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '크타니트 ①', cardId: '엘더 갓-크타니트',
      effectNum: 1, theme: '올드원', mainText: '',
      optional: false,
    });
    renderAll();
  }

  // 노덴스: 제외되면 소환+패널티 발동
  if (cardId === '엘더 갓-노덴스' && canUseEffect('엘더 갓-노덴스', 1)) {
    if (G.myField.length >= maxFieldSlots()) return;
    const cd = CARDS['엘더 갓-노덴스'];
    const ei = G.myExile.findIndex(c => c.id === '엘더 갓-노덴스');
    if (ei >= 0) G.myExile.splice(ei, 1);
    G.myField.push({ id: '엘더 갓-노덴스', name: cd.name, atk: cd.atk ?? 6, atkBase: cd.atk ?? 6 });
    markEffectUsed('엘더 갓-노덴스', 1);
    log('노덴스 ①: 제외→소환', 'mine');
    sendAction({ type: 'summon', cardId: '엘더 갓-노덴스' });
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '노덴스 ①(제외)', cardId: '엘더 갓-노덴스',
      effectNum: 1, theme: '올드원', mainText: '',
      optional: false,
    });
    renderAll();
  }
};

// ── 묘지 트리거 (engine.js의 onSentToGrave에서 호출) ──────────
window._onCthulhuSentToGrave = function(cardId) {
  // 크툴루 ③: 묘지로 보내졌을 경우
  if (cardId === '그레이트 올드 원-크툴루' && canUseEffect('그레이트 올드 원-크툴루', 3)) {
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '크툴루 ③', cardId: '그레이트 올드 원-크툴루',
      effectNum: 3, theme: '올드원', mainText: '',
      optional: true,
    });
  }
  // 크투가 ③: 묘지로 보내졌을 경우
  if (cardId === '그레이트 올드 원-크투가' && canUseEffect('그레이트 올드 원-크투가', 3)) {
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '크투가 ③', cardId: '그레이트 올드 원-크투가',
      effectNum: 3, theme: '올드원', mainText: '',
      optional: true,
    });
  }
  // 크아이가 ③: 필드에서 묘지로 보내졌을 경우만 (③은 별도 effectNum)
  if (cardId === '그레이트 올드 원-크아이가' && canUseEffect('그레이트 올드 원-크아이가', 3)) {
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '크아이가 ③', cardId: '그레이트 올드 원-크아이가',
      effectNum: 3, theme: '올드원', mainText: '',
      optional: true,
    });
  }
  // 노덴스 ①: 묘지로 보내졌을 경우 소환+패널티
  if (cardId === '엘더 갓-노덴스' && canUseEffect('엘더 갓-노덴스', 1)) {
    if (G.myField.length < maxFieldSlots()) {
      const cd = CARDS['엘더 갓-노덴스'];
      const gi = G.myGrave.findIndex(g => g.id === '엘더 갓-노덴스');
      if (gi >= 0) {
        G.myGrave.splice(gi, 1);
        G.myField.push({ id: '엘더 갓-노덴스', name: cd.name, atk: cd.atk ?? 6, atkBase: cd.atk ?? 6 });
        markEffectUsed('엘더 갓-노덴스', 1);
        log('노덴스 ①: 묘지→소환', 'mine');
        sendAction({ type: 'summon', cardId: '엘더 갓-노덴스' });
        enqueueTriggeredEffect({
          type: 'themeEffect', label: '노덴스 ①(묘지)', cardId: '엘더 갓-노덴스',
          effectNum: 1, theme: '올드원', mainText: '',
          optional: false,
        });
        renderAll();
      }
    }
  }
};

// ── 소환 유발 (engine.js의 onSummon에서 호출) ─────────────────
window._triggerCthulhuOnSummon = function(cardId, from) {
  // 크타니트 ②: 소환했을 경우 (제외 트리거①과 다른 경로)
  if (cardId === '엘더 갓-크타니트' && canUseEffect('엘더 갓-크타니트', 2)) {
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '크타니트 ②', cardId: '엘더 갓-크타니트',
      effectNum: 2, theme: '올드원', mainText: '',
      optional: true,
    });
  }
  // 니알라토텝 ②: 소환했을 경우
  if (cardId === '아우터 갓 니알라토텝' && canUseEffect('아우터 갓 니알라토텝', 2)) {
    enqueueTriggeredEffect({
      type: 'themeEffect', label: '니알라토텝 ②(소환)', cardId: '아우터 갓 니알라토텝',
      effectNum: 2, theme: '올드원', mainText: '',
      optional: true,
    });
  }
};

// ── 슈브 니구라스 ① 트리거 ───────────────────────────────────
// GOO가 소환됐을 경우 슈브 니구라스를 소환하고 발동
window._triggerShubniggurath1 = function(summonedCardId, from) {
  if (!canUseEffect('아우터 갓 슈브 니구라스', 1)) return;
  // 키덱에 슈브 니구라스가 있어야
  const ki = G.myKeyDeck.findIndex(c => c.id === '아우터 갓 슈브 니구라스');
  if (ki < 0) return;
  if (G.myField.length >= maxFieldSlots()) return;
  // 소환된 카드가 GOO인지 확인
  const triggeredByGOO = summonedCardId === null || _isGOO(summonedCardId);
  if (!triggeredByGOO) return;

  // 선택 발동
  gameConfirm('슈브 니구라스 ①: GOO 소환에 연동하여 소환 + 덱에서 GOO 묘지\n발동하시겠습니까?', (yes) => {
    if (!yes) return;
    // 키덱에서 꺼내 소환
    G.myKeyDeck.splice(ki, 1);
    const cd = CARDS['아우터 갓 슈브 니구라스'];
    G.myField.push({ id: '아우터 갓 슈브 니구라스', name: cd.name, atk: 0, atkBase: 0, summonedFrom: 'keyDeck' });
    markEffectUsed('아우터 갓 슈브 니구라스', 1);
    log('슈브 니구라스 ①: 소환!', 'mine');
    sendAction({ type: 'summon', cardId: '아우터 갓 슈브 니구라스' });
    // [효과] 덱에서 GOO 1장 묘지
    const gooInDeck = findAllInDeck(d => _isGOO(d.id));
    if (gooInDeck.length) {
      enqueueTriggeredEffect({
        type: 'themeEffect', label: '슈브 니구라스 ①(GOO 덱→묘지)',
        cardId: '아우터 갓 슈브 니구라스', effectNum: 1, theme: '올드원',
        mainText: '', optional: false,
      });
    }
    renderAll();
  });
};

// CHAIN_RESOLVERS에 슈브 니구라스 ① 리졸버 등록 (effects-chain.js와 연동)
window._resolveShubniggurath1 = function() {
  const gooInDeck = findAllInDeck(d => _isGOO(d.id));
  if (!gooInDeck.length) { sendGameState(); renderAll(); return; }
  openCardPicker(gooInDeck, '슈브 니구라스 ①: 덱에서 GOO 1장 묘지로', 1, (sel) => {
    if (sel.length) {
      const picked = gooInDeck[sel[0]];
      removeFromDeck(picked.id);
      G.myGrave.push({ id: picked.id, name: CARDS[picked.id]?.name || picked.id });
      log(`슈브 니구라스 ①: ${picked.id} 덱→묘지`, 'mine');
      onSentToGrave(picked.id);
    }
    sendGameState(); renderAll();
  });
};

// ── 상대 액션 처리 ─────────────────────────────────────────────
function _cthulhuHandleOp(action) {
  switch (action.type) {
    case 'opDeckTopExile':
      if (G.myDeck.length) {
        const top = G.myDeck.shift();
        G.myExile.push(top);
        log(`상대 크타니트 ③: 내 덱 맨 위 ${CARDS[top.id]?.name || top.id} 제외`, 'opponent');
        // 제외 트리거 체크
        if (window._onCthulhuExiled) window._onCthulhuExiled(top.id);
        renderAll();
      }
      break;
  }
}

// ── 등록 ──────────────────────────────────────────────────────
['크툴루', '올드원', '올드 원'].forEach(theme => {
  registerThemeEffectHandler(theme, {
    activateFromHand: _cthulhuActivate,
    resolveLink:      _cthulhuResolve,
    handleOpAction:   _cthulhuHandleOp,
  });
});

// engine.js의 exile 처리 경로에서 _onCthulhuExiled 호출되도록
// summonFromHand/summonFromGrave 등 exile로 보내는 헬퍼를 보완
// (G.myExile.push 직접 후킹 대신 내부 sendToExile 함수를 통해 호출)
