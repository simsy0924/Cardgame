// HAND BATTLE — Rule Constants: Events
// 카드 이동 엔진과 유발 효과 큐는 이 이벤트명을 기준으로 연결한다.
(function initEvents(global) {
  'use strict';

  const rules = global.HB_RULES = global.HB_RULES || {};

  rules.EVENTS = Object.freeze({
    SUMMON: 'summon',
    SENT_TO_GRAVE: 'sentToGrave',
    EXILED: 'exiled',
    ADDED_TO_HAND: 'addedToHand',
    DISCARDED: 'discarded',
    FIELD_CARD_PLACED: 'fieldCardPlaced',
    FIELD_CARD_LEFT: 'fieldCardLeft',
    CHAIN_LINK_RESOLVED: 'chainLinkResolved',
    CARD_ACTIVATED: 'cardActivated',
    EFFECT_NEGATED: 'effectNegated',
  });
})(window);
