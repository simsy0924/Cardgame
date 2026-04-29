// liger.js — 라이거 테마 효과 엔진

function _isLigerRelated(id) { return ['라이거','라이온','타이거'].includes(CARDS[id]?.theme); }
function _isSajaCard(id) { return id.includes('사자') || id === '진정한 사자' || id === '고고한 사자'; }
function _isHorangCard(id) { return id.includes('호랑이') || id === '진정한 호랑이' || id === '고고한 호랑이'; }

// ─── 발동 함수 ───
function _ligerActivate(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }

  // 발동 조건
  if (c.id === '화합의 시대의 라이거' && effectNum === 1) {
    if (!isMyTurn || currentPhase !== 'deploy') { notify('자신 전개 단계에만 발동 가능합니다.'); return; }
  }
  if (c.id === '에이스 라이거' && effectNum === 3) {
    if (currentPhase !== 'deploy') { notify('전개 단계에만 발동 가능합니다.'); return; }
    if (!G.myGrave.some(g => g.id==='모두의 자연')) { notify('묘지에 모두의 자연이 없습니다.'); return; }
  }
  if (c.id === '라이거 킹' && effectNum === 1) {
    if (!G.myField.some(m=>m.id==='라이온 킹') && !G.myGrave.some(g=>g.id==='라이온 킹')) { notify('라이온 킹이 필드/묘지에 필요합니다.'); return; }
    if (!G.myField.some(m=>m.id==='타이거 킹') && !G.myGrave.some(g=>g.id==='타이거 킹')) { notify('타이거 킹이 필드/묘지에 필요합니다.'); return; }
  }

  const effectText = _extractEffectText(card, effectNum);
  if (!effectText) { notify('효과 텍스트를 찾을 수 없습니다.'); return; }
  const { costText, mainText } = _splitCostAndMain(effectText);

  // 라이거 킹 ①: 코스트로 라이온 킹+타이거 킹 묻기
  if (c.id === '라이거 킹' && effectNum === 1) {
    const removeCost = (id) => {
      const fi = G.myField.findIndex(m=>m.id===id);
      if (fi >= 0) G.myGrave.push(G.myField.splice(fi,1)[0]);
    };
    removeCost('라이온 킹'); removeCost('타이거 킹');
    log('라이거 킹 ①: [코스트] 라이온 킹+타이거 킹 묘지','mine');
    markEffectUsed(c.id, effectNum);
    const chainEffect = { type:'themeEffect', label:'라이거 킹 ①', cardId:c.id, effectNum, theme:'라이거', mainText, extra:{ handIdx } };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
    return;
  }

  _payThemeCost(card, handIdx, costText, (paid) => {
    if (!paid) return;
    markEffectUsed(c.id, effectNum);
    const chainEffect = { type:'themeEffect', label:`${c.name} ${effectNum}`, cardId:c.id, effectNum, theme:'라이거', mainText, extra:{} };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
  });
}

