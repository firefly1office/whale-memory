// 她自己的记忆：统一读取她自己的经历、日记、自述；按相关度取回
import fs from 'node:fs'
import path from 'node:path'

const norm = (s) => String(s || '').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()

function bigrams(s) {
  const c = norm(s)
  const out = new Set()
  for (let i = 0; i + 2 <= c.length; i++) out.add(c.slice(i, i + 2))
  return out
}

function overlapScore(query, text) {
  const q = bigrams(query)
  const t = bigrams(text)
  if (!q.size || !t.size) return 0
  let n = 0
  for (const g of q) if (t.has(g)) n++
  return n
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// 她自己的经历（自己的时间写的）
export function loadExperiences(dir) {
  return readJsonl(path.join(dir, 'self-experience.jsonl')).map((r) => ({
    id: r.id || ('exp_' + (r.at || '').slice(0, 10)),
    at: r.at || r.day || '',
    kind: r.kind || (r.then && r.then.kind) || '其它',
    text: String((r.then && r.then.text) || r.text || '').slice(0, 400),
    thought: String((r.then && r.then.thought) || r.thought || '').slice(0, 200),
    origin: 'own-time',
    author: 'self'
  })).filter((r) => r.text)
}

// 她的日记（可能提到别人，默认只在主人私聊用）
export function loadDiaries(dir) {
  return readJsonl(path.join(dir, 'autobiography.jsonl')).map((r) => ({
    id: 'diary_' + (r.day || '') + '_' + String(r.time || '').replace(/:/g, ''),
    at: r.day || '',
    kind: '日记',
    text: String(r.event || r.text || '').slice(0, 400),
    thought: '',
    origin: 'diary',
    author: 'self'
  })).filter((r) => r.text)
}

export function recall(dir, query, { includeDiary = false, limit = 4, minOverlap = 1 } = {}) {
  const pool = loadExperiences(dir).concat(includeDiary ? loadDiaries(dir) : [])
  const q = String(query || '')
  const scored = pool.map((r) => ({ r, score: q ? overlapScore(q, r.text + ' ' + r.thought) : 0 }))
    .filter((x) => (q ? x.score >= minOverlap : true))
    .sort((a, b) => (b.score - a.score) || (String(b.r.at).localeCompare(String(a.r.at))))
  const out = [], seen = new Set()
  for (const x of scored) {
    if (seen.has(x.r.text)) continue
    seen.add(x.r.text)
    out.push(x.r)
    if (out.length >= limit) break
  }
  return out
}

export function renderBlock(items, { title = '【我的记忆（我自己的，不是谁告诉我的）】', maxChars = 320 } = {}) {
  if (!items || !items.length) return ''
  const lines = [title]
  for (const r of items) {
    const when = String(r.at || '').slice(5, 10)
    lines.push('- ' + (when ? when + ' ' : '') + String(r.text).slice(0, 70) + (r.thought ? '（当时想：' + String(r.thought).slice(0, 40) + '）' : ''))
  }
  const out = lines.join('\n')
  return out.length <= maxChars ? out : out.slice(0, maxChars - 1) + '…'
}