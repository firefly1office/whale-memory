// 证据策略（开源子集）：只做判定，不做存储
// 一条 fact：{ id, subject, slot, value, at, source?, supersedes? }
// 规则：as-of、被取代、后继缺席；没有记录就返回「不知道」，不推断

const ts = (v) => {
  const n = Date.parse(String(v || ''))
  return Number.isFinite(n) ? n : null
}

function normalize(f) {
  if (!f || !f.id || !f.subject) return null
  const t = ts(f.at)
  if (t === null) return null
  return {
    id: String(f.id),
    subject: String(f.subject),
    slot: String(f.slot || 'default'),
    value: f.value === undefined ? null : f.value,
    at: new Date(t).toISOString(),
    t,
    source: f.source ? String(f.source) : '',
    supersedes: f.supersedes ? String(f.supersedes) : ''
  }
}

export function normalizeFacts(facts = []) {
  return facts.map(normalize).filter(Boolean).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
}

// 某个时间点之前成立的全部 fact（含被后来者取代的旧值，方便看历史）
export function asOf(facts, at) {
  const limit = ts(at)
  if (limit === null) return []
  return normalizeFacts(facts).filter((f) => f.t <= limit)
}

// id → 取代它的新 fact（只看给定的集合）
export function supersessionMap(facts = []) {
  const map = new Map()
  for (const f of normalizeFacts(facts)) {
    if (f.supersedes) map.set(f.supersedes, f)
  }
  return map
}

// 截至 at 仍然有效的那一条：没被更晚的 fact 取代
export function currentFact(facts, { subject, slot = 'default', at = new Date().toISOString() } = {}) {
  const pool = asOf(facts, at).filter((f) => f.subject === subject && f.slot === slot)
  if (!pool.length) return null
  const superseded = new Set(supersessionMap(pool).keys())
  const alive = pool.filter((f) => !superseded.has(f.id))
  return alive.length ? alive[alive.length - 1] : null
}

// 主查询：有就给出值 + 证据链；没有就明说没有；不问「可能是什么」
export function query(facts, { subject, slot = 'default', at = new Date().toISOString() } = {}) {
  const all = normalizeFacts(facts)
  const atT = ts(at)
  if (atT === null) return { status: 'unknown', reason: 'as-of 时间不合法' }

  const pool = all.filter((f) => f.subject === subject && f.slot === slot && f.t <= atT)
  if (!pool.length) {
    return { status: 'unknown', reason: '截至该时间没有记录', evidence: [] }
  }

  // 只看截至 as-of 已成立的取代关系：未来才会发生的取代不算数
  const bySupersede = supersessionMap(pool)
  const alive = pool.filter((f) => !bySupersede.has(f.id))
  if (!alive.length) {
    return { status: 'unknown', reason: '该时间点的记录都已被后续取代', evidence: pool }
  }

  const latest = alive[alive.length - 1]
  const chain = []
  let cur = latest
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    chain.push(cur)
    seen.add(cur.id)
    cur = cur.supersedes ? pool.find((f) => f.id === cur.supersedes) || null : null
  }
  chain.reverse()

  return {
    status: 'known',
    value: latest.value,
    fact: latest,
    evidence: chain,
    reason: chain.length > 1 ? '有后续记录，旧值被取代' : '只有一条记录，未发现后续'
  }
}

// 后继缺席：在 at 之后有没有更新的记录？没有就明说没有，不补
export function hasSuccessor(facts, id, at = new Date().toISOString()) {
  const all = normalizeFacts(facts)
  const base = all.find((f) => f.id === id)
  if (!base) return { ok: false, reason: '找不到这条记录' }
  const atT = ts(at)
  if (atT === null) return { ok: false, reason: 'as-of 时间不合法' }
  const later = all.filter((f) => f.subject === base.subject && f.slot === base.slot && f.t > base.t && f.t <= atT)
  return { ok: true, hasSuccessor: later.length > 0, successors: later }
}

// 渲染成一句人话：知道就说值，不知道就说不知道
export function render(verdict) {
  if (!verdict || verdict.status !== 'known') {
    return '没有记录：' + (verdict && verdict.reason ? verdict.reason : '查不到')
  }
  const f = verdict.fact
  const when = f.at.slice(0, 10)
  const src = f.source ? '（' + f.source + '）' : ''
  return String(f.value) + ' · ' + when + src
}