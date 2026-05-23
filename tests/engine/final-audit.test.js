const fs = require('fs');
const path = require('path');
const { createContext, loadAllEffects, makeCard, makeState, assert } = require('./_setup');

module.exports = function testFinalAudit() {
  const root = path.resolve(__dirname, '..', '..');
  const effectUiSource = fs.readFileSync(path.join(root, 'js/engine/effect-ui.js'), 'utf8');
  const effectsChainSource = fs.readFileSync(path.join(root, 'js/effects-chain.js'), 'utf8');
  const bulgasauiSource = fs.readFileSync(path.join(root, 'js/effects/theme/bulgasaui.js'), 'utf8');

  assert(!effectUiSource.includes('controller === CONTROLLERS.ME ? global.HB_FIELD_ZONE.getFieldZoneEffects'),
    'Effect UI must allow AI/opponent field-zone effect collection');
  assert(effectsChainSource.includes("AI는 js/ai.js의 _collectAIEngineActions('chain')"),
    'collectChainOptions(aiCtx) must not capture swapped new-engine entries for AI');
  assert(bulgasauiSource.includes('function handAfterActivationCost(ctx)'),
    'additional hand discard costs must account for card activation cost first');

  const themeDir = path.join(root, 'js/effects/theme');
  const themeSource = fs.readdirSync(themeDir)
    .filter(name => name.endsWith('.js'))
    .map(name => fs.readFileSync(path.join(themeDir, name), 'utf8'))
    .join('\n');
  [
    /hand\(ctx[^)]*\)\.push\([^)]*\.shift\(/,
    /grave\(ctx[^)]*\)\.push\(/,
    /exile\(ctx[^)]*\)\.push\(/,
    /publicHand\(ctx[^)]*\)\.push\(/,
    /keyDeck\(ctx[^)]*\)\.push\(/,
    /zoneAccess\.insertCardToZone\(ctx\.gameState/,
    /sendAction\(\{type:'opDiscard'/,
    /sendAction\(\{ type: 'opDiscard'/,
  ].forEach(pattern => {
    assert(!pattern.test(themeSource), `theme effects must route zone mutation/network discard through engine helpers: ${pattern}`);
  });

  const ctx = createContext();
  loadAllEffects(ctx);
  ctx.currentPhase = 'deploy';
  ctx.isMyTurn = true;
  ctx.G = makeState({
    myHand: [makeCard('불가사의한 화폐 속 암호')],
    myDeck: [makeCard('불가사의한 망태 할아버지')],
  });
  const entries = ctx.HB_EFFECT_UI.getAvailableEffects({
    gameState: ctx.G,
    controller: 'me',
    player: 'me',
    card: makeCard('불가사의한 화폐 속 암호'),
    cardId: '불가사의한 화폐 속 암호',
    zone: 'hand',
    sourceZone: 'hand',
    sourceIndex: 0,
  });
  assert(entries.length === 0, 'money code must not be available if activation cost leaves no card for discard cost');

  ctx.G = makeState({
    myHand: [makeCard('불가사의한 화폐 속 암호'), makeCard('구사일생')],
    myDeck: [makeCard('불가사의한 망태 할아버지')],
  });
  const available = ctx.HB_EFFECT_UI.getAvailableEffects({
    gameState: ctx.G,
    controller: 'me',
    player: 'me',
    card: makeCard('불가사의한 화폐 속 암호'),
    cardId: '불가사의한 화폐 속 암호',
    zone: 'hand',
    sourceZone: 'hand',
    sourceIndex: 0,
  });
  assert(available.length > 0, 'money code must be available when another hand card can pay discard cost');
};
