// ui.js — UI 렌더링, 모달, 카드 픽커, 덱 빌더

// ─────────────────────────────────────────────
// CARD RENDERING
// ─────────────────────────────────────────────
function renderCard(cardData, opts = {}) {
  const card  = CARDS[cardData.id] || { name: cardData.name, cardType: 'normal', effects: '' };
  const el    = document.createElement('div');
  el.className = 'card' + (cardData.isPublic ? ' public-card' : '') + (opts.selected ? ' selected' : '');

  const color   = CARD_TYPE_COLOR[card.cardType] || '#555';
  const typeBar = document.createElement('div');
  typeBar.className       = 'card-type-bar';
  typeBar.style.background = color;
  el.appendChild(typeBar);

  const body      = document.createElement('div');
  body.className  = 'card-body';

  const typeLabel     = document.createElement('div');
  typeLabel.className = 'card-type-label';
  typeLabel.textContent = CARD_TYPE_LABEL[card.cardType] || '';

  const nameEl     = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = card.name;

  body.appendChild(typeLabel);
  body.appendChild(nameEl);
  el.appendChild(body);

  if (card.cardType === 'monster' && card.atk !== undefined) {
    const atk     = document.createElement('div');
    atk.className = 'card-atk';
    atk.textContent = `ATK ${card.atk}`;
    el.appendChild(atk);
  }

  return el;
}

function renderCardBack(cardData) {
  const el = document.createElement('div');
  if (cardData.isPublic) {
    el.className = 'card-back public-back';
    const name     = document.createElement('div');
    name.className = 'pub-name';
    name.textContent = cardData.name;
    el.appendChild(name);
  } else {
    el.className   = 'card-back';
    el.textContent = '?';
  }
  return el;
}

// ─────────────────────────────────────────────
// RENDER ALL
// ─────────────────────────────────────────────
function renderAll() {
  renderMyHand();
  renderOpHand();
  renderMyField();
  renderOpField();
  renderCounts();
  renderPhase();
  renderFieldZones();
  renderClock();
}

function renderMyHand() {
  const container = document.getElementById('myHand');
  container.innerHTML = '';
  G.myHand.forEach((c, i) => {
    const el = renderCard(c, { selected: i === selectedCardIdx });
    el.addEventListener('click', () => openCardDetail(c.id, i));
    container.appendChild(el);
  });
  document.getElementById('myHandCount').textContent = G.myHand.length;
}

function renderOpHand() {
  const container = document.getElementById('opHand');
  container.innerHTML = '';
  G.opHand.forEach(c => {
    const el       = renderCardBack(c);
    el.style.cursor = 'pointer';
    if (c.isPublic) {
      el.addEventListener('click', () => openCardDetail(c.id, -1, true));
    }
    container.appendChild(el);
  });
  document.getElementById('opHandCount').textContent = G.opHand.length;
}

function renderMyField() {
  const container = document.getElementById('myField');
  container.innerHTML = '';
  const slots = 5 + (G.myExtraSlots || 0);

  for (let i = 0; i < slots; i++) {
    const slot = document.createElement('div');
    slot.className = 'zone-slot';
    const mon = G.myField[i];
    if (mon) {
      const card = CARDS[mon.id] || {};
      slot.classList.add('active');

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:.55rem;text-align:center;padding:3px;word-break:keep-all;color:var(--text)';
      nameEl.textContent = mon.name;

      const atkEl = document.createElement('div');
      atkEl.style.cssText = 'font-size:.65rem;color:var(--accent);font-family:Black Han Sans,sans-serif';
      atkEl.textContent = `ATK ${mon.atk ?? (card.atk ?? '?')}`;

      slot.appendChild(nameEl);
      slot.appendChild(atkEl);
      slot.addEventListener('click', () => onMyFieldClick(i));
    } else {
      slot.style.cursor = 'default';
    }
    container.appendChild(slot);
  }
}

function renderOpField() {
  const container = document.getElementById('opField');
  container.innerHTML = '';

  G.opField.forEach((mon, i) => {
    const slot = document.createElement('div');
    slot.className = 'zone-slot active';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:.55rem;text-align:center;padding:3px;word-break:keep-all;color:var(--text)';
    nameEl.textContent = mon.name;

    const atkEl = document.createElement('div');
    atkEl.style.cssText = 'font-size:.65rem;color:var(--danger);font-family:Black Han Sans,sans-serif';
    atkEl.textContent = `ATK ${mon.atk ?? '?'}`;

    slot.appendChild(nameEl);
    slot.appendChild(atkEl);
    slot.addEventListener('click', () => onOpFieldClick(i));
    container.appendChild(slot);
  });

  // 빈 슬롯 채우기
  const maxSlots = 5 + (G.opExtraSlots || 0);
  for (let i = G.opField.length; i < maxSlots; i++) {
    const slot     = document.createElement('div');
    slot.className = 'zone-slot';
    container.appendChild(slot);
  }
}

function renderCounts() {
  document.getElementById('myHandCount').textContent    = G.myHand.length;
  document.getElementById('opHandCount').textContent    = G.opHand.length;
  document.getElementById('myKeyDeckCount').textContent = G.myKeyDeck.length;
  document.getElementById('opKeyDeckCount').textContent = G.opKeyDeck.length;
  document.getElementById('myGraveCount').textContent   = G.myGrave.length;
  document.getElementById('opGraveCount').textContent   = G.opGrave.length;
  document.getElementById('myExileCount').textContent   = G.myExile.length;
  document.getElementById('opExileCount').textContent   = G.opExile.length;
}

