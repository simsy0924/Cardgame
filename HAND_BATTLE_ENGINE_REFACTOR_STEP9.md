# HAND BATTLE Engine Refactor — Step 9

## 목표

9단계는 소환/묘지/제외/필드 카드 이벤트 뒤에 발생하는 `trigger` 효과를 중앙에서 수집하고, 강제 효과와 임의 효과를 분리하는 단계다.

이번 단계에서 실제 카드 효과를 대량 이식하지 않는다. 새 엔진이 받을 `EffectDefinition`만 처리한다.

## 추가 파일

- `js/engine/trigger-queue.js`

## 전역 네임스페이스

- `window.HB_TRIGGER_QUEUE`
- `window.HB_ENGINE.triggers`

## 구현 함수

- `collectTriggers(event, gameState)`
- `enqueueTrigger(effect, ctx)`
- `enqueueMandatoryTriggers(triggers)`
- `enqueueOptionalTriggers(triggers)`
- `showOptionalTriggerChoices(player, triggers)`
- `activateSelectedTrigger(selection)`
- `processTriggerQueue(gameState)`

추가로 이벤트 버스 연동용 함수를 제공한다.

- `receiveEvent(event, gameState)`
- `enqueueEvent(event, gameState)`

테스트/디버그용 함수도 포함한다.

- `clearTriggerQueue()`
- `getQueueState()`
- `getTriggerHistory()`

## 강제/임의 기준

- `effect.optional === false` 또는 `effect.mandatory === true`
  - 강제 효과
  - 조건 만족 시 `mandatoryQueue`에 들어간 뒤 자동으로 `HB_CHAIN_ENGINE.activateEffect()`로 체인에 올라간다.

- `effect.optional === true`
  - 임의 효과
  - `optionalQueue`에 보관된다.
  - 자동 발동하지 않고 `showOptionalTriggerChoices()`가 선택 후보를 UI/DOM 이벤트로 알린다.
  - 실제 발동은 `activateSelectedTrigger()`를 호출해야 한다.

## 확실히 제외한 것

아래 타입은 trigger queue에 들어가지 않는다.

- `continuous`
- `procedure`
- `replacement`

즉, 메드 키메라 같은 지속 효과가 소환 유발 후보로 뜨는 문제를 막는 기반이 생겼다.

## 기존 코드와의 관계

- 기존 `effects-chain.js`는 덮어쓰지 않았다.
- 기존 카드 효과 파싱 로직도 수정하지 않았다.
- 신규 `EffectDefinition`으로 등록된 `type: 'trigger'` 효과만 이 큐에서 처리한다.

## 완료 기준

- 소환 시 유발 후보 수집 가능
- 강제 효과 자동 체인 등록 가능
- 임의 효과 선택 후보 표시 가능
- 지속 효과는 유발 후보에서 제외
- event-bus의 `dispatchEvents()`가 `HB_TRIGGER_QUEUE.receiveEvent()`로 전달 가능
