// HAND BATTLE — Rule Constants: Phases
(function initPhases(global) {
  'use strict';

  const rules = global.HB_RULES = global.HB_RULES || {};

  rules.PHASES = Object.freeze({
    DRAW: 'draw',
    DEPLOY: 'deploy',
    BATTLE: 'battle',
    END: 'end',
  });
})(window);
