// jibaeja.js — 지배자/지배룡 테마 카드 효과 엔진
// 지배자/지배룡 엔진
// ─────────────────────────────────────────────

// 헬퍼
function isJibaeCard(id) { return id && (id.includes('지배자') || id.includes('지배룡')); }
function isJibaejaMonster(id) { return id && id.includes('지배자') && CARDS[id]?.cardType === 'monster'; }
function isJibaeryongMonster(id) { return id && id.includes('지배룡') && CARDS[id]?.cardType === 'monster'; }
// 지배자 카드 (몬스터 포함 전체): 지배자 이름을 가진 모든 카드
function isJibaejaCard(id) { return id && id.includes('지배자'); }
// 지배룡 카드 전체
function isJibaeryongCard(id) { return id && id.includes('지배룡'); }


// 키카드 몬스터 필드 존재 여부 (퀵 효과 조건)
// 카드 텍스트: "자신/상대 필드에 키 카드덱 몬스터가 존재할 경우 상대턴에도 발동할 수 있다"
function hasKeyCardMonsterOnField() {
  const allField = [...G.myField, ...G.opField];
  return allField.some(c => CARDS[c.id]?.isKeyCard && CARDS[c.id]?.cardType === 'monster');
}

// 사원소 소환 조건 체크
// 카드 텍스트: "자신 필드/묘지의 카드명이 다른 '지배룡'몬스터를 4장 제외했을 경우"
// → 필드+묘지+제외존에서 4종 이상 있어야 소환 가능
function canSummonSaWonsoJibaeryong() {
  const names = new Set();
  [...G.myField, ...G.myGrave, ...G.myExile].forEach(c => { if (isJibaeryongMonster(c.id)) names.add(c.id); });
  return names.size >= 4;
}
function canSummonSaWonsoJibaeja() {
  const names = new Set();
  [...G.myField, ...G.myGrave, ...G.myExile].forEach(c => { if (isJibaejaMonster(c.id)) names.add(c.id); });
  return names.size >= 4;
}

// 사원소의 기적 발동 여부 상태
let saWonsoMirakActive = false;
let saWonsoMirakType = null;
let saWonsoMirakUsed = false;

// 지배자/지배룡 효과 발동 시 기적 코스트 체크
function jibaeMirakCostIfNeeded(callback) {
  if (!saWonsoMirakActive) { callback(); return; }
  _forcedDiscardOne('사원소의 기적: 효과 발동 코스트 (패 1장 버리기, 필수)', callback);
}

// ═══════════════════════════════════════════════════
// 지배자 ① — 패에서 버리고 발동 (퀵/기동)
// ═══════════════════════════════════════════════════

