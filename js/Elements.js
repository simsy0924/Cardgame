// Elements.js — 엘리멘츠 테마 전용 엔진

(function initElementsTheme() {
  const COUNTER_TYPES = ['화염', '물', '전기', '바람', '궁극'];

  function _ensureCounterMap(mon) {
    if (!mon) return null;
    if (!mon.counters || typeof mon.counters !== 'object') mon.counters = {};
    return mon.counters;
  }

  function _inferCounterType(cardId) {
    if (cardId.includes('불꽃정령')) return '화염';
    if (cardId.includes('물정령')) return '물';
    if (cardId.includes('전기정령')) return '전기';
    if (cardId.includes('바람정령')) return '바람';
    if (cardId.includes('궁극')) return '궁극';
    return null;
  }

  function _triggerCounterSideEffects(type, mon, prevCount, nextCount) {
    if (!mon) return;

    if (type === '전기') {
      const prevPairs = Math.floor(prevCount / 2);
      const nextPairs = Math.floor(nextCount / 2);
      const gainedPairs = Math.max(0, nextPairs - prevPairs);
      for (let i = 0; i < gainedPairs; i++) {
        sendAction({ type: 'forceDiscard', count: 1, reason: '엘리멘츠의 전기정령 카운터 효과' });
        log('전기 카운터 2개 달성: 상대가 패 1장 버립니다.', 'mine');
      }
    }

    if (type === '바람') {
      const prevPairs = Math.floor(prevCount / 2);
      const nextPairs = Math.floor(nextCount / 2);
      const gainedPairs = Math.max(0, nextPairs - prevPairs);
      for (let i = 0; i < gainedPairs; i++) {
        drawOne();
        log('바람 카운터 2개 달성: 1장 드로우.', 'mine');
      }
    }
  }

  function addCounterToOpponent(opFieldIdx, type, amount = 1) {
    const mon = G.opField[opFieldIdx];
    if (!mon || !type || amount <= 0) return 0;

    const map = _ensureCounterMap(mon);
    const prev = map[type] || 0;
    const next = prev + amount;
    map[type] = next;

    if (type === '화염') mon.atk = (mon.atk ?? CARDS[mon.id]?.atk ?? 0) - amount;
    if (type === '궁극') mon.atk = (mon.atk ?? CARDS[mon.id]?.atk ?? 0) + amount;

    _triggerCounterSideEffects(type, mon, prev, next);
    return amount;
  }

  function removeCountersFromOpponent(totalToRemove = 2) {
    let removed = 0;
    const choices = [];
    G.opField.forEach((m, mi) => {
      const cs = m?.counters || {};
      COUNTER_TYPES.forEach(t => {
        const n = cs[t] || 0;
        for (let i = 0; i < n; i++) choices.push({ mi, type: t, label: `${m.name} - ${t} 카운터` });
      });
    });

    if (choices.length === 0) return 0;

    // [BUG FIX] forced=true — 반드시 선택해야 효과 처리 (취소 불가)
    openCardPicker(choices.map(x => ({ id: `${x.mi}:${x.type}`, name: x.label })), '제거할 카운터 선택(최대 2)', Math.min(totalToRemove, choices.length), (sel) => {
      sel.forEach(i => {
        const it = choices[i];
        const mon = G.opField[it.mi];
        if (!mon?.counters?.[it.type]) return;
        mon.counters[it.type] -= 1;
        if (it.type === '화염') mon.atk = (mon.atk ?? CARDS[mon.id]?.atk ?? 0) + 1;
        if (it.type === '궁극') mon.atk = (mon.atk ?? CARDS[mon.id]?.atk ?? 0) - 1;
        if (mon.counters[it.type] <= 0) delete mon.counters[it.type];
        removed += 1;
      });
      if (removed > 0) {
        const targets = findAllInDeck(c => CARDS[c.id]?.theme === '엘리멘츠');
        // [BUG FIX] 덱에 엘리멘츠 카드가 없으면 서치 피커 없이 바로 종료
        if (targets.length === 0) { sendGameState(); renderAll(); return; }
        openCardPicker(targets, `엘리멘츠의 불꽃정령 ③: 카운터 제거 ${removed}개 → 서치`, Math.min(removed, targets.length), (pick) => {
          pick.forEach(i => searchToHand(targets[i].id));
          sendGameState(); renderAll();
        });
      } else { sendGameState(); renderAll(); }
    });
    return -1; // async
  }

  function activateFromHand(handIdx, effectNum = 1) {
    const c = G.myHand[handIdx];
    if (!c) return;
    const id = c.id;

    if (id.includes('정령') && effectNum === 1) {
      if (!canUseEffect(id, 1)) return notify('이미 사용했습니다.');
      if (G.myField.length >= maxFieldSlots()) return notify('몬스터 존이 가득 찼습니다.');
      // [BUG FIX] 필드가 비어있으면 자유 소환, 필드에 무언가 있으면 엘리멘츠 카드 필요
      const hasElements = G.myField.some(m => CARDS[m.id]?.theme === '엘리멘츠');
      if (G.myField.length > 0 && !hasElements) {
        return notify(`${CARDS[id]?.name || id} ①: 자신 필드에 엘리멘츠 카드가 존재할 경우에만 소환할 수 있습니다.`);
      }
      markEffectUsed(id, 1);
      summonFromHand(handIdx);
      sendGameState(); renderAll();
      return;
    }

    // 엘리멘츠의 궁극신/창조신 — 소환 조건 체크
    if ((id === '엘리멘츠의 궁극신' || id === '엘리멘츠의 궁극 창조신') && effectNum === 1) {
      const requiredCounterTypes = id === '엘리멘츠의 궁극신' ? 2 : 4; // 궁극신: 4종×2개, 창조신: 4종×4개
      const counterTypes = ['화염', '물', '전기', '바람'];
      const typesPresent = counterTypes.filter(type =>
        G.opField.some(m => (m.counters?.[type] || 0) >= (id === '엘리멘츠의 궁극신' ? 2 : 4))
      );
      if (typesPresent.length < 4) {
        const need = id === '엘리멘츠의 궁극신' ? '4종류 각 2개' : '4종류 각 4개';
        return notify(`${CARDS[id]?.name}: 소환 조건 불충족 (상대 필드 카운터 ${need} 필요)`);
      }
      // 조건 충족 — 카운터 제거 후 소환
      counterTypes.forEach(type => {
        const removeCount = id === '엘리멘츠의 궁극신' ? 2 : 4;
        G.opField.forEach(m => { if (m.counters?.[type]) m.counters[type] = Math.max(0, (m.counters[type] || 0) - removeCount); });
      });
      log(`${CARDS[id]?.name} 소환 조건 충족 — 카운터 제거 후 소환`, 'mine');
      markEffectUsed(id, 1);
      summonFromHand(handIdx);
      sendGameState(); renderAll();
      return;
    }

    if (id === '엘리멘츠의 불꽃정령' && effectNum === 3) {
      if (!canUseEffect(id, 3)) return notify('이미 사용했습니다.');
      const hasAnyCounter = G.opField.some(m => Object.values(m?.counters || {}).some(n => n > 0));
      if (!hasAnyCounter) return notify('제거할 카운터가 없습니다.');
      markEffectUsed(id, 3);
      const r = removeCountersFromOpponent(2);
      if (r === 0) notify('제거할 카운터가 없습니다.');
      return;
    }

    activateThemeCardEffectFromHand(handIdx, effectNum);
  }

  function onElementsSummoned(cardId) {
    const counterType = _inferCounterType(cardId);
    if (!counterType) return;
    if (!canUseEffect(cardId, 2)) return;
    // [BUG FIX] markEffectUsed를 gameConfirm 전에 호출 — 다이얼로그 열린 사이 중복 발동 방지
    markEffectUsed(cardId, 2);

    gameConfirm(`${cardId} ②\n확인=상대 몬스터에 ${counterType} 카운터\n취소=덱에서 엘리멘츠 카드 서치`, (yes) => {
      if (yes && G.opField.length > 0) {
        openCardPicker(G.opField, `${cardId} ②: 카운터를 놓을 상대 몬스터 선택`, 1, (sel) => {
          if (sel.length > 0) {
            addCounterToOpponent(sel[0], counterType, 1);
            log(`${cardId} ②: ${counterType} 카운터 1개 배치`, 'mine');
          }
          sendGameState(); renderAll();
        });
      } else {
        // yes=false 또는 상대 필드 없음 → 덱에서 엘리멘츠 서치
        const targets = findAllInDeck(dc => CARDS[dc.id]?.theme === '엘리멘츠');
        if (targets.length === 0) { sendGameState(); renderAll(); return; } // [BUG FIX] 서치 대상 없어도 상태 업데이트
        openCardPicker(targets, `${cardId} ②: 엘리멘츠 카드 서치`, 1, (sel) => {
          if (sel.length > 0) searchToHand(targets[sel[0]].id);
          sendGameState(); renderAll();
        });
      }
    });
  }


  const ELEMENT_SPIRITS = {
    '엘리멘츠의 불꽃정령': '화염',
    '엘리멘츠의 물정령': '물',
    '엘리멘츠의 전기정령': '전기',
    '엘리멘츠의 바람정령': '바람',
  };
  const BASIC_COUNTERS = ['화염', '물', '전기', '바람'];

  function isElementsCardObj(c) { return !!c && CARDS[c.id]?.theme === '엘리멘츠'; }
  function isElementsMonsterObj(c) { return isElementsCardObj(c) && CARDS[c.id]?.cardType === 'monster'; }
  function cardName(id) { return CARDS[id]?.name || id; }
  function canUse(cardId, n, max = 1) { return typeof canUseEffect !== 'function' || canUseEffect(cardId, n, max); }
  function markUse(cardId, n) { if (typeof markEffectUsed === 'function') markEffectUsed(cardId, n); }
  function sync() { sendGameState(); renderAll(); }

  function handHas(cardId, idx) { return G.myHand[idx] && G.myHand[idx].id === cardId; }
  function fieldHas(cardId, idx) { return G.myField[idx] && G.myField[idx].id === cardId; }
  function graveHas(cardId) { return G.myGrave.some(c => c && c.id === cardId); }
  function exileHas(cardId) { return G.myExile.some(c => c && c.id === cardId); }
  function currentIsMyDeploy() { return myTurn() && currentPhase === 'deploy'; }
  function hasElementsOnMyField() { return G.myField.some(isElementsCardObj) || (G.myFieldCard && CARDS[G.myFieldCard.id]?.theme === '엘리멘츠'); }
  function canSpiritSummon(cardId, handIdx) {
    return handHas(cardId, handIdx) && G.myField.length < maxFieldSlots() && (G.myField.length === 0 || hasElementsOnMyField()) && canUse(cardId, 1);
  }
  function elementsDeckCards(pred = isElementsCardObj) { return findAllInDeck(c => pred(c)); }
  function elementsGraveCards(pred = isElementsCardObj) { return (G.myGrave || []).filter(pred); }
  function elementsExileCards(pred = isElementsCardObj) { return (G.myExile || []).filter(pred); }

  function removeFromGraveById(cardId) {
    const idx = G.myGrave.findIndex(c => c.id === cardId);
    if (idx < 0) return null;
    return G.myGrave.splice(idx, 1)[0];
  }
  function removeFromExileById(cardId) {
    const idx = G.myExile.findIndex(c => c.id === cardId);
    if (idx < 0) return null;
    return G.myExile.splice(idx, 1)[0];
  }
  function removeFromHandIndex(idx) {
    if (idx < 0 || !G.myHand[idx]) return null;
    return G.myHand.splice(idx, 1)[0];
  }
  function removeFromFieldIndex(idx) {
    if (idx < 0 || !G.myField[idx]) return null;
    return G.myField.splice(idx, 1)[0];
  }
  function addToPublicHand(cardId) {
    G.myHand.push({ id: cardId, name: cardName(cardId), isPublic: true });
  }
  function summonCardObject(cardObj, from = 'effect') {
    if (!cardObj || G.myField.length >= maxFieldSlots()) return false;
    const def = CARDS[cardObj.id];
    if (!def || def.cardType !== 'monster') return false;
    G.myField.push({ id: cardObj.id, name: def.name, atk: def.atk || 0, atkBase: def.atk || 0, summonedFrom: from });
    log(`${from === 'grave' ? '묘지' : from === 'exile' ? '제외' : '효과'}에서 소환: ${def.name}`, 'mine');
    onSummon(cardObj.id, from);
    return true;
  }
  function summonFromKeyDeckDirect(cardId) {
    if (G.myField.length >= maxFieldSlots()) { notify('몬스터 존이 가득 찼습니다.'); return false; }
    const idx = (G.myKeyDeck || []).findIndex(c => c.id === cardId);
    if (idx < 0) { notify('키 카드 덱에 대상 카드가 없습니다.'); return false; }
    const key = G.myKeyDeck.splice(idx, 1)[0];
    const def = CARDS[cardId];
    G.myField.push({ id: key.id, name: def?.name || key.name, atk: def?.atk || 0, atkBase: def?.atk || 0, summonedFrom: 'keyDeck' });
    log(`키 카드 덱에서 소환: ${def?.name || key.name}`, 'mine');
    onSummon(cardId, 'keyDeck');
    return true;
  }

  function addCounterToAllOpponent(type, amount = 1) {
    let total = 0;
    G.opField.forEach((m, idx) => { if (m) total += addCounterToOpponent(idx, type, amount); });
    return total;
  }
  function totalCounterCount(types = COUNTER_TYPES) {
    let total = 0;
    G.opField.forEach(m => { const cs = m?.counters || {}; types.forEach(t => total += (cs[t] || 0)); });
    return total;
  }
  function hasCounterTypeCount(type, count) {
    return G.opField.reduce((a, m) => a + (m?.counters?.[type] || 0), 0) >= count;
  }
  function removeCounterTypeTotal(type, count) {
    let left = count;
    G.opField.forEach(m => {
      if (left <= 0 || !m?.counters?.[type]) return;
      const take = Math.min(left, m.counters[type]);
      m.counters[type] -= take;
      if (type === '화염') m.atk = (m.atk ?? CARDS[m.id]?.atk ?? 0) + take;
      if (type === '궁극') m.atk = (m.atk ?? CARDS[m.id]?.atk ?? 0) - take;
      if (m.counters[type] <= 0) delete m.counters[type];
      left -= take;
    });
    return count - left;
  }
  function removeCounterCondition(eachCount) {
    if (!BASIC_COUNTERS.every(t => hasCounterTypeCount(t, eachCount))) return false;
    BASIC_COUNTERS.forEach(t => removeCounterTypeTotal(t, eachCount));
    return true;
  }
  function countUltimateCountersOnMyField() {
    return G.myField.reduce((sum, m) => sum + (m?.counters?.['궁극'] || 0), 0);
  }
  function removeUltimateCountersFromMyField(n) {
    let left = n;
    G.myField.forEach(m => {
      if (left <= 0 || !m?.counters?.['궁극']) return;
      const take = Math.min(left, m.counters['궁극']);
      m.counters['궁극'] -= take;
      m.atk = (m.atk ?? CARDS[m.id]?.atk ?? 0) - take;
      if (m.counters['궁극'] <= 0) delete m.counters['궁극'];
      left -= take;
    });
    return n - left;
  }

  function counterTypeOfElementMonster(cardId) { return ELEMENT_SPIRITS[cardId] || _inferCounterType(cardId); }

  function activateSpiritSummon1(handIdx) {
    const cardId = G.myHand[handIdx]?.id;
    if (!cardId || !ELEMENT_SPIRITS[cardId]) return false;
    if (!canSpiritSummon(cardId, handIdx)) { notify(`${cardName(cardId)} ①: 소환 조건 불충족`); return false; }
    markUse(cardId, 1);
    summonFromHand(handIdx);
    return true;
  }

  function triggerSpiritSummon2(cardId) {
    const type = ELEMENT_SPIRITS[cardId];
    if (!type || !canUse(cardId, 2)) return false;
    markUse(cardId, 2);
    gameConfirm(`${cardName(cardId)} ②\n확인=상대 몬스터에 ${type} 카운터\n취소=덱에서 엘리멘츠 카드 서치`, (yes) => {
      if (yes && G.opField.length > 0) {
        openCardPicker(G.opField, `${cardName(cardId)} ②: 카운터를 놓을 상대 몬스터 선택`, 1, (sel) => {
          if (sel.length) {
            addCounterToOpponent(sel[0], type, 1);
            log(`${cardName(cardId)} ②: ${type} 카운터 1개 배치`, 'mine');
          }
          sync();
        }, true);
      } else {
        const targets = elementsDeckCards(isElementsCardObj);
        if (!targets.length) { sync(); return; }
        openCardPicker(targets, `${cardName(cardId)} ②: 엘리멘츠 카드 서치`, 1, (sel) => {
          if (sel.length) searchToHand(targets[sel[0]].id);
          sync();
        }, true);
      }
    });
    return true;
  }

  function activateFireSpirit3(handIdx) {
    if (!handHas('엘리멘츠의 불꽃정령', handIdx) || !canUse('엘리멘츠의 불꽃정령', 3)) return false;
    if (totalCounterCount(BASIC_COUNTERS) <= 0) { notify('제거할 기본 카운터가 없습니다.'); return false; }
    markUse('엘리멘츠의 불꽃정령', 3);
    removeCountersFromOpponent(2);
    return true;
  }

  function activateElectricSpirit3FromHand(handIdx) {
    if (!handHas('엘리멘츠의 전기정령', handIdx) || !canUse('엘리멘츠의 전기정령', 3)) return false;
    const c = removeFromHandIndex(handIdx);
    if (!c) return false;
    G.myGrave.push(c);
    onSentToGrave(c.id, 'hand', c);
    markUse('엘리멘츠의 전기정령', 3);
    addCounterToAllOpponent('전기', 1);
    log('엘리멘츠의 전기정령 ③: 상대 몬스터 전부에 전기 카운터 1개', 'mine');
    sync();
    return true;
  }
  function activateElectricSpirit3FromField(fieldIdx) {
    if (!fieldHas('엘리멘츠의 전기정령', fieldIdx) || !canUse('엘리멘츠의 전기정령', 3)) return false;
    const c = removeFromFieldIndex(fieldIdx);
    if (!c) return false;
    G.myGrave.push(c);
    onSentToGrave(c.id, 'field', c);
    markUse('엘리멘츠의 전기정령', 3);
    addCounterToAllOpponent('전기', 1);
    log('엘리멘츠의 전기정령 ③: 상대 몬스터 전부에 전기 카운터 1개', 'mine');
    sync();
    return true;
  }

  function triggerWaterPublicHand3(cardId) {
    if (cardId !== '엘리멘츠의 물정령' || !canUse(cardId, 3)) return false;
    const idx = G.myHand.findIndex(c => c.id === cardId && c.isPublic);
    if (idx < 0) return false;
    const targets = elementsDeckCards(isElementsCardObj);
    if (!targets.length) return false;
    markUse(cardId, 3);
    openCardPicker(targets, '엘리멘츠의 물정령 ③: 덱에서 묘지로 보낼 엘리멘츠 카드', 1, (sel) => {
      if (sel.length) {
        const id = targets[sel[0]].id;
        if (removeFromDeck(id)) {
          G.myGrave.push({ id, name: cardName(id) });
          onSentToGrave(id, 'deck', { id, name: cardName(id) });
          log(`엘리멘츠의 물정령 ③: ${cardName(id)} 덱에서 묘지로`, 'mine');
        }
      }
      const h = G.myHand.find(c => c.id === cardId && c.isPublic);
      if (h) h.isPublic = false;
      sync();
    }, true);
    return true;
  }

  function triggerWindSentToGrave3(event) {
    if (event?.cardId !== '엘리멘츠의 바람정령' || !canUse('엘리멘츠의 바람정령', 3)) return false;
    const t = elementsDeckCards(c => c.id === '엘리멘츠 in rainbow forest');
    if (!t.length) return false;
    markUse('엘리멘츠의 바람정령', 3);
    searchToHand('엘리멘츠 in rainbow forest');
    log('엘리멘츠의 바람정령 ③: 엘리멘츠 in rainbow forest 서치', 'mine');
    return true;
  }

  function activateRainbowForest1(handIdx) {
    if (!handHas('엘리멘츠 in rainbow forest', handIdx) || !canUse('엘리멘츠 in rainbow forest', 1)) return false;
    const c = removeFromHandIndex(handIdx);
    if (!c) return false;
    if (typeof placeMyFieldCard === 'function') {
      placeMyFieldCard(c.id, { source: 'hand', activate: true, send: true, sync: false, render: false });
    } else {
      if (G.myFieldCard) { const oldField = G.myFieldCard; G.myGrave.push(oldField); onSentToGrave(oldField.id, 'fieldCard', oldField); }
      G.myFieldCard = { id: c.id, name: c.name };
      sendAction({ type: 'fieldCard', cardId: c.id, source: 'hand', activate: true });
    }
    markUse(c.id, 1);
    const targets = elementsDeckCards(isElementsMonsterObj);
    if (!targets.length) { sync(); return true; }
    openCardPicker(targets, '엘리멘츠 in rainbow forest ①: 엘리멘츠 몬스터 서치', 1, (sel) => {
      if (sel.length) searchToHand(targets[sel[0]].id);
      sync();
    }, true);
    return true;
  }
  function triggerRainbowForest3(event) {
    if (event?.cardId !== '엘리멘츠 in rainbow forest' || !canUse('엘리멘츠 in rainbow forest', 3)) return false;
    const targets = elementsGraveCards(c => c.id !== '엘리멘츠 in rainbow forest' && isElementsCardObj(c));
    if (!targets.length) return false;
    markUse('엘리멘츠 in rainbow forest', 3);
    openCardPicker(targets, '엘리멘츠 in rainbow forest ③: 묘지의 엘리멘츠 회수', 1, (sel) => {
      if (sel.length) {
        const id = targets[sel[0]].id;
        const card = removeFromGraveById(id);
        if (card) { G.myHand.push({ id: card.id, name: card.name || cardName(card.id), isPublic: true }); log(`${cardName(id)} 회수`, 'mine'); }
      }
      sync();
    }, true);
    return true;
  }

  function activateFairy1(handIdx) {
    if (!handHas('엘리멘츠 is fairy!!!', handIdx) || !canUse('엘리멘츠 is fairy!!!', 1)) return false;
    const pool = [...elementsDeckCards(isElementsMonsterObj), ...elementsGraveCards(isElementsMonsterObj)];
    const unique = pool.filter((c, i, a) => a.findIndex(x => x.id === c.id) === i);
    if (!unique.length) { notify('확인할 엘리멘츠 몬스터가 없습니다.'); return false; }
    markUse('엘리멘츠 is fairy!!!', 1);
    openCardPicker(unique, '엘리멘츠 is fairy!!! ①: 확인할 몬스터 최대 2장', Math.min(2, unique.length), (sel) => {
      const types = new Set(sel.map(i => counterTypeOfElementMonster(unique[i].id)).filter(Boolean));
      const removed = [];
      G.opField = G.opField.filter(m => {
        const has = [...types].some(t => (m?.counters?.[t] || 0) > 0);
        if (has) removed.push(m);
        return !has;
      });
      if (removed.length) log(`엘리멘츠 is fairy!!! ①: 카운터가 놓인 상대 몬스터 ${removed.length}장 묘지로`, 'mine');
      sync();
    }, true);
    return true;
  }

  function applyFourSpiritCountersToAll(label) {
    const pool = [...elementsDeckCards(isElementsMonsterObj), ...elementsGraveCards(isElementsMonsterObj)];
    const unique = pool.filter((c, i, a) => a.findIndex(x => x.id === c.id) === i && counterTypeOfElementMonster(c.id));
    const byType = BASIC_COUNTERS.map(t => unique.find(c => counterTypeOfElementMonster(c.id) === t)).filter(Boolean);
    if (byType.length < 4) { notify('카드명이 다른 4종류 엘리멘츠 몬스터가 부족합니다.'); return false; }
    BASIC_COUNTERS.forEach(t => addCounterToAllOpponent(t, 1));
    log(`${label}: 상대 몬스터 전부에 4종 기본 카운터 1개씩 배치`, 'mine');
    return true;
  }
  function activateFairy2Grave() {
    if (!graveHas('엘리멘츠 is fairy!!!') || !currentIsMyDeploy() || !canUse('엘리멘츠 is fairy!!!', 2)) return false;
    const card = removeFromGraveById('엘리멘츠 is fairy!!!');
    if (!card) return false;
    sendToExile(card, 'grave');
    markUse('엘리멘츠 is fairy!!!', 2);
    applyFourSpiritCountersToAll('엘리멘츠 is fairy!!! ②');
    sync();
    return true;
  }

  function activateMagic1(handIdx) {
    if (!handHas('엘리멘츠의 MAGIC', handIdx) || !canUse('엘리멘츠의 MAGIC', 1)) return false;
    const banishTargets = elementsDeckCards(isElementsCardObj);
    if (banishTargets.length < 2) { notify('덱의 엘리멘츠 카드가 부족합니다.'); return false; }
    markUse('엘리멘츠의 MAGIC', 1);
    openCardPicker(banishTargets, '엘리멘츠의 MAGIC ①: 제외할 엘리멘츠 카드', 1, (bSel) => {
      if (!bSel.length) { sync(); return; }
      const banishId = banishTargets[bSel[0]].id;
      if (removeFromDeck(banishId)) sendToExile({ id: banishId, name: cardName(banishId) }, 'deck');
      const graveTargets = elementsDeckCards(isElementsCardObj);
      if (!graveTargets.length) { sync(); return; }
      openCardPicker(graveTargets, '엘리멘츠의 MAGIC ①: 묘지로 보낼 엘리멘츠 카드', 1, (gSel) => {
        if (gSel.length) {
          const gid = graveTargets[gSel[0]].id;
          if (removeFromDeck(gid)) { const obj = { id: gid, name: cardName(gid) }; G.myGrave.push(obj); onSentToGrave(gid, 'deck', obj); }
        }
        sync();
      }, true);
    }, true);
    return true;
  }
  function activateMagic2Grave() {
    if (!graveHas('엘리멘츠의 MAGIC') || !canUse('엘리멘츠의 MAGIC', 2)) return false;
    const targets = elementsExileCards(isElementsCardObj);
    if (!targets.length) { notify('제외된 엘리멘츠 카드가 없습니다.'); return false; }
    const self = removeFromGraveById('엘리멘츠의 MAGIC');
    if (!self) return false;
    sendToExile(self, 'grave');
    markUse('엘리멘츠의 MAGIC', 2);
    openCardPicker(targets, '엘리멘츠의 MAGIC ②: 제외 카드 최대 2장 회수/소환', Math.min(2, targets.length), (sel) => {
      sel.forEach(i => {
        const id = targets[i].id;
        const card = removeFromExileById(id);
        if (!card) return;
        if (CARDS[id]?.cardType === 'monster' && G.myField.length < maxFieldSlots()) summonCardObject(card, 'exile');
        else G.myHand.push({ id, name: card.name || cardName(id), isPublic: true });
      });
      sync();
    }, true);
    return true;
  }

  function activateTrap2Grave() {
    if (!graveHas('엘리멘츠의 TR∀P') || myTurn() || !canUse('엘리멘츠의 TR∀P', 2)) return false;
    const self = removeFromGraveById('엘리멘츠의 TR∀P');
    if (!self) return false;
    sendToExile(self, 'grave');
    markUse('엘리멘츠의 TR∀P', 2);
    applyFourSpiritCountersToAll('엘리멘츠의 TR∀P ②');
    sync();
    return true;
  }
  function activateTrap1Chain(handIdx) {
    if (!handHas('엘리멘츠의 TR∀P', handIdx) || !canUse('엘리멘츠의 TR∀P', 1)) return false;
    const removed = removeCounterTypeTotal('화염', 1) + removeCounterTypeTotal('물', 1) + removeCounterTypeTotal('전기', 1) + removeCounterTypeTotal('바람', 1);
    if (removed < 4) { notify('이름이 다른 카운터 4개가 필요합니다.'); return false; }
    const c = removeFromHandIndex(handIdx);
    if (c) G.myGrave.push(c);
    markUse('엘리멘츠의 TR∀P', 1);
    addChainLink({ type: 'genericNegate', label: '엘리멘츠의 TR∀P ①', cardId: '엘리멘츠의 TR∀P', effectNum: 1 });
    sync();
    return true;
  }

  function activateShape1(handIdx) {
    if (!handHas('엘리멘츠의 ♤♡◇♧', handIdx) || !canUse('엘리멘츠의 ♤♡◇♧', 1)) return false;
    const targets = elementsDeckCards(isElementsMonsterObj).filter(c => counterTypeOfElementMonster(c.id));
    if (!targets.length) { notify('소환할 엘리멘츠 몬스터가 없습니다.'); return false; }
    markUse('엘리멘츠의 ♤♡◇♧', 1);
    openCardPicker(targets, '엘리멘츠의 ♤♡◇♧ ①: 덱에서 소환할 몬스터', 1, (sel) => {
      if (sel.length) {
        const id = targets[sel[0]].id;
        if (summonFromDeck(id)) {
          const type = counterTypeOfElementMonster(id);
          const placed = addCounterToAllOpponent(type, 1);
          G.elementsShapeCountersPlaced = (G.elementsShapeCountersPlaced || 0) + placed;
        }
      }
      sync();
    }, true);
    return true;
  }
  function activateShape2Grave() {
    if (!graveHas('엘리멘츠의 ♤♡◇♧') || !canUse('엘리멘츠의 ♤♡◇♧', 2)) return false;
    const self = removeFromGraveById('엘리멘츠의 ♤♡◇♧');
    if (!self) return false;
    sendToExile(self, 'grave');
    markUse('엘리멘츠의 ♤♡◇♧', 2);
    const n = G.elementsShapeCountersPlaced || 0;
    drawN(n);
    if (G.myHand.length) {
      openCardPicker(G.myHand, '엘리멘츠의 ♤♡◇♧ ②: 버릴 패 1장', 1, (sel) => {
        if (sel.length) { const c = G.myHand.splice(sel[0], 1)[0]; G.myGrave.push(c); onSentToGrave(c.id, 'hand', c); }
        sync();
      }, true);
    } else sync();
    return true;
  }

  function canSummonUltimate(cardId) {
    return G.myField.length < maxFieldSlots() && removeCounterCondition(cardId === '엘리멘츠의 궁극신' ? 2 : 4);
  }
  function summonUltimateFromHand(handIdx, cardId) {
    cardId = cardId || G.myHand[handIdx]?.id;
    if (!handHas(cardId, handIdx) || !canUse(cardId, 0)) return false;
    if (!BASIC_COUNTERS.every(t => hasCounterTypeCount(t, cardId === '엘리멘츠의 궁극신' ? 2 : 4))) { notify('소환 조건 불충족'); return false; }
    removeCounterCondition(cardId === '엘리멘츠의 궁극신' ? 2 : 4);
    markUse(cardId, 0);
    summonFromHand(handIdx);
    return true;
  }
  function summonUltimateFromGrave(cardId) {
    if (!graveHas(cardId) || !canUse(cardId, 0)) return false;
    if (!BASIC_COUNTERS.every(t => hasCounterTypeCount(t, cardId === '엘리멘츠의 궁극신' ? 2 : 4))) { notify('소환 조건 불충족'); return false; }
    removeCounterCondition(cardId === '엘리멘츠의 궁극신' ? 2 : 4);
    markUse(cardId, 0);
    summonFromGrave(cardId);
    return true;
  }
  function triggerUltimateGod1(cardId) {
    if (cardId !== '엘리멘츠의 궁극신') return false;
    const selfIdx = G.myField.findIndex(c => c.id === cardId);
    const returnedMy = [];
    G.myField = G.myField.filter((m, i) => { if (i !== selfIdx) { returnedMy.push(m); return false; } return true; });
    returnedMy.forEach(m => G.myHand.push({ id: m.id, name: m.name, isPublic: true }));
    sendAction({ type: 'returnAllMonstersExcept', exceptCardId: cardId });
    log('엘리멘츠의 궁극신 ①: 다른 몬스터를 전부 패로 되돌림', 'mine');
    sync();
    return true;
  }
  function activateUltimateGod2(fieldIdx, cardId) {
    cardId = cardId || G.myField[fieldIdx]?.id || '엘리멘츠의 궁극신';
    if (!fieldHas(cardId, fieldIdx) || !currentIsMyDeploy() || !canUse(cardId, 2)) return false;
    const candidates = G.myHand.filter(isElementsMonsterObj).filter((c, i, a) => a.findIndex(x => x.id === c.id) === i && c.id !== cardId);
    if (!candidates.length) { notify('소환할 엘리멘츠 몬스터가 없습니다.'); return false; }
    markUse(cardId, 2);
    openCardPicker(candidates, `${cardName(cardId)} ②: 패에서 소환할 몬스터 최대 4장`, Math.min(4, candidates.length), (sel) => {
      sel.map(i => candidates[i].id).forEach(id => {
        const idx = G.myHand.findIndex(c => c.id === id);
        if (idx >= 0) summonFromHand(idx);
      });
      const self = G.myField.find(c => c.id === cardId);
      const me = G.myField.find(c => c.id === cardId);
      if (me) { const map = _ensureCounterMap(me); map['궁극'] = (map['궁극'] || 0) + 1; me.atk = (me.atk ?? CARDS[me.id]?.atk ?? 0) + 1; }
      sync();
    }, true);
    return true;
  }
  function triggerUltimateGod4(event) {
    if (event?.cardId !== '엘리멘츠의 궁극신' || !canUse('엘리멘츠의 궁극신', 4)) return false;
    const card = removeFromExileById('엘리멘츠의 궁극신');
    if (!card) return false;
    G.myHand.push({ id: card.id, name: card.name || cardName(card.id), isPublic: true });
    markUse('엘리멘츠의 궁극신', 4);
    log('엘리멘츠의 궁극신 ④: 제외에서 패로 회수', 'mine');
    sync();
    return true;
  }
  function activateUltimateGod3Chain(fieldIdx) {
    if (!fieldHas('엘리멘츠의 궁극신', fieldIdx) || !canUse('엘리멘츠의 궁극신', 3)) return false;
    markUse('엘리멘츠의 궁극신', 3);
    addChainLink({ type: 'genericNegate', label: '엘리멘츠의 궁극신 ③', cardId: '엘리멘츠의 궁극신', effectNum: 3 });
    return true;
  }

  function triggerCreator1(event) {
    if (event?.cardId !== '엘리멘츠의 궁극 창조신') return false;
    const max = Math.min(7, G.opField.length + G.myGrave.length);
    if (G.opField.length < 3 || max <= 0) return false;
    const opReturn = Math.min(G.opField.length, Math.max(3, Math.min(7, G.opField.length)));
    sendAction({ type: 'returnOpponentFieldToHand', count: opReturn });
    log(`엘리멘츠의 궁극 창조신 ①: 상대 필드 카드 ${opReturn}장 패로 되돌림 요청`, 'mine');
    sync();
    return true;
  }
  function triggerCreator4(event) {
    if (event?.cardId !== '엘리멘츠의 궁극 창조신' || !canUse('엘리멘츠의 궁극 창조신', 4)) return false;
    const card = removeFromExileById('엘리멘츠의 궁극 창조신');
    if (!card || G.myField.length >= maxFieldSlots()) return false;
    markUse('엘리멘츠의 궁극 창조신', 4);
    summonCardObject(card, 'exile');
    const me = G.myField.find(c => c.id === '엘리멘츠의 궁극 창조신');
    if (me) { const map = _ensureCounterMap(me); map['궁극'] = (map['궁극'] || 0) + 1; me.atk = (me.atk ?? CARDS[me.id]?.atk ?? 0) + 1; }
    sync();
    return true;
  }
  function activateCreator5(fieldIdx) {
    if (!fieldHas('엘리멘츠의 궁극 창조신', fieldIdx) || !currentIsMyDeploy() || !canUse('엘리멘츠의 궁극 창조신', 5)) return false;
    if (countUltimateCountersOnMyField() < 3) { notify('궁극 카운터가 3개 필요합니다.'); return false; }
    removeUltimateCountersFromMyField(3);
    const c = G.myField[fieldIdx];
    c.atk = (c.atk ?? CARDS[c.id]?.atk ?? 0) + 7;
    c.cannotLeaveUntilEndTurn = true;
    markUse('엘리멘츠의 궁극 창조신', 5);
    log('엘리멘츠의 궁극 창조신 ⑤: 공격력 +7, 이 턴 필드에서 벗어나지 않음', 'mine');
    sync();
    return true;
  }

  function activateElementsMagicCard1(handIdx) {
    if (!handHas('엘리멘츠의 마법', handIdx) || !canUse('엘리멘츠의 마법', 1)) return false;
    const pool = [...elementsGraveCards(isElementsCardObj).map(c => ({ ...c, _src: 'grave' })), ...elementsExileCards(isElementsCardObj).map(c => ({ ...c, _src: 'exile' }))];
    const deckMons = elementsDeckCards(isElementsMonsterObj).filter(c => counterTypeOfElementMonster(c.id));
    if (!pool.length || !deckMons.length) { notify('대상 또는 덱 소환 대상이 부족합니다.'); return false; }
    markUse('엘리멘츠의 마법', 1);
    openCardPicker(pool, '엘리멘츠의 마법 ①: 묘지/제외 엘리멘츠 대상', 1, (sel) => {
      if (sel.length) {
        const t = pool[sel[0]];
        const card = t._src === 'grave' ? removeFromGraveById(t.id) : removeFromExileById(t.id);
        if (card) {
          if (CARDS[t.id]?.cardType === 'monster') summonCardObject(card, t._src);
          else G.myHand.push({ id: card.id, name: card.name || cardName(card.id), isPublic: true });
        }
      }
      openCardPicker(deckMons, '엘리멘츠의 마법 ①: 덱에서 소환할 몬스터', 1, (dSel) => {
        if (dSel.length && summonFromDeck(deckMons[dSel[0]].id)) {
          const type = counterTypeOfElementMonster(deckMons[dSel[0]].id);
          if (G.opField.length) openCardPicker(G.opField, '카운터 2개를 놓을 상대 몬스터', 1, (oSel) => { if (oSel.length) addCounterToOpponent(oSel[0], type, 2); sync(); }, true);
          else sync();
        } else sync();
      }, true);
    }, true);
    return true;
  }

  function activateUltimateElements1(handIdx) {
    if (!handHas('궁극의 엘리멘츠', handIdx) || !canUse('궁극의 엘리멘츠', 1)) return false;
    if (!G.myField.some(c => c.id === '엘리멘츠의 궁극 창조신')) { notify('엘리멘츠의 궁극 창조신이 필요합니다.'); return false; }
    markUse('궁극의 엘리멘츠', 1);
    summonFromKeyDeckDirect('엘리멘츠의 궁극신');
    sync();
    return true;
  }
  function triggerUltimateElements2(event) {
    if (event?.cardId !== '궁극의 엘리멘츠' || !canUse('궁극의 엘리멘츠', 2)) return false;
    const targets = elementsDeckCards(isElementsCardObj);
    if (!targets.length) return false;
    markUse('궁극의 엘리멘츠', 2);
    openCardPicker(targets, '궁극의 엘리멘츠 ②: 덱에서 엘리멘츠 카드 서치', 1, (sel) => {
      if (sel.length) searchToHand(targets[sel[0]].id);
      if (G.myHand.length) openCardPicker(G.myHand, '궁극의 엘리멘츠 ②: 버릴 패 1장', 1, (dSel) => {
        if (dSel.length) { const c = G.myHand.splice(dSel[0], 1)[0]; G.myGrave.push(c); onSentToGrave(c.id, 'hand', c); }
        sync();
      }, true); else sync();
    }, true);
    return true;
  }


  function resolveLink(link) {
    resolveThemeEffectGeneric(link);
  }


  function registerElementsChainResponses() {
    if (typeof registerChainHandResponse !== 'function' || typeof registerChainFieldResponse !== 'function') {
      setTimeout(registerElementsChainResponses, 50);
      return;
    }
    registerChainHandResponse('엘리멘츠의 TR∀P', [
      {
        effectNum: 1,
        label: '① 이름이 다른 카운터 4개 제거 → 상대 효과 무효',
        condition: () => !myTurn() && typeof _chainHasOpponentLink === 'function' && _chainHasOpponentLink() && canUse('엘리멘츠의 TR∀P', 1)
          && BASIC_COUNTERS.every(t => G.opField.reduce((sum, m) => sum + (m?.counters?.[t] || 0), 0) >= 1),
        activate: (handIdx) => activateTrap1Chain(handIdx),
      },
    ]);
    registerChainFieldResponse('엘리멘츠의 궁극신', [
      {
        effectNum: 3,
        label: '③ 상대 효과 무효',
        condition: (fieldIdx) => fieldHas('엘리멘츠의 궁극신', fieldIdx) && typeof _chainHasOpponentLink === 'function' && _chainHasOpponentLink() && canUse('엘리멘츠의 궁극신', 3),
        activate: (fieldIdx) => activateUltimateGod3Chain(fieldIdx),
      },
    ]);
  }
  registerElementsChainResponses();

  // [BUG FIX] onSummoned 키로 등록 — patch.js의 _fire가 handler.onSummoned를 호출하므로
  registerThemeEffectHandler('엘리멘츠', { activateFromHand, resolveLink, onSummoned: onElementsSummoned });
  window._elements = { addCounterToOpponent, removeCountersFromOpponent, onElementsSummoned, activateSpiritSummon1, triggerSpiritSummon2, activateFireSpirit3, activateElectricSpirit3FromHand, activateElectricSpirit3FromField, triggerWaterPublicHand3, triggerWindSentToGrave3, activateRainbowForest1, triggerRainbowForest3, activateFairy1, activateFairy2Grave, activateMagic1, activateMagic2Grave, activateTrap1Chain, activateTrap2Grave, activateShape1, activateShape2Grave, summonUltimateFromHand, summonUltimateFromGrave, triggerUltimateGod1, activateUltimateGod2, activateUltimateGod3Chain, triggerUltimateGod4, triggerCreator1, triggerCreator4, activateCreator5, activateElementsMagicCard1, activateUltimateElements1, triggerUltimateElements2 };
})();