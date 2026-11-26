// 阶段 3 的健壮性：随机库上的属性测试（1000 轮）+ 字节截断 + 并发写 + 写不进去
//
// 不变式（每轮都查）：
//   1. loadAll 抛错 → iterate / page / recall / currentView 必须抛**同一个错误码**，
//      而且 iterate 不许"先吐出几条再抛"（那等于给了半个库）；
//   2. loadAll 正常 → iterate 逐条相同；page 一页一页拼起来与全量切片逐条相同；
//   3. allowCorrupt 下三条路都要给出同一份"跳过坏行"的结果；
//   4. 任何抛出来的错都带 code（不带 code 的错会让调用方分不清"库坏了"和"代码坏了"）；
//   5. 文件里一行都没坏时，读出来的条数必须等于写进去的条数——不许静默少一条。
//
// 随机是固定的种子：跑出来的库每轮一样，失败能原样复现。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as exp from '../packages/core/lib/self-experience.js'
import { safeRemove, tmpDir } from './_safety.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const FILE = 'self-experience.jsonl'
const ROUNDS = 1000

function tmp(t, prefix = 'whale-fuzz-') {
  const dir = tmpDir(prefix)
  t.after(() => safeRemove(dir))
  return dir
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)]

const AT = ['2026-11-01T09:00:00.000Z', '2026-11-03T09:00:00.000Z', '2026-11-05T09:00:00.000Z', '2026-11-08T09:00:00.000Z']
const AS_OF = [null, '2026-11-02', '2026-11-05', '2026-11-06T12:00:00.000Z']

const rec = (id, text, at) => ({
  id,
  at,
  day: String(at).slice(0, 10),
  author: 'self',
  source: 'own-time',
  kind: '其它',
  weight: 'normal',
  then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: null },
  later: [],
  status: 'kept'
})

const BAD_LINES = ['{"broken":', 'not json at all', '{"id":"exp_x"', '   ', '[]', 'null']

// 一个随机库：正常记录 / 旧格式 / 重复 id / 坏行 / 六类事件（各自可能是坏的）
function randomLib(rnd) {
  const n = Math.floor(rnd() * 8)
  const lines = []
  const ids = []
  for (let i = 0; i < n; i++) {
    const r = rnd()
    if (r < 0.1) { lines.push(pick(rnd, BAD_LINES)); continue }
    if (r < 0.2) {
      lines.push({ at: pick(rnd, AT), text: '旧格式第 ' + i + ' 条', thought: rnd() < 0.5 ? '想过的' : '' })
      continue
    }
    // 偶尔重复用同一个 id：重复 id 的处理是这一版刻意保留的老行为
    const id = rnd() < 0.15 && ids.length ? pick(rnd, ids) : 'exp_' + i
    ids.push(id)
    const row = rec(id, '随机正文 ' + i, pick(rnd, AT))
    if (rnd() < 0.25 && ids.length > 1) row.then.refs = [pick(rnd, ids), 'exp_missing']
    if (rnd() < 0.15) row.then.unfinished = '还没弄完的事'
    if (rnd() < 0.2) row.weight = 'important'
    lines.push(row)
  }
  const sealer = () => (rnd() < 0.25 ? [pick(rnd, BAD_LINES)] : rnd() < 0.3 ? [{ id: pick(rnd, [...ids, 'exp_ghost']), at: pick(rnd, AT), day: '2026-11-09', action: 'seal', note: '' }] : [])
  const events = {
    'seal-events.jsonl': sealer(),
    'recall-events.jsonl': rnd() < 0.3 ? [pick(rnd, BAD_LINES)] : rnd() < 0.4 ? [{ id: pick(rnd, [...ids, 'exp_ghost']), at: pick(rnd, AT), query: 'q' }] : [],
    'later-events.jsonl': rnd() < 0.3 ? [pick(rnd, BAD_LINES)] : rnd() < 0.4 ? [{ id: pick(rnd, [...ids, 'exp_ghost']), at: pick(rnd, AT), day: '2026-11-04', thought: '后来的想法', reason: '', feeling: [] }] : [],
    'unfinished-events.jsonl': rnd() < 0.3 ? [pick(rnd, BAD_LINES)] : rnd() < 0.35 ? [{ id: pick(rnd, [...ids, 'exp_ghost']), at: pick(rnd, AT), day: '2026-11-04', choice: pick(rnd, ['done', 'shelved', 'reopen']), note: '' }] : [],
    'link-events.jsonl': rnd() < 0.2 ? [pick(rnd, BAD_LINES)] : rnd() < 0.3 && ids.length > 1 ? [{ from: pick(rnd, ids), to: pick(rnd, ids), at: pick(rnd, AT), day: '2026-11-04', reason: '有点关系' }] : [],
    'chapter-events.jsonl': rnd() < 0.2 ? [pick(rnd, BAD_LINES)] : rnd() < 0.25 ? [{ id: 'ch_1', at: pick(rnd, AT), day: '2026-11-04', action: 'open', name: '那段日子', from: '2026-11-01', to: '2026-11-06' }] : []
  }
  // 事件文件"不存在"和"存在但是空的"是两种不同的情况，都要造
  const missing = new Set(Object.keys(events).filter(() => rnd() < 0.25))
  return { lines, events, missing }
}

