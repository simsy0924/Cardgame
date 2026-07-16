// HAND BATTLE — explicit player-choice rules for migrated card effects.
// Theme files keep the actual effect resolution; this module supplies the
// pre-activation choice plans consumed by effect-ui.
(function initEffectChoiceRules(global) {
  'use strict';

  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  const rules = global.HB_RULES || {};
  const ZONES = rules.ZONES || {
    DECK: 'deck',
    HAND: 'hand',
    PUBLIC_HAND: 'publicHand',
    FIELD: 'field',
    FIELD_ZONE: 'fieldZone',
    GRAVE: 'grave',
    EXILE: 'exile',
  };
  const CONTROLLERS = rules.CONTROLLERS || { ME: 'me', OPPONENT: 'opponent' };

  if (!registry || !zoneAccess) {
    throw new Error('[effect-choice-rules] 효과 레지스트리와 존 접근 엔진이 필요합니다.');
  }

  function normalizeController(controller) {
    try { return zoneAccess.normalizeController(controller || CONTROLLERS.ME); }
    catch (_) { return controller === CONTROLLERS.OPPONENT ? CONTROLLERS.OPPONENT : CONTROLLERS.ME; }
  }

  function opponentOf(controller) {
    return normalizeController(controller) === CONTROLLERS.ME
      ? CONTROLLERS.OPPONENT
      : CONTROLLERS.ME;
  }

  function zone(ctx, controller, zoneName) {
    return zoneAccess.getZoneArray(ctx.gameState, normalizeController(controller), zoneName);
  }

  function getCards() {
    // eslint-disable-next-line no-undef
    if (typeof CARDS !== 'undefined' && CARDS) return CARDS;
    return global.CARDS || {};
  }

  function getCardId(card) {
    if (!card) return '';
    if (typeof card === 'string') return card;
    return card.id || card.cardId || '';
  }

  function cardDef(card) {
    return getCards()[getCardId(card)] || null;
  }

  function cardName(card) {
    const def = cardDef(card);
    return (card && card.name) || (def && def.name) || getCardId(card) || '카드';
  }

  function isMonster(card) {
    const def = cardDef(card);
    return !!(def && def.cardType === 'monster');
  }

  function isTheme(card, theme) {
    const def = cardDef(card);
    return !!(def && def.theme === theme);
  }

  function isThemeMonster(card, theme) {
    return isTheme(card, theme) && isMonster(card);
  }

  function group(key, title, candidates, options) {
    return Object.assign({
      key,
      title,
      candidates: candidates || [],
      count: 1,
      forced: true,
    }, options || {});
  }

  function replaceCollectChoices(effectId, collectChoices) {
    const effect = registry.getEffectById(effectId);
    if (!effect) {
      console.warn('[effect-choice-rules] 효과를 찾지 못했습니다:', effectId);
      return false;
    }
    registry.registerEffect(Object.assign({}, effect, { collectChoices }), { replace: true });
    return true;
  }

  // ── 서커스메어 ────────────────────────────────────────────
  replaceCollectChoices('cm-med-wolf-2-boost-other', ctx => ({
    groups: [group(
      'target',
      '공격력을 올릴 다른 서커스메어 몬스터 선택',
      zone(ctx, ctx.controller, ZONES.FIELD)
        .filter(card => isThemeMonster(card, '서커스메어') && getCardId(card) !== '서커스메어 메드 울프')
    )],
  }));

  replaceCollectChoices('cm-med-bear-2-deck-summon', ctx => ({
    groups: [group(
      'summon',
      '덱에서 소환할 서커스메어 몬스터 선택',
      zone(ctx, ctx.controller, ZONES.DECK).filter(card => isThemeMonster(card, '서커스메어'))
    )],
  }));

  replaceCollectChoices('cm-med-chimera-2-quick-attack-gain', ctx => ({
    groups: [group(
      'reference',
      '원래 공격력을 참조할 서커스메어 몬스터 선택',
      zone(ctx, ctx.controller, ZONES.FIELD).filter(card => isThemeMonster(card, '서커스메어'))
    )],
  }));

  replaceCollectChoices('cm-coin-jester-2-field-coin', ctx => {
    const candidates = zone(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(isMonster);
    return candidates.length
      ? { groups: [group('headsTarget', '앞면일 경우 무효화할 상대 몬스터 선택', candidates)] }
      : null;
  });

  replaceCollectChoices('cm-mask-jester-2-name-change-negate', ctx => ({
    groups: [group(
      'target',
      '이름을 바꾸고 효과를 무효화할 상대 몬스터 선택',
      zone(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(isMonster)
    )],
  }));

  replaceCollectChoices('cm-nightmare-circus-2-field-search', ctx => ({
    groups: [group(
      'search',
      '패에 넣을 서커스메어 카드 선택',
      zone(ctx, ctx.controller, ZONES.DECK).filter(card => isTheme(card, '서커스메어'))
    )],
  }));

  // ── 엘리멘츠 ──────────────────────────────────────────────
  replaceCollectChoices('elements-rainbow-3-grave-recover', ctx => ({
    groups: [group(
      'recover',
      '패에 넣을 다른 엘리멘츠 카드 선택',
      zone(ctx, ctx.controller, ZONES.GRAVE)
        .filter(card => isTheme(card, '엘리멘츠') && getCardId(card) !== '엘리멘츠 in rainbow forest')
    )],
  }));

  replaceCollectChoices('elements-magic-1-banish-send', ctx => {
    const candidates = zone(ctx, ctx.controller, ZONES.DECK).filter(card => isTheme(card, '엘리멘츠'));
    return {
      groups: [
        group('banishCost', '제외할 엘리멘츠 카드 선택', candidates),
        Object.assign(group('sendToGrave', '묘지로 보낼 다른 엘리멘츠 카드 선택', []), {
          collect(_choiceCtx, selectedCards) {
            const first = selectedCards[0];
            return candidates.filter(card => {
              if (first && first._iid && card._iid) return first._iid !== card._iid;
              return getCardId(first) !== getCardId(card);
            });
          },
        }),
      ],
    };
  });

  replaceCollectChoices('elements-suits-1-quick-deck-summon-counter-all', ctx => ({
    groups: [group(
      'summon',
      '덱에서 소환할 엘리멘츠 몬스터 선택',
      zone(ctx, ctx.controller, ZONES.DECK).filter(card => isThemeMonster(card, '엘리멘츠'))
    )],
  }));

  replaceCollectChoices('elements-magic-card-1-recover-then-deck-summon-counter', ctx => {
    const recover = zone(ctx, ctx.controller, ZONES.GRAVE)
      .map(card => ({ c: card, z: ZONES.GRAVE, id: card._iid || getCardId(card), name: `${cardName(card)} (묘지)` }))
      .concat(zone(ctx, ctx.controller, ZONES.EXILE)
        .map(card => ({ c: card, z: ZONES.EXILE, id: card._iid || getCardId(card), name: `${cardName(card)} (제외)` })))
      .filter(entry => isTheme(entry.c, '엘리멘츠'));
    const deckMonsters = zone(ctx, ctx.controller, ZONES.DECK).filter(card => isThemeMonster(card, '엘리멘츠'));
    const opponentTargets = zone(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(Boolean);
    return {
      groups: [
        group('recover', '회수하거나 소환할 엘리멘츠 카드 선택', recover),
        group('deckSummon', '덱에서 소환할 엘리멘츠 몬스터 선택', deckMonsters),
        group('counterTarget', '카운터 2개를 놓을 상대 몬스터 선택', opponentTargets),
      ],
    };
  });

  // ── 지배자/지배룡 ─────────────────────────────────────────
  replaceCollectChoices('ruler-wind-1-hand-discard-banish-op-grave', ctx => ({
    groups: [group(
      'banish',
      '제외할 상대 묘지 카드 선택',
      zone(ctx, opponentOf(ctx.controller), ZONES.GRAVE)
    )],
  }));

  replaceCollectChoices('dragon-water-1-nonhand-grave-recover', ctx => ({
    groups: [group(
      'recover',
      '패에 넣을 지배자/지배룡 몬스터 선택',
      zone(ctx, ctx.controller, ZONES.GRAVE)
        .filter(card => isMonster(card)
          && (/지배자|지배룡/.test(getCardId(card)))
          && getCardId(card) !== '수원소의 지배룡')
    )],
  }));

  replaceCollectChoices('dragon-fire-1-nonhand-grave-negate-field', ctx => {
    const opponent = opponentOf(ctx.controller);
    const cards = zone(ctx, opponent, ZONES.FIELD).slice();
    const fieldCard = zoneAccess.getFieldZoneCard(ctx.gameState, opponent);
    if (fieldCard) cards.push(fieldCard);
    return { groups: [group('negate', '효과를 무효화할 상대 필드 카드 선택', cards)] };
  });

  replaceCollectChoices('sa-wonso-ruler-2-banish-self-revive-two', ctx => {
    const pool = zone(ctx, ctx.controller, ZONES.GRAVE).concat(zone(ctx, ctx.controller, ZONES.EXILE));
    const rulers = pool.filter(card => isMonster(card)
      && /지배자/.test(getCardId(card))
      && getCardId(card) !== '사원소의 지배자');
    const dragons = pool.filter(card => isMonster(card) && /지배룡/.test(getCardId(card)));
    const groups = [];
    if (rulers.length) groups.push(group('ruler', '소환할 지배자 몬스터 선택', rulers));
    if (dragons.length) groups.push(group('dragon', '소환할 지배룡 몬스터 선택', dragons));
    return { groups };
  });

  replaceCollectChoices('sa-wonso-ruler-3-send-op-field-discard', ctx => {
    const opponent = opponentOf(ctx.controller);
    const targets = zone(ctx, opponent, ZONES.FIELD).slice();
    const fieldCard = zoneAccess.getFieldZoneCard(ctx.gameState, opponent);
    if (fieldCard) targets.push(fieldCard);
    return {
      groups: [
        group('target', '묘지로 보낼 상대 필드 카드 선택', targets),
        group('discard', '버릴 패 1장 선택', zone(ctx, ctx.controller, ZONES.HAND)),
      ],
    };
  });

  replaceCollectChoices('ruler-spell-1-attack-phase-scale-effects', ctx => {
    // 카드 발동 코스트로 이 카드가 패를 떠난 뒤의 패 수가 실제 적용 기준이다.
    const handAfterActivation = Math.max(0, zone(ctx, ctx.controller, ZONES.HAND).length - 1);
    const groups = [
      group('ownTarget', '공격력을 2 올릴 자신 몬스터 선택', zone(ctx, ctx.controller, ZONES.FIELD).filter(isMonster)),
    ];
    if (handAfterActivation <= 3 && zone(ctx, opponentOf(ctx.controller), ZONES.FIELD).some(isMonster)) {
      groups.push(group(
        'opponentTarget',
        '공격력을 3 내릴 상대 몬스터 선택',
        zone(ctx, opponentOf(ctx.controller), ZONES.FIELD).filter(isMonster)
      ));
    }
    return { groups };
  });

  replaceCollectChoices('penguin-forever-1-bounce-fields-hand-summon', ctx => ({
    groups: [
      group('ownField', '패로 되돌릴 자신 필드 카드 선택', zone(ctx, ctx.controller, ZONES.FIELD)),
      group('opponentField', '패로 되돌릴 상대 필드 카드 선택', zone(ctx, opponentOf(ctx.controller), ZONES.FIELD)),
    ],
  }));

  // ── 마피아 ────────────────────────────────────────────────
  function mafiaState(ctx) {
    const state = ctx.gameState || {};
    state.mafiaTurnState = state.mafiaTurnState || {};
    state.mafiaTurnState.transformByCard = state.mafiaTurnState.transformByCard || {};
    return state.mafiaTurnState;
  }

  function mafiaOptionChooser(ctx, cardId) {
    const boss = zone(ctx, ctx.controller, ZONES.FIELD)
      .some(card => getCardId(card) === '대도시의 거물 마피아');
    return boss && !mafiaState(ctx).transformByCard[cardId] ? 'controller' : 'opponent';
  }

  function selectedMafiaOption(selectedCards) {
    const selected = (selectedCards || []).find(item => item && item._mafiaOption);
    return selected ? selected._mafiaOption : '';
  }

  function sameInstance(a, b) {
    if (!a || !b) return false;
    if (a._iid && b._iid) return a._iid === b._iid;
    return getCardId(a) === getCardId(b);
  }

  [
    '마피아의 제안',
    '마피아의 군림',
    '마피아의 대가',
    '마피아의 협상',
    '마피아의 명령',
    '마피아의 배신자 숙청',
    '마피아 집결',
    '마피아의 위용',
    '마피아의 위기',
  ].forEach(cardId => {
    ['1-transform', '2-draw-public-choice'].forEach(suffix => {
      const effectId = `mafia-spell-${cardId}-${suffix}`;
      if (!registry.getEffectById(effectId)) return;
      replaceCollectChoices(effectId, ctx => {
        const api = global.HB_MAFIA_EFFECTS;
        const table = api && api.getMafiaSpellOptions ? api.getMafiaSpellOptions(cardId) : null;
        const optionType = suffix.indexOf('1-') === 0 ? 'transform' : 'draw';
        const options = api && api.getResolvableMafiaOptions
          ? api.getResolvableMafiaOptions(ctx, cardId, optionType)
          : (table && table[optionType] ? table[optionType] : []);
        const groups = [group(
          'option',
          `${cardId}: 적용할 효과 선택`,
          options.map((text, index) => ({
            id: `mafia-option-${index}`,
            name: text,
            _mafiaOption: text,
          })),
          { chooser: mafiaOptionChooser(ctx, cardId), forceChoice: true }
        )];

        groups.push(Object.assign(group('ownFieldTarget', '묘지로 보낼 자신 몬스터 선택', []), {
          optional: true,
          collect(_choiceCtx, selectedCards) {
            const option = selectedMafiaOption(selectedCards);
            return option.includes('자신은 자신 필드의 몬스터를 1장')
              ? zone(ctx, ctx.controller, ZONES.FIELD).filter(isMonster)
              : [];
          },
        }));
        groups.push(Object.assign(group('opponentFieldTarget', '묘지로 보낼 상대 필드 카드 선택', []), {
          optional: true,
          collect(_choiceCtx, selectedCards) {
            const option = selectedMafiaOption(selectedCards);
            if (!option.includes('상대 필드의 카드 1장') && !option.includes('상대 필드의 몬스터 1장')) return [];
            return zone(ctx, opponentOf(ctx.controller), ZONES.FIELD)
              .filter(card => !option.includes('몬스터 1장') || isMonster(card));
          },
        }));
        groups.push(Object.assign(group('ownMafiaTarget', '공격력을 올릴 마피아 몬스터 선택', []), {
          optional: true,
          collect(_choiceCtx, selectedCards) {
            return selectedMafiaOption(selectedCards).includes("자신 필드의 '마피아'몬스터 1장")
              ? zone(ctx, ctx.controller, ZONES.FIELD).filter(card => isThemeMonster(card, '마피아'))
              : [];
          },
        }));
        groups.push(Object.assign(group('ownGraveTarget', '소환할 묘지의 마피아 몬스터 선택', []), {
          optional: true,
          collect(_choiceCtx, selectedCards) {
            return selectedMafiaOption(selectedCards).includes("자신 묘지의 '마피아'몬스터 1장")
              ? zone(ctx, ctx.controller, ZONES.GRAVE).filter(card => isThemeMonster(card, '마피아'))
              : [];
          },
        }));
        groups.push(Object.assign(group('opponentGraveTarget', '패에 넣을 묘지의 마피아 카드 선택', [], { chooser: 'opponent' }), {
          optional: true,
          collect(_choiceCtx, selectedCards) {
            return selectedMafiaOption(selectedCards).includes("상대는 묘지에서 '마피아'카드 1장")
              ? zone(ctx, opponentOf(ctx.controller), ZONES.GRAVE).filter(card => isTheme(card, '마피아'))
              : [];
          },
        }));
        groups.push(Object.assign(group('discardByDrawCount', '버릴 패 선택', []), {
          optional: true,
          count() {
            const store = global.HB_STATE_STORE;
            const drawn = store && typeof store.getDrawCount === 'function'
              ? store.getDrawCount(ctx.gameState, ctx.controller)
              : 0;
            return Math.max(1, drawn - 2);
          },
          collect(_choiceCtx, selectedCards) {
            if (!selectedMafiaOption(selectedCards).includes('이 턴에 드로우한 수 -2장 패를')) return [];
            const store = global.HB_STATE_STORE;
            const drawn = store && typeof store.getDrawCount === 'function'
              ? store.getDrawCount(ctx.gameState, ctx.controller)
              : 0;
            if (drawn <= 2) return [];
            const source = ctx.card;
            return zone(ctx, ctx.controller, ZONES.HAND).filter(card => !sameInstance(card, source));
          },
        }));
        groups.push(Object.assign(group('ownPublicDiscard', '버릴 자신의 공개 패 2장 선택', []), {
          optional: true,
          count: 2,
          collect(_choiceCtx, selectedCards) {
            return selectedMafiaOption(selectedCards).includes('서로 공개 패의 카드를 2장')
              ? zone(ctx, ctx.controller, ZONES.PUBLIC_HAND)
              : [];
          },
        }));
        groups.push(Object.assign(group('opponentPublicDiscard', '버릴 자신의 공개 패 2장 선택', [], { chooser: 'opponent' }), {
          optional: true,
          count: 2,
          collect(_choiceCtx, selectedCards) {
            return selectedMafiaOption(selectedCards).includes('서로 공개 패의 카드를 2장')
              ? zone(ctx, opponentOf(ctx.controller), ZONES.PUBLIC_HAND)
              : [];
          },
        }));
        groups.push(Object.assign(group('publicToPrivate', '일반 패로 되돌릴 공개 패 선택', [], {
          count: 2,
          forced: false,
          allowEmpty: true,
        }), {
          optional: true,
          collect(_choiceCtx, selectedCards) {
            return selectedMafiaOption(selectedCards).includes('공개 패를 2장까지 일반 패로')
              ? zone(ctx, ctx.controller, ZONES.PUBLIC_HAND)
              : [];
          },
        }));
        return { groups };
      });
    });
  });

  global.HB_EFFECT_CHOICE_RULES = Object.freeze({
    refresh() {
      return registry.getRegistryStats();
    },
  });
})(window);
