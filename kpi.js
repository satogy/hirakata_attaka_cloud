// 実証実験のKPI（管理者用）：成立数・職員の対応時間・校区の可視化を、目標に対する進み具合で見る。
//
// KPI（市の実証実験の検証目標）
//   ① 寄附・支援マッチング成立数  目標40件以上（企業食材寄附・資材提供・ボランティアの自律成立）
//   ② 行政窓口の電話仲介コスト削減率  問い合わせ対応時間70%削減（個別手動調整のプラットフォーム自動化率）
//   ③ 支援不足校区の可視化率  市内44校区の100%可視化（子ども食堂未設置エリアのニーズ特定）
//
// 用語の定義（画面にも表示する。市と合意した定義に合わせて直すこと）
//   成立  = 当事者のどちらかが、チャットのやり取りのあとに「つながり成立にする」を押したもの
//   自律  = 成立のうち、コーディネーターが手動でつないだもの・職員が仲介したと記録されたもの以外
//   完了  = 成立したあと、当事者が「実施できた」と記録したもの（実際に届いた・手伝えた）
//   対応時間 = 職員が管理者画面の「対応ログ」に記録した、問い合わせ・仲介にかけた時間（分）
// 対応ログは職員だけが読み書きでき、個人名・連絡先は書かない運用にする。

import { computeDistrictRows, DISTRICTS } from './districts.js';

export const ORG_TYPES = ['個人', '企業・事業者', '団体・NPO', '子ども食堂', '学校・福祉施設等', '行政・関係機関'];
export const COMPANY = '企業・事業者';
export const DEFAULT_SETTINGS = { pilotStart: '', pilotEnd: '', targetMatches: 40, targetReductionPct: 70, baselineMinutesPerWeek: null };
const CATS = ['食材の寄付', '資材・物品の提供', 'ボランティア・お手伝い', '場所提供', 'その他'];
const CHANNELS = ['電話', 'メール', '窓口', 'アプリ（コーディネーター画面）', 'その他'];
const TOPICS = ['食材の寄付', '資材・物品', 'ボランティア', '場所提供', '補助金・開設相談', 'その他'];
const DAY = 86400000;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateOf = s => (s ? new Date(s + 'T00:00:00') : null);
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : null);

export const isAutonomous = m => m.connectedBy !== 'coordinator' && !m.staffAssisted;

function categoryOf(m, need){
  const kind = need ? need.kind : m.kind;
  if(kind === 'お手伝い') return 'ボランティア・お手伝い';
  if(kind === '場所提供') return '場所提供';
  if(kind === '寄付') return need && need.subcat === '食料' ? '食材の寄付' : '資材・物品の提供';
  return 'その他';
}

// 成立の集計。conns=管理者が読み込んだつながり（成立済みを含む）、settings=実証期間と目標
export function computeKpi({ listings, conns, listingById, logs, settings, districtInfo, now = Date.now() }){
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const start = dateOf(s.pilotStart), end = s.pilotEnd ? new Date(dateOf(s.pilotEnd).getTime() + DAY - 1) : null;
  const inPilot = ts => ts != null && (!start || ts >= start.getTime()) && (!end || ts <= end.getTime());

  // ① 成立
  const matched = conns.filter(m => m.status === 'connected' && inPilot(m.matchedAt || m.connectedAt || m.createdAt));
  const cat = Object.fromEntries(CATS.map(c => [c, { total: 0, auto: 0, assisted: 0, fulfilled: 0, company: 0 }]));
  matched.forEach(m => {
    const need = listingById(m.needId), offer = listingById(m.offerId);
    const c = cat[categoryOf(m, need)];
    c.total++; if(isAutonomous(m)) c.auto++; else c.assisted++;
    if(m.fulfilled) c.fulfilled++;
    if(offer && offer.orgType === COMPANY) c.company++;
  });
  const total = matched.length;
  const auto = matched.filter(isAutonomous).length;
  const fulfilled = matched.filter(m => m.fulfilled).length;
  const companyN = matched.filter(m => { const o = listingById(m.offerId); return o && o.orgType === COMPANY; }).length;

  // ② 職員の対応時間（分/週）：実証前（基準）と実証中を、週あたりに直して比べる
  const L = (logs || []);
  const before = start ? L.filter(l => dateOf(l.date) < start) : [];
  const during = start ? L.filter(l => { const d = dateOf(l.date).getTime(); return d >= start.getTime() && (!end || d <= end.getTime()); }) : [];
  const sumMin = a => a.reduce((t, l) => t + (Number(l.minutes) || 0), 0);
  let baselinePW = null, baselineSource = '';
  if(Number(s.baselineMinutesPerWeek) > 0){ baselinePW = Number(s.baselineMinutesPerWeek); baselineSource = '手入力'; }
  else if(before.length && start){
    const first = Math.min(...before.map(l => dateOf(l.date).getTime()));
    baselinePW = sumMin(before) / Math.max(1, (start.getTime() - first) / (7 * DAY));
    baselineSource = `対応ログ ${before.length}件`;
  }
  const pilotEndMs = end ? Math.min(end.getTime(), now) : now;
  const pilotWeeks = start ? Math.max(1, (pilotEndMs - start.getTime()) / (7 * DAY)) : null;
  const pilotPW = start && pilotWeeks ? sumMin(during) / pilotWeeks : null;
  const reduction = baselinePW > 0 && pilotPW !== null ? Math.round((1 - pilotPW / baselinePW) * 100) : null;

  // ③ 校区
  const { rows } = computeDistrictRows({ listings, conns, listingById, info: districtInfo });
  const served = rows.filter(r => r.shokudo > 0).length, active = rows.filter(r => r.needs + r.offers > 0).length;
  const needDistricts = rows.filter(r => r.status.cls === 'st-need').length;

  return { s, total, auto, assisted: total - auto, fulfilled, companyN, cat, baselinePW, baselineSource, pilotPW, pilotWeeks,
    pilotMin: sumMin(during), pilotLogs: during.length, baselineLogs: before.length, reduction,
    autoRate: pct(auto, total), districts: { total: DISTRICTS.length, served, active, needDistricts } };
}

