const fs = require('fs');
const path = require('path');
const { assert } = require('./_setup');

module.exports = function testAiEngineActions() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js/ai.js'), 'utf8');

  assert(source.includes('function _collectAIEngineActions(mode)'), 'AI must collect EffectDefinition actions');
  assert(source.includes('function _activateAIEngineAction(action)'), 'AI must activate EffectDefinition actions');
  assert(source.includes("_collectAIEngineActions('deploy')"), 'AI deploy must use engine actions first');
  assert(source.includes("_collectAIEngineActions('chain')"), 'AI chain response must use engine quick effects');
  assert(source.includes('!_isNewEngineCardId(x.id)'), 'direct summon fallback must exclude new-engine cards');
  assert(!source.includes('if (source.key)  base = base.concat(source.key);'), 'AI must not shuffle key deck cards into the main deck');
  assert(source.includes('G.opKeyDeck = (window.AI.keyDeck || [])'), 'AI must keep a separate key deck');
  assert(source.includes('HB_CHAIN_ENGINE.passChainResponse(_aiController())'), 'AI must pass HB engine chains as opponent controller without role swapping');

  assert(source.includes('showGameOver(true); }, 200)'), 'AI hand/deck loss must show player victory');
  assert(source.includes('showGameOver(true); }, 100); // true = 플레이어 승리'), 'AI hand 0 must show player victory');
  assert(source.includes('showGameOver(false); }, 100); // false = 플레이어 패배(AI 승리)'), 'player hand 0 must show player defeat');
};
