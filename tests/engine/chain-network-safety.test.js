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
  assert(ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'fieldCard' }), 'network fieldCard lastAction should be suppressed');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'combat' }), 'combat must run on the receiver to resolve local damage');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'directAttack' }), 'directAttack must run on the receiver to resolve local damage');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'forceDiscard' }), 'forceDiscard must run on the receiver so the owner discards real cards');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'forceReturnHand' }), 'forceReturnHand must run on the receiver so the owner returns real cards');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'opDiscard' }), 'opDiscard must run on the receiver');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'opDiscardRandom' }), 'opDiscardRandom must run on the receiver');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'opDraw' }), 'opDraw must run on the receiver');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'revealAllHand' }), 'revealAllHand must run on the receiver');
  assert(!ctx.HB_NETWORK_SYNC.shouldSuppressLegacyAction({ type: 'exileBan' }), 'exileBan must run on the receiver');
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

  // [N1] isAuthority 결정론적 단일 권위 — 모호한 경우 양쪽이 동시에 권위가 되지 않는다.
  // (네트워크 모드: roomRef 설정됨, 로컬 역할 guest)
  const auth = ctx.HB_NETWORK_SYNC.isAuthority;
  assertEqual(auth({ authority: true }), true, 'explicit authority:true → 권위');
  assertEqual(auth({ authority: false }), false, 'explicit authority:false → 비권위');
  assertEqual(auth({ resolvedBy: 'guest' }), true, 'resolvedBy가 내 역할이면 권위');
  assertEqual(auth({ resolvedBy: 'host' }), false, 'resolvedBy가 상대 역할이면 비권위');
  assertEqual(auth({ ownerRole: 'guest' }), true, 'ownerRole이 내 역할이면 권위');
  assertEqual(auth({ ownerRole: 'host' }), false, 'ownerRole이 상대 역할이면 비권위');
  assertEqual(auth({ controller: 'me' }), true, 'controller=me → 내가 권위');
  assertEqual(auth({ controller: 'opponent' }), false, 'controller=opponent → 비권위(상대가 해결)');
  assertEqual(auth({ controller: 'guest' }), true, 'controller가 내 역할이면 권위');
  assertEqual(auth({ controller: 'host' }), false, 'controller가 상대 역할이면 비권위');
  // 모호(컨텍스트 없음): guest는 host가 아니므로 비권위 → host 단일 권위만 해결
  assertEqual(auth({}), false, 'guest + 모호한 컨텍스트 → 비권위(host만 해결)');

  // host 관점: 모호한 경우 단일 해결자로서 권위가 된다.
  ctx.myRole = 'host';
  assertEqual(auth({}), true, 'host + 모호한 컨텍스트 → 권위(단일 해결자)');
  assertEqual(auth({ controller: 'opponent' }), false, 'host도 controller=opponent면 비권위');
  assertEqual(auth({ controller: 'me' }), true, 'host + controller=me → 권위');
  ctx.myRole = 'guest';

  // 비네트워크(룸 없음): 로컬/AI전이므로 항상 권위.
  const savedRoom = ctx.roomRef;
  ctx.roomRef = null;
  assertEqual(auth({}), true, '비네트워크 → 항상 권위');
  assertEqual(auth({ controller: 'opponent' }), true, '비네트워크 → controller 무관하게 권위');
  ctx.roomRef = savedRoom;
};
