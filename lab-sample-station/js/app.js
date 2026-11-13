/* ============================================================
 * app.js — 界面渲染与交互
 * ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let currentOperator = localStorage.getItem('lab-station-operator') || '王雪';

/* ---------- 安全转义 ---------- */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function tagHtml(tests) {
  return `<div class="test-tags">${tests.map((t) => `<span class="test-tag">${esc(t)}</span>`).join('')}</div>`;
}
function statusHtml(st) {
  return `<span class="status status-${st}">${esc(statusLabel(st))}</span>`;
}
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

/* ============================================================
 * 初始化
 * ============================================================ */
function init() {
  Store.load();
  const st = Store.get();

  /* 经手人 */
  $('#operatorSelect').innerHTML = st.operators
    .map((o) => `<option value="${esc(o.name)}" ${o.name === currentOperator ? 'selected' : ''}>${esc(o.name)}（${esc(o.role)}）</option>`)
    .join('');
  $('#operatorSelect').addEventListener('change', (e) => {
    currentOperator = e.target.value;
    localStorage.setItem('lab-station-operator', currentOperator);
    toast(`当前经手人切换为 ${currentOperator}`);
  });

  /* 采集点 / 项目下拉 */
  $('#fSite').innerHTML = st.sites.map((s) => `<option>${esc(s)}</option>`).join('');
  $('#fTests').innerHTML = st.tests.map((t) => `<option>${esc(t)}</option>`).join('');
  $('#newBatchTest').innerHTML = st.tests.map((t) => `<option>${esc(t)}</option>`).join('');
  $('#fSampledAt').value = Store.now();

  /* 模拟条码芯片 */
  renderChips();

  /* 选项卡 */
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  /* 顶栏 */
  $('#resetDemoBtn').addEventListener('click', confirmReset);
  $('#exportBtn').addEventListener('click', exportBackup);

  /* 接收 */
  $('#scanGoBtn').addEventListener('click', handleManualScan);
  $('#scanInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleManualScan(); });
  $('#manualReceiveBtn').addEventListener('click', handleManualReceive);
  $('#loadCsvDemoBtn').addEventListener('click', () => { $('#csvText').value = Store.get().csvTemplate; $('#csvPreview').textContent = '已载入示例 CSV'; });
  $('#importCsvBtn').addEventListener('click', handleCsvImport);
  $('#csvFile').addEventListener('change', handleCsvFile);

  /* 批次 */
  $('#createBatchBtn').addEventListener('click', handleCreateBatch);
  $('#backToBatchesBtn').addEventListener('click', () => {
    $('#batchDetailView').hidden = true;
    $('#batchListView').hidden = false;
  });

  /* 档案搜索 */
  $('#archiveSearch').addEventListener('input', renderArchive);

  /* 抽屉 / 模态关闭 */
  $('#drawerCloseBtn').addEventListener('click', closeDrawer);
  $('#drawerMask').addEventListener('click', closeDrawer);
  $('#modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') closeModal(); });

  /* 全局事件委托：行内操作按钮 */
  document.addEventListener('click', handleActionClick);

  renderAll();
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'batches') {
    $('#batchDetailView').hidden = true;
    $('#batchListView').hidden = false;
  }
  renderAll();
}

function renderAll() {
  renderPendingBadge();
  renderReception();
  renderPending();
  renderBatches();
  if (!$('#batchDetailView').hidden) renderBatchDetail(currentDetailBatchId);
  renderArchive();
  renderDashboard();
}

/* ============================================================
 * 模拟条码芯片
 * ============================================================ */
function renderChips() {
  const st = Store.get();
  $('#chipList').innerHTML = st.barcodes.map((b) => `
    <button class="chip" data-chip="${esc(b.code)}" title="${esc(b.note)}">
      ${esc(b.code)}
      <span class="chip-tag ${b.tag}">${esc(b.note)}</span>
    </button>`).join('');
}

/* 芯片点击 = 扫码枪扫入完整载荷并自动回车 */
document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (!chip) return;
  const code = chip.dataset.chip;
  const b = Store.get().barcodes.find((x) => x.code === code);
  $('#scanInput').value = code;
  const r = Store.receiveSample({
    code: b.code, site: b.site, sampledAt: b.sampledAt, tests: b.tests,
    by: currentOperator, via: '条码扫描（模拟）',
  });
  afterReceive(r);
});

function handleManualScan() {
  const code = $('#scanInput').value.trim();
  if (!code) { toast('请输入或扫描样本编号', 'warn'); return; }
  const b = Store.get().barcodes.find((x) => x.code === code);
  if (!b) {
    toast('未识别该虚构条码，已将编号带入手动表单，请补全采集点/时间/项目', 'warn');
    $('#fCode').value = code;
    $('#fSampledAt').value = Store.now();
    return;
  }
  const r = Store.receiveSample({
    code: b.code, site: b.site, sampledAt: b.sampledAt, tests: b.tests,
    by: currentOperator, via: '条码扫描（模拟）',
  });
  afterReceive(r);
}

