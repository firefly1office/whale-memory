// 醒来块：每天第一次被唤醒时，给她一条自己的时间线
import fs from 'node:fs'
import path from 'node:path'

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

function dayStr(d = new Date()) { return d.toLocaleDateString('sv-SE') }

export function buildWakingBlock(dataDir, chatKey, { now = new Date() } = {}) {
  // 醒来块只给主人私聊和本机操作台；群聊不注入，避免把昨天私下的话带出去
  if (!/private_100000000|local:owner/i.test(String(chatKey || ''))) return ''
  const dir = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  const today = dayStr(now)
  const flag = path.join(dir, 'waking-flags.json')
  let flags = {}
  try { flags = JSON.parse(fs.readFileSync(flag, 'utf8')) } catch {}
  const key = chatKey + '|' + today
  if (flags[key]) return ''
  flags[key] = new Date().toISOString()
  try { fs.writeFileSync(flag, JSON.stringify(flags), 'utf8') } catch {}

  const rows = readJsonl(path.join(dir, 'self-experience.jsonl')).map((r) => {
    if (r.then) return { day: r.day, text: r.then.text, unfinished: r.then.unfinished, weight: r.weight, later: r.later || [] }
    return { day: r.day, text: r.text, unfinished: '', weight: r.weight || 'normal', later: [] }
  }).filter((r) => r.text)
  const y = new Date(now.getTime() - 86400000).toLocaleDateString('sv-SE')
  const yRows = rows.filter((r) => r.day === y)
  const notes = readJsonl(path.join(dir, 'notes-to-tomorrow.jsonl'))
  const lastNote = [...notes].reverse().find((n) => n.day === y)

  const lines = ['【醒来】今天是 ' + today + '。']
  if (yRows.length) {
    lines.push('昨天你自己的时候：')
    for (const r of yRows.slice(-3)) lines.push('- ' + String(r.text).slice(0, 60))
  } else {
    lines.push('昨天你没有留下自己的记录。')
  }
  if (lastNote && lastNote.text) lines.push('昨天睡前你给今天留了一句：' + String(lastNote.text).slice(0, 120))
  const unfinished = rows.filter((r) => r.unfinished).slice(-2)
  for (const r of unfinished) lines.push('- 你还没弄完：' + String(r.unfinished).slice(0, 50))
  lines.push('（这些是记录，不是别人告诉你的。要不要接着想，你自己定。）')
  return lines.join('\n')
}

export function leaveNote(dataDir, text) {
  const dir = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  const row = { at: new Date().toISOString(), day: dayStr(), text: String(text || '').slice(0, 300) }
  fs.appendFileSync(path.join(dir, 'notes-to-tomorrow.jsonl'), JSON.stringify(row) + '\n', 'utf8')
  return row
}