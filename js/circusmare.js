// circusmare.js — 서커스메어 테마 효과 핸들러
// index.html에서 cards.js 다음에 로드하세요:
//   <script src="js/circusmare.js"></script>

// ──────────────────────────────────────────────────────────
// 유틸: 서커스메어 판별
// ──────────────────────────────────────────────────────────
function _isCircusmare(card) {
  return card && (card.theme === '서커스메어' ||
    ['악몽의 서커스장','악몽 융합','광란의 서커스'].includes(card.id));
}

const CIRCUSMARE_MED_SET = new Set([
  '서커스메어 메드 울프',
  '서커스메어 메드 베어',
  '서커스메어 메드 이글',
  '서커스메어 메드 씰',
]);

// ──────────────────────────────────────────────────────────
// 코인 토스 헬퍼
// n회 토스 → 앞면 횟수 반환, 결과 로그 출력
// ──────────────────────────────────────────────────────────
function _circusCoinToss(n, label) {
  let heads = 0;
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random() < 0.5;
    if (r) heads++;
    results.push(r ? '앞' : '뒤');
  }
  log(`${label}: 코인 토스 ${n}회 → [${results.join(', ')}] (앞면 ${heads}회)`, 'mine');
  return heads;
}

// ──────────────────────────────────────────────────────────
// 키카드 소환: 키 카드 덱에서 cardId를 꺼내 필드에 소환
// ──────────────────────────────────────────────────────────
function _circusSummonKeyCard(cardId) {
  const idx = G.myKeyDeck.findIndex(c => c.id === cardId);
  if (idx < 0) { notify(`키 카드 덱에 ${CARDS[cardId]?.name || cardId}가 없습니다.`); return false; }
  const c = G.myKeyDeck.splice(idx, 1)[0];
  const card = CARDS[c.id] || {};
  G.myField.push({ id: c.id, name: c.name, atk: card.atk ?? 0, atkBase: card.atk ?? 0, summonedFrom: 'keyDeck' });
  log(`키 카드 소환: ${c.name}`, 'mine');
  sendAction({ type: 'summon', cardId: c.id, from: 'keyDeck' });
  return true;
}

// ──────────────────────────────────────────────────────────
// 키카드 소환 조건 확인 함수들
// ──────────────────────────────────────────────────────────

/** 스프링 제스터: 서커스메어 몬스터 3장 묘지/제외/덱 복귀 트리거 */
function _checkSpringJesterCondition() {
  const graveCircus = G.myGrave.filter(c => _isCircusmare(CARDS[c.id])).length;
  const exileCircus = G.myExile.filter(c => _isCircusmare(CARDS[c.id])).length;
  return (graveCircus + exileCircus) >= 3;
}

/** 메드 키메라: 메드 4종 모두 묘지/제외 상태인지 확인 */
function _checkMedChimeraCondition() {
  return [...CIRCUSMARE_MED_SET].every(id =>
    G.myGrave.some(c => c.id === id) || G.myExile.some(c => c.id === id)
  );
}

/** 퍼핏 마스터: 묘지+제외 서커스메어 12장 이상 + 5장 이동 트리거 */
function _checkPuppetMasterCondition() {
  const graveCircus = G.myGrave.filter(c => _isCircusmare(CARDS[c.id])).length;
  const exileCircus = G.myExile.filter(c => _isCircusmare(CARDS[c.id])).length;
  return (graveCircus + exileCircus) >= 12;
}

// ──────────────────────────────────────────────────────────
// 키카드 소환 UI: 조건 확인 후 키 카드 덱 선택 창 열기
// ──────────────────────────────────────────────────────────
function _openCircusKeyCardSummon(triggerCardName, conditionCheck) {
  const available = G.myKeyDeck.filter(c => {
    if (c.id === '서커스메어 스프링 제스터') return conditionCheck ? _checkSpringJesterCondition() : false;
    if (c.id === '서커스메어 메드 키메라')   return conditionCheck ? _checkMedChimeraCondition()  : false;
    if (c.id === '서커스메어 퍼핏 마스터')   return conditionCheck ? _checkPuppetMasterCondition(): false;
    // 코인 제스터/마스크 제스터는 상대 효과 발동 시만 소환 (별도 체인 처리)
    return false;
  });

  if (available.length === 0) {
    notify(`${triggerCardName}: 소환 가능한 키 카드가 없습니다. (조건 미충족)`);
    return;
  }
  openCardPicker(available, `${triggerCardName}: 키 카드 덱에서 소환`, 1, (sel) => {
    if (!sel.length) return;
    const target = available[sel[0]];
    _circusSummonKeyCard(target.id);
    _onCircusKeyCardSummoned(target.id);
    sendGameState(); renderAll();
  });
}

// 키카드 소환 직후 발동하는 ① 효과 처리
function _onCircusKeyCardSummoned(cardId) {
  if (cardId === '서커스메어 스프링 제스터') {
    // ①: 상대 필드 몬스터 전부 묘지 (불가항력)
    const removed = [];
    while (G.opField.length) {
      const mon = G.opField.pop();
      G.opGrave.push(mon);
      sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave', isTargeting: false });
      removed.push(mon.name);
    }
    if (removed.length) log(`스프링 제스터 ①: 상대 필드 전부 묘지 (${removed.join(', ')})`, 'mine');
  }

  if (cardId === '서커스메어 메드 키메라') {
    // ①: 자동으로 내 서커스메어 몬스터 보호 상태 적용 (플래그)
    G._circusMedChimeraActive = true;
    log('메드 키메라 ①: 서커스메어 몬스터 대상 불가/효과 묘지 불가 상태', 'mine');
    // 실제 보호는 효과 해결 시 검사하는 구조 (게임 엔진 통합 필요)
    notify('메드 키메라: 내 서커스메어 몬스터는 상대 효과의 대상이 되지 않고 효과로 묘지로 보내지지 않습니다.');
  }
}

