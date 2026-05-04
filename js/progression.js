// progression.js — 상점/미션/튜토리얼
window.SHOP_ITEMS = [
  { id:'card_pack_basic', type:'card', name:'기본 카드 팩', priceGold:120, rewardCards:['황금 펭귄','고대의 지식'] },
  { id:'sleeve_aurora', type:'sleeve', name:'오로라 슬리브', priceGold:200 },
  { id:'board_moon', type:'board', name:'월광 보드', priceGold:280 },
  { id:'starter_lion', type:'starter_deck', name:'입문자 라이온 덱', priceGold:350 }
];

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
  const owned = new Set(p.ownedItems || []);

  window.SHOP_ITEMS.forEach(item => {
    const row = document.createElement('div');
    row.className = 'shop-row';
    const own = owned.has(item.id);
    row.innerHTML = `<div><strong>${item.name}</strong><div style="font-size:.72rem;color:var(--text-dim)">${item.type}</div></div>
      <div style="display:flex;gap:.4rem;align-items:center;"><span style="color:#f0c040">💰 ${item.priceGold}</span>
      <button class="btn btn-secondary" ${own?'disabled':''} onclick="purchaseShopItem('${item.id}')">${own?'보유중':'구매'}</button></div>`;
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
          await fsdb.collection('users').doc(currentUser.uid).update({ tutorialCompleted:true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          userProfile = await getUserProfile(currentUser.uid);
        } catch(e) {}
      }
      return;
    }
    render();
  };
};
