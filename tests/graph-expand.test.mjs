// 图扩展召回（T10）：只填空位、不插队、默认关；封存 / asOf / backend 都要守住。
// 邻接口径见 docs/graph-expand-zh.md；设计参照 Lysmor（AGPL-3.0），未复制代码。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as exp from '../packages/core/lib/self-experience.js'
import { buildAdjacency, expandHits, neighboursOf } from '../packages/core/lib/graph-expand.js'
import { buildCorpus } from '../tools/lib/eval-v2-corpus.mjs'
import { safeRemove, tmpDir } from './_safety.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'graph-expand-baseline.json'), 'utf8'))
// node:sqlite 要 Node >= 22.5；没有它时 sqlite 用例跳过（file 用例照跑）
const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

function rowOf(id, day, text, extra = {}) {
  return {
    id,
    at: day + 'T20:00:00.000Z',
    day,
    author: 'self',
    source: 'own-time',
    kind: extra.kind || '其它',
    weight: extra.weight || 'normal',
    later: [],
    status: 'kept',
    then: {
      text,
      scene: '',
      feeling: [],
      thought: '',
      unfinished: '',
      quote: null,
      state: null,
      ...(extra.refs ? { refs: extra.refs } : {})
    }
  }
}

// 每种邻接各一条的最小图：
//   s1（种子，正文里有「灯塔」）
//   ├─ 写出处 → r1（s1 写下时引用它）→ r1 又引用 n1（2 跳，不该被补）
//   ├─ 事后联想 ↔ l1
//   └─ 同一章节「旧日子」→ c1 / c2
//   x（封存的那条）：也被 s1 引用、也在同一段日子里 → 一律不许出现
//   iso：谁的邻居都不是
function writeGraph(dir) {
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), jsonl([
    rowOf('s1', '2026-06-15', '灯塔的守灯人整夜没睡', { refs: ['r1', 'x'] }),
    rowOf('c1', '2026-06-10', '开始整理旧照片'),
    rowOf('c2', '2026-06-20', '把旧照片按年份排好'),
    rowOf('r1', '2026-05-01', '读到一本写守灯人的书', { refs: ['n1'] }),
    rowOf('n1', '2026-04-01', '更早的一件不相干的事'),
    rowOf('l1', '2026-05-05', '海边捡到的玻璃'),
    rowOf('x', '2026-07-01', '封存的那件事-ONLY-SEALED-GRAPH-EXPAND'),
    rowOf('iso', '2026-03-01', '一个人吃饭的傍晚')
  ]), 'utf8')
  fs.writeFileSync(path.join(dir, 'link-events.jsonl'), jsonl([
    { from: 's1', to: 'l1', at: '2026-05-05T21:00:00.000Z', day: '2026-05-05', reason: '都是海边的光' }
  ]), 'utf8')
  fs.writeFileSync(path.join(dir, 'chapter-events.jsonl'), jsonl([
    { id: 'ch_old', at: '2026-06-01T00:00:00.000Z', day: '2026-06-01', action: 'open', name: '旧日子', from: '2026-06-01', to: '2026-06-30' }
  ]), 'utf8')
  fs.writeFileSync(path.join(dir, 'seal-events.jsonl'), jsonl([
    { id: 'x', at: '2026-07-02T00:00:00.000Z', day: '2026-07-02', action: 'seal', note: '' }
  ]), 'utf8')
  return dir
}

const visibleRows = (dir) => exp.loadAll(dir).filter((r) => !r.sealed)

// ---------------------------------------------------------------- 邻接

test('邻接表：refs 无向、link 无向、章节成组；封存 / 找不到的不参与', (t) => {
  const dir = writeGraph(tmpDir('whale-gx-'))
  t.after(() => safeRemove(dir))
  const graph = buildAdjacency(visibleRows(dir))
  assert.deepEqual([...graph.byId.keys()].sort(), ['c1', 'c2', 'iso', 'l1', 'n1', 'r1', 's1'])
  assert.ok(!graph.byId.has('x'), '封存的不进邻接表')
  // 出处两个方向都算：r1 被 s1 引用，从 r1 也能走回 s1
  assert.ok(neighboursOf(graph, 'r1').some((n) => n.id === 's1' && n.kind === 'refs'))
  // 章节里的成员互为一跳
  assert.ok(neighboursOf(graph, 's1').some((n) => n.id === 'c1' && n.kind === 'chapter'))
  assert.ok(neighboursOf(graph, 's1').some((n) => n.id === 'c2' && n.kind === 'chapter'))
  assert.ok(!neighboursOf(graph, 's1').some((n) => n.id === 'n1'), 'n1 是 2 跳，不在 s1 的一跳里')
  assert.deepEqual(neighboursOf(graph, 'iso'), [], '孤立的记录没有邻居')
})

// ---------------------------------------------------------------- 只补一跳、只填空位