// ──────────────────────────────────────────────────────────
// activateFromHand: 패에서 서커스메어 카드 발동
// ──────────────────────────────────────────────────────────
function activateCircusmareCard(handIdx, effectNum = 1) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!card) return;
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }

  const cardId = c.id;

  // ────── 악몽의 서커스장 (필드 카드 — activateCard에서 이미 처리됨) ──────
  // 필드 카드는 effects-theme.js의 activateCard에서 자동 처리

  // ────── 서커스메어 메드 울프 ──────
  if (cardId === '서커스메어 메드 울프') {
    if (effectNum === 1) {
      // 소환 후 메드 베어 서치 (소환 자체는 필드에서 처리)
      const target = G.myDeck.find(d => d.id === '서커스메어 메드 베어');
      if (target) { searchToHand('서커스메어 메드 베어'); markEffectUsed(cardId, 1); }
      else notify('덱에 서커스메어 메드 베어가 없습니다.');
    } else if (effectNum === 2) {
      const targets = G.myField.filter(f => f.id !== cardId && _isCircusmare(CARDS[f.id]));
      if (!targets.length) { notify('대상 서커스메어 몬스터가 없습니다.'); return; }
      openCardPicker(targets, '메드 울프 ②: 공격력 +3', 1, (sel) => {
        if (!sel.length) return;
        const t = G.myField.find(f => f.id === targets[sel[0]].id);
        if (t) { t.atk = (t.atk || 0) + 3; log(`메드 울프 ②: ${t.name} 공격력 +3 → ${t.atk}`, 'mine'); }
        markEffectUsed(cardId, 2); sendGameState(); renderAll();
      });
    }
    return;
  }

  // ────── 서커스메어 메드 베어 ──────
  if (cardId === '서커스메어 메드 베어') {
    if (effectNum === 1) {
      const target = G.myDeck.find(d => d.id === '서커스메어 메드 이글');
      if (target) { searchToHand('서커스메어 메드 이글'); markEffectUsed(cardId, 1); }
      else notify('덱에 서커스메어 메드 이글이 없습니다.');
    } else if (effectNum === 2) {
      const targets = G.myDeck.filter(d => _isCircusmare(CARDS[d.id]) && CARDS[d.id]?.cardType === 'monster');
      if (!targets.length) { notify('덱에 서커스메어 몬스터가 없습니다.'); return; }
      openCardPicker(targets, '메드 베어 ②: 덱에서 소환', 1, (sel) => {
        if (!sel.length) return;
        summonFromDeck(targets[sel[0]].id);
        markEffectUsed(cardId, 2); sendGameState(); renderAll();
      });
    }
    return;
  }

  // ────── 서커스메어 메드 이글 ──────
  if (cardId === '서커스메어 메드 이글') {
    if (effectNum === 1) {
      const target = G.myDeck.find(d => d.id === '서커스메어 메드 씰');
      if (target) { searchToHand('서커스메어 메드 씰'); markEffectUsed(cardId, 1); }
      else notify('덱에 서커스메어 메드 씰이 없습니다.');
    } else if (effectNum === 2) {
      // 묘지에서 서커스메어 몬스터 2장까지 소환
      const targets = G.myGrave.filter(g => _isCircusmare(CARDS[g.id]) && CARDS[g.id]?.cardType === 'monster');
      if (!targets.length) { notify('묘지에 서커스메어 몬스터가 없습니다.'); return; }
      openCardPicker(targets, '메드 이글 ②: 묘지에서 소환 (최대 2장)', Math.min(2, targets.length), (sel) => {
        sel.map(i => targets[i]?.id).filter(Boolean).forEach(id => summonFromGrave(id));
        markEffectUsed(cardId, 2); sendGameState(); renderAll();
      });
    }
    return;
  }

  // ────── 서커스메어 메드 씰 ──────
  if (cardId === '서커스메어 메드 씰') {
    if (effectNum === 1) {
      const target = G.myDeck.find(d => d.id === '서커스메어 메드 울프');
      if (target) { searchToHand('서커스메어 메드 울프'); markEffectUsed(cardId, 1); }
      else notify('덱에 서커스메어 메드 울프가 없습니다.');
    } else if (effectNum === 2) {
      // 공개 패에 넣어졌을 때: 패의 서커스메어 몬스터 최대 3장 소환
      const targets = G.myHand.filter(h => h.id !== cardId && _isCircusmare(CARDS[h.id]) && CARDS[h.id]?.cardType === 'monster');
      if (!targets.length) { notify('패에 소환할 서커스메어 몬스터가 없습니다.'); return; }
      openCardPicker(targets, '메드 씰 ②: 패에서 소환 (최대 3장)', Math.min(3, targets.length), (sel) => {
        // 뒤에서부터 splice해 인덱스 오염 방지
        const ids = sel.map(i => targets[i]?.id).filter(Boolean);
        ids.forEach(id => {
          const hi = G.myHand.findIndex(h => h.id === id);
          if (hi >= 0) {
            const mon = G.myHand.splice(hi, 1)[0];
            const mCard = CARDS[mon.id] || {};
            G.myField.push({ id: mon.id, name: mon.name, atk: mCard.atk ?? 0, atkBase: mCard.atk ?? 0 });
            log(`메드 씰 ②: ${mon.name} 패→소환`, 'mine');
            sendAction({ type: 'summon', cardId: mon.id });
          }
        });
        markEffectUsed(cardId, 2); sendGameState(); renderAll();
      });
    }
    return;
  }

  // ────── 서커스메어 크라운 드래곤 ──────
  if (cardId === '서커스메어 크라운 드래곤') {
    if (effectNum === 1) {
      const heads = _circusCoinToss(1, '크라운 드래곤 ①');
      if (heads) {
        // 앞면: 상대 패 3장 버리기
        sendAction({ type: 'opDiscardRandom', count: 3, reason: '크라운 드래곤 ① 앞면' });
        if (window._discardOpponentHandRandomly) _discardOpponentHandRandomly(3, '크라운 드래곤 ① 앞면');
        log('크라운 드래곤 ①: 앞면 — 상대 패 3장 버리기', 'mine');
      } else {
        // 뒷면: 내 필드 몬스터 전체 공격력 +3
        G.myField.forEach(m => { m.atk = (m.atk || 0) + 3; });
        log('크라운 드래곤 ①: 뒷면 — 내 필드 몬스터 전체 공격력 +3', 'mine');
      }
      markEffectUsed(cardId, 1); sendGameState(); renderAll();
    } else if (effectNum === 3) {
      // ③: 패/덱/묘지/제외에서 서커스메어 몬스터 최대한 소환
      _circusSummonAllCircusmareMonsters('크라운 드래곤 ③');
      markEffectUsed(cardId, 3);
    }
    return;
  }

  // ────── 서커스메어 퓨전 (마법) ──────
  if (cardId === '서커스메어 퓨전') {
    if (effectNum === 1) {
      // 키 카드 덱 선택 → 조건에 맞는 패/필드 서커스메어 묘지 → 키카드 소환
      const keyOptions = G.myKeyDeck.filter(k => !['서커스메어 코인 제스터','서커스메어 마스크 제스터'].includes(k.id));
      if (!keyOptions.length) { notify('서커스메어 퓨전: 소환 가능한 키 카드가 없습니다.'); return; }
      openCardPicker(keyOptions, '서커스메어 퓨전 ①: 소환할 키 카드 선택', 1, (kSel) => {
        if (!kSel.length) return;
        const keyCard = keyOptions[kSel[0]];
        const costPool = [
          ...G.myHand.filter(h => _isCircusmare(CARDS[h.id])),
          ...G.myField.filter(f => _isCircusmare(CARDS[f.id])),
        ];
        if (!costPool.length) { notify('서커스메어 퓨전: 코스트로 보낼 서커스메어 카드가 없습니다.'); return; }
        openCardPicker(costPool, `${keyCard.name} 소환 코스트: 묘지로 보낼 서커스메어 선택`, 3, (cSel) => {
          cSel.map(i => costPool[i]).filter(Boolean).forEach(target => {
            const hi = G.myHand.findIndex(h => h.id === target.id);
            if (hi >= 0) { G.myGrave.push(G.myHand.splice(hi, 1)[0]); return; }
            const fi = G.myField.findIndex(f => f.id === target.id);
            if (fi >= 0) { G.myGrave.push(G.myField.splice(fi, 1)[0]); sendAction({ type: 'myFieldRemove', cardId: target.id, to: 'grave' }); }
          });
          _circusSummonKeyCard(keyCard.id);
          _onCircusKeyCardSummoned(keyCard.id);
          G.myHand.splice(handIdx, 1);
          log(`서커스메어 퓨전 ①: ${keyCard.name} 소환`, 'mine');
          markEffectUsed(cardId, 1); sendGameState(); renderAll();
        });
      });
    } else if (effectNum === 2) {
      // ②: 묘지의 서커스메어 3장 제외 → 이 카드를 묘지에서 패로
      const graveCircus = G.myGrave.filter(g => _isCircusmare(CARDS[g.id]));
      if (graveCircus.length < 3) { notify('묘지에 서커스메어 몬스터가 3장 이상 필요합니다.'); return; }
      openCardPicker(graveCircus, '서커스메어 퓨전 ②: 제외할 서커스메어 3장', 3, (sel) => {
        if (sel.length < 3) { notify('3장을 선택해야 합니다.'); return; }
        sel.map(i => graveCircus[i]).filter(Boolean).forEach(target => {
          const gi = G.myGrave.findIndex(g => g.id === target.id);
          if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
        });
        // 묘지의 이 카드를 패로 (이미 패에 있으면 무시)
        const gf = G.myGrave.findIndex(g => g.id === cardId);
        if (gf >= 0) {
          const recovered = G.myGrave.splice(gf, 1)[0];
          G.myHand.push({ id: recovered.id, name: recovered.name });
          log('서커스메어 퓨전 ②: 묘지→패 회수', 'mine');
        }
        markEffectUsed(cardId, 2); sendGameState(); renderAll();
      });
    }
    return;
  }

  // ────── 서커스메어 메드 퍼레이드 (일반) ──────
  if (cardId === '서커스메어 메드 퍼레이드') {
    if (effectNum === 1) {
      // 패/덱/필드/묘지의 메드 4종 각 1장씩 제외 → 메드 키메라 소환
      const allZones = [
        ...G.myHand, ...G.myDeck, ...G.myField, ...G.myGrave
      ];
      const hasFour = [...CIRCUSMARE_MED_SET].every(id => allZones.some(c => c.id === id));
      if (!hasFour) { notify('메드 퍼레이드: 메드 4종을 각 1장씩 준비하세요.'); return; }

      // 각 메드 카드 한 장씩 제외 (패 → 덱 → 필드 → 묘지 우선순위)
      const _exileOneMed = (targetId) => {
        let idx = G.myHand.findIndex(c => c.id === targetId);
        if (idx >= 0) { G.myExile.push(G.myHand.splice(idx, 1)[0]); return; }
        idx = G.myDeck.findIndex(c => c.id === targetId);
        if (idx >= 0) { G.myExile.push(G.myDeck.splice(idx, 1)[0]); return; }
        idx = G.myField.findIndex(c => c.id === targetId);
        if (idx >= 0) { G.myExile.push(G.myField.splice(idx, 1)[0]); sendAction({ type: 'myFieldRemove', cardId: targetId, to: 'exile' }); return; }
        idx = G.myGrave.findIndex(c => c.id === targetId);
        if (idx >= 0) G.myExile.push(G.myGrave.splice(idx, 1)[0]);
      };
      [...CIRCUSMARE_MED_SET].forEach(_exileOneMed);

      // 메드 키메라 키카드 소환
      if (_circusSummonKeyCard('서커스메어 메드 키메라')) {
        _onCircusKeyCardSummoned('서커스메어 메드 키메라');
      }
      G.myHand.splice(handIdx, 1);
      log('메드 퍼레이드 ①: 메드 4종 제외 → 메드 키메라 소환', 'mine');
      markEffectUsed(cardId, 1); sendGameState(); renderAll();
    }
    return;
  }

  // ────── 악몽 융합 (일반, 게임 중 2번) ──────
  if (cardId === '악몽 융합') {
    if (effectNum === 1) {
      // 키 카드 덱 선택 → 덱의 서커스메어 묘지 → 키카드 소환
      const keyOptions = G.myKeyDeck;
      if (!keyOptions.length) { notify('악몽 융합: 키 카드 덱이 비어있습니다.'); return; }
      openCardPicker(keyOptions, '악몽 융합 ①: 소환할 키 카드 선택', 1, (kSel) => {
        if (!kSel.length) return;
        const keyCard = keyOptions[kSel[0]];
        const deckCircus = G.myDeck.filter(d => _isCircusmare(CARDS[d.id]));
        if (!deckCircus.length) { notify('악몽 융합: 덱에 서커스메어 카드가 없습니다.'); return; }
        openCardPicker(deckCircus, `${keyCard.name} 소환 코스트: 덱에서 묘지로 보낼 서커스메어 선택`, 3, (cSel) => {
          cSel.map(i => deckCircus[i]).filter(Boolean).forEach(target => {
            const di = G.myDeck.findIndex(d => d.id === target.id);
            if (di >= 0) G.myGrave.push(G.myDeck.splice(di, 1)[0]);
          });
          _circusSummonKeyCard(keyCard.id);
          _onCircusKeyCardSummoned(keyCard.id);
          G.myHand.splice(handIdx, 1);
          log(`악몽 융합 ①: ${keyCard.name} 소환`, 'mine');
          // 게임 중 2번 제한 (간이 카운터)
          if (!window._nightmareFusionCount) window._nightmareFusionCount = 0;
          window._nightmareFusionCount++;
          sendGameState(); renderAll();
        });
      });
    }
    return;
  }

  // ────── 광란의 서커스 (함정) ──────
  if (cardId === '광란의 서커스') {
    if (effectNum === 1) {
      // 키 카드 선택 → 묘지/제외 서커스메어를 덱으로 되돌림 → 키카드 소환
      const keyOptions = G.myKeyDeck;
      if (!keyOptions.length) { notify('광란의 서커스: 키 카드 덱이 비어있습니다.'); return; }
      openCardPicker(keyOptions, '광란의 서커스 ①: 소환할 키 카드 선택', 1, (kSel) => {
        if (!kSel.length) return;
        const keyCard = keyOptions[kSel[0]];
        const costPool = [
          ...G.myGrave.filter(g => _isCircusmare(CARDS[g.id])),
          ...G.myExile.filter(e => _isCircusmare(CARDS[e.id])),
        ];
        if (!costPool.length) { notify('광란의 서커스: 묘지/제외에 서커스메어 카드가 없습니다.'); return; }
        openCardPicker(costPool, `${keyCard.name} 소환 코스트: 덱으로 되돌릴 서커스메어 선택`, 3, (cSel) => {
          cSel.map(i => costPool[i]).filter(Boolean).forEach(target => {
            let ri = G.myGrave.findIndex(g => g.id === target.id);
            if (ri >= 0) { G.myDeck.push(G.myGrave.splice(ri, 1)[0]); return; }
            ri = G.myExile.findIndex(e => e.id === target.id);
            if (ri >= 0) G.myDeck.push(G.myExile.splice(ri, 1)[0]);
          });
          _circusSummonKeyCard(keyCard.id);
          _onCircusKeyCardSummoned(keyCard.id);
          G.myHand.splice(handIdx, 1);
          log(`광란의 서커스 ①: ${keyCard.name} 소환`, 'mine');
          markEffectUsed(cardId, 1); sendGameState(); renderAll();
        });
      });
    } else if (effectNum === 2) {
      // ②: 묘지의 이 카드 제외 → 1장 드로우 (묘지 발동)
      const gi = G.myGrave.findIndex(g => g.id === cardId);
      if (gi < 0) { notify('광란의 서커스: 묘지에 없습니다.'); return; }
      G.myExile.push(G.myGrave.splice(gi, 1)[0]);
      drawN(1);
      log('광란의 서커스 ②: 묘지 제외 → 1장 드로우', 'mine');
      sendGameState(); renderAll();
    }
    return;
  }

  // ────── 스프링 제스터, 메드 키메라, 퍼핏 마스터 (필드 발동 효과) ──────
  // 이 카드들은 필드에서 효과를 발동하므로 activateFieldMonsterEffect에서 처리

  // ────── 폴백: 범용 처리 ──────
  activateThemeCardEffectFromHand(handIdx, effectNum);
}

