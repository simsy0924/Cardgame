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

  // ── 8) 전설 ③ 내성 — 코스트는 통과한다 (코스트는 효과가 아님) ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({ myField: [makeCard('펭귄의 전설', { atk: 5, atkBase: 5 })] });
    ctx.G = state;
    // 상대가 "상대 필드의 카드 1장을 묘지로 보내고 발동" 류 코스트를 지불 (크아이가 ② 패턴)
    const rawEffect = {
      id: 'test-op-cost-send', cardId: '그레이트 올드 원-크아이가', type: 'activation',
      cost(c) {
        return c.move.sendToGrave({ cardId: '펭귄의 전설', controller: 'me', from: { controller: 'me', zone: 'field' }, reason: 'testOpCost' });
      },
      resolve() { return { ok: true }; },
    };
    const paid = ctx.HB_CHAIN_ENGINE.payCost({ gameState: state, controller: 'opponent' }, rawEffect);
    assertEqual(paid.ok, true, 'cost: 상대 코스트의 전설 묘지行은 내성을 통과');
    assert(state.myGrave.some(c => c.id === '펭귄의 전설'), 'cost: 전설이 코스트로 묘지에 감');
  }

  // ── 8-1) 코스트여도 "묘지로 보내지지 않는다" 무조건 룰은 유지 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({ myField: [makeCard('아우터 갓-아자토스', { atk: 10, atkBase: 10 })] });
    ctx.G = state;
    const r = ctx.HB_CARD_MOVE.sendToGrave({
      gameState: state, cardId: '아우터 갓-아자토스', controller: 'me', from: { controller: 'me', zone: 'field' },
      effect: { id: 'op-cost', controller: 'opponent' }, actorController: 'opponent', isCost: true, reason: 'opCost',
    });
    assertEqual(r.ok, false, 'cost: 아자토스의 묘지行 불가 룰은 코스트에도 적용');
  }

  // ── 8-2) 플레이어 명령형(playerDirective) 효과는 내성 예외 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({ myField: [makeCard('펭귄의 전설', { atk: 5, atkBase: 5 })] });
    ctx.G = state;
    const r = ctx.HB_CARD_MOVE.sendToGrave({
      gameState: state, cardId: '펭귄의 전설', controller: 'me', from: { controller: 'me', zone: 'field' },
      effect: { id: 'op-player-directive', controller: 'opponent', tags: ['playerDirective'] },
      actorController: 'opponent', reason: 'playerDirectiveEffect',
    });
    assertEqual(r.ok, true, 'playerDirective: 플레이어 명령형 효과는 전설 내성을 통과');
    assert(state.myGrave.some(c => c.id === '펭귄의 전설'), 'playerDirective: 전설이 묘지로 감');
  }

  // ── 8-3) 상대 지속 효과의 공격력 보정도 전설에는 적용되지 않는다 ──
  {
    const ctx = loadAllEffects(createContext());
    ctx.HB_EFFECT_REGISTRY.registerEffects([{
      id: 'test-op-continuous-debuff', cardId: '테스트 디버퍼', type: 'continuous', zones: ['field'],
      text: '상대 필드의 몬스터의 공격력을 1 내린다.',
      continuousRule: { attackModifiers: [{ opponentCardsOnly: true, amount: -1 }] },
    }]);
    const state = makeState({
      myField: [makeCard('펭귄의 전설', { atk: 5, atkBase: 5 }), makeCard('꼬마 펭귄', { atk: 1, atkBase: 1 })],
      opField: [makeCard('테스트 디버퍼', { atk: 0, atkBase: 0 })],
    });
    ctx.G = state;
    ctx.HB_CONTINUOUS_ENGINE.applyContinuousEffects(state);
    assertEqual(state.myField.find(c => c.id === '꼬마 펭귄').atk, 0, 'contAtk: 내성 없는 꼬마 펭귄은 -1 적용');
    assertEqual(state.myField.find(c => c.id === '펭귄의 전설').atk, 5, 'contAtk: 전설은 비대상 지속 디버프를 받지 않음');
  }

  // ── 8-4) 비대상 무효화(일격 ①)는 필드의 전설의 효과를 무효화하지 못한다 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myHand: [makeCard('펭귄의 일격'), makeCard('펭귄 마을')],
      myField: [makeCard('꼬마 펭귄', { atk: 1 })],
      opField: [makeCard('펭귄의 전설', { atk: 5, atkBase: 5 })],
      opGrave: [makeCard('꼬마 펭귄')],
      activeController: 'me',
    });
    ctx.G = state;
    ctx.isMyTurn = true; // 상대 기준 상대 턴 → 전설 ② 발동 가능
    const chain = ctx.HB_CHAIN_ENGINE;

    const opAct = chain.activateEffect({
      gameState: state, controller: 'opponent', cardId: '펭귄의 전설',
      sourceZone: 'field', effect: 'penguin-legend-2-quick-return-revive-monster',
    });
    assertEqual(opAct.ok, true, 'negateImmunity: 상대 전설 ② 발동');

    const myAct = chain.activateEffect({
      gameState: state, controller: 'me', cardId: '펭귄의 일격',
      sourceZone: 'hand', effect: 'penguin-strike-1-negate-monster-effect',
    });
    assertEqual(myAct.ok, true, 'negateImmunity: 일격 ① 체인 발동');

    const resolved = chain.resolveChain({ controller: 'me' });
    assertEqual(resolved.ok, true, 'negateImmunity: 체인 해결');
    // 비대상 무효화는 전설 ③에 막혀 전설 ②가 그대로 처리된다.
    assert(state.opHand.some(c => c.id === '펭귄의 전설'), 'negateImmunity: 전설 ②가 처리되어 패로 되돌아감');
    assert(state.opField.some(c => c.id === '꼬마 펭귄'), 'negateImmunity: 묘지의 꼬마 펭귄이 소생됨');
  }

  // ── 9) 슈브 니구라스 ②도 같은 무효화 메커니즘으로 실제 작동한다 ──
  //     (기존엔 frozen 체인 링크에 직접 써서 무효가 불발이었다)
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({
      myField: [makeCard('아우터 갓 슈브 니구라스', { atk: 0, atkBase: 0 })],
      myDeck: [makeCard('엘더 갓-노덴스')],
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
    assertEqual(opAct.ok, true, 'shub2: 상대 용사 ② 발동');

    const myAct = chain.activateEffect({
      gameState: state, controller: 'me', cardId: '아우터 갓 슈브 니구라스',
      sourceZone: 'field', effect: 'cthulhu-outer-shub-2-response-banish-elder-negate',
    });
    assertEqual(myAct.ok, true, 'shub2: 슈브 ② 체인 발동');
    assert(state.myExile.some(c => c.id === '엘더 갓-노덴스'), 'shub2: 코스트로 엘더 갓 제외');

    const resolved = chain.resolveChain({ controller: 'me' });
    assertEqual(resolved.ok, true, 'shub2: 체인 해결');
    assert(state.opField.some(c => c.id === '펭귄 용사'), 'shub2: 무효된 용사 ②는 처리되지 않아 필드 잔류');
    assert(!state.opHand.some(c => c.id === '펭귄의 영광'), 'shub2: 무효된 용사 ②의 회수도 처리되지 않음');
  }

  // ── 10) 유발 효과도 상대가 있으면 체인을 열어 두고 응답 창을 거친다 ──
  {
    const ctx = loadAllEffects(createContext());
    ctx.AI = { active: true }; // 응답할 상대(AI)가 있는 환경
    const state = makeState({
      myField: [makeCard('꼬마 펭귄', { atk: 1 })],
      myDeck: [makeCard('현자 펭귄')],
    });
    ctx.G = state;
    const received = ctx.HB_TRIGGER_QUEUE.receiveEvent(
      { type: 'summon', cardId: '꼬마 펭귄', controller: 'me', to: { controller: 'me', zone: 'field' } },
      state
    );
    assertEqual(received.ok, true, 'triggerChain: 이벤트 수신');
    const act = ctx.HB_TRIGGER_QUEUE.activateSelectedTrigger({ effectId: 'kkoma-penguin-2-on-summon-deck-summon', controller: 'me' });
    assertEqual(act.ok, true, 'triggerChain: 꼬마 ② 트리거 발동');
    assert(ctx.HB_CHAIN_ENGINE.hasActiveChain(), 'triggerChain: 체인이 열린 채 응답 대기');
    assertEqual(state.myField.length, 1, 'triggerChain: 해결 전 — 덱 소환 미실행');

    ctx.HB_CHAIN_ENGINE.passChainResponse('opponent');
    ctx.HB_CHAIN_ENGINE.passChainResponse('me');
    assert(state.myField.some(c => c.id === '현자 펭귄'), 'triggerChain: 패스 2회 후 해결되어 덱에서 소환');
    assert(!ctx.HB_CHAIN_ENGINE.hasActiveChain(), 'triggerChain: 체인 종료');
  }

  // ── 10-1) PvP(roomRef)에서 수동 발동도 즉시 해결되지 않고 응답 창을 연다 ──
  //     (기존엔 window.roomRef 오판으로 네트워크전의 모든 발동이 즉시 해결됐다)
  {
    const ctx = loadAllEffects(createContext());
    ctx.roomRef = {
      child: () => ({ set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, on() {}, off() {} }),
      update() { return Promise.resolve(); },
    };
    const state = makeState({ myHand: [makeCard('꼬마 펭귄')] });
    ctx.G = state;
    const entries = ctx.HB_EFFECT_UI.getAvailableEffects({
      gameState: state, controller: 'me', player: 'me',
      cardId: '꼬마 펭귄', card: state.myHand[0], zone: 'hand', sourceIndex: 0,
    });
    const entry = entries.find(e => e.effect.id === 'kkoma-penguin-1-hand-summon');
    assert(entry, 'pvpChain: 꼬마 ① 발동 가능');
    const act = ctx.HB_EFFECT_UI.activateAvailableEffect(entry, {});
    assertEqual(act.ok, true, 'pvpChain: 발동 성공');
    assert(ctx.HB_CHAIN_ENGINE.hasActiveChain(), 'pvpChain: 체인이 열린 채 응답 대기');
    assertEqual(state.myField.length, 0, 'pvpChain: 해결 전 — 소환 미실행');

    ctx.HB_CHAIN_ENGINE.passChainResponse('opponent');
    ctx.HB_CHAIN_ENGINE.passChainResponse('me');
    assert(state.myField.some(c => c.id === '꼬마 펭귄'), 'pvpChain: 패스 2회 후 소환');
  }

  // ── 10-2) 원격 체인 미러 동기화 — 비발동측 엔진에서 패스/해결이 동작한다 ──
  {
    const ctx = loadAllEffects(createContext());
    const state = makeState({ opHand: [makeCard('꼬마 펭귄')] });
    ctx.G = state;
    // 상대(guest)가 발동한 체인 미러를 수신 (나 = host)
    const sync = ctx.HB_CHAIN_ENGINE.syncRemoteChainState({
      hbEngine: true, active: true, chainId: 'remote_c1', passCount: 0, priority: 'host',
      links: [{ id: 'remote_L1', by: 'guest', effectId: 'kkoma-penguin-1-hand-summon', cardId: '꼬마 펭귄', sourceZone: 'hand', sourceIndex: 0, label: '꼬마 ①' }],
    });
    assertEqual(sync.ok, true, 'remoteSync: 미러 재구성');
    assert(ctx.HB_CHAIN_ENGINE.hasActiveChain(), 'remoteSync: 수신측 엔진에 체인 활성');
    assertEqual(ctx.HB_CHAIN_ENGINE.getChainState().priority, 'me', 'remoteSync: 우선권이 수신측(me)으로 매핑');

    const pass1 = ctx.HB_CHAIN_ENGINE.passChainResponse('me');
    assertEqual(pass1.ok, true, 'remoteSync: 수신측 패스 가능 (기존엔 활성 체인 없음 오류)');
    const pass2 = ctx.HB_CHAIN_ENGINE.passChainResponse('opponent');
    assertEqual(pass2.ok, true, 'remoteSync: 해결 패스');
    assert(state.opField.some(c => c.id === '꼬마 펭귄'), 'remoteSync: 재구성된 상대 링크 해결(패→필드)');

    // 해결된(비활성) 미러 수신 → 로컬 엔진 체인 정리
    const clear = ctx.HB_CHAIN_ENGINE.syncRemoteChainState({ hbEngine: true, active: false, links: [] });
    assertEqual(clear.ok, true, 'remoteSync: 비활성 미러 처리');
    assert(!ctx.HB_CHAIN_ENGINE.hasActiveChain(), 'remoteSync: 체인 정리됨');
  }
};
