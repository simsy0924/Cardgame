// index_patch.js
// index.html의 openCardDetail, showZone, viewFieldCard 함수 패치
// lion/tiger/liger 관련 UI 버그 5가지 수정
// ─────────────────────────────────────────────

// ① 패 메뉴 — activateThemeCardEffectFromHand → activateRegisteredThemeCardEffect 교체
// openCardDetail 내부에서 테마 카드 버튼을 만드는 부분을 후킹
// 원본 코드에서 ['크툴루','올드 원','올드원','라이온','타이거','라이거','마피아','불가사의'] 체크 후
// activateThemeCardEffectFromHand를 직접 호출하는 부분을 교체

(function _patchOpenCardDetail() {
  const _orig = typeof openCardDetail === 'function' ? openCardDetail : null;
  if (!_orig) { console.warn('index_patch: openCardDetail not found'); return; }

  openCardDetail = function (cardId, handIdx, isOpCard, fieldIdx) {
    // 원본 함수 호출 후 버튼만 교체하는 방식은 DOM 타이밍이 불안정하므로,
    // 테마 카드에 한해서만 원본을 호출하기 전에 가로채서 올바른 버튼을 붙임.
    // 그런데 openCardDetail 전체를 복제하기엔 너무 크므로,
    // 원본을 그대로 호출한 뒤 모달이 열리면 버튼을 교체하는 방식을 사용.
    _orig.apply(this, arguments);

    // 원본 호출 직후, 모달 액션 영역에서 잘못된 버튼 교체
    // 대상: 패에서 열린 내 카드(handIdx >= 0)이고 라이온/타이거/라이거 테마인 경우
    if (typeof handIdx !== 'number' || handIdx < 0) return;
    if (isOpCard) return;

    const card = CARDS[cardId];
    if (!card) return;
    const THEME_LIST = ['라이온', '타이거', '라이거', '크툴루', '올드 원', '올드원', '마피아', '불가사의'];
    if (!THEME_LIST.includes(card.theme)) return;

    // 핸들러가 등록된 테마만 교체 (등록 안 된 건 원본 버튼 그대로)
    const handler = window.THEME_EFFECT_HANDLERS?.[card.theme];
    if (!handler || typeof handler.activateFromHand !== 'function') return;

    // 모달 액션 영역에서 ①②③ 버튼을 찾아 콜백을 교체
    const actions = document.getElementById('mdCardActions');
    if (!actions) return;

    const effectText = card.effects || '';
    const buttons = actions.querySelectorAll('button');
    buttons.forEach(btn => {
      const txt = btn.textContent.trim();
      if (txt === '① 효과 발동') {
        btn.onclick = () => { closeModal('cardDetailModal'); handler.activateFromHand(handIdx, 1); };
      } else if (txt === '② 효과 발동') {
        btn.onclick = () => { closeModal('cardDetailModal'); handler.activateFromHand(handIdx, 2); };
      } else if (txt === '③ 효과 발동') {
        btn.onclick = () => { closeModal('cardDetailModal'); handler.activateFromHand(handIdx, 3); };
      }
    });

    // 타이거 킹 ③ — 필드에서 열렸을 때 (fieldIdx >= 0)
    if (typeof fieldIdx === 'number' && fieldIdx >= 0) {
      const mon = G.myField[fieldIdx];
      if (!mon) return;
      if (mon.id === '타이거 킹' && canUseEffect('타이거 킹', 3)) {
        const btn3 = document.createElement('button');
        btn3.className = 'btn btn-secondary';
        btn3.textContent = '③ 상대 필드 2장 제외';
        btn3.onclick = () => { closeModal('cardDetailModal'); activateTigerKing3(); };
        const closeBtn = actions.querySelector('.btn-secondary');
        if (closeBtn) actions.insertBefore(btn3, closeBtn);
        else actions.appendChild(btn3);
      }
      if (mon.id === '라이거 킹' && canUseEffect('라이거 킹', 3)) {
        const btn3 = document.createElement('button');
        btn3.className = 'btn btn-secondary';
        btn3.textContent = '③ 상대 필드 전부 제외';
        btn3.onclick = () => { closeModal('cardDetailModal'); activateLigerKing3(); };
        const closeBtn = actions.querySelector('.btn-secondary');
        if (closeBtn) actions.insertBefore(btn3, closeBtn);
        else actions.appendChild(btn3);
      }
    }
  };
})();