function renderPhase() {
  ['Draw','Deploy','Attack','End'].forEach(p => {
    document.getElementById('ph' + p).classList.toggle('active', currentPhase === p.toLowerCase());
  });

  const mine = isMyTurn;
  document.getElementById('btnDraw').classList.toggle('active-phase',      mine && currentPhase === 'draw');
  document.getElementById('btnEndDeploy').classList.toggle('active-phase', mine && currentPhase === 'deploy');
  document.getElementById('btnEndAttack').classList.toggle('active-phase', mine && currentPhase === 'attack');
  document.getElementById('btnEndTurn').classList.toggle('active-phase',   mine && currentPhase === 'end');

  document.getElementById('btnDraw').disabled      = !mine || currentPhase !== 'draw';
  document.getElementById('btnEndDeploy').disabled = !mine || currentPhase !== 'deploy';
  document.getElementById('btnEndAttack').disabled = !mine || currentPhase !== 'attack';
  document.getElementById('btnEndTurn').disabled   = !mine || currentPhase !== 'end';

  const turnLabel       = document.getElementById('turnLabel');
  turnLabel.textContent = mine ? '내 턴' : '상대 턴';
  turnLabel.className   = 'turn-label ' + (mine ? 'turn-mine' : 'turn-opponent');

  renderChainActions();
  syncClockRunState(getPriorityOwner());
}

function renderChainActions() {
  const btnRespond = document.getElementById('btnChainRespond');
  const btnPass    = document.getElementById('btnChainPass');
  const btnKeyFetch = document.getElementById('btnKeyFetch');
  if (!btnRespond || !btnPass) return;

  const chainActive = !!(activeChainState && activeChainState.active);
  const myPriority  = chainActive && activeChainState.priority === myRole;

  btnRespond.classList.toggle('hidden', !myPriority);
  btnPass.classList.toggle('hidden',    !myPriority);

  if (btnKeyFetch) {
    const noKeyCard      = !G.myKeyDeck || G.myKeyDeck.length === 0;
    const inDraw         = currentPhase === 'draw';
    const opponentPriority = chainActive && !myPriority;
    btnKeyFetch.disabled = noKeyCard || inDraw || opponentPriority;
  }
}

function renderFieldZones() {
  const myFZ = document.getElementById('myFieldZone');
  const opFZ = document.getElementById('opFieldZone');
  if (G.myFieldCard) {
    myFZ.innerHTML = `<div class="field-card-display">${G.myFieldCard.name}</div>`;
  } else {
    myFZ.textContent = '비어있음';
  }
  if (G.opFieldCard) {
    opFZ.innerHTML = `<div class="field-card-display">${G.opFieldCard.name}</div>`;
  } else {
    opFZ.textContent = '비어있음';
  }
}

// ─────────────────────────────────────────────
// CARD INTERACTIONS
// ─────────────────────────────────────────────
function onMyHandClick(i) {
  selectedCardIdx = selectedCardIdx === i ? -1 : i;
  renderMyHand();
}

function onMyFieldClick(i) {
  if (currentPhase === 'attack' && isMyTurn) {
    selectedFieldIdx = i;
    document.querySelectorAll('#opField .zone-slot').forEach(el => el.classList.add('attack-target'));
    if (G.opField.length === 0) {
      gameConfirm(
        `${G.myField[i]?.name}으로 직접 공격?\n상대 패 ${G.myField[i]?.atk}장 손실`,
        (yes) => {
          if (yes) directAttack(i);
          selectedFieldIdx = -1;
        }
      );
    } else {
      notify('공격할 상대 몬스터를 클릭하세요');
    }
    return;
  }
  const mon = G.myField[i];
  if (mon) openCardDetail(mon.id, -1, false, i);
}

function onOpFieldClick(i) {
  if (selectedFieldIdx >= 0) {
    executeCombat(selectedFieldIdx, i);
    selectedFieldIdx = -1;
    document.querySelectorAll('.zone-slot.attack-target').forEach(el => el.classList.remove('attack-target'));
  } else {
    const mon = G.opField[i];
    if (mon) openCardDetail(mon.id, -1, true);
  }
}

// ─────────────────────────────────────────────
// PHASE MANAGEMENT
// ─────────────────────────────────────────────
function advancePhase(phase) {
  currentPhase = phase;
  G.phase      = phase;
  ['Draw','Deploy','Attack','End'].forEach(p => {
    document.getElementById('ph' + p).classList.toggle('active', phase === p.toLowerCase());
  });
  renderPhase();
}

