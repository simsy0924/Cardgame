const { createContext, loadCore, makeCard, makeState, assert, assertEqual } = require('./_setup');

// Phase 0 — 출처 효과 메타 배선:
// 효과 컨텍스트의 move가 일으킨 이벤트는 "어떤 효과가 일으켰는지"(sourceEffectId/sourceCardId)를 싣는다.
module.exports = function runSourceEffectMetadataTests() {
  const ctx = loadCore(createContext());

  // 1) 효과 컨텍스트를 통한 이동은 출처 효과 메타를 이벤트에 싣는다.
  const state = makeState({ myHand: [makeCard('테스트몬스터')] });
  ctx.G = state;
  const effect = { id: 'test-source-effect', cardId: '테스트소스카드' };
  const ectx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
    gameState: state,
    controller: 'me',
    sourceZone: 'hand',
    card: makeCard('테스트소스카드'),
    effect,
    authority: true,
  });
  const summoned = ectx.move.summonCard({ cardId: '테스트몬스터', from: { controller: 'me', zone: 'hand' } });
  assert(summoned.ok, `summon via effect context failed: ${summoned.error}`);
  assert(summoned.event, 'effect-context move should return an emitted event');
  assertEqual(summoned.event.sourceEffectId, 'test-source-effect', 'move event must carry source effect id');
  assertEqual(summoned.event.sourceCardId, '테스트소스카드', 'move event must carry source card id');

  // 2) 출처 효과 없이 직접 이동하면 sourceEffectId를 만들어내지 않는다(회귀 방지).
  const plainState = makeState({ myHand: [makeCard('직접소환')] });
  const plain = ctx.HB_CARD_MOVE.summonCard({
    gameState: plainState,
    controller: 'me',
    cardId: '직접소환',
    from: { controller: 'me', zone: 'hand' },
  });
  assert(plain.ok, `direct summon failed: ${plain.error}`);
  assert(plain.event.sourceEffectId == null, 'direct move without effect must not fabricate a source effect id');

  // 3) event-bus.normalizeEvent는 중첩 eventData의 출처 메타를 최상위로 끌어올린다.
  ctx.HB_EVENTS.clearPendingEvents();
  const normalized = ctx.HB_EVENTS.emitGameEvent({
    type: 'summon',
    eventData: { sourceEffectId: 'nested-effect', sourceCardId: 'nested-card' },
  });
  assertEqual(normalized.sourceEffectId, 'nested-effect', 'normalizeEvent should hoist nested sourceEffectId');
  assertEqual(normalized.sourceCardId, 'nested-card', 'normalizeEvent should hoist nested sourceCardId');
  ctx.HB_EVENTS.clearPendingEvents();
};