function handleManualReceive() {
  const tests = [...$('#fTests').selectedOptions].map((o) => o.value);
  const r = Store.receiveSample({
    code: $('#fCode').value,
    site: $('#fSite').value,
    sampledAt: $('#fSampledAt').value,
    tests,
    by: currentOperator,
    via: '手动录入',
  });
  if (r.outcome === 'invalid') { toast(r.message, 'error'); return; }
  $('#fCode').value = '';
  afterReceive(r);
}

function afterReceive(r) {
  const kind = { new: 'success', merged: 'warn', conflict: 'error' }[r.outcome] || '';
  toast(r.message, kind);
  $('#scanInput').value = '';
  renderAll();
}

/* ============================================================
 * CSV
 * ============================================================ */
function handleCsvFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { $('#csvText').value = reader.result; $('#csvPreview').textContent = `已读取文件：${file.name}`; };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
}

function handleCsvImport() {
  const r = Store.importCsv($('#csvText').value, currentOperator);
  const box = $('#csvReport');
  box.hidden = false;
  if (!r.ok) {
    box.className = 'import-report warn';
    box.innerHTML = `<b>导入失败：</b>${esc(r.message)}`;
    return;
  }
  const c = r.counts;
  box.className = 'import-report ' + ((c.conflict || c.invalid) ? 'warn' : 'ok');
  box.innerHTML = `
    <b>导入完成：</b>新建 ${c.new || 0} 份，重复合并 ${c.merged || 0} 份，冲突待确认 ${c.conflict || 0} 份，无效 ${c.invalid || 0} 份
    <ul>${r.items.map((it) => `<li>第 ${it.lineNo} 行 · ${esc(it.message || it.outcome)}</li>`).join('')}</ul>`;
  renderAll();
}

/* ============================================================
 * 接收页：今日记录表
 * ============================================================ */
function renderReception() {
  const st = Store.get();
  const today = Store.now().slice(0, 10);
  const list = Object.values(st.samples)
    .filter((s) => (s.receivedAt || '').startsWith(today))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  $('#receptionSummary').textContent = `共 ${list.length} 份（按接收时间倒序）`;
  const tbody = $('#recentTable tbody');
  tbody.innerHTML = list.length ? list.map(sampleRowHtml).join('') : emptyRow(8, '今日暂无接收记录，请扫码或导入 CSV');
}

function sampleRowHtml(s) {
  const st = Store.get();
  const batchCodes = Store.batchesOfSample(s.id).map((b) => b.code).join('、');
  return `<tr>
    <td class="mono">${esc(s.code)}</td>
    <td>${esc(s.site)}</td>
    <td class="mono">${esc(fmtTime(s.sampledAt))}</td>
    <td>${tagHtml(s.tests)}</td>
    <td>${statusHtml(s.status)}</td>
    <td class="mono">${esc(batchCodes || '—')}</td>
    <td class="mono">${esc(fmtTime(s.receivedAt))}</td>
    <td>${rowActions(s)}</td>
  </tr>`;
}

function rowActions(s) {
  const btns = [`<button class="btn btn-sm" data-action="chain" data-id="${s.id}">流转记录</button>`];
  if (s.status === 'received' || s.status === 'batched') {
    btns.push(`<button class="btn btn-sm btn-primary" data-action="allocate" data-id="${s.id}">分配批次</button>`);
  }
  if (s.status !== 'rejected' && s.status !== 'completed' && s.tests.length > 1) {
    btns.push(`<button class="btn btn-sm" data-action="split" data-id="${s.id}">拆分</button>`);
  }
  if (s.status !== 'rejected' && s.status !== 'completed') {
    btns.push(`<button class="btn btn-sm btn-danger" data-action="reject" data-id="${s.id}">拒收</button>`);
  }
  if (s.status === 'completed' || s.status === 'batched') {
    btns.push(`<button class="btn btn-sm" data-action="retest" data-id="${s.id}">重测</button>`);
  }
  return `<div class="row-actions">${btns.join('')}</div>`;
}

function emptyRow(span, text) {
  return `<tr><td colspan="${span}"><div class="empty-state">${esc(text)}</div></td></tr>`;
}

/* ============================================================
 * 待确认
 * ============================================================ */
function renderPendingBadge() {
  const n = Object.values(Store.get().pending).filter((p) => p.status === 'open').length;
  const badge = $('#pendingBadge');
  badge.hidden = n === 0;
  badge.textContent = n;
}