// ─────────────────────────────────────────────
// CARD DETAIL MODAL
// ─────────────────────────────────────────────
function openCardDetail(cardId, handIdx = -1, opponentCard = false, fieldIdx = -1) {
  try {
    const card = CARDS[cardId] || { name: cardId, cardType: 'normal', effects: '효과 정보 없음' };
    document.getElementById('mdCardName').textContent    = card.name;
    document.getElementById('mdCardEffects').textContent = card.effects || '효과 없음';

    // Meta chips
    const meta = document.getElementById('mdCardMeta');
    meta.innerHTML = '';

    const typeChip = document.createElement('div');
    typeChip.className   = 'meta-chip';
    typeChip.textContent = CARD_TYPE_LABEL[card.cardType] || card.cardType;
    typeChip.style.borderColor = CARD_TYPE_COLOR[card.cardType] || '#555';
    typeChip.style.color       = CARD_TYPE_COLOR[card.cardType] || '#555';
    meta.appendChild(typeChip);

    if (card.atk !== undefined) {
      const atkChip   = document.createElement('div');
      atkChip.className = 'meta-chip';
      const fieldMon  = fieldIdx >= 0 ? G.myField[fieldIdx] : G.myField.find(m => m.id === cardId);
      atkChip.textContent       = `ATK ${fieldMon ? fieldMon.atk : card.atk}`;
      atkChip.style.borderColor = '#c8a96e';
      atkChip.style.color       = '#c8a96e';
      meta.appendChild(atkChip);
    }
    if (card.isKeyCard) {
      const kc   = document.createElement('div');
      kc.className   = 'meta-chip';
      kc.textContent = '키카드';
      kc.style.borderColor = '#7c5cbf';
      kc.style.color       = '#7c5cbf';
      meta.appendChild(kc);
    }

    // 액션 버튼
    const actions = document.getElementById('mdCardActions');
    actions.innerHTML = '';

    const addBtn = (label, cls, fn) => {
      const b     = document.createElement('button');
      b.className = `btn ${cls}`;
      b.textContent = label;
      b.onclick   = () => {
        closeModal('cardDetailModal');
        try { fn(); } catch (e) { console.error(e); notify('효과 처리 오류: ' + e.message); }
      };
      actions.appendChild(b);
    };

    try {
      if (!opponentCard) {
        // ── 패에서 발동 ──
        if (handIdx >= 0) {
          const isPenguin    = typeof isPenguinCard === 'function' ? isPenguinCard(cardId) : cardId.includes('펭귄');
          const canActAnytime = currentPhase !== 'draw';

          if (isPenguin) {
            _addPenguinHandButtons(cardId, handIdx, canActAnytime, addBtn);
          } else if (cardId === '일격필살') {
            if (canActAnytime) addBtn('① 상대 패 1장 버리기', 'btn-primary',   () => activateCard(handIdx));
            addBtn('패에서 버리기', 'btn-danger', () => manualDiscard(handIdx));
          } else if (cardId === '단 한번의 기회') {
            if (canActAnytime) addBtn('① 드로우 1장', 'btn-primary', () => activateCard(handIdx));
            addBtn('패에서 버리기', 'btn-danger', () => manualDiscard(handIdx));
          } else if (card.theme === '지배자') {
            _addJibaeHandButtons(cardId, handIdx, addBtn);
          } else {
            if (card.cardType === 'monster' && isMyTurn && currentPhase === 'deploy') {
              addBtn('효과 소환 전용', 'btn-secondary', () => notify('통상 소환은 없습니다.'));
            }
            if (['normal','magic','field'].includes(card.cardType) && isMyTurn) {
              addBtn('발동', 'btn-primary', () => activateCard(handIdx));
            }
            if (card.cardType === 'magic' && canActAnytime) {
              addBtn('마법 발동', 'btn-secondary', () => activateCard(handIdx));
            }
            if (card.cardType === 'trap' && !isMyTurn && canActAnytime) {
              addBtn('함정 발동', 'btn-secondary', () => activateCard(handIdx));
            }
          }
        }

        // ── 필드 효과 ──
        if (fieldIdx >= 0) {
          _addFieldEffectButtons(cardId, fieldIdx, addBtn);
        }

        // ── 묘지 효과 (handIdx === -2) ──
        if (handIdx === -2) {
          _addGraveEffectButtons(cardId, addBtn);
        }
      }
    } catch (e) {
      console.error('버튼 생성 오류:', e);
    }

    const closeBtn     = document.createElement('button');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.textContent = '닫기';
    closeBtn.onclick   = () => closeModal('cardDetailModal');
    actions.appendChild(closeBtn);

    document.getElementById('cardDetailModal').classList.remove('hidden');

  } catch (e) {
    console.error('openCardDetail 오류:', e);
    document.getElementById('mdCardName').textContent    = cardId;
    document.getElementById('mdCardEffects').textContent = CARDS[cardId]?.effects || '';
    document.getElementById('mdCardActions').innerHTML   =
      '<button class="btn btn-secondary" onclick="closeModal(\'cardDetailModal\')">닫기</button>';
    document.getElementById('cardDetailModal').classList.remove('hidden');
  }
}

