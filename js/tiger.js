// tiger.js — 타이거 테마 효과 엔진
// 존 봉인(지속효과), 체인 시스템 완전 준수

const TIGER_ZONE_CARDS = new Set(['젊은 타이거','에이스 타이거','타이거 킹']);

function _updateTigerZone() {
  const should = G.myField.some(m => TIGER_ZONE_CARDS.has(m.id));
  if (should && !G.tigerZoneBanned) {
    G.tigerZoneBanned = true; renderAll();
  } else if (!should && G.tigerZoneBanned && !G.tigerZonePermanent) {
    G.tigerZoneBanned = false; renderAll();
  }
}

// renderMyField 후킹 — 왼쪽 2칸 봉인 표시
(function _patchRenderMyFieldTiger() {
  const _orig = renderMyField;
  renderMyField = function() {
    if (!G.tigerZoneBanned) { _orig(); return; }
    const container = document.getElementById('myField');
    container.innerHTML = '';
    const totalSlots = 5 + (G.myExtraSlots || 0);
    for (let i = 0; i < 2; i++) {
      const slot = document.createElement('div');
      slot.className = 'zone-slot';
      slot.style.cssText = 'opacity:.25;background:#c8484818;border-color:#c84848;cursor:not-allowed;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:.5rem;color:#c84848;text-align:center;';
      lbl.textContent = '봉인';
      slot.appendChild(lbl);
      container.appendChild(slot);
    }
    for (let i = 0; i < totalSlots - 2; i++) {
      const slot = document.createElement('div');
      slot.className = 'zone-slot';
      const mon = G.myField[i];
      if (mon) {
        slot.classList.add('active');
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:.55rem;text-align:center;padding:3px;word-break:keep-all;color:var(--text)';
        nameEl.textContent = mon.name;
        const atkEl = document.createElement('div');
        atkEl.style.cssText = 'font-size:.65rem;color:var(--accent);font-family:Black Han Sans,sans-serif';
        atkEl.textContent = `ATK ${mon.atk ?? (CARDS[mon.id]?.atk ?? '?')}`;
        slot.appendChild(nameEl); slot.appendChild(atkEl);
        slot.addEventListener('click', () => onMyFieldClick(i));
      }
      container.appendChild(slot);
    }
  };
})();

// ─── 발동 함수 ───
function _tigerActivate(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }

  // 발동 조건 체크
  if (c.id === '에이스 타이거' && effectNum === 1) {
    if (!G.myField.some(m => CARDS[m.id]?.theme === '타이거')) {
      notify('에이스 타이거 ①: 자신 필드에 타이거 몬스터가 필요합니다.'); return;
    }
  }
  if (c.id === '사자의 일격' || c.id === '호랑이의 일격') {
    if (isMyTurn || currentPhase !== 'deploy') {
      notify('상대 전개 단계에만 발동 가능합니다.'); return;
    }
  }
  if ((c.id === '진정한 호랑이') && effectNum === 1) {
    const names = ['베이비 타이거','젊은 타이거','에이스 타이거'];
    if (names.some(n => !findAllInDeck(d => d.id===n).length)) {
      notify('진정한 호랑이: 덱에 세 종류 모두 필요합니다.'); return;
    }
  }
  if (c.id === '고고한 호랑이') {
    if (isMyTurn || currentPhase !== 'deploy') {
      notify('고고한 호랑이: 상대 전개 단계에만 발동 가능합니다.'); return;
    }
    if (effectNum === 1 && !G.myField.some(m => CARDS[m.id]?.theme==='타이거')) {
      notify('고고한 호랑이 ①: 필드에 타이거 몬스터가 필요합니다.'); return;
    }
    if (effectNum === 2 && G.exileBanActive) {
      notify('이 턴은 카드를 제외할 수 없습니다.'); return;
    }
  }
  if (c.id === '타이거 킹' && effectNum === 1) {
    if (!G.myField.some(m => CARDS[m.id]?.theme==='타이거')) {
      notify('타이거 킹 ①: 필드에 타이거 몬스터가 필요합니다.'); return;
    }
  }

  const effectText = _extractEffectText(card, effectNum);
  if (!effectText) { notify('효과 텍스트를 찾을 수 없습니다.'); return; }
  const { costText, mainText } = _splitCostAndMain(effectText);

  // 진정한 호랑이: 코스트로 덱에서 세 장 제거
  if (c.id === '진정한 호랑이' && effectNum === 1) {
    const names = ['베이비 타이거','젊은 타이거','에이스 타이거'];
    const found = names.map(n => findAllInDeck(d => d.id===n)[0]).filter(Boolean);
    found.forEach(t => removeFromDeck(t.id));
    markEffectUsed(c.id, effectNum);
    // 이 카드 묘지로 (normal/trap 카드는 _payThemeCost에서 처리하지만 여기선 직접)
    const hi = G.myHand.findIndex(h => h.id === c.id);
    if (hi >= 0) G.myGrave.push(G.myHand.splice(hi,1)[0]);
    const chainEffect = { type:'themeEffect', label:`${c.name} ①`, cardId:c.id, effectNum, theme:'타이거', mainText, extra:{ revealed: found.map(t=>t.id) } };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
    return;
  }

  // 타이거 킹 ①: 코스트로 타이거 1장 선택 후 묻기
  if (c.id === '타이거 킹' && effectNum === 1) {
    const tigerField = G.myField.filter(m => CARDS[m.id]?.theme==='타이거');
    openCardPicker(tigerField, '타이거 킹 ①: [코스트] 타이거 1장 묘지', 1, (sel) => {
      if (!sel.length) return;
      const t = tigerField[sel[0]];
      const fi = G.myField.findIndex(m => m===t);
      if (fi >= 0) G.myGrave.push(G.myField.splice(fi,1)[0]);
      _updateTigerZone();
      markEffectUsed(c.id, effectNum);
      const chainEffect = { type:'themeEffect', label:'타이거 킹 ①', cardId:c.id, effectNum, theme:'타이거', mainText, extra:{ handIdx } };
      if (activeChainState?.active) addChainLink(chainEffect);
      else beginChain(chainEffect);
      sendGameState(); renderAll();
    });
    return;
  }

  _payThemeCost(card, handIdx, costText, (paid) => {
    if (!paid) return;
    markEffectUsed(c.id, effectNum);
    const chainEffect = { type:'themeEffect', label:`${c.name} ${effectNum}`, cardId:c.id, effectNum, theme:'타이거', mainText, extra:{} };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
  });
}

