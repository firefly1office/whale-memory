// 阶段 1 续：事件也进 SQLite；loadAll / recall 能选后端；迁移扩到事件。
//
// 验收口径（缺一不可）：
//   · 同一份数据，file 与 sqlite 两个后端的 loadAll 逐条相等、recall 的 id 序列相等；
//   · 默认（不传 backend）行为不变；
//   · 记录与事件同事务：一组写入要么全成、要么全不成；
//   · 迁移：演练不写盘、失败整体回滚、源文件一个字节不改；
//   · 拿不到 node:sqlite / 没迁移 / 迁移后 JSONL 又变过：报错，不静默退回、不当成空。
//
// 全部用临时目录和虚构数据，不碰任何真实记忆。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { openBackend } from '../packages/core/lib/storage/backend.js'
import { FileBackend } from '../packages/core/lib/storage/file-backend.js'
import {
  loadAll, recall, currentView, addExperience, reviseExperience, setSealed, markRecalled,
  setUnfinishedState, linkExperiences
} from '../packages/core/lib/self-experience.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import { KIND_NAMES, EVENT_KINDS, DB_FILE } from '../packages/core/lib/sqlite-store.js'

// node:sqlite 要 Node >= 22.5；CI 还在 Node 20 上跑全量。没有它时 sqlite 用例跳过（file 用例照跑）
const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const repo = path.resolve(import.meta.dirname, '..')
const TOOL = path.join(repo, 'tools/migrate-storage.mjs')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wm-events-'))

// ---------------------------------------------------------------- 夹具

const at = (s) => new Date(s).toISOString()
const dayOfIso = (iso) => iso.slice(0, 10)

function rec(id, iso, then, extra = {}) {
  return {
    id, at: at(iso), day: dayOfIso(at(iso)), author: 'self', source: 'own-time', kind: extra.kind || '其它',
    weight: extra.weight || 'normal',
    then: { text: then.text, scene: then.scene || '', feeling: then.feeling || [], thought: then.thought || '', unfinished: then.unfinished || '', quote: then.quote || null, state: { at: at(iso) }, ...(then.refs ? { refs: then.refs } : {}) },
    later: [], status: 'kept'
  }
}

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

