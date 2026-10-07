// 小学校区の一覧と、コーディネーター画面の「校区ダッシュボード」。
//
// 実証のKPI「市内44校区の100%可視化（子ども食堂未設置エリアのニーズ特定）」のためのもの。
//   ・登録（困りごと・できること）には校区を付ける（登録フォームで選択／管理者が一覧で修正）
//   ・各校区の子ども食堂の設置数は、市が把握している数を管理者が入力する（Firestore: districtInfo/main）
// 校区ごとの件数は、画面を開いたときに登録データから数え直す（保存しない）。

// 補助金ガイドの校区の選択肢（市の申込書類作成用ブックの選択肢）を写したもの。
// ★要確認：実証のKPIは「44校区」だが、この一覧は42件。市の公式の校区一覧と照合して差し替えること。
//   （一覧を直せば、登録フォーム・補助金ガイド・ダッシュボードのすべてに反映される）
export const DISTRICTS = ['枚方','枚方第二','蹉跎','香里','開成','五常','春日','桜丘','山田','明倫','殿山第一','殿山第二','樟葉','津田','菅原','氷室','山之上','交北','香陽','招提','中宮','小倉','樟葉南','磯島','蹉跎西','樟葉西','田口山','西牧野','川越','蹉跎東','桜丘北','津田南','樟葉北','船橋','菅原東','山田東','藤阪','平野','長尾','東香里','伊加賀','禁野'];
export const DISTRICT_TARGET = 44;
export const DISTRICT_UNKNOWN = '不明';
const OTHER_ROW = '不明・その他';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function districtOptionsHtml(selected, { blank = '選んでください', unknown = '市外・わからない' } = {}){
  const opt = (v, t) => `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>${esc(t)}</option>`;
  return (blank ? `<option value="" disabled${selected ? '' : ' selected'}>${esc(blank)}</option>` : '')
    + DISTRICTS.map(d => opt(d, d + '校区')).join('')
    + opt(DISTRICT_UNKNOWN, unknown);
}

const STATUS = {
  unknown: { label: '設置状況 未入力', cls: 'st-unknown' },
  need:    { label: '未設置・ニーズあり', cls: 'st-need' },
  blank:   { label: '未設置・登録なし', cls: 'st-blank' },
  short:   { label: '設置済・支援不足', cls: 'st-short' },
  ok:      { label: '設置済', cls: 'st-ok' },
};

// 校区ごとの集計。listings=全登録、conns=成立済みのつながり、info={校区名: 子ども食堂の数 or null}
export function computeDistrictRows({ listings, conns, listingById, info }){
  const rows = DISTRICTS.map(name => ({ name, shokudo: info && info[name] != null ? Number(info[name]) : null, needs: 0, offers: 0, venues: 0, matched: 0 }));
  const other = { name: OTHER_ROW, isOther: true, shokudo: null, needs: 0, offers: 0, venues: 0, matched: 0 };
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));
  const rowOf = d => byName[d] || other;
  listings.forEach(l => {
    const r = rowOf(l.district);
    if(l.mode === 'need') r.needs++; else { r.offers++; if(l.kind === '場所提供') r.venues++; }
  });
  conns.filter(m => m.status === 'connected').forEach(m => {
    const n = listingById(m.needId);
    if(n) rowOf(n.district).matched++;
  });
  rows.forEach(r => {
    const gap = r.needs - r.offers;
    r.status = r.shokudo === null ? STATUS.unknown
      : r.shokudo === 0 ? (r.needs > 0 ? STATUS.need : STATUS.blank)
      : gap > 0 ? STATUS.short : STATUS.ok;
  });
  other.status = null;
  return { rows, other };
}

// ダッシュボード本体（DOM要素を返す）。ctx.onSave(校区名, 数 or null) で子ども食堂数を保存する。
export function renderDistrictDashboard(ctx){
  const { rows, other } = computeDistrictRows(ctx);
  const total = rows.length;
  const known = rows.filter(r => r.shokudo !== null).length;
  const active = rows.filter(r => r.needs + r.offers > 0).length;
  const empty = rows.filter(r => r.shokudo === 0).length;
  const pct = n => Math.round(n / total * 100);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    ${total !== DISTRICT_TARGET ? `<div class="dd-warn">校区の一覧が${total}件です（実証の目標は${DISTRICT_TARGET}校区）。市の公式の校区一覧と照合して、districts.js の DISTRICTS を直してください。</div>` : ''}
    <div class="stat-row">
      <div class="stat"><div class="v">${known}/${total}</div><div class="l">設置状況を把握した校区（${pct(known)}%）</div></div>
      <div class="stat"><div class="v">${active}/${total}</div><div class="l">登録がある校区（${pct(active)}%）</div></div>
      <div class="stat"><div class="v">${empty}</div><div class="l">子ども食堂 未設置の校区</div></div>
      <div class="stat"><div class="v">${other.needs + other.offers}</div><div class="l">校区が未選択の登録</div></div>
    </div>
    <div class="dd-legend">${Object.values(STATUS).map(s => `<span class="dd-chip ${s.cls}">${s.label}</span>`).join('')}</div>
    <div class="dd-grid">${rows.map(r => `<div class="dd-tile ${r.status.cls}" title="${esc(r.name)}校区：${r.status.label}／子ども食堂 ${r.shokudo === null ? '未入力' : r.shokudo}／困りごと ${r.needs}・できること ${r.offers}">${esc(r.name)}<small>困${r.needs}・提${r.offers}</small></div>`).join('')}</div>
    <p class="sub">各校区の「子ども食堂」の数は、市が把握している設置数を入力してください（0＝未設置、空欄＝未確認）。入力すると、色分けと「把握した校区」が更新されます。</p>
    <div class="table-wrap"><table class="ledger dd-table">
      <tr><th>校区</th><th>子ども食堂（数）</th><th>困りごと</th><th>できること</th><th>うち場所提供</th><th>成立</th><th>状態</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.name)}</td><td><input type="number" min="0" class="dd-input" data-d="${esc(r.name)}" value="${r.shokudo === null ? '' : r.shokudo}"></td><td>${r.needs}</td><td>${r.offers}</td><td>${r.venues}</td><td>${r.matched}</td><td><span class="dd-chip ${r.status.cls}">${r.status.label}</span></td></tr>`).join('')}
      <tr><td>${OTHER_ROW}</td><td>-</td><td>${other.needs}</td><td>${other.offers}</td><td>${other.venues}</td><td>${other.matched}</td><td>校区が未選択・市外</td></tr>
    </table></div>
    <button class="export-btn" id="ddExport">校区別の表をCSVで保存</button> <span class="geo-status" id="ddMsg"></span>`;
  const msg = wrap.querySelector('#ddMsg');
  wrap.querySelectorAll('.dd-input').forEach(inp => {
    inp.onchange = async () => {
      const v = inp.value.trim() === '' ? null : Math.max(0, Math.floor(Number(inp.value)));
      msg.textContent = '保存中…';
      try { await ctx.onSave(inp.dataset.d, Number.isFinite(v) ? v : null); msg.textContent = ''; }
      catch(e){ msg.textContent = '保存できませんでした（firestore.rulesのdistrictInfoが未反映の可能性があります）'; }
    };
  });
  wrap.querySelector('#ddExport').onclick = () => ctx.exportCsv(
    ['name', 'shokudo', 'needs', 'offers', 'venues', 'matched', 'statusLabel'],
    rows.concat([other]).map(r => ({ ...r, statusLabel: r.status ? r.status.label : '' })), 'districts.csv');
  return wrap;
}