function renderPending() {
  const st = Store.get();
  const list = Object.values(st.pending).sort((a, b) => a.status.localeCompare(b.status) || b.id.localeCompare(a.id));
  const box = $('#pendingList');
  if (!list.length) { box.innerHTML = '<div class="empty-state">待确认队列为空</div>'; return; }

  box.innerHTML = list.map((p) => {
    const diffSet = new Set();
    p.incoming.diffs.forEach((d) => {
      d.includes('采样时间') && diffSet.add('sampledAt');
      d.includes('项目') && diffSet.add('tests');
    });
    const cls = (field) => (diffSet.has(field) ? 'diff-field' : '');
    return `
    <div class="pending-card ${p.status === 'resolved' ? 'resolved' : ''}">
      <h3>编号 <span class="mono">${esc(p.code)}</span>
        ${p.status === 'open'
          ? '<span class="status status-conflict">待裁决</span>'
          : `<span class="status status-closed">已处理 · ${esc(p.resolution.action === 'create-new' ? '另建新档' : '维持原件')}</span>`}
      </h3>
      <p class="hint">冲突到达时间 ${esc(fmtTime(p.incoming.arrivedAt))}，经手人 ${esc(p.incoming.arrivedBy)}</p>
      <div class="compare-grid">
        <div class="compare-col original">
          <h4>原始记录（只读，不可覆盖）</h4>
          <dl>
            <dt>采集点</dt><dd>${esc(p.original.site)}</dd>
            <dt>采样时间</dt><dd class="${cls('sampledAt')} mono">${esc(fmtTime(p.original.sampledAt))}</dd>
            <dt>检测项目</dt><dd class="${cls('tests')}">${tagHtml(p.original.tests)}</dd>
            <dt>到达时间</dt><dd class="mono">${esc(fmtTime(p.original.arrivedAt))}</dd>
          </dl>
        </div>
        <div class="compare-col incoming">
          <h4>新到样本信息</h4>
          <dl>
            <dt>采集点</dt><dd>${esc(p.incoming.site)}</dd>
            <dt>采样时间</dt><dd class="${cls('sampledAt')} mono">${esc(fmtTime(p.incoming.sampledAt))}</dd>
            <dt>检测项目</dt><dd class="${cls('tests')}">${tagHtml(p.incoming.tests)}</dd>
            <dt>差异</dt><dd>${p.incoming.diffs.map((d) => esc(d)).join('<br>')}</dd>
          </dl>
        </div>
      </div>
      ${p.status === 'open' ? `
      <div class="form-grid" style="margin-bottom:4px">
        <label>裁决备注（可选）<input type="text" id="pnote-${p.id}" placeholder="如：已电话联系采集护士核对"></label>
      </div>
      <div class="pending-actions">
        <button class="btn btn-primary" data-action="resolve-keep" data-id="${p.id}">维持原始记录（冲突件退回）</button>
        <button class="btn" data-action="resolve-new" data-id="${p.id}">另建新档（编号加 -C 后缀）</button>
      </div>` : `
      <p class="hint">裁决时间 ${esc(fmtTime(p.resolution.at))} · 经手人 ${esc(p.resolution.by)}
        ${p.resolution.newCode ? ` · 新档编号 <span class="mono">${esc(p.resolution.newCode)}</span>` : ''}
        ${p.resolution.note ? ` · 备注：${esc(p.resolution.note)}` : ''}
      </p>`}
    </div>`;
  }).join('');
}

/* ============================================================
 * 批次
 * ============================================================ */
function handleCreateBatch() {
  const test = $('#newBatchTest').value;
  const name = $('#newBatchName').value.trim();
  const b = Store.createBatch(test, name, currentOperator);
  $('#newBatchName').value = '';
  toast(`已创建批次 ${b.code}（${test}）`, 'success');
  renderAll();
}

function renderBatches() {
  const st = Store.get();
  const list = Object.values(st.batches).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('#batchTable tbody').innerHTML = list.map((b) => {
    const done = Store.batchSummary(b.id).doneCount;
    return `<tr>
      <td class="mono">${esc(b.code)}</td>
      <td>${esc(b.test)}</td>
      <td><span class="status status-${b.status}">${b.status === 'open' ? '开放中' : '已关闭'}</span>
          ${b.revisions.length ? `<span class="version-chip">${b.revisions.length} 次修订</span>` : ''}</td>
      <td>${b.sampleIds.length}</td>
      <td>${done}</td>
      <td>${b.revisions.length}</td>
      <td class="mono" style="font-size:12px">建 ${esc(fmtTime(b.createdAt))}${b.closedAt ? `<br>关 ${esc(fmtTime(b.closedAt))}` : ''}</td>
      <td><div class="row-actions">
        <button class="btn btn-sm btn-primary" data-action="batch-detail" data-id="${b.id}">打开批次页</button>
      </div></td>
    </tr>`;
  }).join('') || emptyRow(8, '暂无批次，请先新建批次并分配样本');
}

