# HAND BATTLE 엔진 재설계 — 10단계 완료 기록

## 목표

필드에 존재하는 동안 계속 적용되는 지속 효과를 버튼/체인/유발 큐와 분리한다.

## 추가 파일

- `js/engine/continuous-engine.js`

## 전역 네임스페이스

- `window.HB_CONTINUOUS_ENGINE`
- `window.HB_ENGINE.continuous`

## 구현 함수

- `getActiveContinuousEffects(gameState)`
- `isContinuousEffectActive(effect, ctx)`
- `applyContinuousEffects(gameState)`
- `checkTargetProtection(ctx)`
- `checkEffectImmunity(ctx)`
- `checkCannotBeSentToGrave(ctx)`
- `getAttackModifier(card, ctx)`
- `getAvailableMonsterZoneCount(player, gameState)`
- `canAttackWithMonster(ctx)`
- `resetContinuousState(gameState)`

## 연결 지점

- `index.html`
  - `trigger-queue.js` 다음, `ui.js` 이전에 `continuous-engine.js`를 로드한다.
- `ui.js`
  - `renderAll()` 시작 시 `applyContinuousEffects(G)`를 호출한다.
  - 자신/상대 몬스터 존 렌더링 수를 `getAvailableMonsterZoneCount()` 기준으로 계산한다.
- `engine.js`
  - `maxFieldSlots(controller)`가 지속 효과 기반 존 수를 우선 사용한다.
- `card-move.js`
  - `getFieldSlotLimit()`가 지속 효과 기반 존 수를 우선 사용한다.

## 이 단계에서 하지 않은 것

- 레거시 테마 파일의 지속 효과를 전부 새 `EffectDefinition`으로 이식하지 않았다.
- `effects-chain.js`의 기존 체인 시스템을 삭제하지 않았다.
- 필드 존 발동/무효 처리는 아직 11단계로 남겨두었다.

## 검증

- 전체 JS syntax check 통과.
- 지속 효과 활성 조회 통과.
- 메드 키메라형 대상 보호/묘지 보내기 보호 체크 통과.
- 공격력 지속 보정 적용 통과.
- 몬스터 존 축소 보정 및 `HB_CARD_MOVE.getFieldSlotLimit()` 연동 통과.
- 지속 효과가 `HB_TRIGGER_QUEUE.collectTriggers()`에 들어가지 않는 회귀 테스트 통과.

## 10단계 보정: 불가사의 효과 타입 자동 분류 규칙

사용자 지적에 따라 `EffectDefinition` 정규화 단계에 불가사의 테마 전용 기본 분류 규칙을 추가했다.

적용 위치:
- `js/engine/effect-definition.js`

규칙:
1. 수동으로 `type`을 명시한 EffectDefinition은 항상 수동 값이 우선이다.
2. `theme === "불가사의"`이고 효과 텍스트가 `처리 시` + `무효`를 포함하면 `processingNegate`로 분류한다.
3. `theme === "불가사의"`이고 몬스터의 “이 카드는 ... 소환할 수 있다” 텍스트이면 `procedure`로 분류한다.
4. 그 외 `theme === "불가사의"` 효과 중 텍스트에 `발동`이 없으면 `continuous`로 분류한다.
5. `continuous`, `procedure`, `processingNegate`는 기본적으로 `isActivated: false`로 정규화한다.

의도:
- 불가사의의 처리 시 무효가 일반 퀵/유발 체인으로 뜨지 않게 한다.
- “발동”이 없는 불가사의 지속형 문장이 버튼/체인/유발 후보로 뜨지 않게 한다.
- 묘지/제외 상태에서의 자체 소환 가능 문장은 지속효과가 아니라 소환 절차로 보존한다.

검증:
- 불가사의 공격력 상승 문구가 `continuous`로 분류되는지 확인.
- 불가사의 처리 시 무효 문구가 `processingNegate`로 분류되는지 확인.
- 불가사의 자체 소환 문구가 `procedure`로 분류되는지 확인.
- 불가사의의 `발동할 수 있다` 문구는 기존처럼 `activation`으로 남는지 확인.
- 수동 `type` 명시가 자동 분류보다 우선하는지 확인.