// ──────────────────────────────────────────────────────────
// 필드 몬스터 효과 발동: 서커스메어 필드 몬스터 우클릭/버튼 시
// ──────────────────────────────────────────────────────────
function activateCircusmareFieldEffect(fieldIdx, effectNum) {
  const c = G.myField[fieldIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!card || !_isCircusmare(card)) return;
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }

  const cardId = c.id;

  // ──── 스프링 제스터 필드 효과 ────
  if (cardId === '서커스메어 스프링 제스터') {
    if (effectNum === 2) {
      // ②: 공격력이 묘지 서커스메어 수만큼 올라가는 지속 효과 → 수동 재계산
      const graveCount = G.myGrave.filter(g => _isCircusmare(CARDS[g.id])).length;
      const baseAtk = CARDS[cardId]?.atk ?? 5;
      c.atk = baseAtk + graveCount;
      log(`스프링 제스터 ②: 공격력 → ${c.atk} (묘지 서커스메어 ${graveCount}장)`, 'mine');
      markEffectUsed(cardId, 2); sendGameState(); renderAll();
    } else if (effectNum === 3) {
      // ③: 묘지로 보내졌을 경우 → 크라운 드래곤 소환 (묘지 유발이므로 onSummoned에서 처리)
      notify('스프링 제스터 ③: 이 카드가 묘지로 보내졌을 때 자동 발동됩니다.');
    }
    return;
  }

  // ──── 메드 키메라 필드 효과 ────
  if (cardId === '서커스메어 메드 키메라') {
    if (effectNum === 2) {
      // ②: 내 서커스메어 1장을 대상 → 공격력만큼 이 카드 공격력 올리기
      const targets = G.myField.filter(f => f.id !== cardId && _isCircusmare(CARDS[f.id]));
      if (!targets.length) { notify('대상 서커스메어 몬스터가 없습니다.'); return; }
      openCardPicker(targets, '메드 키메라 ②: 대상 서커스메어 선택', 1, (sel) => {
        if (!sel.length) return;
        const t = targets[sel[0]];
        const gain = CARDS[t.id]?.atk ?? t.atk ?? 0;
        c.atk = (c.atk || 0) + gain;
        log(`메드 키메라 ②: ${t.name}의 원래 공격력(${gain})만큼 공격력 상승 → ${c.atk}`, 'mine');
        markEffectUsed(cardId, 2); sendGameState(); renderAll();
      });
    }
    return;
  }

  // ──── 퍼핏 마스터 필드 효과 ────
  if (cardId === '서커스메어 퍼핏 마스터') {
    if (effectNum === 1) {
      const myFieldMonsters = G.myField.filter(f => CARDS[f.id]?.cardType === 'monster');
      if (!myFieldMonsters.length) { notify('필드에 몬스터가 없습니다.'); return; }
      openCardPicker(myFieldMonsters, '퍼핏 마스터 ①: 묘지로 보낼 몬스터 선택 (원하는 수)', myFieldMonsters.length, (sel) => {
        if (!sel.length) return;
        const chosen = sel.map(i => myFieldMonsters[i]).filter(Boolean);
        chosen.forEach(target => {
          const fi = G.myField.findIndex(f => f.id === target.id);
          if (fi >= 0) {
            G.myGrave.push(G.myField.splice(fi, 1)[0]);
            sendAction({ type: 'myFieldRemove', cardId: target.id, to: 'grave' });
          }
        });
        const count = chosen.length;
        log(`퍼핏 마스터 ①: ${count}장 묘지로 전송`, 'mine');

        // 효과 적용
        if (count >= 1) {
          sendAction({ type: 'opDiscardRandom', count: 1, reason: '퍼핏 마스터 ①' });
          if (window._discardOpponentHandRandomly) _discardOpponentHandRandomly(1, '퍼핏 마스터 ①');
          log('퍼핏 마스터 ①: 상대 패 무작위 1장 버리기', 'mine');
        }
        if (count >= 3) {
          // 키카드 덱 선택 → 조건부 소환
          const keyOpts = G.myKeyDeck;
          if (keyOpts.length) {
            openCardPicker(keyOpts, '퍼핏 마스터 ①(3장): 소환할 키 카드', 1, (kSel) => {
              if (!kSel.length) return;
              const keyCard = keyOpts[kSel[0]];
              // 소환 조건에 맞는 상대 필드 몬스터를 덱으로
              const opTargets = G.opField.filter(f => CARDS[f.id]?.cardType === 'monster');
              if (opTargets.length) {
                openCardPicker(opTargets, `${keyCard.name} 소환: 덱으로 되돌릴 상대 몬스터`, 1, (oSel) => {
                  if (oSel.length) {
                    const mon = G.opField.splice(oSel[0], 1)[0];
                    // 상대 덱으로 되돌리기 (sendAction으로 통보)
                    sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'deck' });
                    log(`퍼핏 마스터 ①: ${mon.name} → 덱으로`, 'mine');
                  }
                  _circusSummonKeyCard(keyCard.id);
                  _onCircusKeyCardSummoned(keyCard.id);
                  sendGameState(); renderAll();
                });
              } else {
                _circusSummonKeyCard(keyCard.id);
                _onCircusKeyCardSummoned(keyCard.id);
                sendGameState(); renderAll();
              }
            });
          }
        }
        if (count >= 5) {
          // 상대 필드/묘지 전부 제외
          const opAll = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
          while (G.opField.length) {
            const mon = G.opField.pop();
            G.opExile.push(mon);
            sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile' });
          }
          if (G.opFieldCard) {
            G.opExile.push(G.opFieldCard);
            sendAction({ type: 'opFieldCardRemove', cardId: G.opFieldCard.id, to: 'exile' });
            G.opFieldCard = null;
          }
          // 상대 묘지 제외 (sendAction으로 통보)
          const opGraveCount = G.opGrave.length;
          G.opGrave = [];
          if (opGraveCount > 0) sendAction({ type: 'opGraveClear', to: 'exile', count: opGraveCount });
          log('퍼핏 마스터 ①(5장): 상대 필드/묘지 전부 제외', 'mine');
        }

        markEffectUsed(cardId, 1); sendGameState(); renderAll();
      }, false);
    }
    return;
  }

  // ──── 크라운 드래곤 필드 효과 ────
  if (cardId === '서커스메어 크라운 드래곤') {
    if (effectNum === 1) {
      const heads = _circusCoinToss(1, '크라운 드래곤 ①');
      if (heads) {
        sendAction({ type: 'opDiscardRandom', count: 3, reason: '크라운 드래곤 ① 앞면' });
        if (window._discardOpponentHandRandomly) _discardOpponentHandRandomly(3, '크라운 드래곤 ① 앞면');
        log('크라운 드래곤 ①: 앞면 — 상대 패 3장 버리기', 'mine');
      } else {
        G.myField.forEach(m => { m.atk = (m.atk || 0) + 3; });
        log('크라운 드래곤 ①: 뒷면 — 내 필드 몬스터 전체 공격력 +3', 'mine');
      }
      markEffectUsed(cardId, 1); sendGameState(); renderAll();
    } else if (effectNum === 3) {
      _circusSummonAllCircusmareMonsters('크라운 드래곤 ③');
      markEffectUsed(cardId, 3);
    }
    return;
  }
}

