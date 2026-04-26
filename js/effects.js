// effects.js — 페이즈, 전투, 승리조건, 체인, 범용 카드 효과
// GAME ACTIONS (sent to Firebase)
// ─────────────────────────────────────────────
function doDrawPhase() {
  if (!isMyTurn || currentPhase !== 'draw') return;
  drawOne();
  advancePhase('deploy');
  log('드로우 단계 완료', 'mine');
  sendAction({ type: 'phaseChange', phase: 'deploy' });
  if (roomRef) roomRef.child('roomPhase').set({ activePlayer: myRole, phase: 'deploy' });
}

function drawCards(n) {
  for (let i = 0; i < n; i++) {
    if (!G.myDeck || G.myDeck.length === 0) {
      if (G.myGrave && G.myGrave.length > 0) {
        G.myDeck = shuffle([...G.myGrave]);
        G.myGrave = [];
        log('덱 소진 → 묘지를 덱으로 되돌렸습니다.', 'system');
      } else {
        notify('덱과 묘지 모두 비어있습니다.'); break;
      }
    }
    const card = G.myDeck.shift();
    G.myHand.push({ id: card.id, name: card.name, isPublic: false });
  }
  renderMyHand();
  renderCounts();
  sendGameState(); // 상태 동기화
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
  log(`전개 단계 종료`, 'mine');
  sendAction({ type: 'phaseEnd', phase: 'deploy' });
  if (roomRef) roomRef.child('roomPhase').set({ activePlayer: myRole, phase: 'attack' });
}

function endAttack() {
  if (!isMyTurn || currentPhase !== 'attack') return;
  advancePhase('end');
  log(`공격 단계 종료`, 'mine');
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
  // 페이즈 상태 저장 (재접속 복원용)
  const opRole = myRole === 'host' ? 'guest' : 'host';
  if (roomRef) roomRef.child('roomPhase').set({ activePlayer: opRole, phase: 'draw' });
  renderPhase();
}

function summonMonster(handIdx) {
  notify('통상 소환은 없습니다. 카드 효과로만 소환할 수 있습니다.');
}

// activateCard: 아래 두 번째 정의 사용

function executeCombat(atkIdx, defIdx) {
  if (!isMyTurn || currentPhase !== 'attack') { notify('공격 단계가 아닙니다.'); return; }
  const attacker = G.myField[atkIdx];
  const defender = G.opField[defIdx];
  if (!attacker || !defender) return;
  if (attackedMonstersThisTurn.has(attacker.id)) { notify('이 몬스터는 이번 턴에 이미 공격했습니다.'); return; }
  // 수호의 빛: 공격 단계에 1회만 공격 가능
  if ((G.myFieldCard?.id === '수호의 빛' || G.opFieldCard?.id === '수호의 빛') && attackedMonstersThisTurn.size > 0) {
    notify('수호의 빛: 공격 단계에 몬스터 하나로만 공격할 수 있습니다.');
    return;
  }

  const diff = attacker.atk - defender.atk;
  log(`전투: ${attacker.name}(${attacker.atk}) vs ${defender.name}(${defender.atk})`, 'mine');

  if (diff > 0) {
    // 내 몬스터 승리 — 상대 묘지, 상대 패 diff장 손실 (내가 공격자니까 상대 공개패 우선 선택)
    G.opField.splice(defIdx, 1);
    G.opGrave.push(defender);
    log(`${defender.name} 묘지. 상대 패 ${diff}장 손실`, 'system');
    notify(`공격 성공! 상대 패 ${diff}장 손실`);
    // 상대에게 forceDiscard 전송 (공개패 우선)
    sendAction({ type: 'forceDiscard', count: diff, attackerPicks: true });
  } else if (diff < 0) {
    // 상대 몬스터 승리 — 내 묘지, 내 패 |diff|장 손실
    G.myField.splice(atkIdx, 1);
    G.myGrave.push(attacker);
    log(`${attacker.name} 묘지. 내 패 ${Math.abs(diff)}장 버리기`, 'mine');
    // 묘지 트리거 (펭귄 용사 ③ 등)
    onSentToGrave(attacker.id);
    // 펭귄 마을 ② 체크 먼저
    const replaced = checkPenguinVillageReplace(Math.abs(diff));
    if (!replaced) {
      // 구사일생 체크: 공격력 차 >= 내 패 수일 때 발동 가능
      const guIdxInHand = G.myHand.findIndex(c => c.id === '구사일생');
      if (guIdxInHand >= 0 && Math.abs(diff) >= G.myHand.length) {
        gameConfirm(`구사일생 발동?\n전투 데미지 0 + 드로우 1장\n조건: 공격력 차(${Math.abs(diff)}) ≥ 패 수(${G.myHand.length})`, (yes) => {
          if (!yes) { forceDiscard(Math.abs(diff), true); return; }
          G.myHand.splice(guIdxInHand, 1);
          G.myGrave.push({ id: '구사일생', name: '구사일생' });
          drawOne();
          log('구사일생: 전투 데미지 0 + 드로우', 'mine');
          sendGameState(); renderAll();
        });
        return; // 비동기 처리 — 이후 코드는 gameConfirm 콜백 안에서 실행됨
      }
      forceDiscard(Math.abs(diff), true);
    }
  } else {
    if (attacker.atk === 0) {
      log(`공격력 0 — 양쪽 유지`, 'system');
    } else {
      G.myField.splice(atkIdx, 1);
      G.opField.splice(defIdx, 1);
      G.myGrave.push(attacker);
      G.opGrave.push(defender);
      log(`공격력 동일 — 양쪽 묘지`, 'system');
      onSentToGrave(attacker.id);
    }
  }
  sendAction({ type: 'combat', atkIdx, defIdx, atkCard: attacker, defCard: defender });
  attackedMonstersThisTurn.add(attacker.id);
  sendGameState(); renderAll();
}

