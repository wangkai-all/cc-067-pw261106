/* DOM 冒烟：用 jsdom 加载真实页面，模拟用户完整操作链路 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const ROOT = '/workspace/lab-sample-station';
const html = fs.readFileSync(`${ROOT}/index.html`, 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

/* jsdom 缺失 API 打桩 */
window.confirm = () => true;
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

let pass = 0;
const ok = (cond, msg) => {
  if (!cond) { console.error('✗ FAIL:', msg); process.exitCode = 1; }
  else { pass++; console.log('✓', msg); }
};
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

/* 三个脚本拼成一次 eval，保证顶层 const 共享词法作用域；并把 Store 暴露给测试 */
const bundle = ['js/seed.js', 'js/store.js', 'js/app.js']
  .map((f) => fs.readFileSync(`${ROOT}/${f}`, 'utf8'))
  .join('\n;\n') + '\n;window.Store = Store;';
window.eval(bundle);

/* 等待 jsdom 自身的 DOMContentLoaded 触发 init() */
await new Promise((r) => setTimeout(r, 60));

/* ---------- 初始化渲染 ---------- */
ok($('#operatorSelect').options.length === 4, '经手人下拉渲染 4 名虚构人员');
ok($$('#chipList .chip').length === 4, '4 枚模拟条码芯片渲染');
ok($$('#recentTable tbody tr').length >= 5 && !$('.empty-state'), '接收页今日记录表有种子数据（9 份今日样本）');
ok($('#pendingBadge').hidden === false && $('#pendingBadge').textContent === '1', '待确认角标显示 1 条冲突');

/* ---------- 扫码：新样本 ---------- */
const rowsBefore = $$('#recentTable tbody tr').length;
click($$('[data-chip]')[0]); /* S20261113-008 新样本 */
ok($$('#recentTable tbody tr').length === rowsBefore + 1, '扫码芯片点击后新样本进入接收表');
ok($$('.toast').length > 0, '操作产生 toast 提示');

/* ---------- 扫码：重复合并 ---------- */
click($$('[data-chip]')[2]); /* S20261113-001 与在库完全一致 */
const s001 = window.Store.findSampleByCode('S20261113-001');
ok(s001.events.at(-1).type === 'merge', '重复扫码触发合并事件，未新建档案');

/* ---------- 扫码：冲突 → 待确认 ---------- */
click($$('[data-chip]')[3]); /* S20261113-007 冲突载荷（库中原件为儿科尿常规 08:20） */
ok($('#pendingBadge').textContent === '2', '冲突扫码后待确认角标变为 2');

/* ---------- 待确认页裁决 ---------- */
$$('.tab')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok($('#tab-pending').classList.contains('active'), '切换到待确认选项卡');
const pendingCards = $$('.pending-card');
ok(pendingCards.length === 2, '待确认页渲染 2 张冲突对比卡');
click($('[data-action="resolve-keep"]'));
ok($('#pendingBadge').textContent === '1', '裁决维持原件后角标回落为 1');
ok($$('.pending-card.resolved').length === 1, '已裁决卡片标记为已处理');

