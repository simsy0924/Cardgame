
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
// forceDiscard — 패 n장 강제 버리기
// 선택한 카드 중 공개된 펭귄 마을이 있으면 ②로 대체 여부를 물음
// ─────────────────────────────────────────────
function forceDiscard(n) {
  if (G.myHand.length === 0) { checkWinCondition(); return; }
  const actualN = Math.min(n, G.myHand.length);

  openCardPicker(G.myHand, `패를 ${actualN}장 버려야 합니다`, actualN, (selected) => {
    const indices = [...selected].sort((a, b) => b - a);

    // 선택된 카드 중 공개된 펭귄 마을이 있는지 확인
    const villageSelIdx = selected.find(i => G.myHand[i]?.id === '펭귄 마을' && G.myHand[i]?.isPublic);
    const fieldPenguins = G.myField.filter(c => isPenguinMonster(c.id));

    const doDiscard = () => {
      indices.forEach(i => {
        if (G.myHand[i]) {
          const c = G.myHand.splice(i, 1)[0];
          G.myGrave.push(c);
          // [BUG FIX] 전투 피해 강제 버리기도 지배의 사슬 ①, 지배룡 트리거에 포함
          if (typeof onJibaeryongDiscarded === 'function') onJibaeryongDiscarded(c.id);
          if (typeof onHandDiscarded_jibaeSasl === 'function') onHandDiscarded_jibaeSasl();
        }
      });
      sendGameState(); renderAll(); checkWinCondition();
    };

    if (villageSelIdx !== undefined && fieldPenguins.length > 0) {
      gameConfirm(
        `펭귄 마을 ②\n버리는 대신 필드의 펭귄 몬스터를 묘지로 보냅니까?`,
        (yes) => {
          if (yes) {
            openCardPicker(fieldPenguins, '펭귄 마을 ②: 대신 묘지로 보낼 펭귄 몬스터', 1, (sel) => {
              if (sel.length > 0) {
                const mon = fieldPenguins[sel[0]];
                sendToGrave(mon.id, 'field');
                log(`펭귄 마을 ②: ${mon.name} 대신 묘지`, 'mine');
                // [BUG FIX] 수문장 펭귄 ②: "자신 펭귄 몬스터가 펭귄 마을 효과로 묘지로 보내졌을 경우"
                // 수문장 자신뿐 아니라, 수문장이 필드에 남아있을 때 다른 펭귄이 묘지로 가도 트리거
                const summonerOnField = G.myField.some(m => m.id === '수문장 펭귄');
                if (summonerOnField || mon.id === '수문장 펭귄') triggerSummonerPenguin2();
                _tryRecoverPenguinStrikeFromGrave();
              }
              // 마을 제외 나머지만 버리기
              const remainIdx = indices.filter(i => i !== villageSelIdx).sort((a, b) => b - a);
              remainIdx.forEach(i => { if (G.myHand[i]) G.myGrave.push(G.myHand.splice(i, 1)[0]); });
              sendGameState(); renderAll(); checkWinCondition();
            }, true);
          } else {
            doDiscard();
          }
        }
      );
    } else {
      doDiscard();
    }
  }, true);
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
