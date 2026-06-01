// ui.js — UI 렌더링, 모달, 카드 픽커, 덱 빌더

// ─────────────────────────────────────────────
// 이미지 캐시 — 성능 최적화 (A+B+C 방법 통합)
//   _imgCache  : cardId → 로드 성공한 src
//   _imgFailed : 모든 후보가 실패한 cardId 집합
// ─────────────────────────────────────────────
const _imgCache  = new Map();
const _imgFailed = new Set();

/**
 * 덱(배열)의 카드 이미지를 백그라운드에서 미리 로드합니다.
 * 게임 시작 시 호출하면 게임 중 첫 표시가 즉시 됩니다.
 */
function preloadDeckImages(deck) {
  if (!Array.isArray(deck)) return;
  deck.forEach(card => {
    const id = card.id || card;
    if (!id || _imgCache.has(id) || _imgFailed.has(id)) return;
    const cardData = CARDS[id] || {};
    const candidates = resolveCardImageCandidates(id, cardData);
    if (!candidates.length) { _imgFailed.add(id); return; }
    let idx = 0;
    const img = new Image();
    img.onload  = () => { _imgCache.set(id, img.src); };
    img.onerror = () => {
      idx++;
      if (idx < candidates.length) { img.src = candidates[idx]; }
      else { _imgFailed.add(id); }
    };
    img.src = candidates[0];
  });
}

// CARD RENDERING
// ─────────────────────────────────────────────
function renderCard(cardData, opts = {}) {
  // cardData: {id, name, isPublic?, atk?}
  const card = CARDS[cardData.id] || { name: cardData.name, cardType: 'normal', effects: '' };
  const el = document.createElement('div');
  el.className = 'card' + (cardData.isPublic ? ' public-card' : '') + (opts.selected ? ' selected' : '');

  const showFallbackUI = () => {
    if (el.dataset.fallbackShown === '1') return;
    el.dataset.fallbackShown = '1';

    const color = CARD_TYPE_COLOR[card.cardType] || '#555';
    const typeBar = document.createElement('div');
    typeBar.className = 'card-type-bar';
    typeBar.style.background = color;
    el.appendChild(typeBar);

    const body = document.createElement('div');
    body.className = 'card-body';
    const typeLabel = document.createElement('div');
    typeLabel.className = 'card-type-label';
    typeLabel.textContent = CARD_TYPE_LABEL[card.cardType] || '';
    const nameEl2 = document.createElement('div');
    nameEl2.className = 'card-name';
    nameEl2.textContent = card.name;
    body.appendChild(typeLabel);
    body.appendChild(nameEl2);
    el.appendChild(body);

    if (card.cardType === 'monster' && card.atk !== undefined) {
      const atk = document.createElement('div');
      atk.className = 'card-atk';
      atk.textContent = `ATK ${card.atk}`;
      el.appendChild(atk);
    }
  };

  const imageCandidates = resolveCardImageCandidates(cardData.id, card);
  if (imageCandidates.length > 0 && !_imgFailed.has(cardData.id)) {
    const artWrap = document.createElement('div');
    artWrap.className = 'card-art-wrap';
    const art = document.createElement('img');
    art.className = 'card-art';
    art.alt = `${card.name} 일러스트`;
    art.loading = 'lazy';
    art.decoding = 'async';

    if (_imgCache.has(cardData.id)) {
      // ✅ 캐시 히트 — 즉시 표시
      art.src = _imgCache.get(cardData.id);
    } else {
      // 첫 로드 — 순차 후보 시도 후 캐시에 저장
      let idx = 0;
      art.src = imageCandidates[idx];
      art.onload = () => {
        _imgCache.set(cardData.id, art.src); // ✅ 성공한 src 기록
      };
      art.onerror = () => {
        idx += 1;
        if (idx < imageCandidates.length) {
          art.src = imageCandidates[idx];
        } else {
          // ✅ 모든 후보 실패 — 이후 즉시 fallback
          _imgFailed.add(cardData.id);
          artWrap.remove();
          el.classList.remove('has-art');
          showFallbackUI();
        }
      };
    }

    artWrap.appendChild(art);
    el.appendChild(artWrap);
    el.classList.add('has-art');
  } else {
    showFallbackUI();
  }

  return el;
}

function resolveCardImageCandidates(cardId, card) {
  const candidates = [];
  const pushIfSafe = (rawSrc) => {
    const safeSrc = sanitizeCardImageSrc(rawSrc);
    if (rawSrc && !safeSrc) console.warn('[card-art] blocked unsafe image src:', rawSrc);
    if (safeSrc && !candidates.includes(safeSrc)) candidates.push(safeSrc);
  };

  pushIfSafe(card?.image);
  pushIfSafe(window.CARD_IMAGE_MAP && window.CARD_IMAGE_MAP[cardId]);

  // 파일명을 "카드명 그대로" 쓸 수 있도록 기본 경로 자동 후보 생성
  // 예: /js/assets/cards/펭귄 용사.png
  const base = `js/assets/cards/${cardId}`;
  ['png', 'webp', 'jpg'].forEach(ext => {  // 실제 사용 확장자만 (성능 최적화)
    pushIfSafe(`${base}.${ext}`);
  });
  return candidates;
}

function sanitizeCardImageSrc(rawSrc) {
  if (typeof rawSrc !== 'string') return '';
  const trimmed = rawSrc.trim();
  if (!trimmed) return '';

  // 외부 URL / data: / javascript: 스킴 차단 + 같은 오리진만 허용
  let parsed;
  try {
    parsed = new URL(trimmed, window.location.href);
  } catch {
    return '';
  }
  if (parsed.origin !== window.location.origin) return '';
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';

  // 카드 이미지는 현재 앱 기준 경로 또는 루트 경로의 assets/cards 하위만 허용
  const normalizedPath = parsed.pathname.replace(/\/{2,}/g, '/');
  const appBasePath = new URL('./', window.location.href).pathname.replace(/\/{2,}/g, '/');
  const baseCardsPath = `${appBasePath.endsWith('/') ? appBasePath : appBasePath + '/'}js/assets/cards/`;
  if (!normalizedPath.startsWith(baseCardsPath) && !normalizedPath.startsWith('/js/assets/cards/')) return '';

  // 이미지 확장자만 허용
  if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(normalizedPath)) return '';

  return parsed.href;
}

function renderCardBack(cardData) {
  // For opponent hand
  const el = document.createElement('div');
  if (cardData.isPublic) {
    el.className = 'card-back public-back';
    const name = document.createElement('div');
    name.className = 'pub-name';
    name.textContent = cardData.name;
    el.appendChild(name);
  } else {
    el.className = 'card-back';
    el.textContent = '?';
  }
  return el;
}

// ─────────────────────────────────────────────
// RENDER ALL UI FROM G
// ─────────────────────────────────────────────
function renderAll() {
  if (window.HB_CONTINUOUS_ENGINE && typeof window.HB_CONTINUOUS_ENGINE.applyContinuousEffects === 'function') {
    const _snap = {
      myField: G.myField.map(c => ({ ...c })),
      opField: G.opField.map(c => ({ ...c })),
      myExtraSlots: G.myExtraSlots,
      opExtraSlots: G.opExtraSlots,
    };
    try { window.HB_CONTINUOUS_ENGINE.applyContinuousEffects(G); }
    catch (err) {
      console.warn('[ui] 지속 효과 적용 실패, 이전 상태로 복원:', err);
      G.myField = _snap.myField;
      G.opField = _snap.opField;
      G.myExtraSlots = _snap.myExtraSlots;
      G.opExtraSlots = _snap.opExtraSlots;
    }
  }
  renderMyHand();
  renderOpHand();
  renderMyField();
  renderOpField();
  renderCounts();
  renderPhase();
  renderFieldZones();
  renderClock();
}

function renderMyHand() {
  const container = document.getElementById('myHand');
  container.innerHTML = '';
  G.myHand.forEach((c, i) => {
    const el = renderCard(c, { selected: i === selectedCardIdx });
    el.addEventListener('click', () => openCardDetail(c.id, i));
    container.appendChild(el);
  });
  document.getElementById('myHandCount').textContent = G.myHand.length;
}

function renderOpHand() {
  const container = document.getElementById('opHand');
  container.innerHTML = '';
  G.opHand.forEach((c, i) => {
    const el = renderCardBack(c);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if (c.isPublic) openCardDetail(c.id, -1, true);
    });
    container.appendChild(el);
  });
  document.getElementById('opHandCount').textContent = G.opHand.length;
}


