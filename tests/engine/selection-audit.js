// 선택/자동픽 감사(selection audit)
// ------------------------------------------------------------
// "플레이어가 골라야 하는데 코드가 첫 후보를 자동선택하는" 지점을 효과 단위로 객관 분류한다.
// 신호(effect.resolve 소스 + 런타임 속성 기반):
//   collectChoices 선언 → 엔진이 resolve 전 picker를 띄움 = 플레이어 선택 OK
//   requestHandDiscard/discardOneFromHand → 펭귄 버리기단계 picker = OK
//   firstOrSelected/chooseCards 인데 collectChoices 없음 → ctx.selectedCards가 비어 항상 첫 후보 = 자동(문제)
//   autoPick:true / _hbAutoPick → 강제 자동
// 한계: resolve 본문 텍스트 스캔이라 helper로 감싼 간접 선택은 과소집계될 수 있음(후속 수동검토 대상).
//
// 실행: node tests/engine/selection-audit.js [테마이름]
const vm = require('vm');
const { createContext, loadCore, loadAllEffects } = require('./_setup');

function runSelectionAudit(themeFilter) {
  const ctx = (typeof loadAllEffects === 'function' ? loadAllEffects : loadCore)(createContext());
  const registry = ctx.HB_EFFECT_REGISTRY;
  let CARDS = {};
  try { vm.runInContext('var __selCARDS = (typeof CARDS !== "undefined" ? CARDS : {});', ctx); CARDS = ctx.__selCARDS || {}; } catch (_) { CARDS = ctx.CARDS || {}; }
  const byId = {};
  Object.keys(CARDS).forEach(id => { byId[id] = CARDS[id]; });

  const allEffects = registry.listEffects();
  const PASSIVE_TYPES = new Set(['continuous', 'replacement', 'procedure', 'processingNegate']);
  const IMMUN_KEYS = ['effectImmunity', 'targetProtection', 'cannotBeSentToGrave', 'unaffectedByEffects', 'checkTargetProtection'];

  const rows = [];
  const immun = [];
  allEffects.forEach(effect => {
    const theme = effect.theme || (byId[effect.cardId] && byId[effect.cardId].theme) || '(미상)';
    if (themeFilter && theme !== themeFilter) return;
    const src = String(effect.resolve || '') + String(effect.canResolve || '');
    const hasCollect = typeof effect.collectChoices === 'function';
    const sig = {
      firstOrSelected: /firstOrSelected\s*\(/.test(src),
      chooseCards: /chooseCards\s*\(/.test(src),
      forcedAuto: /autoPick\s*:\s*true|_hbAutoPick/.test(src),
      discardPicker: /requestHandDiscard\s*\(|discardOneFromHand\s*\(/.test(src),
    };

    // 내성/보호 규칙 인벤토리
    const rule = effect.continuousRule || {};
    const immKeys = IMMUN_KEYS.filter(k => rule[k] || (Array.isArray(effect.tags) && effect.tags.includes(k)));
    if (immKeys.length) immun.push({ theme, cardId: effect.cardId, effectNo: effect.effectNo, id: effect.id, keys: immKeys });

    let verdict;
    if (PASSIVE_TYPES.has(effect.type)) {
      verdict = sig.forcedAuto ? 'PASSIVE_AUTOPICK' : 'PASSIVE';
    } else if (hasCollect) {
      verdict = 'OK_COLLECT';
    } else if (sig.discardPicker) {
      verdict = 'OK_DISCARD_PICKER';
    } else if (sig.forcedAuto) {
      verdict = 'FORCED_AUTOPICK';
    } else if (sig.firstOrSelected || sig.chooseCards) {
      verdict = 'AUTO_FIRST';
    } else {
      verdict = 'NO_SEL';
    }
    rows.push({ theme, cardId: effect.cardId, effectNo: effect.effectNo, id: effect.id, type: effect.type, verdict });
  });

  // ── 집계 ──
  const themes = {};
  const VKEYS = ['OK_COLLECT', 'OK_DISCARD_PICKER', 'AUTO_FIRST', 'FORCED_AUTOPICK', 'PASSIVE_AUTOPICK', 'PASSIVE', 'NO_SEL'];
  rows.forEach(r => {
    const t = (themes[r.theme] = themes[r.theme] || { total: 0 });
    t.total += 1; t[r.verdict] = (t[r.verdict] || 0) + 1;
  });

  console.log(`\n=== 선택/자동픽 감사: 총 ${rows.length}개 효과${themeFilter ? ` (테마: ${themeFilter})` : ''} ===`);
  console.log('범례: OK_COLLECT=엔진picker  OK_DISCARD_PICKER=버리기picker  AUTO_FIRST=첫후보자동(문제)  FORCED_AUTOPICK=강제자동(문제)');
  const pad = (s, n) => String(s).padEnd(n); const padL = (s, n) => String(s).padStart(n);
  console.log('\n' + pad('THEME', 12) + ['total', 'collect', 'discPk', 'AUTO1st', 'fAuto', 'pasvAuto', 'passive', 'noSel'].map(h => padL(h, 9)).join(''));
  Object.keys(themes).sort().forEach(t => {
    const c = themes[t];
    console.log(pad(t, 12) + [c.total, c.OK_COLLECT || 0, c.OK_DISCARD_PICKER || 0, c.AUTO_FIRST || 0, c.FORCED_AUTOPICK || 0, c.PASSIVE_AUTOPICK || 0, c.PASSIVE || 0, c.NO_SEL || 0].map(n => padL(n, 9)).join(''));
  });

  // ── 문제 목록(자동픽) ──
  const problems = rows.filter(r => r.verdict === 'AUTO_FIRST' || r.verdict === 'FORCED_AUTOPICK' || r.verdict === 'PASSIVE_AUTOPICK');
  console.log(`\n--- ⚠️ 플레이어 선택 누락 의심: ${problems.length}개 (첫 후보/강제 자동, collectChoices 없음) ---`);
  let lastTheme = null;
  problems.sort((a, b) => (a.theme + a.cardId).localeCompare(b.theme + b.cardId)).forEach(r => {
    if (r.theme !== lastTheme) { console.log(`  [${r.theme}]`); lastTheme = r.theme; }
    console.log(`    ${r.verdict === 'AUTO_FIRST' ? '①' : '★'} ${r.cardId} ${r.effectNo ? '#' + r.effectNo : ''}  (${r.id})`);
  });

  // ── 내성/보호 인벤토리 + 강제 실태 ──
  console.log(`\n--- 🛡 내성/보호 선언 효과: ${immun.length}개 ---`);
  immun.sort((a, b) => a.theme.localeCompare(b.theme)).forEach(i => {
    console.log(`    ${i.theme}: ${i.cardId} ${i.effectNo ? '#' + i.effectNo : ''} [${i.keys.join(',')}]`);
  });
  console.log('  ⚠️ 강제 실태: checkEffectImmunity 호출처 = penguin.js, circusmare.js 뿐 / card-move(파괴·묘지·제외) 미조회');
  console.log('             checkTargetProtection 호출처 = 0개 (완전 미작동) / effectImmune 플래그 read 없음');

  return { rows, problems, immun };
}

if (require.main === module) runSelectionAudit(process.argv[2] || null);
module.exports = runSelectionAudit;
