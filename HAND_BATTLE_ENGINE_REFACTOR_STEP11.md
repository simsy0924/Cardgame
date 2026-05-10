# HAND BATTLE Engine Refactor — Step 11

## 목표

필드 카드 처리를 다음 네 가지로 분리한다.

1. 패에서 필드 카드 발동
2. 효과로 필드 존에 놓기
3. 필드 카드 발동 무효 처리
4. 필드 존에서 발동하는 효과 버튼 표시

## 생성 파일

- `js/engine/field-zone.js`

## 전역 네임스페이스

- `window.HB_FIELD_ZONE`
- `window.HB_ENGINE.fieldZone`

## 구현 함수

- `activateFieldCardFromHand(options)`
- `placeFieldCardByEffect(options)`
- `replaceFieldCard(options)`
- `resolveFieldCardActivation(options)`
- `negateFieldCardActivation(options)`
- `getFieldZoneEffects(player, gameState)`
- `canActivateFieldZoneEffect(ctx, effect)`
- `activateSelectedFieldZoneEffect(options)`
- `renderFieldZoneActionButtons(options)`
- `getFieldZoneContinuousDescriptions(player, gameState)`
- `getPendingActivationRecords()`

## 핵심 처리

### 패에서 필드 카드 발동

`activateFieldCardFromHand()`는 다음 순서로 처리한다.

1. 자신 전개 단계인지 확인한다.
2. 체인 중이 아닌지 확인한다.
3. 패에서 필드 카드를 제거한다.
4. 기존 필드 존 카드가 있으면 묘지로 보낸다.
5. 새 필드 카드를 필드 존에 놓는다.
6. `fieldActivate` 체인 링크를 만든다.
7. 체인 해결 시 `resolveFieldCardActivation()`이 발동 시 효과 처리만 실행한다.

### 효과로 필드 존에 놓기

`placeFieldCardByEffect()`는 `activate: false`로 동작한다.

따라서 다음을 하지 않는다.

- fieldActivate 체인 생성
- `cardActivated` 발동 시 처리 효과 해결
- 발동 시 효과 처리

기존 필드 존 카드는 묘지로 보내고, 새 필드 카드의 지속 효과만 적용될 수 있게 둔다.

### 발동 무효

`negateFieldCardActivation()`은 방금 발동해 필드 존에 놓인 카드가 아직 필드 존에 있으면 묘지로 보낸다.

이미 다른 효과로 사라진 경우에는 중복 이동하지 않는다.

### 필드 존 효과 버튼

`getFieldZoneEffects()`는 다음 조건만 통과시킨다.

- `effect.zone === "fieldZone"`
- `effect.type === "activation"` 또는 `"quick"`
- `condition(ctx)`가 true
- field card activation 전용 태그가 없음

따라서 `continuous`, `procedure`, `processingNegate`, 필드 카드 발동 시 처리 효과는 버튼으로 뜨지 않는다.

## 수정 파일

- `index.html`
  - `field-zone.js` 로드 추가

- `js/effects-theme.js`
  - 일반 필드 카드 패 발동 경로를 `HB_FIELD_ZONE.activateFieldCardFromHand()`로 전환
  - 구버전 fallback은 유지

- `js/effects-chain.js`
  - 비어 있던 `fieldActivate` resolver를 `HB_FIELD_ZONE.resolveFieldCardActivation()`으로 연결

- `js/ui.js`
  - 필드 존 카드 클릭 시 `HB_FIELD_ZONE.renderFieldZoneActionButtons()` 호출

## 검증

통과한 테스트:

- 전체 JS syntax check
- 패에서 필드 카드 발동 시 기존 필드 카드 묘지 이동
- 패에서 발동한 필드 카드가 필드 존에 놓이는지 확인
- `fieldActivate` 체인 링크 생성 확인
- 발동 시 효과가 체인 해결 시 1회만 실행되는지 확인
- 효과로 필드 존에 놓을 경우 발동 시 효과가 실행되지 않는지 확인
- 발동 무효 시 필드 카드가 묘지로 이동하는지 확인
- 필드 존 버튼 후보에서 지속 효과/발동 시 처리 효과 제외 확인
- 9단계 trigger queue 회귀 테스트
- 10단계 continuous engine 회귀 테스트

## 아직 하지 않은 것

- 모든 테마 필드 카드 효과를 EffectDefinition으로 이식하지는 않았다.
- 수호의 빛 등 일부 레거시 특수 필드 카드 처리는 아직 기존 resolver를 유지한다.
- 네트워크 권위 동기화는 12단계 이후 별도 처리 대상이다.