function createCounterUI(mon) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:2px;padding:2px 2px 3px;min-height:16px;';

  const entries = Object.entries(mon?.counters || {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return wrap;

  const colorByType = {
    '화염': '#ff7a7a',
    '물': '#64b5ff',
    '전기': '#ffd75e',
    '바람': '#9cffb5',
    '궁극': '#d1a3ff'
  };

  entries.forEach(([type, count]) => {
    const badge = document.createElement('span');
    const color = colorByType[type] || '#9dd6ff';
    badge.style.cssText = `font-size:.5rem;line-height:1;padding:2px 4px;border-radius:999px;border:1px solid ${color};color:${color};background:rgba(0,0,0,.25);`;
    badge.textContent = `${type} ${count}`;
    wrap.appendChild(badge);
  });

  return wrap;
}

function renderMyField() {
  const container = document.getElementById('myField');
  container.innerHTML = '';
  const slots = window.HB_CONTINUOUS_ENGINE ? window.HB_CONTINUOUS_ENGINE.getAvailableMonsterZoneCount('me', G) : (5 + G.myExtraSlots);
  for (let i = 0; i < slots; i++) {
    const slot = document.createElement('div');
    slot.className = 'zone-slot';
    const mon = G.myField[i];
    if (mon) {
      const card = CARDS[mon.id] || {};
      slot.classList.toggle('active', true);
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:.55rem;text-align:center;padding:3px;word-break:keep-all;color:var(--text)';
      nameEl.textContent = mon.name;
      const atkEl = document.createElement('div');
      atkEl.style.cssText = 'font-size:.65rem;color:var(--accent);font-family:Black Han Sans,sans-serif';
      atkEl.textContent = `ATK ${mon.atk ?? (card.atk ?? '?')}`;
      slot.appendChild(nameEl);
      slot.appendChild(atkEl);
      slot.appendChild(createCounterUI(mon));
      slot.addEventListener('click', () => onMyFieldClick(i));
    } else {
      slot.style.cursor = 'default';
    }
    container.appendChild(slot);
  }
}

function renderOpField() {
  const container = document.getElementById('opField');
  container.innerHTML = '';
  G.opField.forEach((mon, i) => {
    const slot = document.createElement('div');
    slot.className = 'zone-slot active';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:.55rem;text-align:center;padding:3px;word-break:keep-all;color:var(--text)';
    nameEl.textContent = mon.name;
    const atkEl = document.createElement('div');
    atkEl.style.cssText = 'font-size:.65rem;color:var(--danger);font-family:Black Han Sans,sans-serif';
    atkEl.textContent = `ATK ${mon.atk ?? '?'}`;
    slot.appendChild(nameEl);
    slot.appendChild(atkEl);
    slot.appendChild(createCounterUI(mon));
    slot.addEventListener('click', () => onOpFieldClick(i));
    container.appendChild(slot);
  });
  // add empty padding slots up to 5
  const maxSlots = window.HB_CONTINUOUS_ENGINE ? window.HB_CONTINUOUS_ENGINE.getAvailableMonsterZoneCount('opponent', G) : (5 + (G.opExtraSlots || 0));
  for (let i = G.opField.length; i < maxSlots; i++) {
    const slot = document.createElement('div');
    slot.className = 'zone-slot';
    container.appendChild(slot);
  }
}

function renderCounts() {
  document.getElementById('myHandCount').textContent = G.myHand.length;
  document.getElementById('opHandCount').textContent = G.opHand.length;
  document.getElementById('myKeyDeckCount').textContent = G.myKeyDeck.length;
  document.getElementById('opKeyDeckCount').textContent = G.opKeyDeck.length;
  document.getElementById('myGraveCount').textContent = G.myGrave.length;
  document.getElementById('opGraveCount').textContent = G.opGrave.length;
  document.getElementById('myExileCount').textContent = G.myExile.length;
  document.getElementById('opExileCount').textContent = G.opExile.length;
}

function renderPhase() {
  ['Draw','Deploy','Attack','End'].forEach(p => {
    const el = document.getElementById('ph' + p);
    el.classList.toggle('active', currentPhase === p.toLowerCase());
  });

  // Phase action buttons visibility
  const mine = isMyTurn;
  document.getElementById('btnDraw').classList.toggle('active-phase', mine && currentPhase === 'draw');
  document.getElementById('btnEndDeploy').classList.toggle('active-phase', mine && currentPhase === 'deploy');
  document.getElementById('btnEndAttack').classList.toggle('active-phase', mine && currentPhase === 'attack');
  document.getElementById('btnEndTurn').classList.toggle('active-phase', mine && currentPhase === 'end');

  // Enable/disable buttons
  document.getElementById('btnDraw').disabled = !mine || currentPhase !== 'draw';
  document.getElementById('btnEndDeploy').disabled = !mine || currentPhase !== 'deploy';
  document.getElementById('btnEndAttack').disabled = !mine || currentPhase !== 'attack';
  document.getElementById('btnEndTurn').disabled = !mine || currentPhase !== 'end';

  const turnLabel = document.getElementById('turnLabel');
  turnLabel.textContent = mine ? '내 턴' : '상대 턴';
  turnLabel.className = 'turn-label ' + (mine ? 'turn-mine' : 'turn-opponent');
  renderChainActions();
  syncClockRunState(getPriorityOwner());
}

function renderChainActions() {
  const btnRespond = document.getElementById('btnChainRespond');
  const btnPass = document.getElementById('btnChainPass');
  const btnKeyFetch = document.getElementById('btnKeyFetch');
  if (!btnRespond || !btnPass) return;

  const chainActive = !!(activeChainState && activeChainState.active);
  const myPriority = chainActive && activeChainState.priority === myRole;

  // 응답 가능한 카드 수 계산해서 버튼에 표시
  if (myPriority && typeof collectChainOptions === 'function') {
    const opts = collectChainOptions();
    if (opts.length > 0) {
      btnRespond.textContent = `체인 응답 (${opts.length})`;
      btnRespond.style.borderColor = '#9c7cdf';
      btnRespond.style.color = '#c8a0ff';
    } else {
      btnRespond.textContent = '체인 응답';
      btnRespond.style.borderColor = '';
      btnRespond.style.color = '';
    }
  } else {
    btnRespond.textContent = '체인 응답';
    btnRespond.style.borderColor = '';
    btnRespond.style.color = '';
  }

  btnRespond.classList.toggle('hidden', !myPriority);
  btnPass.classList.toggle('hidden', !myPriority);

  // AI 대전에서 상대(AI) 우선권일 때 현재 고민 상태를 버튼 텍스트로 표시
  if (!myPriority && window.AI?.active) {
    const aiThinking = !!window.AI.chain?.handling;
    btnRespond.classList.remove('hidden');
    btnPass.classList.add('hidden');
    btnRespond.textContent = aiThinking ? 'AI가 체인 고민 중...' : 'AI 결정 대기 중...';
    btnRespond.style.borderColor = aiThinking ? '#ea580c' : '';
    btnRespond.style.color = aiThinking ? '#fb923c' : '';
    btnRespond.disabled = true;
  } else {
    btnRespond.disabled = !myPriority;
  }

  if (btnKeyFetch) {
    const noKeyCard = !G.myKeyDeck || G.myKeyDeck.length === 0;
    const inDraw = currentPhase === 'draw';
    const opponentPriority = chainActive && !myPriority;
    // 체인 활성 중에는 키카드 버튼 숨김 (체인 응답 버튼으로 통합)
    btnKeyFetch.disabled = noKeyCard || inDraw || opponentPriority || chainActive;
  }
  renderChainStack();
}

// 체인 응답 행(hang) 방지 워치독: 내(사람) 우선권으로 체인이 열린 채 일정 시간 방치되면
// 자동으로 패스한다. 네트워크전에서 한쪽이 자리를 비워 체인이 무한 대기하는 것을 막는다.
// AI전은 AI가 자체 자동패스 로직을 쓰므로 제외한다.
const CHAIN_RESPONSE_IDLE_TIMEOUT_MS = 30000;
let _chainPriorityHeldSince = 0;
if (typeof window !== 'undefined' && !window.__chainResponseWatchdog) {
  window.__chainResponseWatchdog = setInterval(function chainResponseWatchdog() {
    try {
      const active = !!(activeChainState && activeChainState.active);
      const myPriority = active && activeChainState.priority === myRole;
      if (!myPriority || (window.AI && window.AI.active)) { _chainPriorityHeldSince = 0; return; }
      const now = Date.now();
      if (_chainPriorityHeldSince === 0) { _chainPriorityHeldSince = now; return; }
      if (now - _chainPriorityHeldSince >= CHAIN_RESPONSE_IDLE_TIMEOUT_MS) {
        _chainPriorityHeldSince = 0;
        if (window.HB_DEBUG_PICKER) console.warn('[chain] 응답 타임아웃 → 자동 패스');
        if (typeof passChainPriority === 'function') passChainPriority();
      }
    } catch (_) {}
  }, 3000);
}

function renderChainStack() {
  let wrap = document.getElementById('chainStackView');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'chainStackView';
    wrap.style.cssText = 'margin-top:8px;padding:8px;border:1px solid #4a4a5e;border-radius:8px;background:#1a1a24;font-size:.78rem;color:#ddd;';
    const holder = document.getElementById('phaseActions');
    if (!holder) return;
    holder.appendChild(wrap);
  }
  const links = activeChainState?.links || [];
  if (!activeChainState?.active || links.length === 0) {
    wrap.innerHTML = '<div style="opacity:.5;font-size:.7rem">체인 없음</div>';
    return;
  }
  // 발동자 표시: 내 카드면 녹색, 상대면 빨강
  const rows = links.map((l, i) => {
    const isMine = l.by === myRole;
    const color = isMine ? '#7ad68c' : '#e88888';
    const who = isMine ? '나' : '상대';
    return `<div style="color:${color}">⛓ ${i + 1}: <span style="color:#c8a96e">${l.label || l.type}</span> <span style="opacity:.6;font-size:.65rem">[${who}]</span></div>`;
  }).join('');
  wrap.innerHTML = `<div style="margin-bottom:4px;color:#9c7cdf;font-size:.7rem;letter-spacing:.05em">CHAIN STACK — 역순 해결</div>${rows}`;
}

// 키덱에서 패로 가져올 수 없고 직접 소환해야 하는 카드들
const KEY_SUMMON_ONLY = new Set(['카드의 흑기사', '풀려난 항아리의 마귀', '카드 세계의 영웅']);

function startKeyFetchEffect() {
  if (!G.myKeyDeck || G.myKeyDeck.length === 0) {
    notify('키 카드 덱이 비어있습니다.');
    return;
  }
  if (currentPhase === 'draw') {
    notify('드로우 단계에는 키카드를 사용할 수 없습니다.');
    return;
  }
  if (activeChainState && activeChainState.active && activeChainState.priority !== myRole) {
    notify('현재 체인 우선권은 상대에게 있습니다.');
    return;
  }
  if (activeChainState && activeChainState.active && usedKeyFetchInChain[myRole]) {
    notify('동일 체인에서는 키 카드 덱 가져오기를 1번만 사용할 수 있습니다.');
    return;
  }

  // ── 전개 단계 + 체인 없을 때만 직접 소환 카드 표시 ──
  const inDeployNonChain = isMyTurn && currentPhase === 'deploy' && !(activeChainState && activeChainState.active);

  const options = (G.myKeyDeck || []).map(c => {
    // 직접 소환 전용 카드
    if (KEY_SUMMON_ONLY.has(c.id)) {
      if (!inDeployNonChain) {
        return { id: c.id, name: `${c.name} — 전개 단계에만 소환 가능`, canFetch: false, summonOnly: true };
      }
      return { id: c.id, name: `${c.name} [소환]`, canFetch: true, summonOnly: true };
    }
    // 패로 가져오는 카드 — 조건 체크
    let canFetch = true;
    let reason = '';
    if (c.id === '펭귄 용사' && G.opField.length === 0) {
      canFetch = false; reason = '(상대 필드에 몬스터 필요)';
    }
    if (c.id === '펭귄의 전설' && G.myField.length === 0) {
      canFetch = false; reason = '(내 필드에 몬스터 필요)';
    }
    return { id: c.id, name: canFetch ? c.name : `${c.name} ${reason} — 불가`, canFetch, summonOnly: false };
  });

  const availableOptions = options.filter(o => o.canFetch);
  if (availableOptions.length === 0) {
    notify('현재 사용할 수 있는 키 카드가 없습니다.');
    return;
  }

  openCardPicker(availableOptions, '키 카드 덱 — 사용할 카드 선택', 1, (sel) => {
    if (!sel || sel.length === 0) return;
    const picked = availableOptions[sel[0]];
    if (!picked) return;

    if (picked.summonOnly) {
      // 직접 소환 카드 — activateCard 경로로 위임
      // 체인 없이 소환 코스트 피커를 바로 띄워도 되나, activateCard 내부에서 처리
      // 여기선 activateCard의 switch case로 진입하기 위해 임시로 패에 넣지 않고
      // 바로 전용 소환 함수를 호출한다.
      _summonKeyCardFromDeck(picked.id);
    } else {
      // 패로 가져오기 — 기존 체인 방식
      const effect = {
        type: 'keyFetch',
        label: `키 카드 가져오기 (${picked.name})`,
        cardId: picked.id,
      };
      if (activeChainState && activeChainState.active) addChainLink(effect);
      else beginChain(effect);
    }
  });
}