function directAttack(atkIdx) {
  if (!isMyTurn || currentPhase !== 'attack') return;
  const attacker = G.myField[atkIdx];
  if (!attacker) return;
  if (attackedMonstersThisTurn.has(attacker.id)) { notify('이 몬스터는 이번 턴에 이미 공격했습니다.'); return; }
  if (G.opField.length > 0) { notify('상대 필드에 몬스터가 있습니다. 직접 공격 불가.'); return; }
  log(`직접 공격: ${attacker.name}(${attacker.atk}) — 상대는 패를 ${attacker.atk}장 버려야 합니다.`, 'mine');
  notify(`직접 공격! 상대 패 ${attacker.atk}장 손실`);
  sendAction({ type: 'directAttack', card: attacker });
  attackedMonstersThisTurn.add(attacker.id);
  sendGameState(); renderAll();
}

function forceDiscard(n, opponentPicks = false) {
  if (G.myHand.length === 0) { checkWinCondition(); return; }
  const actualN = Math.min(n, G.myHand.length);

  if (opponentPicks) {
    // 상대가 내 패를 고름
    // 공개패: 상대가 볼 수 있으므로 상대가 고른 것으로 처리 (가장 위협적인 것 우선)
    // 비공개패: 무작위
    const publicCards = G.myHand.filter(c => c.isPublic);
    let remaining = actualN;
    const toDiscard = [];

    // 공개패 먼저 (상대 시점에서 가장 유리한 선택)
    publicCards.slice(0, remaining).forEach(c => { toDiscard.push(c); remaining--; });
    // 비공개패 무작위
    const privateCards = G.myHand.filter(c => !c.isPublic);
    while (remaining > 0 && privateCards.length > 0) {
      const idx = Math.floor(Math.random() * privateCards.length);
      toDiscard.push(privateCards.splice(idx, 1)[0]);
      remaining--;
    }

    const names = toDiscard.map(c => c.name).join(', ');
    log(`상대가 선택: ${names}`, 'mine');
    notify(`상대 효과: ${names} 버림`);

    toDiscard.forEach(c => {
      const hi = G.myHand.findIndex(h => h.id === c.id && h.isPublic === c.isPublic);
      if (hi >= 0) G.myGrave.push(G.myHand.splice(hi, 1)[0]);
    });
    sendGameState(); renderAll(); checkWinCondition();
  } else {
    // 내가 고름
    openCardPicker(
      G.myHand,
      `패를 ${actualN}장 버려야 합니다 (${actualN}장 선택)`,
      actualN,
      (selected) => {
        selected.sort((a,b) => b-a).forEach(i => {
          if (G.myHand[i]) { G.myGrave.push(G.myHand.splice(i, 1)[0]); }
        });
        // 덜 선택했으면 나머지 무작위
        const remaining = actualN - selected.length;
        for (let i = 0; i < remaining && G.myHand.length > 0; i++) {
          const ri = Math.floor(Math.random() * G.myHand.length);
          G.myGrave.push(G.myHand.splice(ri, 1)[0]);
        }
        sendGameState(); renderAll(); checkWinCondition();
      }
    );
  }
}

