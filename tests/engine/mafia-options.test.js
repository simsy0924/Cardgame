const vm = require('vm');
const {
  createContext,
  loadAllEffects,
  makeState,
  makeCard,
  assert,
  assertEqual,
} = require('./_setup');

module.exports = function runMafiaOptionTests() {
  const ctx = loadAllEffects(createContext());
  vm.runInContext('var __mafiaOptionCards = CARDS;', ctx);
  const cards = ctx.__mafiaOptionCards || {};
  const mafiaIds = ctx.HB_MAFIA_EFFECTS.getMafiaCards();
  const allMonsters = Object.keys(cards).filter(id => cards[id].cardType === 'monster');
  const checked = new Set();

  mafiaIds.forEach(cardId => {
    const table = ctx.HB_MAFIA_EFFECTS.getMafiaSpellOptions(cardId);
    if (!table) return;
    ['transform', 'draw'].forEach(type => {
      (table[type] || []).forEach(optionText => {
        if (checked.has(optionText)) return;
        checked.add(optionText);

        const state = makeState({
          myDeck: mafiaIds.concat(allMonsters).map(id => makeCard(id)),
          myHand: mafiaIds.map(id => makeCard(id)),
          myField: mafiaIds.slice(0, 2).map(id => makeCard(id)),
          myGrave: mafiaIds.map(id => makeCard(id)),
          myExile: mafiaIds.map(id => makeCard(id)),
          opDeck: mafiaIds.concat(allMonsters).map(id => makeCard(id)),
          opHand: mafiaIds.map(id => makeCard(id)),
          opField: allMonsters.slice(0, 3).map(id => makeCard(id)),
          opGrave: mafiaIds.map(id => makeCard(id)),
        });
        ctx.HB_STATE_STORE.normalizeLegacyState(state);
        ctx.HB_STATE_STORE.recordDraw(state, 'me', 6);
        const effect = { id: 'test-mafia-option', cardId, type: 'activation' };
        const effectCtx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
          gameState: state,
          controller: 'me',
          effect,
          cardId,
        });
        const result = ctx.HB_MAFIA_EFFECTS.resolveMafiaOption(effectCtx, optionText);
        assert(
          !result || result.ok !== false,
          `mafia option must resolve: ${optionText} (${result && result.error})`
        );
      });
    });
  });

  assertEqual(checked.size, 20, 'all unique mafia spell options must be covered');
};
