// open-threads shadow：只记录“本来会注入什么”，不注入
import fs from 'node:fs'
import path from 'node:path'
import { selectOpenThreads, isFollowUpQuery, renderOpenThreadsBlock } from 'file:///C:/Users/USER/AppData/Local/Programs/QQ%20Agent/resources/app/plugins/biomimetic-memory/lib/open-threads.js'

const DATA = 'C:/Users/USER/QQAgentData'
const DB = `${DATA}/plugin-data/biomimetic-memory/biomimetic-memory-db`
const OUT = `${DATA}/plugin-data/biomimetic-memory/threads-shadow.jsonl`
const DAYS = Number(process.argv[2] || 7)

const idx = JSON.parse(fs.readFileSync(path.join(DB, 'index.json'), 'utf8'))
const events = Object.values(idx.records || {}).map((r) => ({
  id: r.id,
  kind: r.kind,
  eventKind: r.eventKind || r.kind,
  title: r.title || r.topic,
  summary: r.summary,
  chatKey: r.chatKey,
  personId: r.personId,
  lastAt: Number(r.lastAt || r.validFrom || 0),
  status: 'open',
  threadEligible: r.threadEligible === true
}))

const since = Date.now() - DAYS * 86400000
let queries = 0, hits = 0, injectedChars = 0
const rows = []
const dir = path.join(DATA, 'messages')
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const chatKey = f.replace(/\.json$/, '')
  if (/^local_/.test(chatKey)) continue
  let arr = []
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); arr = Array.isArray(j) ? j : (j.messages || []) } catch { continue }
  for (const m of arr) {
    if (Number(m.ts) < since || m.self) continue
    const text = String(m.text || '')
    const strength = isFollowUpQuery(text)
    if (!strength) continue
    queries++
    const threads = selectOpenThreads(events, { query: text, chatKey, personId: String(m.senderId || '') })
    if (threads.length) {
      hits++
      const block = renderOpenThreadsBlock(threads)
      injectedChars += block.length
      rows.push({ at: new Date().toISOString(), chatKey, query: text.slice(0, 60), strength, items: threads, block })
    }
  }
}

fs.appendFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
console.log(`扫到追问 ${queries} 条，命中 ${hits} 条，注入字符 ${injectedChars}`)
if (rows.length) for (const r of rows.slice(-3)) console.log(' ', r.chatKey, '|', r.query, '|', r.items.map((i) => i.text).join(' / '))
console.log('shadow 记录:', OUT)