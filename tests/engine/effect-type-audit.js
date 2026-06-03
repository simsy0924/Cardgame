// 효과 타입(기동/유발즉시/유발/지속...) 검증 하니스
// ------------------------------------------------------------
// 사용자 규칙:
//   "표시가 안 되어 있으면 그 카드 종류를 본다.
//    몬스터·일반·필드 → 기동(activation), 함정·마법 → 유발즉시(quick)."
//
// 이 스크립트는 등록된 모든 효과에 대해:
//   - 현재 코드의 type 표시 (effect.type)
//   - 표시 여부 (effect.meta.inferredType === true 이면 '표시 없음', 기본값으로 떨어진 것)
//   - 카드 텍스트(CARDS[cardId].effects)의 ①②③ 줄에서 추정한 "규칙상 기대 타입"
// 을 한 줄로 정렬하고, 현재 표시와 규칙 기대가 어긋나는 항목을 ⚠️로 표시한다.
//
// 텍스트 추정은 휴리스틱이다(완벽하지 않음). 최종 판정은 사람이 한다.
//
// 실행: node tests/engine/effect-type-audit.js [테마이름]
const vm = require('vm');
const { createContext, loadAllEffects } = require('./_setup');

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

// 카드 전체 효과 텍스트를 ①②③ 단위로 분리한다. 반환: { 0: 머리말, 1: '...', 2: '...' }
function splitByCircled(fullText) {
  const buffers = { 0: '' };
  let current = 0;
  for (const ch of String(fullText || '')) {
    const idx = CIRCLED.indexOf(ch);
    if (idx !== -1) { current = idx + 1; buffers[current] = ''; }
    else { buffers[current] = (buffers[current] || '') + ch; }
  }
  return buffers;
}

// 카드 텍스트 한 줄에서 규칙상 기대 타입을 추정한다.
// 우선순위: 처리시무효 > 소환절차 > 유발(과거 사건) > 유발즉시(응답/상대턴) > 기동(자신턴) > 카드종류 폴백
function detectExpected(cardType, text, effectNo) {
  // 효과번호가 숫자가 아니면(별칭/룰상취급 등) 텍스트 매칭이 어긋나므로 수동확인 표시.
  if (effectNo != null && !/^\d+$/.test(String(effectNo))) {
    return { type: '(수동확인)', why: `효과번호 비정형(${effectNo}) — 텍스트 자동매칭 불가` };
  }
  const t = norm(text);
  if (!t) {
    // 텍스트 없음 → 순수 카드종류 폴백
    return fallbackByType(cardType, '텍스트없음');
  }

  // 처리 시 무효 (불가사의)
  if (/처리\s*시/.test(t) && /무효/.test(t)) return { type: 'processingNegate', why: '처리시 무효' };

  // 상대가 효과를 발동했을 때 / 효과가 발동했을 때 → 유발즉시(응답)
  if (/발동했을 때/.test(t) || /발동할 경우/.test(t)) return { type: 'quick', why: '상대 발동에 응답(…발동했을 때)' };

  // 전투/공격 선언 시·처리 시 → 유발(타이밍 트리거)
  if (/(공격\s*)?선언\s*시/.test(t)) return { type: 'trigger', why: '공격 선언 시(유발 타이밍)' };

  // 과거 사건 트리거: 받침 ㅆ + '을 경우/때' (소환했을/보내졌을/벗어났을/제외되었을/넣어졌을/버려졌을…)
  // 받침 ㅆ을 가진 음절을 광범위하게 매칭한다.
  if (/[가-힣]*[았었였졌했됐왔랐났겄섰썼]을\s*(경우|때)/.test(t)) {
    return { type: 'trigger', why: '사건 유발(…했을 경우/때)' };
  }
  // 미래 수동 '보내질 경우/제외될 경우' 류 (시기 대체 가능성) → 유발로 일단 분류
  if (/(보내질|제외될|버려질|벗어날)\s*경우/.test(t)) return { type: 'trigger', why: '시기 트리거(…될 경우)' };
  // 명령형 자동 발동 '~발동한다' (할 수 있다가 아님) → 유발(강제)
  if (/발동한다(\.|$)/.test(t) && !/발동할 수 있다/.test(t)) return { type: 'trigger', why: '강제 유발(발동한다)' };

  // 상대/양 턴 타이밍 → 유발즉시 (전개단계/전개 단계 띄어쓰기 모두 허용)
  if (/자신\s*\/\s*상대\s*(턴|전개\s*단계|공격\s*단계|드로우\s*단계|엔드\s*단계)/.test(t)
    || /상대\s*(턴에|전개\s*단계|공격\s*단계|드로우\s*단계|엔드\s*단계)/.test(t)) {
    return { type: 'quick', why: '상대/양 턴 타이밍' };
  }

  // 자신 턴 타이밍 → 기동
  if (/자신\s*(턴에|전개\s*단계|공격\s*단계|드로우\s*단계|엔드\s*단계)/.test(t)) {
    return { type: 'activation', why: '자신 턴 타이밍' };
  }

  // 표시 없음 → 카드 종류 폴백
  return fallbackByType(cardType, '타이밍표시 없음');
}

