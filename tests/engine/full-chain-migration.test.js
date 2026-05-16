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

  let pass = ctx.HB_CHAIN_ENGINE.passChainResponse('guest');
  assert(pass && pass.ok !== false, 'guest pass should be accepted');
  pass = ctx.HB_CHAIN_ENGINE.passChainResponse('host');
  assert(pass && pass.ok !== false, 'host pass should resolve');

  assertEqual(ctx.HB_CHAIN_ENGINE.hasActiveChain(), false, 'chain must resolve through HB engine');
  assertEqual(drawn, 1, 'legacy jarDraw resolver must execute once through adapter');
  assertEqual(ctx.G.searchBanActive, true, 'legacy second resolver must execute through adapter');
};
