# HAND BATTLE Engine Refactor — Step 8

## 목표

8단계는 신규 `EffectDefinition` 기반 효과가 레거시 `beginChain/resolveChain`에 직접 섞이지 않도록 별도의 체인 엔진을 만드는 단계다.

이번 단계에서는 기존 `effects-chain.js`를 제거하거나 덮어쓰지 않는다. 레거시 체인은 그대로 두고, 신규 효과만 `window.HB_CHAIN_ENGINE` 또는 `window.HB_ENGINE.chain`을 통해 체인 링크를 만들 수 있게 한다.

## 추가 파일

- `js/engine/chain-engine.js`

## index.html 로딩 순서

`effect-context.js` 다음, `ui.js` 이전에 로드한다.

```html
<script src="js/engine/effect-context.js"></script>
<script src="js/engine/chain-engine.js"></script>
<script src="js/ui.js"></script>
```

## 새 전역 네임스페이스

- `window.HB_CHAIN_ENGINE`
- `window.HB_ENGINE.chain`

`window.HB_ENGINE.chain`은 이후 단계에서 새 엔진 진입점을 한 곳으로 모으기 위한 호환 별칭이다.

## 구현 함수

필수 함수:

- `canActivateEffect(ctx, effect)`
- `payCost(ctx, effect)`
- `selectTargets(ctx, effect)`
- `createChainLink(ctx, effect, activationData)`
- `addChainLink(chainLink)`
- `openChainResponseWindow(ctx)`
- `resolveChain(ctx)`
- `resolveChainLink(ctx, chainLink)`
- `clearChain()`

보조 함수:

- `activateEffect(options)`
- `passChainResponse(controller)`
- `getChainState()`
- `getChainLinks()`
- `hasActiveChain()`
- `getUsageSnapshot()`
- `resetUsageCounters()`

## 발동 순서

`activateEffect()`는 다음 순서를 지킨다.

1. 효과 정규화/조회
2. `EffectContext` 생성
3. `condition` 확인
4. timing 확인
5. zone 확인
6. once per turn 확인
7. cost 선지불
8. target 지정
9. chain link 생성
10. chain link 추가
11. 체인 응답 창 오픈
12. 옵션에 따라 즉시 해결 가능

## 체인 링크 구조

신규 체인 링크는 다음 정보를 가진다.

- `id`
- `chainId`
- `effectId`
- `cardId`
- `cardName`
- `controller`
- `sourceZone`
- `sourceController`
- `sourceIndex`
- `source`
- `targets`
- `paidCost`
- `tags`
- `negated`
- `negateReason`
- `createdAtPhase`
- `createdAtTurn`
- `createdAt`
- `sequence`
- `activationData`

## 해결 순서

`resolveChain()`은 체인 링크를 마지막 링크부터 해결한다.

1. 마지막 링크부터 꺼냄
2. 링크에 연결된 `EffectDefinition` 조회
3. 링크 전용 `EffectContext` 생성
4. 이미 무효 표시된 링크인지 확인
5. 처리 시 무효 후보 확인
6. 무효되면 `resolve` 스킵
7. 무효가 아니면 `effect.resolve(ctx)` 실행
8. `chainLinkResolved` 이벤트 발행
9. 모든 링크 해결 후 체인 정리
10. pending game event dispatch

## 처리 시 무효 훅

이번 단계에서는 완성된 무효 시스템을 만들지 않고, 훅만 만들었다.

지원 방식:

1. `window.HB_PROCESSING_NEGATE.findCandidates(ctx, chainLink, effect)`가 있으면 우선 사용
2. 없으면 `EffectRegistry`에서 `processingNegate` 타입 효과를 조회
3. 후보의 `condition(ctx)`가 false가 아니면 후보로 인정
4. 후보의 `resolve(ctx)`가 성공하면 원래 링크의 `resolve`를 스킵
5. `effectNegated` 이벤트 발행

## once per turn 처리

신규 엔진 내부 카운터 `usageCounters`를 사용한다.

- 발동이 성공해서 체인 링크가 올라간 뒤 카운트를 증가시킨다.
- 코스트가 지불되고 효과가 무효되어도 카운트는 되돌리지 않는다.
- 레거시 `markEffectUsed(cardId, effectNo)`가 있으면 느슨하게 동기화한다.

## 의도적으로 하지 않은 것

- 기존 `beginChain()`을 덮어쓰지 않음
- 기존 `resolveChain()`을 제거하지 않음
- `effects-chain.js`를 삭제하지 않음
- 네트워크 체인 동기화 구조를 아직 바꾸지 않음
- 모든 카드 효과를 신규 체인으로 이식하지 않음

## 검증

실행한 검증:

- 전체 JS syntax check 통과
- 신규 `EffectDefinition` 발동 효과가 체인 링크를 만드는지 확인
- 코스트가 체인 링크 생성 전에 지불되는지 확인
- 체인이 LIFO, 즉 마지막 링크부터 해결되는지 확인
- once per turn 제한이 작동하는지 확인
- 처리 시 무효 훅이 `resolve`를 스킵하는지 확인

## 다음 단계 주의점

9단계 유발 큐를 만들 때는 `HB_EVENTS`의 pending event와 `HB_CHAIN_ENGINE.activateEffect()`를 연결하면 된다. 레거시 `pendingTriggerEffects`와 신규 `HB_TRIGGER_QUEUE`가 중복으로 같은 효과를 체인에 올리지 않도록 반드시 분리해야 한다.