let currentDetailBatchId = null;

function openBatchDetail(batchId) {
  currentDetailBatchId = batchId;
  $('#batchListView').hidden = true;
  $('#batchDetailView').hidden = false;
  renderBatchDetail(batchId);
}

function renderBatchDetail(batchId) {
  const st = Store.get();
  const b = st.batches[batchId];
  if (!b) return;
  $('#batchDetailTitle').textContent = `批次 ${b.code} · ${b.test}`;

  const sum = Store.batchSummary(b.id);
  $('#batchSummaryBox').innerHTML = `
    <div class="summary-item"><b>${b.code}</b>批次号</div>
    <div class="summary-item"><b>${esc(b.test)}</b>检测项目</div>
    <div class="summary-item"><b>${b.status === 'open' ? '开放中' : '已关闭'}</b>状态</div>
    <div class="summary-item"><b>${sum.sampleCount}</b>样本数</div>
    <div class="summary-item"><b>${sum.doneCount}</b>已出结果</div>
    <div class="summary-item"><b>${sum.abnormalCount}</b>异常/阳性</div>
    <div class="summary-item"><b>${sum.revisionCount}</b>修订次数</div>
    <div class="summary-item">
      ${b.status === 'open'
        ? `<button class="btn btn-danger btn-sm" data-action="close-batch" data-id="${b.id}">关闭批次</button>`
        : `关闭于 ${esc(fmtTime(b.closedAt))} · ${esc(b.closedBy)}`}
    </div>`;

  /* 修订提示横幅 */
  const rb = $('#revisionBanner');
  if (b.revisions.length) {
    rb.hidden = false;
    rb.innerHTML = `<b>⚠️ 该批次关闭后存在 ${b.revisions.length} 次补录/修订，以下汇总已受影响：</b>
      <ul>${b.revisions.map((r) => `<li>${esc(fmtTime(r.at))} ${esc(r.by)}：${esc(r.sampleCode)}「${esc(r.test)}」→ v${r.version}
        <br>原因：${esc(r.reason)}<br><b>受影响汇总：</b>${esc(r.summaryImpact)}</li>`).join('')}</ul>`;
  } else rb.hidden = true;

  const rows = b.sampleIds.map((sid) => {
    const s = st.samples[sid];
    if (!s) return '';
    const r = s.results[b.test];
    const cur = r ? r.versions[r.current - 1] : null;
    const resultCell = cur
      ? `<div class="result-cell">
           <span class="result-value ${cur.flag && cur.flag !== '正常' ? 'result-abnormal' : ''}">${esc(cur.value)}</span>
           ${esc(cur.unit ? ' ' + cur.unit : '')}
           <span class="test-tag" style="margin-left:4px">${esc(cur.flag)}</span>
           ${r.current > 1 ? `<div class="result-revised">已修订至 v${r.current}（${esc(cur.recordedBy)} ${esc(fmtTime(cur.recordedAt))}）</div>` : ''}
         </div>`
      : '<span class="hint">未录入</span>';
    const actionLabel = b.status === 'closed'
      ? (cur ? '补录/修订结果' : '补录结果')
      : (cur ? '修订结果（重测）' : '录入结果');
    return `<tr>
      <td class="mono">${esc(s.code)}</td>
      <td>${esc(s.site)}</td>
      <td class="mono">${esc(fmtTime(s.sampledAt))}</td>
      <td>${statusHtml(s.status)}</td>
      <td>${resultCell}</td>
      <td><div class="row-actions">
        <button class="btn btn-sm ${b.status === 'closed' ? '' : 'btn-primary'}" data-action="enter-result" data-sample="${s.id}" data-batch="${b.id}">${actionLabel}</button>
        <button class="btn btn-sm" data-action="chain" data-id="${s.id}">流转</button>
      </div></td>
    </tr>`;
  }).join('');
  $('#batchSampleTable tbody').innerHTML = rows || emptyRow(6, '批次内暂无样本，请在接收页分配样本');
}

/* ============================================================
 * 档案
 * ============================================================ */
function renderArchive() {
  const st = Store.get();
  const q = ($('#archiveSearch').value || '').trim().toLowerCase();
  let list = Object.values(st.samples).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (q) {
    list = list.filter((s) =>
      s.code.toLowerCase().includes(q) ||
      s.site.toLowerCase().includes(q) ||
      s.tests.join(',').toLowerCase().includes(q));
  }
  $('#archiveTable tbody').innerHTML = list.length ? list.map((s) => {
    const lineage = lineageHtml(s);
    const batchCodes = Store.batchesOfSample(s.id).map((b) => b.code).join('、');
    return `<tr>
      <td class="mono">${esc(s.code)}</td>
      <td>${esc(s.site)}</td>
      <td class="mono">${esc(fmtTime(s.sampledAt))}</td>
      <td>${tagHtml(s.tests)}</td>
      <td>${statusHtml(s.status)}</td>
      <td class="mono">${esc(batchCodes || '—')}</td>
      <td>${lineage}</td>
      <td><div class="row-actions">
        <button class="btn btn-sm btn-primary" data-action="chain" data-id="${s.id}">完整流转</button>
      </div></td>
    </tr>`;
  }).join('') : emptyRow(8, '没有匹配的样本');
}

