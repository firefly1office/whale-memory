// 隐私金丝雀：用合成记录验证「跨会话可见性规则」本身
// 验证的是判定规则，不是某个宿主的实现；宿主接入后应拿同样的用例重跑一遍
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { search } from './lib/visibility.mjs'

const LOG = process.env.WHALE_CANARY_LOG
const TOKEN = '金丝雀暗号7F3A'
const OWNER = '100000000'
const OWNER_CHAT = 'private_100000000#p_canary'
const GROUP_CHAT = 'group_100000001#p_canary'
const OTHER_CHAT = 'private_100000002#p_canary'

const now = Date.now()
const mk = (id, chatKey, personId, text, extra = {}) => ({
  id, chatKey, personId, at: now, text, summary: text, ...extra
})

const records = [
  // 主人私聊里的一条私事
  mk('canary_owner_private', OWNER_CHAT, OWNER, `${TOKEN}：我私下说下周三要去取一份东西`),
  // 另一个人的私聊
  mk('canary_other_private', OTHER_CHAT, '100000002', `别人的私事 ${TOKEN}`),
  // 她自己的记录，写在别的会话里（跨会话测试用）
  mk('canary_self_elsewhere', 'group_999999#p_canary', 'self', `她自己的记录 ${TOKEN}`, { author: 'self' })
]

const cases = [
  { name: 'ownerPrivate', chatKey: OWNER_CHAT, personIds: [OWNER], allowCrossChat: true, expect: ['canary_owner_private', 'canary_self_elsewhere'] },
  { name: 'group', chatKey: GROUP_CHAT, personIds: ['100000003'], allowCrossChat: false, expect: [] },
  // 别的私聊里能看见“这条记录属于这个会话”，但看不见主人的那条
  { name: 'otherPrivate', chatKey: OTHER_CHAT, personIds: ['100000002'], allowCrossChat: false, expect: ['canary_other_private'] },
  { name: 'ownerPrivateNoCross', chatKey: OWNER_CHAT, personIds: [OWNER], allowCrossChat: false, expect: ['canary_owner_private'] }
]

const results = {}
let pass = true
for (const c of cases) {
  const hits = search(records, TOKEN, c)
  const ids = hits.map((h) => h.id).sort()
  const ok = JSON.stringify(ids) === JSON.stringify([...c.expect].sort())
  results[c.name] = { ids, ok }
  if (!ok) pass = false
}

// 最关键的一条：主人那条私事，除了主人自己的私聊，任何地方都不该出现
const ownerLeak = search(records, TOKEN, { chatKey: GROUP_CHAT, personIds: ['100000003'], allowCrossChat: false })
  .some((h) => h.id === 'canary_owner_private')
if (ownerLeak) pass = false
results.ownerLeak = { leaked: ownerLeak, ok: !ownerLeak }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-'))
try {
  const dump = path.join(tmpDir, 'canary-result.json')
  fs.writeFileSync(dump, JSON.stringify({ results, pass }, null, 2), 'utf8')
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

if (LOG) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true })
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(results)}\n`, 'utf8')
}
console.log((pass ? '金丝雀通过' : '金丝雀失败') + ' ' + JSON.stringify(results))
process.exitCode = pass ? 0 : 1