const fmt1 = n => (n === null || n === undefined ? '-' : (Math.round(n * 10) / 10).toString());

// KPI画面（DOM要素）。ctx: computeKpiの引数 + onSaveSettings / onAddLog / onDeleteLog / exportCsv
export function renderKpiDashboard(ctx){
  const k = computeKpi(ctx);
  const s = k.s, target = Number(s.targetMatches) || 40, tgtRed = Number(s.targetReductionPct) || 70;
  const progress = Math.min(100, Math.round(k.total / target * 100));
  const bar = (v, max, cls) => `<div class="kpi-bar"><div class="kpi-fill ${cls}" style="width:${Math.min(100, max ? v / max * 100 : 0)}%"></div></div>`;
  const redOk = k.reduction !== null && k.reduction >= tgtRed;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="kpi-cards">
      <div class="kpi-card">
        <div class="kpi-h">① 寄附・支援マッチング成立数</div>
        <div class="kpi-big">${k.total}<small> / 目標${target}件</small></div>
        ${bar(k.total, target, k.total >= target ? 'ok' : '')}
        <div class="kpi-sub">達成率 ${progress}%　うち自律成立 ${k.auto}件（${k.autoRate === null ? '-' : k.autoRate + '%'}）／職員が仲介 ${k.assisted}件</div>
        <div class="kpi-sub">実施まで確認できた（完了）${k.fulfilled}件　うち企業からの提供 ${k.companyN}件</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-h">② 職員の問い合わせ対応時間</div>
        <div class="kpi-big">${k.reduction === null ? '-' : k.reduction + '%'}<small> 削減 / 目標${tgtRed}%</small></div>
        ${bar(Math.max(0, k.reduction || 0), tgtRed, redOk ? 'ok' : '')}
        <div class="kpi-sub">週あたり：実証前 ${fmt1(k.baselinePW)}分 → 実証中 ${fmt1(k.pilotPW)}分${k.baselineSource ? `（実証前は${esc(k.baselineSource)}）` : ''}</div>
        <div class="kpi-sub">プラットフォーム自動化率（自律成立の割合）${k.autoRate === null ? '-' : k.autoRate + '%'}</div>
        ${!s.pilotStart ? '<div class="kpi-warn">下の「実証期間と目標」で、実証の開始日を設定してください。</div>'
          : k.baselinePW === null ? '<div class="kpi-warn">実証前の対応時間がありません。対応ログに開始日より前の記録を入れるか、「実証前の週あたり対応時間」を入力してください。</div>'
          : k.pilotLogs === 0 ? '<div class="kpi-warn">実証期間中の対応ログがまだ0件です（0分として計算しています）。対応したときは、そのつど記録してください。</div>' : ''}
      </div>
      <div class="kpi-card">
        <div class="kpi-h">③ 支援不足校区の可視化</div>
        <div class="kpi-big">${k.districts.total}<small> / ${k.districts.total}校区を可視化</small></div>
        ${bar(k.districts.total, k.districts.total, 'ok')}
        <div class="kpi-sub">子ども食堂 設置済 ${k.districts.served}校区／未設置 ${k.districts.total - k.districts.served}校区</div>
        <div class="kpi-sub">登録がある校区 ${k.districts.active}校区　未設置でニーズありの校区 ${k.districts.needDistricts}校区</div>
      </div>
    </div>

    <div class="section-title"><span>成立の内訳</span><span class="rule"></span></div>
    <div class="table-wrap"><table class="ledger">
      <tr><th>区分</th><th>成立</th><th>うち自律</th><th>うち職員仲介</th><th>うち完了</th><th>うち企業の提供</th></tr>
      ${CATS.map(c => { const v = k.cat[c]; return `<tr><td>${esc(c)}</td><td>${v.total}</td><td>${v.auto}</td><td>${v.assisted}</td><td>${v.fulfilled}</td><td>${v.company}</td></tr>`; }).join('')}
      <tr class="dd-sum"><td>合計</td><td>${k.total}</td><td>${k.auto}</td><td>${k.assisted}</td><td>${k.fulfilled}</td><td>${k.companyN}</td></tr>
    </table></div>
    <p class="sub">集計の対象は、実証期間内に成立したものです（期間が未設定の間は、全期間）。「食材の寄付」は寄付の「食料」、「資材・物品」はそれ以外の寄付です。「企業の提供」は、できること側の登録者の区分が「企業・事業者」のものです。</p>
    <button class="export-btn" id="kpiExport">KPIの集計をCSVで保存</button>

    <div class="section-title"><span>実証期間と目標</span><span class="rule"></span></div>
    <div class="kpi-form">
      <label>実証の開始日<input type="date" class="kpi-in" id="kpiStart" value="${esc(s.pilotStart)}"></label>
      <label>実証の終了日<input type="date" class="kpi-in" id="kpiEnd" value="${esc(s.pilotEnd)}"></label>
      <label>成立数の目標（件）<input type="number" min="1" class="kpi-in" id="kpiTarget" value="${target}"></label>
      <label>対応時間の削減目標（%）<input type="number" min="1" max="100" class="kpi-in" id="kpiRed" value="${tgtRed}"></label>
      <label>実証前の週あたり対応時間（分）<input type="number" min="0" class="kpi-in" id="kpiBase" value="${s.baselineMinutesPerWeek === null || s.baselineMinutesPerWeek === '' ? '' : esc(s.baselineMinutesPerWeek)}" placeholder="ログから自動計算"></label>
      <button class="export-btn" id="kpiSave">保存</button> <span class="geo-status" id="kpiMsg"></span>
    </div>
    <p class="sub">実証前の対応時間は、「対応ログ」に実証開始日より前の記録があれば自動で計算します。過去の記録がないときだけ、見積もりを直接入力してください（入力した値が優先されます）。</p>

    <div class="section-title"><span>職員の対応ログ</span><span class="rule"></span></div>
    <p class="sub">電話・メール・窓口で受けた問い合わせや、マッチングの仲介にかけた時間を、そのつど記録します（1分で入力できます）。<b>個人名・電話番号などは書かないでください。</b>職員だけが見られます。実証の開始前から記録すると、削減率の基準になります。</p>
    <div class="kpi-form">
      <label>日付<input type="date" class="kpi-in" id="logDate" value="${isoToday()}"></label>
      <label>かけた時間（分）<input type="number" min="1" class="kpi-in" id="logMin" placeholder="例）15"></label>
      <label>連絡手段<select class="kpi-in" id="logCh">${CHANNELS.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label>内容<select class="kpi-in" id="logTopic">${TOPICS.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="kpi-wide">メモ（任意）<input type="text" class="kpi-in" id="logNote" maxlength="80" placeholder="例）企業から米の寄付の申し出。子ども食堂へ仲介"></label>
      <button class="export-btn" id="logAdd">記録する</button> <span class="geo-status" id="logMsg"></span>
    </div>
    <div class="kpi-sub">記録：実証前 ${k.baselineLogs}件 ／ 実証中 ${k.pilotLogs}件（合計 ${k.pilotMin}分）</div>
    <div class="table-wrap"><table class="ledger">
      <tr><th>日付</th><th>分</th><th>連絡手段</th><th>内容</th><th>メモ</th><th></th></tr>
      ${(ctx.logs || []).slice(0, 30).map(l => `<tr><td>${esc(l.date)}</td><td>${esc(l.minutes)}</td><td>${esc(l.channel)}</td><td>${esc(l.topic)}</td><td>${esc(l.note || '')}</td><td><button class="btn-sm log-del" data-id="${esc(l.id)}">削除</button></td></tr>`).join('')
        || '<tr><td colspan="6">まだ記録がありません</td></tr>'}
    </table></div>
    ${(ctx.logs || []).length > 30 ? `<p class="sub">新しい30件を表示しています（全${ctx.logs.length}件）。</p>` : ''}

    <details class="kpi-defs"><summary>用語の定義</summary><ul>
      <li><b>成立</b>：やり取りのあと、当事者のどちらかが「つながり成立にする」を押したもの。</li>
      <li><b>自律成立</b>：成立のうち、コーディネーターが手動でつないだもの、および職員が仲介したと記録されたもの以外。</li>
      <li><b>完了</b>：成立のあと、当事者が「実施できた」と記録したもの（実際に届いた・手伝えた）。</li>
      <li><b>対応時間の削減率</b>：（実証前の週あたり対応時間 − 実証中の週あたり対応時間）÷ 実証前の週あたり対応時間。</li>
      <li><b>可視化</b>：全${k.districts.total}校区の子ども食堂の設置状況と、ニーズ・できることの登録状況を、校区別に把握できていること。</li>
    </ul></details>`;

  const $ = id => wrap.querySelector('#' + id);
  $('kpiSave').onclick = async () => {
    const num = id => ($(id).value === '' ? null : Number($(id).value));
    const next = { pilotStart: $('kpiStart').value, pilotEnd: $('kpiEnd').value, targetMatches: num('kpiTarget') || 40,
      targetReductionPct: num('kpiRed') || 70, baselineMinutesPerWeek: num('kpiBase') };
    if(next.pilotStart && next.pilotEnd && next.pilotEnd < next.pilotStart){ $('kpiMsg').textContent = '終了日が開始日より前になっています'; return; }
    $('kpiMsg').textContent = '保存中…';
    try { await ctx.onSaveSettings(next); } catch(e){ $('kpiMsg').textContent = '保存できませんでした（firestore.rulesのkpiSettingsが未反映の可能性があります）'; }
  };
  $('logAdd').onclick = async () => {
    const minutes = Math.floor(Number($('logMin').value));
    if(!$('logDate').value || !(minutes > 0)){ $('logMsg').textContent = '日付と、かけた時間（分）を入れてください'; return; }
    $('logMsg').textContent = '保存中…';
    try { await ctx.onAddLog({ date: $('logDate').value, minutes, channel: $('logCh').value, topic: $('logTopic').value, note: $('logNote').value.trim() }); }
    catch(e){ $('logMsg').textContent = '保存できませんでした（firestore.rulesのstaffLogsが未反映の可能性があります）'; }
  };
  wrap.querySelectorAll('.log-del').forEach(b => { b.onclick = () => { if(confirm('この記録を削除しますか？')) ctx.onDeleteLog(b.dataset.id); }; });
  $('kpiExport').onclick = () => {
    const rows = [
      ['実証期間', `${s.pilotStart || '未設定'} 〜 ${s.pilotEnd || '未設定'}`],
      ['成立数', k.total], ['成立数の目標', target], ['達成率(%)', progress],
      ['自律成立', k.auto], ['職員仲介', k.assisted], ['自律成立の割合(%)', k.autoRate === null ? '' : k.autoRate],
      ['完了（実施まで確認）', k.fulfilled], ['うち企業の提供', k.companyN],
      ...CATS.map(c => [`成立:${c}`, k.cat[c].total]),
      ['実証前の週あたり対応時間(分)', fmt1(k.baselinePW)], ['実証中の週あたり対応時間(分)', fmt1(k.pilotPW)],
      ['対応時間の削減率(%)', k.reduction === null ? '' : k.reduction], ['削減目標(%)', tgtRed],
      ['可視化した校区', `${k.districts.total}/${k.districts.total}`], ['子ども食堂 設置済の校区', k.districts.served],
      ['登録がある校区', k.districts.active], ['未設置でニーズありの校区', k.districts.needDistricts],
    ].map(([metric, value]) => ({ metric, value }));
    ctx.exportCsv(['metric', 'value'], rows, 'kpi_summary.csv');
  };
  return wrap;
}
