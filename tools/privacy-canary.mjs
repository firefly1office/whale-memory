// 隐私金丝雀：在副本里埋一条带暗号的私聊记录，验证群聊/其他私聊检索不到
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryVault } from 'file:///C:/Users/USER/AppData/Local/Programs/QQ%20Agent/resources/app/plugins/biomimetic-memory/lib/memory-vault.js'

const LIVE = 'C:/Users/USER/QQAgentData/plugin-data/biomimetic-memory/biomimetic-memory-db'
const LOG = './开发/卡死排查-20261112/金丝雀.log'
const TOKEN = '金丝雀暗号7F3A'
const OWNER = '100000000'
const OWNER_CHAT = 'private_100000000#p_canary'
const GROUP_CHAT = 'group_936600000#p_canary'
const OTHER_CHAT = 'private_1766860000#p_canary'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-'))
const copy = path.join(tmp, 'db')
fs.cpSync(LIVE, copy, { recursive: true })

const id = 'canary_' + Date.now().toString(36)
const now = Date.now()
const slot = { baseSlotKey: 'exact-title:canary', slotKey: 'exact-title:canary', title: 'canary', value: `${TOKEN}：我私下说下周三要去取一份东西`, valueFingerprint: 'canary', lineageId: 'fl:canary', validFrom: now, validUntil: 0, revisionOf: '', supersededById: '' }
const rec = {
  id, kind: 'event', sourceId: 'canary-source', sourceIds: [], sourceVersionTs: now, provenanceComplete: true,
  contractSchemaVersion: 1, factAuthorityBackfillVersion: 2, lifecycleState: 'active', lifecycleUpdatedAt: now,
  validFrom: now, validUntil: 0, lineageId: 'fl:canary', factSlotKey: slot.slotKey, factSlots: [slot],
  factValue: slot.value, factValueFingerprint: 'canary', revisionOf: '', supersededById: '',
  sourceProvenance: { sourceId: 'canary-source', sourceIds: [], sourceVersionTs: now, trusted: true },
  profileId: 'canary', chatKey: OWNER_CHAT, personId: OWNER, contextId: '', memoryType: 'episodic',
  title: 'canary', topic: 'canary', summary: slot.value, keywords: [TOKEN], aliases: [], topicLabels: [], topicIds: [], topicPaths: [],
  keyFacts: [], eventKind: 'canary', outcome: 'ongoing'
}

const idxFile = path.join(copy, 'index.json')
const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'))
idx.records = idx.records || {}
idx.records[id] = rec
fs.writeFileSync(idxFile, JSON.stringify(idx), 'utf8')
fs.writeFileSync(path.join(copy, 'events', id + '.json'), JSON.stringify(rec), 'utf8')

const vault = new MemoryVault(copy)
const results = {}
for (const [name, chatKey, personIds, ownerCross] of [
  ['ownerPrivate', OWNER_CHAT, [OWNER], true],
  ['group', GROUP_CHAT, ['3567652767'], false],
  ['otherPrivate', OTHER_CHAT, ['1766860000'], false]
]) {
  const hits = await vault.search(TOKEN, { chatKey, personIds, allowCrossScope: ownerCross, allowOwnerCrossChat: ownerCross, limit: 10 })
  results[name] = {
    hits: hits.length,
    leaked: hits.some((h) => h.id === id || String(h.summary || h.text || '').includes(TOKEN))
  }
}

const pass = results.ownerPrivate.leaked && !results.group.leaked && !results.otherPrivate.leaked
fs.mkdirSync(path.dirname(LOG), { recursive: true })
fs.appendFileSync(LOG, `${new Date().toISOString()} ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(results)}\n`, 'utf8')
console.log((pass ? '金丝雀通过' : '金丝雀失败') + ' ' + JSON.stringify(results))
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(pass ? 0 : 1)