function fallbackByType(cardType, why) {
  if (cardType === 'trap' || cardType === 'magic') return { type: 'quick', why: `폴백:${cardType}→유발즉시 (${why})` };
  // monster, normal, field, (미상)
  return { type: 'activation', why: `폴백:${cardType || '?'}→기동 (${why})` };
}

const TYPE_KR = {
  activation: '기동', quick: '유발즉시', trigger: '유발', continuous: '지속',
  procedure: '소환절차', replacement: '대체', processingNegate: '처리시무효',
};
function kr(type) { return TYPE_KR[type] || type; }

// 구조적 타입(아래)은 기동/유발즉시 축과 무관하므로 불일치 판정에서 제외한다.
const STRUCTURAL = new Set(['continuous', 'procedure', 'replacement', 'processingNegate']);

function runTypeAudit(themeFilter) {
  const ctx = loadAllEffects(createContext());
  const registry = ctx.HB_EFFECT_REGISTRY;
  let CARDS = {};
  try { vm.runInContext('var __auditCARDS = (typeof CARDS !== "undefined" ? CARDS : {});', ctx); CARDS = ctx.__auditCARDS || {}; } catch (_) { CARDS = ctx.CARDS || {}; }

  const splitCache = {};
  function effectText(cardId, effectNo) {
    const def = CARDS[cardId];
    if (!def) return '';
    if (!splitCache[cardId]) splitCache[cardId] = splitByCircled(def.effects);
    const n = Number(effectNo);
    if (n && splitCache[cardId][n]) return splitCache[cardId][n];
    return def.effects || '';
  }

  const rows = [];
  registry.listEffects().forEach(effect => {
    const def = CARDS[effect.cardId] || {};
    const theme = effect.theme || def.theme || '(미상)';
    if (themeFilter && theme !== themeFilter) return;
    const cardType = def.cardType || '?';
    const marked = !(effect.meta && effect.meta.inferredType); // 표시 O/X
    const text = effectText(effect.cardId, effect.effectNo);
    const exp = detectExpected(cardType, text, effect.effectNo);

    let flag = 'ok';
    if (exp.type === '(수동확인)') {
      flag = 'manual';
    } else if (STRUCTURAL.has(effect.type)) {
      // 현재 구조적 타입: 규칙 축 밖. 단, 텍스트가 명백히 발동형인데 구조적이면 검토.
      flag = STRUCTURAL.has(exp.type) || exp.type === 'trigger' || exp.type === 'activation' || exp.type === 'quick' ? 'struct' : 'struct';
    } else if (effect.type !== exp.type) {
      flag = 'mismatch';
    }

    rows.push({
      theme, cardId: effect.cardId, effectNo: effect.effectNo, cardType,
      current: effect.type, timing: effect.timing || 'none', marked,
      expected: exp.type, why: exp.why, flag,
      text: norm(text).slice(0, 70),
    });
  });

  // ── 보고 ──
  const byTheme = {};
  rows.forEach(r => { (byTheme[r.theme] = byTheme[r.theme] || []).push(r); });

  console.log(`\n===== 효과 타입 검증 ${themeFilter ? `(테마: ${themeFilter})` : '(전체)'} — 총 ${rows.length}개 =====`);
  console.log('표기: [카드종류] 카드 #효과  현재(표시?)  →  텍스트추정   판정\n');

  Object.keys(byTheme).sort().forEach(theme => {
    const list = byTheme[theme].sort((a, b) => (a.cardId.localeCompare(b.cardId)) || ((a.effectNo || 0) - (b.effectNo || 0)));
    const mism = list.filter(r => r.flag === 'mismatch').length;
    console.log(`\n── ${theme}  (${list.length}개, ⚠️불일치 ${mism}) ─────────────`);
    list.forEach(r => {
      const mark = r.marked ? '표시O' : '표시X';
      const sign = r.flag === 'mismatch' ? '⚠️ ' : (r.flag === 'struct' ? '·  ' : '   ');
      const arrow = `${kr(r.current)}(${mark}) → ${kr(r.expected)}`;
      console.log(`${sign}[${r.cardType}] ${r.cardId} #${r.effectNo}  ${arrow}  [timing:${r.timing}]  | ${r.why}`);
      if (r.flag === 'mismatch') console.log(`       ↳ "${r.text}"`);
    });
  });

  // 요약
  const mismatches = rows.filter(r => r.flag === 'mismatch');
  const markedMismatch = mismatches.filter(r => r.marked);
  const inferredMismatch = mismatches.filter(r => !r.marked);
  console.log(`\n===== 요약 =====`);
  console.log(`총 ${rows.length}개 중 ⚠️ 규칙 불일치 ${mismatches.length}개`);
  console.log(`  - 표시X(기본값으로 떨어진) 불일치: ${inferredMismatch.length}개  ← 우선 검토`);
  console.log(`  - 표시O(코드에 명시했는데 규칙과 다름) 불일치: ${markedMismatch.length}개  ← 의도적 예외인지 확인`);

  return rows;
}

if (require.main === module) {
  runTypeAudit(process.argv[2] || null);
}
module.exports = runTypeAudit;