// ──────────────────────────────────────────────────────────
// 묘지 유발 효과: 서커스메어 카드가 묘지로 보내졌을 때
// engine.js의 onCardSentToGrave 혹은 resolveGraveTrigger에서 호출 필요
// ──────────────────────────────────────────────────────────
function onCircusmareGraveTrigger(cardId) {
  const card = CARDS[cardId];
  if (!card || !_isCircusmare(card)) return;

  // 스프링 제스터 ③: 제외 후 크라운 드래곤 소환
  if (cardId === '서커스메어 스프링 제스터') {
    const gi = G.myGrave.findIndex(g => g.id === cardId);
    if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
    // 패/덱/묘지에서 크라운 드래곤 소환
    const inHand = G.myHand.findIndex(h => h.id === '서커스메어 크라운 드래곤');
    const inDeck = G.myDeck.findIndex(d => d.id === '서커스메어 크라운 드래곤');
    const inGrave = G.myGrave.findIndex(g => g.id === '서커스메어 크라운 드래곤');
    if (inHand >= 0) {
      const mon = G.myHand.splice(inHand, 1)[0];
      G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 8, atkBase: CARDS[mon.id]?.atk ?? 8 });
      log('스프링 제스터 ③: 패→크라운 드래곤 소환', 'mine');
    } else if (inDeck >= 0) {
      const mon = G.myDeck.splice(inDeck, 1)[0];
      G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 8, atkBase: CARDS[mon.id]?.atk ?? 8 });
      log('스프링 제스터 ③: 덱→크라운 드래곤 소환', 'mine');
    } else if (inGrave >= 0) {
      const mon = G.myGrave.splice(inGrave, 1)[0];
      G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 8, atkBase: CARDS[mon.id]?.atk ?? 8 });
      log('스프링 제스터 ③: 묘지→크라운 드래곤 소환', 'mine');
    }
    sendAction({ type: 'summon', cardId: '서커스메어 크라운 드래곤' });
    sendGameState(); renderAll();
    return;
  }

  // 메드 키메라 ③: 묘지/제외의 메드 4종 소환
  if (cardId === '서커스메어 메드 키메라') {
    G._circusMedChimeraActive = false;
    [...CIRCUSMARE_MED_SET].forEach(id => {
      let gi = G.myGrave.findIndex(g => g.id === id);
      if (gi >= 0) {
        const mon = G.myGrave.splice(gi, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 4, atkBase: CARDS[mon.id]?.atk ?? 4 });
        sendAction({ type: 'summon', cardId: mon.id });
        return;
      }
      let ei = G.myExile.findIndex(e => e.id === id);
      if (ei >= 0) {
        const mon = G.myExile.splice(ei, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 4, atkBase: CARDS[mon.id]?.atk ?? 4 });
        sendAction({ type: 'summon', cardId: mon.id });
      }
    });
    log('메드 키메라 ③: 묘지/제외 메드 4종 소환', 'mine');
    sendGameState(); renderAll();
    return;
  }

  // 크라운 드래곤 ③: 패/덱/묘지/제외 서커스메어 전부 소환
  if (cardId === '서커스메어 크라운 드래곤') {
    _circusSummonAllCircusmareMonsters('크라운 드래곤 ③ (묘지 유발)');
    return;
  }

  // 퍼핏 마스터 ②: 필드를 벗어났을 때 묘지의 서커스메어 몬스터 전부 소환
  if (cardId === '서커스메어 퍼핏 마스터') {
    const targets = G.myGrave.filter(g => g.id !== '서커스메어 퍼핏 마스터' && _isCircusmare(CARDS[g.id]) && CARDS[g.id]?.cardType === 'monster');
    targets.forEach(target => {
      const gi = G.myGrave.findIndex(g => g.id === target.id);
      if (gi >= 0) {
        const mon = G.myGrave.splice(gi, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
        sendAction({ type: 'summon', cardId: mon.id });
      }
    });
    log(`퍼핏 마스터 ②: 묘지 서커스메어 ${targets.length}장 소환`, 'mine');
    sendGameState(); renderAll();
  }
}

