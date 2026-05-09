// effect-registry.js — 카드 효과 정식 레지스트리 / 라우터
// 목적: cards.js의 effects 텍스트를 파싱하지 않고, effectId -> 실제 실행 로직으로 연결한다.
// 로드 순서: effects-chain.js 이후, 기존 테마 파일 이후에 로드해도 안전하게 activateCard/openCardDetail을 패치한다.

(function () {
  'use strict';

  const ENGINE = window.EffectEngine = window.EffectEngine || {};
  const EFFECTS = ENGINE.effects = ENGINE.effects || {};
  const CARD_EFFECTS = ENGINE.cardEffects = ENGINE.cardEffects || {};

  // GameEvents — 소환/묘지/제외/테마 전용 사건을 한 곳으로 모으는 가벼운 이벤트 버스.
  // engine.js는 사건만 emit하고, 실제로 어떤 카드가 반응할지는 EffectEngine이 판단한다.
  const GAME_EVENTS = window.GameEvents = window.GameEvents || {};
  GAME_EVENTS.listeners = GAME_EVENTS.listeners || {};

  GAME_EVENTS.on = function on(eventName, handler) {
    if (!eventName || typeof handler !== 'function') return;
    if (!GAME_EVENTS.listeners[eventName]) GAME_EVENTS.listeners[eventName] = [];
    GAME_EVENTS.listeners[eventName].push(handler);
  };

  GAME_EVENTS.emit = function emit(eventName, payload = {}) {
    const event = Object.assign({ name: eventName, ts: Date.now() }, payload);
    const listeners = (GAME_EVENTS.listeners[eventName] || []).slice();
    listeners.forEach(fn => {
      try { fn(event); }
      catch (e) { console.warn('[GameEvents] listener 오류:', eventName, e); }
    });
    if (window.EffectEngine && typeof window.EffectEngine.emitEvent === 'function') {
      window.EffectEngine.emitEvent(eventName, event);
    }
  };

  const BULLETS = ['', '①', '②', '③', '④', '⑤', '⑥'];

  function safeNotify(msg) {
    if (typeof notify === 'function') notify(msg);
    else console.warn(msg);
  }

  function safeLog(msg, type = 'system') {
    if (typeof log === 'function') log(msg, type);
    else console.log(`[${type}] ${msg}`);
  }

  function getCardDef(cardId) {
    return (window.CARDS && CARDS[cardId]) || { id: cardId, name: cardId };
  }

  function getEffectText(cardId, effectNum) {
    const card = getCardDef(cardId);
    const text = String(card.effects || '');
    const bullet = BULLETS[effectNum];
    if (!bullet || !text.includes(bullet)) return '';
    const start = text.indexOf(bullet);
    let end = text.length;
    for (let i = effectNum + 1; i < BULLETS.length; i++) {
      const b = BULLETS[i];
      const pos = b ? text.indexOf(b, start + 1) : -1;
      if (pos >= 0 && pos < end) end = pos;
    }
    return text.slice(start, end).trim();
  }

  function defaultLabel(def) {
    const c = getCardDef(def.cardId);
    return `${c.name || def.cardId} ${BULLETS[def.effectNum] || def.effectNum || ''}`.trim();
  }

  function normalizeEffect(id, def) {
    const out = Object.assign({
      id,
      cardId: def.cardId,
      effectNum: def.effectNum || 1,
      zone: def.zone || 'hand',       // hand | field | grave | exile | any
      kind: def.kind || 'ignition',   // ignition | quick | trigger | direct
      optional: def.optional !== false,
      maxPerTurn: def.maxPerTurn || 1,
      chain: def.chain !== false,
      condition: () => true,
      cost: null,
      buildLink: null,
      resolve: null,
      activate: null,
    }, def, { id });
    out.label = out.label || defaultLabel(out);
    out.text = out.text || getEffectText(out.cardId, out.effectNum);
    return out;
  }

  ENGINE.registerEffect = function registerEffect(id, def) {
    if (!id || !def || !def.cardId) {
      console.warn('[EffectEngine] 잘못된 효과 등록:', id, def);
      return null;
    }
    const normalized = normalizeEffect(id, def);
    EFFECTS[id] = normalized;
    if (!CARD_EFFECTS[normalized.cardId]) CARD_EFFECTS[normalized.cardId] = [];
    if (!CARD_EFFECTS[normalized.cardId].includes(id)) CARD_EFFECTS[normalized.cardId].push(id);
    return normalized;
  };

  ENGINE.registerCardEffects = function registerCardEffects(cardId, effectIds) {
    if (!cardId || !Array.isArray(effectIds)) return;
    CARD_EFFECTS[cardId] = effectIds.slice();
  };

  function ctx(base = {}) {
    return Object.assign({
      G: window.G,
      card: base.cardId ? getCardDef(base.cardId) : null,
      cardId: base.cardId,
      effect: base.effect || null,
      handIdx: base.handIdx,
      fieldIdx: base.fieldIdx,
      source: base.source,
      link: base.link,
      isMyTurn: () => myTurn(),
      phase: () => window.currentPhase,
      notify: safeNotify,
      log: safeLog,
      useEffect(cardId, num, max) {
        if (typeof canUseEffect === 'function' && !canUseEffect(cardId, num, max)) return false;
        if (typeof markEffectUsed === 'function') markEffectUsed(cardId, num);
        return true;
      },
      canUse(cardId, num, max) {
        return typeof canUseEffect !== 'function' || canUseEffect(cardId, num, max);
      },
      sync() {
        if (typeof sendGameState === 'function') sendGameState();
        if (typeof renderAll === 'function') renderAll();
      },
      findHandIndexByInstanceOrId(cardId, iid) {
        if (!G || !Array.isArray(G.myHand)) return -1;
        if (iid && typeof findCardIndexByInstanceId === 'function') {
          const byIid = findCardIndexByInstanceId(G.myHand, iid);
          if (byIid >= 0) return byIid;
        }
        return G.myHand.findIndex(c => c && c.id === cardId);
      },
      findFieldIndexByInstanceOrId(cardId, iid) {
        if (!G || !Array.isArray(G.myField)) return -1;
        if (iid && typeof findCardIndexByInstanceId === 'function') {
          const byIid = findCardIndexByInstanceId(G.myField, iid);
          if (byIid >= 0) return byIid;
        }
        return G.myField.findIndex(c => c && c.id === cardId);
      },
    }, base);
  }

  function zoneMatches(def, zone) {
    return def.zone === 'any' || def.zone === zone;
  }

  function canActivate(def, base) {
    try {
      if (!def) return false;
      if (def.zone === 'hand' && (base.handIdx == null || base.handIdx < 0)) return false;
      if (def.zone === 'field' && (base.fieldIdx == null || base.fieldIdx < 0)) return false;
      if (def.condition && !def.condition(ctx(Object.assign({}, base, { effect: def, cardId: def.cardId })))) return false;
      return true;
    } catch (e) {
      console.warn('[EffectEngine] condition 오류:', def.id, e);
      return false;
    }
  }

  ENGINE.getCardEffectIds = function getCardEffectIds(cardId) {
    const card = getCardDef(cardId);
    const fromCard = Array.isArray(card.effectIds) ? card.effectIds : [];
    const fromMap = CARD_EFFECTS[cardId] || [];
    return Array.from(new Set([...fromCard, ...fromMap]));
  };

  ENGINE.getActivatableEffects = function getActivatableEffects(cardId, zone, base = {}) {
    return ENGINE.getCardEffectIds(cardId)
      .map(id => EFFECTS[id])
      .filter(def => def && zoneMatches(def, zone) && canActivate(def, base));
  };

  ENGINE.emitEvent = function emitEvent(triggerName, event = {}) {
    Object.values(EFFECTS).forEach(def => {
      if (!def || def.kind !== 'trigger' || def.trigger !== triggerName) return;
      const base = {
        cardId: def.cardId,
        event,
        sourceZone: 'event',
      };
      if (!canActivate(def, base)) return;
      ENGINE.activateEffect(def.id, base);
    });
  };

  function makeLink(def, base) {
    const c = ctx(Object.assign({}, base, { effect: def, cardId: def.cardId }));
    const extra = typeof def.buildLink === 'function' ? (def.buildLink(c) || {}) : {};
    return Object.assign({
      type: 'registeredEffect',
      effectId: def.id,
      label: def.label,
      cardId: def.cardId,
      effectNum: def.effectNum,
      sourceZone: def.zone,
      effectTags: Array.isArray(def.effectTags) ? def.effectTags.slice() : [],
      sourceInstanceId: base.sourceInstanceId || null,
    }, extra);
  }

  ENGINE.activateEffect = function activateEffect(effectId, base = {}) {
    const def = EFFECTS[effectId];
    if (!def) { safeNotify(`등록되지 않은 효과입니다: ${effectId}`); return false; }
    const source = base.source || (base.handIdx >= 0 ? G.myHand[base.handIdx] : base.fieldIdx >= 0 ? G.myField[base.fieldIdx] : null);
    if (source && typeof ensureCardInstanceId === 'function') base.sourceInstanceId = ensureCardInstanceId(source);
    base.source = source;

    if (!canActivate(def, base)) {
      safeNotify(`${def.label}: 지금은 발동할 수 없습니다.`);
      return false;
    }

    const c = ctx(Object.assign({}, base, { effect: def, cardId: def.cardId }));

    if (typeof def.activate === 'function') {
      def.activate(c);
      return true;
    }

    const afterCost = (paid) => {
      if (paid === false) return;
      if (def.maxPerTurn && def.markOnActivate !== false && !c.useEffect(def.cardId, def.effectNum, def.maxPerTurn)) {
        safeNotify('이번 턴에는 이미 사용했습니다.');
        return;
      }

      if (def.chain === false || def.kind === 'direct') {
        ENGINE.resolveEffect(def.id, c, {});
        c.sync();
        return;
      }

      const link = makeLink(def, base);
      if (def.kind === 'quick') {
        if (typeof activateQuickEffect === 'function') activateQuickEffect(link);
        else window.beginChain(link);
      } else if (def.kind === 'trigger') {
        if (typeof enqueueTriggeredEffect === 'function') enqueueTriggeredEffect(Object.assign({ optional: def.optional }, link));
        else window.beginChain(link);
      } else {
        if (typeof activateIgnitionEffect === 'function') activateIgnitionEffect(link);
        else window.beginChain(link);
      }
      if (typeof sendGameState === 'function') sendGameState();
      if (typeof renderAll === 'function') renderAll();
    };

    if (typeof def.cost === 'function') def.cost(c, afterCost);
    else afterCost(true);
    return true;
  };

  ENGINE.resolveEffect = function resolveEffect(effectId, c, link) {
    const def = EFFECTS[effectId];
    if (!def || typeof def.resolve !== 'function') {
      console.warn('[EffectEngine] resolve 없음:', effectId);
      return false;
    }
    try {
      def.resolve(c || ctx({ effect: def, cardId: def.cardId, link }), link || {});
      return true;
    } catch (e) {
      console.error('[EffectEngine] resolve 오류:', effectId, e);
      safeNotify(`효과 처리 오류: ${def.label} — ${e.message || e}`);
      return false;
    }
  };

  ENGINE.resolveChainLink = function resolveChainLink(link) {
    if (!link || link.type !== 'registeredEffect') return false;
    const def = EFFECTS[link.effectId];
    if (!def) return false;
    return ENGINE.resolveEffect(link.effectId, ctx({ effect: def, cardId: def.cardId, link }), link);
  };

  function chooseAndActivate(cardId, zone, base) {
    const effects = ENGINE.getActivatableEffects(cardId, zone, base);
    if (!effects.length) return false;
    if (effects.length === 1) return ENGINE.activateEffect(effects[0].id, base);
    const display = effects.map(e => ({ id: e.cardId, name: e.label }));
    if (typeof openCardPicker === 'function') {
      openCardPicker(display, '발동할 효과 선택', 1, (sel) => {
        if (!sel || !sel.length) return;
        ENGINE.activateEffect(effects[sel[0]].id, base);
      }, true);
    } else {
      ENGINE.activateEffect(effects[0].id, base);
    }
    return true;
  }

  ENGINE.activateCardFromHand = function activateCardFromHand(handIdx) {
    const c = G.myHand && G.myHand[handIdx];
    if (!c) return false;
    return chooseAndActivate(c.id, 'hand', { handIdx, cardId: c.id });
  };

  ENGINE.activateCardFromField = function activateCardFromField(fieldIdx, effectNum) {
    const c = G.myField && G.myField[fieldIdx];
    if (!c) return false;
    const effects = ENGINE.getActivatableEffects(c.id, 'field', { fieldIdx, cardId: c.id })
      .filter(e => effectNum == null || e.effectNum === effectNum);
    if (!effects.length) return false;
    return ENGINE.activateEffect(effects[0].id, { fieldIdx, cardId: c.id });
  };

  // activateCard 라우터 패치: 등록된 효과가 있으면 새 엔진이 우선 처리하고, 없으면 기존 코드로 넘김.
  function patchActivateCard() {
    if (typeof window.activateCard !== 'function') { setTimeout(patchActivateCard, 50); return; }
    if (window.activateCard.__effectRegistryPatched) return;
    const oldActivateCard = window.activateCard;
    window.activateCard = function patchedActivateCard(handIdx) {
      if (ENGINE.activateCardFromHand(handIdx)) return;
      return oldActivateCard.apply(this, arguments);
    };
    window.activateCard.__effectRegistryPatched = true;
  }

  function patchFieldEffect() {
    if (typeof window.activateFieldEffect !== 'function') { setTimeout(patchFieldEffect, 50); return; }
    if (window.activateFieldEffect.__effectRegistryPatched) return;
    const oldActivateFieldEffect = window.activateFieldEffect;
    window.activateFieldEffect = function patchedActivateFieldEffect(fieldIdx, effectNum) {
      if (ENGINE.activateCardFromField(fieldIdx, effectNum)) return;
      return oldActivateFieldEffect.apply(this, arguments);
    };
    window.activateFieldEffect.__effectRegistryPatched = true;
  }

  // 상세 모달의 등록형 효과 버튼을 최종 렌더링한다.
  // 기존 수작업 버튼과 등록형 버튼이 겹치지 않도록, 모든 테마 레지스트리가 로드된 뒤 마지막에 패치한다.
  function patchCardDetail() {
    if (typeof window.openCardDetail !== 'function') { setTimeout(patchCardDetail, 50); return; }
    if (window.openCardDetail.__effectRegistryUiPatched) return;

    const oldOpen = window.openCardDetail;

    const getState = () => window.G || (typeof G !== 'undefined' ? G : null);
    const notifySafe = (msg) => {
      if (typeof window.notify === 'function') window.notify(msg);
      else console.warn(msg);
    };
    const closeCardModal = () => {
      if (typeof window.closeModal === 'function') window.closeModal('cardDetailModal');
    };
    const addButton = (actions, label, className, onClick) => {
      const b = document.createElement('button');
      b.className = className || 'btn btn-secondary';
      b.textContent = label;
      b.onclick = onClick;
      actions.appendChild(b);
      return b;
    };
    const addCloseButton = (actions) => addButton(actions, '닫기', 'btn btn-secondary', closeCardModal);
    const addHeader = (actions, text) => {
      const header = document.createElement('div');
      header.className = 'effect-registry-header effect-registry-clean-header';
      header.textContent = text || '사용 가능한 효과';
      header.style.marginTop = '8px';
      header.style.marginBottom = '2px';
      header.style.opacity = '0.75';
      actions.appendChild(header);
      return header;
    };

    function findZone(cardId, handIdx, opponentCard, fieldIdx) {
      if (opponentCard) return null;
      const state = getState();

      if (handIdx >= 0) {
        return { zone: 'hand', base: { cardId, handIdx } };
      }
      if (fieldIdx >= 0) {
        return { zone: 'field', base: { cardId, fieldIdx } };
      }
      // ui.js의 zoneViewModal에서 묘지 카드를 열 때 handIdx=-2를 사용한다.
      if (handIdx === -2) {
        const grave = state && Array.isArray(state.myGrave) ? state.myGrave : [];
        return {
          zone: 'grave',
          base: { cardId, sourceZone: 'grave', zoneIndex: grave.findIndex(c => c && c.id === cardId) },
        };
      }
      // viewFieldCard('me')에서 상세창을 열었을 때만 필드 존 카드 효과를 보여준다.
      if (window.__EFFECT_REGISTRY_VIEWING_MY_FIELD_CARD__) {
        return { zone: 'fieldCard', base: { cardId, sourceZone: 'fieldCard' } };
      }
      return null;
    }

    function getRegistryEffects(cardId, zoneInfo) {
      if (!zoneInfo || !ENGINE || typeof ENGINE.getActivatableEffects !== 'function') return [];
      try {
        const effects = ENGINE.getActivatableEffects(cardId, zoneInfo.zone, zoneInfo.base || {});
        const seen = new Set();
        return effects.filter(def => {
          if (!def || !def.id) return false;
          if (seen.has(def.id)) return false;
          seen.add(def.id);
          return true;
        });
      } catch (e) {
        console.warn('[effect-registry] 등록형 버튼 조회 오류:', e);
        return [];
      }
    }

    function renderRegisteredButtons(cardId, zoneInfo, effects) {
      const actions = document.getElementById('mdCardActions');
      if (!actions || !zoneInfo || !effects.length) return false;

      actions.innerHTML = '';
      addHeader(actions, '사용 가능한 효과');

      effects.forEach(def => {
        addButton(actions, def.label || def.id, 'btn btn-primary', () => {
          closeCardModal();
          try {
            ENGINE.activateEffect(def.id, Object.assign({ cardId }, zoneInfo.base || {}));
          } catch (e) {
            console.error('[effect-registry] activateEffect 오류:', e);
            notifySafe('효과 처리 오류: ' + (e && e.message ? e.message : e));
          }
        });
      });

      // 손패 카드는 등록형 효과만 남기되, 수동 버리기는 기본 조작이라 유지한다.
      if (zoneInfo.zone === 'hand' && typeof window.manualDiscard === 'function' && zoneInfo.base && zoneInfo.base.handIdx >= 0) {
        addButton(actions, '패에서 버리기', 'btn btn-danger', () => {
          closeCardModal();
          try { window.manualDiscard(zoneInfo.base.handIdx); }
          catch (e) {
            console.error('[effect-registry] manualDiscard 오류:', e);
            notifySafe('버리기 처리 오류: ' + (e && e.message ? e.message : e));
          }
        });
      }

      addCloseButton(actions);
      return true;
    }

    function removeExactDuplicateButtons() {
      const actions = document.getElementById('mdCardActions');
      if (!actions) return;
      const seen = new Set();
      Array.from(actions.querySelectorAll('button')).forEach(btn => {
        const key = `${(btn.textContent || '').trim()}@@${btn.className || ''}`;
        if (seen.has(key) && (btn.textContent || '').trim() !== '닫기') {
          btn.remove();
          return;
        }
        seen.add(key);
      });
    }

    window.openCardDetail = function openCardDetailEffectRegistryUi(cardId, handIdx = -1, opponentCard = false, fieldIdx = -1) {
      const result = oldOpen.apply(this, arguments);
      try {
        const zoneInfo = findZone(cardId, handIdx, opponentCard, fieldIdx);
        const effects = getRegistryEffects(cardId, zoneInfo);
        if (effects.length) renderRegisteredButtons(cardId, zoneInfo, effects);
        else removeExactDuplicateButtons();
      } catch (e) {
        console.warn('[effect-registry] 상세 버튼 정리 오류:', e);
      }
      return result;
    };
    window.openCardDetail.__effectRegistryUiPatched = true;
  }

  function patchViewFieldCardForRegistryUi() {
    if (typeof window.viewFieldCard !== 'function') { setTimeout(patchViewFieldCardForRegistryUi, 50); return; }
    if (window.viewFieldCard.__effectRegistryUiPatched) return;
    const oldView = window.viewFieldCard;
    window.viewFieldCard = function viewFieldCardEffectRegistryUi(who) {
      window.__EFFECT_REGISTRY_VIEWING_MY_FIELD_CARD__ = who === 'me';
      try {
        return oldView.apply(this, arguments);
      } finally {
        setTimeout(() => { window.__EFFECT_REGISTRY_VIEWING_MY_FIELD_CARD__ = false; }, 0);
      }
    };
    window.viewFieldCard.__effectRegistryUiPatched = true;
  }

  // 펭귄 테마 등록: 카드 텍스트를 파싱하지 않고, cardId/effectNum -> 실제 함수로 연결한다.
  // 아직 자동 유발(onSummon/onGrave) 자체는 penguin.js의 기존 트리거를 그대로 사용한다.
  // 대신 손패/필드/묘지에서 수동으로 누르는 펭귄 효과는 여기서 먼저 처리한다.
  function registerBuiltIns() {
    if (ENGINE.__builtInsRegistered) return;
    ENGINE.__builtInsRegistered = true;

    const hasFn = (name) => typeof window[name] === 'function';
    const phaseDeploy = () => (typeof currentPhase !== 'undefined') && currentPhase === 'deploy';
    const myTurn = () => (typeof isMyTurn !== 'undefined') && !!isMyTurn;
    const fieldLimit = () => (typeof maxFieldSlots === 'function' ? maxFieldSlots() : 5);
    const canUse = (cardId, num, max) => (typeof canUseEffect !== 'function') || canUseEffect(cardId, num, max);
    const hasPenguinMonsterOnField = () => G && Array.isArray(G.myField) && G.myField.some(c => c && typeof isPenguinMonster === 'function' && isPenguinMonster(c.id));
    const hasHandPenguinMonster = () => G && Array.isArray(G.myHand) && G.myHand.some(c => c && typeof isPenguinMonster === 'function' && isPenguinMonster(c.id));
    const hasDeckPenguinMonster = () => typeof findAllInDeck === 'function' && typeof isPenguinMonster === 'function' && findAllInDeck(c => isPenguinMonster(c.id)).length > 0;
    const hasDeckPenguinCard = () => typeof findAllInDeck === 'function' && typeof isPenguinCard === 'function' && findAllInDeck(c => isPenguinCard(c.id)).length > 0;
    const hasGrave = (id) => G && Array.isArray(G.myGrave) && G.myGrave.some(c => c && c.id === id);
    const hasGraveOrExile = (pred) => G && [...(G.myGrave || []), ...(G.myExile || [])].some(pred);

    function registerWrapper(id, def, fnName) {
      ENGINE.registerEffect(id, Object.assign({
        activate: (c) => {
          const fn = window[fnName];
          if (typeof fn !== 'function') {
            safeNotify(`${def.label || id}: 실행 함수 ${fnName}을 찾을 수 없습니다.`);
            return false;
          }
          if (def.zone === 'hand') return fn(c.handIdx, def.effectNum);
          if (def.zone === 'field') return fn(c.fieldIdx, def.effectNum);
          return fn(def.cardId, def.effectNum);
        },
      }, def));
    }

    // ─────────────────────────────
    // 손패 발동 효과
    // ─────────────────────────────
    ENGINE.registerEffect('penguin_village_1', {
      cardId: '펭귄 마을', effectNum: 1, zone: 'hand', kind: 'ignition', maxPerTurn: 1,
      label: '펭귄 마을 ① 공개',
      condition: (c) => myTurn() && phaseDeploy() && c.handIdx >= 0 && !G.myHand[c.handIdx]?.isPublic && canUse('펭귄 마을', 1),
      resolve: (c, link) => {
        const idx = c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '펭귄 마을'
          ? c.handIdx
          : G.myHand.findIndex(x => x && x.id === '펭귄 마을' && !x.isPublic);
        if (idx >= 0) G.myHand[idx].isPublic = true;
        safeLog('펭귄 마을 ①: 공개', 'mine');
      },
    });

    ENGINE.registerEffect('kkoma_penguin_1', {
      cardId: '꼬마 펭귄', effectNum: 1, zone: 'hand', kind: 'ignition', maxPerTurn: 2,
      label: '꼬마 펭귄 ① 패에서 소환',
      condition: (c) => myTurn() && phaseDeploy() && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '꼬마 펭귄' && G.myField.length < fieldLimit() && canUse('꼬마 펭귄', 1, 2),
      cost: (c, done) => {
        const source = G.myHand[c.handIdx];
        if (!source || source.id !== '꼬마 펭귄') return done(false);
        G.myHand.splice(c.handIdx, 1);
        done(true);
      },
      resolve: () => {
        const card = CARDS['꼬마 펭귄'];
        if (G.myField.length >= fieldLimit()) { safeNotify('몬스터 존이 가득 찼습니다.'); return; }
        G.myField.push({ id: card.id, name: card.name, atk: card.atk || 0, atkBase: card.atk || 0, summonedFrom: 'hand' });
        safeLog('꼬마 펭귄 ①: 패에서 소환', 'mine');
        if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId: card.id });
        if (typeof onSummon === 'function') onSummon(card.id, 'hand');
      },
    });

    registerWrapper('penguin_bubu_2', {
      cardId: '펭귄 부부', effectNum: 2, zone: 'hand', kind: 'ignition', label: '펭귄 부부 ② 드로우2 + 버리기',
      condition: (c) => hasFn('activatePenguinBubu2') && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '펭귄 부부' && canUse('펭귄 부부', 2),
    }, 'activatePenguinBubu2');

    registerWrapper('penguin_charge_1', {
      cardId: '펭귄!돌격!', effectNum: 1, zone: 'hand', kind: 'ignition', label: '펭귄!돌격! ① 덱에서 펭귄 소환',
      condition: (c) => hasFn('activatePenguinCharge1') && myTurn() && phaseDeploy() && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '펭귄!돌격!' && hasDeckPenguinMonster(),
    }, 'activatePenguinCharge1');

    registerWrapper('penguin_glory_1', {
      cardId: '펭귄의 영광', effectNum: 1, zone: 'hand', kind: 'quick', label: '펭귄의 영광 ① 용사 소환 + 상대 패 공개',
      condition: (c) => hasFn('activatePenguinGlory1') && phaseDeploy() && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '펭귄의 영광',
    }, 'activatePenguinGlory1');

    registerWrapper('penguin_forever_1', {
      cardId: '펭귄이여 영원하라', effectNum: 1, zone: 'hand', kind: 'ignition', label: '펭귄이여 영원하라 ① 필드 되돌리기 + 소환',
      condition: (c) => hasFn('activatePenguinForever1') && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '펭귄이여 영원하라' && canUse('펭귄이여 영원하라', 1),
    }, 'activatePenguinForever1');

    registerWrapper('penguin_wizard_1', {
      cardId: '펭귄 마법사', effectNum: 1, zone: 'hand', kind: 'ignition', label: '펭귄 마법사 ① 서치 후 덱 복귀',
      condition: (c) => hasFn('activatePenguinWizard1') && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '펭귄 마법사' && !G.myHand[c.handIdx]?.isPublic && hasDeckPenguinCard() && canUse('펭귄 마법사', 1, 2),
    }, 'activatePenguinWizard1');

    registerWrapper('penguin_strike_1', {
      cardId: '펭귄의 일격', effectNum: 1, zone: 'hand', kind: 'quick', label: '펭귄의 일격 ① 상대 효과 무효',
      condition: () => hasFn('activatePenguinStrike1') && canUse('펭귄의 일격', 1) && hasPenguinMonsterOnField() && G.myHand.length >= 2 && !!(typeof activeChainState !== 'undefined' && activeChainState && activeChainState.active && (activeChainState.links || []).some(l => l.by !== myRole)),
    }, 'activatePenguinStrike1');

    // ─────────────────────────────
    // 필드 발동 효과
    // ─────────────────────────────
    registerWrapper('penguin_bubu_1_field', {
      cardId: '펭귄 부부', effectNum: 1, zone: 'field', kind: 'trigger', label: '펭귄 부부 ① 덱 소환 유발 서치',
      condition: (c) => hasFn('activatePenguinBubu1FromField') && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '펭귄 부부' && G.myField[c.fieldIdx]?.summonedFrom === 'deck' && G.myField[c.fieldIdx]?.bubuTriggerReady && canUse('펭귄 부부', 1),
    }, 'activatePenguinBubu1FromField');

    registerWrapper('sage_penguin_1', {
      cardId: '현자 펭귄', effectNum: 1, zone: 'field', kind: 'ignition', label: '현자 펭귄 ① 드로우 + 버리기',
      condition: (c) => hasFn('activateSagePenguin1') && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '현자 펭귄' && typeof isPenguinVillageRevealed === 'function' && isPenguinVillageRevealed() && canUse('현자 펭귄', 1),
    }, 'activateSagePenguin1');

    registerWrapper('sage_penguin_2', {
      cardId: '현자 펭귄', effectNum: 2, zone: 'field', kind: 'ignition', label: '현자 펭귄 ② 펭귄 카드 서치',
      condition: (c) => hasFn('activateSagePenguin2') && myTurn() && phaseDeploy() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '현자 펭귄' && hasDeckPenguinCard() && canUse('현자 펭귄', 2),
    }, 'activateSagePenguin2');

    registerWrapper('summoner_penguin_1', {
      cardId: '수문장 펭귄', effectNum: 1, zone: 'field', kind: 'ignition', label: '수문장 펭귄 ① ATK+1 + 서로 버리기',
      condition: (c) => hasFn('activateSummonerPenguin1') && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '수문장 펭귄' && typeof isPenguinVillageRevealed === 'function' && isPenguinVillageRevealed() && canUse('수문장 펭귄', 1),
    }, 'activateSummonerPenguin1');

    registerWrapper('penguin_hero_2', {
      cardId: '펭귄 용사', effectNum: 2, zone: 'field', kind: 'quick', label: '펭귄 용사 ② 패로 + 펭귄 마법 회수',
      condition: (c) => hasFn('activatePenguinHero2') && !myTurn() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '펭귄 용사' && canUse('펭귄 용사', 2) && hasGraveOrExile(x => x && typeof isPenguinCard === 'function' && isPenguinCard(x.id) && CARDS[x.id]?.cardType === 'magic'),
    }, 'activatePenguinHero2');

    registerWrapper('penguin_legend_2', {
      cardId: '펭귄의 전설', effectNum: 2, zone: 'field', kind: 'quick', label: '펭귄의 전설 ② 패로 + 펭귄 몬스터 소환',
      condition: (c) => hasFn('activatePenguinLegend2') && !myTurn() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '펭귄의 전설' && canUse('펭귄의 전설', 2) && hasGraveOrExile(x => x && typeof isPenguinMonster === 'function' && isPenguinMonster(x.id)),
    }, 'activatePenguinLegend2');

    registerWrapper('penguin_wizard_3', {
      cardId: '펭귄 마법사', effectNum: 3, zone: 'field', kind: 'trigger', label: '펭귄 마법사 ③ 제외 몬스터 소환',
      condition: (c) => hasFn('triggerPenguinWizard3') && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '펭귄 마법사' && canUse('펭귄 마법사', 3, 2) && [...(G.myExile || []), ...(G.opExile || [])].some(x => x && CARDS[x.id]?.cardType === 'monster'),
    }, 'triggerPenguinWizard3');

    // ─────────────────────────────
    // 묘지 발동 효과
    // ─────────────────────────────
    registerWrapper('penguin_charge_2_grave', {
      cardId: '펭귄!돌격!', effectNum: 2, zone: 'grave', kind: 'quick', label: '펭귄!돌격! ② 묘지 제외 → 패에서 소환',
      condition: () => hasFn('activatePenguinCharge2') && hasGrave('펭귄!돌격!') && hasHandPenguinMonster(),
    }, 'activatePenguinCharge2');

    registerWrapper('penguin_glory_2_grave', {
      cardId: '펭귄의 영광', effectNum: 2, zone: 'grave', kind: 'ignition', label: '펭귄의 영광 ② 묘지 제외 → 드로우',
      condition: () => hasFn('activatePenguinGlory2') && myTurn() && phaseDeploy() && (hasGrave('펭귄의 영광') || hasGrave('펭귄이여 영원하라')),
    }, 'activatePenguinGlory2');

    registerWrapper('penguin_forever_2_grave', {
      cardId: '펭귄이여 영원하라', effectNum: 2, zone: 'grave', kind: 'quick', label: '펭귄이여 영원하라 ② 묘지 제외 → 패에서 소환',
      condition: () => hasFn('activatePenguinForever2') && !myTurn() && hasGrave('펭귄이여 영원하라') && hasHandPenguinMonster(),
    }, 'activatePenguinForever2');

    // ─────────────────────────────
    // 자동 유발 효과: onSummon/onSentToGrave/펭귄 마을 ② 이벤트에서 자동 큐 등록
    // ─────────────────────────────
    const canUseNow = (cardId, num, max) => (typeof canUseEffect !== 'function') || canUseEffect(cardId, num, max);
    const markNow = (cardId, num) => { if (typeof markEffectUsed === 'function') markEffectUsed(cardId, num); };

    ENGINE.registerEffect('kkoma_penguin_2_event', {
      cardId: '꼬마 펭귄', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'summon',
      label: '꼬마 펭귄 ② 덱에서 펭귄 몬스터 소환', maxPerTurn: 2, markOnActivate: false,
      condition: (c) => c.event?.cardId === '꼬마 펭귄' && canUseNow('꼬마 펭귄', 2, 2) && hasDeckPenguinMonster(),
      resolve: () => { markNow('꼬마 펭귄', 2); if (typeof resolveKkomaPenguin === 'function') resolveKkomaPenguin(); },
    });

    ENGINE.registerEffect('penguin_bubu_1_event', {
      cardId: '펭귄 부부', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon',
      label: '펭귄 부부 ① 덱 소환 유발 서치', maxPerTurn: 1, markOnActivate: false,
      condition: (c) => c.event?.cardId === '펭귄 부부' && c.event?.from === 'deck' && canUseNow('펭귄 부부', 1) && hasDeckPenguinCard(),
      resolve: () => { if (typeof resolvePenguinBubu1 === 'function') resolvePenguinBubu1(); },
    });

    ENGINE.registerEffect('penguin_hero_1_event', {
      cardId: '펭귄 용사', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon',
      label: '펭귄 용사 ① 서치 + 펭귄 소환', maxPerTurn: 1, markOnActivate: false,
      condition: (c) => c.event?.cardId === '펭귄 용사' && canUseNow('펭귄 용사', 1) && hasDeckPenguinCard(),
      resolve: () => { if (typeof resolvePenguinHero1 === 'function') resolvePenguinHero1(); },
    });

    ENGINE.registerEffect('penguin_legend_1_event', {
      cardId: '펭귄의 전설', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon',
      label: '펭귄의 전설 ① 꼬마 펭귄 부활', maxPerTurn: 1, markOnActivate: false,
      condition: (c) => c.event?.cardId === '펭귄의 전설' && canUseNow('펭귄의 전설', 1) && (G.myGrave || []).some(x => x.id === '꼬마 펭귄'),
      resolve: () => { if (typeof resolvePenguinLegend1 === 'function') resolvePenguinLegend1(); },
    });

    ENGINE.registerEffect('penguin_wizard_2_event', {
      cardId: '펭귄 마법사', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'summon',
      label: '펭귄 마법사 ② 버린 수만큼 상대 몬스터 제외', maxPerTurn: 2, markOnActivate: false,
      condition: (c) => c.event?.cardId === '펭귄 마법사' && canUseNow('펭귄 마법사', 2, 2) && (G.opField || []).length > 0 && (G.myHand || []).length > 0,
      resolve: () => { if (typeof resolvePenguinWizard2 === 'function') resolvePenguinWizard2(); },
    });

    ENGINE.registerEffect('penguin_hero_3_event', {
      cardId: '펭귄 용사', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'sentToGrave',
      label: '펭귄 용사 ③ 묘지에서 소환 + 전체 강화', maxPerTurn: 1, markOnActivate: false,
      condition: (c) => c.event?.cardId === '펭귄 용사' && canUseNow('펭귄 용사', 3) && (G.myGrave || []).some(x => x.id === '펭귄 용사'),
      resolve: () => { if (typeof resolvePenguinHero3 === 'function') resolvePenguinHero3(); },
    });

    ENGINE.registerEffect('summoner_penguin_2_event', {
      cardId: '수문장 펭귄', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'penguinVillageSentToGrave',
      label: '수문장 펭귄 ② 상대 몬스터 묘지로', maxPerTurn: 1, markOnActivate: false, optional: false,
      condition: (c) => canUseNow('수문장 펭귄', 2) && (G.opField || []).length > 0 && (c.event?.cardId === '수문장 펭귄' || (G.myField || []).some(x => x.id === '수문장 펭귄')),
      resolve: () => { markNow('수문장 펭귄', 2); if (typeof resolveSummonerPenguin2 === 'function') resolveSummonerPenguin2(); },
    });

    ENGINE.registerEffect('penguin_wizard_3_event', {
      cardId: '펭귄 마법사', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'penguinVillageSentToGrave',
      label: '펭귄 마법사 ③ 제외 몬스터 소환', maxPerTurn: 2, markOnActivate: false,
      condition: (c) => canUseNow('펭귄 마법사', 3, 2) && (c.event?.cardId === '펭귄 마법사' || (G.myField || []).some(x => x.id === '펭귄 마법사')) && [...(G.myExile || []), ...(G.opExile || [])].some(x => x && CARDS[x.id]?.cardType === 'monster'),
      resolve: () => { markNow('펭귄 마법사', 3); if (typeof resolvePenguinWizard3 === 'function') resolvePenguinWizard3(); },
    });

    ENGINE.registerEffect('penguin_strike_2_event', {
      cardId: '펭귄의 일격', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'penguinVillageSentToGrave',
      label: '펭귄의 일격 ② 묘지에서 패로 회수', maxPerTurn: 1, markOnActivate: false,
      condition: () => canUseNow('펭귄의 일격', 2) && (G.myGrave || []).some(x => x.id === '펭귄의 일격'),
      resolve: () => { markNow('펭귄의 일격', 2); if (typeof resolvePenguinStrike2 === 'function') resolvePenguinStrike2(); },
    });



    // ─────────────────────────────
    // 서커스메어 테마: 등록형 수동 효과 + 자동 유발 효과
    // 기존 circusmare.js의 실제 resolve 함수는 재사용하되, 발동 라우팅은 EffectEngine으로 모은다.
    // ─────────────────────────────
    const isCircus = (id) => {
      if (!id) return false;
      const card = CARDS[id] || {};
      return card.theme === '서커스메어' || id === '악몽의 서커스장' || id === '악몽 융합' || id === '광란의 서커스';
    };
    const isCircusMon = (id) => {
      if (typeof isCircusmareMonster === 'function') return isCircusmareMonster(id);
      return !!(id && CARDS[id]?.theme === '서커스메어' && CARDS[id]?.cardType === 'monster');
    };
    const isCircusCard = (id) => {
      if (typeof isCircusmareCard === 'function') return isCircusmareCard(id);
      return isCircus(id);
    };
    const cmCanUse = (cardId, num, max) => (typeof canUseEffect !== 'function') || canUseEffect(cardId, num, max);
    const cmDeckHas = (pred) => G && (G.myDeck || []).some(c => c && pred(c));
    const cmGraveHas = (pred) => G && (G.myGrave || []).some(c => c && pred(c));
    const cmExileHas = (pred) => G && (G.myExile || []).some(c => c && pred(c));
    const cmFieldHas = (pred) => G && (G.myField || []).some(c => c && pred(c));
    const cmHandHas = (pred) => G && (G.myHand || []).some(c => c && pred(c));
    const cmKeyHas = (id) => G && (G.myKeyDeck || []).some(c => c && (!id || c.id === id));
    const cmAnyKeySummonable = () => G && (G.myKeyDeck || []).some(c => c && !['서커스메어 코인 제스터','서커스메어 마스크 제스터'].includes(c.id));
    const cmInDeploy = () => typeof currentPhase !== 'undefined' && currentPhase === 'deploy';
    const cmMyTurn = () => typeof isMyTurn !== 'undefined' && !!isMyTurn;
    const cmOpponentEffectOnChain = () => !!(typeof activeChainState !== 'undefined' && activeChainState && activeChainState.active && (activeChainState.links || []).some(l => l.by !== myRole));
    const cmGraveExileCount = () => (G?.myGrave || []).filter(c => isCircusCard(c.id)).length + (G?.myExile || []).filter(c => isCircusCard(c.id)).length;

    function registerCmWrapper(id, def, fnName) {
      ENGINE.registerEffect(id, Object.assign({
        activate: (c) => {
          const fn = window[fnName];
          if (typeof fn !== 'function') {
            safeNotify(`${def.label || id}: 실행 함수 ${fnName}을 찾을 수 없습니다.`);
            return false;
          }
          if (def.zone === 'hand') return fn(c.handIdx, def.effectNum);
          if (def.zone === 'field') return fn(c.fieldIdx, def.effectNum);
          if (def.zone === 'grave') return fn(def.cardId, def.effectNum);
          return fn(c.event?.from);
        },
      }, def));
    }

    // 손패/묘지 발동 카드
    registerCmWrapper('cm_fusion_1', {
      cardId: '서커스메어 퓨전', effectNum: 1, zone: 'hand', kind: 'quick', label: '서커스메어 퓨전 ① 키카드 소환', maxPerTurn: 2,
      condition: (c) => hasFn('activateCmFusion1') && cmInDeploy() && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '서커스메어 퓨전' && cmAnyKeySummonable() && (cmHandHas(x => isCircusMon(x.id)) || cmFieldHas(x => isCircusMon(x.id))) && cmCanUse('서커스메어 퓨전', 1, 2),
    }, 'activateCmFusion1');

    registerCmWrapper('cm_fusion_2_grave', {
      cardId: '서커스메어 퓨전', effectNum: 2, zone: 'grave', kind: 'ignition', label: '서커스메어 퓨전 ② 묘지 제외 → 패 회수', maxPerTurn: 2,
      condition: () => hasFn('activateCmFusion2FromGrave') && cmGraveHas(x => x.id === '서커스메어 퓨전') && (G.myGrave || []).filter(x => isCircusMon(x.id)).length >= 3 && cmCanUse('서커스메어 퓨전', 2, 2),
    }, 'activateCmFusion2FromGrave');

    registerCmWrapper('cm_med_parade_1', {
      cardId: '서커스메어 메드 퍼레이드', effectNum: 1, zone: 'hand', kind: 'ignition', label: '메드 퍼레이드 ① 메드 키메라 소환', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmMedParade1') && cmMyTurn() && cmInDeploy() && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '서커스메어 메드 퍼레이드' && cmKeyHas('서커스메어 메드 키메라') && cmCanUse('서커스메어 메드 퍼레이드', 1),
    }, 'activateCmMedParade1');

    registerCmWrapper('cm_nightmare_fusion_1', {
      cardId: '악몽 융합', effectNum: 1, zone: 'hand', kind: 'ignition', label: '악몽 융합 ① 덱 코스트 → 키카드 소환', maxPerTurn: 2,
      condition: (c) => hasFn('activateCmNightmareFusion1') && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '악몽 융합' && cmAnyKeySummonable() && cmDeckHas(x => isCircusCard(x.id)) && ((window._cmNightmareFusionCount || 0) < 2),
    }, 'activateCmNightmareFusion1');

    registerCmWrapper('cm_wild_circus_1', {
      cardId: '광란의 서커스', effectNum: 1, zone: 'hand', kind: 'quick', label: '광란의 서커스 ① 묘지/제외→덱 + 키카드 소환', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmWildCircus1') && !cmMyTurn() && cmInDeploy() && c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '광란의 서커스' && cmAnyKeySummonable() && [...(G.myGrave || []), ...(G.myExile || [])].some(x => isCircusCard(x.id)) && cmCanUse('광란의 서커스', 1),
    }, 'activateCmWildCircus1');

    registerCmWrapper('cm_wild_circus_2_grave', {
      cardId: '광란의 서커스', effectNum: 2, zone: 'grave', kind: 'ignition', label: '광란의 서커스 ② 묘지 제외 → 드로우', maxPerTurn: 1,
      condition: () => hasFn('activateCmWildCircus2FromGrave') && cmGraveHas(x => x.id === '광란의 서커스') && cmCanUse('광란의 서커스', 2),
    }, 'activateCmWildCircus2FromGrave');

    // 필드 발동 몬스터/필드 카드
    registerCmWrapper('cm_med_wolf_2', {
      cardId: '서커스메어 메드 울프', effectNum: 2, zone: 'field', kind: 'ignition', label: '메드 울프 ② 서커스메어 ATK +3', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmMedWolf2') && cmMyTurn() && cmInDeploy() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 메드 울프' && cmFieldHas(x => x.id !== '서커스메어 메드 울프' && isCircusMon(x.id)) && cmCanUse('서커스메어 메드 울프', 2),
    }, 'activateCmMedWolf2');

    registerCmWrapper('cm_med_bear_2', {
      cardId: '서커스메어 메드 베어', effectNum: 2, zone: 'field', kind: 'ignition', label: '메드 베어 ② 덱에서 서커스메어 소환', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmMedBear2') && cmMyTurn() && cmInDeploy() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 메드 베어' && cmDeckHas(x => isCircusMon(x.id)) && cmCanUse('서커스메어 메드 베어', 2),
    }, 'activateCmMedBear2');

    registerCmWrapper('cm_med_eagle_2', {
      cardId: '서커스메어 메드 이글', effectNum: 2, zone: 'field', kind: 'quick', label: '메드 이글 ② 묘지 서커스메어 최대 2장 소환', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmMedEagle2') && cmInDeploy() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 메드 이글' && cmGraveHas(x => isCircusMon(x.id)) && cmCanUse('서커스메어 메드 이글', 2),
    }, 'activateCmMedEagle2');

    registerCmWrapper('cm_crown_dragon_1', {
      cardId: '서커스메어 크라운 드래곤', effectNum: 1, zone: 'field', kind: 'ignition', label: '크라운 드래곤 ① 코인 토스', maxPerTurn: 2,
      condition: (c) => hasFn('activateCmCrownDragon1') && cmMyTurn() && cmInDeploy() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 크라운 드래곤' && cmCanUse('서커스메어 크라운 드래곤', 1, 2),
    }, 'activateCmCrownDragon1');

    registerCmWrapper('cm_crown_dragon_2', {
      cardId: '서커스메어 크라운 드래곤', effectNum: 2, zone: 'field', kind: 'quick', label: '크라운 드래곤 ② 상대 효과 변형', maxPerTurn: 2,
      condition: () => hasFn('activateCmCrownDragon2') && cmOpponentEffectOnChain() && cmFieldHas(x => x.id === '서커스메어 크라운 드래곤') && cmCanUse('서커스메어 크라운 드래곤', 2, 2),
    }, 'activateCmCrownDragon2');

    registerCmWrapper('cm_med_chimera_2', {
      cardId: '서커스메어 메드 키메라', effectNum: 2, zone: 'field', kind: 'quick', label: '메드 키메라 ② 대상 원래 ATK 흡수', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmMedChimera2') && cmInDeploy() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 메드 키메라' && cmFieldHas(x => x.id !== '서커스메어 메드 키메라' && isCircusMon(x.id)) && cmCanUse('서커스메어 메드 키메라', 2),
    }, 'activateCmMedChimera2');

    registerCmWrapper('cm_coin_jester_2', {
      cardId: '서커스메어 코인 제스터', effectNum: 2, zone: 'field', kind: 'quick', label: '코인 제스터 ② 상대 효과 락', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmCoinJester2') && cmInDeploy() && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 코인 제스터' && !G._cmCoinJesterLock && cmCanUse('서커스메어 코인 제스터', 2),
    }, 'activateCmCoinJester2');

    registerCmWrapper('cm_mask_jester_2', {
      cardId: '서커스메어 마스크 제스터', effectNum: 2, zone: 'field', kind: 'quick', label: '마스크 제스터 ② 몬스터명 변경 + 무효', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmMaskJester2') && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 마스크 제스터' && (G.opField || []).length > 0 && cmCanUse('서커스메어 마스크 제스터', 2),
    }, 'activateCmMaskJester2');

    registerCmWrapper('cm_puppet_master_1', {
      cardId: '서커스메어 퍼핏 마스터', effectNum: 1, zone: 'field', kind: 'quick', label: '퍼핏 마스터 ① 필드 몬스터 묘지 → 단계 효과', maxPerTurn: 1,
      condition: (c) => hasFn('activateCmPuppetMaster1') && c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === '서커스메어 퍼핏 마스터' && (G.myField || []).length > 0 && cmCanUse('서커스메어 퍼핏 마스터', 1),
    }, 'activateCmPuppetMaster1');

    registerCmWrapper('cm_field_2', {
      cardId: '악몽의 서커스장', effectNum: 2, zone: 'field', kind: 'ignition', label: '악몽의 서커스장 ② 서커스메어 서치', maxPerTurn: 1,
      condition: () => hasFn('activateCmField2') && cmMyTurn() && cmInDeploy() && cmFieldHas(x => x.id === '악몽의 서커스장') && cmDeckHas(x => isCircusCard(x.id)) && cmCanUse('악몽의 서커스장', 2),
    }, 'activateCmField2');

    registerCmWrapper('cm_field_3', {
      cardId: '악몽의 서커스장', effectNum: 3, zone: 'field', kind: 'ignition', label: '악몽의 서커스장 ③ 3장 덤핑 + 드로우', maxPerTurn: 1,
      condition: () => hasFn('activateCmField3') && cmMyTurn() && cmInDeploy() && cmFieldHas(x => x.id === '악몽의 서커스장') && cmCanUse('악몽의 서커스장', 3),
    }, 'activateCmField3');

    registerCmWrapper('cm_field_4', {
      cardId: '악몽의 서커스장', effectNum: 4, zone: 'field', kind: 'quick', label: '악몽의 서커스장 ④ 제외 코스트 → 키카드 소환', maxPerTurn: 1,
      condition: () => hasFn('activateCmField4') && cmInDeploy() && cmFieldHas(x => x.id === '악몽의 서커스장') && cmAnyKeySummonable() && (cmFieldHas(x => isCircusMon(x.id)) || cmGraveHas(x => isCircusMon(x.id))) && cmCanUse('악몽의 서커스장', 4),
    }, 'activateCmField4');

    // 상대 효과 체인으로 키 카드 덱에서 튀어나오는 효과
    registerCmWrapper('cm_coin_jester_1_chain', {
      cardId: '서커스메어 코인 제스터', effectNum: 1, zone: 'any', kind: 'quick', label: '코인 제스터 ① 상대 효과에 체인: 소환+코인', maxPerTurn: 1,
      condition: () => hasFn('activateCmCoinJester') && cmOpponentEffectOnChain() && cmKeyHas('서커스메어 코인 제스터') && cmCanUse('서커스메어 코인 제스터', 1),
    }, 'activateCmCoinJester');

    registerCmWrapper('cm_mask_jester_1_chain', {
      cardId: '서커스메어 마스크 제스터', effectNum: 1, zone: 'any', kind: 'quick', label: '마스크 제스터 ① 상대 효과에 체인: 소환+코인', maxPerTurn: 1,
      condition: () => hasFn('activateCmMaskJester') && cmOpponentEffectOnChain() && cmKeyHas('서커스메어 마스크 제스터') && cmCanUse('서커스메어 마스크 제스터', 1),
    }, 'activateCmMaskJester');

    // 자동 유발: GameEvents(summon/sentToGrave) → 기존 trigger 함수 호출
    registerCmWrapper('cm_med_wolf_1_event', {
      cardId: '서커스메어 메드 울프', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '메드 울프 ① 메드 베어 서치', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 메드 울프' && cmCanUse('서커스메어 메드 울프', 1) && cmDeckHas(x => x.id === '서커스메어 메드 베어'),
    }, 'triggerCmMedWolf');

    registerCmWrapper('cm_med_bear_1_event', {
      cardId: '서커스메어 메드 베어', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '메드 베어 ① 메드 이글 서치', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 메드 베어' && cmCanUse('서커스메어 메드 베어', 1) && cmDeckHas(x => x.id === '서커스메어 메드 이글'),
    }, 'triggerCmMedBear');

    registerCmWrapper('cm_med_eagle_1_event', {
      cardId: '서커스메어 메드 이글', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '메드 이글 ① 메드 씰 서치', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 메드 이글' && cmCanUse('서커스메어 메드 이글', 1) && cmDeckHas(x => x.id === '서커스메어 메드 씰'),
    }, 'triggerCmMedEagle');

    registerCmWrapper('cm_med_seal_1_event', {
      cardId: '서커스메어 메드 씰', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '메드 씰 ① 메드 울프 서치', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 메드 씰' && cmCanUse('서커스메어 메드 씰', 1) && cmDeckHas(x => x.id === '서커스메어 메드 울프'),
    }, 'triggerCmMedSeal');

    registerCmWrapper('cm_spring_jester_1_event', {
      cardId: '서커스메어 스프링 제스터', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '스프링 제스터 ① 상대 필드 전부 묘지', markOnActivate: false, optional: false,
      condition: (c) => c.event?.cardId === '서커스메어 스프링 제스터',
    }, 'triggerCmSpringJester');

    registerCmWrapper('cm_med_chimera_1_event', {
      cardId: '서커스메어 메드 키메라', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '메드 키메라 ① 서커스메어 보호 ON', markOnActivate: false, chain: false,
      condition: (c) => c.event?.cardId === '서커스메어 메드 키메라',
    }, 'triggerCmMedChimera');

    registerCmWrapper('cm_crown_dragon_3_event', {
      cardId: '서커스메어 크라운 드래곤', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '크라운 드래곤 ③ 서커스메어 가능한 만큼 소환', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 크라운 드래곤' && cmCanUse('서커스메어 크라운 드래곤', 3, 2),
    }, 'triggerCmCrownDragon3');

    registerCmWrapper('cm_spring_jester_3_event', {
      cardId: '서커스메어 스프링 제스터', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '스프링 제스터 ③ 제외 후 크라운 드래곤 소환', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 스프링 제스터' && cmCanUse('서커스메어 스프링 제스터', 3),
    }, 'triggerCmSpringJester3');

    registerCmWrapper('cm_med_chimera_3_event', {
      cardId: '서커스메어 메드 키메라', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '메드 키메라 ③ 메드 4종 소환', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 메드 키메라' && cmCanUse('서커스메어 메드 키메라', 3),
    }, 'triggerCmMedChimera3');

    registerCmWrapper('cm_puppet_master_2_event', {
      cardId: '서커스메어 퍼핏 마스터', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '퍼핏 마스터 ② 묘지 서커스메어 전부 소환', markOnActivate: false,
      condition: (c) => c.event?.cardId === '서커스메어 퍼핏 마스터' && cmCanUse('서커스메어 퍼핏 마스터', 2) && cmGraveHas(x => x.id !== '서커스메어 퍼핏 마스터' && isCircusMon(x.id)),
    }, 'triggerCmPuppetMaster2');



    // ─────────────────────────────
    // 지배자/지배룡 테마 등록
    // 카드 텍스트 파싱 대신 기존 jibaeja.js 실행 함수를 EffectEngine으로 연결한다.
    // discard / non-hand grave / 4종 제외 조건은 jibaeja.js의 공통 유틸을 재사용한다.
    // ─────────────────────────────
    const jbHasFn = (name) => typeof window[name] === 'function';
    const jbMyTurn = () => (typeof isMyTurn !== 'undefined') && !!isMyTurn;
    const jbPhase = (p) => (typeof currentPhase !== 'undefined') && currentPhase === p;
    const jbCanUse = (cardId, num, max) => (typeof canUseEffect !== 'function') || canUseEffect(cardId, num, max);
    const jbCardAtHand = (c, id) => c.handIdx >= 0 && G.myHand[c.handIdx]?.id === id;
    const jbCardAtField = (c, id) => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === id;
    const jbHasKeyMonster = () => (typeof hasKeyCardMonsterOnField === 'function') ? hasKeyCardMonsterOnField() : jbMyTurn();
    const jbDeckHas = (pred) => typeof findAllInDeck === 'function' && findAllInDeck(pred).length > 0;
    const jbGraveHas = (id) => G && Array.isArray(G.myGrave) && G.myGrave.some(c => c && c.id === id);
    const jbExileHasAny = () => G && Array.isArray(G.myExile) && G.myExile.length > 0;
    const jbHasHandDiscardCost = () => G && Array.isArray(G.myHand) && G.myHand.some(c => c && (typeof isJibaeCard === 'function' ? isJibaeCard(c.id) : (c.id || '').includes('지배')));
    const jbKeySummonableRyong = () => typeof canSummonSaWonsoJibaeryong === 'function' && canSummonSaWonsoJibaeryong();
    const jbKeySummonableJa = () => typeof canSummonSaWonsoJibaeja === 'function' && canSummonSaWonsoJibaeja();

    function registerJbWrapper(id, def, fnName, callMode) {
      ENGINE.registerEffect(id, Object.assign({
        activate: (c) => {
          const fn = window[fnName];
          if (typeof fn !== 'function') {
            safeNotify(`${def.label || id}: 실행 함수 ${fnName}을 찾을 수 없습니다.`);
            return false;
          }
          if (callMode === 'cardId') return fn(def.cardId);
          if (callMode === 'fieldCardId') return fn(c.fieldIdx, def.cardId);
          if (callMode === 'fieldIndex') return fn(c.fieldIdx);
          if (callMode === 'handIndex') return fn(c.handIdx);
          return fn(c.handIdx, def.effectNum);
        },
      }, def));
    }

    // 4원소 지배자 ①: 패에서 버리고 발동. 키카드 몬스터가 있으면 상대 턴에도 가능.
    registerJbWrapper('jibae_shui_1', {
      cardId: '수원소의 지배자', effectNum: 1, zone: 'hand', kind: 'quick', label: '수원소의 지배자 ① 버리고 지배자 서치+드로우', markOnActivate: false,
      condition: (c) => jbHasFn('activateJibaejaShui1') && jbCardAtHand(c, '수원소의 지배자') && (jbMyTurn() || jbHasKeyMonster()) && jbCanUse('수원소의 지배자', 1) && jbDeckHas(x => typeof isJibaejaMonster === 'function' && isJibaejaMonster(x.id)),
    }, 'activateJibaejaShui1', 'handIndex');

    registerJbWrapper('jibae_hwa_1', {
      cardId: '화원소의 지배자', effectNum: 1, zone: 'hand', kind: 'quick', label: '화원소의 지배자 ① 버리고 지배자 소환+드로우', markOnActivate: false,
      condition: (c) => jbHasFn('activateJibaejaHwa1') && jbCardAtHand(c, '화원소의 지배자') && (jbMyTurn() || jbHasKeyMonster()) && jbCanUse('화원소의 지배자', 1) && jbDeckHas(x => typeof isJibaejaMonster === 'function' && isJibaejaMonster(x.id)),
    }, 'activateJibaejaHwa1', 'handIndex');

    registerJbWrapper('jibae_jeon_1', {
      cardId: '전원소의 지배자', effectNum: 1, zone: 'hand', kind: 'quick', label: '전원소의 지배자 ① 버리고 지배자 소환+드로우', markOnActivate: false,
      condition: (c) => jbHasFn('activateJibaejaJeon1') && jbCardAtHand(c, '전원소의 지배자') && (jbMyTurn() || jbHasKeyMonster()) && jbCanUse('전원소의 지배자', 1),
    }, 'activateJibaejaJeon1', 'handIndex');

    registerJbWrapper('jibae_fung_1', {
      cardId: '풍원소의 지배자', effectNum: 1, zone: 'hand', kind: 'quick', label: '풍원소의 지배자 ① 버리고 상대 묘지 제외+드로우', markOnActivate: false,
      condition: (c) => jbHasFn('activateJibaejaFung1') && jbCardAtHand(c, '풍원소의 지배자') && (jbMyTurn() || jbHasKeyMonster()) && jbCanUse('풍원소의 지배자', 1) && G.opGrave && G.opGrave.length > 0,
    }, 'activateJibaejaFung1', 'handIndex');

    // 지배자 ②/③: 필드 기동/유발형 수동 발동
    registerJbWrapper('jibae_shui_2', {
      cardId: '수원소의 지배자', effectNum: 2, zone: 'field', kind: 'ignition', label: '수원소의 지배자 ② 덱에서 지배자 소환', markOnActivate: false,
      condition: (c) => jbHasFn('activateJibaejaShui2') && jbCardAtField(c, '수원소의 지배자') && jbMyTurn() && jbPhase('deploy') && jbCanUse('수원소의 지배자', 2),
    }, 'activateJibaejaShui2', 'fieldIndex');

    registerJbWrapper('jibae_hwa_2', {
      cardId: '화원소의 지배자', effectNum: 2, zone: 'field', kind: 'ignition', label: '화원소의 지배자 ② 덱에서 지배자 서치', markOnActivate: false,
      condition: (c) => jbHasFn('activateJibaejaHwa2') && jbCardAtField(c, '화원소의 지배자') && jbMyTurn() && jbPhase('deploy') && jbCanUse('화원소의 지배자', 2),
    }, 'activateJibaejaHwa2', 'fieldIndex');

    ['수원소의 지배자', '화원소의 지배자', '전원소의 지배자', '풍원소의 지배자'].forEach(cardId => {
      const prefix = cardId.replace('원소의 지배자', '');
      registerJbWrapper(`jibae_${prefix}_3`, {
        cardId, effectNum: 3, zone: 'field', kind: 'ignition', label: `${cardId} ③ 덱에서 지배룡 소환+패 버리기`, markOnActivate: false,
        condition: (c) => jbHasFn('activateJibaeja3') && jbCardAtField(c, cardId) && jbMyTurn() && jbPhase('deploy') && jbCanUse(cardId, 3) && jbDeckHas(x => typeof isJibaeryongMonster === 'function' && isJibaeryongMonster(x.id)),
      }, 'activateJibaeja3', 'fieldCardId');
    });

    // 전원소의 지배자 ②: 소환 시 자동 유발
    registerJbWrapper('jibae_jeon_2_event', {
      cardId: '전원소의 지배자', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'summon', label: '전원소의 지배자 ② 지배자/지배룡 서치+드로우', markOnActivate: false,
      condition: (c) => jbHasFn('triggerJibaejaJeon2') && c.event?.cardId === '전원소의 지배자' && jbCanUse('전원소의 지배자', 2),
    }, 'triggerJibaejaJeon2');

    // 풍원소의 지배자 ②: 묘지 퀵 효과
    registerJbWrapper('jibae_fung_2_grave', {
      cardId: '풍원소의 지배자', effectNum: 2, zone: 'grave', kind: 'quick', label: '풍원소의 지배자 ② 덱 지배룡 묘지→자기 소환+드로우', markOnActivate: false,
      condition: () => jbHasFn('activateJibaejaFung2') && jbGraveHas('풍원소의 지배자') && jbCanUse('풍원소의 지배자', 2) && jbDeckHas(x => typeof isJibaeryongMonster === 'function' && isJibaeryongMonster(x.id)),
    }, 'activateJibaejaFung2');

    // 지배룡 ①: 패 이외에서 묘지로 보내졌을 때. jibaeja.js가 custom event를 emit하면 여기서 기존 처리 함수로 연결한다.
    ['수원소의 지배룡', '화원소의 지배룡', '전원소의 지배룡', '풍원소의 지배룡'].forEach(cardId => {
      registerJbWrapper(`jibaeryong_${cardId[0]}_1_nonhand_grave`, {
        cardId, effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'jibaeNonHandGrave', label: `${cardId} ① 패 이외→묘지 유발`, markOnActivate: false,
        condition: (c) => jbHasFn('onSentToGraveFromNonHand') && c.event?.cardId === cardId && jbCanUse(cardId + '_grave1'),
      }, 'onSentToGraveFromNonHand', 'cardId');
    });

    // 지배룡 ②: 버려졌을 경우 1드로우. 모든 패 버림은 jibaeHandDiscard 이벤트로 라우팅한다.
    ['수원소의 지배룡', '화원소의 지배룡', '전원소의 지배룡', '풍원소의 지배룡'].forEach(cardId => {
      ENGINE.registerEffect(`jibaeryong_${cardId[0]}_2_discard`, {
        cardId, effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'jibaeHandDiscard', label: `${cardId} ② 버려졌을 경우 1드로우`, chain: false, markOnActivate: false,
        condition: (c) => jbHasFn('resolveJibaeryongDiscard2') && c.event?.cardId === cardId && (typeof canUseEffect !== 'function' || canUseEffect(cardId + '_discard2')),
        resolve: (c) => window.resolveJibaeryongDiscard2(c.event && c.event.cardId),
      });
    });

    // 지배의 사슬 ①: 자신의 패가 버려졌을 경우, 그 턴에 버린 매수까지 드로우.
    ENGINE.registerEffect('jibae_chain_1_discard', {
      cardId: '지배의 사슬', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'jibaeHandDiscard', label: '지배의 사슬 ① 패 버림 반응 드로우', chain: false, markOnActivate: false,
      condition: (c) => jbHasFn('resolveJibaeSasl1') && G.myHand.some(x => x && x.id === '지배의 사슬') && jbCanUse('지배의 사슬', 1) && Number(c.event?.turnDiscardCount || 0) > 0,
      resolve: (c) => window.resolveJibaeSasl1(c.event),
    });

    // 지배룡 ③: 필드에서 묘지로 보내고, 패의 지배자/지배룡 카드 버림+드로우
    ['수원소의 지배룡', '화원소의 지배룡', '전원소의 지배룡', '풍원소의 지배룡'].forEach(cardId => {
      registerJbWrapper(`jibaeryong_${cardId[0]}_3`, {
        cardId, effectNum: 3, zone: 'field', kind: 'ignition', label: `${cardId} ③ 필드→묘지, 지배 카드 버리고 드로우`, markOnActivate: false,
        condition: (c) => jbHasFn('activateJibaeryong3') && jbCardAtField(c, cardId) && jbMyTurn() && jbCanUse(cardId, 3) && jbHasHandDiscardCost(),
      }, 'activateJibaeryong3', 'fieldCardId');
    });

    // 사원소 키 카드: 소환 조건 + 필드 효과
    registerJbWrapper('sawonso_jibaeryong_summon_hand', {
      cardId: '사원소의 지배룡', effectNum: 0, zone: 'hand', kind: 'direct', label: '사원소의 지배룡 소환 조건 실행', chain: false, markOnActivate: false,
      condition: (c) => jbHasFn('summonSaWonsoJibaeryong') && jbCardAtHand(c, '사원소의 지배룡') && jbKeySummonableRyong(),
    }, 'summonSaWonsoJibaeryong');
    registerJbWrapper('sawonso_jibaeryong_summon_grave', {
      cardId: '사원소의 지배룡', effectNum: 0, zone: 'grave', kind: 'direct', label: '사원소의 지배룡 묘지 소환 조건 실행', chain: false, markOnActivate: false,
      condition: () => jbHasFn('summonSaWonsoJibaeryong') && jbGraveHas('사원소의 지배룡') && jbKeySummonableRyong(),
    }, 'summonSaWonsoJibaeryong');
    registerJbWrapper('sawonso_jibaeryong_1', {
      cardId: '사원소의 지배룡', effectNum: 1, zone: 'field', kind: 'ignition', label: '사원소의 지배룡 ① 지배자 2장 서치+선택 버리기', markOnActivate: false,
      condition: (c) => jbHasFn('activateSaWonsoJibaeryong1') && jbCardAtField(c, '사원소의 지배룡') && jbMyTurn() && jbPhase('deploy') && jbCanUse('사원소의 지배룡', 1),
    }, 'activateSaWonsoJibaeryong1', 'fieldIndex');
    registerJbWrapper('sawonso_jibaeryong_2', {
      cardId: '사원소의 지배룡', effectNum: 2, zone: 'field', kind: 'quick', label: '사원소의 지배룡 ② 패 차이만큼 공격력 증가', markOnActivate: false,
      condition: (c) => jbHasFn('activateSaWonsoJibaeryong2') && jbCardAtField(c, '사원소의 지배룡') && jbPhase('attack') && G.myHand.length < G.opHand.length && jbCanUse('사원소의 지배룡', 2),
    }, 'activateSaWonsoJibaeryong2', 'fieldIndex');

    registerJbWrapper('sawonso_jibaeja_summon_hand', {
      cardId: '사원소의 지배자', effectNum: 0, zone: 'hand', kind: 'direct', label: '사원소의 지배자 소환 조건 실행', chain: false, markOnActivate: false,
      condition: (c) => jbHasFn('summonSaWonsoJibaeja') && jbCardAtHand(c, '사원소의 지배자') && jbKeySummonableJa(),
    }, 'summonSaWonsoJibaeja');
    registerJbWrapper('sawonso_jibaeja_summon_grave', {
      cardId: '사원소의 지배자', effectNum: 0, zone: 'grave', kind: 'direct', label: '사원소의 지배자 묘지 소환 조건 실행', chain: false, markOnActivate: false,
      condition: () => jbHasFn('summonSaWonsoJibaeja') && jbGraveHas('사원소의 지배자') && jbKeySummonableJa(),
    }, 'summonSaWonsoJibaeja');
    registerJbWrapper('sawonso_jibaeja_1', {
      cardId: '사원소의 지배자', effectNum: 1, zone: 'field', kind: 'ignition', label: '사원소의 지배자 ① 지배룡 2장 서치+선택 버리기', markOnActivate: false,
      condition: (c) => jbHasFn('activateSaWonsoJibaeja1') && jbCardAtField(c, '사원소의 지배자') && jbMyTurn() && jbPhase('deploy') && jbCanUse('사원소의 지배자', 1),
    }, 'activateSaWonsoJibaeja1', 'fieldIndex');
    registerJbWrapper('sawonso_jibaeja_2', {
      cardId: '사원소의 지배자', effectNum: 2, zone: 'field', kind: 'quick', label: '사원소의 지배자 ② 엔드까지 제외+묘지/제외 소환', markOnActivate: false,
      condition: (c) => jbHasFn('activateSaWonsoJibaeja2') && jbCardAtField(c, '사원소의 지배자') && jbCanUse('사원소의 지배자', 2),
    }, 'activateSaWonsoJibaeja2', 'fieldIndex');

    // 사원소의 기적 / 지배의 사슬 / 지배룡과 지배자
    registerJbWrapper('sawonso_miracle_1', {
      cardId: '사원소의 기적', effectNum: 1, zone: 'hand', kind: 'ignition', label: '사원소의 기적 ① 4종 묘지로+추가 버림 규칙', markOnActivate: false,
      condition: (c) => jbHasFn('activateSaWonsoMirak') && jbCardAtHand(c, '사원소의 기적'),
    }, 'activateSaWonsoMirak', 'handIndex');

    registerJbWrapper('jibae_chain_2_grave', {
      cardId: '지배의 사슬', effectNum: 2, zone: 'grave', kind: 'quick', label: '지배의 사슬 ② 제외 카드 최대 8장 덱으로+드로우', markOnActivate: false,
      condition: () => jbHasFn('activateJibaeSasl2') && !jbMyTurn() && jbGraveHas('지배의 사슬') && jbCanUse('지배의 사슬', 2) && jbExileHasAny(),
    }, 'activateJibaeSasl2');

    registerJbWrapper('jibaeryong_and_jibaeja_1', {
      cardId: '지배룡과 지배자', effectNum: 1, zone: 'hand', kind: 'quick', label: '지배룡과 지배자 ① 패 수별 공격 단계 효과', markOnActivate: false,
      condition: (c) => jbHasFn('activateJibaeryongJibaeja1') && jbCardAtHand(c, '지배룡과 지배자') && jbPhase('attack') && jbCanUse('지배룡과 지배자', 1),
    }, 'activateJibaeryongJibaeja1', 'handIndex');
    registerJbWrapper('jibaeryong_and_jibaeja_2_grave', {
      cardId: '지배룡과 지배자', effectNum: 2, zone: 'grave', kind: 'quick', label: '지배룡과 지배자 ② 묘지 제외 후 1드로우', markOnActivate: false,
      condition: () => jbHasFn('activateJibaeryongJibaeja2') && jbGraveHas('지배룡과 지배자') && jbCanUse('지배룡과 지배자', 2),
    }, 'activateJibaeryongJibaeja2');


    // ─────────────────────────────
    // 엘리멘츠 테마 등록
    // 카드 텍스트 파싱 대신 Elements.js의 명시 함수로 연결한다.
    // ─────────────────────────────
    const elHasFn = (name) => window._elements && typeof window._elements[name] === 'function';
    const elFn = (name) => window._elements && window._elements[name];
    const elMyTurn = () => (typeof myTurn === 'function' ? myTurn() : !!window.isMyTurn);
    const elPhase = (p) => (typeof currentPhase !== 'undefined') && currentPhase === p;
    const elCanUse = (cardId, n, max = 1) => (typeof canUseEffect !== 'function') || canUseEffect(cardId, n, max);
    const elCardAtHand = (c, cardId) => c.handIdx >= 0 && G.myHand[c.handIdx]?.id === cardId;
    const elCardAtField = (c, cardId) => c.fieldIdx >= 0 && G.myField[c.fieldIdx]?.id === cardId;
    const elGraveHas = (cardId) => G.myGrave && G.myGrave.some(x => x && x.id === cardId);
    const elExileHas = (cardId) => G.myExile && G.myExile.some(x => x && x.id === cardId);
    const elHasDeckElement = () => typeof findAllInDeck === 'function' && findAllInDeck(c => CARDS[c.id]?.theme === '엘리멘츠').length > 0;
    const elHasDeckElementMonster = () => typeof findAllInDeck === 'function' && findAllInDeck(c => CARDS[c.id]?.theme === '엘리멘츠' && CARDS[c.id]?.cardType === 'monster').length > 0;
    const elHasUltimateCounters = (n) => G.myField && G.myField.reduce((sum, m) => sum + (m?.counters?.['궁극'] || 0), 0) >= n;
    const elHasBasicCounterCondition = (each) => {
      const types = ['화염', '물', '전기', '바람'];
      return types.every(t => (G.opField || []).reduce((sum, m) => sum + (m?.counters?.[t] || 0), 0) >= each);
    };
    function registerElWrapper(id, def, fnName, callMode = 'auto') {
      ENGINE.registerEffect(id, Object.assign({
        activate: (c) => {
          const fn = elFn(fnName);
          if (typeof fn !== 'function') { safeNotify(`${def.label || id}: 실행 함수 ${fnName}을 찾을 수 없습니다.`); return false; }
          if (callMode === 'handIndex' || (callMode === 'auto' && def.zone === 'hand')) return fn(c.handIdx);
          if (callMode === 'fieldIndex' || (callMode === 'auto' && def.zone === 'field')) return fn(c.fieldIdx);
          if (callMode === 'cardId') return fn(def.cardId);
          if (callMode === 'event') return fn(c.event);
          return fn(c);
        },
      }, def));
    }

    ['엘리멘츠의 불꽃정령', '엘리멘츠의 물정령', '엘리멘츠의 전기정령', '엘리멘츠의 바람정령'].forEach(cardId => {
      registerElWrapper(`elements_spirit_${cardId}_1`, {
        cardId, effectNum: 1, zone: 'hand', kind: 'direct', label: `${cardId} ① 자체 소환`, chain: false, markOnActivate: false,
        condition: (c) => elHasFn('activateSpiritSummon1') && elCardAtHand(c, cardId) && elMyTurn() && elPhase('deploy') && elCanUse(cardId, 1),
      }, 'activateSpiritSummon1', 'handIndex');
      registerElWrapper(`elements_spirit_${cardId}_2_summon`, {
        cardId, effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'summon', label: `${cardId} ② 소환 유발`, chain: false, markOnActivate: false,
        condition: (c) => elHasFn('triggerSpiritSummon2') && c.event?.cardId === cardId && elCanUse(cardId, 2),
      }, 'triggerSpiritSummon2', 'cardId');
    });

    registerElWrapper('elements_fire_spirit_3', {
      cardId: '엘리멘츠의 불꽃정령', effectNum: 3, zone: 'hand', kind: 'direct', label: '엘리멘츠의 불꽃정령 ③ 카운터 제거+서치', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('activateFireSpirit3') && elCardAtHand(c, '엘리멘츠의 불꽃정령') && elCanUse('엘리멘츠의 불꽃정령', 3),
    }, 'activateFireSpirit3', 'handIndex');
    registerElWrapper('elements_electric_spirit_3_hand', {
      cardId: '엘리멘츠의 전기정령', effectNum: 3, zone: 'hand', kind: 'direct', label: '엘리멘츠의 전기정령 ③ 패→묘지, 전체 전기 카운터', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('activateElectricSpirit3FromHand') && elCardAtHand(c, '엘리멘츠의 전기정령') && elCanUse('엘리멘츠의 전기정령', 3),
    }, 'activateElectricSpirit3FromHand', 'handIndex');
    registerElWrapper('elements_electric_spirit_3_field', {
      cardId: '엘리멘츠의 전기정령', effectNum: 3, zone: 'field', kind: 'direct', label: '엘리멘츠의 전기정령 ③ 필드→묘지, 전체 전기 카운터', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('activateElectricSpirit3FromField') && elCardAtField(c, '엘리멘츠의 전기정령') && elCanUse('엘리멘츠의 전기정령', 3),
    }, 'activateElectricSpirit3FromField', 'fieldIndex');
    registerElWrapper('elements_water_spirit_3_public', {
      cardId: '엘리멘츠의 물정령', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'addedToPublicHand', label: '엘리멘츠의 물정령 ③ 공개 패 유발', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerWaterPublicHand3') && c.event?.cardId === '엘리멘츠의 물정령' && elCanUse('엘리멘츠의 물정령', 3),
    }, 'triggerWaterPublicHand3', 'cardId');
    registerElWrapper('elements_wind_spirit_3_grave', {
      cardId: '엘리멘츠의 바람정령', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '엘리멘츠의 바람정령 ③ 묘지 유발', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerWindSentToGrave3') && c.event?.cardId === '엘리멘츠의 바람정령' && elCanUse('엘리멘츠의 바람정령', 3),
    }, 'triggerWindSentToGrave3', 'event');

    registerElWrapper('elements_forest_1', {
      cardId: '엘리멘츠 in rainbow forest', effectNum: 1, zone: 'hand', kind: 'direct', label: '엘리멘츠 in rainbow forest ① 발동+몬스터 서치', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('activateRainbowForest1') && elCardAtHand(c, '엘리멘츠 in rainbow forest') && elMyTurn() && elPhase('deploy') && elCanUse('엘리멘츠 in rainbow forest', 1),
    }, 'activateRainbowForest1', 'handIndex');
    registerElWrapper('elements_forest_3_grave', {
      cardId: '엘리멘츠 in rainbow forest', effectNum: 3, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '엘리멘츠 in rainbow forest ③ 묘지 유발 회수', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerRainbowForest3') && c.event?.cardId === '엘리멘츠 in rainbow forest' && elCanUse('엘리멘츠 in rainbow forest', 3),
    }, 'triggerRainbowForest3', 'event');

    registerElWrapper('elements_fairy_1', {
      cardId: '엘리멘츠 is fairy!!!', effectNum: 1, zone: 'hand', kind: 'ignition', label: '엘리멘츠 is fairy!!! ① 카운터 몬스터 묘지로', markOnActivate: false,
      condition: (c) => elHasFn('activateFairy1') && elCardAtHand(c, '엘리멘츠 is fairy!!!') && elCanUse('엘리멘츠 is fairy!!!', 1),
    }, 'activateFairy1', 'handIndex');
    registerElWrapper('elements_fairy_2_grave', {
      cardId: '엘리멘츠 is fairy!!!', effectNum: 2, zone: 'grave', kind: 'direct', label: '엘리멘츠 is fairy!!! ② 묘지 제외+4종 카운터', chain: false, markOnActivate: false,
      condition: () => elHasFn('activateFairy2Grave') && elGraveHas('엘리멘츠 is fairy!!!') && elMyTurn() && elPhase('deploy') && elCanUse('엘리멘츠 is fairy!!!', 2),
    }, 'activateFairy2Grave', 'none');

    registerElWrapper('elements_magic_1', {
      cardId: '엘리멘츠의 MAGIC', effectNum: 1, zone: 'hand', kind: 'ignition', label: '엘리멘츠의 MAGIC ① 덱 제외+덱 묘지', markOnActivate: false,
      condition: (c) => elHasFn('activateMagic1') && elCardAtHand(c, '엘리멘츠의 MAGIC') && elCanUse('엘리멘츠의 MAGIC', 1) && elHasDeckElement(),
    }, 'activateMagic1', 'handIndex');
    registerElWrapper('elements_magic_2_grave', {
      cardId: '엘리멘츠의 MAGIC', effectNum: 2, zone: 'grave', kind: 'direct', label: '엘리멘츠의 MAGIC ② 묘지 제외+제외 회수/소환', chain: false, markOnActivate: false,
      condition: () => elHasFn('activateMagic2Grave') && elGraveHas('엘리멘츠의 MAGIC') && elCanUse('엘리멘츠의 MAGIC', 2),
    }, 'activateMagic2Grave', 'none');

    registerElWrapper('elements_trap_2_grave', {
      cardId: '엘리멘츠의 TR∀P', effectNum: 2, zone: 'grave', kind: 'quick', label: '엘리멘츠의 TR∀P ② 묘지 제외+4종 카운터', markOnActivate: false,
      condition: () => elHasFn('activateTrap2Grave') && elGraveHas('엘리멘츠의 TR∀P') && !elMyTurn() && elCanUse('엘리멘츠의 TR∀P', 2),
    }, 'activateTrap2Grave', 'none');

    registerElWrapper('elements_shape_1', {
      cardId: '엘리멘츠의 ♤♡◇♧', effectNum: 1, zone: 'hand', kind: 'quick', label: '엘리멘츠의 ♤♡◇♧ ① 덱 소환+전체 카운터', markOnActivate: false,
      condition: (c) => elHasFn('activateShape1') && elCardAtHand(c, '엘리멘츠의 ♤♡◇♧') && elCanUse('엘리멘츠의 ♤♡◇♧', 1) && elHasDeckElementMonster(),
    }, 'activateShape1', 'handIndex');
    registerElWrapper('elements_shape_2_grave', {
      cardId: '엘리멘츠의 ♤♡◇♧', effectNum: 2, zone: 'grave', kind: 'direct', label: '엘리멘츠의 ♤♡◇♧ ② 묘지 제외+드로우+버림', chain: false, markOnActivate: false,
      condition: () => elHasFn('activateShape2Grave') && elGraveHas('엘리멘츠의 ♤♡◇♧') && elCanUse('엘리멘츠의 ♤♡◇♧', 2),
    }, 'activateShape2Grave', 'none');

    registerElWrapper('elements_ultimate_god_summon_hand', {
      cardId: '엘리멘츠의 궁극신', effectNum: 0, zone: 'hand', kind: 'direct', label: '엘리멘츠의 궁극신 소환 조건 실행', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('summonUltimateFromHand') && elCardAtHand(c, '엘리멘츠의 궁극신') && elHasBasicCounterCondition(2),
    }, 'summonUltimateFromHand', 'handIndex');
    registerElWrapper('elements_ultimate_god_summon_grave', {
      cardId: '엘리멘츠의 궁극신', effectNum: 0, zone: 'grave', kind: 'direct', label: '엘리멘츠의 궁극신 묘지 소환 조건 실행', chain: false, markOnActivate: false,
      condition: () => elHasFn('summonUltimateFromGrave') && elGraveHas('엘리멘츠의 궁극신') && elHasBasicCounterCondition(2),
    }, 'summonUltimateFromGrave', 'cardId');
    registerElWrapper('elements_ultimate_god_1_summon', {
      cardId: '엘리멘츠의 궁극신', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '엘리멘츠의 궁극신 ① 소환 유발', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerUltimateGod1') && c.event?.cardId === '엘리멘츠의 궁극신',
    }, 'triggerUltimateGod1', 'cardId');
    registerElWrapper('elements_ultimate_god_2', {
      cardId: '엘리멘츠의 궁극신', effectNum: 2, zone: 'field', kind: 'direct', label: '엘리멘츠의 궁극신 ② 패 몬스터 최대 4장 소환', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('activateUltimateGod2') && elCardAtField(c, '엘리멘츠의 궁극신') && elMyTurn() && elPhase('deploy') && elCanUse('엘리멘츠의 궁극신', 2),
    }, 'activateUltimateGod2', 'fieldIndex');
    registerElWrapper('elements_ultimate_god_4_exile', {
      cardId: '엘리멘츠의 궁극신', effectNum: 4, zone: 'event', kind: 'trigger', trigger: 'exile', label: '엘리멘츠의 궁극신 ④ 제외 유발', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerUltimateGod4') && c.event?.cardId === '엘리멘츠의 궁극신' && elCanUse('엘리멘츠의 궁극신', 4),
    }, 'triggerUltimateGod4', 'event');

    registerElWrapper('elements_creator_summon_hand', {
      cardId: '엘리멘츠의 궁극 창조신', effectNum: 0, zone: 'hand', kind: 'direct', label: '엘리멘츠의 궁극 창조신 소환 조건 실행', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('summonUltimateFromHand') && elCardAtHand(c, '엘리멘츠의 궁극 창조신') && elHasBasicCounterCondition(4),
    }, 'summonUltimateFromHand', 'handIndex');
    registerElWrapper('elements_creator_summon_grave', {
      cardId: '엘리멘츠의 궁극 창조신', effectNum: 0, zone: 'grave', kind: 'direct', label: '엘리멘츠의 궁극 창조신 묘지 소환 조건 실행', chain: false, markOnActivate: false,
      condition: () => elHasFn('summonUltimateFromGrave') && elGraveHas('엘리멘츠의 궁극 창조신') && elHasBasicCounterCondition(4),
    }, 'summonUltimateFromGrave', 'cardId');
    registerElWrapper('elements_creator_1_summon', {
      cardId: '엘리멘츠의 궁극 창조신', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'summon', label: '엘리멘츠의 궁극 창조신 ① 소환 유발', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerCreator1') && c.event?.cardId === '엘리멘츠의 궁극 창조신',
    }, 'triggerCreator1', 'event');
    registerElWrapper('elements_creator_2', {
      cardId: '엘리멘츠의 궁극 창조신', effectNum: 2, zone: 'field', kind: 'direct', label: '엘리멘츠의 궁극 창조신 ② 패 몬스터 소환+궁극 카운터', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('activateUltimateGod2') && elCardAtField(c, '엘리멘츠의 궁극 창조신') && elMyTurn() && elPhase('deploy') && elCanUse('엘리멘츠의 궁극 창조신', 2),
    }, 'activateUltimateGod2', 'fieldIndex');
    registerElWrapper('elements_creator_4_exile', {
      cardId: '엘리멘츠의 궁극 창조신', effectNum: 4, zone: 'event', kind: 'trigger', trigger: 'exile', label: '엘리멘츠의 궁극 창조신 ④ 제외 유발', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerCreator4') && c.event?.cardId === '엘리멘츠의 궁극 창조신' && elCanUse('엘리멘츠의 궁극 창조신', 4),
    }, 'triggerCreator4', 'event');
    registerElWrapper('elements_creator_5', {
      cardId: '엘리멘츠의 궁극 창조신', effectNum: 5, zone: 'field', kind: 'direct', label: '엘리멘츠의 궁극 창조신 ⑤ 궁극 카운터 제거+강화', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('activateCreator5') && elCardAtField(c, '엘리멘츠의 궁극 창조신') && elMyTurn() && elPhase('deploy') && elCanUse('엘리멘츠의 궁극 창조신', 5) && elHasUltimateCounters(3),
    }, 'activateCreator5', 'fieldIndex');

    registerElWrapper('elements_magic_card_1', {
      cardId: '엘리멘츠의 마법', effectNum: 1, zone: 'hand', kind: 'ignition', label: '엘리멘츠의 마법 ① 묘지/제외 회수+덱 소환+카운터', markOnActivate: false,
      condition: (c) => elHasFn('activateElementsMagicCard1') && elCardAtHand(c, '엘리멘츠의 마법') && elCanUse('엘리멘츠의 마법', 1),
    }, 'activateElementsMagicCard1', 'handIndex');

    registerElWrapper('ultimate_elements_1', {
      cardId: '궁극의 엘리멘츠', effectNum: 1, zone: 'hand', kind: 'ignition', label: '궁극의 엘리멘츠 ① 궁극신 키 카드 소환', markOnActivate: false,
      condition: (c) => elHasFn('activateUltimateElements1') && elCardAtHand(c, '궁극의 엘리멘츠') && elCanUse('궁극의 엘리멘츠', 1) && G.myField.some(x => x.id === '엘리멘츠의 궁극 창조신'),
    }, 'activateUltimateElements1', 'handIndex');
    registerElWrapper('ultimate_elements_2_grave', {
      cardId: '궁극의 엘리멘츠', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'sentToGrave', label: '궁극의 엘리멘츠 ② 묘지 유발 서치+버림', chain: false, markOnActivate: false,
      condition: (c) => elHasFn('triggerUltimateElements2') && c.event?.cardId === '궁극의 엘리멘츠' && elCanUse('궁극의 엘리멘츠', 2),
    }, 'triggerUltimateElements2', 'event');


    ENGINE.registerCardEffects('펭귄 마을', ['penguin_village_1']);
    ENGINE.registerCardEffects('꼬마 펭귄', ['kkoma_penguin_1']);
    ENGINE.registerCardEffects('펭귄 부부', ['penguin_bubu_2', 'penguin_bubu_1_field']);
    ENGINE.registerCardEffects('현자 펭귄', ['sage_penguin_1', 'sage_penguin_2']);
    ENGINE.registerCardEffects('수문장 펭귄', ['summoner_penguin_1']);
    ENGINE.registerCardEffects('펭귄!돌격!', ['penguin_charge_1', 'penguin_charge_2_grave']);
    ENGINE.registerCardEffects('펭귄의 영광', ['penguin_glory_1', 'penguin_glory_2_grave']);
    ENGINE.registerCardEffects('펭귄 용사', ['penguin_hero_2']);
    ENGINE.registerCardEffects('펭귄의 일격', ['penguin_strike_1']);
    ENGINE.registerCardEffects('펭귄이여 영원하라', ['penguin_forever_1', 'penguin_forever_2_grave']);
    ENGINE.registerCardEffects('펭귄의 전설', ['penguin_legend_2']);
    ENGINE.registerCardEffects('펭귄 마법사', ['penguin_wizard_1', 'penguin_wizard_3']);


    ENGINE.registerCardEffects('수원소의 지배자', ['jibae_shui_1', 'jibae_shui_2', 'jibae_수_3']);
    ENGINE.registerCardEffects('화원소의 지배자', ['jibae_hwa_1', 'jibae_hwa_2', 'jibae_화_3']);
    ENGINE.registerCardEffects('전원소의 지배자', ['jibae_jeon_1', 'jibae_jeon_2_event', 'jibae_전_3']);
    ENGINE.registerCardEffects('풍원소의 지배자', ['jibae_fung_1', 'jibae_fung_2_grave', 'jibae_풍_3']);
    ENGINE.registerCardEffects('수원소의 지배룡', ['jibaeryong_수_1_nonhand_grave', 'jibaeryong_수_2_discard', 'jibaeryong_수_3']);
    ENGINE.registerCardEffects('화원소의 지배룡', ['jibaeryong_화_1_nonhand_grave', 'jibaeryong_화_2_discard', 'jibaeryong_화_3']);
    ENGINE.registerCardEffects('전원소의 지배룡', ['jibaeryong_전_1_nonhand_grave', 'jibaeryong_전_2_discard', 'jibaeryong_전_3']);
    ENGINE.registerCardEffects('풍원소의 지배룡', ['jibaeryong_풍_1_nonhand_grave', 'jibaeryong_풍_2_discard', 'jibaeryong_풍_3']);
    ENGINE.registerCardEffects('사원소의 지배룡', ['sawonso_jibaeryong_summon_hand', 'sawonso_jibaeryong_summon_grave', 'sawonso_jibaeryong_1', 'sawonso_jibaeryong_2']);
    ENGINE.registerCardEffects('사원소의 지배자', ['sawonso_jibaeja_summon_hand', 'sawonso_jibaeja_summon_grave', 'sawonso_jibaeja_1', 'sawonso_jibaeja_2']);
    ENGINE.registerCardEffects('사원소의 기적', ['sawonso_miracle_1']);
    ENGINE.registerCardEffects('지배의 사슬', ['jibae_chain_1_discard', 'jibae_chain_2_grave']);
    ENGINE.registerCardEffects('지배룡과 지배자', ['jibaeryong_and_jibaeja_1', 'jibaeryong_and_jibaeja_2_grave']);


    ENGINE.registerCardEffects('엘리멘츠의 불꽃정령', ['elements_spirit_엘리멘츠의 불꽃정령_1', 'elements_spirit_엘리멘츠의 불꽃정령_2_summon', 'elements_fire_spirit_3']);

    // ─────────────────────────────
    // 마피아 테마 등록
    // 핵심: ① 상대 효과 체인 변형 / ② 드로우 공개 패 유발 / 마피아의 도시 유발
    // ─────────────────────────────
    const mafiaMagics = [
      '마피아의 제안', '마피아의 군림', '마피아의 대가', '마피아의 협상', '마피아의 명령',
      '마피아의 배신자 숙청', '마피아 집결', '마피아의 위용', '마피아의 위기'
    ];
    const isMafia = (id) => CARDS[id]?.theme === '마피아';
    const isMafiaMagic = (id) => isMafia(id) && CARDS[id]?.cardType === 'magic';
    const hasMafiaField = () => G && G.myFieldCard && G.myFieldCard.id === '마피아의 도시';
    const hasOtherMafiaMonster = (selfId) => (G.myField || []).some(c => c && c.id !== selfId && CARDS[c.id]?.theme === '마피아' && CARDS[c.id]?.cardType === 'monster');
    const activeOpponentChain = () => !!(typeof activeChainState !== 'undefined' && activeChainState && activeChainState.active && (activeChainState.links || []).some(l => l.by !== myRole));

    function moveHandCardToGraveByIndex(idx) {
      if (!Number.isInteger(idx) || idx < 0 || !G.myHand[idx]) return false;
      const z = G.myHand.splice(idx, 1)[0];
      G.myGrave.push(z);
      if (window.GameEvents && typeof window.GameEvents.emit === 'function') {
        window.GameEvents.emit('sentToGrave', { cardId: z.id, card: z, from: 'hand', player: 'mine' });
      }
      return true;
    }

    function markMafiaMagicActivated(cardId) {
      window._mafiaMagicOnlyTurn = true;
      window._mafiaMagicActivatedThisTurn = (window._mafiaMagicActivatedThisTurn || 0) + 1;
      if (window.GameEvents && typeof window.GameEvents.emit === 'function') {
        window.GameEvents.emit('mafiaMagicActivated', {
          cardId,
          card: { id: cardId, name: CARDS[cardId]?.name || cardId },
          count: window._mafiaMagicActivatedThisTurn,
          player: 'mine'
        });
      }
    }

    ENGINE.registerEffect('mafia_boss_1_summon', {
      cardId: '대도시의 거물 마피아', effectNum: 1, zone: 'hand', kind: 'quick', maxPerTurn: 1,
      label: '대도시의 거물 마피아 ① 패에서 소환', chain: false,
      condition: (c) => c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '대도시의 거물 마피아' && phaseDeploy() && G.myField.length < fieldLimit() && canUse('대도시의 거물 마피아', 1),
      resolve: (c) => {
        const idx = c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '대도시의 거물 마피아' ? c.handIdx : G.myHand.findIndex(h => h.id === '대도시의 거물 마피아');
        if (idx < 0) return;
        G.myHand.splice(idx, 1);
        const card = CARDS['대도시의 거물 마피아'];
        G.myField.push({ id: card.id, name: card.name, atk: card.atk || 3, atkBase: card.atk || 3, summonedFrom: 'hand' });
        safeLog('대도시의 거물 마피아 ①: 패에서 소환', 'mine');
        if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId: card.id });
        if (typeof onSummon === 'function') onSummon(card.id, 'hand');
      }
    });

    ENGINE.registerEffect('mafia_aide_1_summon', {
      cardId: '마피아의 최측근', effectNum: 1, zone: 'hand', kind: 'quick', maxPerTurn: 1,
      label: '마피아의 최측근 ① 패에서 소환', chain: false,
      condition: (c) => c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '마피아의 최측근' && ['deploy', 'attack'].includes(currentPhase) && G.myField.length < fieldLimit() && canUse('마피아의 최측근', 1),
      resolve: (c) => {
        const idx = c.handIdx >= 0 && G.myHand[c.handIdx]?.id === '마피아의 최측근' ? c.handIdx : G.myHand.findIndex(h => h.id === '마피아의 최측근');
        if (idx < 0) return;
        G.myHand.splice(idx, 1);
        const card = CARDS['마피아의 최측근'];
        G.myField.push({ id: card.id, name: card.name, atk: card.atk || 9, atkBase: card.atk || 9, summonedFrom: 'hand' });
        safeLog('마피아의 최측근 ①: 패에서 소환', 'mine');
        if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId: card.id });
        if (typeof onSummon === 'function') onSummon(card.id, 'hand');
        const bossIdx = G.myHand.findIndex(h => h.id === '대도시의 거물 마피아');
        if (bossIdx >= 0 && G.myField.length < fieldLimit()) {
          gameConfirm("마피아의 최측근 ①: 패의 '대도시의 거물 마피아'도 소환할까요?", (ok) => {
            if (!ok) { c.sync(); return; }
            const b = CARDS['대도시의 거물 마피아'];
            const cur = G.myHand.findIndex(h => h.id === '대도시의 거물 마피아');
            if (cur >= 0 && G.myField.length < fieldLimit()) {
              G.myHand.splice(cur, 1);
              G.myField.push({ id: b.id, name: b.name, atk: b.atk || 3, atkBase: b.atk || 3, summonedFrom: 'hand' });
              safeLog('마피아의 최측근 ①: 대도시의 거물 마피아 추가 소환', 'mine');
              if (typeof sendAction === 'function') sendAction({ type: 'summon', cardId: b.id });
              if (typeof onSummon === 'function') onSummon(b.id, 'hand');
            }
            c.sync();
          });
        }
      }
    });

    ENGINE.registerEffect('mafia_aide_2_city_event', {
      cardId: '마피아의 최측근', effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'summon', maxPerTurn: 1,
      label: '마피아의 최측근 ② 마피아의 도시 배치', chain: false,
      condition: (c) => c.event?.cardId === '마피아의 최측근' && hasOtherMafiaMonster('마피아의 최측근') && (
        G.myHand.some(h => h.id === '마피아의 도시') || G.myGrave.some(g => g.id === '마피아의 도시') || G.myExile.some(e => e.id === '마피아의 도시')
      ) && canUse('마피아의 최측근', 2),
      resolve: () => {
        let source = 'hand';
        let idx = G.myHand.findIndex(c => c.id === '마피아의 도시');
        if (idx >= 0) {
          const z = G.myHand.splice(idx, 1)[0];
          placeMyFieldCard(z.id, { source: 'effect', activate: false, send: true });
          return;
        }
        source = 'grave'; idx = G.myGrave.findIndex(c => c.id === '마피아의 도시');
        if (idx >= 0) { const z = G.myGrave.splice(idx, 1)[0]; placeMyFieldCard(z.id, { source, activate: false, send: true }); return; }
        source = 'exile'; idx = G.myExile.findIndex(c => c.id === '마피아의 도시');
        if (idx >= 0) { const z = G.myExile.splice(idx, 1)[0]; placeMyFieldCard(z.id, { source, activate: false, send: true }); }
      }
    });

    mafiaMagics.forEach(cardId => {
      ENGINE.registerEffect(`mafia_${cardId}_1_chain`, {
        cardId, effectNum: 1, zone: 'hand', kind: 'quick', maxPerTurn: 1,
        label: `${cardId} ① 상대 효과 변형`,
        condition: (c) => c.handIdx >= 0 && G.myHand[c.handIdx]?.id === cardId && activeOpponentChain() && canUse(cardId, 1),
        cost: (c, done) => {
          const idx = c.handIdx >= 0 && G.myHand[c.handIdx]?.id === cardId ? c.handIdx : G.myHand.findIndex(h => h.id === cardId);
          if (idx < 0) return done(false);
          moveHandCardToGraveByIndex(idx);
          markMafiaMagicActivated(cardId);
          done(true);
        },
        buildLink: () => ({ theme: '마피아', mainText: typeof mafiaBuildTransformMainText === 'function' ? mafiaBuildTransformMainText(cardId) : (CARDS[cardId]?.effects || '') }),
        resolve: (c, link) => {
          if (typeof tryResolveMafiaChainTransform === 'function') tryResolveMafiaChainTransform(link);
        }
      });

      if (cardId !== '마피아 집결') {
        ENGINE.registerEffect(`mafia_${cardId}_2_draw`, {
          cardId, effectNum: 2, zone: 'event', kind: 'trigger', trigger: 'draw', maxPerTurn: 1,
          label: `${cardId} ② 드로우 공개 패 유발`, chain: false, markOnActivate: false,
          condition: (c) => c.event?.cardId === cardId && c.event?.player === 'mine',
          resolve: (c) => {
            if (typeof mafiaResolvePublicDrawEffect === 'function') mafiaResolvePublicDrawEffect(cardId, c.event?.handIdx);
          }
        });
      }
    });

    ENGINE.registerEffect('mafia_city_1_magic_activated', {
      cardId: '마피아의 도시', effectNum: 1, zone: 'event', kind: 'trigger', trigger: 'mafiaMagicActivated', maxPerTurn: 1,
      label: '마피아의 도시 ① 묘지 회수 + 패 버리기', chain: false,
      condition: (c) => hasMafiaField() && c.event?.player === 'mine' && (G.myGrave || []).some(g => isMafia(g.id)) && G.myHand.length >= 2 && canUse('마피아의 도시', 1),
      resolve: (c) => {
        const max = Math.min(c.event?.count || 1, (G.myGrave || []).filter(g => isMafia(g.id)).length);
        const targets = (G.myGrave || []).filter(g => isMafia(g.id));
        openCardPicker(targets, `마피아의 도시 ①: 회수할 마피아 카드 최대 ${max}장 선택`, max, (sel) => {
          const picked = sel.map(i => targets[i]).filter(Boolean).slice(0, max);
          picked.forEach(pc => {
            const gi = G.myGrave.findIndex(x => x === pc || x.id === pc.id);
            if (gi >= 0) {
              const z = G.myGrave.splice(gi, 1)[0];
              G.myHand.push({ id: z.id, name: z.name || CARDS[z.id]?.name || z.id, isPublic: false });
            }
          });
          const discardCount = Math.min(2, G.myHand.length);
          if (discardCount <= 0) { c.sync(); return; }
          openCardPicker([...G.myHand], `마피아의 도시 ①: 버릴 패 ${discardCount}장 선택`, discardCount, (ds) => {
            ds.sort((a,b)=>b-a).forEach(i => {
              if (G.myHand[i]) {
                const z = G.myHand.splice(i, 1)[0];
                G.myGrave.push(z);
                if (window.GameEvents) window.GameEvents.emit('discard', { cardId: z.id, card: z, player: 'mine', source: 'mafiaCity' });
              }
            });
            safeLog(`마피아의 도시 ①: ${picked.length}장 회수 후 ${discardCount}장 버림`, 'mine');
            sendGameState(); renderAll();
          }, true);
        }, true);
      }
    });

    ENGINE.registerCardEffects('대도시의 거물 마피아', ['mafia_boss_1_summon']);
    ENGINE.registerCardEffects('마피아의 최측근', ['mafia_aide_1_summon', 'mafia_aide_2_city_event']);
    mafiaMagics.forEach(cardId => {
      const ids = [`mafia_${cardId}_1_chain`];
      if (cardId !== '마피아 집결') ids.push(`mafia_${cardId}_2_draw`);
      ENGINE.registerCardEffects(cardId, ids);
    });
    ENGINE.registerCardEffects('마피아의 도시', ['mafia_city_1_magic_activated']);

    ENGINE.registerCardEffects('엘리멘츠의 물정령', ['elements_spirit_엘리멘츠의 물정령_1', 'elements_spirit_엘리멘츠의 물정령_2_summon', 'elements_water_spirit_3_public']);
    ENGINE.registerCardEffects('엘리멘츠의 전기정령', ['elements_spirit_엘리멘츠의 전기정령_1', 'elements_spirit_엘리멘츠의 전기정령_2_summon', 'elements_electric_spirit_3_hand', 'elements_electric_spirit_3_field']);
    ENGINE.registerCardEffects('엘리멘츠의 바람정령', ['elements_spirit_엘리멘츠의 바람정령_1', 'elements_spirit_엘리멘츠의 바람정령_2_summon', 'elements_wind_spirit_3_grave']);
    ENGINE.registerCardEffects('엘리멘츠 in rainbow forest', ['elements_forest_1', 'elements_forest_3_grave']);
    ENGINE.registerCardEffects('엘리멘츠 is fairy!!!', ['elements_fairy_1', 'elements_fairy_2_grave']);
    ENGINE.registerCardEffects('엘리멘츠의 MAGIC', ['elements_magic_1', 'elements_magic_2_grave']);
    ENGINE.registerCardEffects('엘리멘츠의 TR∀P', ['elements_trap_2_grave']);
    ENGINE.registerCardEffects('엘리멘츠의 ♤♡◇♧', ['elements_shape_1', 'elements_shape_2_grave']);
    ENGINE.registerCardEffects('엘리멘츠의 궁극신', ['elements_ultimate_god_summon_hand', 'elements_ultimate_god_summon_grave', 'elements_ultimate_god_1_summon', 'elements_ultimate_god_2', 'elements_ultimate_god_4_exile']);
    ENGINE.registerCardEffects('엘리멘츠의 궁극 창조신', ['elements_creator_summon_hand', 'elements_creator_summon_grave', 'elements_creator_1_summon', 'elements_creator_2', 'elements_creator_4_exile', 'elements_creator_5']);
    ENGINE.registerCardEffects('엘리멘츠의 마법', ['elements_magic_card_1']);
    ENGINE.registerCardEffects('궁극의 엘리멘츠', ['ultimate_elements_1', 'ultimate_elements_2_grave']);

    ENGINE.registerCardEffects('서커스메어 메드 울프', ['cm_med_wolf_2']);
    ENGINE.registerCardEffects('서커스메어 메드 베어', ['cm_med_bear_2']);
    ENGINE.registerCardEffects('서커스메어 메드 이글', ['cm_med_eagle_2']);
    ENGINE.registerCardEffects('서커스메어 크라운 드래곤', ['cm_crown_dragon_1', 'cm_crown_dragon_2']);
    ENGINE.registerCardEffects('서커스메어 메드 키메라', ['cm_med_chimera_2']);
    ENGINE.registerCardEffects('서커스메어 코인 제스터', ['cm_coin_jester_1_chain', 'cm_coin_jester_2']);
    ENGINE.registerCardEffects('서커스메어 마스크 제스터', ['cm_mask_jester_1_chain', 'cm_mask_jester_2']);
    ENGINE.registerCardEffects('서커스메어 퍼핏 마스터', ['cm_puppet_master_1']);
    ENGINE.registerCardEffects('악몽의 서커스장', ['cm_field_2', 'cm_field_3', 'cm_field_4']);
    ENGINE.registerCardEffects('서커스메어 퓨전', ['cm_fusion_1', 'cm_fusion_2_grave']);
    ENGINE.registerCardEffects('서커스메어 메드 퍼레이드', ['cm_med_parade_1']);
    ENGINE.registerCardEffects('악몽 융합', ['cm_nightmare_fusion_1']);
    ENGINE.registerCardEffects('광란의 서커스', ['cm_wild_circus_1', 'cm_wild_circus_2_grave']);

  }

  ENGINE.activateCardFromGrave = function activateCardFromGrave(cardId) {
    return chooseAndActivate(cardId, 'grave', { cardId, sourceZone: 'grave' });
  };

  function patchGraveEffect() {
    if (typeof window.activateGraveEffect !== 'function') { setTimeout(patchGraveEffect, 50); return; }
    if (window.activateGraveEffect.__effectRegistryPatched) return;
    const oldActivateGraveEffect = window.activateGraveEffect;
    window.activateGraveEffect = function patchedActivateGraveEffect(cardId) {
      if (ENGINE.activateCardFromGrave(cardId)) return;
      return oldActivateGraveEffect.apply(this, arguments);
    };
    window.activateGraveEffect.__effectRegistryPatched = true;
  }

  patchActivateCard();
  patchFieldEffect();
  patchGraveEffect();
  // openCardDetail은 다른 테마 레지스트리도 감싸므로, 모든 스크립트 로드 뒤 마지막에 UI 패치를 건다.
  setTimeout(() => { patchViewFieldCardForRegistryUi(); patchCardDetail(); }, 0);
  registerBuiltIns();
})();