// 一份覆盖面尽量宽的虚构记忆：后记（含感觉）、封存/解封/后来才封存、想起（含孤儿）、
// 没弄完的事反复改主意、联想（含另一头封存）、章节开/改名/结束、出处（含指向封存的）、同一刻写下的两条。
function writeFixture(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const records = [
    rec('exp_f01', '2026-11-01T02:00:00Z', { text: '在灯塔书店读完了一本写海浪的小说，窗外一直在下雨', feeling: ['安静', '有点想哭'], thought: '雨和海浪的声音很像', unfinished: '还没给店长回信' }, { weight: 'important' }),
    rec('exp_f02', '2026-11-02T03:00:00Z', { text: '和朋友聊到深夜，说起小时候养的那只猫', feeling: ['温暖'] }),
    rec('exp_f03', '2026-11-03T04:00:00Z', { text: '第一次自己做饭，煮糊了米饭', feeling: ['好笑'] }, { weight: 'minor' }),
    rec('exp_f04', '2026-11-04T05:00:00Z', { text: '下雨天去海边，看见一只受伤的海鸟', scene: '海边', thought: '它后来飞走了吗' }),
    rec('exp_f05', '2026-11-05T06:00:00Z', { text: '读书会上有人问我为什么喜欢鲸鱼', refs: ['exp_f01'] }),
    rec('exp_f06', '2026-11-06T07:00:00Z', { text: '写了一首关于雨的短诗', thought: '雨声像有人在敲门', quote: { text: '雨落在没有人的街上', source: '自己写的' } }),
    rec('exp_f07', '2026-11-07T08:00:00Z', { text: '一件不想再提的事：和人吵了一架', feeling: ['难过'] }),
    rec('exp_f08', '2026-11-08T09:00:00Z', { text: '在书店门口躲雨，认识了一个画画的人' }),
    rec('exp_f09', '2026-11-09T10:00:00Z', { text: '整理书架时找到一张旧明信片，上面画着鲸鱼', refs: ['exp_f07', 'exp_f05'] }),
    rec('exp_f10', '2026-11-09T10:00:00Z', { text: '同一刻写下的另一条：雨停了，海边有彩虹' }),
    rec('exp_f11', '2026-11-12T11:00:00Z', { text: '决定以后每周去一次海边看海鸟', unfinished: '还没找到合适的望远镜' }, { weight: 'important' }),
    rec('exp_f12', '2026-11-15T12:00:00Z', { text: '店长回信了，说书店下个月要搬家' })
  ]
  const later = [
    { id: 'exp_f01', at: at('2026-11-03T01:00:00Z'), day: '2026-11-03', thought: '后来想想，那天哭不是因为书，是因为雨', reason: '重读', feeling: ['释然'] },
    { id: 'exp_f04', at: at('2026-11-06T01:00:00Z'), day: '2026-11-06', thought: '又梦见那只海鸟了', reason: '' },
    { id: 'exp_f01', at: at('2026-11-14T01:00:00Z'), day: '2026-11-14', thought: '书店要搬家了，那扇窗也会不在', reason: '听说了消息', feeling: ['舍不得'] },
    { id: 'exp_missing', at: at('2026-11-05T01:00:00Z'), day: '2026-11-05', thought: '孤儿后记：指向不存在的经历', reason: '' }
  ]
  const seal = [
    { id: 'exp_f07', at: at('2026-11-07T20:00:00Z'), day: '2026-11-07', action: 'seal', note: '不想再被提起' },
    { id: 'exp_f08', at: at('2026-11-08T20:00:00Z'), day: '2026-11-08', action: 'seal', note: '' },
    { id: 'exp_f08', at: at('2026-11-09T20:00:00Z'), day: '2026-11-09', action: 'unseal', note: '' },
    { id: 'exp_f03', at: at('2026-11-13T20:00:00Z'), day: '2026-11-13', action: 'seal', note: '后来才封存的' }
  ]
  const recalls = [
    { id: 'exp_f01', at: at('2026-11-02T00:00:00Z'), query: '雨', chatKey: 'local:test' },
    { id: 'exp_f01', at: at('2026-11-11T00:00:00Z'), query: '书店', chatKey: 'local:test' },
    { id: 'exp_f04', at: at('2026-11-12T00:00:00Z'), query: '海鸟', chatKey: '' },
    { id: 'exp_nobody', at: at('2026-11-12T00:00:00Z'), query: '孤儿', chatKey: '' }
  ]
  const unfinished = [
    { id: 'exp_f01', at: at('2026-11-04T00:00:00Z'), day: '2026-11-04', choice: 'shelved', note: '先放着' },
    { id: 'exp_f01', at: at('2026-11-15T13:00:00Z'), day: '2026-11-15', choice: 'done', note: '回信了' },
    { id: 'exp_f11', at: at('2026-11-13T00:00:00Z'), day: '2026-11-13', choice: 'shelved', note: '' }
  ]
  const links = [
    { from: 'exp_f04', to: 'exp_f06', at: at('2026-11-07T00:00:00Z'), day: '2026-11-07', reason: '都是下雨天的事' },
    { from: 'exp_f03', to: 'exp_f07', at: at('2026-11-08T00:00:00Z'), day: '2026-11-08', reason: '都发生在那一周' },
    { from: 'exp_f05', to: 'exp_f09', at: at('2026-11-13T00:00:00Z'), day: '2026-11-13', reason: '都和鲸鱼有关' }
  ]
  const chapters = [
    { id: 'ch_t1', at: at('2026-11-01T00:00:00Z'), day: '2026-11-01', action: 'open', name: '在灯塔书店打工的那个月', from: '2026-11-01', to: '', note: '' },
    { id: 'ch_t1', at: at('2026-11-10T00:00:00Z'), day: '2026-11-10', action: 'rename', name: '下雨的十一月' },
    { id: 'ch_t2', at: at('2026-11-04T00:00:00Z'), day: '2026-11-04', action: 'open', name: '海边的日子', from: '2026-11-04', to: '', note: '' },
    { id: 'ch_t2', at: at('2026-11-12T00:00:00Z'), day: '2026-11-12', action: 'close', to: '2026-11-09' }
  ]
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), jsonl(records))
  fs.writeFileSync(path.join(dir, EVENT_KINDS.later.file), jsonl(later))
  fs.writeFileSync(path.join(dir, EVENT_KINDS.seal.file), jsonl(seal))
  fs.writeFileSync(path.join(dir, EVENT_KINDS.recall.file), jsonl(recalls))
  fs.writeFileSync(path.join(dir, EVENT_KINDS.unfinished.file), jsonl(unfinished))
  fs.writeFileSync(path.join(dir, EVENT_KINDS.link.file), jsonl(links))
  fs.writeFileSync(path.join(dir, EVENT_KINDS.chapter.file), jsonl(chapters))

  // 再用真实写入函数各写一些，保证线上格式也在里面
  const a = addExperience(dir, { text: '真实写入：今天又下雨了，想起了海边', feeling: ['平静'], unfinished: '想再去一次海边' })
  const b = addExperience(dir, { text: '真实写入：给书店的猫拍了照片', refs: [a.id] })
  assert.equal(reviseExperience(dir, { id: a.id, thought: '真实后记：雨小了', feeling: ['轻松'] }).ok, true)
  assert.equal(setSealed(dir, { id: b.id, sealed: true, note: '真实封存' }).ok, true)
  assert.equal(markRecalled(dir, a.id), true)
  assert.equal(setUnfinishedState(dir, { id: a.id, choice: 'shelved', note: '真实结案' }).ok, true)
  assert.equal(linkExperiences(dir, { from: a.id, to: 'exp_f04', reason: '都和海边有关' }).ok, true)
  chapterEvents.open(dir, { name: '真实写入的章节', from: '2026-11-20' })
  return { a: a.id, b: b.id }
}

