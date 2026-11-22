// 「我改过主意」：列出当时和后来想法不一样的那些经历。
//
// 这是 then/later 这套数据模型唯一别的记忆系统给不出的东西：不是"相似段落"，
// 而是"我哪天怎么想、后来怎么想"的差。宿主可以把它递给她，让她发现自己变过。
//
// 纯读取，不改任何文件。
import { loadAll } from './self-experience.js'

const DAY = 24 * 3600 * 1000

function tsOf(value) {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value >= 1e11 ? value : value * 1000
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? t : 0
}

function norm(text) {
  return String(text || '').replace(/\s+/g, '').trim()
}

/**
 * 找出「后来改过想法」的经历。
 *
 * @param {string} dir 记忆目录
 * @param {object} [options]
 * @param {number} [options.days=30] 只看这段时间内改的
 * @param {number} [options.limit=5] 最多几条
 * @param {number} [options.now=Date.now()] 当前时间（测试用）
 * @param {boolean} [options.includeSealed=false] 封存的是否算
 * @returns {Array<{id:string, day:string, then:string, now:string, at:number, daysAgo:number}>}
 */
export function changedSince(dir, { days = 30, limit = 5, now = Date.now(), includeSealed = false } = {}) {
  const horizon = now - Number(days) * DAY
  const out = []
  for (const entry of loadAll(dir)) {
    if (!entry) continue
    // 封存标记可能是布尔值，也可能是正式接口写的 { at, day, note } 对象；
    // 这里按"有值即封存"判断，跟 book / recap / detail 的过滤保持一致。
    if (!includeSealed && entry.sealed) continue
    const later = Array.isArray(entry.later) ? entry.later : []
    if (!later.length) continue
    const latest = later[later.length - 1]
    const nowText = String(latest?.thought || '').trim()
    const thenText = String(entry.then?.thought || '').trim()
    if (!nowText) continue
    // 和当时一样就只是"又写了一遍"，不算改主意
    if (norm(nowText) === norm(thenText)) continue
    const at = tsOf(latest.at) || tsOf(entry.then?.at) || tsOf(entry.day)
    if (!at || at < horizon) continue
    out.push({
      id: String(entry.id || ''),
      day: String(entry.day || ''),
      then: thenText,
      now: nowText,
      at,
      daysAgo: Math.floor((now - at) / DAY)
    })
  }
  out.sort((a, b) => b.at - a.at)
  return out.slice(0, Math.max(0, Number(limit) || 0))
}

/** 把改主意渲染成给模型看的一段话；没有就返回空串。 */
export function renderChanged(items, { lang = 'zh' } = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return ''
  if (lang === 'en') {
    const lines = list.map((x) => `- ${x.daysAgo === 0 ? 'today' : x.daysAgo + ' days ago'}: you thought ${JSON.stringify(x.then)}, later ${JSON.stringify(x.now)}`)
    return ['【Things you changed your mind about】', ...lines, '（These are your own notes, not something the user said.）'].join('\n')
  }
  const ago = (n) => (n <= 0 ? '今天' : `${n} 天前`)
  const lines = list.map((x) => `- ${ago(x.daysAgo)}：你当时想「${x.then}」，后来想「${x.now}」`)
  return ['【你改过主意的事】', ...lines, '（这是你自己写下的，不是用户说的。）'].join('\n')
}