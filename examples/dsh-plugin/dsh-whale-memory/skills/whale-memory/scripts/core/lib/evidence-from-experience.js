// 把「她的经历」桥到证据层：只抽有原文锚的东西，不推断
// 情绪快照 → mood fact；原文锚 → quote:<source> fact；当时/后来的感觉 → feeling:<id> fact
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

// 她对这一件事的感觉：当时写下的是第一条；后来某条后记写了感觉，就取代前一条（取代链可查）
// slot 为 feeling:<经历 id>。没写感觉的后记不算数——不替她推断"应该已经不难过了"
export function feelingFacts(experiences, { subject = 'self' } = {}) {
  const facts = []
  for (const r of experiences || []) {
    const slot = 'feeling:' + r.id
    let prev = ''
    const thenFeeling = (r.then && Array.isArray(r.then.feeling)) ? r.then.feeling : []
    if (thenFeeling.length && r.at) {
      prev = 'feeling:' + r.id + ':then'
      facts.push({ id: prev, subject, slot, value: thenFeeling.join('、'), at: r.at, source: 'then.feeling' })
    }
    for (const [i, l] of (r.later || []).entries()) {
      if (!Array.isArray(l.feeling) || !l.feeling.length || !l.at) continue
      const id = 'feeling:' + r.id + ':later:' + i
      facts.push({ id, subject, slot, value: l.feeling.join('、'), at: l.at, source: 'later.feeling', ...(prev ? { supersedes: prev } : {}) })
      prev = id
    }
  }
  return facts
}

export function factsFromExperiences(experiences, opts = {}) {
  return [...moodFacts(experiences, opts), ...quoteFacts(experiences, opts), ...feelingFacts(experiences, opts)]
}

// 问她某个时点是什么心情/读到过什么：没有就返回 unknown，不猜
export function ask(experiences, { slot, at, subject = 'self' } = {}) {
  return query(factsFromExperiences(experiences, { subject }), { subject, slot, at })
}