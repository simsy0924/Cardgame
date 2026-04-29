// cthulhu.js — 크툴루/올드원 테마
// 핵심: GOO "소환하고 발동할 수 있다" = 소환이 코스트, 효과는 체인으로 처리
// _payThemeCost 호출 전 소환을 직접 처리, mainText만 체인에 담음

const _isGOO      = id => id.startsWith('그레이트 올드 원-');
const _isElderGod = id => id.startsWith('엘더 갓-');
const _isOldOne   = dc => ['올드원','올드 원','크툴루'].includes(CARDS[dc.id]?.theme);

// ─── 소환 헬퍼 (코스트로 소환) ───
function _gooSummonFromHand(cardId) {
  const hi = G.myHand.findIndex(h => h.id === cardId);
  if (hi < 0) return false;
  const cd = CARDS[cardId];
  const mon = G.myHand.splice(hi,1)[0];
  G.myField.push({ id:cardId, name:cd.name, atk:cd.atk??0, atkBase:cd.atk??0 });
  log(`${cd.name} 소환 (코스트)`, 'mine');
  return true;
}

// ─── 발동 조건 체크 ───
function _cthulhuCanActivate(cardId, effectNum) {
  switch(cardId) {
    case '그레이트 올드 원-크툴루':
      if (effectNum === 1) return !!findAllInDeck(d=>d.id==='태평양 속 르뤼에').length || (notify('발동 불가: 덱에 태평양 속 르뤼에가 없습니다.'), false);
      if (effectNum === 2) {
        if (!G.myField.length && !G.opField.length) { notify('발동 불가: 필드에 카드가 없습니다.'); return false; }
        if (!G.myField.length) { notify('발동 불가: 패널티로 보낼 자신 필드 카드가 없습니다.'); return false; }
      }
      return true;
    case '그레이트 올드 원-크투가':
      if (effectNum === 1) {
        const fc = (G.myFieldCard?1:0)+(G.opFieldCard?1:0);
        if (!fc) { notify('발동 불가: 필드 존에 카드가 없습니다.'); return false; }
      }
      if (effectNum === 2) {
        if (!G.myField.length) { notify('발동 불가: 패널티로 보낼 자신 필드 카드가 없습니다.'); return false; }
        if (!G.myHand.some((_,i)=> CARDS[G.myHand[i]?.id]?.cardType==='monster')) { notify('발동 불가: 코스트로 소환할 패 몬스터가 없습니다.'); return false; }
      }
      return true;
    case '그레이트 올드 원-크아이가':
      if (effectNum === 1 && G.myHand.length < 2) { notify('발동 불가: 소환 후 버릴 패가 없습니다.'); return false; }
      return true;
    case '그레이트 올드 원-과타노차':
      if (effectNum === 1) {
        if (!G.myField.some(m=>_isGOO(m.id))) { notify('발동 불가: 필드에 GOO 몬스터가 필요합니다.'); return false; }
      }
      if (effectNum === 2) {
        if (!G.myHand.some(h=>_isGOO(h.id))) { notify('발동 불가: 패에 GOO가 없습니다.'); return false; }
        if (!G.opHand.length && !G.opField.length) { notify('발동 불가: 상대 패/필드에 카드가 없습니다.'); return false; }
      }
      return true;
    case '엘더 갓-노덴스':
      if (!G.myField.some(m=>_isGOO(m.id))) { notify('발동 불가: 패널티로 보낼 자신 필드 GOO가 없습니다.'); return false; }
      return true;
    case '엘더 갓-크타니트':
      return true;
    default:
      return true;
  }
}

