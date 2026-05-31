// account.js — 계정, 로그인, 전적 기록
// ACCOUNT SYSTEM — loadFirebase에 의존, 절대 독립 로드 안 함
// ═══════════════════════════════════════════
let fsdb = null;
let currentUser = null;
let userProfile = null;
window.fsdb = null;
window.currentUser = null;
window.userProfile = null;
let gameResultRecorded = false;
let authInitialized = false;

function initAuth() {
  if (authInitialized) return;
  authInitialized = true;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  fsdb = firebase.firestore();
  window.fsdb = fsdb;
  firebase.auth().getRedirectResult().catch(e => console.warn('redirect:', e));
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    window.currentUser = user;
    if (user) {
      await ensureUserDoc(user);
      userProfile = await getUserProfile(user.uid);
      window.userProfile = userProfile;
      renderProfileUI(user);
      checkAdminUI();
      const ni = document.getElementById('playerName');
      if (ni && !ni.value.trim()) ni.value = userProfile?.nickname || user.displayName || '';
    } else {
      userProfile = null;
      window.userProfile = null;
      renderLoggedOutUI();
      checkAdminUI();
    }
  });
}

function signInWithGoogle() {
  if (!firebaseLoaded) {
    notify('로그인 준비 중...');
    loadFirebase(() => { initAuth(); _doGooglePopup(); });
    return;
  }
  if (!authInitialized) initAuth();
  _doGooglePopup();
}

function _doGooglePopup() {
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(e => {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      notify('팝업이 차단됐습니다. 브라우저의 팝업 허용 후 다시 시도하세요.');
    } else {
      notify('로그인 실패: ' + e.message);
    }
  });
}

function signOutUser() {
  if (!firebase || !firebase.auth) return;
  firebase.auth().signOut().then(() => notify('로그아웃 완료'));
}