function lineageHtml(s) {
  const parts = [];
  if (s.parentId) {
    const p = Store.get().samples[s.parentId];
    parts.push(`子样本（父：<button class="link-btn" data-action="chain" data-id="${p.id}">${esc(p.code)}</button>）`);
  }
  if (s.childIds.length) {
    parts.push(`父样本（${s.childIds.length} 个拆分件）`);
  }
  if (s.mergedFrom.length) parts.push(`已合并重复件：${s.mergedFrom.map((c) => esc(c)).join('、')}`);
  if (!parts.length) parts.push('原始建档');
  return parts.join('<br>');
}

/* ============================================================
 * 总览
 * ============================================================ */
function renderDashboard() {
  const st = Store.get();
  const all = Object.values(st.samples);
  const counts = {
    total: all.length,
    received: all.filter((s) => s.status === 'received').length,
    batched: all.filter((s) => s.status === 'batched').length,
    rejected: all.filter((s) => s.status === 'rejected').length,
    completed: all.filter((s) => s.status === 'completed').length,
    pending: Object.values(st.pending).filter((p) => p.status === 'open').length,
  };
  const revisionTotal = Object.values(st.batches).reduce((n, b) => n + b.revisions.length, 0);

  $('#kpiRow').innerHTML = [
    ['样本总数', counts.total, ''],
    ['待分配', counts.received, 'k-warn'],
    ['检测中（已分批）', counts.batched, 'k-purple'],
    ['已完成', counts.completed, 'k-green'],
    ['拒收', counts.rejected, 'k-red'],
    ['待确认冲突', counts.pending, 'k-red'],
    ['批次修订', revisionTotal, 'k-warn'],
  ].map(([label, num, cls]) => `<div class="kpi ${cls}"><div class="num">${num}</div><div class="label">${label}</div></div>`).join('');

  const bySite = {};
  all.forEach((s) => { bySite[s.site] = (bySite[s.site] || 0) + 1; });
  const max = Math.max(1, ...Object.values(bySite));
  $('#siteStats').innerHTML = `<div class="stat-bars">${Object.entries(bySite)
    .sort((a, b) => b[1] - a[1])
    .map(([site, n]) => `
      <div class="stat-bar-row">
        <span>${esc(site)}</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(n / max) * 100}%"></div></div>
        <span class="count">${n}</span>
      </div>`).join('')}</div>`;

  $('#recentEvents').innerHTML = Store.globalEvents(25).map((e) => `
    <div class="feed-item">
      <div class="feed-time">${esc(fmtTime(e.at))}</div>
      <div class="feed-action">
        <b>${esc(eventLabel(e.type))}</b>
        <span> · <span class="mono">${esc(e.sampleCode)}</span> · ${esc(e.by)}</span>
      </div>
    </div>`).join('');
}

/* ============================================================
 * 流转记录抽屉
 * ============================================================ */