function writeLib(dir, spec) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, FILE), spec.lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + (spec.lines.length ? '\n' : ''), 'utf8')
  for (const [name, rows] of Object.entries(spec.events)) {
    if (spec.missing.has(name)) continue
    fs.writeFileSync(path.join(dir, name), rows.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  }
}

async function collect(it) {
  const out = []
  for await (const row of it) out.push(row)
  return out
}

function thrownCode(fn) {
  try {
    const value = fn()
    return { ok: true, value }
  } catch (error) {
    return { ok: false, code: error && error.code, message: String(error && error.message || error) }
  }
}

async function thrownCodeAsync(fn) {
  try {
    const value = await fn()
    return { ok: true, value }
  } catch (error) {
    return { ok: false, code: error && error.code, message: String(error && error.message || error) }
  }
}

// 期望值按"我们写进去的东西"独立算一遍：造的对象都是合格记录（asOf 之前的）；
// 解析不了的字符串是非空坏行；空行按口径跳过；能解析但不是记录的（'null' / '[]'）既不是坏行也不产出记录
function expectedCounts(spec, cut = Infinity) {
  let rows = 0
  let bad = 0
  let junk = 0
  let blank = 0
  for (const l of spec.lines) {
    if (typeof l !== 'string') { if (Date.parse(l.at) <= cut) rows += 1; continue }
    if (!l.trim()) { blank += 1; continue }
    let v
    try { v = JSON.parse(l) } catch { bad += 1; continue }
    if (v === null || Array.isArray(v) || typeof v !== 'object') junk += 1
  }
  return { rows, bad, junk, blank }
}

// asOf 的截止时刻：日期只给到天时算那天的最后一刻（和 lib 里 parseAsOf 同一个口径）
function cutOf(asOf) {
  if (asOf === null) return Infinity
  return /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new Date(asOf + 'T23:59:59.999').getTime() : new Date(asOf).getTime()
}

// ---------------------------------------------------------------- 属性测试

