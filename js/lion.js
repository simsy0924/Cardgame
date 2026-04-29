// lion.js — 라이온 테마 효과 엔진
// ─────────────────────────────────────────────
// 모든 효과는 기존 체인 시스템을 완전히 따름:
//   activateFromHand → _payThemeCost → beginChain/addChainLink
//   resolveLink      → 실제 효과 실행
// ─────────────────────────────────────────────

// ─── 지속효과: 존 슬롯 +1 (베이비/젊은/에이스 라이온) ───
const LION_SLOT_CARDS = new Set(['베이비 라이온','젊은 라이온','에이스 라이온']);

function _updateLionSlots() {
  const desired = G.myField.some(m => LION_SLOT_CARDS.has(m.id)) ? 1 : 0;
  if ((G.myExtraSlots || 0) !== desired) {
    G.myExtraSlots = desired;
    sendAction({ type: 'opExtraSlots', slots: desired });
    renderAll();
  }
}

// ─── 발동 함수 (activateFromHand) ───

function _lionActivate(handIdx, effectNum) {
  const c = G.myHand[handIdx];
  if (!c) return;
  const card = CARDS[c.id];
  if (!canUseEffect(c.id, effectNum)) { notify('이미 사용했습니다.'); return; }

  // 카드별 발동 조건 사전 체크
  if (c.id === '에이스 라이온' && effectNum === 1) {
    if (!G.myField.some(m => CARDS[m.id]?.theme === '라이온')) {
      notify('에이스 라이온 ①: 자신 필드에 라이온 몬스터가 필요합니다.'); return;
    }
  }
  if (c.id === '진정한 사자' && effectNum === 1) {
    const names = ['베이비 라이온','젊은 라이온','에이스 라이온'];
    if (names.some(n => !findAllInDeck(d => d.id === n).length)) {
      notify('진정한 사자: 덱에 세 종류 모두 필요합니다.'); return;
    }
  }
  if (c.id === '사자의 일격' && effectNum === 1) {
    if (isMyTurn) { notify('사자의 일격: 상대 전개 단계에만 발동 가능합니다.'); return; }
    if (currentPhase !== 'deploy') { notify('사자의 일격: 전개 단계에만 발동 가능합니다.'); return; }
  }
  if (c.id === '고고한 사자') {
    if (!isMyTurn || currentPhase !== 'deploy') {
      notify('고고한 사자: 자신 전개 단계에만 발동 가능합니다.'); return;
    }
    if (effectNum === 1 && !G.myField.some(m => CARDS[m.id]?.theme === '라이온')) {
      notify('고고한 사자 ①: 필드에 라이온 몬스터가 필요합니다.'); return;
    }
    if (effectNum === 2 && G.exileBanActive) {
      notify('이 턴은 카드를 제외할 수 없습니다.'); return;
    }
  }

  const effectText = _extractEffectText(card, effectNum);
  if (!effectText) { notify('효과 텍스트를 찾을 수 없습니다.'); return; }
  const { costText, mainText } = _splitCostAndMain(effectText);

  // 진정한 사자: 코스트로 세 장 덱에서 제거 (선택이 필요하므로 별도 처리)
  if (c.id === '진정한 사자' && effectNum === 1) {
    const names = ['베이비 라이온','젊은 라이온','에이스 라이온'];
    const found = names.map(n => findAllInDeck(d => d.id === n)[0]).filter(Boolean);
    found.forEach(t => removeFromDeck(t.id));
    // 코스트(카드 제거) 완료 → 체인 등록
    markEffectUsed(c.id, effectNum);
    const chainEffect = {
      type: 'themeEffect', label: `${c.name} ①`,
      cardId: c.id, effectNum, theme: '라이온', mainText,
      extra: { revealed: found.map(t => t.id) },
    };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
    return;
  }

  // 라이온 킹 ①: 코스트로 필드 4장 선택 필요
  if (c.id === '라이온 킹' && effectNum === 1) {
    if (G.myField.length < 4) { notify('라이온 킹 ①: 필드에 몬스터 4장이 필요합니다.'); return; }
    openCardPicker([...G.myField], '라이온 킹 ①: [코스트] 묻을 몬스터 4장 선택', 4, (sel) => {
      if (sel.length < 4) { notify('4장을 선택해야 합니다.'); return; }
      sel.sort((a,b)=>b-a).forEach(i => G.myGrave.push(G.myField.splice(i,1)[0]));
      _updateLionSlots();
      markEffectUsed(c.id, effectNum);
      const chainEffect = {
        type: 'themeEffect', label: `라이온 킹 ①`,
        cardId: c.id, effectNum, theme: '라이온', mainText,
        extra: { handIdx },
      };
      if (activeChainState?.active) addChainLink(chainEffect);
      else beginChain(chainEffect);
      sendGameState(); renderAll();
    });
    return;
  }

  _payThemeCost(card, handIdx, costText, (paid) => {
    if (!paid) return;
    markEffectUsed(c.id, effectNum);
    const chainEffect = {
      type: 'themeEffect', label: `${c.name} ${effectNum}`,
      cardId: c.id, effectNum, theme: '라이온', mainText,
      extra: {},
    };
    if (activeChainState?.active) addChainLink(chainEffect);
    else beginChain(chainEffect);
    sendGameState(); renderAll();
  });
}

