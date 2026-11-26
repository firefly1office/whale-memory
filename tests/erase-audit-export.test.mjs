// 阶段 4：擦除（整条撤回 + 墓碑）、审计、导出。
//
// 验收口径：
// 1. 擦除后 loadAll / recall（字面 / 混合 / 旧门槛）/ 分页 / 导出 / doctor 都查不到；
//    墓碑只有 id / 时间 / 原因 / 哈希，不含正文；
// 2. 擦除幂等；文件有坏行时整体拒绝，不留半条；
// 3. 审计：读一次、召回一次、擦一次各一条；正文关键词在审计文件里 0 命中；
// 4. 导出与同条件全量读逐条一致。
//
// 所有数据目录都是现造现删的临时目录，不碰真实数据。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { tmpDir, safeRemove } from './_safety.mjs'
import * as exp from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import * as tombstones from '../packages/core/lib/tombstones.js'
import * as audit from '../packages/core/lib/audit.js'
import { exportMemory } from '../packages/core/lib/export-memory.js'
import { runDoctor } from '../tools/doctor.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const NEW = (t) => {
  const dir = tmpDir('whale-erase-')
  t.after(() => safeRemove(dir))
  return dir
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
const fileOf = (dir, name) => path.join(dir, name)
const readText = (dir, name) => {
  try { return fs.readFileSync(fileOf(dir, name), 'utf8') } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}
const linesOf = (dir, name) => (readText(dir, name) || '').split('\n').filter((line) => line.trim())
const rowsOf = (dir, name) => linesOf(dir, name).map((line) => JSON.parse(line))

// 一条经历的原始那一行（按 id 找）
const rawLineOf = (dir, id) => linesOf(dir, 'self-experience.jsonl').find((line) => {
  try { return JSON.parse(line).id === id } catch { return false }
})
const idsOf = (rows) => rows.map((r) => r.id)

// 一个"什么都有"的库：A 有后记 / 封存 / 想起 / 结案 / 联想 / 被别的记录引用；B 是一条干净的经历
function makeLibrary(dir) {
  const a = exp.addExperience(dir, { text: '灯塔下的约定 薄荷糖', thought: '她怕黑', unfinished: '要不要去问' })
  const b = exp.addExperience(dir, { text: '在码头折了一只纸船' })
  exp.reviseExperience(dir, { id: a.id, thought: '后来还是没问' })
  exp.setSealed(dir, { id: a.id, sealed: true, note: '先不想被提起' })
  exp.markRecalled(dir, a.id)
  exp.setUnfinishedState(dir, { id: a.id, choice: 'shelved', note: '先放着' })
  exp.linkExperiences(dir, { from: a.id, to: b.id, reason: '都在等' })
  const c = exp.addExperience(dir, { text: '从那件事想到的', refs: [a.id] })
  return { a, b, c }
}

