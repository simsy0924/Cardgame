// processing-negate.js — 체인 해제 중 "처리 시 무효" 전용 엔진
// 일반 체인 응답이 아니라, 각 체인 링크가 실제로 resolve되기 직전에 조건을 확인한다.
(function() {
  'use strict';

  const ENGINE = window.ProcessingNegateEngine = window.ProcessingNegateEngine || {};
  const ENTRIES = ENGINE.entries = ENGINE.entries || [];

  function safeLog(msg, side) {
    if (typeof log === 'function') log(msg, side || 'system');
    else console.log('[ProcessingNegate]', msg);
  }
  function safeNotify(msg) {
    if (typeof notify === 'function') notify(msg);
    else console.log('[ProcessingNegate]', msg);
  }
  function cardName(id) {
    return (window.CARDS && CARDS[id] && CARDS[id].name) || id;
  }
  function getMyFieldCard(cardId) {
    if (!window.G) return null;
    return (G.myField || []).find(c => c && c.id === cardId) || null;
  }
  function hasMyFieldCard(cardId) {
    return !!getMyFieldCard(cardId);
  }
  function canUseEntry(e, ctx) {
    if (!e) return false;
    if (e.requireField !== false && !hasMyFieldCard(e.cardId)) return false;
    if (typeof canUseEffect === 'function' && !canUseEffect(e.cardId, e.effectNum, e.maxPerTurn || 1)) return false;
    if (typeof e.condition === 'function') {
      try { if (!e.condition(ctx)) return false; }
      catch (err) { console.warn('[ProcessingNegate] condition 오류:', e, err); return false; }
    }
    return true;
  }

  ENGINE.register = function registerProcessingNegate(entry) {
    if (!entry || !entry.cardId || !entry.effectNum) {
      console.warn('[ProcessingNegate] 잘못된 등록:', entry);
      return null;
    }
    const normalized = Object.assign({
      id: entry.id || (entry.cardId + '_' + entry.effectNum + '_processing_negate'),
      label: entry.label || (cardName(entry.cardId) + ' ' + entry.effectNum + ' 처리 시 무효'),
      tags: [],
      maxPerTurn: 1,
      requireField: true,
      condition: null,
      resolve: null,
    }, entry);
    const idx = ENTRIES.findIndex(e => e.id === normalized.id);
    if (idx >= 0) ENTRIES[idx] = normalized;
    else ENTRIES.push(normalized);
    return normalized;
  };

  ENGINE.registerMany = function registerManyProcessingNegates(entries) {
    (entries || []).forEach(ENGINE.register);
  };

  function addTag(tags, tag) {
    if (!tags.includes(tag)) tags.push(tag);
  }

  ENGINE.inferTags = function inferTags(link) {
    const tags = [];
    if (!link) return tags;
    (link.effectTags || link.tags || []).forEach(t => addTag(tags, String(t)));

    const type = String(link.type || '');
    const label = String(link.label || '');
    const effectId = String(link.effectId || '');
    const text = `${type} ${label} ${effectId}`.toLowerCase();
    const ko = `${type} ${label} ${effectId}`;

    if (type === 'keyFetch' || /search|fetch|add.*hand/i.test(text) || ko.includes('서치') || ko.includes('패에 넣')) addTag(tags, 'deckSearch');
    if (/summon.*deck|deck.*summon|aiSummonDeck/i.test(text) || (ko.includes('덱') && ko.includes('소환'))) addTag(tags, 'deckSummon');
    if (/discard|forceDiscard|버리/.test(text) || ko.includes('버리')) addTag(tags, 'discardHand');
    if (/targetMyField|targetField|대상/.test(text) || ko.includes('대상')) addTag(tags, 'targetMyField');
    if (/send.*field.*grave|grave.*field|field.*grave|묘지/.test(text) && (ko.includes('필드') || /field/i.test(text))) addTag(tags, 'sendMyFieldToGrave');
    if (/destroy|파괴/.test(text) && (ko.includes('필드') || /field/i.test(text))) addTag(tags, 'sendMyFieldToGrave');
    if (/return.*hand|패로 되돌/.test(text) && (ko.includes('필드') || /field/i.test(text))) addTag(tags, 'targetMyField');
    if (/exile|banish|제외/.test(text) && (ko.includes('필드') || /field/i.test(text))) addTag(tags, 'targetMyField');

    return tags;
  };

  ENGINE.hasAnyTag = function hasAnyTag(link, requiredTags) {
    const required = Array.isArray(requiredTags) ? requiredTags : [requiredTags];
    if (!required.length || required.includes('*')) return true;
    const tags = ENGINE.inferTags(link);
    return required.some(t => tags.includes(t));
  };

  function isOpponentLink(link) {
    if (!link) return false;
    if (typeof myRole === 'undefined') return true;
    return link.by !== myRole;
  }

  function buildContext(link, meta) {
    return {
      link,
      links: meta && meta.links || [],
      index: meta && meta.index,
      tags: ENGINE.inferTags(link),
      isOpponentLink: isOpponentLink(link),
      cardOnField(cardId) { return getMyFieldCard(cardId); },
      hasTag(tag) { return ENGINE.hasAnyTag(link, tag); },
      hasAnyTag(tags) { return ENGINE.hasAnyTag(link, tags); },
    };
  }

  function askYesNo(message, cb) {
    if (typeof gameConfirm === 'function') {
      gameConfirm(message, cb);
      return;
    }
    const ok = window.confirm ? window.confirm(message) : false;
    cb(!!ok);
  }

  function chooseEntry(options, ctx, cb) {
    if (!options.length) { cb(null); return; }
    if (options.length === 1) {
      askYesNo(`${options[0].label}\n이 효과의 처리 시 무효로 합니까?`, yes => cb(yes ? options[0] : null));
      return;
    }
    const display = options.map(o => ({ id: o.cardId, name: o.label }));
    if (typeof openCardPicker === 'function') {
      openCardPicker(display, '처리 시 무효로 발동할 효과 선택', 1, sel => {
        if (!sel || !sel.length) { cb(null); return; }
        cb(options[sel[0]] || null);
      }, true);
    } else {
      askYesNo(`${options.map(o => o.label).join('\n')}\n처리 시 무효를 발동합니까?`, yes => cb(yes ? options[0] : null));
    }
  }

  ENGINE.getOptionsForLink = function getProcessingNegateOptions(link, meta) {
    if (link.processingNegated || link.negated) return [];
    const ctx = buildContext(link, meta || {});
    return ENTRIES.filter(e => {
      // 기본값은 기존 불가사의처럼 상대 효과만 검사한다.
      // 태평양 속 르뤼에 ③처럼 자신 효과 처리 시 무효가 필요한 카드는 allowOwn:true로 등록한다.
      if (!ctx.isOpponentLink && !e.allowOwn) return false;
      if (ctx.isOpponentLink && e.onlyOwn) return false;
      if (!canUseEntry(e, ctx)) return false;
      if (e.tags && e.tags.length && !ENGINE.hasAnyTag(link, e.tags)) return false;
      return true;
    });
  };

  ENGINE.beforeResolveLink = function beforeResolveLink(link, meta, done) {
    const cb = typeof done === 'function' ? done : function(){};
    const options = ENGINE.getOptionsForLink(link, meta);
    if (!options.length) { cb(false); return false; }

    const ctx = buildContext(link, meta || {});
    chooseEntry(options, ctx, entry => {
      if (!entry) { cb(false); return; }
      if (typeof markEffectUsed === 'function') markEffectUsed(entry.cardId, entry.effectNum);
      link.processingNegated = true;
      link.processingNegatedBy = entry.cardId;

      if (typeof entry.resolve === 'function') {
        try { entry.resolve(ctx); }
        catch (err) { console.warn('[ProcessingNegate] resolve 오류:', entry, err); }
      }

      safeLog(`${entry.label}: ${link.label || link.type} 처리 시 무효`, 'mine');
      if (typeof sendAction === 'function') {
        sendAction({
          type: 'processingNegate',
          reason: entry.label,
          sourceCardId: entry.cardId,
          sourceEffectNum: entry.effectNum,
          targetLabel: link.label || link.type,
          targetType: link.type || '',
          targetEffectId: link.effectId || '',
        });
      }
      if (typeof sendGameState === 'function') sendGameState();
      if (typeof renderAll === 'function') renderAll();
      cb(true, entry);
    });
    return true;
  };
})();
