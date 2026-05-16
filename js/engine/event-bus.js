// HAND BATTLE — Engine: Event Bus
// 카드 이동/효과/체인/지속 효과가 같은 이벤트 구조를 사용하도록 하는 중앙 이벤트 큐.
// 이 파일은 레거시 함수를 직접 덮어쓰지 않고 window.HB_EVENTS 전역 네임스페이스만 제공한다.
(function initEventBus(global) {
  'use strict';

  const rules = global.HB_RULES || {};
  const KNOWN_EVENTS = rules.EVENTS || Object.freeze({});

  const pendingEvents = [];
  const eventLog = [];
  const subscribersByType = new Map();
  let nextSequence = 1;

  const MAX_EVENT_LOG = 300;
  const ANY_EVENT = '*';

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    return null;
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function makeEventId() {
    return `evt_${Date.now()}_${nextSequence}`;
  }

  function normalizeEventType(type) {
    if (!type) throw new Error('[event-bus] 이벤트 type이 없습니다.');
    return String(type);
  }

  function normalizeEvent(event) {
    if (!event || typeof event !== 'object') {
      throw new Error('[event-bus] event 객체가 필요합니다.');
    }

    const type = normalizeEventType(event.type);
    const sequence = typeof event.sequence === 'number' ? event.sequence : nextSequence++;
    const normalized = Object.assign({}, event, {
      type,
      eventId: event.eventId || makeEventId(),
      sequence,
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
    });

    if (!normalized.cardName && normalized.card && normalized.card.name) {
      normalized.cardName = normalized.card.name;
    }

    return Object.freeze(normalized);
  }

  function getSubscriberSet(type) {
    const eventType = normalizeEventType(type);
    if (!subscribersByType.has(eventType)) subscribersByType.set(eventType, new Set());
    return subscribersByType.get(eventType);
  }

  function emitGameEvent(event) {
    const normalized = normalizeEvent(event);
    pendingEvents.push(normalized);
    eventLog.push(normalized);
    if (eventLog.length > MAX_EVENT_LOG) eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);

    // UI/디버그용 알림. 실제 룰 처리는 dispatchEvents에서 한다.
    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('hb:event-emitted', { detail: { event: normalized } }));
    }

    return normalized;
  }

  function getPendingEvents() {
    return pendingEvents.slice();
  }

  function getEventLog() {
    return eventLog.slice();
  }

  function clearPendingEvents() {
    const cleared = pendingEvents.slice();
    pendingEvents.length = 0;
    return cleared;
  }

  function clearEventLog() {
    const cleared = eventLog.slice();
    eventLog.length = 0;
    return cleared;
  }

  function subscribeGameEvent(type, handler) {
    const eventType = normalizeEventType(type || ANY_EVENT);
    if (typeof handler !== 'function') {
      throw new Error('[event-bus] handler는 함수여야 합니다.');
    }

    const set = getSubscriberSet(eventType);
    set.add(handler);

    return function unsubscribeGameEvent() {
      set.delete(handler);
      if (set.size === 0) subscribersByType.delete(eventType);
    };
  }

  function callSubscribers(event, gameState) {
    const specific = subscribersByType.get(event.type);
    const wildcard = subscribersByType.get(ANY_EVENT);
    const handlers = [];

    if (specific) handlers.push.apply(handlers, Array.from(specific));
    if (wildcard) handlers.push.apply(handlers, Array.from(wildcard));

    const errors = [];
    handlers.forEach(handler => {
      try {
        handler(event, gameState);
      } catch (err) {
        errors.push(err);
        console.error('[event-bus] 이벤트 구독자 실행 중 오류:', err);
      }
    });
    return errors;
  }

  function forwardToOptionalEngines(event, gameState) {
    const errors = [];

    const forwarders = [
      ['HB_TRIGGER_QUEUE', 'receiveEvent'],
      ['HB_TRIGGER_QUEUE', 'enqueueEvent'],
      ['HB_CONTINUOUS_ENGINE', 'receiveEvent'],
      ['HB_CONTINUOUS_ENGINE', 'handleGameEvent'],
      ['HB_NETWORK_SYNC', 'receiveEvent'],
      ['HB_NETWORK_SYNC', 'enqueueEvent'],
      ['HB_AI_EVENT_OBSERVER', 'receiveEvent'],
    ];

    const called = typeof WeakSet === 'function' ? new WeakSet() : null;
    forwarders.forEach(([namespace, method]) => {
      const target = global[namespace];
      if (!target || typeof target[method] !== 'function') return;
      const fn = target[method];
      // receiveEvent/enqueueEvent처럼 같은 함수를 별칭으로 노출하는 엔진은 한 이벤트당 한 번만 전달한다.
      if (called && called.has(fn)) return;
      if (called) called.add(fn);
      try {
        fn.call(target, event, gameState);
      } catch (err) {
        errors.push(err);
        console.error(`[event-bus] ${namespace}.${method} 전달 중 오류:`, err);
      }
    });

    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      try {
        global.dispatchEvent(new global.CustomEvent('hb:event-dispatched', { detail: { event, gameState } }));
      } catch (err) {
        errors.push(err);
        console.error('[event-bus] DOM 이벤트 전달 중 오류:', err);
      }
    }

    return errors;
  }

  function dispatchEvents(gameState) {
    const state = resolveGameState(gameState);
    const events = clearPendingEvents();
    const dispatched = [];
    const errors = [];

    events.forEach(event => {
      errors.push.apply(errors, callSubscribers(event, state));
      errors.push.apply(errors, forwardToOptionalEngines(event, state));
      dispatched.push(event);
    });

    return Object.freeze({
      ok: errors.length === 0,
      dispatched,
      count: dispatched.length,
      errors,
    });
  }

  // 4단계 card-move.js가 호출하던 호환 이름. 새 코드에서는 emitGameEvent/dispatchEvents를 우선 사용한다.
  function dispatch(event, gameState) {
    const emitted = emitGameEvent(event);
    const result = dispatchEvents(gameState);
    return Object.freeze({
      ok: result.ok,
      event: emitted,
      dispatched: result.dispatched,
      errors: result.errors,
    });
  }

  function isKnownEventType(type) {
    const eventType = normalizeEventType(type);
    return Object.keys(KNOWN_EVENTS).some(key => KNOWN_EVENTS[key] === eventType);
  }

  global.HB_EVENTS = Object.freeze({
    ANY_EVENT,
    emitGameEvent,
    getPendingEvents,
    clearPendingEvents,
    subscribeGameEvent,
    dispatchEvents,
    dispatch,
    getEventLog,
    clearEventLog,
    isKnownEventType,
  });
})(window);
