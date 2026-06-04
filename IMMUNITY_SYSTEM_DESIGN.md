# 내성/보호 효과 시스템 설계 (Immunity & Protection Design)

> 목적: "효과를 받지 않는다", "대상이 되지 않는다", "전투로 묘지로 보내지지 않는다",
> "무효화되지 않는다" 등 **내성/보호 효과**를 카드는 *선언만* 하고, 강제(enforcement)는
> 엔진의 **단일 체크포인트**가 책임지는 일관된 구조로 정리한다.
>
> **결정**: `effectImmunity`("효과를 받지 않는다")는 **OCG식 — 상대의 모든 효과 상호작용 차단**
> (제거·바운스·되돌리기·스탯 변경·카운터·대상 지정·이 카드 효과 무효화 전부).

---

## 1. 현황 (As-Is)

### 1.1 있는 것
- **`continuous-engine.js`** — 내성 권위(authority):
  - 체크 API: `checkEffectImmunity`, `checkTargetProtection`, `checkCannotBeSentToGrave`,
    `canAttackWithMonster`.
  - 카드 플래그: `effectImmune`, `targetProtected`, `cannotBeSentToGrave`,
    `cannotAttack`, `cannotBeAttackTarget`.
  - 스코프 판정 `immunityScopeMatches`(:614): 자기보호 / 상대한정(opponentEffects) /
    테마 / 컨트롤러 / byOpponentOnly / 함수형 규칙.
- **`card-move.js`** — 카드 이동 단일 통로에서 강제(`checkRemovalImmunity`:397):
  효과 기반 제거만 검사, 전투/룰/레거시 직접 호출은 통과, 자기 효과(actor===owner)는 제외.
- **`ctx.move` 자동 주입**(effect-context.js:232-233): `actorController=ctx.controller`,
  `effect=ctx.effect` → 테마 효과가 수동으로 안 넘겨도 행위자/출처가 잡힌다.
- 현재 사용 중인 `continuousRule` 내성 키: `effectImmunity`(7) ·
  `cannotBeSentToGrave`(6) · `targetProtection`(4) · `cannotAttack`(2) ·
  `cannotBeAttackTarget`(1) · `protectOtherAlliedCards`(1).

### 1.2 구멍 (Gaps)
1. **연산 커버리지** — `checkRemovalImmunity`는 `sendToGrave`(:446)·`banish`(:479)에만 호출.
   **바운스(패로 되돌리기)·덱 되돌리기·스탯 변경·카운터 부여는 무검사** →
   "효과를 받지 않는다"가 *제거 일부*만 막는다.
2. **누락 축** — 훅 자체가 없음:
   - `battleIndestructible`("전투로 묘지로 보내지지 않는다") — 전투 해결은 `opts.effect`가
     없어 `checkRemovalImmunity`를 통과(전투 내성 미구현).
   - `cannotBeNegated`("무효화되지 않는다") — 무효 연산 경로에 내성 훅 없음.
   - 광의의 `cannotLeaveField` — 제거 종류별로 흩어져 있음.
3. **대상 내성 규율** — `cannotBeTargeted`는 호출자가 `isTargeting:true`를 **수동** 전달해야만 동작.

---

## 2. 목표 구조 (To-Be)

### 2.1 원칙
- 카드 효과는 `continuousRule`로 **내성을 선언만** 한다. 강제는 엔진의 체크포인트가 한다.
- 모든 "상대 효과가 카드에 작용하는 연산"은 작용 전에
  **`HB_CONTINUOUS_ENGINE.check*`** 를 통과한다(개별 효과가 직접 검사하지 않는다).
- `effectImmunity`는 광의(OCG식) — 아래 모든 체크포인트에서 "행위자=상대 && 대상=면역 카드"면 차단.

### 2.2 내성 축 어휘 (continuousRule 키)
| 축 | 카드 표현 | 강제 지점 | 스코프 옵션 |
|---|---|---|---|
| `effectImmunity` | 효과를 받지 않는다 | 제거·바운스·되돌리기·스탯·카운터·무효·대상 **전부** | `allEffects`/`opponentEffects`/`cardId`/`theme`/`when` |
| `cannotLeaveField` | (필드에서) 벗어나지 않는다 | card-move 모든 제거(grave/banish/bounce/returnDeck) | 동상 |
| `cannotBeSentToGrave` | 묘지로 보내지지 않는다 | card-move `sendToGrave` | 동상 |
| `cannotBeBanished` | 제외할 수 없다 | card-move `banish` | 동상 |
| `cannotBeReturned` | 패/덱으로 되돌릴 수 없다 | card-move `bounce`/`returnToDeck` | 동상 |
| `cannotBeTargeted` | 대상이 되지 않는다 | 대상 선택 + card-move(`isTargeting`) | 동상 |
| `cannotBeNegated` | (이 카드 효과는) 무효화되지 않는다 | 무효 연산(chain/processing-negate) | 동상 |
| `battleIndestructible` | 전투로 묘지로 보내지지 않는다 | 전투 해결 | 동상 |
| `cannotAttack` / `cannotBeAttackTarget` | 공격할 수 없다 / 공격 대상이 되지 않는다 | 전투(`canAttackWithMonster`) | 동상 |

