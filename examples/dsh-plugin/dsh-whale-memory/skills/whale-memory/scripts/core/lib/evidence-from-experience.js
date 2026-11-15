// 把「她的经历」桥到证据层：只抽有原文锚的东西，不推断
// 情绪快照 → mood fact；原文锚 → quote:<source> fact
import { query } from './evidence-policy.js'

const moodOf = (r) => {
  const state = r.then && r.then.state
  if (!state || typeof state !== 'object') return ''
  return String(state.mood || '')
}

export function moodFacts(experiences, { subject = 'self' } = {}) {
  const facts = []
  for (const r of experiences || []) {
    const mood = moodOf(r)
    if (!mood) continue
    const at = (r.then.state && r.then.state.at) || r.at
    if (!at) continue
    facts.push({ id: 'mood:' + r.id, subject, slot: 'mood', value: mood, at, source: 'then.state' })
  }
  return facts
}

export function quoteFacts(experiences, { subject = 'self' } = {}) {
  const facts = []
  for (const r of experiences || []) {
    const q = r.then && r.then.quote
    if (!q || !q.text) continue
    const slot = 'quote:' + (q.source || 'unknown')
    facts.push({ id: 'quote:' + r.id, subject, slot, value: q.text, at: r.at, source: q.source || 'then.quote' })
  }
  return facts
}

export function factsFromExperiences(experiences, opts = {}) {
  return [...moodFacts(experiences, opts), ...quoteFacts(experiences, opts)]
}

// 问她某个时点是什么心情/读到过什么：没有就返回 unknown，不猜
export function ask(experiences, { slot, at, subject = 'self' } = {}) {
  return query(factsFromExperiences(experiences, { subject }), { subject, slot, at })
}