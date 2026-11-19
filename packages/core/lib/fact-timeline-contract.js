/**
 * 事实时间线契约（阶段 A）：给「同槽位版本链」补齐三样一直缺的东西。
 *
 * 设计文档 `记忆版本与时间线-设计-20261114.md` §1.2 的判断：
 * 一个 `validUntil` 同时承担了三个轴，所以拆开——
 *   - 值轴 validFrom / validUntil：这件事在世界上什么时候为真
 *   - 知轴 factVersionAt / **invalidatedAt**：她什么时候知道、什么时候不再这么认为
 *   - 序轴 **version**：同一槽位里谁在谁后面（追加顺序永远可信，时钟不一定）
 *
 * 本模块只做纯计算，不读写存储：
 *   - `nextFactVersion`：新记录在链内的序号
 *   - `stampSuccession`：后继取代前驱时，两边各该补什么
 *   - `validateLineage`：把链拿出来校验，返回问题清单（对应设计的 I1–I3）
 *
 * 不变量（判读口径）：
 *   I1 同一 lineageId 内 version 唯一、从 1 连续、不跳号
 *   I2 被取代记录的 invalidatedAt 等于后继的 factVersionAt（知轴终点接上起点）
 *   I3 后继的 revisionOf 指向前驱 id，前驱的 supersededById 指向后继 id
 */

const SUPERSEDE_REASONS = new Set(['update', 'correction', 'expiry', 'retraction', 'dedupe', 'unknown']);

function ms(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 链内下一个序号：没有前驱就是 1，否则前驱序号 + 1。前驱没有序号时按 1 起算，不猜。 */
export function nextFactVersion(predecessor) {
  const base = Number(predecessor?.version);
  if (!Number.isFinite(base) || base < 1) return 1;
  return Math.floor(base) + 1;
}

/**
 * 后继取代前驱时两边的补丁。
 *
 * 只补「序轴」和「知轴终点」，不碰值轴：validFrom / validUntil 必须来自证据或人工裁决，
 * 不能因为看到一条更晚的记录就替它编一个有效期（设计文档 §2.5 明确禁止）。
 */
export function stampSuccession(before, after, { reason = 'update', at } = {}) {
  const beforeId = String(before?.id || '');
  const afterId = String(after?.id || '');
  if (!beforeId || !afterId || beforeId === afterId) throw new Error('后继取代需要两个不同的记录 id');
  const invalidatedAt = ms(at) || ms(after?.factVersionAt) || ms(before?.factVersionAt) || null;
  const supersedeReason = SUPERSEDE_REASONS.has(reason) ? reason : 'unknown';
  return {
    before: {
      supersededById: afterId,
      declinedAt: null,
      // 知轴终点：她不再认为这是当前值的时刻
      invalidatedAt,
      supersedeReason
    },
    after: {
      revisionOf: beforeId,
      // 序轴：链内序号。前驱缺序号说明它是链头，按 1 算。
      version: nextFactVersion({ version: Number(before?.version) || 1 })
    }
  };
}

/** 把补丁写回对象（就地），返回被改动的两个对象，便于调用方决定何时落盘。 */
export function applySuccession(before, after, options = {}) {
  const patch = stampSuccession(before, after, options);
  // 链头补齐序号，否则整条链校验永远差第一格。
  if (before && before.version == null) before.version = 1;  // eslint-disable-line no-param-reassign
  Object.assign(before, patch.before);
  Object.assign(after, patch.after);
  return { before, after, patch };
}

/** 校验一条链。返回 [] 表示通过；每条问题带 code / id / message，方便直接进报告。 */
export function validateLineage(records) {
  const rows = (Array.isArray(records) ? records : []).filter(Boolean);
  const issues = [];
  if (!rows.length) return issues;

  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id || '');
    if (!id) {
      issues.push({ code: 'I0', id: '', message: '记录缺少 id' });
      continue;
    }
    if (byId.has(id)) issues.push({ code: 'I0', id, message: '同一链里出现重复 id' });
    // 保留第一次出现的记录继续校验，否则重复 id 会把前面的指针问题遮掉。
    else byId.set(id, row);
  }

  // I1：序号唯一、从 1 连续
  const versions = new Map();
  for (const row of byId.values()) {
    const version = Number(row.version);
    if (!Number.isFinite(version) || version < 1 || Math.floor(version) !== version) {
      issues.push({ code: 'I1', id: row.id, message: `version 不是正整数：${row.version}` });
      continue;
    }
    if (versions.has(version)) {
      issues.push({ code: 'I1', id: row.id, message: `version ${version} 与 ${versions.get(version)} 重复` });
      continue;
    }
    versions.set(version, row.id);
  }
  if (versions.size) {
    const max = Math.max(...versions.keys());
    for (let expected = 1; expected <= max; expected++) {
      if (!versions.has(expected)) issues.push({ code: 'I1', id: '', message: `缺少 version ${expected}` });
    }
  }

  // I2 / I3：指针对称，知轴终点接上后继起点
  for (const row of byId.values()) {
    const nextId = String(row.supersededById || '');
    if (nextId) {
      const next = byId.get(nextId);
      if (!next) {
        issues.push({ code: 'I3', id: row.id, message: `supersededById 指向链外记录 ${nextId}` });
      } else {
        if (String(next.revisionOf || '') !== String(row.id)) {
          issues.push({ code: 'I3', id: row.id, message: `后继 ${nextId} 的 revisionOf 不是本记录` });
        }
        const invalidatedAt = ms(row.invalidatedAt);
        const nextStart = ms(next.factVersionAt);
        if (invalidatedAt && nextStart && invalidatedAt !== nextStart) {
          issues.push({ code: 'I2', id: row.id, message: `invalidatedAt(${invalidatedAt}) 与后继 factVersionAt(${nextStart}) 不一致` });
        }
        if (!invalidatedAt) {
          issues.push({ code: 'I2', id: row.id, message: '有后继却缺 invalidatedAt' });
        }
      }
    } else if (ms(row.invalidatedAt)) {
      issues.push({ code: 'I2', id: row.id, message: '写了 invalidatedAt 却没有后继' });
    }
    const reason = row.supersedeReason;
    if (reason !== undefined && reason !== null && !SUPERSEDE_REASONS.has(String(reason))) {
      issues.push({ code: 'I4', id: row.id, message: `supersedeReason 取值非法：${reason}` });
    }
  }

  return issues;
}

