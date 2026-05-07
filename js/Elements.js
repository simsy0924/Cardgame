
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

  function resolveLink(link) {
    resolveThemeEffectGeneric(link);
  }

  registerThemeEffectHandler('엘리멘츠', { activateFromHand, resolveLink, onElementsSummoned });
  window._elements = { addCounterToOpponent, removeCountersFromOpponent, onElementsSummoned };
})();
