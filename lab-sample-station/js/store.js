/* ============================================================
 * store.js — 状态持久化与领域操作
 * 数据只保存在浏览器 localStorage，不发起任何网络请求。
 * ============================================================ */

const Store = (() => {
  let state = null;

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        return state;
      }
    } catch (err) {
      console.warn('读取本地数据失败，使用演示数据', err);
    }
    state = buildSeedState();
    save();
    return state;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function reset() {
    state = buildSeedState();
    save();
    return state;
  }

  function get() { return state; }

  /* ---------- 工具 ---------- */
  function now() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function nextEvent(by, type, detail) {
    state.seq.event += 1;
    return { id: 'e' + state.seq.event, type, at: now(), by, detail: detail || {} };
  }

  function findSampleByCode(code) {
    return Object.values(state.samples).find((s) => s.code === code) || null;
  }

  function findPendingByCode(code) {
    return Object.values(state.pending).find((p) => p.code === code && p.status === 'open') || null;
  }

  function addEvent(sample, type, by, detail) {
    sample.events.push(nextEvent(by, type, detail));
  }

  function sameTestSet(a, b) {
    const sa = new Set(a), sb = new Set(b);
    return sa.size === sb.size && [...sa].every((t) => sb.has(t));
  }

  /* ============================================================
   * 接收样本：同编号 → 比采样时间与项目
   *  完全一致 → 合并（不建档，只记事件）
   *  存在冲突 → 待确认队列，原始记录只读
   * ============================================================ */
  function receiveSample(input) {
    const code = (input.code || '').trim();
    const site = (input.site || '').trim();
    const sampledAt = (input.sampledAt || '').trim();
    const tests = [...new Set((input.tests || []).map((t) => t.trim()).filter(Boolean))];
    const by = input.by;
    const via = input.via || '手动录入';

    if (!code || !site || !sampledAt || tests.length === 0) {
      return { outcome: 'invalid', message: '编号、采集点、采样时间、检测项目均为必填' };
    }

    const existing = findSampleByCode(code);

    if (existing) {
      const sameTime = existing.sampledAt === sampledAt || existing.sampledAt.startsWith(sampledAt) || sampledAt.startsWith(existing.sampledAt);
      const sameTests = sameTestSet(existing.tests, tests);

      if (sameTime && sameTests) {
        /* 确属重复 → 合并（重复件编号与本档不同才登记，避免自身编号入档） */
        if (!existing.mergedFrom.includes(code) && code !== existing.code) existing.mergedFrom.push(code);
        addEvent(existing, 'merge', by, {
          duplicateCode: code,
          basis: `同编号 + 采样时间（${fmtTime(sampledAt)}）一致 + 检测项目（${tests.join('、')}）一致`,
          via,
        });
        save();
        return {
          outcome: 'merged',
          message: `重复样本已合并到 ${code}，未新建档案`,
          sample: existing,
        };
      }

      /* 信息冲突 → 待确认，绝不覆盖原始记录 */
      const diffs = [];
      if (!sameTime) diffs.push(`采样时间不一致（原始 ${fmtTime(existing.sampledAt)} → 新到 ${fmtTime(sampledAt)}）`);
      if (!sameTests) {
        const added = tests.filter((t) => !existing.tests.includes(t));
        const removed = existing.tests.filter((t) => !tests.includes(t));
        if (added.length) diffs.push(`检测项目新增：${added.join('、')}`);
        if (removed.length) diffs.push(`检测项目缺失：${removed.join('、')}`);
      }
      state.seq.pending += 1;
      const pid = 'p' + state.seq.pending;
      state.pending[pid] = {
        id: pid, code, status: 'open', reason: 'same-code-conflict',
        original: {
          sampleId: existing.id, site: existing.site, sampledAt: existing.sampledAt,
          tests: [...existing.tests], arrivedAt: existing.receivedAt, arrivedBy: existing.receivedBy,
        },
        incoming: {
          site, sampledAt, tests, arrivedAt: now(), arrivedBy: by, diffs,
        },
        resolution: null,
      };
      addEvent(existing, 'conflict', by, {
        reason: '同编号样本再次到达且信息不一致，已转待确认，原始记录未修改',
        pendingId: pid, via,
      });
      save();
      return {
        outcome: 'conflict',
        message: `编号 ${code} 信息冲突，已放入待确认队列，原始记录保持不变`,
        pendingId: pid, sample: existing,
      };
    }

    /* 全新样本建档 */
    state.seq.sample += 1;
    const id = 's' + state.seq.sample;
    const sample = {
      id, code, site, sampledAt, tests,
      status: 'received', batchId: null,
      parentId: null, childIds: [], mergedFrom: [],
      receivedAt: now(), receivedBy: by,
      rejectReason: null, results: {},
      events: [nextEvent(by, 'receive', { via })],
    };
    state.samples[id] = sample;
    save();
    return { outcome: 'new', message: `样本 ${code} 已建档接收`, sample };
  }

  /* ---------- 待确认裁决：只能保留原件或另建新档，均留痕 ---------- */
  function resolvePending(pid, action, by, note) {
    const p = state.pending[pid];
    if (!p || p.status !== 'open') return { ok: false, message: '待确认记录不存在或已处理' };
    const original = state.samples[p.original.sampleId];

    if (action === 'keep-original') {
      p.status = 'resolved';
      p.resolution = { action: 'keep-original', at: now(), by, note: note || '' };
      if (original) {
        addEvent(original, 'pending_resolve', by, {
          pendingId: pid, result: '维持原始记录，新到样本不予合并', note: note || '',
        });
      }
      save();
      return { ok: true, message: '已维持原始记录，冲突到达件按拒收/退回处理并留痕' };
    }

    if (action === 'create-new') {
      /* 另建新档：编号加后缀，绝不覆盖原件 */
      state.seq.sample += 1;
      const newId = 's' + state.seq.sample;
      let suffix = 1;
      let newCode = `${p.code}-C${suffix}`;
      while (findSampleByCode(newCode)) { suffix += 1; newCode = `${p.code}-C${suffix}`; }
      const sample = {
        id: newId, code: newCode,
        site: p.incoming.site, sampledAt: p.incoming.sampledAt, tests: [...p.incoming.tests],
        status: 'received', batchId: null,
        parentId: null, childIds: [], mergedFrom: [],
        receivedAt: now(), receivedBy: by,
        rejectReason: null, results: {},
        events: [
          nextEvent(by, 'receive', { via: '待确认裁决另建档', conflictOf: p.code }),
          nextEvent(by, 'pending_resolve', {
            pendingId: pid, result: `信息冲突无法合并，另建新档 ${newCode}，原件 ${p.code} 未修改`, note: note || '',
          }),
        ],
      };
      state.samples[newId] = sample;
      p.status = 'resolved';
      p.resolution = { action: 'create-new', at: now(), by, newSampleId: newId, newCode, note: note || '' };
      if (original) addEvent(original, 'pending_resolve', by, { pendingId: pid, result: `冲突件另建档 ${newCode}` });
      save();
      return { ok: true, message: `已另建新档 ${newCode}，原始样本 ${p.code} 未做任何修改`, sample };
    }

    return { ok: false, message: '未知裁决方式' };
  }

  /* ---------- 批次 ---------- */
  function createBatch(test, name, by) {
    state.seq.batch += 1;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const code = name || `B${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(state.seq.batch).padStart(2, '0')}`;
    const id = 'b' + state.seq.batch;
    const batch = {
      id, code, test, status: 'open',
      createdAt: now(), createdBy: by,
      closedAt: null, closedBy: null,
      sampleIds: [], revisions: [],
      events: [nextEvent(by, 'create_batch', { test })],
    };
    state.batches[id] = batch;
    save();
    return batch;
  }

  function openBatchesForTest(test) {
    return Object.values(state.batches).filter((b) => b.test === test && b.status === 'open');
  }

  function allocate(sampleId, assignments, by) {
    /* assignments: [{ test, batchId | newBatch }] */
    const sample = state.samples[sampleId];
    if (!sample) return { ok: false, message: '样本不存在' };
    if (sample.status === 'rejected') return { ok: false, message: '已拒收样本不能分配批次' };

    for (const a of assignments) {
      let batch = a.batchId === '__new__'
        ? createBatch(a.test, '', by)
        : state.batches[a.batchId];
      if (!batch) continue;
      if (batch.status !== 'open') return { ok: false, message: `批次 ${batch.code} 已关闭，无法分配` };
      if (batch.test !== a.test) return { ok: false, message: `批次 ${batch.code} 检测项目不匹配` };

      if (!batch.sampleIds.includes(sampleId)) {
        batch.sampleIds.push(sampleId);
        batch.events.push(nextEvent(by, 'allocate', { sampleCode: sample.code, test: a.test }));
      }
      addEvent(sample, 'allocate', by, { batchCode: batch.code, test: a.test });
      sample.batchId = batch.id;
    }
    if (sample.status === 'received') sample.status = 'batched';
    save();
    return { ok: true, message: '已分配到检测批次' };
  }

  function closeBatch(batchId, by) {
    const batch = state.batches[batchId];
    if (!batch || batch.status !== 'open') return { ok: false, message: '批次不存在或已关闭' };
    batch.status = 'closed';
    batch.closedAt = now();
    batch.closedBy = by;
    batch.events.push(nextEvent(by, 'close', { sampleCount: batch.sampleIds.length }));
    batch.sampleIds.forEach((sid) => {
      const s = state.samples[sid];
      if (s && s.status === 'batched') addEvent(s, 'batch_close', by, { batchCode: batch.code });
    });
    save();
    return { ok: true, message: `批次 ${batch.code} 已关闭，共 ${batch.sampleIds.length} 份样本` };
  }

  /* ---------- 拒收 ---------- */
  function reject(sampleId, reason, by) {
    const sample = state.samples[sampleId];
    if (!sample) return { ok: false, message: '样本不存在' };
    if (sample.status === 'rejected') return { ok: false, message: '样本已拒收，不能重复拒收' };
    if (sample.status === 'completed') return { ok: false, message: '已完成检测的样本不能拒收' };
    if (!reason || !reason.trim()) return { ok: false, message: '必须填写拒收原因' };
    sample.status = 'rejected';
    sample.rejectReason = reason.trim();
    sample.rejectedAt = now();
    sample.rejectedBy = by;
    addEvent(sample, 'reject', by, { reason: reason.trim() });
    save();
    return { ok: true, message: `样本 ${sample.code} 已拒收并记录原因` };
  }

  /* ---------- 拆分（按检测项目，父样本保留） ---------- */
  function split(sampleId, childGroups, reason, by) {
    const parent = state.samples[sampleId];
    if (!parent) return { ok: false, message: '样本不存在' };
    if (parent.status === 'rejected' || parent.status === 'completed') {
      return { ok: false, message: '当前状态的样本不能拆分' };
    }
    const allPicked = childGroups.flat();
    if (childGroups.length < 2 || childGroups.some((g) => g.length === 0)) {
      return { ok: false, message: '至少拆成两个非空分组' };
    }
    if (!sameTestSet(allPicked, parent.tests)) {
      return { ok: false, message: '拆分必须覆盖父样本的全部检测项目，且不能重复' };
    }
    const newChildren = [];
    childGroups.forEach((group, idx) => {
      state.seq.sample += 1;
      const childId = 's' + state.seq.sample;
      const childCode = `${parent.code}-${idx + 1}`;
      const child = {
        id: childId, code: childCode,
        site: parent.site, sampledAt: parent.sampledAt, tests: group,
        status: 'received', batchId: null,
        parentId: parent.id, childIds: [], mergedFrom: [],
        receivedAt: now(), receivedBy: by,
        rejectReason: null, results: {},
        events: [
          nextEvent(by, 'split', { parentCode: parent.code, reason: reason || '按检测项目拆分' }),
        ],
      };
      state.samples[childId] = child;
      parent.childIds.push(childId);
      newChildren.push(child);
    });
    parent.status = 'split';
    addEvent(parent, 'split', by, {
      reason: reason || '按检测项目拆分',
      children: newChildren.map((c) => `${c.code}（${c.tests.join('、')}）`),
    });
    save();
    return { ok: true, message: `已拆分为 ${newChildren.length} 份子样本，父样本 ${parent.code} 保留`, children: newChildren };
  }

  /* ---------- 重测 ---------- */
  function retest(sampleId, reason, by) {
    const sample = state.samples[sampleId];
    if (!sample) return { ok: false, message: '样本不存在' };
    if (sample.status === 'rejected') return { ok: false, message: '已拒收样本不能重测' };
    addEvent(sample, 'retest', by, { reason: reason || '常规复检' });
    if (sample.status === 'completed') sample.status = 'batched';
    save();
    return { ok: true, message: `样本 ${sample.code} 已登记重测，下次录入结果将生成新版本` };
  }

  /* ---------- 结果录入 / 关闭后补录（修订版本） ---------- */
  function enterResult(sampleId, batchId, test, payload, by) {
    const sample = state.samples[sampleId];
    const batch = state.batches[batchId];
    if (!sample || !batch) return { ok: false, message: '样本或批次不存在' };
    if (!sample.tests.includes(test)) return { ok: false, message: '该样本不含此检测项目' };

    const before = batchSummary(batchId);
    const existing = sample.results[test];
    const isClosedBatch = batch.status === 'closed';
    const version = existing ? existing.current + 1 : 1;

    const versionRecord = {
      version,
      value: payload.value.trim(),
      unit: payload.unit.trim(),
      flag: payload.flag,
      recordedAt: now(),
      recordedBy: by,
      batchId,
      note: payload.note.trim(),
    };
    if (isClosedBatch || version > 1) {
      versionRecord.revisionReason = payload.revisionReason || (isClosedBatch ? '批次关闭后补录/修订' : '重新检测后修订');
    }

    if (!existing) sample.results[test] = { current: 1, versions: [versionRecord] };
    else {
      existing.current = version;
      existing.versions.push(versionRecord);
    }

    if (isClosedBatch || version > 1) {
      /* 修订留痕：批次级修订记录 + 受影响汇总提示 */
      state.seq.revision += 1;
      const after = batchSummary(batchId);
      const impact =
        `样本 ${sample.code}「${test}」v${version - 1} → v${version}；` +
        `批次已出结果 ${before.doneCount} → ${after.doneCount} 项，异常 ${before.abnormalCount} → ${after.abnormalCount} 项`;
      const revision = {
        id: 'r' + state.seq.revision,
        sampleId, sampleCode: sample.code, test, version,
        at: now(), by,
        reason: versionRecord.revisionReason,
        closedBatch: isClosedBatch,
        summaryImpact: impact,
      };
      batch.revisions.push(revision);
      batch.events.push(nextEvent(by, 'revise', {
        sampleCode: sample.code, test, toVersion: version, closedBatch: isClosedBatch, impact,
      }));
      addEvent(sample, 'revise', by, {
        test, fromVersion: version - 1, toVersion: version,
        reason: versionRecord.revisionReason,
        batchClosed: isClosedBatch, batchCode: batch.code, impact,
      });
    } else {
      batch.events.push(nextEvent(by, 'result', { sampleCode: sample.code, test, version }));
      addEvent(sample, 'result', by, { test, version, summary: payload.value.trim() });
    }

    /* 全部项目均有当前结果 → 完成 */
    const allDone = sample.tests.every((t) => sample.results[t] && sample.results[t].versions.length > 0);
    if (allDone && sample.status !== 'rejected') sample.status = 'completed';

    save();
    return {
      ok: true,
      revised: isClosedBatch || version > 1,
      message: isClosedBatch
        ? `批次已关闭，结果以修订版本 v${version} 补录，受影响汇总已在批次页提示`
        : version > 1
          ? `已生成修订版本 v${version}`
          : `结果已录入（v1）`,
    };
  }

  /* 批次汇总（用于修订前后对比） */
  function batchSummary(batchId, excludeSampleId) {
    const batch = state.batches[batchId];
    let doneCount = 0;
    let abnormalCount = 0;
    batch.sampleIds.forEach((sid) => {
      if (excludeSampleId && sid === excludeSampleId) return;
      const s = state.samples[sid];
      if (!s) return;
      Object.entries(s.results).forEach(([test, r]) => {
        if (batch.test !== test) return;
        const cur = r.versions[r.current - 1];
        if (cur) {
          doneCount += 1;
          if (cur.flag && cur.flag !== '正常') abnormalCount += 1;
        }
      });
    });
    return { doneCount, abnormalCount, sampleCount: batch.sampleIds.length, revisionCount: batch.revisions.length };
  }

  /* 样本出现在哪些批次（按批次 sampleIds 反查，支持一样本多批次） */
  function batchesOfSample(sampleId) {
    return Object.values(state.batches)
      .filter((b) => b.sampleIds.includes(sampleId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /* 全局事件流（总览页） */
  function globalEvents(limit = 30) {
    const all = [];
    Object.values(state.samples).forEach((s) => {
      s.events.forEach((e) => all.push({ ...e, sampleCode: s.code, sampleId: s.id }));
    });
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  /* ---------- CSV 解析（轻量，支持引号包裹） ---------- */
  function parseCsv(text) {
    const rows = [];
    let cur = [], field = '', inQuotes = false;
    const src = text.trim();
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { cur.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        cur.push(field); field = '';
        if (cur.some((c) => c.trim() !== '')) rows.push(cur);
        cur = [];
      } else field += ch;
    }
    if (field !== '' || cur.length) { cur.push(field); if (cur.some((c) => c.trim() !== '')) rows.push(cur); }
    return rows;
  }

  function importCsv(text, by) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { ok: false, message: 'CSV 内容为空或缺少数据行', items: [] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      code: header.indexOf('sample_code'),
      site: header.indexOf('collection_site'),
      sampled: header.indexOf('sampled_at'),
      tests: header.indexOf('tests'),
    };
    if (Object.values(idx).some((v) => v < 0)) {
      return { ok: false, message: '表头必须包含 sample_code, collection_site, sampled_at, tests', items: [] };
    }
    const items = [];
    rows.slice(1).forEach((cols, lineNo) => {
      const sampledRaw = (cols[idx.sampled] || '').trim().replace(' ', 'T');
      const tests = (cols[idx.tests] || '').split('|').map((t) => t.trim()).filter(Boolean);
      const r = receiveSample({
        code: (cols[idx.code] || '').trim(),
        site: (cols[idx.site] || '').trim(),
        sampledAt: sampledRaw,
        tests, by, via: 'CSV 导入',
      });
      items.push({ lineNo: lineNo + 2, ...r });
    });
    const counts = items.reduce((acc, it) => {
      acc[it.outcome] = (acc[it.outcome] || 0) + 1;
      return acc;
    }, {});
    save();
    return { ok: true, items, counts };
  }

  return {
    load, save, reset, get, now,
    findSampleByCode, findPendingByCode,
    receiveSample, resolvePending,
    createBatch, openBatchesForTest, allocate, closeBatch,
    reject, split, retest, enterResult, batchSummary, batchesOfSample,
    globalEvents, parseCsv, importCsv,
  };
})();

/* ---------- 展示格式化 ---------- */
function fmtTime(s) {
  if (!s) return '—';
  return s.replace('T', ' ').slice(0, 16);
}

function statusLabel(st) {
  return {
    received: '待分配',
    batched: '已分批',
    rejected: '已拒收',
    completed: '已完成',
    split: '已拆分',
  }[st] || st;
}

function eventLabel(type) {
  return {
    receive: '接收登记',
    merge: '重复合并',
    conflict: '冲突转待确认',
    pending_resolve: '待确认裁决',
    allocate: '分配批次',
    reject: '拒收',
    split: '样本拆分',
    retest: '登记重测',
    result: '结果录入',
    revise: '结果修订（补录）',
    batch_close: '批次关闭',
    create_batch: '创建批次',
    close: '关闭批次',
  }[type] || type;
}
