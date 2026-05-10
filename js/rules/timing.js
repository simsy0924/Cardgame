// HAND BATTLE — Rule Constants: Effect Timing
(function initTiming(global) {
  'use strict';

  const rules = global.HB_RULES = global.HB_RULES || {};

  rules.TIMING = Object.freeze({
    MY_DEPLOY: 'myDeploy',
    OPPONENT_DEPLOY: 'opponentDeploy',
    MY_TURN: 'myTurn',
    OPPONENT_TURN: 'opponentTurn',
    EITHER_TURN: 'eitherTurn',
    ON_SUMMON: 'onSummon',
    ON_SENT_TO_GRAVE: 'onSentToGrave',
    ON_EXILED: 'onExiled',
    NONE: 'none',
  });
})(window);
