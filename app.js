import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, onSnapshot,
  query, orderBy, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ACCESS_CODE } from "./firebase-config.js";

const KINDS = {
  "ヒト": { emoji:"👤", label:"ヒト（人の手を借りたい・貸したい）", subcats:["見守り・声かけ","話し相手","送迎","付き添い","子どもの見守り","その他"] },
  "モノ": { emoji:"📦", label:"モノ（物資を届けたい・受け取りたい）", subcats:["食料","日用品","衣類","家具・家電","その他"] },
  "コト": { emoji:"🛠️", label:"コト（作業や活動を手伝いたい・頼みたい）", subcats:["力仕事","買い物代行","掃除・片付け","庭仕事","行事の手伝い","その他"] },
};
const KIND_KEYS = Object.keys(KINDS);

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

const LOCAL_KEY = 'attaka_profile_code';

let state = {
  profile: null,
  tab: 'top',
  formMode: 'need',
  formKind: 'ヒト',
  listings: [],
  connections: [],
  activeConnId: null,
  chatUnsub: null,
  chatMsgs: [],
  geoStatus: '',
};

const root = document.getElementById('root');

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDist(d){ return d===null||d===undefined ? '距離不明' : d.toFixed(1)+' km'; }
function fmtTime(ts){ const d = new Date(ts); return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function haversine(lat1,lon1,lat2,lon2){
  if([lat1,lon1,lat2,lon2].some(v=>v===undefined||v===null||v==='')) return null;
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function normText(s){ return (s||'').trim().toLowerCase(); }

function daysLeft(deadline){
  if(!deadline) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const dl = new Date(deadline); dl.setHours(0,0,0,0);
  return Math.round((dl - today) / 86400000);
}
function deadlineBadge(deadline){
  const d = daysLeft(deadline);
  if(d===null) return {cls:'calm', text:'期限なし'};
  if(d < 0) return {cls:'calm', text:'期限終了'};
  if(d === 0) return {cls:'urgent', text:'本日まで'};
  if(d <= 2) return {cls:'urgent', text:`あと${d}日`};
  if(d <= 7) return {cls:'soon', text:`あと${d}日`};
  return {cls:'calm', text:`あと${d}日`};
}

// ---------------- gate ----------------
// プロフィールのID（マイページコード）は Firebase Auth の匿名UIDとは切り離してあります。
// こうすることで、ブラウザのキャッシュ／サイトデータを消してしまっても、
// 「マイページコード」さえ分かれば別の端末・別のブラウザから同じ自分に戻れます。
let gateMode = 'new'; // 'new' | 'restore'

function renderGate(errMsg){
  root.innerHTML = `
    <div class="gate">
      <div class="glow"></div>
      <h1>ひらかたあったかクラウド</h1>
      <p>地域の「困った」と「できること」をつなぐ、あったかい支援の掲示板です。</p>
      ${ACCESS_CODE ? '<input id="gateCode" type="password" placeholder="合言葉">' : ''}
      ${gateMode === 'new' ? `
        <input id="gateName" type="text" placeholder="表示名（例：さとう農園）">
        <button id="gateBtn">はじめる</button>
        <p style="margin-top:14px;"><a href="#" id="toRestore" style="color:var(--ink-soft); font-size:12px;">前に登録した方はこちら（マイページコードでログイン）</a></p>
      ` : `
        <input id="gateRestoreCode" type="text" placeholder="マイページコードを入力">
        <button id="gateRestoreBtn">このコードでログインする</button>
        <p style="margin-top:14px;"><a href="#" id="toNew" style="color:var(--ink-soft); font-size:12px;">はじめての方はこちら</a></p>
      `}
      <div class="err">${errMsg || ''}</div>
    </div>`;

  if(gateMode === 'new'){
    document.getElementById('gateBtn').onclick = onGateSubmit;
    document.getElementById('gateName').addEventListener('keydown', e => { if(e.key==='Enter') onGateSubmit(); });
    document.getElementById('toRestore').onclick = (e) => { e.preventDefault(); gateMode='restore'; renderGate(); };
  } else {
    document.getElementById('gateRestoreBtn').onclick = onGateRestore;
    document.getElementById('gateRestoreCode').addEventListener('keydown', e => { if(e.key==='Enter') onGateRestore(); });
    document.getElementById('toNew').onclick = (e) => { e.preventDefault(); gateMode='new'; renderGate(); };
  }
}

function checkAccessCode(){
  const code = ACCESS_CODE ? document.getElementById('gateCode').value : '';
  return !ACCESS_CODE || code === ACCESS_CODE;
}

async function onGateSubmit(){
  if(!checkAccessCode()){ renderGate('合言葉が違います'); return; }
  const name = document.getElementById('gateName').value.trim();
  if(!name){ renderGate('表示名を入力してください'); return; }
  root.innerHTML = `<div class="empty" style="margin-top:60px;">登録中…</div>`;
  await signInAnonymously(auth);
  const profileId = uid();
  const profile = { id: profileId, name, lat:null, lng:null, createdAt: Date.now() };
  await setDoc(doc(db,'profiles',profileId), profile);
  localStorage.setItem(LOCAL_KEY, profileId);
  state.profile = profile;
  startApp();
  showMyCodeNotice(profileId, true);
}

async function onGateRestore(){
  if(!checkAccessCode()){ renderGate('合言葉が違います'); return; }
  const code = document.getElementById('gateRestoreCode').value.trim();
  if(!code){ renderGate('マイページコードを入力してください'); return; }
  root.innerHTML = `<div class="empty" style="margin-top:60px;">確認中…</div>`;
  await signInAnonymously(auth);
  const snap = await getDoc(doc(db,'profiles',code));
  if(!snap.exists()){ gateMode='restore'; renderGate('そのコードは見つかりませんでした。入力内容をご確認ください'); return; }
  localStorage.setItem(LOCAL_KEY, code);
  state.profile = snap.data();
  startApp();
}

function showMyCodeNotice(code, isNew){
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed; inset:0; background:rgba(74,55,40,0.45); display:flex; align-items:center; justify-content:center; z-index:999; padding:16px;';
  box.innerHTML = `
    <div style="background:#fff; border-radius:18px; padding:26px; max-width:380px; text-align:center; box-shadow:0 8px 30px rgba(0,0,0,0.25);">
      <div style="font-family:'Zen Maru Gothic'; font-weight:800; font-size:17px; margin-bottom:10px;">${isNew ? 'ようこそ！' : 'おかえりなさい'}</div>
      <p style="font-size:12.5px; color:var(--ink-soft); line-height:1.7; margin-bottom:14px;">
        あなたの「マイページコード」です。これがあれば、別の端末やブラウザのキャッシュを消した後でも、同じ自分として戻ってこられます。<br><b>必ずスクリーンショットか、メモで保存してください。</b>
      </p>
      <div style="font-family:'Zen Maru Gothic'; font-weight:800; font-size:20px; letter-spacing:0.03em; background:var(--bg); border:1.5px dashed var(--line); border-radius:10px; padding:12px; margin-bottom:16px; word-break:break-all;">${code}</div>
      <button id="closeCodeNotice" style="font-family:'Zen Maru Gothic'; font-weight:700; padding:10px 22px; border:none; border-radius:20px; background:var(--need); color:#fff; cursor:pointer;">わかりました</button>
    </div>`;
  document.body.appendChild(box);
  document.getElementById('closeCodeNotice').onclick = () => box.remove();
}

async function boot(){
  const savedCode = localStorage.getItem(LOCAL_KEY);
  if(savedCode){
    await signInAnonymously(auth);
    const snap = await getDoc(doc(db,'profiles',savedCode));
    if(snap.exists()){ state.profile = snap.data(); startApp(); return; }
    localStorage.removeItem(LOCAL_KEY); // 無効なコードだったら忘れる
  }
  renderGate();
}
boot();

function startApp(){ listenListings(); listenConnections(); render(); }

function listenListings(){
  const q = query(collection(db,'listings'), orderBy('createdAt','desc'));
  onSnapshot(q, snap => { state.listings = snap.docs.map(d => ({ id:d.id, ...d.data() })); render(); });
}
function listenConnections(){
  const q = query(collection(db,'connections'), orderBy('createdAt','desc'));
  onSnapshot(q, snap => { state.connections = snap.docs.map(d => ({ id:d.id, ...d.data() })); render(); });
}
function listenChat(connId){
  if(state.chatUnsub) state.chatUnsub();
  const q = query(collection(db,'connections',connId,'messages'), orderBy('ts','asc'));
  state.chatUnsub = onSnapshot(q, snap => { state.chatMsgs = snap.docs.map(d => ({ id:d.id, ...d.data() })); renderChatMessagesOnly(); });
}

async function saveProfile(){ await setDoc(doc(db,'profiles',state.profile.id), state.profile); }

async function createListing(listing){
  await setDoc(doc(db,'listings',listing.id), listing);
  await autoSuggestConnections(listing);
}

// 同じヒト・モノ・コト＋サブカテゴリの相手がいれば、候補としてつながりを自動提案する
async function autoSuggestConnections(newListing){
  const opposite = newListing.mode === 'need' ? 'offer' : 'need';
  const candidates = state.listings.filter(l => l.mode===opposite && l.status==='open'
    && l.kind===newListing.kind && l.subcat===newListing.subcat);
  for(const c of candidates){
    const needL = newListing.mode==='need' ? newListing : c;
    const offerL = newListing.mode==='offer' ? newListing : c;
    await proposeConnection(needL, offerL, 'system');
  }
}

async function proposeConnection(needL, offerL, connectedBy){
  const dup = state.connections.find(m => m.needId===needL.id && m.offerId===offerL.id);
  if(dup) return dup;
  const dist = haversine(needL.lat, needL.lng, offerL.lat, offerL.lng);
  const conn = {
    id: uid(), needId: needL.id, offerId: offerL.id,
    title: needL.title, kind: needL.kind,
    participants: [needL.userId, offerL.userId],
    distanceKm: dist, status: 'proposed', connectedBy, createdAt: Date.now(),
  };
  state.connections.push(conn);
  await setDoc(doc(db,'connections',conn.id), conn);
  return conn;
}

async function deleteListing(id){ await deleteDoc(doc(db,'listings',id)); }

function myListings(){ return state.listings.filter(l=>l.userId===state.profile.id); }
function myConnections(){
  const myIds = new Set(myListings().map(l=>l.id));
  return state.connections.filter(m=>myIds.has(m.needId) || myIds.has(m.offerId));
}
function listingById(id){ return state.listings.find(l=>l.id===id); }

// ---------------- render root ----------------
function render(){
  root.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className='app';
  wrap.appendChild(renderHeader());
  wrap.appendChild(renderTabs());
  const panel = document.createElement('div');
  if(state.tab==='top'){ panel.appendChild(renderTop()); }
  else {
    panel.className='panel';
    if(state.tab==='register') panel.appendChild(renderRegister());
    else if(state.tab==='connections') panel.appendChild(renderConnections());
    else if(state.tab==='chat') panel.appendChild(renderChatTab());
    else if(state.tab==='admin') panel.appendChild(renderAdmin());
  }
  wrap.appendChild(panel);
  root.appendChild(wrap);
}

function renderHeader(){
  const h = document.createElement('div'); h.className='masthead';
  h.innerHTML = `
    <div class="brand-row">
      <div class="glow-badge"></div>
      <div class="brand">ひらかたあったかクラウド<small>地域の支援マーケットプレイス</small></div>
    </div>
    <div class="whoami">
      表示名: <b>${escapeHtml(state.profile.name)}</b><br>
      <button id="renameBtn">名前を変更</button>
      <button id="showCodeBtn">マイページコード</button>
    </div>`;
  h.querySelector('#renameBtn').onclick = async () => {
    const n = prompt('表示名を入力してください', state.profile.name);
    if(n && n.trim()){ state.profile.name = n.trim(); await saveProfile(); render(); }
  };
  h.querySelector('#showCodeBtn').onclick = () => showMyCodeNotice(state.profile.id, false);
  return h;
}

function renderTabs(){
  const wrap = document.createElement('div'); wrap.className='tabs';
  const myC = myConnections().length;
  const tabs = [
    {id:'top', label:'TOP'},
    {id:'register', label:'登録する'},
    {id:'connections', label:'つながり', n: myC},
    {id:'chat', label:'チャット'},
    {id:'admin', label:'コーディネーター'},
  ];
  tabs.forEach(t=>{
    const el = document.createElement('div');
    el.className = 'tab' + (state.tab===t.id ? ' active':'');
    el.innerHTML = t.label + (t.n ? `<span class="n">${t.n}</span>` : '');
    el.onclick = () => { state.tab = t.id; render(); };
    wrap.appendChild(el);
  });
  return wrap;
}

// ---- TOP: 今日の支援募集フィード ----
function renderTop(){
  const wrap = document.createElement('div');
  const hero = document.createElement('div'); hero.className='hero';
  hero.innerHTML = `
    <h1>今日の支援募集</h1>
    <p>地域のみんなの「困った」が集まっています。見て「これなら自分にもできそう」と思ったら、気軽に声をかけてみてください。マッチしなくても大丈夫、コーディネーターがつなぎ役になります。</p>
    <div class="cta-row">
      <button class="cta need" id="ctaNeed">困りごとを相談する</button>
      <button class="cta offer" id="ctaOffer">できることを登録する</button>
    </div>
  `;
  hero.querySelector('#ctaNeed').onclick = () => { state.formMode='need'; state.tab='register'; render(); };
  hero.querySelector('#ctaOffer').onclick = () => { state.formMode='offer'; state.tab='register'; render(); };
  wrap.appendChild(hero);

  const feedTitle = document.createElement('div'); feedTitle.className='section-title';
  feedTitle.innerHTML = `<span>募集中の困りごと</span><span class="rule"></span>`;
  wrap.appendChild(feedTitle);

  const feed = document.createElement('div'); feed.className='need-feed';
  const needs = state.listings.filter(l=>l.mode==='need' && l.status==='open')
    .slice()
    .sort((a,b)=>{
      const da = daysLeft(a.deadline), db_ = daysLeft(b.deadline);
      const na = da===null ? Infinity : da, nb = db_===null ? Infinity : db_;
      return na - nb;
    });
  if(needs.length===0){
    feed.innerHTML = `<div class="empty">今はまだ困りごとの登録がありません。最初の一件を登録してみませんか？</div>`;
  } else {
    needs.forEach(n => feed.appendChild(renderNeedCard(n)));
  }
  wrap.appendChild(feed);
  return wrap;
}

function renderNeedCard(n){
  const el = document.createElement('div'); el.className='need-card';
  const badge = deadlineBadge(n.deadline);
  const kindInfo = KINDS[n.kind] || {emoji:'💡'};
  const alreadyMine = n.userId === state.profile.id;
  el.innerHTML = `
    <div class="kind-glow">${kindInfo.emoji}</div>
    <div class="top-row">
      <div>
        <h3>${escapeHtml(n.title)}</h3>
        <div class="cat">${escapeHtml(n.kind)}・${escapeHtml(n.subcat)} ／ ${escapeHtml(n.userName)}さんより</div>
      </div>
      <span class="badge-deadline ${badge.cls}">${badge.text}</span>
    </div>
    ${n.note ? `<div class="note">${escapeHtml(n.note)}</div>` : ''}
    <div class="meta-row">
      <span>${n.lat ? '拠点登録あり' : '場所は未設定'}</span>
    </div>
  `;
  const actionRow = document.createElement('div');
  actionRow.style.marginTop = '12px';
  const btn = document.createElement('button');
  btn.className = 'help-btn';
  btn.textContent = alreadyMine ? '自分の登録です' : '私にもできそう';
  btn.disabled = alreadyMine;
  btn.onclick = () => onOfferToHelp(n);
  actionRow.appendChild(btn);
  el.appendChild(actionRow);
  return el;
}

async function onOfferToHelp(need){
  if(!confirm(`「${need.title}」の支援に立候補しますか？\nこのあとチャットで詳しい相談ができます。`)) return;
  // その場で簡易オファーを登録し、つながりを提案する
  const offerListing = {
    id: uid(), userId: state.profile.id, userName: state.profile.name, mode: 'offer',
    kind: need.kind, subcat: need.subcat,
    title: `「${need.title}」に対応します`,
    note: '', lat: state.profile.lat, lng: state.profile.lng,
    status: 'open', createdAt: Date.now(), quickOffer: true,
  };
  await setDoc(doc(db,'listings',offerListing.id), offerListing);
  state.listings.unshift(offerListing);
  const conn = await proposeConnection(need, offerListing, state.profile.id);
  state.tab = 'chat'; state.activeConnId = conn.id;
  render();
}

// ---- register ----
function renderRegister(){
  const wrap = document.createElement('div');
  const kindInfo = KINDS[state.formKind];
  wrap.innerHTML = `
    <h2>登録する</h2>
    <p class="sub">困っていること、できることを登録してください。「ヒト・モノ・コト」何でもOKです。</p>
    <div class="type-switch">
      <div class="type-btn need ${state.formMode==='need'?'active':''}" data-t="need">😟 困っています<br>（支援してほしい）</div>
      <div class="type-btn offer ${state.formMode==='offer'?'active':''}" data-t="offer">🙋 私にできること<br>（支援します）</div>
    </div>
    <div class="kind-switch">
      ${KIND_KEYS.map(k => `<div class="kind-btn ${state.formKind===k?'active':''}" data-k="${k}">${KINDS[k].emoji} ${k}</div>`).join('')}
    </div>
    <form id="regForm">
      <div class="field"><label>${state.formMode==='need' ? '困っていること' : 'できること'}（一言で）</label>
        <input name="title" required placeholder="${state.formMode==='need' ? '例）重い荷物を運ぶのを手伝ってほしい' : '例）力仕事のお手伝いができます'}">
      </div>
      <div class="grid2">
        <div class="field"><label>カテゴリ</label>
          <select name="subcat">${kindInfo.subcats.map(c=>`<option>${c}</option>`).join('')}</select>
        </div>
        <div class="field"><label>期限（任意）</label><input name="deadline" type="date"></div>
      </div>
      <div class="loc-row">
        <div class="field"><label>緯度</label><input name="lat" id="latInput" placeholder="例）35.658"></div>
        <div class="field"><label>経度</label><input name="lng" id="lngInput" placeholder="例）139.701"></div>
        <button type="button" class="geo-btn" id="geoBtn">📍 現在地を取得</button>
      </div>
      <div class="geo-status" id="geoStatus">${state.geoStatus}</div>
      <div class="field"><label>詳細メモ</label><textarea name="note" placeholder="例）平日夕方に対応できる方を探しています"></textarea></div>
      <button type="submit" class="submit-btn ${state.formMode}">${state.formMode==='need' ? 'この内容で相談する' : 'この内容で登録する'}</button>
    </form>
    <div class="section-title"><span>あなたの登録一覧</span><span class="rule"></span></div>
    <div id="myTags"></div>
  `;

  wrap.querySelectorAll('.type-btn').forEach(b=>{ b.onclick = () => { state.formMode = b.dataset.t; render(); }; });
  wrap.querySelectorAll('.kind-btn').forEach(b=>{ b.onclick = () => { state.formKind = b.dataset.k; render(); }; });

  const geoBtn = wrap.querySelector('#geoBtn');
  geoBtn.onclick = () => {
    if(!navigator.geolocation){ setGeoStatus(wrap,'位置情報が利用できません'); return; }
    setGeoStatus(wrap,'取得中…');
    navigator.geolocation.getCurrentPosition(async pos => {
      wrap.querySelector('#latInput').value = pos.coords.latitude.toFixed(5);
      wrap.querySelector('#lngInput').value = pos.coords.longitude.toFixed(5);
      state.profile.lat = pos.coords.latitude;
      state.profile.lng = pos.coords.longitude;
      await saveProfile();
      setGeoStatus(wrap,'現在地を取得しました ✓');
    }, () => setGeoStatus(wrap,'取得できませんでした（手入力してください）'));
  };

  wrap.querySelector('#regForm').onsubmit = async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('.submit-btn');
    submitBtn.disabled = true;
    const f = new FormData(e.target);
    const listing = {
      id: uid(), userId: state.profile.id, userName: state.profile.name, mode: state.formMode,
      kind: state.formKind, subcat: f.get('subcat'),
      title: f.get('title').trim(),
      deadline: f.get('deadline') || null,
      lat: f.get('lat') ? Number(f.get('lat')) : null, lng: f.get('lng') ? Number(f.get('lng')) : null,
      note: f.get('note').trim(), status: 'open', createdAt: Date.now(),
    };
    await createListing(listing);
    state.geoStatus = '';
    state.tab = 'top';
    render();
  };

  const myTagsEl = wrap.querySelector('#myTags');
  const mine = myListings();
  if(mine.length===0){
    myTagsEl.innerHTML = `<div class="empty">まだ登録がありません。上のフォームから登録してください。</div>`;
  } else {
    const list = document.createElement('div'); list.className='tag-list';
    mine.forEach(l => list.appendChild(renderTag(l)));
    myTagsEl.appendChild(list);
  }
  return wrap;
}
function setGeoStatus(wrap, msg){ state.geoStatus = msg; const el = wrap.querySelector('#geoStatus'); if(el) el.textContent = msg; }

function renderTag(l){
  const el = document.createElement('div'); el.className = 'tag ' + l.mode;
  const kindInfo = KINDS[l.kind] || {emoji:'💡'};
  const badge = l.mode==='need' ? deadlineBadge(l.deadline) : null;
  el.innerHTML = `
    <button class="del" title="削除">✕</button>
    <div class="kind-glow">${kindInfo.emoji}</div>
    <span class="kind">${l.mode==='need' ? '困っています' : 'できること'}</span>
    <h3>${escapeHtml(l.title)}</h3>
    <div class="meta">
      分類: ${escapeHtml(l.kind)}・${escapeHtml(l.subcat)}<br>
      ${badge ? '期限: ' + badge.text + '<br>' : ''}
      座標: ${l.lat ? l.lat.toFixed(2)+', '+l.lng.toFixed(2) : '未設定'}
    </div>
    ${l.note ? `<div class="note">"${escapeHtml(l.note)}"</div>` : ''}
  `;
  el.querySelector('.del').onclick = async () => { if(confirm('この登録を削除しますか？')){ await deleteListing(l.id); } };
  return el;
}

// ---- connections ----
function renderConnections(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>つながり一覧</h2><p class="sub">同じカテゴリの相手が見つかると自動で提案されます。距離が近い順に表示（あなたの登録が関わるものだけ）</p>`;
  const list = document.createElement('div');
  const mine = myConnections().slice().sort((a,b)=>(a.distanceKm??1e9)-(b.distanceKm??1e9));
  if(mine.length===0){
    list.innerHTML = `<div class="empty">まだつながりがありません。「登録する」から困りごと・できることを登録すると、同じカテゴリの相手が見つかった時に自動でここに表示されます。</div>`;
  } else {
    mine.forEach(m => list.appendChild(renderConnCard(m)));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderConnCard(m){
  const n = listingById(m.needId), o = listingById(m.offerId);
  const el = document.createElement('div'); el.className='conn-card';
  if(m.status==='connected'){ const st=document.createElement('div'); st.className='stamp'; st.textContent='つながり成立'; el.appendChild(st); }
  if(!n || !o){ el.innerHTML = `<div class="empty">相手側のデータが削除されました</div>`; return el; }
  const sideN = document.createElement('div'); sideN.className='side need';
  sideN.innerHTML = `<span class="kind">困っています</span><h4>${escapeHtml(n.title)}</h4><div class="m">${escapeHtml(n.userName)}</div>`;
  const mid = document.createElement('div'); mid.className='mid';
  mid.innerHTML = `<div class="dist">${fmtDist(m.distanceKm)}</div><div>${m.connectedBy==='system' ? '自動提案' : 'つないだ人あり'}</div>`;
  const sideO = document.createElement('div'); sideO.className='side offer';
  sideO.innerHTML = `<span class="kind">できること</span><h4>${escapeHtml(o.title)}</h4><div class="m">${escapeHtml(o.userName)}</div>`;
  const actions = document.createElement('div'); actions.className='conn-actions';
  const chatBtn = document.createElement('button'); chatBtn.className='btn-sm primary'; chatBtn.textContent='チャットする';
  chatBtn.onclick = () => { state.tab='chat'; state.activeConnId = m.id; render(); };
  actions.appendChild(chatBtn);
  if(m.status!=='connected'){
    const confirmBtn = document.createElement('button'); confirmBtn.className='btn-sm'; confirmBtn.textContent='つながり成立にする';
    confirmBtn.onclick = async () => { await updateDoc(doc(db,'connections',m.id), {status:'connected'}); };
    actions.appendChild(confirmBtn);
  }
  el.appendChild(sideN); el.appendChild(mid); el.appendChild(sideO); el.appendChild(actions);
  return el;
}

// ---- chat ----
function renderChatTab(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>チャット</h2><p class="sub">つながったお相手とリアルタイムでやり取りできます</p>`;
  const layout = document.createElement('div'); layout.className='chat-layout';
  const threads = document.createElement('div'); threads.className='chat-threads';
  const mine = myConnections();
  if(!state.activeConnId && mine.length) state.activeConnId = mine[0].id;
  if(mine.length===0){
    threads.innerHTML = `<div class="empty">つながりが成立するとここにスレッドが表示されます。</div>`;
  } else {
    mine.forEach(m => {
      const n = listingById(m.needId), o = listingById(m.offerId);
      if(!n||!o) return;
      const partnerName = n.userId===state.profile.id ? o.userName : n.userName;
      const item = document.createElement('div');
      item.className = 'thread-item' + (m.id===state.activeConnId ? ' active':'');
      item.innerHTML = `<div class="t-title">${escapeHtml(partnerName)}</div><div class="t-sub">${escapeHtml(n.title)}</div>`;
      item.onclick = () => { state.activeConnId = m.id; render(); };
      threads.appendChild(item);
    });
  }
  const body = document.createElement('div'); body.className='chat-body'; body.id='chatBody';
  layout.appendChild(threads); layout.appendChild(body);
  wrap.appendChild(layout);

  if(state.activeConnId){
    const m = state.connections.find(x=>x.id===state.activeConnId);
    if(m){
      body.innerHTML = `
        <div class="chat-msgs" id="msgsEl"><div class="empty">読み込み中…</div></div>
        <div class="chat-input">
          <input type="text" id="chatText" placeholder="メッセージを入力…">
          <button id="chatSend">送信</button>
        </div>`;
      listenChat(m.id);
      const send = async () => {
        const inp = document.getElementById('chatText');
        const text = inp.value.trim();
        if(!text) return;
        inp.value = '';
        await addDoc(collection(db,'connections',m.id,'messages'), {
          senderId: state.profile.id, senderName: state.profile.name, text, ts: Date.now()
        });
      };
      document.getElementById('chatSend').onclick = send;
      document.getElementById('chatText').addEventListener('keydown', e => { if(e.key==='Enter') send(); });
    }
  } else {
    body.innerHTML = `<div class="empty">左のスレッドを選択してください。</div>`;
  }
  return wrap;
}

function renderChatMessagesOnly(){
  const msgsEl = document.getElementById('msgsEl');
  if(!msgsEl) return;
  msgsEl.innerHTML = '';
  if(state.chatMsgs.length===0){ msgsEl.innerHTML = `<div class="empty">まだメッセージはありません。挨拶してみましょう。</div>`; return; }
  state.chatMsgs.forEach(msg => {
    const b = document.createElement('div');
    b.className = 'msg ' + (msg.senderId===state.profile.id ? 'me':'them');
    b.innerHTML = `${escapeHtml(msg.text)}<div class="m-meta">${escapeHtml(msg.senderName)} ・ ${fmtTime(msg.ts)}</div>`;
    msgsEl.appendChild(b);
  });
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ---- coordinator (admin) ----
function renderAdmin(){
  const wrap = document.createElement('div');
  const listings = state.listings, conns = state.connections;
  const needCount = listings.filter(l=>l.mode==='need').length;
  const offerCount = listings.filter(l=>l.mode==='offer').length;
  const connectedCount = conns.filter(m=>m.status==='connected').length;
  const rate = conns.length ? Math.round(connectedCount/conns.length*100) : 0;

  wrap.innerHTML = `
    <h2>コーディネーター画面</h2>
    <p class="sub">全員の困りごと・できることを見渡して、手動でつなげることもできます</p>
    <div class="stat-row">
      <div class="stat"><div class="v">${listings.length}</div><div class="l">総登録数</div></div>
      <div class="stat"><div class="v">${needCount} / ${offerCount}</div><div class="l">困りごと / できること</div></div>
      <div class="stat"><div class="v">${conns.length}</div><div class="l">つながり候補数</div></div>
      <div class="stat"><div class="v">${rate}%</div><div class="l">成立率（${connectedCount}件）</div></div>
    </div>

    <div class="section-title"><span>手動でつなげる</span><span class="rule"></span></div>
    <div class="connector-tool">
      <div class="row">
        <div class="field"><label>困りごとを選ぶ</label><select id="pickNeed"></select></div>
        <div class="field"><label>できることを選ぶ</label><select id="pickOffer"></select></div>
        <button id="connectBtn">つなげる</button>
      </div>
    </div>

    <div class="section-title"><span>ヒト・モノ・コト別 登録件数</span><span class="rule"></span></div>
    <div class="bar-chart" id="barChart"></div>

    <div class="section-title"><span>登録データ一覧</span><span class="rule"></span><button class="export-btn" id="expListings">CSVエクスポート</button></div>
    <div class="table-wrap"><table class="ledger" id="listingTable"></table></div>

    <div class="section-title"><span>つながり一覧</span><span class="rule"></span><button class="export-btn" id="expConns">CSVエクスポート</button></div>
    <div class="table-wrap"><table class="ledger" id="connTable"></table></div>
  `;

  // 手動連携ツール
  const needOpts = listings.filter(l=>l.mode==='need' && l.status==='open');
  const offerOpts = listings.filter(l=>l.mode==='offer' && l.status==='open');
  const pickNeed = wrap.querySelector('#pickNeed');
  const pickOffer = wrap.querySelector('#pickOffer');
  pickNeed.innerHTML = needOpts.map(n=>`<option value="${n.id}">${escapeHtml(n.title)}（${escapeHtml(n.userName)}）</option>`).join('') || `<option value="">困りごとがありません</option>`;
  pickOffer.innerHTML = offerOpts.map(o=>`<option value="${o.id}">${escapeHtml(o.title)}（${escapeHtml(o.userName)}）</option>`).join('') || `<option value="">できることがありません</option>`;
  wrap.querySelector('#connectBtn').onclick = async () => {
    const nId = pickNeed.value, oId = pickOffer.value;
    if(!nId || !oId){ alert('困りごとと、できることの両方を選んでください'); return; }
    const n = listingById(nId), o = listingById(oId);
    await proposeConnection(n, o, 'coordinator');
    alert('つなげました。「つながり」タブから確認できます。');
    render();
  };

  const catCounts = {}; KIND_KEYS.forEach(k=>catCounts[k]={need:0,offer:0});
  listings.forEach(l=>{ if(!catCounts[l.kind]) catCounts[l.kind]={need:0,offer:0}; catCounts[l.kind][l.mode]++; });
  const maxCount = Math.max(1, ...Object.values(catCounts).map(c=>c.need+c.offer));
  const barChart = wrap.querySelector('#barChart');
  Object.entries(catCounts).forEach(([k,c])=>{
    const total = c.need + c.offer;
    const row = document.createElement('div'); row.className='bar-row';
    row.innerHTML = `<div>${KINDS[k]?KINDS[k].emoji:''} ${escapeHtml(k)}</div><div class="bar-track"><div class="bar-fill" style="width:${total/maxCount*100}%"></div></div><div>${total}</div>`;
    barChart.appendChild(row);
  });

  wrap.querySelector('#listingTable').innerHTML = `<tr><th>種別</th><th>内容</th><th>分類</th><th>登録者</th><th>期限</th><th>状態</th><th>登録日時</th></tr>` +
    (listings.map(l => `<tr><td>${l.mode==='need'?'困りごと':'できること'}</td><td>${escapeHtml(l.title)}</td><td>${escapeHtml(l.kind)}・${escapeHtml(l.subcat)}</td><td>${escapeHtml(l.userName)}</td><td>${l.deadline || '-'}</td><td><span class="pill ${l.status==='open'?'open':'connected'}">${l.status==='open'?'募集中':'成立'}</span></td><td>${fmtTime(l.createdAt)}</td></tr>`).join('') || `<tr><td colspan="7">データがありません</td></tr>`);

  wrap.querySelector('#connTable').innerHTML = `<tr><th>内容</th><th>困っている人</th><th>できる人</th><th>距離</th><th>つないだ人</th><th>状態</th><th>作成日時</th></tr>` +
    (conns.map(m => { const n=listingById(m.needId), o=listingById(m.offerId); return `<tr><td>${escapeHtml(m.title)}</td><td>${n?escapeHtml(n.userName):'-'}</td><td>${o?escapeHtml(o.userName):'-'}</td><td>${fmtDist(m.distanceKm)}</td><td>${m.connectedBy==='system'?'自動':(m.connectedBy==='coordinator'?'コーディネーター':'本人')}</td><td><span class="pill ${m.status==='connected'?'connected':'open'}">${m.status==='connected'?'成立':'提案中'}</span></td><td>${fmtTime(m.createdAt)}</td></tr>`; }).join('') || `<tr><td colspan="7">データがありません</td></tr>`);

  wrap.querySelector('#expListings').onclick = () => exportCsv(['mode','title','kind','subcat','userName','deadline','status','createdAt'], listings, 'listings.csv');
  wrap.querySelector('#expConns').onclick = () => exportCsv(['title','needId','offerId','distanceKm','connectedBy','status','createdAt'], conns, 'connections.csv');

  return wrap;
}

function exportCsv(cols, rows, filename){
  const lines = [cols.join(',')];
  rows.forEach(r => { lines.push(cols.map(c => { let v=r[c]; if(v===null||v===undefined) v=''; v=String(v).replace(/"/g,'""'); return /[,"\n]/.test(v) ? `"${v}"` : v; }).join(',')); });
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
