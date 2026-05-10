# HAND BATTLE ENGINE REFACTOR — STEP 18

## 목표

17단계까지 구축한 신엔진 테스트 기반 위에서, 이식이 끝난 테마의 레거시 런타임 덮어쓰기/텍스트 파싱 경로를 더 이상 로드하지 않도록 정리한다.

## 적용 원칙

- 같은 효과를 레거시 함수와 `EffectDefinition` 양쪽에서 동시에 처리하지 않는다.
- `patch.js`처럼 런타임에 핵심 함수를 덮어쓰는 파일은 로딩에서 제거한다.
- 테마별 구 구현 파일은 당장 물리 삭제하지 않고 보존하되, `index.html`에서는 더 이상 로드하지 않는다.
- 덱 프리셋처럼 아직 필요한 비효과 데이터는 `ui.js` 본체로 이동한다.
- 실제 효과 로직은 `js/effects/theme/*.js`와 공통 엔진으로 유지한다.

## 변경 내용

1. `index.html`에서 아래 레거시 스크립트 로딩 제거
   - `js/penguin.js`
   - `js/jibaeja.js`
   - `js/theme-common.js`
   - `js/lion.js`
   - `js/tiger.js`
   - `js/liger.js`
   - `js/cthulhu.js`
   - `js/mafia.js`
   - `js/bulgasaui.js`
   - `js/Elements.js`
   - `js/patch.js`
   - `js/circusmare.js`

2. `patch.js`/`circusmare.js`에 있던 덱 프리셋을 `ui.js::loadPreset()`으로 이전
   - 서커스메어
   - 라이온
   - 타이거
   - 라이거
   - 크툴루/올드원
   - 불가사의

3. `progression.js` 기본 프리셋 목록에 `서커스메어` 추가

4. 자동 테스트 추가
   - `tests/engine/legacy-cleanup.test.js`
   - `tests/engine/run-engine-tests.js`에 포함

## 검증 결과

- 전체 JS syntax check 통과
- 자동 엔진 테스트 6개 통과
  - card-move
  - chain-engine
  - trigger-queue
  - field-zone
  - effect-registry
  - legacy-cleanup
- 등록 효과 수 유지: 289개
- 등록 효과 카드 수 유지: 118장
- `continuous / procedure / replacement / processingNegate` 중 `isActivated: true`인 효과 없음
- `activation / quick / trigger` 중 `canResolve` 없는 효과 없음

## 남긴 것

- `effects-core.js`, `effects-chain.js`, `effects-theme.js`는 아직 공용 카드/게임 진입/레거시 체인 호환 기능이 남아 있으므로 유지했다.
- 구 테마 파일들은 물리 삭제하지 않고 보존했다. 필요 시 비교/복구용으로 쓸 수 있지만 `index.html`에서 로드되지는 않는다.

## 다음 단계

19단계에서는 실제 멀티플레이/AI전 기준으로 권위 상태 동기화, 체인 중복 해결, 필드/묘지/제외 수 일치 여부를 검증한다.
