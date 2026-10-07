// 補助金ガイド：枚方市「子どもの居場所づくり推進事業」の解説・金額シミュレーター・申請ウィザード。
//
// 数値・条件はすべて「令和8年度 実施団体募集要項（令和8年6月改正版）」による。年度が変わったら
// このファイルの PROGRAM 定義（金額・要件・書類）を要項に合わせて更新すること。
//
// 申請入力データ（役員の氏名・住所・電話番号を含む）は、Firestoreには一切送らず、この端末の
// localStorageにだけ保存する。firestore.rulesは「ログイン済みなら誰でも読める」設計のため、
// 個人情報をサーバーに置かないことが前提。端末を替える場合は「下書きをファイルに保存」を使う。

import { DISTRICTS, SHOKUDO_BASELINE, SHOKUDO_AS_OF } from './districts.js';

const STORE_KEY = 'attaka_subsidy_draft_v1';

// ---------------------------------------------------------------- 制度の定義（要項より）
const PROGRAM = {
  id: 'hirakata-kodomo-2026',
  year: 8,
  yearLabel: '令和8年度',
  period: '令和8年（2026年）4月1日〜令和9年（2027年）3月31日',
  edition: '実施団体募集要項（令和8年6月改正版）',
};
const OFFICE = {
  dept: '枚方市 子ども未来部 子ども青少年政策課',
  zip: '573-8666', address: '枚方市大垣内町2丁目1番20号',
  tel: '072-841-1375（直通）', fax: '072-843-2244（専用）', email: 'kodosei@city.hirakata.osaka.jp',
};
// 1回あたりの補助限度額（表2）。準備食数が大きい順に並べる。
const TIERS = [
  { id: 'A', min: 40, label: '40食以上', unit: 10000 },
  { id: 'B', min: 20, label: '20〜39食', unit: 7000 },
  { id: 'C', min: 10, label: '10〜19食', unit: 5500 },
];
const INITIAL_AMOUNT = 100000;                    // 初期経費：初めて交付決定を受けた初年度に1回限り
const ENRICH_OPTIONS = [0, 1000, 2000, 3000, 4000, 5000]; // 充実経費：1回あたり（希望制）
const MAX_PER_MONTH = 5;                          // 実施回数は「1か所につき1週間に1回」が上限
const MAX_PER_YEAR = 52;
const MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];


const ORG_REQS = [
  { id: 'o1', text: '会則（団体のルールを書いた文書）がある', help: 'まだ無い場合は、最後のステップで「会則（例）」を印刷して、団体に合わせて作れます。' },
  { id: 'o2', text: '政治活動や宗教活動が主な目的ではない' },
  { id: 'o3', text: '活動内容が、公の秩序や良い風俗に反していない' },
  { id: 'o4', text: '続けて、安定して活動できる見通しがある' },
  { id: 'o5', text: '暴力団や、暴力団と密接な関係のある団体ではない' },
];
const EVENT_REQS = [
  { id: 'e1', text: '中学生以下の子どもの食事は無料にする' },
  { id: 'e2', text: '月に1回以上、定期的に開く（災害や感染症で中止するときは市に相談）' },
  { id: 'e3', text: '1回あたり2時間以上開く（原則）' },
  { id: 'e4', text: '子ども向けの食事を、1回10食以上用意する' },
  { id: 'e5', text: '家で1人で食事をとる、夜遅くまで1人で過ごすなど、事情のある子が参加しやすいよう、関係機関や地域と連携する' },
  { id: 'e6', text: '参加する子どもに、参加登録をしてもらう' },
  { id: 'e7', text: '公共施設または民間施設を使い、子どもの通いやすさ・安全に配慮する' },
  { id: 'e8', text: '調理する人の中に「食品衛生責任者」を置き、設備は保健所の指導に従う' },
  { id: 'e9', text: '保険に入るなど、子どもとスタッフの安全に努める' },
  { id: 'e10', text: '活動で知った個人情報を第三者に漏らさない（活動が終わった後も）' },
];
// 収支予算書の支出項目（様式第3号）と補助対象経費の内容（表1）
const COSTS = [
  { id: 'food', label: '食材費', ex: '食料品の購入費' },
  { id: 'supplies', label: '消耗品費', ex: 'キッチン用品（食器、調理器具、割り箸など）、清掃・衛生用品（洗剤、ペーパータオル、消毒用品、使い捨て手袋など）、文房具、学習用品、絵本、玩具などの購入費' },
  { id: 'equipment', label: '備品購入費', ex: '長く使える物（冷蔵庫、電子レンジ、机、椅子など）の購入費' },
  { id: 'honorarium', label: '謝礼金', ex: 'ボランティアへの謝礼金' },
  { id: 'rent', label: '使用料・賃借料', ex: '会場（施設）の使用料や賃借料' },
  { id: 'utilities', label: '光熱水費', ex: '会場の光熱水費' },
  { id: 'insurance', label: '保険料', ex: '傷害・賠償責任保険などの保険料' },
  { id: 'printing', label: '印刷費', ex: 'チラシ・ポスター・パンフレットなどの印刷費' },
  { id: 'comms', label: '通信費', ex: '連絡に必要な郵送料' },
  { id: 'repair', label: '施設の改修費・修繕費', ex: '会場の改修や、施設・備品の修繕費' },
  { id: 'hygiene', label: '食品衛生責任者となるための講習の受講料', ex: '食品衛生責任者養成講習会の受講料' },
];
const ROLES = ['代表', '副代表', '会計', '会計監査', '理事', 'その他役員'];
const STEPS = [
  { id: 'check',    short: '確認',   title: '対象になるか、確認しましょう' },
  { id: 'org',      short: '団体',   title: '団体のことを書きましょう' },
  { id: 'basic',    short: '基本',   title: '子ども食堂の基本を書きましょう' },
  { id: 'meal',     short: '食事',   title: '食事や取り組みを書きましょう' },
  { id: 'ideas',    short: '考え方', title: '取り組みの考え方を書きましょう' },
  { id: 'schedule', short: '予定',   title: '開催のスケジュールを決めましょう' },
  { id: 'amount',   short: '金額',   title: 'もらえる金額を確認しましょう' },
  { id: 'budget',   short: '収支',   title: 'お金の使い道（収支予算）を書きましょう' },
  { id: 'roster',   short: '役員',   title: '役員と食品衛生責任者を書きましょう' },
  { id: 'pledge',   short: '誓約',   title: '誓約に同意しましょう' },
  { id: 'output',   short: '出力',   title: '確認して、書類をつくりましょう' },
];
const S = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));
// 提出書類（表4）と、その入力に関係するステップ
const DOCS = [
  { id: 'f1', label: '様式第1号　実施団体認定申込書', steps: [S.org] },
  { id: 'f2', label: '様式第2号　事業計画書', steps: [S.basic, S.meal, S.ideas, S.schedule, S.amount] },
  { id: 'f3', label: '様式第3号　収支予算書', steps: [S.budget] },
  { id: 'f4', label: '様式第4号　実施団体役員名簿', steps: [S.roster] },
  { id: 'f5', label: '様式第5号　誓約書', steps: [S.org, S.pledge] },
  { id: 'f6', label: '様式第6号　補助金交付申込書', steps: [S.org, S.amount] },
];
const GLOSSARY = [
  ['概算払い', '先に、見込みの金額をまとめて支払う方法です。年度末に、実際の実績で精算します。'],
  ['精算', '実際に使った額と、すでに受け取った額を比べ、余った分や、開かなかった回の分を返す手続きです。'],
  ['交付決定', '市が「補助金を出します」と決めて、団体に通知することです。'],
  ['実支出額', '使った費用から、参加料など事業の収入を引いた額です。補助額がこれより少ない場合は、この額が上限になります。'],
  ['準備食数', '1回の開催で、子どものために用意する食事の数です。この数で1回あたりの単価が決まります。'],
  ['食品衛生責任者', '調理する人の中の、衛生管理の責任者です。栄養士・調理師のほか、養成講習会を受けた人などがなれます。詳しくは保健所へ。'],
  ['校区', '小学校の通学区域のことです。'],
];

// ---------------------------------------------------------------- ユーティリティ
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const yen = n => (Number(n) || 0).toLocaleString('ja-JP') + '円';
const sum = a => a.reduce((x, y) => x + y, 0);
const intIn = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
function safeUrl(u){ try{ const x = new URL(String(u || '').trim()); return /^https?:$/.test(x.protocol) ? x.href : ''; }catch(e){ return ''; } }
function getPath(o, path){ return path.split('.').reduce((a, k) => a == null ? undefined : a[k], o); }
function setPath(o, path, v){
  const ks = path.split('.'); let a = o;
  ks.forEach((k, i) => {
    if(i === ks.length - 1){ a[k] = v; return; }
    if(a[k] == null || typeof a[k] !== 'object') a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    a = a[k];
  });
}
function deepMerge(base, over){
  if(Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || typeof over !== 'object' || !base || !over) return over === undefined ? base : over;
  const out = { ...base };
  Object.keys(over).forEach(k => { out[k] = deepMerge(base[k], over[k]); });
  return out;
}
function jpDate(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if(!m) return { era: '', m: '', d: '' };
  return { era: Number(m[1]) >= 2019 ? String(Number(m[1]) - 2018) : '', m: String(Number(m[2])), d: String(Number(m[3])) };
}
function jpTime(t){
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); if(!m) return '';
  const h = Number(m[1]);
  return `${h < 12 ? '午前' : '午後'}${h === 12 ? 12 : h % 12}時${m[2]}分`;
}
function durationHours(a, b){
  const p = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const x = p(a), y = p(b); if(x == null || y == null) return null;
  return ((y - x + 1440) % 1440) / 60;
}

// ---------------------------------------------------------------- 下書きの保存（端末内のみ）
function defaultDraft(){
  return {
    ui: { view: 'know', step: 0, qf: { start: 4, per: 2, text: '' } },
    check: {},
    sim: { meals: 20, per: 2, start: 4, first: 'yes', enrich: 0 },
    org: {}, project: {}, schedule: {},
    money: { first: '', enrich: 0, exp: {} },
    roster: { officers: ROLES.slice(0, 4).map(role => ({ role, name: '', address: '', tel: '' })), hyg: {} },
    pledge: {},
  };
}
function loadDraft(){
  try{ const raw = localStorage.getItem(STORE_KEY); if(raw) return deepMerge(defaultDraft(), JSON.parse(raw)); }catch(e){ /* 壊れた保存データは無視して新規にする */ }
  return defaultDraft();
}
let draft = loadDraft();
function saveDraft(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(draft)); }catch(e){ /* 保存できない環境では、画面を閉じると入力は消える */ } }

