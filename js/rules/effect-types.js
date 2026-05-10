// HAND BATTLE — Rule Constants: Effect Types
// 신규 효과 구현은 문자열 하드코딩 대신 window.HB_RULES.EFFECT_TYPES를 사용한다.
// 이 파일은 ES module이 아닌 기존 script 로딩 환경에 맞춰 전역 네임스페이스만 만든다.
(function initEffectTypes(global) {
  'use strict';

  const rules = global.HB_RULES = global.HB_RULES || {};

  rules.EFFECT_TYPES = Object.freeze({
    ACTIVATION: 'activation',
    QUICK: 'quick',
    TRIGGER: 'trigger',
    CONTINUOUS: 'continuous',
    PROCEDURE: 'procedure',
    REPLACEMENT: 'replacement',
    PROCESSING_NEGATE: 'processingNegate',
  });
})(window);
