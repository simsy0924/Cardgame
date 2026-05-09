// bulgasaui-registry.js — 불가사의 테마 등록형 효과 패치
// 기존 bulgasaui.js의 부분 구현을 보강하고, 손패/필드/묘지/제외/체인 반응을 EffectEngine으로 모은다.

(function () {
  'use strict';

  function boot() {
    if (!window.EffectEngine || !window.CARDS || !window.G) {
      setTimeout(boot, 50);
      return;
    }
    if (window.__bulgasauiRegistryPatched) return;
    window.__bulgasauiRegistryPatched = true;

    const ENGINE = window.EffectEngine;
    const BULLETS = ['', '①', '②', '③', '④', '⑤'];

    const safeLog = (msg, type = 'mine') => typeof log === 'function' ? log(msg, type) : console.log(`[${type}] ${msg}`);
    const safeNotify = (msg) => typeof notify === 'function' ? notify(msg) : console.warn(msg);
    const myTurn = () => typeof isMyTurn !== 'undefined' && !!isMyTurn;
    const phase = () => typeof currentPhase !== 'undefined' ? currentPhase : '';
    const canUse = (cardId, num, max = 1) => typeof canUseEffect !== 'function' || canUseEffect(cardId, num, max);
    const markUse = (cardId, num) => { if (typeof markEffectUsed === 'function') markEffectUsed(cardId, num); };
    const fieldLimit = () => typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5;
    const hasCity = () => !!(G.myFieldCard && G.myFieldCard.id === '불가사의한 밤의 대도시');
    const isBulga = (id) => CARDS[id]?.theme === '불가사의';
    const isBulgaMonster = (id) => isBulga(id) && CARDS[id]?.cardType === 'monster';
    const isOpponentEffectOnChain = () => !!(typeof activeChainState !== 'undefined' && activeChainState && activeChainState.active && (activeChainState.links || []).some(l => l.by !== myRole));

    const REVIVE_MONSTERS = [
      '불가사의한 망태 할아버지',
      '불가사의한 빨간 마스크',
      '불가사의한 장산범',
      '불가사의한 숨바꼭질 인형',
      '불가사의한 원흉',
    ];

    function cardObj(id, extra = {}) {
      const c = CARDS[id] || { name: id };
      return Object.assign({ id, name: c.name || id }, extra);
    }

    function effectText(cardId, effectNum) {
      const raw = String(CARDS[cardId]?.effects || '');
      const bullet = BULLETS[effectNum] || '';
      if (!bullet || !raw.includes(bullet)) return '';
      const start = raw.indexOf(bullet);
      let end = raw.length;
      for (let i = effectNum + 1; i < BULLETS.length; i++) {
        const pos = raw.indexOf(BULLETS[i], start + 1);
        if (pos >= 0 && pos < end) end = pos;
      }
      return raw.slice(start, end).trim();
    }

    function sync() {
      if (typeof sendGameState === 'function') sendGameState();
      if (typeof renderAll === 'function') renderAll();
    }

    function deckTargets(pred) {
      if (typeof findAllInDeck !== 'function') return [];
      return findAllInDeck(dc => {
        const id = dc.id;
        return !!(id && CARDS[id] && pred(id, CARDS[id], dc));
      });
    }

    function removeDeckToGrave(id, source = 'bulgasaui') {
      if (typeof removeFromDeck !== 'function' || !removeFromDeck(id)) return false;
      const obj = cardObj(id);
      G.myGrave.push(obj);
      if (window.GameEvents && typeof window.GameEvents.emit === 'function') {
        window.GameEvents.emit('sentToGrave', { cardId: id, card: obj, from: 'deck', player: 'mine', source });
      }
      safeLog(`덱에서 묘지로: ${obj.name}`, 'mine');
      return true;
    }

    function removeHandIndexToGrave(idx, reason = '불가사의') {
      if (!Number.isInteger(idx) || idx < 0 || idx >= G.myHand.length) return null;
      const c = G.myHand.splice(idx, 1)[0];
      G.myGrave.push(c);
      if (window.GameEvents && typeof window.GameEvents.emit === 'function') {
        window.GameEvents.emit('discard', { cardId: c.id, card: c, from: 'hand', player: 'mine', source: reason });
        window.GameEvents.emit('sentToGrave', { cardId: c.id, card: c, from: 'hand', player: 'mine', source: reason });
      }
      safeLog(`버림: ${c.name || c.id}`, 'mine');
      return c;
    }

    function discardOne(label, done, excludeIdx = null) {
      const pool = (G.myHand || []).map((c, i) => Object.assign({}, c, { _handIdx: i })).filter(c => c._handIdx !== excludeIdx);
      if (!pool.length) { safeNotify('버릴 패가 없습니다.'); done && done(false); return; }
      openCardPicker(pool, label || '패 1장 버리기', 1, (sel) => {
        if (!sel || !sel.length) { done && done(false); return; }
        const realIdx = pool[sel[0]]._handIdx;
        removeHandIndexToGrave(realIdx, 'bulgasauiCost');
        done && done(true);
      }, true);
    }

    function discardNCards(n, label, done, excludeIdx = null) {
      const pool = (G.myHand || []).map((c, i) => Object.assign({}, c, { _handIdx: i })).filter(c => c._handIdx !== excludeIdx);
      const need = Math.min(n, pool.length);
      if (need < n) { safeNotify(`버릴 패가 ${n}장 필요합니다.`); done && done(false); return; }
      openCardPicker(pool, label || `패 ${n}장 버리기`, n, (sel) => {
        if (!sel || sel.length < n) { done && done(false); return; }
        sel.map(i => pool[i]._handIdx).sort((a, b) => b - a).forEach(i => removeHandIndexToGrave(i, 'bulgasauiCost'));
        done && done(true);
      }, true);
    }

    function addToHandFromDeck(id) {
      if (typeof searchToHand === 'function') return searchToHand(id);
      if (typeof removeFromDeck === 'function' && removeFromDeck(id)) {
        G.myHand.push(Object.assign(cardObj(id), { isPublic: true }));
        return true;
      }
      return false;
    }

    function zonePool(zones = ['grave', 'exile'], pred = () => true) {
      const out = [];
      if (zones.includes('grave')) (G.myGrave || []).forEach((c, i) => { if (pred(c.id, c, 'grave')) out.push(Object.assign({}, c, { _zone: 'grave', _idx: i })); });
      if (zones.includes('exile')) (G.myExile || []).forEach((c, i) => { if (pred(c.id, c, 'exile')) out.push(Object.assign({}, c, { _zone: 'exile', _idx: i })); });
      return out;
    }

    function moveZoneCardToHand(pick) {
      if (!pick) return false;
      const zone = pick._zone === 'exile' ? G.myExile : G.myGrave;
      const idx = zone.findIndex((c, i) => i === pick._idx || c.id === pick.id);
      if (idx < 0) return false;
      const c = zone.splice(idx, 1)[0];
      G.myHand.push(Object.assign(cardObj(c.id), { isPublic: true }));
      safeLog(`${c.name || c.id} 회수`, 'mine');
      return true;
    }

    function removeFromGraveOrExile(id, preferredZone = null) {
      const zones = preferredZone ? [preferredZone] : ['grave', 'exile'];
      for (const z of zones) {
        const arr = z === 'exile' ? G.myExile : G.myGrave;
        const idx = arr.findIndex(c => c.id === id);
        if (idx >= 0) return { card: arr.splice(idx, 1)[0], zone: z };
      }
      return null;
    }

    function summonFromGraveOrExile(id, preferredZone = null) {
      if (G.myField.length >= fieldLimit()) { safeNotify('몬스터 존이 가득 찼습니다.'); return false; }
      const def = CARDS[id];
      if (!def || def.cardType !== 'monster') return false;
      if (preferredZone === 'grave' && typeof summonFromGrave === 'function') return summonFromGrave(id);
      const moved = removeFromGraveOrExile(id, preferredZone);
      if (!moved) return false;
      G.myField.push({ id, name: def.name || id, atk: def.atk || 0, atkBase: def.atk || 0, summonedFrom: moved.zone });
      safeLog(`${moved.zone === 'grave' ? '묘지' : '제외'}에서 소환: ${def.name || id}`, 'mine');
      if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId: id, source: moved.zone });
      if (typeof onSummon === 'function') onSummon(id, moved.zone);
      else if (window.GameEvents && typeof window.GameEvents.emit === 'function') window.GameEvents.emit('summon', { cardId: id, from: moved.zone, player: 'mine' });
      return true;
    }

    function reviveThis(cardId, sourceZone = null) {
      if (!hasCity()) { safeNotify('불가사의한 밤의 대도시가 필요합니다.'); return false; }
      return summonFromGraveOrExile(cardId, sourceZone);
    }

    function placeCityFromDeck() {
      const id = '불가사의한 밤의 대도시';
      if (G.myFieldCard && G.myFieldCard.id === id) return true;
      const inDeck = deckTargets(x => x === id).length > 0;
      if (!inDeck) { safeNotify('덱에 불가사의한 밤의 대도시가 없습니다.'); return false; }
      if (typeof removeFromDeck === 'function') removeFromDeck(id);
      if (typeof placeMyFieldCard === 'function') return placeMyFieldCard(id, { source: 'deck', activate: false, send: true });
      G.myFieldCard = cardObj(id);
      if (typeof sendAction === 'function') sendAction({ type: 'fieldCard', cardId: id, source: 'deck', activate: false });
      safeLog('불가사의한 밤의 대도시를 필드 존에 놓음', 'mine');
      return true;
    }

    function placeFieldFromZones() {
      const pool = zonePool(['grave', 'exile'], id => CARDS[id]?.cardType === 'field');
      if (!pool.length) { safeNotify('묘지/제외에 필드 카드가 없습니다.'); return false; }
      openCardPicker(pool, '필드 존에 놓을 필드 카드 선택', 1, (sel) => {
        if (!sel || !sel.length) return;
        const p = pool[sel[0]];
        const moved = removeFromGraveOrExile(p.id, p._zone);
        if (!moved) return;
        if (typeof placeMyFieldCard === 'function') placeMyFieldCard(p.id, { source: p._zone, activate: false, send: true });
        else G.myFieldCard = cardObj(p.id);
        sync();
      });
      return true;
    }

    function returnZoneCardToDeck() {
      const pool = zonePool(['grave', 'exile'], () => true);
      if (!pool.length) { safeNotify('되돌릴 묘지/제외 카드가 없습니다.'); return false; }
      openCardPicker(pool, '덱으로 되돌릴 카드 선택', 1, (sel) => {
        if (!sel || !sel.length) return;
        const p = pool[sel[0]];
        const moved = removeFromGraveOrExile(p.id, p._zone);
        if (!moved) return;
        G.myDeck.push(cardObj(p.id));
        if (typeof shuffle === 'function') G.myDeck = shuffle(G.myDeck);
        safeLog(`${p.name || p.id} 덱으로 되돌림`, 'mine');
        sync();
      });
      return true;
    }

    function buffBulgaMonsterByZoneTypes() {
      const typeCount = new Set(zonePool(['grave', 'exile'], () => true).map(c => CARDS[c.id]?.cardType).filter(Boolean)).size;
      if (typeCount <= 0 || !G.myField.length) return false;
      openCardPicker(G.myField, `공격력을 올릴 몬스터 선택 (+${typeCount})`, 1, (sel) => {
        if (!sel || !sel.length || !G.myField[sel[0]]) return;
        G.myField[sel[0]].atk = (G.myField[sel[0]].atk || 0) + typeCount;
        safeLog(`${G.myField[sel[0]].name} ATK +${typeCount}`, 'mine');
        sync();
      });
      return true;
    }

    function reviveBulgaFromZones() {
      const pool = zonePool(['grave', 'exile'], id => isBulgaMonster(id));
      if (!pool.length) { safeNotify('소환할 불가사의 몬스터가 없습니다.'); return false; }
      openCardPicker(pool, '묘지/제외에서 불가사의 몬스터 소환', 1, (sel) => {
        if (!sel || !sel.length) return;
        const p = pool[sel[0]];
        summonFromGraveOrExile(p.id, p._zone);
        sync();
      });
      return true;
    }

    function returnZoneCardToHandAndDraw() {
      const pool = zonePool(['grave', 'exile'], () => true);
      if (!pool.length) { safeNotify('회수할 묘지/제외 카드가 없습니다.'); return false; }
      openCardPicker(pool, '패에 넣을 묘지/제외 카드 선택', 1, (sel) => {
        if (!sel || !sel.length) return;
        moveZoneCardToHand(pool[sel[0]]);
        if (typeof drawN === 'function') drawN(1);
        sync();
      });
      return true;
    }

    function exileOpponentFieldOne(title = '상대 필드 카드 제외') {
      const pool = [...(G.opField || []), ...(G.opFieldCard ? [G.opFieldCard] : [])];
      if (!pool.length) return false;
      openCardPicker(pool, title, 1, (sel) => {
        if (!sel || !sel.length) return;
        const p = pool[sel[0]];
        const fi = G.opField.findIndex(c => c.id === p.id);
        if (fi >= 0) {
          const rm = G.opField.splice(fi, 1)[0];
          G.opExile.push(rm);
          if (typeof sendAction === 'function') sendAction({ type: 'opFieldRemove', cardId: rm.id, to: 'exile' });
        } else if (G.opFieldCard && G.opFieldCard.id === p.id) {
          const rm = G.opFieldCard;
          G.opFieldCard = null;
          G.opExile.push(rm);
          if (typeof sendAction === 'function') sendAction({ type: 'opFieldCardRemove', cardId: rm.id, to: 'exile' });
        }
        sync();
      });
      return true;
    }

    function exileOpponentHandOne() {
      if (!G.opHand || !G.opHand.length) return false;
      const idx = Math.floor(Math.random() * G.opHand.length);
      const c = G.opHand.splice(idx, 1)[0];
      G.opExile.push(c && c.id ? c : { id: 'unknown', name: '?' });
      safeLog(`상대 패 1장 제외`, 'mine');
      sync();
      return true;
    }

    function exileOpponentGraveOne() {
      if (!G.opGrave || !G.opGrave.length) return false;
      openCardPicker(G.opGrave, '상대 묘지 카드 1장 제외', 1, (sel) => {
        if (!sel || !sel.length) return;
        const c = G.opGrave.splice(sel[0], 1)[0];
        G.opExile.push(c);
        if (typeof sendAction === 'function') sendAction({ type: 'opGraveExile', cardId: c.id });
        sync();
      });
      return true;
    }

    function exileOpponentUpToOneEach() {
      if (G.opHand && G.opHand.length) exileOpponentHandOne();
      if (G.opField.length || G.opFieldCard) exileOpponentFieldOne('상대 필드 카드 1장 제외');
      if (G.opGrave && G.opGrave.length) exileOpponentGraveOne();
      safeLog('불가사의한 원흉 ②: 상대 패/필드/묘지 각각 1장까지 제외', 'mine');
      sync();
    }

    function sendAllMonstersToGrave() {
      while (G.myField.length) {
        const c = G.myField.pop();
        G.myGrave.push(c);
        if (typeof onSentToGrave === 'function') onSentToGrave(c.id, 'field', c);
      }
      while (G.opField.length) {
        const c = G.opField.pop();
        G.opGrave.push(c);
        if (typeof sendAction === 'function') sendAction({ type: 'opFieldRemove', cardId: c.id, to: 'grave' });
      }
    }

    function summonTrapToOpponentField(cardId) {
      const fromHand = G.myHand.findIndex(c => c.id === cardId);
      if (fromHand >= 0) G.myHand.splice(fromHand, 1);
      else {
        const gi = G.myGrave.findIndex(c => c.id === cardId);
        if (gi >= 0) G.myGrave.splice(gi, 1);
      }
      const obj = { id: cardId, name: CARDS[cardId]?.name || cardId, atk: 77, atkBase: 77, treatedAsMonster: true };
      G.opField.push(obj);
      if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId, source: 'opponentFieldByEffect', localApplied: true });
      safeLog(`${CARDS[cardId]?.name || cardId}: 상대 몬스터 존에 ATK 77로 소환`, 'mine');
      sync();
    }

    function resolveHelicopter() {
      const targets = deckTargets(id => isBulga(id));
      if (!targets.length) { if (typeof drawN === 'function') drawN(1); sync(); return; }
      openCardPicker(targets, '불가사의한 귀신 헬리콥터: 불가사의 카드 1장 서치', 1, (sel) => {
        if (sel && sel.length) addToHandFromDeck(targets[sel[0]].id);
        if (typeof drawN === 'function') drawN(1);
        safeLog('불가사의한 귀신 헬리콥터: 서치 + 1드로우', 'mine');
        sync();
      });
    }

    function resolveGrandpa2(ctx) {
      const handIdx = Number.isInteger(ctx.handIdx) ? ctx.handIdx : G.myHand.findIndex(c => c.id === '불가사의한 망태 할아버지');
      if (handIdx < 0) { safeNotify('패의 불가사의한 망태 할아버지가 필요합니다.'); return; }
      discardOne('망태 할아버지 ②: 추가로 버릴 패 1장', (ok) => {
        if (!ok) return;
        const currentIdx = G.myHand.findIndex(c => c.id === '불가사의한 망태 할아버지');
        if (currentIdx >= 0) removeHandIndexToGrave(currentIdx, 'bulgasauiGrandpa2');
        placeCityFromDeck();
        if (typeof drawN === 'function') drawN(1);
        safeLog('불가사의한 망태 할아버지 ②: 도시 배치 + 1드로우', 'mine');
        sync();
      }, handIdx);
    }

    function resolveMask2() {
      const targets = deckTargets(id => isBulga(id) && CARDS[id]?.cardType !== 'monster');
      if (!targets.length) { safeNotify('서치할 비몬스터 불가사의 카드가 없습니다.'); return; }
      openCardPicker(targets, '불가사의한 빨간 마스크 ②: 비몬스터 불가사의 서치', 1, (sel) => {
        if (sel && sel.length) addToHandFromDeck(targets[sel[0]].id);
        sync();
      });
    }

    function resolveCity1() {
      discardOne('불가사의한 밤의 대도시 ①: 패 1장 버리기', (ok) => {
        if (!ok) return;
        const targets = deckTargets(id => isBulgaMonster(id));
        if (!targets.length) { safeNotify('덱에 불가사의 몬스터가 없습니다.'); sync(); return; }
        openCardPicker(targets, '덱에서 묘지로 보낼 불가사의 몬스터', 1, (sel) => {
          if (sel && sel.length) removeDeckToGrave(targets[sel[0]].id, 'bulgasauiCity1');
          sync();
        });
      });
    }

    function resolveCurrency(ctx) {
      const handIdx = Number.isInteger(ctx.handIdx) ? ctx.handIdx : G.myHand.findIndex(c => c.id === '불가사의한 화폐 속 암호');
      discardOne('불가사의한 화폐 속 암호 ①: 패 1장 버리기', (ok) => {
        if (!ok) return;
        const selfIdx = G.myHand.findIndex(c => c.id === '불가사의한 화폐 속 암호');
        if (selfIdx >= 0) removeHandIndexToGrave(selfIdx, 'bulgasauiCurrency');
        const targets = deckTargets(id => isBulgaMonster(id));
        if (!targets.length) { safeNotify('덱에 불가사의 몬스터가 없습니다.'); sync(); return; }
        openCardPicker(targets, '불가사의 몬스터 1장 서치', 1, (sel) => {
          if (sel && sel.length) addToHandFromDeck(targets[sel[0]].id);
          const zones = zonePool(['grave', 'exile'], id => isBulga(id));
          if (!zones.length) { sync(); return; }
          if (!confirm('묘지/제외의 불가사의 카드 1장을 추가로 회수하고 패를 1장 더 버리겠습니까?')) { sync(); return; }
          openCardPicker(zones, '추가로 회수할 불가사의 카드', 1, (sel2) => {
            if (sel2 && sel2.length) moveZoneCardToHand(zones[sel2[0]]);
            discardOne('추가 회수 처리: 패 1장 추가로 버리기', () => sync());
          });
        });
      }, handIdx);
    }

    function resolveFriday13() {
      const target = deckTargets(id => id === '불가사의한 망태 할아버지')[0];
      if (!target) { safeNotify('덱에 불가사의한 망태 할아버지가 없습니다.'); return; }
      addToHandFromDeck('불가사의한 망태 할아버지');
      safeLog('불가사의한 13일의 금요일: 망태 할아버지 서치', 'mine');
      sync();
    }

    function resolveReign1() {
      const max = Math.min(4, deckTargets(id => isBulgaMonster(id)).length);
      if (max <= 0) { safeNotify('덱에 불가사의 몬스터가 없습니다.'); return; }
      openCardPicker(deckTargets(id => isBulgaMonster(id)), `불가사의한 지배 ①: 묘지로 보낼 몬스터 최대 ${max}장`, max, (sel) => {
        (sel || []).forEach(i => {
          const targets = deckTargets(id => isBulgaMonster(id));
          const pick = targets[i];
          if (pick) removeDeckToGrave(pick.id, 'bulgasauiReign1');
        });
        sync();
      });
    }

    function resolveReign2() {
      const gi = G.myGrave.findIndex(c => c.id === '불가사의한 지배');
      if (gi < 0) { safeNotify('묘지에 불가사의한 지배가 없습니다.'); return; }
      const c = G.myGrave.splice(gi, 1)[0];
      G.myKeyDeck = G.myKeyDeck || [];
      G.myKeyDeck.push(cardObj(c.id));
      const seen = new Set();
      const pool = (G.myGrave || []).filter(x => isBulgaMonster(x.id) && !seen.has(x.id) && seen.add(x.id));
      pool.slice().forEach(x => { if (G.myField.length < fieldLimit()) summonFromGraveOrExile(x.id, 'grave'); });
      safeLog('불가사의한 지배 ②: 카드명이 다른 불가사의 몬스터 가능한 만큼 소환', 'mine');
      sync();
    }

    function resolveOnehyung3(ctx) {
      const idx = Number.isInteger(ctx.handIdx) ? ctx.handIdx : G.myHand.findIndex(c => c.id === '불가사의한 원흉');
      if (idx < 0) { safeNotify('패의 불가사의한 원흉이 필요합니다.'); return; }
      G.myHand[idx].isPublic = true;
      discardNCards(2, '불가사의한 원흉 ③: 패 2장 버리기', (ok) => {
        if (!ok) return;
        const selfIdx = G.myHand.findIndex(c => c.id === '불가사의한 원흉');
        if (selfIdx >= 0 && G.myField.length < fieldLimit()) {
          G.myHand.splice(selfIdx, 1);
          const def = CARDS['불가사의한 원흉'];
          G.myField.push({ id: '불가사의한 원흉', name: def.name, atk: def.atk || 0, atkBase: def.atk || 0, summonedFrom: 'hand' });
          if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId: '불가사의한 원흉', source: 'hand' });
          if (typeof onSummon === 'function') onSummon('불가사의한 원흉', 'hand');
        }
        sync();
      }, idx);
    }

    function resolveIlluminati() {
      const typeOrder = ['monster', 'normal', 'magic', 'trap', 'field'];
      const picked = [];
      function pickNext(ti) {
        if (ti >= typeOrder.length) { applyIlluminati(picked.length); return; }
        const type = typeOrder[ti];
        const targets = deckTargets(id => isBulga(id) && CARDS[id]?.cardType === type);
        if (!targets.length || !confirm(`불가사의한 일루미나티: ${type} 카드 1장을 묘지로 보내겠습니까?`)) {
          pickNext(ti + 1); return;
        }
        openCardPicker(targets, `일루미나티: ${type} 카드 선택`, 1, (sel) => {
          if (sel && sel.length) {
            const id = targets[sel[0]].id;
            if (removeDeckToGrave(id, 'bulgasauiIlluminati')) picked.push(id);
          }
          pickNext(ti + 1);
        });
      }
      pickNext(0);
    }

    function applyIlluminati(n) {
      safeLog(`불가사의한 일루미나티: ${n}장 묘지로`, 'mine');
      if (n >= 5) { placeFieldFromZones(); return; }
      if (n === 4) { returnZoneCardToDeck(); return; }
      if (n === 3) { buffBulgaMonsterByZoneTypes(); return; }
      if (n === 2) { reviveBulgaFromZones(); return; }
      if (n === 1) { returnZoneCardToHandAndDraw(); return; }
      sync();
    }

    function countBulgaMonsterKindsOnField() {
      return new Set((G.myField || []).filter(c => isBulgaMonster(c.id)).map(c => c.id)).size;
    }

    function refreshDollAtk() {
      (G.myField || []).forEach(m => {
        if (m && m.id === '불가사의한 숨바꼭질 인형') {
          const base = CARDS[m.id]?.atk || 0;
          m.atkBase = base;
          m.atk = base + ((G.myField || []).length * 2);
        }
      });
    }

    function register(id, def) { ENGINE.registerEffect(id, def); return id; }

    function registerHand(cardId, effectNum, opts = {}) {
      return register(opts.id || `bulgasaui_${cardId}_${effectNum}_hand`, {
        cardId, effectNum, zone: 'hand', kind: opts.kind || 'direct', chain: opts.chain === true, markOnActivate: opts.markOnActivate !== false,
        maxPerTurn: opts.maxPerTurn || 1, label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => c.handIdx >= 0 && G.myHand[c.handIdx]?.id === cardId && canUse(cardId, effectNum, opts.maxPerTurn || 1) && (!opts.condition || opts.condition(c)),
        resolve: opts.resolve,
        buildLink: opts.buildLink,
      });
    }

    function registerField(cardId, effectNum, opts = {}) {
      return register(opts.id || `bulgasaui_${cardId}_${effectNum}_field`, {
        cardId, effectNum, zone: 'field', kind: opts.kind || 'direct', chain: opts.chain === true, markOnActivate: opts.markOnActivate !== false,
        maxPerTurn: opts.maxPerTurn || 1, label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === cardId && canUse(cardId, effectNum, opts.maxPerTurn || 1) && (!opts.condition || opts.condition(c)),
        resolve: opts.resolve,
        buildLink: opts.buildLink,
      });
    }

    function registerFieldCard(cardId, effectNum, opts = {}) {
      return register(opts.id || `bulgasaui_${cardId}_${effectNum}_fieldcard`, {
        cardId, effectNum, zone: 'fieldCard', kind: opts.kind || 'direct', chain: opts.chain === true, markOnActivate: opts.markOnActivate !== false,
        maxPerTurn: opts.maxPerTurn || 1, label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => G.myFieldCard?.id === cardId && canUse(cardId, effectNum, opts.maxPerTurn || 1) && (!opts.condition || opts.condition(c)),
        resolve: opts.resolve,
        buildLink: opts.buildLink,
      });
    }

    function registerZone(cardId, effectNum, zone, opts = {}) {
      return register(opts.id || `bulgasaui_${cardId}_${effectNum}_${zone}`, {
        cardId, effectNum, zone, kind: opts.kind || 'direct', chain: opts.chain === true, markOnActivate: opts.markOnActivate !== false,
        maxPerTurn: opts.maxPerTurn || 1, label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => {
          const arr = zone === 'exile' ? G.myExile : G.myGrave;
          return arr.some(x => x.id === cardId) && canUse(cardId, effectNum, opts.maxPerTurn || 1) && (!opts.condition || opts.condition(c));
        },
        resolve: opts.resolve,
        buildLink: opts.buildLink,
      });
    }

    // 손패/일반 발동
    registerHand('불가사의한 귀신 헬리콥터', 1, { kind: 'quick', chain: true, label: '귀신 헬리콥터 ① 서치+드로우', resolve: resolveHelicopter });
    registerHand('불가사의한 망태 할아버지', 2, { label: '망태 할아버지 ② 버림+도시+드로우', condition: () => G.myHand.length >= 2, resolve: resolveGrandpa2 });
    registerHand('불가사의한 밤의 대도시', 0, { label: '불가사의한 밤의 대도시 발동', maxPerTurn: 999, condition: (c) => CARDS[c.cardId]?.cardType === 'field', resolve: (c) => { if (typeof placeMyFieldCard === 'function') placeMyFieldCard('불가사의한 밤의 대도시', { source: 'hand', handIdx: c.handIdx, activate: true, send: true }); } });
    registerHand('불가사의한 화폐 속 암호', 1, { kind: 'quick', label: '화폐 속 암호 ① 몬스터 서치+회수', resolve: resolveCurrency });
    registerHand('불가사의한 분신사바', 1, { kind: 'quick', label: '분신사바 ① 상대 엔드 전체 묘지+상대필드 소환', condition: () => !myTurn() && phase() === 'end' && hasCity(), resolve: () => { sendAllMonstersToGrave(); summonTrapToOpponentField('불가사의한 분신사바'); } });
    registerHand('불가사의한 13일의 금요일', 1, { label: '13일의 금요일 ① 망태 할아버지 서치', maxPerTurn: 999, condition: () => !window.__bulgasauiFriday13Used, resolve: () => { window.__bulgasauiFriday13Used = true; resolveFriday13(); } });
    registerHand('불가사의한 적월', 1, { kind: 'quick', label: '적월 ① 서로 필드 같은 수 제외', condition: () => phase() === 'deploy' && G.myField.some(c => isBulgaMonster(c.id)), resolve: () => resolveBulgasauiEffect({ cardId: '불가사의한 적월', effectNum: 1, mainText: effectText('불가사의한 적월', 1) }) });
    registerHand('불가사의한 지배', 1, { kind: 'quick', label: '지배 ① 상대 드로우 단계 덱→묘지', condition: () => !myTurn() && phase() === 'draw' && hasCity(), resolve: resolveReign1 });
    registerHand('불가사의한 원흉', 3, { label: '원흉 ③ 공개+패2장 버림+소환', condition: () => G.myHand.length >= 3 && G.myField.length < fieldLimit(), resolve: resolveOnehyung3 });
    registerHand('불가사의한 일루미나티', 1, { kind: 'quick', label: '일루미나티 ① 종류별 덱→묘지', resolve: resolveIlluminati });

    // 필드/필드존 발동
    registerField('불가사의한 빨간 마스크', 2, { label: '빨간 마스크 ② 비몬스터 서치', condition: () => myTurn() && phase() === 'deploy', resolve: resolveMask2 });
    registerFieldCard('불가사의한 밤의 대도시', 1, { label: '밤의 대도시 ① 패 버림→덱 몬스터 묘지', maxPerTurn: 4, resolve: resolveCity1 });
    registerFieldCard('불가사의한 밤의 대도시', 2, { label: '밤의 대도시 ② 공격 선언 상대 ATK 0', condition: () => phase() === 'attack' && G.opField.length > 0 && G.myField.some(c => isBulgaMonster(c.id)), resolve: () => {
      openCardPicker(G.opField, '공격력 0으로 만들 상대 몬스터', 1, (sel) => {
        if (sel && sel.length && G.opField[sel[0]]) {
          const t = G.opField[sel[0]];
          t.atk = 0;
          if (typeof sendAction === 'function') sendAction({ type: 'opAtkChange', fieldIdx: sel[0], delta: -999 });
          safeLog(`밤의 대도시 ②: ${t.name} ATK 0`, 'mine');
          sync();
        }
      });
    }});

    // 묘지/제외 자체 소환
    REVIVE_MONSTERS.forEach(cardId => {
      registerZone(cardId, 1, 'grave', { label: `${cardId} ① 묘지에서 소환`, condition: () => hasCity() && G.myField.length < fieldLimit(), resolve: () => { reviveThis(cardId, 'grave'); sync(); } });
      registerZone(cardId, 1, 'exile', { label: `${cardId} ① 제외에서 소환`, condition: () => hasCity() && G.myField.length < fieldLimit(), resolve: () => { reviveThis(cardId, 'exile'); sync(); } });
    });

    // 묘지 발동
    registerZone('불가사의한 지배', 2, 'grave', { label: '지배 ② 묘지→키덱, 불가사의 몬스터 전개', condition: () => !myTurn() && phase() === 'deploy' && hasCity(), resolve: resolveReign2 });

    // 자동 유발
    register('bulgasaui_jangsanbeom_2_summon_from_zones', {
      cardId: '불가사의한 장산범', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'summon', label: '장산범 ② 묘지/제외 소환 유발 드로우', chain: false, markOnActivate: false,
      condition: (c) => (c.event?.from === 'grave' || c.event?.from === 'exile') && G.myField.some(m => m.id === '불가사의한 장산범') && canUse('불가사의한 장산범', 2),
      resolve: () => { const n = countBulgaMonsterKindsOnField(); if (n > 0 && typeof drawN === 'function') drawN(n); markUse('불가사의한 장산범', 2); safeLog(`장산범 ②: ${n}장 드로우`, 'mine'); sync(); },
    });
    register('bulgasaui_doll_refresh_atk_summon', {
      cardId: '불가사의한 숨바꼭질 인형', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'summon', label: '숨바꼭질 인형 ② 공격력 갱신', chain: false, markOnActivate: false,
      condition: () => G.myField.some(m => m.id === '불가사의한 숨바꼭질 인형'),
      resolve: () => { refreshDollAtk(); sync(); },
    });
    register('bulgasaui_onehyung_2_leave', {
      cardId: '불가사의한 원흉', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '원흉 ② 상대 턴 묘지 유발 제외', chain: false, markOnActivate: false,
      condition: (c) => !myTurn() && c.event?.cardId === '불가사의한 원흉' && canUse('불가사의한 원흉', 2),
      resolve: () => { markUse('불가사의한 원흉', 2); exileOpponentUpToOneEach(); },
    });
    register('bulgasaui_onehyung_2_exile', {
      cardId: '불가사의한 원흉', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'exile', label: '원흉 ② 상대 턴 제외 유발 제외', chain: false, markOnActivate: false,
      condition: (c) => !myTurn() && c.event?.cardId === '불가사의한 원흉' && canUse('불가사의한 원흉', 2),
      resolve: () => { markUse('불가사의한 원흉', 2); exileOpponentUpToOneEach(); },
    });

    // 처리 시 무효 — 체인에 미리 얹는 효과가 아니라, 각 링크 resolve 직전에 판정한다.
    function registerBulgasauiProcessingNegates() {
      if (!window.ProcessingNegateEngine || typeof window.ProcessingNegateEngine.registerMany !== 'function') {
        setTimeout(registerBulgasauiProcessingNegates, 50);
        return;
      }
      window.ProcessingNegateEngine.registerMany([
        {
          id: 'bulgasaui_grandpa_3_processing_negate',
          cardId: '불가사의한 망태 할아버지', effectNum: 3,
          label: '망태 할아버지 ③ 자신 필드 묘지 보내기 효과 무효',
          tags: ['sendMyFieldToGrave'],
        },
        {
          id: 'bulgasaui_redmask_3_processing_negate',
          cardId: '불가사의한 빨간 마스크', effectNum: 3,
          label: '빨간 마스크 ③ 자신 필드 대상 효과 무효',
          tags: ['targetMyField'],
        },
        {
          id: 'bulgasaui_jangsanbeom_3_processing_negate',
          cardId: '불가사의한 장산범', effectNum: 3,
          label: '장산범 ③ 덱 서치/소환 효과 무효',
          tags: ['deckSearch', 'deckSummon'],
        },
        {
          id: 'bulgasaui_doll_3_processing_negate',
          cardId: '불가사의한 숨바꼭질 인형', effectNum: 3,
          label: '숨바꼭질 인형 ③ 패 버림 효과 무효',
          tags: ['discardHand'],
        },
        {
          id: 'bulgasaui_onehyung_4_processing_negate',
          cardId: '불가사의한 원흉', effectNum: 4,
          label: '원흉 ④ 상대 효과 처리 시 무효',
          tags: ['*'],
        },
      ]);
    }
    registerBulgasauiProcessingNegates();

    // 카드별 effectIds 연결
    const map = {
      '불가사의한 귀신 헬리콥터': ['bulgasaui_불가사의한 귀신 헬리콥터_1_hand'],
      '불가사의한 망태 할아버지': ['bulgasaui_불가사의한 망태 할아버지_2_hand', 'bulgasaui_불가사의한 망태 할아버지_1_grave', 'bulgasaui_불가사의한 망태 할아버지_1_exile', 'bulgasaui_grandpa_3_processing_negate'],
      '불가사의한 빨간 마스크': ['bulgasaui_불가사의한 빨간 마스크_1_grave', 'bulgasaui_불가사의한 빨간 마스크_1_exile', 'bulgasaui_불가사의한 빨간 마스크_2_field', 'bulgasaui_redmask_3_processing_negate'],
      '불가사의한 장산범': ['bulgasaui_불가사의한 장산범_1_grave', 'bulgasaui_불가사의한 장산범_1_exile', 'bulgasaui_jangsanbeom_2_summon_from_zones', 'bulgasaui_jangsanbeom_3_processing_negate'],
      '불가사의한 밤의 대도시': ['bulgasaui_불가사의한 밤의 대도시_0_hand', 'bulgasaui_불가사의한 밤의 대도시_1_fieldcard', 'bulgasaui_불가사의한 밤의 대도시_2_fieldcard'],
      '불가사의한 화폐 속 암호': ['bulgasaui_불가사의한 화폐 속 암호_1_hand'],
      '불가사의한 분신사바': ['bulgasaui_불가사의한 분신사바_1_hand'],
      '불가사의한 숨바꼭질 인형': ['bulgasaui_불가사의한 숨바꼭질 인형_1_grave', 'bulgasaui_불가사의한 숨바꼭질 인형_1_exile', 'bulgasaui_doll_refresh_atk_summon', 'bulgasaui_doll_3_processing_negate'],
      '불가사의한 13일의 금요일': ['bulgasaui_불가사의한 13일의 금요일_1_hand'],
      '불가사의한 적월': ['bulgasaui_불가사의한 적월_1_hand'],
      '불가사의한 지배': ['bulgasaui_불가사의한 지배_1_hand', 'bulgasaui_불가사의한 지배_2_grave'],
      '불가사의한 원흉': ['bulgasaui_불가사의한 원흉_1_grave', 'bulgasaui_불가사의한 원흉_1_exile', 'bulgasaui_불가사의한 원흉_3_hand', 'bulgasaui_onehyung_4_processing_negate', 'bulgasaui_onehyung_2_leave', 'bulgasaui_onehyung_2_exile'],
      '불가사의한 일루미나티': ['bulgasaui_불가사의한 일루미나티_1_hand'],
    };
    Object.entries(map).forEach(([cardId, ids]) => ENGINE.registerCardEffects(cardId, ids));

    // 필드 존/묘지/제외 존에서도 등록형 버튼 노출
    function prependRegistryButtons(cardId, zone, base) {
      const actions = document.getElementById('mdCardActions');
      if (!actions || !ENGINE.getActivatableEffects) return;
      const effects = ENGINE.getActivatableEffects(cardId, zone, Object.assign({ cardId }, base || {}));
      if (!effects.length) return;
      const header = document.createElement('div');
      header.className = 'effect-registry-header bulgasaui';
      header.textContent = '불가사의 등록형 효과';
      header.style.marginTop = '8px';
      header.style.opacity = '0.75';
      actions.prepend(header);
      effects.slice().reverse().forEach(def => {
        const b = document.createElement('button');
        b.className = 'btn btn-primary';
        b.textContent = def.label;
        b.onclick = () => {
          if (typeof closeModal === 'function') closeModal('cardDetailModal');
          ENGINE.activateEffect(def.id, Object.assign({ cardId }, base || {}));
        };
        actions.prepend(b);
      });
    }

    function patchCardDetailForFieldZone() {
      if (typeof window.openCardDetail !== 'function') { setTimeout(patchCardDetailForFieldZone, 50); return; }
      if (window.openCardDetail.__bulgasauiRegistryPatched) return;
      const old = window.openCardDetail;
      window.openCardDetail = function patchedBulgasauiCardDetail(cardId, handIdx = -1, opponentCard = false, fieldIdx = -1) {
        old.apply(this, arguments);
        if (opponentCard || !isBulga(cardId)) return;
        if (handIdx === -2) prependRegistryButtons(cardId, 'grave', { zoneIndex: (G.myGrave || []).findIndex(c => c.id === cardId) });
        if (G.myFieldCard && G.myFieldCard.id === cardId && handIdx < 0 && fieldIdx < 0) prependRegistryButtons(cardId, 'fieldCard', {});
      };
      window.openCardDetail.__bulgasauiRegistryPatched = true;
    }

    function patchShowZoneButtons() {
      if (typeof window.showZone !== 'function') { setTimeout(patchShowZoneButtons, 50); return; }
      if (window.showZone.__bulgasauiRegistryPatched) return;
      const old = window.showZone;
      window.showZone = function patchedBulgasauiShowZone(zoneKey) {
        old.apply(this, arguments);
        const zoneName = zoneKey === 'myGrave' ? 'grave' : zoneKey === 'myExile' ? 'exile' : null;
        if (!zoneName) return;
        const cards = zoneKey === 'myGrave' ? (G.myGrave || []) : (G.myExile || []);
        const grid = document.getElementById('zoneViewGrid');
        if (!grid) return;
        Array.from(grid.children).forEach((wrapper, i) => {
          const c = cards[i];
          if (!c || !isBulga(c.id)) return;
          const effects = ENGINE.getActivatableEffects(c.id, zoneName, { cardId: c.id, zoneIndex: i });
          effects.forEach(def => {
            const btn = document.createElement('button');
            btn.className = 'btn-sm';
            btn.textContent = def.label;
            btn.onclick = () => { if (typeof closeModal === 'function') closeModal('zoneViewModal'); ENGINE.activateEffect(def.id, { cardId: c.id, zoneIndex: i }); };
            wrapper.appendChild(btn);
          });
        });
      };
      window.showZone.__bulgasauiRegistryPatched = true;
    }

    patchCardDetailForFieldZone();
    patchShowZoneButtons();

    window.BulgasauiRegistry = {
      hasCity, reviveThis, resolveIlluminati, resolveCity1, refreshDollAtk,
    };
  }

  boot();
})();