// ──────────────────────────────────────────────────────────
// 서커스메어 전체 소환 유틸
// ──────────────────────────────────────────────────────────
function _circusSummonAllCircusmareMonsters(label) {
  const allZones = [
    { zone: G.myHand, key: 'hand' },
    { zone: G.myDeck, key: 'deck' },
    { zone: G.myGrave, key: 'grave' },
    { zone: G.myExile, key: 'exile' },
  ];
  let count = 0;
  allZones.forEach(({ zone, key }) => {
    const toSummon = zone.filter(c => _isCircusmare(CARDS[c.id]) && CARDS[c.id]?.cardType === 'monster');
    toSummon.forEach(target => {
      const idx = zone.findIndex(c => c.id === target.id);
      if (idx >= 0) {
        const mon = zone.splice(idx, 1)[0];
        G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk ?? 0, atkBase: CARDS[mon.id]?.atk ?? 0 });
        sendAction({ type: 'summon', cardId: mon.id, from: key });
        count++;
      }
    });
  });
  log(`${label}: 서커스메어 몬스터 ${count}장 소환`, 'mine');
  sendGameState(); renderAll();
}

// ──────────────────────────────────────────────────────────
// resolveLink: 체인 해결
// ──────────────────────────────────────────────────────────
function resolveCircusmareEffect(link) {
  const { cardId, effectNum, mainText } = link;
  const card = CARDS[cardId];
  if (!card) return;

  // 범용 해결기로 처리 가능한 공통 효과는 위임
  resolveThemeEffectGeneric(link);
}

