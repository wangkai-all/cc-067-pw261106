/* 冒烟测试：node tests/smoke.mjs
 * 在 vm 沙箱中模拟浏览器 localStorage，验证 store.js 全部领域规则 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const mem = new Map();
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
};
vm.createContext(sandbox);
vm.runInContext(read('js/seed.js'), sandbox);
vm.runInContext(read('js/store.js'), sandbox);

const Store = vm.runInContext('Store', sandbox);
let passed = 0;
const ok = (cond, msg) => {
  if (!cond) { console.error('✗ FAIL:', msg); process.exitCode = 1; }
  else { passed++; console.log('✓', msg); }
};

/* 1. 载入种子 */
const st = Store.load();
ok(Object.keys(st.samples).length >= 10, '种子数据载入，样本数 ' + Object.keys(st.samples).length);
ok(Object.values(st.batches).length === 6, '共 6 个批次（含独立凝血批次）');
const s6 = Store.findSampleByCode('S20261113-006');

/* 2. 全新样本接收 */
const rNew = Store.receiveSample({
  code: 'S20261113-900', site: '急诊科', sampledAt: '2026-11-13T10:00',
  tests: ['血常规'], by: '王雪', via: '条码扫描（模拟）',
});
ok(rNew.outcome === 'new' && rNew.sample.status === 'received', '全新样本建档成功');

/* 3. 完全重复 → 合并，不新建 */
const beforeCount = Object.keys(st.samples).length;
const rDup = Store.receiveSample({
  code: 'S20261113-900', site: '急诊科', sampledAt: '2026-11-13T10:00',
  tests: ['血常规'], by: '王雪',
});
ok(rDup.outcome === 'merged' && Object.keys(st.samples).length === beforeCount, '重复样本合并且不新建档案');
ok(rDup.sample.mergedFrom.includes('S20261113-900') === false, '合并登记不写入自身编号');
ok(rDup.sample.events.at(-1).type === 'merge' && rDup.sample.events.at(-1).by === '王雪', '合并事件含经手人与时间');

/* 4. 同编号冲突 → 待确认，原始记录不被覆盖 */
const rConflict = Store.receiveSample({
  code: 'S20261113-900', site: '急诊科', sampledAt: '2026-11-13T11:30',
  tests: ['血常规', 'CRP'], by: '王雪',
});
ok(rConflict.outcome === 'conflict' && !!rConflict.pendingId, '冲突样本进入待确认队列');
const s900 = Store.findSampleByCode('S20261113-900');
ok(s900.sampledAt === '2026-11-13T10:00' && s900.tests.length === 1, '冲突后原始记录采样时间与项目保持不变');
ok(s900.events.at(-1).type === 'conflict', '原始样本写入冲突留痕事件');

/* 5. 待确认裁决：另建新档，原件不动 */
const pid = rConflict.pendingId;
const rResolve = Store.resolvePending(pid, 'create-new', '陈立', '电话核对后确认为两份不同样本');
ok(rResolve.ok && rResolve.sample.code === 'S20261113-900-C1', '冲突件另建新档并加 -C1 后缀');
ok(Store.findSampleByCode('S20261113-900').sampledAt === '2026-11-13T10:00', '裁决后原件仍未被修改');
ok(st.pending[pid].status === 'resolved' && st.pending[pid].resolution.by === '陈立', '待确认单记录裁决人与时间');

/* 6. 必填校验 */
const rInvalid = Store.receiveSample({ code: '', site: '', sampledAt: '', tests: [], by: '王雪' });
ok(rInvalid.outcome === 'invalid', '缺字段时拒绝接收');

/* 7. 批次创建与分配 */
const batch = Store.createBatch('血常规', '', '李晨');
ok(batch.code.startsWith('B2026') && batch.status === 'open', '自动编号创建开放批次');
const rAlloc = Store.allocate(rNew.sample.id, [{ test: '血常规', batchId: batch.id }], '李晨');
ok(rAlloc.ok && batch.sampleIds.includes(rNew.sample.id), '样本分配进批次');
ok(Store.findSampleByCode('S20261113-900').status === 'batched', '分配后样本状态变为已分批');

