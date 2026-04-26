// penguin.js — 펭귄 테마 카드 효과 엔진

// ─────────────────────────────────────────────
// 펭귄 마을 ①
// ─────────────────────────────────────────────
function activatePenguinVillage1(handIdx) {
  if (!canUseEffect('펭귄 마을', 1)) { notify('이미 사용했습니다.'); return; }
  beginChain({ type: 'penguinVillage1', label: '펭귄 마을 ①' });
  notify('체인 1: 펭귄 마을 ① 발동. 상대 응답을 기다립니다.');
}

// ─────────────────────────────────────────────
// 꼬마 펭귄 ②
// ─────────────────────────────────────────────
function triggerKkomaPenguin(from) {
  if (!canUseEffect('꼬마 펭귄', 2, 2)) return;
  const targets = findAllInDeck(c => isPenguinMonster(c.id));
  if (targets.length === 0) return;
  gameConfirm('꼬마 펭귄 ②\n덱에서 펭귄 몬스터 1장을 소환합니까?', (yes) => {
    if (!yes) return;
    markEffectUsed('꼬마 펭귄', 2);
    enqueueTriggeredEffect({ type: 'triggerKkomaPenguin', label: '꼬마 펭귄 ②' });
  });
}

function resolveKkomaPenguin() {
  const targets = findAllInDeck(c => isPenguinMonster(c.id));
  if (targets.length === 0) return;
  openCardPicker(targets, '꼬마 펭귄 ②: 덱에서 펭귄 몬스터 1장 소환', 1, (sel) => {
    if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
  });
}

// ─────────────────────────────────────────────
// 펭귄 부부 ①
// ─────────────────────────────────────────────
function triggerPenguinBubu(from) {
  if (from !== 'deck' || !canUseEffect('펭귄 부부', 1)) return;
  const bubu = [...G.myField].reverse().find(c => c.id === '펭귄 부부' && c.summonedFrom === 'deck');
  if (bubu) bubu.bubuTriggerReady = true;
  gameConfirm('펭귄 부부 ①\n덱에서 펭귄 카드를 최대 2장 패에 넣겠습니까?', (yes) => {
    if (!yes) return;
    enqueueTriggeredEffect({ type: 'triggerPenguinBubu1', label: '펭귄 부부 ①' });
  });
}

function resolvePenguinBubu1() {
  markEffectUsed('펭귄 부부', 1);
  G.myField.forEach(c => { if (c.id === '펭귄 부부') c.bubuTriggerReady = false; });
  const targets = findAllInDeck(c => isPenguinCard(c.id));
  if (targets.length === 0) { notify('덱에 펭귄 카드가 없습니다.'); return; }
  const maxPick = Math.min(2, targets.length);
  openCardPicker(
    targets,
    `펭귄 부부 ①: 펭귄 카드 최대 ${maxPick}장 서치`,
    maxPick,
    (sel) => {
      if (sel.length === 0) return;
      const selectedIds = sel.map(i => targets[i]?.id).filter(Boolean);
      selectedIds.forEach(id => searchToHand(id));
      _forcedDiscardOne('펭귄 부부 ①: 패 1장 버리기 (코스트, 필수)', () => {
        sendGameState(); renderAll();
      });
    }
  );
}

function activatePenguinBubu1FromField(fieldIdx) {
  const mon = G.myField[fieldIdx];
  if (!mon || mon.id !== '펭귄 부부') return;
  if (mon.summonedFrom !== 'deck') { notify('덱에서 소환된 경우에만 발동할 수 있습니다.'); return; }
  if (!mon.bubuTriggerReady || !canUseEffect('펭귄 부부', 1)) { notify('발동 가능한 소환 유발 효과가 없습니다.'); return; }
  if (activeChainState && activeChainState.active && activeChainState.priority !== myRole) {
    notify('현재 체인 우선권은 상대에게 있습니다.'); return;
  }
  mon.bubuTriggerReady = false;
  const effect = { type: 'triggerPenguinBubu1', label: '펭귄 부부 ①' };
  if (activeChainState && activeChainState.active) addChainLink(effect);
  else beginChain(effect);
}

// ─────────────────────────────────────────────
// 펭귄 부부 ②
// ─────────────────────────────────────────────
function activatePenguinBubu2(handIdx) {
  activateIgnitionEffect({ type: 'ignitionPenguinBubu2', label: '펭귄 부부 ②' });
}

