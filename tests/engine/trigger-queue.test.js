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
};
