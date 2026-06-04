# 체인 시스템 통합 설계 (Chain System Unification Design)

> 목적: 레거시(`js/effects-chain.js`)와 신엔진(`js/engine/chain-engine.js`)으로
> 이원화된 체인을 **단일 권위(신엔진)** 로 수렴시키고, 그 과정에서 보고된
> 두 증상을 근원에서 제거한다.
>
> - **증상 1** — 발동하는 모든 효과가 체인에 일관되게 등록되지 않는다.
> - **증상 2** — "키 카드 가져오기"처럼 유발즉시로 응답할 수 있어야 할 상황에서도
>   "응답할 효과가 없다"가 뜬다.

---

## 1. 현황 (As-Is)

### 1.1 두 개의 체인
| | 신엔진 `HB_CHAIN_ENGINE` | 레거시 `effects-chain.js` |
|---|---|---|
| 파일 | `js/engine/chain-engine.js` | `js/effects-chain.js` |
| 대상 | EffectDefinition 카드 (132중 **118** 이식 완료) | 텍스트 카드 + 공용 액션 |
| 상태 | 내부 `chainState`(links/priority/passCount) | 전역 `activeChainState` 직접 조작 |
| 발동 | `activateEffect`(816) → `createChainLink`(422) → `addChainLink` | `addChainLink`(644) |
| 해결 | `resolveChain`/`resolveChainLink`(584) | `resolveChain`(763) + `CHAIN_RESOLVERS` |

### 1.2 미러 브릿지
신엔진은 링크 추가·응답창 오픈·패스 시 `syncLegacyChainMirror()`(chain-engine.js:782)로
전역 `activeChainState`를 **`hbEngine:true` 미러**로 덮어쓴다. UI/AI는 이 전역만 본다.
→ 신엔진 체인과 레거시 체인이 **같은 전역 슬롯을 공유**하지만, 링크 목록의 실제 소유자는 다르다.

### 1.3 레거시 잔존 인벤토리 (`CHAIN_RESOLVERS`, 24종)
- 공용: `keyFetch`, `fieldActivate`
- AI 전용 리졸버(10): `aiForceDiscard`, `aiEyeForEye`, `aiSummonDeck`, `aiSearch`,
  `aiFieldCard`, `aiGraveOpField`, `aiGraveAllOpField`, `aiExileOpField`,
  `aiExileAllOpField`, `aiReturnOpHand`
- 범용/레거시 카드(12): `eyeForEyePlayer`, `triggerKkomaPenguin`, `themeEffect`,
  `genericNegate`, `guSaIlSaeng`, `fieldNegate`, `jarSearchBan`, `goldenApple`,
  `sacredLight`, `holyGuardian`, `oneHitKill`, `onceDraw`
- 별도 레지스트리: `CHAIN_HAND_RESPONSES`(패 응답), `CHAIN_FIELD_RESPONSES`

### 1.4 응답 수집 경로 (`collectChainOptions`, effects-chain.js:256)
```
collectChainOptions()
 ├─ activeChainState.hbEngine === true → collectHbEngineChainOptions()   // 신엔진 체인
 │     └─ _collectNewEngineChainOptionsForZone(hand/field/grave/exile/fieldZone)
 │            └─ getAvailableEffects(...).filter(e => e.effect.type === 'quick')   // ★ 하드 필터
 └─ else (레거시·keyFetch 체인)
       ├─ keyFetch 옵션 (myKeyDeck)
       ├─ _collectNewEngineChainOptionsForZone(...)   // 동일 ★ type==='quick' 필터
       └─ CHAIN_HAND_RESPONSES[card.id]   // 레거시 응답
```
- UI 버튼 "체인 응답 (N)"의 N = `collectChainOptions().length` (ui.js:365).
- `getAvailableEffects` 내부 `canShowEffect`는 최종적으로 신엔진
  `chain.canActivateEffect`(timing/condition/canResolve)로 게이팅.

### 1.5 네트워크 동기화
Firebase `roomRef/chainState`를 양쪽이 set/listen(ui.js:644, network.js:68).
미러(`activeChainState`)가 화면·네트워크 동기화의 단일 소스.

---

## 2. 문제 진단 (Root Cause)

### 2.1 증상 2 — "응답할 효과 없음" (두 겹)
**(A) `type === 'quick'` 하드 필터.**
응답 수집(`_collectNewEngineChainOptionsForZone`)이 `type==='quick'`만 통과시킨다.
→ **유발즉시여야 하는데 `activation`(기동)으로 표시된 효과는 응답 후보에서 통째로 사라진다.**
현재 그런 마법/함정이 **16건**(감사: `node tests/engine/effect-type-audit.js`).
> 정정: 타입은 단순 라벨이 아니다. *응답 가능 = `type==='quick'` **AND** `timing` 허용
> **AND** `condition/canResolve` 통과* — 세 조건 모두 필요. 타입 분류가 곧 응답 가능성을 결정.