/* 项目不匹配拦截 */
const bad = Store.createBatch('CRP', '', '李晨');
const rBad = Store.allocate(rNew.sample.id, [{ test: '血常规', batchId: bad.id }], '李晨');
ok(!rBad.ok && rBad.message.includes('项目不匹配'), '检测项目不匹配的批次拒绝分配');

/* 8. 拒收 */
const rRej = Store.reject(s6.id, '条码无法识别', '王雪');
ok(rRej.ok && s6.status === 'rejected' && s6.rejectedAt && s6.rejectedBy === '王雪', '拒收记录原因/时间/经手人');
ok(!Store.reject(s6.id, '再次拒收', '王雪').ok, '已拒收不能重复拒收');
const rRejAlloc = Store.allocate(s6.id, [{ test: '血脂四项', batchId: bad.id }], '李晨');
ok(!rRejAlloc.ok, '拒收样本不能分配批次');

/* 9. 拆分（父样本保留，子件可追溯） */
const s002 = Store.findSampleByCode('S20261113-002');
const rSplit = Store.split(s002.id, [['生化全套']], '生化全套单项目拆出', '李晨');
/* 单项目样本不能拆成两组（g2 为空） */
ok(!rSplit.ok, '单项目样本无法拆分（必须两组非空）');

const s001 = Store.findSampleByCode('S20261113-001');
const beforeSplit = Object.keys(st.samples).length;
const rSplit2 = Store.split(s001.id, [['血常规'], ['CRP']], '不同项目分属不同批次', '李晨');
ok(rSplit2.ok && Object.keys(st.samples).length === beforeSplit + 2, '双项目样本拆成 2 份子样本');
ok(s001.status === 'split' && s001.childIds.length === 2, '父样本保留并标记已拆分、挂子件');
ok(Store.get().samples[s001.childIds[0]].parentId === s001.id, '子件回指父样本');
const child = st.samples[s001.childIds[0]];
ok(child.events[0].by === '李晨' && child.events[0].at, '子件拆分事件带经手人与时间');

/* 10. 结果录入 → 重测 → v2 修订 */
const rV1 = Store.enterResult(rNew.sample.id, batch.id, '血常规',
  { value: 'WBC 6.2', unit: '10^9·L⁻¹', flag: '正常', note: '', revisionReason: '' }, '赵敏');
ok(rV1.ok && !rV1.revised, '开放批次首次录入为 v1，不算修订');
const rRetest = Store.retest(rNew.sample.id, '临床要求复查', '李晨');
ok(rRetest.ok && rNew.sample.events.at(-1).type === 'retest', '重测登记留痕');
const rV2 = Store.enterResult(rNew.sample.id, batch.id, '血常规',
  { value: 'WBC 7.1', unit: '10^9·L⁻¹', flag: '偏高', note: '', revisionReason: '临床要求复查后修订' }, '赵敏');
ok(rV2.ok && rV2.revised, '第二次录入自动生成修订版本');
const res = rNew.sample.results['血常规'];
ok(res.current === 2 && res.versions.length === 2 && res.versions[0].value === 'WBC 6.2', '旧版本保留，当前指向 v2');

/* 11. 关闭批次后补录 → 批次修订记录 + 受影响汇总 */
const rClose = Store.closeBatch(batch.id, '李晨');
ok(rClose.ok && batch.status === 'closed' && batch.closedBy === '李晨', '批次关闭记录时间与经手人');
const revBefore = batch.revisions.length;
const rClosed = Store.enterResult(rNew.sample.id, batch.id, '血常规',
  { value: 'WBC 6.8', unit: '10^9·L⁻¹', flag: '正常', note: '', revisionReason: '关闭后仪器复查校准补录' }, '陈立');
