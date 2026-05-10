# HAND BATTLE ENGINE REFACTOR STEP 16-8

## 대상
라이온 / 타이거 / 라이거 테마 이식.

## 추가 파일
- `js/effects/theme/lion.js`
- `js/effects/theme/tiger.js`
- `js/effects/theme/liger.js`

## 핵심 규칙
- 몬스터 존 확장/축소는 `continuous`로 등록한다.
- 사자/호랑이/라이온/타이거/라이거 이름 취급은 `continuousRule.nameTreatAs`로 명시한다.
- 라이온 킹 / 타이거 킹 / 라이거 킹 자체 소환은 `procedure` + `summonProcedure: true`로 등록한다.
- 라이거 킹 내성은 지속 효과 판정 구조로 분리한다.
- 모든 서치/소환/제외/묘지 보내기 효과는 `canResolve`에서 처리 가능성을 먼저 검사한다.

## 검증 기준
- 존 확장/축소가 체인을 만들지 않는다.
- `HB_CONTINUOUS_ENGINE.getAvailableMonsterZoneCount()`가 존 수 변동을 반영한다.
- `HB_CARD_MOVE.hasFieldSpace()`가 지속 효과 기반 존 수를 사용한다.
- 라이거 킹 내성이 `checkEffectImmunity()`에서 확인 가능하다.
- 처리 불가능한 효과는 버튼/체인 후보에 올라가지 않는다.
