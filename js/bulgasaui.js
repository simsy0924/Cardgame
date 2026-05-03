// bulgasaui.js — 불가사의 테마 효과 로직

function _findBulgasauiInDeck(predicate = null) {
  return findAllInDeck(dc => {
    const info = CARDS[dc.id] || {};
    if (info.theme !== '불가사의') return false;
    return predicate ? !!predicate(info, dc) : true;
  });
}

function _collectBulgasauiFromZones() {
  const all = [];
  (G.myGrave || []).forEach(c => all.push({ ...c, _zone: 'grave' }));
  (G.myExile || []).forEach(c => all.push({ ...c, _zone: 'exile' }));
  return all.filter(c => CARDS[c.id]?.theme === '불가사의');
}

function _reviveBulgasauiMonsterFromZones(label, after) {
  const pool = _collectBulgasauiFromZones().filter(c => CARDS[c.id]?.cardType === 'monster');
  if (pool.length === 0) { after && after(false); return; }
  openCardPicker(pool, label, 1, (sel) => {
    if (sel.length === 0) { after && after(false); return; }
    const pick = pool[sel[0]];
    let ok = false;
    if (pick._zone === 'grave') ok = summonFromGrave(pick.id);
    else {
      const ei = G.myExile.findIndex(c => c.id === pick.id);
      if (ei >= 0 && G.myField.length < maxFieldSlots()) {
        const c = G.myExile.splice(ei, 1)[0];
        G.myField.push({ id: c.id, name: c.name || CARDS[c.id]?.name || c.id, atk: CARDS[c.id]?.atk || 0, atkBase: CARDS[c.id]?.atk || 0 });
        sendAction({ type: 'summon', cardId: c.id, source: 'exile' });
        ok = true;
      }
    }
    after && after(!!ok);
  });
}

function resolveBulgasauiEffect(link) {
  const cardId = link.cardId;
  const mainText = link.mainText || '';
  const card = CARDS[cardId] || { name: cardId };

  if (cardId === '불가사의한 귀신 헬리콥터') {
    const targets = _findBulgasauiInDeck();
    if (targets.length > 0) {
      openCardPicker(targets, `${card.name}: 덱에서 불가사의 카드 1장`, 1, (sel) => {
        if (sel.length > 0) searchToHand(targets[sel[0]].id);
        drawN(1);
        renderAll();
      });
    } else drawN(1);
    log(`${card.name}: 불가사의 서치 + 1드로우`, 'mine');
    return;
  }

  if (cardId === '불가사의한 빨간 마스크') {
    const targets = _findBulgasauiInDeck(info => info.cardType !== 'monster');
    if (targets.length === 0) return;
    openCardPicker(targets, `${card.name}: 불가사의 비몬스터 서치`, 1, (sel) => {
      if (sel.length > 0) searchToHand(targets[sel[0]].id);
      renderAll();
    });
    return;
  }

  if (cardId === '불가사의한 밤의 대도시') {
    const mons = _findBulgasauiInDeck(info => info.cardType === 'monster');
    if (mons.length === 0) return;
    openCardPicker(mons, `${card.name}: 덱에서 불가사의 몬스터 1장 묘지로`, 1, (sel) => {
      if (sel.length === 0) return;
      const pick = mons[sel[0]];
      if (removeFromDeck(pick.id)) {
        G.myGrave.push({ id: pick.id, name: pick.name || CARDS[pick.id]?.name || pick.id });
        log(`${card.name}: ${pick.name || pick.id} 묘지로`, 'mine');
      }
      renderAll();
    });
    return;
  }

  if (cardId === '불가사의한 적월') {
    const max = G.myField.filter(c => CARDS[c.id]?.theme === '불가사의').length;
    const myTargets = [...G.myField, ...(G.myFieldCard ? [G.myFieldCard] : [])];
    const opTargets = [...G.opField, ...(G.opFieldCard ? [G.opFieldCard] : [])];
    if (myTargets.length === 0 || opTargets.length === 0) return;

    openCardPicker(opTargets, `${card.name}: 상대 필드 제외`, Math.min(max, opTargets.length), (opSel) => {
      const pickedOp = opSel.map(i => opTargets[i]).filter(Boolean);
      pickedOp.forEach(t => {
        const oi = G.opField.findIndex(c => c.id === t.id);
        if (oi >= 0) {
          const rm = G.opField.splice(oi, 1)[0];
          if (rm) { G.opExile.push(rm); sendAction({ type: 'opFieldRemove', cardId: rm.id, to: 'exile' }); }
        } else if (G.opFieldCard && G.opFieldCard.id === t.id) {
          G.opExile.push(G.opFieldCard);
          G.opFieldCard = null;
          sendAction({ type: 'opFieldCardRemove', cardId: t.id, to: 'exile' });
        }
      });

      openCardPicker(myTargets, `${card.name}: 내 필드 제외`, Math.min(pickedOp.length, myTargets.length), (mySel) => {
        mySel.map(i => myTargets[i]).filter(Boolean).forEach(t => {
          const mi = G.myField.findIndex(c => c.id === t.id);
          if (mi >= 0) G.myExile.push(G.myField.splice(mi, 1)[0]);
          else if (G.myFieldCard && G.myFieldCard.id === t.id) { G.myExile.push(G.myFieldCard); G.myFieldCard = null; }
        });
        renderAll();
      });
    });
    return;
  }

  if (cardId === '불가사의한 일루미나티') {
    _reviveBulgasauiMonsterFromZones(`${card.name}: 묘지/제외에서 불가사의 몬스터 소환`, () => {
      drawN(1);
      renderAll();
    });
    return;
  }

  if (mainText.includes('패에 넣')) {
    const targets = _findBulgasauiInDeck();
    if (targets.length > 0) {
      openCardPicker(targets, `${card.name}: 불가사의 카드 서치`, 1, (sel) => {
        if (sel.length > 0) searchToHand(targets[sel[0]].id);
        renderAll();
      });
      return;
    }
  }

  resolveThemeEffectGeneric(link);
}

registerThemeEffectHandler('불가사의', {
  activateFromHand: activateThemeCardEffectFromHand,
  resolveLink: resolveBulgasauiEffect,
});
