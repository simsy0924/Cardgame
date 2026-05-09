// rule-stabilizer.js — 엔진 안정화 패치
// - 크툴루/올드원 코스트와 효과를 분리
// - 필드존 효과 버튼/지속효과 보강
// - 서커스메어 지속효과/소환 동기화 오류 보정
(function () {
  'use strict';

  function wait() {
    if (!window.EffectEngine || !window.EffectEngine.effects || !window.CARDS || !window.G ||
        !window.EffectEngine.effects['cthulhu_그레이트 올드 원-크툴루_1_hand']) {
      setTimeout(wait, 50);
      return;
    }
    if (window.__HAND_BATTLE_RULE_STABILIZER__) return;
    window.__HAND_BATTLE_RULE_STABILIZER__ = true;
    patchCthulhuCostEffectSeparation();
    patchFieldZoneEffectUi();
    patchContinuousEffects();
    patchTriggeredOptionalDefaults();
    if (typeof log === 'function') log('규칙 안정화 패치 적용 완료', 'system');
  }

  const cardName = (id) => (window.CARDS && CARDS[id] && CARDS[id].name) || id;
  const cardDef = (id) => (window.CARDS && CARDS[id]) || { id, name: id };
  const isMonster = (id) => cardDef(id).cardType === 'monster';
  const isGOO = (id) => typeof id === 'string' && id.startsWith('그레이트 올드 원-');
  const isElder = (id) => typeof id === 'string' && id.startsWith('엘더 갓-');
  const isOldOne = (id) => !!(id && (cardDef(id).theme === '올드원' || isGOO(id) || isElder(id) || String(id).startsWith('아우터 갓') || id === '태평양 속 르뤼에' || id === '올드_원의 멸망'));
  const notifySafe = (m) => (typeof notify === 'function' ? notify(m) : console.warn(m));
  const logSafe = (m, t = 'mine') => (typeof log === 'function' ? log(m, t) : console.log(m));
  const sync = () => { if (typeof sendGameState === 'function') sendGameState(); if (typeof renderAll === 'function') renderAll(); };
  const maxSlots = () => (typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5);

  function choose(list, title, max, cb) {
    if (!list || !list.length) { cb([]); return; }
    if (typeof openCardPicker === 'function') {
      openCardPicker(list, title, Math.min(max, list.length), (sel) => cb((sel || []).map(i => list[i])), true);
    } else {
      cb(list.slice(0, max));
    }
  }

  function removeExact(zone, target) {
    const i = zone.findIndex(c => c === target || (target && c && c._iid && target._iid && c._iid === target._iid) || (target && c && c.id === target.id));
    if (i < 0) return null;
    return zone.splice(i, 1)[0];
  }

  function moveMyFieldToGraveByIndex(i, reason) {
    if (i < 0 || i >= G.myField.length) return null;
    const moved = G.myField.splice(i, 1)[0];
    if (!moved) return null;
    G.myGrave.push(moved);
    if (typeof onSentToGrave === 'function') onSentToGrave(moved.id, 'field', moved);
    logSafe(`${reason || '효과'}: ${moved.name || cardName(moved.id)} 묘지로`, 'mine');
    return moved;
  }

  function moveOpFieldToGraveByIndex(i, reason, isTargeting = false) {
    if (i < 0 || i >= G.opField.length) return null;
    const moved = G.opField.splice(i, 1)[0];
    if (!moved) return null;
    G.opGrave.push(moved);
    if (typeof sendAction === 'function') sendAction({ type: 'opFieldRemove', cardId: moved.id, to: 'grave', isTargeting });
    logSafe(`${reason || '효과'}: 상대 ${moved.name || cardName(moved.id)} 묘지로`, 'mine');
    return moved;
  }

  function moveMyFieldCardToGrave(reason) {
    if (!G.myFieldCard) return null;
    const moved = G.myFieldCard;
    G.myFieldCard = null;
    G.myGrave.push(moved);
    if (typeof onSentToGrave === 'function') onSentToGrave(moved.id, 'fieldCard', moved);
    logSafe(`${reason || '효과'}: ${moved.name || cardName(moved.id)} 필드존→묘지`, 'mine');
    return moved;
  }

  function moveOpFieldCardToGrave(reason) {
    if (!G.opFieldCard) return null;
    const moved = G.opFieldCard;
    G.opFieldCard = null;
    G.opGrave.push(moved);
    if (typeof sendAction === 'function') sendAction({ type: 'opFieldCardRemove', cardId: moved.id, to: 'grave' });
    logSafe(`${reason || '효과'}: 상대 ${moved.name || cardName(moved.id)} 필드존→묘지`, 'mine');
    return moved;
  }

  function summonFromHandById(cardId, reason) {
    if (G.myField.length >= maxSlots()) { notifySafe('몬스터 존이 가득 찼습니다.'); return false; }
    const idx = G.myHand.findIndex(c => c.id === cardId);
    if (idx < 0) return false;
    const c = G.myHand.splice(idx, 1)[0];
    const cd = cardDef(cardId);
    G.myField.push({ id: cardId, name: cd.name || cardId, atk: cd.atk || 0, atkBase: cd.atk || 0, summonedFrom: 'hand' });
    logSafe(`${reason || '코스트'}: ${cd.name || cardId} 패에서 소환`, 'mine');
    if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId, from: 'hand' });
    if (typeof onSummon === 'function') onSummon(cardId, 'hand');
    return true;
  }

  function summonFromGraveById(cardId, reason) {
    if (G.myField.length >= maxSlots()) { notifySafe('몬스터 존이 가득 찼습니다.'); return false; }
    const i = G.myGrave.findIndex(c => c.id === cardId);
    if (i < 0) return false;
    const c = G.myGrave.splice(i, 1)[0];
    const cd = cardDef(cardId);
    G.myField.push({ id: cardId, name: cd.name || cardId, atk: cd.atk || 0, atkBase: cd.atk || 0, summonedFrom: 'grave' });
    logSafe(`${reason || '효과'}: ${cd.name || cardId} 묘지에서 소환`, 'mine');
    if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId, from: 'grave' });
    if (typeof onSummon === 'function') onSummon(cardId, 'grave');
    return true;
  }

  function summonFromDeckById(cardId, reason) {
    if (G.myField.length >= maxSlots()) { notifySafe('몬스터 존이 가득 찼습니다.'); return false; }
    const i = G.myDeck.findIndex(c => c.id === cardId);
    if (i < 0) return false;
    G.myDeck.splice(i, 1);
    const cd = cardDef(cardId);
    G.myField.push({ id: cardId, name: cd.name || cardId, atk: cd.atk || 0, atkBase: cd.atk || 0, summonedFrom: 'deck' });
    logSafe(`${reason || '효과'}: ${cd.name || cardId} 덱에서 소환`, 'mine');
    if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId, from: 'deck' });
    if (typeof onSummon === 'function') onSummon(cardId, 'deck');
    return true;
  }

  function deckPick(pred) { return (G.myDeck || []).filter(c => c && pred(c.id)); }
  function gravePick(pred) { return (G.myGrave || []).filter(c => c && pred(c.id)); }

  function exileDeckCard(cardId, reason) {
    const i = G.myDeck.findIndex(c => c.id === cardId);
    if (i < 0) return false;
    const moved = G.myDeck.splice(i, 1)[0];
    G.myExile.push({ id: moved.id, name: moved.name || cardName(moved.id) });
    if (window.GameEvents) GameEvents.emit('exile', { cardId: moved.id, card: moved, from: 'deck', player: 'mine' });
    logSafe(`${reason || '코스트'}: ${cardName(moved.id)} 덱에서 제외`, 'mine');
    return true;
  }

  function exileGraveCard(cardId, reason) {
    const i = G.myGrave.findIndex(c => c.id === cardId);
    if (i < 0) return false;
    const moved = G.myGrave.splice(i, 1)[0];
    G.myExile.push(moved);
    if (window.GameEvents) GameEvents.emit('exile', { cardId: moved.id, card: moved, from: 'grave', player: 'mine' });
    logSafe(`${reason || '코스트'}: ${cardName(moved.id)} 묘지에서 제외`, 'mine');
    return true;
  }

  function discardOneFromHand(title, done) {
    if (!G.myHand.length) { done && done(false); return; }
    choose([...G.myHand], title || '패 1장 버리기', 1, picked => {
      if (!picked.length) { done && done(false); return; }
      const moved = removeExact(G.myHand, picked[0]);
      if (moved) {
        G.myGrave.push(moved);
        if (typeof onSentToGrave === 'function') onSentToGrave(moved.id, 'hand', moved);
        logSafe(`${cardName(moved.id)} 패에서 묘지로`, 'mine');
      }
      done && done(true);
    });
  }

  function patchDef(id, patch) {
    const def = window.EffectEngine && window.EffectEngine.effects && window.EffectEngine.effects[id];
    if (!def) return false;
    Object.assign(def, patch);
    def.activate = null;
    def.chain = patch.chain !== false;
    return true;
  }

  function patchCthulhuCostEffectSeparation() {
    const E = window.EffectEngine.effects;
    if (!E) return;

    patchDef('cthulhu_그레이트 올드 원-크툴루_1_hand', {
      label: '크툴루 ① [코스트: 자신 소환] → 르뤼에 배치', effectTags: ['fieldPlace'],
      cost: (c, done) => done(summonFromHandById('그레이트 올드 원-크툴루', '크툴루 ① 코스트')),
      resolve: () => {
        const i = G.myDeck.findIndex(c => c.id === '태평양 속 르뤼에');
        if (i < 0) { notifySafe('덱에 태평양 속 르뤼에가 없습니다.'); return; }
        G.myDeck.splice(i, 1);
        if (typeof placeMyFieldCard === 'function') placeMyFieldCard('태평양 속 르뤼에', { source: 'deck', activate: false });
        else G.myFieldCard = { id: '태평양 속 르뤼에', name: '태평양 속 르뤼에' };
      },
    });

    patchDef('cthulhu_그레이트 올드 원-크툴루_2_hand', {
      label: '크툴루 ② [코스트: 필드 카드 묘지] → 자신 필드 묘지', effectTags: ['sendMyFieldToGrave'],
      cost: (c, done) => {
        const pool = [
          ...G.myField.map((x, i) => ({ ...x, _zone: 'myField', _i: i })),
          ...G.opField.map((x, i) => ({ ...x, _zone: 'opField', _i: i })),
          ...(G.myFieldCard ? [{ ...G.myFieldCard, _zone: 'myFieldCard' }] : []),
          ...(G.opFieldCard ? [{ ...G.opFieldCard, _zone: 'opFieldCard' }] : []),
        ];
        choose(pool, '크툴루 ② 코스트: 필드의 카드 1장 묘지로', 1, picked => {
          if (!picked.length) return done(false);
          const p = picked[0];
          if (p._zone === 'myField') moveMyFieldToGraveByIndex(p._i, '크툴루 ② 코스트');
          if (p._zone === 'opField') moveOpFieldToGraveByIndex(p._i, '크툴루 ② 코스트');
          if (p._zone === 'myFieldCard') moveMyFieldCardToGrave('크툴루 ② 코스트');
          if (p._zone === 'opFieldCard') moveOpFieldCardToGrave('크툴루 ② 코스트');
          done(true);
        });
      },
      resolve: () => choose([...G.myField], '크툴루 ② 효과: 자신 필드 카드 1장 묘지로', 1, picked => { if (picked.length) moveMyFieldToGraveByIndex(G.myField.indexOf(picked[0]), '크툴루 ② 효과'); sync(); }),
    });

    patchDef('cthulhu_그레이트 올드 원-크투가_1_hand', {
      label: '크투가 ① [코스트: 자신 소환] → 필드존 묘지', effectTags: ['sendFieldToGrave'],
      cost: (c, done) => done(summonFromHandById('그레이트 올드 원-크투가', '크투가 ① 코스트')),
      resolve: () => {
        const pool = [ ...(G.myFieldCard ? [{ ...G.myFieldCard, _who: 'me' }] : []), ...(G.opFieldCard ? [{ ...G.opFieldCard, _who: 'op' }] : []) ];
        choose(pool, '크투가 ① 효과: 필드존 카드 1장 묘지로', 1, picked => {
          if (picked.length) picked[0]._who === 'me' ? moveMyFieldCardToGrave('크투가 ① 효과') : moveOpFieldCardToGrave('크투가 ① 효과');
          sync();
        });
      },
    });

    patchDef('cthulhu_그레이트 올드 원-크투가_2_hand', {
      label: '크투가 ② [코스트: 패 몬스터 소환] → 자신 필드 묘지', effectTags: ['handSummon', 'sendMyFieldToGrave'],
      cost: (c, done) => {
        const pool = G.myHand.filter(x => x.id !== '그레이트 올드 원-크투가' && isMonster(x.id));
        choose(pool, '크투가 ② 코스트: 패 몬스터 1장 소환', 1, picked => {
          if (!picked.length) return done(false);
          done(summonFromHandById(picked[0].id, '크투가 ② 코스트'));
        });
      },
      resolve: () => choose([...G.myField], '크투가 ② 효과: 자신 필드 카드 1장 묘지로', 1, picked => { if (picked.length) moveMyFieldToGraveByIndex(G.myField.indexOf(picked[0]), '크투가 ② 효과'); sync(); }),
    });

    patchDef('cthulhu_그레이트 올드 원-크아이가_1_hand', {
      label: '크아이가 ① [코스트: 자신 소환] → 패 1장 버림', effectTags: ['discardHand'],
      cost: (c, done) => done(summonFromHandById('그레이트 올드 원-크아이가', '크아이가 ① 코스트')),
      resolve: () => discardOneFromHand('크아이가 ① 효과: 자신 패 1장 버리기', () => sync()),
    });

    patchDef('cthulhu_그레이트 올드 원-크아이가_2_hand', {
      label: '크아이가 ② [코스트: 상대 필드 묘지] → 패 1장 버림', effectTags: ['sendOpponentFieldToGrave', 'discardHand'],
      cost: (c, done) => choose([...G.opField], '크아이가 ② 코스트: 상대 필드 카드 1장 묘지로', 1, picked => {
        if (!picked.length) return done(false);
        moveOpFieldToGraveByIndex(G.opField.indexOf(picked[0]), '크아이가 ② 코스트', false);
        done(true);
      }),
      resolve: () => discardOneFromHand('크아이가 ② 효과: 자신 패 1장 버리기', () => sync()),
    });

    patchDef('cthulhu_그레이트 올드 원-과타노차_1_hand', {
      label: '과타노차 ① [코스트: GOO 묘지+자신 소환] → 드로우 선택', effectTags: ['draw'],
      cost: (c, done) => {
        const pool = G.myField.filter(x => isGOO(x.id));
        choose(pool, '과타노차 ① 코스트: 자신 필드 GOO 1장 묘지로', 1, picked => {
          if (!picked.length) return done(false);
          moveMyFieldToGraveByIndex(G.myField.indexOf(picked[0]), '과타노차 ① 코스트');
          done(summonFromHandById('그레이트 올드 원-과타노차', '과타노차 ① 코스트'));
        });
      },
      resolve: () => gameConfirm('과타노차 ①\n1장 드로우하시겠습니까?', yes => { if (yes && typeof drawOne === 'function') drawOne(); sync(); }),
    });

    patchDef('cthulhu_엘더 갓-크타니트_1_hand', {
      label: '크타니트 ① [코스트: 자신 소환] → 서로 드로우', effectTags: ['draw'],
      cost: (c, done) => done(summonFromHandById('엘더 갓-크타니트', '크타니트 ① 코스트')),
      resolve: () => { if (typeof drawOne === 'function') drawOne(); if (typeof sendAction === 'function') sendAction({ type: 'opDraw', count: 1 }); sync(); },
    });

    const nodensResolve = () => {
      const pool = deckPick(isGOO);
      choose(pool, '노덴스 ② 효과: 덱에서 GOO 1장 묘지로', 1, picked => {
        if (picked.length) {
          const i = G.myDeck.findIndex(c => c.id === picked[0].id);
          if (i >= 0) {
            const moved = G.myDeck.splice(i, 1)[0];
            G.myGrave.push({ id: moved.id, name: moved.name || cardName(moved.id) });
            if (typeof onSentToGrave === 'function') onSentToGrave(moved.id, 'deck', moved);
          }
        }
        sync();
      });
    };
    const nodensCost = (c, done) => {
      const pool = gravePick(isGOO);
      choose(pool, '노덴스 ② 코스트: 묘지 GOO 1장 제외', 1, picked => {
        if (!picked.length) return done(false);
        done(exileGraveCard(picked[0].id, '노덴스 ② 코스트'));
      });
    };
    patchDef('cthulhu_엘더 갓-노덴스_2_hand', { label: '노덴스 ② [코스트: 묘지 GOO 제외] → 덱 GOO 묘지', effectTags: ['sendDeckToGrave'], cost: nodensCost, resolve: nodensResolve });
    patchDef('cthulhu_nodens_2_field', { label: '노덴스 ② [코스트: 묘지 GOO 제외] → 덱 GOO 묘지', effectTags: ['sendDeckToGrave'], cost: nodensCost, resolve: nodensResolve });

    patchDef('cthulhu_올드_원의 멸망_1_hand', {
      label: '올드_원의 멸망 ① [코스트: 엘더 갓 제외] → GOO 소환', effectTags: ['deckBanish', 'deckSummon', 'graveSummon'],
      cost: (c, done) => {
        // 마법 카드는 발동 카드 자체를 먼저 묘지로 보낸다.
        const hi = G.myHand.findIndex(x => x.id === '올드_원의 멸망');
        if (hi >= 0) { const moved = G.myHand.splice(hi, 1)[0]; G.myGrave.push(moved); if (typeof onSentToGrave === 'function') onSentToGrave(moved.id, 'hand', moved); }
        const pool = deckPick(isElder);
        choose(pool, '올드_원의 멸망 ① 코스트: 덱에서 엘더 갓 제외', 1, picked => {
          if (!picked.length) return done(false);
          done(exileDeckCard(picked[0].id, '올드_원의 멸망 ① 코스트'));
        });
      },
      resolve: () => {
        const pool = [...deckPick(isGOO).map(c => ({ ...c, _from: 'deck' })), ...gravePick(isGOO).map(c => ({ ...c, _from: 'grave' }))];
        choose(pool, '올드_원의 멸망 ① 효과: 덱/묘지에서 GOO 소환', 1, picked => {
          if (picked.length) picked[0]._from === 'deck' ? summonFromDeckById(picked[0].id, '올드_원의 멸망 ①') : summonFromGraveById(picked[0].id, '올드_원의 멸망 ①');
          sync();
        });
      },
    });

    patchDef('cthulhu_ghatanothoa_2_field', {
      label: '과타노차 ② [코스트: 이 카드+상대 카드 묘지] → 패 GOO 소환', effectTags: ['sendOpponentFieldToGrave', 'handSummon'],
      cost: (c, done) => {
        const fi = G.myField.findIndex(x => x.id === '그레이트 올드 원-과타노차');
        if (fi < 0) return done(false);
        moveMyFieldToGraveByIndex(fi, '과타노차 ② 코스트');
        const pool = [...G.opField.map((x, i) => ({ ...x, _src: 'field', _i: i })), ...G.opHand.map((x, i) => ({ id: x.id, name: x.isPublic ? x.name : '비공개 패', _src: 'hand', _i: i }))];
        choose(pool, '과타노차 ② 코스트: 상대 패/필드 카드 1장 묘지로', 1, picked => {
          if (!picked.length) return done(false);
          if (picked[0]._src === 'field') moveOpFieldToGraveByIndex(picked[0]._i, '과타노차 ② 코스트', false);
          else if (typeof sendAction === 'function') sendAction({ type: 'forceDiscard', count: 1, reason: '과타노차 ②', attackerPicks: false });
          done(true);
        });
      },
      resolve: () => {
        const pool = G.myHand.filter(x => isGOO(x.id));
        choose(pool, '과타노차 ② 효과: 패에서 GOO 1장 소환', 1, picked => { if (picked.length) summonFromHandById(picked[0].id, '과타노차 ②'); sync(); });
      },
    });
  }

  function patchFieldZoneEffectUi() {
    // 등록형 UI 패치들이 여러 번 감싸져도 마지막에 필드존 효과 버튼을 확실히 다시 그린다.
    if (typeof window.viewFieldCard !== 'function' || window.viewFieldCard.__ruleStabilizerPatched) return;
    const oldView = window.viewFieldCard;
    window.viewFieldCard = function viewFieldCardRuleStabilized(who) {
      const ret = oldView.apply(this, arguments);
      if (who !== 'me') return ret;
      setTimeout(() => {
        const card = G.myFieldCard;
        if (!card || !window.EffectEngine || !EffectEngine.getActivatableEffects) return;
        const actions = document.getElementById('mdCardActions');
        if (!actions) return;
        const effects = EffectEngine.getActivatableEffects(card.id, 'fieldCard', { cardId: card.id, sourceZone: 'fieldCard' });
        if (!effects.length) return;
        actions.innerHTML = '';
        const h = document.createElement('div');
        h.className = 'effect-registry-header field-zone';
        h.textContent = '필드존 효과';
        actions.appendChild(h);
        effects.forEach(def => {
          if (def.effectNum === 0) return;
          const b = document.createElement('button');
          b.className = 'btn btn-primary';
          b.textContent = def.label || def.id;
          b.onclick = () => { if (typeof closeModal === 'function') closeModal('cardDetailModal'); EffectEngine.activateEffect(def.id, { cardId: card.id, sourceZone: 'fieldCard' }); };
          actions.appendChild(b);
        });
        const close = document.createElement('button');
        close.className = 'btn btn-secondary';
        close.textContent = '닫기';
        close.onclick = () => { if (typeof closeModal === 'function') closeModal('cardDetailModal'); };
        actions.appendChild(close);
      }, 0);
      return ret;
    };
    window.viewFieldCard.__ruleStabilizerPatched = true;
  }

  function patchContinuousEffects() {
    // 메드 키메라 ①은 소환 유발이 아니라 필드에 존재하는 동안 적용되는 지속 효과다.
    if (typeof window.checkImmunity === 'function' && !window.checkImmunity.__ruleStabilizerPatched) {
      const old = window.checkImmunity;
      window.checkImmunity = function checkImmunityRuleStabilized(cardId, effectType, source) {
        const circusMonster = typeof isCircusmareMonster === 'function' ? isCircusmareMonster(cardId) : (cardDef(cardId).theme === '서커스메어' && cardDef(cardId).cardType === 'monster');
        const chimeraActive = G.myField.some(c => c && c.id === '서커스메어 메드 키메라' && !c.effectNegatedUntilEndTurn);
        if (chimeraActive && source === 'opponent' && circusMonster) {
          if (effectType === 'target') return { immune: true, reason: '메드 키메라 ①: 서커스메어 몬스터는 상대 효과의 대상이 되지 않습니다.' };
          if (effectType === 'toGrave') return { immune: true, reason: '메드 키메라 ①: 서커스메어 몬스터는 상대 효과로 묘지로 보내지지 않습니다.' };
        }
        const springActive = G.myField.some(c => c && c.id === '서커스메어 스프링 제스터' && !c.effectNegatedUntilEndTurn);
        if (cardId === '서커스메어 스프링 제스터' && source === 'opponent' && springActive && ['effect','target','toGrave'].includes(effectType)) {
          return { immune: true, reason: '스프링 제스터 ④: 상대가 발동한 효과를 받지 않습니다.' };
        }
        return old.apply(this, arguments);
      };
      window.checkImmunity.__ruleStabilizerPatched = true;
    }

    // 기존 플래그가 없어도 지속 효과가 동작하도록 매 렌더 전 보정한다.
    const refresh = () => {
      if (!window.G) return;
      G._cmMedChimeraActive = G.myField.some(c => c && c.id === '서커스메어 메드 키메라' && !c.effectNegatedUntilEndTurn);
    };
    if (typeof window.renderAll === 'function' && !window.renderAll.__ruleStabilizerPatched) {
      const oldRender = window.renderAll;
      window.renderAll = function renderAllRuleStabilized() { refresh(); return oldRender.apply(this, arguments); };
      window.renderAll.__ruleStabilizerPatched = true;
    }
    refresh();
  }

  function patchTriggeredOptionalDefaults() {
    if (typeof window.normalizeTriggeredEffect === 'function' && !window.normalizeTriggeredEffect.__ruleStabilizerPatched) {
      const old = window.normalizeTriggeredEffect;
      window.normalizeTriggeredEffect = function normalizeTriggeredEffectRuleStabilized(effect) {
        const out = old.apply(this, arguments);
        if (!out) return out;
        if (effect && effect.optional === undefined && effect.mandatory === undefined) {
          const card = cardDef(effect.cardId);
          const text = String(card.effects || '');
          const forced = /발동한다/.test(text) || /적용한다/.test(text) && !/발동할 수 있다/.test(text);
          out.optional = !forced;
          out.mandatory = forced;
        }
        return out;
      };
      window.normalizeTriggeredEffect.__ruleStabilizerPatched = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wait);
  else wait();
})();
