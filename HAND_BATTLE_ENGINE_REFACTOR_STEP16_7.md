# HAND BATTLE ENGINE REFACTOR — STEP 16-7

## 대상
마피아 테마 EffectDefinition 이식.

## 핵심 처리
- `js/effects/theme/mafia.js` 추가.
- 마피아 카드 12종을 등록형 효과로 이식.
- 마피아 마법 ①은 `effectTransform` 태그를 가진 quick 효과로 등록.
- 변형 효과가 해결되면 원래 상대 체인 링크를 pending transform에 기록하고, 원래 링크 해결 시 `consumeTransformedChainLink()`가 원효과를 스킵한다.
- `대도시의 거물 마피아`가 필드에 있으면 마피아 마법 선택권을 컨트롤러 쪽으로 돌릴 수 있도록 turn state를 사용한다.
- `마피아의 도시`는 이번 턴 마피아 마법 발동 횟수(`mafiaTurnState.magicActivatedCount`)를 기준으로 묘지 회수 수량을 계산한다.
- 처리 불가능한 선택지만 남은 효과는 `canResolve`에서 발동 전 차단한다.

## 체인 엔진 보강
`chain-engine.js`의 `resolveChainLink()` 시작부에 `HB_EFFECT_TRANSFORM_ENGINE.consumeTransformedChainLink()` 훅을 추가했다.
이 훅은 처리 시 무효보다 먼저 확인되어, 변형된 원래 효과가 다시 처리되지 않도록 막는다.

## 주의
현재 신 체인 엔진은 동기식 해결 구조라 실제 원격 상대 선택 UI를 완전히 await하지 못한다.
그래서 `ctx.selectedOption`, `selectedOptionIndex`가 있으면 그 값을 우선 사용하고, 없으면 첫 번째 처리 가능 선택지로 폴백한다.
네트워크 상대 선택의 완전한 비동기화는 이후 선택 UI/네트워크 보강 단계에서 다듬는다.

## 검증
- 전체 JS syntax check 통과.
- 마피아 효과 파일 로드 순서 확인.
- 체인 변형 훅이 원래 링크 스킵 구조를 갖는지 확인.