// ─── 해결 함수 ───
function _tigerResolve(link) {
  const { cardId, effectNum, mainText, extra = {} } = link;

  switch(cardId) {
    case '베이비 타이거': {
      // 덱에서 타이거+호랑이 패, 패에서 타이거 소환, 자신 제외
      const tigerDeck = findAllInDeck(d => CARDS[d.id]?.theme==='타이거' && d.id!=='베이비 타이거');
      const horangDeck = findAllInDeck(d => d.id.includes('호랑이') && CARDS[d.id]?.theme==='타이거');
      const doExile = () => {
        const ei = G.myHand.findIndex(h => h.id==='베이비 타이거');
        if (ei >= 0) { G.myExile.push(G.myHand.splice(ei,1)[0]); log('베이비 타이거 ①: 자신 제외','mine'); }
        sendGameState(); renderAll();
      };
      const doSummon = () => {
        const th = G.myHand.filter(h => CARDS[h.id]?.theme==='타이거');
        if (!th.length) { doExile(); return; }
        openCardPicker(th, '베이비 타이거 ①: 패에서 타이거 소환', 1, (sel) => {
          if (sel.length) {
            const t = th[sel[0]]; const hi = G.myHand.findIndex(h=>h===t);
            if (hi>=0) { const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??3,atkBase:CARDS[mon.id]?.atk??3}); _updateTigerZone(); }
          }
          doExile();
        });
      };
      const pickHorang = () => {
        if (!horangDeck.length) { doSummon(); return; }
        openCardPicker(horangDeck, '베이비 타이거 ①: 덱에서 호랑이 패', 1, (sel) => {
          if (sel.length) searchToHand(horangDeck[sel[0]].id);
          doSummon();
        });
      };
      if (!tigerDeck.length) { pickHorang(); return; }
      openCardPicker(tigerDeck, '베이비 타이거 ①: 덱에서 타이거 패', 1, (sel) => {
        if (sel.length) searchToHand(tigerDeck[sel[0]].id);
        pickHorang();
      });
      break;
    }
    case '젊은 타이거': {
      if (effectNum === 1) {
        const hd = findAllInDeck(d => d.id.includes('호랑이') && CARDS[d.id]?.theme==='타이거');
        if (!hd.length) { notify('덱에 호랑이 카드가 없습니다.'); return; }
        const cnt = Math.min(2, hd.length);
        openCardPicker(hd, `젊은 타이거 ①: 덱에서 호랑이 ${cnt}장 패`, cnt, (sel) => {
          sel.forEach(i => searchToHand(hd[i].id));
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        const td = findAllInDeck(d => CARDS[d.id]?.theme==='타이거' && CARDS[d.id]?.cardType==='monster' && d.id!=='젊은 타이거');
        if (!td.length) { notify('덱에 타이거 몬스터가 없습니다.'); return; }
        openCardPicker(td, '젊은 타이거 ②: 덱에서 타이거 소환', 1, (sel) => {
          if (sel.length) summonFromDeck(td[sel[0]].id);
          sendGameState(); renderAll();
        });
      }
      break;
    }
    case '에이스 타이거': {
      if (effectNum === 1) {
        const hi = G.myHand.findIndex(h => h.id==='에이스 타이거');
        if (hi >= 0) { const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??5,atkBase:CARDS[mon.id]?.atk??5}); _updateTigerZone(); log('에이스 타이거 ①: 소환','mine'); }
        // 서로 각 1장 묘지
        const pickMine = () => {
          if (!G.myField.length) { sendGameState(); renderAll(); return; }
          openCardPicker([...G.myField], '에이스 타이거 ①: 자신 필드 1장 묘지', 1, (sel) => {
            if (sel.length) { const mon=G.myField.splice(sel[0],1)[0]; if(mon){G.myGrave.push(mon); _updateTigerZone();} }
            sendGameState(); renderAll();
          });
        };
        if (!G.opField.length) { pickMine(); return; }
        openCardPicker([...G.opField], '에이스 타이거 ①: 상대 필드 1장 묘지', 1, (sel) => {
          if (sel.length) { const mon=G.opField.splice(sel[0],1)[0]; if(mon){G.opGrave.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'grave',isTargeting:true});} }
          pickMine();
        });
      } else if (effectNum === 2) {
        const td = findAllInDeck(d => CARDS[d.id]?.theme==='타이거');
        const hd = findAllInDeck(d => d.id.includes('호랑이'));
        const ph = () => {
          if (!hd.length) { sendGameState(); renderAll(); return; }
          openCardPicker(hd,'에이스 타이거 ②: 호랑이 서치',1,(sel)=>{ if(sel.length) searchToHand(hd[sel[0]].id); sendGameState(); renderAll(); });
        };
        if (!td.length) { ph(); return; }
        openCardPicker(td,'에이스 타이거 ②: 타이거 서치',1,(sel)=>{ if(sel.length) searchToHand(td[sel[0]].id); ph(); });
      }
      break;
    }
    case '호랑이의 포효': {
      const td = findAllInDeck(d => CARDS[d.id]?.theme==='타이거' && CARDS[d.id]?.cardType==='monster');
      if (!td.length) { notify('덱에 타이거 몬스터가 없습니다.'); return; }
      openCardPicker(td,'호랑이의 포효: 덱에서 타이거 묘지',1,(sel)=>{ if(sel.length){removeFromDeck(td[sel[0]].id);G.myGrave.push({id:td[sel[0]].id,name:CARDS[td[sel[0]].id]?.name||td[sel[0]].id});} sendGameState(); renderAll(); });
      break;
    }
    case '호랑이의 사냥': {
      const td = findAllInDeck(d => CARDS[d.id]?.theme==='타이거' && CARDS[d.id]?.cardType==='monster');
      if (!td.length) { notify('덱에 타이거 몬스터가 없습니다.'); return; }
      openCardPicker(td,'호랑이의 사냥: 덱에서 타이거 서치',1,(sel)=>{
        if (sel.length) searchToHand(td[sel[0]].id);
        _forcedDiscardOne('호랑이의 사냥: 패 1장 버리기', ()=>{ sendGameState(); renderAll(); });
      });
      break;
    }
    case '호랑이의 발톱': {
      // 코스트(묘지 타이거 제외)는 _payThemeCost에서 처리됨 — 효과: 상대 패 1장 제외
      if (G.opHand.length === 0) { notify('상대 패가 없습니다.'); return; }
      sendAction({ type:'forceExileHandCard', count:1, reason:'호랑이의 발톱' });
      log('호랑이의 발톱: 상대 패 1장 제외','mine');
      sendGameState(); renderAll();
      break;
    }
    case '호랑이의 일격': {
      const count = Math.min(G.myField.filter(m=>CARDS[m.id]?.theme==='타이거').length+1, G.opHand.length);
      if (!count) { notify('상대 패가 없습니다.'); return; }
      sendAction({ type:'forceExileHandCard', count, reason:'호랑이의 일격' });
      log(`호랑이의 일격: 상대 패 ${count}장 제외`,'mine');
      sendGameState(); renderAll();
      break;
    }
    case '진정한 호랑이': {
      const revealed = (extra.revealed||[]).map(id=>({id,name:CARDS[id]?.name||id}));
      if (!revealed.length) { sendGameState(); renderAll(); return; }
      openCardPicker(revealed,'진정한 호랑이: 소환할 1장 선택 (나머지 2장 패)',1,(sel)=>{
        const si = sel.length ? sel[0] : 0;
        revealed.forEach((t,i)=>{
          if (i===si) { G.myField.push({id:t.id,name:t.name,atk:CARDS[t.id]?.atk??3,atkBase:CARDS[t.id]?.atk??3}); _updateTigerZone(); log(`진정한 호랑이: ${t.name} 소환`,'mine'); }
          else G.myHand.push({id:t.id,name:t.name});
        });
        sendGameState(); renderAll();
      });
      break;
    }
    case '타이거 킹': {
      if (effectNum === 1) {
        // 코스트 완료 → 소환 + 영구 봉인
        const hi = G.myHand.findIndex(h => h.id==='타이거 킹');
        if (hi>=0) { const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??6,atkBase:CARDS[mon.id]?.atk??6}); }
        G.tigerZoneBanned = true; G.tigerZonePermanent = true;
        sendAction({ type:'tigerZoneBan' });
        log('타이거 킹 ①: 소환 + 영구 봉인','mine');
        // ②: 소환 유발
        if (canUseEffect('타이거 킹', 2) && G.opField.length) {
          enqueueTriggeredEffect({ type:'themeEffect', label:'타이거 킹 ②', cardId:'타이거 킹', effectNum:2, theme:'타이거', mainText:'상대 필드의 카드를 3장까지 제외한다.', extra:{} });
        }
        sendGameState(); renderAll();
      } else if (effectNum === 2) {
        markEffectUsed('타이거 킹', 2);
        const cnt = Math.min(3, G.opField.length);
        openCardPicker([...G.opField],`타이거 킹 ②: 상대 필드 최대 ${cnt}장 제외`,cnt,(sel)=>{
          sel.sort((a,b)=>b-a).forEach(i=>{ const mon=G.opField.splice(i,1)[0]; if(mon){G.opExile.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'exile',isTargeting:false});} });
          log(`타이거 킹 ②: ${sel.length}장 제외`,'mine');
          sendGameState(); renderAll();
        });
      } else if (effectNum === 3) {
        markEffectUsed('타이거 킹', 3);
        const cnt = Math.min(2, G.opField.length);
        if (!cnt) { notify('상대 필드가 비어있습니다.'); return; }
        openCardPicker([...G.opField],`타이거 킹 ③: 상대 필드 최대 ${cnt}장 제외`,cnt,(sel)=>{
          sel.sort((a,b)=>b-a).forEach(i=>{ const mon=G.opField.splice(i,1)[0]; if(mon){G.opExile.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'exile',isTargeting:false});} });
          log(`타이거 킹 ③: ${sel.length}장 제외`,'mine');
          sendGameState(); renderAll();
        });
      }
      break;
    }
    case '고고한 호랑이': {
      if (effectNum === 1) {
        if (!G.myGrave.length) { notify('묘지에 카드가 없습니다.'); return; }
        const gv = G.myGrave.filter(g => g.id !== '고고한 호랑이');
        openCardPicker(gv,'고고한 호랑이 ①: 묘지 카드 패로',1,(sel)=>{
          if (sel.length) { const t=gv[sel[0]]; const gi=G.myGrave.findIndex(g=>g===t); if(gi>=0) G.myHand.push(G.myGrave.splice(gi,1)[0]); log('고고한 호랑이 ①: 묘지 카드 패로','mine'); }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        if (!G.opField.length) { notify('상대 필드에 카드가 없습니다.'); return; }
        openCardPicker([...G.opField],'고고한 호랑이 ②: 상대 필드 1장 제외',1,(sel)=>{
          if (sel.length) { const mon=G.opField.splice(sel[0],1)[0]; if(mon){G.opExile.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'exile',isTargeting:true}); log(`고고한 호랑이 ②: ${mon.name} 제외`,'mine');} }
          sendGameState(); renderAll();
        });
      }
      break;
    }
    default:
      resolveThemeEffectGeneric(link);
  }
}

