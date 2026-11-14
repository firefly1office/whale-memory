// 虚拟对话全链路沙盘：不碰线上、不需要主人参与
// 消息 → 巩固/抽取 → 记忆库 → 检索，验证普通事实/更正/诱饵
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUG = 'C:/Users/USER/AppData/Local/Programs/QQ Agent/resources/app/plugins/biomimetic-memory'
const { createBiomimeticMemory } = await import(pathToFileURL(path.join(PLUG, 'lib/memory.js')).href)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-'))
const messagesDir = path.join(root, 'messages')
fs.mkdirSync(messagesDir, { recursive: true })
const t0 = Date.now() - 3600 * 1000
let seq = 0
const msg = (senderId, text) => ({ id: ++seq, mid: 100000 + seq, ts: t0 + seq * 60000, senderId, senderName: senderId === 'self' ? '我' : senderId, text, self: senderId === 'self', read: true, reply: null, media: [] })

const dialog = [
  msg('100000000', '记住：我的车是白色比亚迪，尾号 3721。'),
  msg('self', '记下了。'),
  msg('100000000', '记住：我养了一只橘猫叫小鱼干。'),
  msg('self', '小鱼干，好名字。'),
  msg('100000000', '我本来打算买黑色外套，后来改买灰色的了。'),
  msg('self', '灰色好看。'),
  msg('100000000', '我原计划坐高铁去，后来改成飞机。'),
  msg('self', '飞机快。'),
  msg('2717617173', '小林说他住在杭州，养了两只狗。'),
  msg('self', '杭州不错。'),
  msg('100000000', '别忘了，我的生日是 5 月 17 日。'),
  msg('self', '记着呢。')
]
fs.writeFileSync(path.join(messagesDir, 'private_10086.json'), JSON.stringify({ messages: dialog }), 'utf8')

const memoryRoot = path.join(root, 'memory')
const vaultRoot = path.join(root, 'vault')
const mem = createBiomimeticMemory({ messagesDir, memoryRoot, vaultRoot })

console.log('1) 巩固/抽取…')
const results = mem.consolidate({ personaEnabled: false, allowNativeArchiveFallback: true }) || []
console.log('   会话结果:', results.map((r) => `${r.chatKey}:+${r.added}`).join(' '))
console.log('2) 同步记忆库…')
try { console.log('   sync:', JSON.stringify(mem.syncVault())) } catch (e) { console.log('   sync 失败', e.message) }

const dump = Object.values(JSON.parse(fs.readFileSync(path.join(vaultRoot, 'index.json'), 'utf8')).records || {});
console.log('3) 库内记录:');
for (const r of dump) console.log('   -', String(r.id).slice(0,8), '| pid', String(r.personId||'?').slice(0,12), '|', String(r.title||r.summary||'').slice(0,50));
const chatKeys = ['private_10086', 'private_10086#p_test000000']
const cases = [
  ['普通事实', '我的车是什么颜色', ['白色']],
  ['普通事实', '我的猫叫什么', ['小鱼干']],
  ['普通事实', '我的生日是哪天', ['5 月 17', '5月17']],
  ['更正', '我最后买的外套什么颜色', ['灰色', '灰']],
  ['更正', '最后坐什么去的', ['飞机']],
  ['诱饵', '小林住在哪里', ['杭州'], ['2717617173']]
]
let pass = 0
for (const [label, q, wants, pids] of cases) {
  let hits = []
  for (const ck of chatKeys) {
    hits = mem.search(q, { chatKey: ck, personIds: pids || ['100000000'], limit: 5 })
    if (hits.length) break
  }
  const blob = hits.map((h) => `${h.title || ''} ${h.text || h.summary || ''}`).join(' ')
  const ok = wants.some((w) => blob.includes(w))
  if (ok) pass++
  console.log(`   ${ok ? '✓' : '✗'} [${label}] ${q} → ${hits.length} 条 | ${blob.replace(/\s+/g, ' ').slice(0, 70)}`)
}
console.log(`\n${pass}/${cases.length} 通过`)
console.log('沙盘目录:', root)
fs.rmSync(root, { recursive: true, force: true })