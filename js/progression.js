// progression.js — 상점/미션/튜토리얼
window.SHOP_ITEMS = [
  { id:'card_pack_basic', type:'card', name:'기본 카드 팩', priceGold:120, rewardCards:['황금 펭귄','고대의 지식'] },
  { id:'sleeve_aurora', type:'sleeve', name:'오로라 슬리브', priceGold:200 },
  { id:'board_moon', type:'board', name:'월광 보드', priceGold:280 },
  { id:'starter_lion', type:'starter_deck', name:'입문자 라이온 덱', priceGold:350 }
];

window.STARTER_THEME_PRICE = 350;
window.STARTER_THEME_PRESETS = ['펭귄','서커스메어','올드원','라이온','지배자','엘리멘츠','범용'];

window.MISSIONS = [
  { id:'first_win', name:'첫 승리', goal:1, reward:80, metric:'totalWins' },
  { id:'play_3', name:'3판 플레이', goal:3, reward:60, metric:'totalGames' },
  { id:'win_5', name:'5승 달성', goal:5, reward:180, metric:'totalWins' }
];

function getMissionProgress(profile, mission){ return Number(profile?.[mission.metric]||0); }

window.renderShopUI = function() {
  const wrap = document.getElementById('shopItems');
  const missionWrap = document.getElementById('missionItems');
  if (!wrap || !missionWrap) return;
  wrap.innerHTML = '';
  missionWrap.innerHTML = '';
  const p = window.userProfile || {};
  const isAdmin = !!p.isAdmin;
  const owned = isAdmin ? new Set((window.SHOP_ITEMS || []).map(item => item.id)) : new Set(p.ownedItems || []);

  window.SHOP_ITEMS.forEach(item => {
    const row = document.createElement('div');
    row.className = 'shop-row';
    const own = owned.has(item.id);
    const equipType = (item.type === 'sleeve' || item.type === 'board') ? item.type : null;
    const equippedId = equipType === 'sleeve' ? (p.equippedSleeve || 'default') : (equipType === 'board' ? (p.equippedBoard || 'default') : null);
    const canEquip = !!equipType && own;
    const equipped = canEquip && equippedId === item.id;
    row.innerHTML = `<div><strong>${item.name}</strong><div style="font-size:.72rem;color:var(--text-dim)">${item.type}</div></div>
      <div style="display:flex;gap:.4rem;align-items:center;"><span style="color:#f0c040">💰 ${isAdmin ? '∞' : item.priceGold}</span>
      <button class="btn btn-secondary" ${own?'disabled':''} onclick="purchaseShopItem('${item.id}')">${own?'보유중':'구매'}</button>
      ${canEquip ? `<button class="btn btn-secondary" ${equipped?'disabled':''} onclick="equipShopItem('${item.id}')">${equipped?'장착중':'장착'}</button>` : ''}
      </div>`;
    wrap.appendChild(row);
  });

  const claimed = new Set(p.claimedMissions || []);
  window.MISSIONS.forEach(m => {
    const progress = getMissionProgress(p, m);
    const done = progress >= m.goal;
    const isClaimed = claimed.has(m.id);
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `<div><strong>${m.name}</strong><div style="font-size:.72rem;color:var(--text-dim)">${progress}/${m.goal}</div></div>
    <div style="display:flex;gap:.4rem;align-items:center;"><span style="color:#8be48b">+${m.reward}</span>
    <button class="btn btn-secondary" ${(!done||isClaimed)?'disabled':''} onclick="claimMissionReward('${m.id}')">${isClaimed?'수령완료':'수령'}</button></div>`;
    missionWrap.appendChild(row);
  });
};

window.applyCosmeticsUI = function(profile) {
  const p = profile || window.userProfile || {};
  document.body.dataset.board = p.equippedBoard || 'default';
  document.body.dataset.sleeve = p.equippedSleeve || 'default';
};

