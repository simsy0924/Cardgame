// HAND BATTLE — Rule Constants: Effect Tags
// 처리 시 무효, 내성, UI 분류, 테스트 체크리스트가 이 태그를 기준으로 효과를 식별한다.
(function initEffectTags(global) {
  'use strict';

  const rules = global.HB_RULES = global.HB_RULES || {};

  rules.EFFECT_TAGS = Object.freeze({
    MONSTER_SUMMON: 'monsterSummon',
    DECK_SUMMON: 'deckSummon',
    HAND_SUMMON: 'handSummon',
    GRAVE_SUMMON: 'graveSummon',
    EXILE_SUMMON: 'exileSummon',
    KEY_DECK_SUMMON: 'keyDeckSummon',

    DECK_SEARCH: 'deckSearch',
    SEND_MY_FIELD_TO_GRAVE: 'sendMyFieldToGrave',
    SEND_OPPONENT_FIELD_TO_GRAVE: 'sendOpponentFieldToGrave',
    SEND_OPPONENT_MONSTERS_TO_GRAVE: 'sendOpponentMonstersToGrave',

    TARGET_MY_FIELD: 'targetMyField',
    TARGET_OPPONENT_FIELD: 'targetOpponentField',

    DISCARD_HAND: 'discardHand',
    BANISH_FIELD: 'banishField',
    NEGATE_EFFECT: 'negateEffect',
    DRAW: 'draw',

    PLACE_FIELD_CARD: 'placeFieldCard',
    FIELD_CARD_ACTIVATION: 'fieldCardActivation',
    FIELD_ZONE_EFFECT: 'fieldZoneEffect',

    COST_SUMMON: 'costSummon',
    COST_DISCARD: 'costDiscard',
    COST_BANISH: 'costBanish',
    COST_SEND_TO_GRAVE: 'costSendToGrave',
  });
})(window);