// ② 묘지 뷰어 — 라이온/타이거/라이거 묘지 효과 버튼 추가
(function _patchShowZone() {
  const _orig = typeof showZone === 'function' ? showZone : null;
  if (!_orig) { console.warn('index_patch: showZone not found'); return; }

  // 테마별 묘지 효과 카드 목록
  const LION_GRAVE_CARDS   = new Set(['에이스 라이온', '라이온 킹']);
  const TIGER_GRAVE_CARDS  = new Set(['에이스 타이거', '타이거 킹']);
  const LIGER_GRAVE_CARDS  = new Set(['에이스 라이거', '라이거 킹']);
  const ALL_GRAVE_EFFECT_CARDS = new Set([
    ...LION_GRAVE_CARDS, ...TIGER_GRAVE_CARDS, ...LIGER_GRAVE_CARDS
  ]);

  showZone = function (zoneKey) {
    _orig.apply(this, arguments);

    // 내 묘지가 아니면 패스
    if (zoneKey !== 'myGrave') return;

    const grid = document.getElementById('zoneViewGrid');
    if (!grid) return;

    // 이미 렌더된 wrapper 목록을 순회하며 효과 버튼 추가
    // 원본이 카드 id를 wrapper 안의 카드 엘리먼트에 직접 저장하지 않으므로,
    // 묘지 배열과 DOM 순서가 일치함을 이용
    const wrappers = grid.querySelectorAll('div');
    G.myGrave.forEach((c, idx) => {
      if (!ALL_GRAVE_EFFECT_CARDS.has(c.id)) return;
      const wrapper = wrappers[idx];
      if (!wrapper) return;

      // 이미 버튼이 추가됐으면 스킵
      if (wrapper.querySelector('.grave-effect-btn')) return;

      const btn = document.createElement('button');
      btn.className = 'btn-sm grave-effect-btn';
      btn.textContent = '효과 발동';
      btn.onclick = () => {
        closeModal('zoneViewModal');
        const theme = CARDS[c.id]?.theme;
        const handler = window.THEME_EFFECT_HANDLERS?.[theme];
        if (handler && typeof handler.activateGraveEffect === 'function') {
          handler.activateGraveEffect(c.id);
        } else {
          activateGraveEffect(c.id);
        }
      };
      wrapper.appendChild(btn);
    });
  };
})();

// ③ 필드 존 클릭 — 모두의 자연 효과 발동 버튼
(function _patchViewFieldCard() {
  const _orig = typeof viewFieldCard === 'function' ? viewFieldCard : null;
  if (!_orig) { console.warn('index_patch: viewFieldCard not found'); return; }

  viewFieldCard = function (who) {
    _orig.apply(this, arguments);

    // 내 필드 카드이고 모두의 자연인 경우에만 버튼 추가
    if (who !== 'me') return;
    if (!G.myFieldCard || G.myFieldCard.id !== '모두의 자연') return;

    const actions = document.getElementById('mdCardActions');
    if (!actions) return;
    if (actions.querySelector('.modu-btn')) return; // 중복 방지

    const btn1 = document.createElement('button');
    btn1.className = 'btn btn-primary modu-btn';
    btn1.textContent = '① 라이거 카드 회수';
    btn1.onclick = () => { closeModal('cardDetailModal'); activateModuJayeon1(); };

    const btn2 = document.createElement('button');
    btn2.className = 'btn btn-secondary modu-btn';
    btn2.textContent = '② 묻고 함정 서치';
    btn2.onclick = () => { closeModal('cardDetailModal'); activateModuJayeon2(); };

    const closeBtn = actions.querySelector('.btn-secondary');
    if (closeBtn) {
      actions.insertBefore(btn2, closeBtn);
      actions.insertBefore(btn1, btn2);
    } else {
      actions.appendChild(btn1);
      actions.appendChild(btn2);
    }
  };
})();
