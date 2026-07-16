const {
  createContext,
  loadAllEffects,
  makeCard,
  makeState,
  assert,
  assertEqual,
} = require('./_setup');

module.exports = function runChoiceFlowTests() {
  const ctx = loadAllEffects(createContext());

  // 여러 선택 그룹은 순서대로 고른 뒤 하나의 selectedCards 배열로 해결 컨텍스트에 전달한다.
  let groupedSelection = null;
  const groupedEffect = ctx.HB_EFFECT_REGISTRY.registerEffect({
    id: 'test-grouped-choice',
    cardId: '펭귄 마을',
    type: 'activation',
    zones: ['fieldZone'],
    condition: () => true,
    canResolve: () => true,
    collectChoices: () => ({
      groups: [
        { key: 'first', title: '첫 선택', candidates: [makeCard('A'), makeCard('B')], count: 1, forced: true },
        { key: 'second', title: '둘째 선택', candidates: [makeCard('C'), makeCard('D')], count: 1, forced: true },
      ],
    }),
    resolve(effectCtx) {
      groupedSelection = effectCtx.selectedCards.map(card => card.id);
      return { ok: true };
    },
  });
  const fieldState = makeState({ myFieldCard: makeCard('펭귄 마을') });
  ctx.G = fieldState;
  ctx.currentPhase = 'deploy';
  ctx.openCardPicker = (_cards, _title, _count, done) => done([1]);
  const fieldEntry = {
    effect: groupedEffect,
    ctx: ctx.HB_EFFECT_CONTEXT.createEffectContext({
      gameState: fieldState,
      controller: 'me',
      cardId: '펭귄 마을',
      sourceZone: 'fieldZone',
      source: { controller: 'me', zone: 'fieldZone', index: null },
      effect: groupedEffect,
    }),
  };
  const grouped = ctx.HB_EFFECT_UI.activateAvailableEffect(fieldEntry, { resolveImmediately: true });
  assert(grouped.ok, `grouped field-zone choice failed: ${grouped.error}`);
  assertEqual((groupedSelection || []).join(','), 'B,D', 'field-zone resolve must receive every grouped choice');

  // 상대 선택 그룹은 Firebase 선택 요청 경로를 사용하고 응답 인덱스를 원래 후보로 복원한다.
  let requested = null;
  let remotePicked = null;
  ctx.HB_NETWORK_SYNC = {
    hasNetworkRoom: () => true,
    requestOpponentChoice(request) {
      requested = request;
      return {
        then(callback) {
          callback({ ok: true, selectedIndices: [1] });
          return { catch() {} };
        },
      };
    },
  };
  const remoteEffect = {
    id: 'test-remote-choice',
    cardId: '마피아의 제안',
    collectChoices: () => ({
      groups: [{
        chooser: 'opponent',
        title: '상대 선택',
        candidates: [makeCard('선택1'), makeCard('선택2')],
        count: 1,
        forced: true,
      }],
    }),
  };
  const remoteCtx = ctx.HB_EFFECT_CONTEXT.createEffectContext({
    gameState: makeState(),
    controller: 'me',
    effect: remoteEffect,
    cardId: remoteEffect.cardId,
  });
  const remoteResult = ctx.HB_EFFECT_UI.requestPickerAndProceed(
    { effect: remoteEffect, ctx: remoteCtx },
    {},
    finalOptions => {
      remotePicked = finalOptions.selectedCards.map(card => card.id);
      return { ok: true };
    }
  );
  assert(remoteResult.ok && remoteResult.remoteChoice, 'opponent choice should defer through network request');
  assert(requested && requested.effectId === remoteEffect.id, 'remote request must identify the effect');
  assertEqual((remotePicked || []).join(','), '선택2', 'remote response index must restore the chosen candidate');

  // 덱→패 드로우는 addedToHand와 별도로 draw 이벤트와 턴 통계를 남긴다.
  const drawState = makeState({ myDeck: [makeCard('마피아의 제안')] });
  const drawResult = ctx.HB_CARD_MOVE.addToHand({
    gameState: drawState,
    controller: 'me',
    cardId: '마피아의 제안',
    from: { controller: 'me', zone: 'deck', index: 0 },
    reason: 'testDraw',
  });
  assert(drawResult.ok, `draw move failed: ${drawResult.error}`);
  assert(drawResult.events.some(event => event.type === 'draw'), 'draw move must emit a draw event');
  assertEqual(ctx.HB_STATE_STORE.getDrawCount(drawState, 'me'), 1, 'draw move must increment turn draw count');
};