window.equipShopItem = async function(itemId) {
  if (!currentUser || !fsdb) { notify('로그인 필요'); return; }
  const item = (window.SHOP_ITEMS || []).find(x => x.id === itemId);
  if (!item || !['sleeve', 'board'].includes(item.type)) { notify('장착할 수 없는 아이템입니다.'); return; }
  try {
    await fsdb.runTransaction(async (tx) => {
      const ref = fsdb.collection('users').doc(currentUser.uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('유저 정보 없음');
      const d = snap.data();
      const isAdmin = !!d.isAdmin;
      const owned = new Set(d.ownedItems || []);
      if (!isAdmin && !owned.has(item.id)) throw new Error('보유하지 않은 아이템입니다.');
      const patch = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      if (item.type === 'sleeve') patch.equippedSleeve = item.id;
      if (item.type === 'board') patch.equippedBoard = item.id;
      tx.update(ref, patch);
    });
    userProfile = await getUserProfile(currentUser.uid);
    window.userProfile = userProfile;
    if (window.applyCosmeticsUI) window.applyCosmeticsUI(userProfile);
    if (window.renderShopUI) renderShopUI();
    notify('장착 완료: ' + item.name);
  } catch(e) { notify('장착 실패: ' + e.message); }
};

window.openShop = function(){
  if (!window.currentUser) { notify('로그인 후 이용하세요.'); return; }
  openModal('shopModal');
  renderShopUI();
};

window.startTutorial = function() {
  const steps = [
    '튜토리얼 1/4: 덱을 확정하고 게임을 시작하세요.',
    '튜토리얼 2/4: 드로우 단계에서 카드를 1장 뽑으세요.',
    '튜토리얼 3/4: 몬스터를 소환하고 공격해보세요.',
    '튜토리얼 4/4: 승리하면 골드를 획득하고 상점에서 아이템을 살 수 있어요!'
  ];
  let i = 0;
  openModal('tutorialModal');
  const text = document.getElementById('tutorialText');
  const next = document.getElementById('tutorialNextBtn');
  const render = ()=>{ text.textContent = steps[i]; next.textContent = (i===steps.length-1)?'완료':'다음'; };
  render();
  next.onclick = async ()=>{
    i += 1;
    if (i >= steps.length) {
      closeModal('tutorialModal');
      if (window.currentUser && window.fsdb) {
        try {
          await fsdb.runTransaction(async (tx) => {
            const ref = fsdb.collection('users').doc(currentUser.uid);
            const snap = await tx.get(ref);
            if (!snap.exists) return;
            const d = snap.data();
            if (d.tutorialCompleted === true) return;
            tx.update(ref, {
              tutorialCompleted:true,
              currency: Number(d.currency || 0) + 400,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          });
          userProfile = await getUserProfile(currentUser.uid);
          window.userProfile = userProfile;
          notify('튜토리얼 보상: 재화 +400');
          if (!userProfile?.selectedStarterTheme && window.chooseStarterThemeWithCurrency) {
            setTimeout(() => window.chooseStarterThemeWithCurrency(), 150);
          }
        } catch(e) {}
      }
      return;
    }
    render();
  };
};

window.chooseStarterThemeWithCurrency = async function() {
  if (!window.currentUser || !window.fsdb) { notify('로그인 후 선택할 수 있습니다.'); return; }

  const price = Number(window.STARTER_THEME_PRICE || 350);
  const themes = (window.STARTER_THEME_PRESETS || []).join(', ');
  const picked = prompt(`원하는 스타터 테마를 입력하세요.\n선택 가능: ${themes}\n비용: ${price} 재화\n(테스트 코드: FREE)`);
  if (!picked) return;
  const theme = (picked || '').trim();

  // 테스트용 코드: FREE 입력 시 모든 카드를 무료 지급
  if (theme.toUpperCase() === 'FREE') {
    const unlocked = new Set(window.userProfile?.unlockedCards || []);
    const granted = new Set();
    const allCardIds = Object.keys(window.CARDS || CARDS || {});

    allCardIds.forEach((id) => {
      if (!unlocked.has(id)) granted.add(id);
      unlocked.add(id);
    });

    try {
      await fsdb.runTransaction(async (tx) => {
        const ref = fsdb.collection('users').doc(currentUser.uid);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('유저 정보 없음');
        const d = snap.data();
        tx.update(ref, {
          unlockedCards: Array.from(new Set([...(d.unlockedCards || []), ...unlocked])),
          freeThemeDeckCheatUsedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      userProfile = await getUserProfile(currentUser.uid);
      window.userProfile = userProfile;
      notify(`테스트 코드 FREE 적용: 전체 카드 ${granted.size}장 무료 지급!`);
    } catch (e) {
      notify('테스트 코드 적용 실패: ' + e.message);
    }
    return;
  }

  if (window.userProfile?.selectedStarterTheme) { notify('이미 스타터 테마를 선택했습니다.'); return; }

  if (!(window.STARTER_THEME_PRESETS || []).includes(theme)) {
    notify('선택할 수 없는 테마입니다.');
    return;
  }
  if (!window.createStarterDeckFromTheme) {
    notify('스타터 덱 생성기를 찾을 수 없습니다.');
    return;
  }
  const starter = window.createStarterDeckFromTheme(theme);
  if (!starter || !starter.main?.length) { notify('스타터 덱 생성 실패'); return; }

  try {
    await fsdb.runTransaction(async (tx) => {
      const ref = fsdb.collection('users').doc(currentUser.uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('유저 정보 없음');
      const d = snap.data();
      if (d.selectedStarterTheme) throw new Error('이미 선택 완료');
      const isAdmin = !!d.isAdmin;
      const currency = Number(d.currency || 0);
      if (!isAdmin && currency < price) throw new Error('재화가 부족합니다.');
      tx.update(ref, {
        currency: isAdmin ? currency : (currency - price),
        selectedStarterTheme: theme,
        starterDeckMain: starter.main,
        starterDeckKey: starter.key,
        unlockedCards: Array.from(new Set([...(d.unlockedCards || []), ...starter.main, ...starter.key])),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    userProfile = await getUserProfile(currentUser.uid);
    window.userProfile = userProfile;
    notify(`스타터 테마 [${theme}] 선택 완료!`);
  } catch (e) {
    notify('스타터 테마 선택 실패: ' + e.message);
  }
};