// 펭귄 패 버튼 헬퍼
function _addPenguinHandButtons(cardId, handIdx, canActAnytime, addBtn) {
  const villageRevealed    = isPenguinVillageRevealed();
  const hasDeckPenguin     = findAllInDeck(c => isPenguinMonster(c.id)).length > 0;
  const hasDeckPenguinCard = findAllInDeck(c => isPenguinCard(c.id)).length > 0;

  switch (cardId) {
    case '펭귄 마을':
      if (isMyTurn && currentPhase === 'deploy' && !G.myHand[handIdx]?.isPublic) {
        addBtn('① 공개하기', 'btn-primary', () => activatePenguinCard(handIdx, 1));
      }
      break;

    case '꼬마 펭귄':
      if (isMyTurn && currentPhase === 'deploy') {
        addBtn('① 패에서 소환', 'btn-primary', () => activatePenguinCard(handIdx, 1));
      }
      break;

    case '펭귄 부부':
      if (canUseEffect('펭귄 부부', 2)) {
        addBtn('② 보여주기 → 드로우2 + 버리기', 'btn-secondary', () => activatePenguinCard(handIdx, 2));
      }
      break;

    case '펭귄!돌격!':
      if (isMyTurn && currentPhase === 'deploy') {
        if (hasDeckPenguin) {
          addBtn('① 덱에서 펭귄 소환', 'btn-primary', () => activatePenguinCard(handIdx, 1));
        } else {
          addBtn('① 덱에 펭귄 몬스터 없음', 'btn-secondary', () => notify('덱에 펭귄 몬스터가 없습니다.'));
        }
      }
      break;

    case '펭귄의 영광': {
      const heroAvail = G.myHand.some(c => c.id === '펭귄 용사' || c.id === '펭귄의 전설');
      if (heroAvail) {
        addBtn('① 펭귄 용사/전설 소환 + 상대 패 공개', 'btn-primary', () => activatePenguinCard(handIdx, 1));
      } else {
        addBtn('① 발동 불가 (패에 용사/전설 없음)', 'btn-secondary', () => notify('패에 펭귄 용사 또는 펭귄의 전설이 있어야 합니다.'));
      }
      break;
    }

    case '펭귄의 일격': {
      const hasPenguinField = G.myField.some(c => isPenguinMonster(c.id));
      if (hasPenguinField && canUseEffect('펭귄의 일격', 1)) {
        addBtn('① 패 1장 버리고 효과 무효', 'btn-primary', () => activatePenguinCard(handIdx, 1));
      } else if (!hasPenguinField) {
        addBtn('① 필드에 펭귄 몬스터 필요', 'btn-secondary', () => notify('자신 필드에 펭귄 몬스터가 필요합니다.'));
      }
      break;
    }

    case '펭귄이여 영원하라': {
      const myHasAnyField = G.myField.length > 0 || G.myFieldCard != null;
      if (canActAnytime && myHasAnyField) {
        addBtn('① 필드 카드 교환 + 소환', 'btn-primary', () => activatePenguinCard(handIdx, 1));
      } else if (!myHasAnyField) {
        addBtn('① 발동 불가 (내 필드에 카드 없음)', 'btn-secondary', () => notify('내 필드에 카드가 있어야 합니다.'));
      }
      break;
    }

    case '펭귄의 전설':
      if (!isMyTurn) {
        addBtn('② 패로 + 묘지 소환 (상대 턴)', 'btn-secondary', () => activatePenguinCard(handIdx, 2));
      }
      break;

    case '펭귄 마법사':
      if (!G.myHand[handIdx]?.isPublic && canUseEffect('펭귄 마법사', 1, 2) && hasDeckPenguinCard) {
        addBtn('① 보여주기 → 서치 → 덱으로', 'btn-secondary', () => activatePenguinCard(handIdx, 1));
      } else if (G.myHand[handIdx]?.isPublic) {
        addBtn('① 공개패에서는 발동 불가', 'btn-secondary', () => notify('일반 패(비공개)에서만 발동할 수 있습니다.'));
      } else if (!hasDeckPenguinCard) {
        addBtn('① 덱에 펭귄 카드 없음', 'btn-secondary', () => notify('덱에 펭귄 카드가 없습니다.'));
      }
      break;

    default:
      if (CARDS[cardId]?.cardType === 'monster' && isMyTurn && currentPhase === 'deploy') {
        addBtn('효과 소환 전용', 'btn-secondary', () => notify('통상 소환은 없습니다.'));
      }
      break;
  }
}

// 지배자 패 버튼 헬퍼
function _addJibaeHandButtons(cardId, handIdx, addBtn) {
  const canAnyTurn = isMyTurn || hasKeyCardMonsterOnField();
  addBtn('패에서 버리기', 'btn-danger', () => manualDiscard(handIdx));

  switch (cardId) {
    case '수원소의 지배자':
      if (canAnyTurn && canUseEffect('수원소의 지배자', 1)) {
        addBtn('① 버리고 → 덱에서 지배자 서치 + 드로우(선택)', 'btn-primary', () => activateJibaejaShui1(handIdx));
      }
      break;
    case '화원소의 지배자':
      if (canAnyTurn && canUseEffect('화원소의 지배자', 1)) {
        addBtn('① 버리고 → 덱에서 지배자 소환 + 드로우(선택)', 'btn-primary', () => activateJibaejaHwa1(handIdx));
      }
      break;
    case '전원소의 지배자':
      if (canAnyTurn && canUseEffect('전원소의 지배자', 1)) {
        addBtn('① 버리고 → 패/묘지 지배자 소환 + 드로우(선택)', 'btn-primary', () => activateJibaejaJeon1(handIdx));
      }
      break;
    case '풍원소의 지배자':
      if (canAnyTurn && canUseEffect('풍원소의 지배자', 1)) {
        if (G.opGrave.length > 0) {
          addBtn('① 버리고 → 상대 묘지 카드 제외 + 드로우', 'btn-primary', () => activateJibaejaFung1(handIdx));
        } else {
          addBtn('① 발동 불가 (상대 묘지 없음)', 'btn-secondary', () => notify('상대 묘지에 카드가 없습니다.'));
        }
      }
      break;
    case '사원소의 지배자':
      if (canSummonSaWonsoJibaeja()) {
        addBtn('소환 (지배자 4종 제외)', 'btn-primary', () => summonSaWonsoJibaeja());
      } else {
        addBtn('소환 불가 (필드/묘지 지배자 4종 필요)', 'btn-secondary', () => notify('필드/묘지에 카드명이 다른 지배자 4종이 필요합니다.'));
      }
      break;
    case '사원소의 지배룡':
      if (canSummonSaWonsoJibaeryong()) {
        addBtn('소환 (지배룡 4종 제외)', 'btn-primary', () => summonSaWonsoJibaeryong());
      } else {
        addBtn('소환 불가 (필드/묘지 지배룡 4종 필요)', 'btn-secondary', () => notify('필드/묘지에 카드명이 다른 지배룡 4종이 필요합니다.'));
      }
      break;
    case '사원소의 기적':
      if (!saWonsoMirakUsed) {
        addBtn('① 4종 묘지로 (게임 중 1번)', 'btn-primary', () => activateSaWonsoMirak(handIdx));
      } else {
        addBtn('이미 발동했습니다', 'btn-secondary', () => notify('사원소의 기적은 게임 중 1번밖에 발동할 수 없습니다.'));
      }
      break;
    case '지배의 사슬':
      addBtn('① 자동 트리거 (패 버려질 때)', 'btn-secondary', () => notify('지배의 사슬 ①은 자신의 패가 버려졌을 때 자동 발동 여부를 묻습니다.'));
      break;
    case '지배룡과 지배자':
      if (currentPhase === 'attack' && canUseEffect('지배룡과 지배자', 1)) {
        addBtn('① 공격 단계 — 패 수에 따른 강화', 'btn-primary', () => activateJibaeryongJibaeja1(handIdx));
      }
      break;
    default:
      break;
  }
}

