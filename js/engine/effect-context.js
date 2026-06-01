// HAND BATTLE — Engine: Effect Context
// 모든 신규 효과의 condition/cost/target/resolve에 동일한 ctx 형식을 전달하기 위한 빌더.
// 효과 내부에서는 G.myField.push 같은 직접 조작 대신 ctx.move.* 래퍼를 사용한다.
(function initEffectContext(global) {
  'use strict';

  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!zoneAccess) {
    throw new Error('[effect-context] HB_ZONE_ACCESS가 필요합니다. zone-access.js를 먼저 로드하세요.');
  }

  const cardMove = global.HB_CARD_MOVE;
  if (!cardMove) {
    throw new Error('[effect-context] HB_CARD_MOVE가 필요합니다. card-move.js를 먼저 로드하세요.');
  }

  const CONTROLLERS = zoneAccess.CONTROLLERS || Object.freeze({ ME: 'me', OPPONENT: 'opponent' });
  const MOVE_METHODS = Object.freeze([
    'moveCard',
    'summonCard',
    'sendToGrave',
    'banishCard',
    'discardCard',
    'addToHand',
    'placeFieldCard',
    'removeFieldCard',
  ]);

  function getDefaultGameState() {
    // engine.js의 top-level let G는 window.G가 아닐 수 있으므로 typeof G를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof G !== 'undefined') return G;
    if (global.G) return global.G;
    throw new Error('[effect-context] gameState가 없습니다. createEffectContext({ gameState })처럼 명시적으로 전달하세요.');
  }

  function resolveGameState(gameState) {
    return gameState || getDefaultGameState();
  }

  function getCardDatabase() {
    // cards.js의 const CARDS는 전역 lexical binding일 수 있어서 typeof를 먼저 확인한다.
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || null;
  }

  function getCardDef(cardId) {
    const cards = getCardDatabase();
    return cards && cardId ? (cards[cardId] || null) : null;
  }

  function normalizeController(controller) {
    return zoneAccess.normalizeController(controller || CONTROLLERS.ME);
  }

  function getOpponent(controller) {
    return normalizeController(controller) === CONTROLLERS.ME ? CONTROLLERS.OPPONENT : CONTROLLERS.ME;
  }

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value.slice() : [value];
  }

  function getCardId(cardOrId) {
    if (!cardOrId) return '';
    if (typeof cardOrId === 'string') return cardOrId;
    return cardOrId.id || cardOrId.cardId || '';
  }

  function normalizeLocation(location, defaultController) {
    if (!location) return null;
    if (typeof location === 'string') {
      return {
        controller: normalizeController(defaultController),
        zone: zoneAccess.normalizeZone(location),
        index: null,
      };
    }
    return {
      controller: normalizeController(location.controller || defaultController || CONTROLLERS.ME),
      zone: zoneAccess.normalizeZone(location.zone || location.name),
      index: typeof location.index === 'number' ? location.index : null,
    };
  }

  function inferNetworkMode(explicitMode) {
    if (explicitMode) return explicitMode;
    // eslint-disable-next-line no-undef
    if (typeof DEMO_MODE !== 'undefined' && DEMO_MODE) return 'demo';
    // eslint-disable-next-line no-undef
    if (typeof roomRef !== 'undefined' && roomRef) return 'firebase';
    return 'local';
  }

  function inferAuthority(opts, controller, gameState) {
    if (typeof opts.authority === 'boolean') return opts.authority;
    if (opts.preview === true) return false;

    const sync = global.HB_NETWORK_SYNC;
    if (sync && typeof sync.hasAuthority === 'function') {
      try { return !!sync.hasAuthority({ gameState, controller, effect: opts.effect, event: opts.event, chainLink: opts.chainLink }); }
      catch (err) { console.warn('[effect-context] HB_NETWORK_SYNC.hasAuthority 확인 중 오류:', err); }
    }

    return true;
  }

  function makeLogger(options) {
    const opts = options || {};
    const entries = Array.isArray(opts.entries) ? opts.entries : [];
    const prefix = opts.prefix || '[effect-context]';

    function push(level, argsLike) {
      const args = Array.from(argsLike || []);
      const entry = Object.freeze({
        level,
        message: args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '),
        args,
        timestamp: Date.now(),
      });
      entries.push(entry);

      if (opts.silent) return entry;
      const method = level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'log');
      if (global.console && typeof global.console[method] === 'function') {
        global.console[method](prefix, ...args);
      }
      return entry;
    }

    function log() { return push('info', arguments); }
    log.info = function info() { return push('info', arguments); };
    log.warn = function warn() { return push('warn', arguments); };
    log.error = function error() { return push('error', arguments); };
    log.add = function add(level, message, data) { return push(level || 'info', data === undefined ? [message] : [message, data]); };
    log.entries = entries;
    log.clear = function clear() { entries.length = 0; };
    return log;
  }

  function makeAskPlayer(explicitAskPlayer) {
    if (typeof explicitAskPlayer === 'function') return explicitAskPlayer;

    return function askPlayer(question, callback) {
      const request = typeof question === 'string' ? { message: question } : (question || {});
      const message = request.message || request.text || request.title || '선택하시겠습니까?';
      const cb = typeof callback === 'function' ? callback : null;

      if (cb) {
        // eslint-disable-next-line no-undef
        if (typeof gameConfirm === 'function') {
          // eslint-disable-next-line no-undef
          gameConfirm(message, cb);
          return undefined;
        }
        if (typeof global.confirm === 'function') {
          cb(!!global.confirm(message));
          return undefined;
        }
        cb(false);
        return undefined;
      }

      if (typeof global.Promise === 'function') {
        return new global.Promise(resolve => askPlayer(request, resolve));
      }

      return false;
    };
  }

  function makeRandom(randomSource) {
    const base = typeof randomSource === 'function' ? randomSource : Math.random;

    function random() {
      return base();
    }

    random.int = function int(maxExclusive) {
      const max = Math.max(0, Number(maxExclusive || 0));
      if (max <= 0) return 0;
      return Math.floor(random() * max);
    };

    random.choice = function choice(list) {
      const arr = asArray(list);
      if (arr.length === 0) return null;
      return arr[random.int(arr.length)];
    };

    random.shuffle = function shuffle(list) {
      const arr = asArray(list);
      for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = random.int(i + 1);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    };

    return Object.freeze(random);
  }

  function makeAuthorityBlockedResult(action, options, ctx) {
    const preview = Object.freeze({
      ok: true,
      preview: true,
      blockedByAuthority: true,
      action,
      cardId: getCardId(options && (options.cardId || options.card)) || null,
      controller: (options && options.controller) || ctx.controller,
      reason: (options && options.reason) || 'authorityPreview',
      message: 'authority=false 상태에서는 실제 게임 상태를 변경하지 않습니다.',
    });

    if (ctx.log && typeof ctx.log.warn === 'function') {
      ctx.log.warn(`권위 없는 컨텍스트에서 ${action} 상태 변경을 차단했습니다.`, preview);
    }

    return preview;
  }

  function withContextDefaults(ctx, options) {
    const opts = Object.assign({}, options || {});
    if (!opts.gameState) opts.gameState = ctx.gameState;
    if (!opts.controller) opts.controller = ctx.controller;
    // 행위자(효과를 발동한 컨트롤러). opts.controller는 카드 소유자로 덮일 수 있어 별도 보존한다.
    // card-move가 "상대 효과가 내 카드를 건드리는가"를 판별해 내성/보호를 적용하는 데 쓴다.
    if (!opts.actorController) opts.actorController = ctx.controller;
    if (!opts.effect && ctx.effect) opts.effect = ctx.effect;
    if (!opts.chainLink && ctx.chainLink) opts.chainLink = ctx.chainLink;
    if (!opts.event && ctx.event) opts.eventData = Object.assign({}, opts.eventData || {}, { causedByEventId: ctx.event.eventId || null });
    return opts;
  }

  function makeMoveProxy(ctx) {
    const proxy = {};

    MOVE_METHODS.forEach(methodName => {
      proxy[methodName] = function callMove(options) {
        const opts = withContextDefaults(ctx, options);
        if (!ctx.authority) return makeAuthorityBlockedResult(methodName, opts, ctx);
        if (typeof cardMove[methodName] !== 'function') {
          return Object.freeze({ ok: false, error: `HB_CARD_MOVE.${methodName}가 없습니다.` });
        }
        return cardMove[methodName](opts);
      };
    });

    proxy.getFieldSlotLimit = function getFieldSlotLimit(controller) {
      return cardMove.getFieldSlotLimit(ctx.gameState, controller || ctx.controller);
    };

    proxy.hasFieldSpace = function hasFieldSpace(controller) {
      return cardMove.hasFieldSpace(ctx.gameState, controller || ctx.controller);
    };

    proxy.dispatchMoveEvent = function dispatchMoveEvent(event) {
      if (!ctx.authority) return makeAuthorityBlockedResult('dispatchMoveEvent', event || {}, ctx);
      return cardMove.dispatchMoveEvent(ctx.gameState, event);
    };

    return Object.freeze(proxy);
  }

  function resolveSource(opts, gameState, controller, cardId) {
    const explicit = normalizeLocation(opts.source || opts.from || opts.location, controller);
    if (explicit) return explicit;

    const event = opts.event || {};
    const eventLocation = event.to || event.from;
    if (eventLocation && (!cardId || event.cardId === cardId)) {
      return normalizeLocation(eventLocation, eventLocation.controller || event.controller || controller);
    }

    if (opts.sourceZone) {
      return {
        controller,
        zone: zoneAccess.normalizeZone(opts.sourceZone),
        index: typeof opts.sourceIndex === 'number' ? opts.sourceIndex : null,
      };
    }

    if (!cardId) return null;
    try {
      return zoneAccess.findCardLocation(gameState, cardId);
    } catch (err) {
      console.warn('[effect-context] 카드 위치 탐색 중 오류:', err);
      return null;
    }
  }

  function resolveCard(opts, gameState, source, cardId) {
    if (opts.card) return opts.card;

    const event = opts.event || {};
    if (event.card && (!cardId || getCardId(event.card) === cardId)) return event.card;

    const chainLink = opts.chainLink || {};
    if (chainLink.card && (!cardId || getCardId(chainLink.card) === cardId)) return chainLink.card;

    if (source && source.zone) {
      try {
        const card = source.zone === ((global.HB_RULES && global.HB_RULES.ZONES && global.HB_RULES.ZONES.FIELD_ZONE) || 'fieldZone')
          ? zoneAccess.getFieldZoneCard(gameState, source.controller)
          : (typeof source.index === 'number' ? zoneAccess.getCardFromZone(gameState, source.controller, source.zone, source.index) : null);
        if (card && (!cardId || getCardId(card) === cardId)) return card;
      } catch (err) {
        console.warn('[effect-context] source에서 카드 확인 중 오류:', err);
      }
    }

    if (cardId) return getCardDef(cardId) || { id: cardId, name: cardId };
    return null;
  }

  function inferCardId(opts) {
    return getCardId(opts.card)
      || getCardId(opts.cardId)
      || (opts.effect && opts.effect.cardId)
      || (opts.event && opts.event.cardId)
      || (opts.chainLink && opts.chainLink.cardId)
      || getCardId(opts.chainLink && opts.chainLink.card)
      || '';
  }

  function inferController(opts) {
    return opts.controller
      || (opts.chainLink && opts.chainLink.controller)
      || (opts.event && opts.event.controller)
      || (opts.effect && opts.effect.controller)
      || CONTROLLERS.ME;
  }

  function createEffectContext(options) {
    const opts = options || {};
    const gameState = resolveGameState(opts.gameState);
    const controller = normalizeController(inferController(opts));
    const opponent = normalizeController(opts.opponent || getOpponent(controller));
    const cardId = inferCardId(opts);
    const source = resolveSource(opts, gameState, controller, cardId);
    const card = resolveCard(opts, gameState, source, cardId);
    const networkMode = inferNetworkMode(opts.networkMode);
    const authority = inferAuthority(opts, controller, gameState);
    const log = makeLogger({
      entries: opts.logEntries,
      prefix: opts.logPrefix || '[effect-context]',
      silent: !!opts.silentLog,
    });
    const random = makeRandom(opts.random);

    const ctx = {
      gameState,
      controller,
      opponent,
      card,
      sourceZone: opts.sourceZone || (source && source.zone) || null,
      sourceIndex: typeof opts.sourceIndex === 'number' ? opts.sourceIndex : (source ? source.index : null),
      sourceController: source ? source.controller : controller,
      source,
      effect: opts.effect || null,
      event: opts.event || null,
      chainLink: opts.chainLink || null,
      targets: asArray(opts.targets),
      selectedCards: asArray(opts.selectedCards),
      networkMode,
      isAI: opts.isAI === true,
      authority,
      log,
      move: null,
      askPlayer: makeAskPlayer(opts.askPlayer),
      random,
    };

    ctx.move = makeMoveProxy(ctx);

    ctx.addTarget = function addTarget(target) {
      ctx.targets.push(target);
      return ctx.targets;
    };

    ctx.setTargets = function setTargets(targets) {
      ctx.targets.length = 0;
      ctx.targets.push.apply(ctx.targets, asArray(targets));
      return ctx.targets;
    };

    ctx.clearTargets = function clearTargets() {
      ctx.targets.length = 0;
      return ctx.targets;
    };

    ctx.with = function withEffectContext(overrides) {
      return createEffectContext(Object.assign({}, opts, {
        gameState: ctx.gameState,
        controller: ctx.controller,
        opponent: ctx.opponent,
        card: ctx.card,
        source: ctx.source,
        sourceZone: ctx.sourceZone,
        sourceIndex: ctx.sourceIndex,
        effect: ctx.effect,
        event: ctx.event,
        chainLink: ctx.chainLink,
        targets: ctx.targets,
        selectedCards: ctx.selectedCards,
        networkMode: ctx.networkMode,
        isAI: ctx.isAI,
        authority: ctx.authority,
        askPlayer: ctx.askPlayer,
        random: ctx.random,
        logEntries: ctx.log.entries,
      }, overrides || {}));
    };

    return ctx;
  }

  function createPreviewContext(options) {
    return createEffectContext(Object.assign({}, options || {}, { authority: false, preview: true }));
  }

  function assertAuthority(ctx) {
    if (!ctx || ctx.authority !== true) {
      throw new Error('[effect-context] authority=true인 컨텍스트에서만 실제 상태 변경을 실행할 수 있습니다.');
    }
    return true;
  }

  function isAuthorityContext(ctx) {
    return !!(ctx && ctx.authority === true);
  }

  global.HB_EFFECT_CONTEXT = Object.freeze({
    createEffectContext,
    buildEffectContext: createEffectContext,
    createPreviewContext,
    assertAuthority,
    isAuthorityContext,
    getOpponent,
  });
})(window);