test('属性测试：随机库（含坏行/旧格式/重复 id/坏事件）上，三条读路径 1000 轮必须一致', async (t) => {
  const dir = tmp(t)
  const rnd = mulberry32(20261126)
  const t0 = Date.now()
  for (let round = 0; round < ROUNDS; round++) {
    const tag = '第 ' + round + ' 轮 '
    const spec = randomLib(rnd)
    writeLib(dir, spec)
    // 每轮把 mtime 往前推：分页索引按 size+mtime 认库，同一毫秒内的同长度重写不该被当成"没变"
    const stamp = new Date(Date.UTC(2026, 10, 26, 8, 0, 0) + round * 1000)
    fs.utimesSync(path.join(dir, FILE), stamp, stamp)

    const asOf = pick(rnd, AS_OF)
    for (const allowCorrupt of [false, true]) {
      const opts = { asOf, ...(allowCorrupt ? { allowCorrupt: true } : {}) }
      const load = thrownCode(() => exp.loadAll(dir, opts))
      if (!load.ok) {
        assert.ok(load.code, tag + '抛错必须带 code：' + load.message)
        // allowCorrupt 只放行"经历文件坏行"，不放行封存日志坏行（口径和 0.23.0 一模一样）
        if (allowCorrupt) assert.equal(load.code, 'SEAL_EVENTS_CORRUPT', tag + 'allowCorrupt 下还抛错，只该是封存日志的错：' + load.message)
        // 展示路径同一个码，而且不许"先给几条再抛"
        const early = []
        const it = await thrownCodeAsync(async () => { for await (const row of exp.iterate(dir, opts)) early.push(row) })
        assert.equal(it.ok, false, tag + 'loadAll 抛错时 iterate 不许正常返回')
        assert.equal(it.code, load.code, tag + 'iterate 的错误码要和 loadAll 一致（' + it.code + ' vs ' + load.code + '）')
        assert.equal(early.length, 0, tag + '坏库不许先吐出 ' + early.length + ' 条再抛')
        const pg = await thrownCodeAsync(() => exp.page(dir, { limit: 3, ...opts }))
        assert.equal(pg.ok, false, tag + 'loadAll 抛错时 page 不许正常返回')
        assert.equal(pg.code, load.code, tag + 'page 的错误码要和 loadAll 一致（' + pg.code + ' vs ' + load.code + '）')
        if (!allowCorrupt) assert.equal(thrownCode(() => exp.recall(dir, '随机', opts)).ok, false, tag + 'recall 也要 fail closed')
        continue
      }

      const want = load.value
      const got = await collect(exp.iterate(dir, opts))
      assert.deepEqual(got, want, tag + 'iterate 与 loadAll 不一致（asOf=' + asOf + '）')

      // 分页：一页一页翻到底，拼起来必须与全量切片逐条相同
      for (const limit of [1, 3, 7]) {
        const paged = []
        let after = null
        let pages = 0
        for (;;) {
          const pageOpts = { asOf, ...(allowCorrupt ? { allowCorrupt: true } : {}) }
          const res = await exp.page(dir, { limit, after, ...pageOpts })
          assert.equal(res.total, want.length, tag + 'total 与条数不一致')
          paged.push(...res.rows)
          pages += 1
          if (!res.hasMore) { assert.equal(res.next, null); break }
          after = res.next
          assert.ok(pages <= want.length + 1, tag + '翻页停不下来')
        }
        assert.deepEqual(paged, want, tag + '分页拼起来与全量不一致（limit=' + limit + ' asOf=' + asOf + '）')
      }
      // 没有任何坏行时，读出来的条数必须正好是写进去的条数（不许静默少一条）
      if (!allowCorrupt) {
        const want2 = expectedCounts(spec, cutOf(asOf))
        assert.equal(exp.badLines(dir), want2.bad, tag + '坏行数对不上')
        assert.equal(want.length, want2.rows, tag + '条数对不上：读 ' + want.length + ' ≠ 应有 ' + want2.rows + '（asOf=' + asOf + '）')
        // "一行都没不翼而飞"只在不截断时才有意义（asOf 本来就要藏起后面的记录）
        if (asOf === null) assert.equal(want.length + want2.bad + want2.junk, spec.lines.length - want2.blank, tag + '有行不翼而飞')
      }
    }
  }
  assert.ok(Date.now() - t0 < 120000, '1000 轮不该跑太久（' + (Date.now() - t0) + 'ms）')
})

// ---------------------------------------------------------------- 按字节截断

