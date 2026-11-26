// 阶段 3 的读路径规模：流式 iterate 与游标分页 page
//   · iterate / page 与 loadAll **逐条相同**：出处、反向引用、联想、章节、封存、重复 id、
//     旧格式 id（唯一 / 有歧义 / 与显式 id 撞车三种）、asOf 都算在内
//   · 坏行：三条路都 fail closed，并且坏行在**第一次 yield 之前**就拦住，不许"先给几条再抛"
//   · 逐行读的边界：截断的最后一行照样读、半个 JSON 算坏行、多字节字符横跨 64KB 块边界、
//     CRLF、空行、没有文件
//   · 遍历期间文件被改：EXPERIENCE_CHANGED，不静默少返一条
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as exp from '../packages/core/lib/self-experience.js'
import { safeRemove, tmpDir } from './_safety.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const MIGRATE = path.join(repo, 'tools', 'migrate-storage.mjs')
// node:sqlite 要 Node >= 22.5；没有它时 sqlite 用例跳过（file 用例照跑）
const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const FILE = 'self-experience.jsonl'

function tmp(t, prefix = 'whale-scale-') {
  const dir = tmpDir(prefix)
  t.after(() => safeRemove(dir))
  return dir
}

const rec = (id, text, at, more = {}) => ({
  id,
  at,
  day: String(at).slice(0, 10),
  author: 'self',
  source: 'own-time',
  kind: '其它',
  weight: 'normal',
  then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: null, ...(more.then || {}) },
  later: more.later || [],
  status: 'kept',
  ...(more.top || {})
})

