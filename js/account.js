// account.js — 계정, 로그인, 전적 기록
// ACCOUNT SYSTEM — loadFirebase에 의존, 절대 독립 로드 안 함
// ═══════════════════════════════════════════
let fsdb = null;
let currentUser = null;
let userProfile = null;
let gameResultRecorded = false;
let authInitialized = false;

function initAuth() {
  if (authInitialized) return;
  authInitialized = true;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  fsdb = firebase.firestore();
  firebase.auth().getRedirectResult().catch(e => console.warn('redirect:', e));
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    if (user) {
      await ensureUserDoc(user);
      userProfile = await getUserProfile(user.uid);
      renderProfileUI(user);
      const ni = document.getElementById('playerName');
      if (ni && !ni.value.trim()) ni.value = userProfile?.nickname || user.displayName || '';
    } else {
      userProfile = null;
      renderLoggedOutUI();
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
      ownedItems: [], equippedSleeve: 'default', equippedBoard: 'default', unlockedCards: [],
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
  const earned = win ? 30 : 10;
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
    notify((win ? '🏆 승리' : '💀 패배') + '! 재화 +' + earned + ' (합계: ' + (userProfile?.currency ?? '?') + ')');
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
}

function renderLoggedOutUI() {
  document.getElementById('loginArea').style.display = '';
  document.getElementById('profileArea').style.display = 'none';
}

// 페이지 로드 후 미리 SDK 로드 (로그인 버튼 응답 빠르게)
window.addEventListener('load', () => loadFirebase(() => {}));