// memory.sqlite 及其 -wal/-shm，以及迁移时的临时库 .memory.sqlite.migrating-*
const isDbFile = (n) => n.startsWith(DB_FILE) || n.startsWith('.' + DB_FILE)

// 目录里每个文件的字节（不含 SQLite 文件）：用来证明源文件一个字节都没变
function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir).filter((n) => !isDbFile(n)).sort().map((n) => [n, fs.readFileSync(path.join(dir, n)).toString('base64')]))
}

const migrate = (dir, ...flags) => migrateEnv(dir, {}, ...flags)

function migrateEnv(dir, env, ...flags) {
  const r = spawnSync(process.execPath, [TOOL, dir, ...flags], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

const dbFiles = (dir) => fs.readdirSync(dir).filter(isDbFile)

const QUERIES = ['雨', '海边 海鸟', '鲸鱼', '书店', '猫', '吵架', '做饭 米饭', '明信片', '彩虹', '真实写入', '望远镜', 'xyz 不存在的词', '']
const AS_OF = [null, '2026-11-05', '2026-11-10T12:00:00.000Z']

function recallMatrix(dir, backend) {
  const out = []
  for (const q of QUERIES) for (const limit of [1, 3, 20]) for (const mode of ['strict', 'loose']) for (const gate of ['cover', 'legacy'])
    for (const includeSealed of [false, true]) for (const asOf of AS_OF) {
      const opts = { limit, mode, gate, includeSealed, asOf, ...(backend ? { backend } : {}) }
      out.push({ key: JSON.stringify([q, limit, mode, gate, includeSealed, asOf]), hits: recall(dir, q, opts) })
    }
  return out
}

// ---------------------------------------------------------------- 两个后端逐条相等

test('默认路径不变：不传 backend 与 backend: "file" 结果完全相同', () => {
  const dir = tmp()
  writeFixture(dir)
  for (const asOf of AS_OF) assert.deepEqual(loadAll(dir, { asOf }), loadAll(dir, { asOf, backend: 'file' }))
  assert.deepEqual(recallMatrix(dir, null), recallMatrix(dir, 'file'))
})

sq('迁移前后：loadAll 逐条相等（含 asOf 与 allowCorrupt），召回 id 序列逐条相同', () => {
  const dir = tmp()
  writeFixture(dir)
  // 迁移之前先算好 file 后端的结果
  const beforeLoads = AS_OF.map((asOf) => loadAll(dir, { asOf }))
  const beforeRaw = loadAll(dir, { allowCorrupt: true })
  const beforeRecall = recallMatrix(dir, null)
  const bytes = snapshot(dir)

  const m = migrate(dir, '--write')
  assert.equal(m.status, 0, m.out)
  assert.match(m.out, /逐条对拍通过/)
  assert.deepEqual(snapshot(dir), bytes, '迁移不许改任何源文件')

  AS_OF.forEach((asOf, i) => assert.deepEqual(loadAll(dir, { asOf, backend: 'sqlite' }), beforeLoads[i], 'asOf=' + asOf))
  assert.deepEqual(loadAll(dir, { allowCorrupt: true, backend: 'sqlite' }), beforeRaw)

  const afterRecall = recallMatrix(dir, 'sqlite')
  assert.equal(afterRecall.length, beforeRecall.length)
  let nonEmpty = 0
  for (let i = 0; i < beforeRecall.length; i += 1) {
    const ids = (x) => x.hits.map((r) => r.id)
    assert.deepEqual(ids(afterRecall[i]), ids(beforeRecall[i]), '召回 id 序列不同：' + beforeRecall[i].key)
    assert.deepEqual(afterRecall[i].hits, beforeRecall[i].hits, '召回内容不同：' + beforeRecall[i].key)
    if (beforeRecall[i].hits.length) nonEmpty += 1
  }
  // 防止"两边都是空"这种假相等
  assert.ok(nonEmpty > 100, '有命中的组合太少：' + nonEmpty)

  // 迁移后 file 后端照常（源文件没变）
  assert.deepEqual(loadAll(dir), beforeLoads[0])
  // 夹具里每一类事件都真的进了结果（不然"相等"说明不了什么）
  const rows = beforeLoads[0]
  assert.ok(rows.some((r) => r.later.length >= 2), '后记')
  assert.ok(rows.some((r) => r.sealed) && rows.some((r) => r.id === 'exp_f08' && !r.sealed), '封存与解封')
  assert.ok(rows.some((r) => r.recalls >= 2), '想起次数')
  assert.ok(rows.some((r) => r.unfinishedState && r.unfinishedState.history.length >= 2), '没弄完的事')
  assert.ok(rows.some((r) => (r.links || []).some((l) => l.sealed)), '联想（另一头封存）')
  assert.ok(rows.some((r) => (r.chapters || []).length >= 2), '章节重叠')
  assert.ok(rows.some((r) => (r.refsInfo || []).some((x) => x.sealed)), '出处指向封存')
  assert.ok(beforeLoads[2].some((r) => r.sealed && r.sealed.afterAsOf), '后来才封存')
})

sq('currentView 也能选后端，结果相同', () => {
  const dir = tmp()
  const { a } = writeFixture(dir)
  assert.equal(migrate(dir, '--write').status, 0)
  for (const id of [a, 'exp_f01', 'exp_f07', 'exp_none']) {
    for (const asOf of AS_OF) assert.deepEqual(currentView(dir, id, { asOf, backend: 'sqlite' }), currentView(dir, id, { asOf }))
  }
})

sq('后端 API 直接写：同样的记录与事件写进两个后端，loadAll 读出来相同', async () => {
  const fileDir = tmp()
  const sqlDir = tmp()
  const recs = [
    rec('exp_a', '2026-11-01T00:00:00Z', { text: '海边散步', unfinished: '没走到灯塔' }),
    rec('exp_b', '2026-11-02T00:00:00Z', { text: '下雨读书' })
  ]
  const ops = [
    ['later', { id: 'exp_a', at: at('2026-11-03T00:00:00Z'), day: '2026-11-03', thought: '下次走到灯塔', reason: '' }],
    ['seal', { id: 'exp_b', at: at('2026-11-04T00:00:00Z'), day: '2026-11-04', action: 'seal', note: '' }],
    ['recall', { id: 'exp_a', at: at('2026-11-05T00:00:00Z'), query: '海边', chatKey: '' }],
    ['unfinished', { id: 'exp_a', at: at('2026-11-06T00:00:00Z'), day: '2026-11-06', choice: 'done', note: '' }],
    ['link', { from: 'exp_a', to: 'exp_b', at: at('2026-11-07T00:00:00Z'), day: '2026-11-07', reason: '同一周' }],
    ['chapter', { id: 'ch_x', at: at('2026-11-01T00:00:00Z'), day: '2026-11-01', action: 'open', name: '十一月', from: '2026-11-01', to: '', note: '' }]
  ]
  for (const [kind, dir] of [['file', fileDir], ['sqlite', sqlDir]]) {
    const b = await openBackend({ kind, dir })
    for (const r of recs) await b.append(r)
    for (const [k, row] of ops) await b.appendEvent(k, row)
    for (const [k] of ops) assert.equal((await b.events(k)).length, 1, kind + ' ' + k)
    await b.close()
  }
  assert.deepEqual(loadAll(sqlDir, { backend: 'sqlite' }), loadAll(fileDir))
  assert.ok(loadAll(fileDir).find((r) => r.id === 'exp_b').sealed)
})

// ---------------------------------------------------------------- 同事务

sq('sqlite：一条经历 + 它的事件同事务写，事件不合格时经历也不落盘', async () => {
  const dir = tmp()
  const b = await openBackend({ kind: 'sqlite', dir })
  const r = rec('exp_tx', '2026-11-01T00:00:00Z', { text: '整组写' })
  await assert.rejects(() => b.appendWithEvents(r, [
    { kind: 'later', row: { id: 'exp_tx', at: at('2026-11-02T00:00:00Z'), day: '2026-11-02', thought: '合格的后记', reason: '' } },
    { kind: 'seal', row: { id: 'exp_tx', at: at('2026-11-03T00:00:00Z'), action: 'not-an-action' } }
  ]), /不合格/)
  assert.equal(await b.count(), 0, '经历不许单独落盘')
  assert.deepEqual(await b.events('later'), [], '前面那条合格事件也要一起回滚')

  await b.appendWithEvents(r, [{ kind: 'later', row: { id: 'exp_tx', at: at('2026-11-02T00:00:00Z'), day: '2026-11-02', thought: '这次整组成功', reason: '' } }])
  assert.equal(await b.count(), 1)
  assert.equal((await b.events('later')).length, 1)

  // 重复 id：经历写不进，跟着的事件也不许写进
  await assert.rejects(() => b.appendWithEvents(r, [{ kind: 'recall', row: { id: 'exp_tx', at: at('2026-11-04T00:00:00Z'), query: '' } }]), /id 已存在/)
  assert.deepEqual(await b.events('recall'), [])
  await b.close()
})

sq('sqlite：改主意指向不存在的经历时整条不写（查和写同一个事务）', async () => {
  const dir = tmp()
  const b = await openBackend({ kind: 'sqlite', dir })
  await assert.rejects(() => b.appendEvent('later', { id: 'exp_ghost', at: at('2026-11-02T00:00:00Z'), thought: '谁也看不见的后记' }, { mustExist: true }), /找不到这条经历/)
  assert.deepEqual(await b.events('later'), [])
  await b.append(rec('exp_real', '2026-11-01T00:00:00Z', { text: '真的在' }))
  await b.appendEvent('later', { id: 'exp_real', at: at('2026-11-02T00:00:00Z'), thought: '写得进' }, { mustExist: true })
  assert.equal((await b.events('later')).length, 1)
  await b.close()
})

sq('sqlite：transaction() 里抛错，记录和事件一起回滚', async () => {
  const dir = tmp()
  const b = await openBackend({ kind: 'sqlite', dir })
  await assert.rejects(() => b.transaction(async (db) => {
    await db.append(rec('exp_r1', '2026-11-01T00:00:00Z', { text: '一' }))
    await db.appendEvent('recall', { id: 'exp_r1', at: at('2026-11-02T00:00:00Z'), query: '' })
    await db.appendWithEvents(rec('exp_r2', '2026-11-01T00:00:00Z', { text: '二' }), [])
    throw new Error('中途失败')
  }), /中途失败/)
  assert.equal(await b.count(), 0)
  assert.deepEqual(await b.events('recall'), [])
  await b.close()
})

sq('未知事件类型、不合格事件：两个后端都拒绝', async () => {
  for (const kind of ['file', 'sqlite']) {
    const b = await openBackend({ kind, dir: tmp() })
    await assert.rejects(() => b.appendEvent('mood', { id: 'x', at: at('2026-11-01T00:00:00Z') }), /未知的事件类型/)
    await assert.rejects(() => b.appendEvent('later', { id: 'x', at: at('2026-11-01T00:00:00Z') }), /不合格/)
    await assert.rejects(() => b.events('mood'), /未知的事件类型/)
    await b.close()
  }
  assert.deepEqual(KIND_NAMES, ['later', 'seal', 'recall', 'unfinished', 'link', 'chapter'])
})

// ---------------------------------------------------------------- fail closed

sq('sqlite 读：没迁移过但有 JSONL → 报错，不当成空；空目录如实返回空', () => {
  const dir = tmp()
  addExperience(dir, { text: '只在 JSONL 里' })
  assert.throws(() => loadAll(dir, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_NOT_MIGRATED')
  assert.throws(() => recall(dir, '只在', { backend: 'sqlite' }), (e) => e.code === 'STORAGE_NOT_MIGRATED')
  assert.equal(fs.existsSync(path.join(dir, DB_FILE)), false, '读路径不许顺手建库')
  const empty = tmp()
  assert.deepEqual(loadAll(empty, { backend: 'sqlite' }), [])
  assert.equal(fs.existsSync(path.join(empty, DB_FILE)), false)
})

sq('sqlite 读：迁移之后 JSONL 又被写过 → STORAGE_STALE，不读出一份少了东西的记忆', () => {
  const dir = tmp()
  const { a } = writeFixture(dir)
  assert.equal(migrate(dir, '--write').status, 0)
  assert.ok(loadAll(dir, { backend: 'sqlite' }).length > 0)
  reviseExperience(dir, { id: a, thought: '迁移之后才写的后记' }) // 写路径还在 JSONL 上
  assert.throws(() => loadAll(dir, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_STALE' && e.files.includes(EVENT_KINDS.later.file))
  const v = migrate(dir, '--verify-only')
  assert.equal(v.status, 1)
  assert.match(v.out, /对不上/)
})

sq('sqlite 读：阶段 1 早期只有记录表的库 → STORAGE_INCOMPLETE', () => {
  const dir = tmp()
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(path.join(dir, DB_FILE))
  db.exec('CREATE TABLE records (id TEXT PRIMARY KEY, day TEXT NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL)')
  db.close()
  assert.throws(() => loadAll(dir, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_INCOMPLETE')
})

sq('sqlite 读：封存事件有坏行时和 file 一样 fail closed；allowSealCorrupt 才放行', async () => {
  const fileDir = tmp()
  const sqlDir = tmp()
  const r = rec('exp_s', '2026-11-01T00:00:00Z', { text: '封存状态未知的经历' })
  fs.writeFileSync(path.join(fileDir, 'self-experience.jsonl'), jsonl([r]))
  fs.writeFileSync(path.join(fileDir, EVENT_KINDS.seal.file), '{"id":"exp_s","action":"???"}\n')
  const b = await openBackend({ kind: 'sqlite', dir: sqlDir })
  await b.append(r)
  await b.close()
  // 绕过合格检查直接塞一条坏的封存事件，模拟库里出了坏数据
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(path.join(sqlDir, DB_FILE))
  db.prepare('INSERT INTO events (kind, exp_id, at, json) VALUES (?, ?, ?, ?)').run('seal', 'exp_s', '', '{"id":"exp_s","action":"???"}')
  db.close()
  assert.throws(() => loadAll(fileDir), (e) => e.code === 'SEAL_EVENTS_CORRUPT')
  assert.throws(() => loadAll(sqlDir, { backend: 'sqlite' }), (e) => e.code === 'SEAL_EVENTS_CORRUPT')
  assert.deepEqual(loadAll(sqlDir, { backend: 'sqlite', allowSealCorrupt: true }), loadAll(fileDir, { allowSealCorrupt: true }))
})

test('未知后端名报错；sqlite 下 recall 不能 mark（写路径还在 JSONL 上）', () => {
  const dir = tmp()
  addExperience(dir, { text: '海边' })
  assert.throws(() => loadAll(dir, { backend: 'postgres' }), /未知的存储后端/)
  assert.throws(() => recall(dir, '海边', { backend: 'sqlite', mark: true }), /mark=true/)
  assert.equal(fs.existsSync(path.join(dir, 'recall-events.jsonl')), false, '拒绝时不许已经记了一笔')
})

test('拿不到 node:sqlite：sqlite 后端报错，不静默降级；默认路径照常', (t) => {
  const dir = tmp()
  addExperience(dir, { text: '默认路径不需要 sqlite' })
  const lib = pathToFileURL(path.join(repo, 'packages/core/lib/self-experience.js')).href
  const backend = pathToFileURL(path.join(repo, 'packages/core/lib/storage/backend.js')).href
  const script = `
    const { loadAll } = await import(${JSON.stringify(lib)})
    const { openBackend } = await import(${JSON.stringify(backend)})
    const dir = ${JSON.stringify(dir)}
    const out = { file: loadAll(dir).length }
    try { loadAll(dir, { backend: 'sqlite' }); out.sqlite = 'no-error' } catch (e) { out.sqlite = e.code }
    try { await openBackend({ kind: 'sqlite', dir }); out.backend = 'no-error' } catch (e) { out.backend = e.code }
    console.log(JSON.stringify(out))
  `
  const flags = HAS_SQLITE ? ['--no-experimental-sqlite'] : []
  const r = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', script], { encoding: 'utf8' })
  if (/bad option/i.test(String(r.stderr))) return t.skip('这个 Node 不认 --no-experimental-sqlite')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout.trim()), { file: 1, sqlite: 'SQLITE_UNAVAILABLE', backend: 'SQLITE_UNAVAILABLE' })
  assert.equal(fs.existsSync(path.join(dir, DB_FILE)), false)
})

// ---------------------------------------------------------------- 迁移工具

sq('迁移：演练只报数，不写任何文件', () => {
  const dir = tmp()
  writeFixture(dir)
  const bytes = snapshot(dir)
  const m = migrate(dir)
  assert.equal(m.status, 0, m.out)
  assert.match(m.out, /演练模式/)
  assert.match(m.out, /事件 later \d+ \/ seal \d+ \/ recall \d+ \/ unfinished \d+ \/ link \d+ \/ chapter \d+/)
  assert.deepEqual(dbFiles(dir), [])
  assert.deepEqual(snapshot(dir), bytes)
})

sq('迁移：事件逐条对拍，verify-only 也覆盖事件', () => {
  const dir = tmp()
  writeFixture(dir)
  assert.equal(migrate(dir, '--write').status, 0)
  const v = migrate(dir, '--verify-only')
  assert.equal(v.status, 0, v.out)
  assert.match(v.out, /逐条对拍通过：记录 14 条、事件 \d+ 条全部一致/)
})

sq('迁移：写完提交前失败 → 整体回滚，库和 -wal/-shm 都不留，源文件不变', () => {
  const dir = tmp()
  writeFixture(dir)
  const bytes = snapshot(dir)
  const m = migrateEnv(dir, { WM_MIGRATE_FAIL_AFTER_INSERT: '1' }, '--write')
  assert.equal(m.status, 1, m.out)
  assert.match(m.out, /已回滚/)
  assert.deepEqual(dbFiles(dir), [])
  assert.deepEqual(snapshot(dir), bytes)
  // 回滚之后可以重新迁移
  assert.equal(migrate(dir, '--write').status, 0)
})

sq('迁移：事件文件有坏行 / 旧格式无 id / 重复 id → 拒绝迁移，不建库，源文件不变', () => {
  const cases = [
    ['坏行', (dir) => fs.appendFileSync(path.join(dir, EVENT_KINDS.unfinished.file), '{坏行\n'), /坏行或不合格行/],
    ['不合格行', (dir) => fs.appendFileSync(path.join(dir, EVENT_KINDS.link.file), JSON.stringify({ from: 'exp_f01', to: 'exp_f02' }) + '\n'), /坏行或不合格行/],
    ['旧格式', (dir) => fs.appendFileSync(path.join(dir, 'self-experience.jsonl'), JSON.stringify({ at: '2026-10-01T00:00:00Z', text: '0.10 之前的旧记录' }) + '\n'), /没有 id/],
    ['重复 id', (dir) => fs.appendFileSync(path.join(dir, 'self-experience.jsonl'), JSON.stringify(rec('exp_f02', '2026-11-20T00:00:00Z', { text: '同一个 id 又写了一次' })) + '\n'), /不止一次/]
  ]
  for (const [label, damage, message] of cases) {
    const dir = tmp()
    writeFixture(dir)
    damage(dir)
    const bytes = snapshot(dir)
    const m = migrate(dir, '--write')
    assert.equal(m.status, 1, label + '：' + m.out)
    assert.match(m.out, message, label)
    assert.deepEqual(dbFiles(dir), [], label + '：不许留库')
    assert.deepEqual(snapshot(dir), bytes, label + '：源文件不许变')
  }
})

sq('迁移：verify-only 认出只有记录表的旧库', () => {
  const dir = tmp()
  writeFixture(dir)
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(path.join(dir, DB_FILE))
  db.exec('CREATE TABLE records (id TEXT PRIMARY KEY, day TEXT NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL)')
  db.close()
  const v = migrate(dir, '--verify-only')
  assert.equal(v.status, 1)
  assert.match(v.out, /缺表/)
  assert.equal(migrate(dir, '--write').status, 3, '旧库在时拒绝覆盖')
})

// ---------------------------------------------------------------- 复审抓到的回归（2026-11-25 晚）

const okLater = (id, s) => ({ id, at: at(s), day: dayOfIso(at(s)), thought: '合格的后记', reason: '' })
const badLater = (id, s) => ({ id, at: at(s), day: dayOfIso(at(s)), reason: '缺 thought，不合格' })

sq('sqlite：事务里 appendWithEvents 失败只撤这一组，外层接住错误后照常提交', async () => {
  const b = await openBackend({ kind: 'sqlite', dir: tmp() })
  await b.transaction(async (t) => {
    await t.append(rec('exp_keep', '2026-11-01T00:00:00Z', { text: '外层写的' }))
    await assert.rejects(() => t.appendWithEvents(rec('exp_grp', '2026-11-01T00:00:00Z', { text: '这一组要整组撤掉' }), [
      { kind: 'later', row: okLater('exp_grp', '2026-11-02T00:00:00Z') },
      { kind: 'later', row: badLater('exp_grp', '2026-11-03T00:00:00Z') }
    ]), /不合格/)
    await t.appendEvent('later', okLater('exp_keep', '2026-11-04T00:00:00Z'))
  })
  assert.deepEqual((await b.all()).map((r) => r.id), ['exp_keep'])
  assert.deepEqual((await b.events('later')).map((r) => r.id), ['exp_keep'])
  await b.close()
})

sq('sqlite：嵌套 transaction() 失败只撤内层（SAVEPOINT），外层照常提交', async () => {
  const b = await openBackend({ kind: 'sqlite', dir: tmp() })
  await b.transaction(async (t) => {
    await t.append(rec('exp_outer', '2026-11-01T00:00:00Z', { text: '外层' }))
    await assert.rejects(() => t.transaction(async (u) => {
      await u.append(rec('exp_inner', '2026-11-01T00:00:00Z', { text: '内层' }))
      throw new Error('内层失败')
    }), /内层失败/)
  })
  assert.deepEqual((await b.all()).map((r) => r.id), ['exp_outer'])
  await b.close()
})

sq('sqlite：不相干的调用方排队，不会并进别人的事务、跟着别人一起回滚', async () => {
  const b = await openBackend({ kind: 'sqlite', dir: tmp() })
  await b.count() // 先把连接建好
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const order = []
  const p1 = b.transaction(async (t) => {
    await t.append(rec('exp_p1', '2026-11-01T00:00:00Z', { text: '会被回滚' }))
    await gate
    order.push('p1 throws')
    throw new Error('p1 失败')
  })
  const p2 = b.appendWithEvents(rec('exp_p2', '2026-11-01T00:00:00Z', { text: '别人的写入' }), [{ kind: 'seal', row: { id: 'exp_p2', at: at('2026-11-02T00:00:00Z'), day: '2026-11-02', action: 'seal', note: '' } }])
    .then(() => order.push('p2 done'))
  const p3 = b.transaction(async (t) => {
    await t.append(rec('exp_p3a', '2026-11-01T00:00:00Z', { text: '第三个事务' }))
    await t.append(rec('exp_p3b', '2026-11-01T00:00:00Z', { text: '第三个事务' }))
    throw new Error('p3 失败')
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  release()
  await assert.rejects(p1, /p1 失败/)
  await p2
  await assert.rejects(p3, /p3 失败/)
  assert.deepEqual(order, ['p1 throws', 'p2 done'], 'p2 要等 p1 结束才执行')
  assert.deepEqual((await b.all()).map((r) => r.id), ['exp_p2'], 'p1、p3 整体回滚，p2 自己提交')
  assert.equal((await b.events('seal')).length, 1)
  await b.close()
})

sq('sqlite：事务里调 close() 直接拒绝（否则会自己等自己）', async () => {
  const b = await openBackend({ kind: 'sqlite', dir: tmp() })
  await assert.rejects(() => b.transaction(async (t) => { await t.close() }), /不能 close/)
  await b.close()
})

sq('坏行口径一致：行首带 BOM 的经历，loadAll 当坏行，迁移也拒绝（不会把坏行搬进库）', async () => {
  const dir = tmp()
  const lines = [rec('exp_bom', '2026-11-01T00:00:00Z', { text: '带 BOM 的一行' }), rec('exp_ok', '2026-11-02T00:00:00Z', { text: '正常' })].map((r) => JSON.stringify(r))
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), '\uFEFF' + lines.join('\n') + '\n')
  assert.throws(() => loadAll(dir), (e) => e.code === 'EXPERIENCE_CORRUPT')
  await assert.rejects(() => new FileBackend(dir).all(), /不是合法 JSON/)
  const bytes = snapshot(dir)
  const m = migrate(dir, '--write')
  assert.equal(m.status, 1, m.out)
  assert.deepEqual(dbFiles(dir), [])
  assert.deepEqual(snapshot(dir), bytes)
})

sq('未知事件类型：原型上的名字（constructor / toString / __proto__）也拒绝', async () => {
  for (const kind of ['file', 'sqlite']) {
    const b = await openBackend({ kind, dir: tmp() })
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      await assert.rejects(() => b.events(name), /未知的事件类型/, kind + ' events ' + name)
      await assert.rejects(() => b.appendEvent(name, { id: 'x', at: at('2026-11-01T00:00:00Z') }), /未知的事件类型/, kind + ' appendEvent ' + name)
    }
    await b.close()
  }
})

sq('mustExist：联想两头都要在；章节不指向经历，不查', async () => {
  for (const kind of ['file', 'sqlite']) {
    const b = await openBackend({ kind, dir: tmp() })
    await b.append(rec('exp_a', '2026-11-01T00:00:00Z', { text: '在的' }))
    await assert.rejects(() => b.appendEvent('link', { from: 'exp_a', to: 'exp_ghost', at: at('2026-11-02T00:00:00Z'), day: '2026-11-02', reason: '一头不在' }, { mustExist: true }), /exp_ghost/, kind)
    await assert.rejects(() => b.appendEvent('link', { from: 'exp_ghost', to: 'exp_a', at: at('2026-11-02T00:00:00Z'), day: '2026-11-02', reason: '另一头不在' }, { mustExist: true }), /exp_ghost/, kind)
    assert.deepEqual(await b.events('link'), [], kind + '：一条都不许写进去')
    await b.appendEvent('chapter', { id: 'ch_1', at: at('2026-11-01T00:00:00Z'), day: '2026-11-01', action: 'open', name: '十一月', from: '2026-11-01', to: '', note: '' }, { mustExist: true })
    assert.equal((await b.events('chapter')).length, 1, kind)
    await b.close()
  }
})

sq('迁移：提交之后对拍失败 → 整体回滚，正式库和临时库都不留，可以重来', () => {
  const dir = tmp()
  writeFixture(dir)
  const bytes = snapshot(dir)
  const m = migrateEnv(dir, { WM_MIGRATE_TAMPER_BEFORE_VERIFY: '1' }, '--write')
  assert.equal(m.status, 1, m.out)
  assert.match(m.out, /对不上/)
  assert.match(m.out, /已回滚/)
  assert.deepEqual(dbFiles(dir), [])
  assert.deepEqual(snapshot(dir), bytes)
  assert.equal(migrate(dir, '--write').status, 0)
})

sq('迁移：verify-only 抓得到库里被改过的一条', () => {
  const dir = tmp()
  writeFixture(dir)
  assert.equal(migrate(dir, '--write').status, 0)
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(path.join(dir, DB_FILE))
  db.exec("UPDATE events SET json = replace(json, '\"thought\":\"', '\"thought\":\"改过') WHERE seq = (SELECT MIN(seq) FROM events WHERE kind = 'later')")
  db.close()
  const v = migrate(dir, '--verify-only')
  assert.equal(v.status, 1, v.out)
  assert.match(v.out, /later 事件第 1 条对不上/)
})

sq('迁移：上次中断留下的临时库不挡路，只提示', () => {
  const dir = tmp()
  writeFixture(dir)
  fs.writeFileSync(path.join(dir, '.' + DB_FILE + '.migrating-99999'), 'half-built')
  const m = migrate(dir, '--write')
  assert.equal(m.status, 0, m.out)
  assert.match(m.out, /上次中断留下的临时库/)
  assert.ok(fs.existsSync(path.join(dir, DB_FILE)))
  assert.ok(loadAll(dir, { backend: 'sqlite' }).length > 0)
})
