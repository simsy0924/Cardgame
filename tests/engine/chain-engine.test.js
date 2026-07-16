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
  ctx.HB_CHAIN_ENGINE.resolveChain({ gameState: activationState, controller: 'me', authority: true });

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

  // [회귀] 지연 해결(응답 창이 열린 뒤 별도 resolveChain) 경로에서, 발동 시 저장한
  // 사용자 선택(selectedCards)이 체인 링크로부터 resolve ctx로 복원되는지 검증한다.
  // 복원이 누락되면 firstOrSelected/chooseCards가 candidates[0]로 떨어져
  // "고른 것과 다른 카드"가 처리되는 버그가 난다.
  ctx.HB_CHAIN_ENGINE.resolveChain({ gameState: state, controller: 'me', authority: true }); // 잔여 링크 정리
  const selState = makeState({ myHand: [makeCard('꼬마 펭귄')] });
  ctx.G = selState;
  let seenSelected = null;
  const selEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-chain-selectedcards-restore',
    cardId: '꼬마 펭귄',
    type: 'activation',
    zone: 'hand',
    resolve(rctx) { seenSelected = (rctx.selectedCards || []).map(c => c.id); return true; },
  }, { replace: true });
  const selActivated = ctx.HB_CHAIN_ENGINE.activateEffect({
    gameState: selState,
    controller: 'me',
    sourceZone: 'hand',
    sourceIndex: 0,
    card: selState.myHand[0],
    effect: selEffect,
    activationData: { selectedCards: [{ id: '꼬마 펭귄' }] },
  });
  assert(selActivated.ok, `selectedCards activation failed: ${selActivated.error}`);
  const selResolved = ctx.HB_CHAIN_ENGINE.resolveChain({ gameState: selState, controller: 'me', authority: true });
  assert(selResolved.ok, `resolveChain (selectedCards) failed: ${selResolved.error}`);
  assertEqual((seenSelected || []).join(','), '꼬마 펭귄', 'resolve must receive selectedCards restored from chain link (deferred path)');

  // [회귀] 우선권 사이클: 발동자는 발동 직후 자동 패스되지 않는다. 상대가 패스하면
  // 우선권이 발동자에게 복귀하고, 양쪽이 패스해야(passCount>=2) 최종 처리된다.
  // (이전엔 effect-ui가 발동자를 선패스시켜, 상대의 단일 패스만으로 즉시 해결돼
  //  발동자에게 우선권이 돌아오지 않았다.)
  ctx.HB_CHAIN_ENGINE.resolveChain({ gameState: selState, controller: 'me', authority: true }); // 잔여 정리
  ctx.AI = { active: true }; // 상대 존재 → 즉시 해결이 아니라 응답창을 연다
  const prState = makeState({ myHand: [makeCard('꼬마 펭귄')] });
  ctx.G = prState;
  let prResolved = 0;
  const prEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-priority-no-autopass',
    cardId: '꼬마 펭귄',
    type: 'activation',
    zone: 'hand',
    resolve() { prResolved += 1; return true; },
  }, { replace: true });
  const prCtx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
    gameState: prState, controller: 'me', sourceZone: 'hand', sourceIndex: 0,
    card: prState.myHand[0], cardId: '꼬마 펭귄', effect: prEffect,
  });
  ctx.HB_EFFECT_UI.activateAvailableEffect({ effect: prEffect, ctx: prCtx }, { gameState: prState, controller: 'me', player: 'me' });

  let pcs = ctx.HB_CHAIN_ENGINE.getChainState();
  assert(pcs.active, 'priority: chain must stay open after activation when opponent present');
  assertEqual(pcs.passCount, 0, 'priority: activator must NOT be auto-passed (passCount stays 0)');
  assertEqual(pcs.priority, 'opponent', 'priority: priority goes to opponent after activation');
  assertEqual(prResolved, 0, 'priority: must not resolve before both players pass');

  ctx.HB_CHAIN_ENGINE.passChainResponse('opponent');
  pcs = ctx.HB_CHAIN_ENGINE.getChainState();
  assert(pcs.active, 'priority: chain still open after opponent single pass');
  assertEqual(pcs.priority, 'me', 'priority: returns to activator after opponent passes');
  assertEqual(prResolved, 0, 'priority: still not resolved after one pass');

  ctx.HB_CHAIN_ENGINE.passChainResponse('me');
  assertEqual(prResolved, 1, 'priority: resolves only after both players pass (passCount>=2)');
  delete ctx.AI;

  // 네트워크 왕복: 절대 역할이 포함된 export/import를 통해 양쪽 클라이언트가
  // 동일한 링크 수, 우선권, 패스 횟수를 이어받아야 한다.
  ctx.HB_CHAIN_ENGINE.clearChain();
  ctx.myRole = 'host';
  ctx.opRole = 'guest';
  const netState = makeState({ myHand: [makeCard('꼬마 펭귄')] });
  ctx.G = netState;
  const networkOrder = [];
  const hostEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-network-chain-host',
    cardId: '꼬마 펭귄',
    type: 'activation',
    zone: 'hand',
    resolve() { networkOrder.push('host'); return true; },
  }, { replace: true });
  const guestEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-network-chain-guest',
    cardId: '꼬마 펭귄',
    type: 'quick',
    zone: 'hand',
    resolve() { networkOrder.push('guest'); return true; },
  }, { replace: true });
  const hostActivation = ctx.HB_CHAIN_ENGINE.activateEffect({
    gameState: netState, controller: 'me', sourceZone: 'hand',
    card: netState.myHand[0], effect: hostEffect,
  });
  assert(hostActivation.ok, `host network activation failed: ${hostActivation.error}`);
  const exportedByHost = ctx.HB_CHAIN_ENGINE.exportChainState();
  assertEqual(exportedByHost.priorityRole, 'guest', 'export must store absolute priority role');

  ctx.myRole = 'guest';
  ctx.opRole = 'host';
  const importedByGuest = ctx.HB_CHAIN_ENGINE.importChainState(exportedByHost);
  assert(importedByGuest.ok, `guest import failed: ${importedByGuest.error}`);
  let networkChain = ctx.HB_CHAIN_ENGINE.getChainState();
  assertEqual(networkChain.links[0].controller, 'opponent', 'remote host link must map to opponent for guest');
  assertEqual(networkChain.priority, 'me', 'guest must receive priority after host activation');
  const guestActivation = ctx.HB_CHAIN_ENGINE.activateEffect({
    gameState: netState, controller: 'me', sourceZone: 'hand',
    card: netState.myHand[0], effect: guestEffect,
  });
  assert(guestActivation.ok, `guest network activation failed: ${guestActivation.error}`);

  const exportedByGuest = ctx.HB_CHAIN_ENGINE.exportChainState();
  ctx.myRole = 'host';
  ctx.opRole = 'guest';
  const importedBackByHost = ctx.HB_CHAIN_ENGINE.importChainState(exportedByGuest);
  assert(importedBackByHost.ok, `host re-import failed: ${importedBackByHost.error}`);
  networkChain = ctx.HB_CHAIN_ENGINE.getChainState();
  assertEqual(networkChain.links.length, 2, 'both clients must keep the same two links');
  assertEqual(networkChain.priority, 'me', 'priority must return to host after guest response');
  const firstNetworkPass = ctx.HB_CHAIN_ENGINE.passChainResponse('me');
  assert(firstNetworkPass.ok, `host pass failed: ${firstNetworkPass.error}`);
  const afterHostPass = ctx.HB_CHAIN_ENGINE.exportChainState();

  ctx.myRole = 'guest';
  ctx.opRole = 'host';
  ctx.HB_CHAIN_ENGINE.importChainState(afterHostPass);
  const secondNetworkPass = ctx.HB_CHAIN_ENGINE.passChainResponse('me');
  assert(secondNetworkPass.ok, `guest pass failed: ${secondNetworkPass.error}`);
  assertEqual(networkOrder.join(','), 'guest,host', 'imported network chain must resolve once in LIFO order');
};
