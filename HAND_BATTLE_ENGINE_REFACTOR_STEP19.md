# HAND BATTLE Engine Refactor — Step 19

## 목적

18단계에서 index.html 로딩에서 제거한 구 테마/패치 파일을 실제 프로젝트 트리에서도 제거한다.
이번 단계의 기준은 "혹시 몰라 남겨둔 파일" 때문에 새 엔진과 레거시 로직이 다시 섞이는 일을 막는 것이다.

## 제거한 파일

### 구 테마/패치 파일

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
- `js/legacy/effect.old.js`

### 일회성 루트 테스트

- `test_bulgasaui_16_5.js`
- `test_cthulhu_16_4.js`
- `test_ruler_16_5.js`

이 테스트들은 `tests/engine/*` 자동 테스트와 수동 체크리스트로 대체되었기 때문에 루트에 남기지 않는다.

## 남겨둔 파일

아래 파일은 아직 게임 진입, 공통 체인 호환, 네트워크, UI 흐름에 직접 연결되어 있으므로 삭제하지 않는다.

- `js/effects-core.js`
- `js/effects-chain.js`
- `js/effects-theme.js`
- `js/engine.js`
- `js/network.js`
- `js/ui.js`
- `js/ai.js`

## 검증 기준

- 삭제된 레거시 파일이 실제로 존재하지 않아야 한다.
- 삭제된 레거시 파일이 `index.html`에서 로드되지 않아야 한다.
- 신 테마 정의 파일 `js/effects/theme/*.js`는 계속 로드되어야 한다.
- 전체 등록 효과 수는 289개를 유지해야 한다.
- 등록 효과 카드 수는 118장을 유지해야 한다.
- `activation / quick / trigger` 효과는 모두 `canResolve`를 가져야 한다.
- `continuous / procedure / replacement / processingNegate`는 `isActivated: true`가 되면 안 된다.

## 결과

레거시 테마 파일을 물리적으로 제거했고, `legacy-cleanup.test.js`를 강화해 파일이 다시 생기거나 index.html에 재연결되면 테스트가 실패하도록 했다.
