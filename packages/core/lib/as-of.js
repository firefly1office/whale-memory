// 「翻回那天的自己」用的时间口径：只在这里定义一次
// 「2026-11-15」= 那天本地时间的最后一刻（23:59:59.999）；也接受完整的 ISO 时间
// 没有时间戳的记录无法放到时间线上：截断时一律不算在"那时"里

export function parseAsOf(v) {
  if (v === undefined || v === null || v === '') return null
  if (v instanceof Date) {
    const t = v.getTime()
    if (!Number.isFinite(t)) throw new Error('Invalid as-of time.（as-of 时间不合法。）')
    return t
  }
  const s = String(v).trim()
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])]
    const end = new Date(y, m - 1, d, 23, 59, 59, 999)
    if (end.getFullYear() !== y || end.getMonth() !== m - 1 || end.getDate() !== d) throw new Error('as-of date does not exist: ' + s + '（as-of 日期不存在：' + s + '）')
    return end.getTime()
  }
  const t = Date.parse(s)
  if (!Number.isFinite(t)) throw new Error('Cannot parse as-of time: ' + s + ' (use a date like 2026-11-15, or a full ISO time).（as-of 时间看不懂：' + s + '（用 2026-11-15 这样的日期，或完整的 ISO 时间））')
  return t
}

// 这条记录在截断时刻之前（含）发生过吗？until 为 null 表示不截断
export function before(row, until) {
  if (until === null || until === undefined) return true
  const t = Date.parse(String((row && row.at) || ''))
  return Number.isFinite(t) && t <= until
}

export const dayOf = (ms) => new Date(ms).toLocaleDateString('sv-SE')