// 필드 효과 버튼 헬퍼
function _addFieldEffectButtons(cardId, fieldIdx, addBtn) {
  const mon            = G.myField[fieldIdx];
  const villageRevealed = isPenguinVillageRevealed();
  if (!mon) return;

  switch (mon.id) {
    case '펭귄 부부':
      if (mon.summonedFrom === 'deck' && mon.bubuTriggerReady && canUseEffect('펭귄 부부', 1)) {
        addBtn('① 소환 유발 효과', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 1));
      }
      break;
    case '현자 펭귄':
      if (isMyTurn && villageRevealed && canUseEffect('현자 펭귄', 1)) {
        addBtn('① 드로우+버리기 [마을 공개 중]', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 1));
      } else if (isMyTurn && !villageRevealed) {
        addBtn('① 발동 불가 (펭귄 마을 미공개)', 'btn-secondary', () => notify('패에 펭귄 마을이 공개 상태여야 합니다.'));
      }
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('현자 펭귄', 2)) {
        const hasDeck = findAllInDeck(c => isPenguinCard(c.id)).length > 0;
        if (hasDeck) {
          addBtn('② 서치', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 2));
        } else {
          addBtn('② 발동 불가 (덱에 펭귄 카드 없음)', 'btn-secondary', () => notify('덱에 펭귄 카드가 없습니다.'));
        }
      }
      break;
    case '수문장 펭귄':
      if (isMyTurn && currentPhase === 'deploy' && villageRevealed && canUseEffect('수문장 펭귄', 1)) {
        addBtn('① 공격력+1 + 서로 패 버리기 [마을 공개 중]', 'btn-primary', () => activatePenguinFieldEffect(fieldIdx, 1));
      } else if (isMyTurn && currentPhase === 'deploy' && !villageRevealed) {
        addBtn('① 펭귄 마을 공개 필요', 'btn-secondary', () => notify('패에 펭귄 마을이 공개 상태여야 합니다.'));
      }
      break;
    case '펭귄 용사':
      if (!isMyTurn && canUseEffect('펭귄 용사', 2)) {
        addBtn('② 패로 + 마법 회수', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 2));
      }
      break;
    case '펭귄의 전설':
      if (!isMyTurn && canUseEffect('펭귄의 전설', 2)) {
        addBtn('② 패로 + 묘지 소환', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 2));
      }
      break;
    case '펭귄 마법사':
      addBtn('③ 자동 트리거 (수동 발동 불가)', 'btn-secondary', () => notify('펭귄 마법사 ③은 펭귄 마을 효과로 묘지로 보내졌을 때 자동 발동합니다.'));
      break;
    // ── 지배자 필드 ──
    case '수원소의 지배자':
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('수원소의 지배자', 2)) {
        addBtn('② 덱에서 지배자 소환', 'btn-secondary', () => activateJibaejaShui2(fieldIdx));
      }
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('수원소의 지배자', 3)) {
        addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '수원소의 지배자'));
      }
      break;
    case '화원소의 지배자':
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('화원소의 지배자', 2)) {
        addBtn('② 덱에서 지배자 패에 넣기', 'btn-secondary', () => activateJibaejaHwa2(fieldIdx));
      }
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('화원소의 지배자', 3)) {
        addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '화원소의 지배자'));
      }
      break;
    case '전원소의 지배자':
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('전원소의 지배자', 3)) {
        addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '전원소의 지배자'));
      }
      break;
    case '풍원소의 지배자':
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('풍원소의 지배자', 3)) {
        addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '풍원소의 지배자'));
      }
      break;
    case '수원소의 지배룡':
    case '화원소의 지배룡':
    case '전원소의 지배룡':
    case '풍원소의 지배룡':
      if (isMyTurn && canUseEffect(mon.id, 3)) {
        addBtn('③ 필드→묘지 + 지배자 버리고 드로우', 'btn-secondary', () => activateJibaeryong3(fieldIdx, mon.id));
      }
      break;
    case '사원소의 지배룡':
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('사원소의 지배룡', 1)) {
        addBtn('① 지배자 2장 서치 + 버리기', 'btn-secondary', () => activateSaWonsoJibaeryong1(fieldIdx));
      }
      if (currentPhase === 'attack' && G.myHand.length < G.opHand.length && canUseEffect('사원소의 지배룡', 2)) {
        addBtn('② ATK +(상대패-내패) 상승', 'btn-secondary', () => activateSaWonsoJibaeryong2(fieldIdx));
      }
      if (G.myHand.length <= 5 && canUseEffect('사원소의 지배룡', 3)) {
        addBtn('③ 효과 무효 + 패 2장 버리기', 'btn-secondary', () => tryActivateSaWonsoJibaeryong3());
      }
      break;
    case '사원소의 지배자':
      if (isMyTurn && currentPhase === 'deploy' && canUseEffect('사원소의 지배자', 1)) {
        addBtn('① 지배룡 2장 서치 + 버리기', 'btn-secondary', () => activateSaWonsoJibaeja1(fieldIdx));
      }
      if (canUseEffect('사원소의 지배자', 2)) {
        addBtn('② 제외 후 지배자/지배룡 소환', 'btn-secondary', () => activateSaWonsoJibaeja2(fieldIdx));
      }
      if (G.myHand.length <= 5 && canUseEffect('사원소의 지배자', 3)) {
        addBtn('③ 상대 필드 카드 묘지 + 패 버리기', 'btn-secondary', () => tryActivateSaWonsoJibaeja3());
      }
      break;
    default:
      break;
  }
}

