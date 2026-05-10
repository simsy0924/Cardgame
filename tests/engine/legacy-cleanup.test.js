const fs = require('fs');
const path = require('path');
const { createContext, loadAllEffects, assert, assertEqual } = require('./_setup');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
}

module.exports = function testLegacyCleanup() {
  const index = read('index.html');
  const removedScripts = [
    'js/penguin.js',
    'js/jibaeja.js',
    'js/theme-common.js',
    'js/lion.js',
    'js/tiger.js',
    'js/liger.js',
    'js/cthulhu.js',
    'js/mafia.js',
    'js/bulgasaui.js',
    'js/Elements.js',
    'js/patch.js',
    'js/circusmare.js',
  ];
  for (const script of removedScripts) {
    assert(!index.includes(`src="${script}"`), `${script} must not be loaded after step19 hard cleanup`);
    assert(!fs.existsSync(path.resolve(__dirname, '..', '..', script)), `${script} must be physically removed after step19 hard cleanup`);
  }

  const oneOffRootTests = [
    'test_bulgasaui_16_5.js',
    'test_cthulhu_16_4.js',
    'test_ruler_16_5.js',
  ];
  for (const rel of oneOffRootTests) {
    assert(!fs.existsSync(path.resolve(__dirname, '..', '..', rel)), `${rel} was replaced by tests/engine and must not remain at project root`);
  }

  assert(!fs.existsSync(path.resolve(__dirname, '..', '..', 'js/legacy/effect.old.js')), 'js/legacy/effect.old.js must be removed after step19 hard cleanup');

  const requiredNewThemeScripts = [
    'js/effects/theme/penguin.js',
    'js/effects/theme/circusmare.js',
    'js/effects/theme/elements.js',
    'js/effects/theme/cthulhu.js',
    'js/effects/theme/ruler.js',
    'js/effects/theme/bulgasaui.js',
    'js/effects/theme/mafia.js',
    'js/effects/theme/lion.js',
    'js/effects/theme/tiger.js',
    'js/effects/theme/liger.js',
  ];
  for (const script of requiredNewThemeScripts) {
    assert(index.includes(`src="${script}"`), `${script} must remain loaded`);
  }

  const ui = read('js/ui.js');
  for (const marker of [
    '서커스메어 기본 덱 로드',
    '라이온 기본 덱 로드',
    '타이거 기본 덱 로드',
    '라이거 기본 덱 로드',
    '크툴루/올드원 기본 덱 로드',
    '불가사의 기본 덱 로드',
  ]) {
    assert(ui.includes(marker), `deck preset marker missing in ui.js: ${marker}`);
  }

  const progression = read('js/progression.js');
  assert(progression.includes("'서커스메어'"), 'STARTER_THEME_PRESETS must include 서커스메어 without circusmare.js patch');

  const ctx = createContext();
  loadAllEffects(ctx);
  const registry = ctx.HB_EFFECT_REGISTRY;
  const stats = registry.getRegistryStats();
  assertEqual(stats.total, 289, 'effect registry count must stay unchanged after removing legacy script loads');
  assertEqual(stats.cards, 118, 'effect card count must stay unchanged after removing legacy script loads');

  const allEffects = Array.from({ length: 0 });
  for (const cardId of Object.keys(ctx.CARDS || {})) {
    const effects = registry.getEffectsByCardId(cardId);
    effects.forEach(effect => allEffects.push(effect));
  }

  const badActivated = allEffects.filter(effect => ['continuous', 'procedure', 'replacement', 'processingNegate'].includes(effect.type) && effect.isActivated);
  assertEqual(badActivated.length, 0, 'non-chain effect types must not be activated effects');

  const missingCanResolve = allEffects.filter(effect => ['activation', 'quick', 'trigger'].includes(effect.type) && typeof effect.canResolve !== 'function');
  assertEqual(missingCanResolve.length, 0, 'activated/trigger effects must have canResolve guard');
};
