# HAND BATTLE 엔진 재설계 13단계 — 네트워크 동기화 구조 재정리

## 목표

양쪽 클라이언트가 같은 체인/효과를 동시에 해결해서 필드, 묘지, 제외, 패 수가 서로 다르게 보이는 문제를 줄인다.

특히 기존 구조의 가장 큰 문제는 `chainState.resolvedLinks`를 양쪽 클라이언트가 수신한 뒤 둘 다 `executeChainLocally()`를 실행할 수 있다는 점이었다. 13단계에서는 체인 해결 결과에 `resolvedBy`, `authoritativeState`, `diff`를 붙여서 비권위 클라이언트는 효과를 재실행하지 않고 상태만 반영하게 했다.

## 새 파일

- `js/engine/network-sync.js`

## 새 전역 네임스페이스

- `window.HB_NETWORK_SYNC`
- `window.HB_ENGINE.network`

## 핵심 원칙

1. 체인 해결은 권위 클라이언트에서만 실제 실행한다.
2. 비권위 클라이언트는 상대 효과를 다시 실행하지 않는다.
3. `sendAction()`은 가능하면 로그/애니메이션/선택 요청용으로만 남긴다.
4. 실제 상태 반영은 `sendGameState`, `authoritativeState`, `diff`를 우선한다.
5. AI/로컬전도 중복 실행을 피한다.

## 구현된 기능

- `isAuthority()` / `hasAuthority()`
- `captureLocalState()`
- `createAuthoritativeState()`
- `applyAuthoritativeState()`
- `createStateDiff()`
- `sendStateDiff()`
- `applyStateDiff()`
- `sendLogAction()`
- `sendAnimationAction()`
- `requestOpponentChoice()`
- `handleOpponentChoiceResponse()`
- `shouldSuppressLegacyAction()`
- `consumeResolvedChainState()`
- `resolveLegacyChain()`
- `listenStateDiffs()`

## 수정된 파일

### `index.html`

`field-zone.js` 이후, `ui.js` 이전에 `network-sync.js`를 로드한다.

### `js/effects-chain.js`

기존 `resolveChain()`이 바로 Firebase에 `resolvedLinks`만 쓰던 구조를 바꿨다.

변경 후 흐름:

1. 권위 클라이언트가 `executeChainLocally()`를 1회 실행한다.
2. 실행 전/후 상태를 기록한다.
3. `authoritativeState`와 `diff`를 만든다.
4. Firebase `chainState`에 `resolvedBy`, `authoritativeState`, `diff`를 함께 쓴다.
5. 자기 자신이 다시 수신한 해결 이벤트는 무시한다.

### `js/network.js`

`listenChainState()`에서 해결 완료 체인을 받을 때 `HB_NETWORK_SYNC.consumeResolvedChainState()`를 우선 사용한다.

- `resolvedBy === myRole`이면 이미 내가 해결한 체인이므로 재실행하지 않는다.
- `authoritativeState`가 있으면 그 상태만 반영한다.
- 구버전 방처럼 권위 정보가 없으면 기존 방식으로 fallback한다.

또한 `handleOpponentAction()` 시작부에서 상태 변경형 레거시 액션을 억제한다.

억제 대상 예시:

- `summon`
- `fieldCard`
- `combat`
- `discard`
- `opFieldRemove`
- `opFieldExile`
- `opFieldCardRemove`
- `opGraveExile`
- `opAtkChange`

이제 이 액션들은 상대 화면에서 직접 상태를 바꾸지 않고 로그만 남긴다. 실제 상태는 `sendGameState` 또는 권위 스냅샷이 반영한다.

### `js/effects-theme.js`

`enterGame()`에서 `HB_NETWORK_SYNC.listenStateDiffs()`를 등록한다.

### `js/engine/chain-engine.js`

신규 `EffectDefinition` 체인 엔진에도 권위 체크와 diff 전송 준비를 추가했다.

## 주의

아직 모든 레거시 테마 효과가 `EffectDefinition` 기반으로 이식된 것은 아니다. 그래서 `sendAction()` 호출 자체를 완전히 제거하지는 않았다. 다만 상태 변경형 `lastAction`을 받은 쪽에서 직접 상태를 바꾸는 동작은 억제했다.

이 단계는 네트워크 중복 실행을 끊는 안전장치이며, 14단계 이후 효과 버튼/테마 이식이 진행될수록 `sendAction()` 기반 상태 변경은 더 줄여야 한다.

## 검증

- 전체 JS syntax check 통과
- `HB_NETWORK_SYNC` 생성 확인
- 권위 스냅샷 적용 테스트 통과
- 비권위 클라이언트가 `resolvedLinks`를 재실행하지 않는지 확인
- 권위 클라이언트가 `resolveLegacyChain()`에서 1회만 실행하는지 확인
- 레거시 상태 변경 액션 억제 확인
- 11단계 field-zone 회귀 테스트 통과
- 10단계 continuous 회귀 테스트 통과
- 9단계 trigger queue 회귀 테스트 통과
- 12단계 processing negate 회귀 테스트 통과
