// 엔진 버리기 단계(requestHandDiscard) 검증 — 펭귄 파일럿.
// 핵심: 패 버리기 시 플레이어가 고른 카드가 실제로 버려지는가(첫 카드 자동이 아님).
const { createContext, loadAllEffects, makeCard, makeState, assert, assertEqual } = require('./_setup');

module.exports = function runPenguinDiscardTests() {
  const ctx = loadAllEffects(createContext());
  const PENGUIN = ctx.HB_PENGUIN_EFFECTS;
  assert(PENGUIN && typeof PENGUIN.requestHandDiscard === 'function', 'requestHandDiscard must be exposed');

  function makeEctx(handIdList) {
    const state = makeState({ myHand: handIdList.map(id => makeCard(id)) });
    ctx.G = state;
    const ectx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
      gameState: state, controller: 'me', cardId: handIdList[0],
      sourceZone: 'hand', sourceIndex: 0, source: { controller: 'me', zone: 'hand', index: 0 },
    });
    return { state, ectx };
  }
  const graveIds = state => state.myGrave.map(c => c.id);
  const handIds = state => state.myHand.map(c => c.id);

  // 1) picker 부재 → 첫 후보 자동 (비-로컬/픽커 없음 안전 동작 보존)
  {
    delete ctx.openCardPicker;
    const { state, ectx } = makeEctx(['A', 'B', 'C', 'D']);
    const r = PENGUIN.requestHandDiscard(ectx, { count: 1, reason: 'test-auto' });
    assert(r.ok, 'auto discard should succeed');
    assertEqual(state.myGrave.length, 1, 'auto: exactly one discarded');
    assertEqual(graveIds(state)[0], 'A', 'auto: first card discarded when no picker');
  }

  // 2) picker가 3번째(C)를 고름 → C가 버려지고 A/B/D는 남음 (★ 핵심 버그 수정)
  {
    let pickerSawCount = -1;
    ctx.openCardPicker = function (cards, title, maxPick, cb) { pickerSawCount = cards.length; cb([2]); };
    const { state, ectx } = makeEctx(['A', 'B', 'C', 'D']);
    const r = PENGUIN.requestHandDiscard(ectx, { count: 1, reason: 'test-pick' });
    assertEqual(r.deferred, true, 'picker path returns deferred');
    assertEqual(pickerSawCount, 4, 'picker shows all 4 hand cards');
    assertEqual(state.myGrave.length, 1, 'pick: exactly one discarded');
    assertEqual(graveIds(state)[0], 'C', 'pick: chosen 3rd card discarded, NOT first');
    assertEqual(handIds(state).join(','), 'A,B,D', 'pick: A,B,D remain in hand');
    delete ctx.openCardPicker;
  }

  // 3) 사전 선택(ctx.selectedCards) 우선 → D가 버려짐
  {
    delete ctx.openCardPicker;
    const { state, ectx } = makeEctx(['A', 'B', 'C', 'D']);
    ectx.selectedCards = [{ id: 'D', name: 'D' }];
    const r = PENGUIN.requestHandDiscard(ectx, { count: 1, reason: 'test-pre' });
    assert(r.ok, 'preselected discard should succeed');
    assertEqual(graveIds(state)[0], 'D', 'preselected card discarded');
  }

  // 4) excludeCardId 는 후보에서 제외 (A 제외 → 첫 적격 후보 B)
  {
    delete ctx.openCardPicker;
    const { state, ectx } = makeEctx(['A', 'B', 'C']);
    const r = PENGUIN.requestHandDiscard(ectx, { count: 1, excludeCardId: 'A', reason: 'test-exclude' });
    assert(r.ok, 'exclude discard should succeed');
    assertEqual(graveIds(state)[0], 'B', 'excluded A not discarded; first eligible (B) discarded');
  }

  // 5) count=2 picker → 고른 2장(A,D)이 버려짐
  {
    ctx.openCardPicker = function (cards, title, maxPick, cb) { cb([0, 3]); };
    const { state, ectx } = makeEctx(['A', 'B', 'C', 'D']);
    const r = PENGUIN.requestHandDiscard(ectx, { count: 2, reason: 'test-two' });
    assertEqual(r.deferred, true, 'count2 picker deferred');
    assertEqual(state.myGrave.length, 2, 'two cards discarded');
    assertEqual(graveIds(state).slice().sort().join(','), 'A,D', 'chosen A and D discarded');
    delete ctx.openCardPicker;
  }

  // 6) 빈 패 → 실패(우아하게)
  {
    delete ctx.openCardPicker;
    const { state, ectx } = makeEctx([]);
    const r = PENGUIN.requestHandDiscard(ectx, { count: 1, reason: 'test-empty' });
    assertEqual(r.ok, false, 'empty hand: discard reports not-ok');
    assertEqual(state.myGrave.length, 0, 'empty hand: nothing discarded');
  }

  // 7) sync:true → picker가 있어도 동기 첫 후보 (각성의 군단 등 동기 루프 안전)
  {
    ctx.openCardPicker = function (cards, title, maxPick, cb) { cb([2]); };
    const { state, ectx } = makeEctx(['A', 'B', 'C', 'D']);
    const r = PENGUIN.requestHandDiscard(ectx, { count: 1, sync: true, reason: 'test-sync' });
    assert(r.ok, 'sync discard ok');
    assertEqual(r.deferred, undefined, 'sync path is not deferred');
    assertEqual(graveIds(state)[0], 'A', 'sync: first card discarded immediately despite picker');
    assertEqual(state.myHand.length, 3, 'sync: hand reduced immediately (loop-safe)');
    delete ctx.openCardPicker;
  }
};