test('1 跳邻居被补进来；2 跳不补；封存不补；via 写清关系', (t) => {
  const dir = writeGraph(tmpDir('whale-gx-'))
  t.after(() => safeRemove(dir))
  const hits = exp.recall(dir, '灯塔', { limit: 1 })
  assert.deepEqual(hits.map((h) => h.id), ['s1'], '基础命中只有种子那一条')
  const added = expandHits({ rows: visibleRows(dir), hits, limit: 10 })
  const ids = added.map((a) => a.id).sort()
  assert.deepEqual(ids, ['c1', 'c2', 'l1', 'r1'], '一跳邻居：c1/c2（章节）、l1（联想）、r1（出处）')
  assert.ok(!ids.includes('n1'), '2 跳不许补')
  assert.ok(!ids.includes('x'), '封存的不许补')
  assert.ok(!ids.includes('iso'), '没有关系的也不许凑数')
  const kinds = Object.fromEntries(added.map((a) => [a.id, a.via.kind]))
  assert.equal(kinds.r1, 'refs')
  assert.equal(kinds.l1, 'link')
  assert.equal(kinds.c1, 'chapter')
  assert.equal(kinds.c2, 'chapter')
  for (const a of added) {
    assert.deepEqual(a.via.seeds, ['s1'])
    assert.equal(a.via.seedCount, 1)
  }
})

test('limit 已经满 / 命中为空 / 没有邻居时，一条都不补', (t) => {
  const dir = writeGraph(tmpDir('whale-gx-'))
  t.after(() => safeRemove(dir))
  const rows = visibleRows(dir)
  const hits = exp.recall(dir, '灯塔', { limit: 1 })
  assert.deepEqual(expandHits({ rows, hits, limit: 1 }), [], 'limit 满了不塞人')
  assert.deepEqual(expandHits({ rows, hits: [], limit: 10 }), [], '没有种子就没有扩展')
  assert.deepEqual(expandHits({ rows, hits: [{ id: 'iso' }], limit: 10 }), [], '孤立记录没有邻居')
  assert.deepEqual(expandHits({ rows, hits, limit: 10 }).length, 4, '有空位时才补，补到不越界')
})

test('排序：先看命中了几条种子，再看种子排名，再看时间', () => {
  const row = (id, at, extra = {}) => ({ id, at, day: at.slice(0, 10), then: { text: id }, refsInfo: [], links: [], chapters: [], ...extra })
  const rows = [
    row('s1', '2026-11-02T00:00:00.000Z', { refsInfo: [{ id: 'a' }, { id: 'b' }, { id: 'd' }] }),
    row('s2', '2026-11-01T00:00:00.000Z', { refsInfo: [{ id: 'a' }, { id: 'c' }] }),
    row('a', '2026-10-01T00:00:00.000Z'),
    row('b', '2026-10-02T00:00:00.000Z'),
    row('c', '2026-10-03T00:00:00.000Z'),
    row('d', '2026-10-01T00:00:00.000Z')
  ]
  const hits = [{ id: 's1' }, { id: 's2' }]
  // 两条种子都指到 a → 先补 a；b、d 都来自第 1 名种子，按时间新的先；c 来自第 2 名种子，排最后
  assert.deepEqual(expandHits({ rows, hits, limit: 3 }).map((x) => x.id), ['a'])
  assert.deepEqual(expandHits({ rows, hits, limit: 6 }).map((x) => x.id), ['a', 'b', 'd', 'c'])
  assert.deepEqual(expandHits({ rows, hits, limit: 6 })[0].via, { seeds: ['s1', 's2'], seedCount: 2, kind: 'refs' })
})

// ---------------------------------------------------------------- 接进 recall：默认关、不插队

test('默认关：不传 graphExpand 的召回与 main 基线逐条相同（12 条查询 × 字面/混合）', (t) => {
  const dir = tmpDir('whale-gx-')
  t.after(() => safeRemove(dir))
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'eval', 'corpus.json'), 'utf8'))
  const { memoryDir } = buildCorpus(dir, corpus)
  assert.ok(Object.keys(baseline.queries).length >= 10, '基线快照不该是空的')
  for (const [query, want] of Object.entries(baseline.queries)) {
    assert.deepEqual(exp.recall(memoryDir, query, { limit: 10 }).map((r) => r.id), want.literal, 'literal 变了：' + query)
    assert.deepEqual(exp.recall(memoryDir, query, { limit: 10, graphExpand: false }).map((r) => r.id), want.literal, '显式 false 也该与 main 相同：' + query)
    assert.deepEqual(exp.recall(memoryDir, query, { limit: 10, ranker: 'hybrid' }).map((r) => r.id), want.hybrid, 'hybrid 变了：' + query)
  }
})

test('打开后不插队：前 N 条与关闭时逐条相同，补的排在后面且带 via', (t) => {
  const dir = writeGraph(tmpDir('whale-gx-'))
  t.after(() => safeRemove(dir))
  const off = exp.recall(dir, '灯塔', { limit: 10 })
  const on = exp.recall(dir, '灯塔', { limit: 10, graphExpand: true })
  assert.deepEqual(on.slice(0, off.length).map((r) => r.id), off.map((r) => r.id), '已有命中不许被挤动')
  assert.equal(on[0].via, undefined, '基础命中不带 via')
  assert.deepEqual(on.slice(off.length).map((r) => r.id).sort(), ['c1', 'c2', 'l1', 'r1'])
  for (const r of on.slice(off.length)) assert.ok(r.via && r.via.kind, '扩展进来的必须有 via')
  assert.equal(new Set(on.map((r) => r.id)).size, on.length, '不许重复')
})

