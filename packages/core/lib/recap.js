// 回顾材料：把这几天发生过的整理出来，给她写回想用
// 只列事实——写下了什么、改过什么想法、感觉怎么变的、哪些事想通或放下了、哪些还没弄完
// 不调模型、不下结论、不替她归纳；她封存了的不列。要不要写回想、从哪几件事想到的，由她定
import { loadAll } from './self-experience.js'
import { parseAsOf, dayOf } from './as-of.js'

const snippet = (s, n = 40) => { const c = [...String(s || '')]; return c.length > n ? c.slice(0, n).join('') + '…' : c.join('') }

// days：往回看几天（1–366）；asOf：以那一刻为"今天"往回看（只看那时的她）
export function recap(dir, { days = 7, asOf = null, now = new Date() } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('days must be an integer from 1 to 366.（days 要是 1 到 366 之间的整数。）')
  const cut = parseAsOf(asOf)
  const end = cut === null ? now.getTime() : cut
  // 按自然日：含"今天"在内往回 days 天，从那天本地零点算起
  const e = new Date(end)
  const start = new Date(e.getFullYear(), e.getMonth(), e.getDate() - (days - 1)).getTime() - 1
  const within = (at) => { const t = Date.parse(String(at || '')); return Number.isFinite(t) && t > start && t <= end }
  const rows = loadAll(dir, { asOf: cut === null ? null : asOf }).filter((r) => !r.sealed)
  const head = (r) => ({ id: r.id, day: r.day, text: snippet(r.then.text) })

  const written = rows.filter((r) => within(r.at)).map((r) => ({ ...head(r), kind: r.kind, feeling: r.then.feeling || [], refs: r.then.refs || [] }))
  const revised = []
  const feelingShifts = []
  for (const r of rows) {
    const inRange = (r.later || []).filter((l) => within(l.at))
    for (const l of inRange) revised.push({ ...head(r), thought: String(l.thought || ''), feeling: l.feeling || [], at: l.at, laterDay: l.day || String(l.at || '').slice(0, 10) })
    const felt = [...inRange].reverse().find((l) => Array.isArray(l.feeling) && l.feeling.length)
    if (felt) feelingShifts.push({ ...head(r), then: r.then.feeling || [], now: felt.feeling, laterDay: felt.day || String(felt.at || '').slice(0, 10) })
  }
  const settled = []
  const reopened = []
  for (const r of rows) {
    const st = r.unfinishedState
    if (!st || !within(st.at)) continue
    const item = { ...head(r), unfinished: r.then.unfinished, choice: st.choice, stateDay: st.day }
    if (st.choice === 'reopen') reopened.push(item)
    else settled.push(item)
  }
  const stillOpen = rows
    .filter((r) => r.then.unfinished && !(r.unfinishedState && (r.unfinishedState.choice === 'done' || r.unfinishedState.choice === 'shelved')))
    .slice(-5)
    .map((r) => ({ ...head(r), unfinished: r.then.unfinished }))

  return { from: dayOf(start + 1), to: dayOf(end), days, written, revised, feelingShifts, settled, reopened, stillOpen }
}

const at = (x) => (x.day || '') + '「' + x.text + '」（' + x.id + '）'

export function renderRecap(rc) {
  const lines = ['【这几天（' + rc.from + ' ~ ' + rc.to + '）】']
  const empty = !rc.written.length && !rc.revised.length && !rc.settled.length && !rc.reopened.length
  if (empty) lines.push('这几天没有新写下的，也没有改过想法。')
  if (rc.written.length) {
    lines.push('写下了 ' + rc.written.length + ' 件：')
    for (const x of rc.written) lines.push('- ' + at(x) + (x.feeling.length ? ' 当时的感觉：' + x.feeling.join('、') : '') + (x.kind === '回想' ? '（这是一条回想）' : ''))
  }
  if (rc.revised.length) {
    lines.push('回头想过的：')
    for (const x of rc.revised) lines.push('- ' + at(x) + ' → ' + x.laterDay + ' 写了「' + snippet(x.thought, 60) + '」')
  }
  if (rc.feelingShifts.length) {
    lines.push('感觉变了的：')
    for (const x of rc.feelingShifts) lines.push('- ' + at(x) + '：当时 ' + (x.then.length ? x.then.join('、') : '没写') + ' → ' + x.laterDay + ' ' + x.now.join('、'))
  }
  if (rc.settled.length) {
    lines.push('有了决定的：')
    for (const x of rc.settled) lines.push('- 「' + x.unfinished + '」' + (x.choice === 'done' ? '想通了' : '先放下了') + '（' + x.stateDay + '，' + x.id + '）')
  }
  if (rc.reopened.length) {
    lines.push('又拾起来的：')
    for (const x of rc.reopened) lines.push('- 「' + x.unfinished + '」（' + x.stateDay + '，' + x.id + '）')
  }
  if (rc.stillOpen.length) {
    lines.push('还没弄完的：')
    for (const x of rc.stillOpen) lines.push('- 「' + x.unfinished + '」（' + x.id + '）')
  }
  lines.push('（这些是记录，不是结论。想写一条回想，就用 write --kind 回想 --refs 带上你想到的那几条 id；不想写也可以。）')
  return lines.join('\n')
}
