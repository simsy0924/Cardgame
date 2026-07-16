const fs = require('fs');
const path = require('path');
const { createContext, loadCore, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runStateSessionTests() {
  const networkSource = fs.readFileSync(path.join(__dirname, '../../js/network.js'), 'utf8');
  assert(
    !/^\s*lastActionKey,\s*$/m.test(networkSource),
    'network state capture must not reference an undeclared lastActionKey shorthand'
  );
  assertEqual(
    (networkSource.match(/lastActionKey:\s*lastHandledActionKey/g) || []).length,
    2,
    'snapshot and session state must map the handled action cursor explicitly'
  );

  const ctx = loadCore(createContext());
  const state = makeState({
    myHand: [makeCard('hand-a')],
    myDeck: [makeCard('deck-1'), makeCard('deck-2'), makeCard('deck-3')],
    myField: [makeCard('field-a', { atk: 3 })],
    myGrave: [makeCard('grave-a')],
    myExile: [makeCard('exile-a')],
    myKeyDeck: [makeCard('key-a')],
    turn: 7,
    phase: 'attack',
    activePlayer: 'guest',
    goldenAppleActive: true,
    exileBanActive: true,
  });

  const snapshot = ctx.HB_STATE_STORE.captureLegacyState(state, {
    role: 'host',
    roomCode: 'ABCD',
    playerName: 'tester',
    deckList: ['deck-1', 'deck-2', 'deck-3'],
    keyDeckList: ['key-a'],
    attackedMonsterIds: new Set(['field-a']),
    pendingTriggers: [{ effectId: 'pending-effect', event: { type: 'draw' } }],
    chainUsage: [{ key: 'host:7:test', count: 1 }],
    lastActionKey: 'action-1',
    lastActionTs: 1234,
  });

  assert(snapshot.validation.ok, `snapshot should be valid: ${(snapshot.validation.errors || []).join(', ')}`);
  assertEqual(snapshot.schema, 2, 'state snapshot schema');
  assertEqual(snapshot.data.myDeck.map(c => c.id).join(','), 'deck-1,deck-2,deck-3', 'remaining deck order must be exact');
  assert(snapshot.data.myHand[0]._iid, 'cards must receive stable instance ids');

  const restored = makeState({
    myHand: [makeCard('wrong')],
    myDeck: [makeCard('wrong-deck')],
  });
  const applied = ctx.HB_STATE_STORE.applyLegacySnapshot(restored, snapshot);
  assert(applied.ok, `restored state should validate: ${(applied.errors || []).join(', ')}`);
  assertEqual(restored.myDeck.map(c => c.id).join(','), 'deck-1,deck-2,deck-3', 'restore must not reshuffle or rebuild deck');
  assertEqual(restored.turn, 7, 'turn must restore');
  assertEqual(restored.phase, 'attack', 'phase must restore');
  assertEqual(restored.activePlayer, 'guest', 'active player must restore');
  assertEqual(applied.attackedMonsterIds.join(','), 'field-a', 'attacked card ids must restore');
  assertEqual(applied.pendingTriggers[0].effectId, 'pending-effect', 'pending trigger descriptors must restore');
  assertEqual(applied.chainUsage[0].count, 1, 'effect usage must restore');

  const opponentView = ctx.HB_STATE_STORE.makeOpponentView(snapshot);
  assertEqual(opponentView.hand[0].id, 'unknown', 'private opponent hand must stay masked');
  assertEqual(opponentView.deckCount, 3, 'opponent deck count must be public');

  const seatToken = ctx.HB_SESSION.makeSeatToken();
  ctx.HB_SESSION.remember({
    roomCode: 'ABCD',
    role: 'host',
    playerName: 'tester',
    seatToken,
    stage: 'playing',
  });
  const session = ctx.HB_SESSION.load();
  assert(session, 'remembered session must load');
  assertEqual(session.roomCode, 'ABCD', 'room code must persist');
  assertEqual(session.seatToken, seatToken, 'seat token must persist');
  ctx.HB_SESSION.markProcessedAction('action-1', 1234);
  assert(ctx.HB_SESSION.hasProcessedAction('action-1'), 'processed action key must persist');
  ctx.HB_SESSION.clear();
  assertEqual(ctx.HB_SESSION.load(), null, 'cleared session must not resume');
};