// 묘지 효과 버튼 헬퍼
function _addGraveEffectButtons(cardId, addBtn) {
  switch (cardId) {
    case '펭귄!돌격!': {
      const hp = G.myHand.filter(c => isPenguinMonster(c.id));
      if (hp.length > 0) {
        addBtn('② 패에서 펭귄 소환 (묘지 제외)', 'btn-secondary', () => activateGraveEffect(cardId));
      } else {
        addBtn('② 패에 펭귄 몬스터 없음', 'btn-secondary', () => notify('패에 펭귄 몬스터가 없습니다.'));
      }
      break;
    }
    case '펭귄의 영광':
    case '펭귄이여 영원하라':
      addBtn('② 묘지 제외 → 드로우', 'btn-secondary', () => activateGraveEffect(cardId));
      break;
    case '지배의 사슬':
      if (!isMyTurn && canUseEffect('지배의 사슬', 2)) {
        addBtn('② 묘지 제외 → 제외 카드 덱으로 + 드로우 (상대 턴)', 'btn-secondary', () => activateJibaeSasl2());
      }
      break;
    case '지배룡과 지배자':
      if (canUseEffect('지배룡과 지배자', 2)) {
        addBtn('② 묘지 제외 → 드로우', 'btn-secondary', () => activateJibaeryongJibaeja2());
      }
      break;
    case '풍원소의 지배자':
      if (canUseEffect('풍원소의 지배자', 2) && G.myGrave.some(c => c.id === '풍원소의 지배자')) {
        addBtn('② 지배룡 묘지 → 이 카드 소환 (자신/상대 턴)', 'btn-secondary', () => activateJibaejaFung2());
      }
      break;
    default:
      addBtn('묘지 효과 발동', 'btn-secondary', () => activateGraveEffect(cardId));
      break;
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ─────────────────────────────────────────────
// CARD PICKER (큐 기반)
// ─────────────────────────────────────────────
function openCardPicker(cards, title, maxPick, callback, forced = false) {
  if (!cards || cards.length === 0) { callback([]); return; }
  pickerQueue.push({
    cards:   [...cards],
    title,
    maxPick: Math.min(maxPick, cards.length),
    callback,
    forced,
  });
  if (!pickerRunning) runNextPicker();
}

function runNextPicker() {
  if (pickerQueue.length === 0) { pickerRunning = false; return; }
  pickerRunning = true;
  const { cards, title, maxPick, forced } = pickerQueue[0];
  pickerSelected     = [];
  pickerCurrentCards = cards;

  document.getElementById('pickerTitle').textContent = title;
  document.getElementById('pickerDesc').textContent  = forced
    ? `⚠️ 반드시 ${maxPick}장 선택 (취소 불가)`
    : maxPick === 0 ? '선택 없이 확인 가능' : `최대 ${maxPick}장 선택`;

  const cancelBtn = document.querySelector('#cardPickerModal .btn-secondary');
  if (cancelBtn) cancelBtn.style.display = forced ? 'none' : '';

  const grid = document.getElementById('pickerGrid');
  grid.innerHTML = '';
  cards.forEach((c, i) => {
    const el        = renderCard(c);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const idx = pickerSelected.indexOf(i);
      if (idx >= 0) {
        pickerSelected.splice(idx, 1);
        el.classList.remove('selected');
      } else if (pickerSelected.length < maxPick) {
        pickerSelected.push(i);
        el.classList.add('selected');
        if (maxPick === 1) confirmPick(); // 1장 선택이면 즉시 확정
      }
    });
    grid.appendChild(el);
  });

  document.getElementById('cardPickerModal').classList.remove('hidden');
}

function confirmPick() {
  if (pickerQueue.length === 0) { pickerRunning = false; closeModal('cardPickerModal'); return; }
  const { callback, forced, maxPick } = pickerQueue[0];

  if (forced && pickerSelected.length === 0) {
    notify('반드시 카드를 선택해야 합니다!');
    return;
  }

  closeModal('cardPickerModal');
  pickerQueue.shift();
  const selected = [...pickerSelected];
  pickerSelected = [];

  const cancelBtn = document.querySelector('#cardPickerModal .btn-secondary');
  if (cancelBtn) cancelBtn.style.display = '';

  try {
    callback(selected);
  } catch (e) {
    console.error('picker 콜백 오류:', e);
    notify('효과 처리 오류: ' + e.message);
  }

  if (pickerQueue.length > 0) setTimeout(runNextPicker, 150);
  else pickerRunning = false;
}