function openDrawer(sampleId) {
  const st = Store.get();
  const s = st.samples[sampleId];
  if (!s) return;
  $('#drawerTitle').textContent = `样本 ${s.code}`;

  const batches = Store.batchesOfSample(s.id);
  const resultBlocks = Object.entries(s.results).map(([test, r]) => {
    const cur = r.versions[r.current - 1];
    return `<div class="ev-detail" style="margin-bottom:6px">
      <b>${esc(test)}</b> — 当前 v${r.current}：${esc(cur.value)} ${esc(cur.unit)}（${esc(cur.flag)}）
      ${r.versions.length > 1 ? `<br>历史版本：${r.versions.slice(0, -1).map((v) => `v${v.version} ${esc(v.value)}`).join('；')}` : ''}
    </div>`;
  }).join('');

  const lineage = [];
  if (s.parentId) {
    const p = st.samples[s.parentId];
    lineage.push(`<dt>父样本</dt><dd><button class="link-btn" data-action="chain" data-id="${p.id}">${esc(p.code)}</button></dd>`);
  }
  if (s.childIds.length) {
    lineage.push('<dt>拆分子件</dt><dd>' + s.childIds.map((cid) => {
      const c = st.samples[cid];
      return `<button class="link-btn" data-action="chain" data-id="${cid}">${esc(c.code)}（${esc(c.tests.join('、'))}）</button>`;
    }).join('，') + '</dd>');
  }
  if (s.mergedFrom.length) lineage.push(`<dt>合并件</dt><dd>${s.mergedFrom.map((c) => esc(c)).join('、')}（重复到达，未另建档）</dd>`);

  $('#drawerBody').innerHTML = `
    <dl class="meta-grid">
      <dt>采集点</dt><dd>${esc(s.site)}</dd>
      <dt>采样时间</dt><dd class="mono">${esc(fmtTime(s.sampledAt))}</dd>
      <dt>检测项目</dt><dd>${tagHtml(s.tests)}</dd>
      <dt>当前状态</dt><dd>${statusHtml(s.status)}</dd>
      <dt>所在批次</dt><dd class="mono">${batches.length ? batches.map((b) => esc(b.code)).join('、') : '—'}</dd>
      ${s.rejectReason ? `<dt>拒收原因</dt><dd style="color:var(--red)">${esc(s.rejectReason)}<br><span class="hint">${esc(fmtTime(s.rejectedAt))} · ${esc(s.rejectedBy)}</span></dd>` : ''}
      ${lineage.join('')}
    </dl>
    ${resultBlocks ? `<h3 style="margin-bottom:8px">检测结果（含修订版本）</h3>${resultBlocks}` : ''}
    <h3 style="margin:14px 0 10px">完整流转记录（${s.events.length} 条，全程留痕）</h3>
    <ul class="timeline">
      ${s.events.map((e) => `
        <li class="ev-${esc(e.type)}">
          <div class="ev-title">${esc(eventLabel(e.type))}</div>
          <div class="ev-meta">${esc(fmtTime(e.at))} · 经手人：${esc(e.by)}</div>
          ${eventDetailHtml(e)}
        </li>`).join('')}
    </ul>`;

  $('#drawerMask').hidden = false;
  $('#sampleDrawer').hidden = false;
}

