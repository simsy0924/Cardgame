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

// ─────────────────────────────────────────────
// 전투 피해 처리 — 펭귄 마을 ②, 구사일생 순서대로 비동기 체크
// ─────────────────────────────────────────────
function _resolveCombatDamage(dmg) {
  // 1순위: 펭귄 마을 ② (패 버리는 대신 필드 펭귄 묘지)
  const villageIdx    = G.myHand.findIndex(c => c.id === '펭귄 마을' && c.isPublic);
  const fieldPenguins = G.myField.filter(c => isPenguinMonster(c.id));

  if (villageIdx >= 0 && fieldPenguins.length > 0) {
    gameConfirm('펭귄 마을 ② 발동?\n패 버리는 대신 필드 펭귄 몬스터를 묘지로 보냅니다.', (yes) => {
      if (yes) {
        openCardPicker(
          fieldPenguins,
          `펭귄 마을 ②: 묘지로 보낼 펭귄 몬스터 (최대 ${Math.min(dmg, fieldPenguins.length)}장)`,
          Math.min(dmg, fieldPenguins.length),
          (sel) => {
            const sent = sel.length;
            sel.forEach(i => {
              const mon = fieldPenguins[i];
              sendToGrave(mon.id, 'field');
              if (mon.id === '수문장 펭귄') triggerSummonerPenguin2();
            });
            _tryRecoverPenguinStrikeFromGrave();
            const remaining = dmg - sent;
            // 대체한 것보다 피해가 더 많으면 나머지는 패 버리기
            if (remaining > 0) _resolveForceDiscardWithGuard(remaining);
            else { sendGameState(); renderAll(); checkWinCondition(); }
          },
          true // forced
        );
      } else {
        // 마을 ② 거부 → 구사일생 or 일반 버리기
        _resolveForceDiscardWithGuard(dmg);
      }
    });
  } else {
    // 마을 조건 불충족 → 구사일생 or 일반 버리기
    _resolveForceDiscardWithGuard(dmg);
  }
}

// 구사일생 체크 후 강제 패 버리기
function _resolveForceDiscardWithGuard(dmg) {
  const guIdx = G.myHand.findIndex(c => c.id === '구사일생');
  if (guIdx >= 0 && dmg >= G.myHand.length) {
    gameConfirm(`구사일생 발동?\n전투 데미지 0 + 드로우 1장\n조건: 공격력 차(${dmg}) ≥ 패 수(${G.myHand.length})`, (yes) => {
      if (!yes) { forceDiscard(dmg); return; }
      G.myHand.splice(guIdx, 1);
      G.myGrave.push({ id: '구사일생', name: '구사일생' });
      drawOne();
      log('구사일생: 전투 데미지 0 + 드로우', 'mine');
      sendGameState(); renderAll();
    });
  } else {
    forceDiscard(dmg);
  }
}

function forceDiscard(n, opponentPicks = false) {
  if (G.myHand.length === 0) { checkWinCondition(); return; }
  const actualN = Math.min(n, G.myHand.length);

  if (opponentPicks) {
    // 상대가 고름: 공개패 우선, 나머지 무작위
    const publicCards  = G.myHand.filter(c => c.isPublic);
    const privateCards = G.myHand.filter(c => !c.isPublic);
    let remaining = actualN;
    const toDiscard = [];
    publicCards.slice(0, remaining).forEach(c => { toDiscard.push(c); remaining--; });
    while (remaining > 0 && privateCards.length > 0) {
      toDiscard.push(privateCards.splice(Math.floor(Math.random() * privateCards.length), 1)[0]);
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
    // 내가 고름 — forced=true: 반드시 선택해야 함
    openCardPicker(
      G.myHand,
      `패를 ${actualN}장 버려야 합니다 (${actualN}장 선택)`,
      actualN,
      (selected) => {
        selected.sort((a, b) => b - a).forEach(i => {
          if (G.myHand[i]) G.myGrave.push(G.myHand.splice(i, 1)[0]);
        });
        // 덜 선택된 경우 무작위로 채움
        const rem = actualN - selected.length;
        for (let i = 0; i < rem && G.myHand.length > 0; i++) {
          G.myGrave.push(G.myHand.splice(Math.floor(Math.random() * G.myHand.length), 1)[0]);
        }
        sendGameState(); renderAll(); checkWinCondition();
      },
      true // forced — 취소 불가
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