// effect.js — 페이즈, 전투, 승리조건, 체인, 범용 카드 효과

// ─────────────────────────────────────────────
// PHASE ACTIONS
// ─────────────────────────────────────────────
function doDrawPhase() {
  if (!isMyTurn || currentPhase !== 'draw') return;
  drawOne();
  advancePhase('deploy');
  log('드로우 단계 완료', 'mine');
  sendAction({ type: 'phaseChange', phase: 'deploy' });
  if (roomRef) roomRef.child('roomPhase').set({ activePlayer: myRole, phase: 'deploy' });
}

function endDeploy() {
  if (!isMyTurn || currentPhase !== 'deploy') return;
  if (G.turn === 1 && myRole === 'host') {
    advancePhase('end');
    log('선공 1턴은 공격 단계를 건너뜁니다.', 'system');
    sendAction({ type: 'phaseEnd', phase: 'deploy_skip_attack' });
    if (roomRef) roomRef.child('roomPhase').set({ activePlayer: myRole, phase: 'end' });
    return;
  }
  advancePhase('attack');
  log('전개 단계 종료', 'mine');
  sendAction({ type: 'phaseEnd', phase: 'deploy' });
  if (roomRef) roomRef.child('roomPhase').set({ activePlayer: myRole, phase: 'attack' });
}

function endAttack() {
  if (!isMyTurn || currentPhase !== 'attack') return;
  advancePhase('end');
  log('공격 단계 종료', 'mine');
  sendAction({ type: 'phaseEnd', phase: 'attack' });
  if (roomRef) roomRef.child('roomPhase').set({ activePlayer: myRole, phase: 'end' });
}

function endTurn() {
  if (!isMyTurn || currentPhase !== 'end') return;
  resetTurnEffects();
  attackedMonstersThisTurn.clear();
  G.turn++;
  isMyTurn = false;
  advancePhase('draw');
  log('턴 종료 — 상대 턴', 'mine');
  sendAction({ type: 'endTurn' });
  sendGameState();
  const opRole = getOtherRole(myRole);
  if (roomRef) roomRef.child('roomPhase').set({ activePlayer: opRole, phase: 'draw' });
  renderPhase();
}

function summonMonster(/* handIdx */) {
  notify('통상 소환은 없습니다. 카드 효과로만 소환할 수 있습니다.');
}

// ─────────────────────────────────────────────
// COMBAT
// ─────────────────────────────────────────────
function executeCombat(atkIdx, defIdx) {
  if (!isMyTurn || currentPhase !== 'attack') {
    notify('공격 단계가 아닙니다.');
    return;
  }
  const attacker = G.myField[atkIdx];
  const defender = G.opField[defIdx];
  if (!attacker || !defender) return;

  if (attackedMonstersThisTurn.has(attacker.id)) {
    notify('이 몬스터는 이번 턴에 이미 공격했습니다.');
    return;
  }
  // 수호의 빛: 공격 단계에 1회만 공격 가능
  if ((G.myFieldCard?.id === '수호의 빛' || G.opFieldCard?.id === '수호의 빛') && attackedMonstersThisTurn.size > 0) {
    notify('수호의 빛: 공격 단계에 몬스터 하나로만 공격할 수 있습니다.');
    return;
  }

  const diff = attacker.atk - defender.atk;
  log(`전투: ${attacker.name}(${attacker.atk}) vs ${defender.name}(${defender.atk})`, 'mine');

  if (diff > 0) {
    // 내 몬스터 승리 — 상대 묘지 + 상대 패 손실
    G.opField.splice(defIdx, 1);
    G.opGrave.push(defender);
    log(`${defender.name} 묘지. 상대 패 ${diff}장 손실`, 'system');
    notify(`공격 성공! 상대 패 ${diff}장 손실`);
    sendAction({ type: 'forceDiscard', count: diff, attackerPicks: true });

  } else if (diff < 0) {
    // 상대 몬스터 승리 — 내 묘지 + 내 패 손실
    G.myField.splice(atkIdx, 1);
    G.myGrave.push(attacker);
    log(`${attacker.name} 묘지. 내 패 ${Math.abs(diff)}장 버리기`, 'mine');
    onSentToGrave(attacker.id);

    _resolveForceDiscardWithGuard(Math.abs(diff));

  } else {
    // 무승부
    if (attacker.atk === 0) {
      log('공격력 0 — 양쪽 유지', 'system');
    } else {
      G.myField.splice(atkIdx, 1);
      G.opField.splice(defIdx, 1);
      G.myGrave.push(attacker);
      G.opGrave.push(defender);
      log('공격력 동일 — 양쪽 묘지', 'system');
      onSentToGrave(attacker.id);
    }
  }

  sendAction({ type: 'combat', atkIdx, defIdx, atkCard: attacker, defCard: defender });
  attackedMonstersThisTurn.add(attacker.id);
  sendGameState();
  renderAll();
}

