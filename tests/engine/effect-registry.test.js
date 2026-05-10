const { createContext, loadAllEffects, assert, assertEqual } = require('./_setup');

module.exports = function runEffectRegistryTests() {
  const ctx = loadAllEffects(createContext());
  const effects = ctx.HB_EFFECT_REGISTRY.listEffects();
  assert(effects.length >= 250, `expected many registered theme effects, got ${effects.length}`);

  const cardIds = new Set(effects.map(effect => effect.cardId));
  assert(cardIds.size >= 100, `expected many registered cards, got ${cardIds.size}`);

  const activeTypes = new Set(['activation', 'quick', 'trigger']);
  const missingCanResolve = effects.filter(effect => activeTypes.has(effect.type) && typeof effect.canResolve !== 'function');
  assertEqual(missingCanResolve.length, 0, 'all activation/quick/trigger effects must have canResolve');

  const triggerMissingEvent = effects.filter(effect => effect.type === 'trigger' && (!effect.events || effect.events.length === 0));
  assertEqual(triggerMissingEvent.length, 0, 'trigger effects must declare events');

  const buttonForbidden = new Set(['continuous', 'procedure', 'replacement', 'processingNegate']);
  const incorrectlyActivated = effects.filter(effect => buttonForbidden.has(effect.type) && effect.isActivated === true);
  assertEqual(incorrectlyActivated.length, 0, 'non-chain effect types must not be marked isActivated');

  const requiredNamespaces = [
    'HB_PENGUIN_EFFECTS',
    'HB_CIRCUSMARE_EFFECTS',
    'HB_ELEMENTS_EFFECTS',
    'HB_CTHULHU_EFFECTS',
    'HB_RULER_EFFECTS',
    'HB_BULGASAUI_EFFECTS',
    'HB_MAFIA_EFFECTS',
    'HB_LION_EFFECTS',
    'HB_TIGER_EFFECTS',
    'HB_LIGER_EFFECTS',
  ];
  requiredNamespaces.forEach(name => assert(ctx[name], `${name} missing`));

  const themeCards = {
    penguin: '펭귄 마을',
    circusmare: '서커스메어 스프링 제스터',
    elements: '엘리멘츠의 궁극 창조신',
    cthulhu: '태평양 속 르뤼에',
    ruler: '사원소의 지배자',
    bulgasaui: '불가사의한 밤의 대도시',
    mafia: '마피아의 도시',
    lion: '라이온 킹',
    tiger: '타이거 킹',
    liger: '라이거 킹',
  };
  Object.entries(themeCards).forEach(([theme, cardId]) => {
    assert(ctx.HB_EFFECT_REGISTRY.getEffectsByCardId(cardId).length > 0, `${theme} representative card has no effects: ${cardId}`);
  });
};