// ─── 해결 함수 ───
function _ligerResolve(link) {
  const { cardId, effectNum, mainText, extra = {} } = link;

  switch(cardId) {
    case '화합의 시대의 라이거': {
      const deckLiger = findAllInDeck(d => CARDS[d.id]?.theme==='라이거' && CARDS[d.id]?.cardType==='monster');
      if (!deckLiger.length) { notify('덱에 라이거 몬스터가 없습니다.'); return; }
      openCardPicker(deckLiger,'화합의 시대의 라이거: 덱에서 라이거 소환',1,(sel)=>{
        if (sel.length) summonFromDeck(deckLiger[sel[0]].id);
        // 이후 패에서 라이거 소환 선택 (ATK -1)
        const handLiger = G.myHand.filter(h => CARDS[h.id]?.theme==='라이거' && CARDS[h.id]?.cardType==='monster');
        if (!handLiger.length) { sendGameState(); renderAll(); return; }
        openCardPicker(handLiger,'화합의 시대의 라이거: 패에서 라이거 소환? (ATK-1, 선택)',1,(sel2)=>{
          if (sel2.length) {
            const t=handLiger[sel2[0]]; const hi=G.myHand.findIndex(h=>h===t);
            if (hi>=0) { const mon=G.myHand.splice(hi,1)[0]; const ba=CARDS[mon.id]?.atk??4; G.myField.push({id:mon.id,name:mon.name,atk:Math.max(0,ba-1),atkBase:ba}); }
          }
          sendGameState(); renderAll();
        });
      });
      break;
    }
    case '베이비 라이거': {
      // 덱에서 라이온+타이거 각 1장 소환 → 이 카드 소환 선택
      const lionDeck  = findAllInDeck(d => CARDS[d.id]?.theme==='라이온' && CARDS[d.id]?.cardType==='monster');
      const tigerDeck = findAllInDeck(d => CARDS[d.id]?.theme==='타이거' && CARDS[d.id]?.cardType==='monster');
      const doSelf = () => {
        const hi = G.myHand.findIndex(h=>h.id==='베이비 라이거');
        if (hi < 0) { sendGameState(); renderAll(); return; }
        // "소환할 수 있다" = 선택
        openCardPicker([G.myHand[hi]],'베이비 라이거 ①: 자신 소환? (선택)',1,(sel)=>{
          if (sel.length) { const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??4,atkBase:CARDS[mon.id]?.atk??4}); log('베이비 라이거 ①: 소환','mine'); }
          sendGameState(); renderAll();
        });
      };
      const pickTiger = () => {
        if (!tigerDeck.length) { doSelf(); return; }
        openCardPicker(tigerDeck,'베이비 라이거 ①: 덱에서 타이거 소환',1,(sel)=>{ if(sel.length) summonFromDeck(tigerDeck[sel[0]].id); doSelf(); });
      };
      if (!lionDeck.length) { pickTiger(); return; }
      openCardPicker(lionDeck,'베이비 라이거 ①: 덱에서 라이온 소환',1,(sel)=>{ if(sel.length) summonFromDeck(lionDeck[sel[0]].id); pickTiger(); });
      break;
    }
    case '젊은 라이거': {
      if (effectNum === 1) {
        const sajaD = findAllInDeck(d => _isSajaCard(d.id));
        const horangD = findAllInDeck(d => _isHorangCard(d.id));
        const ph = () => {
          if (!horangD.length) { sendGameState(); renderAll(); return; }
          openCardPicker(horangD,'젊은 라이거 ①: 호랑이 카드 패로',1,(sel)=>{ if(sel.length) searchToHand(horangD[sel[0]].id); sendGameState(); renderAll(); });
        };
        if (!sajaD.length) { ph(); return; }
        openCardPicker(sajaD,'젊은 라이거 ①: 사자 카드 패로',1,(sel)=>{ if(sel.length) searchToHand(sajaD[sel[0]].id); ph(); });
      } else if (effectNum === 2) {
        const ld = findAllInDeck(d => CARDS[d.id]?.theme==='라이거');
        if (!ld.length) { notify('덱에 라이거 카드가 없습니다.'); return; }
        openCardPicker(ld,'젊은 라이거 ②: 라이거 카드 서치',1,(sel)=>{ if(sel.length) searchToHand(ld[sel[0]].id); sendGameState(); renderAll(); });
      }
      break;
    }
    case '에이스 라이거': {
      if (effectNum === 2) {
        // 자신 필드 몬스터 수까지 상대 패 덱으로 + 상대 드로우
        const count = Math.min(G.myField.length, G.opHand.length);
        if (count) { sendAction({ type:'forceReturnHand', count, reason:'에이스 라이거 ②' }); sendAction({ type:'opDraw', count:1 }); log(`에이스 라이거 ②: 상대 패 ${count}장 덱으로+드로우`,'mine'); }
        sendGameState(); renderAll();
      } else if (effectNum === 3) {
        // 묘지의 모두의 자연 필드 존에
        const gi = G.myGrave.findIndex(g=>g.id==='모두의 자연');
        if (gi >= 0) { G.myGrave.splice(gi,1); G.myFieldCard={id:'모두의 자연',name:'모두의 자연'}; log('에이스 라이거 ③: 모두의 자연 필드 존에','mine'); }
        sendGameState(); renderAll();
      }
      break;
    }
    case '라이거 킹': {
      if (effectNum === 1) {
        // 코스트 완료(①의 activate에서) → 소환
        const hi = G.myHand.findIndex(h=>h.id==='라이거 킹');
        if (hi>=0) { const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??8,atkBase:CARDS[mon.id]?.atk??8}); log('라이거 킹 ①: 소환','mine'); }
        // ②: 소환 유발
        if (canUseEffect('라이거 킹',2) && G.opField.length) {
          enqueueTriggeredEffect({ type:'themeEffect', label:'라이거 킹 ②', cardId:'라이거 킹', effectNum:2, theme:'라이거', mainText:'상대 필드의 카드를 전부 제외한다.', extra:{} });
        }
        sendGameState(); renderAll();
      } else if (effectNum === 2) {
        markEffectUsed('라이거 킹', 2);
        while (G.opField.length) { const mon=G.opField.pop(); G.opExile.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'exile',isTargeting:false}); }
        log('라이거 킹 ②: 상대 필드 전부 제외','mine');
        sendGameState(); renderAll();
      } else if (effectNum === 3) {
        // 자신/상대 턴 — 상대 필드 전부 제외
        markEffectUsed('라이거 킹', 3);
        if (!G.opField.length) { notify('상대 필드가 비어있습니다.'); return; }
        while (G.opField.length) { const mon=G.opField.pop(); G.opExile.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'exile',isTargeting:false}); }
        log('라이거 킹 ③: 상대 필드 전부 제외','mine');
        sendGameState(); renderAll();
      }
      break;
    }
    default:
      resolveThemeEffectGeneric(link);
  }
}