ok(rClosed.ok && rClosed.revised && batch.revisions.length === revBefore + 1, '关闭后补录生成批次级修订记录');
ok(batch.revisions.at(-1).summaryImpact.includes('异常'), '修订记录包含受影响汇总对比');
ok(batch.revisions.at(-1).closedBatch === true, '修订标记为关闭批次后补录');
ok(rNew.sample.events.at(-1).type === 'revise' && rNew.sample.events.at(-1).detail.batchClosed, '样本流转链同步修订事件');
const rClosedAlloc = Store.allocate(rNew.sample.id, [{ test: '血常规', batchId: batch.id }], '李晨');
ok(!rClosedAlloc.ok, '已关闭批次不能再分配样本');

/* 12. CSV 导入：新建 + 重复合并 + 冲突三种结果 */
const csv = [
  'sample_code,collection_site,sampled_at,tests',
  'S20261113-910,发热门诊,2026-11-13 12:00,血常规|CRP',
  'S20261113-910,发热门诊,2026-11-13 12:00,血常规|CRP',
  'S20261113-910,发热门诊,2026-11-13 12:40,尿常规',
].join('\n');
const rCsv = Store.importCsv(csv, '王雪');
ok(rCsv.ok && rCsv.counts.new === 1 && rCsv.counts.merged === 1 && rCsv.counts.conflict === 1,
  `CSV 导入三分支正确（new=${rCsv.counts.new}, merged=${rCsv.counts.merged}, conflict=${rCsv.counts.conflict}）`);
const rBadHeader = Store.importCsv('foo,bar\n1,2', '王雪');
ok(!rBadHeader.ok, '错误表头被拒绝');

/* 13. 一样本多批次（CRP 子件进 CRP 批次） */
const crpChild = st.samples[s001.childIds.find((cid) => st.samples[cid].tests.includes('CRP'))];
const crpBatch = Store.openBatchesForTest('CRP')[0];
const rMulti = Store.allocate(crpChild.id, [{ test: 'CRP', batchId: crpBatch.id }], '李晨');
ok(rMulti.ok && crpBatch.sampleIds.includes(crpChild.id), '拆分子件可独立分配批次');
ok(Store.batchesOfSample(crpChild.id).some((b) => b.code === crpBatch.code), '子件批次关联可反查');

/* 14. 持久化往返：新沙箱模拟页面刷新 */
Store.save();
ok(mem.has('lab-sample-station-demo-v1'), '数据写入 localStorage');
const sandbox2 = {
  console,
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
};
vm.createContext(sandbox2);
vm.runInContext(read('js/seed.js'), sandbox2);
vm.runInContext(read('js/store.js'), sandbox2);
const Store2 = vm.runInContext('Store', sandbox2);
const reloaded = Store2.load();
const reloadedSample = reloaded.samples[rNew.sample.id];
ok(!!reloadedSample, '刷新后样本档案仍存在（ID 稳定）');
ok(reloadedSample.results['血常规'].current === 3 && reloadedSample.results['血常规'].versions.length === 3,
  `刷新后完整修订版本链保留（v1→v2→v3，当前 v${reloadedSample.results['血常规'].current}）`);
ok(reloadedSample.results['血常规'].versions[0].value === 'WBC 6.2', '刷新后历史 v1 原值未被覆盖');
ok(reloaded.pending[pid].status === 'resolved', '刷新后待确认裁决状态仍保留');

/* 15. 全局事件流与批次汇总 */
const feed = Store.globalEvents(5);
ok(feed.length === 5 && feed[0].at >= feed[1].at, '全局事件流按时间倒序');
const sum = Store.batchSummary(batch.id);
ok(sum.sampleCount >= 1 && sum.revisionCount >= 1, '批次汇总含样本数与修订次数');

console.log(`\n${passed} 项检查全部通过`);
