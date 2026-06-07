const { createContext, loadCore, assert } = require('./_setup');

// Phase 1 — 명시 매칭 프리미티브:
// 무효/응답 효과가 보유한 대상 목록(negateTargets / respondsTo)을 엔진이 체인 링크/이벤트와 대조한다.
module.exports = function runExplicitMatchTests() {
  const ctx = loadCore(createContext());
  const registry = ctx.HB_EFFECT_REGISTRY;
  const match = ctx.HB_EXPLICIT_MATCH;
  const def = ctx.HB_EFFECT_DEFINITION;

  assert(match && typeof match.chainLinkMatches === 'function', 'HB_EXPLICIT_MATCH must be loaded');

  // 매칭 대상이 될 효과들을 레지스트리에 등록(cardId 확장 검증용).
  registry.registerEffects([
    { id: 'summon-a', cardId: '소환카드A', type: 'activation', zones: ['hand'], canResolve() { return true; }, resolve() { return true; } },
    { id: 'summon-b1', cardId: '소환카드B', type: 'activation', zones: ['hand'], canResolve() { return true; }, resolve() { return true; } },
    { id: 'summon-b2', cardId: '소환카드B', type: 'trigger', zones: ['field'], events: ['summon'], canResolve() { return true; }, resolve() { return true; } },
    { id: 'draw-x', cardId: '드로우카드', type: 'activation', zones: ['hand'], canResolve() { return true; }, resolve() { return true; } },
  ], { replace: true });

  // negateTargets 정규화: 문자열/객체/cardId 혼합.
  const negate = def.createEffectDefinition({
    id: 'test-negate', cardId: '테스트무효', type: 'quick', zones: ['hand'],
    negateTargets: [{ effectId: 'summon-a' }, { cardId: '소환카드B' }, 'string-as-effectid'],
    canResolve() { return true; }, resolve() { return true; },
  });
  assert(negate.negateTargets.length === 3, 'negateTargets should normalize three matchers');

  // chainLinkMatches: 명시 effectId.
  assert(match.chainLinkMatches(negate, { effectId: 'summon-a' }) === true, 'should match listed effectId');
  // cardId 확장: 소환카드B의 effect-id(summon-b1/b2) 모두 매칭.
  assert(match.chainLinkMatches(negate, { effectId: 'summon-b1' }) === true, 'should match via cardId expansion (b1)');
  assert(match.chainLinkMatches(negate, { effectId: 'summon-b2' }) === true, 'should match via cardId expansion (b2)');
  // 체인 링크가 cardId만 줄 때 직접 매칭.
  assert(match.chainLinkMatches(negate, { cardId: '소환카드B' }) === true, 'should match via chainLink.cardId');
  // 문자열 단축형 = effectId.
  assert(match.chainLinkMatches(negate, { effectId: 'string-as-effectid' }) === true, 'string shorthand should match as effectId');
  // 미등록/미열거 효과는 매칭되지 않는다.
  assert(match.chainLinkMatches(negate, { effectId: 'draw-x' }) === false, 'should NOT match unlisted effect');
  assert(match.chainLinkMatches(negate, { effectId: 'unknown' }) === false, 'should NOT match unknown effect');

  // negateTargets 없는 효과는 항상 false.
  const noTargets = def.createEffectDefinition({ id: 'n2', cardId: 'c2', type: 'quick', zones: ['hand'], canResolve() { return true; }, resolve() { return true; } });
  assert(match.chainLinkMatches(noTargets, { effectId: 'summon-a' }) === false, 'effect without negateTargets must not match');

  // tagAny 브리지(이행기 한정).
  const tagNegate = def.createEffectDefinition({
    id: 'tag-negate', cardId: '태그무효', type: 'quick', zones: ['hand'],
    negateTargets: [{ tagAny: ['monsterSummon'] }],
    canResolve() { return true; }, resolve() { return true; },
  });
  assert(match.chainLinkMatches(tagNegate, { effectId: 'whatever', tags: ['monsterSummon'] }) === true, 'tagAny bridge should match by tag');
  assert(match.chainLinkMatches(tagNegate, { effectId: 'whatever', tags: ['draw'] }) === false, 'tagAny bridge should not match other tags');

  // respondsTo / eventMatches.
  const responder = def.createEffectDefinition({
    id: 'resp', cardId: '응답카드', type: 'trigger', zones: ['hand'], events: ['addedToHand'],
    respondsTo: { event: 'addedToHand', sourceEffectIds: ['summon-a'], sourceCardIds: ['드로우카드'] },
    canResolve() { return true; }, resolve() { return true; },
  });
  assert(responder.respondsTo, 'respondsTo should normalize');
  assert(match.eventMatches(responder, { type: 'addedToHand', sourceEffectId: 'summon-a' }) === true, 'eventMatches by sourceEffectId');
  assert(match.eventMatches(responder, { type: 'addedToHand', sourceCardId: '드로우카드' }) === true, 'eventMatches by sourceCardId');
  assert(match.eventMatches(responder, { type: 'addedToHand', sourceEffectId: 'other' }) === false, 'eventMatches should fail for unlisted source');
  assert(match.eventMatches(responder, { type: 'summon', sourceEffectId: 'summon-a' }) === false, 'eventMatches should fail for wrong event type');

  // 출처 제한이 없는 event-only 응답은 이벤트 타입만 맞으면 매칭.
  const anySource = def.createEffectDefinition({
    id: 'resp-any', cardId: '응답카드2', type: 'trigger', zones: ['hand'], events: ['summon'],
    respondsTo: { event: 'summon' },
    canResolve() { return true; }, resolve() { return true; },
  });
  assert(match.eventMatches(anySource, { type: 'summon', sourceEffectId: 'anything' }) === true, 'event-only responder matches by type');
  assert(match.eventMatches(anySource, { type: 'addedToHand' }) === false, 'event-only responder fails on other type');
};