// 수원소의 지배자 ①: 버리고 → 덱에서 지배자 몬스터 1장 서치 + 드로우 선택
// (자신/상대 필드에 키카드 몬스터가 있으면 상대 턴에도 가능)
function activateJibaejaShui1(handIdx) {
  const canQuick = isMyTurn || hasKeyCardMonsterOnField();
  if (!canQuick) { notify('키카드 몬스터가 없으면 자신 턴에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('수원소의 지배자', 1)) { notify('이미 사용했습니다.'); return; }
  // 코스트: 이 카드를 버리기 (체인 발동 전)
  const hi = G.myHand.findIndex(c => c.id === '수원소의 지배자');
  if (hi < 0) return;
  G.myGrave.push(G.myHand.splice(hi, 1)[0]);
  markEffectUsed('수원소의 지배자', 1);
  log('수원소의 지배자 ①: 자신을 버리고 발동', 'mine');
  jibaeMirakCostIfNeeded(() => {
    if (isMyTurn) activateIgnitionEffect({ type: 'jibaeShui1', label: '수원소의 지배자 ①' });
    else activateQuickEffect({ type: 'jibaeShui1', label: '수원소의 지배자 ①' });
  });
}
function resolveJibaeShui1() {
  const targets = findAllInDeck(c => isJibaejaMonster(c.id));
  if (targets.length === 0) { notify('덱에 지배자 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(targets, '수원소의 지배자 ①: 덱에서 지배자 몬스터 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    gameConfirm('1장 드로우하겠습니까?', (yes) => {
      if (yes) drawOne();
      sendGameState(); renderAll();
    });
  });
}

function activateJibaejaHwa1(handIdx) {
  const canQuick = isMyTurn || hasKeyCardMonsterOnField();
  if (!canQuick) { notify('키카드 몬스터가 없으면 자신 턴에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('화원소의 지배자', 1)) { notify('이미 사용했습니다.'); return; }
  const hi = G.myHand.findIndex(c => c.id === '화원소의 지배자');
  if (hi < 0) return;
  G.myGrave.push(G.myHand.splice(hi, 1)[0]);
  markEffectUsed('화원소의 지배자', 1);
  log('화원소의 지배자 ①: 자신을 버리고 발동', 'mine');
  jibaeMirakCostIfNeeded(() => {
    if (isMyTurn) activateIgnitionEffect({ type: 'jibaeHwa1', label: '화원소의 지배자 ①' });
    else activateQuickEffect({ type: 'jibaeHwa1', label: '화원소의 지배자 ①' });
  });
}
function resolveJibaeHwa1() {
  const targets = findAllInDeck(c => isJibaejaMonster(c.id));
  if (targets.length === 0) { notify('덱에 지배자 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(targets, '화원소의 지배자 ①: 덱에서 지배자 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
    gameConfirm('1장 드로우하겠습니까?', (yes) => {
      if (yes) drawOne();
      sendGameState(); renderAll();
    });
  });
}

function activateJibaejaJeon1(handIdx) {
  const canQuick = isMyTurn || hasKeyCardMonsterOnField();
  if (!canQuick) { notify('키카드 몬스터가 없으면 자신 턴에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('전원소의 지배자', 1)) { notify('이미 사용했습니다.'); return; }
  const hi = G.myHand.findIndex(c => c.id === '전원소의 지배자');
  if (hi < 0) return;
  G.myGrave.push(G.myHand.splice(hi, 1)[0]);
  markEffectUsed('전원소의 지배자', 1);
  log('전원소의 지배자 ①: 자신을 버리고 발동', 'mine');
  jibaeMirakCostIfNeeded(() => {
    if (isMyTurn) activateIgnitionEffect({ type: 'jibaeJeon1', label: '전원소의 지배자 ①' });
    else activateQuickEffect({ type: 'jibaeJeon1', label: '전원소의 지배자 ①' });
  });
}
function resolveJibaeJeon1() {
  const handTargets = G.myHand
    .filter(c => isJibaejaMonster(c.id) && c.id !== '전원소의 지배자')
    .map(c => ({ ...c, _from: 'hand' }));
  const graveTargets = G.myGrave
    .filter(c => isJibaejaMonster(c.id) && c.id !== '전원소의 지배자')
    .map(c => ({ ...c, _from: 'grave' }));
  const targets = [...handTargets, ...graveTargets];
  if (targets.length === 0) { notify('패/묘지에 다른 지배자 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(targets, '전원소의 지배자 ①: 패/묘지에서 지배자 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) {
      const t = targets[sel[0]];
      if (t._from === 'hand') {
        const idx = G.myHand.findIndex(c => c.id === t.id);
        if (idx >= 0) summonFromHand(idx);
      } else {
        summonFromGrave(t.id);
      }
    }
    gameConfirm('1장 드로우하겠습니까?', (yes) => {
      if (yes) drawOne();
      sendGameState(); renderAll();
    });
  });
}

function activateJibaejaFung1(handIdx) {
  const canQuick = isMyTurn || hasKeyCardMonsterOnField();
  if (!canQuick) { notify('키카드 몬스터가 없으면 자신 턴에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('풍원소의 지배자', 1)) { notify('이미 사용했습니다.'); return; }
  if (G.opGrave.length === 0) { notify('상대 묘지에 카드가 없습니다.'); return; }
  const hi = G.myHand.findIndex(c => c.id === '풍원소의 지배자');
  if (hi < 0) return;
  G.myGrave.push(G.myHand.splice(hi, 1)[0]);
  markEffectUsed('풍원소의 지배자', 1);
  log('풍원소의 지배자 ①: 자신을 버리고 발동', 'mine');
  jibaeMirakCostIfNeeded(() => {
    if (isMyTurn) activateIgnitionEffect({ type: 'jibaeFung1', label: '풍원소의 지배자 ①' });
    else activateQuickEffect({ type: 'jibaeFung1', label: '풍원소의 지배자 ①' });
  });
}
function resolveJibaeFung1() {
  if (G.opGrave.length === 0) { notify('상대 묘지에 카드가 없습니다.'); sendGameState(); renderAll(); return; }
  openCardPicker(G.opGrave, '풍원소의 지배자 ①: 상대 묘지 카드 1장 제외', 1, (sel) => {
    if (sel.length > 0) {
      const c = G.opGrave.splice(sel[0], 1)[0];
      G.opExile.push(c);
      log(`풍원소의 지배자 ①: 상대 묘지 ${c.name} 제외`, 'mine');
      sendAction({ type: 'opGraveExile', cardId: c.id });
    }
    drawOne();
    sendGameState(); renderAll();
  });
}

// 풍원소의 지배자 ②: 자신/상대 턴, 덱에서 지배룡 몬스터 1장 묘지 → 이 카드를 묘지에서 소환 + 드로우
function activateJibaejaFung2() {
  if (!canUseEffect('풍원소의 지배자', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.myGrave.some(c => c.id === '풍원소의 지배자')) { notify('묘지에 풍원소의 지배자가 없습니다.'); return; }
  const deckTargets = findAllInDeck(c => isJibaeryongMonster(c.id));
  if (deckTargets.length === 0) { notify('덱에 지배룡 몬스터가 없습니다.'); return; }
  markEffectUsed('풍원소의 지배자', 2);
  jibaeMirakCostIfNeeded(() => {
    openCardPicker(deckTargets, '풍원소의 지배자 ②: 덱에서 지배룡 몬스터 묘지로', 1, (sel) => {
      if (sel.length > 0) {
        const id = deckTargets[sel[0]].id;
        removeFromDeck(id);
        G.myGrave.push({ id, name: CARDS[id].name });
        log(`풍원소의 지배자 ②: ${CARDS[id].name} 덱→묘지`, 'mine');
        // 묘지로 보내진 지배룡 ① 트리거 (재귀 방지: 직접 호출)
        onSentToGraveFromNonHand(id);
      }
      // 이 카드를 묘지에서 소환
      summonFromGrave('풍원소의 지배자');
      // 드로우
      drawOne();
      sendGameState(); renderAll();
    });
  });
}

// ═══════════════════════════════════════════════════
// 지배자 ② — 필드 기동 효과
// ═══════════════════════════════════════════════════

// 수원소의 지배자 ②: 전개 단계 → 덱에서 지배자 몬스터 1장 소환
function activateJibaejaShui2(fieldIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('수원소의 지배자', 2)) { notify('이미 사용했습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    const targets = findAllInDeck(c => isJibaejaMonster(c.id));
    if (targets.length === 0) { notify('덱에 지배자 몬스터가 없습니다.'); return; }
    markEffectUsed('수원소의 지배자', 2);
    openCardPicker(targets, '수원소의 지배자 ②: 덱에서 지배자 몬스터 소환', 1, (sel) => {
      if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
      sendGameState(); renderAll();
    });
  });
}

// 화원소의 지배자 ②: 전개 단계 → 덱에서 지배자 몬스터 1장 서치 (패에 넣기)
function activateJibaejaHwa2(fieldIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('화원소의 지배자', 2)) { notify('이미 사용했습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    const targets = findAllInDeck(c => isJibaejaMonster(c.id));
    if (targets.length === 0) { notify('덱에 지배자 몬스터가 없습니다.'); return; }
    markEffectUsed('화원소의 지배자', 2);
    openCardPicker(targets, '화원소의 지배자 ②: 덱에서 지배자 몬스터 패에 넣기', 1, (sel) => {
      if (sel.length > 0) searchToHand(targets[sel[0]].id);
      sendGameState(); renderAll();
    });
  });
}

// 전원소의 지배자 ② 소환 유발: 소환됐을 경우 → 덱에서 지배자 카드 + 지배룡 카드 각 1장 서치 + 드로우 선택
function triggerJibaejaJeon2() {
  if (!canUseEffect('전원소의 지배자', 2)) return;
  gameConfirm('전원소의 지배자 ②\n덱에서 지배자 카드와 지배룡 카드를 각 1장씩 패에 넣고, 1장 드로우하겠습니까?', (yes) => {
    if (!yes) return;
    markEffectUsed('전원소의 지배자', 2);
    jibaeMirakCostIfNeeded(() => {
      // 지배자 카드 (몬스터/마법/함정 포함, 지배자 이름 가진 것)
      const jaTargets = findAllInDeck(c => isJibaejaCard(c.id));
      // 지배룡 카드 전체
      const ryongTargets = findAllInDeck(c => isJibaeryongCard(c.id));
      openCardPicker(jaTargets.length > 0 ? jaTargets : [{id:'none',name:'없음'}],
        '전원소의 지배자 ②: 지배자 카드 1장 서치', 1, (sel1) => {
        if (sel1.length > 0 && jaTargets[sel1[0]]?.id !== 'none') searchToHand(jaTargets[sel1[0]].id);
        openCardPicker(ryongTargets.length > 0 ? ryongTargets : [{id:'none',name:'없음'}],
          '전원소의 지배자 ②: 지배룡 카드 1장 서치', 1, (sel2) => {
          if (sel2.length > 0 && ryongTargets[sel2[0]]?.id !== 'none') searchToHand(ryongTargets[sel2[0]].id);
          gameConfirm('1장 드로우하겠습니까?', (drawYes) => {
            if (drawYes) drawOne();
            sendGameState(); renderAll();
          });
        });
      });
    });
  });
}

// ═══════════════════════════════════════════════════
// 지배자 ③ — 공통 (전개 단계, 덱에서 지배룡 소환 + 패 버리기)
// ═══════════════════════════════════════════════════
function activateJibaeja3(fieldIdx, cardId) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect(cardId, 3)) { notify('이미 사용했습니다.'); return; }
  const targets = findAllInDeck(c => isJibaeryongMonster(c.id));
  if (targets.length === 0) { notify('덱에 지배룡 몬스터가 없습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    markEffectUsed(cardId, 3);
    openCardPicker(targets, `${CARDS[cardId]?.name} ③: 덱에서 지배룡 몬스터 소환`, 1, (sel) => {
      if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
      // 소환 후 패 1장 버리기 (코스트)
      _forcedDiscardOne(`${CARDS[cardId]?.name} ③: 패 1장 버리기 (코스트)`, () => {
        sendGameState(); renderAll();
      });
    });
  });
}

// ═══════════════════════════════════════════════════
// 지배룡 ① — 패 이외에서 묘지로 보내졌을 경우 유발
// ═══════════════════════════════════════════════════
function onSentToGraveFromNonHand(cardId) {
  if (!isJibaeryongMonster(cardId)) return;
  if (!canUseEffect(cardId + '_grave1')) return;
  gameConfirm(`${CARDS[cardId]?.name} ①\n패 이외에서 묘지로 보내졌습니다. 효과를 발동합니까?`, (yes) => {
    if (!yes) return;
    markEffectUsed(cardId + '_grave1');
    jibaeMirakCostIfNeeded(() => {
      switch(cardId) {

        case '수원소의 지배룡':
          // 묘지에서 이 카드 이외의 지배자/지배룡 몬스터 1장 패에 넣기
          { const targets = G.myGrave.filter(c => (isJibaejaMonster(c.id) || isJibaeryongMonster(c.id)) && c.id !== '수원소의 지배룡');
            if (targets.length === 0) { notify('묘지에 해당 카드가 없습니다.'); sendGameState(); renderAll(); return; }
            openCardPicker(targets, '수원소의 지배룡 ①: 묘지에서 지배자/지배룡 몬스터 패에 넣기', 1, (sel) => {
              if (sel.length > 0) {
                const t = targets[sel[0]];
                const gi = G.myGrave.findIndex(c => c.id === t.id);
                if (gi >= 0) {
                  const card = G.myGrave.splice(gi, 1)[0];
                  G.myHand.push({ id: card.id, name: card.name, isPublic: true });
                  log(`수원소의 지배룡 ①: ${t.name} 묘지→공개패`, 'mine');
                }
              }
              sendGameState(); renderAll();
            });
          }
          break;

        case '화원소의 지배룡':
          // 상대 필드의 카드 1장을 골라 그 효과를 턴 종료 시까지 무효
          { const targets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
            if (targets.length === 0) { notify('상대 필드에 카드가 없습니다.'); sendGameState(); renderAll(); return; }
            openCardPicker(targets, '화원소의 지배룡 ①: 상대 필드 카드 효과 무효 (턴 종료까지)', 1, (sel) => {
              if (sel.length > 0) {
                const t = targets[sel[0]];
                log(`화원소의 지배룡 ①: ${t.name} 효과 무효 (턴 종료까지)`, 'mine');
                sendAction({ type: 'negateField', cardId: t.id, reason: '화원소의 지배룡 ①' });
              }
              sendGameState(); renderAll();
            });
          }
          break;

        case '전원소의 지배룡':
          // 자신은 2장 드로우
          drawN(2);
          log('전원소의 지배룡 ①: 2장 드로우', 'mine');
          sendGameState(); renderAll();
          break;

        case '풍원소의 지배룡':
          // 덱에서 지배룡 몬스터 2장 소환
          { const targets = findAllInDeck(c => isJibaeryongMonster(c.id));
            if (targets.length === 0) { notify('덱에 지배룡 몬스터가 없습니다.'); sendGameState(); renderAll(); return; }
            openCardPicker(targets, '풍원소의 지배룡 ①: 덱에서 지배룡 몬스터 2장 소환', Math.min(2, targets.length), (sel) => {
              // 선택한 순서대로 (중복 방지: 덱에서 하나씩 꺼내므로 첫 번째 제거 후 두 번째 탐색)
              const ids = sel.map(i => targets[i]?.id).filter(Boolean);
              ids.forEach(id => summonFromDeck(id));
              sendGameState(); renderAll();
            });
          }
          break;
      }
    });
  });
}

// ═══════════════════════════════════════════════════
// 지배룡 ② — 버려졌을 경우 드로우 유발
// ═══════════════════════════════════════════════════
function onJibaeryongDiscarded(cardId) {
  if (!isJibaeryongMonster(cardId)) return;
  if (!canUseEffect(cardId + '_discard2')) return;
  gameConfirm(`${CARDS[cardId]?.name} ②\n버려졌습니다. 1장 드로우합니까?`, (yes) => {
    if (!yes) return;
    markEffectUsed(cardId + '_discard2');
    jibaeMirakCostIfNeeded(() => {
      drawOne();
      sendGameState(); renderAll();
    });
  });
}

// ═══════════════════════════════════════════════════
// 지배룡 ③ — 필드에서 묘지로 → 패의 지배자 카드 버리고 드로우
// ═══════════════════════════════════════════════════
function activateJibaeryong3(fieldIdx, cardId) {
  if (!isMyTurn) { notify('자신 턴에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect(cardId, 3)) { notify('이미 사용했습니다.'); return; }
  const jibaejasInHand = G.myHand.filter(c => isJibaeCard(c.id));
  if (jibaejasInHand.length === 0) { notify('패에 지배자/지배룡 카드가 없습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    markEffectUsed(cardId, 3);
    // 필드에서 묘지로 (이 효과 코스트 — 지배룡① 트리거 안 됨)
    const fi = G.myField.findIndex(c => c.id === cardId);
    if (fi >= 0) G.myGrave.push(G.myField.splice(fi, 1)[0]);
    openCardPicker(jibaejasInHand, `${CARDS[cardId]?.name} ③: 패의 지배자 카드 버리기 (코스트)`, 1, (sel) => {
      if (sel.length > 0) {
        const hi = G.myHand.findIndex(c => c.id === jibaejasInHand[sel[0]].id);
        if (hi >= 0) {
          const discarded = G.myHand.splice(hi, 1)[0];
          G.myGrave.push(discarded);
          log(`${CARDS[cardId]?.name} ③: ${discarded.name} 버림`, 'mine');
          // 버려진 카드가 지배룡이면 ② 트리거
          onJibaeryongDiscarded(discarded.id);
          // 지배의 사슬 ① 트리거
          onHandDiscarded_jibaeSasl();
        }
      }
      drawOne();
      sendGameState(); renderAll();
    });
  });
}

// ═══════════════════════════════════════════════════
// 사원소의 지배룡 효과
// ═══════════════════════════════════════════════════

// 사원소의 지배룡 ①: 전개 단계 → 덱에서 지배자 몬스터 2장 패에 넣고, 원하는만큼 버리기
function activateSaWonsoJibaeryong1(fieldIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('사원소의 지배룡', 1)) { notify('이미 사용했습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    const targets = findAllInDeck(c => isJibaejaMonster(c.id));
    if (targets.length === 0) { notify('덱에 지배자 몬스터가 없습니다.'); return; }
    markEffectUsed('사원소의 지배룡', 1);
    openCardPicker(targets, '사원소의 지배룡 ①: 덱에서 지배자 몬스터 2장 패에 넣기', Math.min(2, targets.length), (sel) => {
      const ids = sel.map(i => targets[i]?.id).filter(Boolean);
      ids.forEach(id => searchToHand(id));
      _optionalMultiDiscard('사원소의 지배룡 ①: 패를 원하는만큼 버리기 (선택)', () => {
        sendGameState(); renderAll();
      });
    });
  });
}

// 사원소의 지배룡 ②: 자신/상대 공격 단계, 내 패 < 상대 패 → 차이만큼 ATK 상승
function activateSaWonsoJibaeryong2(fieldIdx) {
  if (currentPhase !== 'attack') { notify('공격 단계에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('사원소의 지배룡', 2)) { notify('이미 사용했습니다.'); return; }
  if (G.myHand.length >= G.opHand.length) { notify('자신 패가 상대 패보다 적을 경우에만 발동할 수 있습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    markEffectUsed('사원소의 지배룡', 2);
    const diff = G.opHand.length - G.myHand.length;
    const fi = G.myField.findIndex(c => c.id === '사원소의 지배룡');
    if (fi >= 0) {
      G.myField[fi].atk += diff;
      log(`사원소의 지배룡 ②: ATK +${diff} → ${G.myField[fi].atk}`, 'mine');
    }
    sendGameState(); renderAll();
  });
}

// 사원소의 지배룡 ③: 상대 효과 발동 시, 자신 패 5장 이하 → 효과 무효 + 패 2장 버리기 (동일 체인 1번)
function tryActivateSaWonsoJibaeryong3() {
  if (G.myHand.length > 5) return;
  if (!G.myField.some(c => c.id === '사원소의 지배룡')) return;
  if (!canUseEffect('사원소의 지배룡', 3)) return;
  gameConfirm('사원소의 지배룡 ③\n상대 효과를 무효로 하고 내 패 2장을 버리겠습니까?', (yes) => {
    if (!yes) return;
    markEffectUsed('사원소의 지배룡', 3);
    log('사원소의 지배룡 ③: 효과 무효!', 'mine');
    sendAction({ type: 'negate', reason: '사원소의 지배룡 ③' });
    _forcedDiscardOne('사원소의 지배룡 ③: 패 1장 버리기 (1/2)', () => {
      _forcedDiscardOne('사원소의 지배룡 ③: 패 1장 버리기 (2/2)', () => {
        sendGameState(); renderAll();
      });
    });
  });
}

// ═══════════════════════════════════════════════════
// 사원소의 지배자 효과
// ═══════════════════════════════════════════════════

// 사원소의 지배자 ①: 전개 단계 → 덱에서 지배룡 몬스터 2장 패에 넣고, 원하는만큼 버리기
function activateSaWonsoJibaeja1(fieldIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('사원소의 지배자', 1)) { notify('이미 사용했습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    const targets = findAllInDeck(c => isJibaeryongMonster(c.id));
    if (targets.length === 0) { notify('덱에 지배룡 몬스터가 없습니다.'); return; }
    markEffectUsed('사원소의 지배자', 1);
    openCardPicker(targets, '사원소의 지배자 ①: 덱에서 지배룡 몬스터 2장 패에 넣기', Math.min(2, targets.length), (sel) => {
      const ids = sel.map(i => targets[i]?.id).filter(Boolean);
      ids.forEach(id => searchToHand(id));
      _optionalMultiDiscard('사원소의 지배자 ①: 패를 원하는만큼 버리기 (선택)', () => {
        sendGameState(); renderAll();
      });
    });
  });
}

// 사원소의 지배자 ②: 자신/상대 턴 → 이 카드를 엔드 단계까지 제외, 묘지/제외의 지배자+지배룡 각 1장 소환
function activateSaWonsoJibaeja2(fieldIdx) {
  if (!canUseEffect('사원소의 지배자', 2)) { notify('이미 사용했습니다.'); return; }
  jibaeMirakCostIfNeeded(() => {
    markEffectUsed('사원소의 지배자', 2);
    // 이 카드를 엔드 단계까지 제외
    const fi = G.myField.findIndex(c => c.id === '사원소의 지배자');
    if (fi >= 0) {
      G.myExile.push(G.myField.splice(fi, 1)[0]);
      G.saWonsoJibaejaReturning = true;
      log('사원소의 지배자 ②: 엔드 단계까지 제외', 'mine');
    }
    // 묘지/제외에서 지배자 몬스터 소환 (이 카드 제외)
    const jaTargets = [...G.myGrave, ...G.myExile]
      .filter(c => isJibaejaMonster(c.id) && c.id !== '사원소의 지배자');
    const ryongTargets = [...G.myGrave, ...G.myExile]
      .filter(c => isJibaeryongMonster(c.id));
    openCardPicker(jaTargets, '사원소의 지배자 ②: 묘지/제외 지배자 몬스터 소환 (선택)', 1, (sel1) => {
      if (sel1.length > 0) {
        const t = jaTargets[sel1[0]];
        _removeFromGraveOrExile(t.id);
        const card = CARDS[t.id];
        G.myField.push({ id: t.id, name: card.name, atk: card.atk||0, atkBase: card.atk||0 });
        onSummon(t.id, 'grave');
      }
      openCardPicker(ryongTargets, '사원소의 지배자 ②: 묘지/제외 지배룡 몬스터 소환 (선택)', 1, (sel2) => {
        if (sel2.length > 0) {
          const t = ryongTargets[sel2[0]];
          _removeFromGraveOrExile(t.id);
          const card = CARDS[t.id];
          G.myField.push({ id: t.id, name: card.name, atk: card.atk||0, atkBase: card.atk||0 });
          onSummon(t.id, 'grave');
        }
        sendGameState(); renderAll();
      });
    });
  });
}

// 사원소의 지배자 ③: 자신/상대 전개 단계, 패 5장 이하 → 상대 필드 카드 1장 묘지 + 패 1장 버리기 (동일 체인 1번)
function tryActivateSaWonsoJibaeja3() {
  if (G.myHand.length > 5) return;
  if (!G.myField.some(c => c.id === '사원소의 지배자')) return;
  if (!canUseEffect('사원소의 지배자', 3)) return;
  if (currentPhase !== 'deploy') return;
  const opTargets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
  if (opTargets.length === 0) { return; } // 대상 없으면 발동 불가
  gameConfirm('사원소의 지배자 ③\n상대 필드 카드 1장을 묘지로 보내고, 내 패 1장을 버리겠습니까?', (yes) => {
    if (!yes) return;
    markEffectUsed('사원소의 지배자', 3);
    openCardPicker(opTargets, '사원소의 지배자 ③: 상대 필드 카드 1장 묘지로', 1, (sel) => {
      if (sel.length > 0) {
        const t = opTargets[sel[0]];
        const oi = G.opField.findIndex(c => c.id === t.id);
        if (oi >= 0) {
          G.opGrave.push(G.opField.splice(oi, 1)[0]);
          sendAction({ type: 'opFieldRemove', cardId: t.id, to: 'grave' });
          log(`사원소의 지배자 ③: ${t.name} 묘지로`, 'mine');
        } else if (G.opFieldCard && G.opFieldCard.id === t.id) {
          G.opGrave.push(G.opFieldCard);
          G.opFieldCard = null;
          sendAction({ type: 'opFieldCardRemove', cardId: t.id, to: 'grave' });
          log(`사원소의 지배자 ③: ${t.name} 묘지로`, 'mine');
        }
      }
      _forcedDiscardOne('사원소의 지배자 ③: 패 1장 버리기 (코스트)', () => {
        sendGameState(); renderAll();
      });
    });
  });
}

// ═══════════════════════════════════════════════════
// 사원소의 기적
// ═══════════════════════════════════════════════════
function activateSaWonsoMirak(handIdx) {
  if (saWonsoMirakUsed) { notify('사원소의 기적은 게임 중 1번밖에 발동할 수 없습니다.'); return; }
  if (G.myHand[handIdx]?.id !== '사원소의 기적') return;
  openCardPicker(
    [{ id: 'jibaeja', name: '①-A 지배자 4종 묘지로 (이 턴 지배자 효과 발동마다 패 1장 버리기)' },
     { id: 'jibaeryong', name: '①-B 지배룡 4종 묘지로 (이 턴 지배룡 효과 발동마다 패 1장 버리기)' }],
    '사원소의 기적: 효과 선택',
    1,
    (sel) => {
      if (sel.length === 0) return;
      const choice = sel[0] === 0 ? 'jibaeja' : 'jibaeryong';
      const filter = choice === 'jibaeja' ? isJibaejaMonster : isJibaeryongMonster;
      const deckTargets = findAllInDeck(c => filter(c.id));
      // 카드명이 다른 4종 추출
      const uniqueCards = [...new Map(deckTargets.map(c => [c.id, c])).values()];
      if (uniqueCards.length < 4) { notify('덱에 카드명이 다른 4종이 없습니다.'); return; }
      openCardPicker(uniqueCards, `사원소의 기적: 카드명이 다른 4종 선택해서 묘지로`, 4, (sel2) => {
        if (sel2.length < 4) { notify('4장을 선택해야 합니다.'); return; }
        const ids = sel2.map(i => uniqueCards[i]?.id).filter(Boolean);
        if (new Set(ids).size < 4) { notify('카드명이 다른 4종을 선택해야 합니다.'); return; }
        ids.forEach(id => {
          removeFromDeck(id);
          G.myGrave.push({ id, name: CARDS[id].name });
          onSentToGraveFromNonHand(id); // 지배룡이면 ① 트리거
        });
        saWonsoMirakUsed = true;
        saWonsoMirakActive = true;
        saWonsoMirakType = choice;
        G.myHand.splice(handIdx, 1);
        G.myGrave.push({ id: '사원소의 기적', name: '사원소의 기적' });
        log(`사원소의 기적: ${choice === 'jibaeja' ? '지배자' : '지배룡'} 4종 묘지로! 이 턴 효과 발동마다 패 1장 버리기`, 'mine');
        sendGameState(); renderAll();
      }, true);
    }
  );
}

// ═══════════════════════════════════════════════════
// 지배의 사슬
// ═══════════════════════════════════════════════════
let jibaeSaslTurnDiscardCount = 0;

// ①: 자신의 패가 버려졌을 경우 → 이 턴에 버려진 매수까지 드로우 (패에 있을 때)
function onHandDiscarded_jibaeSasl() {
  jibaeSaslTurnDiscardCount++;
  const idx = G.myHand.findIndex(c => c.id === '지배의 사슬');
  if (idx < 0) return;
  if (!canUseEffect('지배의 사슬', 1)) return;
  gameConfirm(`지배의 사슬 ①\n패가 버려졌습니다. 이 턴에 버려진 패의 매수(${jibaeSaslTurnDiscardCount}장)까지 드로우하겠습니까?`, (yes) => {
    if (!yes) return;
    markEffectUsed('지배의 사슬', 1);
    drawN(jibaeSaslTurnDiscardCount);
    log(`지배의 사슬 ①: ${jibaeSaslTurnDiscardCount}장 드로우`, 'mine');
    sendGameState(); renderAll();
  });
}

// ②: 상대 턴, 묘지의 이 카드를 제외 → 제외된 카드 8장까지 덱으로 + 드로우
function activateJibaeSasl2() {
  if (isMyTurn) { notify('상대 턴에만 발동할 수 있습니다.'); return; }
  const graveIdx = G.myGrave.findIndex(c => c.id === '지배의 사슬');
  if (graveIdx < 0) { notify('묘지에 지배의 사슬이 없습니다.'); return; }
  if (!canUseEffect('지배의 사슬', 2)) { notify('이미 사용했습니다.'); return; }
  if (G.myExile.length === 0) { notify('제외된 카드가 없습니다.'); return; }
  // 이 카드를 제외
  G.myExile.push(G.myGrave.splice(graveIdx, 1)[0]);
  markEffectUsed('지배의 사슬', 2);
  const maxReturn = Math.min(8, G.myExile.length);
  openCardPicker([...G.myExile], `지배의 사슬 ②: 제외 카드 최대 8장 덱으로`, maxReturn, (sel) => {
    sel.sort((a,b) => b-a).forEach(i => {
      if (G.myExile[i]) G.myDeck.push(G.myExile.splice(i, 1)[0]);
    });
    G.myDeck = shuffle(G.myDeck);
    log(`지배의 사슬 ②: 제외 ${sel.length}장 덱으로 복귀 + 드로우`, 'mine');
    drawOne();
    sendGameState(); renderAll();
  });
}

// ═══════════════════════════════════════════════════
// 지배룡과 지배자
// ═══════════════════════════════════════════════════

// ①: 자신/상대 공격 단계 → 자신 패의 수에 따라 누적 효과 (5장 이하부터 단계별 추가)
function activateJibaeryongJibaeja1(handIdx) {
  if (currentPhase !== 'attack') { notify('공격 단계에만 발동할 수 있습니다.'); return; }
  if (!canUseEffect('지배룡과 지배자', 1)) { notify('이미 사용했습니다.'); return; }
  // 발동 전 현재 패 수 (이 카드 포함)
  const handCountBeforeDiscard = G.myHand.length;
  // 이 카드를 버려서 발동
  G.myHand.splice(handIdx, 1);
  G.myGrave.push({ id: '지배룡과 지배자', name: '지배룡과 지배자' });
  // 발동 후 남은 패 수 기준으로 효과 판정
  const handCount = G.myHand.length;
  markEffectUsed('지배룡과 지배자', 1);
  log(`지배룡과 지배자 ①: 현재 패 ${handCount}장 기준 효과 적용`, 'mine');

  if (handCount > 5) {
    notify('패가 5장 초과 — 효과 없음');
    sendGameState(); renderAll();
    return;
  }

  // 효과는 조건 만족하는 것 전부 순서대로 적용 (누적)
  // 5장 이하: 자신 필드 몬스터 1장 ATK+2
  // 4장 이하: 자신 필드 몬스터 전원 ATK+1 (위와 누적)
  // 3장 이하: 상대 필드 몬스터 1장 ATK-3 (위와 누적)
  // 2장 이하: 이번 공격 단계 동안 자신 몬스터 보호 (위와 누적)

  const applyStep3 = (cb) => {
    if (handCount <= 3 && G.opField.length > 0) {
      openCardPicker(G.opField, '지배룡과 지배자 ①: 상대 몬스터 1장 ATK-3', 1, (sel2) => {
        if (sel2.length > 0) {
          G.opField[sel2[0]].atk -= 3;
          log(`지배룡과 지배자 ①: 상대 ${G.opField[sel2[0]].name} ATK-3 → ${G.opField[sel2[0]].atk}`, 'mine');
          sendAction({ type: 'opAtkChange', fieldIdx: sel2[0], delta: -3 });
        }
        cb();
      });
    } else {
      cb();
    }
  };

  const applyStep2and3 = (cb) => {
    if (handCount <= 4 && G.myField.length > 0) {
      G.myField.forEach(c => { c.atk += 1; });
      log('지배룡과 지배자 ①: 자신 필드 전원 ATK+1', 'mine');
    }
    applyStep3(cb);
  };

  if (handCount <= 5 && G.myField.length > 0) {
    openCardPicker(G.myField, '지배룡과 지배자 ①: 자신 몬스터 1장 ATK+2', 1, (sel) => {
      if (sel.length > 0) {
        G.myField[sel[0]].atk += 2;
        log(`지배룡과 지배자 ①: ${G.myField[sel[0]].name} ATK+2 → ${G.myField[sel[0]].atk}`, 'mine');
      }
      applyStep2and3(() => {
        if (handCount <= 2) {
          G.attackPhaseProtected = true;
          log('지배룡과 지배자 ①: 이번 공격 단계 자신 몬스터 보호', 'mine');
        }
        sendGameState(); renderAll();
      });
    });
  } else {
    // 필드에 몬스터 없어도 4장 이하 효과는 적용 가능
    applyStep2and3(() => {
      if (handCount <= 2) {
        G.attackPhaseProtected = true;
        log('지배룡과 지배자 ①: 이번 공격 단계 자신 몬스터 보호', 'mine');
      }
      sendGameState(); renderAll();
    });
  }
}

// ②: 자신/상대 턴, 묘지의 이 카드를 제외 → 1장 드로우
function activateJibaeryongJibaeja2() {
  const graveIdx = G.myGrave.findIndex(c => c.id === '지배룡과 지배자');
  if (graveIdx < 0) { notify('묘지에 지배룡과 지배자가 없습니다.'); return; }
  if (!canUseEffect('지배룡과 지배자', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('지배룡과 지배자', 2);
  G.myExile.push(G.myGrave.splice(graveIdx, 1)[0]);
  drawOne();
  log('지배룡과 지배자 ②: 드로우', 'mine');
  sendGameState(); renderAll();
}

// ═══════════════════════════════════════════════════
// 사원소 소환 처리
// ═══════════════════════════════════════════════════

// 사원소의 지배룡 소환: 필드/묘지/제외의 카드명이 다른 지배룡 4종 제외
function summonSaWonsoJibaeryong() {
  if (!canSummonSaWonsoJibaeryong()) { notify('필드/묘지/제외에 카드명이 다른 지배룡 몬스터 4종이 필요합니다.'); return; }
  const allZones = [...G.myField, ...G.myGrave, ...G.myExile].filter(c => isJibaeryongMonster(c.id));
  const uniqueCandidates = [...new Map(allZones.map(c => [c.id, c])).values()];
  openCardPicker(uniqueCandidates, '사원소의 지배룡: 제외할 지배룡 몬스터 4종 선택', 4, (sel) => {
    if (sel.length < 4) { notify('4종을 선택해야 합니다.'); return; }
    const ids = sel.map(i => uniqueCandidates[i]?.id).filter(Boolean);
    if (new Set(ids).size < 4) { notify('카드명이 다른 4종을 선택해야 합니다.'); return; }
    // 필드/묘지/제외 모든 존에서 제거 후 제외존으로 이동
    ids.forEach(id => {
      _removeFromFieldOrGraveOrExile(id);
      G.myExile.push({ id, name: CARDS[id].name });
    });
    log(`사원소의 지배룡: ${ids.map(id=>CARDS[id]?.name||id).join(', ')} 제외`, 'mine');
    const inHand = G.myHand.findIndex(c => c.id === '사원소의 지배룡');
    const inGrave = G.myGrave.findIndex(c => c.id === '사원소의 지배룡');
    if (inHand >= 0) summonFromHand(inHand);
    else if (inGrave >= 0) summonFromGrave('사원소의 지배룡');
    else notify('패/묘지에 사원소의 지배룡이 없습니다.');
    sendGameState(); renderAll();
  }, true);
}

// 사원소의 지배자 소환: 필드/묘지/제외의 카드명이 다른 지배자 4종 제외
function summonSaWonsoJibaeja() {
  if (!canSummonSaWonsoJibaeja()) { notify('필드/묘지/제외에 카드명이 다른 지배자 몬스터 4종이 필요합니다.'); return; }
  const allZones = [...G.myField, ...G.myGrave, ...G.myExile].filter(c => isJibaejaMonster(c.id));
  const uniqueCandidates = [...new Map(allZones.map(c => [c.id, c])).values()];
  openCardPicker(uniqueCandidates, '사원소의 지배자: 제외할 지배자 몬스터 4종 선택', 4, (sel) => {
    if (sel.length < 4) { notify('4종을 선택해야 합니다.'); return; }
    const ids = sel.map(i => uniqueCandidates[i]?.id).filter(Boolean);
    if (new Set(ids).size < 4) { notify('카드명이 다른 4종을 선택해야 합니다.'); return; }
    ids.forEach(id => {
      _removeFromFieldOrGraveOrExile(id);
      G.myExile.push({ id, name: CARDS[id].name });
    });
    log(`사원소의 지배자: ${ids.join(', ')} 제외`, 'mine');
    const inHand = G.myHand.findIndex(c => c.id === '사원소의 지배자');
    const inGrave = G.myGrave.findIndex(c => c.id === '사원소의 지배자');
    if (inHand >= 0) summonFromHand(inHand);
    else if (inGrave >= 0) summonFromGrave('사원소의 지배자');
    else notify('패/묘지에 사원소의 지배자가 없습니다.');
    sendGameState(); renderAll();
  }, true);
}

// ═══════════════════════════════════════════════════
// 헬퍼 유틸
// ═══════════════════════════════════════════════════
function _removeFromGraveOrExile(cardId) {
  let idx = G.myGrave.findIndex(c => c.id === cardId);
  if (idx >= 0) { G.myGrave.splice(idx, 1); return true; }
  idx = G.myExile.findIndex(c => c.id === cardId);
  if (idx >= 0) { G.myExile.splice(idx, 1); return true; }
  return false;
}
function _removeFromFieldOrGrave(cardId) {
  let idx = G.myField.findIndex(c => c.id === cardId);
  if (idx >= 0) { G.myField.splice(idx, 1); return true; }
  idx = G.myGrave.findIndex(c => c.id === cardId);
  if (idx >= 0) { G.myGrave.splice(idx, 1); return true; }
  return false;
}
function _removeFromFieldOrGraveOrExile(cardId) {
  if (_removeFromFieldOrGrave(cardId)) return true;
  const idx = G.myExile.findIndex(c => c.id === cardId);
  if (idx >= 0) { G.myExile.splice(idx, 1); return true; }
  return false;
}

// 원하는만큼 버리기 (선택적 다중 버리기)
function _optionalMultiDiscard(title, callback) {
  if (G.myHand.length === 0) { callback(); return; }
  gameConfirm(`${title}\n패를 버리겠습니까? (취소하면 버리지 않음)`, (yes) => {
    if (!yes) { callback(); return; }
    openCardPicker([...G.myHand], title, G.myHand.length, (sel) => {
      sel.sort((a,b) => b-a).forEach(i => {
        if (G.myHand[i]) {
          const c = G.myHand.splice(i, 1)[0];
          G.myGrave.push(c);
          onJibaeryongDiscarded(c.id);
          onHandDiscarded_jibaeSasl();
        }
      });
      callback();
    });
  });
}

// 엔드 단계: 사원소의 지배자 ② 복귀, 기적 해제
function resetJibaeEffects() {
  if (G.saWonsoJibaejaReturning) {
    const ei = G.myExile.findIndex(c => c.id === '사원소의 지배자');
    if (ei >= 0) {
      const c = G.myExile.splice(ei, 1)[0];
      G.myField.push({ id: c.id, name: c.name, atk: CARDS[c.id]?.atk||5, atkBase: CARDS[c.id]?.atk||5 });
      log('사원소의 지배자 ②: 엔드 단계에 필드로 복귀', 'mine');
    }
    G.saWonsoJibaejaReturning = false;
  }
  saWonsoMirakActive = false;
  jibaeSaslTurnDiscardCount = 0;
  G.attackPhaseProtected = false;
  G.goldenAppleActive = false;
  G.exileBanActive = false;
}


// sendToGrave 후킹: 지배룡 ① 트리거
const _origSendToGrave = sendToGrave;
sendToGrave = function(cardId, from = 'field') {
  _origSendToGrave(cardId, from);
  if (from !== 'hand') onSentToGraveFromNonHand(cardId);
};