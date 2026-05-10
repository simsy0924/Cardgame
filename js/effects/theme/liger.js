// HAND BATTLE — Theme Effects: Liger
// 16-8단계: 라이거 테마를 EffectDefinition 기반으로 이식한다.
// 핵심: 라이온/타이거 이름 취급, 라이거 융합형 전개, 라이거 킹 내성/광역 제외.
(function initLigerEffectDefinitions(global) {
  'use strict';
  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || { ACTIVATION:'activation', QUICK:'quick', TRIGGER:'trigger', CONTINUOUS:'continuous', PROCEDURE:'procedure' };
  const ZONES = rules.ZONES || { DECK:'deck', HAND:'hand', FIELD:'field', FIELD_ZONE:'fieldZone', GRAVE:'grave', EXILE:'exile', KEY_DECK:'keyDeck' };
  const EVENTS = rules.EVENTS || { SUMMON:'summon', SENT_TO_GRAVE:'sentToGrave', ADDED_TO_HAND:'addedToHand' };
  const TIMING = rules.TIMING || { MY_DEPLOY:'myDeploy', EITHER_TURN:'eitherTurn', ON_SUMMON:'onSummon' };
  const TAGS = rules.EFFECT_TAGS || {};
  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry || !zoneAccess) throw new Error('[liger-effects] registry/zone-access가 필요합니다.');
  const CONTROLLERS = zoneAccess.CONTROLLERS || { ME:'me', OPPONENT:'opponent' };
  const effects = [];
  const LIGER_IDS = ['화합의 시대의 라이거','베이비 라이거','젊은 라이거','에이스 라이거','라이거 킹','모두의 자연'];
  function state(ctx){ return (ctx&&ctx.gameState)||(typeof G!=='undefined'?G:global.G); } // eslint-disable-line no-undef
  function cards(){ return (typeof CARDS!=='undefined'&&CARDS)||global.CARDS||{}; } // eslint-disable-line no-undef
  function id(x){ return typeof x==='string'?x:(x&&(x.id||x.cardId||x.name))||''; }
  function def(x){ return cards()[id(x)]||null; }
  function ctrl(ctx){ return zoneAccess.normalizeController((ctx&&ctx.controller)||CONTROLLERS.ME); }
  function opp(ctx){ return ctrl(ctx)===CONTROLLERS.ME?CONTROLLERS.OPPONENT:CONTROLLERS.ME; }
  function zone(ctx,c,z){ return zoneAccess.getZoneArray(state(ctx), c||ctrl(ctx), z); }
  function deck(ctx){ return zone(ctx,ctrl(ctx),ZONES.DECK); }
  function hand(ctx){ return zone(ctx,ctrl(ctx),ZONES.HAND); }
  function field(ctx,c){ return zone(ctx,c||ctrl(ctx),ZONES.FIELD); }
  function grave(ctx){ return zone(ctx,ctrl(ctx),ZONES.GRAVE); }
  function exile(ctx){ return zone(ctx,ctrl(ctx),ZONES.EXILE); }
  function fieldCard(ctx,c){ return zoneAccess.getFieldZoneCard(state(ctx),c||ctrl(ctx)); }
  function isMonster(c){ const d=def(c); return !!(d&&d.cardType==='monster'); }
  function isLiger(c){ const d=def(c); return !!(d&&d.theme==='라이거'); }
  function isLigerMonster(c){ return isLiger(c)&&isMonster(c); }
  function isLion(c){ const d=def(c); return !!(d&&d.theme==='라이온'); }
  function isTiger(c){ const d=def(c); return !!(d&&d.theme==='타이거'); }
  function isLionMonster(c){ return isLion(c)&&isMonster(c); }
  function isTigerMonster(c){ return isTiger(c)&&isMonster(c); }
  function isSaja(c){ const x=id(c); return x.includes('사자') || x==='진정한 사자' || x==='고고한 사자'; }
  function isHorang(c){ const x=id(c); return x.includes('호랑이') || x==='진정한 호랑이' || x==='고고한 호랑이'; }
  function first(a,p){ return (a||[]).find(p||(_=>_)); }
  function selectedId(ctx){ return id(ctx&&(ctx.selectedCard||ctx.selectedTarget||ctx.target||ctx.selectedCardId)); }
  function choose(ctx,list,p){ const sid=selectedId(ctx); if(sid){ const hit=(list||[]).find(c=>id(c)===sid&&(!p||p(c))); if(hit) return hit; } return first(list,p); }
  function hasFieldSpace(ctx,c){ return global.HB_CARD_MOVE&&global.HB_CARD_MOVE.hasFieldSpace?global.HB_CARD_MOVE.hasFieldSpace(state(ctx),c||ctrl(ctx)):field(ctx,c).length<5; }
  function addHand(ctx,c,from,reason,reveal){ return ctx.move.addToHand({cardId:id(c),controller:ctrl(ctx),from:{controller:ctrl(ctx),zone:from},reason,reveal:!!reveal}); }
  function summon(ctx,c,from,reason){ return ctx.move.summonCard({cardId:id(c),controller:ctrl(ctx),from:{controller:ctrl(ctx),zone:from},reason}); }
  function sendGrave(ctx,c,from,controller,reason){ const owner=controller||ctrl(ctx); return ctx.move.sendToGrave({cardId:id(c),controller:owner,from:{controller:owner,zone:from},reason}); }
  function banish(ctx,c,from,controller,reason){ const owner=controller||ctrl(ctx); return ctx.move.banishCard({cardId:id(c),controller:owner,from:{controller:owner,zone:from},reason}); }
  function placeField(ctx,cardId,from,reason){ return ctx.move.placeFieldCard({cardId,controller:ctrl(ctx),from:{controller:ctrl(ctx),zone:from},reason}); }
  function removeFieldCard(ctx,reason){ return ctx.move.removeFieldCard({controller:ctrl(ctx),reason}); }
  function dispatch(ctx){ if(global.HB_EVENTS) global.HB_EVENTS.dispatchEvents(state(ctx)); try{ if(typeof sendGameState==='function') sendGameState(); if(typeof renderAll==='function') renderAll(); }catch(_){} } // eslint-disable-line no-undef
  function isDeployPhase(){ if(typeof currentPhase==='undefined') return true; return currentPhase==='deploy'||currentPhase==='전개'; } // eslint-disable-line no-undef
  function mk(o){ return Object.assign({theme:'라이거',optional:true},o); }
  function add(o){ effects.push(mk(o)); }
  function graveExile(ctx,p){ return grave(ctx).map(c=>Object.assign({_z:ZONES.GRAVE},c)).concat(exile(ctx).map(c=>Object.assign({_z:ZONES.EXILE},c))).filter(p||(_=>_)); }
  function keyDeckArray(ctx){ try { return zone(ctx,ctrl(ctx),ZONES.KEY_DECK); } catch (_) { const st=state(ctx); return st.myKeyDeck || st.keyDeck || []; } }

  // 이름 취급
  add({id:'liger-era-name-treated-as-saja-horang',cardId:'화합의 시대의 라이거',effectNo:0,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD,ZONES.HAND,ZONES.GRAVE,ZONES.EXILE],continuousRule:{nameTreatAs:['사자','호랑이']}});
  ['베이비 라이거','젊은 라이거','에이스 라이거'].forEach(cardId=>add({id:`${cardId}-name-treated-as-lion-tiger`,cardId,effectNo:0,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD,ZONES.HAND,ZONES.GRAVE,ZONES.EXILE],continuousRule:{nameTreatAs:['라이온','타이거']}}));
  add({id:'everyone-nature-name-treated-as-all-beasts',cardId:'모두의 자연',effectNo:0,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD_ZONE,ZONES.FIELD,ZONES.HAND,ZONES.GRAVE,ZONES.EXILE],continuousRule:{nameTreatAs:['사자','호랑이','라이온','타이거','라이거']}});
  add({id:'young-liger-3-king-attack-plus',cardId:'젊은 라이거',effectNo:3,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD],continuousRule:{attackModifier:(checkCtx,sourceCtx)=>checkCtx.targetController===sourceCtx.controller&&['라이온 킹','타이거 킹','라이거 킹'].includes(id(checkCtx.target))?1:0}});
  add({id:'baby-liger-3-liger-king-temporary-immunity',cardId:'베이비 라이거',effectNo:3,type:EFFECT_TYPES.ACTIVATION,zones:[ZONES.FIELD],timing:TIMING.MY_DEPLOY,oncePerTurn:{key:'베이비 라이거_3',limit:1},canResolve:ctx=>field(ctx).some(c=>id(c)==='라이거 킹'),resolve(ctx){ state(ctx).ligerKingImmuneThisTurn=true; dispatch(ctx); return {ok:true}; }});
  add({id:'liger-king-turn-immunity-continuous',cardId:'라이거 킹',effectNo:99,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD],continuousRule:{effectImmunity:(checkCtx,sourceCtx)=>state(sourceCtx).ligerKingImmuneThisTurn===true&&id(checkCtx.target)==='라이거 킹'&&checkCtx.targetController===sourceCtx.controller&&checkCtx.actorController!==sourceCtx.controller}});

  add({id:'liger-era-1-deck-summon-liger-then-hand',cardId:'화합의 시대의 라이거',effectNo:1,type:EFFECT_TYPES.ACTIVATION, cardActivationCost: true,zones:[ZONES.HAND],timing:TIMING.MY_DEPLOY,oncePerTurn:{key:'화합의 시대의 라이거_1',limit:1},condition:isDeployPhase,canResolve:ctx=>deck(ctx).some(isLigerMonster)&&hasFieldSpace(ctx),resolve(ctx){ const d=choose(ctx,deck(ctx),isLigerMonster); const r1=summon(ctx,d,ZONES.DECK,'ligerEraDeckSummon'); let r2={ok:true}; const h=choose(ctx,hand(ctx),c=>isLigerMonster(c)&&id(c)!==id(d)); if(h&&hasFieldSpace(ctx)){ r2=summon(ctx,h,ZONES.HAND,'ligerEraHandSummon'); const mon=field(ctx).find(c=>id(c)===id(h)); if(mon) mon.atk=(mon.atk||0)-1; } dispatch(ctx); return {ok:r1.ok,results:[r1,r2]}; }});
  add({id:'baby-liger-1-summon-lion-and-tiger',cardId:'베이비 라이거',effectNo:1,type:EFFECT_TYPES.ACTIVATION,zones:[ZONES.HAND],oncePerTurn:{key:'베이비 라이거_1',limit:1},canResolve:ctx=>deck(ctx).some(isLionMonster)&&deck(ctx).some(isTigerMonster)&&hasFieldSpace(ctx),resolve(ctx){ const l=choose(ctx,deck(ctx),isLionMonster); const t=choose(ctx,deck(ctx),isTigerMonster); const r1=summon(ctx,l,ZONES.DECK,'babyLigerSummonLion'); const r2=hasFieldSpace(ctx)?summon(ctx,t,ZONES.DECK,'babyLigerSummonTiger'):{ok:false}; let r3={ok:true}; if(hasFieldSpace(ctx)&&hand(ctx).some(c=>id(c)==='베이비 라이거')) r3=summon(ctx,'베이비 라이거',ZONES.HAND,'babyLigerSelfSummon'); dispatch(ctx); return {ok:r1.ok&&r2.ok,results:[r1,r2,r3]}; }});
  add({id:'baby-liger-2-on-summon-place-nature',cardId:'베이비 라이거',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.FIELD],events:[EVENTS.SUMMON],oncePerTurn:{key:'베이비 라이거_2',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='베이비 라이거',canResolve:ctx=>deck(ctx).some(c=>id(c)==='모두의 자연'),resolve(ctx){ const r=placeField(ctx,'모두의 자연',ZONES.DECK,'babyLigerPlaceNature'); dispatch(ctx); return r; }});
  add({id:'young-liger-1-public-search-saja-horang',cardId:'젊은 라이거',effectNo:1,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.PUBLIC_HAND],events:[EVENTS.ADDED_TO_HAND],oncePerTurn:{key:'젊은 라이거_1',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='젊은 라이거',canResolve:ctx=>deck(ctx).some(c=>isSaja(c)||isHorang(c)),resolve(ctx){ const s=choose(ctx,deck(ctx),isSaja); const h=choose(ctx,deck(ctx),c=>isHorang(c)&&id(c)!==id(s)); const r1=s?addHand(ctx,s,ZONES.DECK,'youngLigerSearchSaja',true):{ok:true}; const r2=h?addHand(ctx,h,ZONES.DECK,'youngLigerSearchHorang',true):{ok:true}; dispatch(ctx); return {ok:r1.ok&&r2.ok,results:[r1,r2]}; }});
  add({id:'young-liger-2-on-summon-search-liger',cardId:'젊은 라이거',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.FIELD],events:[EVENTS.SUMMON],oncePerTurn:{key:'젊은 라이거_2',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='젊은 라이거',canResolve:ctx=>deck(ctx).some(isLiger),resolve(ctx){ const r=addHand(ctx,choose(ctx,deck(ctx),isLiger),ZONES.DECK,'youngLigerSearchLiger',true); dispatch(ctx); return r; }});
  add({id:'ace-liger-1-sent-revive-and-banish-op',cardId:'에이스 라이거',effectNo:1,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.GRAVE],events:[EVENTS.SENT_TO_GRAVE],oncePerTurn:{key:'에이스 라이거_1',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='에이스 라이거',canResolve:ctx=>grave(ctx).some(c=>id(c)==='에이스 라이거')&&hasFieldSpace(ctx),resolve(ctx){ const r1=summon(ctx,'에이스 라이거',ZONES.GRAVE,'aceLigerRevive'); const op=choose(ctx,field(ctx,opp(ctx))); const r2=op?banish(ctx,op,ZONES.FIELD,opp(ctx),'aceLigerBanish'):{ok:true}; dispatch(ctx); return {ok:r1.ok,results:[r1,r2]}; }});
  add({id:'ace-liger-2-on-summon-return-op-hand-draw',cardId:'에이스 라이거',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.FIELD],events:[EVENTS.SUMMON],oncePerTurn:{key:'에이스 라이거_2',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='에이스 라이거',canResolve:ctx=>field(ctx).length>0,resolve(ctx){ try{ if(typeof sendAction==='function') sendAction({type:'forceReturnHand',count:field(ctx).length,reason:'에이스 라이거 ②'}); sendAction({type:'opDraw',count:1}); }catch(_){} dispatch(ctx); return {ok:true}; }});
  add({id:'ace-liger-3-place-nature-from-grave',cardId:'에이스 라이거',effectNo:3,type:EFFECT_TYPES.QUICK,zones:[ZONES.FIELD],timing:TIMING.EITHER_TURN,oncePerTurn:{key:'에이스 라이거_3',limit:1},canResolve:ctx=>grave(ctx).some(c=>id(c)==='모두의 자연'),resolve(ctx){ const r=placeField(ctx,'모두의 자연',ZONES.GRAVE,'aceLigerPlaceNature'); dispatch(ctx); return r; }});
  add({id:'liger-king-1-procedure-summon',cardId:'라이거 킹',effectNo:1,type:EFFECT_TYPES.PROCEDURE,zones:[ZONES.HAND],summonProcedure:true,canResolve:ctx=>field(ctx).some(c=>id(c)==='라이온 킹')&&field(ctx).some(c=>id(c)==='타이거 킹')&&hasFieldSpace(ctx),resolve(ctx){ const c1=sendGrave(ctx,'라이온 킹',ZONES.FIELD,ctrl(ctx),'ligerKingCostLionKing'); const c2=sendGrave(ctx,'타이거 킹',ZONES.FIELD,ctrl(ctx),'ligerKingCostTigerKing'); const r=summon(ctx,'라이거 킹',ZONES.HAND,'ligerKingProcedure'); dispatch(ctx); return {ok:c1.ok&&c2.ok&&r.ok,costs:[c1,c2],summon:r}; }});
  add({id:'liger-king-2-on-summon-banish-op-all',cardId:'라이거 킹',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.FIELD],events:[EVENTS.SUMMON],oncePerTurn:{key:'라이거 킹_2',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='라이거 킹',canResolve:ctx=>field(ctx,opp(ctx)).length>0,resolve(ctx){ const results=field(ctx,opp(ctx)).slice().map(c=>banish(ctx,c,ZONES.FIELD,opp(ctx),'ligerKingBanishAllOnSummon')); dispatch(ctx); return {ok:results.length>0,results}; }});
  add({id:'liger-king-3-quick-banish-op-all',cardId:'라이거 킹',effectNo:3,type:EFFECT_TYPES.QUICK,zones:[ZONES.FIELD],timing:TIMING.EITHER_TURN,oncePerTurn:{key:'라이거 킹_3',limit:1},canResolve:ctx=>field(ctx,opp(ctx)).length>0,resolve(ctx){ const results=field(ctx,opp(ctx)).slice().map(c=>banish(ctx,c,ZONES.FIELD,opp(ctx),'ligerKingQuickBanishAll')); dispatch(ctx); return {ok:results.length>0,results}; }});
  add({id:'liger-king-4-sent-banish-all-and-lock-summon',cardId:'라이거 킹',effectNo:4,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.GRAVE],events:[EVENTS.SENT_TO_GRAVE],optional:false,mandatory:true,condition:ctx=>ctx.event&&ctx.event.cardId==='라이거 킹'&&ctx.event.sourceZone===ZONES.FIELD,canResolve:ctx=>field(ctx).length+grave(ctx).length+field(ctx,opp(ctx)).length+zone(ctx,opp(ctx),ZONES.GRAVE).length>0,resolve(ctx){ const results=[]; field(ctx).slice().forEach(c=>results.push(banish(ctx,c,ZONES.FIELD,ctrl(ctx),'ligerKing4BanishMineField'))); grave(ctx).slice().forEach(c=>results.push(banish(ctx,c,ZONES.GRAVE,ctrl(ctx),'ligerKing4BanishMineGrave'))); field(ctx,opp(ctx)).slice().forEach(c=>results.push(banish(ctx,c,ZONES.FIELD,opp(ctx),'ligerKing4BanishOpField'))); zone(ctx,opp(ctx),ZONES.GRAVE).slice().forEach(c=>results.push(banish(ctx,c,ZONES.GRAVE,opp(ctx),'ligerKing4BanishOpGrave'))); state(ctx).ligerKingBanSummon=true; dispatch(ctx); return {ok:true,results}; }});

  add({id:'everyone-nature-1-recover-liger-discard-op',cardId:'모두의 자연',effectNo:1,type:EFFECT_TYPES.ACTIVATION,zones:[ZONES.FIELD_ZONE],timing:TIMING.MY_DEPLOY,oncePerTurn:{key:'모두의 자연_1',limit:1},canResolve:ctx=>graveExile(ctx,isLiger).length>0,resolve(ctx){ const t=choose(ctx,graveExile(ctx,isLiger)); const r=addHand(ctx,t,t._z,'natureRecoverLiger',true); try{ if(typeof sendAction==='function') sendAction({type:'opDiscard',count:1,reason:'모두의 자연 ①'}); }catch(_){} dispatch(ctx); return r; }});
  add({id:'everyone-nature-2-send-self-search-beast-trap',cardId:'모두의 자연',effectNo:2,type:EFFECT_TYPES.ACTIVATION,zones:[ZONES.FIELD_ZONE],oncePerTurn:{key:'모두의 자연_2',limit:1},canResolve:ctx=>!!fieldCard(ctx)&&deck(ctx).some(c=>{const d=def(c); return d&&d.cardType==='trap'&&(isSaja(c)||isHorang(c));}),cost:ctx=>removeFieldCard(ctx,'nature2Cost'),resolve(ctx){ const r=addHand(ctx,choose(ctx,deck(ctx),c=>{const d=def(c); return d&&d.cardType==='trap'&&(isSaja(c)||isHorang(c));}),ZONES.DECK,'natureSearchTrap',true); dispatch(ctx); return r; }});
  add({id:'everyone-nature-3-summon-liger-king',cardId:'모두의 자연',effectNo:3,type:EFFECT_TYPES.QUICK,zones:[ZONES.FIELD_ZONE],timing:TIMING.EITHER_TURN,oncePerTurn:{key:'모두의 자연_3',limit:1},canResolve:ctx=>field(ctx).filter(isLigerMonster).length>=2&&hasFieldSpace(ctx)&&(hand(ctx).concat(grave(ctx)).concat(keyDeckArray(ctx))).some(c=>id(c)==='라이거 킹'),cost(ctx){ const mats=field(ctx).filter(isLigerMonster).slice(0,2); const results=mats.map(c=>sendGrave(ctx,c,ZONES.FIELD,ctrl(ctx),'nature3Cost')); return {ok:results.every(r=>r.ok),results};},resolve(ctx){ let from=hand(ctx).some(c=>id(c)==='라이거 킹')?ZONES.HAND:(grave(ctx).some(c=>id(c)==='라이거 킹')?ZONES.GRAVE:ZONES.KEY_DECK); const r=summon(ctx,'라이거 킹',from,'natureSummonLigerKingIgnoreCondition'); dispatch(ctx); return r; }});

  registry.registerEffects(effects); registry.syncEffectIdsToCards();
  const api=Object.freeze({getLigerEffectIds:()=>effects.map(e=>e.id),isLigerRelated: c => ['라이거','라이온','타이거'].includes((def(c)||{}).theme),getLigerImplementationSpec:()=>Object.freeze({phase:'16-8',cards:LIGER_IDS,effectCount:effects.length,criticalChecks:['라이온/타이거 이름 취급','라이거 킹 procedure','라이거 킹 내성','모두의 자연 필드 존 효과']})});
  global.HB_LIGER_EFFECTS=api;
})(window);