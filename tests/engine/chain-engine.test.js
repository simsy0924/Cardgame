const { createContext, loadCore, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runChainEngineTests() {
  const ctx = loadCore(createContext());
  const state = makeState({ myHand: [makeCard('cost-card')] });
  ctx.G = state;

  const falseEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-chain-cannot-resolve',
    cardId: '꼬마 펭귄',
    type: 'activation',
    zone: 'hand',
    canResolve() { return false; },
    resolve() { throw new Error('must not resolve'); },
  }, { replace: true });
  const blocked = ctx.HB_CHAIN_ENGINE.canActivateEffect({ gameState: state, controller: 'me', sourceZone: 'hand', card: makeCard('꼬마 펭귄') }, falseEffect);
  assert(!blocked.ok, 'canResolve=false effect should not be activatable');

  const order = [];
  const first = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-chain-first',
    cardId: '꼬마 펭귄',
    type: 'activation',
    zone: 'hand',
    cost() { order.push('cost1'); return true; },
    resolve() { order.push('resolve1'); return true; },
  }, { replace: true });
  const second = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-chain-second',
    cardId: '꼬마 펭귄',
    type: 'activation',
    zone: 'hand',
    resolve() { order.push('resolve2'); return true; },
  }, { replace: true });

  const c1 = ctx.HB_EFFECT_CONTEXT.createEffectContext({ gameState: state, controller: 'me', sourceZone: 'hand', card: makeCard('꼬마 펭귄'), effect: first });
  const c2 = ctx.HB_EFFECT_CONTEXT.createEffectContext({ gameState: state, controller: 'opponent', sourceZone: 'hand', card: makeCard('꼬마 펭귄'), effect: second });
  const activated1 = ctx.HB_CHAIN_ENGINE.activateEffect(c1, first);
  assert(activated1.ok, `activate first failed: ${activated1.error}`);
  assertEqual(order[0], 'cost1', 'cost must be paid before chain resolve');
  const activated2 = ctx.HB_CHAIN_ENGINE.activateEffect(c2, second);
  assert(activated2.ok, `activate second failed: ${activated2.error}`);

  const resolved = ctx.HB_CHAIN_ENGINE.resolveChain({ gameState: state, controller: 'me', authority: true });
  assert(resolved.ok, `resolveChain failed: ${resolved.error}`);
  assertEqual(order.join(','), 'cost1,resolve2,resolve1', 'chain should resolve in LIFO order after cost payment');



  const activationState = makeState({
    myHand: [makeCard('펭귄!돌격!'), makeCard('꼬마 펭귄')],
    myGrave: [],
  });
  ctx.G = activationState;
  const activationCostEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-card-activation-cost-normal-card',
    cardId: '펭귄!돌격!',
    type: 'activation',
    zone: 'hand',
    cardActivationCost: true,
    cost(costCtx) {
      assert(!costCtx.gameState.myHand.some(card => card.id === '펭귄!돌격!'), 'card activation cost should be paid before additional cost');
      return true;
    },
    resolve() { return true; },
  }, { replace: true });
  const activatedByCardCost = ctx.HB_CHAIN_ENGINE.activateEffect({
    gameState: activationState,
    controller: 'me',
    sourceZone: 'hand',
    sourceIndex: 0,
    card: activationState.myHand[0],
    effect: activationCostEffect,
  }, activationCostEffect);
  assert(activatedByCardCost.ok, `card activation cost failed: ${activatedByCardCost.error}`);
  assert(!activationState.myHand.some(card => card.id === '펭귄!돌격!'), 'activated normal card should leave hand');
  assert(activationState.myGrave.some(card => card.id === '펭귄!돌격!'), 'activated normal card should be sent to grave as cost');

  const noActivationCostState = makeState({ myHand: [makeCard('펭귄 마을')], myGrave: [] });
  ctx.G = noActivationCostState;
  const revealEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-no-card-activation-cost-reveal',
    cardId: '펭귄 마을',
    type: 'activation',
    zone: 'hand',
    resolve() { return true; },
  }, { replace: true });
  const revealActivated = ctx.HB_CHAIN_ENGINE.activateEffect({
    gameState: noActivationCostState,
    controller: 'me',
    sourceZone: 'hand',
    sourceIndex: 0,
    card: noActivationCostState.myHand[0],
    effect: revealEffect,
  }, revealEffect);
  assert(revealActivated.ok, `no activation cost effect failed: ${revealActivated.error}`);
  assert(noActivationCostState.myHand.some(card => card.id === '펭귄 마을'), 'effect without cardActivationCost should remain in hand');

  const procedure = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-chain-procedure',
    cardId: '꼬마 펭귄',
    type: 'procedure',
    zone: 'hand',
    summonProcedure: { type: 'test' },
  }, { replace: true });
  const procResult = ctx.HB_CHAIN_ENGINE.canActivateEffect({ gameState: state, controller: 'me', sourceZone: 'hand', card: makeCard('꼬마 펭귄') }, procedure);
  assert(!procResult.ok, 'procedure should not be chainable');
};