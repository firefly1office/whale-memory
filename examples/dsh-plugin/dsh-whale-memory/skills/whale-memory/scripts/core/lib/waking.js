// 醒来块：每天第一次被唤醒时，给她一条自己的时间线
import fs from 'node:fs'
import path from 'node:path'
import * as exp from './self-experience.js'

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

function dayStr(d = new Date()) { return d.toLocaleDateString('sv-SE') }

// 只认得出一对一的会话键（private_* / private:* / local_* / local:*）；认不出的一律当成可能有别人在，宁可不给
const PRIVATE_KEY = /^(private|local)[:_]/i
function mayShow(key, allowGroup) {
  return Boolean(key) && (allowGroup || PRIVATE_KEY.test(key))
}

// 给宿主用的同一个判断：注入记忆前先问它，别自己写"不是群就行"
export function isPrivateKey(chatKey) {
  return mayShow(String(chatKey || '').trim(), false)
}

// 只读：算出「今天该给她看什么」，不写任何文件
// 调用方确认真的把这段注入了，再调 consumeWaking 记「已展示」
// 安全默认：没有 chatKey、或不是认得出的一对一会话（未显式 allowGroup）→ 返回空
// 醒来块里可能有昨天私下的话，默认不该流到群里
export function buildWakingBlock(dataDir, chatKey, { now = new Date(), allowGroup = false } = {}) {
  const key = String(chatKey || '').trim()
  if (!mayShow(key, allowGroup)) return ''

  const dir = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  const today = dayStr(now)
  const flag = path.join(dir, 'waking-flags.json')
  let flags = {}
  try { flags = JSON.parse(fs.readFileSync(flag, 'utf8')) } catch {}
  const dedupeKey = key + '|' + today
  if (flags[dedupeKey]) return ''

  // 用合并后的视图：明确想通/暂放的不再进入未完列表；旧库没有状态事件，行为不变
  // 她封存了的经历不出现在醒来块里，昨天的、没弄完的都一样
  let loaded = []
  try { loaded = exp.loadAll(dir) } catch { }
  const rows = loaded.filter((r) => !r.sealed).map((r) => ({
    day: r.day,
    text: r.then.text,
    unfinished: r.then.unfinished,
    weight: r.weight,
    later: r.later || [],
    state: r.unfinishedState || null
  })).filter((r) => r.text)
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
  const unfinished = rows.filter((r) => r.unfinished && !(r.state && (r.state.choice === 'done' || r.state.choice === 'shelved'))).slice(-2)
  for (const r of unfinished) lines.push('- 你还没弄完：' + String(r.unfinished).slice(0, 50))
  lines.push('（这些是记录，不是别人告诉你的。要不要接着想，你自己定。）')
  return lines.join('\n')
}

// 确认已展示：写入 flags，之后同一天同一会话不会再出
export function consumeWaking(dataDir, chatKey, { now = new Date(), allowGroup = false } = {}) {
  const key = String(chatKey || '').trim()
  if (!mayShow(key, allowGroup)) return false

  const dir = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(dir, { recursive: true })
  const flag = path.join(dir, 'waking-flags.json')
  let flags = {}
  try { flags = JSON.parse(fs.readFileSync(flag, 'utf8')) } catch {}
  flags[key + '|' + dayStr(now)] = new Date().toISOString()
  fs.writeFileSync(flag, JSON.stringify(flags), 'utf8')
  return true
}

export function leaveNote(dataDir, text) {
  const dir = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(dir, { recursive: true })
  const row = { at: new Date().toISOString(), day: dayStr(), text: String(text || '').slice(0, 300) }
  fs.appendFileSync(path.join(dir, 'notes-to-tomorrow.jsonl'), JSON.stringify(row) + '\n', 'utf8')
  return row
}