// 把她自己说过的话（群聊+私聊）提炼成她自己的事实，落成"待确认"条目（分批）
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const DATA = 'C:/Users/USER/QQAgentData'
const MSG = path.join(DATA, 'messages')
const OUT = path.join(DATA, 'plugin-data', 'biomimetic-memory', 'self-facts.jsonl')
const CFG = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8'))
const DAYS = Number(process.argv[2] || 7)
const since = Date.now() - DAYS * 86400000

function readJsonl(f) {
  try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}

const lines = []
for (const f of fs.readdirSync(MSG)) {
  if (!f.endsWith('.json') || f.startsWith('local_')) continue
  const chat = f.replace('.json', '')
  let arr = []
  try { const j = JSON.parse(fs.readFileSync(path.join(MSG, f), 'utf8')); arr = Array.isArray(j) ? j : (j.messages || []) } catch { continue }
  for (const m of arr) {
    if (!m.self || Number(m.ts) < since) continue
    const t = String(m.text || '').replace(/\n/g, ' ').trim()
    if (t.length < 4) continue
    lines.push({ chat, day: new Date(Number(m.ts)).toLocaleDateString('sv-SE'), t: t.slice(0, 80) })
  }
}
console.log('近', DAYS, '天她说的话', lines.length, '条')

const batches = []
for (let i = 0; i < lines.length; i += 50) batches.push(lines.slice(i, i + 50))

function promptFor(batch) {
  const list = batch.map((x, i) => `${i + 1}. [${x.day}|${x.chat}] ${x.t}`).join('\n')
  return `下面这些是 AI 角色「鲸鲸」自己说过的话。只提取**关于她本人**、可以长期成立的事实。
规则：
- 只收：她的喜好、习惯、边界、经历、近况
- 出现别人的名字/称呼/私事、具体数字金额地址 → 不要
- 一条 ≤ 30 字；每条带 evidence（能对上的短句 ≤20 字）和日期
- 最多 8 条；宁可少
- 只输出 JSON 数组：[{"value":"我喜欢吃黄焖鸡","category":"偏好","evidence":"黄焖鸡吧，下饭","day":"2026-11-14"}]

她说过的话：
${list}`
}

function ask(prompt) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.api.apiKey}` } }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { try { resolve(String(JSON.parse(b).choices[0].message.content || '').trim()) } catch { resolve('') } })
    })
    req.on('error', () => resolve(''))
    req.write(JSON.stringify({ model: CFG.api.model, messages: [{ role: 'system', content: '你只输出 JSON。' }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 1500 }))
    req.end()
  })
}

const all = []
for (const [bi, batch] of batches.entries()) {
  let raw = ''
  for (let i = 0; i < 2 && !raw; i++) raw = await ask(promptFor(batch))
  const clean = raw.replace(/^```json\s*|```$/g, '').trim()
  let arr = null
  try { arr = JSON.parse(clean) } catch { try { arr = JSON.parse(clean.slice(clean.indexOf('['), clean.lastIndexOf(']') + 1)) } catch {} }
  if (Array.isArray(arr)) { all.push(...arr); console.log('批', bi + 1, '→', arr.length) }
  else console.error('批', bi + 1, '空/失败, len', raw.length)
}

const existing = new Set(readJsonl(OUT).map((x) => x.value))
const seen = new Set()
const rows = all.filter((x) => x && x.value).map((x) => ({
  at: new Date().toISOString(),
  value: String(x.value).slice(0, 60),
  category: ['身份', '偏好', '边界', '近况'].includes(x.category) ? x.category : '近况',
  evidence: String(x.evidence || '').slice(0, 40),
  day: String(x.day || '').slice(0, 10),
  status: 'candidate',
  source: '她说的话'
})).filter((x) => {
  if (existing.has(x.value) || seen.has(x.value)) return false
  seen.add(x.value)
  return true
}).slice(0, 24)

if (rows.length) fs.appendFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
console.log('新增待确认', rows.length, '条')
for (const r of rows) console.log('  [' + r.category + '] ' + r.value + '  ← ' + r.evidence + ' (' + r.day + ')')