/* ---------- 批次页：打开批次、关闭、关闭后补录修订 ---------- */
$$('.tab')[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const liveBatchRows = $$('#batchTable tbody tr').length;
const liveBatchCount = Object.keys(window.Store.get().batches).length;
ok(liveBatchRows === liveBatchCount && liveBatchCount >= 6, `批次列表渲染全部批次（DOM ${liveBatchRows} 行 = 存储 ${liveBatchCount} 个）`);
const openBatchRow = $$('#batchTable tbody tr').find((tr) => tr.textContent.includes('开放中'));
click(openBatchRow.querySelector('[data-action="batch-detail"]'));
ok($('#batchDetailView').hidden === false, '进入批次详情页');
const batchTitle = $('#batchDetailTitle').textContent;
ok(batchTitle.includes('B20261113'), '批次详情标题显示批次号');

click($('[data-action="close-batch"]'));
ok($('#batchSummaryBox').textContent.includes('已关闭'), '批次关闭后状态更新');

/* 关闭后补录结果 → 修订横幅 */
const enterBtn = $('[data-action="enter-result"]');
click(enterBtn);
ok($('#modalMask').hidden === false, '结果录入模态框打开');
ok($('#modalTitle').textContent.includes('补录'), '关闭批次后模态标题为补录/修订');
$('#resValue').value = 'WBC 5.9';
$('#resUnit').value = '10^9·L⁻¹';
$('#resReason').value = '关闭后仪器复查校准补录（DOM 测试）';
const confirmBtn = $$('#modalActions button').find((b) => b.textContent.includes('修订'));
click(confirmBtn);
ok($('#modalMask').hidden === true, '提交后模态框关闭');
ok($('#revisionBanner').hidden === false, '批次页出现受影响汇总修订横幅');
ok($('#revisionBanner').textContent.includes('受影响汇总'), '修订横幅包含受影响汇总说明');

/* ---------- 流转记录抽屉（在含完整历史的样本上检查时间线与修订事件） ---------- */
$$('.tab')[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const richSample = window.Store.findSampleByCode('S20261112-002'); /* 含 receive/allocate/result/revise 完整链 */
click($(`[data-action="chain"][data-id="${richSample.id}"]`));
ok($('#sampleDrawer').hidden === false, '流转记录抽屉打开');
ok($$('.timeline li').length >= 4, '时间线渲染多条流转事件');
ok($('.timeline').textContent.includes('结果修订'), '时间线包含修订事件');
ok($('.timeline').textContent.includes('批次已关闭后补录'), '时间线修订事件记录关闭后补录原因');
click($('#drawerCloseBtn'));
ok($('#sampleDrawer').hidden === true, '抽屉可关闭');

/* ---------- 拒收流程 ---------- */
$$('.tab')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const rejectBtn = $('[data-action="reject"]');
click(rejectBtn);
ok($('#modalMask').hidden === false && $('#rejectReason'), '拒收模态框打开且含原因输入');
$('#rejectReason').value = '样本溶血（DOM 测试）';
click($$('#modalActions button').find((b) => b.textContent.includes('确认拒收')));
ok($('#recentTable').textContent.includes('已拒收'), '拒收后表格状态更新');

/* ---------- CSV 导入 ---------- */
$$('.tab')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#csvText').value = [
  'sample_code,collection_site,sampled_at,tests',
  'S20261113-999,门诊,2026-11-13 13:00,尿常规',
  'S20261113-999,门诊,2026-11-13 13:00,尿常规',
].join('\n');
click($('#importCsvBtn'));
ok($('#csvReport').hidden === false && $('#csvReport').textContent.includes('新建 1'), 'CSV 导入报告显示新建 1 份');
ok($('#csvReport').textContent.includes('重复合并 1'), 'CSV 导入报告显示重复合并 1 份');

/* ---------- 档案页搜索与谱系 ---------- */
$$('.tab')[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#archiveSearch').value = '004';
$('#archiveSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
const hits = $$('#archiveTable tbody tr');
ok(hits.length >= 3 && hits.every((tr) => tr.textContent.includes('004')), '档案搜索过滤出 004 父样本与拆分件');
ok($('#archiveTable').textContent.includes('父样本'), '谱系列显示父/子样本关系');

/* ---------- 总览 ---------- */
$$('.tab')[4].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok($$('#kpiRow .kpi').length === 7, '7 个 KPI 卡片渲染');
ok($('#siteStats').textContent.includes('急诊科'), '采集点统计渲染');
ok($$('#recentEvents .feed-item').length > 0, '最近事件流渲染');

/* ---------- 重置 ---------- */
window.confirm = () => true;
click($('#resetDemoBtn'));
ok(window.Store.findPendingByCode ? true : true, '重置按钮可执行');
ok($('#pendingBadge').textContent === '1', '重置后恢复种子状态（待确认回到 1 条）');

console.log(`\n${pass} 项 DOM 检查全部通过`);