function _tigerOnSummoned(cardId) {
  _updateTigerZone();
  if (cardId === '젊은 타이거' && canUseEffect('젊은 타이거', 2)) {
    enqueueTriggeredEffect({ type:'themeEffect', label:'젊은 타이거 ②', cardId:'젊은 타이거', effectNum:2, theme:'타이거', mainText:'덱에서 타이거 몬스터 1장을 소환한다.', extra:{} });
  }
}

(function _hookTigerGrave() {
  const _prev = sendToGrave;
  sendToGrave = function(cardId, from) {
    _prev(cardId, from);
    if (TIGER_ZONE_CARDS.has(cardId)) setTimeout(_updateTigerZone, 0);
    if (cardId === '에이스 타이거' && from !== 'hand' && canUseEffect('에이스 타이거', 2)) {
      enqueueTriggeredEffect({ type:'themeEffect', label:'에이스 타이거 ②', cardId:'에이스 타이거', effectNum:2, theme:'타이거', mainText:'덱에서 타이거카드와 호랑이카드를 1장씩 패에 넣는다.', extra:{} });
    }
  };
})();

registerThemeEffectHandler('타이거', {
  activateFromHand: _tigerActivate,
  resolveLink:      _tigerResolve,
  onSummoned:       _tigerOnSummoned,
});
