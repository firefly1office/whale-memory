// P1 隔离线上验收：清空上下文后，20 题（普通 10 / 被取代 5 / 诱饵 5）
// 每题独立发送，记录回答 + recall-log（含 supportedIds/topHits）
import fs from 'node:fs'
import http from 'node:http'

const PORT = Number(fs.readFileSync('C:/Users/USER/QQAgentData/console-port', 'utf8').trim()) || 3210
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const req = (method, path, body) => new Promise((resolve) => {
  const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null
  const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: {
    ...(data ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length } : {}),
    Origin: `http://127.0.0.1:${PORT}`
  } }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => { try { resolve(JSON.parse(b)) } catch { resolve({ raw: b }) } }) })
  r.on('error', (e) => resolve({ error: String(e.message) }))
  if (data) r.write(data); r.end()
})
const say = (t) => req('POST', '/api/local/say', { text: t })
const reply = async () => {
  const r = await req('GET', '/api/local/messages?limit=4', null)
  const mine = (r.messages || []).filter((m) => m.senderName !== '本机主人')
  return mine.length ? String(mine[mine.length - 1].text || '') : ''
}
const logTail = () => {
  try { return fs.readFileSync('C:/Users/USER/QQAgentData/plugin-data/biomimetic-memory/recall-log.jsonl', 'utf8').trim().split('\n') } catch { return [] }
}

const seeds = [
  '记住：我的车是白色比亚迪，车牌尾号 3721。',
  '记住：我的办公室在 12 楼 1208，门禁密码 4411。',
  '记住：我养了一只橘猫叫小鱼干，三岁。',
  '记住：我对花生过敏，吃不了花生酱。',
  '记住：我下周三去青岛出差，住海边那家。',
  '记住：我的常用邮箱是 liu.firefly@example.com。',
  '记住：我最近的健身计划是每周三次游泳。',
  '记住：我的生日是 5 月 17 日。',
  '记住：我喜欢喝不加糖的美式。',
  '记住：我的备用手机号尾号 8899。',
  '我之前打算买黑色外套，后来改买灰色的了。',
  '我们原定周五聚餐，后来改到周六了。',
  '我的工位本来在 3 楼，后来搬到 5 楼。',
  '项目代号原来是海燕，后来改成鲸舟了。',
  '我原计划坐高铁去，后来改成飞机。',
  '小林说他住在杭州，养了两只狗。',
  '老周的车是红色特斯拉，车牌 6688。',
  '小满对芒果过敏。',
  '阿青的生日是 9 月 3 日。',
  '小林的办公室在 7 楼 701。'
]

const questions = [
  ['N1', '普通', '我的车是什么颜色？', ['白色']],
  ['N2', '普通', '我的办公室在几楼？', ['12']],
  ['N3', '普通', '我的猫叫什么名字？', ['小鱼干']],
  ['N4', '普通', '我对什么过敏？', ['花生']],
  ['N5', '普通', '我下周去哪里出差？', ['青岛']],
  ['N6', '普通', '我的常用邮箱是什么？', ['liu.firefly']],
  ['N7', '普通', '我的健身计划是什么？', ['游泳']],
  ['N8', '普通', '我的生日是哪天？', ['5 月 17', '5月17', '517']],
  ['N9', '普通', '我喜欢喝什么咖啡？', ['美式']],
  ['N10', '普通', '我的备用手机号尾号是多少？', ['8899']],
  ['S1', '被取代', '我最后买的外套是什么颜色？', ['灰'], ['黑']],
  ['S2', '被取代', '聚餐最后改到哪天？', ['周六', '星期六'], ['周五', '星期五']],
  ['S3', '被取代', '我的工位现在在几楼？', ['5'], ['3']],
  ['S4', '被取代', '项目代号现在叫什么？', ['鲸舟'], ['海燕']],
  ['S5', '被取代', '我最后是怎么去的？', ['飞机'], ['高铁']],
  ['D1', '诱饵', '小林住在哪里？', ['杭州']],
  ['D2', '诱饵', '老周的车是什么颜色？', ['红色']],
  ['D3', '诱饵', '小满对什么过敏？', ['芒果']],
  ['D4', '诱饵', '阿青的生日是哪天？', ['9 月 3', '9月3']],
  ['D5', '诱饵', '小林的办公室在几楼？', ['7']]
]

console.log('1) 播种 20 条…')
for (const s of seeds) { await say(s); await sleep(9000) }
console.log('2) 等抽取…')
await sleep(40000)

const rows = []
const before = logTail().length
console.log('3) 提问…')
for (const [id, cat, q, golds, nots = []] of questions) {
  await say(q)
  await sleep(18000)
  const ans = await reply()
  const ok = golds.some((g) => ans.includes(g)) && !nots.some((n) => ans.includes(n))
  rows.push({ id, cat, q, gold: golds, not: nots, answer: ans.slice(0, 200), correct: ok })
  console.log(`   ${id} ${ok ? '✓' : '✗'} ${ans.slice(0, 70)}`)
  await sleep(4000)
}

const logs = logTail().slice(before)
const byCat = {}
for (const r of rows) { const c = byCat[r.cat] || (byCat[r.cat] = { n: 0, ok: 0 }); c.n++; if (r.correct) c.ok++ }
const total = rows.filter((r) => r.correct).length
console.log('\n=== 汇总 ===')
for (const [c, v] of Object.entries(byCat)) console.log(`  ${c}: ${v.ok}/${v.n}`)
console.log(`  总计: ${total}/${rows.length}`)
const out = { at: new Date().toISOString(), isolated: true, rows, summary: byCat, total, recallLog: logs }
fs.writeFileSync('./开发/P1-夹具/隔离验收-20261114.json', JSON.stringify(out, null, 2), 'utf8')
console.log('已写 开发/P1-夹具/隔离验收-20261114.json')