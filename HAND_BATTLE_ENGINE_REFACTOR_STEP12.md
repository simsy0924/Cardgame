# Hand Battle Engine Refactor — Step 12

## 목표

`처리 시 그 효과를 무효로 한다` 계열 효과를 일반 체인 응답과 분리한다.

이 효과는 새 체인 링크를 만들지 않는다. 체인 링크가 해결되기 직전에만 확인하고, 조건을 만족하면 해당 링크의 `resolve`를 스킵한다.

## 생성 파일

- `js/engine/processing-negate-engine.js`

## 연결 파일

- `index.html`
  - `effect-context.js` 다음, `chain-engine.js` 전에 `processing-negate-engine.js`를 로드한다.
- `js/engine/chain-engine.js`
  - 기존 임시 처리 시 무효 로직을 `HB_PROCESSING_NEGATE_ENGINE.applyFirstProcessingNegate()`로 위임한다.
- `js/engine/effect-definition.js`
  - `negateTags`, `processingNegate` 메타를 정규화 결과에 보존한다.

## 핵심 규칙

1. 체인 링크가 해결되기 직전에만 확인한다.
2. 처리 시 무효 효과는 체인에 올라가지 않는다.
3. 처리 시 무효 효과 자체의 `resolve`는 즉시 처리된다.
4. 무효가 적용되면 원래 체인 링크의 `resolve`는 실행하지 않는다.
5. 태그가 없는 체인 링크는 무효 후보가 되지 않는다.
6. 무효 대상 태그가 없는 `processingNegate` 효과도 후보가 되지 않는다.

## 지원 태그

- `deckSearch`
- `monsterSummon`
- `deckSummon`
- `handSummon`
- `graveSummon`
- `exileSummon`
- `keyDeckSummon`
- `sendMyFieldToGrave`
- `targetMyField`
- `discardHand`
- `banishField`
- `draw`
- `placeFieldCard`
- `negateEffect`

## API

- `findProcessingNegateCandidates(chainLink, gameState, ctx)`
- `canApplyProcessingNegate(candidate, chainLink, ctx)`
- `askProcessingNegateActivation(candidate, chainLink, ctx)`
- `applyProcessingNegate(candidate, chainLink, ctx)`
- `applyFirstProcessingNegate(chainLink, gameState, ctx)`
- `getHistory()`
- `clearHistory()`

## 등록 예시

```js
HB_EFFECT_REGISTRY.registerEffect({
  id: 'rlyeh_3',
  cardId: '태평양 속 르뤼에',
  type: HB_RULES.EFFECT_TYPES.PROCESSING_NEGATE,
  zone: 'fieldZone',
  optional: true,
  isActivated: false,
  tags: [HB_RULES.EFFECT_TAGS.NEGATE_EFFECT],
  negateTags: [HB_RULES.EFFECT_TAGS.DECK_SUMMON],
  condition(ctx) {
    return ctx.chainLink && ctx.chainLink.cardId && /그레이트 올드 원/.test(ctx.chainLink.cardId);
  },
  resolve(ctx) {
    return { ok: true, negated: true };
  },
});
```

## 완료 확인

- 처리 시 무효가 새 체인 링크를 만들지 않는다.
- 태그 기반으로만 후보가 수집된다.
- 태그 없는 효과는 무효 후보가 되지 않는다.
- `negateTags`가 맞지 않으면 후보가 되지 않는다.
- 무효 적용 시 원래 효과의 `resolve`가 실행되지 않는다.