test('按字节截断：在任何位置切断（含多字节字符中间），三条路都必须同样 fail closed 或不约而同地读对', async (t) => {
  const dir = tmp(t)
  const lines = [
    rec('exp_a', '海边捡到一只受伤的海鸟，抱回家', AT[0]),
    rec('exp_b', '书店打工第一天，店里有只猫', AT[1]),
    rec('exp_c', '和妈妈吵了一架，摔了门', AT[2])
  ]
  const whole = Buffer.from(lines.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  fs.writeFileSync(path.join(dir, FILE), whole)
  const rnd = mulberry32(777)
  for (let round = 0; round < 200; round++) {
    // 截断点：故意偏向前三条记录结尾附近，好造出"半个 JSON"和"半个汉字"
    const cut = round < 3 ? whole.length - 1 - round : 1 + Math.floor(rnd() * (whole.length - 1))
    fs.writeFileSync(path.join(dir, FILE), whole.subarray(0, cut))
    const stamp = new Date(Date.UTC(2026, 10, 27, 8, 0, 0) + round * 1000)
    fs.utimesSync(path.join(dir, FILE), stamp, stamp)
    const tag = '截断到 ' + cut + '/' + whole.length + ' 字节 '

    const load = thrownCode(() => exp.loadAll(dir))
    if (!load.ok) {
      assert.ok(load.code, tag + '抛错必须带 code')
      const early = []
      const it = await thrownCodeAsync(async () => { for await (const row of exp.iterate(dir)) early.push(row) })
      assert.equal(it.code, load.code, tag + 'iterate 错误码不一致（' + it.code + ' vs ' + load.code + '）')
      assert.equal(early.length, 0, tag + 'iterate 先给后抛')
      const pg = await thrownCodeAsync(() => exp.page(dir, { limit: 2 }))
      assert.equal(pg.code, load.code, tag + 'page 错误码不一致（' + pg.code + ' vs ' + load.code + '）')
      // 按字节抢救（备份/恢复那条路）时三条路仍然一致
      const raw = exp.loadAll(dir, { allowCorrupt: true })
      assert.deepEqual(await collect(exp.iterate(dir, { allowCorrupt: true })), raw, tag + 'allowCorrupt 下不一致')
      // 抢救出来的 + 坏掉的 = 截断后文件里非空的行数（对照的是**截断后**的内容，不是完整文件）
      const shown = whole.subarray(0, cut).toString('utf8').split('\n').filter((l) => l.trim()).length
      assert.equal(raw.length + exp.badLines(dir), shown, tag + '抢救时丢了行（读到 ' + raw.length + ' + 坏 ' + exp.badLines(dir) + ' ≠ 文件里 ' + shown + ' 行）')
    } else {
      assert.deepEqual(await collect(exp.iterate(dir)), load.value, tag + 'iterate 不一致')
      const res = await exp.page(dir, { limit: 2 })
      assert.deepEqual(res.rows, load.value.slice(0, 2), tag + 'page 不一致')
    }
  }
})

// ---------------------------------------------------------------- 并发写

test('并发写：两个进程同时追加，结果要么完整、要么明确报坏行，不许静默少一条', (t) => {
  const dir = tmp(t)
  fs.writeFileSync(path.join(dir, FILE), JSON.stringify(rec('exp_0', '最前面的一条', AT[0])) + '\n', 'utf8')
  const script = `
    const { addExperience } = await import(${JSON.stringify(new URL('../packages/core/lib/self-experience.js', import.meta.url).href)})
    let ok = 0
    for (let i = 0; i < 20; i++) {
      try { addExperience(${JSON.stringify(dir)}, { text: '并发写的第 ' + i + ' 条' }); ok += 1 } catch {}
    }
    console.log(JSON.stringify({ ok }))
  `
  const runs = [0, 1].map(() => spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }))
  const wrote = runs.reduce((n, r) => n + Number(JSON.parse(String(r.stdout || '{}').trim() || '{}').ok || 0), 0)
  assert.equal(wrote, 40, '两个进程都该写完（示例脚本不该抛）：' + String(runs[0].stderr || '') + String(runs[1].stderr || ''))
  const bad = exp.badLines(dir)
  const raw = exp.loadAll(dir, { allowCorrupt: true })
  // 不许静默丢：写进去的条数要么全读得回来，要么被算成坏行（坏行会让展示路径 fail closed）
  assert.equal(raw.length + bad, 41, '并发写之后丢了行：读到 ' + raw.length + ' + 坏行 ' + bad + ' ≠ 41')
  if (bad === 0) {
    assert.equal(exp.loadAll(dir).length, 41, '没有坏行时展示路径必须读回全部')
  } else {
    assert.throws(() => exp.loadAll(dir), (e) => e.code === 'EXPERIENCE_CORRUPT', '有坏行时展示路径必须 fail closed')
  }
  // 每一行仍然是完整的一条记录（解析出来的都有 id 和正文）
  for (const row of raw) assert.ok(row.id && row.then && row.then.text, '读出来的必须是完整记录')
})

// ---------------------------------------------------------------- 写不进去

