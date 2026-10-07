// 小学校区の一覧と、コーディネーター画面の「校区ダッシュボード」。
//
// 実証のKPI「市内44校区の100%可視化（子ども食堂未設置エリアのニーズ特定）」のためのもの。
//   ・登録（困りごと・できること）には校区を付ける（登録フォームで選択／管理者が一覧で修正）
//   ・各校区の子ども食堂の数は、市の公表一覧（下のSHOKUDO_BASELINE）を初期値にし、
//     管理者が一覧で上書きできる（Firestore: districtInfo/main）
// 校区ごとの件数は、画面を開いたときに登録データから数え直す（保存しない）。

// 校区の「正」：枚方市教育委員会「市立小学校・中学校通学区域表」（最終改正 令和7年3月25日施行）。
// 小学校区44、中学校区19。中学校区ごとに、所属する小学校区を並べている
// （小学校区が複数の中学校区にまたがる場合は、町丁数の多い側に入れている）。
// 校区名は通学区域表の表記どおり（小学校区は「樟葉」、中学校区は「楠葉」）。
// 小学校区の増減や名称変更があったときは、ここだけ直せばよい
// （登録フォーム・補助金ガイド・ダッシュボードのすべてがこの一覧を使う）。
const JHS_GROUPS = [
  ['楠葉', ['樟葉', '樟葉北']],
  ['楠葉西', ['樟葉西', '樟葉南']],
  ['招提北', ['船橋']],
  ['招提', ['招提', '平野']],
  ['第三', ['牧野', '殿山第二']],
  ['渚西', ['磯島', '西牧野']],
  ['第一', ['殿山第一', '禁野', '小倉']],
  ['山田', ['山田東', '交北']],
  ['中宮', ['中宮', '明倫', '山田']],
  ['桜丘', ['桜丘', '桜丘北']],
  ['枚方', ['枚方', '枚方第二']],
  ['蹉跎', ['蹉跎', '蹉跎東', '蹉跎西', '伊加賀']],
  ['第二', ['香里']],
  ['第四', ['五常', '開成', '山之上']],
  ['東香里', ['東香里', '香陽', '春日', '川越']],
  ['長尾', ['長尾', '菅原']],
  ['長尾西', ['西長尾', '田口山']],
  ['杉', ['氷室', '菅原東', '藤阪']],
  ['津田', ['津田', '津田南']],
];
export const DISTRICTS = JHS_GROUPS.flatMap(g => g[1]);
export const DISTRICT_JHS = Object.fromEntries(JHS_GROUPS.flatMap(([jhs, list]) => list.map(d => [d, jhs])));
export const JHS_COUNT = JHS_GROUPS.length;
export const DISTRICT_TARGET = 44;
export const DISTRICT_UNKNOWN = '不明';
const OTHER_ROW = '不明・その他';

// 子ども食堂の実施団体数（校区別）。出典：枚方市「『子どもの居場所づくり（子ども食堂）』団体一覧」
// 令和8年（2026年）7月1日現在。同じ団体が複数の校区で開いている場合は、校区ごとに1と数える。
// 一覧に載っていない校区は0（未設置）。市の最新の一覧が出たらここを更新するか、
// コーディネーター画面の校区ダッシュボードで校区ごとに上書きする。
export const SHOKUDO_AS_OF = '令和8年7月1日現在';
const SHOKUDO_LISTED = {
  樟葉南: 1, 樟葉西: 1, 船橋: 1, 牧野: 3, 殿山第二: 1, 招提: 2, 磯島: 1, 中宮: 1, 明倫: 1, 桜丘: 1,
  枚方第二: 2, 枚方: 2, 山之上: 1, 川越: 1, 開成: 2, 蹉跎東: 1, 蹉跎: 1, 五常: 1, 香陽: 1, 春日: 2,
  菅原東: 1, 菅原: 2, 津田: 2,
};
export const SHOKUDO_BASELINE = Object.fromEntries(DISTRICTS.map(d => [d, SHOKUDO_LISTED[d] || 0]));

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 登録フォーム用の<option>。中学校区ごとにまとめて表示する。
export function districtOptionsHtml(selected, { blank = '選んでください', unknown = '市外・わからない' } = {}){
  const opt = (v, t) => `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>${esc(t)}</option>`;
  return (blank ? `<option value="" disabled${selected ? '' : ' selected'}>${esc(blank)}</option>` : '')
    + JHS_GROUPS.map(([jhs, list]) => `<optgroup label="${esc(jhs)}中学校区">${list.map(d => opt(d, d + '校区')).join('')}</optgroup>`).join('')
    + opt(DISTRICT_UNKNOWN, unknown);
}