// ─────────────────────────────────────────────
// WIN CONDITION
// ─────────────────────────────────────────────
function checkWinCondition() {
  if (G.myHand.length === 0) {
    showGameOver(false);
    sendAction({ type: 'gameOver', winner: myRole === 'host' ? 'guest' : 'host' });
  }
}

function showGameOver(win) {
  const el = document.getElementById('gameover');
  const title = document.getElementById('gameoverTitle');
  const msg = document.getElementById('gameoverMsg');
  el.classList.add('show');
  if (win) {
    title.textContent = '승리!';
    title.className = 'gameover-title win';
    msg.textContent = '상대의 패를 모두 털었습니다.';
  } else {
    title.textContent = '패배...';
    title.className = 'gameover-title lose';
    msg.textContent = '패가 0장이 되었습니다.';
  }
  recordGameResult(win);
}

function concede() {
  gameConfirm('정말 항복하시겠습니까?', (yes) => {
    if (!yes) return;
    showGameOver(false);
    sendAction({ type: 'gameOver', winner: myRole === 'host' ? 'guest' : 'host' });
  });
}

function beginChain(effect) {
  const chainState = {
    active: true,
    startedBy: myRole,
    priority: myRole === 'host' ? 'guest' : 'host',
    passCount: 0,
    links: [{ ...effect, by: myRole }],
  };
  activeChainState = chainState;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 1: ${effect.label} 발동`, 'mine');

  if (!roomRef) {
    // 로컬/데모: 상대 자동 패스 → 즉시 해결
    const localState = { ...chainState, passCount: 2 };
    resolveChain(localState);
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
    if (!sel || sel.length === 0) return; // 취소 시 무시
    const picked = options[sel[0]];
    if (!picked) return;
    addChainLink({
      type: 'keyFetch',
      label: `키 카드 가져오기 (${picked.name})`,
      cardId: picked.id,
    });
  });
}

function passChainPriority() {
  if (!activeChainState || !activeChainState.active || activeChainState.priority !== myRole) return;

  const next = { ...activeChainState };
  next.passCount = (next.passCount || 0) + 1;
  next.priority = myRole === 'host' ? 'guest' : 'host';
  log('체인 패스', 'system');

  if (next.passCount >= 2) {
    resolveChain(next);
    return;
  }

  if (!roomRef) {
    // 로컬/데모: 상대도 자동 패스 → 즉시 해결
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
  const next = { ...activeChainState };
  next.links = [...(next.links || []), { ...effect, by: myRole }];
  next.priority = myRole === 'host' ? 'guest' : 'host';
  next.passCount = 0;
  activeChainState = next;
  if (effect.type === 'keyFetch') usedKeyFetchInChain[myRole] = true;
  log(`체인 ${next.links.length}: ${effect.label}`, 'mine');

  if (!roomRef) {
    // 로컬: 상대 패스 자동 처리 → 즉시 해결
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

  const queued = [...pendingTriggerEffects];
  pendingTriggerEffects = [];

  if (!roomRef) {
    const links = queued.map(e => ({ ...e, by: myRole }));
    executeChainLocally(links.reverse());
    return;
  }

  beginChain(queued[0]);
  queued.slice(1).forEach(e => addChainLink(e));
}

function activateQuickEffect(effect) {
  if (activeChainState && activeChainState.active) {
    if (activeChainState.priority !== myRole) {
      notify('현재 체인 우선권은 상대에게 있습니다. (체인 시작 직후에는 상대가 먼저 응답)');
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
      notify('현재 체인 우선권은 상대에게 있습니다. (체인 시작 직후에는 상대가 먼저 응답)');
      return;
    }
    addChainLink(effect);
    return;
  }
  beginChain(effect);
}

function ensureCardInstanceId(card) {
  if (!card) return null;
  if (!card._iid) {
    ensureCardInstanceId._seq = (ensureCardInstanceId._seq || 0) + 1;
    card._iid = `cid_${Date.now()}_${ensureCardInstanceId._seq}`;
  }
  return card._iid;
}

function findCardIndexByInstanceId(zone, instanceId) {
  if (!Array.isArray(zone) || !instanceId) return -1;
  return zone.findIndex(c => c && c._iid === instanceId);
}

function resolveChain(chainState) {
  const links = [...(chainState.links || [])];
  const resolvedAt = Date.now();
  usedKeyFetchInChain = {};
  activeChainState = null; // ★ 즉시 초기화 → 버튼 정상화
  renderChainActions();
  if (roomRef) {
    roomRef.child('chainState').set({ active: false, links: [], priority: null, passCount: 0, resolvedLinks: links, resolvedAt });
  } else {
    executeChainLocally(links.slice().reverse());
  }
}

function executeChainLocally(links) {
  links.forEach(link => {
    if (link.by !== myRole) return;
    if (link.type === 'keyFetch') {
      resolveKeyFetch(link.cardId);
    } else if (link.type === 'penguinVillage1') {
      resolvePenguinVillage1();
    } else if (link.type === 'triggerKkomaPenguin') {
      resolveKkomaPenguin();
    } else if (link.type === 'triggerPenguinBubu1') {
      resolvePenguinBubu1();
    } else if (link.type === 'triggerPenguinHero1') {
      resolvePenguinHero1();
    } else if (link.type === 'triggerPenguinLegend1') {
      resolvePenguinLegend1();
    } else if (link.type === 'triggerPenguinWizard2') {
      resolvePenguinWizard2();
    } else if (link.type === 'triggerPenguinHero3') {
      resolvePenguinHero3();
    } else if (link.type === 'quickPenguinHero2') {
      resolvePenguinHero2();
    } else if (link.type === 'quickPenguinLegend2') {
      resolvePenguinLegend2();
    } else if (link.type === 'quickPenguinStrike1') {
      resolvePenguinStrike1();
    } else if (link.type === 'quickPenguinForever2') {
      resolvePenguinForever2();
    } else if (link.type === 'ignitionPenguinBubu2') {
      resolvePenguinBubu2();
    } else if (link.type === 'ignitionSagePenguin1') {
      resolveSagePenguin1();
    } else if (link.type === 'ignitionSagePenguin2') {
      resolveSagePenguin2();
    } else if (link.type === 'ignitionSummonerPenguin1') {
      resolveSummonerPenguin1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinCharge1') {
      resolvePenguinCharge1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinCharge2') {
      resolvePenguinCharge2();
    } else if (link.type === 'ignitionPenguinGlory1') {
      resolvePenguinGlory1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinGlory2') {
      resolvePenguinGlory2();
    } else if (link.type === 'ignitionPenguinForever1') {
      resolvePenguinForever1();
    } else if (link.type === 'ignitionPenguinWizard1') {
      resolvePenguinWizard1();
    } else if (link.type === 'ignitionPenguinWizard3') {
      resolvePenguinWizard3();
    } else if (link.type === 'themeEffect') {
      resolveThemeEffect(link);
    }
  });
  sendGameState();
  renderAll();
  usedKeyFetchInChain = {};
}


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

// ★ 강제 패 버리기 — 반드시 1장 선택해야 함, 취소 불가
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
  }, true); // forced=true: 반드시 선택, 취소 불가
}

function resolveKeyFetch(cardId) {
  const idx = G.myKeyDeck.findIndex(c => c.id === cardId);
  if (idx < 0) { notify(`키 카드 덱에 ${CARDS[cardId]?.name || cardId}가 없습니다.`); return; }

  // ★ 카드별 가져오기 조건 체크
  if (cardId === '펭귄 용사') {
    // "상대 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있다"
    if (G.opField.length === 0) {
      notify('펭귄 용사: 상대 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
      return;
    }
  }
  if (cardId === '펭귄의 전설') {
    // "자신 필드에 몬스터가 존재할 경우에만 패에 넣을 수 있다"
    if (G.myField.length === 0) {
      notify('펭귄의 전설: 자신 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
      return;
    }
  }

  const c = G.myKeyDeck.splice(idx, 1)[0];
  G.myHand.push({ id: c.id, name: c.name, isPublic: true });
  log(`키 카드 가져오기: ${c.name} (공개패)`, 'mine');
  sendGameState(); renderAll();
}

function resolvePenguinVillage1() {
  const idx = G.myHand.findIndex(c => c.id === '펭귄 마을' && !c.isPublic);
  if (idx < 0) return;
  G.myHand[idx].isPublic = true;
  markEffectUsed('펭귄 마을', 1);
  log('체인 처리: 펭귄 마을 ① 공개', 'mine');
}

function renderFieldZones() {}

// ENTER GAME
// ─────────────────────────────────────────────
function enterGame() {
  opName = myRole === 'host' ? '게스트' : '호스트';
  myName = document.getElementById('playerName').value.trim() || (myRole === 'host' ? '호스트' : '게스트');

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'flex';

  document.getElementById('hdrMyName').textContent = myName;
  document.getElementById('hdrOpName').textContent = opName;
  document.getElementById('hdrRoomCode').textContent = roomCode;
  document.getElementById('myNameLabel').textContent = myName;
  document.getElementById('opNameLabel').textContent = opName;

  timeoutHandled = false;
  lastSyncedClockRunner = null;
  lastHandledActionTs = 0;
  lastLogTs = 0;
  gameActionListenerActive = false;
  gameClock = { host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now() };
  G.myExtraSlots = 0;
  G.opExtraSlots = 0;
  G.penguinHeroAtkBuff = false;
  attackedMonstersThisTurn.clear();

  listenOpponentState();
  listenChainState();
  listenClockState();
  listenGameActions();
  listenOpponentLog();
  startClockTicker();

  if (!roomRef) {
    // DEMO 모드: 항상 새 게임
    _startNewGame();
    return;
  }

  // Firebase에 내 상태가 있는지 먼저 확인
  const myPath = myRole === 'host' ? 'hostState' : 'guestState';
  roomRef.child(myPath).once('value').then(snap => {
    const data = snap.val();
    if (data && data.ts && data.hand && data.hand.length > 0) {
      // ★ 재접속: Firebase 상태 복원 (새 패 뽑지 않음, initDecks 호출 안 함)
      G.myHand = data.hand.map(c => ({ id: c.id, name: c.name, isPublic: c.isPublic || false }));
      G.myField = data.field || [];
      G.myGrave = data.grave || [];
      G.myExile = data.exile || [];
      G.myFieldCard = data.fieldCard || null;
      G.myKeyDeck = (data.keyDeck || []).map(c => ({ id: c.id, name: c.name }));

      // 덱은 저장된 deckList로 재구성 (없으면 기본 펭귄 덱)
      const deckList = data.deckList || window._confirmedDeck || null;
      if (deckList) {
        G.myDeck = shuffle(deckList.map(id => ({ id, name: CARDS[id]?.name || id })));
      } else {
        G.myDeck = []; // 덱 소진 시 묘지로 복구됨
      }
      G.myDeckCount = G.myDeck.length;

      // 페이즈/턴 복원
      roomRef.child('roomPhase').once('value').then(phSnap => {
        const ph = phSnap.val();
        if (ph) {
          isMyTurn = (ph.activePlayer === myRole);
          advancePhase(ph.phase || 'deploy');
        } else {
          isMyTurn = (myRole === 'host');
          advancePhase('deploy');
        }
        log('재접속: 이전 게임 상태 복원!', 'system');
        notify('재접속: 이전 상태를 복원했습니다.');
        renderAll();
      });
    } else {
      // ★ 새 게임
      _startNewGame();
    }
  });
}

function _startNewGame() {
  initDecks();
  const startCards = (myRole === 'host') ? 6 : 7;
  drawCards(startCards);
  isMyTurn = (myRole === 'host');

  if (myRole === 'host') {
    advancePhase('deploy');
    log('선공 첫 턴: 드로우 없이 전개 단계 시작', 'system');
    if (roomRef) {
      roomRef.child('clock').set({
        host: 500, guest: 500, runningFor: 'host', lastUpdated: Date.now()
      });
      // 페이즈 상태 저장
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
  // 덱빌더에서 확정한 덱 우선, 없으면 펭귄 기본덱으로 폴백
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
  const keyDeck = ['펭귄 용사', '펭귄의 일격', '펭귄의 전설', '일격필살', '단 한번의 기회'];

  const baseDeck = window._confirmedDeck || penguinDeck;
  const baseKeyDeck = window._confirmedKeyDeck || keyDeck;
  G.myDeck = shuffle(baseDeck.map(id => ({ id, name: CARDS[id]?.name || id })));
  G.myKeyDeck = baseKeyDeck.map(id => ({ id, name: CARDS[id]?.name || id }));
  G.myHand = [];
  G.myField = [];
  G.myGrave = [];
  G.myExile = [];
  G.myFieldCard = null;
  G.myDeckCount = G.myDeck.length;
  G.opHand = [];
  G.opField = [];
  G.opGrave = [];
  G.opExile = [];
  G.opFieldCard = null;
  G.opKeyDeck = Array.from({ length: baseKeyDeck.length }, () => ({ id: 'unknown', name: '?' }));
  G.opDeckCount = 40;
}

function activateCard(handIdx) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  const dynamicThemes = ['크툴루', '올드 원', '라이온', '타이거', '라이거', '마피아', '불가사의'];
  if (card && dynamicThemes.includes(card.theme)) {
    activateThemeCardEffectFromHand(handIdx, 1);
    return;
  }

  switch(c.id) {
    case '구사일생':
      notify('구사일생은 전투 시 자동으로 발동 여부를 물어봅니다.');
      return;

    case '눈에는 눈':
      // 상대 서치 시 자동 트리거 — 수동으로도 발동 가능
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      drawN(2);
      log('눈에는 눈: 드로우 2장!', 'mine');
      sendGameState(); renderAll();
      return;

    case '출입통제':
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      log('출입통제 발동! 상대 소환 효과 무효', 'mine');
      sendAction({ type: 'negate', reason: '출입통제', cardId: c.id });
      sendGameState(); renderAll();
      return;

    case '단단한 카드 자물쇠':
      if (G.opField.length === 0 && !G.opFieldCard) { notify('대상으로 할 카드가 없습니다.'); return; }
      openCardPicker(
        [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])],
        '단단한 카드 자물쇠: 상대 필드 카드 1장 효과 무효',
        1,
        (selected) => {
          const targets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
          if (selected.length > 0) {
            const t = targets[selected[0]];
            log(`단단한 카드 자물쇠: ${t.name} 효과 턴 종료시까지 무효`, 'mine');
            sendAction({ type: 'negateField', cardId: t.id });
          }
          G.myHand.splice(handIdx, 1);
          G.myGrave.push({ id: c.id, name: c.name });
          sendGameState(); renderAll();
        }
      );
      return;

    case '서치 봉인의 항아리':
      // ① 덱으로 되돌리고 드로우  ② 버려서 서치 봉인
      gameConfirm('서치 봉인의 항아리\n확인 = ① 덱으로 되돌리고 1장 드로우\n취소 = ② 버려서 이 턴 서치 봉인', (choice) => {
        if (choice) {
          G.myHand.splice(handIdx, 1);
          G.myDeck.push({ id: c.id, name: c.name });
          G.myDeck = shuffle(G.myDeck);
          drawOne();
          log('서치 봉인의 항아리 ①: 덱으로 + 드로우', 'mine');
        } else {
          G.myHand.splice(handIdx, 1);
          G.myGrave.push({ id: c.id, name: c.name });
          log('서치 봉인의 항아리 ②: 이 턴 서치 봉인!', 'mine');
          sendAction({ type: 'searchBan', reason: '서치 봉인의 항아리' });
        }
        sendGameState(); renderAll();
      });
      return;

    case '유혹의 황금사과':
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      G.goldenAppleActive = true;
      log('유혹의 황금사과 발동! 이 턴 상대 소환 시마다 1장 드로우', 'mine');
      sendGameState(); renderAll();
      return;

    case '수호의 빛':
      // 필드 마법
      if (G.myFieldCard) G.myGrave.push(G.myFieldCard);
      G.myHand.splice(handIdx, 1);
      G.myFieldCard = { id: c.id, name: c.name };
      // 발동 시 제외된 카드 패에 넣기
      if (G.myExile.length > 0) {
        openCardPicker(
          G.myExile,
          '수호의 빛: 제외된 카드 1장 패에 넣기 (선택)',
          1,
          (selected) => {
            if (selected.length > 0) {
              const ec = G.myExile.splice(selected[0], 1)[0];
              G.myHand.push({ id: ec.id, name: ec.name, isPublic: true });
              log(`수호의 빛: ${ec.name} 패로`, 'mine');
            }
            sendGameState(); renderAll();
          }
        );
      }
      log('수호의 빛 필드 발동!', 'mine');
      sendGameState(); renderAll();
      return;

    case '신성한 수호자':
      // ① 패에서 제외 → 이 턴 제외 불가
      G.myHand.splice(handIdx, 1);
      G.myExile.push({ id: c.id, name: c.name });
      G.exileBanActive = true;
      log('신성한 수호자 ①: 이 턴 서로 카드 제외 불가!', 'mine');
      sendAction({ type: 'exileBan' });
      // ② 제외됐으면 수호의 빛 서치 자동
      const lightIdx = G.myDeck.findIndex(dc => dc.id === '수호의 빛');
      if (lightIdx >= 0) {
        G.myDeck.splice(lightIdx, 1);
        G.myHand.push({ id: '수호의 빛', name: '수호의 빛', isPublic: true });
        log('신성한 수호자 ②: 수호의 빛 서치!', 'mine');
      }
      sendGameState(); renderAll();
      return;

    case '일격필살':
      // 키카드 — 상대 패 1장 버리기
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      log('일격필살: 상대 패 1장 버리기!', 'mine');
      sendAction({ type: 'forceDiscard', count: 1, reason: '일격필살', attackerPicks: true });
      sendGameState(); renderAll();
      return;

    case '단 한번의 기회':
      // 키카드 — 드로우 1장
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      drawOne();
      log('단 한번의 기회: 드로우!', 'mine');
      sendGameState(); renderAll();
      return;

    default:
      // 기본 처리
      G.myHand.splice(handIdx, 1);
      G.myGrave.push({ id: c.id, name: c.name });
      log(`발동: ${c.name}`, 'mine');
      notify(`${c.name} 발동! (효과를 수동으로 처리하세요)`);
      sendGameState(); renderAll();
  }
}

function _extractEffectText(card, effectNum) {
  const raw = (card?.effects || '').split('\n').map(s => s.trim()).filter(Boolean);
  const bullet = ['①', '②', '③'][effectNum - 1];
  const found = raw.find(line => line.startsWith(bullet));
  return found || '';
}

function _inferThemePredicate(theme) {
  if (!theme) return () => true;
  if (theme === '라이거') {
    return c => ['라이거', '라이온', '타이거'].includes(CARDS[c.id]?.theme);
  }
  if (theme === '올드 원') {
    return c => ['올드 원', '크툴루'].includes(CARDS[c.id]?.theme);
  }
  return c => CARDS[c.id]?.theme === theme;
}

function _readCount(text, fallback = 1) {
  const m = text.match(/(\d+)장/);
  return m ? Math.max(1, parseInt(m[1], 10)) : fallback;
}

function _splitCostAndMain(effectText) {
  const marker = '발동할 수 있다.';
  const idx = effectText.indexOf(marker);
  if (idx < 0) return { costText: '', mainText: effectText };
  return {
    costText: effectText.slice(0, idx + marker.length).trim(),
    mainText: effectText.slice(idx + marker.length).trim(),
  };
}

function _isExileCostBlocked(costText) {
  if (!G.exileBanActive) return false;
  if (!costText) return false;
  return costText.includes('제외');
}

function _sendCardFromHandToZone(handIdx, zone = 'grave') {
  const card = G.myHand[handIdx];
  if (!card) return false;
  if (zone === 'grave') G.myGrave.push(G.myHand.splice(handIdx, 1)[0]);
  else if (zone === 'exile') G.myExile.push(G.myHand.splice(handIdx, 1)[0]);
  return true;
}

function _payThemeCost(card, handIdx, costText, done) {
  if (!costText) { done(true); return; }
  if (_isExileCostBlocked(costText)) {
    notify('신성한 수호자 효과로 제외 코스트를 지불할 수 없어 발동할 수 없습니다.');
    done(false);
    return;
  }

  // 이 카드 처리(버리기/제외)
  if (costText.includes('이 카드를') && costText.includes('버리')) {
    const idx = G.myHand.findIndex(h => h.id === card.id);
    if (idx < 0) { done(false); return; }
    _sendCardFromHandToZone(idx, 'grave');
  } else if (costText.includes('이 카드를') && costText.includes('제외')) {
    const idx = G.myHand.findIndex(h => h.id === card.id);
    if (idx < 0) { done(false); return; }
    _sendCardFromHandToZone(idx, 'exile');
  } else {
    // 일반 마법/함정은 발동 시 묘지로 처리
    if (['magic', 'trap', 'normal'].includes(card.cardType)) {
      const idx = G.myHand.findIndex(h => h.id === card.id);
      if (idx >= 0) _sendCardFromHandToZone(idx, 'grave');
    }
  }

  if (costText.includes('패') && costText.includes('버리') && !costText.includes('이 카드를')) {
    _forcedDiscardOne(`${card.name}: 코스트로 패 1장 버리기`, () => done(true));
    return;
  }

  if (costText.includes('덱') && costText.includes('제외')) {
    const themePredicate = _inferThemePredicate(card.theme);
    const targets = findAllInDeck(dc => themePredicate(dc));
    if (targets.length === 0) { notify('덱 제외 코스트를 지불할 카드가 없습니다.'); done(false); return; }
    openCardPicker(targets, `${card.name}: 코스트로 덱 카드 제외`, 1, (sel) => {
      if (sel.length === 0) { done(false); return; }
      const picked = targets[sel[0]];
      if (!removeFromDeck(picked.id)) { done(false); return; }
      G.myExile.push({ id: picked.id, name: picked.name || CARDS[picked.id]?.name || picked.id });
      done(true);
    });
    return;
  }
  done(true);
}

function activateThemeCardEffectFromHand(handIdx, effectNum = 1) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!card) return;
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }

  const effectText = _extractEffectText(card, effectNum);
  if (!effectText) { notify('효과 텍스트를 찾을 수 없습니다.'); return; }
  const { costText, mainText } = _splitCostAndMain(effectText);

  _payThemeCost(card, handIdx, costText, (paid) => {
    if (!paid) return;
    markEffectUsed(c.id, effectNum);
    beginChain({
      type: 'themeEffect',
      label: `${c.name} ${effectNum}`,
      cardId: c.id,
      effectNum,
      theme: card.theme,
      mainText,
    });
    sendGameState();
    renderAll();
  });
}

function resolveThemeEffect(link) {
  const mainText = link.mainText || '';
  const cardId = link.cardId;
  const card = CARDS[cardId] || { name: cardId, theme: link.theme };
  const count = _readCount(mainText, 1);
  const themePredicate = _inferThemePredicate(card.theme);

  if (mainText.includes('드로우')) {
    drawN(count);
    log(`${card.name}: ${count}장 드로우`, 'mine');
    return;
  }
  if (mainText.includes('덱') && mainText.includes('서치')) {
    const targets = findAllInDeck(dc => themePredicate(dc));
    if (targets.length === 0) return;
    openCardPicker(targets, `${card.name}: 덱에서 서치`, Math.min(count, targets.length), (sel) => {
      sel.map(i => targets[i]?.id).filter(Boolean).forEach(id => searchToHand(id));
      renderAll();
    });
    return;
  }
  if (mainText.includes('덱') && mainText.includes('소환')) {
    const targets = findAllInDeck(dc => CARDS[dc.id]?.cardType === 'monster' && themePredicate(dc));
    if (targets.length === 0) return;
    openCardPicker(targets, `${card.name}: 덱에서 소환`, 1, (sel) => {
      if (sel.length > 0) summonFromDeck(targets[sel[0]].id);
      renderAll();
    });
    return;
  }
  if (mainText.includes('묘지') && mainText.includes('소환')) {
    const targets = G.myGrave.filter(gc => CARDS[gc.id]?.cardType === 'monster' && themePredicate(gc));
    if (targets.length === 0) return;
    openCardPicker(targets, `${card.name}: 묘지에서 소환`, 1, (sel) => {
      if (sel.length > 0) summonFromGrave(targets[sel[0]].id);
      renderAll();
    });
    return;
  }
  if (mainText.includes('상대') && mainText.includes('묘지')) {
    if (G.opField.length === 0) return;
    openCardPicker(G.opField, `${card.name}: 상대 몬스터 묘지로`, 1, (sel) => {
      if (sel.length > 0) {
        const mon = G.opField.splice(sel[0], 1)[0];
        G.opGrave.push(mon);
      }
      renderAll();
    });
    return;
  }
  log(`${card.name}: 메인 효과 해제`, 'mine');
}

// ─────────────────────────────────────────────
// LOBBY → DECK BUILDER 연결
// ─────────────────────────────────────────────
// createRoom/joinRoom 후 덱 빌더로 이동하도록 startGame 수정
const _origStartGame = typeof startGame === 'function' ? startGame : null;

function goToDeckBuilder() {
  document.getElementById('lobby').style.display = 'none';
  // 혹시 남아있는 대기 오버레이 제거
  const existing = document.getElementById('waitingOverlay');
  if (existing) existing.remove();
  document.getElementById('deckBuilder').style.display = 'flex';
  filterDeckPool('전체');
  renderBuilderDeck();
  // 게스트에게 "게임 시작됨" 알림
  if (myRole === 'guest') notify('게임이 시작됐습니다! 덱을 구성해주세요.');
}

// ─────────────────────────────────────────────
// 화면 오류 표시 (디버깅용)
// ─────────────────────────────────────────────
window.onerror = function(msg, src, line, col, err) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#c84848;color:#fff;padding:8px;font-size:11px;z-index:9999;word-break:break-all;max-height:30vh;overflow-y:auto;';
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
