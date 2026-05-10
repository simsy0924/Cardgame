# HandBattle 테스트 폴더

17~20단계에서 추가·강화한 테스트 자료입니다.

## 수동 테스트

위치: `tests/manual/`

테마 이식이나 엔진 수정 후에는 최소한 다음 파일을 확인합니다.

1. `common-checklist.md`
2. `network-checklist.md`
3. 수정한 테마의 체크리스트

필수 네트워크 검증 대상:
- 서커스메어
- 크툴루/올드원

## 자동 테스트

위치: `tests/engine/`

실행:

```bash
node tests/engine/run-engine-tests.js
```

현재 포함된 테스트:
- `card-move.test.js`
- `chain-engine.test.js`
- `trigger-queue.test.js`
- `field-zone.test.js`
- `effect-registry.test.js`

이 테스트는 브라우저 없이 Node `vm` 환경에서 핵심 엔진만 로드합니다. UI/네트워크 실제 클릭 검증은 `tests/manual/` 체크리스트로 수행합니다.

- `final-gate.test.js`

## Step 19 hard cleanup

`legacy-cleanup.test.js`는 이제 단순히 구 테마 파일이 로드되지 않는지만 확인하지 않는다. 18단계에서 로딩 제거된 레거시 테마/패치 파일이 실제 프로젝트 트리에서도 제거되었는지 확인한다.

삭제 대상이 다시 생기거나 `index.html`에 재연결되면 테스트가 실패해야 한다.



## Step 20 final gate

`final-gate.test.js`는 최종 릴리즈 게이트다.

검사 내용:
- `index.html`의 모든 script 파일 존재 여부
- 핵심 스크립트 로딩 순서
- 레거시 테마/패치 파일 부재
- 등록 효과 수 289개 유지
- 등록 효과 카드 수 118장 유지
- 효과 타입별 개수 유지
- 처리 시 무효의 `negateTags` 보유
- 신규 엔진/테마 파일의 직접 `G.*` 존 조작 금지

20단계 이후 새 효과/테마를 추가하면 이 테스트가 깨질 수 있다. 그 경우 숫자를 무작정 고치지 말고, 새 효과가 정말 의도된 추가인지 먼저 확인한다.