test('写不进去：经历文件被换成目录 / 事件文件只读，写入必须抛错，且不破坏已有内容', (t) => {
  // 主文件路径是目录：append 一定失败
  const dir = tmp(t)
  fs.mkdirSync(path.join(dir, FILE))
  assert.throws(() => exp.addExperience(dir, { text: '写不进去的一条' }), (e) => ['EISDIR', 'EEXIST', 'EPERM', 'EACCES', 'ERR_INVALID_ARG_TYPE'].includes(e.code) || /EISDIR|EEXIST|EPERM|EACCES/.test(String(e.message)))
  assert.ok(fs.statSync(path.join(dir, FILE)).isDirectory(), '失败之后不许把目录删掉/换掉')

  // 事件文件被换成目录：封存事件写不进去，必须报出来而不是假装成功
  const dir2 = tmp(t)
  const before = JSON.stringify(rec('exp_a', '一条正常的', AT[0])) + '\n'
  fs.writeFileSync(path.join(dir2, FILE), before, 'utf8')
  fs.mkdirSync(path.join(dir2, 'seal-events.jsonl'))
  const res = exp.setSealed(dir2, { id: 'exp_a', sealed: true })
  assert.equal(res.ok, false, '封存写不进去时必须返回 ok:false')
  assert.ok(res.error, '要说清为什么')
  assert.equal(fs.readFileSync(path.join(dir2, FILE), 'utf8'), before, '经历正文一个字节都不该被动过')
  // 封存日志读不出来 → 展示路径 fail closed（宁可报错，也不许当成"她什么都没封存"）
  // 注意 allowSealCorrupt 只放行"坏行"，不放过"整份读不出来"——读不了就是状态未知
  assert.equal(thrownCode(() => exp.loadAll(dir2)).code, 'SEAL_EVENTS_UNREADABLE')
  assert.equal(thrownCode(() => exp.loadAll(dir2, { allowSealCorrupt: true })).code, 'SEAL_EVENTS_UNREADABLE')
  // 把那半个目录挪开：正文还在，而且没有被她"封存"过
  fs.rmdirSync(path.join(dir2, 'seal-events.jsonl'))
  const after = exp.loadAll(dir2)
  assert.equal(after.length, 1, '经历正文还在')
  assert.ok(!after[0].sealed, '没写进去就不许显示成已封存')

  // 数据目录本身是个文件：mkdir 失败要说清楚
  const filePath = path.join(tmp(t), 'not-a-dir')
  fs.writeFileSync(filePath, 'x', 'utf8')
  assert.throws(() => exp.addExperience(filePath, { text: '放不进去' }), (e) => Boolean(e.code || e.message))
})

// ---------------------------------------------------------------- 封存事件文件损坏

test('封存事件文件损坏：读、召回、逐条、分页全部 fail closed；按字节抢救时才放行', async (t) => {
  const dir = tmp(t)
  fs.writeFileSync(path.join(dir, FILE), JSON.stringify(rec('exp_a', '海边的那一天', AT[0])) + '\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'seal-events.jsonl'), JSON.stringify({ id: 'exp_a', at: AT[0], day: '2026-11-01', action: 'seal', note: '' }) + '\n{"broken":\n', 'utf8')
  const code = (fn) => { try { fn(); return 'ok' } catch (e) { return e.code } }
  assert.equal(code(() => exp.loadAll(dir)), 'SEAL_EVENTS_CORRUPT')
  assert.equal(code(() => exp.recall(dir, '海边')), 'SEAL_EVENTS_CORRUPT')
  assert.equal(code(() => exp.currentView(dir, 'exp_a')), 'SEAL_EVENTS_CORRUPT')
  const it = await thrownCodeAsync(() => collect(exp.iterate(dir)))
  assert.equal(it.code, 'SEAL_EVENTS_CORRUPT', '逐条读也要把封存状态当"未知"')
  const pg = await thrownCodeAsync(() => exp.page(dir, { limit: 5 }))
  assert.equal(pg.code, 'SEAL_EVENTS_CORRUPT', '分页也要 fail closed')
  // 备份/恢复那条路放行，但结果不能当成"可见"用
  assert.equal(exp.loadAll(dir, { allowSealCorrupt: true }).length, 1)
  assert.deepEqual(await collect(exp.iterate(dir, { allowSealCorrupt: true })), exp.loadAll(dir, { allowSealCorrupt: true }))
})