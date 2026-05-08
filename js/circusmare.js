// circusmare.js — 서커스메어 테마 효과 엔진
// 펭귄(penguin.js) / 지배자(jibaeja.js) 패턴 기반

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
function isCircusmareCard(id) {
  return !!(id && (
    (CARDS[id] && CARDS[id].theme === '서커스메어') ||
    id === '악몽의 서커스장' || id === '악몽 융합' || id === '광란의 서커스'
  ));
}
function isCircusmareMonster(id) {
  return !!(id && CARDS[id]?.theme === '서커스메어' && CARDS[id]?.cardType === 'monster');
}

const CIRCUSMARE_MED_IDS = [
  '서커스메어 메드 울프','서커스메어 메드 베어',
  '서커스메어 메드 이글','서커스메어 메드 씰',
];

function _cmCoinToss(n, label) {
  let heads = 0;
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random() < 0.5;
    if (r) heads++;
    results.push(r ? '앞' : '뒤');
  }
  log(`${label} 코인 ${n}회 → [${results.join(', ')}] (앞 ${heads}회)`, 'mine');
  return heads;
}

function _cmGraveExileCount() {
  return G.myGrave.filter(c => isCircusmareCard(c.id)).length
       + G.myExile.filter(c => isCircusmareCard(c.id)).length;
}

function _cmSummonKeyCard(cardId) {
  const idx = G.myKeyDeck.findIndex(c => c.id === cardId);
  if (idx < 0) { notify(`키카드 덱에 ${CARDS[cardId]?.name || cardId}가 없습니다.`); return false; }
  const c = G.myKeyDeck.splice(idx, 1)[0];
  const card = CARDS[c.id] || {};
  G.myField.push({ id: c.id, name: c.name, atk: card.atk ?? 0, atkBase: card.atk ?? 0, summonedFrom: 'keyDeck' });
  log(`키카드 소환: ${c.name}`, 'mine');
  sendAction({ type: 'summon', cardId: c.id, from: 'keyDeck' });
  return true;
}

function _cmQueueTrigger(effect, optional) {
  enqueueTriggeredEffect({ speed: 'trigger', timing: 'immediate', optional: optional !== false, ...effect });
}

// ─────────────────────────────────────────────
// 메드 울프
// ─────────────────────────────────────────────
function triggerCmMedWolf(from) {
  if (!canUseEffect('서커스메어 메드 울프', 1)) return;
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 베어')) return;
  _cmQueueTrigger({ type: 'triggerCmMedWolf1', label: '메드 울프 ①' });
}
function resolveCmMedWolf1() {
  if (!canUseEffect('서커스메어 메드 울프', 1)) return;
  markEffectUsed('서커스메어 메드 울프', 1);
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 베어')) { notify('덱에 메드 베어 없음'); return; }
  searchToHand('서커스메어 메드 베어');
  sendGameState(); renderAll();
}

