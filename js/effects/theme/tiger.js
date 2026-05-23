// HAND BATTLE — Theme Effects: Tiger
// 16-8단계: 타이거 테마를 EffectDefinition 기반으로 이식한다.
// 핵심: 몬스터 존 축소 지속효과, 호랑이/타이거 명칭 취급, 타이거 킹 내성.
(function initTigerEffectDefinitions(global) {
  'use strict';
  const rules = global.HB_RULES || {};
  const EFFECT_TYPES = rules.EFFECT_TYPES || { ACTIVATION:'activation', QUICK:'quick', TRIGGER:'trigger', CONTINUOUS:'continuous', PROCEDURE:'procedure' };
  const ZONES = rules.ZONES || { DECK:'deck', HAND:'hand', PUBLIC_HAND:'publicHand', FIELD:'field', GRAVE:'grave', EXILE:'exile' };
  const EVENTS = rules.EVENTS || { SUMMON:'summon', SENT_TO_GRAVE:'sentToGrave', EXILED:'exiled', ADDED_TO_HAND:'addedToHand' };
  const TIMING = rules.TIMING || { MY_DEPLOY:'myDeploy', EITHER_TURN:'eitherTurn', ON_SUMMON:'onSummon' };
  const TAGS = rules.EFFECT_TAGS || {};
  const registry = global.HB_EFFECT_REGISTRY;
  const zoneAccess = global.HB_ZONE_ACCESS;
  if (!registry || !zoneAccess) throw new Error('[tiger-effects] registry/zone-access가 필요합니다.');
  const CONTROLLERS = zoneAccess.CONTROLLERS || { ME:'me', OPPONENT:'opponent' };
  const effects = [];
  const TIGER_IDS = ['베이비 타이거','젊은 타이거','에이스 타이거','호랑이의 포효','호랑이의 사냥','호랑이의 발톱','호랑이의 일격','진정한 호랑이','고고한 호랑이','타이거 킹'];
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
  function isMonster(c){ const d=def(c); return !!(d&&d.cardType==='monster'); }
  function isTiger(c){ const d=def(c); return !!(d&&d.theme==='타이거'); }
  function isTigerMonster(c){ return isTiger(c)&&isMonster(c); }
  function isHorang(c){ const x=id(c); return x.includes('호랑이')||x==='진정한 호랑이'||x==='고고한 호랑이'; }
  function isHorangMonster(c){ return isHorang(c)&&isMonster(c); }
  function first(a,p){ return (a||[]).find(p||(_=>_)); }
  function selectedId(ctx){ return id(ctx&&(ctx.selectedCard||ctx.selectedTarget||ctx.target||ctx.selectedCardId)); }
  function choose(ctx,list,p){ const sid=selectedId(ctx); if(sid){ const hit=(list||[]).find(c=>id(c)===sid&&(!p||p(c))); if(hit) return hit; } return first(list,p); }
  function hasFieldSpace(ctx,c){ return global.HB_CARD_MOVE&&global.HB_CARD_MOVE.hasFieldSpace?global.HB_CARD_MOVE.hasFieldSpace(state(ctx),c||ctrl(ctx)):field(ctx,c).length<5; }
  function addHand(ctx,c,from,reason,reveal){ return ctx.move.addToHand({cardId:id(c),controller:ctrl(ctx),from:{controller:ctrl(ctx),zone:from},reason,reveal:!!reveal}); }
  function summon(ctx,c,from,reason){ return ctx.move.summonCard({cardId:id(c),controller:ctrl(ctx),from:{controller:ctrl(ctx),zone:from},reason}); }
  function sendGrave(ctx,c,from,controller,reason){ const owner=controller||ctrl(ctx); return ctx.move.sendToGrave({cardId:id(c),controller:owner,from:{controller:owner,zone:from},reason}); }
  function banish(ctx,c,from,controller,reason){ const owner=controller||ctrl(ctx); return ctx.move.banishCard({cardId:id(c),controller:owner,from:{controller:owner,zone:from},reason}); }
  function dispatch(ctx){ if(global.HB_EVENTS) global.HB_EVENTS.dispatchEvents(state(ctx)); try{ if(typeof sendGameState==='function') sendGameState(); if(typeof renderAll==='function') renderAll(); }catch(_){} } // eslint-disable-line no-undef
  function mk(o){ return Object.assign({theme:'타이거',optional:true},o); }
  function add(o){ effects.push(mk(o)); }

  add({id:'young-tiger-3-zone-minus-two',cardId:'젊은 타이거',effectNo:3,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD],continuousRule:{monsterZoneDelta:ctx=>({controller:ctx.controller,amount:-2})}});
  add({id:'ace-tiger-3-zone-minus-two',cardId:'에이스 타이거',effectNo:3,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD],continuousRule:{monsterZoneDelta:ctx=>({controller:ctx.controller,amount:-2})}});
  add({id:'true-tiger-name-treated-as-horang',cardId:'진정한 호랑이',effectNo:0,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD,ZONES.HAND,ZONES.GRAVE,ZONES.EXILE],continuousRule:{nameTreatAs:['호랑이']}});
  add({id:'lonely-tiger-name-treated-as-horang',cardId:'고고한 호랑이',effectNo:0,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD,ZONES.HAND,ZONES.GRAVE,ZONES.EXILE],continuousRule:{nameTreatAs:['호랑이']}});
  add({id:'tiger-king-4-lone-grave-protection',cardId:'타이거 킹',effectNo:4,type:EFFECT_TYPES.CONTINUOUS,zones:[ZONES.FIELD],continuousRule:{cannotBeSentToGrave:(checkCtx,sourceCtx)=>id(checkCtx.target)==='타이거 킹'&&checkCtx.targetController===sourceCtx.controller&&field(sourceCtx,sourceCtx.controller).filter(c=>id(c)!=='타이거 킹').length===0}});

  add({id:'baby-tiger-1-search-two-summon-banish-self',cardId:'베이비 타이거',effectNo:1,type:EFFECT_TYPES.ACTIVATION,zones:[ZONES.HAND],oncePerTurn:{key:'베이비 타이거_1',limit:1},canResolve:ctx=>deck(ctx).some(c=>isTiger(c)&&id(c)!=='베이비 타이거')&&deck(ctx).some(isHorang)&&hand(ctx).some(isTigerMonster)&&hasFieldSpace(ctx),resolve(ctx){ const t=choose(ctx,deck(ctx),c=>isTiger(c)&&id(c)!=='베이비 타이거'); const h=choose(ctx,deck(ctx),isHorang); const sm=choose(ctx,hand(ctx),isTigerMonster); const r1=addHand(ctx,t,ZONES.DECK,'babyTigerSearchTiger',true); const r2=addHand(ctx,h,ZONES.DECK,'babyTigerSearchHorang',true); const r3=summon(ctx,sm,ZONES.HAND,'babyTigerSummonTiger'); const r4=banish(ctx,'베이비 타이거',ZONES.HAND,ctrl(ctx),'babyTigerBanishSelf'); dispatch(ctx); return {ok:r1.ok&&r2.ok&&r3.ok,results:[r1,r2,r3,r4]};}});
  add({id:'baby-tiger-2-exiled-discard-op-hand',cardId:'베이비 타이거',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.EXILE],events:[EVENTS.EXILED],condition:ctx=>ctx.event&&ctx.event.cardId==='베이비 타이거',canResolve:ctx=>zone(ctx,opp(ctx),ZONES.HAND).length>0,resolve(ctx){ try{ if(typeof sendAction==='function') sendAction({type:'forceDiscard',count:1,reason:'베이비 타이거 ②'}); }catch(_){} dispatch(ctx); return {ok:true}; }});
  add({id:'young-tiger-1-public-search-two-horang',cardId:'젊은 타이거',effectNo:1,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.PUBLIC_HAND],events:[EVENTS.ADDED_TO_HAND],oncePerTurn:{key:'젊은 타이거_1',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='젊은 타이거',canResolve:ctx=>deck(ctx).filter(isHorang).length>=1,resolve(ctx){ const picks=deck(ctx).filter(isHorang).slice(0,2); const results=picks.map(c=>addHand(ctx,c,ZONES.DECK,'youngTigerSearchHorang',true)); dispatch(ctx); return {ok:results.length>0,results};}});
  add({id:'young-tiger-2-on-summon-summon-tiger-from-deck',cardId:'젊은 타이거',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.FIELD],events:[EVENTS.SUMMON],oncePerTurn:{key:'젊은 타이거_2',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='젊은 타이거',canResolve:ctx=>deck(ctx).some(isTigerMonster)&&hasFieldSpace(ctx),resolve(ctx){ const r=summon(ctx,choose(ctx,deck(ctx),isTigerMonster),ZONES.DECK,'youngTigerDeckSummon'); dispatch(ctx); return r; }});
  add({id:'ace-tiger-1-hand-summon-send-each-monster',cardId:'에이스 타이거',effectNo:1,type:EFFECT_TYPES.ACTIVATION,zones:[ZONES.HAND],oncePerTurn:{key:'에이스 타이거_1',limit:1},canResolve:ctx=>field(ctx).some(isTigerMonster)&&hasFieldSpace(ctx),resolve(ctx){ const r1=summon(ctx,'에이스 타이거',ZONES.HAND,'aceTigerSummon'); const mine=choose(ctx,field(ctx),isMonster); const op=choose(ctx,field(ctx,opp(ctx)),isMonster); const r2=mine?sendGrave(ctx,mine,ZONES.FIELD,ctrl(ctx),'aceTigerSendMine'):{ok:true}; const r3=op?sendGrave(ctx,op,ZONES.FIELD,opp(ctx),'aceTigerSendOp'):{ok:true}; dispatch(ctx); return {ok:r1.ok,results:[r1,r2,r3]}; }});
  add({id:'ace-tiger-2-sent-search-tiger-and-horang',cardId:'에이스 타이거',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.GRAVE],events:[EVENTS.SENT_TO_GRAVE],oncePerTurn:{key:'에이스 타이거_2',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='에이스 타이거',canResolve:ctx=>deck(ctx).some(isTiger)&&deck(ctx).some(isHorang),resolve(ctx){ const r1=addHand(ctx,choose(ctx,deck(ctx),isTiger),ZONES.DECK,'aceTigerSearchTiger',true); const r2=addHand(ctx,choose(ctx,deck(ctx),c=>isHorang(c)&&id(c)!==id(r1.movedCard)),ZONES.DECK,'aceTigerSearchHorang',true); dispatch(ctx); return {ok:r1.ok&&r2.ok,results:[r1,r2]}; }});
  add({id:'tiger-roar-banish-deck-tiger-monsters',cardId:'호랑이의 포효',effectNo:1,type:EFFECT_TYPES.ACTIVATION, cardActivationCost: true,zones:[ZONES.HAND],canResolve:ctx=>deck(ctx).some(isTigerMonster),resolve(ctx){ const results=deck(ctx).filter(isTigerMonster).slice().map(c=>banish(ctx,c,ZONES.DECK,ctrl(ctx),'tigerRoarBanish')); dispatch(ctx); return {ok:results.length>0,results}; }});
  add({id:'tiger-hunt-hand-summon-horang',cardId:'호랑이의 사냥',effectNo:1,type:EFFECT_TYPES.ACTIVATION, cardActivationCost: true,zones:[ZONES.HAND],canResolve:ctx=>hand(ctx).some(isHorangMonster)&&hasFieldSpace(ctx),resolve(ctx){ const r=summon(ctx,choose(ctx,hand(ctx),isHorangMonster),ZONES.HAND,'tigerHuntSummon'); dispatch(ctx); return r; }});
  add({id:'tiger-claw-exile-summon-horang',cardId:'호랑이의 발톱',effectNo:1,type:EFFECT_TYPES.ACTIVATION, cardActivationCost: true,zones:[ZONES.HAND],canResolve:ctx=>exile(ctx).some(isHorangMonster)&&hasFieldSpace(ctx),resolve(ctx){ const r=summon(ctx,choose(ctx,exile(ctx),isHorangMonster),ZONES.EXILE,'tigerClawSummon'); dispatch(ctx); return r; }});
  add({id:'tiger-strike-op-field-banish-by-tigers',cardId:'호랑이의 일격',effectNo:1,type:EFFECT_TYPES.QUICK, cardActivationCost: true,zones:[ZONES.HAND],timing:TIMING.EITHER_TURN,canResolve:ctx=>field(ctx).some(isTigerMonster)&&field(ctx,opp(ctx)).length>0,resolve(ctx){ const count=field(ctx).filter(isTigerMonster).length; const targets=field(ctx,opp(ctx)).slice(0,count); const results=targets.map(c=>banish(ctx,c,ZONES.FIELD,opp(ctx),'tigerStrikeBanish')); dispatch(ctx); return {ok:results.length>0,results}; }});
  add({id:'true-tiger-1-banish-three-from-deck-summon-one',cardId:'진정한 호랑이',effectNo:1,type:EFFECT_TYPES.ACTIVATION, cardActivationCost: true,zones:[ZONES.HAND],canResolve:ctx=>['베이비 타이거','젊은 타이거','에이스 타이거'].every(n=>deck(ctx).some(c=>id(c)===n))&&hasFieldSpace(ctx),resolve(ctx){ const picks=['베이비 타이거','젊은 타이거','에이스 타이거'].map(n=>first(deck(ctx),c=>id(c)===n)); const sm=choose(ctx,picks)||picks[0]; picks.forEach(c=>{ if(id(c)!==id(sm)) banish(ctx,c,ZONES.DECK,ctrl(ctx),'trueTigerBanishCost'); }); const r=summon(ctx,sm,ZONES.DECK,'trueTigerSummon'); dispatch(ctx); return r; }});
  add({id:'tiger-king-1-procedure-summon',cardId:'타이거 킹',effectNo:1,type:EFFECT_TYPES.PROCEDURE,zones:[ZONES.HAND],summonProcedure:true,canResolve:ctx=>field(ctx).some(isTigerMonster)&&hasFieldSpace(ctx),resolve(ctx){ const mat=choose(ctx,field(ctx),isTigerMonster); const cost=sendGrave(ctx,mat,ZONES.FIELD,ctrl(ctx),'tigerKingCost'); const r=summon(ctx,'타이거 킹',ZONES.HAND,'tigerKingProcedure'); const st=state(ctx); st.tigerKingLeftZoneLocked=true; dispatch(ctx); return {ok:cost.ok&&r.ok,cost,summon:r}; }});
  add({id:'tiger-king-2-on-summon-banish-three-op',cardId:'타이거 킹',effectNo:2,type:EFFECT_TYPES.TRIGGER,zones:[ZONES.FIELD],events:[EVENTS.SUMMON],oncePerTurn:{key:'타이거 킹_2',limit:1},condition:ctx=>ctx.event&&ctx.event.cardId==='타이거 킹',canResolve:ctx=>field(ctx,opp(ctx)).length>0,resolve(ctx){ const results=field(ctx,opp(ctx)).slice(0,3).map(c=>banish(ctx,c,ZONES.FIELD,opp(ctx),'tigerKingBanish3')); dispatch(ctx); return {ok:results.length>0,results}; }});
  add({id:'tiger-king-3-quick-banish-two-op',cardId:'타이거 킹',effectNo:3,type:EFFECT_TYPES.QUICK,zones:[ZONES.FIELD],timing:TIMING.EITHER_TURN,oncePerTurn:{key:'타이거 킹_3',limit:1},canResolve:ctx=>field(ctx,opp(ctx)).length>0,resolve(ctx){ const results=field(ctx,opp(ctx)).slice(0,2).map(c=>banish(ctx,c,ZONES.FIELD,opp(ctx),'tigerKingQuickBanish2')); dispatch(ctx); return {ok:results.length>0,results}; }});
  add({id:'lonely-tiger-1-search',cardId:'고고한 호랑이',effectNo:1,type:EFFECT_TYPES.ACTIVATION, cardActivationCost: true,zones:[ZONES.HAND],canResolve:ctx=>deck(ctx).some(c=>isTiger(c)||isHorang(c)),resolve(ctx){ const r=addHand(ctx,choose(ctx,deck(ctx),c=>isTiger(c)||isHorang(c)),ZONES.DECK,'lonelyTigerSearch',true); dispatch(ctx); return r; }});
  add({id:'lonely-tiger-2-banish-op-field',cardId:'고고한 호랑이',effectNo:2,type:EFFECT_TYPES.ACTIVATION, cardActivationCost: true,zones:[ZONES.HAND],canResolve:ctx=>field(ctx,opp(ctx)).length>0,resolve(ctx){ const r=banish(ctx,choose(ctx,field(ctx,opp(ctx))),ZONES.FIELD,opp(ctx),'lonelyTigerBanish'); dispatch(ctx); return r; }});
  registry.registerEffects(effects); registry.syncEffectIdsToCards();
  const api=Object.freeze({getTigerEffectIds:()=>effects.map(e=>e.id),isHorangCard:isHorang,isTigerCard:isTiger,getTigerImplementationSpec:()=>Object.freeze({phase:'16-8',cards:TIGER_IDS,effectCount:effects.length,criticalChecks:['몬스터 존 축소 continuous','호랑이/타이거 명칭 취급','타이거 킹 protection','처리 불가 발동 차단']})});
  global.HB_TIGER_EFFECTS=api;
})(window);
