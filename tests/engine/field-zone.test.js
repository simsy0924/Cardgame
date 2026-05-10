const { createContext, loadCore, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runFieldZoneTests() {
  const ctx = loadCore(createContext());
  const state = makeState({
    myHand: [makeCard('태평양 속 르뤼에')],
    myDeck: [makeCard('불가사의한 밤의 대도시')],
    myFieldCard: makeCard('펭귄 마을'),
  });
  ctx.G = state;
  ctx.currentPhase = 'deploy';
  ctx.isMyTurn = true;

  const activated = ctx.HB_FIELD_ZONE.activateFieldCardFromHand({
    gameState: state,
    controller: 'me',
    cardId: '태평양 속 르뤼에',
    ignoreTiming: true,
  });
  assert(activated.ok, `activateFieldCardFromHand failed: ${activated.error}`);
  assertEqual(state.myHand.length, 0, 'field activation should remove card from hand');
  assertEqual(state.myFieldCard.id, '태평양 속 르뤼에', 'field activation should place card in field zone');
  assertEqual(state.myGrave.length, 1, 'old field card should be sent to grave');

  const byEffectState = makeState({ myDeck: [makeCard('불가사의한 밤의 대도시')], myFieldCard: makeCard('태평양 속 르뤼에') });
  const placed = ctx.HB_FIELD_ZONE.placeFieldCardByEffect({
    gameState: byEffectState,
    controller: 'me',
    cardId: '불가사의한 밤의 대도시',
    source: { controller: 'me', zone: 'deck' },
  });
  assert(placed.ok, `placeFieldCardByEffect failed: ${placed.error}`);
  assertEqual(byEffectState.myFieldCard.id, '불가사의한 밤의 대도시', 'effect placement should replace field card');
  assertEqual(byEffectState.myGrave.length, 1, 'effect placement should send previous field card to grave');
};