function directAttack(atkIdx) {
  if (!isMyTurn || currentPhase !== 'attack') return;
  const attacker = G.myField[atkIdx];
  if (!attacker) return;

  if (attackedMonstersThisTurn.has(attacker.id)) {
    notify('이 몬스터는 이번 턴에 이미 공격했습니다.');
    return;
  }
  if (G.opField.length > 0) {
    notify('상대 필드에 몬스터가 있습니다. 직접 공격 불가.');
    return;
  }

  log(`직접 공격: ${attacker.name}(${attacker.atk}) — 상대는 패를 ${attacker.atk}장 버려야 합니다.`, 'mine');
  notify(`직접 공격! 상대 패 ${attacker.atk}장 손실`);
  sendAction({ type: 'directAttack', card: attacker });
  attackedMonstersThisTurn.add(attacker.id);
  sendGameState();
  renderAll();
}

// ─────────────────────────────────────────────
// FORCE DISCARD
// ─────────────────────────────────────────────
/**
 * n장 버리기.
 * opponentPicks=true: 공개패 우선 자동 선택 (상대가 공격자인 경우)
 * opponentPicks=false: 내가 피커로 선택
 *
 * NOTE: "상대가 고른다"는 클라이언트 시뮬레이션입니다.
 * 완전한 보안을 위해서는 서버사이드 검증이 필요합니다.
 */
function forceDiscard(n, opponentPicks = false) {
  if (G.myHand.length === 0) {
    checkWinCondition();
    return;
  }

  const actualN = Math.min(n, G.myHand.length);

  const pickerTitle = opponentPicks
    ? `상대 효과: 버릴 패 ${actualN}장 직접 선택`
    : `패를 ${actualN}장 버려야 합니다 (${actualN}장 선택)`;

  openCardPicker(
    G.myHand,
    pickerTitle,
    actualN,
    (selected) => {
      if (!selected || selected.length < actualN) {
        notify(`정확히 ${actualN}장을 선택해야 합니다.`);
        return;
      }
      selected.sort((a, b) => b - a).forEach(i => {
        if (G.myHand[i]) G.myGrave.push(G.myHand.splice(i, 1)[0]);
      });
      sendGameState();
      renderAll();
      checkWinCondition();
    },
    true
  );
}

// ─────────────────────────────────────────────
// WIN CONDITION
// ─────────────────────────────────────────────
function checkWinCondition() {
  if (G.myHand.length === 0) {
    showGameOver(false);
    sendAction({ type: 'gameOver', winner: getOtherRole(myRole) });
  }
}

function showGameOver(win) {
  const el    = document.getElementById('gameover');
  const title = document.getElementById('gameoverTitle');
  const msg   = document.getElementById('gameoverMsg');
  el.classList.add('show');
  if (win) {
    title.textContent = '승리!';
    title.className   = 'gameover-title win';
    msg.textContent   = '상대의 패를 모두 털었습니다.';
  } else {
    title.textContent = '패배...';
    title.className   = 'gameover-title lose';
    msg.textContent   = '패가 0장이 되었습니다.';
  }
  recordGameResult(win);
}

function concede() {
  gameConfirm('정말 항복하시겠습니까?', (yes) => {
    if (!yes) return;
    showGameOver(false);
    sendAction({ type: 'gameOver', winner: getOtherRole(myRole) });
  });
}

