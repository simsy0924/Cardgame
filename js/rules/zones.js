// HAND BATTLE — Rule Constants: Zones
// 내부 로직은 가능하면 controller + zone 조합으로 처리한다.
(function initZones(global) {
  'use strict';

  const rules = global.HB_RULES = global.HB_RULES || {};

  rules.ZONES = Object.freeze({
    DECK: 'deck',
    HAND: 'hand',
    PUBLIC_HAND: 'publicHand',
    FIELD: 'field',
    FIELD_ZONE: 'fieldZone',
    GRAVE: 'grave',
    EXILE: 'exile',
    KEY_DECK: 'keyDeck',

    // 임시 호환/표시용 별칭. 신규 엔진 내부에서는 controller + zone 사용을 우선한다.
    OPPONENT_FIELD: 'opponentField',
    OPPONENT_FIELD_ZONE: 'opponentFieldZone',
  });
})(window);
