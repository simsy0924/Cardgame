# HAND BATTLE Engine Refactor — Step 14

## 목표

UI 효과 버튼을 카드 텍스트 파싱이 아니라 `EffectDefinition` / `EffectRegistry` 기준으로 생성한다.

## 적용 내용

- `js/engine/effect-ui.js` 추가
- `index.html`에 `effect-ui.js` 로드 추가
- `openCardDetail()`에서 `effectIds`가 있는 카드는 신엔진 UI만 사용하도록 분기
- `effectIds`가 없는 카드는 기존 텍스트/switch 기반 버튼 유지
- 필드 존 카드는 `fieldZone` zone으로 상세창을 열도록 변경
- 묘지 뷰어에서 신엔진 묘지 효과 버튼을 우선 표시하고, 없으면 기존 펭귄 묘지 버튼 유지

## 새 공개 API

- `window.HB_EFFECT_UI.getAvailableEffects(options)`
- `window.HB_EFFECT_UI.renderEffectButtons(card, zone, options)`
- `window.HB_EFFECT_UI.renderFieldZoneEffectButtons(card, options)`
- `window.HB_EFFECT_UI.renderTriggerChoiceDialog(triggers)`
- `window.HB_EFFECT_UI.renderCostSelectionDialog(request)`
- `window.HB_EFFECT_UI.renderTargetSelectionDialog(request)`

실행 계획의 함수명과 맞추기 위해 같은 이름의 전역 함수도 함께 노출한다.

## 버튼 표시 대상

표시:

- `activation`
- `quick`
- 필드 존의 `activation` / `quick`
- 묘지/제외 존의 `activation` / `quick`
- optional trigger 선택 팝업

표시하지 않음:

- `continuous`
- `procedure`
- `replacement`
- `processingNegate`
- `fieldCardActivation` 태그가 붙은 “필드 카드 발동 시 처리” 효과

## 중요한 판단

`effectIds`가 붙은 필드 카드도 패에서 발동할 수 있어야 하므로, 패 zone에서는 `EffectDefinition` 버튼과 별개로 `필드 카드 발동` synthetic 버튼을 생성한다. 이 버튼은 `HB_FIELD_ZONE.activateFieldCardFromHand()`를 직접 호출한다.

## 검증

- 전체 JS syntax check 통과
- 신규 effect UI 필터 테스트 통과
- activation/quick만 버튼 후보가 되는지 확인
- continuous/procedure/processingNegate가 버튼 후보에서 제외되는지 확인
- 필드 카드 synthetic hand activation 버튼 확인
- fieldZone 버튼에서 `fieldCardActivation` 태그와 continuous가 제외되는지 확인
- 13단계 network-sync 회귀 테스트 통과
- 12단계 processing-negate 회귀 테스트 통과
- 11단계 field-zone 회귀 테스트 통과
- 10단계 continuous 회귀 테스트 통과
- 9단계 trigger queue 회귀 테스트 통과

## 아직 하지 않은 것

- 실제 테마별 효과의 대량 `EffectDefinition` 이식은 16단계 이후 작업이다.
- 15단계에서 legacy bridge를 만들어 새 엔진 카드와 레거시 카드의 라우팅을 더 명확히 분리해야 한다.
