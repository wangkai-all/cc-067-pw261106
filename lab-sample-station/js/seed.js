/* ============================================================
 * seed.js — 虚构演示数据
 * 所有人员、机构、样本编号与结果均为编造，仅用于流程演示。
 * ============================================================ */

const STORAGE_KEY = 'lab-sample-station-demo-v1';

const DEMO_OPERATORS = [
  { id: 'u1', name: '王雪', role: '样本接收岗' },
  { id: 'u2', name: '李晨', role: '批次组长' },
  { id: 'u3', name: '赵敏', role: '检验技师' },
  { id: 'u4', name: '陈立', role: '检验主管' },
];

const DEMO_SITES = ['急诊科', '发热门诊', '住院部', '门诊', '体检中心', '儿科', '心内科'];

const DEMO_TESTS = [
  '血常规', 'CRP', '尿常规', '尿微量白蛋白', '生化全套', '凝血四项',
  '糖化血红蛋白', '血脂四项', '空腹血糖', '核酸检测(HBV-DNA)',
];

/* 模拟条码芯片：扫码枪扫到的就是这里的完整样本载荷（虚构） */
const DEMO_BARCODES = [
  { code: 'S20261113-008', site: '发热门诊', sampledAt: '2026-11-13T09:02', tests: ['血常规', 'CRP'],
    tag: 'new', note: '新样本' },
  { code: 'S20261113-009', site: '体检中心', sampledAt: '2026-11-13T09:10', tests: ['生化全套'],
    tag: 'new', note: '新样本' },
  { code: 'S20261113-001', site: '发热门诊', sampledAt: '2026-11-13T08:05', tests: ['血常规', 'CRP'],
    tag: 'dup', note: '与在库样本完全一致 → 演示重复合并' },
  { code: 'S20261113-007', site: '急诊科', sampledAt: '2026-11-13T09:25', tests: ['尿常规', '尿微量白蛋白'],
    tag: 'conflict', note: '同编号但采样时间/项目冲突 → 演示待确认' },
];

const DEMO_CSV = [
  'sample_code,collection_site,sampled_at,tests',
  'S20261113-010,发热门诊,2026-11-13 09:32,血常规|CRP',
  'S20261113-011,住院部,2026-11-13 09:18,凝血四项',
  'S20261113-012,体检中心,2026-11-13 09:40,糖化血红蛋白|空腹血糖',
  'S20261113-001,发热门诊,2026-11-13 08:05,血常规|CRP',
  'S20261113-006,心内科,2026-11-13 08:10,血脂四项|空腹血糖',
].join('\n');

