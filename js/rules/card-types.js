// HAND BATTLE — Rule Constants: Card Types
// 키 카드는 타입이 아니라 card.isKeyCard === true 로 판정한다.
(function initCardTypes(global) {
  'use strict';

  const rules = global.HB_RULES = global.HB_RULES || {};

  rules.CARD_TYPES = Object.freeze({
    MONSTER: 'monster',
    NORMAL: 'normal',
    MAGIC: 'magic',
    TRAP: 'trap',
    FIELD: 'field',
  });
})(window);