// ─── 해결 함수 (resolveLink) ───

function _lionResolve(link) {
  const { cardId, effectNum, mainText, extra = {} } = link;

  switch(cardId) {
    case '베이비 라이온': {
      // 덱에서 라이온 1장 + 사자 1장 패에 넣고, 이 카드 소환
      const lionTargets = findAllInDeck(d => CARDS[d.id]?.theme === '라이온' && d.id !== '베이비 라이온');
      const sajaTargets = findAllInDeck(d => d.id.includes('사자') || d.id === '진정한 사자');
      const doSummon = () => {
        const idx = G.myHand.findIndex(h => h.id === '베이비 라이온');
        if (idx >= 0) {
          const mon = G.myHand.splice(idx,1)[0];
          G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk??2, atkBase: CARDS[mon.id]?.atk??2 });
          _updateLionSlots();
          log('베이비 라이온 ①: 소환', 'mine');
        }
        sendGameState(); renderAll();
      };
      const pickSaja = () => {
        if (!sajaTargets.length) { doSummon(); return; }
        openCardPicker(sajaTargets, '베이비 라이온 ①: 덱에서 사자 카드 패에', 1, (sel) => {
          if (sel.length) searchToHand(sajaTargets[sel[0]].id);
          doSummon();
        });
      };
      if (!lionTargets.length) { pickSaja(); return; }
      openCardPicker(lionTargets, '베이비 라이온 ①: 덱에서 라이온 카드 패에', 1, (sel) => {
        if (sel.length) searchToHand(lionTargets[sel[0]].id);
        pickSaja();
      });
      break;
    }
    case '젊은 라이온': {
      if (effectNum === 1) {
        // 덱에서 라이온 서치 + 패에서 라이온 소환
        const lionDeck = findAllInDeck(d => CARDS[d.id]?.theme === '라이온');
        const pickAndSummon = () => {
          const lionHand = G.myHand.filter(h => CARDS[h.id]?.theme === '라이온' && h.id !== '젊은 라이온');
          if (!lionHand.length) { sendGameState(); renderAll(); return; }
          openCardPicker(lionHand, '젊은 라이온 ①: 패에서 라이온 소환', 1, (sel) => {
            if (sel.length) {
              const t = lionHand[sel[0]];
              const hi = G.myHand.findIndex(h => h === t);
              if (hi >= 0) {
                const mon = G.myHand.splice(hi,1)[0];
                G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk??3, atkBase: CARDS[mon.id]?.atk??3 });
                _updateLionSlots(); log(`젊은 라이온 ①: ${mon.name} 소환`,'mine');
              }
            }
            sendGameState(); renderAll();
          });
        };
        if (!lionDeck.length) { pickAndSummon(); return; }
        openCardPicker(lionDeck, '젊은 라이온 ①: 덱에서 라이온 서치', 1, (sel) => {
          if (sel.length) searchToHand(lionDeck[sel[0]].id);
          pickAndSummon();
        });
      } else if (effectNum === 2) {
        // 덱에서 사자 카드 서치
        const sajaTargets = findAllInDeck(d => d.id.includes('사자') || d.id === '진정한 사자');
        if (!sajaTargets.length) { notify('덱에 사자 카드가 없습니다.'); return; }
        openCardPicker(sajaTargets, '젊은 라이온 ②: 덱에서 사자 카드 서치', 1, (sel) => {
          if (sel.length) searchToHand(sajaTargets[sel[0]].id);
          sendGameState(); renderAll();
        });
      }
      break;
    }
    case '에이스 라이온': {
      if (effectNum === 1) {
        // 소환 후 필드 카드 1장 묘지
        const c = G.myHand.findIndex(h => h.id === '에이스 라이온');
        if (c >= 0) {
          const mon = G.myHand.splice(c,1)[0];
          G.myField.push({ id: mon.id, name: mon.name, atk: CARDS[mon.id]?.atk??4, atkBase: CARDS[mon.id]?.atk??4 });
          _updateLionSlots(); log('에이스 라이온 ①: 소환','mine');
        }
        const allField = [
          ...G.myField.map((m,i) => ({...m, _src:'mine', _i:i})),
          ...G.opField.map((m,i) => ({...m, _src:'op',   _i:i})),
        ];
        if (!allField.length) { sendGameState(); renderAll(); return; }
        openCardPicker(allField, '에이스 라이온 ①: 필드 카드 1장 묘지', 1, (sel) => {
          if (sel.length) {
            const p = allField[sel[0]];
            if (p._src === 'mine') {
              const mon = G.myField.splice(p._i,1)[0];
              if (mon) { G.myGrave.push(mon); _updateLionSlots(); }
            } else {
              const mon = G.opField.splice(p._i,1)[0];
              if (mon) { G.opGrave.push(mon); sendAction({ type:'opFieldRemove', cardId:mon.id, to:'grave', isTargeting:true }); }
            }
          }
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        // 덱/묘지에서 사자+라이온 각 1장 패로
        const sajaPool = [
          ...findAllInDeck(d => d.id.includes('사자')||d.id==='진정한 사자').map(d => ({...d,_from:'deck'})),
          ...G.myGrave.filter(g => g.id.includes('사자')||g.id==='진정한 사자').map(g => ({...g,_from:'grave'})),
        ];
        const lionPool = [
          ...findAllInDeck(d => CARDS[d.id]?.theme==='라이온').map(d => ({...d,_from:'deck'})),
          ...G.myGrave.filter(g => CARDS[g.id]?.theme==='라이온').map(g => ({...g,_from:'grave'})),
        ];
        const _moveToHand = (card) => {
          if (card._from === 'deck') { const i = G.myDeck.findIndex(d=>d.id===card.id); if(i>=0) G.myHand.push(G.myDeck.splice(i,1)[0]); }
          else { const i = G.myGrave.findIndex(g=>g.id===card.id); if(i>=0) G.myHand.push(G.myGrave.splice(i,1)[0]); }
        };
        const pickLion = () => {
          if (!lionPool.length) { sendGameState(); renderAll(); return; }
          openCardPicker(lionPool, '에이스 라이온 ②: 라이온 카드 패로', 1, (sel) => {
            if (sel.length) _moveToHand(lionPool[sel[0]]);
            sendGameState(); renderAll();
          });
        };
        if (!sajaPool.length) { pickLion(); return; }
        openCardPicker(sajaPool, '에이스 라이온 ②: 사자 카드 패로', 1, (sel) => {
          if (sel.length) _moveToHand(sajaPool[sel[0]]);
          pickLion();
        });
      }
      break;
    }
    case '사자의 포효':
      // 덱에서 라이온 몬스터 전부 묘지
      findAllInDeck(d => CARDS[d.id]?.theme==='라이온' && CARDS[d.id]?.cardType==='monster').forEach(t => {
        removeFromDeck(t.id);
        G.myGrave.push({ id:t.id, name:CARDS[t.id]?.name||t.id });
      });
      log('사자의 포효: 라이온 몬스터 덱→묘지', 'mine');
      sendGameState(); renderAll();
      break;
    case '사자의 사냥': {
      // 패에서 사자 몬스터 소환
      const sajaMon = G.myHand.filter(h => h.id.includes('사자') && CARDS[h.id]?.cardType==='monster');
      if (!sajaMon.length) { notify('패에 사자 몬스터가 없습니다.'); return; }
      openCardPicker(sajaMon, '사자의 사냥: 패에서 사자 몬스터 소환', 1, (sel) => {
        if (sel.length) {
          const t = sajaMon[sel[0]];
          const hi = G.myHand.findIndex(h => h===t);
          if (hi >= 0) {
            const mon = G.myHand.splice(hi,1)[0];
            G.myField.push({ id:mon.id, name:mon.name, atk:CARDS[mon.id]?.atk??2, atkBase:CARDS[mon.id]?.atk??2 });
            _updateLionSlots(); log(`사자의 사냥: ${mon.name} 소환`,'mine');
          }
        }
        sendGameState(); renderAll();
      });
      break;
    }
    case '사자의 발톱': {
      // 묘지에서 사자 몬스터 소환
      const sajaGrave = G.myGrave.filter(g => g.id.includes('사자') && CARDS[g.id]?.cardType==='monster');
      if (!sajaGrave.length) { notify('묘지에 사자 몬스터가 없습니다.'); return; }
      openCardPicker(sajaGrave, '사자의 발톱: 묘지에서 사자 몬스터 소환', 1, (sel) => {
        if (sel.length) {
          const t = sajaGrave[sel[0]];
          const gi = G.myGrave.findIndex(g => g===t);
          if (gi >= 0) {
            const mon = G.myGrave.splice(gi,1)[0];
            G.myField.push({ id:mon.id, name:mon.name, atk:CARDS[mon.id]?.atk??2, atkBase:CARDS[mon.id]?.atk??2 });
            _updateLionSlots(); log(`사자의 발톱: ${mon.name} 묘지→소환`,'mine');
          }
        }
        sendGameState(); renderAll();
      });
      break;
    }
    case '사자의 일격': {
      // 상대 패를 라이온 수만큼 덱으로
      const count = Math.min(G.myField.filter(m=>CARDS[m.id]?.theme==='라이온').length, G.opHand.length);
      if (!count) { notify('되돌릴 상대 패가 없습니다.'); return; }
      sendAction({ type:'forceReturnHand', count, reason:'사자의 일격' });
      log(`사자의 일격: 상대 패 ${count}장 덱으로`,'mine');
      sendGameState(); renderAll();
      break;
    }
    case '진정한 사자': {
      // extra.revealed에 이미 제거된 세 장 id 있음
      const revealed = (extra.revealed || []).map(id => ({ id, name: CARDS[id]?.name||id }));
      if (!revealed.length) { sendGameState(); renderAll(); return; }
      openCardPicker(revealed, '진정한 사자: 소환할 1장 선택 (나머지 2장은 패)', 1, (sel) => {
        const si = sel.length ? sel[0] : 0;
        revealed.forEach((t,i) => {
          if (i === si) {
            G.myField.push({ id:t.id, name:t.name, atk:CARDS[t.id]?.atk??2, atkBase:CARDS[t.id]?.atk??2 });
            _updateLionSlots(); log(`진정한 사자: ${t.name} 소환`,'mine');
          } else {
            G.myHand.push({ id:t.id, name:t.name });
          }
        });
        sendGameState(); renderAll();
      });
      break;
    }
    case '라이온 킹': {
      if (effectNum === 1) {
        // 코스트(4장 묻기)는 activateFromHand에서 완료 — 이제 소환 + ② 선택
        const hi = G.myHand.findIndex(h => h.id === '라이온 킹');
        if (hi >= 0) {
          const mon = G.myHand.splice(hi,1)[0];
          G.myField.push({ id:mon.id, name:mon.name, atk:CARDS[mon.id]?.atk??5, atkBase:CARDS[mon.id]?.atk??5 });
          log('라이온 킹 ①: 소환','mine');
        }
        // ②는 소환 유발 — 별도 체인으로 등록
        if (canUseEffect('라이온 킹', 2) && G.opField.length) {
          enqueueTriggeredEffect({ type:'themeEffect', label:'라이온 킹 ②', cardId:'라이온 킹', effectNum:2, theme:'라이온', mainText:'상대 필드의 카드를 전부 묘지로 보낸다.', extra:{} });
        }
        sendGameState(); renderAll();
      } else if (effectNum === 2) {
        // 상대 필드 전부 묘지
        markEffectUsed('라이온 킹', 2);
        while (G.opField.length) {
          const mon = G.opField.pop();
          G.opGrave.push(mon);
          sendAction({ type:'opFieldRemove', cardId:mon.id, to:'grave', isTargeting:false });
        }
        log('라이온 킹 ②: 상대 필드 전부 묘지','mine');
        sendGameState(); renderAll();
      } else if (effectNum === 3) {
        // 묘지에서 소환 + 상대 몬스터 1장 제외
        const gi = G.myGrave.findIndex(g => g.id==='라이온 킹');
        if (gi >= 0) {
          const mon = G.myGrave.splice(gi,1)[0];
          G.myField.push({ id:mon.id, name:mon.name, atk:CARDS[mon.id]?.atk??5, atkBase:CARDS[mon.id]?.atk??5 });
          log('라이온 킹 ③: 묘지→소환','mine');
        }
        if (G.opField.length) {
          openCardPicker([...G.opField], '라이온 킹 ③: 상대 몬스터 1장 제외', 1, (sel) => {
            if (sel.length) {
              const mon = G.opField.splice(sel[0],1)[0];
              G.opExile.push(mon);
              sendAction({ type:'opFieldRemove', cardId:mon.id, to:'exile', isTargeting:true });
              log(`라이온 킹 ③: ${mon.name} 제외`,'mine');
            }
            sendGameState(); renderAll();
          });
        } else { sendGameState(); renderAll(); }
      }
      break;
    }
    case '고고한 사자': {
      if (effectNum === 1) {
        const targets = findAllInDeck(d => !!CARDS[d.id]);
        if (!targets.length) { notify('덱이 비어있습니다.'); return; }
        openCardPicker(targets, '고고한 사자 ①: 덱에서 카드 서치', 1, (sel) => {
          if (sel.length) searchToHand(targets[sel[0]].id);
          sendGameState(); renderAll();
        });
      } else if (effectNum === 2) {
        if (!G.opField.length) { notify('상대 필드에 카드가 없습니다.'); return; }
        openCardPicker([...G.opField], '고고한 사자 ②: 상대 필드 1장 제외', 1, (sel) => {
          if (sel.length) {
            const mon = G.opField.splice(sel[0],1)[0];
            G.opExile.push(mon);
            sendAction({ type:'opFieldRemove', cardId:mon.id, to:'exile', isTargeting:true });
            log(`고고한 사자 ②: ${mon.name} 제외`,'mine');
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

// ─── 소환 트리거 ───
function _lionOnSummoned(cardId) {
  _updateLionSlots();
  // 젊은 라이온 ②: 소환 시 사자 카드 서치
  if (cardId === '젊은 라이온' && canUseEffect('젊은 라이온', 2)) {
    enqueueTriggeredEffect({ type:'themeEffect', label:'젊은 라이온 ②', cardId:'젊은 라이온', effectNum:2, theme:'라이온', mainText:'덱에서 사자 카드 1장을 패에 넣는다.', extra:{} });
  }
  // 에이스 라이온 ②: 묘지로 보내졌을 때 (호출은 sendToGrave 후킹에서)
  // 라이온 킹 ②: ①의 resolve에서 enqueueTriggeredEffect
}

// ─── sendToGrave 후킹 ───
(function _hookLionGrave() {
  const _prev = sendToGrave;
  sendToGrave = function(cardId, from) {
    _prev(cardId, from);
    if (LION_SLOT_CARDS.has(cardId)) setTimeout(_updateLionSlots, 0);
    if (cardId === '에이스 라이온' && from !== 'hand' && canUseEffect('에이스 라이온', 2)) {
      enqueueTriggeredEffect({ type:'themeEffect', label:'에이스 라이온 ②', cardId:'에이스 라이온', effectNum:2, theme:'라이온', mainText:'덱/묘지에서 사자카드와 라이온카드를 1장씩 패에 넣는다.', extra:{} });
    }
    if (cardId === '라이온 킹' && from !== 'hand' && canUseEffect('라이온 킹', 3)) {
      // ③은 수동 발동 (자신/상대 턴) — 묘지 뷰어에서 버튼으로 처리
    }
  };
})();

// ─── 핸들러 등록 ───
registerThemeEffectHandler('라이온', {
  activateFromHand: _lionActivate,
  resolveLink:      _lionResolve,
  onSummoned:       _lionOnSummoned,
});