test('擦除：loadAll / 三种召回路子 / 分页 / 导出 / doctor 都查不到', async (t) => {
  const dir = NEW(t)
  const { a, b, c } = makeLibrary(dir)
  const rawLine = rawLineOf(dir, a.id)
  const hash = sha256(rawLine)
  const rawB = rawLineOf(dir, b.id)
  const rawC = rawLineOf(dir, c.id)

  const res = eraseExperience(dir, { id: a.id, reason: '她本人要求撤回', actor: 'self' })
  assert.equal(res.ok, true)
  assert.equal(res.alreadyGone, false)
  assert.equal(res.id, a.id)
  assert.equal(res.hash, hash)
  assert.equal(res.removed.records, 1)

  // 读：全量
  assert.deepEqual(idsOf(exp.loadAll(dir)), [b.id, c.id])

  // 读：三种召回路子（字面 / 混合 / 旧门槛 loose）
  assert.equal(exp.recall(dir, '薄荷糖', { limit: 5 }).length, 0, '字面召回')
  assert.equal(exp.recall(dir, '薄荷糖', { limit: 5, ranker: 'hybrid' }).length, 0, '混合召回')
  assert.equal(exp.recall(dir, '薄荷糖', { limit: 5, gate: 'legacy', mode: 'loose' }).length, 0, '旧门槛召回')
  assert.equal(exp.recallForContext(dir, '薄荷糖', { max: 3 }).length, 0, '宿主自动召回')

  // 读：分页
  const page = await exp.page(dir, { limit: 10 })
  assert.deepEqual(idsOf(page.rows), [b.id, c.id])
  assert.equal(page.total, 2)

  // 导出
  assert.equal(exportMemory(dir).includes('薄荷糖'), false)

  // 体检：全绿，结果里也没有正文
  const report = runDoctor(dir)
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((x) => !x.ok)))
  assert.equal(JSON.stringify(report).includes('薄荷糖'), false)

  // 记录文件：正文没了；B / C 的原始那一行一个字节没动
  assert.equal(readText(dir, 'self-experience.jsonl').includes('薄荷糖'), false)
  assert.ok(readText(dir, 'self-experience.jsonl').includes(rawB), '其它记录必须原样保留')
  assert.ok(readText(dir, 'self-experience.jsonl').includes(rawC), '其它记录必须原样保留')

  // 关联事件：later / recall / unfinished / link 都没了；seal 留着（封存状态不是正文）
  for (const name of ['later-events.jsonl', 'recall-events.jsonl', 'unfinished-events.jsonl', 'link-events.jsonl']) {
    const text = readText(dir, name)
    assert.equal(text.includes(a.id), false, name + ' 里还留着被撤回的 id')
  }
  assert.equal(readText(dir, 'seal-events.jsonl').includes(a.id), true, '封存事件保留（文档里写明）')

  // 引用：C 的正文还在，出处指向的那条按"找不到了"报，不把正文带出来
  const stillC = exp.loadAll(dir).find((r) => r.id === c.id)
  assert.deepEqual(stillC.refsInfo, [{ id: a.id, missing: true }])
  assert.equal(JSON.stringify(stillC).includes('薄荷糖'), false)

  // 墓碑：只有 id / 时间 / 原因 / 哈希
  const tomb = tombstones.readAll(dir)
  assert.equal(tomb.bad, 0)
  assert.equal(tomb.rows.length, 1)
  const mark = tomb.rows[0]
  assert.deepEqual(Object.keys(mark).sort(), ['actor', 'at', 'hash', 'id', 'reason', 'v'])
  assert.equal(mark.v, 1)
  assert.equal(mark.id, a.id)
  assert.equal(mark.reason, '她本人要求撤回')
  assert.equal(mark.actor, 'self')
  assert.equal(mark.hash, hash, 'hash = 删除前那条记录的 sha256')
  assert.ok(Number.isFinite(Date.parse(mark.at)))
  assert.equal(JSON.stringify(mark).includes('薄荷糖'), false, '墓碑不含正文')
})

test('擦除：幂等——第二次是 alreadyGone，不再写第二条墓碑', (t) => {
  const dir = NEW(t)
  const { a } = makeLibrary(dir)
  eraseExperience(dir, { id: a.id, reason: '第一次', actor: 'self' })

  const again = eraseExperience(dir, { id: a.id, reason: '第二次', actor: 'self' })
  assert.equal(again.ok, true)
  assert.equal(again.alreadyGone, true)
  assert.equal(tombstones.readAll(dir).rows.length, 1, '墓碑只留一条')
  assert.equal(tombstones.readAll(dir).rows[0].reason, '第一次')

  // 本来就不存在的 id：同样是 alreadyGone，不报错、不写墓碑
  const ghost = eraseExperience(dir, { id: 'exp_never_existed', reason: '本来就没有', actor: 'leo' })
  assert.equal(ghost.ok, true)
  assert.equal(ghost.alreadyGone, true)
  assert.equal(tombstones.readAll(dir).rows.length, 1)
})

test('擦除：参数不全直接拒绝（撤回要说清为什么、谁要求的）', (t) => {
  const dir = NEW(t)
  const { a } = makeLibrary(dir)
  assert.throws(() => eraseExperience(dir, { id: a.id, reason: '', actor: 'self' }), /reason/)
  assert.throws(() => eraseExperience(dir, { id: a.id, reason: '她要求', actor: '' }), /actor/)
  assert.throws(() => eraseExperience(dir, { id: '', reason: 'x', actor: 'self' }), /id/)
  assert.ok(rawLineOf(dir, a.id), '拒绝的调用不许动数据')
  assert.equal(tombstones.readAll(dir).rows.length, 0)
})

