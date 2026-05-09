// lion-tiger-liger-registry.js — 라이온/사자 + 타이거/호랑이 + 라이거 등록형 효과 패치
// 이전 테마 파일의 실제 resolve 함수는 최대한 재사용하고, 발동/유발 라우팅을 EffectEngine으로 모은다.

(function () {
  'use strict';

  function boot() {
    if (!window.EffectEngine || !window.CARDS || !window.THEME_EFFECT_HANDLERS) {
      setTimeout(boot, 50);
      return;
    }
    if (window.__lionTigerLigerRegistryPatched) return;
    window.__lionTigerLigerRegistryPatched = true;
    window.LTL_REGISTRY_EVENTS_ACTIVE = true;

    const ENGINE = window.EffectEngine;
    const BULLETS = ['', '①', '②', '③', '④', '⑤'];

    const safeLog = (msg, type = 'mine') => typeof log === 'function' ? log(msg, type) : console.log(`[${type}] ${msg}`);
    const safeNotify = (msg) => typeof notify === 'function' ? notify(msg) : console.warn(msg);
    const myTurn = () => typeof isMyTurn !== 'undefined' && !!isMyTurn;
    const phase = () => typeof currentPhase !== 'undefined' ? currentPhase : '';
    const phaseDeploy = () => phase() === 'deploy';
    const canUse = (cardId, num, max) => typeof canUseEffect !== 'function' || canUseEffect(cardId, num, max);
    const fieldLimit = () => typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5 + (G.myExtraSlots || 0);
    const isTheme = (id, theme) => CARDS[id]?.theme === theme;
    const isMonster = (id) => CARDS[id]?.cardType === 'monster';
    const isLion = (id) => isTheme(id, '라이온') || id.includes('라이온');
    const isTiger = (id) => isTheme(id, '타이거') || id.includes('타이거');
    const isLiger = (id) => isTheme(id, '라이거') || id.includes('라이거');
    const isSaja = (id) => id.includes('사자') || id === '진정한 사자' || isLion(id);
    const isHorang = (id) => id.includes('호랑이') || id === '진정한 호랑이' || isTiger(id);

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

    function handler(theme) {
      return window.THEME_EFFECT_HANDLERS && window.THEME_EFFECT_HANDLERS[theme];
    }

    function resolveTheme(theme, cardId, effectNum, extra = {}, mainText = null) {
      const h = handler(theme);
      const link = {
        type: 'themeEffect',
        label: `${cardId} ${BULLETS[effectNum] || effectNum}`,
        cardId,
        effectNum,
        theme,
        mainText: mainText || effectText(cardId, effectNum),
        extra,
      };
      if (h && typeof h.resolveLink === 'function') h.resolveLink(link);
      else if (typeof resolveThemeEffect === 'function') resolveThemeEffect(link);
    }

    function registerHand(theme, cardId, effectNum, opts = {}) {
      const id = opts.id || `${theme}_${cardId}_${effectNum}_hand`;
      ENGINE.registerEffect(id, {
        cardId,
        effectNum,
        zone: 'hand',
        kind: opts.kind || 'ignition',
        maxPerTurn: opts.maxPerTurn || 1,
        label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => {
          if (c.handIdx == null || c.handIdx < 0 || G.myHand[c.handIdx]?.id !== cardId) return false;
          if (!canUse(cardId, effectNum, opts.maxPerTurn || 1)) return false;
          return !opts.condition || opts.condition(c);
        },
        activate: (c) => {
          const h = handler(theme);
          if (!h || typeof h.activateFromHand !== 'function') {
            safeNotify(`${cardId}: ${theme} 기존 실행 함수를 찾을 수 없습니다.`);
            return false;
          }
          return h.activateFromHand(c.handIdx, effectNum);
        },
      });
      return id;
    }

    function registerFieldMonster(theme, cardId, effectNum, opts = {}) {
      const id = opts.id || `${theme}_${cardId}_${effectNum}_field`;
      ENGINE.registerEffect(id, {
        cardId,
        effectNum,
        zone: 'field',
        kind: opts.kind || 'ignition',
        maxPerTurn: opts.maxPerTurn || 1,
        label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => {
          if (c.fieldIdx == null || c.fieldIdx < 0 || G.myField[c.fieldIdx]?.id !== cardId) return false;
          if (!canUse(cardId, effectNum, opts.maxPerTurn || 1)) return false;
          return !opts.condition || opts.condition(c);
        },
        cost: opts.cost || null,
        resolve: opts.resolve || (() => resolveTheme(theme, cardId, effectNum, opts.extra || {})),
      });
      return id;
    }

    function registerGrave(theme, cardId, effectNum, opts = {}) {
      const id = opts.id || `${theme}_${cardId}_${effectNum}_grave`;
      ENGINE.registerEffect(id, {
        cardId,
        effectNum,
        zone: 'grave',
        kind: opts.kind || 'quick',
        maxPerTurn: opts.maxPerTurn || 1,
        label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => (G.myGrave || []).some(g => g.id === cardId) && canUse(cardId, effectNum, opts.maxPerTurn || 1) && (!opts.condition || opts.condition(c)),
        cost: opts.cost || null,
        resolve: opts.resolve || (() => resolveTheme(theme, cardId, effectNum, opts.extra || {})),
      });
      return id;
    }

    function registerTrigger(theme, id, cardId, effectNum, trigger, opts = {}) {
      ENGINE.registerEffect(id, {
        cardId,
        effectNum,
        zone: 'event',
        kind: 'trigger',
        trigger,
        maxPerTurn: opts.maxPerTurn || 1,
        optional: opts.optional !== false,
        chain: opts.chain !== false,
        markOnActivate: opts.markOnActivate,
        label: opts.label || `${cardId} ${BULLETS[effectNum] || effectNum}`,
        condition: (c) => canUse(cardId, effectNum, opts.maxPerTurn || 1) && (!opts.condition || opts.condition(c)),
        resolve: opts.resolve || ((c) => resolveTheme(theme, cardId, effectNum, opts.extra ? opts.extra(c) : {})),
      });
      return id;
    }

    function moveFromZoneToHand(zoneName, pred) {
      const zone = G[zoneName] || [];
      const idx = zone.findIndex(pred);
      if (idx < 0) return false;
      const z = zone.splice(idx, 1)[0];
      G.myHand.push({ id: z.id, name: z.name || CARDS[z.id]?.name || z.id, isPublic: false });
      return true;
    }

    function searchTrapFromDeck(pred, title) {
      const targets = typeof findAllInDeck === 'function' ? findAllInDeck(d => pred(d.id) && CARDS[d.id]?.cardType === 'trap') : [];
      if (!targets.length) { safeNotify('덱에 조건에 맞는 함정 카드가 없습니다.'); return; }
      openCardPicker(targets, title, 1, (sel) => {
        if (sel.length) searchToHand(targets[sel[0]].id);
        sendGameState(); renderAll();
      });
    }

    function placeNatureFromDeck() {
      const found = typeof findAllInDeck === 'function' ? findAllInDeck(d => d.id === '모두의 자연') : [];
      if (!found.length) return false;
      removeFromDeck('모두의 자연');
      if (typeof placeMyFieldCard === 'function') placeMyFieldCard('모두의 자연', { source: 'deck', activate: false, send: true });
      else G.myFieldCard = { id: '모두의 자연', name: '모두의 자연' };
      return true;
    }

    function exileOpponentFieldAll(reason, targeting = false) {
      while (G.opField.length) {
        const mon = G.opField.pop();
        if (mon) {
          G.opExile.push(mon);
          sendAction({ type: 'opFieldRemove', cardId: mon.id, to: 'exile', isTargeting: targeting });
        }
      }
      safeLog(`${reason}: 상대 필드 전부 제외`, 'mine');
      sendGameState(); renderAll();
    }

    // ─────────────────────────────
    // 라이온 / 사자 — 손패 수동 효과
    // ─────────────────────────────
    const lionIds = [];
    lionIds.push(registerHand('라이온', '베이비 라이온', 1, { label: '베이비 라이온 ① 서치 + 소환' }));
    lionIds.push(registerHand('라이온', '에이스 라이온', 1, {
      label: '에이스 라이온 ① 소환 + 필드 묘지',
      condition: () => G.myField.some(m => isTheme(m.id, '라이온')),
    }));
    ['사자의 포효', '사자의 사냥', '사자의 발톱'].forEach(cardId => {
      lionIds.push(registerHand('라이온', cardId, 1, { label: `${cardId} ①` }));
    });
    lionIds.push(registerHand('라이온', '사자의 일격', 1, {
      kind: 'quick', maxPerTurn: 2, label: '사자의 일격 ① 상대 패 덱으로',
      condition: () => !myTurn() && phaseDeploy(),
    }));
    lionIds.push(registerHand('라이온', '진정한 사자', 1, { label: '진정한 사자 ① 3종 공개' }));
    lionIds.push(registerHand('라이온', '라이온 킹', 1, { label: '라이온 킹 ① 패에서 소환' }));
    lionIds.push(registerHand('라이온', '고고한 사자', 1, {
      label: '고고한 사자 ① 덱 카드 서치',
      condition: () => myTurn() && phaseDeploy() && G.myField.some(m => isTheme(m.id, '라이온')),
    }));
    lionIds.push(registerHand('라이온', '고고한 사자', 2, {
      label: '고고한 사자 ② 패 제외 + 상대 필드 제외',
      condition: () => myTurn() && phaseDeploy() && !G.exileBanActive,
    }));

    // 라이온 자동/묘지/퀵
    lionIds.push(registerTrigger('라이온', 'lion_young_1_public', '젊은 라이온', 1, 'addedToPublicHand', {
      label: '젊은 라이온 ① 공개 패 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '젊은 라이온',
    }));
    lionIds.push(registerTrigger('라이온', 'lion_young_2_summon', '젊은 라이온', 2, 'summon', {
      label: '젊은 라이온 ② 소환 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '젊은 라이온',
    }));
    lionIds.push(registerTrigger('라이온', 'lion_ace_2_grave_event', '에이스 라이온', 2, 'sentToGrave', {
      label: '에이스 라이온 ② 묘지 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '에이스 라이온' && c.event?.from !== 'hand',
    }));
    lionIds.push(registerTrigger('라이온', 'lion_king_2_summon_event', '라이온 킹', 2, 'summon', {
      label: '라이온 킹 ② 소환 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '라이온 킹' && G.opField.length > 0,
    }));
    lionIds.push(registerGrave('라이온', '라이온 킹', 3, {
      label: '라이온 킹 ③ 묘지 소환 + 제외', kind: 'quick',
      condition: () => G.myField.length >= 5,
      cost: (c, done) => {
        const pool = [...G.myField];
        if (pool.length < 5) { safeNotify('라이온 킹 ③: 필드 몬스터 5장이 필요합니다.'); return done(false); }
        openCardPicker(pool, '라이온 킹 ③: [코스트] 묘지로 보낼 몬스터 5장 선택', 5, (sel) => {
          if (sel.length < 5) return done(false);
          sel.sort((a,b)=>b-a).forEach(i => { if (G.myField[i]) G.myGrave.push(G.myField.splice(i,1)[0]); });
          done(true);
        }, true);
      },
    }));

    // ─────────────────────────────
    // 타이거 / 호랑이 — 손패 수동 효과
    // ─────────────────────────────
    const tigerIds = [];
    tigerIds.push(registerHand('타이거', '베이비 타이거', 1, { label: '베이비 타이거 ① 서치 + 소환 + 제외' }));
    tigerIds.push(registerHand('타이거', '에이스 타이거', 1, {
      label: '에이스 타이거 ① 소환 + 서로 묘지',
      condition: () => G.myField.some(m => isTheme(m.id, '타이거')),
    }));
    ['호랑이의 포효', '호랑이의 사냥', '호랑이의 발톱'].forEach(cardId => {
      tigerIds.push(registerHand('타이거', cardId, 1, { label: `${cardId} ①` }));
    });
    tigerIds.push(registerHand('타이거', '진정한 호랑이', 1, { label: '진정한 호랑이 ① 3종 공개' }));
    tigerIds.push(registerHand('타이거', '호랑이의 일격', 1, {
      kind: 'quick', maxPerTurn: 2, label: '호랑이의 일격 ① 상대 패 제외',
      condition: () => !myTurn() && phaseDeploy(),
    }));
    tigerIds.push(registerHand('타이거', '타이거 킹', 1, {
      label: '타이거 킹 ① 패에서 소환',
      condition: () => G.myField.some(m => isTheme(m.id, '타이거')),
    }));
    tigerIds.push(registerHand('타이거', '고고한 호랑이', 1, {
      kind: 'quick', label: '고고한 호랑이 ① 묘지 회수',
      condition: () => !myTurn() && phaseDeploy() && G.myField.some(m => isTheme(m.id, '타이거')),
    }));
    tigerIds.push(registerHand('타이거', '고고한 호랑이', 2, {
      kind: 'quick', label: '고고한 호랑이 ② 패 제외 + 상대 필드 제외',
      condition: () => !myTurn() && phaseDeploy() && !G.exileBanActive,
    }));

    tigerIds.push(registerTrigger('타이거', 'tiger_young_1_public', '젊은 타이거', 1, 'addedToPublicHand', {
      label: '젊은 타이거 ① 공개 패 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '젊은 타이거',
    }));
    tigerIds.push(registerTrigger('타이거', 'tiger_young_2_summon', '젊은 타이거', 2, 'summon', {
      label: '젊은 타이거 ② 소환 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '젊은 타이거',
    }));
    tigerIds.push(registerTrigger('타이거', 'tiger_ace_2_grave_event', '에이스 타이거', 2, 'sentToGrave', {
      label: '에이스 타이거 ② 묘지 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '에이스 타이거' && c.event?.from !== 'hand',
    }));
    tigerIds.push(registerTrigger('타이거', 'tiger_baby_2_exile_event', '베이비 타이거', 2, 'exile', {
      label: '베이비 타이거 ② 제외 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '베이비 타이거',
      resolve: () => {
        if (G.opHand && G.opHand.length > 0) {
          sendAction({ type: 'forceDiscard', count: 1, reason: '베이비 타이거 ②', attackerPicks: false });
          safeLog('베이비 타이거 ②: 상대 패 1장 버리게 함', 'mine');
        }
        sendGameState(); renderAll();
      },
    }));
    tigerIds.push(registerTrigger('타이거', 'tiger_king_2_summon_event', '타이거 킹', 2, 'summon', {
      label: '타이거 킹 ② 소환 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '타이거 킹' && G.opField.length > 0,
    }));
    tigerIds.push(registerFieldMonster('타이거', '타이거 킹', 3, {
      kind: 'quick', label: '타이거 킹 ③ 상대 필드 최대 2장 제외',
    }));

    // ─────────────────────────────
    // 라이거 — 손패/필드/필드존/이벤트
    // ─────────────────────────────
    const ligerIds = [];
    ligerIds.push(registerHand('라이거', '화합의 시대의 라이거', 1, {
      label: '화합의 시대의 라이거 ① 덱/패 소환',
      condition: () => myTurn() && phaseDeploy(),
    }));
    ligerIds.push(registerHand('라이거', '베이비 라이거', 1, { label: '베이비 라이거 ① 라이온+타이거 소환' }));
    ligerIds.push(registerHand('라이거', '라이거 킹', 1, {
      label: '라이거 킹 ① 패에서 소환',
      condition: () => G.myField.some(m => m.id === '라이온 킹') && G.myField.some(m => m.id === '타이거 킹'),
    }));

    ligerIds.push(registerTrigger('라이거', 'liger_young_1_public', '젊은 라이거', 1, 'addedToPublicHand', {
      label: '젊은 라이거 ① 공개 패 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '젊은 라이거',
    }));
    ligerIds.push(registerTrigger('라이거', 'liger_baby_2_summon', '베이비 라이거', 2, 'summon', {
      label: '베이비 라이거 ② 모두의 자연 배치', chain: false,
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '베이비 라이거',
      resolve: () => { placeNatureFromDeck(); sendGameState(); renderAll(); },
    }));
    ligerIds.push(registerTrigger('라이거', 'liger_young_2_summon', '젊은 라이거', 2, 'summon', {
      label: '젊은 라이거 ② 라이거 서치',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '젊은 라이거',
    }));
    ligerIds.push(registerTrigger('라이거', 'liger_ace_1_grave_event', '에이스 라이거', 1, 'sentToGrave', {
      label: '에이스 라이거 ① 묘지 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '에이스 라이거' && c.event?.from !== 'hand',
    }));
    ligerIds.push(registerTrigger('라이거', 'liger_ace_2_summon', '에이스 라이거', 2, 'summon', {
      label: '에이스 라이거 ② 소환 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '에이스 라이거',
    }));
    ligerIds.push(registerTrigger('라이거', 'liger_king_2_summon_event', '라이거 킹', 2, 'summon', {
      label: '라이거 킹 ② 소환 유발',
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '라이거 킹' && G.opField.length > 0,
      resolve: () => { exileOpponentFieldAll('라이거 킹 ②', false); },
    }));
    ligerIds.push(registerTrigger('라이거', 'liger_king_4_field_grave_event', '라이거 킹', 4, 'sentToGrave', {
      label: '라이거 킹 ④ 필드→묘지 유발', optional: false,
      condition: (c) => c.event?.player === 'mine' && c.event?.cardId === '라이거 킹' && c.event?.from === 'field',
    }));

    ligerIds.push(registerFieldMonster('라이거', '베이비 라이거', 3, {
      label: '베이비 라이거 ③ 라이거 킹 내성',
      condition: () => myTurn() && phaseDeploy() && G.myField.some(m => m.id === '라이거 킹'),
      resolve: () => {
        G.ligerKingImmune = true;
        safeLog('베이비 라이거 ③: 이 턴 라이거 킹은 상대 효과를 받지 않음', 'mine');
        sendGameState(); renderAll();
      },
    }));
    ligerIds.push(registerFieldMonster('라이거', '에이스 라이거', 3, {
      kind: 'quick', label: '에이스 라이거 ③ 모두의 자연 재배치',
      condition: () => phaseDeploy() && G.myGrave.some(g => g.id === '모두의 자연'),
      resolve: () => {
        const gi = G.myGrave.findIndex(g => g.id === '모두의 자연');
        if (gi < 0) return;
        const z = G.myGrave.splice(gi, 1)[0];
        if (typeof placeMyFieldCard === 'function') placeMyFieldCard(z, { source: 'grave', activate: false, send: true });
        else G.myFieldCard = { id: z.id, name: z.name || '모두의 자연' };
        safeLog('에이스 라이거 ③: 묘지의 모두의 자연을 필드 존에 놓음', 'mine');
        sendGameState(); renderAll();
      },
    }));
    ligerIds.push(registerFieldMonster('라이거', '라이거 킹', 3, {
      kind: 'quick', label: '라이거 킹 ③ 상대 필드 전부 제외',
      resolve: () => { exileOpponentFieldAll('라이거 킹 ③', false); },
    }));

    // 모두의 자연 — 필드 존 전용 효과
    ENGINE.registerEffect('nature_all_1_fieldcard', {
      cardId: '모두의 자연', effectNum: 1, zone: 'fieldCard', kind: 'ignition', maxPerTurn: 1,
      label: '모두의 자연 ① 라이거 회수 + 상대 버리기',
      condition: () => G.myFieldCard?.id === '모두의 자연' && myTurn() && phaseDeploy() && canUse('모두의 자연', 1) && (
        G.myGrave.some(g => isLiger(g.id)) || G.myExile.some(e => isLiger(e.id))
      ),
      resolve: () => {
        const pool = [
          ...G.myGrave.filter(g => isLiger(g.id)).map(c => ({ ...c, _zone: 'myGrave' })),
          ...G.myExile.filter(e => isLiger(e.id)).map(c => ({ ...c, _zone: 'myExile' })),
        ];
        if (!pool.length) { safeNotify('묘지/제외 상태의 라이거 카드가 없습니다.'); return; }
        openCardPicker(pool, '모두의 자연 ①: 패에 넣을 라이거 카드 1장 선택', 1, (sel) => {
          if (sel.length) {
            const t = pool[sel[0]];
            moveFromZoneToHand(t._zone, z => z === t || z.id === t.id);
            safeLog(`모두의 자연 ①: ${t.name || t.id} 회수`, 'mine');
          }
          if (G.opHand && G.opHand.length > 0) {
            sendAction({ type: 'forceDiscard', count: 1, reason: '모두의 자연 ①', attackerPicks: false });
          }
          sendGameState(); renderAll();
        });
      },
    });
    ENGINE.registerEffect('nature_all_2_fieldcard', {
      cardId: '모두의 자연', effectNum: 2, zone: 'fieldCard', kind: 'ignition', maxPerTurn: 1,
      label: '모두의 자연 ② 묘지로 보내고 사자/호랑이 함정 서치',
      condition: () => G.myFieldCard?.id === '모두의 자연' && canUse('모두의 자연', 2),
      cost: (c, done) => {
        if (G.myFieldCard?.id !== '모두의 자연') return done(false);
        const moved = G.myFieldCard;
        G.myFieldCard = null;
        G.myGrave.push(moved);
        if (typeof onSentToGrave === 'function') onSentToGrave('모두의 자연', 'fieldCard', moved);
        safeLog('모두의 자연 ②: [코스트] 자신을 묘지로 보냄', 'mine');
        done(true);
      },
      resolve: () => searchTrapFromDeck(id => id.includes('사자') || id.includes('호랑이'), '모두의 자연 ②: 사자/호랑이 함정 서치'),
    });
    ENGINE.registerEffect('nature_all_3_fieldcard', {
      cardId: '모두의 자연', effectNum: 3, zone: 'fieldCard', kind: 'quick', maxPerTurn: 1,
      label: '모두의 자연 ③ 라이거 킹 소환',
      condition: () => G.myFieldCard?.id === '모두의 자연' && !myTurn() && phaseDeploy() && canUse('모두의 자연', 3) && G.myField.filter(m => isLiger(m.id) && isMonster(m.id)).length >= 2,
      cost: (c, done) => {
        const ligers = G.myField.filter(m => isLiger(m.id) && isMonster(m.id));
        openCardPicker(ligers, '모두의 자연 ③: [코스트] 묘지로 보낼 라이거 몬스터 2장', 2, (sel) => {
          if (sel.length < 2) return done(false);
          const picked = sel.map(i => ligers[i]).filter(Boolean);
          picked.forEach(t => {
            const fi = G.myField.findIndex(m => m === t || m.id === t.id);
            if (fi >= 0) {
              const z = G.myField.splice(fi, 1)[0];
              G.myGrave.push(z);
              if (typeof onSentToGrave === 'function') onSentToGrave(z.id, 'field', z);
            }
          });
          done(true);
        }, true);
      },
      resolve: () => {
        let idx = G.myKeyDeck.findIndex(c => c.id === '라이거 킹');
        if (idx >= 0) {
          const z = G.myKeyDeck.splice(idx, 1)[0];
          G.myField.push({ id: z.id, name: z.name || '라이거 킹', atk: CARDS['라이거 킹']?.atk || 8, atkBase: CARDS['라이거 킹']?.atk || 8, summonedFrom: 'keyDeck' });
        } else if ((idx = G.myHand.findIndex(c => c.id === '라이거 킹')) >= 0) {
          const z = G.myHand.splice(idx, 1)[0];
          G.myField.push({ id: z.id, name: z.name || '라이거 킹', atk: CARDS['라이거 킹']?.atk || 8, atkBase: CARDS['라이거 킹']?.atk || 8, summonedFrom: 'hand' });
        } else if ((idx = G.myGrave.findIndex(c => c.id === '라이거 킹')) >= 0) {
          const z = G.myGrave.splice(idx, 1)[0];
          G.myField.push({ id: z.id, name: z.name || '라이거 킹', atk: CARDS['라이거 킹']?.atk || 8, atkBase: CARDS['라이거 킹']?.atk || 8, summonedFrom: 'grave' });
        } else {
          safeNotify('라이거 킹을 키덱/패/묘지에서 찾을 수 없습니다.');
          sendGameState(); renderAll();
          return;
        }
        safeLog('모두의 자연 ③: 라이거 킹 소환', 'mine');
        if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId: '라이거 킹' });
        if (typeof onSummon === 'function') onSummon('라이거 킹', 'effect');
        sendGameState(); renderAll();
      },
    });
    ligerIds.push('nature_all_1_fieldcard', 'nature_all_2_fieldcard', 'nature_all_3_fieldcard');

    // 카드별 효과 연결
    ENGINE.registerCardEffects('베이비 라이온', ['라이온_베이비 라이온_1_hand']);
    ENGINE.registerCardEffects('젊은 라이온', ['lion_young_1_public', 'lion_young_2_summon']);
    ENGINE.registerCardEffects('에이스 라이온', ['라이온_에이스 라이온_1_hand', 'lion_ace_2_grave_event']);
    ENGINE.registerCardEffects('사자의 포효', ['라이온_사자의 포효_1_hand']);
    ENGINE.registerCardEffects('사자의 사냥', ['라이온_사자의 사냥_1_hand']);
    ENGINE.registerCardEffects('사자의 발톱', ['라이온_사자의 발톱_1_hand']);
    ENGINE.registerCardEffects('사자의 일격', ['라이온_사자의 일격_1_hand']);
    ENGINE.registerCardEffects('진정한 사자', ['라이온_진정한 사자_1_hand']);
    ENGINE.registerCardEffects('라이온 킹', ['라이온_라이온 킹_1_hand', 'lion_king_2_summon_event', '라이온_라이온 킹_3_grave']);
    ENGINE.registerCardEffects('고고한 사자', ['라이온_고고한 사자_1_hand', '라이온_고고한 사자_2_hand']);

    ENGINE.registerCardEffects('베이비 타이거', ['타이거_베이비 타이거_1_hand', 'tiger_baby_2_exile_event']);
    ENGINE.registerCardEffects('젊은 타이거', ['tiger_young_1_public', 'tiger_young_2_summon']);
    ENGINE.registerCardEffects('에이스 타이거', ['타이거_에이스 타이거_1_hand', 'tiger_ace_2_grave_event']);
    ENGINE.registerCardEffects('호랑이의 포효', ['타이거_호랑이의 포효_1_hand']);
    ENGINE.registerCardEffects('호랑이의 사냥', ['타이거_호랑이의 사냥_1_hand']);
    ENGINE.registerCardEffects('호랑이의 발톱', ['타이거_호랑이의 발톱_1_hand']);
    ENGINE.registerCardEffects('호랑이의 일격', ['타이거_호랑이의 일격_1_hand']);
    ENGINE.registerCardEffects('진정한 호랑이', ['타이거_진정한 호랑이_1_hand']);
    ENGINE.registerCardEffects('타이거 킹', ['타이거_타이거 킹_1_hand', 'tiger_king_2_summon_event', '타이거_타이거 킹_3_field']);
    ENGINE.registerCardEffects('고고한 호랑이', ['타이거_고고한 호랑이_1_hand', '타이거_고고한 호랑이_2_hand']);

    ENGINE.registerCardEffects('화합의 시대의 라이거', ['라이거_화합의 시대의 라이거_1_hand']);
    ENGINE.registerCardEffects('베이비 라이거', ['라이거_베이비 라이거_1_hand', 'liger_baby_2_summon', '라이거_베이비 라이거_3_field']);
    ENGINE.registerCardEffects('젊은 라이거', ['liger_young_1_public', 'liger_young_2_summon']);
    ENGINE.registerCardEffects('에이스 라이거', ['liger_ace_1_grave_event', 'liger_ace_2_summon', '라이거_에이스 라이거_3_field']);
    ENGINE.registerCardEffects('모두의 자연', ['nature_all_1_fieldcard', 'nature_all_2_fieldcard', 'nature_all_3_fieldcard']);
    ENGINE.registerCardEffects('라이거 킹', ['라이거_라이거 킹_1_hand', 'liger_king_2_summon_event', '라이거_라이거 킹_3_field', 'liger_king_4_field_grave_event']);

    patchFieldCardDetailButtons();
    safeLog('라이온/타이거/라이거 등록형 효과 로드 완료', 'system');
  }

  function patchFieldCardDetailButtons() {
    if (window.viewFieldCard && !window.viewFieldCard.__ltlPatched) {
      const oldView = window.viewFieldCard;
      window.viewFieldCard = function patchedViewFieldCard(who) {
        window.__LTL_VIEWING_MY_FIELD_CARD = (who === 'me');
        try { return oldView.apply(this, arguments); }
        finally { setTimeout(() => { window.__LTL_VIEWING_MY_FIELD_CARD = false; }, 0); }
      };
      window.viewFieldCard.__ltlPatched = true;
    }

    if (!window.openCardDetail || window.openCardDetail.__ltlFieldCardPatched) return;
    const oldOpen = window.openCardDetail;
    window.openCardDetail = function patchedOpenCardDetail(cardId, handIdx = -1, opponentCard = false, fieldIdx = -1) {
      oldOpen.apply(this, arguments);
      if (opponentCard || !window.__LTL_VIEWING_MY_FIELD_CARD) return;
      if (!G.myFieldCard || G.myFieldCard.id !== cardId) return;
      const actions = document.getElementById('mdCardActions');
      if (!actions || !window.EffectEngine) return;
      const effects = window.EffectEngine.getActivatableEffects(cardId, 'fieldCard', { cardId, sourceZone: 'fieldCard' });
      if (!effects.length) return;

      const header = document.createElement('div');
      header.className = 'effect-registry-header';
      header.textContent = '필드 존 등록형 효과';
      header.style.marginTop = '8px';
      header.style.opacity = '0.75';
      actions.prepend(header);

      effects.slice().reverse().forEach(def => {
        const b = document.createElement('button');
        b.className = 'btn btn-primary';
        b.textContent = def.label;
        b.onclick = () => {
          if (typeof closeModal === 'function') closeModal('cardDetailModal');
          window.EffectEngine.activateEffect(def.id, { cardId, sourceZone: 'fieldCard' });
        };
        actions.prepend(b);
      });
    };
    window.openCardDetail.__ltlFieldCardPatched = true;
  }

  boot();
})();
