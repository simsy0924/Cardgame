# 내성/보호 효과 설계 — 카드별 하드코딩 + 엔진 게이트

> 방침(결정): 내성은 **카드마다 텍스트가 다르므로 범용 스코프 DSL을 만들지 않는다.**
> 각 카드의 면역 로직은 그 카드 텍스트를 보고 **함수형 `continuousRule`로 하드코딩**한다.
> 엔진이 설계할 것은 단 하나 — *"효과가 카드에 무언가를 적용하려는 모든 순간"에 그 카드의
> 면역 함수를 호출하는 **게이트*** 와 그 호출 규약(checkCtx).

---

## 0. 두 가지 필수 교정 (이전 설계의 오류)
1. **대상 지정 ≠ 효과면역.** "효과를 받지 않는다"는 대상 지정을 막지 않는다. 면역 카드도
   대상으로 *지정은 되고* 적용만 안 된다. "대상이 되지 않는다"는 **별개 게이트**.
   - 근거: `…효과의 대상이 되지 않으며, 다른 카드의 효과를 받지 않는다`(일격필살 — 둘 따로 명시),
     `이 카드를 **대상으로 하지 않는** 상대 효과를 받지 않는다`(펭귄의 전설 — 대상 효과는 받음).
2. **효과면역은 이로운 효과도 막는다.** `다른 카드의 효과를 받지 않으며`(아자토스)는 *자기편
   다른 카드의 공격력 버프*도 차단. 따라서 면역 게이트는 제거뿐 아니라 **스탯±·카운터 적용
   지점에도** 있어야 한다(현재는 호출 자체가 없음).

## 1. 카드별 하드코딩 (카드 책임)
함수형 `continuousRule`로 그 카드 텍스트를 직접 인코딩. (엔진은 함수형 규칙을
`immunityScopeMatches`에서 그대로 통과시키고, 함수가 직접 판정 — 이미 지원.)

```js
// 아우터 갓-아자토스: "다른 카드의 효과를 받지 않으며, 묘지로 보내지지 않는다"
continuousRule: {
  unaffectedByEffects: (ck, src) => getCardId(ck.sourceCard) !== getCardId(src.card), // 자기 자신 외 전부
  cannotBeSentToGrave: true,
}

// 아우터 갓 슈브 니구라스: "상대 카드의 효과를 받지 않으며, 공격 대상이 되지 않는다"
continuousRule: {
  unaffectedByEffects: (ck, src) => isOpponentOf(ck.actorController, src.controller),
  cannotBeAttackTarget: true,
}

// 펭귄의 전설 ③: "이 카드를 대상으로 하지 않는 상대 카드의 효과를 받지 않는다"
continuousRule: {
  unaffectedByEffects: (ck, src) => isOpponentOf(ck.actorController, src.controller) && !ck.isTargeting,
}

// 일격필살: "묘지에 있을 경우 효과의 대상이 되지 않으며, 다른 카드의 효과를 받지 않는다"
continuousRule: {
  cannotBeTargeted: (ck, src) => isInGrave(src),          // 대상 보호(별개 축)
  unaffectedByEffects: (ck, src) => getCardId(ck.sourceCard) !== getCardId(src.card),
}
```

> 범용 키(`allEffects`/`opponentEffects`)는 *흔한 패턴의 단축*으로만 남기고, 비표준 문구는
> 전부 함수로 하드코딩한다.

## 2. 엔진 게이트 (엔진 책임) — 유일하게 설계하는 부분
"효과가 카드에 작용하는 연산"마다, 작용 직전에 대상 카드의 면역 함수를 호출한다.
개별 효과는 면역을 직접 검사하지 않는다.

### 2.1 checkCtx 규약 (게이트가 면역 함수에 넘기는 정보)
| 필드 | 의미 |
|---|---|
| `target` / `targetController` | 면역을 검사받는 카드 |
| `sourceCard` / `sourceController` / `actorController` | 작용을 일으킨 **효과의 출처 카드/주체** |
| `operation` | `sendToGrave`·`banish`·`bounce`·`returnDeck`·`statChange`·`counter`·`negate`·`target`·`battle` |
| `isTargeting` | 이 작용이 대상 지정을 동반하는가 |
| `isBeneficial` | 이로운 적용인가(공격력↑ 등) — 로깅/판정 보조 |
| `amount` 등 | 연산별 부가 |

> 핵심: `sourceCard`를 반드시 실어야 "다른 카드(=출처≠자기)" 판정이 가능. 현재 빠져 있음.

### 2.2 게이트 목록 / 현황
| 게이트(연산) | 호출 체크 | 현재 |
|---|---|---|
| card-move 제거 | `unaffectedByEffects` + `cannotBeSentToGrave`/`cannotBeBanished` | grave·banish만 |
| card-move **바운스/되돌리기** | `unaffectedByEffects` + `cannotBeReturned` | ✗ |
| **스탯/카운터 적용**(continuous + one-shot) | `unaffectedByEffects` | ✗ (이로운 효과 통과) |
| **대상 선택**(collectChoices/target) | `cannotBeTargeted` (후보 제외) | 백스톱만 |
| **무효 연산**(chain/processing-negate) | `unaffectedByEffects`/`cannotBeNegated` | ✗ |
| 전투 해결 | `battleIndestructible` / `canAttackWithMonster` | 일부 |

> `actor===owner면 통과` 단축(card-move:402)은 제거 — "다른 카드(자기편 포함)" 면역을 위해
> **출처 카드 정체성 기반**으로 바꾼다(자기 자신 효과만 면제).

## 3. 단계별 계획
- **Phase 0** — 스탯/카운터 적용 지점(continuous-engine `modifyAttack`/카운터)에서
  `unaffectedByEffects` 호출 + checkCtx에 `sourceCard` 추가. (이로운 효과 차단 핵심)
- **Phase 1** — 대상 선택 게이트: 대상 후보 수집 시 `cannotBeTargeted` 제외(효과면역과 독립).
- **Phase 2** — card-move 바운스/되돌리기 커버리지 확장.
- **Phase 3** — 무효 연산 게이트(`cannotBeNegated`/효과면역).
- **Phase 4** — 전투 게이트(`battleIndestructible`).
- 병행 — 기존 면역 카드(아자토스·슈브·히프노스·펭귄의 전설·일격필살·단 한번의 기회·
  엘리멘츠 궁극 창조신·서커스메어 메드 키메라 등)를 함수형 `continuousRule`로 재정의.

## 4. 불변식 / 테스트
1. 출처=다른 카드의 공격력 버프가 `others` 면역 카드에 **미적용**.
2. 대상 면역 카드는 대상 후보에서 **제외**(효과면역 카드는 후보엔 포함, 적용만 차단).
3. 자기 자신 효과는 `others` 면역에 막히지 않음.
4. 전투/룰 직접 호출(opts.effect 없음)은 효과면역에 막히지 않음(전투 내성은 별도 축).
5. `cannotBeNegated`/면역 카드의 효과 발동은 상대가 무효화 불가.

### 권장 착수
**Phase 0(스탯/카운터 게이트 + sourceCard) → Phase 1(대상 분리)** 가 두 교정을 가장
직접 해소한다.