test('擦除：经历文件有坏行时整体拒绝，一条都不删', (t) => {
  const dir = NEW(t)
  const { a } = makeLibrary(dir)
  const before = readText(dir, 'self-experience.jsonl')
  fs.appendFileSync(fileOf(dir, 'self-experience.jsonl'), '{"broken":\n', 'utf8')

  assert.throws(() => eraseExperience(dir, { id: a.id, reason: '她要求', actor: 'self' }), /无法解析|坏行/)
  assert.ok(rawLineOf(dir, a.id), '记录还在')
  assert.equal(tombstones.readAll(dir).rows.length, 0, '没有墓碑')
  assert.equal(readText(dir, 'self-experience.jsonl').startsWith(before), true, '文件没被改过（坏行也原样留着）')
})

test('擦除：关联事件文件读不出来时，先拒绝，不把记录删成半截', (t) => {
  const dir = NEW(t)
  const { a } = makeLibrary(dir)
  const before = readText(dir, 'self-experience.jsonl')
  // 把 link 事件文件换成一个目录：读它必然失败（EISDIR）
  fs.rmSync(fileOf(dir, 'link-events.jsonl'))
  fs.mkdirSync(fileOf(dir, 'link-events.jsonl'))

  assert.throws(() => eraseExperience(dir, { id: a.id, reason: '她要求', actor: 'self' }))
  assert.equal(readText(dir, 'self-experience.jsonl'), before, '记录文件一个字节都没动')
  assert.equal(tombstones.readAll(dir).rows.length, 0)
})

test('审计：读一次、召回一次、擦一次各一条；正文关键词 0 命中', (t) => {
  const dir = NEW(t)
  const { a, b } = makeLibrary(dir)

  audit.noteRead(dir, { actor: 'self', ids: [b.id], note: '读了这一条' })
  audit.noteRecall(dir, { actor: 'self', query: '薄荷糖 纸船', ids: [b.id] })
  eraseExperience(dir, { id: a.id, reason: '她要求', actor: 'self' })

  const rows = audit.read(dir)
  assert.deepEqual(rows.map((r) => r.action), ['read', 'recall', 'erase'])
  assert.deepEqual(rows[0].ids, [b.id])
  assert.deepEqual(rows[1].ids, [b.id])
  assert.deepEqual(rows[2].ids, [a.id])
  assert.equal(rows[2].actor, 'self')

  // 召回只留查询哈希，不留查询原文
  assert.equal(rows[1].note, 'qsha256:' + sha256('薄荷糖 纸船'))

  // 审计文件里搜正文关键词：0 命中（后记里的词、查询里带出来的词都算）
  const text = readText(dir, 'audit.jsonl')
  for (const word of ['薄荷糖', '纸船', '灯塔', '她怕黑', '先不想被提起']) {
    assert.equal(text.includes(word), false, '审计文件里出现了正文关键词：' + word)
  }

  // 只读查询：按动作 / 按人 / 按时间
  assert.equal(audit.read(dir, { action: 'recall' }).length, 1)
  assert.equal(audit.read(dir, { actor: 'leo' }).length, 0)
  assert.equal(audit.read(dir, { since: new Date(Date.now() - 60_000).toISOString() }).length, 3)
  assert.equal(audit.read(dir, { until: new Date(Date.now() - 60_000).toISOString() }).length, 0)

  // 擦除不碰审计文件
  assert.ok(fs.existsSync(fileOf(dir, 'audit.jsonl')), '审计文件还在')
  assert.equal(audit.read(dir).length, 3, '擦除没有删掉或改写已有的审计行')

  // 库内没有删除/清空审计、墓碑的 API
  for (const mod of [audit, tombstones]) {
    for (const name of Object.keys(mod)) {
      assert.equal(/^(delete|remove|purge|clear|drop)/i.test(name), false, '不该导出删除类 API：' + name)
    }
  }

  // 宿主边界用的两个顺手函数：读了 / 召回了都各留一条，正文照样不进审计
  const readBack = audit.readRecord(dir, b.id, { actor: 'self' })
  assert.equal(readBack.id, b.id)
  const hits = audit.recall(dir, '一只纸船', { actor: 'self', limit: 1 })
  assert.equal(hits[0].id, b.id)
  const after = audit.read(dir)
  assert.deepEqual(after.map((r) => r.action), ['read', 'recall', 'erase', 'read', 'recall'])
  assert.equal(after[4].note, 'qsha256:' + sha256('一只纸船'))
  assert.equal(readText(dir, 'audit.jsonl').includes('纸船'), false, '查询原文不进审计')
})

