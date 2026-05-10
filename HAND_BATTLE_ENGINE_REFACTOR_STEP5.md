# HAND BATTLE ENGINE REFACTOR — STEP 5

## 목표

카드 이동 결과가 유발 효과, 지속 효과, 네트워크 동기화, UI 로그, AI 판단으로 이어질 수 있도록 중앙 이벤트 발생 구조를 만든다.

## 완료 내용

### 1. 이벤트 버스 추가

새 파일:

- `js/engine/event-bus.js`

생성 전역:

- `window.HB_EVENTS`

필수 함수:

- `emitGameEvent(event)`
- `getPendingEvents()`
- `clearPendingEvents()`
- `subscribeGameEvent(type, handler)`
- `dispatchEvents(gameState)`

보조 함수:

- `dispatch(event, gameState)`
- `getEventLog()`
- `clearEventLog()`
- `isKnownEventType(type)`

### 2. 카드 이동 엔진과 연결

`js/engine/card-move.js`의 `dispatchMoveEvent()`를 수정했다.

변경 전:

- `HB_EVENTS.dispatch()`가 있으면 즉시 dispatch
- 없으면 `HB_TRIGGER_QUEUE`에 직접 전달

변경 후:

- `HB_EVENTS.emitGameEvent()`로 중앙 pending queue에 이벤트 등록
- 이벤트 버스가 없을 때만 fallback으로 `HB_TRIGGER_QUEUE`에 직접 전달

이제 카드 이동 함수들은 직접 다른 엔진을 호출하지 않고 이벤트 버스를 통한다.

### 3. 이벤트 정규화

이벤트 버스는 들어온 이벤트에 다음 값을 자동 부여한다.

- `eventId`
- `sequence`
- `timestamp`

따라서 이후 trigger queue, chain engine, network sync가 같은 이벤트를 안정적으로 추적할 수 있다.

### 4. 구독 구조 추가

예시:

```js
const unsubscribe = HB_EVENTS.subscribeGameEvent('summon', (event, gameState) => {
  console.log(event.cardName, '소환됨');
});
```

`'*'` 구독도 지원한다.

```js
HB_EVENTS.subscribeGameEvent('*', (event) => {
  console.log('모든 이벤트:', event.type);
});
```

### 5. optional engine forwarder 추가

`dispatchEvents(gameState)` 실행 시 존재하는 경우에만 다음 엔진으로 이벤트를 전달한다.

- `HB_TRIGGER_QUEUE.receiveEvent(event, gameState)`
- `HB_TRIGGER_QUEUE.enqueueEvent(event, gameState)`
- `HB_CONTINUOUS_ENGINE.receiveEvent(event, gameState)`
- `HB_CONTINUOUS_ENGINE.handleGameEvent(event, gameState)`
- `HB_NETWORK_SYNC.receiveEvent(event, gameState)`
- `HB_NETWORK_SYNC.enqueueEvent(event, gameState)`
- `HB_AI_EVENT_OBSERVER.receiveEvent(event, gameState)`

아직 없는 엔진은 무시한다.

### 6. DOM 이벤트 추가

UI/디버그용으로만 사용한다.

- emit 시: `hb:event-emitted`
- dispatch 시: `hb:event-dispatched`

룰 처리는 DOM 이벤트가 아니라 `HB_EVENTS`를 기준으로 한다.

### 7. index.html 로딩 순서

`event-bus.js`를 `zone-access.js` 다음, `card-move.js` 이전에 로드한다.

```html
<script src="js/engine/zone-access.js"></script>
<script src="js/engine/event-bus.js"></script>
<script src="js/engine/card-move.js"></script>
```

## 검증

Node VM 테스트 파일:

- `/mnt/data/test_event_bus_step5.js`

확인 항목:

- `HB_EVENTS` 생성
- 필수 함수 존재
- `summonCard()`가 `summon` pending event 생성
- `dispatchEvents()`가 구독자와 `HB_TRIGGER_QUEUE`에 이벤트 전달
- `sendToGrave()`가 `sentToGrave` event 생성
- `placeFieldCard({ activate: true })`가 `fieldCardPlaced`, `cardActivated` event 생성
- 전체 `js/**/*.js` syntax check 통과

## 이번 단계에서 일부러 하지 않은 것

- 레거시 `handleSummonTriggers`, `checkFieldCardActivation` 등은 아직 연결하지 않았다.
- 실제 유발 효과 선별은 6단계 이후 `EffectDefinition`/`EffectRegistry`가 생긴 다음 처리한다.
- 네트워크 동기화도 아직 실행하지 않고, 이후 `HB_NETWORK_SYNC`가 생기면 이벤트 버스가 전달할 수 있게만 열어두었다.

## 다음 단계

6단계:

- `js/effects/effect-definition.js`
- `js/effects/effect-registry.js`
- 효과를 텍스트 파싱이 아니라 명시적 EffectDefinition으로 등록하는 구조 생성
