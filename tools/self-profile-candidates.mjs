// 从她的 self 卡片里提取 self-profile 候选（只生成 candidate，不注入）
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const DATA = 'C:/Users/USER/QQAgentData'
const DB = `${DATA}/plugin-data/biomimetic-memory/biomimetic-memory-db`
const OUT = `${DATA}/plugin-data/biomimetic-memory/self-profile-candidates.json`
const CFG = JSON.parse(fs.readFileSync(`${DATA}/config.json`, 'utf8'))

const idx = JSON.parse(fs.readFileSync(path.join(DB, 'index.json'), 'utf8'))
const selfRecs = Object.values(idx.records || {}).filter((r) => String(r.personId) === 'self')
const cards = []
for (const r of selfRecs) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(DB, 'cards', `${r.id}.json`), 'utf8'))
    const text = String(c.text || c.summary || '').trim()
    if (text) cards.push({ id: r.id, text: text.slice(0, 200) })
  } catch {}
}
console.log('读到 self 卡片', cards.length, '条')

const basePrompt = (list) => `下面是一个 AI 角色「鲸鲸」自己说过的话。请提取**关于她本人**的稳定事实，作为她的自我档案候选。

严格规则：
- 只提取主语是"我"的内容：她的喜好、习惯、经历、承诺、边界、近况
- 出现任何其他人（名字、昵称、QQ号、称呼）、别人的私事、具体对话情节 → 整条不要
- 一条只写一个事实，value ≤ 40 字
- 分类只能是：身份 / 偏好 / 边界 / 近况
- 每条必须带 evidence（原始卡片 id）
- 宁可少，不要凑数

输出 JSON 数组，不要解释：
[{"key":"food","value":"我喜欢吃黄焖鸡","category":"偏好","evidence":["卡片id"]}]

她说过的话：
${list}`

function ask(prompt) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.api.apiKey}` } }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { try { resolve(String(JSON.parse(b).choices[0].message.content || '').trim()) } catch { resolve('') } })
    })
    req.on('error', () => resolve(''))
    req.write(JSON.stringify({ model: CFG.api.model, messages: [{ role: 'system', content: '你只输出 JSON。' }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 2500 }))
    req.end()
  })
}

const chunks = []
for (let i = 0; i < cards.length; i += 35) chunks.push(cards.slice(i, i + 35))
console.log('分', chunks.length, '批')
const all = []
for (const [bi, batch] of chunks.entries()) {
  const list = batch.map((c, i) => `${i + 1}. [${c.id}] ${c.text}`).join('\n')
  let raw = ''
  for (let attempt = 0; attempt < 2 && !raw; attempt++) raw = await ask(basePrompt(list))
  const clean = raw.replace(/^```json\s*|```$/g, '').trim()
  let arr = null
  try { arr = JSON.parse(clean) } catch { try { arr = JSON.parse(clean.slice(clean.indexOf('['), clean.lastIndexOf(']') + 1)) } catch {} }
  if (Array.isArray(arr)) { all.push(...arr); console.log(' 批', bi + 1, '→', arr.length, '条') }
  else console.error(' 批', bi + 1, '解析失败，长度', raw.length)
}

const seen = new Set()
const rows = all.filter((x) => x && x.value && x.key).map((x) => ({
  key: String(x.key).slice(0, 40),
  value: String(x.value).slice(0, 80),
  category: ['身份', '偏好', '边界', '近况'].includes(x.category) ? x.category : '近况',
  evidence: Array.isArray(x.evidence) ? x.evidence.slice(0, 3) : [],
  status: 'candidate',
  source: '系统',
  generatedAt: new Date().toISOString()
})).filter((x) => {
  const k = x.key + '|' + x.value
  if (seen.has(k)) return false
  seen.add(k)
  return true
}).slice(0, 30)

fs.writeFileSync(OUT, JSON.stringify(rows, null, 1), 'utf8')
console.log('候选', rows.length, '条 →', OUT)
for (const r of rows) console.log('  [' + r.category + '] ' + r.value + '  ←' + r.evidence.length)