// ─────────────────────────────────────────────
// 키덱 직접 소환 카드 — 소환 조건/코스트를 처리하고 필드에 배치
// activateCard의 해당 케이스와 동일 로직, 키덱에서 직접 진입
// ─────────────────────────────────────────────
function _summonKeyCardFromDeck(cardId) {
  if (!isMyTurn || currentPhase !== 'deploy') {
    notify('전개 단계에만 소환할 수 있습니다.');
    return;
  }
  if (activeChainState && activeChainState.active) {
    notify('체인 중에는 소환할 수 없습니다.');
    return;
  }
  if (G.myField.length >= maxFieldSlots()) {
    notify('몬스터 존이 가득 찼습니다.');
    return;
  }

  const card = CARDS[cardId];
  if (!card) { notify('카드 정보를 찾을 수 없습니다.'); return; }

  if (cardId === '카드의 흑기사') {
    if (G.myField.length < 2) { notify('소환 불가: 필드 몬스터 2장 이상이 필요합니다.'); return; }
    const targets = [...G.myField];
    openCardPicker(targets, '카드의 흑기사 소환 코스트: 공격력 합계 10 이상이 되도록 몬스터 선택', Math.min(5, targets.length), (sel) => {
      if (!sel.length) return;
      const picked = sel.map(i => targets[i]);
      const sumAtk = picked.reduce((a, m) => a + ((m && m.atk) || 0), 0);
      if (picked.length < 2 || sumAtk < 10) { notify('소환 불가: 2장 이상, 공격력 합계 10 이상이 필요합니다.'); return; }
      // 코스트: 선택한 몬스터들 묘지
      picked.forEach(m => {
        const idx = G.myField.findIndex(x => x === m);
        if (idx >= 0) G.myGrave.push(G.myField.splice(idx, 1)[0]);
      });
      // 키덱에서 제거 후 필드에 소환
      const ki = G.myKeyDeck.findIndex(c => c.id === cardId);
      if (ki >= 0) G.myKeyDeck.splice(ki, 1);
      G.myField.push({ id: cardId, name: card.name, atk: card.atk || 5, atkBase: card.atk || 5, summonedFrom: 'keyDeck' });
      log('카드의 흑기사 소환!', 'mine');
      sendAction({ type: 'summon', cardId });
      sendGameState(); renderAll();
    });

  } else if (cardId === '풀려난 항아리의 마귀') {
    if (G.myField.length < 3) { notify('소환 불가: 필드 몬스터 3장이 필요합니다.'); return; }
    const targets = [...G.myField];
    openCardPicker(targets, '풀려난 항아리의 마귀 소환 코스트: 몬스터 3장 선택', 3, (sel) => {
      if (sel.length !== 3) return;
      sel.sort((a, b) => b - a).forEach(i => G.myGrave.push(G.myField.splice(i, 1)[0]));
      const ki = G.myKeyDeck.findIndex(c => c.id === cardId);
      if (ki >= 0) G.myKeyDeck.splice(ki, 1);
      G.myField.push({ id: cardId, name: card.name, atk: card.atk || 5, atkBase: card.atk || 5, summonedFrom: 'keyDeck' });
      log('풀려난 항아리의 마귀 소환!', 'mine');
      sendAction({ type: 'summon', cardId });
      sendGameState(); renderAll();
    });

  } else if (cardId === '카드 세계의 영웅') {
    const hasPot = G.myField.some(m => m.id === '풀려난 항아리의 마귀');
    if (!hasPot || G.myField.length < 2) {
      notify('소환 불가: 필드의 풀려난 항아리의 마귀 1장과 다른 몬스터 1장이 필요합니다.');
      return;
    }
    const potIdx   = G.myField.findIndex(m => m.id === '풀려난 항아리의 마귀');
    const otherIdx = G.myField.findIndex((m, i) => i !== potIdx);
    // 높은 인덱스부터 제거
    G.myGrave.push(G.myField.splice(Math.max(potIdx, otherIdx), 1)[0]);
    G.myGrave.push(G.myField.splice(Math.min(potIdx, otherIdx), 1)[0]);
    const ki = G.myKeyDeck.findIndex(c => c.id === cardId);
    if (ki >= 0) G.myKeyDeck.splice(ki, 1);
    G.myField.push({ id: cardId, name: card.name, atk: card.atk || 5, atkBase: card.atk || 5, summonedFrom: 'keyDeck' });
    // 영웅의 탄생 서치 (덱→묘지→제외 순)
    const searchHero = () => {
      const d = G.myDeck.findIndex(x => x.id === '영웅의 탄생');
      if (d >= 0) { const z = G.myDeck.splice(d, 1)[0]; G.myHand.push({ id: z.id, name: z.name, isPublic: true }); return true; }
      const g = G.myGrave.findIndex(x => x.id === '영웅의 탄생');
      if (g >= 0) { const z = G.myGrave.splice(g, 1)[0]; G.myHand.push({ id: z.id, name: z.name, isPublic: true }); return true; }
      const e = G.myExile.findIndex(x => x.id === '영웅의 탄생');
      if (e >= 0) { const z = G.myExile.splice(e, 1)[0]; G.myHand.push({ id: z.id, name: z.name, isPublic: true }); return true; }
      return false;
    };
    if (searchHero()) log('카드 세계의 영웅 ①: 영웅의 탄생을 패에 추가', 'mine');
    log('카드 세계의 영웅 소환!', 'mine');
    sendAction({ type: 'summon', cardId });
    sendGameState(); renderAll();
  }
}

// ─────────────────────────────────────────────
// 체인 시스템 함수들은 effects-chain.js에 정의됨
// beginChain, passChainPriority, addChainLink, flushTriggeredEffects,
// activateQuickEffect, activateIgnitionEffect — 모두 effects-chain.js에서 관리
// activateQuickEffect와 activateIgnitionEffect는 effects-chain.js에 정의됨
// 이 파일에서 재정의하지 않음 — 기동효과는 체인 1로만 발동 가능

function ensureCardInstanceId(card) {
  if (!card) return null;
  if (!card._iid) {
    ensureCardInstanceId._seq = (ensureCardInstanceId._seq || 0) + 1;
    card._iid = `cid_${Date.now()}_${ensureCardInstanceId._seq}`;
  }
  return card._iid;
}

function findCardIndexByInstanceId(zone, instanceId) {
  if (!Array.isArray(zone) || !instanceId) return -1;
  return zone.findIndex(c => c && c._iid === instanceId);
}

function resolveChain(chainState) {
  const links = [...(chainState.links || [])];
  const resolvedAt = Date.now();
  usedKeyFetchInChain = {};
  activeChainState = null; // ★ 즉시 초기화 → 버튼 정상화
  renderChainActions();
  if (roomRef) {
    roomRef.child('chainState').set({ active: false, links: [], priority: null, passCount: 0, resolvedLinks: links, resolvedAt });
  } else {
    executeChainLocally(links.slice().reverse());
  }
}

function executeChainLocally(links) {
  links.forEach(link => {
    if (link.by !== myRole) return;
    if (link.type === 'keyFetch') {
      resolveKeyFetch(link.cardId);
    } else if (link.type === 'penguinVillage1') {
      resolvePenguinVillage1();
    } else if (link.type === 'triggerKkomaPenguin') {
      resolveKkomaPenguin();
    } else if (link.type === 'triggerPenguinBubu1') {
      resolvePenguinBubu1();
    } else if (link.type === 'triggerPenguinHero1') {
      resolvePenguinHero1();
    } else if (link.type === 'triggerPenguinLegend1') {
      resolvePenguinLegend1();
    } else if (link.type === 'triggerPenguinWizard2') {
      resolvePenguinWizard2();
    } else if (link.type === 'triggerPenguinHero3') {
      resolvePenguinHero3();
    } else if (link.type === 'quickPenguinHero2') {
      resolvePenguinHero2();
    } else if (link.type === 'quickPenguinLegend2') {
      resolvePenguinLegend2();
    } else if (link.type === 'quickPenguinStrike1') {
      resolvePenguinStrike1();
    } else if (link.type === 'quickPenguinForever2') {
      resolvePenguinForever2();
    } else if (link.type === 'ignitionPenguinBubu2') {
      resolvePenguinBubu2();
    } else if (link.type === 'ignitionSagePenguin1') {
      resolveSagePenguin1();
    } else if (link.type === 'ignitionSagePenguin2') {
      resolveSagePenguin2();
    } else if (link.type === 'ignitionSummonerPenguin1') {
      resolveSummonerPenguin1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinCharge1') {
      resolvePenguinCharge1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinCharge2') {
      resolvePenguinCharge2();
    } else if (link.type === 'ignitionPenguinGlory1') {
      resolvePenguinGlory1(link.sourceInstanceId);
    } else if (link.type === 'ignitionPenguinGlory2') {
      resolvePenguinGlory2();
    } else if (link.type === 'ignitionPenguinForever1') {
      resolvePenguinForever1();
    } else if (link.type === 'ignitionPenguinWizard1') {
      resolvePenguinWizard1();
    } else if (link.type === 'ignitionPenguinWizard3') {
      resolvePenguinWizard3();
    }
  });
  sendGameState();
  renderAll();
  usedKeyFetchInChain = {};
}

function manualDiscard(handIdx) {
  if (handIdx < 0 || !G.myHand[handIdx]) return;
  const c = G.myHand.splice(handIdx, 1)[0];
  G.myGrave.push({ id: c.id, name: c.name });
  selectedCardIdx = -1;
  log(`패를 버림: ${c.name}`, 'mine');
  sendAction({ type: 'discard', cardId: c.id });
  onJibaeryongDiscarded(c.id);
  onHandDiscarded_jibaeSasl();
  sendGameState();
  renderAll();
  checkWinCondition();
}

// ★ 강제 패 버리기 — 반드시 1장 선택해야 함, 취소 불가
function _forcedDiscardOne(title, callback) {
  if (G.myHand.length === 0) { callback(); return; }
  openCardPicker(G.myHand, title, 1, (sel) => {
    if (sel.length > 0) {
      const c = G.myHand.splice(sel[0], 1)[0];
      G.myGrave.push(c);
      log(`버림(코스트): ${c.name}`, 'mine');
      onJibaeryongDiscarded(c.id);
      onHandDiscarded_jibaeSasl();
    }
    callback();
  }, true); // forced=true: 반드시 선택, 취소 불가
}

