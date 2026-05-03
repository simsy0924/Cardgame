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

  function addCounterToOpponent(opFieldIdx, type, amount = 1) {
    const mon = G.opField[opFieldIdx];
    if (!mon || !type) return 0;
    const map = _ensureCounterMap(mon);
    map[type] = (map[type] || 0) + amount;

    if (type === '화염') mon.atk = (mon.atk ?? CARDS[mon.id]?.atk ?? 0) - amount;
    if (type === '궁극') mon.atk = (mon.atk ?? CARDS[mon.id]?.atk ?? 0) + amount;
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

    openCardPicker(choices.map(x => ({ id: `${x.mi}:${x.type}`, name: x.label })), '제거할 카운터 선택(최대 2)', Math.min(totalToRemove, choices.length), (sel) => {
      sel.forEach(i => {
        const it = choices[i];
        const mon = G.opField[it.mi];
        if (!mon?.counters?.[it.type]) return;
        mon.counters[it.type] -= 1;
        if (mon.counters[it.type] <= 0) delete mon.counters[it.type];
        removed += 1;
      });
      if (removed > 0) {
        const targets = findAllInDeck(c => CARDS[c.id]?.theme === '엘리멘츠');
        openCardPicker(targets, `엘리멘츠 불꽃정령 ③: ${removed}장 서치`, Math.min(removed, targets.length), (pick) => {
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
      const hasElements = G.myField.some(m => CARDS[m.id]?.theme === '엘리멘츠');
      if (G.myField.length > 0 && !hasElements) return notify('내 필드에 엘리멘츠 카드가 없으면 소환할 수 없습니다.');
      markEffectUsed(id, 1);
      summonFromHand(handIdx);
      sendGameState(); renderAll();
      return;
    }

    if (id === '엘리멘츠의 불꽃정령' && effectNum === 3) {
      if (!canUseEffect(id, 3)) return notify('이미 사용했습니다.');
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

    gameConfirm(`${cardId} ②\n확인=상대 몬스터에 ${counterType} 카운터\n취소=덱에서 엘리멘츠 카드 서치`, (yes) => {
      markEffectUsed(cardId, 2);
      if (yes && G.opField.length > 0) {
        openCardPicker(G.opField, `${cardId} ②: 카운터를 놓을 상대 몬스터 선택`, 1, (sel) => {
          if (sel.length > 0) {
            addCounterToOpponent(sel[0], counterType, 1);
            log(`${cardId} ②: ${counterType} 카운터 1개 배치`, 'mine');
          }
          sendGameState(); renderAll();
        });
      } else {
        const targets = findAllInDeck(dc => CARDS[dc.id]?.theme === '엘리멘츠');
        if (targets.length === 0) return;
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