// ─────────────────────────────────────────────
// ZONE VIEWER
// ─────────────────────────────────────────────
function showZone(zoneKey) {
  const zoneMap = {
    myKeyDeck: { label: '내 키 카드 덱',   cards: G.myKeyDeck, canActivate: false },
    myGrave:   { label: '내 묘지',         cards: G.myGrave,   canActivate: true  },
    opGrave:   { label: '상대 묘지',       cards: G.opGrave,   canActivate: false },
    myExile:   { label: '내 제외 존',      cards: G.myExile,   canActivate: false },
    opExile:   { label: '상대 제외 존',    cards: G.opExile,   canActivate: false },
  };
  const zone = zoneMap[zoneKey];
  document.getElementById('zoneViewTitle').textContent = zone.label;

  const grid = document.getElementById('zoneViewGrid');
  grid.innerHTML = '';

  if (zone.cards.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-dim);font-size:.85rem">카드 없음</p>';
  } else {
    zone.cards.forEach(c => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:center';

      const el = renderCard(c);
      el.addEventListener('click', () => openCardDetail(c.id, zone.canActivate ? -2 : -1));
      wrapper.appendChild(el);

      if (zone.canActivate) {
        const hasGraveEffect = ['펭귄!돌격!','펭귄의 영광','펭귄이여 영원하라'].includes(c.id);
        if (hasGraveEffect) {
          const btn     = document.createElement('button');
          btn.className = 'btn-sm';
          btn.textContent = '효과 발동';
          btn.onclick   = () => { closeModal('zoneViewModal'); activateGraveEffect(c.id); };
          wrapper.appendChild(btn);
        }
      }
      grid.appendChild(wrapper);
    });
  }
  document.getElementById('zoneViewModal').classList.remove('hidden');
}

function viewFieldCard(who) {
  const card = who === 'me' ? G.myFieldCard : G.opFieldCard;
  if (!card) { notify('필드 존이 비어있습니다.'); return; }
  openCardDetail(card.id);
}

// ─────────────────────────────────────────────
// DECK BUILDER
// ─────────────────────────────────────────────
let builderMainDeck  = {};  // { cardId: count }
let builderKeyDeck   = {};  // { cardId: 1 }
let currentPoolFilter = '전체';

const GENERIC_CARDS = [
  '구사일생','일격필살','눈에는 눈','출입통제','단 한번의 기회',
  '유혹의 황금사과','수호의 빛','신성한 수호자','서치 봉인의 항아리','단단한 카드 자물쇠',
];

function openDeckBuilder() {
  document.getElementById('lobby').style.display     = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  filterDeckPool('전체');
  renderBuilderDeck();
}

function filterDeckPool(theme) {
  currentPoolFilter = theme;
  document.querySelectorAll('.deck-tab').forEach(t => {
    t.classList.toggle('active', t.textContent === theme);
  });

  const pool = document.getElementById('dbPool');
  pool.innerHTML = '';

  Object.values(CARDS).forEach(card => {
    if (card.isKeyCard) return;
    const matchTheme = theme === '전체'   ? true
      : theme === '범용' ? GENERIC_CARDS.includes(card.id)
      : card.theme === theme;
    if (!matchTheme) return;

    const wrapper   = document.createElement('div');
    wrapper.className = 'pool-card';
    wrapper.title   = card.name;

    const el        = renderCard({ id: card.id, name: card.name });
    el.style.cursor = 'pointer';

    const inDeck = builderMainDeck[card.id] || 0;
    if (inDeck > 0) {
      const badge     = document.createElement('div');
      badge.className = 'card-in-deck';
      badge.textContent = inDeck;
      wrapper.appendChild(badge);
    }
    el.addEventListener('click',   () => addToDeck(card.id, false));
    el.addEventListener('dblclick', () => openCardDetail(card.id));
    wrapper.appendChild(el);
    pool.appendChild(wrapper);
  });

  // 키카드 (전체 또는 테마 탭)
  if (theme !== '범용') {
    Object.values(CARDS)
      .filter(c => c.isKeyCard && (theme === '전체' || c.theme === theme))
      .forEach(card => {
        const wrapper   = document.createElement('div');
        wrapper.className = 'pool-card';

        const el        = renderCard({ id: card.id, name: card.name });
        el.style.cursor = 'pointer';
        el.style.border = '1.5px solid #7c5cbf';

        const inKey = builderKeyDeck[card.id] ? 1 : 0;
        if (inKey) {
          const badge     = document.createElement('div');
          badge.className = 'card-in-deck';
          badge.style.background = '#7c5cbf';
          badge.textContent = '✓';
          wrapper.appendChild(badge);
        }
        el.addEventListener('click', () => addToDeck(card.id, true));
        wrapper.appendChild(el);
        pool.appendChild(wrapper);
      });
  }
}