function _ligerOnSummoned(cardId) {
  if (cardId === '베이비 라이거' && canUseEffect('베이비 라이거', 2)) {
    enqueueTriggeredEffect({ type:'themeEffect', label:'베이비 라이거 ②', cardId:'베이비 라이거', effectNum:2, theme:'라이거', mainText:'덱에서 모두의 자연을 필드 존에 놓는다.', extra:{} });
  }
  if (cardId === '젊은 라이거' && canUseEffect('젊은 라이거', 2)) {
    enqueueTriggeredEffect({ type:'themeEffect', label:'젊은 라이거 ②', cardId:'젊은 라이거', effectNum:2, theme:'라이거', mainText:'덱에서 라이거 카드 1장을 패에 넣는다.', extra:{} });
  }
  if (cardId === '에이스 라이거' && canUseEffect('에이스 라이거', 2)) {
    enqueueTriggeredEffect({ type:'themeEffect', label:'에이스 라이거 ②', cardId:'에이스 라이거', effectNum:2, theme:'라이거', mainText:'자신 필드의 몬스터 수까지 상대 패를 덱으로 되돌린다. 상대는 1장 드로우한다.', extra:{} });
  }
  // 에이스 라이거 ①: 묘지로 보내졌을 때 — sendToGrave 후킹에서 처리
}

// 베이비 라이거 ② resolve (필드에서도 발동 가능하므로 직접)
(function _patchLigerResolve() {
  const _origResolve = window.THEME_EFFECT_HANDLERS?.['라이거']?.resolveLink;
})();

(function _hookLigerGrave() {
  const _prev = sendToGrave;
  sendToGrave = function(cardId, from) {
    _prev(cardId, from);
    if (cardId === '에이스 라이거' && from !== 'hand' && canUseEffect('에이스 라이거', 1)) {
      enqueueTriggeredEffect({ type:'themeEffect', label:'에이스 라이거 ①', cardId:'에이스 라이거', effectNum:1, theme:'라이거', mainText:'이 카드를 소환하고 상대 필드의 카드 1장을 제외할 수 있다.', extra:{ fromGrave: true } });
    }
    if (cardId === '라이거 킹' && from === 'field') {
      // ④: 즉발 강제 효과
      enqueueTriggeredEffect({ type:'themeEffect', label:'라이거 킹 ④', cardId:'라이거 킹', effectNum:4, theme:'라이거', mainText:'서로의 필드/묘지의 카드를 전부 제외한다. 턴 종료까지 소환 불가.', extra:{} });
    }
  };
})();

// 라이거 킹 ④ resolve 추가
const _ligerResolveOrig = _ligerResolve;
function _ligerResolveFull(link) {
  if (link.cardId === '에이스 라이거' && link.effectNum === 1) {
    const gi = G.myGrave.findIndex(g=>g.id==='에이스 라이거');
    if (gi>=0) { const mon=G.myGrave.splice(gi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??6,atkBase:CARDS[mon.id]?.atk??6}); log('에이스 라이거 ①: 묘지→소환','mine'); }
    if (G.opField.length) {
      openCardPicker([...G.opField],'에이스 라이거 ①: 상대 필드 1장 제외 (선택)',1,(sel)=>{
        if (sel.length) { const mon=G.opField.splice(sel[0],1)[0]; if(mon){G.opExile.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'exile',isTargeting:true});} }
        sendGameState(); renderAll();
      });
    } else { sendGameState(); renderAll(); }
    return;
  }
  if (link.cardId === '베이비 라이거' && link.effectNum === 2) {
    const found = findAllInDeck(d=>d.id==='모두의 자연');
    if (found.length) { removeFromDeck('모두의 자연'); G.myFieldCard={id:'모두의 자연',name:'모두의 자연'}; log('베이비 라이거 ②: 모두의 자연 필드 존에','mine'); }
    sendGameState(); renderAll();
    return;
  }
  if (link.cardId === '라이거 킹' && link.effectNum === 4) {
    const mf=[...G.myField], mg=[...G.myGrave], of_=[...G.opField], og=[...G.opGrave];
    G.myField=[]; G.myGrave=[];
    mf.forEach(c=>G.myExile.push(c)); mg.forEach(c=>G.myExile.push(c));
    of_.forEach(c=>{ G.opExile.push(c); sendAction({type:'opFieldRemove',cardId:c.id,to:'exile',isTargeting:false}); });
    og.forEach(()=>{}); G.opGrave=[];
    sendAction({ type:'opGraveMassExile' });
    G.ligerKingBanSummon = true;
    log('라이거 킹 ④: 서로 필드/묘지 전부 제외, 소환 불가','mine');
    sendGameState(); renderAll();
    return;
  }
  _ligerResolveOrig(link);
}

registerThemeEffectHandler('라이거', {
  activateFromHand: _ligerActivate,
  resolveLink:      _ligerResolveFull,
  onSummoned:       _ligerOnSummoned,
});