// ─────────────────────────────────────────────
// CHAIN SYSTEM
// ─────────────────────────────────────────────
function beginChain(effect) {
  const chainState = {
    active:     true,
    startedBy:  myRole,
    priority:   getOtherRole(myRole),
    passCount:  0,
    links:      [{ ...effect, by: myRole }],
  };
  activeChainState = chainState;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 1: ${effect.label} 발동`, 'mine');

  if (!roomRef) {
    // 데모: 상대 자동 패스 → 즉시 해결
    resolveChain({ ...chainState, passCount: 2 });
    return;
  }
  roomRef.child('chainState').set(chainState);
  syncClockRunState(chainState.priority);
}

function openChainResponse() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;
  if (usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }
  const options = (G.myKeyDeck || []).map(c => ({ id: c.id, name: c.name }));
  if (options.length === 0) {
    notify('키 카드 덱에 발동 가능한 카드가 없습니다. 패스하세요.');
    return;
  }
  openCardPicker(options, '체인 응답: 키 카드 가져오기 (유발 즉시)', 1, (sel) => {
    if (!sel || sel.length === 0) return;
    const picked = options[sel[0]];
    if (!picked) return;
    addChainLink({
      type:   'keyFetch',
      label:  `키 카드 가져오기 (${picked.name})`,
      cardId: picked.id,
    });
  });
}

function passChainPriority() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;

  const next = { ...activeChainState };
  next.passCount = (next.passCount || 0) + 1;
  next.priority  = getOtherRole(myRole);
  log('체인 패스', 'system');

  if (next.passCount >= 2) {
    resolveChain(next);
    return;
  }

  if (!roomRef) {
    next.passCount = 2;
    resolveChain(next);
    return;
  }

  activeChainState = next;
  roomRef.child('chainState').set(next);
  syncClockRunState(next.priority);
}

function addChainLink(effect) {
  if (!activeChainState || !activeChainState.active) return;
  if (effect.type === 'keyFetch' && usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }

  const next    = { ...activeChainState };
  next.links    = [...(next.links || []), { ...effect, by: myRole }];
  next.priority = getOtherRole(myRole);
  next.passCount = 0;
  activeChainState = next;

  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 ${next.links.length}: ${effect.label}`, 'mine');

  if (!roomRef) {
    next.passCount = 2;
    resolveChain(next);
    return;
  }
  roomRef.child('chainState').set(next);
  syncClockRunState(next.priority);
}

function enqueueTriggeredEffect(effect) {
  pendingTriggerEffects.push(effect);
  setTimeout(flushTriggeredEffects, 0);
}

function flushTriggeredEffects() {
  if (pendingTriggerEffects.length === 0) return;
  if (activeChainState && activeChainState.active) return;

  const queued          = [...pendingTriggerEffects];
  pendingTriggerEffects = [];

  if (!roomRef) {
    executeChainLocally(queued.map(e => ({ ...e, by: myRole })).reverse());
    return;
  }

  beginChain(queued[0]);
  queued.slice(1).forEach(e => addChainLink(e));
}

function activateQuickEffect(effect) {
  if (activeChainState && activeChainState.active) {
    if (activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다.');
      return;
    }
    addChainLink(effect);
    return;
  }
  beginChain(effect);
}

function activateIgnitionEffect(effect) {
  if (activeChainState && activeChainState.active) {
    if (activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다.');
      return;
    }
    addChainLink(effect);
    return;
  }
  beginChain(effect);
}

function resolveChain(chainState) {
  const links       = [...(chainState.links || [])];
  const resolvedAt  = Date.now();
  usedKeyFetchInChain = {};
  activeChainState    = null;
  renderChainActions();

  if (roomRef) {
    roomRef.child('chainState').set({
      active: false, links: [], priority: null, passCount: 0,
      resolvedLinks: links, resolvedAt,
    });
  } else {
    executeChainLocally(links.slice().reverse());
  }
}

// 체인 링크 로컬 실행 (역순)
const CHAIN_RESOLVERS = {
  keyFetch:                  (link) => resolveKeyFetch(link.cardId),
  penguinVillage1:           ()     => resolvePenguinVillage1(),
  triggerKkomaPenguin:       ()     => resolveKkomaPenguin(),
  triggerPenguinBubu1:       ()     => resolvePenguinBubu1(),
  triggerPenguinHero1:       ()     => resolvePenguinHero1(),
  triggerPenguinLegend1:     ()     => resolvePenguinLegend1(),
  triggerPenguinWizard2:     ()     => resolvePenguinWizard2(),
  triggerPenguinHero3:       ()     => resolvePenguinHero3(),
  quickPenguinHero2:         ()     => resolvePenguinHero2(),
  quickPenguinLegend2:       ()     => resolvePenguinLegend2(),
  quickPenguinStrike1:       ()     => resolvePenguinStrike1(),
  quickPenguinForever2:      ()     => resolvePenguinForever2(),
  ignitionPenguinBubu2:      ()     => resolvePenguinBubu2(),
  ignitionSagePenguin1:      ()     => resolveSagePenguin1(),
  ignitionSagePenguin2:      ()     => resolveSagePenguin2(),
  ignitionSummonerPenguin1:  (link) => resolveSummonerPenguin1(link.sourceInstanceId),
  ignitionPenguinCharge1:    (link) => resolvePenguinCharge1(link.sourceInstanceId),
  ignitionPenguinCharge2:    ()     => resolvePenguinCharge2(),
  ignitionPenguinGlory1:     (link) => resolvePenguinGlory1(link.sourceInstanceId),
  ignitionPenguinGlory2:     ()     => resolvePenguinGlory2(),
  ignitionPenguinForever1:   ()     => resolvePenguinForever1(),
  ignitionPenguinWizard1:    ()     => resolvePenguinWizard1(),
  ignitionPenguinWizard3:    ()     => resolvePenguinWizard3(),
};

