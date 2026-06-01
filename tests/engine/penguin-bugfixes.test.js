// 펭귄 버그 수정 검증:
//  Bug 1) 펭귄 마을 ②(REPLACEMENT) — 엔진 버리기 경로에서 공개 마을을 버릴 때
//          대신 필드 펭귄을 묘지로 보내는 교체가 발동되는가.
//  Bug 2) 기동효과 timing — 펭귄 부부 ②는 자신 전개 단계에만 발동 가능한가.
const { createContext, loadAllEffects, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runPenguinBugfixTests() {
  const ctx = loadAllEffects(createContext());
  const PENGUIN = ctx.HB_PENGUIN_EFFECTS;
  const CHAIN = ctx.HB_CHAIN_ENGINE;
  const REG = ctx.HB_EFFECT_REGISTRY;

  // ─────────────────────────────────────────────
  // Bug 2: 펭귄 부부 ② 기동효과 → 자신 전개 단계에만
  // ─────────────────────────────────────────────
  {
    const effect = REG.getEffectById('penguin-couple-2-hand-draw-return');
    assert(effect, 'penguin-couple-2 effect exists');
    assert(!!effect.timing, 'bubu2 timing is set (not undefined)');

    const savedIsMyTurn = ctx.isMyTurn;
    const canAct = (phase, mine) => {
      const state = makeState({ myHand: [makeCard('펭귄 부부'), makeCard('X')] });
      state.myDeck = [makeCard('a'), makeCard('b'), makeCard('c')];
      state.phase = phase;
      ctx.isMyTurn = mine; // 엔진 isMyTurnForController는 글로벌 isMyTurn을 우선 사용
      ctx.G = state;
      const ectx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
        gameState: state, controller: 'me', cardId: '펭귄 부부', card: state.myHand[0],
        sourceZone: 'hand', sourceIndex: 0, source: { controller: 'me', zone: 'hand', index: 0 },
      });
      return CHAIN.canActivateEffect(ectx, effect);
    };

    assertEqual(canAct('deploy', true).ok, true, 'bubu2: 자신 전개 단계 → 발동 가능');
    assertEqual(canAct('battle', true).ok, false, 'bubu2: 자신 공격(비전개) 단계 → 발동 불가');
    assertEqual(canAct('deploy', false).ok, false, 'bubu2: 상대 턴 → 발동 불가');
    ctx.isMyTurn = savedIsMyTurn;
  }

  // 회귀: 트리거/상대턴 효과는 영향받지 않는다 (펭귄 용사 ② = 상대 턴)
  {
    const warrior2 = REG.getEffectById('penguin-warrior-2-bounce-recover-magic')
      || REG.getEffectsByCardId('펭귄 용사').find(e => String(e.effectNo) === '2');
    if (warrior2) assert(warrior2.timing && warrior2.timing !== (ctx.HB_RULES && ctx.HB_RULES.TIMING && ctx.HB_RULES.TIMING.MY_DEPLOY), '펭귄 용사 ②는 전개 타이밍이 아님(상대 턴)');
  }

  // ─────────────────────────────────────────────
  // Bug 1: 펭귄 마을 ② 교체 (엔진 버리기 경로)
  // ─────────────────────────────────────────────
  const publicVillage = () => Object.assign(makeCard('펭귄 마을'), { isPublic: true });

  // 1) 직접 호출 (confirmChoice) — 교체 메커니즘
  {
    const state = makeState({ myHand: [publicVillage(), makeCard('B')], myField: [makeCard('꼬마 펭귄')] });
    ctx.G = state;
    const r = PENGUIN.handleVillageDiscardReplacement({ gameState: state, controller: 'me', confirmChoice: true, selectedIndices: [0] });
    assertEqual(r.handled, true, 'village②(direct): handled');
    assert(state.myGrave.some(c => c.id === '꼬마 펭귄'), 'village②(direct): 필드 펭귄이 묘지로');
    assert(state.myHand.some(c => c.id === '펭귄 마을'), 'village②(direct): 펭귄 마을은 패에 잔류');
  }

  // 2) 통합 — requestHandDiscard 인터랙티브가 공개 마을 선택 시 교체로 위임
  {
    const state = makeState({ myHand: [publicVillage(), makeCard('B'), makeCard('C')], myField: [makeCard('꼬마 펭귄')] });
    ctx.G = state;
    ctx.gameConfirm = (_msg, cb) => cb(true);                                   // "대신 펭귄 묘지로?" → 예
    ctx.openCardPicker = (cards, _t, _n, cb) => cb([cards.findIndex(c => c.id === '펭귄 마을')]); // 마을을 버리려 선택
    const ectx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
      gameState: state, controller: 'me', cardId: '펭귄 마을',
      sourceZone: 'hand', sourceIndex: 0, source: { controller: 'me', zone: 'hand', index: 0 },
    });
    PENGUIN.requestHandDiscard(ectx, { count: 1, reason: 'test-village' });
    assert(state.myGrave.some(c => c.id === '꼬마 펭귄'), 'village②(integration): 필드 펭귄이 묘지로');
    assert(state.myHand.some(c => c.id === '펭귄 마을'), 'village②(integration): 펭귄 마을은 패에 잔류');
    assert(!state.myGrave.some(c => c.id === '펭귄 마을'), 'village②(integration): 펭귄 마을은 묘지로 가지 않음');
    delete ctx.gameConfirm; delete ctx.openCardPicker;
  }

  // 3) 거부 시 정상 버리기 (교체 안 함 → 마을이 묘지로)
  {
    const state = makeState({ myHand: [publicVillage(), makeCard('B')], myField: [makeCard('꼬마 펭귄')] });
    ctx.G = state;
    ctx.gameConfirm = (_msg, cb) => cb(false);                                  // 거부
    ctx.openCardPicker = (cards, _t, _n, cb) => cb([cards.findIndex(c => c.id === '펭귄 마을')]);
    const ectx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
      gameState: state, controller: 'me', cardId: '펭귄 마을',
      sourceZone: 'hand', sourceIndex: 0, source: { controller: 'me', zone: 'hand', index: 0 },
    });
    PENGUIN.requestHandDiscard(ectx, { count: 1, reason: 'test-village-decline' });
    assert(state.myGrave.some(c => c.id === '펭귄 마을'), 'village②(decline): 거부 시 펭귄 마을이 묘지로');
    assert(state.myField.some(c => c.id === '꼬마 펭귄'), 'village②(decline): 필드 펭귄은 유지');
    delete ctx.gameConfirm; delete ctx.openCardPicker;
  }
};