// ---------------------------------------------------------------- ホストアプリとのつなぎ
let host = { isAdmin: () => false, saveMeta: async () => {} };
let meta = { pdfUrl: '', pageUrl: '', note: '' };
let currentRoot = null;
export function initSubsidy(h){ host = { ...host, ...h }; }
export function setSubsidyMeta(m){ meta = { ...meta, ...(m || {}) }; }
// 入力中にホスト側のrender()で画面が作り直されると、フォーカスが外れて打ちにくくなるので、その判定に使う
export function isSubsidyEditing(){
  const a = document.activeElement;
  return !!(a && a.closest && a.closest('.subsidy-root') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

// ---------------------------------------------------------------- 計算
function tierOf(meals){ const n = Number(meals) || 0; return TIERS.find(t => n >= t.min) || null; }
// シミュレーター用：開始月から年度末までの回数
function simSessions(sim){
  const idx = Math.max(0, MONTHS.indexOf(Number(sim.start)));
  return Math.min(MAX_PER_YEAR, intIn(sim.per, 0, MAX_PER_MONTH) * (MONTHS.length - idx));
}
function calcSim(sim){
  const t = tierOf(sim.meals), n = simSessions(sim);
  const unit = t ? t.unit : 0, enrich = Number(sim.enrich) || 0;
  const operating = unit * n, initial = sim.first === 'yes' ? INITIAL_AMOUNT : 0, enrichment = enrich * n;
  return { t, n, unit, enrich, operating, initial, enrichment, grand: operating + initial + enrichment };
}
function calcAll(d){
  const t = tierOf(d.project.meals);
  const counts = MONTHS.map(m => intIn(getPath(d, `schedule.m${m}.count`), 0, MAX_PER_MONTH));
  const first = sum(counts.slice(0, 6)), second = sum(counts.slice(6));
  const total = Math.min(MAX_PER_YEAR, first + second);
  const unit = t ? t.unit : 0, enrich = Number(d.money.enrich) || 0;
  const operating = unit * total;
  const initial = d.money.first === 'yes' ? INITIAL_AMOUNT : 0;
  const enrichment = enrich * total;
  const grand = operating + initial + enrichment;
  const expTotal = sum(COSTS.map(c => Number(getPath(d, `money.exp.${c.id}.amount`)) || 0));
  const fee = Number(d.money.fee) || 0, own = Number(d.money.own) || 0;
  const incomeTotal = grand + fee + own;
  const diff = expTotal - incomeTotal;
  return {
    t, counts, first, second, total, unit, enrich, operating, initial, enrichment, grand,
    // 上半期（4〜9月）に初期経費を含める。書類作成用ブックの支払い額の見方に合わせた「目安」
    payFirst: (unit + enrich) * first + initial, paySecond: (unit + enrich) * second,
    expTotal, fee, own, incomeTotal, diff,
  };
}

// ---------------------------------------------------------------- 入力チェック
function validate(d){
  const V = [];
  const add = (level, step, text) => V.push({ level, step, text });
  const empty = v => v == null || String(v).trim() === '';
  const req = (v, step, text) => { if(empty(v)) add('error', step, text); };
  const c = calcAll(d);

  const unchecked = [...ORG_REQS, ...EVENT_REQS].filter(r => !d.check[r.id]).length;
  if(unchecked) add('warn', S.check, `対象になるかの確認が、あと${unchecked}項目残っています`);

  const o = d.org;
  req(o.name, S.org, '団体名が未入力です'); req(o.repName, S.org, '代表者の氏名が未入力です');
  req(o.repAddress, S.org, '代表者の住所が未入力です'); req(o.contactPerson, S.org, '連絡担当者が未入力です');
  req(o.zip, S.org, '書類の送付先の郵便番号が未入力です'); req(o.sendAddress, S.org, '書類の送付先の住所が未入力です');
  if(empty(o.tel) && empty(o.email)) add('error', S.org, '連絡先の電話番号かメールアドレスのどちらかを入れてください');

  const p = d.project;
  req(p.name, S.basic, '事業の名称が未入力です');
  if(!p.purposeConsent) add('error', S.basic, '事業の目的への同意（チェック）が入っていません');
  req(p.purposeText, S.basic, '事業の目的（自分たちの言葉）が未記入です');
  req(p.staffCount, S.basic, 'スタッフ数が未入力です');
  req(p.venueName, S.basic, '実施場所の施設名が未入力です'); req(p.venueAddress, S.basic, '実施場所の住所が未入力です');
  req(p.district, S.basic, '小学校区が未選択です');
  if(empty(p.meals)) add('error', S.basic, '1回に用意する子ども向けの食数が未入力です');
  else if(!c.t) add('error', S.basic, '子ども向けの食事は1回10食以上が必要です（要件）');
  req(p.capacity, S.basic, '利用定員が未入力です'); req(p.startDate, S.basic, '事業開始（予定）日が未入力です');
  req(p.dayText, S.basic, '実施日が未記入です');
  const hrs = durationHours(p.startTime, p.endTime);
  if(hrs == null) add('error', S.basic, '実施時間（開始・終了）が未入力です');
  else if(hrs < 2) add('warn', S.basic, `実施時間が${hrs}時間です。原則2時間以上が必要です`);
  if([p.pubTel, p.pubFax, p.pubEmail, p.pubSns].every(empty)) add('error', S.basic, '利用者向けの問い合わせ先を、どれか1つは入れてください');

  req(p.food, S.meal, '食材の調達方法が未記入です'); req(p.menu, S.meal, '食事の内容が未記入です'); req(p.fee, S.meal, '利用者負担が未記入です');
  req(p.safety, S.ideas, '安全管理の考え方が未記入です'); req(p.outreach, S.ideas, '情報発信の考え方が未記入です');
  req(p.sustain, S.ideas, '事業の継続に関する考え方が未記入です'); req(p.track, S.ideas, '団体の活動実績が未記入です');

  if(c.total < 1) add('error', S.schedule, '開催予定の回数が0回です。月ごとの回数を入れてください');
  else {
    const firstIdx = c.counts.findIndex(n => n > 0);
    const gaps = MONTHS.filter((m, i) => i > firstIdx && c.counts[i] === 0);
    if(gaps.length) add('warn', S.schedule, `${gaps.map(m => m + '月').join('・')}が0回です。原則、月に1回以上の定期開催が必要です`);
  }
  if(d.money.first === '') add('error', S.amount, '「初めて補助金を受けるか」が未選択です');

  if(c.expTotal <= 0) add('error', S.budget, '支出の予算が入っていません');
  else if(c.diff !== 0) add('error', S.budget, c.diff > 0 ? `収支が合いません（支出が${yen(c.diff)}多いです）` : `収支が合いません（収入が${yen(-c.diff)}多いです）`);

  const off = d.roster.officers || [];
  ['代表', '会計', '会計監査'].forEach(role => {
    const r = off.find(x => x.role === role);
    if(!r || empty(r.name) || empty(r.address) || empty(r.tel)) add('error', S.roster, `役員名簿に「${role}」の氏名・住所・電話番号を入れてください`);
  });
  const acc = off.find(x => x.role === '会計'), aud = off.find(x => x.role === '会計監査');
  if(acc && aud && !empty(acc.name) && acc.name.trim() === aud.name.trim()) add('error', S.roster, '会計と会計監査は、同じ人が兼ねることはできません');
  const h = d.roster.hyg || {};
  req(h.name, S.roster, '食品衛生責任者の氏名が未入力です'); req(h.tel, S.roster, '食品衛生責任者の電話番号が未入力です');
  if(!h.q1 && !h.q2 && !h.q3 && !(h.q4 && !empty(h.qtext))) add('warn', S.roster, '食品衛生責任者の資格等が未選択です。講習をこれから受ける場合は保健所に確認しましょう');

  if(!d.pledge.p1 || !d.pledge.p2 || !d.pledge.p3) add('error', S.pledge, '誓約書の3項目すべてに同意（チェック）が必要です');
  return V;
}

// ---------------------------------------------------------------- 画面の部品
const districtLabel = x => x + '校区' + (SHOKUDO_BASELINE[x] > 0 ? '（実施団体あり）' : '');
function sec(title, inner, open){
  return `<details class="sb-sec"${open ? ' open' : ''}><summary>${title}</summary><div class="sb-sec-body">${inner}</div></details>`;
}
function fld({ path, label, hint, type = 'text', ph = '', req = false, num = false, rows = 0, attrs = '' }){
  const v = getPath(draft, path);
  const badge = req ? '<span class="sb-req">必須</span>' : '';
  const help = hint ? `<div class="sb-help">${hint}</div>` : '';
  const ctrl = rows
    ? `<textarea data-bind="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`
    : `<input data-bind="${path}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}"${num ? ' data-num inputmode="numeric"' : ''} ${attrs}>`;
  return `<div class="field sb-field"><label>${label}${badge}</label>${help}${ctrl}</div>`;
}
function selectField({ path, label, hint, options, req = false, blank = '選んでください' }){
  const v = getPath(draft, path);
  const opts = (blank ? [['', blank]] : []).concat(options).map(([val, text]) => `<option value="${esc(val)}"${String(v ?? '') === String(val) ? ' selected' : ''}>${esc(text)}</option>`).join('');
  return `<div class="field sb-field"><label>${label}${req ? '<span class="sb-req">必須</span>' : ''}</label>${hint ? `<div class="sb-help">${hint}</div>` : ''}<select data-bind="${path}">${opts}</select></div>`;
}
function chk(path, text){
  return `<label class="sb-check"><input type="checkbox" data-bind="${path}"${getPath(draft, path) ? ' checked' : ''}><span>${text}</span></label>`;
}
function radios(path, options){
  const v = getPath(draft, path);
  return `<div class="sb-radios">${options.map(([val, text]) => `<label class="sb-radio"><input type="radio" name="${path}" data-bind="${path}" value="${val}"${String(v ?? '') === String(val) ? ' checked' : ''}><span>${text}</span></label>`).join('')}</div>`;
}
const out = key => `<span data-out="${key}"></span>`;

// ---------------------------------------------------------------- 画面：ヘッダーとナビ
function headerHtml(){
  const pdf = safeUrl(meta.pdfUrl), page = safeUrl(meta.pageUrl);
  return `
    <div class="sb-hero">
      <h2>子ども食堂を始めたい方へ　補助金ガイド</h2>
      <p class="sub">${PROGRAM.yearLabel}　枚方市「子どもの居場所づくり推進事業」の補助金を、はじめての方にも分かるようにまとめました。</p>
      <div class="sb-consult">
        <b>⚠ 新しく始める団体は、申し込みの前に、必ず市へ事前相談をしてください。</b>
        <div>${esc(OFFICE.dept)}　電話 ${esc(OFFICE.tel)}　<a href="mailto:${esc(OFFICE.email)}">${esc(OFFICE.email)}</a></div>
        ${meta.note ? `<div class="sb-note">${nl(meta.note)}</div>` : ''}
      </div>
      <div class="sb-links">
        ${pdf ? `<a class="sb-linkbtn" href="${esc(pdf)}" target="_blank" rel="noopener noreferrer">📄 募集要項（PDF）を開く</a>` : `<span class="sb-linkbtn off">📄 募集要項PDFは準備中です</span>`}
        ${page ? `<a class="sb-linkbtn" href="${esc(page)}" target="_blank" rel="noopener noreferrer">🏛 市のページを開く</a>` : ''}
      </div>
      <p class="sb-fine">この画面は、申請書類づくりのお手伝いです。金額は上限の目安で、認定・交付の決定は市が行います。最新の内容は、必ず市の募集要項で確認してください。</p>
    </div>`;
}
function navHtml(){
  const v = draft.ui.view;
  const b = (id, n, t) => `<button type="button" class="sb-navbtn${v === id ? ' active' : ''}" data-act="view:${id}"><span>${n}</span>${t}</button>`;
  return `<div class="sb-nav">${b('know', 1, '制度を知る')}${b('sim', 2, 'いくらもらえる？')}${b('wizard', 3, '申請書をつくる')}</div>`;
}

// ---------------------------------------------------------------- 画面：制度を知る
function knowHtml(){
  const ex = t => { const n = 24; return t.unit * n; };
  const flow = [
    ['市へ事前相談', '新しく始める団体は必須です。電話・メールで、計画や対象地域について相談します。'],
    ['書類をそろえて提出', '様式第1〜6号と会則を、メール・郵送・持参のいずれかで子ども青少年政策課へ。'],
    ['審査・認定（約2か月）', '事業計画書・収支予算書をもとに、目的・内容・予算・安全性・継続性・活動実績を審査します。'],
    ['認定・交付決定の通知', '市から通知が届きます。認定団体の事業計画書・収支予算書は、市のホームページに載ります。'],
    ['補助金が振り込まれる（概算払い）', '年度末までの予定回数で計算した額が、上半期・下半期の2回に分けて支払われます。4月当初から始める場合は4月下旬です。'],
    ['開催しながら、毎月報告', '月例報告書で、毎月の実施回数や参加者数を報告します。'],
    ['年度末に実績報告・精算', '最終開催日の1週間後をめやすに、実績報告書・収支決算書・出納簿・領収書の写しを提出します。'],
  ];
  return `
    ${sec('この制度ってなに？', `
      <p>子ども食堂などの「子どもの居場所づくり」に取り組む団体に、市が運営のお金を助成する制度です。食事の提供に使う備品などの<b>初期費用</b>と、食材費などの<b>運営費</b>が対象です。</p>
      <p>いくつかの条件を満たせば、開く回数に応じて、年間で数十万円の補助が受けられます。</p>
      <p class="sb-cta"><button type="button" class="sb-btn" data-act="view:sim">いくらもらえるか計算してみる</button> <button type="button" class="sb-btn ghost" data-act="view:wizard">申請書づくりを始める</button></p>`, true)}
    ${sec('もらえるお金は3種類', `
      <div class="sb-cards">
        <div class="sb-card"><h4>運営経費</h4><div class="sb-big">1回 5,500〜10,000円</div>
          <p>毎回の食材費などに使えます。1回に用意する子ども向けの食数で単価が決まり、<b>年間の開催回数</b>をかけた額が上限です。</p></div>
        <div class="sb-card"><h4>初期経費</h4><div class="sb-big">最大 100,000円</div>
          <p>初めて補助金を受ける<b>最初の年に1回だけ</b>。冷蔵庫などの備品をそろえるときに助かります。</p></div>
        <div class="sb-card"><h4>充実経費（希望制）</h4><div class="sb-big">1回 0〜5,000円 上乗せ</div>
          <p>希望する団体だけ。使い道と成果を<b>毎月報告</b>します。充実経費<b>だけ</b>では申請できません。（令和8年度からの暫定の区分）</p></div>
      </div>
      <table class="sb-table"><thead><tr><th>1回に用意する子ども向けの食数</th><th>1回あたりの上限</th><th>月2回（24回）</th><th>毎週（52回）</th></tr></thead><tbody>
        ${TIERS.map(t => `<tr><td>${t.label}（${t.id}区分）</td><td>${yen(t.unit)}</td><td>${yen(t.unit * 24)}</td><td>${yen(t.unit * 52)}</td></tr>`).join('')}
      </tbody></table>
      <p class="sb-fine">開催回数は「1か所につき、1週間に1回」までを数えます（週に2回開いても1回）。実際に使った額（支出−収入）が上限より少ないときは、その額が補助額になります。市の予算の範囲内で交付されます。</p>`, true)}
    ${sec('対象になる団体・事業', `
      <h4 class="sb-h">団体の条件（すべて満たす）</h4>
      <ul>${ORG_REQS.map(r => `<li>${esc(r.text)}</li>`).join('')}</ul>
      <h4 class="sb-h">どんな事業が対象？</h4>
      <ul><li>枚方市内で、営利を目的とせず、さまざまな課題のある子どもたちのために行う</li>
        <li><b>食事の提供（必ず行う）</b>。原則、調理をします。パンやおにぎりだけなど、簡単な食事は避けてください</li>
        <li>あわせて、学習支援・相談支援・交流の場の提供に、できるだけ取り組む</li></ul>
      <h4 class="sb-h">事業の条件（すべて満たさないと、補助金は出ません）</h4>
      <ul>${EVENT_REQS.map(r => `<li>${esc(r.text)}</li>`).join('')}</ul>
      <div class="sb-alert warn"><b>対象になる地域</b>：新しく始める団体は、原則、すでにこの事業が行われている小学校区は対象外です。ただし、状況によっては対象になることもあるので、市に相談してください。</div>`)}
    ${sec('お金の使い道（使えるもの・使えないもの）', `
      <table class="sb-table"><thead><tr><th>項目</th><th>主な内容</th></tr></thead><tbody>
        ${COSTS.map(c => `<tr><td>${esc(c.label)}</td><td>${esc(c.ex)}</td></tr>`).join('')}
      </tbody></table>
      <div class="sb-alert warn"><b>使えないもの</b>：子ども食堂の運営に直接関係のない物（お酒、個人で消費する食材や消耗品など）。</div>
      <div class="sb-alert info"><b>領収書が必須です</b>：領収書の写しが付けられない費用は、対象になりません。「何を買ったか（品目）」を書いてもらい、<b>宛名は団体名</b>にしてください。10年間の保存をお願いされます。</div>
      <p class="sb-fine">年度の途中で申し込む場合は、申請日以降に使ったお金が対象です。</p>`)}
    ${sec('申請から入金までの流れ', `
      <ol class="sb-flow">${flow.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ol>
      <p class="sb-fine">書類を出してから認定まで、約2か月かかります。開催予定を変える（回数の増減・場所の変更など）ときは、事前に市と相談して「事業計画変更申請書」を、やめるときは「事業中止（廃止）申請書」を出します。</p>`)}
    ${sec('もらった後に気をつけること', `
      <ul>
        <li>年度末に精算します。<b>開かなかった回の分</b>や、実際の支出が受け取った額より少なかった分は、返還します。</li>
        <li>補助金を他の用途に使う、不正に受け取る、参加者が著しく少なく続けられない、などの場合は、交付が取り消され、返還になります。</li>
        <li>領収書などの書類は、10年間保存します。</li>
        <li>食中毒・食物アレルギー・帰宅時の安全に配慮します。終了時刻を伝え、寄り道せず帰るよう声をかけましょう。</li>
        <li>福祉サービス事業所（デイサービスなど）を会場にする場合は、事前に窓口（福祉指導監査課など）へ相談します。</li>
        <li>始めたばかりのころは周知が足りないことが多いので、回数や食数は<b>無理のない設定</b>にしましょう。</li>
      </ul>`)}
    ${sec('むずかしい言葉', `<dl class="sb-gloss">${GLOSSARY.map(([w, d]) => `<dt>${esc(w)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`)}
    ${host.isAdmin() ? adminHtml() : ''}`;
}
function adminHtml(){
  return `<details class="sb-sec sb-admin" open><summary>🔒 行政ご担当者向け：募集要項PDFのURLを登録</summary><div class="sb-sec-body">
    <p class="sb-fine">市のホームページに掲載している募集要項PDFのURLを登録すると、この画面の「募集要項（PDF）を開く」から誰でも開けます。年度が変わったら更新してください。</p>
    <div class="field"><label>募集要項PDFのURL</label><input type="url" id="sbPdfUrl" value="${esc(meta.pdfUrl)}" placeholder="https://www.city.hirakata.osaka.jp/..."></div>
    <div class="field"><label>市の制度ページのURL（任意）</label><input type="url" id="sbPageUrl" value="${esc(meta.pageUrl)}" placeholder="https://www.city.hirakata.osaka.jp/..."></div>
    <div class="field"><label>お知らせ（任意：受付期間など。相談窓口の下に表示されます）</label><textarea id="sbNote" rows="2">${esc(meta.note)}</textarea></div>
    <button type="button" class="sb-btn" data-act="adminSave">登録する</button> <span class="sb-fine" id="sbAdminMsg"></span>
  </div></details>`;
}

// ---------------------------------------------------------------- 画面：シミュレーター
function simHtml(){
  const s = draft.sim;
  const startOpts = MONTHS.map(m => [m, m + '月から']);
  return `
    <p class="sub">いくつかの質問に答えると、補助金の上限額がわかります。書き換えながら、いろいろ試してみてください。</p>
    <div class="sb-simform">
      ${fld({ path: 'sim.meals', label: '1回に用意する、子ども向けの食事は何食？', hint: '中学生以下の子どもに出す分です。10食未満は対象外です。', type: 'number', num: true, attrs: 'min="0" max="999"' })}
      ${selectField({ path: 'sim.per', label: '月に何回開く？', hint: '1か所につき、1週間に1回までを数えます（月の上限は5回）。', options: [1, 2, 3, 4, 5].map(n => [n, n + '回']), blank: '' })}
      ${selectField({ path: 'sim.start', label: 'いつから始める？', hint: '年度（4月〜翌3月）の途中から始める場合は、その月を選びます。', options: startOpts, blank: '' })}
      <div class="field sb-field"><label>初めて補助金を受ける？</label><div class="sb-help">初めての年だけ、初期経費（10万円）が加わります。</div>${radios('sim.first', [['yes', 'はい（初めて）'], ['no', 'いいえ（2年目以降）']])}</div>
      ${selectField({ path: 'sim.enrich', label: '充実経費を希望する？', hint: '1回あたりの上乗せ額を選びます。希望しない場合は「0円」。', options: ENRICH_OPTIONS.map(n => [n, n ? yen(n) : '0円（希望しない）']), blank: '' })}
    </div>
    <div class="sb-result" data-sim-result></div>
    <p class="sb-cta"><button type="button" class="sb-btn" data-act="simToWizard">この条件で、申請書づくりに進む</button></p>
    <p class="sb-fine">この計算は、上限額の目安です。実際に使った額（支出−収入）が上限より少ないときは、その額が補助額になります。</p>`;
}
function simResultHtml(){
  const r = calcSim(draft.sim);
  if(!r.t) return `<div class="sb-alert warn">子ども向けの食事が10食未満のため、この補助金の対象になりません。10食以上で計画してみましょう。</div>`;
  return `
    <div class="sb-total"><span>年間の補助額（上限の目安）</span><b>${yen(r.grand)}</b></div>
    <table class="sb-table"><tbody>
      <tr><th>運営経費</th><td>${r.n}回 × ${yen(r.unit)}（${r.t.id}区分・${r.t.label}）</td><td class="sb-r">${yen(r.operating)}</td></tr>
      <tr><th>初期経費</th><td>${r.initial ? '初めて補助金を受ける年だけ' : '対象外（2年目以降）'}</td><td class="sb-r">${yen(r.initial)}</td></tr>
      <tr><th>充実経費</th><td>${r.enrich ? `${r.n}回 × ${yen(r.enrich)}` : '希望しない'}</td><td class="sb-r">${yen(r.enrichment)}</td></tr>
    </tbody></table>
    <details class="sb-sec"><summary>ほかの食数だと、いくら？</summary><div class="sb-sec-body">
      <table class="sb-table"><thead><tr><th>区分</th><th>1回あたり</th><th>${r.n}回だと</th></tr></thead><tbody>
        ${TIERS.map(t => `<tr${r.t.id === t.id ? ' class="sb-hit"' : ''}><td>${t.id}区分（${t.label}）</td><td>${yen(t.unit)}</td><td>${yen(t.unit * r.n)}</td></tr>`).join('')}
      </tbody></table></div></details>`;
}

// ---------------------------------------------------------------- 画面：申請ウィザード
function wizardHtml(){
  const i = intIn(draft.ui.step, 0, STEPS.length - 1);
  const chips = STEPS.map((s, k) => `<button type="button" class="sb-chip${k === i ? ' active' : ''}${k < i ? ' done' : ''}" data-act="step:${k}"><span>${k + 1}</span>${s.short}</button>`).join('');
  return `
    <div class="sb-chips">${chips}</div>
    <div class="sb-stephead"><div class="sb-stepno">ステップ ${i + 1} / ${STEPS.length}</div><h3>${STEPS[i].title}</h3></div>
    <div class="sb-stepbody">${stepHtml(STEPS[i].id)}</div>
    <div class="sb-wizfoot">
      <button type="button" class="sb-btn ghost" data-act="prev"${i === 0 ? ' disabled' : ''}>← 前へ</button>
      <span class="sb-fine">入力は自動で、この端末の中に保存されます</span>
      <button type="button" class="sb-btn" data-act="next"${i === STEPS.length - 1 ? ' disabled' : ''}>次へ →</button>
    </div>`;
}
function stepHtml(id){
  switch(id){
    case 'check': return `
      <p>申請できる団体かどうかを、順番に確認します。<b>すべて「はい」にできれば</b>、申請の準備はOKです。まだのものは、市への事前相談で確認しましょう。</p>
      <h4 class="sb-h">団体について</h4>
      ${ORG_REQS.map(r => chk('check.' + r.id, esc(r.text) + (r.help ? `<em>${esc(r.help)}</em>` : ''))).join('')}
      <h4 class="sb-h">事業について（すべて満たさないと補助金は出ません）</h4>
      ${EVENT_REQS.map(r => chk('check.' + r.id, esc(r.text))).join('')}
      <div class="sb-alert warn"><b>対象の地域</b>：新しく始める団体は、原則、すでにこの事業が行われている小学校区は対象外です。あなたの校区で実施団体があるかは、市に確認してください。</div>
      <div class="sb-alert info"><b>事前相談は必須です</b>：${esc(OFFICE.dept)}　電話 ${esc(OFFICE.tel)}</div>`;
    case 'org': return `
      <p class="sb-help">ここで入れた内容は、様式第1号・第5号・第6号に自動で入ります。</p>
      ${fld({ path: 'org.name', label: '団体名', req: true, ph: '例）ひらかた子ども食堂の会' })}
      ${fld({ path: 'org.repName', label: '代表者の氏名', req: true })}
      ${fld({ path: 'org.repAddress', label: '代表者の住所', req: true })}
      <h4 class="sb-h">団体の連絡先</h4>
      <p class="sb-help">補助金の手続きや事業について、市から連絡するときに使います。</p>
      ${fld({ path: 'org.contactPerson', label: '連絡担当者', req: true })}
      <div class="grid2">${fld({ path: 'org.zip', label: '書類の送付先：郵便番号', req: true, ph: '573-8666', attrs: 'inputmode="numeric"' })}${fld({ path: 'org.sendAddress', label: '書類の送付先：住所', req: true })}</div>
      <div class="grid2">${fld({ path: 'org.tel', label: '電話', type: 'tel', ph: '072-000-0000' })}${fld({ path: 'org.fax', label: 'FAX', type: 'tel' })}</div>
      ${fld({ path: 'org.email', label: 'メールアドレス', type: 'email', hint: '電話かメールの、どちらかは入れてください。' })}
      ${fld({ path: 'org.applyDate', label: '申請する日（分かる場合）', type: 'date', hint: '空欄でも構いません。様式第1号・第5号の日付に入ります（様式第6号は、市の指定どおり空欄で出力します）。' })}`;
    case 'basic': return `
      <h4 class="sb-h">事業の目的</h4>
      <div class="sb-help">市が定めた趣旨です。ご理解・ご同意いただける場合はチェックを入れてください。</div>
      ${chk('project.purposeConsent', '家で1人で食事をとる、夜遅くまで1人で過ごすといった環境にあるなど、家庭的に様々な課題のある子どもたちが、食事の提供を通じ、地域で安心して過ごせるための居場所づくりに取り組みます。')}
      ${fld({ path: 'project.purposeText', label: 'どんな思いで取り組みますか？', req: true, rows: 4, hint: '食事の提供を基本として、どのような目的で事業に取り組むかを、自分たちの言葉で書きます。', ph: '例）地域で子どもたちを見守り、だれでも気軽に立ち寄れる場所をつくりたい。' })}
      <h4 class="sb-h">子ども食堂の基本</h4>
      ${fld({ path: 'project.name', label: '事業の名称', req: true, ph: '例）●●子ども食堂' })}
      ${fld({ path: 'project.staffCount', label: 'スタッフ数（人）', req: true, num: true, type: 'number', attrs: 'min="1"', hint: 'ボランティアを含めた、おおよその人数です。' })}
      ${fld({ path: 'project.venueName', label: '実施場所：施設名', req: true, ph: '例）●●会館', hint: '「つながり」で見つけた場所提供の施設があれば、ここに入れます。' })}
      ${fld({ path: 'project.venueAddress', label: '実施場所：住所', req: true, ph: '枚方市…' })}
      ${selectField({ path: 'project.district', label: '実施場所の小学校区', req: true, options: DISTRICTS.map(x => [x, districtLabel(x)]), hint: `新しく始める団体は、原則、すでに実施団体がある校区は対象外です。（実施団体の有無は、市の一覧・${SHOKUDO_AS_OF}にもとづきます）` })}
      <div data-district-note></div>
      ${selectField({ path: 'project.district2', label: '校区の異なる2か所目（ある場合のみ）', options: DISTRICTS.map(x => [x, districtLabel(x)]), blank: 'なし' })}
      ${fld({ path: 'project.meals', label: '1回に用意する、子ども向けの食数（食）', req: true, num: true, type: 'number', attrs: 'min="0"', hint: '「子ども」は、無料が必須となる<b>中学生以下</b>の子どもです。10食以上が必要です。この数で区分（A・B・C）が決まります。' })}
      <div class="sb-inline">区分：<b>${out('tier')}</b>　1回あたりの上限：<b>${out('unit')}</b></div>
      ${fld({ path: 'project.capacity', label: '利用定員（1回あたり・人）', req: true, num: true, type: 'number', attrs: 'min="1"', hint: '中学生以下だけでなく、高校生以上も含めた人数です。' })}
      ${fld({ path: 'project.startDate', label: '事業開始（予定）日', req: true, type: 'date', hint: 'すでに同じような取り組みをしている場合は、その開始日を入れます。' })}
      ${fld({ path: 'project.dayText', label: '実施日', req: true, ph: '例）毎週第2・4金曜日 ／ 毎月10日・20日' })}
      <div class="grid2">${fld({ path: 'project.startTime', label: '開始時刻', req: true, type: 'time' })}${fld({ path: 'project.endTime', label: '終了時刻', req: true, type: 'time' })}</div>
      <div class="sb-inline" data-out-box="hours"></div>
      <h4 class="sb-h">利用者向けの問い合わせ先</h4>
      <div class="sb-alert info">ここは<b>市のホームページなどで一般に公開</b>されます。電話・FAX・メールは、どれか1つでも構いません。</div>
      <div class="grid2">${fld({ path: 'project.pubTel', label: '電話', type: 'tel' })}${fld({ path: 'project.pubFax', label: 'FAX', type: 'tel' })}</div>
      <div class="grid2">${fld({ path: 'project.pubEmail', label: 'メール', type: 'email' })}${fld({ path: 'project.pubSns', label: 'SNS等（インスタグラム、Xなど）', ph: '@●●●' })}</div>`;
    case 'meal': return `
      ${fld({ path: 'project.food', label: '食材の調達方法', req: true, rows: 3, hint: 'どこから、どのように食材を集めるかを書きます。', ph: '例）可能な限り地域の方や商店からの寄付でまかない、一部は補助金で購入する。' })}
      ${fld({ path: 'project.menu', label: '食事の内容', req: true, rows: 3, hint: 'おおよそのメニューや、栄養バランスの考え方を書きます。原則、調理をします（パンやおにぎりだけは避けてください）。' })}
      ${fld({ path: 'project.fee', label: '利用者負担', req: true, rows: 2, hint: '中学生以下は無料が必須です。', ph: '例）中学生以下は無償。高校生以上は1食●●●円を徴収する。' })}
      ${fld({ path: 'project.other', label: '食事提供以外の取り組み（あれば）', rows: 3, hint: '宿題サポートなどの学習支援や、相談支援などを行う場合に書きます。', ph: '例）自主学習の見守り、相談しやすい雰囲気づくり' })}`;
    case 'ideas': return `
      <p class="sb-help">審査では、事業の目的・取り組み内容・予算・安全性・継続性・活動実績が見られます。ヒントを参考に、具体的に書きましょう。</p>
      ${fld({ path: 'project.safety', label: '安全管理の考え方', req: true, rows: 5, hint: '次のようなことを書きます：<br>・保健所の指導などに基づく、食品衛生の安全管理<br>・子どもの帰宅時の対応方法<br>・万一の事故に備えた保険への加入' })}
      ${fld({ path: 'project.outreach', label: '情報発信の考え方', req: true, rows: 4, hint: '事業を必要としている子どもや世帯に、どうやって情報を届けるかを書きます。（学校・地域・SNS・チラシなど）' })}
      ${fld({ path: 'project.sustain', label: '事業の継続に関する考え方', req: true, rows: 4, hint: '続けていくために、スタッフやボランティアをどう確保していくかなどを書きます。' })}
      ${fld({ path: 'project.track', label: '団体の活動実績', req: true, rows: 4, hint: '子ども食堂に限らず、これまで団体で取り組んできた活動を書きます。' })}
      ${fld({ path: 'project.free', label: '自由記入（あれば）', rows: 3, hint: 'より効果のある事業にするために力を入れることや、特色ある取り組みなどがあれば書きます。' })}`;
    case 'schedule': {
      const qf = draft.ui.qf;
      return `
        <p>月ごとの開催回数と、開催日を入れます。<b>1か所につき1週間に1回まで</b>が数えられる回数です（週に2回開いても1回）。月の上限は5回です。年度の途中から始める場合は、始める前の月は0回にします。</p>
        <div class="sb-quick"><b>かんたん入力</b>
          <div class="sb-quickrow">
            <label>いつから <select data-qf="start">${MONTHS.map(m => `<option value="${m}"${Number(qf.start) === m ? ' selected' : ''}>${m}月</option>`).join('')}</select></label>
            <label>月に <select data-qf="per">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${Number(qf.per) === n ? ' selected' : ''}>${n}回</option>`).join('')}</select></label>
            <input type="text" data-qf="text" value="${esc(qf.text)}" placeholder="開催日（例：第2・4金曜日に夕食の提供）">
            <button type="button" class="sb-btn" data-act="fillSchedule">この内容で全部の月を埋める</button>
          </div></div>
        <table class="sb-table sb-sched"><thead><tr><th>月</th><th>回数</th><th>開催日・内容</th></tr></thead><tbody>
          ${MONTHS.map(m => `<tr><td>${m}月</td><td><select data-bind="schedule.m${m}.count" data-num>${[0, 1, 2, 3, 4, 5].map(n => `<option value="${n}"${Number(getPath(draft, `schedule.m${m}.count`) || 0) === n ? ' selected' : ''}>${n}回</option>`).join('')}</select></td>
            <td><input type="text" data-bind="schedule.m${m}.note" value="${esc(getPath(draft, `schedule.m${m}.note`))}" placeholder="例）●日(■)・●日(■)に開催"></td></tr>`).join('')}
        </tbody></table>
        <div class="sb-total"><span>年間の実施予定回数（補助対象）</span><b>${out('total')}</b></div>
        <div class="sb-inline">上半期（4〜9月）<b>${out('first')}</b>　下半期（10〜3月）<b>${out('second')}</b></div>`;
    }
    case 'amount': return `
      <div class="sb-inline">区分：<b>${out('tier')}</b>　1回あたり：<b>${out('unit')}</b>　年間の回数：<b>${out('total')}</b></div>
      <div class="field sb-field"><label>初めて補助金を受ける団体ですか？<span class="sb-req">必須</span></label><div class="sb-help">初めての年だけ、初期経費（最大10万円）が受けられます。2年目以降は対象外です。</div>${radios('money.first', [['yes', 'はい（初めて）'], ['no', 'いいえ（2年目以降）']])}</div>
      ${selectField({ path: 'money.enrich', label: '充実経費を希望しますか？', options: ENRICH_OPTIONS.map(n => [n, n ? '1回あたり ' + yen(n) : '0円（希望しない）']), blank: '', hint: '希望すると、1回あたり最大5,000円が上乗せされます。使い道と成果を毎月報告する必要があります。充実経費だけで申請することはできません。' })}
      <div class="sb-total"><span>申請する補助額（合計）</span><b>${out('grand')}</b></div>
      <table class="sb-table"><tbody>
        <tr><th>(1) 運営経費</th><td>${out('operatingCalc')}</td><td class="sb-r">${out('operating')}</td></tr>
        <tr><th>(2) 初期経費</th><td>新たに補助金を受ける団体のみ</td><td class="sb-r">${out('initial')}</td></tr>
        <tr><th>(3) 充実経費</th><td>${out('enrichCalc')}</td><td class="sb-r">${out('enrichment')}</td></tr>
      </tbody></table>
      <div class="sb-alert info"><b>支払いの目安</b>（概算払い・2回）<br>上半期：${out('payFirst')}　下半期：${out('paySecond')}<br><span class="sb-fine">初期経費は上半期に含めた目安です。実際の支払い時期は、市の通知で確認してください。</span></div>
      <div class="sb-alert warn">これは<b>上限</b>です。実際に使った額（支出−収入）がこれより少ないと、その額が補助額になります。年度末に精算があり、開かなかった回の分は返還します。</div>`;
    case 'budget': return `
      <div class="sb-alert info">収入と支出の<b>合計を一致</b>させます。事業が終わったあとの実績報告では、<b>領収書が必ず必要</b>です（品目を書いてもらい、宛名は団体名に）。</div>
      <h4 class="sb-h">支出（補助の対象になる経費ごとに、予算の見積もりを入れます）</h4>
      <table class="sb-table sb-budget"><thead><tr><th>項目</th><th>予算額（円）</th><th>内訳（何にいくらか）</th></tr></thead><tbody>
        ${COSTS.map(c => `<tr><td>${esc(c.label)}<div class="sb-help">${esc(c.ex)}</div></td>
          <td><input type="number" min="0" inputmode="numeric" data-num data-bind="money.exp.${c.id}.amount" value="${esc(getPath(draft, `money.exp.${c.id}.amount`))}"></td>
          <td><input type="text" data-bind="money.exp.${c.id}.note" value="${esc(getPath(draft, `money.exp.${c.id}.note`))}" placeholder="例）米・野菜など 月●円×12回"></td></tr>`).join('')}
        <tr class="sb-sum"><td>支出 合計</td><td colspan="2">${out('expTotal')}</td></tr>
      </tbody></table>
      <h4 class="sb-h">収入</h4>
      <table class="sb-table sb-budget"><tbody>
        <tr><td>市補助金<div class="sb-help">「もらえる金額」の合計が自動で入ります</div></td><td colspan="2"><b>${out('grand')}</b></td></tr>
        <tr><td>参加費<div class="sb-help">高校生以上の参加者からの徴収金</div></td><td><input type="number" min="0" inputmode="numeric" data-num data-bind="money.fee" value="${esc(draft.money.fee)}"></td><td><input type="text" data-bind="money.feeNote" value="${esc(draft.money.feeNote)}" placeholder="例）1食●円 × 人数"></td></tr>
        <tr><td>団体自己資金など</td><td><input type="number" min="0" inputmode="numeric" data-num data-bind="money.own" value="${esc(draft.money.own)}"></td><td><input type="text" data-bind="money.ownNote" value="${esc(draft.money.ownNote)}" placeholder="例）会費・寄付金"></td></tr>
        <tr class="sb-sum"><td>収入 合計</td><td colspan="2">${out('incomeTotal')}</td></tr>
      </tbody></table>
      <div data-balance></div>
      <p><button type="button" class="sb-btn ghost" data-act="balanceOwn">差額を「団体自己資金」に自動で入れる</button></p>`;
    case 'roster': {
      const rows = draft.roster.officers;
      return `
        <div class="sb-alert info"><b>「代表」「会計」「会計監査」は必ず置きます。</b>会計と会計監査を、同じ人が兼ねることはできません。</div>
        <table class="sb-table sb-roster"><thead><tr><th>役職</th><th>氏名</th><th>住所</th><th>電話番号</th><th></th></tr></thead><tbody>
          ${rows.map((r, k) => `<tr>
            <td><select data-bind="roster.officers.${k}.role">${ROLES.map(x => `<option${r.role === x ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
            <td><input type="text" data-bind="roster.officers.${k}.name" value="${esc(r.name)}"></td>
            <td><input type="text" data-bind="roster.officers.${k}.address" value="${esc(r.address)}" placeholder="枚方市…"></td>
            <td><input type="tel" data-bind="roster.officers.${k}.tel" value="${esc(r.tel)}"></td>
            <td>${rows.length > 4 ? `<button type="button" class="sb-x" data-act="delOfficer:${k}" aria-label="この行を削除">✕</button>` : ''}</td></tr>`).join('')}
        </tbody></table>
        <p>${rows.length < 10 ? '<button type="button" class="sb-btn ghost" data-act="addOfficer">＋ 役員を追加（最大10人）</button> ' : ''}<button type="button" class="sb-btn ghost" data-act="fillRep">代表者の情報を「代表」の行に入れる</button></p>
        <h4 class="sb-h">食品衛生責任者</h4>
        <div class="sb-help">調理する人の中に置きます。栄養士・調理師以外でも、なれる場合があります。詳しくは保健所に確認してください。</div>
        <div class="grid2">${fld({ path: 'roster.hyg.name', label: '氏名', req: true })}${fld({ path: 'roster.hyg.tel', label: '電話番号', req: true, type: 'tel' })}</div>
        <div class="field sb-field"><label>資格等（あてはまるものにチェック）</label>
          ${chk('roster.hyg.q1', '栄養士')}${chk('roster.hyg.q2', '調理師')}${chk('roster.hyg.q3', '食品衛生責任者養成講習会 受講者')}${chk('roster.hyg.q4', 'その他')}
          <input type="text" data-bind="roster.hyg.qtext" value="${esc(getPath(draft, 'roster.hyg.qtext'))}" placeholder="その他の内容"></div>
        <div class="sb-alert info">講習をこれから受ける場合、受講料は補助対象経費（「食品衛生責任者となるための講習の受講料」）です。収支予算書に入れられます。</div>`;
    }
    case 'pledge': return `
      <p>次の3つに間違いがないことを誓約します。（様式第5号）</p>
      ${chk('pledge.p1', '主に政治活動または宗教活動を行うことを目的としていないこと。')}
      ${chk('pledge.p2', '活動内容が公の秩序または善良の風俗に反するものでないこと。')}
      ${chk('pledge.p3', '暴力団または暴力団と密接な関係のある団体でないこと。')}`;
    case 'output': return `<div data-validation></div>
      <h4 class="sb-h">提出する書類</h4>
      <div data-docs></div>
      <div class="sb-alert warn"><b>提出の前に</b>：①市へ事前相談をしましたか？　②最新の様式・募集要項と見比べましたか？（市の様式が更新されることがあります）　③提出先：${esc(OFFICE.dept)}（${esc(OFFICE.zip)} ${esc(OFFICE.address)}／${esc(OFFICE.email)}）へ、<b>メール・郵送・持参</b>のいずれかで。提出した書類は返却されません。</div>
      <div class="sb-actions">
        <button type="button" class="sb-btn" data-act="preview">📄 書類をプレビュー・印刷する</button>
        <button type="button" class="sb-btn ghost" data-act="previewBylaws">会則（例）もいっしょに</button>
      </div>
      <p class="sb-fine">印刷の画面で「PDFに保存」を選ぶと、メールで送れるPDFになります。会則は団体ごとに作るものなので、例文を参考に団体に合わせて直してください。</p>
      <h4 class="sb-h">この端末のデータ</h4>
      <div class="sb-actions">
        <button type="button" class="sb-btn ghost" data-act="export">下書きをファイルに保存</button>
        <label class="sb-btn ghost sb-file">ファイルから読み込む<input type="file" accept="application/json,.json" data-import hidden></label>
        <button type="button" class="sb-btn danger" data-act="reset">入力をすべて消す</button>
      </div>
      <p class="sb-fine">入力した内容は、サーバーには送られず、この端末のブラウザの中にだけ保存されています。別の端末で続きを書くときは、「ファイルに保存」→「読み込む」を使ってください。</p>`;
    default: return '';
  }
}

// ---------------------------------------------------------------- 描画の本体
export function renderSubsidyTab(){
  const root = document.createElement('div'); root.className = 'subsidy-root';
  currentRoot = root;
  paint(root);
  bindEvents(root);
  return root;
}
function paint(root){
  const v = draft.ui.view;
  root.innerHTML = headerHtml() + navHtml() + `<div class="sb-body">${v === 'know' ? knowHtml() : v === 'sim' ? simHtml() : wizardHtml()}</div>`;
  refresh(root);
}
function rerender(){ if(currentRoot){ const y = window.scrollY; paint(currentRoot); window.scrollTo(0, y); } }
function toTop(){ if(currentRoot){ const r = currentRoot.getBoundingClientRect(); window.scrollTo({ top: window.scrollY + r.top - 8 }); } }

// 入力のたびに、計算結果・チェック結果の表示だけを更新する（入力欄は作り直さない＝フォーカスを保つ）
function refresh(root){
  if(!root) return;
  const c = calcAll(draft);
  const tierText = c.t ? `${c.t.id}区分（${c.t.label}）` : (Number(draft.project.meals) > 0 ? '対象外（10食未満）' : '—');
  const values = {
    tier: tierText, unit: c.t ? yen(c.unit) : '—',
    total: `${c.total}回`, first: `${c.first}回`, second: `${c.second}回`,
    operating: yen(c.operating), operatingCalc: c.t ? `${c.total}回 × ${yen(c.unit)}（${c.t.id}区分）` : '準備食数を入れると計算されます',
    initial: yen(c.initial), enrichment: yen(c.enrichment), enrichCalc: c.enrich ? `${c.total}回 × ${yen(c.enrich)}` : '希望しない',
    grand: yen(c.grand), payFirst: yen(c.payFirst), paySecond: yen(c.paySecond),
    expTotal: yen(c.expTotal), incomeTotal: yen(c.incomeTotal),
  };
  root.querySelectorAll('[data-out]').forEach(el => { const k = el.getAttribute('data-out'); if(k in values) el.textContent = values[k]; });
  const bal = root.querySelector('[data-balance]');
  if(bal){
    bal.className = 'sb-alert ' + (c.diff === 0 && c.expTotal > 0 ? 'ok' : 'warn');
    bal.textContent = c.expTotal <= 0 ? '支出の予算を入れると、収入との差額を確認できます。'
      : c.diff === 0 ? '✓ 収入と支出が一致しています。'
      : c.diff > 0 ? `支出が ${yen(c.diff)} 多いです。参加費や団体自己資金などの収入を増やすか、支出を見直してください。`
      : `収入が ${yen(-c.diff)} 多いです。補助金は実際に使う額が上限のため、支出を増やすか、収入を見直してください。`;
  }
  const dnote = root.querySelector('[data-district-note]');
  if(dnote){
    const d = draft.project.district, n = SHOKUDO_BASELINE[d] || 0;
    dnote.innerHTML = !d ? '' : n > 0
      ? `<div class="sb-alert warn">${esc(d)}校区には、すでに子ども食堂の実施団体が${n}団体あります（市の一覧・${SHOKUDO_AS_OF}）。新しく始める場合は原則、対象外です。ただし状況によっては対象になることもあるので、事前相談で確認しましょう。</div>`
      : `<div class="sb-alert ok">${esc(d)}校区は、市の一覧（${SHOKUDO_AS_OF}）に実施団体がない校区です。</div>`;
  }
  const hrs = root.querySelector('[data-out-box="hours"]');
  if(hrs){ const h = durationHours(draft.project.startTime, draft.project.endTime); hrs.textContent = h == null ? '' : `実施時間：${h}時間${h < 2 ? '（原則2時間以上が必要です）' : ''}`; hrs.classList.toggle('warn', h != null && h < 2); }
  const sim = root.querySelector('[data-sim-result]'); if(sim) sim.innerHTML = simResultHtml();
  const val = root.querySelector('[data-validation]'); if(val) val.innerHTML = validationHtml();
  const docs = root.querySelector('[data-docs]'); if(docs) docs.innerHTML = docsHtml();
}
function validationHtml(){
  const V = validate(draft);
  const errs = V.filter(x => x.level === 'error'), warns = V.filter(x => x.level === 'warn');
  if(!V.length) return `<div class="sb-alert ok"><b>✓ 入力に、足りないところは見つかりませんでした。</b>プレビューで内容を確認し、印刷（PDF保存）して提出の準備をしましょう。</div>`;
  const li = x => `<li><button type="button" class="sb-jump" data-act="step:${x.step}">${STEPS[x.step].short}</button> ${esc(x.text)}</li>`;
  return `${errs.length ? `<div class="sb-alert err"><b>直すところが ${errs.length} 件あります</b><ul>${errs.map(li).join('')}</ul></div>` : ''}
    ${warns.length ? `<div class="sb-alert warn"><b>確認してほしいところが ${warns.length} 件あります</b><ul>${warns.map(li).join('')}</ul></div>` : ''}
    <p class="sb-fine">未入力のままでも、プレビュー・印刷はできます（空欄のまま出力されます）。</p>`;
}
function docsHtml(){
  const V = validate(draft).filter(x => x.level === 'error');
  const rows = DOCS.map(d => {
    const n = V.filter(x => d.steps.includes(x.step)).length;
    return `<li class="${n ? 'todo' : 'ok'}"><span>${n ? `要入力 ${n}件` : '✓ 入力OK'}</span>${esc(d.label)}</li>`;
  });
  rows.push(`<li class="manual"><span>ご自身で用意</span>実施団体会則（例文あり）</li>`);
  return `<ul class="sb-docs">${rows.join('')}</ul>`;
}

// ---------------------------------------------------------------- イベント
function bindEvents(root){
  const onInput = e => {
    const t = e.target;
    if(t.matches('[data-qf]')){ draft.ui.qf[t.getAttribute('data-qf')] = t.value; saveDraft(); return; }
    if(!t.matches('[data-bind]')) return;
    const path = t.getAttribute('data-bind');
    let v;
    if(t.type === 'checkbox') v = t.checked;
    else if(t.type === 'radio'){ if(!t.checked) return; v = t.value; }
    else if(t.hasAttribute('data-num')) v = t.value === '' ? '' : Number(t.value);
    else v = t.value;
    setPath(draft, path, v);
    saveDraft();
    refresh(root);
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', e => {
    onInput(e);
    if(e.target.matches('[data-import]')) importDraft(e.target);
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if(!t) return;
    act(t.getAttribute('data-act'), t);
  });
}

function act(a){
  const [name, arg] = a.split(':');
  const goto = n => { draft.ui.step = intIn(n, 0, STEPS.length - 1); draft.ui.view = 'wizard'; saveDraft(); rerender(); toTop(); };
  switch(name){
    case 'view': draft.ui.view = arg; saveDraft(); rerender(); toTop(); break;
    case 'step': goto(arg); break;
    case 'next': goto(draft.ui.step + 1); break;
    case 'prev': goto(draft.ui.step - 1); break;
    case 'simToWizard': {
      const s = draft.sim;
      draft.project.meals = Number(s.meals) || '';
      draft.money.first = s.first; draft.money.enrich = Number(s.enrich) || 0;
      const idx = Math.max(0, MONTHS.indexOf(Number(s.start)));
      MONTHS.forEach((m, i) => setPath(draft, `schedule.m${m}.count`, i >= idx ? intIn(s.per, 0, MAX_PER_MONTH) : 0));
      draft.ui.step = S.org; draft.ui.view = 'wizard'; saveDraft(); rerender(); toTop(); break;
    }
    case 'fillSchedule': {
      const qf = draft.ui.qf, idx = Math.max(0, MONTHS.indexOf(Number(qf.start)));
      MONTHS.forEach((m, i) => { setPath(draft, `schedule.m${m}.count`, i >= idx ? intIn(qf.per, 0, MAX_PER_MONTH) : 0); setPath(draft, `schedule.m${m}.note`, i >= idx ? qf.text : ''); });
      saveDraft(); rerender(); break;
    }
    case 'balanceOwn': {
      const c = calcAll(draft);
      draft.money.own = Math.max(0, c.expTotal - c.grand - c.fee);
      saveDraft(); rerender(); break;
    }
    case 'addOfficer': if(draft.roster.officers.length < 10){ draft.roster.officers.push({ role: '理事', name: '', address: '', tel: '' }); saveDraft(); rerender(); } break;
    case 'delOfficer': draft.roster.officers.splice(Number(arg), 1); saveDraft(); rerender(); break;
    case 'fillRep': {
      const r = draft.roster.officers.find(x => x.role === '代表') || draft.roster.officers[0];
      if(r){ r.name = draft.org.repName || r.name; r.address = draft.org.repAddress || r.address; saveDraft(); rerender(); }
      break;
    }
    case 'preview': openPreview(false); break;
    case 'previewBylaws': openPreview(true); break;
    case 'export': exportDraft(); break;
    case 'reset':
      if(confirm('入力した内容をすべて消します。よろしいですか？（元に戻せません）')){ draft = defaultDraft(); saveDraft(); rerender(); toTop(); }
      break;
    case 'adminSave': adminSave(); break;
  }
}
async function adminSave(){
  const g = id => (document.getElementById(id) || {}).value || '';
  const next = { pdfUrl: g('sbPdfUrl').trim(), pageUrl: g('sbPageUrl').trim(), note: g('sbNote').trim() };
  const msg = document.getElementById('sbAdminMsg');
  if((next.pdfUrl && !safeUrl(next.pdfUrl)) || (next.pageUrl && !safeUrl(next.pageUrl))){ if(msg) msg.textContent = 'URLは https:// から始まる形式で入力してください'; return; }
  try{
    await host.saveMeta(next);
    setSubsidyMeta(next);
    const hero = currentRoot && currentRoot.querySelector('.sb-hero');
    if(hero) hero.outerHTML = headerHtml();
    if(msg) msg.textContent = '登録しました';
  }catch(e){
    if(msg) msg.textContent = '登録できませんでした。firestore.rulesの更新（subsidyPrograms）が反映されているか確認してください';
  }
}

// ---------------------------------------------------------------- 下書きのファイル入出力
function exportDraft(){
  const blob = new Blob([JSON.stringify({ kind: 'attaka-subsidy-draft', version: 1, draft }, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = '子ども食堂_補助金申請_下書き.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importDraft(input){
  const f = input.files && input.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try{
      const j = JSON.parse(r.result);
      if(j.kind !== 'attaka-subsidy-draft' || !j.draft) throw new Error('形式が違います');
      draft = deepMerge(defaultDraft(), j.draft); saveDraft(); rerender(); alert('読み込みました');
    }catch(e){ alert('読み込めませんでした。このアプリで保存したファイルを選んでください。'); }
  };
  r.readAsText(f);
  input.value = '';
}

// ---------------------------------------------------------------- 書類プレビュー・印刷
function openPreview(withBylaws){
  let area = document.getElementById('subsidyPrint');
  if(!area){ area = document.createElement('div'); area.id = 'subsidyPrint'; document.body.appendChild(area); }
  area.innerHTML = `<div class="ps-toolbar">
      <b>書類プレビュー</b><span>下の内容を確認して、印刷またはPDFに保存してください</span>
      <button type="button" class="sb-btn" data-pact="print">印刷 / PDFに保存</button>
      <button type="button" class="sb-btn ghost" data-pact="close">閉じる</button></div>` + buildPrint(draft, withBylaws);
  document.body.classList.add('sb-preview');
  area.scrollTop = 0;
  area.onclick = e => {
    const t = e.target.closest('[data-pact]'); if(!t) return;
    if(t.getAttribute('data-pact') === 'close'){ document.body.classList.remove('sb-preview'); area.innerHTML = ''; }
    else window.print();
  };
}

const blankOr = (s, w = 10) => s ? esc(s) : '&nbsp;'.repeat(w);
function psTable(rows){ return `<table class="ps-table">${rows.join('')}</table>`; }
function orgBlock(d){
  return `<div class="ps-sign"><div>団 体 名　<u>${blankOr(d.org.name, 24)}</u></div><div>代表者住所　<u>${blankOr(d.org.repAddress, 24)}</u></div><div>代表者氏名　<u>${blankOr(d.org.repName, 24)}</u></div></div>`;
}
function dateLine(iso){ const t = jpDate(iso); return `<div class="ps-right">令和 ${t.era || '　　'} 年 ${t.m || '　　'} 月 ${t.d || '　　'} 日</div>`; }
function buildPrint(d, withBylaws){
  const c = calcAll(d), p = d.project, o = d.org;
  const y = PROGRAM.year;
  const title = (t) => `<div class="ps-t1">令和${y}年度　子どもの居場所づくり推進事業</div><div class="ps-t2">${t}</div>`;
  const start = jpDate(p.startDate);
  const tierText = c.t ? `${c.t.id}（${c.t.label}）` : '';
  const hours = (p.startTime || p.endTime) ? `${jpTime(p.startTime)}頃 ～ ${jpTime(p.endTime)}頃` : '';
  const boxRow = (label, body) => `<tr><th>${label}</th><td>${body}</td></tr>`;
  const pages = [];

  // 様式第1号
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第１号）</div>${dateLine(o.applyDate)}<div class="ps-to">枚 方 市 長</div>${orgBlock(d)}
    ${title('実施団体認定申込書')}
    <p class="ps-body">令和${y}年度、枚方市子どもの居場所づくり推進事業を実施したいので、実施団体の認定を申し込みます。</p>
    <div class="ps-center">記</div>
    <div class="ps-h">◎添付書類</div>
    <ul class="ps-list"><li>事業計画書（様式第２号）</li><li>収支予算書（様式第３号）</li><li>実施団体役員名簿（様式第４号）</li><li>誓約書（様式第５号）</li><li>補助金交付申込書（様式第６号）</li><li>実施団体会則</li></ul>
    <div class="ps-h">【団体の連絡先】</div>
    ${psTable([boxRow('連絡担当者', blankOr(o.contactPerson)), boxRow('書類等送付先', `（〒${blankOr(o.zip, 4)}）　${blankOr(o.sendAddress, 4)}`), boxRow('電話・ＦＡＸ', `電話 ${blankOr(o.tel, 4)}　　ＦＡＸ ${blankOr(o.fax, 4)}`), boxRow('Ｅ－ＭＡＩＬ', blankOr(o.email))])}
  </section>`);

  // 様式第2号（1）事業の内容
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第２号）</div>${title('事 業 計 画 書')}
    <div class="ps-center ps-big">団体名（ ${blankOr(o.name, 12)} ）</div>
    <div class="ps-h">１．事業の内容</div>
    ${psTable([
      boxRow('①事業の目的', `${p.purposeConsent ? '☑' : '□'} 家で1人で食事をとる、夜遅くまで1人で過ごすといった環境にあるなど、家庭的に様々な課題のある子どもたちが、食事の提供を通じ、地域で安心して過ごせるための居場所づくりに取り組みます。<hr class="ps-dot">${nl(p.purposeText) || '&nbsp;'}`),
      boxRow('②取り組みの内容', `<ol class="ps-items">
        <li>事業の名称　（ ${blankOr(p.name, 8)} ）</li>
        <li>スタッフ数　（ 約 ${blankOr(p.staffCount, 3)} 人）</li>
        <li>実施場所　利用施設名 ${blankOr(p.venueName, 6)}　利用施設住所 ${blankOr(p.venueAddress, 6)}　小学校区 ${p.district ? esc(p.district) + '校区' : '&nbsp;'.repeat(4)}${p.district2 ? '、' + esc(p.district2) + '校区' : ''}</li>
        <li>準備食数（区分と食数）　区分：${blankOr(tierText, 4)}　実施1回の子どもへの準備食数（ ${blankOr(p.meals, 3)} 食）</li>
        <li>利用定員（1回あたり）（ 約 ${blankOr(p.capacity, 3)} 人）</li>
        <li>事業開始（予定）日　令和${start.era || '　'}年${start.m || '　'}月${start.d || '　'}日</li>
        <li>実施日　${blankOr(p.dayText, 8)}</li>
        <li>実施時間　${blankOr(hours, 8)}</li>
        <li>利用者等からの問い合わせ先（市ホームページなど公開用）<br>電話：${blankOr(p.pubTel, 3)}　FAX：${blankOr(p.pubFax, 3)}　Eメール：${blankOr(p.pubEmail, 3)}　SNS等：${blankOr(p.pubSns, 3)}</li></ol>`)])}
  </section>`);

  // 様式第2号（2）取り組みの内容（続き）
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第２号）</div>
    ${psTable([
      boxRow('②取り組みの内容<br><small>（前ページの続き）</small>', `<div class="ps-sub"><b>１０．食材の調達方法</b><div>${nl(p.food) || '&nbsp;'}</div></div><div class="ps-sub"><b>１１．食事の内容</b><div>${nl(p.menu) || '&nbsp;'}</div></div><div class="ps-sub"><b>１２．利用者負担</b><div>${nl(p.fee) || '&nbsp;'}</div></div><div class="ps-sub"><b>１３．食事提供以外の取り組み</b><div>${nl(p.other) || '&nbsp;'}</div></div>`),
      boxRow('③安全管理の考え方', nl(p.safety) || '&nbsp;'), boxRow('④情報発信の考え方', nl(p.outreach) || '&nbsp;'),
      boxRow('⑤事業の継続に関する考え方', nl(p.sustain) || '&nbsp;'), boxRow('⑥団体の活動実績', nl(p.track) || '&nbsp;'),
      boxRow('⑦自由記入<br><small>（その他提案等があれば）</small>', nl(p.free) || '&nbsp;')])}
  </section>`);

  // 様式第2号（3）スケジュールと申請補助額
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第２号）</div>
    <div class="ps-h">２．実施のスケジュール</div>
    <table class="ps-table ps-sched"><tr><th>月</th><th>実施予定回数</th><th>実施の概要</th></tr>
      ${MONTHS.map((m, i) => `<tr><td>${m}月</td><td>${c.counts[i]} 回</td><td>${esc(getPath(d, `schedule.m${m}.note`) || '')}</td></tr>`).join('')}</table>
    <p class="ps-right">実施予定回数（補助対象となる回数：週１回が上限）の年度合計　<u>&nbsp;${c.total}&nbsp;</u> 回・・・・①</p>
    <div class="ps-h">３．計画に基づく申請補助額</div>
    <table class="ps-table ps-amt">
      <tr><th>運営経費</th><td>金 ${c.operating.toLocaleString('ja-JP')} 円 ・・・（１）</td><td class="ps-small">${c.t ? `${c.total}回 × ${c.unit.toLocaleString('ja-JP')}円（${c.t.id}区分）` : ''}</td></tr>
      <tr><th>初期経費<br><small>（新たに補助金の交付を受ける団体のみ）</small></th><td>金 ${c.initial.toLocaleString('ja-JP')} 円 ・・・（２）</td><td class="ps-small">上限100,000円</td></tr>
      <tr><th>充実経費<br><small>（希望する団体のみ）</small></th><td>金 ${c.enrichment.toLocaleString('ja-JP')} 円 ・・・（３）</td><td class="ps-small">${c.enrich ? `${c.total}回 × ${c.enrich.toLocaleString('ja-JP')}円` : '希望しない'}</td></tr>
      <tr><th>合計（１）＋（２）＋（３）</th><td colspan="2"><b>金 ${c.grand.toLocaleString('ja-JP')} 円</b></td></tr></table>
  </section>`);

  // 様式第3号
  const expRows = COSTS.map(x => `<tr><td>${esc(x.label)}</td><td class="ps-r">${(Number(getPath(d, `money.exp.${x.id}.amount`)) || 0).toLocaleString('ja-JP')}円</td><td>${esc(getPath(d, `money.exp.${x.id}.note`) || '')}</td></tr>`).join('');
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第３号）</div>${title('収 支 予 算 書')}
    <div class="ps-center ps-big">団体名（ ${blankOr(o.name, 12)} ）</div>
    <div class="ps-h">１．収 入</div>
    <table class="ps-table"><tr><th>項 目</th><th>予算額</th><th>内 訳</th></tr>
      <tr><td>市補助金</td><td class="ps-r">${c.grand.toLocaleString('ja-JP')}円</td><td>運営経費・初期経費・充実経費の合計</td></tr>
      <tr><td>参加費（高校生以上の参加者からの徴収金）</td><td class="ps-r">${c.fee.toLocaleString('ja-JP')}円</td><td>${esc(d.money.feeNote || '')}</td></tr>
      <tr><td>団体自己資金など</td><td class="ps-r">${c.own.toLocaleString('ja-JP')}円</td><td>${esc(d.money.ownNote || '')}</td></tr>
      <tr class="ps-sum"><td>合 計</td><td class="ps-r">${c.incomeTotal.toLocaleString('ja-JP')}円</td><td></td></tr></table>
    <div class="ps-h">２．支 出</div>
    <table class="ps-table"><tr><th>項 目</th><th>予算額</th><th>内 訳</th></tr>${expRows}
      <tr class="ps-sum"><td>合 計</td><td class="ps-r">${c.expTotal.toLocaleString('ja-JP')}円</td><td></td></tr></table>
    <p class="ps-small">事業終了後の実績報告時には、領収書が必要です。何の経費か品目が分かるようにし、宛名は団体名にしてください。</p>
  </section>`);

  // 様式第4号
  const off = d.roster.officers || [], h = d.roster.hyg || {};
  const offRows = Array.from({ length: 10 }, (_, k) => { const r = off[k] || {}; return `<tr><td>${blankOr(r.name, 4)}</td><td>${blankOr(r.address, 4)}</td><td>${blankOr(r.tel, 4)}</td><td>${blankOr(r.name ? r.role : '', 2)}</td></tr>`; }).join('');
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第４号）</div><div class="ps-t1">枚方市子どもの居場所づくり推進事業</div><div class="ps-t2">実施団体役員名簿</div>
    <div class="ps-center ps-big">団体名（ ${blankOr(o.name, 12)} ）</div>
    <table class="ps-table ps-roster"><tr><th>氏名</th><th>住所</th><th>電話番号</th><th>役職 ※</th></tr>${offRows}</table>
    <p class="ps-small">※役職は代表、会計、会計監査を必ず置くこと。ただし会計と会計監査を兼ねることは不可。</p>
    <div class="ps-h">食品衛生責任者</div>
    <table class="ps-table"><tr><th>氏名</th><th>電話番号</th><th>資格等（該当項目に〇）</th></tr>
      <tr><td>${blankOr(h.name, 6)}</td><td>${blankOr(h.tel, 6)}</td><td>${h.q1 ? '☑' : '□'}栄養士　${h.q2 ? '☑' : '□'}調理師<br>${h.q3 ? '☑' : '□'}食品衛生責任者養成講習会受講者<br>${h.q4 ? '☑' : '□'}その他（${esc(h.qtext || '')}）</td></tr></table>
  </section>`);

  // 様式第5号
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第５号）</div><div class="ps-t2">誓 約 書</div>${dateLine(o.applyDate)}<div class="ps-to">枚 方 市 長</div>${orgBlock(d)}
    <p class="ps-body">私は、令和${y}年度枚方市子どもの居場所づくり推進事業補助金の実施団体の認定を受けるにあたり、下記の事項に相違ないことを誓約します。</p>
    <div class="ps-center">記</div>
    <ol class="ps-pledge"><li>主に政治活動又は宗教活動を行うことを目的としていないこと。</li><li>活動内容が公の秩序又は善良の風俗に反するものでないこと。</li><li>暴力団又は暴力団と密接な関係のある団体でないこと。</li></ol>
  </section>`);

  // 様式第6号（日付は空欄で提出）
  pages.push(`<section class="ps-page"><div class="ps-no">（様式第６号）</div>${dateLine('')}<div class="ps-to">枚 方 市 長</div>${orgBlock(d)}
    ${title('補助金交付申込書')}
    <p class="ps-body">枚方市子どもの居場所づくり推進事業補助金交付要綱に基づく補助金の交付を受けたいので、枚方市補助金等交付規則に基づき、交付を申し込みます。</p>
    <div class="ps-center">記</div>
    <div class="ps-h">◎申請補助額</div>
    <table class="ps-table ps-amt"><tr><th>運営経費</th><td>金 ${c.operating.toLocaleString('ja-JP')} 円</td></tr>
      <tr><th>初期経費<br><small>（新たに補助金の交付を受ける団体のみ）</small></th><td>金 ${c.initial.toLocaleString('ja-JP')} 円</td></tr>
      <tr><th>充実経費</th><td>金 ${c.enrichment.toLocaleString('ja-JP')} 円</td></tr>
      <tr><th>合計額</th><td><b>金 ${c.grand.toLocaleString('ja-JP')} 円</b></td></tr></table>
  </section>`);

  if(withBylaws) pages.push(`<section class="ps-page ps-bylaws">${bylawsHtml(o.name)}</section>`);
  return pages.join('');
}

