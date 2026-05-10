# HAND BATTLE ENGINE REFACTOR — STEP 15

## 목표

기존 텍스트/switch 기반 효과 로직과 신규 `EffectDefinition` 엔진 사이에 호환 레이어를 둔다.
한 번에 모든 카드 효과를 옮기지 않고, 이식된 카드만 신엔진을 사용한다.

## 추가 파일

- `js/engine/legacy-bridge.js`

## 핵심 규칙

- `effectIds`가 있거나 `HB_EFFECT_REGISTRY`에 효과가 등록된 카드는 신엔진 카드로 본다.
- 신엔진 카드는 레거시 `activateCard`, `onSummon`, `onSentToGrave` 분기와 동시에 실행되면 안 된다.
- 이식되지 않은 카드는 기존 레거시 로직을 그대로 유지한다.

## 제공 API

- `isNewEngineCard(card)`
- `hasRegisteredEffects(card)`
- `shouldUseLegacyCard(card)`
- `routeCardActivation(card, ctx)`
- `routeSummonTrigger(event)`
- `routeSentToGraveTrigger(event)`
- `routeFieldZoneClick(card, ctx)`
- `shouldSuppressLegacyAction(card, reason)`

## 연결 지점

- `index.html`
  - `effect-ui.js` 다음, `ui.js` 이전에 `legacy-bridge.js` 로드.

- `effects-theme.js`
  - `activateCard(handIdx)` 시작 부분에서 신엔진 카드면 `routeCardActivation()`으로 넘기고 즉시 반환.

- `engine.js`
  - `onSummon(cardId, from)` 시작 부분에서 신엔진 유발 라우팅.
  - `onSentToGrave(cardId)` 시작 부분에서 신엔진 묘지 유발 라우팅.

- `ui.js`
  - 카드 상세창/묘지/필드 존 클릭에서 신엔진 카드 판정을 `HB_LEGACY_BRIDGE` 기준으로 통일.

## 안전장치

- 필드 카드는 패에서 발동할 때 반드시 `HB_FIELD_ZONE.activateFieldCardFromHand()`로 라우팅한다.
- 신엔진 유발 후보가 수집되면 레거시 트리거를 억제한다.
- 등록 효과가 없는 카드는 기존 버튼과 기존 테마 핸들러를 유지한다.

## 검증

- 전체 JS syntax check 통과.
- `handbattle_step15_test.js` 통과.
- step14 effect-ui 회귀 테스트 통과.
- step13 network-sync 회귀 테스트 통과.
- step12 processing-negate 회귀 테스트 통과.
- step11 field-zone 회귀 테스트 통과.
- step10 trigger queue 회귀 테스트 통과.

## 다음 단계

16단계에서는 이 호환 레이어를 기준으로 테마별 효과를 하나씩 `js/effects/theme/*.js`로 이식한다.