const put = (dir, name, lines) => fs.writeFileSync(path.join(dir, name), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n', 'utf8')
const append = (dir, name, row) => fs.appendFileSync(path.join(dir, name), JSON.stringify(row) + '\n', 'utf8')

async function collect(it) {
  const out = []
  for await (const row of it) out.push(row)
  return out
}

// 一份"什么都有"的库：六条现代记录 + 三条旧格式 + 一对重复 id + 六类事件
// legacy=false / dup=false：迁移不搬没有 id 的旧格式行、也拒绝重复 id，SQLite 用例要单独一份
function richDir(t, { legacy = true, dup = true } = {}) {
  const dir = tmp(t)
  const legacyRows = [
    // 旧格式：没有 id，靠内容指纹生成；三条各自的情况不同（见下）
    { at: '2026-11-07T09:00:00.000Z', text: '旧格式的一行（没有 id）', thought: '那时还没换格式' },
    { at: '2026-11-20T09:00:00.000Z', text: '旧格式第二条（同一分钟）', thought: '' },
    { at: '2026-11-20T09:00:00.000Z', text: '旧格式第三条（同一分钟）', thought: '' },
    { at: '2026-11-21T09:00:00.000Z', text: '旧格式第四条（旧 id 被占）', thought: '' }
  ]
  put(dir, FILE, [
    rec('exp_a', '海边捡到一只受伤的海鸟，抱回家', '2026-11-01T09:00:00.000Z'),
    rec('exp_b', '书店打工第一天，店里有只猫', '2026-11-02T09:00:00.000Z', { then: { unfinished: '要不要继续做下去' } }),
    rec('exp_c', '和妈妈吵了一架，摔了门', '2026-11-03T09:00:00.000Z'),
    rec('exp_d', '书店的常客送来一张明信片', '2026-11-04T09:00:00.000Z', { then: { refs: ['exp_b', 'exp_missing'] } }),
    rec('exp_e', '雨停之后看见彩虹', '2026-11-05T09:00:00.000Z', { then: { refs: ['exp_a'] } }),
    rec('exp_f', '灯塔管理员的望远镜', '2026-11-06T09:00:00.000Z'),
    ...(legacy ? legacyRows : []),
    // 现代记录，但 id 正好是上面那条旧记录的旧 id（旧 id 被显式占着，就不认领）
    rec('exp_legacy_202611210900', '现代记录，但 id 正好是上面那条的旧 id', '2026-11-22T09:00:00.000Z'),
    // 同一个 id 写了两遍：只有先写下的那条算数
    ...(dup ? [
      rec('exp_dup', '同一个 id 写了两遍：先写下的这条', '2026-11-08T09:00:00.000Z'),
      rec('exp_dup', '同一个 id 写了两遍：后来的那条', '2026-11-09T09:00:00.000Z')
    ] : [])
  ])
  put(dir, 'recall-events.jsonl', [
    { id: 'exp_a', at: '2026-11-10T01:00:00.000Z', query: '海鸟' },
    { id: 'exp_a', at: '2026-11-11T01:00:00.000Z', query: '海边' },
    { id: 'exp_c', at: '2026-11-11T02:00:00.000Z', query: '吵架' }
  ])
  put(dir, 'later-events.jsonl', [
    { id: 'exp_c', at: '2026-11-12T01:00:00.000Z', day: '2026-11-12', thought: '其实那天我也有错', reason: '', feeling: ['后悔'] },
    { id: 'exp_a', at: '2026-11-05T01:00:00.000Z', day: '2026-11-05', thought: '它后来飞走了', reason: '', feeling: [] }
  ])
  put(dir, 'unfinished-events.jsonl', [
    { id: 'exp_b', at: '2026-11-13T01:00:00.000Z', day: '2026-11-13', choice: 'shelved', note: '先放下' }
  ])
  put(dir, 'seal-events.jsonl', [
    { id: 'exp_c', at: '2026-11-14T01:00:00.000Z', day: '2026-11-14', action: 'seal', note: '不想再被提起' },
    { id: 'exp_f', at: '2026-11-14T02:00:00.000Z', day: '2026-11-14', action: 'seal', note: '' },
    { id: 'exp_f', at: '2026-11-15T02:00:00.000Z', day: '2026-11-15', action: 'unseal', note: '又愿意说了' }
  ])
  put(dir, 'link-events.jsonl', [
    { from: 'exp_b', to: 'exp_d', at: '2026-11-16T01:00:00.000Z', day: '2026-11-16', reason: '同一家书店' },
    { from: 'exp_a', to: 'exp_e', at: '2026-11-16T02:00:00.000Z', day: '2026-11-16', reason: '都是海边那天' }
  ])
  put(dir, 'chapter-events.jsonl', [
    { id: 'ch_1', at: '2026-11-17T01:00:00.000Z', day: '2026-11-17', action: 'open', name: '在海边住的那个月', from: '2026-11-01', to: '2026-11-10' }
  ])
  return dir
}

const AS_OF = [null, '2026-11-02', '2026-11-05', '2026-11-12', '2026-11-14T06:00:00.000Z', '2026-11-30']

// ---------------------------------------------------------------- 三条读路径逐条相同

test('iterate 与 loadAll 逐条相同（出处、反向引用、联想、章节、封存、重复 id、旧格式 id、asOf）', async (t) => {
  const dir = richDir(t)
  let 见过了 = 0
  for (const asOf of AS_OF) {
    const want = exp.loadAll(dir, { asOf })
    const got = await collect(exp.iterate(dir, { asOf }))
    assert.deepEqual(got, want, 'asOf=' + asOf)
    见过了 += want.length
  }
  assert.ok(见过了 > 0, '样本不能是空的')
  // 富样本得真的富：出处、反向引用、联想、章节、封存、重复 id、旧格式都要出现过
  const all = exp.loadAll(dir)
  assert.ok(all.some((r) => r.refsInfo), '要有出处')
  assert.ok(all.some((r) => r.citedBy), '要有反向引用')
  assert.ok(all.some((r) => r.links), '要有联想')
  assert.ok(all.some((r) => r.chapters), '要有章节')
  assert.ok(all.some((r) => r.sealed), '要有封存')
  assert.ok(all.some((r) => r.duplicateOf), '要有重复 id')
  assert.ok(all.some((r) => r.legacy), '要有旧格式记录')
  assert.ok(all.some((r) => r.recalls), '要有想起次数')
  assert.ok(all.some((r) => r.unfinishedState), '要有结案状态')
  assert.ok(all.some((r) => r.refsInfo && r.refsInfo.some((x) => x.missing)), '要有指不到的出处')
})

test('page 一页一页翻到底，拼起来与 loadAll 逐条相同（含 asOf）', async (t) => {
  const dir = richDir(t)
  for (const asOf of AS_OF) {
    const want = exp.loadAll(dir, { asOf })
    for (const limit of [1, 2, 3, 5, 100]) {
      const got = []
      let after = null
      let pages = 0
      for (;;) {
        const res = await exp.page(dir, { limit, after, asOf })
        assert.equal(res.total, want.length, 'total 要等于条数')
        assert.ok(res.rows.length <= limit, '一页不能超过 limit')
        got.push(...res.rows)
        pages += 1
        if (!res.hasMore) {
          assert.equal(res.next, null, '最后一页没有下一页游标')
          break
        }
        assert.ok(res.next && res.next.id, '还有下一页时必须给出游标')
        after = res.next
        assert.ok(pages < 200, '翻页不能停不下来')
      }
      assert.deepEqual(got, want, 'limit=' + limit + ' asOf=' + asOf)
    }
  }
})

test('page 的索引缓存按"文件变没变"认库：追加一条之后翻页立刻能看到', async (t) => {
  const dir = richDir(t)
  const first = await exp.page(dir, { limit: 3 })
  assert.equal(first.total, exp.loadAll(dir).length)
  append(dir, FILE, rec('exp_later', '她刚写下的一条', '2026-11-25T09:00:00.000Z'))
  const after = await exp.page(dir, { limit: 100 })
  assert.equal(after.total, exp.loadAll(dir).length, '文件变了，索引必须重建')
  assert.deepEqual(after.rows, exp.loadAll(dir))
  // 同一份文件连着翻两页：游标和缓存都不能把页算错
  const p1 = await exp.page(dir, { limit: 2 })
  const p2 = await exp.page(dir, { limit: 2, after: p1.next })
  assert.deepEqual([...p1.rows, ...p2.rows], exp.loadAll(dir).slice(0, 4))
})

test('page 也认"上一页最后一个 id"这种字符串游标，翻完不漏不重', async (t) => {
  // 字符串游标只在 id 唯一时精确（契约里 id 永不复用）；文件里真有重复 id 时，
  // 要用 page 返回的 { id, n }——n 记着这个 id 已经走过几条
  const dir = richDir(t, { dup: false })
  const want = exp.loadAll(dir)
  const got = []
  let after = null
  for (;;) {
    const res = await exp.page(dir, { limit: 2, after })
    got.push(...res.rows)
    if (!res.hasMore) break
    after = res.next.id // 只把 id 传回去
  }
  assert.deepEqual(got, want)
})

test('page 的边界：limit 必须正整数、游标找不到要明说、空库给空页', async (t) => {
  const dir = richDir(t)
  for (const bad of [0, -1, 2.5, 'x', NaN]) {
    await assert.rejects(exp.page(dir, { limit: bad }), /positive integer/)
  }
  await assert.rejects(exp.page(dir, { limit: 5, after: 'exp_不存在' }), (e) => e.code === 'PAGE_CURSOR_UNKNOWN')
  const empty = tmp(t)
  const res = await exp.page(empty, { limit: 5 })
  assert.deepEqual(res, { rows: [], next: null, hasMore: false, total: 0 })
  assert.deepEqual(await collect(exp.iterate(empty)), [])
  assert.deepEqual(exp.loadAll(empty), [])
})

// ---------------------------------------------------------------- 坏行与逐行读的边界

test('坏行：三条路都 fail closed，坏行在第一次 yield 之前就拦住', async (t) => {
  const dir = tmp(t)
  put(dir, FILE, [rec('exp_ok', '翻到灯塔那一章', '2026-11-01T09:00:00.000Z'), '{"broken":'])
  assert.throws(() => exp.loadAll(dir), (e) => e.code === 'EXPERIENCE_CORRUPT' && e.bad === 1)
  await assert.rejects(collect(exp.iterate(dir)), (e) => e.code === 'EXPERIENCE_CORRUPT' && e.bad === 1)
  await assert.rejects(exp.page(dir, { limit: 5 }), (e) => e.code === 'EXPERIENCE_CORRUPT' && e.bad === 1)
  // 不许"先吐出前面几条再抛"：第一次 next() 就要拒绝
  const it = exp.iterate(dir)[Symbol.asyncIterator]()
  await assert.rejects(it.next(), (e) => e.code === 'EXPERIENCE_CORRUPT')
  // allowCorrupt：跳过坏行，但跳过的口径要和 loadAll 一模一样
  assert.deepEqual(await collect(exp.iterate(dir, { allowCorrupt: true })), exp.loadAll(dir, { allowCorrupt: true }))
})

test('逐行读的边界：没有换行的最后一行照读、半个 JSON 算坏行、CRLF、空行', async (t) => {
  // 最后一行没有换行
  const tail = tmp(t)
  fs.writeFileSync(path.join(tail, FILE), JSON.stringify(rec('exp_1', '最后一行没有换行', '2026-11-01T09:00:00.000Z')), 'utf8')
  assert.equal(exp.loadAll(tail).length, 1)
  assert.deepEqual(await collect(exp.iterate(tail)), exp.loadAll(tail))
  assert.deepEqual((await exp.page(tail, { limit: 5 })).rows, exp.loadAll(tail))

  // 最后一行被切断（连多字节字符一起切）：坏行，但前面那条不能被吃掉
  const cut = tmp(t)
  const good = Buffer.from(JSON.stringify(rec('exp_0', '完好的一条', '2026-11-01T08:00:00.000Z')) + '\n', 'utf8')
  const half = Buffer.from(JSON.stringify(rec('exp_2', '被截断的一行，最后半个字', '2026-11-01T09:00:00.000Z')) + '\n', 'utf8')
  fs.writeFileSync(path.join(cut, FILE), Buffer.concat([good, half.subarray(0, half.length - 5)]))
  assert.equal(exp.badLines(cut), 1)
  assert.throws(() => exp.loadAll(cut), (e) => e.bad === 1)
  assert.equal(exp.loadAll(cut, { allowCorrupt: true }).length, 1)
  assert.deepEqual(await collect(exp.iterate(cut, { allowCorrupt: true })), exp.loadAll(cut, { allowCorrupt: true }))

  // CRLF 与中间的空行：和 split('\n') 的口径一致
  const crlf = tmp(t)
  const lines = [JSON.stringify(rec('exp_r1', '第一行', '2026-11-01T09:00:00.000Z')), '', '   ', JSON.stringify(rec('exp_r2', '第二行', '2026-11-02T09:00:00.000Z'))]
  fs.writeFileSync(path.join(crlf, FILE), lines.join('\r\n') + '\r\n', 'utf8')
  assert.equal(exp.loadAll(crlf).length, 2)
  assert.deepEqual(await collect(exp.iterate(crlf)), exp.loadAll(crlf))
  assert.deepEqual((await exp.page(crlf, { limit: 5 })).rows, exp.loadAll(crlf))
})

test('多字节字符横跨 64KB 块边界也读得对（按字节切行，不按块切）', async (t) => {
  const dir = tmp(t)
  const CHUNK = 64 * 1024
  const make = (pad) => JSON.stringify(rec('exp_big', 'a'.repeat(pad) + '鲸鱼与灯塔', '2026-11-01T09:00:00.000Z'))
  const base = make(0)
  const baseIdx = Buffer.byteLength(base.slice(0, base.indexOf('鲸')), 'utf8')
  const pad = 65535 - baseIdx // 让「鲸」的三个字节正好跨在 65536 字节的边界上
  assert.ok(pad > 0)
  const big = make(pad)
  const bigBytes = Buffer.from(big + '\n', 'utf8')
  assert.ok(bigBytes.length > CHUNK, '这一行要真的跨块')
  const text = big.slice(big.indexOf('"text":"') + 8, big.indexOf('","scene"'))
  put(dir, FILE, [make(pad), rec('exp_small', '后面还有一条', '2026-11-02T09:00:00.000Z')])
  const rows = exp.loadAll(dir)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].then.text, 'a'.repeat(pad) + '鲸鱼与灯塔')
  assert.ok(rows[0].then.text.includes('鲸鱼与灯塔'), '多字节字符不能在块边界上被切坏')
  assert.equal(exp.badLines(dir), 0)
  assert.deepEqual(await collect(exp.iterate(dir)), rows)
  assert.deepEqual((await exp.page(dir, { limit: 5 })).rows, rows)
})