function resolveKeyFetch(cardId) {
  const idx = G.myKeyDeck.findIndex(c => c.id === cardId);
  if (idx < 0) { notify(`키 카드 덱에 ${CARDS[cardId]?.name || cardId}가 없습니다.`); return; }

  // 직접 소환 전용 카드 — keyFetch 체인으로는 패에 넣을 수 없음
  // (startKeyFetchEffect에서 _summonKeyCardFromDeck으로 분기되므로 여기 도달하면 오류)
  if (['카드의 흑기사','풀려난 항아리의 마귀','카드 세계의 영웅'].includes(cardId)) {
    notify(`${CARDS[cardId]?.name || cardId}는 키덱 버튼에서 [소환]으로 직접 소환해야 합니다.`);
    return;
  }

  if (cardId === '펭귄 용사' && G.opField.length === 0) {
    notify('펭귄 용사: 상대 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
    return;
  }
  if (cardId === '펭귄의 전설' && G.myField.length === 0) {
    notify('펭귄의 전설: 자신 필드에 몬스터가 없어 패에 넣을 수 없습니다.');
    return;
  }

  const c = G.myKeyDeck.splice(idx, 1)[0];
  G.myHand.push({ id: c.id, name: c.name, isPublic: true });
  log(`키 카드 가져오기: ${c.name} (공개패)`, 'mine');
  sendGameState(); renderAll();
}

function resolvePenguinVillage1() {
  const idx = G.myHand.findIndex(c => c.id === '펭귄 마을' && !c.isPublic);
  if (idx < 0) return;
  G.myHand[idx].isPublic = true;
  markEffectUsed('펭귄 마을', 1);
  log('체인 처리: 펭귄 마을 ① 공개', 'mine');
}

function renderFieldZones() {
  const myFZ = document.getElementById('myFieldZone');
  const opFZ = document.getElementById('opFieldZone');
  if (G.myFieldCard) {
    myFZ.innerHTML = `<div class="field-card-display">${G.myFieldCard.name}</div>`;
  } else {
    myFZ.textContent = '비어있음';
  }
  if (G.opFieldCard) {
    opFZ.innerHTML = `<div class="field-card-display">${G.opFieldCard.name}</div>`;
  } else {
    opFZ.textContent = '비어있음';
  }
}

// ─────────────────────────────────────────────
// CARD INTERACTIONS
// ─────────────────────────────────────────────
function onMyHandClick(i) {
  if (selectedCardIdx === i) {
    selectedCardIdx = -1;
  } else {
    selectedCardIdx = i;
  }
  renderMyHand();
}

function onMyFieldClick(i) {
  if (currentPhase === 'attack' && isMyTurn) {
    selectedFieldIdx = i;
    document.querySelectorAll('#opField .zone-slot').forEach(el => el.classList.toggle('attack-target', true));
    if (G.opField.length === 0) {
      gameConfirm(`${G.myField[i]?.name}으로 직접 공격?\n상대 패 ${G.myField[i]?.atk}장 손실`, (yes) => {
        if (yes) directAttack(i);
        selectedFieldIdx = -1;
      });
    } else {
      notify('공격할 상대 몬스터를 클릭하세요');
    }
    return;
  }
  // 전개/상대턴: 카드 상세 + 효과 버튼
  const mon = G.myField[i];
  if (mon) openCardDetail(mon.id, -1, false, i);
}

function onOpFieldClick(i) {
  if (selectedFieldIdx >= 0) {
    // 공격 모드: 전투 실행
    executeCombat(selectedFieldIdx, i);
    selectedFieldIdx = -1;
    document.querySelectorAll('.zone-slot.attack-target').forEach(el => el.classList.remove('attack-target'));
  } else {
    // 일반 모드: 카드 상세 보기
    const mon = G.opField[i];
    if (mon) openCardDetail(mon.id, -1, true);
  }
}

// ─────────────────────────────────────────────
// CARD DETAIL MODAL (효과 버튼 포함)
// ─────────────────────────────────────────────
function openCardDetail(cardId, handIdx = -1, opponentCard = false, fieldIdx = -1) {
  try {
    const card = CARDS[cardId] || { name: cardId, cardType: 'normal', effects: '효과 정보 없음' };
    document.getElementById('mdCardName').textContent = card.name;
    document.getElementById('mdCardEffects').textContent = card.effects || '효과 없음';

    // Meta chips
    const meta = document.getElementById('mdCardMeta');
    meta.innerHTML = '';
    const typeChip = document.createElement('div');
    typeChip.className = 'meta-chip';
    typeChip.textContent = CARD_TYPE_LABEL[card.cardType] || card.cardType;
    typeChip.style.borderColor = CARD_TYPE_COLOR[card.cardType] || '#555';
    typeChip.style.color = CARD_TYPE_COLOR[card.cardType] || '#555';
    meta.appendChild(typeChip);
    if (card.atk !== undefined) {
      const atkChip = document.createElement('div');
      atkChip.className = 'meta-chip';
      const fieldMon = fieldIdx >= 0 ? G.myField[fieldIdx] : G.myField.find(m => m.id === cardId);
      const currentAtk = fieldMon ? fieldMon.atk : card.atk;
      atkChip.textContent = `ATK ${currentAtk}`;
      atkChip.style.borderColor = '#c8a96e'; atkChip.style.color = '#c8a96e';
      meta.appendChild(atkChip);
    }
    if (card.isKeyCard) {
      const kc = document.createElement('div');
      kc.className = 'meta-chip';
      kc.textContent = '키카드';
      kc.style.borderColor = '#7c5cbf'; kc.style.color = '#7c5cbf';
      meta.appendChild(kc);
    }

    // 액션 버튼
    const actions = document.getElementById('mdCardActions');
    actions.innerHTML = '';

    const addBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`;
      b.textContent = label;
      b.onclick = () => { closeModal('cardDetailModal'); try { fn(); } catch(e) { console.error(e); notify('효과 처리 오류: ' + e.message); } };
      actions.appendChild(b);
    };

    // 14단계: effectIds가 있는 카드는 텍스트/switch 기반 레거시 버튼을 만들지 않고
    // EffectDefinition 기준 UI만 사용한다. 아직 이식되지 않은 카드는 기존 버튼을 유지한다.
    const detailZone = handIdx >= 0 ? 'hand' : (handIdx === -2 ? 'grave' : (handIdx === -3 ? 'fieldZone' : (fieldIdx >= 0 ? 'field' : null)));
    let usingNewEffectUi = false;
    const bridge = window.HB_LEGACY_BRIDGE;
    const hasNewEngineEffects = !!(bridge && typeof bridge.isNewEngineCard === 'function' && bridge.isNewEngineCard(card));
    const suppressLegacyButtons = !!(bridge && typeof bridge.isFullyMigratedCard === 'function'
      ? bridge.isFullyMigratedCard(card)
      : hasNewEngineEffects);
    if (!opponentCard && detailZone && hasNewEngineEffects) {
      try {
        if (detailZone === 'fieldZone') {
          bridge.routeFieldZoneClick(card, {
            gameState: G,
            player: 'me',
            controller: 'me',
            actionsElement: actions,
          });
        } else {
          window.HB_EFFECT_UI.renderEffectButtons(card, detailZone, {
            gameState: G,
            player: 'me',
            controller: 'me',
            handIdx,
            handIndex: handIdx,
            fieldIdx,
            fieldIndex: fieldIdx,
            sourceIndex: detailZone === 'hand' ? handIdx : (detailZone === 'field' ? fieldIdx : null),
            actionsElement: actions,
            showNoEffectHint: true,
          });
        }
        usingNewEffectUi = suppressLegacyButtons;
      } catch (err) {
        console.error('[ui] 신엔진 효과 버튼 생성 오류:', err);
        notify('신규 효과 버튼 생성 오류: ' + err.message);
      }
    }

    try {
      if (!opponentCard && !usingNewEffectUi) {
        if (handIdx >= 0) {
          const isPenguin = typeof isPenguinCard === 'function' ? isPenguinCard(cardId) : cardId.includes('펭귄');
          const canActAnytime = currentPhase !== 'draw';

          if (isPenguin) {
            // 자주 쓰는 조건 미리 계산
            const villageRevealed = isPenguinVillageRevealed();
            const hasDeckPenguin = findAllInDeck(c => isPenguinMonster(c.id)).length > 0;
            const hasOpMonster = G.opField.length > 0;
            const hasMyMonster = G.myField.length > 0;
            const hasDeckPenguinCard = findAllInDeck(c => isPenguinCard(c.id)).length > 0;
            const hasGraveCharge = G.myGrave.some(c => c.id === '펭귄!돌격!');
            const hasGraveGlory = G.myGrave.some(c => c.id === '펭귄의 영광' || c.id === '펭귄이여 영원하라');
            const hasGraveKkoma = G.myGrave.some(c => c.id === '꼬마 펭귄');

            switch(cardId) {
              case '펭귄 마을':
                if (isMyTurn && currentPhase === 'deploy' && !G.myHand[handIdx]?.isPublic)
                  addBtn('① 공개하기', 'btn-primary', () => activateCard(handIdx, 1));
                break;

              case '꼬마 펭귄':
                if (isMyTurn && currentPhase === 'deploy')
                  addBtn('① 패에서 소환', 'btn-primary', () => activateCard(handIdx, 1));
                break;

              case '펭귄 부부':
                // ② 보여주기: 기동효과 → 자신 전개 단계에만 (1턴 1번)
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('펭귄 부부', 2))
                  addBtn('② 보여주기 → 드로우2 + 버리기', 'btn-secondary', () => activateCard(handIdx, 2));
                break;

              case '현자 펭귄':
                // 현자 펭귄은 패에서 소환 불가 (특수 소환만 가능)
                // ① ② 는 필드에서만
                break;

              case '수문장 펭귄':
                // 수문장 펭귄도 패에서 소환 불가
                break;

              case '펭귄!돌격!':
                if (isMyTurn && currentPhase === 'deploy' && hasDeckPenguin)
                  addBtn('① 덱에서 펭귄 소환', 'btn-primary', () => activateCard(handIdx, 1));
                else if (isMyTurn && currentPhase === 'deploy' && !hasDeckPenguin)
                  addBtn('① 덱에 펭귄 몬스터 없음', 'btn-secondary', () => notify('덱에 펭귄 몬스터가 없습니다.'));
                break;

              case '펭귄의 영광':
                // ①: 자신/상대 전개 단계 + 패에 펭귄 용사 또는 펭귄의 전설(용사 취급) 필요
                { const heroAvail = G.myHand.some(c => c.id === '펭귄 용사' || c.id === '펭귄의 전설');
                  if (currentPhase === 'deploy' && heroAvail)
                    addBtn('① 펭귄 용사/전설 소환 + 상대 패 공개', 'btn-primary', () => activateCard(handIdx, 1));
                  else if (currentPhase !== 'deploy')
                    addBtn('① 전개 단계에서만 발동 가능', 'btn-secondary', () => notify('펭귄의 영광 ①은 자신/상대 전개 단계에만 발동할 수 있습니다.'));
                  else
                    addBtn('① 발동 불가 (패에 용사/전설 없음)', 'btn-secondary', () => notify('패에 펭귄 용사 또는 펭귄의 전설이 있어야 합니다.'));
                }
                break;

              case '펭귄 용사':
                // 소환 조건: 상대 필드에 몬스터가 있을 때만 (키카드 덱에서 패로 가져올 때 이미 체크됨)
                // 패에 있으면 이미 조건 충족된 것이므로 소환 버튼은 영광으로만
                break;

              case '펭귄의 일격':
                // ①: 상대 몬스터 효과 무효 — 상대 효과 발동 시, 자신 필드에 펭귄 몬스터 필요
                {
                  const hasPenguinField = G.myField.some(c => isPenguinMonster(c.id));
                  if (hasPenguinField && canUseEffect('펭귄의 일격', 1))
                    addBtn('① 패 1장 버리고 효과 무효', 'btn-primary', () => activateCard(handIdx, 1));
                  else if (!hasPenguinField)
                    addBtn('① 필드에 펭귄 몬스터 필요', 'btn-secondary', () => notify('자신 필드에 펭귄 몬스터가 필요합니다.'));
                }
                break;

              case '펭귄이여 영원하라':
                // ①: 서로 필드 카드 1장씩 패로 — 내 필드(몬스터 또는 필드 마법)에 카드 필요
                { const myHasAnyField = G.myField.length > 0 || G.myFieldCard != null;
                  if (canActAnytime && myHasAnyField)
                    addBtn('① 필드 카드 교환 + 소환', 'btn-primary', () => activateCard(handIdx, 1));
                  else if (!myHasAnyField)
                    addBtn('① 발동 불가 (내 필드에 카드 없음)', 'btn-secondary', () => notify('내 필드에 카드가 있어야 합니다.'));
                }
                // ②: 상대 턴, 묘지에 이 카드 있어야 함 — 패에 있을 때는 ② 없음 (묘지에서만)
                break;

              case '펭귄의 전설':
                // 패에 있을 경우: 자신 필드에 몬스터가 있을 때만 패에 넣을 수 있으므로
                // 이미 패에 있는 상태 → ②만 표시
                if (!isMyTurn)
                  addBtn('② 패로 + 묘지 소환 (상대 턴)', 'btn-secondary', () => activateCard(handIdx, 2));
                break;

              case '펭귄 마법사':
                // ①: 일반 패(비공개)일 때만
                if (!G.myHand[handIdx]?.isPublic && canUseEffect('펭귄 마법사', 1, 2) && hasDeckPenguinCard)
                  addBtn('① 보여주기 → 서치 → 덱으로', 'btn-secondary', () => activateCard(handIdx, 1));
                else if (G.myHand[handIdx]?.isPublic)
                  addBtn('① 공개패에서는 발동 불가', 'btn-secondary', () => notify('일반 패(비공개)에서만 발동할 수 있습니다.'));
                else if (!hasDeckPenguinCard)
                  addBtn('① 덱에 펭귄 카드 없음', 'btn-secondary', () => notify('덱에 펭귄 카드가 없습니다.'));
                break;

              default:
                if (card.cardType === 'monster' && isMyTurn && currentPhase === 'deploy')
                  addBtn('효과 소환 전용', 'btn-secondary', () => notify('통상 소환은 없습니다.'));
            }
          } else if (cardId === '일격필살') {
            // 키카드 — 언제든 발동 가능, 묘지에 있을 때 효과 대상 안 됨
            if (handIdx >= 0 && currentPhase !== 'draw')
              addBtn('① 상대 패 1장 버리기', 'btn-primary', () => activateCard(handIdx));
            if (handIdx >= 0) addBtn('패에서 버리기', 'btn-danger', () => manualDiscard(handIdx));
          } else if (cardId === '단 한번의 기회') {
            // 키카드 — 언제든 발동 가능
            if (handIdx >= 0 && currentPhase !== 'draw')
              addBtn('① 드로우 1장', 'btn-primary', () => activateCard(handIdx));
            if (handIdx >= 0) addBtn('패에서 버리기', 'btn-danger', () => manualDiscard(handIdx));
          } else if (cardId === '카드의 흑기사' || cardId === '풀려난 항아리의 마귀' || cardId === '카드 세계의 영웅') {
            if (isMyTurn && currentPhase === 'deploy')
              addBtn('소환', 'btn-primary', () => activateCard(handIdx));
          } else if (card.theme === '지배자') {
            // ── 지배자/지배룡 카드 버튼 ──
            const canAnyTurn = isMyTurn || hasKeyCardMonsterOnField();
            if (handIdx >= 0) {
              switch(cardId) {
                case '수원소의 지배자':
                  // ①: 이 카드를 버리고 → 덱에서 지배자 몬스터 서치 + 드로우 선택
                  if (canAnyTurn && canUseEffect('수원소의 지배자',1))
                    addBtn('① 버리고 → 덱에서 지배자 서치 + 드로우(선택)', 'btn-primary', () => activateJibaejaShui1(handIdx));
                  // ② ③은 필드에서만
                  break;
                case '화원소의 지배자':
                  // ①: 이 카드를 버리고 → 덱에서 지배자 몬스터 소환 + 드로우 선택
                  if (canAnyTurn && canUseEffect('화원소의 지배자',1))
                    addBtn('① 버리고 → 덱에서 지배자 소환 + 드로우(선택)', 'btn-primary', () => activateJibaejaHwa1(handIdx));
                  break;
                case '전원소의 지배자':
                  // ①: 이 카드를 버리고 → 패/묘지에서 다른 지배자 몬스터 소환 + 드로우 선택
                  if (canAnyTurn && canUseEffect('전원소의 지배자',1))
                    addBtn('① 버리고 → 패/묘지 지배자 소환 + 드로우(선택)', 'btn-primary', () => activateJibaejaJeon1(handIdx));
                  break;
                case '풍원소의 지배자':
                  // ①: 이 카드를 버리고 → 상대 묘지 카드 1장 제외 + 드로우
                  if (canAnyTurn && canUseEffect('풍원소의 지배자',1)) {
                    if (G.opGrave.length > 0)
                      addBtn('① 버리고 → 상대 묘지 카드 제외 + 드로우', 'btn-primary', () => activateJibaejaFung1(handIdx));
                    else
                      addBtn('① 발동 불가 (상대 묘지 없음)', 'btn-secondary', () => notify('상대 묘지에 카드가 없습니다.'));
                  }
                  break;
                case '사원소의 지배자':
                  if (canSummonSaWonsoJibaeja())
                    addBtn('소환 (지배자 4종 제외)', 'btn-primary', () => summonSaWonsoJibaeja());
                  else
                    addBtn('소환 불가 (필드/묘지 지배자 4종 필요)', 'btn-secondary', () => notify('필드/묘지에 카드명이 다른 지배자 4종이 필요합니다.'));
                  break;
                case '사원소의 지배룡':
                  if (canSummonSaWonsoJibaeryong())
                    addBtn('소환 (지배룡 4종 제외)', 'btn-primary', () => summonSaWonsoJibaeryong());
                  else
                    addBtn('소환 불가 (필드/묘지 지배룡 4종 필요)', 'btn-secondary', () => notify('필드/묘지에 카드명이 다른 지배룡 4종이 필요합니다.'));
                  break;
                case '사원소의 기적':
                  if (!saWonsoMirakUsed)
                    addBtn('① 4종 묘지로 (게임 중 1번)', 'btn-primary', () => activateSaWonsoMirak(handIdx));
                  else
                    addBtn('이미 발동했습니다', 'btn-secondary', () => notify('사원소의 기적은 게임 중 1번밖에 발동할 수 없습니다.'));
                  break;
                case '지배의 사슬':
                  // ①은 패가 버려질 때 자동 트리거 (패에 있을 때)
                  // ②는 묘지에서 발동 (묘지 뷰어에서)
                  addBtn('① 자동: 패 버려질 때 드로우 (자동)', 'btn-secondary', () => notify('지배의 사슬 ①은 자신의 패가 버려졌을 때 자동 발동 여부를 묻습니다. 지배의 사슬 ②는 묘지에서 발동하세요.'));
                  break;
                case '지배룡과 지배자':
                  // 자신/상대 공격 단계에 발동 가능
                  if (currentPhase === 'attack' && canUseEffect('지배룡과 지배자',1))
                    addBtn('① 공격 단계 — 패 수에 따른 강화', 'btn-primary', () => activateJibaeryongJibaeja1(handIdx));
                  // ② 묘지에서 발동
                  break;
              }
              // 지배자/지배룡 카드는 ①효과 자체가 이 카드를 버리는 코스트이므로
              // 별도 "패에서 버리기" 버튼은 필요하지 않음
            }
          } else if (['크툴루', '올드 원', '올드원', '라이온', '엘리멘츠'].includes(card.theme)) {
            // [BUG FIX] 엘리멘츠 테마 추가 — activateCard 경유 대신 직접 핸들러 호출
            const effectText = card.effects || '';
            if (effectText.includes('①')) addBtn('① 효과 발동', 'btn-primary', () => activateCard(handIdx));
            if (effectText.includes('②')) addBtn('② 효과 발동', 'btn-secondary', () => activateCard(handIdx, 2));
            if (effectText.includes('③')) addBtn('③ 효과 발동', 'btn-secondary', () => activateCard(handIdx, 3));
            addBtn('패에서 버리기', 'btn-danger', () => manualDiscard(handIdx));
          } else {
            // [BUG FIX] 몬스터 카드도 activateCard로 — "통상 소환 없음" 메시지 제거
            // 효과로 소환하는 경우(엘리멘츠 궁극신 등) 포함, 조건은 activateCard/핸들러 내부에서 체크
            if (card.cardType === 'monster' && isMyTurn && currentPhase === 'deploy')
              addBtn('① 효과 발동/소환', 'btn-primary', () => activateCard(handIdx));
            if (['normal','magic','field'].includes(card.cardType) && isMyTurn)
              addBtn('발동', 'btn-primary', () => activateCard(handIdx));
            if (card.cardType === 'magic' && canActAnytime)
              addBtn('마법 발동', 'btn-secondary', () => activateCard(handIdx));
            if (card.cardType === 'trap' && !isMyTurn && canActAnytime)
              addBtn('함정 발동', 'btn-secondary', () => activateCard(handIdx));
          }
        }

        if (fieldIdx >= 0) {
          const mon = G.myField[fieldIdx];
          const villageRevealed = isPenguinVillageRevealed();
          if (mon) {
            switch(mon.id) {
              case '펭귄 부부':
                if (mon.summonedFrom === 'deck' && mon.bubuTriggerReady && canUseEffect('펭귄 부부', 1))
                  addBtn('① 소환 유발 효과', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 1));
                break;
              case '현자 펭귄':
                // ①: 내 턴 + 펭귄 마을 공개 상태 필요
                if (isMyTurn && villageRevealed && canUseEffect('현자 펭귄', 1))
                  addBtn('① 드로우+버리기 [마을 공개 중]', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 1));
                else if (isMyTurn && !villageRevealed)
                  addBtn('① 발동 불가 (펭귄 마을 미공개)', 'btn-secondary', () => notify('패에 펭귄 마을이 공개 상태여야 합니다.'));
                // ②: 전개 단계, 덱에 펭귄 카드 필요
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('현자 펭귄', 2)) {
                  const hasDeckCard = findAllInDeck(c => isPenguinCard(c.id)).length > 0;
                  if (hasDeckCard)
                    addBtn('② 서치', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 2));
                  else
                    addBtn('② 발동 불가 (덱에 펭귄 카드 없음)', 'btn-secondary', () => notify('덱에 펭귄 카드가 없습니다.'));
                }
                break;
              case '수문장 펭귄':
                // ①: 펭귄 마을 공개 상태 필요, 전개 단계
                if (isMyTurn && currentPhase === 'deploy' && villageRevealed && canUseEffect('수문장 펭귄', 1))
                  addBtn('① 공격력+1 + 서로 패 버리기 [마을 공개 중]', 'btn-primary', () => activatePenguinFieldEffect(fieldIdx, 1));
                else if (isMyTurn && currentPhase === 'deploy' && !villageRevealed)
                  addBtn('① 펭귄 마을 공개 필요', 'btn-secondary', () => notify('패에 펭귄 마을이 공개 상태여야 합니다.'));
                break;
              case '펭귄 용사':
                if (!isMyTurn && canUseEffect('펭귄 용사', 2))
                  addBtn('② 패로 + 마법 회수', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 2));
                break;
              case '펭귄의 전설':
                if (!isMyTurn && canUseEffect('펭귄의 전설', 2))
                  addBtn('② 패로 + 묘지 소환', 'btn-secondary', () => activatePenguinFieldEffect(fieldIdx, 2));
                break;
              case '카드의 흑기사':
                if (canUseEffect('카드의 흑기사',1))
                  addBtn('① 필드 카드 1장 묘지로', 'btn-secondary', () => { if (typeof activateFieldEffect === 'function') activateFieldEffect(fieldIdx, 1); else notify('이 효과는 현재 버전에서 사용할 수 없습니다.'); });
                if (canUseEffect('카드의 흑기사',2))
                  addBtn('② 상대 효과 무효(체인)', 'btn-secondary', () => notify('카드의 흑기사 ②는 상대 효과 발동 시 체인으로 자동 선택됩니다.'));
                break;
              case '풀려난 항아리의 마귀':
                if (isMyTurn && currentPhase === 'attack' && canUseEffect('풀려난 항아리의 마귀',2))
                  addBtn('② 서치 + 공격력 +1', 'btn-secondary', () => { if (typeof activateFieldEffect === 'function') activateFieldEffect(fieldIdx, 2); else notify('이 효과는 현재 버전에서 사용할 수 없습니다.'); });
                break;
              case '카드 세계의 영웅':
                addBtn('② 영웅의 탄생 서치(체인)', 'btn-secondary', () => notify('상대 조건 효과 발동 시 체인으로 자동 선택됩니다.'));
                break;
              case '펭귄 마법사':
                addBtn('③ 자동 트리거 효과 (수동 발동 불가)', 'btn-secondary', () => notify('펭귄 마법사 ③은 펭귄 마을 효과로 묘지로 보내졌을 때 자동 발동합니다.'));
                break;
              // ── 지배자 필드 효과 ──
              case '수원소의 지배자':
                // ②: 전개 단계 → 덱에서 지배자 몬스터 소환
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('수원소의 지배자',2))
                  addBtn('② 덱에서 지배자 소환', 'btn-secondary', () => activateJibaejaShui2(fieldIdx));
                // ③: 전개 단계 → 덱에서 지배룡 소환 + 패 버리기
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('수원소의 지배자',3))
                  addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '수원소의 지배자'));
                break;
              case '화원소의 지배자':
                // ②: 전개 단계 → 덱에서 지배자 몬스터 패에 넣기
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('화원소의 지배자',2))
                  addBtn('② 덱에서 지배자 패에 넣기', 'btn-secondary', () => activateJibaejaHwa2(fieldIdx));
                // ③: 전개 단계 → 덱에서 지배룡 소환 + 패 버리기
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('화원소의 지배자',3))
                  addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '화원소의 지배자'));
                break;
              case '전원소의 지배자':
                // ②는 소환 유발 (onSummon에서 자동 트리거) — 수동 버튼 없음
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('전원소의 지배자',3))
                  addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '전원소의 지배자'));
                break;
              case '풍원소의 지배자':
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('풍원소의 지배자',3))
                  addBtn('③ 덱에서 지배룡 소환 + 패 버리기', 'btn-secondary', () => activateJibaeja3(fieldIdx, '풍원소의 지배자'));
                break;
              case '수원소의 지배룡':
              case '화원소의 지배룡':
              case '전원소의 지배룡':
              case '풍원소의 지배룡':
                if (isMyTurn && canUseEffect(mon.id,3))
                  addBtn('③ 필드→묘지 + 지배자 버리고 드로우', 'btn-secondary', () => activateJibaeryong3(fieldIdx, mon.id));
                break;
              case '사원소의 지배룡':
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('사원소의 지배룡',1))
                  addBtn('① 지배자 2장 서치 + 버리기', 'btn-secondary', () => activateSaWonsoJibaeryong1(fieldIdx));
                // ②: 자신/상대 공격 단계, 내 패 < 상대 패
                if (currentPhase === 'attack' && G.myHand.length < G.opHand.length && canUseEffect('사원소의 지배룡',2))
                  addBtn('② ATK +(상대패-내패) 상승', 'btn-secondary', () => activateSaWonsoJibaeryong2(fieldIdx));
                if (G.myHand.length <= 5 && canUseEffect('사원소의 지배룡',3))
                  addBtn('③ 효과 무효 + 패 2장 버리기', 'btn-secondary', () => tryActivateSaWonsoJibaeryong3());
                break;
              case '사원소의 지배자':
                if (isMyTurn && currentPhase === 'deploy' && canUseEffect('사원소의 지배자',1))
                  addBtn('① 지배룡 2장 서치 + 버리기', 'btn-secondary', () => activateSaWonsoJibaeja1(fieldIdx));
                if (canUseEffect('사원소의 지배자',2))
                  addBtn('② 제외 후 지배자/지배룡 소환', 'btn-secondary', () => activateSaWonsoJibaeja2(fieldIdx));
                if (G.myHand.length <= 5 && canUseEffect('사원소의 지배자',3))
                  addBtn('③ 상대 필드 카드 묘지 + 패 버리기', 'btn-secondary', () => tryActivateSaWonsoJibaeja3());
                break;
            }
          }
        }

        if (handIdx === -2) {
          // 묘지에서 열린 경우 — 조건 체크 후 버튼 표시
          switch(cardId) {
            case '펭귄!돌격!':
              { const hp = G.myHand.filter(c => isPenguinMonster(c.id));
                if (hp.length > 0)
                  addBtn('② 패에서 펭귄 소환 (묘지 제외)', 'btn-secondary', () => activateGraveEffect(cardId));
                else
                  addBtn('② 패에 펭귄 몬스터 없음', 'btn-secondary', () => notify('패에 펭귄 몬스터가 없습니다.')); }
              break;
            case '펭귄의 영광':
            case '펭귄이여 영원하라':
              addBtn('② 묘지 제외 → 드로우', 'btn-secondary', () => activateGraveEffect(cardId));
              break;
            case '지배의 사슬':
              if (!isMyTurn && canUseEffect('지배의 사슬',2))
                addBtn('② 묘지 제외 → 제외 카드 덱으로 + 드로우 (상대 턴)', 'btn-secondary', () => activateJibaeSasl2());
              break;
            case '지배룡과 지배자':
              if (canUseEffect('지배룡과 지배자',2))
                addBtn('② 묘지 제외 → 드로우', 'btn-secondary', () => activateJibaeryongJibaeja2());
              break;
            case '풍원소의 지배자':
              if (canUseEffect('풍원소의 지배자',2) && G.myGrave.some(c=>c.id==='풍원소의 지배자'))
                addBtn('② 지배룡 묘지 → 이 카드 소환 (자신/상대 턴)', 'btn-secondary', () => activateJibaejaFung2());
              break;
            default:
              addBtn('묘지 효과 발동', 'btn-secondary', () => activateGraveEffect(cardId));
          }
        }
      }
    } catch(e) {
      console.error('버튼 생성 오류:', e);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.textContent = '닫기';
    closeBtn.onclick = () => closeModal('cardDetailModal');
    actions.appendChild(closeBtn);

    document.getElementById('cardDetailModal').classList.remove('hidden');
  } catch(e) {
    console.error('openCardDetail 오류:', e);
    // 최소한 모달은 열기
    document.getElementById('mdCardName').textContent = cardId;
    document.getElementById('mdCardEffects').textContent = CARDS[cardId]?.effects || '';
    document.getElementById('mdCardActions').innerHTML = '<button class="btn btn-secondary" onclick="closeModal(\'cardDetailModal\')">닫기</button>';
    document.getElementById('cardDetailModal').classList.remove('hidden');
  }
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// PHASE MANAGEMENT
// ─────────────────────────────────────────────
function advancePhase(phase) {
  currentPhase = phase;
  G.phase = phase;
  ['Draw','Deploy','Attack','End'].forEach(p => {
    document.getElementById('ph' + p).classList.toggle('active', phase === p.toLowerCase());
  });
  renderPhase();
}

// ─────────────────────────────────────────────
// MODAL HELPERS
// ─────────────────────────────────────────────
function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('hidden');
}

function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// CARD PICKER MODAL
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// CARD PICKER — 큐 기반 (중첩 호출 안전)
// ─────────────────────────────────────────────

// picker 모달이 실제로 화면에 떠 있는지 확인한다.
function isPickerModalVisible() {
  const modal = document.getElementById('cardPickerModal');
  if (!modal) return false;
  if (modal.classList && modal.classList.contains('hidden')) return false;
  if (modal.style && modal.style.display === 'none') return false;
  return true;
}

// pickerRunning이 true인데 모달이 보이지 않는 "stale lock"을 감지해 복구한다.
// 렌더 중 예외나 외부에서 모달이 닫히는 경우 등으로 락이 영구히 걸려
// 이후 모든 picker가 표시되지 않는 잼(jam)을 자동으로 푼다.
function recoverStalePickerLock() {
  if (pickerRunning && !isPickerModalVisible()) {
    if (window.HB_DEBUG_PICKER) console.warn('[picker] stale lock 감지 → 자동 복구');
    pickerRunning = false;
    return true;
  }
  return false;
}

// 외부에서 호출하는 함수
function openCardPicker(cards, title, maxPick, callback, forced = false) {
  if (window.HB_DEBUG_PICKER) console.log('[picker] openCardPicker called', { title, count: maxPick, cards: (cards || []).length, pickerRunning, queueLen: pickerQueue.length });
  if (!cards || cards.length === 0) { callback([]); return; }
  pickerQueue.push({ cards: [...cards], title, maxPick: Math.min(maxPick, cards.length), callback, forced });
  // 새 picker 요청 시점에 stale lock을 먼저 치유한다(잼 자동 복구).
  recoverStalePickerLock();
  if (!pickerRunning) runNextPicker();
  else if (window.HB_DEBUG_PICKER) console.warn('[picker] queue was already running. New picker queued and will wait. Run window._resetPickerQueue() to unjam.');
}

// 큐가 잠긴 상태에서 새 picker가 표시되지 않을 때 수동 복구용.
// pickerRunning이 true인데 모달이 보이지 않으면 호출해서 큐를 리셋한다.
window._resetPickerQueue = function() {
  pickerQueue.length = 0;
  pickerRunning = false;
  pickerSelected = [];
  try { closeModal('cardPickerModal'); } catch (_) {}
  console.log('[picker] queue reset.');
};

// 워치독: 락이 걸렸는데 모달이 안 보이고 대기 중인 picker가 있으면 자동으로 재표시한다.
// 네트워크전에서 내 picker가 잼나면 상대 클라이언트가 무한 대기하는 것을 막는 안전망.
if (typeof window !== 'undefined' && !window.__pickerWatchdog) {
  window.__pickerWatchdog = setInterval(function pickerWatchdog() {
    if (pickerRunning && pickerQueue.length > 0 && !isPickerModalVisible()) {
      if (window.HB_DEBUG_PICKER) console.warn('[picker] 워치독: stale lock + 대기 picker → 재표시');
      pickerRunning = false;
      try { runNextPicker(); } catch (e) { console.error('[picker] 워치독 복구 실패:', e); pickerRunning = false; }
    }
  }, 1500);
}

// index.html의 취소 버튼이 호출하는데 정의가 없어 ReferenceError가 발생하던 함수.
// 취소 = 콜백을 빈 배열로 호출하여 효과 발동을 중단.
function cancelPick() {
  if (pickerQueue.length === 0) { pickerRunning = false; closeModal('cardPickerModal'); return; }
  const { callback, forced } = pickerQueue[0];
  if (forced) { notify('이 picker는 취소할 수 없습니다.'); return; }
  closeModal('cardPickerModal');
  pickerQueue.shift();
  pickerSelected = [];
  try { callback([]); } catch (e) { console.error('picker 취소 콜백 오류:', e); }
  if (pickerQueue.length > 0) setTimeout(runNextPicker, 150);
  else pickerRunning = false;
}
window.cancelPick = cancelPick;

function runNextPicker() {
  if (window.HB_DEBUG_PICKER) console.log('[picker] runNextPicker queueLen:', pickerQueue.length);
  if (pickerQueue.length === 0) { pickerRunning = false; return; }
  pickerRunning = true;
  const { cards, title, maxPick, forced } = pickerQueue[0];
  pickerSelected = [];
  pickerCurrentCards = cards;

  try {
    const modal = document.getElementById('cardPickerModal');
    const titleEl = document.getElementById('pickerTitle');
    if (!modal || !titleEl) {
      console.error('[picker] cardPickerModal/pickerTitle DOM 요소가 없습니다. 큐를 리셋합니다.');
      pickerQueue.shift();
      pickerRunning = false;
      return;
    }
    titleEl.textContent = title;
    document.getElementById('pickerDesc').textContent = forced
      ? `⚠️ 반드시 ${maxPick}장 선택 (취소 불가)`
      : maxPick === 0 ? '선택 없이 확인 가능' : `최대 ${maxPick}장 선택`;

    // 강제 모드일 때 닫기 버튼 숨기기
    const cancelBtn = document.querySelector('#cardPickerModal .btn-secondary');
    if (cancelBtn) cancelBtn.style.display = forced ? 'none' : '';

    const grid = document.getElementById('pickerGrid');
    grid.innerHTML = '';
    cards.forEach((c, i) => {
      const el = renderCard(c);
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const idx = pickerSelected.indexOf(i);
        if (idx >= 0) {
          pickerSelected.splice(idx, 1);
          el.classList.remove('selected');
        } else if (pickerSelected.length < maxPick) {
          pickerSelected.push(i);
          el.classList.add('selected');
          // maxPick이 1이면 바로 확정
          if (maxPick === 1) confirmPick();
        }
      });
      grid.appendChild(el);
    });

    modal.classList.remove('hidden');
    if (window.HB_DEBUG_PICKER) console.log('[picker] modal hidden class removed. classList:', modal.classList.toString(), 'inline display:', modal.style.display);
  } catch (err) {
    // 렌더 도중 예외가 나도 락을 풀어 잼을 방지한다. 문제가 된 picker는 건너뛰고 다음으로 진행.
    console.error('[picker] runNextPicker 렌더 오류 → 해당 picker 건너뜀:', err);
    if (typeof notify === 'function') notify('카드 선택창 표시 오류: ' + err.message);
    pickerQueue.shift();
    pickerRunning = false;
    if (pickerQueue.length > 0) setTimeout(runNextPicker, 150);
  }
}

function confirmPick() {
  if (pickerQueue.length === 0) { pickerRunning = false; closeModal('cardPickerModal'); return; }
  const { callback, forced, maxPick } = pickerQueue[0];

  // 강제 모드: 아무것도 선택 안 하면 닫히지 않음
  if (forced && pickerSelected.length === 0) {
    notify('반드시 카드를 선택해야 합니다!');
    return;
  }

  closeModal('cardPickerModal');
  pickerQueue.shift();
  const selected = [...pickerSelected];
  pickerSelected = [];

  // 닫기 버튼 복원
  const cancelBtn = document.querySelector('#cardPickerModal .btn-secondary');
  if (cancelBtn) cancelBtn.style.display = '';

  try { callback(selected); } catch(e) { console.error('picker 콜백 오류:', e); notify('효과 처리 오류: ' + e.message); }
  if (pickerQueue.length > 0) setTimeout(runNextPicker, 150);
  else pickerRunning = false;
}

// ─────────────────────────────────────────────
// ZONE VIEWER
// ─────────────────────────────────────────────
function showZone(zoneKey) {
  const zoneMap = {
    myKeyDeck: { label: '내 키 카드 덱', cards: G.myKeyDeck, canActivate: false },
    myGrave: { label: '내 묘지', cards: G.myGrave, canActivate: true },
    opGrave: { label: '상대 묘지', cards: G.opGrave, canActivate: false },
    myExile: { label: '내 제외 존', cards: G.myExile, canActivate: false },
    opExile: { label: '상대 제외 존', cards: G.opExile, canActivate: false },
  };
  const zone = zoneMap[zoneKey];
  document.getElementById('zoneViewTitle').textContent = zone.label;
  const grid = document.getElementById('zoneViewGrid');
  grid.innerHTML = '';
  if (zone.cards.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-dim);font-size:.85rem">카드 없음</p>';
  } else {
    zone.cards.forEach(c => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex'; wrapper.style.flexDirection = 'column'; wrapper.style.gap = '4px'; wrapper.style.alignItems = 'center';
      const el = renderCard(c);
      el.addEventListener('click', () => openCardDetail(c.id, zone.canActivate ? -2 : -1));
      wrapper.appendChild(el);
      if (zone.canActivate) {
        let renderedNewZoneButtons = false;
        if (window.HB_LEGACY_BRIDGE && window.HB_LEGACY_BRIDGE.isNewEngineCard(c)) {
          try {
            const available = window.HB_EFFECT_UI.getAvailableEffects({
              gameState: G,
              player: 'me',
              controller: 'me',
              card: c,
              cardId: c.id,
              zone: 'grave',
              sourceZone: 'grave',
            });
            available.forEach(entry => {
              const btn = document.createElement('button');
              btn.className = 'btn-sm';
              btn.textContent = entry.label || '효과 발동';
              btn.onclick = () => {
                closeModal('zoneViewModal');
                const result = window.HB_EFFECT_UI.activateAvailableEffect(entry);
                if (result && result.ok === false) notify(result.error || '효과를 발동할 수 없습니다.');
              };
              wrapper.appendChild(btn);
            });
            renderedNewZoneButtons = available.length > 0;
          } catch (err) {
            console.error('[ui] 묘지 신엔진 버튼 생성 오류:', err);
          }
        }

        if (!renderedNewZoneButtons) {
          const hasGraveEffect = ['펭귄!돌격!','펭귄의 영광','펭귄이여 영원하라'].includes(c.id);
          if (hasGraveEffect) {
            const btn = document.createElement('button');
            btn.className = 'btn-sm';
            btn.textContent = '효과 발동';
            btn.onclick = () => { closeModal('zoneViewModal'); activateGraveEffect(c.id); };
            wrapper.appendChild(btn);
          }
        }
      }
      grid.appendChild(wrapper);
    });
  }
  document.getElementById('zoneViewModal').classList.remove('hidden');
}

function viewFieldCard(who) {
  const card = who === 'me' ? G.myFieldCard : G.opFieldCard;
  if (!card) { notify('필드 존이 비어있습니다.'); return; }

  // 14단계: 필드 존 카드는 별도 zone으로 열어서 EffectDefinition 기반 버튼/지속 설명을 표시한다.
  openCardDetail(card.id, -3, who !== 'me');

  if (who !== 'me' && window.HB_LEGACY_BRIDGE && typeof window.HB_LEGACY_BRIDGE.routeFieldZoneClick === 'function') {
    try {
      window.HB_LEGACY_BRIDGE.routeFieldZoneClick(card, {
        gameState: G,
        player: 'opponent',
        controller: 'opponent',
        actionsElement: document.getElementById('mdCardActions'),
      });
    } catch (err) {
      console.error('[ui] 상대 필드 존 지속 설명 표시 오류:', err);
    }
  }
}
// ─────────────────────────────────────────────
// DECK BUILDER
// ─────────────────────────────────────────────
let builderMainDeck = {}; // {cardId: count}
let builderKeyDeck = {};  // {cardId: 1}
let currentPoolFilter = '전체';
let deckSearchQuery = '';
let deckSortMode = 'default';

// 범용 카드 (테마 없는 것들)
const GENERIC_CARDS = ['구사일생','눈에는 눈','출입통제','유혹의 황금사과','수호의 빛','신성한 수호자','서치 봉인의 항아리','단단한 카드 자물쇠','영웅의 탄생'];
const GENERIC_KEY_CARDS = ['일격필살','단 한번의 기회','카드의 흑기사','풀려난 항아리의 마귀','카드 세계의 영웅'];

function isAdminUser() {
  return !!window.userProfile?.isAdmin;
}

function getOwnedCardSet() {
  if (isAdminUser()) return null;
  const owned = new Set(window.userProfile?.unlockedCards || []);
  return owned;
}

// 신엔진으로 이식되지 않아 사용이 차단된 테마.
// 이 테마의 카드는 덱 풀/검색/저장된 덱에서 자동 제외된다.
const UNSUPPORTED_THEMES = new Set(['타이거','라이거','마피아','불가사의']);

function isCardSupported(cardId) {
  const card = CARDS && CARDS[cardId];
  if (!card) return false;
  if (UNSUPPORTED_THEMES.has(card.theme)) return false;
  return true;
}

function canUseCard(cardId) {
  if (!isCardSupported(cardId)) return false;
  const owned = getOwnedCardSet();
  if (!owned) return true;
  return owned.has(cardId);
}

function openDeckBuilder() {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('deckBuilder').style.display = 'flex';
  const noDeck = Object.keys(builderMainDeck).length === 0;
  const starter = window.userProfile?.starterDeckMain || [];
  if (noDeck && starter.length) {
    builderMainDeck = {};
    starter.forEach(id => { builderMainDeck[id] = (builderMainDeck[id] || 0) + 1; });
    builderKeyDeck = {};
    (window.userProfile?.starterDeckKey || []).forEach(id => { builderKeyDeck[id] = 1; });
    notify('신규 유저 스타터 덱이 적용되었습니다.');
  }
  filterDeckPool('전체');
  renderBuilderDeck();
}


function setDeckSearch(q) {
  deckSearchQuery = (q || '').trim().toLowerCase();
  filterDeckPool(currentPoolFilter);
}

function sortBuilderDeckByName() {
  deckSortMode = 'name';
  renderBuilderDeck();
}

function sortBuilderDeckByCount() {
  deckSortMode = 'count';
  renderBuilderDeck();
}

function filterDeckPool(theme) {
  currentPoolFilter = theme;
  document.querySelectorAll('.deck-tab').forEach(t => {
    t.classList.toggle('active', t.textContent === theme);
  });
  const pool = document.getElementById('dbPool');
  pool.innerHTML = '';
  Object.values(CARDS).forEach(card => {
    if (!canUseCard(card.id)) return;
    if (card.isKeyCard) return; // 키카드는 별도 처리
    const matchTheme = theme === '전체' ? true :
      theme === '범용' ? GENERIC_CARDS.includes(card.id) :
      (card.theme === theme);
    if (!matchTheme) return;
    if (deckSearchQuery && !card.name.toLowerCase().includes(deckSearchQuery)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'pool-card';
    wrapper.title = card.name;
    const el = renderCard({ id: card.id, name: card.name });
    el.style.cursor = 'pointer';
    // 현재 덱에 몇 장인지 배지
    const inDeck = builderMainDeck[card.id] || 0;
    if (inDeck > 0) {
      const badge = document.createElement('div');
      badge.className = 'card-in-deck';
      badge.textContent = inDeck;
      wrapper.appendChild(badge);
    }
    el.addEventListener('click', () => addToDeck(card.id, false));
    el.addEventListener('dblclick', () => openCardDetail(card.id));
    wrapper.appendChild(el);
    pool.appendChild(wrapper);
  });
  // 키카드 풀
  Object.values(CARDS).filter(c => c.isKeyCard).forEach(card => {
    const keyMatchTheme = theme === '전체' ? true : (theme === '범용' ? GENERIC_KEY_CARDS.includes(card.id) : card.theme === theme);
    if (!keyMatchTheme) return;
      if (!canUseCard(card.id)) return;
      if (deckSearchQuery && !card.name.toLowerCase().includes(deckSearchQuery)) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'pool-card';
      const el = renderCard({ id: card.id, name: card.name });
      el.style.cursor = 'pointer';
      el.style.border = '1.5px solid #7c5cbf';
      const inKey = builderKeyDeck[card.id] ? 1 : 0;
      if (inKey) {
        const badge = document.createElement('div');
        badge.className = 'card-in-deck';
        badge.style.background = '#7c5cbf';
        badge.textContent = '✓';
        wrapper.appendChild(badge);
      }
      el.addEventListener('click', () => addToDeck(card.id, true));
      wrapper.appendChild(el);
      pool.appendChild(wrapper);
    });
}

function addToDeck(cardId, isKey) {
  const card = CARDS[cardId];
  if (!card) return;
  if (!canUseCard(cardId)) { notify('보유한 카드만 사용할 수 있습니다.'); return; }
  if (isKey) {
    if (builderKeyDeck[cardId]) {
      delete builderKeyDeck[cardId];
    } else {
      if (Object.keys(builderKeyDeck).length >= 10) { notify('키카드 덱은 최대 10종입니다.'); return; }
      builderKeyDeck[cardId] = 1;
    }
  } else {
    const cur = builderMainDeck[cardId] || 0;
    const total = Object.values(builderMainDeck).reduce((a,b) => a+b, 0);
    if (cur >= 4) { notify('같은 카드는 최대 4장입니다.'); return; }
    if (total >= 60) { notify('메인 덱은 최대 60장입니다.'); return; }
    builderMainDeck[cardId] = cur + 1;
  }
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

function removeFromBuilderDeck(cardId, isKey) {
  if (isKey) {
    delete builderKeyDeck[cardId];
  } else {
    if (builderMainDeck[cardId] > 1) builderMainDeck[cardId]--;
    else delete builderMainDeck[cardId];
  }
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

function renderBuilderDeck() {
  const mainTotal = Object.values(builderMainDeck).reduce((a,b) => a+b, 0);
  const keyTotal = Object.keys(builderKeyDeck).length;
  document.getElementById('dbMainCount').textContent = mainTotal;
  document.getElementById('dbKeyCount').textContent = keyTotal;

  // 메인 덱 목록
  const mainList = document.getElementById('dbMainList');
  mainList.innerHTML = '';
  let mainEntries = Object.entries(builderMainDeck);
  if (deckSortMode === 'name') mainEntries.sort((a, b) => (CARDS[a[0]]?.name || a[0]).localeCompare(CARDS[b[0]]?.name || b[0], 'ko'));
  else if (deckSortMode === 'count') mainEntries.sort((a, b) => (b[1]-a[1]) || (CARDS[a[0]]?.name || a[0]).localeCompare(CARDS[b[0]]?.name || b[0], 'ko'));

  mainEntries.forEach(([id, count]) => {
    const chip = document.createElement('div');
    chip.className = 'deck-card-chip';
    chip.innerHTML = `<span class="chip-count">${count}x</span>${CARDS[id]?.name || id}`;
    chip.title = '클릭하면 1장 제거';
    chip.addEventListener('click', () => removeFromBuilderDeck(id, false));
    mainList.appendChild(chip);
  });

  // 키카드 덱 목록
  const keyList = document.getElementById('dbKeyList');
  keyList.innerHTML = '';
  const keyEntries = Object.keys(builderKeyDeck).sort((a, b) => (CARDS[a]?.name || a).localeCompare(CARDS[b]?.name || b, 'ko'));
  keyEntries.forEach(id => {
    const chip = document.createElement('div');
    chip.className = 'deck-card-chip';
    chip.style.borderColor = '#7c5cbf';
    chip.innerHTML = `<span style="color:#9c7cdf">🔑</span>${CARDS[id]?.name || id}`;
    chip.title = '클릭하면 제거';
    chip.addEventListener('click', () => removeFromBuilderDeck(id, true));
    keyList.appendChild(chip);
  });

  // 확정 버튼 활성화 조건: 메인 40~60장
  const ok = mainTotal >= 40 && mainTotal <= 60;
  document.getElementById('dbConfirmBtn').disabled = !ok;
  document.getElementById('dbConfirmBtn').textContent = ok ? `덱 확정 (${mainTotal}장) →` : `덱 확정 (${mainTotal}장, 40~60장 필요)`;
}

function loadPreset(theme) {
  if (theme === '펭귄') {
    builderMainDeck = {
      '펭귄 마을':4,'꼬마 펭귄':4,'펭귄 부부':4,'현자 펭귄':4,
      '수문장 펭귄':4,'펭귄!돌격!':4,'펭귄의 영광':4,
      '펭귄이여 영원하라':4,'펭귄 마법사':4,'구사일생':2,'눈에는 눈':2,
    };
    builderKeyDeck = { '펭귄 용사':1, '펭귄의 일격':1, '펭귄의 전설':1, '일격필살':1, '단 한번의 기회':1, '카드의 흑기사':1, '풀려난 항아리의 마귀':1, '카드 세계의 영웅':1 };
    notify('펭귄 기본 덱 로드!');
  } else if (theme === '지배자') {
    // 지배자/지배룡 기본덱
    // 메인덱: 지배자 4종×4 + 지배룡 4종×4 + 지배의 사슬×4 + 지배룡과 지배자×4 + 범용 8장 = 48장
    builderMainDeck = {
      '수원소의 지배자':4, '화원소의 지배자':4,
      '전원소의 지배자':4, '풍원소의 지배자':4,
      '수원소의 지배룡':4, '화원소의 지배룡':4,
      '전원소의 지배룡':4, '풍원소의 지배룡':4,
      '지배의 사슬':4, '지배룡과 지배자':4,
      '눈에는 눈':2, '출입통제':2,
      '단단한 카드 자물쇠':2, '구사일생':2,
    };
    // 키카드덱: 사원소 2종 + 기적 + 범용 2종
    builderKeyDeck = {
      '사원소의 지배룡':1, '사원소의 지배자':1,
      '사원소의 기적':1, '일격필살':1, '단 한번의 기회':1, '카드의 흑기사':1, '풀려난 항아리의 마귀':1, '카드 세계의 영웅':1,
    };
    notify('지배자/지배룡 기본 덱 로드!');
  } else if (theme === '엘리멘츠') {
    builderMainDeck = {
      '엘리멘츠의 불꽃정령':4, '엘리멘츠의 물정령':4,
      '엘리멘츠의 전기정령':4, '엘리멘츠의 바람정령':4,
      '엘리멘츠 in rainbow forest':4, '엘리멘츠 is fairy!!!':4,
      '엘리멘츠의 MAGIC':4, '엘리멘츠의 TR∀P':4,
      '엘리멘츠의 마법':4, '궁극의 엘리멘츠':4,
      '구사일생':2, '눈에는 눈':2,
    };
    builderKeyDeck = {
      '엘리멘츠의 ♤♡◇♧':1, '엘리멘츠의 궁극신':1,
      '엘리멘츠의 궁극 창조신':1, '일격필살':1, '단 한번의 기회':1, '카드의 흑기사':1, '풀려난 항아리의 마귀':1, '카드 세계의 영웅':1,
    };
    notify('엘리멘츠 기본 덱 로드!');
  } else if (theme === '서커스메어') {
    builderMainDeck = {
      '서커스메어 메드 울프':4,'서커스메어 메드 베어':4,'서커스메어 메드 이글':4,'서커스메어 메드 씰':4,
      '서커스메어 크라운 드래곤':4,'서커스메어 퓨전':4,'서커스메어 메드 퍼레이드':4,
      '악몽 융합':4,'광란의 서커스':4,'악몽의 서커스장':4,'구사일생':2,'눈에는 눈':2,
    };
    builderKeyDeck = {
      '서커스메어 스프링 제스터':1,'서커스메어 메드 키메라':1,'서커스메어 코인 제스터':1,
      '서커스메어 마스크 제스터':1,'서커스메어 퍼핏 마스터':1,'일격필살':1,'단 한번의 기회':1,'카드의 흑기사':1,
    };
    notify('서커스메어 기본 덱 로드! (메인 40장)');
  } else if (theme === '라이온') {
    builderMainDeck = {
      '베이비 라이온':4,'젊은 라이온':4,'에이스 라이온':4,
      '사자의 포효':4,'사자의 사냥':4,'사자의 발톱':4,
      '사자의 일격':4,'진정한 사자':4,'고고한 사자':4,
      '구사일생':2,'눈에는 눈':2,'출입통제':2,
    };
    builderKeyDeck = { '라이온 킹':1,'일격필살':1,'단 한번의 기회':1,'카드의 흑기사':1,'풀려난 항아리의 마귀':1,'카드 세계의 영웅':1 };
    notify('라이온 기본 덱 로드! (메인 42장)');
  } else if (theme === '크툴루' || theme === '올드원') {
    builderMainDeck = {
      '그레이트 올드 원-크툴루':4,'그레이트 올드 원-크투가':4,
      '그레이트 올드 원-크아이가':4,'그레이트 올드 원-과타노차':4,
      '엘더 갓-노덴스':4,'엘더 갓-크타니트':4,'엘더 갓-히프노스':4,
      '올드_원의 멸망':4,'눈에는 눈':2,'구사일생':2,'출입통제':2,'유혹의 황금사과':2,
    };
    builderKeyDeck = {
      '아우터 갓 니알라토텝':1,'아우터 갓-아자토스':1,'아우터 갓 슈브 니구라스':1,
      '일격필살':1,'단 한번의 기회':1,'카드의 흑기사':1,'풀려난 항아리의 마귀':1,'카드 세계의 영웅':1,
    };
    notify('크툴루/올드원 기본 덱 로드! (메인 40장)');
  }
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

window.createStarterDeckFromTheme = function(theme) {
  const prevMain = builderMainDeck;
  const prevKey = builderKeyDeck;
  builderMainDeck = {};
  builderKeyDeck = {};
  loadPreset(theme);
  const main = [];
  Object.entries(builderMainDeck).forEach(([id, count]) => { for (let i = 0; i < count; i++) main.push(id); });
  const key = Object.keys(builderKeyDeck);
  builderMainDeck = prevMain;
  builderKeyDeck = prevKey;
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
  return { main, key };
};

function clearDeck() {
  builderMainDeck = {};
  builderKeyDeck = {};
  renderBuilderDeck();
  filterDeckPool(currentPoolFilter);
}

function confirmDeck() {
  const mainTotal = Object.values(builderMainDeck).reduce((a,b) => a+b, 0);
  if (mainTotal < 40 || mainTotal > 60) { notify('메인 덱은 40~60장이어야 합니다.'); return; }

  const deckArr = [];
  let mainEntries = Object.entries(builderMainDeck);
  if (deckSortMode === 'name') mainEntries.sort((a, b) => (CARDS[a[0]]?.name || a[0]).localeCompare(CARDS[b[0]]?.name || b[0], 'ko'));
  else if (deckSortMode === 'count') mainEntries.sort((a, b) => (b[1]-a[1]) || (CARDS[a[0]]?.name || a[0]).localeCompare(CARDS[b[0]]?.name || b[0], 'ko'));

  mainEntries.forEach(([id, count]) => {
    for (let i = 0; i < count; i++) deckArr.push(id);
  });
  const keyArr = Object.keys(builderKeyDeck);

  if (!isAdminUser()) {
    const invalid = [...new Set([...deckArr, ...keyArr].filter(id => !canUseCard(id)))];
    if (invalid.length) {
      notify('보유하지 않은 카드가 덱에 포함되어 있습니다: ' + invalid.slice(0, 5).join(', '));
      return;
    }
  }

  window._confirmedDeck = deckArr;
  window._confirmedKeyDeck = keyArr;

  document.getElementById('deckBuilder').style.display = 'none';

  if (!roomRef) {
    // DEMO 모드 — 바로 게임 시작
    enterGameWithDeck();
    return;
  }

  // 대기 오버레이 표시 (로비로 돌아가지 않음!)
  const overlay = document.createElement('div');
  overlay.id = 'waitingOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#000c;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;z-index:500;';
  overlay.innerHTML = `
    <div style="font-family:Black Han Sans,sans-serif;font-size:1.5rem;color:#c8a96e;letter-spacing:.1em;">덱 확정 완료!</div>
    <div style="color:#888;font-size:.9rem;">상대방의 덱 확정을 기다리는 중...</div>
    <div style="width:40px;height:40px;border:3px solid #2a2a45;border-top-color:#c8a96e;border-radius:50%;animation:spin .8s linear infinite;"></div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(overlay);

  // Firebase에 내 덱 준비 완료 신호
  roomRef.child(myRole + 'DeckReady').set(true);

  // 상대방도 준비됐는지 확인
  checkBothDecksReady(overlay);
}

let _deckReadyHandler = null;

function checkBothDecksReady(overlay) {
  if (!roomRef) { enterGameWithDeck(); return; }

  if (_deckReadyHandler) {
    roomRef.off('value', _deckReadyHandler);
    _deckReadyHandler = null;
  }

  _deckReadyHandler = function(snap) {
    const data = snap.val();
    if (!data) return;
    const hostReady = data.hostDeckReady === true;
    const guestReady = data.guestDeckReady === true;
    if (hostReady && guestReady) {
      roomRef.off('value', _deckReadyHandler);
      _deckReadyHandler = null;
      if (overlay) overlay.remove();
      enterGameWithDeck();
    }
  };

  roomRef.on('value', _deckReadyHandler);
}

function enterGameWithDeck() {
  gameResultRecorded = false;
  enterGame();
}