// ──────────────────────────────────────────────────────────
// 체인 체크: 코인 제스터 / 마스크 제스터 자동 소환 (상대 효과 발동 시)
// 기존 체인 시스템의 onOpponentEffect 훅 혹은 beginChain 진입 시 호출
// ──────────────────────────────────────────────────────────
function checkCircusmareChainSummon() {
  // 코인 제스터 / 마스크 제스터가 키카드 덱에 있을 경우 체인 발동 제안
  const jesters = G.myKeyDeck.filter(c =>
    c.id === '서커스메어 코인 제스터' || c.id === '서커스메어 마스크 제스터'
  );
  if (!jesters.length) return;

  jesters.forEach(jester => {
    const label = jester.id === '서커스메어 코인 제스터' ? '코인 제스터 ①' : '마스크 제스터 ①';
    // UI 확인 요청 (간이 confirm 방식)
    if (confirm(`${CARDS[jester.id]?.name}: 상대 효과에 체인해 소환하시겠습니까?`)) {
      _circusSummonKeyCard(jester.id);

      // 코인 제스터 소환 효과
      if (jester.id === '서커스메어 코인 제스터') {
        const heads = _circusCoinToss(3, '코인 제스터 ①');
        if (heads > 0) {
          // 앞면 수만큼 상대 필드/패 카드 선택해 묘지
          const opAll = [
            ...G.opField,
            ...(G.opFieldCard ? [G.opFieldCard] : []),
            ...G.opHand.map(h => ({ id: h.id, name: h.name || '(패)' })),
          ];
          const available = opAll.slice(0, heads);
          openCardPicker(available, `코인 제스터 ①: 묘지로 보낼 상대 카드 (최대 ${heads}장)`, heads, (sel) => {
            sel.map(i => available[i]).filter(Boolean).forEach(target => {
              const oi = G.opField.findIndex(f => f.id === target.id);
              if (oi >= 0) { G.opGrave.push(G.opField.splice(oi, 1)[0]); sendAction({ type: 'opFieldRemove', cardId: target.id, to: 'grave' }); return; }
              if (G.opFieldCard && G.opFieldCard.id === target.id) { G.opGrave.push(G.opFieldCard); G.opFieldCard = null; sendAction({ type: 'opFieldCardRemove', cardId: target.id, to: 'grave' }); return; }
              // 패 카드
              const hi = G.opHand.findIndex(h => h.id === target.id);
              if (hi >= 0) { G.opGrave.push(G.opHand.splice(hi, 1)[0]); sendAction({ type: 'opHandRemove', cardId: target.id }); }
            });
            if (heads === 3) {
              // 턴 종료까지 상대 효과 발동 불가 (플래그)
              G._circusCoinJesterLockActive = true;
              log('코인 제스터 ①: 3앞면 — 상대 턴 종료까지 효과 발동 불가', 'mine');
              notify('상대는 이번 턴 효과를 발동할 수 없습니다.');
            }
            sendGameState(); renderAll();
          });
        }
      }

      // 마스크 제스터 소환 효과
      if (jester.id === '서커스메어 마스크 제스터') {
        const heads = _circusCoinToss(3, '마스크 제스터 ①');
        const tails = 3 - heads;
        // 앞면 수만큼 덱→묘지
        if (heads > 0) {
          const deckCircus = G.myDeck.filter(d => _isCircusmare(CARDS[d.id]));
          const toMill = deckCircus.slice(0, heads);
          toMill.forEach(target => {
            const di = G.myDeck.findIndex(d => d.id === target.id);
            if (di >= 0) G.myGrave.push(G.myDeck.splice(di, 1)[0]);
          });
          log(`마스크 제스터 ①: 앞면 ${heads}장 — 덱 서커스메어 묘지`, 'mine');
        }
        // 뒷면 수만큼 묘지→패
        if (tails > 0) {
          const graveCircus = G.myGrave.filter(g => _isCircusmare(CARDS[g.id]));
          if (graveCircus.length > 0) {
            openCardPicker(graveCircus, `마스크 제스터 ①: 패에 넣을 서커스메어 (최대 ${tails}장)`, Math.min(tails, graveCircus.length), (sel) => {
              sel.map(i => graveCircus[i]).filter(Boolean).forEach(target => {
                const gi = G.myGrave.findIndex(g => g.id === target.id);
                if (gi >= 0) G.myHand.push(G.myGrave.splice(gi, 1)[0]);
              });
              sendGameState(); renderAll();
            });
          }
        }
      }

      sendGameState(); renderAll();
    }
  });
}

