# 16단계 — 펭귄 테마 EffectDefinition 이식

## 목적

16단계는 테마별 효과 이식의 첫 단계다. 실행계획의 권장 순서에 따라 펭귄 테마부터 새 엔진으로 옮긴다.

이번 단계의 원칙은 다음과 같다.

- 카드 텍스트 파싱으로 효과를 실행하지 않는다.
- 펭귄 효과는 `js/effects/theme/penguin.js` 안의 `EffectDefinition`으로 등록한다.
- 실제 카드 이동은 `HB_CARD_MOVE` / `ctx.move`만 사용한다.
- 공개 패, 버려짐 대체, 덱 소환, 묘지/제외 회수, 소환 유발을 명시 타입으로 분리한다.
- 펭귄 마을 ②는 `replacement`이며 체인과 유발 버튼을 만들지 않는다.
- `발동할 수 있다` 계열 펭귄 유발 효과는 기본적으로 `optional: true`로 둔다.
- 이식된 펭귄 카드는 레거시 효과와 새 엔진이 동시에 처리하지 않는다.

## 추가 파일

- `js/effects/theme/penguin.js`

## 등록한 카드

- 펭귄 마을
- 꼬마 펭귄
- 펭귄 부부
- 현자 펭귄
- 수문장 펭귄
- 펭귄!돌격!
- 펭귄의 영광
- 펭귄 용사
- 펭귄의 일격
- 펭귄이여 영원하라
- 펭귄의 전설
- 펭귄 마법사

## 주요 효과 타입

- `activation`: 패/필드/묘지에서 직접 발동하는 일반 효과
- `quick`: 상대 턴 또는 체인 응답용 효과
- `trigger`: 소환/묘지 이동 후 선택 가능한 유발 효과
- `replacement`: 펭귄 마을 ②의 버려짐 대체 처리
- `procedure`: 펭귄 용사/펭귄의 전설의 키 카드 취급 및 소환 제한
- `continuous`: 펭귄의 전설 ③의 비대상 상대 효과 내성

## 레거시 차단

- `effects-chain.js`의 손패/필드 레거시 체인 응답 후보 수집에서 `HB_LEGACY_BRIDGE.isNewEngineCard(card)`가 참이면 후보를 만들지 않도록 했다.
- `effects-core.js`의 펭귄 마을 ② 직접 처리 로직을 `HB_PENGUIN_EFFECTS.handleVillageDiscardReplacement()`로 우회했다.
- 새 replacement 처리 후 `HB_EVENTS.dispatchEvents()`를 호출해 후속 `sentToGrave` 유발 효과가 trigger queue로 들어가게 했다.

## 검증

- 전체 JS syntax check 통과
- 펭귄 효과 30개 등록 확인
- 펭귄 마을 ②가 `replacement`로 등록되는지 확인
- 펭귄의 전설 ③이 `continuous`로 등록되는지 확인
- 펭귄의 일격 ①이 `quick`으로 등록되는지 확인
- 펭귄 마을 ② replacement가 공개 패의 펭귄 마을을 버리지 않고 필드의 펭귄 몬스터를 묘지로 보내는지 확인
- 펭귄의 전설 ③이 비대상 상대 카드 효과 내성으로 작동하는지 확인
- 꼬마 펭귄 소환 유발이 trigger queue 후보로 수집되는지 확인
- 펭귄 테마 카드가 `HB_LEGACY_BRIDGE` 기준으로 신엔진 카드로 라우팅되는지 확인
