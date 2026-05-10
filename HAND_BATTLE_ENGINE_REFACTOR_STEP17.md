# HAND BATTLE Engine Refactor — Step 17

## 단계명

자동/수동 테스트 체크리스트 구축

## 목적

16단계에서 테마별 효과 정의 이식을 완료했으므로, 이후 수정 때마다 같은 기준으로 회귀 검사를 수행할 수 있는 테스트 구조를 만든다.

## 추가한 파일

### 수동 체크리스트

- `tests/manual/common-checklist.md`
- `tests/manual/network-checklist.md`
- `tests/manual/circusmare-checklist.md`
- `tests/manual/cthulhu-checklist.md`
- `tests/manual/elements-checklist.md`
- `tests/manual/penguin-checklist.md`
- `tests/manual/ruler-checklist.md`
- `tests/manual/bulgasaui-checklist.md`
- `tests/manual/mafia-checklist.md`
- `tests/manual/lion-tiger-liger-checklist.md`

실행 계획 필수 항목인 공통/네트워크/서커스메어/크툴루/엘리멘츠에 더해, 16단계에서 실제 이식한 나머지 테마도 체크리스트를 추가했다.

### 자동 테스트

- `tests/engine/_setup.js`
- `tests/engine/card-move.test.js`
- `tests/engine/chain-engine.test.js`
- `tests/engine/trigger-queue.test.js`
- `tests/engine/field-zone.test.js`
- `tests/engine/effect-registry.test.js`
- `tests/engine/run-engine-tests.js`

## 실행 방법

```bash
node tests/engine/run-engine-tests.js
```

## 자동 테스트 검증 범위

- 카드 이동 공통 함수가 존 이동과 이벤트를 만든다.
- 몬스터 존이 가득 차면 소환이 실패한다.
- `canResolve === false`인 발동 효과는 체인에 올라가지 않는다.
- 코스트는 체인 해결 전에 먼저 처리된다.
- 체인은 마지막 링크부터 해결된다.
- 소환 절차는 체인에 올라가지 않는다.
- 유발 효과는 이벤트로 수집된다.
- `canResolve === false`인 유발 효과는 후보에서 제외된다.
- 지속 효과는 유발 큐에 들어가지 않는다.
- 필드 카드는 패에서 발동하면 필드 존에 놓이고 기존 필드 카드가 묘지로 간다.
- 효과로 필드 존에 놓을 수 있다.
- 16단계 테마 효과가 전체 등록된다.
- `activation / quick / trigger` 효과는 `canResolve`를 가진다.
- `trigger` 효과는 이벤트를 가진다.
- `continuous / procedure / replacement / processingNegate`는 `isActivated`가 아니다.

## 이번 단계에서 발견해 수정한 문제

`replacement` 타입 효과 2개가 `isActivated: true`로 정규화되고 있었다.

수정:
- `js/engine/effect-definition.js`
- `inferIsActivated()`에서 `replacement`도 비발동 효과로 처리하도록 수정

영향:
- `펭귄 마을` 대체 효과
- `서커스메어 메드 퍼레이드` 대체 효과

두 효과가 일반 발동 버튼/체인 후보로 잘못 분류될 가능성을 차단했다.

## 완료 기준

- 자동 테스트 전체 통과
- 수동 체크리스트 파일 생성 완료
- 18단계 레거시 제거 전 회귀 기준 확보
