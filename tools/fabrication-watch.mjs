// 编造观察：扫她当天说过的"关于自己"的断言，凡是查不到出处的，记下来
import fs from 'node:fs'
import path from 'node:path'

const DATA = 'C:/Users/USER/QQAgentData'
const OUT = path.join(DATA, 'plugin-data', 'biomimetic-memory', 'fabrication-watch.jsonl')
const MEM = path.join(DATA, 'plugin-data', 'biomimetic-memory')
const TODAY = new Date().toLocaleDateString('sv-SE')

function readJsonl(f) {
  try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}

// 已知出处：确认档案 + 待确认事实 + 她自己的经历 + 日记 + 自述
const known = []
for (const r of readJsonl(path.join(MEM, 'self-profile.json'))) known.push(String(r.value || ''))
for (const r of readJsonl(path.join(MEM, 'self-facts.jsonl'))) known.push(String(r.value || ''))
for (const r of readJsonl(path.join(MEM, 'self-experience.jsonl'))) known.push(String((r.then && r.then.text) || r.text || ''))
for (const r of readJsonl(path.join(MEM, 'autobiography.jsonl'))) known.push(String(r.event || ''))
for (const r of readJsonl(path.join(MEM, 'self-summary.jsonl'))) known.push(String(r.paragraph || ''))
const knownText = known.join(' ').replace(/[\s\p{P}\p{S}]+/gu, '')

const CLAIM = /(我喜欢|我爱|我最爱|我不喜欢|我吃|我不吃|我住|我是|我怕|我不怕|我想要|我不想|最爱|也行|排第|喜欢)/
const rows = []
for (const f of fs.readdirSync(path.join(DATA, 'messages'))) {
  if (!f.endsWith('.json') || f.startsWith('local_')) continue
  let arr = []
  try { const j = JSON.parse(fs.readFileSync(path.join(DATA, 'messages', f), 'utf8')); arr = Array.isArray(j) ? j : (j.messages || []) } catch { continue }
  for (const m of arr) {
    if (!m.self) continue
    if (new Date(Number(m.ts)).toLocaleDateString('sv-SE') !== TODAY) continue
    const t = String(m.text || '').replace(/\n/g, ' ').trim()
    if (!CLAIM.test(t) || t.length < 4 || t.length > 120) continue
    const clean = t.replace(/[\s\p{P}\p{S}]+/gu, '')
    // 用 4 字滑窗看能否在出处里找到
    let hit = 0
    for (let i = 0; i + 4 <= clean.length; i++) if (knownText.includes(clean.slice(i, i + 4))) hit++
    const ratio = clean.length > 3 ? hit / Math.max(1, clean.length - 3) : 1
    if (ratio >= 0.35) continue
    rows.push({ at: new Date().toISOString(), chat: f.replace('.json', ''), text: t.slice(0, 80), hit, chars: clean.length })
  }
}
if (rows.length) fs.appendFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
console.log('今日可疑断言', rows.length, '条')
for (const r of rows.slice(-8)) console.log('  [' + r.chat + '] ' + r.text)