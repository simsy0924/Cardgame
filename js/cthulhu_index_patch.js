// cthulhu_index_patch.js
// 기존 index_patch.js에 크툴루 관련 UI 추가
// openCardDetail에서 크툴루 필드 카드 효과 버튼, 묘지 효과 버튼 노출
// ─────────────────────────────────────────────

// 크툴루 테마 필드 카드의 효과 버튼 매핑
const CTHULHU_FIELD_EFFECTS = {
  '그레이트 올드 원-크툴루':   [{ num: 2, label: '② [코스트→패널티] 필드 카드 묘지' }],
  '그레이트 올드 원-크투가':   [{ num: 2, label: '② [코스트→패널티] 패 몬스터 소환 → 자신 필드 묘지' }],
  '그레이트 올드 원-크아이가': [{ num: 2, label: '②③ [코스트→패널티] 상대 필드 묘지 → 패 버리기' }],
  '그레이트 올드 원-과타노차': [{ num: 2, label: '② [코스트→효과] 이 카드+상대 묘지 → GOO 소환' }],
  '엘더 갓-노덴스':           [{ num: 2, label: '② [코스트→효과] 묘지 GOO 제외 → 덱 GOO 묘지' }],
  '엘더 갓-크타니트':         [
    { num: 2, label: '② [효과+패널티] 상대 패 버리기 → 드로우' },
    { num: 3, label: '③ [코스트→선택] 상대 덱 제외 → 서로 몬스터 소환' },
  ],
  '엘더 갓-히프노스':         [{ num: 3, label: '③ [효과] 묘지 몬스터 소환 (공격 단계)' }],
  '아우터 갓 니알라토텝':     [{ num: 2, label: '② [효과] 상대 몬스터 무효 + 정보 획득' }],
  '아우터 갓-아자토스':       [{ num: 3, label: '③ [코스트→패널티] 필드 무효 → 서로 제외' }],
  '아우터 갓 슈브 니구라스':  [{ num: 2, label: '② [코스트→효과] 엘더 갓 제외 → 상대 효과 무효' }],
};

// ─────────────────────────────────────────────
// 아자토스 절대 내성 — opFieldRemove/opFieldExile 수신 측 차단
// 상대가 내 아자토스를 제거하려 할 때 무시
// ─────────────────────────────────────────────
(function _patchAzathothImmunityOnReceive() {
  const _orig = typeof handleOpponentAction === 'function' ? handleOpponentAction : null;
  if (!_orig) return;
  handleOpponentAction = function (action) {
    if ((action.type === 'opFieldRemove' || action.type === 'opFieldExile') &&
        action.cardId === '아우터 갓-아자토스' &&
        G.myField.some(m => m.id === '아우터 갓-아자토스')) {
      log('아자토스 ①: 다른 카드의 효과를 받지 않음 — 제거 무효!', 'opponent');
      notify('아우터 갓-아자토스는 다른 카드의 효과를 받지 않습니다.');
      return;
    }
    _orig.apply(this, arguments);
  };
})();

// 크툴루 테마 묘지 효과 카드
const CTHULHU_GRAVE_EFFECT_CARDS = new Set([
  '그레이트 올드 원-크아이가',
  '엘더 갓-노덴스',
  '올드_원의 멸망',
]);

// 제외 존 트리거 카드 (제외 뷰어에서 버튼 노출)
const CTHULHU_EXILE_TRIGGER_CARDS = new Set([
  '엘더 갓-노덴스',
  '엘더 갓-히프노스',
  '엘더 갓-크타니트',
]);

(function _patchCthulhuOpenCardDetail() {
  const _orig = typeof openCardDetail === 'function' ? openCardDetail : null;
  if (!_orig) return;

  openCardDetail = function (cardId, handIdx, isOpCard, fieldIdx) {
    _orig.apply(this, arguments);
    if (isOpCard) return;

    const card = CARDS[cardId];
    if (!card) return;
    const isCthulhuTheme = ['크툴루', '올드원', '올드 원'].includes(card.theme);
    if (!isCthulhuTheme) return;

    const actions = document.getElementById('mdCardActions');
    if (!actions) return;

    // ── 필드에서 열린 경우 → 필드 효과 버튼 추가
    if (typeof fieldIdx === 'number' && fieldIdx >= 0) {
      const buttons = CTHULHU_FIELD_EFFECTS[cardId];
      if (!buttons) return;
      buttons.forEach(({ num, label }) => {
        if (actions.querySelector(`[data-cthulhu-field="${cardId}-${num}"]`)) return;
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.dataset.cthulhuField = `${cardId}-${num}`;
        btn.textContent = label;
        btn.onclick = () => {
          closeModal('cardDetailModal');
          if (typeof activateCthulhuFieldEffect === 'function') activateCthulhuFieldEffect(fieldIdx, num);
        };
        const closeBtn = [...actions.querySelectorAll('button')].find(b => b.textContent === '닫기');
        if (closeBtn) actions.insertBefore(btn, closeBtn);
        else actions.appendChild(btn);
      });
    }
  };
})();