test('mark=true：只给基础命中记「想起」，补进来的不记', (t) => {
  const dir = writeGraph(tmpDir('whale-gx-'))
  t.after(() => safeRemove(dir))
  const before = exp.loadAll(dir).find((r) => r.id === 's1').recalls || 0
  const on = exp.recall(dir, '灯塔', { limit: 10, graphExpand: true, mark: true })
  const extras = on.filter((r) => r.via)
  assert.ok(extras.length > 0)
  assert.ok(extras.every((r) => Number(r.recalls || 0) === 0), '扩展补进来的不该被记成想起')
  const after = exp.loadAll(dir)
  assert.equal((after.find((r) => r.id === 's1').recalls || 0), before + 1, '种子照常记一笔')
  for (const id of ['c1', 'c2', 'l1', 'r1']) {
    assert.equal(after.find((r) => r.id === id).recalls || 0, 0, id + ' 不该被记成想起')
  }
})

// ---------------------------------------------------------------- 边界：封存 / asOf / backend

test('封存过滤：封了就不补；includeSealed 只给"她自己要翻"的场景', (t) => {
  const dir = writeGraph(tmpDir('whale-gx-'))
  t.after(() => safeRemove(dir))
  const hits = exp.recall(dir, '灯塔', { limit: 1 })
  const all = exp.loadAll(dir)
  const withSealed = expandHits({ rows: all, hits, limit: 10, includeSealed: true })
  assert.ok(withSealed.some((x) => x.id === 'x'), '明确要看封存内容时才能补进来')
  assert.ok(!expandHits({ rows: all, hits, limit: 10 }).some((x) => x.id === 'x'))
  // 把 c1 封存：之后的召回与扩展都不该再出现它
  assert.equal(exp.setSealed(dir, { id: 'c1', sealed: true }).ok, true)
  const on = exp.recall(dir, '灯塔', { limit: 10, graphExpand: true })
  assert.ok(!on.some((r) => r.id === 'c1'))
})

test('asOf：那之后才写下的邻居不补（翻回那天看不到后来的事）', (t) => {
  const dir = tmpDir('whale-gx-')
  t.after(() => safeRemove(dir))
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), jsonl([
    rowOf('seed', '2026-06-05', '灯塔的守灯人'),
    rowOf('early', '2026-06-01', '早一点的邻居'),
    rowOf('late', '2026-06-25', '晚一点的邻居')
  ]), 'utf8')
  fs.writeFileSync(path.join(dir, 'chapter-events.jsonl'), jsonl([
    { id: 'ch', at: '2026-06-01T00:00:00.000Z', day: '2026-06-01', action: 'open', name: '那段日子', from: '2026-06-01', to: '2026-06-30' }
  ]), 'utf8')
  const on = exp.recall(dir, '灯塔', { limit: 10, graphExpand: true, asOf: '2026-06-15' })
  const ids = on.map((r) => r.id)
  assert.ok(ids.includes('seed') && ids.includes('early'))
  assert.ok(!ids.includes('late'), 'asOf 之后写下的邻居不该被补')
})

sq('sqlite 后端：图扩展补出来的结果与 file 逐条相同', (t) => {
  const dir = writeGraph(tmpDir('whale-gx-'))
  t.after(() => safeRemove(dir))
  execFileSync(process.execPath, [path.join(root, 'tools', 'migrate-storage.mjs'), dir, '--write'], { stdio: 'pipe' })
  const fromFile = exp.recall(dir, '灯塔', { limit: 10, graphExpand: true })
  const fromSqlite = exp.recall(dir, '灯塔', { limit: 10, graphExpand: true, backend: 'sqlite' })
  assert.deepEqual(fromSqlite.map((r) => r.id), fromFile.map((r) => r.id))
  assert.deepEqual(fromSqlite.map((r) => r.via && r.via.kind), fromFile.map((r) => r.via && r.via.kind))
})

// ---------------------------------------------------------------- 纯函数口径

test('纯函数：不读盘、不改 rows；重复 id 不参与', () => {
  const rows = [
    { id: 'a', at: '2026-11-01T00:00:00.000Z', day: '2026-11-01', then: { text: 'a' }, refsInfo: [{ id: 'b' }], links: [], chapters: [] },
    { id: 'b', at: '2026-10-01T00:00:00.000Z', day: '2026-10-01', then: { text: 'b' }, refsInfo: [], links: [], chapters: [] },
    { id: 'b', at: '2026-10-02T00:00:00.000Z', day: '2026-10-02', then: { text: 'b 的第二次导入' }, duplicateOf: 'b', refsInfo: [], links: [], chapters: [] }
  ]
  const snapshot = JSON.stringify(rows)
  const out = expandHits({ rows, hits: [{ id: 'a' }], limit: 5 })
  assert.deepEqual(out.map((x) => x.id), ['b'])
  assert.equal(JSON.stringify(rows), snapshot, '纯函数不许改输入')
})