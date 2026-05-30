const { createContext, loadCore, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runTriggerQueueTests() {
  const ctx = loadCore(createContext());
  const state = makeState({ myField: [makeCard('테스트 유발 카드')] });
  ctx.G = state;

  ctx.HB_EFFECT_REGISTRY.registerEffects([
    {
      id: 'test-trigger-optional',
      cardId: '테스트 유발 카드',
      type: 'trigger',
      zone: 'field',
      event: 'summon',
      optional: true,
      canResolve() { return true; },
      resolve() { return true; },
    },
    {
      id: 'test-trigger-mandatory',
      cardId: '테스트 유발 카드',
      type: 'trigger',
      zone: 'field',
      event: 'summon',
      optional: false,
      canResolve() { return true; },
      resolve() { return true; },
    },
    {
      id: 'test-trigger-cannot-resolve',
      cardId: '테스트 유발 카드',
      type: 'trigger',
      zone: 'field',
      event: 'summon',
      optional: true,
      canResolve() { return false; },
      resolve() { throw new Error('must not resolve'); },
    },
    {
      id: 'test-trigger-continuous-excluded',
      cardId: '테스트 유발 카드',
      type: 'continuous',
      zone: 'field',
      event: 'summon',
      continuousRule: { kind: 'test' },
    },
  ], { replace: true });

  const collected = ctx.HB_TRIGGER_QUEUE.collectTriggers({ type: 'summon', cardId: 'x', controller: 'me' }, state);
  const ids = collected.map(entry => entry.effectId);
  assert(ids.includes('test-trigger-optional'), 'optional trigger should be collected');
  assert(ids.includes('test-trigger-mandatory'), 'mandatory trigger should be collected');
  assert(!ids.includes('test-trigger-cannot-resolve'), 'canResolve=false trigger should not be collected');
  assert(!ids.includes('test-trigger-continuous-excluded'), 'continuous effect should not be collected as trigger');

  ctx.HB_TRIGGER_QUEUE.clearTriggerQueue();
  const result = ctx.HB_TRIGGER_QUEUE.enqueueEvent({ type: 'summon', cardId: 'x', controller: 'me' }, state);
  assert(result.ok, `enqueueEvent failed: ${result.error}`);
  const queue = ctx.HB_TRIGGER_QUEUE.getQueueState();
  assertEqual(queue.optional.length, 1, 'optional queue should contain one entry');

  // [H1] 공개 패(PUBLIC_HAND) 트리거가 reveal addToHand 경로로 발동하는지 검증.
  // 젊은 라이온 ① 류: zones:[publicHand] + addedToHand. 레거시 direct-push가
  // 이 이벤트를 건너뛰면 트리거가 조용히 안 터지는 H1을 막기 위한 회귀 테스트다.
  ctx.HB_TRIGGER_QUEUE.clearTriggerQueue();
  const phState = makeState({ myDeck: [makeCard('테스트 공개패 카드')] });
  ctx.G = phState;
  ctx.HB_EFFECT_REGISTRY.registerEffects([{
    id: 'test-public-hand-trigger',
    cardId: '테스트 공개패 카드',
    type: 'trigger',
    zone: 'publicHand',
    event: 'addedToHand',
    optional: true,
    condition: c => !!(c && c.event && c.event.cardId === '테스트 공개패 카드'),
    canResolve() { return true; },
    resolve() { return true; },
  }], { replace: true });

  // reveal=true로 패에 추가 → 공개 패(PUBLIC_HAND)로 이동 + addedToHand 이벤트 발행
  const phMove = ctx.HB_CARD_MOVE.addToHand({ gameState: phState, controller: 'me', cardId: '테스트 공개패 카드', from: { controller: 'me', zone: 'deck' }, reveal: true, reason: 'h1-test' });
  assert(phMove && phMove.ok !== false, `addToHand(reveal) failed: ${phMove && phMove.error}`);
  const inPublic = ctx.HB_ZONE_ACCESS.getZoneArray(phState, 'me', 'publicHand').some(c => c && c.id === '테스트 공개패 카드');
  assert(inPublic, 'reveal addToHand으로 카드가 공개 패에 들어가야 한다');

  const phTriggers = ctx.HB_TRIGGER_QUEUE.collectTriggers({ type: 'addedToHand', cardId: '테스트 공개패 카드', controller: 'me', to: { controller: 'me', zone: 'publicHand' } }, phState);
  assert(phTriggers.map(e => e.effectId).includes('test-public-hand-trigger'), '공개 패 트리거가 addedToHand 이벤트로 수집되어야 한다(H1)');
};