// ---------------------------------------------------------------- 并发改动

test('遍历期间文件被追加：抛 EXPERIENCE_CHANGED，不静默少返一条', async (t) => {
  const dir = richDir(t)
  const it = exp.iterate(dir)[Symbol.asyncIterator]()
  const first = await it.next()
  assert.ok(first.done === false, '第一遍索引建完之后应当能给出第一条')
  append(dir, FILE, rec('exp_late', '她刚写下的一条', '2026-11-25T09:00:00.000Z'))
  await assert.rejects(async () => { for (;;) { const r = await it.next(); if (r.done) break } }, (e) => e.code === 'EXPERIENCE_CHANGED')
})

// ---------------------------------------------------------------- sqlite 后端

sq('sqlite 后端：iterate / page 与 loadAll 逐条相同', async (t) => {
  // 迁移不搬没有 id 的旧格式行、也拒绝重复 id，所以这一份用纯现代记录
  const dir = richDir(t, { legacy: false, dup: false })
  const r = spawnSync(process.execPath, [MIGRATE, dir, '--write'], { encoding: 'utf8' })
  assert.equal(r.status, 0, String(r.stdout || '') + String(r.stderr || ''))
  const want = exp.loadAll(dir, { backend: 'sqlite' })
  assert.ok(want.length > 0)
  assert.deepEqual(await collect(exp.iterate(dir, { backend: 'sqlite' })), want)
  const got = []
  let after = null
  for (;;) {
    const res = await exp.page(dir, { limit: 2, after, backend: 'sqlite' })
    got.push(...res.rows)
    if (!res.hasMore) break
    after = res.next
  }
  assert.deepEqual(got, want)
  // 没迁移过：三条路都一样 fail closed，不静默退回 file
  const virgin = tmp(t)
  put(virgin, FILE, [rec('exp_x', '还没迁移', '2026-11-01T09:00:00.000Z')])
  assert.throws(() => exp.loadAll(virgin, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_NOT_MIGRATED')
  await assert.rejects(collect(exp.iterate(virgin, { backend: 'sqlite' })), (e) => e.code === 'STORAGE_NOT_MIGRATED')
  await assert.rejects(exp.page(virgin, { limit: 5, backend: 'sqlite' }), (e) => e.code === 'STORAGE_NOT_MIGRATED')
})