**(B) 시스템 경계 condition 갭.**
신엔진 퀵의 condition이 "상대가 효과를 발동했을 때"류면, 트리거가 **레거시 액션
(`keyFetch` 등)** 일 때 신엔진이 이를 "효과 발동"으로 인식하지 못해 condition=false → 제외.
(레거시 액션은 신엔진 chainState/이벤트에 링크를 남기지 않는다.)

### 2.2 증상 1 — "체인 등록 누락"
- **레거시 링크와 신엔진 체인이 한 체인에서 섞이면** 내부 `chainState`와 화면 미러/
  Firebase의 링크 목록이 어긋난다. (이미 `collectHbEngineChainOptions` 주석이 인정:
  "…섞이면 …서로 다른 링크 목록을 갖게 된다".)
- `keyFetch`/AI 액션은 레거시 `addChainLink`로만 등록 → 신엔진 권위 밖.
- 소환 절차(키덱 소환 등)는 직접 resolve(체인 링크 없음) — 설계상 소환은 체인 불가(유지).

**공통 뿌리: 체인 권위의 이원화.** 타입 오분류(16건)가 증상2를 직접 악화.

### 2.3 우선권 사이클 — 발동자 선패스 버그 (✅ 수정됨)
**문제**: `effect-ui.js`의 `activateAvailableEffect`가 발동 직후 발동자를 **자동 패스**
(`passChainResponse(ctx.controller)`)시켰다. `addChainLink`가 이미 우선권을 상대에게
넘긴(priority=상대, passCount=0) 상태에서 발동자가 선패스하면 passCount=1이 되어,
**상대의 단일 패스만으로 passCount>=2 → 즉시 해결**된다. → 발동자에게 우선권이
다시 돌아오지 않는다.

**예시(펭귄 마을 ①, AI전)** — 기대 vs 기존:
```
[기대] 발동 → 상대 윈도우 → 상대 패스(pc=1, prio=ME) → 내 윈도우(한 번 더) → 패스(pc=2) → 해결
[기존] 발동 → 발동자 자동패스(pc=1) → 상대 패스(pc=2) → 즉시 해결   (나에게 복귀 X)
```

**수정**: 발동자 자동 패스 제거. 이제 우선권이 `상대 → 발동자`로 정상 복귀하고,
양쪽이 연속 패스(`passCount>=2`)해야 최종 처리된다. 복귀한 발동자에게 응답이 0개여도
**항상 한 번 확인**(패스 버튼)을 거친다(결정사항). AI전 워치독은 비활성(ui.js:417),
네트워크전은 30s 유휴 시 자동 패스(데드락 방지)로 영향 없음.
회귀 테스트: `chain-engine.test.js`(발동자 비-자동패스 / 우선권 복귀 / 2패스 해결).

---

## 3. 목표 아키텍처 (To-Be)

### 3.1 단일 권위 = `HB_CHAIN_ENGINE`
- 모든 "발동"은 `chain.activateEffect`를 거쳐 신엔진 chainState에 링크를 남긴다.
- `effects-chain.js`는 **렌더/네트워크 미러 + 한시적 호환 레이어**로 축소 → 최종 제거.
- 미러는 단방향(신엔진 → activeChainState → 화면/Firebase). 레거시의 직접 조작 폐지.

### 3.2 응답 수집 일원화
- `collectChainOptions`의 두 갈래를 **하나**로: 항상 신엔진 기준으로
  `getAvailableEffects`를 hand/field/grave/exile/fieldZone에 순회, `type==='quick'` 필터 유지
  (이 필터는 OCG상 **정상** — 응답은 스펠스피드2만). 레거시 `CHAIN_HAND_RESPONSES`는
  카드 이식 완료 시 제거.
- "응답 가능 여부"의 단일 판정기 = `chain.canActivateEffect`.

### 3.3 keyFetch / AI / 범용의 이관
- **keyFetch**: 신엔진 효과/링크로 표현(예: 키덱 카드의 PROCEDURE/QUICK 또는 전용 액션 링크)
  → 발동 시 신엔진 응답창을 연다.
- **AI 액션**: `ai.js`가 `_collectAIEngineActions` + `activateEffect` 경로로 통일,
  `ai*` 레거시 리졸버 폐지.
- **범용 카드 12종**: EffectDefinition으로 이식(타입 검증과 함께).

