const { createContext, loadCore, assert, assertEqual } = require('./_setup');

module.exports = function runChainNetworkSafetyTests() {
  const ctx = loadCore(createContext());

  ctx.myRole = 'guest';
  ctx.opRole = 'host';
  assertEqual(ctx.HB_CHAIN_ENGINE.roleToController('guest'), 'me', 'local role should map to me');
  assertEqual(ctx.HB_CHAIN_ENGINE.roleToController('host'), 'opponent', 'remote role should map to opponent');
  assertEqual(ctx.HB_CHAIN_ENGINE.controllerToRole('me'), 'guest', 'me controller should map to local role');
  assertEqual(ctx.HB_CHAIN_ENGINE.controllerToRole('opponent'), 'host', 'opponent controller should map to remote role');

  ctx.roomRef = {};
  assert(ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'summon' }), 'network summon lastAction should be suppressed');
  assert(ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'forceDiscard' }), 'network forceDiscard lastAction should be suppressed');
  assert(ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'revealAllHand' }), 'network revealAllHand lastAction should be suppressed');
  assert(ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'exileBan' }), 'network exileBan lastAction should be suppressed');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'draw' }), 'draw lastAction should remain log/public only');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'search' }), 'search lastAction should remain log/public only');

  ctx.HB_EFFECT_REGISTRY.registerEffects([{
    id: 'partial-card-effect-1',
    cardId: 'partial-card',
    effectNo: 1,
    type: 'activation',
    zones: ['hand'],
    condition() { return true; },
    canResolve() { return true; },
    resolve() { return true; },
  }], { replace: true });

  const partialCard = {
    id: 'partial-card',
    name: 'partial-card',
    migration: { fullyMigrated: false, migratedEffects: [1] },
  };

  assert(ctx.HB_LEGACY_BRIDGE.isNewEngineEffect(partialCard, 1, 'hand'), 'migrated effect should use new engine');
  assert(!ctx.HB_LEGACY_BRIDGE.isNewEngineEffect(partialCard, 2, 'hand'), 'unmigrated effect should stay legacy');
  assert(ctx.HB_LEGACY_BRIDGE.shouldUseLegacyCard(partialCard), 'partially migrated cards should keep legacy buttons');
  const route = ctx.HB_LEGACY_BRIDGE.routeCardActivation(partialCard, { card: partialCard, effectNo: 2, zone: 'hand' });
  assert(route && route.useLegacy, 'unmigrated requested effect should route back to legacy');
};
