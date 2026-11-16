// 她自己的记忆：统一读取她自己的经历、日记、自述；按相关度取回
// 匹配口径和 self-experience.recall 是同一套（query-match.js）：虚词不算、长查询要过比例门槛
import fs from 'node:fs'
import path from 'node:path'
import { loadAll } from './self-experience.js'
import { queryTerms, requiredOverlap, matchedTerms, contentUnits, coverage, MIN_COVER } from './query-match.js'

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// 她自己的经历（自己的时间写的）：走 loadAll，id 和后记都与 self-experience 一致
// 她封存了的不进这里：被问到"你自己"时不该把她不想再提的事翻出来
export function loadExperiences(dir) {
  return loadAll(dir).filter((r) => !r.sealed).map((r) => ({
    id: r.id,
    at: r.at || r.day || '',
    kind: r.kind || '其它',
    text: String(r.then.text || '').slice(0, 400),
    thought: String(r.then.thought || '').slice(0, 200),
    later: (r.later || []).map((l) => String(l.thought || '')).join(' '),
    origin: 'own-time',
    author: 'self'
  }))
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

export function recall(dir, query, { includeDiary = false, limit = 4, minOverlap = 1, minRatio = 0.6, mode = 'strict' } = {}) {
  const pool = loadExperiences(dir).concat(includeDiary ? loadDiaries(dir) : [])
  const q = String(query || '')
  const parsed = queryTerms(q)
  const required = requiredOverlap(parsed, { mode, minOverlap, minRatio })
  const units = contentUnits(q)
  const scored = pool.map((r) => { const text = [r.text, r.thought, r.later || ''].join(' '); return { r, score: q ? matchedTerms(parsed.terms, text).size : 0, cover: q ? coverage(units, text) : 0 } })
    // 与 self-experience 同一口径：strict 要求意思被接住至少 MIN_COVER
    .filter((x) => (!q ? true : mode === 'loose' ? x.score >= required : x.score >= minOverlap && x.cover >= MIN_COVER))
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