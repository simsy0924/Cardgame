const fs = require('fs');
const path = require('path');
const { createContext, loadAllEffects, assert, assertEqual } = require('./_setup');

const ROOT = path.resolve(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function getIndexScripts() {
  const index = read('index.html');
  const scripts = [];
  const pattern = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let match;
  // 캐시 버스터 쿼리(?v=...)는 실파일 비교에 무관하므로 제거한다.
  while ((match = pattern.exec(index))) scripts.push(match[1].split('?')[0]);
  return scripts;
}

function assertBefore(scripts, before, after) {
  const beforeIndex = scripts.indexOf(before);
  const afterIndex = scripts.indexOf(after);
  assert(beforeIndex !== -1, `missing script: ${before}`);
  assert(afterIndex !== -1, `missing script: ${after}`);
  assert(beforeIndex < afterIndex, `${before} must load before ${after}`);
}

module.exports = function runFinalGateTests() {
  const scripts = getIndexScripts();
  assert(scripts.length >= 35, `expected full script graph, got ${scripts.length}`);

  // index.html이 참조하는 모든 파일은 실제로 있어야 한다.
  scripts.forEach(script => assert(exists(script), `index.html references missing script: ${script}`));

  // 룰 → 효과 정의 → 등록소 → 엔진 → 테마 → 후처리 엔진 → UI/네트워크 순서를 지킨다.
  assertBefore(scripts, 'js/cards.js', 'js/rules/effect-types.js');
  assertBefore(scripts, 'js/rules/timing.js', 'js/engine/effect-definition.js');
  assertBefore(scripts, 'js/engine/effect-definition.js', 'js/effects/effect-registry.js');
  assertBefore(scripts, 'js/effects/effect-registry.js', 'js/engine/zone-access.js');
  assertBefore(scripts, 'js/engine/zone-access.js', 'js/engine/card-move.js');
  assertBefore(scripts, 'js/engine/card-move.js', 'js/engine/effect-context.js');
  assertBefore(scripts, 'js/engine/effect-context.js', 'js/effects/theme/penguin.js');
  assertBefore(scripts, 'js/effects/theme/liger.js', 'js/engine/processing-negate-engine.js');
  assertBefore(scripts, 'js/engine/processing-negate-engine.js', 'js/engine/chain-engine.js');
  assertBefore(scripts, 'js/engine/chain-engine.js', 'js/engine/trigger-queue.js');
  assertBefore(scripts, 'js/engine/trigger-queue.js', 'js/engine/continuous-engine.js');
  assertBefore(scripts, 'js/engine/continuous-engine.js', 'js/engine/field-zone.js');
  assertBefore(scripts, 'js/engine/field-zone.js', 'js/engine/network-sync.js');
  assertBefore(scripts, 'js/engine/network-sync.js', 'js/engine/effect-ui.js');
  assertBefore(scripts, 'js/engine/effect-ui.js', 'js/engine/legacy-bridge.js');
  assertBefore(scripts, 'js/engine/legacy-bridge.js', 'js/ui.js');

  const requiredThemeScripts = [
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
  requiredThemeScripts.forEach(script => assert(scripts.includes(script), `theme script not loaded: ${script}`));

  const forbiddenLegacyFiles = [
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
    'js/legacy/effect.old.js',
  ];
  forbiddenLegacyFiles.forEach(file => {
    assert(!scripts.includes(file), `legacy script must not be loaded: ${file}`);
    assert(!exists(file), `legacy file must not exist: ${file}`);
  });

  const ctx = loadAllEffects(createContext());
  const registry = ctx.HB_EFFECT_REGISTRY;
  const effects = registry.listEffects();
  const stats = registry.getRegistryStats();

  assertEqual(stats.total, 289, 'final registered effect count');
  assertEqual(stats.cards, 118, 'final registered effect card count');
  assertEqual(stats.types, 7, 'final effect type count');
  assertEqual(stats.continuous, 30, 'final continuous effect count');
  assertEqual(stats.procedures, 24, 'final procedure effect count');

  const byType = effects.reduce((acc, effect) => {
    acc[effect.type] = (acc[effect.type] || 0) + 1;
    return acc;
  }, {});
  const expectedByType = {
    activation: 83,
    quick: 63,
    trigger: 80,
    continuous: 30,
    procedure: 24,
    replacement: 3,
    processingNegate: 6,
  };
  Object.entries(expectedByType).forEach(([type, count]) => {
    assertEqual(byType[type] || 0, count, `final ${type} effect count`);
  });

  const activeTypes = new Set(['activation', 'quick', 'trigger']);
  const nonChainTypes = new Set(['continuous', 'procedure', 'replacement', 'processingNegate']);

  const badActive = effects.filter(effect => activeTypes.has(effect.type) && effect.isActivated !== true);
  assertEqual(badActive.length, 0, 'activation/quick/trigger effects must be activated effects');

  const badNonChain = effects.filter(effect => nonChainTypes.has(effect.type) && effect.isActivated === true);
  assertEqual(badNonChain.length, 0, 'continuous/procedure/replacement/processingNegate must not be activated effects');

  const triggerMissingEvent = effects.filter(effect => effect.type === 'trigger' && (!effect.events || effect.events.length === 0));
  assertEqual(triggerMissingEvent.length, 0, 'trigger effects must declare event(s)');

  const processingNegateWithoutTags = effects.filter(effect => effect.type === 'processingNegate' && (!effect.negateTags || effect.negateTags.length === 0));
  assertEqual(processingNegateWithoutTags.length, 0, 'processingNegate effects must declare negateTags');

  const themeFiles = fs.readdirSync(path.join(ROOT, 'js/effects/theme')).filter(name => name.endsWith('.js'));
  assertEqual(themeFiles.length, 10, 'theme effect file count');

  // 신규 효과/엔진 파일에서는 직접 G.myField.push/splice 같은 필드 조작을 금지한다.
  const guardedDirs = ['js/effects/theme', 'js/engine'];
  const forbiddenMutations = /\bG\.(myField|opField|myGrave|opGrave|myExile|opExile|myHand|opHand)\s*\.\s*(push|splice|pop|shift|unshift)\b/;
  guardedDirs.forEach(dir => {
    const fullDir = path.join(ROOT, dir);
    fs.readdirSync(fullDir).forEach(name => {
      const rel = `${dir}/${name}`;
      if (!name.endsWith('.js')) return;
      const code = read(rel)
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
      assert(!forbiddenMutations.test(code), `direct G zone mutation is forbidden in new engine/theme file: ${rel}`);
    });
  });
};