// 会則（例）。申込書類づくり用ブックの例文をもとに、団体名だけ差し込む。団体に合わせて直して使う。
function bylawsHtml(name){
  const n = name ? esc(name) : '○○○';
  return `<div class="ps-t2">${n}　会則（例）</div>
    <p class="ps-small">※これは例文です。団体の実情に合わせて書き直してください。</p>
    <h5>（名称）</h5><p>第１条　この会は、${n}（以下「本会」という。）と称する。</p>
    <h5>（目的）</h5><p>第２条　本会は、食の提供等を通して子どもたちが安心して過ごせる居場所づくりを行うことで、地域で子どもを見守る環境をつくることを目的とする。</p>
    <h5>（事業）</h5><p>第３条　本会は、第２条に規定する目的を達成するために次の事業を行う。<br>　（１）子どもへの食の提供等を通じた居場所づくり<br>　（２）その他目的達成のために必要な事業</p>
    <h5>（会員）</h5><p>第４条　本会の会員は、この会の目的に賛同し、参加する者とする。</p>
    <h5>（役員の構成及び任期）</h5><p>第５条　本会に次の役員を置く。役員は会員の中から互選するものとする。<br>　（１）会長　１人　（２）副会長　１人　（３）会計　１人　（４）会計監査　１人<br>２　役員の任期は２年とする。ただし、再任を妨げない。</p>
    <h5>（役員の職務）</h5><p>第６条　会長は、本会を代表し、会務を総括する。<br>２　副会長は、会長を補佐し、会長に事故あるときはその職務を代理する。<br>３　会計は、本会の会計を担当する。<br>４　会計監査は、本会の会計経理を監査する。</p>
    <h5>（運営会議）</h5><p>第７条　本会の運営に関する重要な事項を審議決定するための運営会議を置き、会員の出席をもって開催する。<br>２　運営会議は会長が招集し、その議長となる。</p>
    <h5>（事業に関する実施規定）</h5><p>第８条　第３条に規定する事業の執行に関し必要な事項は、運営会議の議決を得て別に定める。</p>
    <h5>（会計）</h5><p>第９条　本会の経費は、補助金その他の収入金をもって充てる。<br>２　本会の会計年度は、毎年４月１日に始まり翌年３月３１日に終わる。<br>３　前項の会計年度に係る決算終了後、監査を経て運営会議にて決算報告を行う。</p>
    <h5>（会則の改廃）</h5><p>第１０条　この会則を改廃しようとするときは、運営会議において同意を得なければならない。</p>
    <h5>（細則）</h5><p>第１１条　この会則に定めるもののほか、本会の運営上必要な事項は、運営会議において別に定める。</p>
    <h5>付　則</h5><p>この会則は、令和○○年○月○日から施行する。</p>`;
}
