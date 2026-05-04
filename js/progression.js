// progression.js — 상점/미션/튜토리얼
const THEME_CHOICES = ['펭귄','올드원','라이온','타이거','라이거','지배자','마피아','불가사의','엘리멘츠','범용'];

window.SHOP_ITEMS = THEME_CHOICES.map(theme => ({
  id: `theme_${theme}`,
  type: 'theme_unlock',
  theme,
  name: `${theme} 테마 해금권`,
  priceGold: 300,
}));

window.MISSIONS = [
  { id:'first_win', name:'첫 승리', goal:1, reward:120, metric:'totalWins' },
  { id:'play_3', name:'3판 플레이', goal:3, reward:80, metric:'totalGames' },
  { id:'win_5', name:'5승 달성', goal:5, reward:200, metric:'totalWins' }
];

function getMissionProgress(profile, mission){ return Number(profile?.[mission.metric]||0); }
window.getMissionProgress = getMissionProgress;

window.renderShopUI = function() {
  const wrap = document.getElementById('shopItems');
  const missionWrap = document.getElementById('missionItems');
  if (!wrap || !missionWrap) return;
  wrap.innerHTML = ''; missionWrap.innerHTML = '';
  const p = window.userProfile || {};
  const ownedThemes = new Set(p.unlockedThemes || []);
  const alreadyPicked = !!p.hasPickedTheme;

  window.SHOP_ITEMS.forEach(item => {
    const row = document.createElement('div'); row.className = 'shop-row';
    const own = ownedThemes.has(item.theme);
    const lockedByPick = alreadyPicked && !own;
    row.innerHTML = `<div><strong>${item.name}</strong><div style="font-size:.72rem;color:var(--text-dim)">튜토리얼 보상 골드로 원하는 테마 1개 선택</div></div>
      <div style="display:flex;gap:.4rem;align-items:center;"><span style="color:#f0c040">💰 ${item.priceGold}</span>
      <button class="btn btn-secondary" ${(own||lockedByPick)?'disabled':''} onclick="purchaseShopItem('${item.id}')">${own?'보유중':(lockedByPick?'선택완료':'구매')}</button></div>`;
    wrap.appendChild(row);
  });

  const claimed = new Set(p.claimedMissions || []);
  window.MISSIONS.forEach(m => {
    const progress = getMissionProgress(p, m), done = progress >= m.goal, isClaimed = claimed.has(m.id);
    const row = document.createElement('div'); row.className = 'shop-row';
    row.innerHTML = `<div><strong>${m.name}</strong><div style="font-size:.72rem;color:var(--text-dim)">${progress}/${m.goal}</div></div>
    <div style="display:flex;gap:.4rem;align-items:center;"><span style="color:#8be48b">+${m.reward}</span>
    <button class="btn btn-secondary" ${(!done||isClaimed)?'disabled':''} onclick="claimMissionReward('${m.id}')">${isClaimed?'수령완료':'수령'}</button></div>`;
    missionWrap.appendChild(row);
  });
};

window.openShop = function(){ if (!window.currentUser) return notify('로그인 후 이용하세요.'); openModal('shopModal'); renderShopUI(); };

window.startTutorial = function() {
  const steps = [
    '튜토리얼 1/4: 덱을 확정하고 게임을 시작하세요.',
    '튜토리얼 2/4: 드로우 단계에서 카드를 1장 뽑으세요.',
    '튜토리얼 3/4: 몬스터를 소환하고 공격해보세요.',
    '튜토리얼 4/4: 완료 보상 골드로 상점에서 테마 1개를 구매하세요.'
  ];
  let i = 0; openModal('tutorialModal');
  const text = document.getElementById('tutorialText'); const next = document.getElementById('tutorialNextBtn');
  const render = ()=>{ text.textContent = steps[i]; next.textContent = (i===steps.length-1)?'완료':'다음'; }; render();
  next.onclick = async ()=>{
    i += 1;
    if (i >= steps.length) {
      closeModal('tutorialModal');
      if (window.currentUser && window.fsdb) {
        try {
          await window.fsdb.runTransaction(async (tx) => {
            const ref = window.fsdb.collection('users').doc(window.currentUser.uid); const snap = await tx.get(ref); if (!snap.exists) return;
            const d = snap.data(); if (d.tutorialCompleted) return;
            tx.update(ref, { tutorialCompleted:true, currency: Number(d.currency||0) + 300, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          });
          userProfile = await window.getUserProfile(window.currentUser.uid); window.userProfile = userProfile; if (window.renderProfileUI) window.renderProfileUI(window.currentUser);
          notify('튜토리얼 완료! 보상 300골드를 획득했습니다.');
        } catch(e) {}
      }
      return;
    }
    render();
  };
};