const STATUS = {
  unknown: { label: '設置状況 未入力', cls: 'st-unknown' },
  need:    { label: '未設置・ニーズあり', cls: 'st-need' },
  blank:   { label: '未設置・登録なし', cls: 'st-blank' },
  short:   { label: '設置済・支援不足', cls: 'st-short' },
  ok:      { label: '設置済', cls: 'st-ok' },
};

// 校区ごとの集計。listings=全登録、conns=成立済みのつながり、
// info={校区名: 管理者が上書きした子ども食堂の数 or null}（無ければ市の公表値SHOKUDO_BASELINEを使う）
export function computeDistrictRows({ listings, conns, listingById, info }){
  const rows = DISTRICTS.map(name => {
    const override = info && info[name] != null ? Number(info[name]) : null;
    return { name, jhs: DISTRICT_JHS[name], shokudo: override !== null ? override : SHOKUDO_BASELINE[name], overridden: override !== null,
      needs: 0, offers: 0, venues: 0, matched: 0 };
  });
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

// ダッシュボード本体（DOM要素を返す）。ctx.onSave(校区名, 数 or null) で子ども食堂数の上書きを保存する。
export function renderDistrictDashboard(ctx){
  const { rows, other } = computeDistrictRows(ctx);
  const total = rows.length;
  const served = rows.filter(r => r.shokudo > 0).length;
  const empty = rows.filter(r => r.shokudo === 0).length;
  const active = rows.filter(r => r.needs + r.offers > 0).length;
  const pct = n => Math.round(n / total * 100);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    ${total !== DISTRICT_TARGET ? `<div class="dd-warn">校区の一覧が${total}件です（実証の目標は${DISTRICT_TARGET}校区）。districts.js の一覧を確認してください。</div>` : ''}
    <p class="sub">市内${total}校区（中学校区${JHS_COUNT}）すべての子ども食堂の設置状況を、市の公表一覧（${SHOKUDO_AS_OF}）で反映しています。色は、設置の有無と、登録されたニーズ・できることの差から付けています。</p>
    <div class="stat-row">
      <div class="stat"><div class="v">${served}/${total}</div><div class="l">子ども食堂 設置済の校区（${pct(served)}%）</div></div>
      <div class="stat"><div class="v">${empty}</div><div class="l">子ども食堂 未設置の校区</div></div>
      <div class="stat"><div class="v">${active}/${total}</div><div class="l">登録がある校区（${pct(active)}%）</div></div>
      <div class="stat"><div class="v">${other.needs + other.offers}</div><div class="l">校区が未選択の登録</div></div>
    </div>
    <div class="dd-legend">${Object.values(STATUS).filter(s => s !== STATUS.unknown).map(s => `<span class="dd-chip ${s.cls}">${s.label}</span>`).join('')}</div>
    <div class="dd-grid">${rows.map(r => `<div class="dd-tile ${r.status.cls}" title="${esc(r.name)}校区（${esc(r.jhs)}中学校区）：${r.status.label}／子ども食堂 ${r.shokudo}／困りごと ${r.needs}・できること ${r.offers}">${esc(r.name)}<small>困${r.needs}・提${r.offers}</small></div>`).join('')}</div>
    <p class="sub">「子ども食堂（数）」は市の公表値が初期値です。新しくできた・なくなったときは、数を入力して上書きしてください（空欄にすると市の公表値に戻ります）。</p>
    <div class="table-wrap"><table class="ledger dd-table">
      <tr><th>校区</th><th>中学校区</th><th>子ども食堂（数）</th><th>困りごと</th><th>できること</th><th>うち場所提供</th><th>成立</th><th>状態</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.jhs)}</td><td><input type="number" min="0" class="dd-input" data-d="${esc(r.name)}" value="${r.overridden ? r.shokudo : ''}" placeholder="${SHOKUDO_BASELINE[r.name]}"></td><td>${r.needs}</td><td>${r.offers}</td><td>${r.venues}</td><td>${r.matched}</td><td><span class="dd-chip ${r.status.cls}">${r.status.label}</span></td></tr>`).join('')}
      <tr><td>${OTHER_ROW}</td><td>-</td><td>-</td><td>${other.needs}</td><td>${other.offers}</td><td>${other.venues}</td><td>${other.matched}</td><td>校区が未選択・市外</td></tr>
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
    ['name', 'jhs', 'shokudo', 'needs', 'offers', 'venues', 'matched', 'statusLabel'],
    rows.concat([other]).map(r => ({ ...r, statusLabel: r.status ? r.status.label : '' })), 'districts.csv');
  return wrap;
}