function addToDeck(cardId, isKey) {
  const card = CARDS[cardId];
  if (!card) return;

  if (isKey) {
    if (builderKeyDeck[cardId]) {
      delete builderKeyDeck[cardId];
    } else {
      if (Object.keys(builderKeyDeck).length >= 5) { notify('키카드 덱은 최대 5종입니다.'); return; }
      builderKeyDeck[cardId] = 1;
    }
  } else {
    const cur   = builderMainDeck[cardId] || 0;
    const total = Object.values(builderMainDeck).reduce((a, b) => a + b, 0);
    if (cur >= 4)   { notify('같은 카드는 최대 4장입니다.'); return; }
    if (total >= 60) { notify('메인 덱은 최대 60장입니다.'); return; }
    builderMainDeck[cardId] = cur + 1;
  }
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

function removeFromBuilderDeck(cardId, isKey) {
  if (isKey) {
    delete builderKeyDeck[cardId];
  } else {
    if (builderMainDeck[cardId] > 1) builderMainDeck[cardId]--;
    else                             delete builderMainDeck[cardId];
  }
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

function renderBuilderDeck() {
  const mainTotal = Object.values(builderMainDeck).reduce((a, b) => a + b, 0);
  const keyTotal  = Object.keys(builderKeyDeck).length;
  document.getElementById('dbMainCount').textContent = mainTotal;
  document.getElementById('dbKeyCount').textContent  = keyTotal;

  // 메인 덱 목록
  const mainList = document.getElementById('dbMainList');
  mainList.innerHTML = '';
  Object.entries(builderMainDeck).forEach(([id, count]) => {
    const chip     = document.createElement('div');
    chip.className = 'deck-card-chip';
    chip.innerHTML = `<span class="chip-count">${count}x</span>${CARDS[id]?.name || id}`;
    chip.title     = '클릭하면 1장 제거';
    chip.addEventListener('click', () => removeFromBuilderDeck(id, false));
    mainList.appendChild(chip);
  });

  // 키카드 덱 목록
  const keyList = document.getElementById('dbKeyList');
  keyList.innerHTML = '';
  Object.keys(builderKeyDeck).forEach(id => {
    const chip     = document.createElement('div');
    chip.className = 'deck-card-chip';
    chip.style.borderColor = '#7c5cbf';
    chip.innerHTML = `<span style="color:#9c7cdf">🔑</span>${CARDS[id]?.name || id}`;
    chip.title     = '클릭하면 제거';
    chip.addEventListener('click', () => removeFromBuilderDeck(id, true));
    keyList.appendChild(chip);
  });

  // 확정 버튼
  const ok = mainTotal >= 40 && mainTotal <= 60;
  const confirmBtn = document.getElementById('dbConfirmBtn');
  confirmBtn.disabled   = !ok;
  confirmBtn.textContent = ok
    ? `덱 확정 (${mainTotal}장) →`
    : `덱 확정 (${mainTotal}장, 40~60장 필요)`;
}

function loadPreset(theme) {
  if (theme === '펭귄') {
    builderMainDeck = {
      '펭귄 마을':4,'꼬마 펭귄':4,'펭귄 부부':4,'현자 펭귄':4,
      '수문장 펭귄':4,'펭귄!돌격!':4,'펭귄의 영광':4,
      '펭귄이여 영원하라':4,'펭귄 마법사':4,'구사일생':2,'눈에는 눈':2,
    };
    builderKeyDeck = { '펭귄 용사':1,'펭귄의 일격':1,'펭귄의 전설':1,'일격필살':1,'단 한번의 기회':1 };
    notify('펭귄 기본 덱 로드!');
  } else if (theme === '지배자') {
    builderMainDeck = {
      '수원소의 지배자':4,'화원소의 지배자':4,'전원소의 지배자':4,'풍원소의 지배자':4,
      '수원소의 지배룡':4,'화원소의 지배룡':4,'전원소의 지배룡':4,'풍원소의 지배룡':4,
      '지배의 사슬':4,'지배룡과 지배자':4,
      '눈에는 눈':2,'출입통제':2,'단단한 카드 자물쇠':2,'구사일생':2,
    };
    builderKeyDeck = {
      '사원소의 지배룡':1,'사원소의 지배자':1,'사원소의 기적':1,'일격필살':1,'단 한번의 기회':1,
    };
    notify('지배자/지배룡 기본 덱 로드!');
  }
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

function clearDeck() {
  builderMainDeck = {};
  builderKeyDeck  = {};
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

function confirmDeck() {
  const mainTotal = Object.values(builderMainDeck).reduce((a, b) => a + b, 0);
  if (mainTotal < 40 || mainTotal > 60) { notify('메인 덱은 40~60장이어야 합니다.'); return; }

  const deckArr = [];
  Object.entries(builderMainDeck).forEach(([id, count]) => {
    for (let i = 0; i < count; i++) deckArr.push(id);
  });
  const keyArr = Object.keys(builderKeyDeck);

  window._confirmedDeck    = deckArr;
  window._confirmedKeyDeck = keyArr;

  document.getElementById('deckBuilder').style.display = 'none';

  if (!roomRef) {
    enterGameWithDeck();
    return;
  }

  // 대기 오버레이
  const overlay   = document.createElement('div');
  overlay.id      = 'waitingOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#000c;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;z-index:500;';
  overlay.innerHTML = `
    <div style="font-family:Black Han Sans,sans-serif;font-size:1.5rem;color:#c8a96e;letter-spacing:.1em;">덱 확정 완료!</div>
    <div style="color:#888;font-size:.9rem;">상대방의 덱 확정을 기다리는 중...</div>
    <div style="width:40px;height:40px;border:3px solid #2a2a45;border-top-color:#c8a96e;border-radius:50%;animation:spin .8s linear infinite;"></div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(overlay);

  roomRef.child(myRole + 'DeckReady').set(true);
  checkBothDecksReady(overlay);
}

// ─────────────────────────────────────────────
// DECK READY SYNC
// ─────────────────────────────────────────────
// listenRoom의 value 핸들러를 제거하지 않고, 별도 자식 경로를 리슨합니다.
// 이렇게 해야 기존 listenRoom 핸들러가 유지됩니다.
let _deckReadyHandler = null;

function checkBothDecksReady(overlay) {
  if (!roomRef) { enterGameWithDeck(); return; }

  // 이전 핸들러가 있으면 정확히 제거
  if (_deckReadyHandler) {
    roomRef.off('value', _deckReadyHandler);
    _deckReadyHandler = null;
  }

  // 별도 자식 경로로 리슨 (listenRoom의 value 리스너와 충돌 없음)
  const checkHandler = (snap) => {
    const data = snap.val();
    if (!data) return;
    const hostReady  = data.hostDeckReady  === true;
    const guestReady = data.guestDeckReady === true;

    if (hostReady && guestReady) {
      roomRef.off('value', checkHandler);
      if (overlay) overlay.remove();
      enterGameWithDeck();
    }
  };

  _deckReadyHandler = checkHandler;
  roomRef.on('value', checkHandler);
}

function enterGameWithDeck() {
  gameResultRecorded = false;
  enterGame();
}