function executeChainLocally(links) {
  links.forEach(link => {
    if (link.by !== myRole) return;
    const resolver = CHAIN_RESOLVERS[link.type];
    if (resolver) resolver(link);
  });
  sendGameState();
  renderAll();
  usedKeyFetchInChain = {};
}

// ─────────────────────────────────────────────
// KEY FETCH
// ─────────────────────────────────────────────
function startKeyFetchEffect() {
  if (!G.myKeyDeck || G.myKeyDeck.length === 0) {
    notify('키 카드 덱이 비어있습니다.');
    return;
  }
  if (currentPhase === 'draw') {
    notify('드로우 단계에는 키카드 가져오기를 사용할 수 없습니다.');
    return;
  }
  if (activeChainState && activeChainState.active && activeChainState.priority !== myRole) {
    notify('현재 체인 우선권은 상대에게 있습니다.');
    return;
  }
  if (activeChainState && activeChainState.active && usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }

  const noHandFetchKeyMonsters = new Set(['카드의 흑기사', '풀려난 항아리의 마귀', '카드 세계의 영웅']);
  const options = (G.myKeyDeck || []).map(c => {
    let canFetch = true;
    let reason   = '';
    if (noHandFetchKeyMonsters.has(c.id))              { canFetch = false; reason = '(패로 가져올 수 없는 카드)'; }
    if (c.id === '펭귄 용사'   && G.opField.length === 0)  { canFetch = false; reason = '(상대 필드에 몬스터 필요)'; }
    if (c.id === '펭귄의 전설' && G.myField.length === 0)  { canFetch = false; reason = '(내 필드에 몬스터 필요)'; }
    return { id: c.id, name: canFetch ? c.name : `${c.name} ${reason} — 불가`, canFetch };
  });

  const fetchable = options.filter(o => o.canFetch);
  if (fetchable.length === 0) {
    notify('현재 가져올 수 있는 키 카드가 없습니다. (조건 미충족)');
    return;
  }

  openCardPicker(fetchable, '키 카드 덱에서 1장 가져오기 (유발 즉시)', 1, (sel) => {
    if (!sel || sel.length === 0) return;
    const picked = fetchable[sel[0]];
    if (!picked) return;
    const effect = {
      type:   'keyFetch',
      label:  `키 카드 가져오기 (${picked.name})`,
      cardId: picked.id,
    };
    if (activeChainState && activeChainState.active) addChainLink(effect);
    else beginChain(effect);
  });
}

function resolveKeyFetch(cardId) {
  const idx = G.myKeyDeck.findIndex(c => c.id === cardId);
  if (idx < 0) {
    notify(`키 카드 덱에 ${CARDS[cardId]?.name || cardId}가 없습니다.`);
    return;
  }
  if (['카드의 흑기사', '풀려난 항아리의 마귀', '카드 세계의 영웅'].includes(cardId)) {
    notify(`${CARDS[cardId]?.name || cardId}: 패로 가져올 수 없는 카드입니다.`);
    return;
  }
  if (cardId === '펭귄 용사'   && G.opField.length === 0) { notify('펭귄 용사: 상대 필드에 몬스터가 없어 패에 넣을 수 없습니다.'); return; }
  if (cardId === '펭귄의 전설' && G.myField.length === 0) { notify('펭귄의 전설: 자신 필드에 몬스터가 없어 패에 넣을 수 없습니다.'); return; }

  const c = G.myKeyDeck.splice(idx, 1)[0];
  G.myHand.push({ id: c.id, name: c.name, isPublic: true });
  log(`키 카드 가져오기: ${c.name} (공개패)`, 'mine');
  sendGameState();
  renderAll();
}

function resolvePenguinVillage1() {
  const idx = G.myHand.findIndex(c => c.id === '펭귄 마을' && !c.isPublic);
  if (idx < 0) return;
  G.myHand[idx].isPublic = true;
  markEffectUsed('펭귄 마을', 1);
  log('체인 처리: 펭귄 마을 ① 공개', 'mine');
}

