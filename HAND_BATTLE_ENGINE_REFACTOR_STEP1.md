# Handbattle Effect Engine Refactor — Step 1 Legacy Isolation

작성일: 2026-05-10

## 이번 단계의 목적

1단계는 기능 수정 단계가 아니라, 새 효과 엔진 작업을 안전하게 시작하기 위한 보호 장치 단계다.
기존 게임 동작을 최대한 바꾸지 않으면서 레거시 코드를 동결/격리/이식 대상으로 표시했다.

## 적용한 변경

1. `js/effect.js`를 `js/legacy/effect.old.js`로 이동했다.
   - `index.html`에서 원래 로드되지 않던 파일이므로 런타임 동작 변화는 없어야 한다.
   - 상단에 레거시 동결 주석을 추가했다.

2. `js/patch.js` 상단에 레거시 동결 주석을 추가했다.
   - 새 패치를 여기에 추가하지 않는다.
   - 기존 런타임 덮어쓰기 로직은 이식 후 제거 대상이다.

3. `js/theme-common.js` 상단에 임시 호환 레이어 주석을 추가했다.
   - 텍스트 파싱 기반 효과 추론은 신규 구현에서 사용하지 않는다.
   - 신규 카드 효과는 EffectDefinition으로 등록한다.

4. `js/circusmare.js` 상단에 임시 호환 레이어 주석을 추가했다.
   - 서커스메어 효과를 이 파일에 계속 직접 추가하지 않는다.
   - 직접 필드 조작과 함수 덮어쓰기는 제거 대상이다.

5. 위험 함수 TODO 목록을 문서화했다.

## 원본 Git 저장소에서 권장되는 보호 명령

이 zip은 repomix 산출물에서 복원한 작업본이라 실제 `.git` 기록은 포함하지 않는다.
원본 저장소에서는 다음 명령을 먼저 실행하는 것을 권장한다.

```bash
git checkout -b engine-refactor-v1
git tag before-effect-engine-refactor
```

## 위험 함수 TODO

- `handleOpponentAction`
- `beginChain`
- `resolveChain`
- `executeChainLocally`
- `resolveKeyFetch`
- `manualDiscard`
- `_forcedDiscardOne`
- `activateCard`
- `onSummon`
- `onSentToGrave`
- `checkImmunity`
- `summonFromDeck`
- `summonFromGrave`
- `summonFromHand`

## 1단계 완료 기준 체크

- [x] 레거시 파일 위치 명확화
- [x] `patch.js` 새 패치 추가 금지 명시
- [x] `effect.js` 실사용 파일 아님 표시 및 격리
- [x] 게임 동작에 직접 영향을 주는 로직 변경 없음
- [x] 다음 단계에서 `js/rules/*`를 추가할 준비 완료

## 다음 단계

2단계에서 다음 파일을 생성한다.

- `js/rules/effect-types.js`
- `js/rules/zones.js`
- `js/rules/phases.js`
- `js/rules/card-types.js`
- `js/rules/effect-tags.js`
- `js/rules/events.js`
- `js/rules/timing.js`
