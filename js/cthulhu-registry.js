// cthulhu-registry.js — 크툴루/올드원 테마 등록형 효과 패치
// 이전 cthulhu.js의 실제 처리 함수를 최대한 재사용하면서,
// 발동 버튼/필드존 버튼/처리 시 무효/키덱 직접 소환을 EffectEngine으로 묶는다.
(function() {
  'use strict';

  function boot() {
    if (!window.EffectEngine || !window.CARDS || !window.G) { setTimeout(boot, 50); return; }
    if (window.__CTHULHU_REGISTRY_READY__) return;
    window.__CTHULHU_REGISTRY_READY__ = true;

    const ENGINE = window.EffectEngine;
    const PN = window.ProcessingNegateEngine;

    const BULLET = ['', '①', '②', '③', '④', '⑤'];
    const OLD_THEME = '올드원';

    const cardName = id => (CARDS[id] && CARDS[id].name) || id;
    const cardObj = id => ({ id, name: cardName(id) });
    const isMonster = id => CARDS[id] && CARDS[id].cardType === 'monster';
    const isGOO = id => typeof id === 'string' && id.startsWith('그레이트 올드 원-');
    const isElder = id => typeof id === 'string' && id.startsWith('엘더 갓-');
    const isOuter = id => typeof id === 'string' && id.startsWith('아우터 갓');
    const isOldOne = id => !!(id && CARDS[id] && (CARDS[id].theme === OLD_THEME || isGOO(id) || isElder(id) || isOuter(id) || id === '태평양 속 르뤼에' || id === '올드_원의 멸망'));
    const phase = () => window.currentPhase;
    const myTurn = () => !!window.isMyTurn;
    const inChain = () => !!(window.activeChainState && activeChainState.active);
    const fieldLimit = () => (typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5);
    const canUse = (id, num, max = 1) => (typeof canUseEffect !== 'function') || canUseEffect(id, num, max);
    const mark = (id, num) => { if (typeof markEffectUsed === 'function') markEffectUsed(id, num); };
    const logSafe = (msg, side = 'mine') => (typeof log === 'function' ? log(msg, side) : console.log(msg));
    const notifySafe = msg => (typeof notify === 'function' ? notify(msg) : console.warn(msg));
    const sync = () => { if (typeof sendGameState === 'function') sendGameState(); if (typeof renderAll === 'function') renderAll(); };

    function deckCards(pred) { return typeof findAllInDeck === 'function' ? findAllInDeck(c => c && pred(c.id)) : (G.myDeck || []).filter(c => pred(c.id)); }
    function hasDeck(pred) { return deckCards(pred).length > 0; }
    function hasGrave(pred) { return (G.myGrave || []).some(c => c && pred(c.id)); }
    function hasExile(pred) { return (G.myExile || []).some(c => c && pred(c.id)); }
    function hasField(pred) { return (G.myField || []).some(c => c && pred(c.id)); }
    function hasHand(pred) { return (G.myHand || []).some(c => c && pred(c.id)); }

    function removeDeckCard(id) {
      if (typeof removeFromDeck === 'function') return removeFromDeck(id);
      const idx = (G.myDeck || []).findIndex(c => c.id === id);
      if (idx >= 0) return G.myDeck.splice(idx, 1)[0];
      return null;
    }

    function sendCardToGraveFromMyField(index, reason) {
      if (index < 0 || index >= G.myField.length) return null;
      const m = G.myField.splice(index, 1)[0];
      if (m) {
        G.myGrave.push(m);
        if (typeof onSentToGrave === 'function') onSentToGrave(m.id, 'field', m);
        logSafe(`${reason || '크툴루'}: ${m.name || cardName(m.id)} 묘지로`, 'mine');
      }
      return m;
    }

    function summonToMyFieldFromZone(cardId, zone, opts = {}) {
      if (G.myField.length >= fieldLimit()) { notifySafe('몬스터 존이 가득 찼습니다.'); return false; }
      const def = CARDS[cardId];
      if (!def || def.cardType !== 'monster') { notifySafe('몬스터만 소환할 수 있습니다.'); return false; }
      let moved = null;
      if (zone === 'hand') {
        const i = G.myHand.findIndex(c => c.id === cardId);
        if (i < 0) return false;
        moved = G.myHand.splice(i, 1)[0];
      } else if (zone === 'grave') {
        const i = G.myGrave.findIndex(c => c.id === cardId);
        if (i < 0) return false;
        moved = G.myGrave.splice(i, 1)[0];
      } else if (zone === 'exile') {
        const i = G.myExile.findIndex(c => c.id === cardId);
        if (i < 0) return false;
        moved = G.myExile.splice(i, 1)[0];
      } else if (zone === 'deck') {
        moved = removeDeckCard(cardId) || { id: cardId, name: def.name };
      } else if (zone === 'keyDeck') {
        const i = G.myKeyDeck.findIndex(c => c.id === cardId);
        if (i >= 0) G.myKeyDeck.splice(i, 1);
        moved = { id: cardId, name: def.name };
      }
      if (!moved) return false;
      G.myField.push({ id: cardId, name: def.name, atk: def.atk || 0, atkBase: def.atk || 0, summonedFrom: zone, ...(opts.extra || {}) });
      logSafe(`${def.name} 소환 (${zone})`, 'mine');
      if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId, from: zone });
      if (typeof onSummon === 'function') onSummon(cardId, zone);
      return true;
    }

    function chooseOne(list, title, cb, allowCancel = true) {
      if (!list || !list.length) { cb(null); return; }
      if (list.length === 1 && !allowCancel) { cb(list[0]); return; }
      if (typeof openCardPicker === 'function') {
        openCardPicker(list, title, 1, sel => cb(sel && sel.length ? list[sel[0]] : null), true);
      } else {
        cb(list[0]);
      }
    }

    function chooseMany(list, title, max, cb) {
      if (!list || !list.length) { cb([]); return; }
      if (typeof openCardPicker === 'function') openCardPicker(list, title, Math.min(max, list.length), sel => cb((sel || []).map(i => list[i])), true);
      else cb(list.slice(0, max));
    }

    function startThemeLink(cardId, effectNum, opts = {}) {
      const label = opts.label || `${cardName(cardId)} ${BULLET[effectNum] || effectNum}`;
      if (opts.maxPerTurn !== 0 && !canUse(cardId, effectNum, opts.maxPerTurn || 1)) { notifySafe('이미 사용했습니다.'); return false; }
      if (opts.maxPerTurn !== 0) mark(cardId, effectNum);
      const link = {
        type: 'themeEffect',
        label,
        cardId,
        effectNum,
        theme: OLD_THEME,
        mainText: '',
        effectTags: opts.effectTags || [],
      };
      if (opts.kind === 'quick') {
        if (inChain()) addChainLink(link);
        else if (typeof window.beginChain === 'function') window.beginChain(link);
      } else {
        if (typeof activateIgnitionEffect === 'function') activateIgnitionEffect(link);
        else if (typeof window.beginChain === 'function') window.beginChain(link);
      }
      sync();
      return true;
    }

    function registerOldHandlerWrapper(id, def, fnName, callMode) {
      ENGINE.registerEffect(id, Object.assign({
        activate: c => {
          const fn = window[fnName];
          if (typeof fn !== 'function') { notifySafe(`${def.label || id}: ${fnName} 함수를 찾을 수 없습니다.`); return false; }
          if (callMode === 'field') return fn(c.fieldIdx, def.effectNum);
          if (callMode === 'outer') return fn(def.cardId);
          return fn(c.handIdx, def.effectNum);
        },
      }, def));
    }

    function handCondition(cardId, effectNum, extra) {
      return c => {
        if (!c || c.handIdx == null || c.handIdx < 0 || !G.myHand[c.handIdx] || G.myHand[c.handIdx].id !== cardId) return false;
        if (!canUse(cardId, effectNum, extra && extra.maxPerTurn || 1)) return false;
        if (typeof window._cthulhuCanActivate === 'function' && !window._cthulhuCanActivate(cardId, effectNum)) return false;
        return !extra || !extra.condition || extra.condition(c);
      };
    }

    function registerHand(cardId, effectNum, opts = {}) {
      const id = opts.id || `cthulhu_${cardId}_${effectNum}_hand`;
      registerOldHandlerWrapper(id, {
        cardId, effectNum, zone: 'hand', kind: opts.kind || 'ignition', label: opts.label || `${cardName(cardId)} ${BULLET[effectNum]} 손패 효과`,
        maxPerTurn: opts.maxPerTurn || 1,
        condition: handCondition(cardId, effectNum, opts),
      }, '_cthulhuActivate', 'hand');
      return id;
    }

    // ─────────────────────────────
    // 손패 발동 효과: 기존 cthulhu.js의 코스트/체인 처리를 래핑
    // ─────────────────────────────
    registerHand('그레이트 올드 원-크툴루', 1, { label: '크툴루 ① 소환 + 르뤼에 배치', condition: () => myTurn() && phase() === 'deploy' && hasDeck(id => id === '태평양 속 르뤼에') });
    registerHand('그레이트 올드 원-크툴루', 2, { label: '크툴루 ② 필드 카드 묘지 + 패널티', condition: () => myTurn() && phase() === 'deploy' && (G.myField.length || G.opField.length) && G.myField.length });

    registerHand('그레이트 올드 원-크투가', 1, { label: '크투가 ① 소환 + 필드 존 묘지', condition: () => myTurn() && phase() === 'deploy' && (G.myFieldCard || G.opFieldCard) });
    registerHand('그레이트 올드 원-크투가', 2, { label: '크투가 ② 패 몬스터 소환 + 패널티', condition: () => myTurn() && phase() === 'deploy' && G.myField.length && hasHand(id => isMonster(id) && id !== '그레이트 올드 원-크투가') });

    registerHand('그레이트 올드 원-크아이가', 1, { kind: 'quick', label: '크아이가 ① 소환 + 패 버림', condition: () => G.myHand.length >= 2 });
    registerHand('그레이트 올드 원-크아이가', 2, { kind: 'quick', label: '크아이가 ② 상대 필드 묘지 + 패 버림', condition: () => G.myHand.length >= 2 && G.opField.length > 0 });

    registerHand('그레이트 올드 원-과타노차', 1, { label: '과타노차 ① GOO 묘지 + 소환 + 드로우', condition: () => myTurn() && phase() === 'deploy' && hasField(isGOO) });

    registerHand('엘더 갓-크타니트', 1, { label: '크타니트 ① 패에서 소환 + 서로 드로우', condition: () => myTurn() && phase() === 'deploy' });
    registerHand('엘더 갓-크타니트', 3, { kind: 'quick', label: '크타니트 ③ 상대 덱 위 제외 + 패 몬스터 소환', condition: () => phase() === 'deploy' });

    registerHand('엘더 갓-노덴스', 2, { kind: 'quick', maxPerTurn: 2, label: '노덴스 ② 묘지 GOO 제외 + 덱 GOO 묘지', condition: () => (phase() === 'draw' || phase() === 'deploy') && hasGrave(isGOO) && hasDeck(isGOO) });

    registerHand('올드_원의 멸망', 1, { label: '올드_원의 멸망 ① 엘더 갓 제외 + GOO 소환', condition: () => myTurn() && phase() === 'deploy' && hasDeck(isElder) && (hasDeck(isGOO) || hasGrave(isGOO)) });

    // ─────────────────────────────
    // 필드/묘지/필드존 등록형 효과
    // ─────────────────────────────
    ENGINE.registerEffect('cthulhu_ghatanothoa_2_field', {
      cardId: '그레이트 올드 원-과타노차', effectNum: 2, zone: 'field', kind: 'ignition', label: '과타노차 ② 자신/상대 카드 묘지 + GOO 소환',
      condition: c => myTurn() && phase() === 'deploy' && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '그레이트 올드 원-과타노차' && canUse('그레이트 올드 원-과타노차', 2) && hasHand(isGOO) && (G.opHand.length || G.opField.length),
      activate: c => window._cthulhuActivateFromField ? window._cthulhuActivateFromField(c.fieldIdx, 2) : notifySafe('과타노차 ② 처리 함수 없음'),
    });

    ENGINE.registerEffect('cthulhu_cyaegha_4_grave', {
      cardId: '그레이트 올드 원-크아이가', effectNum: 4, zone: 'grave', kind: 'ignition', label: '크아이가 ④ 묘지 제외 → 엘더 갓 덱 제외', effectTags: ['deckBanish'],
      condition: () => hasGrave(id => id === '그레이트 올드 원-크아이가') && hasDeck(isElder) && canUse('그레이트 올드 원-크아이가', 4),
      cost: (c, done) => {
        const gi = G.myGrave.findIndex(x => x.id === '그레이트 올드 원-크아이가');
        if (gi < 0) return done(false);
        const moved = G.myGrave.splice(gi, 1)[0];
        G.myExile.push(moved);
        logSafe('크아이가 ④: 묘지의 이 카드를 제외 [코스트]', 'mine');
        done(true);
      },
      resolve: (c, link) => window._cthulhuResolve ? window._cthulhuResolve({ cardId: '그레이트 올드 원-크아이가', effectNum: 4, mainText: '', effectTags: ['deckBanish'] }) : null,
    });

    ENGINE.registerEffect('cthulhu_ru_rlyeh_1_fieldcard', {
      cardId: '태평양 속 르뤼에', effectNum: 1, zone: 'fieldCard', kind: 'ignition', label: '르뤼에 ① 묘지 GOO 소환', effectTags: ['graveSummon'],
      condition: () => G.myFieldCard?.id === '태평양 속 르뤼에' && myTurn() && phase() === 'deploy' && canUse('태평양 속 르뤼에', 1) && hasGrave(isGOO),
      resolve: () => {
        const targets = G.myGrave.filter(g => isGOO(g.id));
        chooseOne(targets, '르뤼에 ①: 묘지의 GOO 소환', target => {
          if (target) summonToMyFieldFromZone(target.id, 'grave');
          sync();
        });
      },
    });

    ENGINE.registerEffect('cthulhu_ru_rlyeh_2_fieldcard', {
      cardId: '태평양 속 르뤼에', effectNum: 2, zone: 'fieldCard', kind: 'quick', label: '르뤼에 ② GOO 회수 + 엘더 갓 제외', effectTags: ['deckBanish', 'graveToHand'],
      condition: () => G.myFieldCard?.id === '태평양 속 르뤼에' && canUse('태평양 속 르뤼에', 2) && hasGrave(isGOO) && hasDeck(isElder),
      cost: (c, done) => {
        const targets = G.myGrave.filter(g => isGOO(g.id));
        chooseOne(targets, '르뤼에 ②: [코스트] 묘지 GOO를 패에 넣기', target => {
          if (!target) return done(false);
          const gi = G.myGrave.findIndex(g => g === target || g.id === target.id);
          if (gi >= 0) {
            const moved = G.myGrave.splice(gi, 1)[0];
            G.myHand.push({ id: moved.id, name: moved.name || cardName(moved.id), isPublic: false });
            logSafe(`르뤼에 ②: ${cardName(moved.id)} 묘지→패 [코스트]`, 'mine');
          }
          done(true);
        });
      },
      resolve: () => {
        const elder = deckCards(isElder);
        chooseOne(elder, '르뤼에 ②: 덱의 엘더 갓 제외', target => {
          if (target) {
            removeDeckCard(target.id);
            G.myExile.push(cardObj(target.id));
            if (window.GameEvents) GameEvents.emit('exile', { cardId: target.id, card: cardObj(target.id), from: 'deck', player: 'mine' });
            logSafe(`르뤼에 ②: ${cardName(target.id)} 덱에서 제외`, 'mine');
          }
          sync();
        });
      },
    });

    ENGINE.registerEffect('cthulhu_nodens_2_field', {
      cardId: '엘더 갓-노덴스', effectNum: 2, zone: 'field', kind: 'quick', maxPerTurn: 2, label: '노덴스 ② 묘지 GOO 제외 + 덱 GOO 묘지', effectTags: ['sendDeckToGrave'],
      condition: c => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '엘더 갓-노덴스' && (phase() === 'draw' || phase() === 'deploy') && canUse('엘더 갓-노덴스', 2, 2) && hasGrave(isGOO) && hasDeck(isGOO),
      cost: (c, done) => {
        const targets = G.myGrave.filter(g => isGOO(g.id));
        chooseOne(targets, '노덴스 ②: [코스트] 묘지 GOO 제외', target => {
          if (!target) return done(false);
          const gi = G.myGrave.findIndex(g => g === target || g.id === target.id);
          if (gi >= 0) G.myExile.push(G.myGrave.splice(gi, 1)[0]);
          done(true);
        });
      },
      resolve: (c, link) => window._cthulhuResolve ? window._cthulhuResolve({ cardId: '엘더 갓-노덴스', effectNum: 2, mainText: '', effectTags: ['sendDeckToGrave'] }) : null,
    });

    ENGINE.registerEffect('cthulhu_hypnos_3_field', {
      cardId: '엘더 갓-히프노스', effectNum: 3, zone: 'field', kind: 'ignition', label: '히프노스 ③ 묘지 몬스터 소환', effectTags: ['graveSummon'],
      condition: c => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '엘더 갓-히프노스' && myTurn() && phase() === 'attack' && canUse('엘더 갓-히프노스', 3) && hasGrave(isMonster),
      resolve: (c, link) => window._cthulhuResolve ? window._cthulhuResolve({ cardId: '엘더 갓-히프노스', effectNum: 3, mainText: '', effectTags: ['graveSummon'] }) : null,
    });

    ENGINE.registerEffect('cthulhu_cthanit_3_field', {
      cardId: '엘더 갓-크타니트', effectNum: 3, zone: 'field', kind: 'quick', label: '크타니트 ③ 상대 덱 위 제외 + 패 몬스터 소환', effectTags: ['deckBanish', 'handSummon'],
      condition: c => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '엘더 갓-크타니트' && phase() === 'deploy' && canUse('엘더 갓-크타니트', 3),
      resolve: (c, link) => window._cthulhuResolve ? window._cthulhuResolve({ cardId: '엘더 갓-크타니트', effectNum: 3, mainText: '', effectTags: ['deckBanish', 'handSummon'] }) : null,
    });

    ENGINE.registerEffect('cthulhu_nyar_2_field', {
      cardId: '아우터 갓 니알라토텝', effectNum: 2, zone: 'field', kind: 'quick', label: '니알라토텝 ② 상대 몬스터 무효 + 복사', effectTags: ['targetOpponentMonster', 'negateFieldMonster'],
      condition: c => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '아우터 갓 니알라토텝' && canUse('아우터 갓 니알라토텝', 2) && G.opField.length > 0,
      resolve: (c, link) => window._cthulhuResolve ? window._cthulhuResolve({ cardId: '아우터 갓 니알라토텝', effectNum: 2, mainText: '', effectTags: ['targetOpponentMonster'] }) : null,
    });

    // 니알라토텝 ③: 상대 효과를 “니알라토텝을 묘지로 보낸다”로 변환한다.
    // 체인 해제 중 다음 상대 링크를 consume하는 방식으로 구현한다.
    window.__cthulhuNyarReplacement = null;
    const oldConsumeReplacement = window.consumeMafiaChainReplacement;
    window.consumeMafiaChainReplacement = function consumeCthulhuReplacement(link) {
      if (window.__cthulhuNyarReplacement && link && link.by !== myRole) {
        const rep = window.__cthulhuNyarReplacement;
        window.__cthulhuNyarReplacement = null;
        const fi = G.myField.findIndex(m => m.id === '아우터 갓 니알라토텝');
        if (fi >= 0) sendCardToGraveFromMyField(fi, '니알라토텝 ③ 변환 효과');
        logSafe(`${rep.label}: 상대 효과를 “니알라토텝을 묘지로 보낸다”로 적용`, 'mine');
        sync();
        return true;
      }
      return typeof oldConsumeReplacement === 'function' ? oldConsumeReplacement(link) : false;
    };

    ENGINE.registerEffect('cthulhu_nyar_3_field', {
      cardId: '아우터 갓 니알라토텝', effectNum: 3, zone: 'field', kind: 'quick', label: '니알라토텝 ③ 상대 효과 변환', effectTags: ['chainTransform'],
      condition: c => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '아우터 갓 니알라토텝' && myTurn() && inChain() && canUse('아우터 갓 니알라토텝', 3) && (activeChainState.links || []).some(l => l.by !== myRole),
      resolve: (c, link) => { window.__cthulhuNyarReplacement = { label: '니알라토텝 ③' }; logSafe('니알라토텝 ③: 다음 상대 효과 변환 예약', 'mine'); },
    });

    ENGINE.registerEffect('cthulhu_azathoth_3_field', {
      cardId: '아우터 갓-아자토스', effectNum: 3, zone: 'field', kind: 'quick', label: '아자토스 ③ 필드 효과 무효 + 제외', effectTags: ['negateFieldCard', 'banishField'],
      condition: c => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '아우터 갓-아자토스' && canUse('아우터 갓-아자토스', 3) && ((G.myField.length + G.opField.length) > 0),
      resolve: () => {
        const all = [
          ...G.myField.map((m, i) => ({ ...m, _src: 'mine', _i: i })),
          ...G.opField.map((m, i) => ({ ...m, _src: 'op', _i: i })),
        ];
        chooseMany(all, '아자토스 ③: 효과를 무효로 할 필드 카드 최대 3장', 3, picked => {
          picked.forEach(p => {
            if (p._src === 'mine' && G.myField[p._i]) G.myField[p._i].effectNegatedUntilEndTurn = true;
            if (p._src === 'op' && G.opField[p._i]) { G.opField[p._i].effectNegatedUntilEndTurn = true; if (typeof sendAction === 'function') sendAction({ type: 'negateField', cardId: p.id }); }
          });
          const maxCnt = Math.min(2, G.myField.length, G.opField.length);
          if (!maxCnt) { sync(); return; }
          chooseMany([...G.myField], `아자토스 ③: 제외할 내 필드 카드 최대 ${maxCnt}장`, maxCnt, myPicked => {
            const cnt = myPicked.length;
            if (!cnt) { sync(); return; }
            chooseMany([...G.opField], `아자토스 ③: 제외할 상대 필드 카드 ${cnt}장`, cnt, opPicked => {
              myPicked.sort((a,b)=>G.myField.indexOf(b)-G.myField.indexOf(a)).forEach(m => { const i = G.myField.findIndex(x => x === m); if (i >= 0) G.myExile.push(G.myField.splice(i,1)[0]); });
              opPicked.sort((a,b)=>G.opField.indexOf(b)-G.opField.indexOf(a)).forEach(m => { const i = G.opField.findIndex(x => x === m); if (i >= 0) { const z = G.opField.splice(i,1)[0]; G.opExile.push(z); if (typeof sendAction === 'function') sendAction({ type: 'opFieldRemove', cardId: z.id, to: 'exile' }); } });
              logSafe(`아자토스 ③: 서로 필드 ${cnt}장씩 제외`, 'mine');
              sync();
            });
          });
        });
      },
    });

    ENGINE.registerEffect('cthulhu_shub_2_field', {
      cardId: '아우터 갓 슈브 니구라스', effectNum: 2, zone: 'field', kind: 'quick', label: '슈브 니구라스 ② 엘더 갓 제외 → 상대 효과 무효',
      condition: c => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '아우터 갓 슈브 니구라스' && inChain() && (activeChainState.links || []).some(l => l.by !== myRole) && canUse('아우터 갓 슈브 니구라스', 2) && hasDeck(isElder),
      activate: c => {
        const targets = deckCards(isElder);
        chooseOne(targets, '슈브 니구라스 ②: [코스트] 덱에서 엘더 갓 제외', target => {
          if (!target) return;
          removeDeckCard(target.id);
          G.myExile.push(cardObj(target.id));
          mark('아우터 갓 슈브 니구라스', 2);
          if (typeof addChainLink === 'function') addChainLink({ type: 'genericNegate', label: '슈브 니구라스 ②', cardId: '아우터 갓 슈브 니구라스', effectNum: 2 });
          else if (typeof window.beginChain === 'function') window.beginChain({ type: 'genericNegate', label: '슈브 니구라스 ②', cardId: '아우터 갓 슈브 니구라스', effectNum: 2 });
          sync();
        });
      },
    });

    ENGINE.registerEffect('cthulhu_oldone_doom_2_grave', {
      cardId: '올드_원의 멸망', effectNum: 2, zone: 'grave', kind: 'quick', label: '올드_원의 멸망 ② 묘지 제외 → 올드원 서치', effectTags: ['deckSearch'],
      condition: () => !myTurn() && hasGrave(id => id === '올드_원의 멸망') && canUse('올드_원의 멸망', 2) && hasDeck(isOldOne),
      cost: (c, done) => {
        const gi = G.myGrave.findIndex(x => x.id === '올드_원의 멸망');
        if (gi < 0) return done(false);
        G.myExile.push(G.myGrave.splice(gi, 1)[0]);
        done(true);
      },
      resolve: (c, link) => window._cthulhuResolve ? window._cthulhuResolve({ cardId: '올드_원의 멸망', effectNum: 2, mainText: '', effectTags: ['deckSearch'] }) : null,
    });

    // ─────────────────────────────
    // 르뤼에 ③: 자신이 발동한 GOO 효과 처리 시 무효
    // ProcessingNegateEngine은 기본적으로 상대 링크만 보지만, allowOwn:true로 자신 링크도 검사한다.
    // ─────────────────────────────
    if (PN) {
      const oldInfer = PN.inferTags;
      if (typeof oldInfer === 'function' && !PN.__cthulhuInferPatched) {
        PN.inferTags = function inferTagsWithCthulhu(link) {
          const tags = oldInfer.call(PN, link) || [];
          const add = t => { if (!tags.includes(t)) tags.push(t); };
          if (link && isGOO(link.cardId)) add('greatOldOneEffect');
          if (link && link.cardId === '올드_원의 멸망') add('oldOneMagic');
          return tags;
        };
        PN.__cthulhuInferPatched = true;
      }
      PN.register({
        id: 'cthulhu_rlyeh_3_processing_negate',
        cardId: '태평양 속 르뤼에', effectNum: 3, label: '르뤼에 ③ GOO 효과 처리 시 무효',
        tags: ['greatOldOneEffect'], allowOwn: true, onlyOwn: true, requireField: false, maxPerTurn: 1,
        condition: ctx => !!(G.myFieldCard && G.myFieldCard.id === '태평양 속 르뤼에') && ctx.link && ctx.link.by === myRole,
        resolve: () => logSafe('르뤼에 ③: 자신 GOO 효과 처리 시 무효 적용', 'mine'),
      });
    }

    // ─────────────────────────────
    // 키 카드 덱의 아우터 갓 직접 소환 버튼 보강
    // ─────────────────────────────
    function canOfferOuterGod(id) {
      if (!myTurn() || phase() !== 'deploy' || inChain()) return false;
      if (!(G.myKeyDeck || []).some(c => c.id === id)) return false;
      if (id === '아우터 갓 슈브 니구라스') return false; // 슈브 ①은 GOO 소환 유발 전용
      return true;
    }
    const oldStartKeyFetch = window.startKeyFetchEffect;
    if (typeof oldStartKeyFetch === 'function' && !oldStartKeyFetch.__cthulhuPatched) {
      window.startKeyFetchEffect = function startKeyFetchWithOuterGods() {
        const outer = (G.myKeyDeck || []).filter(c => isOuter(c.id) && canOfferOuterGod(c.id));
        if (!outer.length) return oldStartKeyFetch.apply(this, arguments);
        const options = outer.map(c => ({ id: c.id, name: `${c.name} [아우터 갓 소환]`, _outer: true }));
        options.push({ id: '__default_key_menu__', name: '기존 키 카드 메뉴 열기', _default: true });
        openCardPicker(options, '키 카드 덱 — 크툴루 직접 소환/기존 메뉴', 1, sel => {
          if (!sel || !sel.length) return;
          const picked = options[sel[0]];
          if (!picked || picked._default) return oldStartKeyFetch.apply(this, arguments);
          if (typeof window._activateOuterGod === 'function') window._activateOuterGod(picked.id);
          else notifySafe('아우터 갓 소환 처리 함수를 찾을 수 없습니다.');
        }, true);
      };
      window.startKeyFetchEffect.__cthulhuPatched = true;
    }

    // _summonKeyCardFromDeck으로 들어와도 아우터 갓은 cthulhu.js 소환 처리로 위임
    const oldSummonKey = window._summonKeyCardFromDeck;
    if (typeof oldSummonKey === 'function' && !oldSummonKey.__cthulhuPatched) {
      window._summonKeyCardFromDeck = function summonKeyWithCthulhu(cardId) {
        if (isOuter(cardId) && typeof window._activateOuterGod === 'function') return window._activateOuterGod(cardId);
        return oldSummonKey.apply(this, arguments);
      };
      window._summonKeyCardFromDeck.__cthulhuPatched = true;
    }

    // ─────────────────────────────
    // 카드별 effectId 매핑
    // ─────────────────────────────
    ENGINE.registerCardEffects('그레이트 올드 원-크툴루', ['cthulhu_그레이트 올드 원-크툴루_1_hand', 'cthulhu_그레이트 올드 원-크툴루_2_hand']);
    ENGINE.registerCardEffects('태평양 속 르뤼에', ['cthulhu_ru_rlyeh_1_fieldcard', 'cthulhu_ru_rlyeh_2_fieldcard', 'cthulhu_rlyeh_3_processing_negate']);
    ENGINE.registerCardEffects('그레이트 올드 원-크투가', ['cthulhu_그레이트 올드 원-크투가_1_hand', 'cthulhu_그레이트 올드 원-크투가_2_hand']);
    ENGINE.registerCardEffects('그레이트 올드 원-크아이가', ['cthulhu_그레이트 올드 원-크아이가_1_hand', 'cthulhu_그레이트 올드 원-크아이가_2_hand', 'cthulhu_cyaegha_4_grave']);
    ENGINE.registerCardEffects('그레이트 올드 원-과타노차', ['cthulhu_그레이트 올드 원-과타노차_1_hand', 'cthulhu_ghatanothoa_2_field']);
    ENGINE.registerCardEffects('엘더 갓-노덴스', ['cthulhu_엘더 갓-노덴스_2_hand', 'cthulhu_nodens_2_field']);
    ENGINE.registerCardEffects('엘더 갓-크타니트', ['cthulhu_엘더 갓-크타니트_1_hand', 'cthulhu_엘더 갓-크타니트_3_hand', 'cthulhu_cthanit_3_field']);
    ENGINE.registerCardEffects('엘더 갓-히프노스', ['cthulhu_hypnos_3_field']);
    ENGINE.registerCardEffects('아우터 갓 니알라토텝', ['cthulhu_nyar_2_field', 'cthulhu_nyar_3_field']);
    ENGINE.registerCardEffects('아우터 갓-아자토스', ['cthulhu_azathoth_3_field']);
    ENGINE.registerCardEffects('아우터 갓 슈브 니구라스', ['cthulhu_shub_2_field']);
    ENGINE.registerCardEffects('올드_원의 멸망', ['cthulhu_올드_원의 멸망_1_hand', 'cthulhu_oldone_doom_2_grave']);

    // ─────────────────────────────
    // 필드존/묘지/제외 화면에도 등록형 버튼 노출
    // ─────────────────────────────
    function prependButtons(cardId, zone, base) {
      const actions = document.getElementById('mdCardActions');
      if (!actions || !ENGINE.getActivatableEffects) return;
      const effects = ENGINE.getActivatableEffects(cardId, zone, Object.assign({ cardId }, base || {}));
      if (!effects.length) return;
      const header = document.createElement('div');
      header.className = 'effect-registry-header cthulhu';
      header.textContent = '크툴루 등록형 효과';
      header.style.marginTop = '8px';
      header.style.opacity = '0.75';
      actions.prepend(header);
      effects.slice().reverse().forEach(def => {
        const b = document.createElement('button');
        b.className = 'btn btn-primary';
        b.textContent = def.label;
        b.onclick = () => { if (typeof closeModal === 'function') closeModal('cardDetailModal'); ENGINE.activateEffect(def.id, Object.assign({ cardId }, base || {})); };
        actions.prepend(b);
      });
    }

    if (typeof window.viewFieldCard === 'function' && !window.viewFieldCard.__cthulhuPatched) {
      const oldView = window.viewFieldCard;
      window.viewFieldCard = function viewFieldCardCthulhu(who) {
        window.__CTHULHU_VIEWING_MY_FIELD_CARD__ = who === 'me';
        try { return oldView.apply(this, arguments); }
        finally { setTimeout(() => { window.__CTHULHU_VIEWING_MY_FIELD_CARD__ = false; }, 0); }
      };
      window.viewFieldCard.__cthulhuPatched = true;
    }

    if (typeof window.openCardDetail === 'function' && !window.openCardDetail.__cthulhuPatched) {
      const oldOpen = window.openCardDetail;
      window.openCardDetail = function openCardDetailCthulhu(cardId, handIdx = -1, opponentCard = false, fieldIdx = -1) {
        oldOpen.apply(this, arguments);
        if (opponentCard || !isOldOne(cardId)) return;
        if (window.__CTHULHU_VIEWING_MY_FIELD_CARD__ && G.myFieldCard && G.myFieldCard.id === cardId) prependButtons(cardId, 'fieldCard', { sourceZone: 'fieldCard' });
        if (handIdx === -2) prependButtons(cardId, 'grave', { zoneIndex: (G.myGrave || []).findIndex(c => c.id === cardId) });
      };
      window.openCardDetail.__cthulhuPatched = true;
    }

    if (typeof window.showZone === 'function' && !window.showZone.__cthulhuPatched) {
      const oldShowZone = window.showZone;
      window.showZone = function showZoneCthulhu(zoneKey) {
        oldShowZone.apply(this, arguments);
        const zone = zoneKey === 'myGrave' ? 'grave' : zoneKey === 'myExile' ? 'exile' : null;
        if (!zone) return;
        const cards = zone === 'grave' ? (G.myGrave || []) : (G.myExile || []);
        const grid = document.getElementById('zoneViewGrid');
        if (!grid) return;
        Array.from(grid.children).forEach((wrapper, i) => {
          const c = cards[i];
          if (!c || !isOldOne(c.id)) return;
          const effects = ENGINE.getActivatableEffects(c.id, zone, { cardId: c.id, zoneIndex: i });
          effects.forEach(def => {
            const btn = document.createElement('button');
            btn.className = 'btn-sm';
            btn.textContent = def.label;
            btn.onclick = () => { if (typeof closeModal === 'function') closeModal('zoneViewModal'); ENGINE.activateEffect(def.id, { cardId: c.id, zoneIndex: i }); };
            wrapper.appendChild(btn);
          });
        });
      };
      window.showZone.__cthulhuPatched = true;
    }

    logSafe('크툴루/올드원 레지스트리 적용 완료', 'system');
  }

  boot();
})();