// ─── 발동 함수 ───
function _cthulhuActivate(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }
  if (!_cthulhuCanActivate(c.id, effectNum)) return;

  const effectText = _extractEffectText(card, effectNum);
  if (!effectText) { notify('효과 텍스트를 찾을 수 없습니다.'); return; }
  const { costText, mainText } = _splitCostAndMain(effectText);

  // GOO ①: "이 카드를 패에서 소환하고 발동" — 소환이 코스트
  if (_isGOO(c.id) && effectNum === 1 && costText.includes('소환')) {
    if (!_gooSummonFromHand(c.id)) return;
    sendGameState(); renderAll();
    markEffectUsed(c.id, effectNum);
    const chainEffect = { type:'themeEffect', label:`${c.name} ①`, cardId:c.id, effectNum, theme:'올드원', mainText, extra:{} };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
    return;
  }

  // 엘더 갓 크타니트 ①: 패/제외에서 소환
  if (c.id === '엘더 갓-크타니트' && effectNum === 1) {
    if (!_gooSummonFromHand('엘더 갓-크타니트')) return;
    markEffectUsed(c.id, effectNum);
    const chainEffect = { type:'themeEffect', label:'크타니트 ①', cardId:c.id, effectNum, theme:'올드원', mainText, extra:{} };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
    return;
  }

  // 과타노차 ①: [코스트] 자신 필드 GOO 1장 묻기 → [의무] 소환
  if (c.id === '그레이트 올드 원-과타노차' && effectNum === 1) {
    const gooOnField = G.myField.filter(m => _isGOO(m.id));
    openCardPicker(gooOnField,'과타노차 ①: [코스트] 자신 필드 GOO 1장 묘지',1,(sel)=>{
      if (!sel.length) return;
      const t=gooOnField[sel[0]]; const fi=G.myField.findIndex(m=>m===t);
      if (fi>=0) G.myGrave.push(G.myField.splice(fi,1)[0]);
      if (!_gooSummonFromHand('그레이트 올드 원-과타노차')) { sendGameState(); renderAll(); return; }
      markEffectUsed(c.id, effectNum);
      const chainEffect = { type:'themeEffect', label:'과타노차 ①', cardId:c.id, effectNum, theme:'올드원', mainText, extra:{} };
      if (activeChainState?.active) addChainLink(chainEffect);
      else beginChain(chainEffect);
      sendGameState(); renderAll();
    });
    return;
  }

  // 나머지 (magic/trap/normal 카드, 덱 제외 코스트 등)
  _payThemeCost(card, handIdx, costText, (paid) => {
    if (!paid) return;
    markEffectUsed(c.id, effectNum);
    const chainEffect = { type:'themeEffect', label:`${c.name} ${effectNum}`, cardId:c.id, effectNum, theme:'올드원', mainText, extra:{} };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
  });
}

