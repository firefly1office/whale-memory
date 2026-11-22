// 她的书：把自传导出成人能读的 Markdown
// 按她起过名字的章节分组；没归进章节的按月份。每一条的「当时」是原样，「后来」按时间接在后面
// 封存了的默认不收，只说收了几件、没收几件；asOf 导出"那时的她"写到那天为止的书
import { loadAll } from './self-experience.js'
import * as chapterEvents from './chapter-events.js'
import { parseAsOf, dayOf } from './as-of.js'

const range = (c) => c.from + ' ~ ' + (c.to || '至今')
const laterDay = (l) => l.day || String(l.at || '').slice(0, 10)
const ptr = (x) => x.missing ? '（' + x.id + '，找不到了）' : x.sealed ? '（一件封存了的事）' : x.day + '「' + x.text + '」'

function entry(r) {
  const t = r.then
  const out = ['### ' + (r.day || '没有日期') + (r.kind && r.kind !== '其它' ? ' · ' + r.kind : '') + (r.weight === 'important' ? ' · 重要' : ''), '']
  if (t.scene) out.push('*' + t.scene + '*', '')
  if (t.quote && t.quote.text) out.push('> ' + t.quote.text + (t.quote.source ? '（' + t.quote.source + '）' : ''), '')
  out.push(t.text, '')
  const meta = []
  if (Array.isArray(r.refsInfo) && r.refsInfo.length) meta.push('是从这些事想到的：' + r.refsInfo.map(ptr).join('；'))
  if ((t.feeling || []).length) meta.push('当时的感觉：' + t.feeling.join('、'))
  if (t.thought) meta.push('当时的想法：' + t.thought)
  if (t.unfinished) meta.push('还没完的：' + t.unfinished)
  for (const m of meta) out.push('- ' + m)
  if (meta.length) out.push('')
  const later = r.later || []
  if (later.length) {
    out.push('**后来**', '')
    for (const l of later) out.push('- ' + laterDay(l) + '：' + l.thought + (Array.isArray(l.feeling) && l.feeling.length ? '（再想起时：' + l.feeling.join('、') + '）' : ''))
    out.push('')
  }
  const st = r.unfinishedState
  if (st && t.unfinished) {
    const word = { done: '想通了', shelved: '先放下了', reopen: '又接着想' }[st.choice] || st.choice
    out.push('- 「' + t.unfinished + '」' + word + '（' + st.day + '）', '')
  }
  if (Array.isArray(r.links) && r.links.length) out.push('- 后来连在一起的：' + r.links.map((l) => l.sealed ? ptr(l) : ptr(l) + '——' + l.reason).join('；'), '')
  if (r.sealed) out.push('- （这件事她' + (r.sealed.afterAsOf ? '后来' : '') + '封存了：' + r.sealed.day + '）', '')
  return out
}

export function renderBook(dir, { asOf = null, includeSealed = false, title = '她的自传', now = new Date() } = {}) {
  const until = parseAsOf(asOf)
  let rows = []
  // 封存日志读不出来时，给一本空书，而不是一本把该藏的都露出来的书。
  try { rows = loadAll(dir, { asOf }) } catch { return '' }
  const visible = rows.filter((r) => includeSealed || !r.sealed).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
  const hidden = rows.length - visible.length
  const chapters = chapterEvents.chapters(dir, { until })

  // 分节：章节会嵌套（"那个秋天"里有"拿到钥匙的那周"），每条放进它落入的最具体的那段——开始得最晚的那个；
  // 一件事只印一遍，其余更大的章节在条目里提一句
  const sections = new Map()
  for (const c of chapters) sections.set(c.id, { key: c.from, heading: c.name, sub: range(c) + (c.names.length > 1 ? '，以前叫' + c.names.slice(0, -1).map((n) => '「' + n + '」').join('、') : ''), items: [] })
  const primaryOf = (r) => (r.chapters || [])[(r.chapters || []).length - 1]
  for (const r of visible) {
    const first = primaryOf(r)
    if (first && sections.has(first.id)) { sections.get(first.id).items.push(r); continue }
    const month = String(r.day || '').slice(0, 7) || '没有日期'
    if (!sections.has('m:' + month)) sections.set('m:' + month, { key: month + '-01', heading: month, sub: '没有归进章节的日子', items: [] })
    sections.get('m:' + month).items.push(r)
  }

  const lines = ['# ' + title, '']
  lines.push('> ' + (until !== null ? '截至 ' + dayOf(until) + ' 的样子，那之后写下的不在这本里。' : '导出于 ' + now.toLocaleString('zh-CN', { hour12: false }) + '。') + '每一条的正文是那天写下的原样，「后来」按时间接在后面。')
  lines.push('>', '> 收了 ' + visible.length + ' 件' + (hidden ? '；有 ' + hidden + ' 件她封存了的事没有收进来' : '') + '。', '')
  if (!visible.length) lines.push('（还没有可以收进来的记录。）', '')
  const ordered = [...sections.values()].filter((s) => s.items.length).sort((a, b) => a.key.localeCompare(b.key))
  for (const s of ordered) {
    lines.push('## ' + s.heading, '', '*' + s.sub + '*', '')
    for (const r of s.items) {
      lines.push(...entry(r))
      const others = (r.chapters || []).slice(0, -1)
      if (others.length) lines.push('- 也在这段日子里：' + others.map((c) => '「' + c.name + '」').join('、'), '')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
