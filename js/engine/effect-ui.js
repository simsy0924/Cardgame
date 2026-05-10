// HAND BATTLE — Engine: Effect UI
// EffectDefinition 기준으로 UI 효과 버튼/선택 팝업을 생성한다.
// 텍스트 파싱 버튼은 레거시 호환 레이어로 남기고, effectIds가 있는 카드는 이 파일의 버튼만 사용한다.
(function initEffectUi(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || Object.freeze({
    ACTIVATION: 'activation',
    QUICK: 'quick',
    TRIGGER: 'trigger',
    CONTINUOUS: 'continuous',
    PROCEDURE: 'procedure',
    REPLACEMENT: 'replacement',
    PROCESSING_NEGATE: 'processingNegate',
  });
  const ZONES = rules.ZONES || Object.freeze({
    HAND: 'hand',
    FIELD: 'field',
    FIELD_ZONE: 'fieldZone',
    GRAVE: 'grave',
    EXILE: 'exile',
  });
  const EFFECT_TAGS = rules.EFFECT_TAGS || Object.freeze({ FIELD_CARD_ACTIVATION: 'fieldCardActivation' });

  const registry = global.HB_EFFECT_REGISTRY;
  const definition = global.HB_EFFECT_DEFINITION;
  const contextFactory = global.HB_EFFECT_CONTEXT;
  const chain = global.HB_CHAIN_ENGINE;
  const zoneAccess = global.HB_ZONE_ACCESS;

  if (!registry) throw new Error('[effect-ui] HB_EFFECT_REGISTRY가 필요합니다.');
  if (!definition) throw new Error('[effect-ui] HB_EFFECT_DEFINITION이 필요합니다.');
  if (!contextFactory) throw new Error('[effect-ui] HB_EFFECT_CONTEXT가 필요합니다.');

  const CONTROLLERS = (zoneAccess && zoneAccess.CONTROLLERS) || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const DISPLAYABLE_TYPES = new Set([EFFECT_TYPES.ACTIVATION, EFFECT_TYPES.QUICK]);
  // procedure는 일반 효과 버튼에서는 숨기지만, summonProcedure=true인 경우에는
  // 체인 없는 소환 절차 버튼으로 별도 표시한다.
  const HIDDEN_TYPES = new Set([
    EFFECT_TYPES.CONTINUOUS,
    EFFECT_TYPES.REPLACEMENT,
    EFFECT_TYPES.PROCESSING_NEGATE,
  ]);

  function getDefaultGameState() {
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    return null;
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function getCardDatabase() {
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function getCardDef(cardOrId) {
    const id = getCardId(cardOrId);
    const cards = getCardDatabase();
    return cards && id ? (cards[id] || null) : null;
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || cardOrId.name || '';
  }

  function normalizeController(player) {
    if (zoneAccess && typeof zoneAccess.normalizeController === 'function') return zoneAccess.normalizeController(player || CONTROLLERS.ME);
    return player === CONTROLLERS.OPPONENT || player === 'op' || player === 'opponent' ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
  }

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function resultOk(result) {
    return result === undefined || result === true || !(result && result.ok === false);
  }

  function makeOk(payload) {
    return Object.freeze(Object.assign({ ok: true }, payload || {}));
  }

  function makeFail(message, payload) {
    return Object.freeze(Object.assign({ ok: false, error: message }, payload || {}));
  }

  function maybeNotify(message) {
    // eslint-disable-next-line no-undef
    if (typeof notify === 'function') notify(message);
    else if (global.console && global.console.warn) global.console.warn('[effect-ui]', message);
  }

  function closeModalIfAvailable(id) {
    // eslint-disable-next-line no-undef
    if (typeof closeModal === 'function') closeModal(id);
    else {
      const el = global.document && global.document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
  }

  function openModalIfAvailable(id) {
    // eslint-disable-next-line no-undef
    if (typeof openModal === 'function') openModal(id);
    else {
      const el = global.document && global.document.getElementById(id);
      if (el) el.classList.remove('hidden');
    }
  }

  function hasRegisteredEffects(cardOrId) {
    const cardId = getCardId(cardOrId);
    if (!cardId) return false;
    const card = getCardDef(cardId) || (typeof cardOrId === 'object' ? cardOrId : null);
    if (card && Array.isArray(card.effectIds) && card.effectIds.length > 0) return true;
    return registry.getEffectsByCardId(cardId).length > 0;
  }

  function shouldUseNewEffectUI(cardOrId) {
    return hasRegisteredEffects(cardOrId);
  }

  function effectHasTag(effect, tag) {
    if (!effect || !tag) return false;
    if (definition && typeof definition.effectHasTag === 'function') return definition.effectHasTag(effect, tag);
    return asArray(effect.tags).indexOf(tag) !== -1;
  }

  function isSummonProcedureEffect(effect) {
    return !!(effect && effect.type === EFFECT_TYPES.PROCEDURE && (effect.summonProcedure || (effect.meta && effect.meta.summonProcedure)));
  }

  function isHiddenEffect(effect) {
    if (!effect) return true;
    if (isSummonProcedureEffect(effect)) return false;
    if (effect.type === EFFECT_TYPES.PROCEDURE) return true;
    if (HIDDEN_TYPES.has(effect.type)) return true;
    if (definition.isContinuousEffect && definition.isContinuousEffect(effect)) return true;
    if (definition.isProcedureEffect && definition.isProcedureEffect(effect) && !isSummonProcedureEffect(effect)) return true;
    if (effectHasTag(effect, EFFECT_TAGS.FIELD_CARD_ACTIVATION)) return true;
    if (effect.meta && effect.meta.fieldCardActivation) return true;
    return false;
  }

  function isDisplayableManualEffect(effect) {
    if (!effect || isHiddenEffect(effect)) return false;
    if (isSummonProcedureEffect(effect)) return true;
    return DISPLAYABLE_TYPES.has(effect.type);
  }

  function labelForEffect(effect, index) {
    if (!effect) return `${index + 1}번 효과 발동`;
    if (isSummonProcedureEffect(effect)) return effect.label || '소환 조건으로 소환';
    if (effect.label) return effect.label;
    if (effect.effectNo != null) return `${effect.effectNo} 효과 발동`;
    const text = String(effect.text || '').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
    return `${index + 1}번 효과 발동`;
  }

  function inferSourceIndex(options) {
    const opts = options || {};
    if (typeof opts.sourceIndex === 'number') return opts.sourceIndex;
    if (typeof opts.handIdx === 'number') return opts.handIdx;
    if (typeof opts.handIndex === 'number') return opts.handIndex;
    if (typeof opts.fieldIdx === 'number') return opts.fieldIdx;
    if (typeof opts.fieldIndex === 'number') return opts.fieldIndex;
    return null;
  }

  function buildContextForEffect(options, effect) {
    const opts = options || {};
    const card = opts.card || getCardDef(opts.cardId) || { id: opts.cardId };
    const controller = normalizeController(opts.player || opts.controller || CONTROLLERS.ME);
    const zone = opts.zone || opts.sourceZone || ZONES.HAND;
    const sourceIndex = inferSourceIndex(opts);
    return contextFactory.createEffectContext(Object.assign({}, opts.ctx || {}, {
      gameState: resolveGameState(opts.gameState),
      controller,
      card,
      cardId: getCardId(card),
      source: opts.source || { controller, zone, index: sourceIndex },
      sourceZone: zone,
      sourceController: controller,
      sourceIndex,
      effect,
      event: opts.event || null,
      chainLink: opts.chainLink || null,
      targets: opts.targets || [],
      authority: opts.authority,
    }));
  }

  function checkConditionOnly(effect, ctx) {
    try { return resultOk(effect.condition(ctx)); }
    catch (err) {
      console.warn('[effect-ui] condition 확인 실패:', effect.id, err);
      return false;
    }
  }

  function canShowEffect(effect, ctx, options) {
    if (!isDisplayableManualEffect(effect)) return false;
    if (!checkConditionOnly(effect, ctx)) return false;

    if (isSummonProcedureEffect(effect)) {
      try { return resultOk(effect.canResolve ? effect.canResolve(ctx) : true); }
      catch (err) {
        console.warn('[effect-ui] procedure canResolve 확인 실패:', effect.id, err);
        return false;
      }
    }

    if (ctx.sourceZone === ZONES.FIELD_ZONE && global.HB_FIELD_ZONE && typeof global.HB_FIELD_ZONE.canActivateFieldZoneEffect === 'function') {
      const fieldCheck = global.HB_FIELD_ZONE.canActivateFieldZoneEffect({ gameState: ctx.gameState, controller: ctx.controller, card: ctx.card, cardId: ctx.cardId }, effect);
      return !!fieldCheck.ok;
    }

    if ((options && options.skipChainCheck) || !chain || typeof chain.canActivateEffect !== 'function') return true;
    const check = chain.canActivateEffect(ctx, effect);
    return !!check.ok;
  }

  function getAvailableEffects(query) {
    const q = query || {};
    const card = q.card || getCardDef(q.cardId) || { id: q.cardId };
    const cardId = getCardId(card || q.cardId);
    if (!cardId) return [];

    const zone = q.zone || q.sourceZone || ZONES.HAND;
    const state = resolveGameState(q.gameState);
    const controller = normalizeController(q.player || q.controller || CONTROLLERS.ME);

    let effects;
    if (zone === ZONES.FIELD_ZONE && global.HB_FIELD_ZONE && typeof global.HB_FIELD_ZONE.getFieldZoneEffects === 'function') {
      effects = controller === CONTROLLERS.ME ? global.HB_FIELD_ZONE.getFieldZoneEffects(controller, state) : [];
    } else {
      effects = registry.getEffectsByCardAndZone(cardId, zone);
    }

    const seen = new Set();
    const result = [];
    effects.forEach((effect, index) => {
      if (!effect || seen.has(effect.id)) return;
      seen.add(effect.id);
      const ctx = buildContextForEffect(Object.assign({}, q, { card, cardId, zone, sourceZone: zone, gameState: state, controller }), effect);
      if (!canShowEffect(effect, ctx, q)) return;
      result.push(Object.freeze({ effect, ctx, label: labelForEffect(effect, index), zone, controller, card }));
    });
    return result;
  }

  function insertBeforeClose(actions, button) {
    const closeButton = Array.from(actions.children || []).find(el => el && el.textContent === '닫기');
    if (closeButton) actions.insertBefore(button, closeButton);
    else actions.appendChild(button);
  }

  function activateAvailableEffect(entry, options) {
    if (!entry || !entry.effect) return makeFail('발동할 효과가 없습니다.');
    const opts = options || {};
    const effect = entry.effect;
    const ctx = entry.ctx || buildContextForEffect(opts, effect);

    if (ctx.sourceZone === ZONES.FIELD_ZONE && global.HB_FIELD_ZONE && typeof global.HB_FIELD_ZONE.activateSelectedFieldZoneEffect === 'function') {
      return global.HB_FIELD_ZONE.activateSelectedFieldZoneEffect({ gameState: ctx.gameState, controller: ctx.controller, effect });
    }

    if (isSummonProcedureEffect(effect)) {
      try {
        const conditionOk = resultOk(effect.condition(ctx));
        const canResolveOk = resultOk(effect.canResolve ? effect.canResolve(ctx) : true);
        if (!conditionOk || !canResolveOk) return makeFail('소환 조건을 만족하지 않습니다.');
        const resolved = effect.resolve(ctx);
        return resultOk(resolved) ? makeOk({ procedure: true, result: resolved }) : makeFail((resolved && resolved.error) || '소환 절차를 처리할 수 없습니다.', { result: resolved });
      } catch (err) {
        return makeFail(`소환 절차 처리 오류: ${err.message}`, { errorObject: err });
      }
    }

    if (!chain || typeof chain.activateEffect !== 'function') return makeFail('HB_CHAIN_ENGINE.activateEffect를 사용할 수 없습니다.');
    return chain.activateEffect({
      gameState: ctx.gameState,
      controller: ctx.controller,
      card: ctx.card,
      cardId: effect.cardId,
      source: ctx.source,
      sourceZone: ctx.sourceZone,
      sourceIndex: ctx.sourceIndex,
      effect,
      activationData: Object.assign({}, opts.activationData || {}, { source: 'effect-ui' }),
    });
  }

  function renderEffectButtons(card, zone, options) {
    const opts = options || {};
    const actions = opts.actionsElement || (global.document && global.document.getElementById('mdCardActions'));
    if (!actions) return makeFail('효과 버튼을 넣을 actionsElement가 없습니다.');

    const cardId = getCardId(card || opts.cardId);
    const cardDef = card || getCardDef(cardId);
    if (!cardId || !shouldUseNewEffectUI(cardId)) return makeOk({ usedNewEngineUI: false, inserted: [], effects: [] });

    const entries = getAvailableEffects(Object.assign({}, opts, { card: cardDef, cardId, zone }));
    const inserted = [];

    // 필드 카드는 패에서의 “카드 발동” 자체가 EffectDefinition 버튼 목록과 별개다.
    // effectIds가 붙은 필드 카드도 레거시 activateCard로 되돌아가지 않도록 신 UI에서 직접 처리한다.
    if (zone === ZONES.HAND && cardDef && cardDef.cardType === 'field' && global.HB_FIELD_ZONE && typeof global.HB_FIELD_ZONE.activateFieldCardFromHand === 'function') {
      const b = global.document.createElement('button');
      b.className = 'btn btn-primary';
      b.textContent = '필드 카드 발동';
      b.dataset.effectUiSynthetic = 'field-card-activate';
      b.onclick = function onFieldCardActivateClick() {
        closeModalIfAvailable('cardDetailModal');
        try {
          const result = global.HB_FIELD_ZONE.activateFieldCardFromHand({
            gameState: resolveGameState(opts.gameState),
            controller: opts.player || opts.controller || CONTROLLERS.ME,
            handIndex: opts.handIdx ?? opts.handIndex,
            cardId,
          });
          if (result && result.ok === false) maybeNotify(result.error || '필드 카드를 발동할 수 없습니다.');
        } catch (err) {
          console.error('[effect-ui] 필드 카드 발동 오류:', err);
          maybeNotify(`필드 카드 발동 오류: ${err.message}`);
        }
      };
      insertBeforeClose(actions, b);
      inserted.push(b);
    }

    entries.forEach(entry => {
      const b = global.document.createElement('button');
      b.className = `btn ${entry.effect.type === EFFECT_TYPES.QUICK ? 'btn-secondary' : 'btn-primary'}`;
      b.textContent = isSummonProcedureEffect(entry.effect) ? `[소환] ${entry.label}` : (entry.effect.type === EFFECT_TYPES.QUICK ? `[퀵] ${entry.label}` : entry.label);
      b.dataset.effectId = entry.effect.id;
      b.onclick = function onEffectButtonClick() {
        closeModalIfAvailable('cardDetailModal');
        try {
          const result = activateAvailableEffect(entry, opts);
          if (result && result.ok === false) maybeNotify(result.error || '효과를 발동할 수 없습니다.');
        } catch (err) {
          console.error('[effect-ui] 효과 버튼 처리 오류:', err);
          maybeNotify(`효과 처리 오류: ${err.message}`);
        }
      };
      insertBeforeClose(actions, b);
      inserted.push(b);
    });

    if (entries.length === 0 && opts.showNoEffectHint === true) {
      const hint = global.document.createElement('button');
      hint.className = 'btn btn-secondary';
      hint.textContent = '현재 발동 가능한 효과 없음';
      hint.disabled = true;
      insertBeforeClose(actions, hint);
      inserted.push(hint);
    }

    return makeOk({ usedNewEngineUI: true, inserted, effects: entries.map(entry => entry.effect), entries });
  }

  function renderFieldZoneEffectButtons(card, options) {
    const opts = Object.assign({}, options || {}, { zone: ZONES.FIELD_ZONE, sourceZone: ZONES.FIELD_ZONE, card });
    if (global.HB_FIELD_ZONE && typeof global.HB_FIELD_ZONE.renderFieldZoneActionButtons === 'function') {
      return global.HB_FIELD_ZONE.renderFieldZoneActionButtons({
        gameState: resolveGameState(opts.gameState),
        player: opts.player || opts.controller || CONTROLLERS.ME,
        controller: opts.player || opts.controller || CONTROLLERS.ME,
        actionsElement: opts.actionsElement || (global.document && global.document.getElementById('mdCardActions')),
      });
    }
    return renderEffectButtons(card, ZONES.FIELD_ZONE, opts);
  }

  function ensureDialog(id, title) {
    if (!global.document) return null;
    let overlay = global.document.getElementById(id);
    if (overlay) return overlay;
    overlay = global.document.createElement('div');
    overlay.className = 'modal-overlay hidden';
    overlay.id = id;
    overlay.innerHTML = [
      '<div class="modal">',
      `<h2 id="${id}Title"></h2>`,
      `<div class="modal-effects" id="${id}Body"></div>`,
      `<div class="modal-actions" id="${id}Actions"></div>`,
      '</div>',
    ].join('');
    global.document.body.appendChild(overlay);
    const titleEl = global.document.getElementById(`${id}Title`);
    if (titleEl) titleEl.textContent = title || '선택';
    return overlay;
  }

  function renderTriggerChoiceDialog(triggersOrDetail) {
    const detail = triggersOrDetail && triggersOrDetail.detail ? triggersOrDetail.detail : (triggersOrDetail || {});
    const choices = asArray(detail.choices || detail.triggers || triggersOrDetail);
    if (!choices.length) return makeOk({ count: 0 });

    const overlay = ensureDialog('optionalTriggerModal', '임의 유발 효과 선택');
    if (!overlay) return makeFail('DOM이 없습니다.');
    const body = global.document.getElementById('optionalTriggerModalBody');
    const actions = global.document.getElementById('optionalTriggerModalActions');
    body.innerHTML = `<p style="font-size:.85rem;color:var(--text-dim);margin-bottom:.6rem">발동할 임의 유발 효과를 선택하세요.</p>`;
    actions.innerHTML = '';

    choices.forEach((choice, index) => {
      const b = global.document.createElement('button');
      b.className = 'btn btn-primary';
      const label = choice.label || choice.cardName || choice.cardId || choice.effectId || `${index + 1}번 효과`;
      b.textContent = choice.effectNo != null ? `${choice.effectNo}효과: ${label}` : label;
      b.onclick = function onTriggerChoiceClick() {
        try {
          const result = global.HB_TRIGGER_QUEUE && global.HB_TRIGGER_QUEUE.activateSelectedTrigger(choice);
          if (result && result.ok === false) maybeNotify(result.error || '유발 효과를 발동할 수 없습니다.');
          else closeModalIfAvailable('optionalTriggerModal');
        } catch (err) {
          console.error('[effect-ui] 임의 유발 선택 처리 오류:', err);
          maybeNotify(`유발 효과 처리 오류: ${err.message}`);
        }
      };
      actions.appendChild(b);
    });

    const pass = global.document.createElement('button');
    pass.className = 'btn btn-secondary';
    pass.textContent = '이번에는 발동하지 않기';
    pass.onclick = () => closeModalIfAvailable('optionalTriggerModal');
    actions.appendChild(pass);
    overlay.classList.remove('hidden');
    return makeOk({ count: choices.length, choices });
  }

  function renderCardSelectionDialog(dialogId, title, request) {
    const req = request || {};
    const cards = asArray(req.cards || req.candidates || req.targets);
    const overlay = ensureDialog(dialogId, title);
    if (!overlay) return makeFail('DOM이 없습니다.');
    const body = global.document.getElementById(`${dialogId}Body`);
    const actions = global.document.getElementById(`${dialogId}Actions`);
    body.innerHTML = '';
    actions.innerHTML = '';

    const selected = new Set();
    if (!cards.length) {
      body.innerHTML = '<p style="color:var(--text-dim);font-size:.85rem">선택 가능한 카드가 없습니다.</p>';
    } else {
      const list = global.document.createElement('div');
      list.style.display = 'grid';
      list.style.gridTemplateColumns = 'repeat(auto-fill, minmax(110px, 1fr))';
      list.style.gap = '8px';
      cards.forEach((card, index) => {
        const item = global.document.createElement('button');
        item.className = 'btn btn-secondary';
        item.textContent = card.name || card.id || String(card);
        item.onclick = () => {
          if (!req.multi) selected.clear();
          if (selected.has(index)) selected.delete(index); else selected.add(index);
          Array.from(list.children).forEach((child, childIndex) => child.classList.toggle('btn-primary', selected.has(childIndex)));
        };
        list.appendChild(item);
      });
      body.appendChild(list);
    }

    const ok = global.document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.textContent = '선택 완료';
    ok.onclick = () => {
      const picked = Array.from(selected).map(index => cards[index]);
      closeModalIfAvailable(dialogId);
      if (typeof req.onSelect === 'function') req.onSelect(req.multi ? picked : picked[0], picked);
    };
    actions.appendChild(ok);

    const cancel = global.document.createElement('button');
    cancel.className = 'btn btn-secondary';
    cancel.textContent = '취소';
    cancel.onclick = () => {
      closeModalIfAvailable(dialogId);
      if (typeof req.onCancel === 'function') req.onCancel();
    };
    actions.appendChild(cancel);
    openModalIfAvailable(dialogId);
    return makeOk({ cards, selected });
  }

  function renderCostSelectionDialog(costRequest) {
    return renderCardSelectionDialog('costSelectionModal', '코스트 선택', costRequest);
  }

  function renderTargetSelectionDialog(targetRequest) {
    return renderCardSelectionDialog('targetSelectionModal', '대상 선택', targetRequest);
  }

  if (global.addEventListener) {
    global.addEventListener('hb:optional-triggers', evt => {
      try { renderTriggerChoiceDialog(evt.detail); }
      catch (err) { console.error('[effect-ui] optional trigger dialog 오류:', err); }
    });
  }

  const api = Object.freeze({
    getAvailableEffects,
    renderEffectButtons,
    renderFieldZoneEffectButtons,
    renderTriggerChoiceDialog,
    renderCostSelectionDialog,
    renderTargetSelectionDialog,
    activateAvailableEffect,
    shouldUseNewEffectUI,
    hasRegisteredEffects,
    isDisplayableManualEffect,
    isHiddenEffect,
  });

  global.HB_EFFECT_UI = api;
  global.HB_ENGINE = global.HB_ENGINE || {};
  global.HB_ENGINE.effectUi = api;

  // 실행 계획에 적힌 이름을 그대로 전역에서도 사용할 수 있게 한다.
  global.getAvailableEffects = getAvailableEffects;
  global.renderEffectButtons = renderEffectButtons;
  global.renderFieldZoneEffectButtons = renderFieldZoneEffectButtons;
  global.renderTriggerChoiceDialog = renderTriggerChoiceDialog;
  global.renderCostSelectionDialog = renderCostSelectionDialog;
  global.renderTargetSelectionDialog = renderTargetSelectionDialog;
})(window);
