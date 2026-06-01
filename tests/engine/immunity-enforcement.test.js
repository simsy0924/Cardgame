// 내성/보호 중앙 강제(card-move) + 선언형 룰 self-scope 보정 검증.
const { createContext, loadAllEffects, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runImmunityEnforcementTests() {
  const ctx = loadAllEffects(createContext());
  const MOVE = ctx.HB_CARD_MOVE;
  const OP_EFFECT = { id: 'op-removal-effect', controller: 'opponent' };

  const fieldState = (ids) => makeState({ myField: ids.map(id => makeCard(id)) });
  const fromField = { controller: 'me', zone: 'field' };
  // 상대 효과가 내 필드 카드를 묘지로 보내려는 호출
  const opGrave = (state, cardId, extra) => MOVE.sendToGrave(Object.assign({
    gameState: state, cardId, controller: 'me', from: fromField,
    effect: OP_EFFECT, actorController: 'opponent', reason: 'opEffect',
  }, extra || {}));

  // 1) 상대 효과가 아자토스(effectImmunity:allEffects + cannotBeSentToGrave)를 묘지로 → 차단
  {
    const state = fieldState(['아우터 갓-아자토스']);
    const r = opGrave(state, '아우터 갓-아자토스');
    assertEqual(r.ok, false, 'azathoth: opponent-effect grave blocked');
    assertEqual(state.myGrave.length, 0, 'azathoth: not sent to grave');
    assertEqual(state.myField.length, 1, 'azathoth: stays on field');
  }

  // 2) ★ over-broad 가드: 아자토스가 필드에 있어도 '다른 카드'는 상대 효과로 제거 가능
  {
    const state = fieldState(['아우터 갓-아자토스', '꼬마 펭귄']);
    const r = opGrave(state, '꼬마 펭귄');
    assertEqual(r.ok, true, 'other card NOT protected by azathoth-on-field (self-scope fix)');
    assert(state.myGrave.some(c => c.id === '꼬마 펭귄'), 'other card moved to grave');
  }

  // 3) 자기 효과(actor === owner)는 차단 안 함 (v1: 상대 효과 한정 강제)
  {
    const state = fieldState(['아우터 갓-아자토스']);
    const r = MOVE.sendToGrave({ gameState: state, cardId: '아우터 갓-아자토스', controller: 'me', from: fromField, effect: { id: 'self', controller: 'me' }, actorController: 'me', reason: 'selfEffect' });
    assertEqual(r.ok, true, 'own effect not blocked');
  }

  // 4) 전투/효과 외(opts.effect 없음)는 차단 안 함 (effect 게이트)
  {
    const state = fieldState(['아우터 갓-아자토스']);
    const r = MOVE.sendToGrave({ gameState: state, cardId: '아우터 갓-아자토스', controller: 'me', from: fromField, reason: 'battle' });
    assertEqual(r.ok, true, 'battle/non-effect grave not blocked');
  }

  // 5) banishCard에도 effectImmunity 적용
  {
    const state = fieldState(['아우터 갓-아자토스']);
    const r = MOVE.banishCard({ gameState: state, cardId: '아우터 갓-아자토스', controller: 'me', from: fromField, effect: OP_EFFECT, actorController: 'opponent', reason: 'opEffect' });
    assertEqual(r.ok, false, 'azathoth: opponent-effect banish blocked');
    assertEqual(state.myExile.length, 0, 'azathoth: not banished');
  }

  // 6) 펭귄의 전설(함수형 룰, 비대상 상대효과 면역)
  {
    const state = fieldState(['펭귄의 전설']);
    const r = opGrave(state, '펭귄의 전설'); // isTargeting 미지정 → 비대상 → 면역
    assertEqual(r.ok, false, 'penguin legend: non-target opponent effect blocked');
  }

  // 7) effect-context가 actorController를 주입하는 경로 검증 (ctx.move)
  {
    const state = fieldState(['아우터 갓-아자토스']);
    ctx.G = state;
    const ectx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
      gameState: state, controller: 'opponent', authority: true,
      effect: { id: 'op-ctx-removal' }, cardId: '아우터 갓-아자토스',
      sourceZone: 'field', source: { controller: 'opponent', zone: 'field', index: 0 },
    });
    const r = ectx.move.sendToGrave({ cardId: '아우터 갓-아자토스', controller: 'me', from: fromField, reason: 'opCtxEffect' });
    assertEqual(r.ok, false, 'ctx.move injects actorController=opponent → immunity blocks');
  }
};