async function ensureUserDoc(user) {
  if (!fsdb) return;
  const ref = fsdb.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid: user.uid, nickname: user.displayName || '플레이어',
      email: user.email || '', photoURL: user.photoURL || '',
      currency: 0, totalWins: 0, totalLosses: 0, totalGames: 0, rank: 1000,
      ownedItems: [], equippedSleeve: 'default', equippedBoard: 'default', unlockedCards: ['펭귄 병사','황제 펭귄','펭귄 부부','전략 회의'],
      starterDeckMain: ['펭귄 병사','펭귄 병사','펭귄 병사','황제 펭귄','황제 펭귄','펭귄 부부','전략 회의'],
      starterDeckKey: ['황제 펭귄'],
      tutorialCompleted: false, claimedMissions: [],
      selectedStarterTheme: null,
      isAdmin: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function getUserProfile(uid) {
  if (!fsdb) return null;
  try { const s = await fsdb.collection('users').doc(uid).get(); return s.exists ? s.data() : null; }
  catch(e) { return null; }
}

async function recordGameResult(win) {
  if (!currentUser || !fsdb || gameResultRecorded) return;
  gameResultRecorded = true;
  const earned = win ? 40 : 0;
  try {
    await fsdb.runTransaction(async (tx) => {
      const ref = fsdb.collection('users').doc(currentUser.uid);
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const d = doc.data();
      tx.update(ref, {
        currency: firebase.firestore.FieldValue.increment(earned),
        totalWins: firebase.firestore.FieldValue.increment(win ? 1 : 0),
        totalLosses: firebase.firestore.FieldValue.increment(win ? 0 : 1),
        totalGames: firebase.firestore.FieldValue.increment(1),
        rank: Math.max(0, (d.rank || 1000) + (win ? 25 : -20)),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await fsdb.collection('users').doc(currentUser.uid).collection('gameHistory').add({
      result: win ? 'win' : 'loss', currency: earned,
      roomCode: roomCode || 'unknown',
      playedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    userProfile = await getUserProfile(currentUser.uid);
    notify((win ? '🏆 승리' : '💀 패배') + '! ' + (earned > 0 ? ('재화 +' + earned) : '재화 획득 없음') + ' (합계: ' + (userProfile?.currency ?? '?') + ')');
  } catch(e) { console.error('결과 기록 실패:', e); }
}

async function saveNickname() {
  if (!currentUser || !fsdb) { notify('로그인 필요'); return; }
  const input = document.getElementById('nicknameInput');
  const newNick = (input?.value || '').trim();
  if (!newNick) { notify('닉네임을 입력하세요.'); return; }
  try {
    await fsdb.collection('users').doc(currentUser.uid).update({ nickname: newNick, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    userProfile = await getUserProfile(currentUser.uid);
    const nameEl = document.getElementById('profileName');
    if (nameEl) nameEl.textContent = newNick;
    const playerNameEl = document.getElementById('playerName');
    if (playerNameEl) playerNameEl.value = newNick;
    input.value = '';
    notify("닉네임이 '" + newNick + "'으로 변경되었습니다.");
  } catch(e) { notify('닉네임 저장 실패: ' + e.message); }
}

function renderProfileUI(user) {
  document.getElementById('loginArea').style.display = 'none';
  document.getElementById('profileArea').style.display = '';
  const avatar = document.getElementById('profileAvatar');
  if (avatar) avatar.src = user.photoURL || '';
  const nameEl = document.getElementById('profileName');
  if (nameEl) nameEl.textContent = userProfile?.nickname || user.displayName || '';
  const statsEl = document.getElementById('profileStats');
  if (statsEl) statsEl.textContent = (userProfile?.totalWins||0) + '승 ' + (userProfile?.totalLosses||0) + '패  ·  랭크 ' + (userProfile?.rank||1000);
  const currEl = document.getElementById('profileCurrency');
  if (currEl) currEl.textContent = '💰 ' + (userProfile?.currency ?? 0);
  const nickInput = document.getElementById('nicknameInput');
  if (nickInput) nickInput.placeholder = userProfile?.nickname || user.displayName || '닉네임 변경';
  if (window.applyCosmeticsUI) window.applyCosmeticsUI(userProfile);
  if (window.renderShopUI) window.renderShopUI();
  if (userProfile && userProfile.tutorialCompleted === false && window.startTutorial) {
    setTimeout(() => window.startTutorial(), 300);
  }
}

function renderLoggedOutUI() {
  document.getElementById('loginArea').style.display = '';
  document.getElementById('profileArea').style.display = 'none';
}


// ─────────────────────────────────────────────
// 관리자 전적 초기화
// 보안: Firebase Firestore의 admins 컬렉션에
// 본인 UID 문서가 존재할 때만 실행 가능
// Firebase Console에서 직접 추가:
//   Firestore > admins > {내 UID} > { uid: "..." }
// ─────────────────────────────────────────────
async function adminResetAllStats() {
  if (!currentUser) {
    notify('로그인이 필요합니다.');
    return;
  }
  if (!fsdb) {
    notify('Firebase에 연결되어 있지 않습니다.');
    return;
  }

  // 서버에서 관리자 여부 확인
  try {
    const adminDoc = await fsdb.collection('admins').doc(currentUser.uid).get();
    if (!adminDoc.exists) {
      notify('관리자 권한이 없습니다.');
      return;
    }
  } catch (e) {
    notify('권한 확인 실패: ' + e.message);
    return;
  }

  if (!confirm('정말 모든 유저의 전적을 초기화합니까?\n이 작업은 되돌릴 수 없습니다.')) return;

  try {
    notify('초기화 중...');
    const snapshot = await fsdb.collection('users').get();
    const batch = fsdb.batch();
    snapshot.forEach(doc => {
      batch.update(doc.ref, {
        totalWins: 0,
        totalLosses: 0,
        totalGames: 0,
        rank: 1000,
        currency: 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    notify('✅ 모든 유저 전적 초기화 완료!');

    if (currentUser) {
      userProfile = await getUserProfile(currentUser.uid);
      renderProfileUI(currentUser);
    }
  } catch (e) {
    notify('초기화 실패: ' + e.message);
    console.error(e);
  }
}

// 로그인 상태에 따라 관리자 버튼 표시 여부 결정
async function checkAdminUI() {
  const btn = document.getElementById('adminResetBtn');
  if (!btn) return;
  if (!currentUser || !fsdb) { btn.closest('.lobby-card').style.display = 'none'; return; }
  try {
    const adminDoc = await fsdb.collection('admins').doc(currentUser.uid).get();
    btn.closest('.lobby-card').style.display = adminDoc.exists ? '' : 'none';
    if (currentUser && fsdb) {
      await fsdb.collection('users').doc(currentUser.uid).set({
        isAdmin: !!adminDoc.exists,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      userProfile = await getUserProfile(currentUser.uid);
      window.userProfile = userProfile;
    }
  } catch (e) {
    btn.closest('.lobby-card').style.display = 'none';
  }
}
// 페이지 로드 후 미리 SDK 로드 (로그인 버튼 응답 빠르게)
window.addEventListener('load', () => loadFirebase(() => {}));




async function purchaseShopItem(itemId) {
  if (!currentUser || !fsdb) { notify('로그인 필요'); return; }
  const item = (window.SHOP_ITEMS || []).find(x => x.id === itemId);
  if (!item) { notify('존재하지 않는 상품입니다.'); return; }
  try {
    await fsdb.runTransaction(async (tx) => {
      const ref = fsdb.collection('users').doc(currentUser.uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('유저 정보 없음');
      const d = snap.data();
      const isAdmin = !!d.isAdmin;
      const owned = new Set(d.ownedItems || []);
      if (owned.has(item.id)) throw new Error('이미 구매한 아이템입니다.');
      const currency = Number(d.currency || 0);
      if (!isAdmin && currency < item.priceGold) throw new Error('재화가 부족합니다.');
      owned.add(item.id);
      const unlocked = new Set(d.unlockedCards || []);
      (item.rewardCards || []).forEach(c => unlocked.add(c));
      tx.update(ref, {
        currency: isAdmin ? currency : (currency - item.priceGold),
        ownedItems: Array.from(owned),
        unlockedCards: Array.from(unlocked),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    userProfile = await getUserProfile(currentUser.uid);
    window.userProfile = userProfile;
    renderProfileUI(currentUser);
    if (window.renderShopUI) renderShopUI();
    notify('구매 완료: ' + item.name);
  } catch(e) { notify('구매 실패: ' + e.message); }
}

async function claimMissionReward(missionId) {
  if (!currentUser || !fsdb) { notify('로그인 필요'); return; }
  const mission = (window.MISSIONS || []).find(m => m.id === missionId);
  if (!mission) { notify('미션 없음'); return; }
  try {
    await fsdb.runTransaction(async (tx) => {
      const ref = fsdb.collection('users').doc(currentUser.uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('유저 없음');
      const d = snap.data();
      const claimed = new Set(d.claimedMissions || []);
      if (claimed.has(mission.id)) throw new Error('이미 수령한 미션입니다.');
      const progress = Number(d[mission.metric] || 0);
      if (progress < mission.goal) throw new Error('미션 조건 미달성');
      claimed.add(mission.id);
      tx.update(ref, {
        currency: Number(d.currency || 0) + mission.reward,
        claimedMissions: Array.from(claimed),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    userProfile = await getUserProfile(currentUser.uid);
    window.userProfile = userProfile;
    renderProfileUI(currentUser);
    if (window.renderShopUI) renderShopUI();
    notify('미션 보상 수령 완료');
  } catch(e) { notify('보상 수령 실패: ' + e.message); }
}

// ─────────────────────────────────────────────
// P0 HOTFIX — 신규 효과 엔진/레거시 UI 연결 안정화
// ─────────────────────────────────────────────
// 1) EffectDefinition UI/트리거/필드존 효과가 체인에 올라가기만 하고 해결되지 않는 문제 완화
// 2) HB_CHAIN_ENGINE 내부 chainState를 기존 activeChainState UI/Firebase 체인 상태와 미러링
// 3) 레거시 sendToExile의 카드 복제 버그를 중앙 이동 엔진 경유로 우회
(function initP0EngineHotfix(global) {
  'use strict';
  if (global.__HB_P0_ENGINE_HOTFIX__) return;
  global.__HB_P0_ENGINE_HOTFIX__ = true;

  function safeCall(fn) {
    try { return typeof fn === 'function' ? fn() : undefined; }
    catch (err) { console.warn('[P0 hotfix] safeCall failed:', err); return undefined; }
  }

  function getLocalRole() {
    // eslint-disable-next-line no-undef
    if (typeof myRole !== 'undefined' && myRole) return myRole;
    return global.myRole || 'host';
  }

  function otherRole(role) {
    return role === 'host' ? 'guest' : 'host';
  }

  function roleToController(role) {
    const local = getLocalRole();
    if (!role || role === local || role === 'me') return 'me';
    if (role === 'opponent') return 'opponent';
    return 'opponent';
  }

  function controllerToRole(controller) {
    const local = getLocalRole();
    if (!controller || controller === 'me') return local;
    if (controller === local || controller === 'host' || controller === 'guest') return controller;
    return otherRole(local);
  }

  function mapHbLinkToLegacyLink(link, order) {
    const activationData = link && link.activationData ? link.activationData : {};
    const legacyLink = activationData.legacyLink || null;
    const controller = link && link.controller;
    const by = legacyLink && legacyLink.by ? legacyLink.by : controllerToRole(controller);
    const label = (legacyLink && legacyLink.label)
      || (link && (link.cardName || link.effectId || link.cardId))
      || '신규 효과';
    const type = (legacyLink && legacyLink.type)
      || (link && (link.type || link.effectId))
      || 'hbEffect';

    return {
      id: link && link.id,
      hbEngine: true,
      by,
      controller: controller || roleToController(by),
      type,
      label,
      cardId: (legacyLink && legacyLink.cardId) || (link && link.cardId) || null,
      effectId: link && link.effectId,
      sourceZone: link && link.sourceZone,
      sourceIndex: typeof (link && link.sourceIndex) === 'number' ? link.sourceIndex : null,
      order: order + 1,
      legacy: !!legacyLink,
    };
  }

  function buildLegacyMirrorFromHbState(hbState) {
    const links = (hbState && hbState.links ? hbState.links : []).map(mapHbLinkToLegacyLink);
    return {
      hbEngine: true,
      active: !!(hbState && hbState.active && links.length > 0),
      links,
      priority: controllerToRole(hbState && hbState.priority),
      passCount: (hbState && hbState.passCount) || 0,
      startedBy: links[0] ? links[0].by : null,
      chainId: hbState && hbState.id,
      createdAt: (hbState && hbState.createdAt) || Date.now(),
    };
  }

  function publishChainMirror(mirror, options) {
    const opts = options || {};
    if (!mirror) return;

    safeCall(() => {
      // eslint-disable-next-line no-undef
      if (typeof activeChainState !== 'undefined') activeChainState = mirror.active ? mirror : null;
    });
    safeCall(() => { if (typeof renderChainActions === 'function') renderChainActions(); });

    if (opts.publish === false) return;
    safeCall(() => {
      // eslint-disable-next-line no-undef
      if (typeof roomRef !== 'undefined' && roomRef) roomRef.child('chainState').set(mirror);
    });
  }

  function publishHbChainState(chainApi, options) {
    if (!chainApi || typeof chainApi.getChainState !== 'function') return;
    const state = chainApi.getChainState();
    const mirror = buildLegacyMirrorFromHbState(state);
    publishChainMirror(mirror, options);
  }

  function publishResolvedHbChain(detail) {
    const chainBeforeClear = detail && detail.chain;
    const mirror = buildLegacyMirrorFromHbState(chainBeforeClear || { active: false, links: [] });
    const payload = Object.assign({}, mirror, {
      active: false,
      priority: null,
      passCount: 0,
      resolvedLinks: mirror.links || [],
      resolvedAt: Date.now(),
      resolvedBy: getLocalRole(),
      authorityMode: 'snapshot',
    });

    const authoritativeState = safeCall(() => global.HB_NETWORK_SYNC && global.HB_NETWORK_SYNC.createAuthoritativeState
      ? global.HB_NETWORK_SYNC.createAuthoritativeState({ authorityRole: getLocalRole() })
      : null);
    if (authoritativeState) payload.authoritativeState = authoritativeState;

    publishChainMirror(payload);
  }

  // HB_CHAIN_ENGINE에 roleToController/controllerToRole 보조를 한 번만 부착한다.
  // 과거 P0 래핑은 publishHbChainState를 모든 메서드에 belt-and-suspenders로 끼웠으나,
  // chain-engine.js가 동일 시점에 hb:chain-* 이벤트를 발행하므로 그 리스너가 같은 역할을 한다.
  function attachChainRoleHelpers() {
    const chain = global.HB_CHAIN_ENGINE;
    if (!chain || chain.__p0RoleHelpersAttached) return;
    try {
      const augmented = Object.assign({}, chain, {
        __p0RoleHelpersAttached: true,
        roleToController,
        controllerToRole,
        importChainState(data) {
          if (!data || data.hbEngine !== true) return false;
          publishChainMirror(data, { publish: false });
          return true;
        },
      });
      global.HB_CHAIN_ENGINE = Object.freeze(augmented);
      global.HB_ENGINE = global.HB_ENGINE || {};
      global.HB_ENGINE.chain = global.HB_CHAIN_ENGINE;
    } catch (err) {
      console.warn('[P0] attachChainRoleHelpers 실패:', err);
    }
  }

  attachChainRoleHelpers();

  if (global.addEventListener) {
    global.addEventListener('hb:chain-link-added', function onHbChainLinkAdded() {
      publishHbChainState(global.HB_CHAIN_ENGINE);
    });
    global.addEventListener('hb:chain-response-window', function onHbChainResponseWindow() {
      publishHbChainState(global.HB_CHAIN_ENGINE);
    });
    global.addEventListener('hb:chain-passed', function onHbChainPassed() {
      publishHbChainState(global.HB_CHAIN_ENGINE);
    });
    global.addEventListener('hb:chain-resolved', function onHbChainResolved(evt) {
      publishResolvedHbChain(evt && evt.detail);
    });
  }

  console.info('[P0] 신엔진 체인 발행 구독 설치 완료');
})(window);