// ──────────────────────────────────────────────────────────
// 테마 핸들러 등록
// ──────────────────────────────────────────────────────────
registerThemeEffectHandler('서커스메어', {
  activateFromHand: activateCircusmareCard,
  resolveLink: resolveCircusmareEffect,
  onGraveTrigger: onCircusmareGraveTrigger,
  onOpponentEffect: checkCircusmareChainSummon,
});

// ──────────────────────────────────────────────────────────
// QUICK_THEMES / AUTO_THEMES 에 서커스메어 추가
// ──────────────────────────────────────────────────────────
(function _registerCircusmareAutoTheme() {
  function patch() {
    // theme-common.js가 정의하는 배열들은 IIFE 내부 지역변수라
    // 직접 접근이 불가능하므로, CARDS 기반 자동 등록 경로를 이용.
    // AUTO_THEMES 대신 THEME_EFFECT_HANDLERS 등록(위에서 완료)으로
    // activateRegisteredThemeCardEffect가 자동으로 서커스메어를 처리함.
    // 퀵효과 자동 등록은 registerChainHandResponse를 직접 호출.
    if (typeof registerChainHandResponse !== 'function') {
      setTimeout(patch, 100); return;
    }
    const QUICK_PATTERNS = [
      '자신/상대 턴에', '상대 턴에 발동할 수 있다',
      '상대턴에도 발동할 수 있다', '상대가 효과를 발동했을 때',
    ];
    Object.values(CARDS || {}).forEach(card => {
      if (card.theme !== '서커스메어') return;
      const effects = (card.effects || '').split('\n').filter(Boolean);
      const entries = [];
      [1, 2, 3].forEach(n => {
        const bullet = ['①','②','③'][n-1];
        const line = effects.find(l => l.startsWith(bullet));
        if (!line) return;
        if (!QUICK_PATTERNS.some(p => line.includes(p))) return;
        entries.push({
          effectNum: n,
          label: `${bullet} 퀵 효과 발동`,
          condition: () => (activeChainState?.active) || !isMyTurn,
          activate: (hi) => activateThemeCardEffectFromHand(hi, n),
        });
      });
      if (entries.length) registerChainHandResponse(card.id, entries);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ──────────────────────────────────────────────────────────
// resolveKeyFetch 패치: 서커스메어 키카드 패 가져오기 차단
// ──────────────────────────────────────────────────────────
(function _patchResolveKeyFetchCircusmare() {
  const NO_HAND_FETCH = new Set([
    '서커스메어 스프링 제스터', '서커스메어 메드 키메라',
    '서커스메어 코인 제스터', '서커스메어 마스크 제스터',
    '서커스메어 퍼핏 마스터',
  ]);
  function patch() {
    if (typeof resolveKeyFetch !== 'function') { setTimeout(patch, 100); return; }
    const _orig = resolveKeyFetch;
    resolveKeyFetch = function(cardId) {
      if (NO_HAND_FETCH.has(cardId)) {
        notify(`${CARDS[cardId]?.name || cardId}: 패로 가져올 수 없습니다. (소환 조건 충족 시 직접 소환)`);
        return;
      }
      return _orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ──────────────────────────────────────────────────────────
// 덱 프리셋 등록 + AI 풀 추가
// ──────────────────────────────────────────────────────────
(function _registerCircusmarePreset() {
  // STARTER_THEME_PRESETS에 추가 (AI _buildAIDeck이 자동으로 사용)
  if (!Array.isArray(window.STARTER_THEME_PRESETS))
    window.STARTER_THEME_PRESETS = [];
  if (!window.STARTER_THEME_PRESETS.includes('서커스메어'))
    window.STARTER_THEME_PRESETS.push('서커스메어');

  function patchPreset() {
    if (typeof loadPreset !== 'function') { setTimeout(patchPreset, 100); return; }
    const _orig = loadPreset;
    loadPreset = function(theme) {
      if (theme !== '서커스메어') return _orig.apply(this, arguments);

      builderMainDeck = {
        '서커스메어 메드 울프':      4,
        '서커스메어 메드 베어':      4,
        '서커스메어 메드 이글':      4,
        '서커스메어 메드 씰':        4,
        '서커스메어 크라운 드래곤':  4,
        '서커스메어 퓨전':           4,
        '서커스메어 메드 퍼레이드':  4,
        '악몽 융합':                 4,
        '광란의 서커스':             4,
        '악몽의 서커스장':           4,
        '구사일생':                  2,
        '눈에는 눈':                 2,
      };
      builderKeyDeck = {
        '서커스메어 스프링 제스터':  1,
        '서커스메어 메드 키메라':    1,
        '서커스메어 코인 제스터':    1,
        '서커스메어 마스크 제스터':  1,
        '서커스메어 퍼핏 마스터':    1,
        '일격필살':                  1,
        '단 한번의 기회':            1,
        '카드의 흑기사':             1,
      };
      notify('서커스메어 기본 덱 로드! (메인 40장)');
      if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
      if (typeof filterDeckPool === 'function' && typeof currentPoolFilter !== 'undefined')
        filterDeckPool(currentPoolFilter);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchPreset);
  } else {
    patchPreset();
  }
})();