// 묘지 뷰어에서 크툴루 묘지 효과 버튼 추가
(function _patchCthulhuShowZone() {
  const _orig = typeof showZone === 'function' ? showZone : null;
  if (!_orig) return;

  showZone = function (zoneKey) {
    _orig.apply(this, arguments);

    if (zoneKey === 'myGrave') {
      const grid = document.getElementById('zoneViewGrid');
      if (!grid) return;
      const wrappers = grid.querySelectorAll('div');
      G.myGrave.forEach((c, idx) => {
        if (!CTHULHU_GRAVE_EFFECT_CARDS.has(c.id)) return;
        const wrapper = wrappers[idx];
        if (!wrapper || wrapper.querySelector('.cthulhu-grave-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'btn-sm cthulhu-grave-btn';
        btn.textContent = '묘지 효과';
        btn.onclick = () => {
          closeModal('zoneViewModal');
          if (typeof activateCthulhuGraveEffect === 'function') activateCthulhuGraveEffect(c.id);
        };
        wrapper.appendChild(btn);
      });
    }

    // 제외 존에서 엘더 갓 트리거 버튼
    if (zoneKey === 'myExile') {
      const grid = document.getElementById('zoneViewGrid');
      if (!grid) return;
      const wrappers = grid.querySelectorAll('div');
      G.myExile.forEach((c, idx) => {
        if (!CTHULHU_EXILE_TRIGGER_CARDS.has(c.id)) return;
        const wrapper = wrappers[idx];
        if (!wrapper || wrapper.querySelector('.cthulhu-exile-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'btn-sm cthulhu-exile-btn';
        btn.textContent = '제외 트리거';
        btn.onclick = () => {
          closeModal('zoneViewModal');
          // 각 카드별 제외 트리거 함수 직접 호출
          if (c.id === '엘더 갓-노덴스'   && typeof activateNodens1   === 'function') activateNodens1('exile');
          if (c.id === '엘더 갓-히프노스'  && typeof activateHypnos1  === 'function') activateHypnos1();
          if (c.id === '엘더 갓-크타니트'  && typeof activateKthanid1 === 'function') activateKthanid1('exile');
        };
        wrapper.appendChild(btn);
      });
    }

    // 태평양 속 르뤼에 필드 마법 효과
    if (zoneKey === 'myFieldZone') return; // viewFieldCard에서 처리
  };
})();

// 태평양 속 르뤼에 필드 존 효과 버튼 추가 (viewFieldCard 후킹)
(function _patchRlyehFieldCard() {
  const _orig = typeof viewFieldCard === 'function' ? viewFieldCard : null;
  if (!_orig) return;
  viewFieldCard = function (who) {
    _orig.apply(this, arguments);
    if (who !== 'me') return;
    if (!G.myFieldCard || G.myFieldCard.id !== '태평양 속 르뤼에') return;
    const actions = document.getElementById('mdCardActions');
    if (!actions || actions.querySelector('.rlyeh-btn')) return;

    const btn1 = document.createElement('button');
    btn1.className = 'btn btn-primary rlyeh-btn';
    btn1.textContent = '① GOO 묘지에서 소환';
    btn1.onclick = () => { closeModal('cardDetailModal'); activateRlyeh1(); };

    const btn2 = document.createElement('button');
    btn2.className = 'btn btn-secondary rlyeh-btn';
    btn2.textContent = '② 묘지 GOO 패로 + 엘더 갓 제외';
    btn2.onclick = () => { closeModal('cardDetailModal'); activateRlyeh2(); };

    const closeBtn = [...actions.querySelectorAll('button')].find(b => b.textContent === '닫기');
    if (closeBtn) { actions.insertBefore(btn2, closeBtn); actions.insertBefore(btn1, btn2); }
    else { actions.appendChild(btn1); actions.appendChild(btn2); }
  };
})();

// 덱빌더 프리셋 추가 (loadPreset 후킹에 크툴루 추가)
(function _patchCthulhuPreset() {
  const _orig = typeof loadPreset === 'function' ? loadPreset : null;
  if (!_orig) return;
  loadPreset = function (theme) {
    if (theme === '크툴루' || theme === '올드원') {
      // 메인 40장
      builderMainDeck = {
        '그레이트 올드 원-크툴루':   4,
        '그레이트 올드 원-크투가':   4,
        '그레이트 올드 원-크아이가': 4,
        '그레이트 올드 원-과타노차': 4,
        '엘더 갓-노덴스':           4,
        '엘더 갓-크타니트':         4,
        '엘더 갓-히프노스':         4,
        '올드_원의 멸망':           4,
        '눈에는 눈':                2,
        '구사일생':                 2,
        '출입통제':                 2,
        '유혹의 황금사과':          2,
      };
      builderKeyDeck = {
        '아우터 갓 니알라토텝':     1,
        '아우터 갓-아자토스':       1,
        '아우터 갓 슈브 니구라스':  1,
        '일격필살':                 1,
        '단 한번의 기회':           1,
      };
      notify('크툴루/올드원 기본 덱 로드! (메인 40장)');
      renderBuilderDeck();
      filterDeckPool(currentPoolFilter);
    } else {
      _orig(theme);
    }
  };
})();