// ─────────────────────────────────────────────
// MANUAL DISCARD
// ─────────────────────────────────────────────
function manualDiscard(handIdx) {
  if (handIdx < 0 || !G.myHand[handIdx]) return;
  const c = G.myHand.splice(handIdx, 1)[0];
  G.myGrave.push({ id: c.id, name: c.name });
  selectedCardIdx = -1;
  log(`패를 버림: ${c.name}`, 'mine');
  sendAction({ type: 'discard', cardId: c.id });
  onJibaeryongDiscarded(c.id);
  onHandDiscarded_jibaeSasl();
  sendGameState();
  renderAll();
  checkWinCondition();
}

/** 강제 1장 버리기 — 반드시 선택해야 하며 취소 불가 */
function _forcedDiscardOne(title, callback) {
  if (G.myHand.length === 0) { callback(); return; }
  openCardPicker(G.myHand, title, 1, (sel) => {
    if (sel.length > 0) {
      const c = G.myHand.splice(sel[0], 1)[0];
      G.myGrave.push(c);
      log(`버림(코스트): ${c.name}`, 'mine');
      onJibaeryongDiscarded(c.id);
      onHandDiscarded_jibaeSasl();
    }
    callback();
  }, true /* forced=true */);
}

// ─────────────────────────────────────────────
// CARD ACTIVATE (범용)
// ─────────────────────────────────────────────

