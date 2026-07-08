import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, onSnapshot,
  query, orderBy, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ACCESS_CODE } from "./firebase-config.js";

const CATS = ["食品","日用品","衣類・繊維","家具・家電","工具・資材","本・メディア","植物・園芸","その他"];
const UNITS = ["個","箱","kg袋","束","セット"];

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

let state = {
  profile: null,
  tab: 'register',
  formType: 'want',
  listings: [],
  matches: [],
  activeMatchId: null,
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
function normItem(s){ return (s||'').trim().toLowerCase(); }

// ---------------- gate (login) ----------------
function renderGate(errMsg){
  root.innerHTML = `
    <div class="gate">
      <h1>モノマッチ</h1>
      <p>実証実験に参加するには、表示名を入力してください。</p>
      ${ACCESS_CODE ? '<input id="gateCode" type="password" placeholder="合言葉">' : ''}
      <input id="gateName" type="text" placeholder="表示名（例：さとう農園）">
      <button id="gateBtn">はじめる</button>
      <div class="err">${errMsg || ''}</div>
    </div>`;
  document.getElementById('gateBtn').onclick = onGateSubmit;
  document.getElementById('gateName').addEventListener('keydown', e => { if(e.key==='Enter') onGateSubmit(); });
}

async function onGateSubmit(){
  const name = document.getElementById('gateName').value.trim();
  const code = ACCESS_CODE ? document.getElementById('gateCode').value : '';
  if(ACCESS_CODE && code !== ACCESS_CODE){ renderGate('合言葉が違います'); return; }
  if(!name){ renderGate('表示名を入力してください'); return; }
  root.innerHTML = `<div class="empty" style="margin-top:60px;">ログイン中…</div>`;
  const cred = await signInAnonymously(auth);
  const profile = { id: cred.user.uid, name, lat:null, lng:null, createdAt: Date.now() };
  await setDoc(doc(db,'profiles',profile.id), profile);
  state.profile = profile;
  startApp();
}

// ---------------- boot ----------------
onAuthStateChanged(auth, async (user) => {
  if(user){
    const snap = await getDoc(doc(db,'profiles',user.uid));
    if(snap.exists()){
      state.profile = snap.data();
      startApp();
    } else {
      renderGate();
    }
  } else {
    renderGate();
  }
});

function startApp(){
  listenListings();
  listenMatches();
  render();
}

// ---------------- realtime listeners ----------------
function listenListings(){
  const q = query(collection(db,'listings'), orderBy('createdAt','desc'));
  onSnapshot(q, snap => {
    state.listings = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    render();
  });
}
function listenMatches(){
  const q = query(collection(db,'matches'), orderBy('createdAt','desc'));
  onSnapshot(q, snap => {
    state.matches = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    render();
  });
}
function listenChat(matchId){
  if(state.chatUnsub) state.chatUnsub();
  const q = query(collection(db,'matches',matchId,'messages'), orderBy('ts','asc'));
  state.chatUnsub = onSnapshot(q, snap => {
    state.chatMsgs = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderChatMessagesOnly();
  });
}

// ---------------- data ops ----------------
async function saveProfile(){ await setDoc(doc(db,'profiles',state.profile.id), state.profile); }

async function createListing(listing){
  await setDoc(doc(db,'listings',listing.id), listing);
  await runMatchingFor(listing);
}

async function runMatchingFor(newListing){
  const opposite = newListing.type === 'want' ? 'offer' : 'want';
  const candidates = state.listings.filter(l => l.type===opposite && l.status==='open' && normItem(l.itemName)===normItem(newListing.itemName));
  for(const c of candidates){
    const wantL = newListing.type==='want' ? newListing : c;
    const offerL = newListing.type==='offer' ? newListing : c;
    const dup = state.matches.find(m => m.wantId===wantL.id && m.offerId===offerL.id);
    if(dup) continue;
    const dist = haversine(wantL.lat, wantL.lng, offerL.lat, offerL.lng);
    const qtyOk = offerL.quantity >= wantL.quantity;
    const match = {
      id: uid(), wantId: wantL.id, offerId: offerL.id, itemName: wantL.itemName,
      participants: [wantL.userId, offerL.userId],
      distanceKm: dist, qtyOk, status: 'proposed', createdAt: Date.now(),
    };
    state.matches.push(match);
    await setDoc(doc(db,'matches',match.id), match);
  }
}

async function deleteListing(id){
  await deleteDoc(doc(db,'listings',id));
}

function myListings(){ return state.listings.filter(l=>l.userId===state.profile.id); }
function myMatches(){
  const myIds = new Set(myListings().map(l=>l.id));
  return state.matches.filter(m=>myIds.has(m.wantId) || myIds.has(m.offerId));
}
function listingById(id){ return state.listings.find(l=>l.id===id); }

// ---------------- render root ----------------
function render(){
  root.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className='app';
  wrap.appendChild(renderHeader());
  wrap.appendChild(renderTabs());
  const panel = document.createElement('div'); panel.className='panel';
  if(state.tab==='register') panel.appendChild(renderRegister());
  else if(state.tab==='matching') panel.appendChild(renderMatching());
  else if(state.tab==='chat') panel.appendChild(renderChatTab());
  else if(state.tab==='admin') panel.appendChild(renderAdmin());
  wrap.appendChild(panel);
  root.appendChild(wrap);
}

function renderHeader(){
  const h = document.createElement('div'); h.className='masthead';
  h.innerHTML = `
    <div class="brand">モノマッチ<small>ITEM MATCHING &amp; LOGISTICS BOARD — 実証実験版</small></div>
    <div class="whoami">
      表示名: <b>${escapeHtml(state.profile.name)}</b><br>
      拠点: ${state.profile.lat ? state.profile.lat.toFixed(3)+', '+state.profile.lng.toFixed(3) : '未設定'}
      <br><button id="renameBtn">名前を変更</button>
    </div>`;
  h.querySelector('#renameBtn').onclick = async () => {
    const n = prompt('表示名を入力してください', state.profile.name);
    if(n && n.trim()){ state.profile.name = n.trim(); await saveProfile(); render(); }
  };
  return h;
}

function renderTabs(){
  const wrap = document.createElement('div'); wrap.className='tabs';
  const myM = myMatches().length;
  const tabs = [
    {id:'register', label:'登録'},
    {id:'matching', label:'マッチング', n: myM},
    {id:'chat', label:'チャット'},
    {id:'admin', label:'管理画面'},
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

// ---- register ----
function renderRegister(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h2>物品を登録する</h2>
    <p class="sub">WANT = 欲しいもの ／ OFFER = 提供できるもの</p>
    <div class="type-switch">
      <div class="type-btn want ${state.formType==='want'?'active':''}" data-t="want">🔴 欲しい (WANT)</div>
      <div class="type-btn offer ${state.formType==='offer'?'active':''}" data-t="offer">🟢 提供できる (OFFER)</div>
    </div>
    <form id="regForm">
      <div class="grid2">
        <div class="field"><label>品名</label><input name="itemName" required placeholder="例）段ボール箱"></div>
        <div class="field"><label>カテゴリ</label><select name="category">${CATS.map(c=>`<option>${c}</option>`).join('')}</select></div>
      </div>
      <div class="grid2">
        <div class="field mono"><label>個数</label><input name="quantity" type="number" min="1" value="1" required></div>
        <div class="field"><label>単位</label><select name="unit">${UNITS.map(u=>`<option>${u}</option>`).join('')}</select></div>
      </div>
      <div class="field mono"><label>重量（合計・kg、任意）</label><input name="weightKg" type="number" min="0" step="0.1" placeholder="例）12.5"></div>
      <div class="loc-row">
        <div class="field mono"><label>緯度</label><input name="lat" id="latInput" placeholder="例）35.658"></div>
        <div class="field mono"><label>経度</label><input name="lng" id="lngInput" placeholder="例）139.701"></div>
        <button type="button" class="geo-btn" id="geoBtn">📍 現在地を取得</button>
      </div>
      <div class="geo-status" id="geoStatus">${state.geoStatus}</div>
      <div class="field"><label>メモ（状態・受け渡し方法など）</label><textarea name="note" placeholder="例）平日夕方に駅前で受け渡し可能"></textarea></div>
      <button type="submit" class="submit-btn ${state.formType}">${state.formType==='want' ? 'この内容で「欲しい」を登録' : 'この内容で「提供」を登録'}</button>
    </form>
    <div class="section-title"><span>あなたの登録一覧</span><span class="rule"></span></div>
    <div id="myTags"></div>
  `;

  wrap.querySelectorAll('.type-btn').forEach(b=>{ b.onclick = () => { state.formType = b.dataset.t; render(); }; });

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
      id: uid(), userId: state.profile.id, userName: state.profile.name, type: state.formType,
      itemName: f.get('itemName').trim(), category: f.get('category'),
      quantity: Number(f.get('quantity')) || 1, unit: f.get('unit'),
      weightKg: f.get('weightKg') ? Number(f.get('weightKg')) : null,
      lat: f.get('lat') ? Number(f.get('lat')) : null, lng: f.get('lng') ? Number(f.get('lng')) : null,
      note: f.get('note').trim(), status: 'open', createdAt: Date.now(),
    };
    await createListing(listing);
    state.geoStatus = '';
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
  const el = document.createElement('div'); el.className = 'tag ' + l.type;
  el.innerHTML = `
    <button class="del" title="削除">✕</button>
    <span class="kind">${l.type==='want' ? 'WANT・欲しい' : 'OFFER・提供'}</span>
    <h3>${escapeHtml(l.itemName)}</h3>
    <div class="meta">
      数量: ${l.quantity} ${escapeHtml(l.unit)}${l.weightKg ? ' ／ ' + l.weightKg + ' kg' : ''}<br>
      分類: ${escapeHtml(l.category)}<br>
      座標: ${l.lat ? l.lat.toFixed(2)+', '+l.lng.toFixed(2) : '未設定'}
    </div>
    <div class="who">by ${escapeHtml(l.userName)}</div>
    ${l.note ? `<div class="note">"${escapeHtml(l.note)}"</div>` : ''}
    <div class="barcode"></div>
  `;
  el.querySelector('.del').onclick = async () => { if(confirm('この登録を削除しますか？')){ await deleteListing(l.id); } };
  return el;
}

// ---- matching ----
function renderMatching(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>マッチング一覧</h2><p class="sub">距離が近い順に表示 ／ あなたの登録が関わるマッチのみ</p>`;
  const list = document.createElement('div');
  const mine = myMatches().slice().sort((a,b)=>(a.distanceKm??1e9)-(b.distanceKm??1e9));
  if(mine.length===0){
    list.innerHTML = `<div class="empty">まだマッチがありません。「登録」タブで欲しいもの・提供できるものを登録すると、同じ品名の相手が現れた時に自動でここに表示されます。</div>`;
  } else {
    mine.forEach(m => list.appendChild(renderMatchCard(m)));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderMatchCard(m){
  const w = listingById(m.wantId), o = listingById(m.offerId);
  const el = document.createElement('div'); el.className='match-card';
  if(m.status==='confirmed'){ const st=document.createElement('div'); st.className='stamp'; st.textContent='MATCHED'; el.appendChild(st); }
  if(!w || !o){ el.innerHTML = `<div class="empty">相手側のデータが削除されました</div>`; return el; }
  const sideW = document.createElement('div'); sideW.className='side want';
  sideW.innerHTML = `<span class="kind">WANT</span><h4>${escapeHtml(w.itemName)}</h4><div class="m">${w.quantity}${escapeHtml(w.unit)}${w.weightKg?' / '+w.weightKg+'kg':''}</div><div class="m">${escapeHtml(w.userName)}</div>`;
  const mid = document.createElement('div'); mid.className='mid';
  mid.innerHTML = `<div class="dist">${fmtDist(m.distanceKm)}</div><div>${m.qtyOk ? '数量OK' : '数量要確認'}</div>`;
  const sideO = document.createElement('div'); sideO.className='side offer';
  sideO.innerHTML = `<span class="kind">OFFER</span><h4>${escapeHtml(o.itemName)}</h4><div class="m">${o.quantity}${escapeHtml(o.unit)}${o.weightKg?' / '+o.weightKg+'kg':''}</div><div class="m">${escapeHtml(o.userName)}</div>`;
  const actions = document.createElement('div'); actions.className='match-actions';
  const chatBtn = document.createElement('button'); chatBtn.className='btn-sm primary'; chatBtn.textContent='チャットする';
  chatBtn.onclick = () => { state.tab='chat'; state.activeMatchId = m.id; render(); };
  actions.appendChild(chatBtn);
  if(m.status!=='confirmed'){
    const confirmBtn = document.createElement('button'); confirmBtn.className='btn-sm'; confirmBtn.textContent='成立にする';
    confirmBtn.onclick = async () => { await updateDoc(doc(db,'matches',m.id), {status:'confirmed'}); };
    actions.appendChild(confirmBtn);
  }
  el.appendChild(sideW); el.appendChild(mid); el.appendChild(sideO); el.appendChild(actions);
  return el;
}

// ---- chat ----
function renderChatTab(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>チャット</h2><p class="sub">マッチしたお相手とリアルタイムでやり取りできます</p>`;
  const layout = document.createElement('div'); layout.className='chat-layout';
  const threads = document.createElement('div'); threads.className='chat-threads';
  const mine = myMatches();
  if(!state.activeMatchId && mine.length) state.activeMatchId = mine[0].id;
  if(mine.length===0){
    threads.innerHTML = `<div class="empty">マッチが成立するとここにスレッドが表示されます。</div>`;
  } else {
    mine.forEach(m => {
      const w = listingById(m.wantId), o = listingById(m.offerId);
      if(!w||!o) return;
      const partnerName = w.userId===state.profile.id ? o.userName : w.userName;
      const item = document.createElement('div');
      item.className = 'thread-item' + (m.id===state.activeMatchId ? ' active':'');
      item.innerHTML = `<div class="t-title">${escapeHtml(partnerName)}</div><div class="t-sub">${escapeHtml(w.itemName)} ・ ${fmtDist(m.distanceKm)}</div>`;
      item.onclick = () => { state.activeMatchId = m.id; render(); };
      threads.appendChild(item);
    });
  }
  const body = document.createElement('div'); body.className='chat-body'; body.id='chatBody';
  layout.appendChild(threads); layout.appendChild(body);
  wrap.appendChild(layout);

  if(state.activeMatchId){
    body.innerHTML = `
      <div class="chat-msgs" id="msgsEl"><div class="empty">読み込み中…</div></div>
      <div class="chat-input">
        <input type="text" id="chatText" placeholder="メッセージを入力…">
        <button id="chatSend">送信</button>
      </div>`;
    listenChat(state.activeMatchId);
    const send = async () => {
      const inp = document.getElementById('chatText');
      const text = inp.value.trim();
      if(!text) return;
      inp.value = '';
      await addDoc(collection(db,'matches',state.activeMatchId,'messages'), {
        senderId: state.profile.id, senderName: state.profile.name, text, ts: Date.now()
      });
    };
    document.getElementById('chatSend').onclick = send;
    document.getElementById('chatText').addEventListener('keydown', e => { if(e.key==='Enter') send(); });
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

// ---- admin ----
function renderAdmin(){
  const wrap = document.createElement('div');
  const listings = state.listings, matches = state.matches;
  const wantCount = listings.filter(l=>l.type==='want').length;
  const offerCount = listings.filter(l=>l.type==='offer').length;
  const confirmed = matches.filter(m=>m.status==='confirmed').length;
  const rate = matches.length ? Math.round(confirmed/matches.length*100) : 0;

  wrap.innerHTML = `
    <h2>管理画面（バックエンド）</h2>
    <p class="sub">全参加者の登録・マッチングデータ一覧とレポート（Firestoreの実データ）</p>
    <div class="stat-row">
      <div class="stat"><div class="v">${listings.length}</div><div class="l">総登録数</div></div>
      <div class="stat"><div class="v">${wantCount} / ${offerCount}</div><div class="l">欲しい / 提供</div></div>
      <div class="stat"><div class="v">${matches.length}</div><div class="l">マッチ候補数</div></div>
      <div class="stat"><div class="v">${rate}%</div><div class="l">成立率（${confirmed}件成立）</div></div>
    </div>
    <div class="section-title"><span>カテゴリ別登録件数</span><span class="rule"></span></div>
    <div class="bar-chart" id="barChart"></div>
    <div class="section-title"><span>登録データ一覧</span><span class="rule"></span><button class="export-btn" id="expListings">CSVエクスポート</button></div>
    <div class="table-wrap"><table class="ledger" id="listingTable"></table></div>
    <div class="section-title"><span>マッチング一覧</span><span class="rule"></span><button class="export-btn" id="expMatches">CSVエクスポート</button></div>
    <div class="table-wrap"><table class="ledger" id="matchTable"></table></div>
  `;

  const catCounts = {}; CATS.forEach(c=>catCounts[c]={want:0,offer:0});
  listings.forEach(l=>{ if(!catCounts[l.category]) catCounts[l.category]={want:0,offer:0}; catCounts[l.category][l.type]++; });
  const maxCount = Math.max(1, ...Object.values(catCounts).map(c=>c.want+c.offer));
  const barChart = wrap.querySelector('#barChart');
  Object.entries(catCounts).forEach(([cat,c])=>{
    const total = c.want + c.offer;
    const row = document.createElement('div'); row.className='bar-row';
    row.innerHTML = `<div>${escapeHtml(cat)}</div><div class="bar-track"><div class="bar-fill" style="width:${total/maxCount*100}%"></div></div><div>${total}</div>`;
    barChart.appendChild(row);
  });

  wrap.querySelector('#listingTable').innerHTML = `<tr><th>種別</th><th>品名</th><th>カテゴリ</th><th>数量</th><th>重量</th><th>登録者</th><th>状態</th><th>登録日時</th></tr>` +
    (listings.map(l => `<tr><td>${l.type==='want'?'WANT':'OFFER'}</td><td>${escapeHtml(l.itemName)}</td><td>${escapeHtml(l.category)}</td><td>${l.quantity}${escapeHtml(l.unit)}</td><td>${l.weightKg ?? '-'}</td><td>${escapeHtml(l.userName)}</td><td><span class="pill ${l.status}">${l.status==='open'?'募集中':'成立'}</span></td><td>${fmtTime(l.createdAt)}</td></tr>`).join('') || `<tr><td colspan="8">データがありません</td></tr>`);

  wrap.querySelector('#matchTable').innerHTML = `<tr><th>品名</th><th>WANT</th><th>OFFER</th><th>距離</th><th>数量適合</th><th>状態</th><th>作成日時</th></tr>` +
    (matches.map(m => { const w=listingById(m.wantId), o=listingById(m.offerId); return `<tr><td>${escapeHtml(m.itemName)}</td><td>${w?escapeHtml(w.userName):'-'}</td><td>${o?escapeHtml(o.userName):'-'}</td><td>${fmtDist(m.distanceKm)}</td><td>${m.qtyOk?'OK':'要確認'}</td><td><span class="pill ${m.status==='confirmed'?'matched':'open'}">${m.status==='confirmed'?'成立':'提案中'}</span></td><td>${fmtTime(m.createdAt)}</td></tr>`; }).join('') || `<tr><td colspan="7">データがありません</td></tr>`);

  wrap.querySelector('#expListings').onclick = () => exportCsv(['type','itemName','category','quantity','unit','weightKg','userName','status','createdAt'], listings, 'listings.csv');
  wrap.querySelector('#expMatches').onclick = () => exportCsv(['itemName','wantId','offerId','distanceKm','qtyOk','status','createdAt'], matches, 'matches.csv');

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
