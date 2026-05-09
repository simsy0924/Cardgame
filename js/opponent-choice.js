// opponent-choice.js — 상대 선택/응답 공통 네트워크 엔진
// - "상대가 고른다" 계열 효과를 실제 상대 클라이언트 선택으로 처리
// - 공격자가 상대 패 슬롯을 고르는 처리도 비공개 패 정보 노출 없이 처리
(function(){
  const pending = {};
  const handledRequests = new Set();
  const handledResponses = new Set();

  function uid() {
    return `choice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function safeNotify(msg) { try { if (typeof notify === 'function') notify(msg); } catch (_) {} }
  function safeLog(msg, cls) { try { if (typeof log === 'function') log(msg, cls || 'system'); } catch (_) {} }
  function canNetwork() { return !!(window.roomRef || (typeof roomRef !== 'undefined' && roomRef)) && typeof sendAction === 'function' && typeof myRole !== 'undefined' && !!myRole; }

  function normalizeOptions(options) {
    return (options || []).map((o, i) => {
      if (typeof o === 'string') return { id: `choice_opt_${i}`, name: o, payload: { index: i } };
      return {
        id: o.id || `choice_opt_${i}`,
        name: o.name || o.label || String(o.id || `선택지 ${i + 1}`),
        text: o.text || o.name || o.label || '',
        isPublic: o.isPublic !== false,
        payload: o.payload || { index: i },
      };
    });
  }

  function localPick(req, callback, fallback) {
    const options = normalizeOptions(req.options);
    if (!options.length) { if (fallback) fallback(); return; }
    if (typeof openCardPicker !== 'function') {
      callback([options[0]], { localFallback: true, selectedIndices: [0] });
      return;
    }
    openCardPicker(options, req.title || '효과 선택', req.maxPick || 1, (sel) => {
      const selected = (sel || []).map(i => options[i]).filter(Boolean);
      if (!selected.length && fallback) fallback();
      else callback(selected, { localFallback: true, selectedIndices: sel || [] });
    }, req.forced !== false);
  }

  function request(req, callback, fallback) {
    const options = normalizeOptions(req.options);
    const maxPick = Math.max(1, Math.min(req.maxPick || 1, options.length || 1));
    const requestId = req.requestId || uid();

    if (!canNetwork()) {
      localPick({ ...req, options, maxPick }, callback, fallback);
      return requestId;
    }

    pending[requestId] = {
      callback,
      fallback,
      options,
      createdAt: Date.now(),
      title: req.title || '효과 선택',
    };

    sendAction({
      type: 'choiceRequest',
      requestId,
      purpose: req.purpose || 'generic',
      title: req.title || '효과 선택',
      desc: req.desc || '',
      maxPick,
      forced: req.forced !== false,
      options: options.map((o, i) => ({
        id: o.id || `choice_opt_${i}`,
        name: o.name || o.text || `선택지 ${i + 1}`,
        text: o.text || o.name || '',
        payload: o.payload || { index: i },
        isPublic: o.isPublic !== false,
      })),
      context: req.context || {},
      requester: myRole,
    });

    safeNotify('상대의 선택을 기다리는 중입니다.');
    safeLog(`상대 선택 요청: ${req.title || '효과 선택'}`, 'system');
    return requestId;
  }

  function respondToChoiceRequest(action) {
    if (!action || !action.requestId) return true;
    if (handledRequests.has(action.requestId)) return true;
    handledRequests.add(action.requestId);

    const options = normalizeOptions(action.options || []);
    const maxPick = Math.max(1, Math.min(action.maxPick || 1, options.length || 1));
    const title = action.title ? `상대 요청: ${action.title}` : '상대 요청: 효과 선택';
    const forced = action.forced !== false;

    safeNotify('상대가 선택을 요청했습니다.');
    safeLog(`상대 선택 요청 수신: ${action.title || action.purpose || '효과 선택'}`, 'opponent');

    if (!options.length) {
      sendAction({ type: 'choiceResponse', requestId: action.requestId, purpose: action.purpose, selectedIndices: [], selectedOptions: [], context: action.context || {} });
      return true;
    }

    openCardPicker(options, title, maxPick, (sel) => {
      const selectedIndices = (sel || []).filter(i => Number.isInteger(i));
      const selectedOptions = selectedIndices.map(i => options[i]).filter(Boolean).map(o => ({
        id: o.id,
        name: o.name,
        text: o.text || o.name,
        payload: o.payload || {},
      }));
      sendAction({
        type: 'choiceResponse',
        requestId: action.requestId,
        purpose: action.purpose || 'generic',
        selectedIndices,
        selectedOptions,
        context: action.context || {},
      });
      safeLog(`선택 응답 전송: ${selectedOptions.map(o => o.name).join(', ') || '(없음)'}`, 'mine');
    }, forced);
    return true;
  }

  function receiveChoiceResponse(action) {
    if (!action || !action.requestId) return true;
    if (handledResponses.has(action.requestId)) return true;
    handledResponses.add(action.requestId);

    const p = pending[action.requestId];
    if (!p) return true;
    delete pending[action.requestId];

    const selected = (action.selectedOptions || []).map((o, idx) => {
      const index = Array.isArray(action.selectedIndices) ? action.selectedIndices[idx] : undefined;
      const original = Number.isInteger(index) ? p.options[index] : null;
      return original ? { ...original, ...o, payload: o.payload || original.payload || {} } : o;
    });

    safeLog(`상대 선택 완료: ${selected.map(o => o.name || o.text).join(', ') || '(없음)'}`, 'system');
    try { p.callback(selected, action); }
    catch (e) { console.error('choiceResponse 처리 오류:', e); safeNotify('상대 선택 처리 오류: ' + e.message); if (p.fallback) p.fallback(e); }
    return true;
  }

  function handleAttackerPicksDiscard(action) {
    const cnt = Math.max(0, Math.min(action.count || 0, (G.myHand || []).length));
    const reason = action.reason ? ` (${action.reason})` : '';
    if (cnt <= 0) return true;

    if (!canNetwork()) {
      // AI/로컬에서는 실제 상대 클라이언트가 없으므로 무작위 처리한다.
      const indices = [];
      for (let i = 0; i < cnt && G.myHand.length > 0; i++) indices.push(Math.floor(Math.random() * G.myHand.length));
      if (typeof _discardMyHandByIndices === 'function') _discardMyHandByIndices(indices);
      else indices.sort((a,b)=>b-a).forEach(i => { if (G.myHand[i]) G.myGrave.push(G.myHand.splice(i,1)[0]); });
      safeLog(`상대가 고르는 패 버리기${reason}: 로컬/AI 무작위 처리`, 'opponent');
      if (typeof sendGameState === 'function') sendGameState();
      if (typeof renderAll === 'function') renderAll();
      if (typeof checkWinCondition === 'function') checkWinCondition();
      return true;
    }

    const options = (G.myHand || []).map((c, i) => ({
      id: `hand_slot_${i}`,
      name: c && c.isPublic ? (c.name || c.id || `공개 패 ${i + 1}`) : `비공개 패 ${i + 1}`,
      payload: { handIdx: i },
      isPublic: true,
    }));

    request({
      purpose: 'forceDiscard.attackerPicks',
      title: `버릴 상대 패 ${cnt}장 선택${reason}`,
      desc: '비공개 패는 카드명 없이 슬롯만 보입니다.',
      options,
      maxPick: cnt,
      forced: true,
      context: { reason: action.reason || '', count: cnt },
    }, (selected) => {
      const indices = selected.map(o => o.payload && o.payload.handIdx).filter(i => Number.isInteger(i));
      safeLog(`상대가 내 패 ${indices.length}장 선택${reason}`, 'opponent');
      if (typeof _discardMyHandByIndices === 'function') _discardMyHandByIndices(indices);
      else indices.sort((a,b)=>b-a).forEach(i => { if (G.myHand[i]) G.myGrave.push(G.myHand.splice(i,1)[0]); });
      if (typeof sendGameState === 'function') sendGameState();
      if (typeof renderAll === 'function') renderAll();
      if (typeof checkWinCondition === 'function') checkWinCondition();
    }, () => {
      if (typeof forceDiscard === 'function') forceDiscard(cnt);
    });
    return true;
  }

  function handleNetworkAction(action) {
    if (!action || !action.type) return false;
    if (action.type === 'choiceRequest') return respondToChoiceRequest(action);
    if (action.type === 'choiceResponse') return receiveChoiceResponse(action);
    if (action.type === 'forceDiscard' && action.attackerPicks) return handleAttackerPicksDiscard(action);
    return false;
  }

  function patchOpponentActionHandler() {
    if (typeof window.handleOpponentAction !== 'function') { setTimeout(patchOpponentActionHandler, 50); return; }
    if (window.handleOpponentAction.__opponentChoicePatched) return;
    const old = window.handleOpponentAction;
    window.handleOpponentAction = function opponentChoiceHandleOpponentAction(action) {
      if (handleNetworkAction(action)) return;
      return old.apply(this, arguments);
    };
    window.handleOpponentAction.__opponentChoicePatched = true;
  }

  window.OpponentChoice = {
    request,
    localPick,
    handleNetworkAction,
    _pending: pending,
  };

  patchOpponentActionHandler();
})();