function activateFieldEffect(fieldIdx, effectNum) {
  const mon = G.myField[fieldIdx];
  if (!mon) return;
  if (mon.id === '카드의 흑기사' && effectNum === 1) {
    const targets = [...G.opField, ...G.myField.filter((_,i)=>i!==fieldIdx), ...(G.opFieldCard?[G.opFieldCard]:[]), ...(G.myFieldCard?[G.myFieldCard]:[])];
    if (!targets.length) { notify('대상이 없습니다.'); return; }
    openCardPicker(targets, '카드의 흑기사 ①: 필드 카드 1장 묘지로', 1, (sel)=>{
      if (!sel.length) return;
      const t = targets[sel[0]];
      sendAction({ type:'sendToGrave', cardId:t.id, reason:'카드의 흑기사 ①' });
      markEffectUsed('카드의 흑기사', 1);
      log('카드의 흑기사 ① 발동', 'mine'); sendGameState(); renderAll();
    });
    return;
  }
  if (mon.id === '풀려난 항아리의 마귀' && effectNum === 2) {
    if (!canUseEffect('풀려난 항아리의 마귀', 2)) { notify('이번 턴에는 이미 사용했습니다.'); return; }
    if (!G.myDeck.length) { notify('덱이 비어 있습니다.'); return; }
    const pick = G.myDeck.shift();
    G.myHand.push({ id:pick.id, name:pick.name, isPublic:true });
    mon.atk = (mon.atk || 5) + 1;
    markEffectUsed('풀려난 항아리의 마귀', 2);
    log('풀려난 항아리의 마귀 ②: 서치 + 공격력 1 상승', 'mine');
    sendGameState(); renderAll();
  }
}
function activateCard(handIdx) {
  const c = G.myHand[handIdx];
  if (!c) return;

  switch (c.id) {

    case '구사일생':
      notify('구사일생은 전투 시 자동으로 발동 여부를 물어봅니다.');
      return;

    case '눈에는 눈':
      notify('눈에는 눈은 상대 서치 계열 효과에 체인으로만 발동할 수 있습니다.');
      return;

    case '출입통제':
      notify('출입통제는 상대 효과에 체인으로만 발동할 수 있습니다.');
      return;


    case '영웅의 탄생':
      notify('영웅의 탄생은 상대의 서치/묘지이동/묘지·제외 활용 효과에 체인으로 발동할 수 있습니다.');
      return;

    case '카드의 흑기사': {
      if (G.myField.length < 2) { notify('소환 불가: 필드 몬스터 2장 이상이 필요합니다.'); return; }
      const targets = [...G.myField];
      openCardPicker(targets, '카드의 흑기사 소환 코스트: 공격력 합계 10 이상이 되도록 몬스터 선택', Math.min(5, targets.length), (sel) => {
        if (!sel.length) return;
        const picked = sel.map(i => targets[i]);
        const sumAtk = picked.reduce((a,m)=>a+((m&&m.atk)||0),0);
        if (picked.length < 2 || sumAtk < 10) { notify('소환 불가: 2장 이상, 공격력 합계 10 이상이 필요합니다.'); return; }
        for (const m of picked) { const idx = G.myField.findIndex(x => x===m || (x.id===m.id && x.atk===m.atk)); if (idx>=0) G.myGrave.push(G.myField.splice(idx,1)[0]); }
        G.myField.push({ id:c.id, name:c.name, atk:5, summonedFrom:'keyDeck' });
        G.myHand.splice(handIdx,1);
        log('카드의 흑기사 소환!', 'mine'); sendGameState(); renderAll();
      });
      return;
    }

    case '풀려난 항아리의 마귀': {
      if (G.myField.length < 3) { notify('소환 불가: 필드 몬스터 3장이 필요합니다.'); return; }
      const targets = [...G.myField];
      openCardPicker(targets, '풀려난 항아리의 마귀 소환 코스트: 몬스터 3장 선택', 3, (sel)=>{
        if (sel.length!==3) return;
        sel.sort((a,b)=>b-a).forEach(i=>G.myGrave.push(G.myField.splice(i,1)[0]));
        G.myField.push({ id:c.id, name:c.name, atk:5, summonedFrom:'keyDeck' });
        G.myHand.splice(handIdx,1);
        log('풀려난 항아리의 마귀 소환!', 'mine'); sendGameState(); renderAll();
      });
      return;
    }

    case '카드 세계의 영웅': {
      const hasPot = G.myField.some(m=>m.id==='풀려난 항아리의 마귀');
      if (!hasPot || G.myField.length < 2) { notify('소환 불가: 필드의 풀려난 항아리의 마귀 1장과 다른 몬스터 1장이 필요합니다.'); return; }
      const potIdx = G.myField.findIndex(m=>m.id==='풀려난 항아리의 마귀');
      const otherIdx = G.myField.findIndex((m,i)=>i!==potIdx);
      G.myGrave.push(G.myField.splice(Math.max(potIdx,otherIdx),1)[0]);
      G.myGrave.push(G.myField.splice(Math.min(potIdx,otherIdx),1)[0]);
      G.myField.push({ id:c.id, name:c.name, atk:5, summonedFrom:'keyDeck' });
      G.myHand.splice(handIdx,1);
      const addHero = ()=>{
        const d=G.myDeck.findIndex(x=>x.id==='영웅의 탄생'); if(d>=0){const z=G.myDeck.splice(d,1)[0]; G.myHand.push({id:z.id,name:z.name,isPublic:true}); return true;}
        const g=G.myGrave.findIndex(x=>x.id==='영웅의 탄생'); if(g>=0){const z=G.myGrave.splice(g,1)[0]; G.myHand.push({id:z.id,name:z.name,isPublic:true}); return true;}
        const e=G.myExile.findIndex(x=>x.id==='영웅의 탄생'); if(e>=0){const z=G.myExile.splice(e,1)[0]; G.myHand.push({id:z.id,name:z.name,isPublic:true}); return true;}
        return false;
      };
      if (addHero()) log('카드 세계의 영웅 ①: 영웅의 탄생을 패에 추가', 'mine');
      log('카드 세계의 영웅 소환!', 'mine'); sendGameState(); renderAll();
      return;
    }

    case '단단한 카드 자물쇠': {
      if (G.opField.length === 0 && !G.opFieldCard) { notify('대상으로 할 카드가 없습니다.'); return; }
      const targets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
      openCardPicker(targets, '단단한 카드 자물쇠: 상대 필드 카드 1장 효과 무효', 1, (selected) => {
        if (selected.length > 0) {
          const t = targets[selected[0]];
          log(`단단한 카드 자물쇠: ${t.name} 효과 턴 종료시까지 무효`, 'mine');
          sendAction({ type: 'negateField', cardId: t.id });
        }
        G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
        sendGameState(); renderAll();
      });
      return;
    }

    case '서치 봉인의 항아리':
      gameConfirm(
        '서치 봉인의 항아리\n확인 = ① 덱으로 되돌리고 1장 드로우\n취소 = ② 버려서 이 턴 서치 봉인',
        (choice) => {
          if (choice) {
            G.myHand.splice(handIdx, 1);
            G.myDeck.push({ id: c.id, name: c.name });
            G.myDeck = shuffle(G.myDeck);
            drawOne();
            log('서치 봉인의 항아리 ①: 덱으로 + 드로우', 'mine');
          } else {
            G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
            log('서치 봉인의 항아리 ②: 이 턴 서치 봉인!', 'mine');
            sendAction({ type: 'searchBan', reason: '서치 봉인의 항아리' });
          }
          sendGameState(); renderAll();
        }
      );
      return;

    case '유혹의 황금사과':
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      G.goldenAppleActive = true;
      log('유혹의 황금사과 발동! 이 턴 상대 소환 시마다 1장 드로우', 'mine');
      sendGameState(); renderAll();
      return;

    case '수호의 빛':
      if (G.myFieldCard) G.myGrave.push(G.myFieldCard);
      G.myFieldCard = { id: c.id, name: c.name };
      G.myHand.splice(handIdx, 1);
      if (G.myExile.length > 0) {
        openCardPicker(G.myExile, '수호의 빛: 제외된 카드 1장 패에 넣기 (선택)', 1, (selected) => {
          if (selected.length > 0) {
            const ec = G.myExile.splice(selected[0], 1)[0];
            G.myHand.push({ id: ec.id, name: ec.name, isPublic: true });
            log(`수호의 빛: ${ec.name} 패로`, 'mine');
          }
          sendGameState(); renderAll();
        });
      }
      log('수호의 빛 필드 발동!', 'mine');
      sendGameState(); renderAll();
      return;

    case '신성한 수호자': {
      G.myExile.push(G.myHand.splice(handIdx, 1)[0]);
      G.exileBanActive = true;
      log('신성한 수호자 ①: 이 턴 서로 카드 제외 불가!', 'mine');
      sendAction({ type: 'exileBan' });
      const lightIdx = G.myDeck.findIndex(dc => dc.id === '수호의 빛');
      if (lightIdx >= 0) {
        G.myDeck.splice(lightIdx, 1);
        G.myHand.push({ id: '수호의 빛', name: '수호의 빛', isPublic: true });
        log('신성한 수호자 ②: 수호의 빛 서치!', 'mine');
      }
      sendGameState(); renderAll();
      return;
    }

    case '일격필살':
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      log('일격필살: 상대 패 1장 버리기!', 'mine');
      sendAction({ type: 'forceDiscard', count: 1, reason: '일격필살', attackerPicks: true });
      sendGameState(); renderAll();
      return;

    case '단 한번의 기회':
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      drawOne();
      log('단 한번의 기회: 드로우!', 'mine');
      sendGameState(); renderAll();
      return;

    default:
      G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
      log(`발동: ${c.name}`, 'mine');
      notify(`${c.name} 발동! (효과를 수동으로 처리하세요)`);
      sendGameState(); renderAll();
  }
}

