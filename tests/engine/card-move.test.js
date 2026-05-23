const { createContext, loadCore, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runCardMoveTests() {
  const ctx = loadCore(createContext());
  const state = makeState({
    myHand: [makeCard('꼬마 펭귄')],
    opField: [makeCard('상대 몬스터', { atk: 1 })],
  });
  ctx.G = state;

  const summoned = ctx.HB_CARD_MOVE.summonCard({
    gameState: state,
    controller: 'me',
    cardId: '꼬마 펭귄',
    from: { controller: 'me', zone: 'hand' },
  });
  assert(summoned.ok, `summonCard failed: ${summoned.error}`);
  assertEqual(state.myHand.length, 0, 'summon should remove card from hand');
  assertEqual(state.myField.length, 1, 'summon should add card to field');
  assertEqual(summoned.event.type, 'summon', 'summon should emit summon event');

  const sent = ctx.HB_CARD_MOVE.sendToGrave({
    gameState: state,
    controller: 'opponent',
    cardId: '상대 몬스터',
    from: { controller: 'opponent', zone: 'field' },
  });
  assert(sent.ok, `sendToGrave failed: ${sent.error}`);
  assertEqual(state.opField.length, 0, 'sendToGrave should remove card from opponent field');
  assertEqual(state.opGrave.length, 1, 'sendToGrave should add card to opponent grave');
  assertEqual(sent.event.type, 'sentToGrave', 'sendToGrave should emit sentToGrave event');

  const full = makeState({ myHand: [makeCard('꼬마 펭귄')], myField: [1,2,3,4,5].map(i => makeCard(`m${i}`)) });
  const failed = ctx.HB_CARD_MOVE.summonCard({
    gameState: full,
    controller: 'me',
    cardId: '꼬마 펭귄',
    from: { controller: 'me', zone: 'hand' },
  });
  assert(!failed.ok, 'summon should fail when monster zone is full');

  ctx.HB_TRIGGER_QUEUE.clearTriggerQueue();
  ctx.HB_EVENTS.clearPendingEvents();
  ctx.HB_EFFECT_REGISTRY.registerEffects([{
    id: 'auto-dispatch-trigger',
    cardId: 'listener',
    type: 'trigger',
    zones: ['field'],
    events: ['summon'],
    optional: true,
    condition() { return true; },
    canResolve() { return true; },
    resolve() { return true; },
  }], { replace: true });

  const autoDispatchState = makeState({
    myHand: [makeCard('summoned')],
    myField: [makeCard('listener')],
  });
  const autoDispatch = ctx.HB_CARD_MOVE.summonCard({
    gameState: autoDispatchState,
    controller: 'me',
    cardId: 'summoned',
    from: { controller: 'me', zone: 'hand' },
  });
  assert(autoDispatch.ok, `auto dispatch summon failed: ${autoDispatch.error}`);
  assertEqual(ctx.HB_EVENTS.getPendingEvents().length, 0, 'card moves outside a chain should dispatch pending events');
  assertEqual(ctx.HB_TRIGGER_QUEUE.getQueueState().optional.length, 1, 'summon trigger should be queued after automatic dispatch');

  ctx.HB_TRIGGER_QUEUE.clearTriggerQueue();
  ctx.HB_EVENTS.clearPendingEvents();
  ctx.activeChainState = { active: true };
  const deferredState = makeState({
    myHand: [makeCard('deferred-summoned')],
    myField: [makeCard('listener')],
  });
  const deferred = ctx.HB_CARD_MOVE.summonCard({
    gameState: deferredState,
    controller: 'me',
    cardId: 'deferred-summoned',
    from: { controller: 'me', zone: 'hand' },
  });
  assert(deferred.ok, `deferred summon failed: ${deferred.error}`);
  assertEqual(ctx.HB_EVENTS.getPendingEvents().length, 1, 'card moves during a chain should keep events pending');
  assertEqual(ctx.HB_TRIGGER_QUEUE.getQueueState().optional.length, 0, 'chain-deferred move should not enqueue triggers early');
  ctx.activeChainState = null;
  ctx.HB_EVENTS.dispatchEvents(deferredState);
  assertEqual(ctx.HB_TRIGGER_QUEUE.getQueueState().optional.length, 1, 'deferred move event should enqueue after explicit dispatch');

  const duplicateState = makeState({
    myDeck: [makeCard('duplicate', { name: 'first copy' }), makeCard('duplicate', { name: 'second copy' })],
  });
  const indexedMove = ctx.HB_CARD_MOVE.addToHand({
    gameState: duplicateState,
    controller: 'me',
    cardId: 'duplicate',
    from: { controller: 'me', zone: 'deck', index: 1 },
    reveal: true,
  });
  assert(indexedMove.ok, `indexed addToHand failed: ${indexedMove.error}`);
  assertEqual(duplicateState.myDeck.length, 1, 'indexed move should remove exactly one duplicate');
  assertEqual(duplicateState.myDeck[0].name, 'first copy', 'indexed move should remove the requested duplicate copy');
};
