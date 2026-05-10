# HAND BATTLE ENGINE REFACTOR — STEP 16-3

## 범위

엘리멘츠 테마를 `EffectDefinition` 기반으로 이식했다.

## 핵심 원칙

- 정령의 자체 소환은 일반 발동 효과가 아니라 `procedure`다.
- `엘리멘츠의 궁극신`, `엘리멘츠의 궁극 창조신`의 소환 조건도 `procedure`다.
- `procedure`는 체인에 올라가지 않는다.
- 단, 실제 플레이어가 누를 수 있어야 하므로 `summonProcedure: true`인 procedure는 Effect UI에서 `[소환]` 버튼으로 표시한다.
- 카운터는 카드 객체의 `counters` 맵에 저장한다.
- 서치/소환/카운터 배치가 불가능하면 `canResolve`에서 발동 후보 자체를 차단한다.

## 추가 파일

- `js/effects/theme/elements.js`

## 수정 파일

- `index.html`
- `js/engine/effect-ui.js`

## 구현 카드

- 엘리멘츠의 불꽃정령
- 엘리멘츠의 물정령
- 엘리멘츠의 전기정령
- 엘리멘츠의 바람정령
- 엘리멘츠 in rainbow forest
- 엘리멘츠 is fairy!!!
- 엘리멘츠의 MAGIC
- 엘리멘츠의 TR∀P
- 엘리멘츠의 ♤♡◇♧
- 엘리멘츠의 궁극신
- 엘리멘츠의 마법
- 엘리멘츠의 궁극 창조신
- 궁극의 엘리멘츠

## 검증 포인트

- 자체 소환 procedure가 버튼으로 뜬다.
- procedure는 체인을 만들지 않고 바로 소환한다.
- 체인이 활성화되어 있으면 자체 소환 조건이 막힌다.
- 카운터가 `card.counters`에 저장된다.
- 궁극신/궁극 창조신은 4종 카운터 조건을 확인한다.
- 처리 불가능한 서치/소환/카운터 효과는 발동 후보에 뜨지 않는다.