### 3.4 불변식 (Invariants) — 테스트로 고정
1. 발동 가능한 모든 효과는 `chain.activateEffect`를 통과하고 신엔진 chainState에 링크를 남긴다.
2. `activeChainState.links` == 신엔진 `chainState.links`(미러는 항상 일치).
3. 응답 후보 = `type==='quick'` && `canActivateEffect.ok` — 단일 경로.
4. 레거시 액션이 만든 체인도 신엔진 퀵으로 응답 가능(이벤트 인식 통일).

---

## 4. 단계별 계획 (Phases)

각 단계는 **독립 배포 가능**하고 **엔진 테스트 14개 + 타입 감사**가 그린이어야 한다.

### Phase 0 — 타입 정합성 (즉효, 작음) ✅ 증상2-A
- 남은 16건(+나머지 테마) `기동→유발즉시` 교정, `timing`도 함께 정합(eitherTurn/opponentTurn).
- 산출물: 타입 감사 불일치 0, `final-gate` 분포 갱신.
- 효과: 응답 필터에 걸려 사라지던 마법/함정이 즉시 응답 후보로 노출.

### Phase 1 — 이벤트 인식 통일 (중) ✅ 증상2-B
- 레거시 액션(`keyFetch` 등)도 신엔진 이벤트 버스에 "효과/액션 발동" 이벤트를 발행.
- 신엔진 퀵 condition이 시스템 무관하게 이를 인식.
- 산출물: keyFetch에 응답하는 퀵 카드 회귀 테스트.

### Phase 2 — keyFetch 신엔진 링크화 (중) ✅ 증상1
- `keyFetch`를 신엔진 chainState 링크로 발행, 응답창을 신엔진이 연다.
- 레거시 `addChainLink('keyFetch')` 제거, 미러 일치 불변식(2) 테스트.

### Phase 3 — 응답 수집 일원화 (중)
- `collectChainOptions`를 단일 신엔진 경로로. 레거시 갈래/`CHAIN_HAND_RESPONSES` 의존 제거(이식분).
- AI 응답도 동일 수집기 공유.

### Phase 4 — AI 액션 신엔진화 (중~대)
- `ai*` 리졸버 → `activateEffect` 경로. 레거시 AI 리졸버 폐지.
- `tests/engine/ai-engine-actions.test.js` 확장.

### Phase 5 — 범용 카드 이식 + 레거시 체인 제거 (대)
- 범용 12종 EffectDefinition 이식.
- `effects-chain.js`의 체인 권위 코드 제거, 렌더/네트워크 미러만 잔존(또는 신엔진으로 흡수).
- `legacy-cleanup` 게이트로 잔존물 0 고정.

---

## 5. 테스트 전략
- **회귀 게이트 유지**: `run-engine-tests.js`(14) + `effect-type-audit.js` + `effect-audit.js`.
- **신규 회귀**: ① keyFetch에 퀵 응답 가능, ② 미러 링크 목록 일치, ③ 레거시·신엔진 혼합 체인의
  LIFO 해결 순서, ④ 네트워크 2클라 chainState 수렴(가능 범위 내 시뮬).
- 각 Phase는 **그 Phase의 불변식 테스트를 먼저 추가**(red) → 구현(green).

## 6. 리스크 & 롤백
- **네트워크 동기화**: 미러 포맷 변경이 Firebase 스키마(network.js:236 기본값)와 호환돼야 함.
  Phase마다 미러 출력 형태를 고정.
- **AI 회귀**: AI 경로가 레거시 리졸버에 깊게 의존(Phase 4 위험 최고). Phase 4는 마지막에.
- **혼합 체인 과도기**: Phase 1~3 동안 레거시/신엔진 공존 → 불변식(2) 테스트로 분기 감시.
- 롤백: 각 Phase는 독립 커밋. 미러는 단방향이라 Phase 0~3은 되돌리기 쉬움.

## 7. 결정 필요 (Open Questions)
- keyFetch를 **PROCEDURE(소환 절차)** 로 볼지 **QUICK 액션 링크**로 볼지 (응답 가능성에 영향).
- 범용 카드(구사일생/눈에는눈/일격필살 등)의 효과 타입 분류 — 타입 감사와 동시 진행.
- 레거시 `effects-chain.js`를 완전 삭제할지, 얇은 네트워크/렌더 어댑터로 남길지.

---

### 권장 착수 순서
**Phase 0(타입 정합) → Phase 1(이벤트 인식) → Phase 2(keyFetch 링크화)** 가
증상 2와 1을 가장 빠르고 안전하게 해소한다. Phase 4(AI)·5(레거시 제거)는 후순위.
