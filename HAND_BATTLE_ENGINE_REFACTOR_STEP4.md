# HAND BATTLE ENGINE REFACTOR — STEP 4

## 목표

카드 이동을 한 곳에서 처리하기 위한 신규 엔진 파일을 추가했다.
이번 단계는 기존 전역 함수(`sendToGrave`, `summonFromHand` 등)를 즉시 덮어쓰지 않는다.
레거시 함수와 동시에 동작시키면 같은 카드 이동이 두 번 처리될 수 있으므로, 새 엔진은 `window.HB_CARD_MOVE` 네임스페이스로만 제공한다.

## 추가 파일

- `js/engine/card-move.js`

## index.html 로딩 순서

```html
<script src="js/engine.js"></script>
<script src="js/engine/zone-access.js"></script>
<script src="js/engine/card-move.js"></script>
<script src="js/ui.js"></script>
```

`card-move.js`는 `HB_ZONE_ACCESS`에 의존하므로 반드시 `zone-access.js` 뒤에 로드해야 한다.

## 제공 함수

`window.HB_CARD_MOVE`에 다음 함수를 추가했다.

- `moveCard(options)`
- `summonCard(options)`
- `sendToGrave(options)`
- `banishCard(options)`
- `discardCard(options)`
- `addToHand(options)`
- `placeFieldCard(options)`
- `removeFieldCard(options)`
- `getFieldSlotLimit(gameState, controller)`
- `hasFieldSpace(gameState, controller)`
- `dispatchMoveEvent(gameState, event)`

## 반환 형식

성공 시:

```js
{
  ok: true,
  movedCard,
  event,
  events,
  diff
}
```

실패 시:

```js
{
  ok: false,
  error: "실패 이유"
}
```

## 이벤트 생성

이동 결과에 따라 다음 이벤트를 생성한다.

- 필드로 이동: `summon`
- 묘지로 이동: `sentToGrave`
- 제외로 이동: `exiled`
- 패/공개패로 이동: `addedToHand`
- 패에서 버림: `discarded` + `sentToGrave`
- 필드 카드 배치: `fieldCardPlaced`
- 필드 카드 이탈: `fieldCardLeft`
- 필드 카드 발동 선처리: `fieldCardPlaced` + `cardActivated`

아직 5단계 이벤트 버스가 없으므로 이벤트는 반환값으로 제공하고, 다음 훅이 존재할 경우에만 전달한다.

- `window.HB_EVENTS.dispatch(event, gameState)`
- `window.HB_TRIGGER_QUEUE.receiveEvent(event, gameState)`
- 브라우저 `hb:card-event` CustomEvent

## 의도적으로 하지 않은 것

- 기존 `sendToGrave`, `sendToExile`, `summonFromHand`, `summonFromDeck`, `summonFromGrave`를 덮어쓰지 않았다.
- 기존 테마 파일의 직접 `G.myField.push`, `G.myGrave.push`를 아직 일괄 치환하지 않았다.
- 필드 카드 발동 체인 생성은 실제 생성하지 않고 `activation` 후보 객체만 반환한다.
- 네트워크 동기화는 직접 실행하지 않고 `diff` 후보만 반환한다.

이유:

- 기존 코드와 새 이동 엔진이 동시에 상태를 변경하면 필드/묘지 수가 다시 꼬일 수 있다.
- 체인 엔진, 트리거 큐, 네트워크 싱크가 아직 없으므로 지금 자동 연결하면 오히려 중복 해결 위험이 크다.

## 다음 단계 연결 지점

5단계에서 이벤트 구조가 생기면 `dispatchMoveEvent`가 실제 이벤트 버스에 연결된다.
6단계 이후 체인 엔진이 생기면 `placeFieldCard({ activate: true })`가 반환하는 `activation` 후보를 체인 링크로 바꿀 수 있다.

## 간단 사용 예

```js
HB_CARD_MOVE.summonCard({
  gameState: G,
  cardId: '꼬마 펭귄',
  from: { controller: 'me', zone: 'hand' },
  controller: 'me',
  reason: 'effect'
});

HB_CARD_MOVE.sendToGrave({
  gameState: G,
  cardId: '상대 몬스터',
  from: { controller: 'opponent', zone: 'field' },
  controller: 'opponent',
  reason: 'effect'
});

HB_CARD_MOVE.placeFieldCard({
  gameState: G,
  cardId: '태평양 속 르뤼에',
  source: { controller: 'me', zone: 'deck' },
  controller: 'me',
  activate: false,
  reason: 'effect'
});
```