function activateCmMedWolf2(fieldIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 메드 울프', 2)) { notify('이미 사용했습니다.'); return; }
  const targets = G.myField.filter(f => f.id !== '서커스메어 메드 울프' && isCircusmareMonster(f.id));
  if (!targets.length) { notify('대상 서커스메어 몬스터가 없습니다.'); return; }
  markEffectUsed('서커스메어 메드 울프', 2);
  activateIgnitionEffect({ type: 'ignitionCmMedWolf2', label: '메드 울프 ②' });
}
function resolveCmMedWolf2() {
  const targets = G.myField.filter(f => f.id !== '서커스메어 메드 울프' && isCircusmareMonster(f.id));
  if (!targets.length) { notify('대상 없음'); return; }
  openCardPicker(targets, '메드 울프 ②: 서커스메어 ATK +3', 1, (sel) => {
    if (!sel.length) return;
    const t = G.myField.find(f => f.id === targets[sel[0]].id);
    if (t) { t.atk = (t.atk || 0) + 3; log(`메드 울프 ②: ${t.name} ATK+3 → ${t.atk}`, 'mine'); }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 메드 베어
// ─────────────────────────────────────────────
function triggerCmMedBear(from) {
  if (!canUseEffect('서커스메어 메드 베어', 1)) return;
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 이글')) return;
  _cmQueueTrigger({ type: 'triggerCmMedBear1', label: '메드 베어 ①' });
}
function resolveCmMedBear1() {
  if (!canUseEffect('서커스메어 메드 베어', 1)) return;
  markEffectUsed('서커스메어 메드 베어', 1);
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 이글')) { notify('덱에 메드 이글 없음'); return; }
  searchToHand('서커스메어 메드 이글');
  sendGameState(); renderAll();
}

function activateCmMedBear2(fieldIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 메드 베어', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.myDeck.some(d => isCircusmareMonster(d.id))) { notify('덱에 서커스메어 몬스터 없음'); return; }
  markEffectUsed('서커스메어 메드 베어', 2);
  activateIgnitionEffect({ type: 'ignitionCmMedBear2', label: '메드 베어 ②' });
}
function resolveCmMedBear2() {
  const targets = G.myDeck.filter(d => isCircusmareMonster(d.id));
  if (!targets.length) { notify('덱에 서커스메어 몬스터 없음'); return; }
  openCardPicker(targets, '메드 베어 ②: 덱에서 소환', 1, (sel) => {
    if (sel.length) summonFromDeck(targets[sel[0]].id);
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 메드 이글
// ─────────────────────────────────────────────
function triggerCmMedEagle(from) {
  if (!canUseEffect('서커스메어 메드 이글', 1)) return;
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 씰')) return;
  _cmQueueTrigger({ type: 'triggerCmMedEagle1', label: '메드 이글 ①' });
}
function resolveCmMedEagle1() {
  if (!canUseEffect('서커스메어 메드 이글', 1)) return;
  markEffectUsed('서커스메어 메드 이글', 1);
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 씰')) { notify('덱에 메드 씰 없음'); return; }
  searchToHand('서커스메어 메드 씰');
  sendGameState(); renderAll();
}

function activateCmMedEagle2(fieldIdx) {
  if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 메드 이글', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.myGrave.some(g => isCircusmareMonster(g.id))) { notify('묘지에 서커스메어 몬스터 없음'); return; }
  markEffectUsed('서커스메어 메드 이글', 2);
  activateQuickEffect({ type: 'quickCmMedEagle2', label: '메드 이글 ②' });
}
function resolveCmMedEagle2() {
  const targets = G.myGrave.filter(g => isCircusmareMonster(g.id));
  if (!targets.length) { notify('묘지에 서커스메어 몬스터 없음'); return; }
  openCardPicker(targets, '메드 이글 ②: 묘지에서 소환 (최대 2장)', Math.min(2, targets.length), (sel) => {
    sel.map(i => targets[i]?.id).filter(Boolean).forEach(id => summonFromGrave(id));
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 메드 씰
// ─────────────────────────────────────────────
function triggerCmMedSeal(from) {
  if (!canUseEffect('서커스메어 메드 씰', 1)) return;
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 울프')) return;
  _cmQueueTrigger({ type: 'triggerCmMedSeal1', label: '메드 씰 ①' });
}
function resolveCmMedSeal1() {
  if (!canUseEffect('서커스메어 메드 씰', 1)) return;
  markEffectUsed('서커스메어 메드 씰', 1);
  if (!G.myDeck.some(d => d.id === '서커스메어 메드 울프')) { notify('덱에 메드 울프 없음'); return; }
  searchToHand('서커스메어 메드 울프');
  sendGameState(); renderAll();
}

function triggerCmMedSeal2() {
  if (!canUseEffect('서커스메어 메드 씰', 2)) return;
  if (!G.myHand.some(h => h.id !== '서커스메어 메드 씰' && isCircusmareMonster(h.id))) return;
  _cmQueueTrigger({ type: 'triggerCmMedSeal2', label: '메드 씰 ②' });
}
function resolveCmMedSeal2() {
  if (!canUseEffect('서커스메어 메드 씰', 2)) return;
  markEffectUsed('서커스메어 메드 씰', 2);
  const targets = G.myHand.filter(h => h.id !== '서커스메어 메드 씰' && isCircusmareMonster(h.id));
  if (!targets.length) { notify('패에 소환할 서커스메어 몬스터 없음'); return; }
  openCardPicker(targets, '메드 씰 ②: 패에서 소환 (최대 3장)', Math.min(3, targets.length), (sel) => {
    sel.map(i => targets[i]?.id).filter(Boolean).forEach(id => {
      const hi = G.myHand.findIndex(h => h.id === id);
      if (hi >= 0) summonFromHand(hi);
    });
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 크라운 드래곤
// ─────────────────────────────────────────────
function activateCmCrownDragon1(fieldIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 크라운 드래곤', 1, 2)) { notify('이미 2번 사용했습니다.'); return; }
  markEffectUsed('서커스메어 크라운 드래곤', 1);
  activateIgnitionEffect({ type: 'ignitionCmCrownDragon1', label: '크라운 드래곤 ①' });
}
function resolveCmCrownDragon1() {
  const heads = _cmCoinToss(1, '크라운 드래곤 ①');
  if (heads) {
    sendAction({ type: 'opDiscardRandom', count: 3, reason: '크라운 드래곤 ① 앞면' });
    if (window._discardOpponentHandRandomly) _discardOpponentHandRandomly(3, '크라운 드래곤 ①');
    log('크라운 드래곤 ①: 앞면 → 상대 패 3장 버리기', 'mine');
  } else {
    G.myField.forEach(m => { m.atk = (m.atk || 0) + 3; });
    log('크라운 드래곤 ①: 뒷면 → 내 필드 전체 ATK+3', 'mine');
  }
  sendGameState(); renderAll();
}

function activateCmCrownDragon2() {
  if (!canUseEffect('서커스메어 크라운 드래곤', 2, 2)) { notify('이미 2번 사용했습니다.'); return; }
  if (!activeChainState?.active) { notify('상대가 효과를 발동했을 때만 사용 가능합니다.'); return; }
  const hasOp = (activeChainState.links || []).some(l => l.by !== myRole);
  if (!hasOp) { notify('상대 효과 발동 시에만 사용 가능합니다.'); return; }
  markEffectUsed('서커스메어 크라운 드래곤', 2);
  addChainLink({ type: 'quickCmCrownDragon2', label: '크라운 드래곤 ②' });
  sendGameState(); renderAll();
}
function resolveCmCrownDragon2() {
  sendAction({ type: 'opDraw', count: 2, reason: '크라운 드래곤 ②' });
  log('크라운 드래곤 ②: 효과 → "상대 2장 드로우"로 변형', 'mine');
  sendGameState(); renderAll();
}

function triggerCmCrownDragon3() {
  if (!canUseEffect('서커스메어 크라운 드래곤', 3, 2)) return;
  _cmQueueTrigger({ type: 'triggerCmCrownDragon3', label: '크라운 드래곤 ③' });
}
function resolveCmCrownDragon3() {
  if (!canUseEffect('서커스메어 크라운 드래곤', 3, 2)) return;
  markEffectUsed('서커스메어 크라운 드래곤', 3);
  _cmSummonAllFromAllZones('크라운 드래곤 ③');
}

function _cmSummonAllFromAllZones(label) {
  let count = 0;
  const zones = [
    { zone: G.myHand,  from: 'hand' },
    { zone: G.myDeck,  from: 'deck' },
    { zone: G.myGrave, from: 'grave' },
    { zone: G.myExile, from: 'exile' },
  ];
  const maxSlots = typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5;
  zones.forEach(({ zone, from }) => {
    const toSummon = zone.filter(c => isCircusmareMonster(c.id));
    toSummon.forEach(target => {
      if (G.myField.length >= maxSlots) return;
      const idx = zone.findIndex(c => c.id === target.id);
      if (idx < 0) return;
      const mon = zone.splice(idx, 1)[0];
      const card = CARDS[mon.id] || {};
      G.myField.push({ id: mon.id, name: mon.name, atk: card.atk ?? 0, atkBase: card.atk ?? 0, summonedFrom: from });
      sendAction({ type: 'summon', cardId: mon.id, from });
      count++;
    });
  });
  log(`${label}: 서커스메어 몬스터 ${count}장 소환`, 'mine');
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 스프링 제스터 (키카드)
// ─────────────────────────────────────────────
function triggerCmSpringJester() {
  _cmQueueTrigger({ type: 'triggerCmSpringJester1', label: '스프링 제스터 ①' }, false);
}
function resolveCmSpringJester1() {
  if (!canUseEffect('서커스메어 스프링 제스터', 1)) return;
  markEffectUsed('서커스메어 스프링 제스터', 1);
  const removed = [];
  while (G.opField.length) {
    const mon = G.opField.pop();
    G.opGrave.push(mon);
    sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'grave', isTargeting: false });
    removed.push(mon.name);
  }
  if (removed.length) log(`스프링 제스터 ①: 상대 필드 전부 묘지 (${removed.join(', ')})`, 'mine');
  sendGameState(); renderAll();
}

function updateCmSpringJesterAtk() {
  const f = G.myField.find(c => c.id === '서커스메어 스프링 제스터');
  if (!f) return;
  const graveCount = G.myGrave.filter(c => isCircusmareMonster(c.id)).length;
  f.atk = (CARDS['서커스메어 스프링 제스터']?.atk ?? 5) + graveCount;
}

function triggerCmSpringJester3() {
  if (!canUseEffect('서커스메어 스프링 제스터', 3)) return;
  _cmQueueTrigger({ type: 'triggerCmSpringJester3', label: '스프링 제스터 ③' });
}
function resolveCmSpringJester3() {
  if (!canUseEffect('서커스메어 스프링 제스터', 3)) return;
  markEffectUsed('서커스메어 스프링 제스터', 3);
  const gi = G.myGrave.findIndex(c => c.id === '서커스메어 스프링 제스터');
  if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);

  const dragonId = '서커스메어 크라운 드래곤';
  const card = CARDS[dragonId] || {};
  let from = null;
  let hi = G.myHand.findIndex(c => c.id === dragonId);
  if (hi >= 0) { G.myHand.splice(hi, 1); from = 'hand'; }
  else { hi = G.myDeck.findIndex(c => c.id === dragonId);
    if (hi >= 0) { G.myDeck.splice(hi, 1); from = 'deck'; }
    else { hi = G.myGrave.findIndex(c => c.id === dragonId);
      if (hi >= 0) { G.myGrave.splice(hi, 1); from = 'grave'; }
    }
  }
  if (from) {
    G.myField.push({ id: dragonId, name: card.name, atk: card.atk ?? 8, atkBase: card.atk ?? 8, summonedFrom: from });
    sendAction({ type: 'summon', cardId: dragonId, from });
    log(`스프링 제스터 ③: 크라운 드래곤 소환 (${from})`, 'mine');
    onSummon(dragonId, from);
  } else {
    notify('스프링 제스터 ③: 크라운 드래곤이 없습니다.');
  }
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 메드 키메라 (키카드)
// ─────────────────────────────────────────────
function triggerCmMedChimera() {
  G._cmMedChimeraActive = true;
  log('메드 키메라 ①: 서커스메어 보호 상태 ON', 'mine');
  notify('메드 키메라: 서커스메어 몬스터는 상대 효과 대상이 되지 않고 효과로 묘지로 보내지지 않습니다.');
}

function activateCmMedChimera2(fieldIdx) {
  if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 메드 키메라', 2)) { notify('이미 사용했습니다.'); return; }
  const targets = G.myField.filter(f => f.id !== '서커스메어 메드 키메라' && isCircusmareMonster(f.id));
  if (!targets.length) { notify('대상 서커스메어 몬스터 없음'); return; }
  markEffectUsed('서커스메어 메드 키메라', 2);
  activateQuickEffect({ type: 'quickCmMedChimera2', label: '메드 키메라 ②' });
}
function resolveCmMedChimera2() {
  const chimera = G.myField.find(f => f.id === '서커스메어 메드 키메라');
  if (!chimera) return;
  const targets = G.myField.filter(f => f.id !== '서커스메어 메드 키메라' && isCircusmareMonster(f.id));
  if (!targets.length) { notify('대상 없음'); return; }
  openCardPicker(targets, '메드 키메라 ②: 대상 선택', 1, (sel) => {
    if (!sel.length) return;
    const t = targets[sel[0]];
    const gain = CARDS[t.id]?.atk ?? 0;
    chimera.atk = (chimera.atk || 0) + gain;
    log(`메드 키메라 ②: ${t.name} 원래 ATK(${gain}) → 키메라 ATK ${chimera.atk}`, 'mine');
    sendGameState(); renderAll();
  });
}

function triggerCmMedChimera3() {
  G._cmMedChimeraActive = false;
  if (!canUseEffect('서커스메어 메드 키메라', 3)) return;
  _cmQueueTrigger({ type: 'triggerCmMedChimera3', label: '메드 키메라 ③' });
}
function resolveCmMedChimera3() {
  if (!canUseEffect('서커스메어 메드 키메라', 3)) return;
  markEffectUsed('서커스메어 메드 키메라', 3);
  const maxSlots = typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5;
  CIRCUSMARE_MED_IDS.forEach(id => {
    if (G.myField.length >= maxSlots) return;
    let gi = G.myGrave.findIndex(c => c.id === id);
    if (gi >= 0) { summonFromGrave(id); return; }
    let ei = G.myExile.findIndex(c => c.id === id);
    if (ei >= 0) {
      const mon = G.myExile.splice(ei, 1)[0];
      const card = CARDS[mon.id] || {};
      G.myField.push({ id: mon.id, name: mon.name, atk: card.atk ?? 4, atkBase: card.atk ?? 4, summonedFrom: 'exile' });
      sendAction({ type: 'summon', cardId: mon.id, from: 'exile' });
    }
  });
  log('메드 키메라 ③: 묘지/제외 메드 4종 소환', 'mine');
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 코인 제스터 (키카드)
// ─────────────────────────────────────────────
function activateCmCoinJester() {
  if (!canUseEffect('서커스메어 코인 제스터', 1)) { notify('이미 사용했습니다.'); return; }
  if (!activeChainState?.active) { notify('상대 효과 발동 시에만 사용 가능합니다.'); return; }
  if (!(activeChainState.links || []).some(l => l.by !== myRole)) { notify('상대 효과 발동 시에만 사용 가능합니다.'); return; }
  markEffectUsed('서커스메어 코인 제스터', 1);
  if (!_cmSummonKeyCard('서커스메어 코인 제스터')) return;
  addChainLink({ type: 'triggerCmCoinJester1', label: '코인 제스터 ①' });
  sendGameState(); renderAll();
}
function resolveCmCoinJester1() {
  const heads = _cmCoinToss(3, '코인 제스터 ①');
  if (heads > 0) {
    const opTargets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
    const pickable = Math.min(heads, opTargets.length);
    if (pickable > 0) {
      openCardPicker(opTargets, `코인 제스터 ①: 묘지로 보낼 상대 카드 (최대 ${heads}장)`, pickable, (sel) => {
        sel.map(i => opTargets[i]).filter(Boolean).forEach(t => {
          const oi = G.opField.findIndex(f => f.id === t.id);
          if (oi >= 0) { G.opGrave.push(G.opField.splice(oi, 1)[0]); sendAction({ type: 'opFieldRemove', cardId: t.id, to: 'grave' }); return; }
          if (G.opFieldCard?.id === t.id) { G.opGrave.push(G.opFieldCard); sendAction({ type: 'opFieldCardRemove', cardId: t.id, to: 'grave' }); G.opFieldCard = null; }
        });
        const remain = heads - sel.length;
        if (remain > 0) { sendAction({ type: 'opDiscardRandom', count: remain, reason: '코인 제스터 ①' }); if (window._discardOpponentHandRandomly) _discardOpponentHandRandomly(remain, '코인 제스터 ①'); }
        if (heads === 3) { G._cmCoinJesterLock = true; log('코인 제스터 ①: 3앞면 → 상대 이번 턴 효과 불가', 'mine'); notify('상대는 이번 턴 효과를 발동할 수 없습니다.'); }
        sendGameState(); renderAll();
      });
      return;
    }
  }
  if (heads === 3) { G._cmCoinJesterLock = true; notify('상대는 이번 턴 효과를 발동할 수 없습니다.'); }
  sendGameState(); renderAll();
}

function activateCmCoinJester2(fieldIdx) {
  if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 코인 제스터', 2)) { notify('이미 사용했습니다.'); return; }
  markEffectUsed('서커스메어 코인 제스터', 2);
  activateQuickEffect({ type: 'quickCmCoinJester2', label: '코인 제스터 ②' });
}
function resolveCmCoinJester2() {
  const heads = _cmCoinToss(1, '코인 제스터 ②');
  if (heads) {
    if (!G.opField.length) { log('코인 제스터 ②: 앞면이지만 대상 없음', 'mine'); return; }
    openCardPicker(G.opField, '코인 제스터 ②: 효과 무효로 할 상대 몬스터', 1, (sel) => {
      if (sel.length) { const t = G.opField[sel[0]]; log(`코인 제스터 ②: ${t.name} 효과 무효`, 'mine'); notify(`${t.name}의 효과가 이번 턴 무효입니다.`); sendAction({ type: 'effectNullify', cardId: t.id, reason: '코인 제스터 ②' }); }
      sendGameState(); renderAll();
    });
  } else {
    drawOne(); log('코인 제스터 ②: 뒷면 → 드로우', 'mine'); sendGameState(); renderAll();
  }
}

// ─────────────────────────────────────────────
// 마스크 제스터 (키카드)
// ─────────────────────────────────────────────
function activateCmMaskJester() {
  if (!canUseEffect('서커스메어 마스크 제스터', 1)) { notify('이미 사용했습니다.'); return; }
  if (!activeChainState?.active) { notify('상대 효과 발동 시에만 사용 가능합니다.'); return; }
  if (!(activeChainState.links || []).some(l => l.by !== myRole)) { notify('상대 효과 발동 시에만 사용 가능합니다.'); return; }
  markEffectUsed('서커스메어 마스크 제스터', 1);
  if (!_cmSummonKeyCard('서커스메어 마스크 제스터')) return;
  addChainLink({ type: 'triggerCmMaskJester1', label: '마스크 제스터 ①' });
  sendGameState(); renderAll();
}
function resolveCmMaskJester1() {
  const heads = _cmCoinToss(3, '마스크 제스터 ①');
  const tails = 3 - heads;
  if (heads > 0) {
    const dc = G.myDeck.filter(d => isCircusmareCard(d.id));
    dc.slice(0, heads).forEach(t => { const di = G.myDeck.findIndex(d => d.id === t.id); if (di >= 0) G.myGrave.push(G.myDeck.splice(di, 1)[0]); });
    log(`마스크 제스터 ①: 앞면 ${heads}회 → 덱 서커스메어 묘지`, 'mine');
  }
  if (tails > 0) {
    const gc = G.myGrave.filter(g => isCircusmareCard(g.id));
    if (gc.length > 0) {
      openCardPicker(gc, `마스크 제스터 ①: 묘지에서 서커스메어 패로 (최대 ${tails}장)`, Math.min(tails, gc.length), (sel) => {
        sel.map(i => gc[i]).filter(Boolean).forEach(t => { const gi = G.myGrave.findIndex(g => g.id === t.id); if (gi >= 0) G.myHand.push(G.myGrave.splice(gi, 1)[0]); });
        sendGameState(); renderAll();
      });
      return;
    }
  }
  sendGameState(); renderAll();
}

function activateCmMaskJester2(fieldIdx) {
  if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 마스크 제스터', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.opField.length) { notify('상대 필드에 몬스터 없음'); return; }
  markEffectUsed('서커스메어 마스크 제스터', 2);
  activateQuickEffect({ type: 'quickCmMaskJester2', label: '마스크 제스터 ②' });
}
function resolveCmMaskJester2() {
  if (!G.opField.length) { notify('상대 필드에 몬스터 없음'); return; }
  openCardPicker(G.opField, '마스크 제스터 ②: 효과 무효로 할 상대 몬스터', 1, (sel) => {
    if (sel.length) { const t = G.opField[sel[0]]; log(`마스크 제스터 ②: ${t.name} → 서커스메어의 희생자 취급, 효과 무효`, 'mine'); notify(`${t.name}은 이번 턴 '서커스메어의 희생자'로 취급되며 효과가 무효입니다.`); sendAction({ type: 'effectNullify', cardId: t.id, reason: '마스크 제스터 ②' }); }
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 퍼핏 마스터 (키카드)
// ─────────────────────────────────────────────
function activateCmPuppetMaster1(fieldIdx) {
  if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 퍼핏 마스터', 1)) { notify('이미 사용했습니다.'); return; }
  if (!G.myField.some(f => CARDS[f.id]?.cardType === 'monster')) { notify('필드에 몬스터 없음'); return; }
  markEffectUsed('서커스메어 퍼핏 마스터', 1);
  activateQuickEffect({ type: 'quickCmPuppetMaster1', label: '퍼핏 마스터 ①' });
}
function resolveCmPuppetMaster1() {
  const myMons = G.myField.filter(f => CARDS[f.id]?.cardType === 'monster');
  if (!myMons.length) { notify('필드에 몬스터 없음'); return; }
  openCardPicker(myMons, '퍼핏 마스터 ①: 묘지로 보낼 몬스터 (원하는 수)', myMons.length, (sel) => {
    if (!sel.length) return;
    sel.map(i => myMons[i]).filter(Boolean).forEach(t => {
      const fi = G.myField.findIndex(f => f.id === t.id);
      if (fi >= 0) { G.myGrave.push(G.myField.splice(fi, 1)[0]); sendAction({ type: 'myFieldRemove', cardId: t.id, to: 'grave' }); }
    });
    const count = sel.length;
    log(`퍼핏 마스터 ①: ${count}장 묘지`, 'mine');
    if (count >= 1) {
      sendAction({ type: 'opDiscardRandom', count: 1, reason: '퍼핏 마스터 ①' });
      if (window._discardOpponentHandRandomly) _discardOpponentHandRandomly(1, '퍼핏 마스터 ①');
    }
    if (count >= 3) {
      const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
      if (keyOpts.length) {
        openCardPicker(keyOpts, '퍼핏 마스터 ①(3장+): 소환할 키카드', 1, (kSel) => {
          if (kSel.length) {
            const keyCard = keyOpts[kSel[0]];
            if (G.opField.length) {
              openCardPicker(G.opField, `${keyCard.name} 소환: 덱으로 돌려보낼 상대 몬스터 (선택)`, 1, (oSel) => {
                if (oSel.length) { const m = G.opField.splice(oSel[0], 1)[0]; sendAction({ type: 'opFieldRemove', cardId: m.id, to: 'deck' }); log(`퍼핏 마스터 ①: ${m.name} 상대 덱으로`, 'mine'); }
                _cmSummonKeyCard(keyCard.id); onSummon(keyCard.id, 'keyDeck');
                _cmAfterPuppet5(count);
              });
            } else {
              _cmSummonKeyCard(keyCard.id); onSummon(keyCard.id, 'keyDeck');
              _cmAfterPuppet5(count);
            }
          } else { _cmAfterPuppet5(count); }
        });
        return;
      }
    }
    _cmAfterPuppet5(count);
  }, false);
}
function _cmAfterPuppet5(count) {
  if (count >= 5) {
    while (G.opField.length) { const m = G.opField.pop(); G.opExile.push(m); sendAction({ type: 'opFieldRemove', cardId: m.id, to: 'exile' }); }
    if (G.opFieldCard) { G.opExile.push(G.opFieldCard); sendAction({ type: 'opFieldCardRemove', cardId: G.opFieldCard.id, to: 'exile' }); G.opFieldCard = null; }
    const gc = G.opGrave.length; G.opGrave.forEach(c => G.opExile.push(c)); G.opGrave = [];
    if (gc) sendAction({ type: 'opGraveClear', to: 'exile', count: gc });
    log('퍼핏 마스터 ①(5장): 상대 필드/묘지 전부 제외', 'mine');
  }
  sendGameState(); renderAll();
}

function triggerCmPuppetMaster2() {
  if (!canUseEffect('서커스메어 퍼핏 마스터', 2)) return;
  if (!G.myGrave.some(g => g.id !== '서커스메어 퍼핏 마스터' && isCircusmareMonster(g.id))) return;
  _cmQueueTrigger({ type: 'triggerCmPuppetMaster2', label: '퍼핏 마스터 ②' });
}
function resolveCmPuppetMaster2() {
  if (!canUseEffect('서커스메어 퍼핏 마스터', 2)) return;
  markEffectUsed('서커스메어 퍼핏 마스터', 2);
  const maxSlots = typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5;
  G.myGrave.filter(g => g.id !== '서커스메어 퍼핏 마스터' && isCircusmareMonster(g.id)).forEach(t => {
    if (G.myField.length >= maxSlots) return;
    summonFromGrave(t.id);
  });
  log('퍼핏 마스터 ②: 묘지 서커스메어 전부 소환', 'mine');
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 악몽의 서커스장 (필드)
// ─────────────────────────────────────────────
function activateCmField2() {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('악몽의 서커스장', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.myDeck.some(d => isCircusmareCard(d.id))) { notify('덱에 서커스메어 카드 없음'); return; }
  markEffectUsed('악몽의 서커스장', 2);
  activateIgnitionEffect({ type: 'ignitionCmField2', label: '악몽의 서커스장 ②' });
}
function resolveCmField2() {
  const targets = G.myDeck.filter(d => isCircusmareCard(d.id));
  if (!targets.length) { notify('덱에 서커스메어 카드 없음'); return; }
  openCardPicker(targets, '악몽의 서커스장 ②: 덱에서 서커스메어 서치', 1, (sel) => {
    if (sel.length) searchToHand(targets[sel[0]].id);
    sendGameState(); renderAll();
  });
}

function activateCmField3() {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('악몽의 서커스장', 3)) { notify('이미 사용했습니다.'); return; }
  if (G.myDeck.length < 3) { notify('덱에 카드가 3장 미만입니다.'); return; }
  markEffectUsed('악몽의 서커스장', 3);
  activateIgnitionEffect({ type: 'ignitionCmField3', label: '악몽의 서커스장 ③' });
}
function resolveCmField3() {
  const milled = G.myDeck.splice(0, 3);
  let circusCount = 0;
  milled.forEach(c => { G.myGrave.push(c); if (isCircusmareCard(c.id)) circusCount++; });
  log(`악몽의 서커스장 ③: 덱 위 3장 묘지 (서커스메어 ${circusCount}장) → ${circusCount}장 드로우`, 'mine');
  drawN(circusCount);
  sendGameState(); renderAll();
}

function activateCmField4() {
  if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('악몽의 서커스장', 4)) { notify('이미 사용했습니다.'); return; }
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  if (!keyOpts.length) { notify('소환 가능한 키카드 없음'); return; }
  const costPool = [...G.myField.filter(f => isCircusmareMonster(f.id)), ...G.myGrave.filter(g => isCircusmareMonster(g.id))];
  if (!costPool.length) { notify('제외할 서커스메어 몬스터가 없습니다.'); return; }
  markEffectUsed('악몽의 서커스장', 4);
  activateQuickEffect({ type: 'quickCmField4', label: '악몽의 서커스장 ④' });
}
function resolveCmField4() {
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  if (!keyOpts.length) { notify('소환 가능한 키카드 없음'); return; }
  openCardPicker(keyOpts, '악몽의 서커스장 ④: 소환할 키카드', 1, (kSel) => {
    if (!kSel.length) return;
    const keyCard = keyOpts[kSel[0]];
    const costPool = [...G.myField.filter(f => isCircusmareMonster(f.id)), ...G.myGrave.filter(g => isCircusmareMonster(g.id))];
    openCardPicker(costPool, `${keyCard.name} 소환 코스트: 제외할 서커스메어 (필드/묘지)`, costPool.length, (cSel) => {
      if (!cSel.length) return;
      cSel.map(i => costPool[i]).filter(Boolean).forEach(t => {
        const fi = G.myField.findIndex(f => f.id === t.id);
        if (fi >= 0) { G.myExile.push(G.myField.splice(fi, 1)[0]); sendAction({ type: 'myFieldRemove', cardId: t.id, to: 'exile' }); return; }
        const gi = G.myGrave.findIndex(g => g.id === t.id);
        if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
      });
      _cmSummonKeyCard(keyCard.id); onSummon(keyCard.id, 'keyDeck');
      sendGameState(); renderAll();
    });
  });
}

// ─────────────────────────────────────────────
// 서커스메어 퓨전
// ─────────────────────────────────────────────
function activateCmFusion1(handIdx) {
  if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 퓨전', 1, 2)) { notify('이미 2번 사용했습니다.'); return; }
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  if (!keyOpts.length) { notify('소환 가능한 키카드 없음'); return; }
  const costPool = [...G.myHand.filter(h => isCircusmareMonster(h.id)), ...G.myField.filter(f => isCircusmareMonster(f.id))];
  if (!costPool.length) { notify('코스트로 보낼 서커스메어 몬스터가 없습니다.'); return; }
  markEffectUsed('서커스메어 퓨전', 1);
  const src = G.myHand[handIdx];
  if (!src) return;
  activateQuickEffect({ type: 'quickCmFusion1', label: '서커스메어 퓨전 ①', srcIID: ensureCardInstanceId(src) });
}
function resolveCmFusion1(link) {
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  if (!keyOpts.length) { notify('소환 가능한 키카드 없음'); return; }
  openCardPicker(keyOpts, '서커스메어 퓨전 ①: 소환할 키카드', 1, (kSel) => {
    if (!kSel.length) return;
    const keyCard = keyOpts[kSel[0]];
    const costPool = [...G.myHand.filter(h => isCircusmareMonster(h.id)), ...G.myField.filter(f => isCircusmareMonster(f.id))];
    openCardPicker(costPool, `${keyCard.name} 소환 코스트: 묘지로 보낼 서커스메어 (패/필드)`, costPool.length, (cSel) => {
      if (!cSel.length) return;
      cSel.map(i => costPool[i]).filter(Boolean).forEach(t => {
        const hi = G.myHand.findIndex(h => h.id === t.id); if (hi >= 0) { G.myGrave.push(G.myHand.splice(hi, 1)[0]); return; }
        const fi = G.myField.findIndex(f => f.id === t.id); if (fi >= 0) { G.myGrave.push(G.myField.splice(fi, 1)[0]); sendAction({ type: 'myFieldRemove', cardId: t.id, to: 'grave' }); }
      });
      const hi2 = G.myHand.findIndex(h => h.id === '서커스메어 퓨전'); if (hi2 >= 0) G.myGrave.push(G.myHand.splice(hi2, 1)[0]);
      _cmSummonKeyCard(keyCard.id); onSummon(keyCard.id, 'keyDeck');
      log('서커스메어 퓨전 ①: 키카드 소환 완료', 'mine');
      sendGameState(); renderAll();
    });
  });
}

function activateCmFusion2FromGrave() {
  if (!canUseEffect('서커스메어 퓨전', 2, 2)) { notify('이미 2번 사용했습니다.'); return; }
  if (!G.myGrave.some(g => g.id === '서커스메어 퓨전')) { notify('묘지에 없습니다.'); return; }
  if (G.myGrave.filter(g => isCircusmareMonster(g.id)).length < 3) { notify('묘지에 서커스메어 몬스터 3장 이상 필요'); return; }
  markEffectUsed('서커스메어 퓨전', 2);
  activateIgnitionEffect({ type: 'ignitionCmFusion2', label: '서커스메어 퓨전 ②' });
}
function resolveCmFusion2() {
  const gc = G.myGrave.filter(g => isCircusmareMonster(g.id));
  openCardPicker(gc, '서커스메어 퓨전 ②: 제외할 서커스메어 몬스터 3장', 3, (sel) => {
    if (sel.length < 3) { notify('3장 선택 필요'); return; }
    sel.map(i => gc[i]).filter(Boolean).forEach(t => { const gi = G.myGrave.findIndex(g => g.id === t.id); if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]); });
    const gi2 = G.myGrave.findIndex(g => g.id === '서커스메어 퓨전'); if (gi2 >= 0) G.myHand.push(G.myGrave.splice(gi2, 1)[0]);
    log('서커스메어 퓨전 ②: 묘지→패 회수', 'mine');
    sendGameState(); renderAll();
  });
}

// ─────────────────────────────────────────────
// 메드 퍼레이드
// ─────────────────────────────────────────────
function activateCmMedParade1(handIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!canUseEffect('서커스메어 메드 퍼레이드', 1)) { notify('이미 사용했습니다.'); return; }
  const allZone = [...G.myHand, ...G.myDeck, ...G.myField, ...G.myGrave];
  if (!CIRCUSMARE_MED_IDS.every(id => allZone.some(c => c.id === id))) { notify('메드 4종(울프/베어/이글/씰)이 각 1장 이상 필요합니다.'); return; }
  if (!G.myKeyDeck.some(c => c.id === '서커스메어 메드 키메라')) { notify('키카드 덱에 메드 키메라 없음'); return; }
  markEffectUsed('서커스메어 메드 퍼레이드', 1);
  const src = G.myHand[handIdx]; if (!src) return;
  activateIgnitionEffect({ type: 'ignitionCmMedParade1', label: '메드 퍼레이드 ①', srcIID: ensureCardInstanceId(src) });
}
function resolveCmMedParade1() {
  CIRCUSMARE_MED_IDS.forEach(id => {
    const hi = G.myHand.findIndex(h => h.id === id); if (hi >= 0) { G.myExile.push(G.myHand.splice(hi, 1)[0]); return; }
    const di = G.myDeck.findIndex(d => d.id === id); if (di >= 0) { G.myExile.push(G.myDeck.splice(di, 1)[0]); return; }
    const fi = G.myField.findIndex(f => f.id === id); if (fi >= 0) { G.myExile.push(G.myField.splice(fi, 1)[0]); sendAction({ type: 'myFieldRemove', cardId: id, to: 'exile' }); return; }
    const gi = G.myGrave.findIndex(g => g.id === id); if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
  });
  const ph = G.myHand.findIndex(h => h.id === '서커스메어 메드 퍼레이드'); if (ph >= 0) G.myGrave.push(G.myHand.splice(ph, 1)[0]);
  _cmSummonKeyCard('서커스메어 메드 키메라'); onSummon('서커스메어 메드 키메라', 'keyDeck');
  log('메드 퍼레이드 ①: 메드 4종 제외 → 키메라 소환', 'mine');
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// 악몽 융합
// ─────────────────────────────────────────────
function activateCmNightmareFusion1(handIdx) {
  if (!isMyTurn || currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
  if (!window._cmNightmareFusionCount) window._cmNightmareFusionCount = 0;
  if (window._cmNightmareFusionCount >= 2) { notify('악몽 융합은 게임 중 2번까지만 사용 가능합니다.'); return; }
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  if (!keyOpts.length) { notify('소환 가능한 키카드 없음'); return; }
  if (!G.myDeck.some(d => isCircusmareCard(d.id))) { notify('덱에 서커스메어 카드 없음'); return; }
  window._cmNightmareFusionCount++;
  const src = G.myHand[handIdx]; if (!src) return;
  activateIgnitionEffect({ type: 'ignitionCmNightmareFusion1', label: '악몽 융합 ①', srcIID: ensureCardInstanceId(src) });
}
function resolveCmNightmareFusion1() {
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  openCardPicker(keyOpts, '악몽 융합 ①: 소환할 키카드', 1, (kSel) => {
    if (!kSel.length) return;
    const keyCard = keyOpts[kSel[0]];
    const dc = G.myDeck.filter(d => isCircusmareCard(d.id));
    openCardPicker(dc, `${keyCard.name} 소환 코스트: 덱에서 묘지로 보낼 서커스메어`, dc.length, (cSel) => {
      if (!cSel.length) return;
      cSel.map(i => dc[i]).filter(Boolean).forEach(t => { const di = G.myDeck.findIndex(d => d.id === t.id); if (di >= 0) G.myGrave.push(G.myDeck.splice(di, 1)[0]); });
      const ph = G.myHand.findIndex(h => h.id === '악몽 융합'); if (ph >= 0) G.myGrave.push(G.myHand.splice(ph, 1)[0]);
      _cmSummonKeyCard(keyCard.id); onSummon(keyCard.id, 'keyDeck');
      log('악몽 융합 ①: 덱 서커스메어 묘지 → 키카드 소환', 'mine');
      sendGameState(); renderAll();
    });
  });
}

// ─────────────────────────────────────────────
// 광란의 서커스
// ─────────────────────────────────────────────
function activateCmWildCircus1(handIdx) {
  if (isMyTurn) { notify('광란의 서커스 ①은 상대 턴에만 발동 가능합니다.'); return; }
  if (!canUseEffect('광란의 서커스', 1)) { notify('이미 사용했습니다.'); return; }
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  if (!keyOpts.length) { notify('소환 가능한 키카드 없음'); return; }
  const costPool = [...G.myGrave.filter(g => isCircusmareCard(g.id)), ...G.myExile.filter(e => isCircusmareCard(e.id))];
  if (!costPool.length) { notify('묘지/제외에 서커스메어 카드 없음'); return; }
  markEffectUsed('광란의 서커스', 1);
  activateQuickEffect({ type: 'quickCmWildCircus1', label: '광란의 서커스 ①', srcIID: ensureCardInstanceId(G.myHand[handIdx]) });
}
function resolveCmWildCircus1() {
  const keyOpts = G.myKeyDeck.filter(c => c.id !== '서커스메어 코인 제스터' && c.id !== '서커스메어 마스크 제스터');
  openCardPicker(keyOpts, '광란의 서커스 ①: 소환할 키카드', 1, (kSel) => {
    if (!kSel.length) return;
    const keyCard = keyOpts[kSel[0]];
    const costPool = [...G.myGrave.filter(g => isCircusmareCard(g.id)), ...G.myExile.filter(e => isCircusmareCard(e.id))];
    openCardPicker(costPool, `${keyCard.name} 소환 코스트: 덱으로 돌려보낼 서커스메어 (묘지/제외)`, costPool.length, (cSel) => {
      if (!cSel.length) return;
      cSel.map(i => costPool[i]).filter(Boolean).forEach(t => {
        let gi = G.myGrave.findIndex(g => g.id === t.id); if (gi >= 0) { G.myDeck.push(G.myGrave.splice(gi, 1)[0]); return; }
        let ei = G.myExile.findIndex(e => e.id === t.id); if (ei >= 0) G.myDeck.push(G.myExile.splice(ei, 1)[0]);
      });
      const ph = G.myHand.findIndex(h => h.id === '광란의 서커스'); if (ph >= 0) G.myGrave.push(G.myHand.splice(ph, 1)[0]);
      _cmSummonKeyCard(keyCard.id); onSummon(keyCard.id, 'keyDeck');
      log('광란의 서커스 ①: 묘지/제외 덱으로 → 키카드 소환', 'mine');
      sendGameState(); renderAll();
    });
  });
}

function activateCmWildCircus2FromGrave() {
  if (!canUseEffect('광란의 서커스', 2)) { notify('이미 사용했습니다.'); return; }
  if (!G.myGrave.some(g => g.id === '광란의 서커스')) { notify('묘지에 없습니다.'); return; }
  markEffectUsed('광란의 서커스', 2);
  const gi = G.myGrave.findIndex(g => g.id === '광란의 서커스'); if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
  drawOne(); log('광란의 서커스 ②: 묘지 제외 → 드로우', 'mine');
  sendGameState(); renderAll();
}

// ─────────────────────────────────────────────
// CHAIN_RESOLVERS 등록
// ─────────────────────────────────────────────
(function _patchChainResolvers() {
  function patch() {
    if (typeof CHAIN_RESOLVERS === 'undefined') { setTimeout(patch, 100); return; }
    Object.assign(CHAIN_RESOLVERS, {
      triggerCmMedWolf1:          () => resolveCmMedWolf1(),
      triggerCmMedBear1:          () => resolveCmMedBear1(),
      triggerCmMedEagle1:         () => resolveCmMedEagle1(),
      triggerCmMedSeal1:          () => resolveCmMedSeal1(),
      triggerCmMedSeal2:          () => resolveCmMedSeal2(),
      triggerCmCrownDragon3:      () => resolveCmCrownDragon3(),
      triggerCmSpringJester1:     () => resolveCmSpringJester1(),
      triggerCmSpringJester3:     () => resolveCmSpringJester3(),
      triggerCmMedChimera3:       () => resolveCmMedChimera3(),
      triggerCmPuppetMaster2:     () => resolveCmPuppetMaster2(),
      triggerCmCoinJester1:       () => resolveCmCoinJester1(),
      triggerCmMaskJester1:       () => resolveCmMaskJester1(),
      ignitionCmMedWolf2:         () => resolveCmMedWolf2(),
      ignitionCmMedBear2:         () => resolveCmMedBear2(),
      ignitionCmCrownDragon1:     () => resolveCmCrownDragon1(),
      ignitionCmField2:           () => resolveCmField2(),
      ignitionCmField3:           () => resolveCmField3(),
      ignitionCmMedParade1:       (l) => resolveCmMedParade1(l),
      ignitionCmNightmareFusion1: (l) => resolveCmNightmareFusion1(l),
      ignitionCmFusion2:          () => resolveCmFusion2(),
      quickCmMedEagle2:           () => resolveCmMedEagle2(),
      quickCmCrownDragon2:        () => resolveCmCrownDragon2(),
      quickCmCoinJester2:         () => resolveCmCoinJester2(),
      quickCmMaskJester2:         () => resolveCmMaskJester2(),
      quickCmPuppetMaster1:       () => resolveCmPuppetMaster1(),
      quickCmMedChimera2:         () => resolveCmMedChimera2(),
      quickCmField4:              () => resolveCmField4(),
      quickCmFusion1:             (l) => resolveCmFusion1(l),
      quickCmWildCircus1:         (l) => resolveCmWildCircus1(l),
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// onSummon 패치
// ─────────────────────────────────────────────
(function _patchOnSummon() {
  function patch() {
    if (typeof onSummon !== 'function') { setTimeout(patch, 100); return; }
    const _orig = onSummon;
    onSummon = function(cardId, from) {
      _orig.apply(this, arguments);
      switch(cardId) {
        case '서커스메어 메드 울프':     triggerCmMedWolf(from); break;
        case '서커스메어 메드 베어':     triggerCmMedBear(from); break;
        case '서커스메어 메드 이글':     triggerCmMedEagle(from); break;
        case '서커스메어 메드 씰':       triggerCmMedSeal(from); break;
        case '서커스메어 스프링 제스터': triggerCmSpringJester(); break;
        case '서커스메어 메드 키메라':   triggerCmMedChimera(); break;
      }
      updateCmSpringJesterAtk();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// onSentToGrave 패치
// ─────────────────────────────────────────────
(function _patchOnSentToGrave() {
  function patch() {
    if (typeof onSentToGrave !== 'function') { setTimeout(patch, 100); return; }
    const _orig = onSentToGrave;
    onSentToGrave = function(cardId) {
      _orig.apply(this, arguments);
      switch(cardId) {
        case '서커스메어 크라운 드래곤': triggerCmCrownDragon3(); break;
        case '서커스메어 스프링 제스터': triggerCmSpringJester3(); break;
        case '서커스메어 메드 키메라':   triggerCmMedChimera3(); break;
        case '서커스메어 퍼핏 마스터':   triggerCmPuppetMaster2(); break;
      }
      updateCmSpringJesterAtk();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// activateGraveEffect 패치
// ─────────────────────────────────────────────
(function _patchActivateGraveEffect() {
  function patch() {
    if (typeof activateGraveEffect !== 'function') { setTimeout(patch, 100); return; }
    const _orig = activateGraveEffect;
    activateGraveEffect = function(cardId) {
      if (cardId === '서커스메어 퓨전') { activateCmFusion2FromGrave(); return; }
      if (cardId === '광란의 서커스')   { activateCmWildCircus2FromGrave(); return; }
      _orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// checkImmunity 패치
// ─────────────────────────────────────────────
(function _patchCheckImmunity() {
  function patch() {
    if (typeof checkImmunity !== 'function') { setTimeout(patch, 100); return; }
    const _orig = checkImmunity;
    checkImmunity = function(cardId, effectType, source) {
      if (cardId === '서커스메어 스프링 제스터' && source === 'opponent' && G.myField.some(f => f.id === '서커스메어 스프링 제스터'))
        return { immune: true, reason: '스프링 제스터 ④: 상대 효과를 받지 않습니다.' };
      if (G._cmMedChimeraActive && source === 'opponent' && isCircusmareMonster(cardId)) {
        if (effectType === 'target') return { immune: true, reason: '메드 키메라 ①: 상대 효과 대상이 되지 않습니다.' };
        if (effectType === 'toGrave') return { immune: true, reason: '메드 키메라 ①: 효과로 묘지로 보내지지 않습니다.' };
      }
      return _orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// resolveKeyFetch 패치
// ─────────────────────────────────────────────
(function _patchResolveKeyFetch() {
  const NO_HAND = new Set(['서커스메어 스프링 제스터','서커스메어 메드 키메라','서커스메어 코인 제스터','서커스메어 마스크 제스터','서커스메어 퍼핏 마스터']);
  function patch() {
    if (typeof resolveKeyFetch !== 'function') { setTimeout(patch, 100); return; }
    const _orig = resolveKeyFetch;
    resolveKeyFetch = function(cardId) {
      if (NO_HAND.has(cardId)) { notify(`${CARDS[cardId]?.name || cardId}: 패로 가져올 수 없습니다.`); return; }
      return _orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// resetTurnEffects 패치
// ─────────────────────────────────────────────
(function _patchResetTurn() {
  function patch() {
    if (typeof resetTurnEffects !== 'function') { setTimeout(patch, 100); return; }
    const _orig = resetTurnEffects;
    resetTurnEffects = function() {
      _orig.apply(this, arguments);
      G._cmCoinJesterLock = false;
      updateCmSpringJesterAtk();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// 체인 응답 등록 (퀵효과 패널)
// ─────────────────────────────────────────────
(function _registerCmChainResponses() {
  function patch() {
    if (typeof registerChainHandResponse !== 'function') { setTimeout(patch, 50); return; }

    registerChainHandResponse('서커스메어 코인 제스터', [{
      effectNum: 1, label: '① 상대 효과에 체인: 소환+코인 토스',
      condition: () => !!(activeChainState?.active && (activeChainState.links||[]).some(l=>l.by!==myRole) && G.myKeyDeck.some(c=>c.id==='서커스메어 코인 제스터')),
      activate: () => activateCmCoinJester(),
    }]);

    registerChainHandResponse('서커스메어 마스크 제스터', [{
      effectNum: 1, label: '① 상대 효과에 체인: 소환+코인 토스',
      condition: () => !!(activeChainState?.active && (activeChainState.links||[]).some(l=>l.by!==myRole) && G.myKeyDeck.some(c=>c.id==='서커스메어 마스크 제스터')),
      activate: () => activateCmMaskJester(),
    }]);

    registerChainHandResponse('서커스메어 크라운 드래곤', [{
      effectNum: 2, label: '② 상대 효과 → 상대 2장 드로우로 변형',
      condition: () => !!(activeChainState?.active && (activeChainState.links||[]).some(l=>l.by!==myRole) && G.myField.some(f=>f.id==='서커스메어 크라운 드래곤')),
      activate: () => activateCmCrownDragon2(),
    }]);

    registerChainHandResponse('광란의 서커스', [{
      effectNum: 1, label: '① 상대 턴: 묘지/제외→덱 + 키카드 소환',
      condition: (hi) => {
        if (isMyTurn || currentPhase !== 'deploy') return false;
        return [...G.myGrave,...G.myExile].some(c=>isCircusmareCard(c.id)) &&
               G.myKeyDeck.some(c=>c.id!=='서커스메어 코인 제스터'&&c.id!=='서커스메어 마스크 제스터');
      },
      activate: (hi) => activateCmWildCircus1(hi),
    }]);

    registerChainHandResponse('서커스메어 메드 키메라', [{
      effectNum: 2, label: '② 자신/상대 전개: 서커스메어 대상→ATK 상승',
      condition: () => currentPhase==='deploy' && G.myField.some(f=>f.id==='서커스메어 메드 키메라') && G.myField.some(f=>f.id!=='서커스메어 메드 키메라'&&isCircusmareMonster(f.id)),
      activate: () => { const fi=G.myField.findIndex(f=>f.id==='서커스메어 메드 키메라'); activateCmMedChimera2(fi); },
    }]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// ROUTER: 패 발동
// ─────────────────────────────────────────────
function activateCircusmareCard(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  switch (c.id) {
    case '서커스메어 메드 울프':
    case '서커스메어 메드 베어':
    case '서커스메어 메드 이글':
    case '서커스메어 메드 씰':
      notify(`${c.name}은 소환 시 자동으로 효과가 발동됩니다.`); break;
    case '서커스메어 크라운 드래곤':
      if (effectNum === 2) activateCmCrownDragon2(); else notify('크라운 드래곤은 필드 또는 소환 시 효과를 사용하세요.'); break;
    case '서커스메어 퓨전':
      if (effectNum === 1) activateCmFusion1(handIdx); break;
    case '서커스메어 메드 퍼레이드':
      if (effectNum === 1) activateCmMedParade1(handIdx); break;
    case '악몽 융합':
      if (effectNum === 1) activateCmNightmareFusion1(handIdx); break;
    case '광란의 서커스':
      if (effectNum === 1) activateCmWildCircus1(handIdx); break;
    case '서커스메어 스프링 제스터':
    case '서커스메어 메드 키메라':
    case '서커스메어 코인 제스터':
    case '서커스메어 마스크 제스터':
    case '서커스메어 퍼핏 마스터':
      notify(`${c.name}은 패로 가져올 수 없습니다.`); break;
    default:
      notify(`${c.name}: 수동 발동 효과 없음`); break;
  }
}

// ─────────────────────────────────────────────
// ROUTER: 필드 효과
// ─────────────────────────────────────────────
function activateCircusmareFieldEffect(fieldIdx, effectNum) {
  const mon = G.myField[fieldIdx];
  if (!mon) return;
  switch (mon.id) {
    case '서커스메어 메드 울프':     if (effectNum === 2) activateCmMedWolf2(fieldIdx); break;
    case '서커스메어 메드 베어':     if (effectNum === 2) activateCmMedBear2(fieldIdx); break;
    case '서커스메어 메드 이글':     if (effectNum === 2) activateCmMedEagle2(fieldIdx); break;
    case '서커스메어 크라운 드래곤': if (effectNum === 1) activateCmCrownDragon1(fieldIdx); else if (effectNum === 2) activateCmCrownDragon2(); break;
    case '서커스메어 메드 키메라':   if (effectNum === 2) activateCmMedChimera2(fieldIdx); break;
    case '서커스메어 코인 제스터':   if (effectNum === 2) activateCmCoinJester2(fieldIdx); break;
    case '서커스메어 마스크 제스터': if (effectNum === 2) activateCmMaskJester2(fieldIdx); break;
    case '서커스메어 퍼핏 마스터':   if (effectNum === 1) activateCmPuppetMaster1(fieldIdx); break;
    case '악몽의 서커스장':
      if (effectNum === 2) activateCmField2();
      else if (effectNum === 3) activateCmField3();
      else if (effectNum === 4) activateCmField4();
      break;
    case '서커스메어 스프링 제스터':
      notify('스프링 제스터 ②는 지속효과(자동), ③은 묘지 유발(자동)입니다.'); break;
    default:
      notify(`${mon.name}: 수동 발동 가능한 필드 효과 없음`); break;
  }
}

// ─────────────────────────────────────────────
// activateCard 라우팅 패치
// ─────────────────────────────────────────────
(function _patchActivateCard() {
  function patch() {
    if (typeof activateCard !== 'function') { setTimeout(patch, 100); return; }
    const _orig = activateCard;
    activateCard = function(handIdx) {
      const c = G.myHand[handIdx];
      if (c && CARDS[c.id]?.theme === '서커스메어') { activateCircusmareCard(handIdx, 1); return; }
      if (c && ['악몽의 서커스장','악몽 융합','광란의 서커스'].includes(c.id)) { activateCircusmareCard(handIdx, 1); return; }
      _orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();

// ─────────────────────────────────────────────
// 덱 프리셋 + AI 등록
// ─────────────────────────────────────────────
(function _registerPreset() {
  if (!Array.isArray(window.STARTER_THEME_PRESETS)) window.STARTER_THEME_PRESETS = [];
  if (!window.STARTER_THEME_PRESETS.includes('서커스메어')) window.STARTER_THEME_PRESETS.push('서커스메어');

  function patchPreset() {
    if (typeof loadPreset !== 'function') { setTimeout(patchPreset, 100); return; }
    const _orig = loadPreset;
    loadPreset = function(theme) {
      if (theme !== '서커스메어') return _orig.apply(this, arguments);
      builderMainDeck = {
        '서커스메어 메드 울프':4,'서커스메어 메드 베어':4,'서커스메어 메드 이글':4,'서커스메어 메드 씰':4,
        '서커스메어 크라운 드래곤':4,'서커스메어 퓨전':4,'서커스메어 메드 퍼레이드':4,
        '악몽 융합':4,'광란의 서커스':4,'악몽의 서커스장':4,'구사일생':2,'눈에는 눈':2,
      };
      builderKeyDeck = {
        '서커스메어 스프링 제스터':1,'서커스메어 메드 키메라':1,'서커스메어 코인 제스터':1,
        '서커스메어 마스크 제스터':1,'서커스메어 퍼핏 마스터':1,'일격필살':1,'단 한번의 기회':1,'카드의 흑기사':1,
      };
      notify('서커스메어 기본 덱 로드! (메인 40장)');
      if (typeof renderBuilderDeck === 'function') renderBuilderDeck();
      if (typeof filterDeckPool === 'function' && typeof currentPoolFilter !== 'undefined') filterDeckPool(currentPoolFilter);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchPreset);
  else patchPreset();
})();
