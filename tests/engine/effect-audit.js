// 효과 감사(audit) 하니스
// ------------------------------------------------------------
// 등록된 모든 효과를 "관대한" 게임 상태에서 실행해 객관적 고장 신호를 수집한다.
// 정확성 100% 검증이 아니라(미세한 룰 오류는 못 잡음), 다음을 테마별로 목록화한다:
//   💥 CRASH        : condition/canResolve/resolve 중 예외 (특히 "is not a function/defined" = 미정의 헬퍼 = 확정 버그)
//   🚫 BLOCKED      : 관대한 상태에서도 canResolve가 false (발동 불가 — 검토 필요, 상태의존 가능)
//   ⛔ COND_FALSE   : condition이 false (타이밍/조건 — 검토 필요)
//   ❓ RESOLVE_FAIL : resolve가 {ok:false} 반환
//   ✅ RAN          : resolve가 예외 없이 실행됨
//   ⚙️ PASSIVE      : continuous/replacement (직접 발동 안 함 — resolve 미실행)
//
// 실행: node tests/engine/effect-audit.js [테마이름]
const vm = require('vm');
const { createContext, loadCore, loadAllEffects, makeState } = require('./_setup');

function runEffectAudit(themeFilter) {
  const ctx = (typeof loadAllEffects === 'function' ? loadAllEffects : loadCore)(createContext());
  const registry = ctx.HB_EFFECT_REGISTRY;
  const ctxFactory = ctx.HB_EFFECT_CONTEXT;
  // CARDS는 cards.js의 const lexical 바인딩이라 ctx 프로퍼티로 직접 접근되지 않는다.
  // vm 컨텍스트 내부에서 var로 복사해 꺼낸다.
  let CARDS = {};
  try { vm.runInContext('var __auditCARDS = (typeof CARDS !== "undefined" ? CARDS : {});', ctx); CARDS = ctx.__auditCARDS || {}; } catch (_) { CARDS = ctx.CARDS || {}; }
  const ZONES = (ctx.HB_RULES && ctx.HB_RULES.ZONES) || {};
  const Z = {
    DECK: ZONES.DECK || 'deck', HAND: ZONES.HAND || 'hand', PUBLIC_HAND: ZONES.PUBLIC_HAND || 'publicHand',
    FIELD: ZONES.FIELD || 'field', FIELD_ZONE: ZONES.FIELD_ZONE || 'fieldZone',
    GRAVE: ZONES.GRAVE || 'grave', EXILE: ZONES.EXILE || 'exile', KEY_DECK: ZONES.KEY_DECK || 'keyDeck',
  };

  const allEffects = registry.listEffects();
  const byId = {};
  Object.keys(CARDS).forEach(id => { byId[id] = CARDS[id]; });

  function mk(id) {
    const c = byId[id] || {};
    return { id, name: c.name || id, atk: c.atk || 0, atkBase: c.atk || 0, isKeyCard: !!c.isKeyCard, cardType: c.cardType };
  }
  function themeCards(theme, pred) {
    return Object.keys(CARDS).filter(id => (!theme || CARDS[id].theme === theme) && (!pred || pred(CARDS[id]))).map(mk);
  }
  function monstersOf(theme) { return themeCards(theme, c => c.cardType === 'monster'); }

  // 효과 하나에 대해 "모든 자원이 풍부한" 상태를 만든다.
  function buildGenerousState(effect, sourceZone) {
    const theme = effect.theme || (byId[effect.cardId] && byId[effect.cardId].theme) || null;
    const tMons = monstersOf(theme);
    const tAll = themeCards(theme);
    const selfCard = mk(effect.cardId);
    const fieldMons = (tMons.length ? tMons : themeCards(null, c => c.cardType === 'monster')).slice(0, 3);
    const opMons = themeCards(null, c => c.cardType === 'monster').slice(0, 3);

    const state = makeState({
      myDeck: tAll.slice(0, 8).concat([selfCard]),
      myHand: [selfCard].concat(tAll.slice(0, 4)),
      myField: fieldMons.slice(0, 2),
      myGrave: tAll.slice(0, 4).concat([selfCard]),
      myExile: tAll.slice(0, 2).concat([selfCard]),
      myKeyDeck: themeCards(theme, c => c.isKeyCard).slice(0, 5).concat([selfCard]),
      opField: opMons.slice(0, 2),
      opHand: opMons.slice(0, 3),
      opDeck: opMons.slice(0, 5),
      opGrave: opMons.slice(0, 2),
    });

    // 효과의 소스 존에 자기 카드를 0번 인덱스로 보장
    const zoneToArr = {
      [Z.DECK]: 'myDeck', [Z.HAND]: 'myHand', [Z.PUBLIC_HAND]: 'myHand',
      [Z.FIELD]: 'myField', [Z.GRAVE]: 'myGrave', [Z.EXILE]: 'myExile', [Z.KEY_DECK]: 'myKeyDeck',
    };
    const arrName = zoneToArr[sourceZone];
    if (sourceZone === Z.FIELD_ZONE) {
      state.myFieldCard = selfCard;
    } else if (arrName) {
      const card = sourceZone === Z.PUBLIC_HAND ? Object.assign({}, selfCard, { isPublic: true }) : selfCard;
      state[arrName] = [card].concat((state[arrName] || []).filter(c => c.id !== effect.cardId));
    }
    return state;
  }

  function buildEvent(effect, sourceZone) {
    const evType = (effect.events && effect.events[0]) || effect.event || null;
    if (!evType) return null;
    return {
      type: evType, cardId: effect.cardId, controller: 'me',
      to: { controller: 'me', zone: sourceZone },
      from: { controller: 'me', zone: Z.DECK },
      reveal: sourceZone === Z.PUBLIC_HAND, eventData: { reveal: sourceZone === Z.PUBLIC_HAND },
    };
  }

  function isUndefinedRefError(msg) {
    return /is not a function|is not defined|Cannot read propert|undefined is not/.test(String(msg || ''));
  }

  const results = [];
  allEffects.forEach(effect => {
    const theme = effect.theme || (byId[effect.cardId] && byId[effect.cardId].theme) || '(미상)';
    if (themeFilter && theme !== themeFilter) return;

    const type = effect.type;
    const passive = type === 'continuous' || type === 'replacement';
    const sourceZone = (effect.zones && effect.zones[0]) || effect.zone || Z.HAND;
    const rec = { id: effect.id, cardId: effect.cardId, effectNo: effect.effectNo, theme, type, status: '', detail: '' };

    try {
      const state = buildGenerousState(effect, sourceZone);
      ctx.G = state;
      const event = (type === 'trigger') ? buildEvent(effect, sourceZone) : null;
      const ectx = ctxFactory.createEffectContext({
        gameState: state, controller: 'me', effect, cardId: effect.cardId,
        sourceZone, sourceIndex: 0, source: { controller: 'me', zone: sourceZone, index: 0 },
        event,
      });

      let condOk = true, crOk = true;
      if (typeof effect.condition === 'function') condOk = effect.condition(ectx) !== false;
      if (typeof effect.canResolve === 'function') crOk = effect.canResolve(ectx) !== false;

      if (passive) { rec.status = 'PASSIVE'; }
      else if (!condOk) { rec.status = 'COND_FALSE'; }
      else if (!crOk) { rec.status = 'BLOCKED'; }
      else if (typeof effect.resolve === 'function') {
        const r = effect.resolve(ectx);
        if (r && r.ok === false) { rec.status = 'RESOLVE_FAIL'; rec.detail = r.error || ''; }
        else { rec.status = 'RAN'; }
      } else { rec.status = 'NO_RESOLVE'; }
    } catch (err) {
      rec.status = isUndefinedRefError(err.message) ? 'CRASH_REF' : 'CRASH';
      rec.detail = String(err.message || err).slice(0, 160);
    }
    results.push(rec);
  });

  // ── 보고 ──
  const order = ['CRASH_REF', 'CRASH', 'BLOCKED', 'RESOLVE_FAIL', 'COND_FALSE', 'NO_RESOLVE', 'RAN', 'PASSIVE'];
  const icon = { CRASH_REF: '💥REF', CRASH: '💥', BLOCKED: '🚫', RESOLVE_FAIL: '❓', COND_FALSE: '⛔', NO_RESOLVE: '∅', RAN: '✅', PASSIVE: '⚙️' };
  const counts = {};
  results.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });

  console.log(`\n=== 효과 감사: 총 ${results.length}개${themeFilter ? ` (테마: ${themeFilter})` : ''} ===`);
  console.log(order.filter(s => counts[s]).map(s => `${icon[s]} ${s}=${counts[s]}`).join('  '));

  // 테마별 집계
  const themes = {};
  results.forEach(r => { (themes[r.theme] = themes[r.theme] || {}).total = (themes[r.theme].total || 0) + 1; themes[r.theme][r.status] = (themes[r.theme][r.status] || 0) + 1; });
  console.log('\n--- 테마별 ---');
  Object.keys(themes).sort().forEach(t => {
    const tc = themes[t];
    const broken = (tc.CRASH_REF || 0) + (tc.CRASH || 0) + (tc.BLOCKED || 0) + (tc.RESOLVE_FAIL || 0);
    console.log(`  ${t}: ${tc.total}개 | 의심 ${broken} (💥${(tc.CRASH_REF||0)+(tc.CRASH||0)} 🚫${tc.BLOCKED||0} ❓${tc.RESOLVE_FAIL||0}) | ✅${tc.RAN||0} ⚙️${tc.PASSIVE||0} ⛔${tc.COND_FALSE||0}`);
  });

  // 크래시 상세 (가장 확실한 버그)
  const crashes = results.filter(r => r.status === 'CRASH_REF' || r.status === 'CRASH');
  if (crashes.length) {
    console.log(`\n--- 💥 크래시 상세 (${crashes.length}) — 확정 버그 우선 ---`);
    crashes.forEach(r => console.log(`  [${r.theme}] ${r.cardId} #${r.effectNo} (${r.type}) ${icon[r.status]}: ${r.detail}`));
  }
  // 발동 불가 상세
  const blocked = results.filter(r => r.status === 'BLOCKED' || r.status === 'RESOLVE_FAIL');
  if (blocked.length) {
    console.log(`\n--- 🚫/❓ 발동불가·해결실패 (${blocked.length}) — 상태의존 가능, 검토 필요 ---`);
    blocked.forEach(r => console.log(`  [${r.theme}] ${r.cardId} #${r.effectNo} (${r.type}) ${icon[r.status]}${r.detail ? ': ' + r.detail : ''}`));
  }
  return results;
}

if (require.main === module) {
  runEffectAudit(process.argv[2] || null);
}
module.exports = runEffectAudit;