> `effectImmunity`가 켜진 카드는 위 표의 개별 축이 없어도 **상대 효과에 의한 제거·바운스·
> 되돌리기·스탯·카운터·대상·무효를 전부** 차단한다. 개별 축은 "전투엔 안 죽지만 효과엔 죽는다"
> 같은 **부분 내성**을 표현할 때 쓴다.

### 2.3 강제 지점 (Enforcement Points) — 단일 체크포인트 5
1. **card-move** (이동/제거/바운스/되돌리기) — `checkRemovalImmunity` 커버리지를
   `sendToGrave`/`banish` → **`bounce`/`returnToDeck`/`removeFieldCard`** 까지 확장.
   action별로 `cannotBeSentToGrave`/`cannotBeBanished`/`cannotBeReturned` +
   광의 `cannotLeaveField` + `effectImmunity`를 조회.
2. **대상 선택** (collectChoices/target 수집) — 후보 필터 단계에서 `checkTargetProtection`
   자동 적용. `isTargeting`을 대상 지정 효과에서 자동 추론(수동 전달 제거).
3. **스탯/카운터 변경** — atk 증감·카운터 부여 헬퍼에 `checkEffectImmunity` 훅 추가
   (상대 효과면 면역 카드에 미적용).
4. **무효 연산** — 체인 링크/효과 무효 직전 `checkEffectImmunity`(이 카드 효과 무효 불가) +
   `cannotBeNegated` 조회. (processing-negate-engine / chain-engine 무효 지점.)
5. **전투 해결** — 전투 파괴 직전 `battleIndestructible` 조회, 공격 가부는 기존
   `canAttackWithMonster` 유지.

### 2.4 선언 패턴 (EffectDefinition)
```js
// 전체 내성 + 전투 내성 (예: 아우터 갓-아자토스)
continuousRule: { effectImmunity: { allEffects: true }, cannotBeSentToGrave: true }

// 상대 효과 한정 + 공격 대상 불가 (예: 슈브 니구라스)
continuousRule: { effectImmunity: { opponentEffects: true }, cannotBeAttackTarget: true }

// 부분 내성: 전투엔 안 죽지만 효과엔 영향받음 (예: 에이스 라이온 — '라이온' 카드)
continuousRule: { battleIndestructible: { theme: '라이온' } }

// 대상 비지정 상대 효과만 무시 (예: 펭귄의 전설 ③)
continuousRule: { effectImmunity: { opponentEffects: true, when: ctx => !ctx.isTargeting } }
```

### 2.5 불변식 (Invariants) — 테스트로 고정
1. 상대 효과가 면역 카드를 제거/바운스/되돌리기 시 → 차단(`ok:false`), 카드 잔류.
2. 자기 효과(actor===owner)는 차단되지 않음.
3. 전투/룰 직접 호출(opts.effect 없음)은 `effectImmunity`에 막히지 않음(전투 내성은 별도 축).
4. 면역 카드에 상대의 스탯 감소/카운터/무효가 적용되지 않음.
5. `cannotBeNegated`/effectImmunity 카드의 효과는 상대가 무효화하지 못함.

---

## 3. 단계별 계획 (Phases)
각 단계는 독립 배포 가능, 엔진 테스트 + 신규 불변식 테스트 그린.

- **Phase 0** — card-move 제거 커버리지 확장: `bounce`/`returnToDeck`/`removeFieldCard`에도
  `checkRemovalImmunity` 호출. 광의 `cannotLeaveField` 축 추가. (effectImmunity가 모든 제거를 막음) ✅ 구멍1 핵심
- **Phase 1** — 대상 선택에서 `cannotBeTargeted` 자동 적용 + `isTargeting` 자동 추론(수동 제거). ✅ 구멍3
- **Phase 2** — 스탯/카운터 변경 헬퍼에 `checkEffectImmunity` 훅. ✅ effectImmunity 광의화
- **Phase 3** — 무효 연산 훅: `cannotBeNegated` + "면역 카드 효과 무효 불가". ✅ 누락 축
- **Phase 4** — 전투 해결 훅: `battleIndestructible`. ✅ 누락 축

## 4. 리스크 / 결정 필요
- **레이어 분리**: `effectImmunity`(효과)와 `battleIndestructible`(전투)는 반드시 구분
  (card-move의 "opts.effect 없으면 통과"가 이 경계 — 유지).
- **연쇄 적용 순서**: 스탯/카운터 훅 추가 시 continuous 재계산(applyContinuousEffects)과
  one-shot 효과의 적용 순서 충돌 주의.
- **부분 내성 표기**: "이 카드를 대상으로 하지 않는 상대 효과는 받지 않는다"(펭귄의 전설) 같은
  조건부는 `when`/함수형 규칙으로 — 선언 어휘를 문서 §2.4로 표준화.
- 결정필요: `cannotBeNegated`를 "이 카드의 효과 발동이 무효화되지 않음"으로 한정할지,
  "이 카드 자체가 (필드에서) 무효화되지 않음"까지 포함할지.

### 권장 착수
**Phase 0(제거 커버리지) → Phase 2(스탯/카운터) → Phase 1(대상)** 순이
"효과를 받지 않는다"(OCG식)의 체감 정확도를 가장 빠르게 끌어올린다.
Phase 3(무효)·4(전투)는 해당 표현 카드가 적어 후순위.
