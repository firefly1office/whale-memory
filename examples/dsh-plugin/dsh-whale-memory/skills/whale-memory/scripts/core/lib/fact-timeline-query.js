/**
 * 时间线查询：用已有字段回答三种问法。
 *
 * 设计文档 §2.1 说得很清楚：所有问法都从两个谓词长出来——
 *   - **知轴**：她在这个时刻「知道」哪一版？  factVersionAt <= t < invalidatedAt
 *   - **值轴**：这件事在这个时刻「为真」？    validFrom <= t < validUntil
 * 两者不能混：事实可以仍为真、但她还不知道（未来事实），也可以她已知道、但事实上已经变了。
 *
 * 这里只做纯计算，不读写存储。
 */

function ms(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 链按版本号升序；没有版本号的排最后，保持稳定。 */
export function orderChain(records) {
  return (Array.isArray(records) ? records : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const va = Number(a.version);
      const vb = Number(b.version);
      const ha = Number.isFinite(va) && va > 0;
      const hb = Number.isFinite(vb) && vb > 0;
      if (ha && hb) return va - vb;
      if (ha !== hb) return ha ? -1 : 1;
      return (ms(a.factVersionAt) - ms(b.factVersionAt)) || String(a.id || '').localeCompare(String(b.id || ''));
    });
}

/** 当前版本：链里最后一个还有效的（没有后继、也没被 invalidatedAt 关掉）。 */
export function currentVersion(records) {
  const chain = orderChain(records);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const row = chain[i];
    if (!String(row.supersededById || '') && !ms(row.invalidatedAt)) return row;
  }
  // 全部都已关闭时，返回最新那版（历史问题，调用方自己决定怎么讲）
  return chain.length ? chain[chain.length - 1] : null;
}

/**
 * 知轴：在 asOf 时刻，她「认为」的是哪一版。
 * 条件：factVersionAt <= asOf，且（没有 invalidatedAt，或 asOf < invalidatedAt）。
 * 同一时刻有多版时取版本号最大的。
 */
export function versionKnownAt(records, asOf) {
  const at = ms(asOf);
  if (!at) return null;
  const candidates = orderChain(records).filter((row) => {
    const start = ms(row.factVersionAt);
    if (!start || start > at) return false;
    const end = ms(row.invalidatedAt);
    return !end || at < end;
  });
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/**
 * 值轴：在 asOf 时刻，这件事在世界上是否为真。
 * validFrom 为 0 视为「不知道起点」，退回知轴（她什么时候知道的）。
 */
export function valueValidAt(records, asOf) {
  const at = ms(asOf);
  if (!at) return null;
  const candidates = orderChain(records).filter((row) => {
    const start = ms(row.validFrom) || ms(row.factVersionAt);
    if (!start || start > at) return false;
    const end = ms(row.validUntil);
    return !end || at < end;
  });
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/**
 * 两个时刻之间发生了什么：返回被新增、被取代的版本。
 * 只列事实，不做解读。
 */
export function changesBetween(records, from, to) {
  const start = ms(from);
  const end = ms(to);
  if (!start || !end || end <= start) return [];
  return orderChain(records)
    .filter((row) => {
      const began = ms(row.factVersionAt);
      return began > start && began <= end;
    })
    .map((row) => ({
      id: String(row.id || ''),
      version: Number(row.version) || null,
      at: ms(row.factVersionAt),
      revisionOf: String(row.revisionOf || ''),
      reason: row.supersedeReason || ''
    }));
}