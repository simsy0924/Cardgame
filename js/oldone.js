// oldone.js — 올드 원 테마 효과 라우팅
['올드 원', '올드원'].forEach(theme => {
  registerThemeEffectHandler(theme, {
    activateFromHand: activateThemeCardEffectFromHand,
    resolveLink: resolveThemeEffectGeneric,
  });
});
