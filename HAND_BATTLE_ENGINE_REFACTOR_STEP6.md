# HAND BATTLE 엔진 리팩터 6단계 완료 메모

## 목적

카드 텍스트를 즉석에서 파싱해 효과를 추측하는 구조를 버리고, 명시적인 `EffectDefinition` 객체를 등록·조회하는 구조를 추가했다.

이번 단계는 효과 실행/체인 연결 단계가 아니다. 새 카드 효과를 안전하게 이식하기 위한 정의/등록 기반만 만든다.

## 추가 파일

- `js/engine/effect-definition.js`
- `js/effects/effect-registry.js`

## 로딩 순서

`index.html`에서 룰 상수 파일 이후, `engine.js` 이전에 다음 순서로 로드한다.

```html
<script src="js/engine/effect-definition.js"></script>
<script src="js/effects/effect-registry.js"></script>
```

## 새 네임스페이스

### `window.HB_EFFECT_DEFINITION`

효과 정의의 생성/검증/분류만 담당한다.

핵심 함수:

- `createEffectDefinition(raw)`
- `normalizeEffectDefinition(raw)`
- `validateEffectDefinition(raw)`
- `effectHasZone(effect, zone)`
- `effectHasEvent(effect, eventType)`
- `effectHasTag(effect, tag)`
- `isActivatedEffect(effect)`
- `isTriggerEffect(effect)`
- `isContinuousEffect(effect)`
- `isProcedureEffect(effect)`
- `makeEffectId(cardId, effectNo, suffix)`

정규화되는 필드:

- `id`
- `cardId`
- `effectNo`
- `text`
- `type`
- `speed`
- `timing`
- `zone` / `zones`
- `event` / `events`
- `isActivated`
- `optional`
- `mandatory`
- `oncePerTurn`
- `condition(ctx)`
- `cost(ctx)`
- `target(ctx)`
- `resolve(ctx)`
- `tags`
- `summonProcedure`
- `continuousRule`
- `meta`

### `window.HB_EFFECT_REGISTRY`

효과 정의의 중앙 등록소다.

필수 함수:

- `registerEffect(effectDefinition)`
- `registerEffects(effectDefinitions)`
- `getEffectById(effectId)`
- `getEffectsByCardId(cardId)`
- `getEffectsByCardAndZone(cardId, zone)`
- `getEffectsByType(type)`
- `getTriggerEffectsByEvent(eventType)`
- `getContinuousEffects()`
- `getProcedureEffectsByCard(cardId)`

추가 편의 함수:

- `unregisterEffect(effectId)`
- `getActivatedEffectsByCardAndZone(cardId, zone)`
- `getEffectCandidates(query)`
- `listEffects()`
- `hasEffect(effectId)`
- `clearRegistry()`
- `syncEffectIdsToCards(cardsDb)`
- `getRegistryStats()`

## 설계 결정

1. 기존 효과 실행 함수는 아직 덮어쓰지 않았다.
   - 이 단계에서 실행 연결까지 하면 레거시 효과와 중복 발동할 수 있다.

2. `cards.js`의 모든 카드에 `effectIds`를 한 번에 넣지 않았다.
   - 실행 계획대로 테마별 이식 단계에서 해당 테마부터 붙인다.
   - 대신 등록 시 해당 카드가 존재하면 `card.effectIds`에 자동 반영하는 보조 로직을 넣었다.

3. 효과 정의는 등록 시 `Object.freeze()`로 고정된다.
   - 런타임 중 효과 구조가 몰래 바뀌는 문제를 줄이기 위함이다.

4. `zone`과 `event`는 단일값/배열을 모두 받을 수 있다.
   - 정규화 후 `zones`, `events` 배열로 조회한다.

5. `condition/cost/target/resolve`는 함수만 허용한다.
   - 없으면 안전한 no-op 기본 함수로 채운다.
   - 함수가 아닌 값이 들어오면 등록 시 오류를 낸다.

## 완료 기준 체크

- [x] 효과 ID로 효과 정의를 찾을 수 있음
- [x] 카드별 효과 조회 가능
- [x] 카드별/존별 효과 조회 가능
- [x] 타입별 효과 조회 가능
- [x] 이벤트별 유발 효과 조회 가능
- [x] 지속 효과 조회 가능
- [x] 소환 절차 효과 조회 가능
- [x] 카드 텍스트 파싱 없이 UI 버튼 후보를 만들 수 있는 조회 함수 제공

## 다음 단계

7단계에서는 `EffectContext`를 만든다.

모든 `condition/cost/target/resolve`가 같은 형식의 `ctx`를 받도록 표준화해야 한다.
