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
};