// ─── 해결 함수 ───
function _cthulhuResolve(link) {
  const { cardId, effectNum, mainText, extra = {} } = link;

  // 공통 패 1장 강제 버리기 (크아이가 패널티)
  const _selfDiscard = (label, done) => {
    if (!G.myHand.length) { log(`${label}: 패 없음 스킵`,'mine'); done(); return; }
    openCardPicker([...G.myHand],`${label}: 패 1장 버리기 (의무)`,1,(sel)=>{
      if (sel.length) G.myGrave.push(G.myHand.splice(sel[0],1)[0]);
      done();
    });
  };

  switch(cardId) {
    case '그레이트 올드 원-크툴루': {
      if (effectNum === 1) {
        // 덱에서 르뤼에 필드 존에
        removeFromDeck('태평양 속 르뤼에');
        G.myFieldCard = { id:'태평양 속 르뤼에', name:'태평양 속 르뤼에' };
        log('크툴루 ①: 태평양 속 르뤼에 배치','mine');
        sendGameState(); renderAll();
      } else if (effectNum === 2) {
        // [코스트] 필드 1장 묘지 → [의무 패널티] 자신 필드 1장 묘지
        const allField = [...G.myField.map((m,i)=>({...m,_src:'mine',_i:i})), ...G.opField.map((m,i)=>({...m,_src:'op',_i:i}))];
        if (!allField.length) { sendGameState(); renderAll(); return; }
        openCardPicker(allField,'크툴루 ②: [코스트] 필드 카드 1장 묘지',1,(sel)=>{
          if (!sel.length) return;
          const p=allField[sel[0]];
          if (p._src==='mine') { const m=G.myField.splice(p._i,1)[0]; if(m) G.myGrave.push(m); }
          else { const m=G.opField.splice(p._i,1)[0]; if(m){G.opGrave.push(m); sendAction({type:'opFieldRemove',cardId:m.id,to:'grave',isTargeting:true});} }
          if (!G.myField.length) { sendGameState(); renderAll(); return; }
          openCardPicker([...G.myField].map((m,i)=>({...m,_i:i})),'크툴루 ②: [패널티] 자신 필드 1장 묘지',1,(sel2)=>{
            if (sel2.length) { const m=G.myField.splice(sel2[0],1)[0]; if(m) G.myGrave.push(m); }
            sendGameState(); renderAll();
          });
        });
      } else if (effectNum === 3) {
        const td = findAllInDeck(d=>_isGOO(d.id));
        if (!td.length) { notify('덱에 GOO가 없습니다.'); return; }
        openCardPicker(td,'크툴루 ③: 덱에서 GOO 서치',1,(sel)=>{ if(sel.length) searchToHand(td[sel[0]].id); sendGameState(); renderAll(); });
      }
      break;
    }
    case '그레이트 올드 원-크투가': {
      if (effectNum === 1) {
        // [의무 패널티] 필드 존 카드 묘지
        const fc = [];
        if (G.myFieldCard)  fc.push({ id:G.myFieldCard.id,  name:G.myFieldCard.name,  _who:'me' });
        if (G.opFieldCard)  fc.push({ id:G.opFieldCard.id,  name:G.opFieldCard.name,  _who:'op' });
        if (!fc.length) { sendGameState(); renderAll(); return; }
        openCardPicker(fc,'크투가 ①: [패널티] 필드 존 카드 1장 묘지',1,(sel)=>{
          if (sel.length) {
            const p=fc[sel[0]];
            if (p._who==='me') { G.myGrave.push(G.myFieldCard); G.myFieldCard=null; }
            else { G.opGrave.push(G.opFieldCard); sendAction({type:'opFieldCardRemove',cardId:p.id,to:'grave'}); G.opFieldCard=null; }
          }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // [코스트] 패 몬스터 소환 → [의무 패널티] 자신 필드 1장 묘지
        const monsters = G.myHand.filter(h => CARDS[h.id]?.cardType==='monster');
        openCardPicker(monsters,'크투가 ②: [코스트] 패에서 몬스터 소환',1,(sel)=>{
          if (!sel.length) return;
          const t=monsters[sel[0]]; const hi=G.myHand.findIndex(h=>h===t);
          if (hi>=0) { const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??0,atkBase:CARDS[mon.id]?.atk??0}); }
          sendGameState(); renderAll();
          if (!G.myField.length) return;
          openCardPicker([...G.myField].map((m,i)=>({...m,_i:i})),'크투가 ②: [패널티] 자신 필드 1장 묘지',1,(sel2)=>{
            if (sel2.length) { const m=G.myField.splice(sel2[0],1)[0]; if(m) G.myGrave.push(m); }
            sendGameState(); renderAll();
          });
        });
      } else if (effectNum === 3) {
        // 묘지에서 2장 제외
        const pool = [...G.myGrave.map(g=>({...g,_src:'mine'})), ...G.opGrave.map(g=>({...g,_src:'op'}))];
        if (!pool.length) { sendGameState(); renderAll(); return; }
        const cnt = Math.min(2, pool.length);
        openCardPicker(pool,`크투가 ③: 묘지 ${cnt}장 제외`,cnt,(sel)=>{
          sel.sort((a,b)=>b-a).forEach(i=>{
            const p=pool[i];
            if (p._src==='mine') { const gi=G.myGrave.findIndex(g=>g.id===p.id); if(gi>=0) G.myExile.push(G.myGrave.splice(gi,1)[0]); }
            else { const gi=G.opGrave.findIndex(g=>g.id===p.id); if(gi>=0){G.opExile.push(G.opGrave.splice(gi,1)[0]); sendAction({type:'opGraveExile',cardId:p.id});} }
          });
          sendGameState(); renderAll();
        });
      }
      break;
    }
    case '그레이트 올드 원-크아이가': {
      if (effectNum === 1) {
        // [의무 패널티] 패 1장 버리기
        _selfDiscard('크아이가 ①', ()=>{ sendGameState(); renderAll(); });
      } else if (effectNum === 2) {
        // [코스트] 상대 필드 1장 묘지 → [의무 패널티] 패 1장 버리기
        if (!G.opField.length) { notify('상대 필드가 비어있습니다.'); return; }
        openCardPicker([...G.opField],'크아이가 ②: [코스트] 상대 필드 1장 묘지',1,(sel)=>{
          if (!sel.length) return;
          const mon=G.opField.splice(sel[0],1)[0]; if(mon){G.opGrave.push(mon); sendAction({type:'opFieldRemove',cardId:mon.id,to:'grave',isTargeting:true});}
          _selfDiscard('크아이가 ②', ()=>{ sendGameState(); renderAll(); });
        });
      }
      break;
    }
    case '그레이트 올드 원-과타노차': {
      if (effectNum === 1) {
        // 드로우 선택 ("할 수 있다")
        // 체인 resolve 시점에 선택
        openCardPicker([{id:'_draw',name:'1장 드로우'}],'과타노차 ①: 드로우하겠습니까? (선택)',1,(sel)=>{
          if (sel.length) drawOne();
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // [코스트] 이 카드(필드) + 상대 패/필드 1장 묘지 → [의무] 패에서 GOO 소환
        // 이 카드는 activateFromHand에서 이미 묻혔으므로(필드에서 발동)
        // 상대 카드 선택
        const opTargets = [
          ...G.opHand.map(h=>({id:h.id,name:h.isPublic?h.name:'(비공개)',_src:'hand'})),
          ...G.opField.map((m,i)=>({...m,_src:'field',_i:i})),
        ];
        const gooHand = G.myHand.filter(h=>_isGOO(h.id));
        if (!opTargets.length||!gooHand.length) { sendGameState(); renderAll(); return; }
        openCardPicker(opTargets,'과타노차 ②: [코스트] 상대 패/필드 1장 묘지',1,(sel)=>{
          if (sel.length) {
            const p=opTargets[sel[0]];
            if (p._src==='hand') sendAction({type:'forceDiscard',count:1,reason:'과타노차 ②',attackerPicks:false});
            else { const fi=p._i; if(fi!==undefined){const m=G.opField.splice(fi,1)[0]; if(m){G.opGrave.push(m); sendAction({type:'opFieldRemove',cardId:m.id,to:'grave',isTargeting:true});}}}
          }
          openCardPicker(gooHand,'과타노차 ②: [의무] 패에서 GOO 소환',1,(sel2)=>{
            if (sel2.length) { const t=gooHand[sel2[0]]; const hi=G.myHand.findIndex(h=>h===t); if(hi>=0){const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??4,atkBase:CARDS[mon.id]?.atk??4}); log(`과타노차 ②: ${mon.name} 소환`,'mine');} }
            sendGameState(); renderAll();
          });
        });
      }
      break;
    }
    case '엘더 갓-노덴스': {
      if (effectNum === 1) {
        // [의무 패널티] 자신 필드 GOO 1장 이상 묘지 (소환은 activate에서 완료)
        const gooField = G.myField.filter(m=>_isGOO(m.id));
        if (!gooField.length) { sendGameState(); renderAll(); return; }
        openCardPicker(gooField,'노덴스 ①: [패널티] 자신 필드 GOO 1장 이상 묘지',gooField.length,(sel)=>{
          if (!sel.length) sel=[0];
          sel.sort((a,b)=>b-a).forEach(i=>{ const fi=G.myField.findIndex(m=>m===gooField[i]); if(fi>=0) G.myGrave.push(G.myField.splice(fi,1)[0]); });
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // [코스트] 묘지 GOO 제외 → [의무] 덱에서 GOO 묘지
        const gg = G.myGrave.filter(g=>_isGOO(g.id));
        const gd = findAllInDeck(d=>_isGOO(d.id));
        if (!gg.length||!gd.length) { notify('코스트/효과 대상 없음'); return; }
        openCardPicker(gg,'노덴스 ②: [코스트] 묘지 GOO 제외',1,(sel)=>{
          if (sel.length) { const gi=G.myGrave.findIndex(g=>g===gg[sel[0]]); if(gi>=0) G.myExile.push(G.myGrave.splice(gi,1)[0]); }
          openCardPicker(gd,'노덴스 ②: [의무] 덱에서 GOO 묘지',1,(sel2)=>{
            if (sel2.length) { removeFromDeck(gd[sel2[0]].id); G.myGrave.push({id:gd[sel2[0]].id,name:CARDS[gd[sel2[0]].id]?.name||gd[sel2[0]].id}); }
            sendGameState(); renderAll();
          });
        });
      }
      break;
    }
    case '엘더 갓-크타니트': {
      if (effectNum === 1) {
        // [의무] 서로 드로우 (상대도 드로우 = 패널티)
        drawOne();
        sendAction({ type:'opDraw', count:1 });
        log('크타니트 ①: 서로 드로우','mine');
        sendGameState(); renderAll();
      } else if (effectNum === 2) {
        // 상대 패 버리게 + 자신 드로우
        if (!G.opHand.length) { notify('상대 패가 없습니다.'); return; }
        sendAction({ type:'forceDiscard', count:1, reason:'크타니트 ②', attackerPicks:false });
        drawOne();
        sendGameState(); renderAll();
      } else if (effectNum === 3) {
        // [코스트] 상대 덱 맨 위 제외 → [선택] 서로 패 몬스터 소환
        sendAction({ type:'opDeckTopExile', reason:'크타니트 ③' });
        const myMons = G.myHand.filter(h=>CARDS[h.id]?.cardType==='monster');
        if (!myMons.length) { sendGameState(); renderAll(); return; }
        // "할 수 있다" — picker에서 선택 없이 확인 가능
        openCardPicker(myMons,'크타니트 ③: 패에서 몬스터 소환? (선택)',1,(sel)=>{
          if (sel.length) { const t=myMons[sel[0]]; const hi=G.myHand.findIndex(h=>h===t); if(hi>=0){const mon=G.myHand.splice(hi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??0,atkBase:CARDS[mon.id]?.atk??0});} }
          sendGameState(); renderAll();
        });
      }
      break;
    }
    case '엘더 갓-히프노스': {
      if (effectNum === 1) {
        // [의무] 드로우 + [선택] GOO 버리면 추가 드로우 (소환은 exileTrigger에서)
        drawOne(); log('히프노스 ①: 드로우','mine');
        const gh = G.myHand.filter(h=>_isGOO(h.id));
        if (!gh.length) { sendGameState(); renderAll(); return; }
        openCardPicker(gh,'히프노스 ①: GOO 버리고 추가 드로우? (선택)',1,(sel)=>{
          if (sel.length) { const hi=G.myHand.findIndex(h=>h===gh[sel[0]]); if(hi>=0) G.myGrave.push(G.myHand.splice(hi,1)[0]); drawOne(); }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 3) {
        const targets = G.myGrave.filter(g=>CARDS[g.id]?.cardType==='monster');
        if (!targets.length) { notify('묘지에 몬스터가 없습니다.'); return; }
        openCardPicker(targets,'히프노스 ③: 묘지에서 몬스터 소환',1,(sel)=>{
          if (sel.length) { const t=targets[sel[0]]; const gi=G.myGrave.findIndex(g=>g===t); if(gi>=0){const mon=G.myGrave.splice(gi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??0,atkBase:CARDS[mon.id]?.atk??0}); log(`히프노스 ③: ${mon.name} 소환`,'mine');} }
          sendGameState(); renderAll();
        });
      }
      break;
    }
    case '올드_원의 멸망': {
      if (effectNum === 1) {
        // 코스트(덱 엘더 갓 제외)는 _payThemeCost에서 완료 → 덱/묘지 GOO 소환
        const gooPool = [
          ...findAllInDeck(d=>_isGOO(d.id)).map(d=>({...d,_from:'deck'})),
          ...G.myGrave.filter(g=>_isGOO(g.id)).map(g=>({...g,_from:'grave'})),
        ];
        if (!gooPool.length) { notify('덱/묘지에 GOO가 없습니다.'); return; }
        openCardPicker(gooPool,'멸망 ①: 덱/묘지에서 GOO 소환',1,(sel)=>{
          if (sel.length) {
            const p=gooPool[sel[0]];
            if (p._from==='deck') summonFromDeck(p.id);
            else { const gi=G.myGrave.findIndex(g=>g.id===p.id); if(gi>=0){const mon=G.myGrave.splice(gi,1)[0]; G.myField.push({id:mon.id,name:mon.name,atk:CARDS[mon.id]?.atk??4,atkBase:CARDS[mon.id]?.atk??4}); log(`멸망 ①: ${mon.name} 묘지→소환`,'mine');} }
          }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // 묘지 제외(코스트, _payThemeCost에서) → 덱에서 올드원 서치
        const td = findAllInDeck(d=>_isOldOne(d));
        if (!td.length) { notify('덱에 올드원 카드가 없습니다.'); return; }
        openCardPicker(td,'멸망 ②: 덱에서 올드원 카드 서치',1,(sel)=>{ if(sel.length) searchToHand(td[sel[0]].id); sendGameState(); renderAll(); });
      }
      break;
    }
    case '아우터 갓 니알라토텝': {
      if (effectNum === 2) {
        if (!G.opField.length) { notify('상대 필드에 몬스터가 없습니다.'); return; }
        openCardPicker([...G.opField],'니알라토텝 ②: 상대 몬스터 효과 무효+정보 획득',1,(sel)=>{
          if (sel.length) {
            const mon=G.opField[sel[0]]; const fi=G.myField.findIndex(m=>m.id==='아우터 갓 니알라토텝');
            if (fi>=0 && CARDS[mon.id]) { G.myField[fi].atk=CARDS[mon.id]?.atk??G.myField[fi].atk; G.myField[fi].copiedFrom=mon.id; }
            sendAction({ type:'negateField', cardId:mon.id });
            log(`니알라토텝 ②: ${mon.name} 무효+정보 획득`,'mine');
          }
          sendGameState(); renderAll();
        });
      }
      break;
    }
    default:
      resolveThemeEffectGeneric(link);
  }
}

// ─── 제외 트리거 (히프노스, 노덴스, 크타니트) ───
(function _hookCthulhuExile() {
  // enterGame 이후 G.myExile이 준비된 후에 후킹
  const _origEnterGame = typeof enterGame === 'function' ? enterGame : null;
  if (!_origEnterGame) return;
  enterGame = function() {
    _origEnterGame.apply(this, arguments);
    const origPush = G.myExile.push.bind(G.myExile);
    G.myExile.push = function(...items) {
      const result = origPush(...items);
      items.forEach(item => {
        if (!item?.id) return;
        if (item.id==='엘더 갓-히프노스' && canUseEffect('엘더 갓-히프노스',1)) {
          // 소환 후 resolve에서 드로우 처리
          if (_cthulhuCanActivate('엘더 갓-히프노스',1)) {
            markEffectUsed('엘더 갓-히프노스',1);
            const cd=CARDS['엘더 갓-히프노스'];
            G.myField.push({id:'엘더 갓-히프노스',name:cd.name,atk:cd.atk??4,atkBase:cd.atk??4});
            log('히프노스 ①: 제외→소환','mine');
            enqueueTriggeredEffect({ type:'themeEffect', label:'히프노스 ①', cardId:'엘더 갓-히프노스', effectNum:1, theme:'올드원', mainText:'1장 드로우. 원한다면 GOO 버리고 추가 드로우.', extra:{} });
          }
        }
        if (item.id==='엘더 갓-노덴스' && canUseEffect('엘더 갓-노덴스',1)) {
          enqueueTriggeredEffect({ type:'themeEffect', label:'노덴스 ①(제외)', cardId:'엘더 갓-노덴스', effectNum:1, theme:'올드원', mainText:'자신 필드의 GOO 1장 이상을 묘지로 보낸다.', extra:{ from:'exile' } });
        }
        if (item.id==='엘더 갓-크타니트' && canUseEffect('엘더 갓-크타니트',1)) {
          const cd=CARDS['엘더 갓-크타니트'];
          G.myField.push({id:'엘더 갓-크타니트',name:cd.name,atk:cd.atk??5,atkBase:cd.atk??5});
          markEffectUsed('엘더 갓-크타니트',1);
          enqueueTriggeredEffect({ type:'themeEffect', label:'크타니트 ①(제외)', cardId:'엘더 갓-크타니트', effectNum:1, theme:'올드원', mainText:'서로 1장 드로우한다.', extra:{} });
        }
      });
      return result;
    };
  };
})();

// ─── sendToGrave 후킹 ───
(function _hookCthulhuGrave() {
  const _prev = sendToGrave;
  sendToGrave = function(cardId, from) {
    _prev(cardId, from);
    if (cardId==='그레이트 올드 원-크툴루' && from!=='hand' && canUseEffect('그레이트 올드 원-크툴루',3)) {
      enqueueTriggeredEffect({ type:'themeEffect', label:'크툴루 ③', cardId:'그레이트 올드 원-크툴루', effectNum:3, theme:'올드원', mainText:'덱에서 GOO 1장을 패에 넣는다.', extra:{} });
    }
    if (cardId==='그레이트 올드 원-크투가' && from!=='hand' && canUseEffect('그레이트 올드 원-크투가',3)) {
      enqueueTriggeredEffect({ type:'themeEffect', label:'크투가 ③', cardId:'그레이트 올드 원-크투가', effectNum:3, theme:'올드원', mainText:'자신/상대 묘지 카드 합계 2장을 제외한다.', extra:{} });
    }
    if (cardId==='그레이트 올드 원-크아이가' && from==='field' && canUseEffect('그레이트 올드 원-크아이가',2)) {
      enqueueTriggeredEffect({ type:'themeEffect', label:'크아이가 ③', cardId:'그레이트 올드 원-크아이가', effectNum:2, theme:'올드원', mainText:'상대 필드 카드 2장까지 묘지로 보내고 패 1장 버린다.', extra:{ triggerFrom:'field' } });
    }
    if (cardId==='엘더 갓-노덴스' && from!=='hand' && canUseEffect('엘더 갓-노덴스',1)) {
      const cd=CARDS['엘더 갓-노덴스'];
      const gi=G.myGrave.findIndex(g=>g.id==='엘더 갓-노덴스');
      if (gi>=0) { G.myGrave.splice(gi,1); G.myField.push({id:'엘더 갓-노덴스',name:cd.name,atk:cd.atk??6,atkBase:cd.atk??6}); markEffectUsed('엘더 갓-노덴스',1); }
      enqueueTriggeredEffect({ type:'themeEffect', label:'노덴스 ①(묘지)', cardId:'엘더 갓-노덴스', effectNum:1, theme:'올드원', mainText:'자신 필드의 GOO 1장 이상을 묘지로 보낸다.', extra:{ from:'grave' } });
    }
  };
})();

// ─── 상대 액션 처리 ───
function _cthulhuHandleOp(action) {
  if (action.type==='opDeckTopExile') {
    if (G.myDeck.length) { const top=G.myDeck.shift(); G.myExile.push(top); log(`상대 크타니트 ③: 내 덱 맨 위 ${top.id} 제외`,'opponent'); renderAll(); }
  }
}

['크툴루','올드원','올드 원'].forEach(theme => {
  registerThemeEffectHandler(theme, {
    activateFromHand: _cthulhuActivate,
    resolveLink:      _cthulhuResolve,
    handleOpAction:   _cthulhuHandleOp,
  });
});
