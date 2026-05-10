# HAND BATTLE ENGINE REFACTOR — STEP 7

## 목적

7단계는 모든 신규 효과의 `condition(ctx)`, `cost(ctx)`, `target(ctx)`, `resolve(ctx)`가 같은 형식의 `ctx`를 받도록 만드는 단계다.

기존 레거시 효과는 `G.myField`, `G.opField`, `G.myGrave` 같은 상태 배열을 직접 조작하는 경우가 많았다. 새 엔진에서는 효과 내부에서 직접 상태를 만지지 않고 `ctx.move.*`만 사용해야 한다.

## 추가 파일

- `js/engine/effect-context.js`

## 로딩 순서

`effect-context.js`는 다음 파일들이 필요하다.

1. `js/engine/zone-access.js`
2. `js/engine/card-move.js`

따라서 `index.html`에서는 `card-move.js` 다음, `ui.js` 이전에 로드한다.

## 제공 네임스페이스

```js
window.HB_EFFECT_CONTEXT
```

## 주요 함수

```js
HB_EFFECT_CONTEXT.createEffectContext(options)
HB_EFFECT_CONTEXT.buildEffectContext(options)
HB_EFFECT_CONTEXT.createPreviewContext(options)
HB_EFFECT_CONTEXT.assertAuthority(ctx)
HB_EFFECT_CONTEXT.isAuthorityContext(ctx)
HB_EFFECT_CONTEXT.getOpponent(controller)
```

## ctx 구조

```js
{
  gameState,
  controller,
  opponent,
  card,
  sourceZone,
  sourceIndex,
  sourceController,
  source,
  effect,
  event,
  chainLink,
  targets,
  selectedCards,
  networkMode,
  isAI,
  authority,
  log,
  move,
  askPlayer,
  random
}
```

## ctx.move 정책

`ctx.move`는 `HB_CARD_MOVE`를 직접 노출하지 않고 감싼 래퍼다.

- `authority === true`: 실제 `HB_CARD_MOVE.*` 실행
- `authority === false`: 상태 변경 차단, preview 결과만 반환

차단 대상:

- `moveCard`
- `summonCard`
- `sendToGrave`
- `banishCard`
- `discardCard`
- `addToHand`
- `placeFieldCard`
- `removeFieldCard`
- `dispatchMoveEvent`

## 보조 기능

- `ctx.log(...)`, `ctx.log.warn(...)`, `ctx.log.error(...)`
- `ctx.askPlayer(...)`
- `ctx.random()`, `ctx.random.int(max)`, `ctx.random.choice(list)`, `ctx.random.shuffle(list)`
- `ctx.addTarget(target)`, `ctx.setTargets(targets)`, `ctx.clearTargets()`
- `ctx.with(overrides)`

## 완료 기준

- 신규 효과가 동일한 `ctx` 구조를 받을 수 있다.
- `effect.resolve(ctx)`에서 직접 `G`를 만지지 않고 `ctx.move.*`를 사용할 수 있다.
- `authority=false`인 미리보기/비권위 클라이언트에서는 실제 상태 변경이 차단된다.
- 네트워크/AI/체인 엔진이 이후 단계에서 같은 컨텍스트를 재사용할 수 있다.

## 아직 하지 않은 것

- 레거시 효과 함수 전체를 `ctx` 기반으로 변환하지 않았다.
- 체인 엔진과 트리거 큐는 아직 없다.
- 네트워크 권위 판단은 `HB_NETWORK_SYNC.hasAuthority()`가 생기면 자동 위임하도록 훅만 마련했다.
