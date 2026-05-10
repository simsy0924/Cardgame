# HAND BATTLE Engine Refactor — Step 3

## 목적

기존 코드에는 `G.myField`, `G.opField`, `G.myGrave` 같은 직접 접근이 매우 많다.
이 직접 접근을 한 번에 전부 제거하면 위험하므로, 먼저 새 엔진 코드가 사용할 표준 존 접근 어댑터를 만든다.

이번 단계는 카드 이동 엔진 구현 단계가 아니다. 실제 카드 이동 이벤트, 체인, 네트워크 동기화는 아직 연결하지 않는다.

## 생성한 파일

- `js/engine/zone-access.js`

## 전역 네임스페이스

현재 프로젝트는 ES module 기반이 아니므로 `export/import`를 쓰지 않는다.
대신 아래 전역 네임스페이스에 존 접근 함수를 등록한다.

```js
window.HB_ZONE_ACCESS
```

## 지원 controller

신규 구현에서는 아래 두 값을 기본으로 사용한다.

```js
"me"
"opponent"
```

임시 호환 별칭으로 `my`, `mine`, `self`, `op`, `enemy`도 받을 수 있지만,
새 코드에서는 `me/opponent`만 사용한다.

## 지원 zone

2단계의 `window.HB_RULES.ZONES` 값을 기준으로 한다.

- `deck`
- `hand`
- `publicHand`
- `field`
- `fieldZone`
- `grave`
- `exile`
- `keyDeck`

## 구현한 함수

- `getZoneArray(gameState, controller, zone)`
- `getZoneSize(gameState, controller, zone)`
- `getCardFromZone(gameState, controller, zone, index)`
- `findCardLocation(gameState, cardIdOrPredicate)`
- `hasCardInZone(gameState, controller, zone, cardIdOrPredicate)`
- `removeCardFromZone(gameState, controller, zone, cardIdOrPredicate)`
- `insertCardToZone(gameState, controller, zone, card, index)`
- `getFieldZoneCard(gameState, controller)`
- `setFieldZoneCard(gameState, controller, card)`
- `clearFieldZoneCard(gameState, controller)`

## 기존 G 구조 매핑

`controller === "me"`:

- `hand` → `G.myHand`
- `field` → `G.myField`
- `grave` → `G.myGrave`
- `exile` → `G.myExile`
- `deck` → `G.myDeck`
- `keyDeck` → `G.myKeyDeck`
- `fieldZone` → `G.myFieldCard`

`controller === "opponent"`:

- `hand` → `G.opHand`
- `field` → `G.opField`
- `grave` → `G.opGrave`
- `exile` → `G.opExile`
- `deck` → `G.opDeck`가 있으면 사용, 없고 `G.opDeckCount`만 있으면 읽기용 빈 배열 처리
  - count만 있는 비공개 존은 `insertCardToZone/removeCardFromZone`에서 직접 조작하지 않고 오류를 낸다
- `keyDeck` → `G.opKeyDeck`
- `fieldZone` → `G.opFieldCard`

## 중요한 판단

`fieldZone`은 `field`처럼 배열이 아니라 단일 카드 슬롯이다.
따라서 신규 코드에서는 `getZoneArray(..., "fieldZone")`로 조작하지 않고,
반드시 아래 전용 함수를 사용한다.

```js
getFieldZoneCard(G, "me")
setFieldZoneCard(G, "me", card)
clearFieldZoneCard(G, "me")
```

`getZoneArray(..., "fieldZone")`는 조회 편의를 위해 카드가 있으면 `[card]`, 없으면 `[]`를 반환하지만,
실제 변경은 전용 함수를 사용해야 한다.

## index.html 변경

`engine.js` 다음, `ui.js` 이전에 다음 스크립트를 추가했다.

```html
<script src="js/engine/zone-access.js"></script>
```

`engine.js`에서 `G`가 만들어진 뒤 로드되도록 하여, 기존 브라우저 전역 스크립트 환경에서 안전하게 사용할 수 있게 했다.

## 완료 기준

- `window.HB_ZONE_ACCESS`가 생성된다.
- 신규 엔진 파일은 앞으로 `G.myField` 직접 접근 대신 이 어댑터를 사용할 수 있다.
- 기존 전체 코드를 무리하게 일괄 치환하지 않았다.
- 카드 이동/이벤트/네트워크 동기화는 아직 건드리지 않았다.

## 다음 단계

4단계에서는 `js/engine/card-move.js`를 만들고,
카드 이동을 `moveCard`, `summonCard`, `sendToGrave`, `banishCard`, `placeFieldCard` 같은 공통 함수로 중앙화한다.
