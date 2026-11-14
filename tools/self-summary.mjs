// 最近的我：从自传体日记提炼一周的“主线”（在意什么、变了什么、未完成）
import fs from 'node:fs'
import https from 'node:https'

const DATA = 'C:/Users/USER/QQAgentData'
const AUTO = `${DATA}/plugin-data/biomimetic-memory/autobiography.jsonl`
const OUT = `${DATA}/plugin-data/biomimetic-memory/self-summary.jsonl`
const MD = `${DATA}/plugin-data/biomimetic-memory/self-summary.md`
const CFG = JSON.parse(fs.readFileSync(`${DATA}/config.json`, 'utf8'))
const DAYS = Number(process.argv[2] || 7)
const since = new Date(Date.now() - DAYS * 86400000).toLocaleDateString('sv-SE')

const rows = fs.existsSync(AUTO)
  ? fs.readFileSync(AUTO, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).filter((r) => String(r.day || '') >= since)
  : []
if (!rows.length) { console.log('没有可用日记'); process.exit(0) }

const lines = rows.map((r) => `- ${r.day} ${r.time || ''}（${r.place || ''}）${r.event || ''}${r.i_said ? ' 我说「' + r.i_said + '」' : ''}${r.felt ? ' ' + r.felt : ''}`).join('\n')

function callModel(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: CFG.api.model, messages: [{ role: 'system', content: '你只输出 JSON，不要解释。' }, { role: 'user', content: prompt }], temperature: 0.4, max_tokens: 4000 })
    const req = https.request({ hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.api.apiKey}` } }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { try { resolve(String(JSON.parse(b).choices[0].message.content || '').trim()) } catch (e) { reject(new Error(b.slice(0, 160))) } })
    })
    req.on('error', reject); req.write(body); req.end()
  })
}

const prompt = `下面这些是「鲸鲸」最近 ${DAYS} 天自己说过/做过的事（第一人称日记）。请提炼成她的“最近的我”，只依据这些内容，不编造：
输出 JSON：{"paragraph":"一段第一人称自述，120字内，像她自己回想这几天","care_about":["在意的事"],"changed":["有变化的地方"],"unfinished":["没做完/想继续的事"],"sources":["支撑上面判断的原文片段，最多5条"]}
规则：paragraph 用“我”的口吻；没有依据的字段给空数组；不要写评价她的话。
最近 ${DAYS} 天日记（${rows.length} 条）：
${lines}`

let raw = await callModel(prompt)
if (!raw) raw = await callModel(prompt + '\n直接输出 JSON。')
let data
try { data = JSON.parse(raw.replace(/^```json\s*|```$/g, '').trim()) } catch (e) { console.error('解析失败', raw.slice(0, 200)); process.exit(1) }

const week = `${since}~${new Date().toLocaleDateString('sv-SE')}`
const row = { at: new Date().toISOString(), week, days: DAYS, entries: rows.length, ...data, confirmed: false }
fs.appendFileSync(OUT, JSON.stringify(row) + '\n', 'utf8')
fs.appendFileSync(MD, `## ${week}\n\n${row.paragraph}\n\n在意：${(row.care_about || []).join('；') || '—'}\n变化：${(row.changed || []).join('；') || '—'}\n没做完：${(row.unfinished || []).join('；') || '—'}\n\n`, 'utf8')
console.log('本周自述：', row.paragraph)
console.log('在意：', (row.care_about || []).join('；'))
console.log('变化：', (row.changed || []).join('；'))
console.log('未完成：', (row.unfinished || []).join('；'))
console.log('来源条数：', (row.sources || []).length)