export const SUPERSEDE_REASON_VALUES = [...SUPERSEDE_REASONS];
/**
 * 迁移规划：给一条链排出序号。
 *
 * 两条原则：
 *   1. 已有指针优先。revisionOf / supersededById 是写入时留下的追加记录，比时钟可信（设计文档 §0 序轴）。
 *   2. 指针排不出完整路径时，退回按 factVersionAt 排序，并标记 orderBy='time' 让人复核，不假装指针是对的。
 *
 * 不写存储：返回每条记录该补的字段，由调用方决定是否落盘。
 */
export function planChainVersions(records) {
  const rows = (Array.isArray(records) ? records : []).filter(Boolean)
  const issues = []
  if (!rows.length) return { order: [], patches: [], issues, orderBy: 'empty' }

  const byId = new Map()
  for (const row of rows) {
    const id = String(row.id || '')
    if (!id) { issues.push({ code: 'I0', id: '', message: '记录缺少 id' }); continue }
    if (byId.has(id)) { issues.push({ code: 'I0', id, message: '同一链里出现重复 id' }); continue }
    byId.set(id, row)
  }

  const defined = [...byId.values()]
  const hasForward = (row) => Boolean(String(row.supersededById || ''))
  const hasBackward = (row) => Boolean(String(row.revisionOf || ''))
  const heads = defined.filter((row) => !hasBackward(row))
  let order = []

  // 只有「唯一链头 + 一路向前、不重复、走完全部记录」才算指针排得出来。
  const walkable = heads.length === 1 && defined.every((row) => !hasBackward(row) || byId.has(String(row.revisionOf)))
  if (walkable) {
    const seen = new Set()
    let cursor = heads[0]
    while (cursor) {
      const id = String(cursor.id)
      if (seen.has(id)) { issues.push({ code: 'I5', id, message: '指针成环' }); break }
      seen.add(id)
      order.push(cursor)
      const nextId = String(cursor.supersededById || '')
      if (!nextId) break
      const next = byId.get(nextId)
      if (!next) { issues.push({ code: 'I3', id, message: `supersededById 指向链外记录 ${nextId}` }); break }
      cursor = next
    }
    if (order.length !== defined.length) {
      issues.push({ code: 'I5', id: '', message: `指针只串起 ${order.length}/${defined.length} 条，退回按时间排序` })
      order = []
    }
  }

  let orderBy = 'pointer'
  if (!order.length) {
    orderBy = 'time'
    order = [...defined].sort((a, b) => (ms(a.factVersionAt) || 0) - (ms(b.factVersionAt) || 0) || String(a.id).localeCompare(String(b.id)))
    if (defined.some(hasBackward) || defined.some(hasForward)) {
      issues.push({ code: 'I5', id: '', message: '指针无法排出完整链，已按时间排序，需人工复核' })
    }
  }

  const patches = order.map((row, index) => {
    const next = order[index + 1] || null
    const patch = { id: String(row.id), version: index + 1, supersedeReason: next ? 'unknown' : null }
    if (next) {
      patch.invalidatedAt = ms(next.factVersionAt) || null
      patch.supersededById = String(next.id)
    } else {
      patch.invalidatedAt = null
      patch.supersededById = ''
    }
    if (index > 0) patch.revisionOf = String(order[index - 1].id)
    return patch
  })

  return { order, patches, issues, orderBy }
}