function resolvePenguinBubu2() {
  if (!canUseEffect('펭귄 부부', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('펭귄 부부', 2);
  drawN(2);
  _forcedDiscardOne('펭귄 부부 ②: 패 1장 버리기 (코스트, 필수)', () => {
    const idx = G.myHand.findIndex(c => c.id === '펭귄 부부');
    if (idx >= 0) {
      G.myDeck.push({ id: '펭귄 부부', name: '펭귄 부부' });
      G.myDeck = shuffle(G.myDeck);
      G.myHand.splice(idx, 1);
      log('펭귄 부부 덱으로', 'mine');
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 현자 펭귄 ①
// ─────────────────────────────────────────────
function activateSagePenguin1() {
  if (!isPenguinVillageRevealed()) { notify('펭귄 마을이 공개 상태가 아닙니다.'); return; }
  if (!canUseEffect('현자 펭귄', 1)) { notify('이미 사용했습니다.'); return; }
  activateIgnitionEffect({ type: 'ignitionSagePenguin1', label: '현자 펭귄 ①' });
}

function resolveSagePenguin1() {
  if (!isPenguinVillageRevealed()) { notify('펭귄 마을이 공개 상태가 아닙니다.'); return; }
  if (!canUseEffect('현자 펭귄', 1)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('현자 펭귄', 1);
  drawOne();
  openCardPicker(G.myHand, '현자 펭귄 ①: 패 1장 버리기', 1, (sel) => {
    if (sel.length > 0) G.myGrave.push(G.myHand.splice(sel[0], 1)[0]);
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 현자 펭귄 ②
// ─────────────────────────────────────────────
function activateSagePenguin2() {
  activateIgnitionEffect({ type: 'ignitionSagePenguin2', label: '현자 펭귄 ②' });
}

function resolveSagePenguin2() {
  if (!canUseEffect('현자 펭귄', 2)) { notify('이미 사용했습니다.'); return; }
  const targets = findAllInDeck(c => isPenguinCard(c.id));
  if (targets.length === 0) { notify('덱에 펭귄 카드가 없습니다.'); return; }
  markEffectUsed('현자 펭귄', 2);
  openCardPicker(targets, '현자 펭귄 ②: 덱에서 펭귄 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    renderAll();
  });
}

// ─────────────────────────────────────────────
// 수문장 펭귄 ①
// ─────────────────────────────────────────────
function activateSummonerPenguin1(fieldIdx) {
  if (!isPenguinVillageRevealed()) { notify('펭귄 마을이 공개 상태가 아닙니다.'); return; }
  if (!canUseEffect('수문장 펭귄', 1)) { notify('이미 사용했습니다.'); return; }
  const source = G.myField[fieldIdx];
  if (!source || source.id !== '수문장 펭귄') { notify('수문장 펭귄이 필드에 없습니다.'); return; }
  activateIgnitionEffect({
    type:             'ignitionSummonerPenguin1',
    label:            '수문장 펭귄 ①',
    sourceInstanceId: ensureCardInstanceId(source),
  });
}

function resolveSummonerPenguin1(sourceInstanceId) {
  if (!isPenguinVillageRevealed()) { notify('펭귄 마을이 공개 상태가 아닙니다.'); return; }
  if (!canUseEffect('수문장 펭귄', 1)) { notify('이미 사용했습니다.'); return; }
  const fieldIdx = findCardIndexByInstanceId(G.myField, sourceInstanceId);
  if (fieldIdx < 0 || G.myField[fieldIdx]?.id !== '수문장 펭귄') {
    notify('수문장 펭귄 ①: 발동한 카드가 유효하지 않습니다.');
    return;
  }
  markEffectUsed('수문장 펭귄', 1);
  G.myField[fieldIdx].atk += 1;
  log(`수문장 펭귄 ATK +1 → ${G.myField[fieldIdx].atk}`, 'mine');
  openCardPicker(G.myHand, '수문장 펭귄 ①: 자신 패 1장 버리기', 1, (sel) => {
    if (sel.length > 0) G.myGrave.push(G.myHand.splice(sel[0], 1)[0]);
    log('수문장 펭귄 ①: 상대도 패 1장 버려야 합니다.', 'system');
    sendAction({ type: 'forceDiscard', count: 1, reason: '수문장 펭귄 ①' });
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 수문장 펭귄 ②
// ─────────────────────────────────────────────
function triggerSummonerPenguin2() {
  if (G.opField.length === 0) return;
  openCardPicker(G.opField, '수문장 펭귄 ②: 상대 몬스터 1장 묘지로', 1, (sel) => {
    if (sel.length > 0) {
      const mon = G.opField.splice(sel[0], 1)[0];
      G.opGrave.push(mon);
      sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave' });
      log(`수문장 펭귄 ②: 상대 ${mon.name} 묘지로`, 'mine');
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 펭귄의 전설 ③ — 비대상 내성
// 상대 효과가 내 필드의 펭귄의 전설을 대상으로 지정하려 할 때 차단
// 반환값: true = 전설이 보호되어 대상 지정 불가, false = 정상 진행
// ─────────────────────────────────────────────
function isPenguinLegendTargeted(cardId) {
  if (cardId !== '펭귄의 전설') return false;
  return G.myField.some(c => c.id === '펭귄의 전설');
}

// 상대가 내 필드 카드를 대상으로 하는 효과 처리 전에 호출
// cardId: 대상이 될 내 필드 카드 id
// isTargeting: true = 대상 지정 효과, false = 비대상 효과(전설도 막을 수 없음)
// 반환값: true = 전설 내성으로 효과 무효, false = 정상 진행
function checkPenguinLegendImmunity(cardId, isTargeting = true) {
  if (!isTargeting) return false; // 비대상 효과는 전설도 받음
  if (cardId !== '펭귄의 전설') return false;
  if (!G.myField.some(c => c.id === '펭귄의 전설')) return false;
  log('펭귄의 전설 ③: 대상 지정 효과 무효!', 'mine');
  notify('펭귄의 전설 ③: 이 카드를 대상으로 하는 효과는 무효입니다.');
  return true;
}
function checkPenguinVillageReplace(discardCount) {
  const villageIdx    = G.myHand.findIndex(c => c.id === '펭귄 마을' && c.isPublic);
  const fieldPenguins = G.myField.filter(c => isPenguinMonster(c.id));
  if (villageIdx < 0 || fieldPenguins.length === 0 || discardCount <= 0) return false;

  gameConfirm('펭귄 마을 ② 발동? (패 버리는 대신 필드 펭귄 몬스터 묘지로)', (yes) => {
    if (!yes) return;
    openCardPicker(
      fieldPenguins,
      '펭귄 마을 ②: 대신 묘지로 보낼 펭귄 몬스터',
      Math.min(discardCount, fieldPenguins.length),
      (sel) => {
        sel.forEach(i => {
          const mon = fieldPenguins[i];
          sendToGrave(mon.id, 'field');
          // 수문장 펭귄 ②: 마을 효과로 묘지 시 상대 몬스터 제거
          if (mon.id === '수문장 펭귄') triggerSummonerPenguin2();
        });
        // 펭귄의 일격 ②: 마을 효과로 몬스터가 묘지로 보내졌을 경우 묘지의 이 카드를 패에 넣는다
        _tryRecoverPenguinStrikeFromGrave();
        renderAll();
      }
    );
  });
  return true;
}

// 펭귄의 일격 ② — 펭귄 마을 효과로 몬스터 묘지 시 자동 트리거
function _tryRecoverPenguinStrikeFromGrave() {
  const graveIdx = G.myGrave.findIndex(c => c.id === '펭귄의 일격');
  if (graveIdx < 0) return;
  if (!canUseEffect('펭귄의 일격', 2)) return;
  gameConfirm('펭귄의 일격 ②\n묘지의 펭귄의 일격을 패에 넣습니까?', (yes) => {
    if (!yes) return;
    markEffectUsed('펭귄의 일격', 2);
    const c = G.myGrave.splice(graveIdx, 1)[0];
    G.myHand.push({ id: c.id, name: c.name, isPublic: true });
    log('펭귄의 일격 ②: 묘지에서 패로 회수!', 'mine');
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 펭귄!돌격! ①②
// ─────────────────────────────────────────────
function activatePenguinCharge1(handIdx) {
  const source = G.myHand[handIdx];
  if (!source || source.id !== '펭귄!돌격!') { notify('패의 펭귄!돌격! 카드가 필요합니다.'); return; }
  activateIgnitionEffect({
    type:             'ignitionPenguinCharge1',
    label:            '펭귄!돌격! ①',
    sourceInstanceId: ensureCardInstanceId(source),
  });
}

function resolvePenguinCharge1(sourceInstanceId) {
  const targets = findAllInDeck(c => isPenguinMonster(c.id));
  if (targets.length === 0) { notify('덱에 펭귄 몬스터가 없습니다.'); return; }
  const handIdx = findCardIndexByInstanceId(G.myHand, sourceInstanceId);
  if (handIdx < 0 || G.myHand[handIdx]?.id !== '펭귄!돌격!') {
    notify('펭귄!돌격! ①: 발동한 카드가 유효하지 않습니다.');
    return;
  }
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  openCardPicker(targets, '펭귄!돌격! ①: 덱에서 펭귄 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
    renderAll();
  });
}

function activatePenguinCharge2() {
  activateIgnitionEffect({ type: 'ignitionPenguinCharge2', label: '펭귄!돌격! ②' });
}

function resolvePenguinCharge2() {
  const graveIdx = G.myGrave.findIndex(c => c.id === '펭귄!돌격!');
  if (graveIdx < 0) { notify('묘지에 없습니다.'); return; }
  const handPenguins = G.myHand.filter(c => isPenguinMonster(c.id));
  if (handPenguins.length === 0) { notify('패에 펭귄 몬스터가 없습니다.'); return; }
  G.myExile.push(G.myGrave.splice(graveIdx, 1)[0]);
  openCardPicker(handPenguins, '펭귄!돌격! ②: 패에서 펭귄 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) {
      const hIdx = G.myHand.findIndex(c => c.id === handPenguins[sel[0]].id);
      if (hIdx >= 0) summonFromHand(hIdx);
    }
    renderAll();
  });
}

// ─────────────────────────────────────────────
// 펭귄의 영광 ①②
// ─────────────────────────────────────────────
function activatePenguinGlory1(handIdx) {
  const source = G.myHand[handIdx];
  if (!source || source.id !== '펭귄의 영광') { notify('패의 펭귄의 영광 카드가 필요합니다.'); return; }
  activateIgnitionEffect({
    type:             'ignitionPenguinGlory1',
    label:            '펭귄의 영광 ①',
    sourceInstanceId: ensureCardInstanceId(source),
  });
}

function resolvePenguinGlory1(sourceInstanceId) {
  const handIdx = findCardIndexByInstanceId(G.myHand, sourceInstanceId);
  if (handIdx < 0 || G.myHand[handIdx]?.id !== '펭귄의 영광') {
    notify('펭귄의 영광 ①: 발동한 카드가 유효하지 않습니다.');
    return;
  }
  G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);

  const heroIdx   = G.myHand.findIndex(c => c.id === '펭귄 용사');
  const legendIdx = G.myHand.findIndex(c => c.id === '펭귄의 전설');
  const candidates = [];
  if (heroIdx   >= 0) candidates.push({ handIdx: heroIdx,   id: '펭귄 용사',   name: '펭귄 용사' });
  if (legendIdx >= 0) candidates.push({ handIdx: legendIdx, id: '펭귄의 전설', name: '펭귄의 전설 (용사 취급)' });

  if (candidates.length === 0) {
    notify('패에 펭귄 용사 또는 펭귄의 전설이 없습니다. 효과만 적용됩니다.');
  } else if (candidates.length === 1) {
    _glorySummonFromHand(candidates[0].handIdx, candidates[0].id);
  } else {
    openCardPicker(
      candidates.map(c => ({ id: c.id, name: c.name })),
      '펭귄의 영광 ①: 소환할 카드 선택',
      1,
      (sel) => {
        if (sel.length > 0) _glorySummonFromHand(candidates[sel[0]].handIdx, candidates[sel[0]].id);
      }
    );
  }

  G.opHand.forEach(c => { c.isPublic = true; });
  log('펭귄의 영광 ①: 상대 패 전부 공개!', 'mine');
  sendAction({ type: 'revealAllHand' });
  sendGameState(); renderAll();
}

function _glorySummonFromHand(hIdx, cardId) {
  if (hIdx < 0 || !G.myHand[hIdx]) return;
  if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return; }
  const card = CARDS[cardId];
  G.myHand.splice(hIdx, 1);
  G.myField.push({ id: cardId, name: card.name, atk: card.atk || 4, atkBase: card.atk || 4 });
  log(`펭귄의 영광 ①: ${card.name} 소환!`, 'mine');
  onSummon(cardId, 'glory');
}

function activatePenguinGlory2() {
  activateIgnitionEffect({ type: 'ignitionPenguinGlory2', label: '펭귄의 영광 ②' });
}

function resolvePenguinGlory2() {
  const graveIdx = G.myGrave.findIndex(c => c.id === '펭귄의 영광' || c.id === '펭귄이여 영원하라');
  if (graveIdx < 0) { notify('묘지에 없습니다.'); return; }
  G.myExile.push(G.myGrave.splice(graveIdx, 1)[0]);
  drawOne();
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 펭귄 용사 ①②③
// ─────────────────────────────────────────────
function triggerPenguinHero(from) {
  if (!canUseEffect('펭귄 용사', 1)) return;
  gameConfirm('펭귄 용사 ①\n덱에서 펭귄 카드 서치 + 펭귄 몬스터 소환 + 패 1장 버리기를 발동합니까?', (yes) => {
    if (!yes) return;
    enqueueTriggeredEffect({ type: 'triggerPenguinHero1', label: '펭귄 용사 ①' });
  });
}

function resolvePenguinHero1() {
  markEffectUsed('펭귄 용사', 1);
  const targets = findAllInDeck(c => isPenguinCard(c.id));
  openCardPicker(targets, '펭귄 용사 ①: 덱에서 펭귄 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    const monTargets = findAllInDeck(c => isPenguinMonster(c.id));
    if (monTargets.length > 0) {
      openCardPicker(monTargets, '펭귄 용사 ①: 펭귄 몬스터 소환', 1, (sel2) => {
        if (sel2.length > 0) summonFromDeck(monTargets[sel2[0]].id);
        _forcedDiscardOne('펭귄 용사 ①: 패 1장 버리기 (코스트, 필수)', () => {
          sendGameState(); renderAll();
        });
      });
    } else {
      _forcedDiscardOne('펭귄 용사 ①: 패 1장 버리기 (코스트, 필수)', () => {
        sendGameState(); renderAll();
      });
    }
  });
}

function activatePenguinHero2() {
  activateQuickEffect({ type: 'quickPenguinHero2', label: '펭귄 용사 ②' });
}

function resolvePenguinHero2() {
  if (!canUseEffect('펭귄 용사', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('펭귄 용사', 2);
  const fIdx = G.myField.findIndex(c => c.id === '펭귄 용사');
  if (fIdx >= 0) {
    const c = G.myField.splice(fIdx, 1)[0];
    G.myHand.push({ id: c.id, name: c.name, isPublic: false });
    log('펭귄 용사 ②: 패로', 'mine');
  }
  const graveMagic = [...G.myGrave, ...G.myExile].filter(c => isPenguinCard(c.id) && CARDS[c.id]?.cardType === 'magic');
  if (graveMagic.length > 0) {
    openCardPicker(graveMagic, '펭귄 용사 ②: 펭귄 마법 회수', 1, (sel) => {
      if (sel.length > 0) {
        const t = graveMagic[sel[0]];
        let idx = G.myGrave.findIndex(c => c.id === t.id);
        if (idx >= 0) {
          G.myHand.push({ ...G.myGrave.splice(idx, 1)[0], isPublic: true });
        } else {
          idx = G.myExile.findIndex(c => c.id === t.id);
          if (idx >= 0) G.myHand.push({ ...G.myExile.splice(idx, 1)[0], isPublic: true });
        }
      }
      sendGameState(); renderAll();
    });
  } else {
    sendGameState(); renderAll();
  }
}

function autoTriggerHeroGrave() {
  gameConfirm('펭귄 용사 ③\n묘지에서 다시 소환하고 펭귄 공격력을 1씩 올립니까?', (yes) => {
    if (!yes) return;
    enqueueTriggeredEffect({ type: 'triggerPenguinHero3', label: '펭귄 용사 ③' });
  });
}

function resolvePenguinHero3() {
  notify('펭귄 용사 ③ 발동!');
  summonFromGrave('펭귄 용사');
  G.myField.forEach(c => { if (isPenguinMonster(c.id)) c.atk += 1; });
  G.penguinHeroAtkBuff = true;
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 펭귄의 일격 ①
// ─────────────────────────────────────────────
function activatePenguinStrike1() {
  activateQuickEffect({ type: 'quickPenguinStrike1', label: '펭귄의 일격 ①' });
}

function resolvePenguinStrike1() {
  if (!canUseEffect('펭귄의 일격', 1)) { notify('이미 사용했습니다.'); return; }
  if (!G.myField.some(c => isPenguinMonster(c.id))) { notify('필드에 펭귄 몬스터가 없습니다.'); return; }
  _forcedDiscardOne('펭귄의 일격 ①: 패 1장 버리기 (코스트, 필수)', () => {
    markEffectUsed('펭귄의 일격', 1);
    const sIdx = G.myHand.findIndex(c => c.id === '펭귄의 일격');
    if (sIdx >= 0) G.myGrave.push(G.myHand.splice(sIdx, 1)[0]);
    log('펭귄의 일격 ①: 상대 효과 무효!', 'mine');
    sendAction({ type: 'negate', reason: '펭귄의 일격' });
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 펭귄이여 영원하라 ①②
// ─────────────────────────────────────────────
function activatePenguinForever1(handIdx) {
  activateIgnitionEffect({ type: 'ignitionPenguinForever1', label: '펭귄이여 영원하라 ①', handIdx });
}

function resolvePenguinForever1() {
  if (!canUseEffect('펭귄이여 영원하라', 1)) { notify('이미 사용했습니다.'); return; }
  openCardPicker(G.myField, '펭귄이여 영원하라 ①: 내 필드 카드 1장 패로', 1, (mySel) => {
    if (mySel.length > 0) {
      const mon = G.myField.splice(mySel[0], 1)[0];
      G.myHand.push({ id: mon.id, name: mon.name, isPublic: true });
      log(`내 ${mon.name} 패로`, 'mine');
    }
    openCardPicker(G.opField, '펭귄이여 영원하라 ①: 상대 필드 카드 1장 패로', 1, (opSel) => {
      if (opSel.length > 0) {
        const mon = G.opField.splice(opSel[0], 1)[0];
        G.opHand.push({ id: mon.id, name: mon.name, isPublic: false });
        sendAction({ type: 'returnToHand', cardId: mon.id });
      }
      const hp = G.myHand.filter(c => isPenguinMonster(c.id));
      openCardPicker(hp, '펭귄이여 영원하라 ①: 패에서 펭귄 소환 (선택)', 1, (sumSel) => {
        if (sumSel.length > 0) {
          const hIdx = G.myHand.findIndex(c => c.id === hp[sumSel[0]].id);
          if (hIdx >= 0) summonFromHand(hIdx);
        }
        markEffectUsed('펭귄이여 영원하라', 1);
        const hIdx2 = G.myHand.findIndex(c => c.id === '펭귄이여 영원하라');
        if (hIdx2 >= 0) G.myGrave.push(G.myHand.splice(hIdx2, 1)[0]);
        sendGameState(); renderAll();
      });
    });
  });
}

function activatePenguinForever2() {
  activateQuickEffect({ type: 'quickPenguinForever2', label: '펭귄이여 영원하라 ②' });
}

function resolvePenguinForever2() {
  const gIdx = G.myGrave.findIndex(c => c.id === '펭귄이여 영원하라');
  if (gIdx < 0) { notify('묘지에 없습니다.'); return; }
  const hp = G.myHand.filter(c => isPenguinMonster(c.id));
  if (hp.length === 0) { notify('패에 펭귄 몬스터가 없습니다.'); return; }
  G.myExile.push(G.myGrave.splice(gIdx, 1)[0]);
  openCardPicker(hp, '펭귄이여 영원하라 ②: 패에서 펭귄 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) {
      const hIdx = G.myHand.findIndex(c => c.id === hp[sel[0]].id);
      if (hIdx >= 0) summonFromHand(hIdx);
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 펭귄의 전설 ①②
// ─────────────────────────────────────────────
function triggerPenguinLegend(from) {
  if (!canUseEffect('펭귄의 전설', 1)) return;
  gameConfirm('펭귄의 전설 ①\n묘지에서 꼬마 펭귄을 최대 2장 소환합니까?', (yes) => {
    if (!yes) return;
    enqueueTriggeredEffect({ type: 'triggerPenguinLegend1', label: '펭귄의 전설 ①' });
  });
}

function resolvePenguinLegend1() {
  markEffectUsed('펭귄의 전설', 1);
  const gp = G.myGrave.filter(c => c.id === '꼬마 펭귄');
  for (let i = 0; i < Math.min(2, gp.length); i++) summonFromGrave('꼬마 펭귄');
}

function activatePenguinLegend2() {
  activateQuickEffect({ type: 'quickPenguinLegend2', label: '펭귄의 전설 ②' });
}

function resolvePenguinLegend2() {
  if (!canUseEffect('펭귄의 전설', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('펭귄의 전설', 2);
  const fIdx = G.myField.findIndex(c => c.id === '펭귄의 전설');
  if (fIdx >= 0) {
    const c = G.myField.splice(fIdx, 1)[0];
    G.myHand.push({ id: c.id, name: c.name, isPublic: false });
  }
  const targets = [...G.myGrave, ...G.myExile].filter(c => isPenguinMonster(c.id));
  if (targets.length > 0) {
    openCardPicker(targets, '펭귄의 전설 ②: 묘지/제외 펭귄 몬스터 소환', 1, (sel) => {
      if (sel.length > 0) {
        const t   = targets[sel[0]];
        let idx   = G.myGrave.findIndex(c => c.id === t.id);
        if (idx >= 0) {
          G.myGrave.splice(idx, 1);
        } else {
          idx = G.myExile.findIndex(c => c.id === t.id);
          if (idx >= 0) G.myExile.splice(idx, 1);
        }
        const card = CARDS[t.id];
        G.myField.push({ id: t.id, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0 });
        onSummon(t.id, 'grave');
      }
      sendGameState(); renderAll();
    });
  } else {
    sendGameState(); renderAll();
  }
}

// ─────────────────────────────────────────────
// 펭귄 마법사 ①②③
// ─────────────────────────────────────────────
function activatePenguinWizard1(handIdx) {
  activateIgnitionEffect({ type: 'ignitionPenguinWizard1', label: '펭귄 마법사 ①', handIdx });
}

function resolvePenguinWizard1() {
  if (!canUseEffect('펭귄 마법사', 1, 2)) { notify('이미 2번 사용했습니다.'); return; }
  const handIdx = G.myHand.findIndex(c => c.id === '펭귄 마법사' && !c.isPublic);
  if (handIdx < 0 || G.myHand[handIdx]?.isPublic) { notify('일반 패의 펭귄 마법사가 필요합니다.'); return; }
  markEffectUsed('펭귄 마법사', 1);
  const targets = findAllInDeck(c => isPenguinCard(c.id));
  if (targets.length === 0) { notify('덱에 펭귄 카드가 없습니다.'); return; }
  openCardPicker(targets, '펭귄 마법사 ①: 펭귄 카드 서치', 1, (sel) => {
    if (sel.length > 0) searchToHand(targets[sel[0]].id);
    const wIdx = G.myHand.findIndex(c => c.id === '펭귄 마법사');
    if (wIdx >= 0) {
      G.myDeck.push({ id: '펭귄 마법사', name: '펭귄 마법사' });
      G.myDeck = shuffle(G.myDeck);
      G.myHand.splice(wIdx, 1);
    }
    sendGameState(); renderAll();
  });
}

function triggerPenguinWizard(from) {
  if (!canUseEffect('펭귄 마법사', 2, 2) || G.opField.length === 0) return;
  gameConfirm('펭귄 마법사 ②\n패를 버리고 상대 몬스터를 제외합니까?', (yes) => {
    if (!yes) return;
    enqueueTriggeredEffect({ type: 'triggerPenguinWizard2', label: '펭귄 마법사 ②' });
  });
}

function resolvePenguinWizard2() {
  markEffectUsed('펭귄 마법사', 2);
  const maxD = Math.min(3, G.myHand.length);
  if (maxD === 0) return;
  openCardPicker(G.myHand, `펭귄 마법사 ②: 패 최대 3장 버리고 상대 몬스터 제외`, maxD, (sel) => {
    const dc = sel.length;
    sel.sort((a, b) => b - a).forEach(i => G.myGrave.push(G.myHand.splice(i, 1)[0]));
    openCardPicker(G.opField, `펭귄 마법사 ②: 상대 몬스터 ${dc}장 제외`, dc, (opSel) => {
      opSel.sort((a, b) => b - a).forEach(i => {
        const mon = G.opField.splice(i, 1)[0];
        G.opExile.push(mon);
        sendAction({ type: 'opFieldExile', cardId: mon.id });
      });
      sendGameState(); renderAll();
    });
  });
}

function triggerPenguinWizard3() {
  activateIgnitionEffect({ type: 'ignitionPenguinWizard3', label: '펭귄 마법사 ③' });
}

function resolvePenguinWizard3() {
  if (!canUseEffect('펭귄 마법사', 3, 2)) { notify('이미 2번 사용했습니다.'); return; }
  const targets = [
    ...G.myExile.filter(c => CARDS[c.id]?.cardType === 'monster'),
    ...G.opExile.filter(c => CARDS[c.id]?.cardType === 'monster'),
  ];
  if (targets.length === 0) { notify('제외된 몬스터가 없습니다.'); return; }
  markEffectUsed('펭귄 마법사', 3);
  openCardPicker(targets, '펭귄 마법사 ③: 제외 몬스터 소환', 1, (sel) => {
    if (sel.length > 0) {
      const t   = targets[sel[0]];
      let idx   = G.myExile.findIndex(c => c.id === t.id);
      if (idx >= 0) {
        G.myExile.splice(idx, 1);
        const card = CARDS[t.id];
        G.myField.push({ id: t.id, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0 });
      } else {
        idx = G.opExile.findIndex(c => c.id === t.id);
        if (idx >= 0) {
          const mon  = G.opExile.splice(idx, 1)[0];
          const card = CARDS[mon.id];
          G.myField.push({ id: mon.id, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0 });
        }
      }
    }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────
function activatePenguinCard(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;

  switch (c.id) {
    case '펭귄 마을':          if (effectNum === 1) activatePenguinVillage1(handIdx); break;
    case '꼬마 펭귄':           summonFromHand(handIdx); break;
    case '펭귄 부부':           if (effectNum === 2) activatePenguinBubu2(handIdx); else notify('펭귄 부부는 자체 소환 효과가 없습니다.'); break;
    case '현자 펭귄':           notify('현자 펭귄은 자체 소환 효과가 없습니다.'); break;
    case '수문장 펭귄':         notify('수문장 펭귄은 자체 소환 효과가 없습니다.'); break;
    case '펭귄!돌격!':          if (effectNum === 1) activatePenguinCharge1(handIdx); break;
    case '펭귄의 영광':         if (effectNum === 1) activatePenguinGlory1(handIdx); else activatePenguinGlory2(); break;
    case '펭귄 용사':           notify('펭귄 용사는 카드 효과로만 소환할 수 있습니다.'); break;
    case '펭귄의 일격':         if (effectNum === 1) activatePenguinStrike1(); break;
    case '펭귄이여 영원하라':   if (effectNum === 1) activatePenguinForever1(handIdx); else activatePenguinForever2(); break;
    case '펭귄의 전설':         notify('펭귄의 전설은 카드 효과로만 소환할 수 있습니다.'); break;
    case '펭귄 마법사':         if (effectNum === 1) activatePenguinWizard1(handIdx); else notify('펭귄 마법사는 자체 소환 효과가 없습니다.'); break;
    default:
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      log(`발동: ${c.name}`, 'mine');
      sendGameState(); renderAll();
      break;
  }
}

function activatePenguinFieldEffect(fieldIdx, effectNum) {
  const mon = G.myField[fieldIdx];
  if (!mon) return;

  switch (mon.id) {
    case '펭귄 부부':      if (effectNum === 1) activatePenguinBubu1FromField(fieldIdx); break;
    case '현자 펭귄':      if (effectNum === 1) activateSagePenguin1(); else if (effectNum === 2) activateSagePenguin2(); break;
    case '수문장 펭귄':    if (effectNum === 1) activateSummonerPenguin1(fieldIdx); break;
    case '펭귄 용사':      if (effectNum === 2) activatePenguinHero2(); break;
    case '펭귄의 전설':    if (effectNum === 2) activatePenguinLegend2(); break;
    case '펭귄 마법사':    if (effectNum === 3) triggerPenguinWizard3(); break;
    default:               notify(`${mon.name}: 수동 발동 가능한 효과 없음`); break;
  }
}

function activateGraveEffect(cardId) {
  switch (cardId) {
    case '펭귄!돌격!':                   activatePenguinCharge2(); break;
    case '펭귄의 영광':
    case '펭귄이여 영원하라':             activatePenguinGlory2(); break;
    default:                              notify('이 카드는 묘지 효과가 없습니다.'); break;
  }
}

// 레거시 호환
function activatePenguinEffect() { return false; }

// 상대 펭귄 액션 처리
function handlePenguinOpAction(action) {
  switch (action.type) {
    case 'opFieldExile':
      // 상대 펭귄 마법사 ②로 내 카드 제외 — network.js의 opFieldExile 케이스에서 처리됨
      // 여기선 추가 로그만
      log(`상대 효과: ${action.cardId ? (CARDS[action.cardId]?.name || action.cardId) : '카드'} 제외`, 'opponent');
      break;
    default:
      break;
  }
}