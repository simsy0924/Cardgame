const { createContext, loadCore, runFile, makeState, assert, assertEqual } = require('./_setup');

module.exports = function testFullChainMigration() {
  const ctx = createContext();
  loadCore(ctx);
  ctx.G = makeState({ myHand: [], myDeck: [{ id: 'dummy', name: 'dummy' }] });
  ctx.myRole = 'host';
  ctx.opRole = 'guest';
  ctx.isMyTurn = true;
  ctx.currentPhase = 'deploy';
  ctx.activeChainState = null;
  ctx.pendingTriggerEffects = [];
  ctx.usedKeyFetchInChain = {};
  ctx.window._chainResolving = false;
  let drawn = 0;
  ctx.drawOne = function drawOne() { drawn += 1; return { ok: true }; };
  ctx.drawN = function drawN(n) { drawn += Number(n || 1); return { ok: true }; };
  ctx.renderChainActions = function renderChainActions() {};
  ctx.syncClockRunState = function syncClockRunState() {};
  ctx.sendGameState = function sendGameState() {};
  ctx.renderAll = function renderAll() {};
  ctx.log = function log() {};
  ctx.notify = function notify() {};

  runFile(ctx, 'js/effects-chain.js');

  assert(ctx.HB_LEGACY_CHAIN_ADAPTER, 'legacy chain adapter must be exposed');
  assertEqual(ctx.HB_CHAIN_ENGINE.hasActiveChain(), false, 'chain starts inactive');

  ctx.beginChain({ type: 'jarDraw1', label: '서치 봉인의 항아리 ①' });
  assertEqual(ctx.HB_CHAIN_ENGINE.hasActiveChain(), true, 'legacy beginChain must open HB chain');
  assert(ctx.activeChainState && ctx.activeChainState.hbEngine === true, 'legacy mirror must be an HB engine mirror');
  assertEqual(ctx.activeChainState.links.length, 1, 'first legacy link must be mirrored');
  assert(ctx.activeChainState.links[0].hbEffectId && ctx.activeChainState.links[0].hbEffectId.startsWith('legacy-chain-'), 'legacy link must be wrapped as an EffectDefinition');

  ctx.addChainLink({ type: 'jarSearchBan', label: '서치 봉인의 항아리 ②' }, { force: true });
  assertEqual(ctx.HB_CHAIN_ENGINE.getChainLinks().length, 2, 'legacy addChainLink must add to HB internal links');
  assertEqual(ctx.activeChainState.links.length, 2, 'mirror links must match HB internal links');

  // [체인 응답 전파] 체인을 해결하지 않는 중간 패스는 hb:chain-passed 이벤트를 발행해야 한다.
  // (네트워크에서 상대가 우선권 이양을 보지 못해 데드락되는 것을 막는 핵심 — account.js가 이 이벤트로 chainState 발행)
  let chainPassedEvents = 0;
  ctx.addEventListener('hb:chain-passed', function () { chainPassedEvents += 1; });

  let pass = ctx.HB_CHAIN_ENGINE.passChainResponse('guest');
  assert(pass && pass.ok !== false, 'guest pass should be accepted');
  assertEqual(chainPassedEvents, 1, '비해결 패스는 hb:chain-passed 이벤트를 발행해야 한다(네트워크 전파)');
  pass = ctx.HB_CHAIN_ENGINE.passChainResponse('host');
  assert(pass && pass.ok !== false, 'host pass should resolve');
  assertEqual(chainPassedEvents, 1, '해결하는 패스는 chain-passed가 아닌 chain-resolved 경로를 탄다');

  assertEqual(ctx.HB_CHAIN_ENGINE.hasActiveChain(), false, 'chain must resolve through HB engine');
  assertEqual(drawn, 1, 'legacy jarDraw resolver must execute once through adapter');
  assertEqual(ctx.G.searchBanActive, true, 'legacy second resolver must execute through adapter');
};
