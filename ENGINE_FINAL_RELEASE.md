# HAND BATTLE — Effect Engine Final Release

## 현재 상태

핸드배틀 효과 엔진 리팩터링 1~20단계가 완료되었다.

이제 프로젝트의 카드 효과는 다음 원칙을 따른다.

1. 카드 텍스트는 표시용이다.
2. 실제 효과 처리는 `EffectDefinition`이 담당한다.
3. 카드 이동은 `HB_CARD_MOVE`를 통과한다.
4. 유발 효과는 `HB_TRIGGER_QUEUE`를 통과한다.
5. 지속 효과는 `HB_CONTINUOUS_ENGINE`이 계산한다.
6. 필드 카드는 `HB_FIELD_ZONE`이 처리한다.
7. 처리 시 무효는 `HB_PROCESSING_NEGATE_ENGINE`이 처리한다.
8. 네트워크 상태 변경은 `HB_NETWORK_SYNC`의 권위 상태 원칙을 따른다.
9. 구 테마 직접 패치 파일은 제거되었다.
10. 최종 게이트 테스트가 이 구조를 보호한다.

## 최종 효과 등록 현황

| 항목 | 값 |
|---|---:|
| 전체 등록 효과 | 289 |
| 효과 등록 카드 | 118 |
| 효과 타입 | 7 |
| activation | 83 |
| quick | 63 |
| trigger | 80 |
| continuous | 30 |
| procedure | 24 |
| replacement | 3 |
| processingNegate | 6 |

## 테마 효과 파일

| 테마 | 파일 |
|---|---|
| 펭귄 | `js/effects/theme/penguin.js` |
| 서커스메어 | `js/effects/theme/circusmare.js` |
| 엘리멘츠 | `js/effects/theme/elements.js` |
| 크툴루/올드원 | `js/effects/theme/cthulhu.js` |
| 지배자/지배룡 | `js/effects/theme/ruler.js` |
| 불가사의 | `js/effects/theme/bulgasaui.js` |
| 마피아 | `js/effects/theme/mafia.js` |
| 라이온 | `js/effects/theme/lion.js` |
| 타이거 | `js/effects/theme/tiger.js` |
| 라이거 | `js/effects/theme/liger.js` |

## 필수 자동 테스트

```bash
node tests/engine/run-engine-tests.js
```

이 명령은 다음 7개 테스트 묶음을 실행한다.

- `card-move`
- `chain-engine`
- `trigger-queue`
- `field-zone`
- `effect-registry`
- `legacy-cleanup`
- `final-gate`

릴리즈 전에는 반드시 이 명령이 통과해야 한다.

## 필수 수동 테스트

자동 테스트는 브라우저 클릭, 상대 클라이언트 선택, 실제 네트워크 싱크를 완전히 대체하지 못한다.

릴리즈 전에는 아래 체크리스트를 최소 1회 수행한다.

1. `tests/manual/final-release-checklist.md`
2. `tests/manual/common-checklist.md`
3. `tests/manual/network-checklist.md`
4. 수정한 테마의 체크리스트

## 앞으로 새 효과를 추가할 때의 규칙

새 효과는 반드시 아래 중 하나로 분류한다.

- `activation`
- `quick`
- `trigger`
- `continuous`
- `procedure`
- `replacement`
- `processingNegate`

직접 금지:

- `G.myField.push(...)`
- `G.opField.splice(...)`
- 구 테마 파일 재생성
- `patch.js`식 런타임 덮어쓰기
- 임의 효과 자동 발동
- 처리 불가능한 효과 버튼 표시
- 소환 절차를 체인으로 올리기
- 필드 카드 발동과 효과 배치를 같은 처리로 뭉개기

## 아직 수동 검증이 중요한 부분

- 상대가 골라야 하는 효과
- 체인 응답 UI
- 장기 네트워크 매치
- AI전 상태 깜빡임
- 일부 효과의 임시 자동 선택 UI 제거

이 문서는 “코드가 완벽하다”는 보증이 아니라, 앞으로 다시 무너지지 않게 하는 최종 기준이다.
