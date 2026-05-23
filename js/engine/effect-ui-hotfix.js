// HAND BATTLE — Engine: Effect UI Hotfix
// P0-2: EffectDefinition 버튼/임의 유발 선택이 체인에만 올라가고 해결되지 않는 문제를 보정한다.
// effect-ui.js 로드 뒤, legacy-bridge/ui/network 로드 전에 실행되어야 한다.
(function initEffectUiHotfix(global) {
  'use strict';
  if (global.__HB_EFFECT_UI_AUTO_RESOLVE_HOTFIX__) return;
  global.__HB_EFFECT_UI_AUTO_RESOLVE_HOTFIX__ = true;

  function safeCall(fn, fallback) {
    try { return typeof fn === 'function' ? fn() : fallback; }
    catch (err) { console.warn('[effect-ui-hotfix] safeCall 실패:', err); return fallback; }
  }

  function hasLegacyActiveChain() {
    return safeCall(function checkLegacyChain() {
      // eslint-disable-next-line no-undef
      return !!(typeof activeChainState !== 'undefined' && activeChainState && activeChainState.active);
    }, false);
  }

  function hasHbActiveChain() {
    const chain = global.HB_CHAIN_ENGINE;
    if (!chain || typeof chain.hasActiveChain !== 'function') return false;
    return !!safeCall(function checkHbChain() { return chain.hasActiveChain(); }, false);
  }

  function shouldAutoResolveDefault(opts) {
    const options = opts || {};
    if (options.resolveImmediately === true || options.autoResolve === true) return true;
    if (options.resolveImmediately === false || options.autoResolve === false) return false;
    return !hasLegacyActiveChain() && !hasHbActiveChain();
  }

  function withDefaultAutoResolve(options) {
    const opts = Object.assign({}, options || {});
    if (shouldAutoResolveDefault(opts)) {
      opts.resolveImmediately = true;
      opts.autoResolve = true;
    }
    return opts;
  }

  function patchEffectUi() {
    const ui = global.HB_EFFECT_UI;
    if (!ui || ui.__autoResolveHotfixed) return false;
    const originalActivate = ui.activateAvailableEffect && ui.activateAvailableEffect.bind(ui);
    if (typeof originalActivate !== 'function') return false;

    const patched = Object.freeze(Object.assign({}, ui, {
      __autoResolveHotfixed: true,
      activateAvailableEffect(entry, options) {
        return originalActivate(entry, withDefaultAutoResolve(options));
      },
    }));

    global.HB_EFFECT_UI = patched;
    global.HB_ENGINE = global.HB_ENGINE || {};
    global.HB_ENGINE.effectUi = patched;
    global.activateAvailableEffect = patched.activateAvailableEffect;
    return true;
  }

  function patchTriggerQueue() {
    const queue = global.HB_TRIGGER_QUEUE;
    if (!queue || queue.__autoResolveHotfixed) return false;
    const originalActivateSelected = queue.activateSelectedTrigger && queue.activateSelectedTrigger.bind(queue);
    const originalProcess = queue.processTriggerQueue && queue.processTriggerQueue.bind(queue);
    const originalReceive = queue.receiveEvent && queue.receiveEvent.bind(queue);
    if (typeof originalActivateSelected !== 'function') return false;

    const patched = Object.freeze(Object.assign({}, queue, {
      __autoResolveHotfixed: true,
      activateSelectedTrigger(selection, options) {
        return originalActivateSelected(selection, withDefaultAutoResolve(options));
      },
      processTriggerQueue(gameState, options) {
        return typeof originalProcess === 'function'
          ? originalProcess(gameState, withDefaultAutoResolve(options))
          : queue.processTriggerQueue(gameState, options);
      },
      receiveEvent(eventOrType, gameState, options) {
        return typeof originalReceive === 'function'
          ? originalReceive(eventOrType, gameState, withDefaultAutoResolve(options))
          : queue.receiveEvent(eventOrType, gameState, options);
      },
      enqueueEvent(eventOrType, gameState, options) {
        return typeof originalReceive === 'function'
          ? originalReceive(eventOrType, gameState, withDefaultAutoResolve(options))
          : queue.receiveEvent(eventOrType, gameState, options);
      },
    }));

    global.HB_TRIGGER_QUEUE = patched;
    global.HB_ENGINE = global.HB_ENGINE || {};
    global.HB_ENGINE.triggers = patched;
    return true;
  }

  function patchFieldZone() {
    const fieldZone = global.HB_FIELD_ZONE;
    if (!fieldZone || fieldZone.__autoResolveHotfixed) return false;
    const originalActivateSelected = fieldZone.activateSelectedFieldZoneEffect && fieldZone.activateSelectedFieldZoneEffect.bind(fieldZone);
    if (typeof originalActivateSelected !== 'function') return false;

    const patched = Object.freeze(Object.assign({}, fieldZone, {
      __autoResolveHotfixed: true,
      activateSelectedFieldZoneEffect(options) {
        return originalActivateSelected(withDefaultAutoResolve(Object.assign({}, options || {}, { reason: (options && options.reason) || 'fieldZoneEffect' })));
      },
    }));

    global.HB_FIELD_ZONE = patched;
    global.HB_ENGINE = global.HB_ENGINE || {};
    global.HB_ENGINE.fieldZone = patched;
    return true;
  }

  function patchAll() {
    patchEffectUi();
    patchTriggerQueue();
    patchFieldZone();
  }

  patchAll();
  if (global.addEventListener) {
    global.addEventListener('hb:optional-triggers', patchAll);
    global.addEventListener('hb:chain-resolved', patchAll);
  }
  global.HB_EFFECT_UI_HOTFIX = Object.freeze({ patchAll, withDefaultAutoResolve, shouldAutoResolveDefault });
  console.info('[effect-ui-hotfix] 기본 즉시 해결 패치 적용 완료');
})(window);