// ─────────────────────────────────────────────
// GAME INIT
// ─────────────────────────────────────────────
function goToDeckBuilder() {
  document.getElementById('lobby').style.display = 'none';
  const existing = document.getElementById('waitingOverlay');
  if (existing) existing.remove();
  document.getElementById('deckBuilder').style.display = 'flex';
  filterDeckPool('전체');
  renderBuilderDeck();
  if (myRole === 'guest') notify('게임이 시작됐습니다! 덱을 구성해주세요.');
}

function enterGame() {
  opName = myRole === 'host' ? '게스트' : '호스트';
  myName = document.getElementById('playerName').value.trim() || (myRole === 'host' ? '호스트' : '게스트');

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display  = 'flex';
  document.getElementById('hdrMyName').textContent  = myName;
  document.getElementById('hdrOpName').textContent  = opName;
  document.getElementById('hdrRoomCode').textContent = roomCode;
  document.getElementById('myNameLabel').textContent = myName;
  document.getElementById('opNameLabel').textContent = opName;

  // 상태 초기화
  timeoutHandled        = false;
  lastSyncedClockRunner = null;
  lastHandledActionTs   = 0;
  lastLogTs             = 0;
  gameActionListenerActive = false;
  gameClock = { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() };
  G.myExtraSlots       = 0;
  G.opExtraSlots       = 0;
  G.penguinHeroAtkBuff = false;
  attackedMonstersThisTurn.clear();

  listenOpponentState();
  listenChainState();
  listenClockState();
  listenGameActions();
  listenOpponentLog();
  startClockTicker();

  if (!roomRef) {
    _startNewGame();
    return;
  }

  const myPath = myRole === 'host' ? 'hostState' : 'guestState';
  roomRef.child(myPath).once('value').then(snap => {
    const data = snap.val();
    if (data && data.ts && data.hand && data.hand.length > 0) {
      // 재접속: 저장된 상태 복원
      G.myHand    = data.hand.map(c => ({ id: c.id, name: c.name, isPublic: c.isPublic || false }));
      G.myField   = data.field    || [];
      G.myGrave   = data.grave    || [];
      G.myExile   = data.exile    || [];
      G.myFieldCard = data.fieldCard || null;
      G.myKeyDeck = (data.keyDeck || []).map(c => ({ id: c.id, name: c.name }));

      const deckList = data.deckList || window._confirmedDeck || null;
      G.myDeck      = deckList
        ? shuffle(deckList.map(id => ({ id, name: CARDS[id]?.name || id })))
        : [];
      G.myDeckCount = G.myDeck.length;

      roomRef.child('roomPhase').once('value').then(phSnap => {
        const ph = phSnap.val();
        if (ph) {
          isMyTurn = ph.activePlayer === myRole;
          advancePhase(ph.phase || 'deploy');
        } else {
          isMyTurn = myRole === 'host';
          advancePhase('deploy');
        }
        log('재접속: 이전 게임 상태 복원!', 'system');
        notify('재접속: 이전 상태를 복원했습니다.');
        renderAll();
      });
    } else {
      _startNewGame();
    }
  });
}

