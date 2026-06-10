// 펭귄 테마 — 카드 텍스트 준수 회귀 테스트
// (무효화, 소환 제한, 1턴 제한, 공격력 버프 보존, 자기-유발 판정, 바운스 내성)
const { createContext, loadAllEffects, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runPenguinTextComplianceTests() {
  // ── 1) 펭귄의 일격 ①: 상대 몬스터 효과를 실제로 무효화한다 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myHand: [makeCard('펭귄의 일격'), makeCard('펭귄 마을')],
      myField: [makeCard('꼬마 펭귄', { atk: 1 })],
      opField: [makeCard('펭귄 용사', { atk: 4 })],
      opGrave: [makeCard('펭귄의 영광')],
    });
    ctx.G = state;
    ctx.isMyTurn = true;
    const chain = ctx.HB_CHAIN_ENGINE;

    const opAct = chain.activateEffect({
      gameState: state, controller: 'opponent', cardId: '펭귄 용사',
      sourceZone: 'field', effect: 'penguin-hero-2-quick-return-recover-magic',
    });
    assertEqual(opAct.ok, true, 'strike: 상대 용사 ② 발동');

    const myAct = chain.activateEffect({
      gameState: state, controller: 'me', cardId: '펭귄의 일격',
      sourceZone: 'hand', effect: 'penguin-strike-1-negate-monster-effect',
    });
    assertEqual(myAct.ok, true, 'strike: 일격 ① 체인 발동');

    const resolved = chain.resolveChain({ controller: 'me' });
    assertEqual(resolved.ok, true, 'strike: 체인 해결');
    assert(state.opField.some(c => c.id === '펭귄 용사'), 'strike: 무효된 용사 ②는 처리되지 않아 필드 잔류');
    assert(!state.opHand.some(c => c.id === '펭귄의 영광'), 'strike: 무효된 용사 ②의 회수도 처리되지 않음');
  }

  // ── 2) 소환 제한: 용사/전설은 허용된 효과(reason)로만 소환 ──
  {
    const ctx = loadAllEffects(createContext());
    const MOVE = ctx.HB_CARD_MOVE;
    const state = makeState({ myHand: [makeCard('펭귄 용사')], opField: [makeCard('꼬마 펭귄')] });
    ctx.G = state;

    const blocked = MOVE.summonCard({ gameState: state, cardId: '펭귄 용사', controller: 'me', from: { controller: 'me', zone: 'hand' }, reason: 'penguinCharge2' });
    assertEqual(blocked.ok, false, 'restriction: 돌격 ② reason으로 용사 소환 차단');
    assertEqual(state.myField.length, 0, 'restriction: 용사가 필드에 나오지 않음');

    const allowed = MOVE.summonCard({ gameState: state, cardId: '펭귄 용사', controller: 'me', from: { controller: 'me', zone: 'hand' }, reason: 'penguinGlory1' });
    assertEqual(allowed.ok, true, 'restriction: 영광 ① reason으로는 소환 허용');
    assert(typeof MOVE.canSummonWithReason === 'function' && !MOVE.canSummonWithReason(state, '펭귄의 전설', 'penguinLegend2Summon'), 'restriction: 전설은 전설 ② reason으로 소환 불가');
  }

  // ── 2-1) 돌격 ②: 패에 용사만 있으면 발동 자체가 불가(후보 필터) ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myHand: [makeCard('펭귄 용사')],
      myGrave: [makeCard('펭귄!돌격!')],
      opField: [makeCard('꼬마 펭귄')],
    });
    ctx.G = state;
    const can = ctx.HB_CHAIN_ENGINE.canActivateEffect({ gameState: state, controller: 'me', cardId: '펭귄!돌격!', sourceZone: 'grave' }, 'penguin-charge-2-grave-banish-hand-summon');
    assertEqual(can.ok, false, 'restriction: 돌격 ②는 소환 가능한 펭귄이 패에 없으면 발동 불가');
  }

  // ── 2-2) 영원하라 ②(묘지 발동 = 카드명 '펭귄의 영광' 취급)는 용사를 소환할 수 있다 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myHand: [makeCard('펭귄 용사')],
      myGrave: [makeCard('펭귄이여 영원하라')],
      opField: [makeCard('꼬마 펭귄')],
      activeController: 'opponent',
    });
    ctx.G = state;
    ctx.isMyTurn = false; // 상대 턴
    const act = ctx.HB_CHAIN_ENGINE.activateEffect({
      gameState: state, controller: 'me', cardId: '펭귄이여 영원하라',
      sourceZone: 'grave', effect: 'penguin-forever-2-grave-banish-hand-summon', autoResolve: true,
    });
    assertEqual(act.ok, true, 'nameTreat: 영원하라 ② 발동');
    assert(state.myField.some(c => c.id === '펭귄 용사'), 'nameTreat: 영원하라 ②(영광 취급)로 용사 소환 허용');
    assert(state.myExile.some(c => c.id === '펭귄이여 영원하라'), 'nameTreat: 코스트로 제외됨');
  }

  // ── 3) 1턴 제한: 부부 ②와 용사 ③은 텍스트상 횟수 제한 없음 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myHand: [makeCard('펭귄 부부'), makeCard('펭귄 마을')],
      myDeck: [makeCard('꼬마 펭귄'), makeCard('현자 펭귄'), makeCard('수문장 펭귄'), makeCard('펭귄 마을')],
    });
    ctx.G = state;
    const chain = ctx.HB_CHAIN_ENGINE;
    const first = chain.activateEffect({ gameState: state, controller: 'me', cardId: '펭귄 부부', sourceZone: 'hand', effect: 'penguin-couple-2-hand-draw-return', autoResolve: true });
    assertEqual(first.ok, true, 'oncePerTurn: 부부 ② 1회차');
    state.myHand.push(makeCard('펭귄 부부'));
    const second = chain.canActivateEffect({ gameState: state, controller: 'me', cardId: '펭귄 부부', sourceZone: 'hand' }, 'penguin-couple-2-hand-draw-return');
    assertEqual(second.ok, true, 'oncePerTurn: 부부 ②는 같은 턴 재발동 가능');

    const hero3 = ctx.HB_EFFECT_REGISTRY.getEffectById('penguin-hero-3-sent-to-grave-revive-buff');
    assert(hero3 && !hero3.oncePerTurn, 'oncePerTurn: 용사 ③은 횟수 제한 없음');
  }

  // ── 4) 공격력 버프: 지속 효과 재계산(렌더)에도 보존, 버프 종류 구분 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myHand: [makeCard('펭귄 마을', { isPublic: true }), makeCard('현자 펭귄')],
      opHand: [makeCard('꼬마 펭귄')],
      myField: [makeCard('수문장 펭귄', { atk: 3, atkBase: 3 })],
    });
    ctx.G = state;
    const act = ctx.HB_CHAIN_ENGINE.activateEffect({
      gameState: state, controller: 'me', cardId: '수문장 펭귄',
      sourceZone: 'field', sourceIndex: 0, effect: 'gatekeeper-penguin-1-village-atk-discard', autoResolve: true,
    });
    assertEqual(act.ok, true, 'buff: 수문장 ① 발동');
    const gk = state.myField.find(c => c.id === '수문장 펭귄');
    assertEqual(gk.atk, 4, 'buff: 수문장 ① 공격력 +1');
    assertEqual(gk.atkBuff, 1, 'buff: 영구 버프 필드(atkBuff)에 기록');

    // 렌더링마다 도는 지속 효과 재계산이 버프를 지우지 않아야 한다.
    ctx.HB_CONTINUOUS_ENGINE.applyContinuousEffects(state);
    assertEqual(state.myField.find(c => c.id === '수문장 펭귄').atk, 4, 'buff: applyContinuousEffects 후에도 +1 유지');
  }

  // ── 4-1) 용사 ③: "턴 종료시까지" 버프는 atkBuffTurn에 기록 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myGrave: [makeCard('펭귄 용사')],
      myField: [makeCard('꼬마 펭귄', { atk: 1, atkBase: 1 })],
    });
    ctx.G = state;
    const effect = ctx.HB_EFFECT_REGISTRY.getEffectById('penguin-hero-3-sent-to-grave-revive-buff');
    const ectx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
      gameState: state, controller: 'me', effect, cardId: '펭귄 용사',
      sourceZone: 'grave', event: { type: 'sentToGrave', cardId: '펭귄 용사', controller: 'me' },
    });
    const result = effect.resolve(ectx);
    assertEqual(result.ok, true, 'hero3: 자기 소생 처리');
    assert(state.myField.some(c => c.id === '펭귄 용사'), 'hero3: 용사 부활');
    const kkoma = state.myField.find(c => c.id === '꼬마 펭귄');
    assertEqual(kkoma.atk, 2, 'hero3: 꼬마 펭귄 +1');
    assertEqual(kkoma.atkBuffTurn, 1, 'hero3: 턴 한정 버프 필드(atkBuffTurn)에 기록');
    ctx.HB_CONTINUOUS_ENGINE.applyContinuousEffects(state);
    assertEqual(state.myField.find(c => c.id === '꼬마 펭귄').atk, 2, 'hero3: 재계산 후에도 유지');
  }

  // ── 5) 자기-유발 판정: 내 소환 이벤트가 상대 동명 카드를 깨우지 않는다 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myField: [makeCard('꼬마 펭귄', { atk: 1 })],
      opField: [makeCard('꼬마 펭귄', { atk: 1 })],
      myDeck: [makeCard('현자 펭귄')],
      opDeck: [makeCard('현자 펭귄')],
    });
    ctx.G = state;
    const event = { type: 'summon', cardId: '꼬마 펭귄', controller: 'me', from: { controller: 'me', zone: 'hand' }, to: { controller: 'me', zone: 'field' } };
    const triggers = ctx.HB_TRIGGER_QUEUE.collectTriggers(event, state, {});
    const entries = triggers.filter(t => t.effectId === 'kkoma-penguin-2-on-summon-deck-summon');
    assertEqual(entries.length, 1, 'selfTrigger: 후보는 1건');
    assertEqual(entries[0].controller, 'me', 'selfTrigger: 소환한 쪽(me)만 유발');
  }

  // ── 6) 전설 ③ 내성: 비대상 바운스는 차단, 대상 지정 바운스는 통과 ──
  {
    const ctx = loadAllEffects(createContext());
    const MOVE = ctx.HB_CARD_MOVE;
    const opEffect = { id: 'op-bounce-effect', controller: 'opponent' };
    const mk = () => {
      const s = makeState({ myField: [makeCard('펭귄의 전설', { atk: 5, atkBase: 5 })] });
      ctx.G = s;
      return s;
    };

    const s1 = mk();
    const nonTarget = MOVE.moveCard({
      gameState: s1, cardId: '펭귄의 전설', controller: 'me',
      from: { controller: 'me', zone: 'field' }, to: { controller: 'me', zone: 'hand' },
      effect: opEffect, actorController: 'opponent', reason: 'opBounce',
    });
    assertEqual(nonTarget.ok, false, 'legend3: 비대상 상대 효과 바운스 차단');
    assertEqual(s1.myField.length, 1, 'legend3: 필드 유지');

    const s2 = mk();
    const targeted = MOVE.moveCard({
      gameState: s2, cardId: '펭귄의 전설', controller: 'me',
      from: { controller: 'me', zone: 'field' }, to: { controller: 'me', zone: 'hand' },
      effect: opEffect, actorController: 'opponent', reason: 'opBounce', isTargeting: true,
    });
    assertEqual(targeted.ok, true, 'legend3: 대상 지정 효과는 텍스트대로 통과');
    assert(s2.myHand.some(c => c.id === '펭귄의 전설'), 'legend3: 대상 바운스는 패로 이동');
  }

  // ── 7) 선택권: 수문장 ②/용사 ②에 collectChoices가 정의되어 picker가 뜬다 ──
  {
    const ctx = loadAllEffects(createContext());
    const reg = ctx.HB_EFFECT_REGISTRY;
    assert(typeof reg.getEffectById('gatekeeper-penguin-2-village-send-opponent').collectChoices === 'function', 'choices: 수문장 ② collectChoices');
    assert(typeof reg.getEffectById('penguin-hero-2-quick-return-recover-magic').collectChoices === 'function', 'choices: 용사 ② collectChoices');
  }
};
