// effects-core.js — 턴/전투/승리 등 공용 게임 효과

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

  if (activeChainState && activeChainState.active) {
    notify('체인 처리 중에는 전개 단계를 종료할 수 없습니다.');
    return;
  }

  const priorityOwner = (typeof getPriorityOwner === 'function') ? getPriorityOwner() : myRole;
  if (priorityOwner !== myRole) {
    notify('우선권이 있을 때만 전개 단계를 종료할 수 있습니다.');
    return;
  }

  if (pendingTriggerEffects.length > 0) {
    notify('전개 단계 종료 전, 유발 즉시 효과의 발동 여부를 먼저 확인합니다.');
    flushTriggeredEffects();
    return;
  }

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

  // 엔드 단계 유발효과 잔여분이 있으면 먼저 처리
  if (pendingTriggerEffects.length > 0) {
    notify('발동할 유발효과가 있습니다. 먼저 처리해주세요.');
    flushTriggeredEffects();
    return;
  }

  resetTurnEffects();
  attackedMonstersThisTurn.clear();
  G.turn++;
  isMyTurn = false;
  advancePhase('draw');
  log('턴 종료 — 상대 턴', 'mine');
  sendAction({ type: 'endTurn' });
  sendGameState();
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
    // 내 몬스터 승리 — 상대 묘지, 상대가 직접 패 선택해서 버림
    G.opField.splice(defIdx, 1);
    G.opGrave.push(defender);
    log(`${defender.name} 묘지. 상대 패 ${diff}장 손실`, 'system');
    notify(`공격 성공! 상대 패 ${diff}장 손실`);
    // 상대 화면에서 상대가 직접 선택
    sendAction({ type: 'forceDiscard', count: diff, reason: '전투 피해' });
  } else if (diff < 0) {
    // 상대 몬스터 승리 — 내 묘지, 내 패 |diff|장 손실
    G.myField.splice(atkIdx, 1);
    G.myGrave.push(attacker);
    log(`${attacker.name} 묘지. 내 패 ${Math.abs(diff)}장 버리기`, 'mine');
    // 묘지 트리거 (펭귄 용사 ③ 등)
    onSentToGrave(attacker.id);
    // 이후 패 처리는 _resolveCombatDamage에 위임 (펭귄 마을 ②, 구사일생 비동기 처리)
    sendAction({ type: 'combat', atkIdx, defIdx, atkCard: attacker, defCard: defender });
    attackedMonstersThisTurn.add(attacker.id);
    sendGameState(); renderAll();
    _resolveCombatDamage(Math.abs(diff));
    return;
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

// 전투 피해 처리 — 구사일생 체크 후 forceDiscard (마을 ②는 forceDiscard 내부에서 처리)
function _resolveCombatDamage(dmg) {
  _resolveForceDiscardWithGuard(dmg);
}

// 구사일생 체크 후 강제 패 버리기
function _resolveForceDiscardWithGuard(dmg) {
  const guIdx = G.myHand.findIndex(c => c.id === '구사일생');
  if (guIdx >= 0 && dmg >= G.myHand.length) {
    gameConfirm(
      `구사일생 발동?\n전투 데미지 0 + 드로우 1장\n조건: 공격력 차(${dmg}) ≥ 패 수(${G.myHand.length})`,
      (yes) => {
        if (!yes) { forceDiscard(dmg); return; }
        G.myHand.splice(guIdx, 1);
        G.myGrave.push({ id: '구사일생', name: '구사일생' });
        drawOne();
        log('구사일생: 전투 데미지 0 + 드로우', 'mine');
        sendGameState(); renderAll();
      }
    );
  } else {
    forceDiscard(dmg);
  }
}

// ─────────────────────────────────────────────
// 펭귄 마을 ② 공통 헬퍼
// 패 버리기가 발생하는 모든 경로에서 호출.
// 조건 충족 시 gameConfirm → 대신 필드 펭귄 묘지 or 나머지 패 버리기.
// done(true)  = 마을 ②로 전부 대체됨 (추가 버리기 불필요)
// done(false) = 마을 미발동 또는 부족분 → 일반 버리기 진행
// ─────────────────────────────────────────────
function _tryVillageReplace(n, onSkip) {
  const villageIdx    = G.myHand.findIndex(c => c.id === '펭귄 마을' && c.isPublic);
  const fieldPenguins = G.myField.filter(c => isPenguinMonster(c.id));
  if (villageIdx < 0 || fieldPenguins.length === 0 || n <= 0) { onSkip(n); return; }

  gameConfirm(
    `펭귄 마을 ② 발동?\n패 ${n}장 버리는 대신 필드 펭귄 몬스터를 묘지로 보냅니다.`,
    (yes) => {
      if (!yes) { onSkip(n); return; }
      const maxReplace = Math.min(n, fieldPenguins.length);
      openCardPicker(
        fieldPenguins,
        `펭귄 마을 ②: 묘지로 보낼 펭귄 몬스터 (최대 ${maxReplace}장)`,
        maxReplace,
        (sel) => {
          const sent = sel.length;
          sel.forEach(i => {
            const mon = fieldPenguins[i];
            sendToGrave(mon.id, 'field');
            if (mon.id === '수문장 펭귄') triggerSummonerPenguin2();
          });
          _tryRecoverPenguinStrikeFromGrave();
          const remaining = n - sent;
          if (remaining > 0) onSkip(remaining); // 부족분은 일반 버리기
          else { sendGameState(); renderAll(); checkWinCondition(); }
        },
        true // forced
      );
    }
  );
}

// ─────────────────────────────────────────────
// forceDiscard — 패 n장 강제 버리기 (항상 내가 직접 선택, 취소 불가)
// 펭귄 마을 ②: 버리기 전 대체 가능 여부 먼저 체크
// ─────────────────────────────────────────────
function forceDiscard(n) {
  if (G.myHand.length === 0) { checkWinCondition(); return; }
  const actualN = Math.min(n, G.myHand.length);

  _tryVillageReplace(actualN, (rem) => {
    const remN = Math.min(rem, G.myHand.length);
    if (remN <= 0) { sendGameState(); renderAll(); checkWinCondition(); return; }
    openCardPicker(
      G.myHand,
      `패를 ${remN}장 버려야 합니다 (${remN}장 선택)`,
      remN,
      (selected) => {
        selected.sort((a, b) => b - a).forEach(i => {
          if (G.myHand[i]) G.myGrave.push(G.myHand.splice(i, 1)[0]);
        });
        // 덜 선택된 경우 무작위로 채움 (비공개패 보호 불가)
        const shortage = remN - selected.length;
        for (let i = 0; i < shortage && G.myHand.length > 0; i++) {
          G.myGrave.push(G.myHand.splice(Math.floor(Math.random() * G.myHand.length), 1)[0]);
        }
        sendGameState(); renderAll(); checkWinCondition();
      },
      true // forced — 취소 불가
    );
  });
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