test('导出：与同条件全量读逐条一致；封存默认带 sealed: true 标记', (t) => {
  const dir = NEW(t)
  const { a } = makeLibrary(dir)
  const d = exp.addExperience(dir, { text: '和另一个人有关的事', state: { personId: 'p_2' } })

  const before = Object.fromEntries(['self-experience.jsonl', 'later-events.jsonl', 'seal-events.jsonl', 'recall-events.jsonl', 'unfinished-events.jsonl', 'link-events.jsonl', 'chapter-events.jsonl']
    .map((name) => [name, readText(dir, name)]))

  const rows = rowsOf(dir, 'audit.jsonl') // 不存在时是空数组，仅确认导出不建审计文件
  assert.equal(rows.length, 0)

  const all = exportMemory(dir)
  const exported = all.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(exported.length, 4)

  // 与同条件全量读逐条一致：唯一差别是封存状态记成 true（理由不导出）
  const seen = exp.loadAll(dir)
  const strip = (r) => { const { sealed, ...rest } = r; return rest }
  assert.deepEqual(exported.map(strip), seen.map(strip))
  assert.equal(exported.find((r) => r.id === a.id).sealed, true, '封存内容默认带 sealed: true')

  // includeSealed: false → 封存的那条不在导出物里
  const closed = exportMemory(dir, { includeSealed: false }).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(closed.some((r) => r.id === a.id), false)
  assert.equal(closed.length, 3)

  // from / to 按 day 截（含端点）
  const today = new Date().toLocaleDateString('sv-SE')
  assert.equal(exportMemory(dir, { from: today, to: today }).split('\n').filter(Boolean).length, 4)
  assert.equal(exportMemory(dir, { to: '2000-01-01' }).split('\n').filter(Boolean).length, 0)
  assert.equal(exportMemory(dir, { from: '2999-12-31' }).split('\n').filter(Boolean).length, 0)

  // personId：只导出这个人的（v1 记录本身不带 person；宿主写进 then.state.personId 时才有意义）
  const mine = exportMemory(dir, { personId: 'p_2' }).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.deepEqual(idsOf(mine), [d.id])

  // 导出是只读：一个数据文件都不许变，也不许顺手建出审计/墓碑文件
  for (const [name, text] of Object.entries(before)) assert.equal(readText(dir, name), text, name + ' 被导出改动了')
  assert.equal(fs.existsSync(fileOf(dir, 'audit.jsonl')), false, '导出不写审计')
  assert.equal(fs.existsSync(fileOf(dir, 'tombstones.jsonl')), false, '导出不写墓碑')
})

sq('擦除（sqlite）：记录与关联事件一起删，墓碑与审计照写，库刷新后仍可读', (t) => {
  const dir = NEW(t)
  const { a, b } = makeLibrary(dir)
  const rawLine = rawLineOf(dir, a.id)

  const migrated = spawnSync(process.execPath, [path.join(root, 'tools/migrate-storage.mjs'), dir, '--write'], { encoding: 'utf8' })
  assert.equal(migrated.status, 0, migrated.stderr)
  assert.ok(fs.existsSync(fileOf(dir, 'memory.sqlite')))

  const res = eraseExperience(dir, { id: a.id, reason: '她要求', actor: 'leo' })
  assert.equal(res.ok, true)
  assert.equal(res.hash, sha256(rawLine))
  assert.equal(res.removed.sqlite, true, '目录里有库时，库里的副本也要删')

  // 两个后端都查不到；库刷新过 sources 之后仍然可读（不是挂着 STORAGE_STALE）
  assert.equal(idsOf(exp.loadAll(dir)).includes(a.id), false)
  const viaSqlite = exp.loadAll(dir, { backend: 'sqlite' })
  assert.equal(idsOf(viaSqlite).includes(a.id), false)
  assert.equal(idsOf(viaSqlite).includes(b.id), true)
  assert.equal(viaSqlite.find((r) => r.id === b.id).links, undefined, '库里那条联想事件也删了')

  // 墓碑 / 审计：和 file 后端同一份
  assert.equal(tombstones.readAll(dir).rows.length, 1)
  assert.deepEqual(audit.read(dir).map((r) => r.action), ['erase'])
})