function eventDetailHtml(e) {
  const d = e.detail || {};
  const rows = [];
  switch (e.type) {
    case 'receive': rows.push(['录入方式', d.via || '—']); break;
    case 'merge': rows.push(['重复编号', d.duplicateCode], ['合并依据', d.basis]); break;
    case 'conflict': rows.push(['处理', d.reason], ['待确认单号', d.pendingId]); break;
    case 'pending_resolve': rows.push(['裁决结果', d.result], ['备注', d.note || '—']); break;
    case 'allocate': rows.push(['批次', d.batchCode], ['检测项目', d.test || '全部']); break;
    case 'reject': rows.push(['拒收原因', d.reason]); break;
    case 'split':
      if (d.children) rows.push(['拆分为', d.children.join('；')]);
      if (d.parentCode) rows.push(['父样本', d.parentCode]);
      rows.push(['原因', d.reason || '—']);
      break;
    case 'retest': rows.push(['重测原因', d.reason]); break;
    case 'result': rows.push(['检测项目', d.test], ['版本', 'v' + d.version], ['结果摘要', d.summary]); break;
    case 'revise':
      rows.push(['检测项目', d.test], ['版本', `v${d.fromVersion} → v${d.toVersion}`], ['修订原因', d.reason]);
      if (d.batchClosed) rows.push(['批次状态', '批次已关闭后补录']);
      if (d.impact) rows.push(['受影响汇总', d.impact]);
      break;
    case 'close': rows.push(['样本数', d.sampleCount]); break;
    case 'batch_close': rows.push(['批次', d.batchCode]); break;
    case 'create_batch': rows.push(['检测项目', d.test]); break;
  }
  if (!rows.length) return '';
  return `<div class="ev-detail">${rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<div><b>${esc(k)}：</b>${esc(v)}</div>`).join('')}</div>`;
}

function closeDrawer() {
  $('#drawerMask').hidden = true;
  $('#sampleDrawer').hidden = true;
}

/* ============================================================
 * 通用模态框
 * ============================================================ */
function openModal(title, bodyHtml, actions) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalActions').innerHTML = actions
    .map((a) => `<button class="btn ${a.cls || ''}" data-modal-action="${a.key}">${esc(a.label)}</button>`)
    .join('');
  $('#modalMask').hidden = false;
  $('#modalActions').querySelectorAll('[data-modal-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = actions.find((a) => a.key === btn.dataset.modalAction);
      if (act && act.onClick) act.onClick();
    });
  });
}
function closeModal() { $('#modalMask').hidden = true; }

/* ---------- 拒收 ---------- */
function modalReject(s) {
  openModal(`拒收样本 ${s.code}`, `
    <p class="hint">拒收将记录原因、时间与经手人，并写入该样本完整流转链。</p>
    <label>拒收原因（必填）
      <textarea id="rejectReason" rows="3" placeholder="如：溶血 / 采血量不足 / 容器破损 / 条码无法识别"></textarea>
    </label>`,
    [
      { key: 'cancel', label: '取消', onClick: closeModal },
      {
        key: 'confirm', label: '确认拒收', cls: 'btn-danger',
        onClick: () => {
          const r = Store.reject(s.id, $('#rejectReason').value, currentOperator);
          if (!r.ok) { toast(r.message, 'error'); return; }
          toast(r.message, 'error'); closeModal(); renderAll();
        },
      },
    ]);
}

/* ---------- 重测 ---------- */
function modalRetest(s) {
  openModal(`登记重测 ${s.code}`, `
    <p class="hint">重测不删除已有结果；下次录入结果时自动生成新版本并在流转链留痕。</p>
    <label>重测原因（必填）
      <textarea id="retestReason" rows="3" placeholder="如：首次结果异常 / 临床要求复查 / 仪器质控失控"></textarea>
    </label>`,
    [
      { key: 'cancel', label: '取消', onClick: closeModal },
      {
        key: 'confirm', label: '确认登记重测', cls: 'btn-primary',
        onClick: () => {
          const reason = $('#retestReason').value.trim();
          if (!reason) { toast('请填写重测原因', 'error'); return; }
          const r = Store.retest(s.id, reason, currentOperator);
          if (!r.ok) { toast(r.message, 'error'); return; }
          toast(r.message, 'warn'); closeModal(); renderAll();
        },
      },
    ]);
}

/* ---------- 分配批次 ---------- */
function modalAllocate(s) {
  const st = Store.get();
  const body = `
    <p class="hint">为每个检测项目选择开放批次，或即时新建批次。一份样本可同时进入多个批次。</p>
    <div id="allocRows">
      ${s.tests.map((t, i) => {
        const opts = Store.openBatchesForTest(t);
        return `<div class="alloc-row" style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <label style="flex-direction:row;align-items:center;gap:6px;flex:0 0 150px">
            <input type="checkbox" class="alloc-check" data-test="${esc(t)}" checked style="width:auto">
            <span class="test-tag">${esc(t)}</span>
          </label>
          <select class="alloc-select" data-test="${esc(t)}">
            ${opts.length ? opts.map((b) => `<option value="${b.id}">${esc(b.code)}（开放中，${b.sampleIds.length} 份）</option>`).join('') : ''}
            <option value="__new__">＋ 新建「${esc(t)}」批次</option>
          </select>
        </div>`;
      }).join('')}
    </div>`;
  openModal(`分配批次 · ${s.code}`, body, [
    { key: 'cancel', label: '取消', onClick: closeModal },
    {
      key: 'confirm', label: '确认分配', cls: 'btn-primary',
      onClick: () => {
        const assignments = $$('.alloc-check').filter((c) => c.checked).map((c) => {
          const t = c.dataset.test;
          const sel = $(`.alloc-select[data-test="${CSS.escape(t)}"]`);
          return { test: t, batchId: sel.value };
        });
        if (!assignments.length) { toast('至少勾选一个检测项目', 'error'); return; }
        const r = Store.allocate(s.id, assignments, currentOperator);
        if (!r.ok) { toast(r.message, 'error'); return; }
        toast(r.message, 'success'); closeModal(); renderAll();
      },
    },
  ]);
}

/* ---------- 拆分 ---------- */
function modalSplit(s) {
  openModal(`拆分样本 ${s.code}`, `
    <p class="hint">勾选进入 <b>子样本 1</b> 的项目，其余项目自动进入 <b>子样本 2</b>。父样本保留并标记「已拆分」，子件编号为 ${esc(s.code)}-1 / -2。</p>
    <label>子样本 1 的检测项目（多选，至少 1 项且不能全选）
      <select id="splitTests" multiple size="${Math.min(s.tests.length, 5)}">
        ${s.tests.map((t) => `<option>${esc(t)}</option>`).join('')}
      </select>
    </label>
    <label style="margin-top:10px">拆分原因（必填）
      <input type="text" id="splitReason" placeholder="如：不同项目分属不同检测批次">
    </label>`,
    [
      { key: 'cancel', label: '取消', onClick: closeModal },
      {
        key: 'confirm', label: '确认拆分', cls: 'btn-primary',
        onClick: () => {
          const g1 = [...$('#splitTests').selectedOptions].map((o) => o.value);
          const g2 = s.tests.filter((t) => !g1.includes(t));
          const reason = $('#splitReason').value.trim();
          if (!g1.length || !g2.length) { toast('两组都必须至少包含一个项目', 'error'); return; }
          if (!reason) { toast('请填写拆分原因', 'error'); return; }
          const r = Store.split(s.id, [g1, g2], reason, currentOperator);
          if (!r.ok) { toast(r.message, 'error'); return; }
          toast(r.message, 'success'); closeModal(); renderAll();
        },
      },
    ]);
}

/* ---------- 结果录入 / 修订 ---------- */
function modalEnterResult(sampleId, batchId) {
  const st = Store.get();
  const s = st.samples[sampleId];
  const b = st.batches[batchId];
  const test = b.test;
  const existing = s.results[test];
  const closed = b.status === 'closed';
  const nextVersion = existing ? existing.current + 1 : 1;
  const needReason = closed || !!existing;

  openModal(`${closed ? '关闭后补录（修订）' : existing ? '重测结果录入（修订）' : '结果录入'} · ${s.code}`, `
    <p class="hint">
      批次：<span class="mono">${esc(b.code)}</span>（${closed ? '已关闭' : '开放中'}） ·
      项目：${esc(test)} · 本次生成 <b>v${nextVersion}</b>
      ${existing ? `（当前 v${existing.current}：${esc(existing.versions[existing.current - 1].value)}，旧版本保留）` : ''}
    </p>
    <div class="form-grid">
      <label>结果数值 / 描述<input type="text" id="resValue" placeholder="如 WBC 11.8 / 阴性 / 5.62"></label>
      <label>单位<input type="text" id="resUnit" placeholder="如 10^9·L⁻¹（可留空）"></label>
      <label>结果判定
        <select id="resFlag">
          <option>正常</option><option>偏高</option><option>偏低</option>
          <option>阳性</option><option>阴性</option><option>危急值</option>
        </select>
      </label>
      <label>备注<input type="text" id="resNote" placeholder="可留空"></label>
    </div>
    ${needReason ? `
      <label style="margin-top:10px">${closed ? '补录/修订原因（必填，将写入修订记录与受影响汇总）' : '重测修订原因（必填）'}
        <textarea id="resReason" rows="3" placeholder="${closed ? '如：关闭后仪器复查发现偏差，校准后补录' : '如：更换试剂重新检测'}"></textarea>
      </label>` : ''}`,
    [
      { key: 'cancel', label: '取消', onClick: closeModal },
      {
        key: 'confirm', label: needReason ? '生成修订版本' : '确认录入', cls: needReason ? 'btn-danger' : 'btn-primary',
        onClick: () => {
          const payload = {
            value: $('#resValue').value,
            unit: $('#resUnit').value,
            flag: $('#resFlag').value,
            note: $('#resNote').value,
            revisionReason: needReason ? $('#resReason').value : '',
          };
          if (!payload.value.trim()) { toast('请填写结果', 'error'); return; }
          if (needReason && !payload.revisionReason.trim()) { toast('必须填写修订/补录原因', 'error'); return; }
          const r = Store.enterResult(sampleId, batchId, test, payload, currentOperator);
          if (!r.ok) { toast(r.message, 'error'); return; }
          toast(r.message, r.revised ? 'warn' : 'success'); closeModal(); renderAll();
        },
      },
    ]);
}

/* ============================================================
 * 事件委托
 * ============================================================ */
function handleActionClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const st = Store.get();

  switch (action) {
    case 'chain': openDrawer(id); break;
    case 'reject': modalReject(st.samples[id]); break;
    case 'retest': modalRetest(st.samples[id]); break;
    case 'allocate': modalAllocate(st.samples[id]); break;
    case 'split': modalSplit(st.samples[id]); break;
    case 'close-batch': {
      if (!confirm(`确认关闭批次 ${st.batches[id].code}？关闭后仍可补录，但会生成修订版本并提示受影响汇总。`)) return;
      const r = Store.closeBatch(id, currentOperator);
      toast(r.message, r.ok ? 'success' : 'error');
      renderAll();
      break;
    }
    case 'batch-detail': openBatchDetail(id); break;
    case 'enter-result': modalEnterResult(btn.dataset.sample, btn.dataset.batch); break;
    case 'resolve-keep': {
      const r = Store.resolvePending(id, 'keep-original', currentOperator, $(`#pnote-${id}`).value.trim());
      toast(r.message, r.ok ? 'success' : 'error');
      renderAll();
      break;
    }
    case 'resolve-new': {
      const r = Store.resolvePending(id, 'create-new', currentOperator, $(`#pnote-${id}`).value.trim());
      toast(r.message, r.ok ? 'success' : 'error');
      renderAll();
      break;
    }
  }
}

/* ---------- 重置 / 导出 ---------- */
function confirmReset() {
  if (!confirm('将清空当前全部本地数据并重新载入虚构演示数据，确定继续？')) return;
  Store.reset();
  $('#fSampledAt').value = Store.now();
  renderChips();
  renderAll();
  toast('已重置为虚构演示数据', 'success');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(Store.get(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lab-sample-station-backup-${Store.now().replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出 JSON 备份（本地文件，未上传任何服务器）');
}

document.addEventListener('DOMContentLoaded', init);