function _startNewGame() {
  initDecks();
  const startCards = myRole === 'host' ? 6 : 7;
  drawN(startCards);
  isMyTurn = myRole === 'host';

  if (myRole === 'host') {
    advancePhase('deploy');
    log('선공 첫 턴: 드로우 없이 전개 단계 시작', 'system');
    if (roomRef) {
      roomRef.child('clock').set({ host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() });
      roomRef.child('roomPhase').set({ activePlayer: 'host', phase: 'deploy' });
    }
  } else {
    advancePhase('draw');
    if (roomRef) {
      roomRef.child('roomPhase').set({ activePlayer: 'host', phase: 'draw' });
    }
  }

  sendGameState();
  log('게임 시작!', 'system');
  renderAll();
}

function initDecks() {
  const penguinDeck = [
    '펭귄 마을','펭귄 마을','펭귄 마을','펭귄 마을',
    '꼬마 펭귄','꼬마 펭귄','꼬마 펭귄','꼬마 펭귄',
    '펭귄 부부','펭귄 부부','펭귄 부부','펭귄 부부',
    '현자 펭귄','현자 펭귄','현자 펭귄','현자 펭귄',
    '수문장 펭귄','수문장 펭귄','수문장 펭귄','수문장 펭귄',
    '펭귄!돌격!','펭귄!돌격!','펭귄!돌격!','펭귄!돌격!',
    '펭귄의 영광','펭귄의 영광','펭귄의 영광','펭귄의 영광',
    '펭귄이여 영원하라','펭귄이여 영원하라','펭귄이여 영원하라','펭귄이여 영원하라',
    '펭귄 마법사','펭귄 마법사','펭귄 마법사','펭귄 마법사',
    '구사일생','구사일생','눈에는 눈','눈에는 눈',
  ];
  const keyDeck = ['펭귄 용사','펭귄의 일격','펭귄의 전설','일격필살','단 한번의 기회'];

  const baseDeck    = window._confirmedDeck    || penguinDeck;
  const baseKeyDeck = window._confirmedKeyDeck || keyDeck;

  G.myDeck    = shuffle(baseDeck.map(id => ({ id, name: CARDS[id]?.name || id })));
  G.myKeyDeck = baseKeyDeck.map(id => ({ id, name: CARDS[id]?.name || id }));
  G.myHand    = [];
  G.myField   = [];
  G.myGrave   = [];
  G.myExile   = [];
  G.myFieldCard = null;
  G.myDeckCount = G.myDeck.length;

  G.opHand    = [];
  G.opField   = [];
  G.opGrave   = [];
  G.opExile   = [];
  G.opFieldCard = null;
  G.opKeyDeck   = Array.from({ length: baseKeyDeck.length }, () => ({ id: 'unknown', name: '?' }));
  G.opDeckCount = 40;
}

// ─────────────────────────────────────────────
// GLOBAL ERROR DISPLAY (디버깅용)
// ─────────────────────────────────────────────
window.onerror = function(msg, src, line, col) {
  const div = document.createElement('div');
  div.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0',
    'background:#c84848', 'color:#fff', 'padding:8px',
    'font-size:11px', 'z-index:9999',
    'word-break:break-all', 'max-height:30vh', 'overflow-y:auto',
  ].join(';');
  div.textContent = `오류 [${line}:${col}]: ${msg}`;
  document.body.appendChild(div);
  return false;
};

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.getElementById('playerName').focus();

if (DEMO_MODE) {
  document.getElementById('createStatus').textContent = 'DEMO 모드 활성화';
}