function buildSeedState() {
  let eventSeq = 100;
  const ev = (type, at, by, detail = {}) => ({ id: 'e' + (++eventSeq), type, at, by, detail });

  const samples = {};
  const put = (s) => { samples[s.id] = s; return s; };

  /* ---------- 昨日样本（已闭环，含拒收 / 重测 / 关闭后修订） ---------- */

  const s0101 = put({
    id: 's1', code: 'S20261112-001', site: '急诊科', sampledAt: '2026-11-12T09:12',
    tests: ['血常规'], status: 'completed', batchId: 'b1', parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-12T09:25', receivedBy: '王雪', rejectReason: null,
    results: {
      '血常规': {
        current: 1,
        versions: [{
          version: 1, value: 'WBC 6.2 / RBC 4.5 / HGB 138', unit: '10^9·L⁻¹ 等', flag: '正常',
          recordedAt: '2026-11-12T13:40', recordedBy: '赵敏', batchId: 'b1', note: '',
        }],
      },
    },
    events: [
      ev('receive', '2026-11-12T09:25', '王雪', { via: '条码扫描' }),
      ev('allocate', '2026-11-12T10:02', '李晨', { batchCode: 'B20261112-01' }),
      ev('result', '2026-11-12T13:40', '赵敏', { test: '血常规', version: 1, summary: 'WBC 6.2，全部正常' }),
    ],
  });

  const s0102 = put({
    id: 's2', code: 'S20261112-002', site: '住院部', sampledAt: '2026-11-12T08:50',
    tests: ['生化全套'], status: 'completed', batchId: 'b2', parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-12T09:20', receivedBy: '王雪', rejectReason: null,
    results: {
      '生化全套': {
        current: 2,
        versions: [
          { version: 1, value: 'K⁺ 4.1 / GLU 5.4 / ALT 22', unit: 'mmol·L⁻¹ 等', flag: '正常',
            recordedAt: '2026-11-12T14:30', recordedBy: '赵敏', batchId: 'b2', note: '初版结果' },
          { version: 2, value: 'K⁺ 4.3 / GLU 5.4 / ALT 22', unit: 'mmol·L⁻¹ 等', flag: '正常',
            recordedAt: '2026-11-13T08:40', recordedBy: '陈立', batchId: 'b2',
            note: '批次关闭后补录', revisionReason: '仪器复查发现钾离子偏差，重新校准后修订补录' },
        ],
      },
    },
    events: [
      ev('receive', '2026-11-12T09:20', '王雪', { via: 'CSV 导入' }),
      ev('allocate', '2026-11-12T10:05', '李晨', { batchCode: 'B20261112-02' }),
      ev('result', '2026-11-12T14:30', '赵敏', { test: '生化全套', version: 1, summary: '初版：K⁺ 4.1' }),
      ev('revise', '2026-11-13T08:40', '陈立', {
        test: '生化全套', fromVersion: 1, toVersion: 2,
        reason: '仪器复查发现钾离子偏差，重新校准后修订补录',
        batchClosed: true, batchCode: 'B20261112-02',
      }),
    ],
  });

  const s0103 = put({
    id: 's3', code: 'S20261112-003', site: '门诊', sampledAt: '2026-11-12T10:02',
    tests: ['尿常规'], status: 'rejected', batchId: null, parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-12T10:15', receivedBy: '王雪',
    rejectReason: '容器破损、样本渗漏，量不足无法检测', rejectedAt: '2026-11-12T10:18', rejectedBy: '王雪',
    results: {},
    events: [
      ev('receive', '2026-11-12T10:15', '王雪', { via: '条码扫描' }),
      ev('reject', '2026-11-12T10:18', '王雪', { reason: '容器破损、样本渗漏，量不足无法检测' }),
    ],
  });

  const s0104 = put({
    id: 's4', code: 'S20261112-004', site: '住院部', sampledAt: '2026-11-12T09:40',
    tests: ['凝血四项'], status: 'completed', batchId: 'b6', parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-12T09:55', receivedBy: '王雪', rejectReason: null,
    results: {
      '凝血四项': {
        current: 2,
        versions: [
          { version: 1, value: 'PT 17.8 / APTT 42.1', unit: 's', flag: '偏高',
            recordedAt: '2026-11-12T13:10', recordedBy: '赵敏', batchId: 'b1', note: '首次检测' },
          { version: 2, value: 'PT 13.2 / APTT 33.5', unit: 's', flag: '正常',
            recordedAt: '2026-11-12T14:50', recordedBy: '赵敏', batchId: 'b1',
            note: '重新检测', revisionReason: '首次结果异常，更换试剂后重新检测' },
        ],
      },
    },
    events: [
      ev('receive', '2026-11-12T09:55', '王雪', { via: '条码扫描' }),
      ev('allocate', '2026-11-12T10:08', '李晨', { batchCode: 'B20261112-03' }),
      ev('result', '2026-11-12T13:10', '赵敏', { test: '凝血四项', version: 1, summary: 'PT 17.8 偏高' }),
      ev('retest', '2026-11-12T14:20', '李晨', { reason: '首次结果异常，更换试剂后重新检测' }),
      ev('result', '2026-11-12T14:50', '赵敏', { test: '凝血四项', version: 2, summary: '复查正常' }),
    ],
  });

  /* 昨日重复到达 → 合并演示：S20261112-007 与 S20261112-006 完全一致，合并入 006 */
  const s0106 = put({
    id: 's5', code: 'S20261112-006', site: '体检中心', sampledAt: '2026-11-12T08:30',
    tests: ['糖化血红蛋白'], status: 'completed', batchId: 'b2', parentId: null, childIds: [],
    mergedFrom: ['S20261112-007'],
    receivedAt: '2026-11-12T09:02', receivedBy: '王雪', rejectReason: null,
    results: {
      '糖化血红蛋白': {
        current: 1,
        versions: [{
          version: 1, value: 'HbA1c 5.9', unit: '%', flag: '正常',
          recordedAt: '2026-11-12T14:05', recordedBy: '赵敏', batchId: 'b2', note: '',
        }],
      },
    },
    events: [
      ev('receive', '2026-11-12T09:02', '王雪', { via: '条码扫描' }),
      ev('merge', '2026-11-12T09:34', '王雪', {
        duplicateCode: 'S20261112-007',
        basis: '同编号 + 采样时间 2026-11-12 08:30 一致 + 检测项目（糖化血红蛋白）一致',
      }),
      ev('allocate', '2026-11-12T10:05', '李晨', { batchCode: 'B20261112-02' }),
      ev('result', '2026-11-12T14:05', '赵敏', { test: '糖化血红蛋白', version: 1, summary: 'HbA1c 5.9%' }),
    ],
  });

  /* ---------- 今日样本（在途，覆盖分批 / 拒收 / 拆分 / 待分配） ---------- */

  const s0201 = put({
    id: 's6', code: 'S20261113-001', site: '发热门诊', sampledAt: '2026-11-13T08:05',
    tests: ['血常规', 'CRP'], status: 'batched', batchId: 'b3', parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T08:20', receivedBy: '王雪', rejectReason: null, results: {},
    events: [
      ev('receive', '2026-11-13T08:20', '王雪', { via: '条码扫描' }),
      ev('allocate', '2026-11-13T08:45', '李晨', { batchCode: 'B20261113-01', test: '血常规' }),
      ev('allocate', '2026-11-13T08:45', '李晨', { batchCode: 'B20261113-02', test: 'CRP' }),
    ],
  });

  const s0202 = put({
    id: 's7', code: 'S20261113-002', site: '体检中心', sampledAt: '2026-11-13T08:15',
    tests: ['生化全套'], status: 'received', batchId: null, parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T08:32', receivedBy: '王雪', rejectReason: null, results: {},
    events: [
      ev('receive', '2026-11-13T08:32', '王雪', { via: 'CSV 导入' }),
    ],
  });

  const s0203 = put({
    id: 's8', code: 'S20261113-003', site: '住院部', sampledAt: '2026-11-13T07:58',
    tests: ['凝血四项'], status: 'rejected', batchId: null, parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T08:25', receivedBy: '王雪',
    rejectReason: '抗凝管采血量不足（标识线以下），不符合凝血检测要求',
    rejectedAt: '2026-11-13T08:29', rejectedBy: '王雪', results: {},
    events: [
      ev('receive', '2026-11-13T08:25', '王雪', { via: '条码扫描' }),
      ev('reject', '2026-11-13T08:29', '王雪', { reason: '抗凝管采血量不足（标识线以下），不符合凝血检测要求' }),
    ],
  });

  /* 拆分演示：父样本 004 含三个项目，按项目拆成两个子样本，父样本保留 */
  const s0204p = put({
    id: 's9', code: 'S20261113-004', site: '门诊', sampledAt: '2026-11-13T08:10',
    tests: ['血常规', 'CRP', '尿常规'], status: 'split', batchId: null,
    parentId: null, childIds: ['s10', 's11'], mergedFrom: [],
    receivedAt: '2026-11-13T08:28', receivedBy: '王雪', rejectReason: null, results: {},
    events: [
      ev('receive', '2026-11-13T08:28', '王雪', { via: '条码扫描' }),
      ev('split', '2026-11-13T09:02', '李晨', {
        reason: '不同项目分属不同检测批次，按项目拆分',
        children: ['S20261113-004-1（血常规）', 'S20261113-004-2（CRP、尿常规）'],
      }),
    ],
  });

  const s0204c1 = put({
    id: 's10', code: 'S20261113-004-1', site: '门诊', sampledAt: '2026-11-13T08:10',
    tests: ['血常规'], status: 'batched', batchId: 'b3',
    parentId: 's9', childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T09:02', receivedBy: '李晨', rejectReason: null, results: {},
    events: [
      ev('split', '2026-11-13T09:02', '李晨', { parentCode: 'S20261113-004', reason: '按检测项目拆分' }),
      ev('allocate', '2026-11-13T09:05', '李晨', { batchCode: 'B20261113-01' }),
    ],
  });

  const s0204c2 = put({
    id: 's11', code: 'S20261113-004-2', site: '门诊', sampledAt: '2026-11-13T08:10',
    tests: ['CRP', '尿常规'], status: 'batched', batchId: 'b4',
    parentId: 's9', childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T09:02', receivedBy: '李晨', rejectReason: null, results: {},
    events: [
      ev('split', '2026-11-13T09:02', '李晨', { parentCode: 'S20261113-004', reason: '按检测项目拆分' }),
      ev('allocate', '2026-11-13T09:05', '李晨', { batchCode: 'B20261113-02', test: 'CRP' }),
    ],
  });

  const s0205 = put({
    id: 's12', code: 'S20261113-005', site: '门诊', sampledAt: '2026-11-13T08:35',
    tests: ['核酸检测(HBV-DNA)'], status: 'batched', batchId: 'b5',
    parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T08:50', receivedBy: '王雪', rejectReason: null, results: {},
    events: [
      ev('receive', '2026-11-13T08:50', '王雪', { via: '条码扫描' }),
      ev('allocate', '2026-11-13T09:10', '李晨', { batchCode: 'B20261113-03' }),
    ],
  });

  const s0206 = put({
    id: 's13', code: 'S20261113-006', site: '心内科', sampledAt: '2026-11-13T07:50',
    tests: ['血脂四项'], status: 'received', batchId: null,
    parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T08:12', receivedBy: '王雪', rejectReason: null, results: {},
    events: [
      ev('receive', '2026-11-13T08:12', '王雪', { via: '条码扫描' }),
      ev('conflict', '2026-11-13T09:40', '王雪', {
        reason: '同编号样本再次到达，采样时间与检测项目均不一致，已转待确认，原始记录未修改',
        pendingId: 'p1',
      }),
    ],
  });

  const s0207 = put({
    id: 's14', code: 'S20261113-007', site: '儿科', sampledAt: '2026-11-13T08:20',
    tests: ['尿常规'], status: 'received', batchId: null,
    parentId: null, childIds: [], mergedFrom: [],
    receivedAt: '2026-11-13T08:40', receivedBy: '王雪', rejectReason: null, results: {},
    events: [
      ev('receive', '2026-11-13T08:40', '王雪', { via: '条码扫描' }),
    ],
  });

  /* ---------- 批次 ---------- */
  const batches = {
    b1: {
      id: 'b1', code: 'B20261112-01', test: '血常规', status: 'closed',
      createdAt: '2026-11-12T10:02', createdBy: '李晨',
      closedAt: '2026-11-12T15:20', closedBy: '李晨',
      sampleIds: ['s1'], revisions: [],
      events: [
        ev('create_batch', '2026-11-12T10:02', '李晨', {}),
        ev('close', '2026-11-12T15:20', '李晨', { sampleCount: 1 }),
      ],
    },
    b6: {
      id: 'b6', code: 'B20261112-03', test: '凝血四项', status: 'closed',
      createdAt: '2026-11-12T10:08', createdBy: '李晨',
      closedAt: '2026-11-12T15:30', closedBy: '李晨',
      sampleIds: ['s4'], revisions: [],
      events: [
        ev('create_batch', '2026-11-12T10:08', '李晨', {}),
        ev('close', '2026-11-12T15:30', '李晨', { sampleCount: 1 }),
      ],
    },
    b2: {
      id: 'b2', code: 'B20261112-02', test: '生化全套', status: 'closed',
      createdAt: '2026-11-12T10:05', createdBy: '李晨',
      closedAt: '2026-11-12T15:25', closedBy: '李晨',
      sampleIds: ['s2', 's5'],
      revisions: [
        {
          id: 'r1', sampleId: 's2', sampleCode: 'S20261112-002', test: '生化全套',
          version: 2, at: '2026-11-13T08:40', by: '陈立',
          reason: '仪器复查发现钾离子偏差，重新校准后修订补录',
          summaryImpact: '批次 K⁺ 均值由 4.1 mmol·L⁻¹ 修订为 4.3 mmol·L⁻¹；异常项数量不变（0 项）',
        },
      ],
      events: [
        ev('create_batch', '2026-11-12T10:05', '李晨', {}),
        ev('close', '2026-11-12T15:25', '李晨', { sampleCount: 2 }),
        ev('revise', '2026-11-13T08:40', '陈立', { sampleCode: 'S20261112-002', toVersion: 2 }),
      ],
    },
    b3: {
      id: 'b3', code: 'B20261113-01', test: '血常规', status: 'open',
      createdAt: '2026-11-13T08:45', createdBy: '李晨',
      closedAt: null, closedBy: null,
      sampleIds: ['s6', 's10'], revisions: [],
      events: [ev('create_batch', '2026-11-13T08:45', '李晨', {})],
    },
    b4: {
      id: 'b4', code: 'B20261113-02', test: 'CRP', status: 'open',
      createdAt: '2026-11-13T08:45', createdBy: '李晨',
      closedAt: null, closedBy: null,
      sampleIds: ['s6', 's11'], revisions: [],
      events: [ev('create_batch', '2026-11-13T08:45', '李晨', {})],
    },
    b5: {
      id: 'b5', code: 'B20261113-03', test: '核酸检测(HBV-DNA)', status: 'open',
      createdAt: '2026-11-13T09:10', createdBy: '李晨',
      closedAt: null, closedBy: null,
      sampleIds: ['s12'], revisions: [],
      events: [ev('create_batch', '2026-11-13T09:10', '李晨', {})],
    },
  };

  /* ---------- 待确认（信息冲突，原始样本 s13 保持不变） ---------- */
  const pending = {
    p1: {
      id: 'p1', code: 'S20261113-006', status: 'open', reason: 'same-code-conflict',
      original: {
        sampleId: 's13', site: '心内科', sampledAt: '2026-11-13T07:50',
        tests: ['血脂四项'], arrivedAt: '2026-11-13T08:12', arrivedBy: '王雪',
      },
      incoming: {
        site: '心内科', sampledAt: '2026-11-13T08:10',
        tests: ['血脂四项', '空腹血糖'], arrivedAt: '2026-11-13T09:40', arrivedBy: '王雪',
        diffs: ['采样时间不一致（07:50 → 08:10）', '检测项目不一致（新增：空腹血糖）'],
      },
      resolution: null,
    },
  };

  return {
    meta: { version: 1, seededAt: '2026-11-13T09:45:00', demo: true },
    seq: { sample: 14, batch: 3, event: eventSeq, pending: 1, revision: 1 },
    operators: DEMO_OPERATORS,
    sites: DEMO_SITES,
    tests: DEMO_TESTS,
    barcodes: DEMO_BARCODES,
    csvTemplate: DEMO_CSV,
    samples,
    batches,
    pending,
  };
}
