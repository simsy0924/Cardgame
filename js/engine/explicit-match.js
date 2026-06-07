// HAND BATTLE — Engine: Explicit Match
// 무효/응답 효과가 "자신이 막을·반응할 대상"을 명시 목록으로 보유하고(EffectDefinition.negateTargets /
// respondsTo), 엔진이 그 목록을 체인 링크/이벤트와 직접 대조한다.
// 카드 텍스트 스캔이나 태그 추정 매칭을 대체하기 위한 중앙 매처. 매칭 단위는 effect-id이며,
// {cardId} 매처는 그 카드의 effect-id 집합으로 확장된다.
(function initExplicitMatch(global) {
  'use strict';

  function getRegistry() {
    return global.HB_EFFECT_REGISTRY || null;
  }

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  // {cardId} 매처를 그 카드의 effect-id 목록으로 확장한다(레지스트리 조회).
  function effectIdsForCard(cardId) {
    const registry = getRegistry();
    if (!cardId || !registry || typeof registry.getEffectsByCardId !== 'function') return [];
    return registry.getEffectsByCardId(cardId)
      .map(effect => effect && effect.id)
      .filter(Boolean)
      .map(String);
  }

  // negateTargets 매처 배열을 effect-id 집합 / card-id 집합 / 태그 집합 목록으로 펼친다.
  function expandNegateTargets(matchers) {
    const effectIds = new Set();
    const cardIds = new Set();
    const tagSets = [];
    asArray(matchers).forEach(matcher => {
      if (!matcher) return;
      if (matcher.effectId) { effectIds.add(String(matcher.effectId)); return; }
      if (matcher.cardId) {
        const cid = String(matcher.cardId);
        cardIds.add(cid);
        effectIdsForCard(cid).forEach(id => effectIds.add(id));
        return;
      }
      if (matcher.tagAny && matcher.tagAny.length) {
        tagSets.push(new Set(asArray(matcher.tagAny).map(String)));
      }
    });
    return { effectIds, cardIds, tagSets };
  }

  function chainLinkTagList(chainLink) {
    if (!chainLink) return [];
    return asArray(chainLink.tags).map(String);
  }

  // 무효 효과(negateTargets 보유)가 주어진 체인 링크를 막을 수 있는가?
  function chainLinkMatches(negateEffect, chainLink) {
    if (!negateEffect || !chainLink) return false;
    const matchers = negateEffect.negateTargets;
    if (!matchers || matchers.length === 0) return false;

    const { effectIds, cardIds, tagSets } = expandNegateTargets(matchers);
    if (chainLink.effectId && effectIds.has(String(chainLink.effectId))) return true;
    if (chainLink.cardId && cardIds.has(String(chainLink.cardId))) return true;
    if (tagSets.length) {
      const tags = chainLinkTagList(chainLink);
      if (tags.length && tagSets.some(set => tags.some(tag => set.has(tag)))) return true;
    }
    return false;
  }

  // 이벤트 유발 응답 효과(respondsTo 보유)가 주어진 이벤트에 반응하는가?
  // event.sourceEffectId / event.sourceCardId 는 effect-context가 이동 이벤트에 실어 준다.
  function eventMatches(responder, event) {
    if (!responder || !event) return false;
    const spec = responder.respondsTo;
    if (!spec) return false;

    if (spec.events && spec.events.length && spec.events.indexOf(String(event.type)) === -1) return false;

    const hasEffectIds = !!(spec.sourceEffectIds && spec.sourceEffectIds.length);
    const hasCardIds = !!(spec.sourceCardIds && spec.sourceCardIds.length);
    // 출처 제한이 없으면 이벤트 타입 일치만으로 반응한다.
    if (!hasEffectIds && !hasCardIds) return true;
    if (hasEffectIds && event.sourceEffectId && spec.sourceEffectIds.indexOf(String(event.sourceEffectId)) !== -1) return true;
    if (hasCardIds && event.sourceCardId && spec.sourceCardIds.indexOf(String(event.sourceCardId)) !== -1) return true;
    return false;
  }

  global.HB_EXPLICIT_MATCH = Object.freeze({
    effectIdsForCard,
    expandNegateTargets,
    chainLinkMatches,
    eventMatches,
  });
})(window);
