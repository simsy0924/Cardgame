# HAND BATTLE Engine Refactor — Step 2

## 목적

문자열 하드코딩을 줄이고, 새 엔진에서 사용할 룰 개념을 전역 상수로 고정한다.

이번 단계는 기능 수정 단계가 아니다. 기존 효과 로직, 체인 처리, 카드 이동 로직은 아직 연결하지 않는다.

## 생성한 파일

- `js/rules/effect-types.js`
- `js/rules/zones.js`
- `js/rules/phases.js`
- `js/rules/card-types.js`
- `js/rules/effect-tags.js`
- `js/rules/events.js`
- `js/rules/timing.js`

## 로딩 방식

현재 프로젝트는 ES module 기반이 아니므로 `export/import`를 쓰지 않는다.
대신 모든 상수는 기존 브라우저 script 환경에 맞춰 아래 전역 네임스페이스에 등록한다.

```js
window.HB_RULES
```

예시:

```js
window.HB_RULES.EFFECT_TYPES.TRIGGER
window.HB_RULES.ZONES.FIELD_ZONE
window.HB_RULES.EFFECT_TAGS.DECK_SEARCH
```

## index.html 변경

`cards.js` 다음, `engine.js` 이전에 룰 상수 파일들을 로드한다.

이 변경은 상수 등록만 수행하므로 기존 게임 상태 변경 로직에는 영향을 주지 않는다.

## 다음 단계

3단계에서는 `js/engine/zone-access.js`를 만들고, 새 엔진 코드가 `G.myField`, `G.opField` 같은 직접 접근 대신 표준 접근 함수를 사용하도록 준비한다.
