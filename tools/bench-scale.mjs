#!/usr/bin/env node
// 阶段 3 的规模基准：10 万条下的写入、全量读、逐条读、分页读、召回
//
// 为什么每一项都在**独立子进程**里跑：
//   loadAll 是同步的，跑的时候事件循环被占住，没法在主线程里采样 heapUsed；
//   所以峰值用子进程的 process.resourceUsage().maxRSS（OS 记的峰值常驻内存），
//   并且把「只 import + 摸一下文件」的基线一起量出来，两个数相减才是这段读路径自己的账。
//
// 用法：
//   node tools/bench-scale.mjs                  # 造数据（如果还没有）+ 跑全套
//   node tools/bench-scale.mjs --gen            # 只造数据
//   node tools/bench-scale.mjs --rows 20000     # 换规模
//   node tools/bench-scale.mjs --json           # 机器可读
//   node tools/bench-scale.mjs --child load <dir>   # 内部用：单次测量
//
// 数据是虚构的（词表随机拼），落在系统临时目录，不碰真实数据。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const LIB = path.join(root, 'packages', 'core', 'lib', 'self-experience.js')

const argv = process.argv.slice(2)
const flag = (name, dflt = null) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : dflt
}
const ROWS = Number(flag('rows', 100000))
// --text：每条正文再塞这么多字。用来看"记录越长，两个读法的内存差距怎么变"
const TEXT_PAD = Number(flag('text', 0))
const AS_JSON = Boolean(flag('json', false))
// --once：只跑一次。内存测量必须单次——连着跑很多次的话，峰值记的是"垃圾堆到 GC 之前"，
// 不是这一段读路径自己要多少内存。
const ONCE = Boolean(flag('once', false))
const BASE = String(flag('dir', path.join(os.tmpdir(), 'whale-bench-scale-' + ROWS + (TEXT_PAD ? '-t' + TEXT_PAD : ''))))
const MEM = path.join(BASE, 'mem')

// ---------------------------------------------------------------- 造数据（虚构）

// 固定的伪随机：每次跑出来的库一样，数字才可比
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

const WHO = ['阿禾', '小满', '妈妈', '店长', '楼下的猫', '隔壁的小孩', '灯塔管理员', '送信的阿姨']
const WHAT = ['在书店值了晚班', '把海鸟放回了海边', '煮了一锅粥', '把伞借给了同事', '爬上楼顶看雨', '收到一张明信片', '把旧照片翻了出来', '在站台上等了很久', '把窗户擦干净了', '学会了折纸船']
const HOW = ['有点累，但心里是静的', '风很大，围巾一直贴在脸上', '闻到了桂花，忽然想家', '灯光黄得让人想坐一会儿', '雨点把玻璃敲得很响', '声音很小，像怕吵醒什么', '没有说出口的那句话还在', '手心一直是热的']
const KIND = ['日常', '人际', '工作', '其它', '想起']
const FEEL = ['安心', '累', '高兴', '怕', '失落', '暖', '乱']

function makeRow(i, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const t = Date.UTC(2025, 0, 1) + Math.floor(i * (700 * 24 * 3600 * 1000) / ROWS) // 摊在两年里
  const at = new Date(t).toISOString()
  const weight = rnd() < 0.08 ? 'important' : rnd() < 0.4 ? 'minor' : 'normal'
  const row = {
    id: 'exp_b' + i.toString(36).padStart(5, '0'),
    at,
    day: at.slice(0, 10),
    author: 'self',
    source: 'own-time',
    kind: pick(KIND),
    weight,
    then: {
      text: pick(WHAT) + '。' + pick(HOW) + '（' + pick(WHO) + '）' + (TEXT_PAD ? '｜' + '雨声一直在窗外'.repeat(Math.ceil(TEXT_PAD / 7)).slice(0, TEXT_PAD) : ''),
      scene: rnd() < 0.3 ? pick(HOW) : '',
      feeling: rnd() < 0.5 ? [pick(FEEL)] : [],
      thought: rnd() < 0.35 ? '我大概是个' + pick(FEEL) + '的人吧' : '',
      unfinished: rnd() < 0.06 ? '要不要再去找她' : '',
      quote: null,
      state: { at }
    },
    later: [],
    status: 'kept'
  }
  return row
}

function gen() {
  if (fs.existsSync(path.join(MEM, 'self-experience.jsonl'))) {
    const have = countLines(path.join(MEM, 'self-experience.jsonl'))
    if (have === ROWS) return { reused: true, rows: have }
    fs.rmSync(MEM, { recursive: true, force: true })
  }
  fs.mkdirSync(MEM, { recursive: true })
  const rnd = mulberry32(20261126)
  const recalls = []
  const later = []
  const seal = []
  let chunk = []
  for (let i = 0; i < ROWS; i++) {
    const row = makeRow(i, rnd)
    chunk.push(row)
    if (rnd() < 0.3) recalls.push({ id: row.id, at: row.at, query: '雨' })
    if (rnd() < 0.05) later.push({ id: row.id, at: row.at, day: row.day, thought: '后来想想，其实还好', reason: '', feeling: [] })
    if (rnd() < 0.03) seal.push({ id: row.id, at: row.at, day: row.day, action: 'seal', note: '不想再提' })
    if (chunk.length >= 2000 || i === ROWS - 1) {
      fs.appendFileSync(path.join(MEM, 'self-experience.jsonl'), chunk.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
      chunk = []
    }
  }
  const dump = (name, rows) => fs.writeFileSync(path.join(MEM, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  dump('recall-events.jsonl', recalls)
  dump('later-events.jsonl', later)
  dump('seal-events.jsonl', seal)
  return { reused: false, rows: ROWS, recalls: recalls.length, later: later.length, seal: seal.length }
}

function countLines(file) {
  let n = 0
  const buf = Buffer.allocUnsafe(1 << 20)
  const fd = fs.openSync(file, 'r')
  try {
    for (;;) {
      const got = fs.readSync(fd, buf, 0, buf.length, null)
      if (!got) break
      for (let i = 0; i < got; i++) if (buf[i] === 10) n += 1
    }
  } finally { fs.closeSync(fd) }
  return n
}

const fileSize = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0)

// ---------------------------------------------------------------- 单次测量（子进程里跑）

const QUERIES = ['书店 晚班', '海鸟', '明信片 照片', '桂花 想家', '雨 玻璃', '妈妈', '折纸船', '围巾', '楼顶', '粥']

async function child(mode, dir) {
  const exp = await import(pathToFileURL(LIB).href)
  const file = path.join(dir, 'self-experience.jsonl')
  const out = { mode, peaks: {} }
  const rss = () => Math.round(process.resourceUsage().maxRSS / 1024) // MB
  out.fileMB = Math.round(fileSize(file) / 1048576 * 10) / 10

  if (mode === 'baseline') {
    // 只 import + 摸一下文件：子进程和模块本身的底噪
    exp.badLines(path.join(dir, 'no-such-dir'))
    out.rss = rss()
    out.count = 0
    return out
  }

  if (mode === 'load') {
    const t = []
    let n = 0
    for (let i = 0; i < (ONCE ? 1 : 5); i++) {
      const t0 = process.hrtime.bigint()
      n = exp.loadAll(dir).length
      t.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    out.ms = t
    out.count = n
    out.rss = rss()
    return out
  }

  if (mode === 'iterate') {
    const t0 = process.hrtime.bigint()
    let n = 0
    for await (const row of exp.iterate(dir)) n += row.id ? 1 : 0
    out.ms = [Number(process.hrtime.bigint() - t0) / 1e6]
    out.count = n
    out.rss = rss()
    return out
  }

  if (mode === 'page') {
    // 连续翻二十页：第一页含建索引，后面吃缓存。整库翻完在十万条下要上千页，
    // 那是遍历该用 iterate 的活，不是分页的用法。
    const ms = []
    let after = null
    let n = 0
    let pages = 0
    const want = ONCE ? 1 : 20
    while (pages < want) {
      const t0 = process.hrtime.bigint()
      const res = await exp.page(dir, { limit: 100, after })
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
      n += res.rows.length
      pages += 1
      if (!res.hasMore) break
      after = res.next
    }
    out.ms = ms
    out.count = n
    out.pages = pages
    out.rss = rss()
    return out
  }

  if (mode === 'verify') {
    // 分页拼起来和全量切片逐条一致（只比 id 与正文，避免两份全量对象同时在内存里）
    const want = exp.loadAll(dir).map((r) => r.id + '\u0000' + r.then.text)
    let after = null
    const got = []
    for (;;) {
      const res = await exp.page(dir, { limit: 997, after })
      for (const r of res.rows) got.push(r.id + '\u0000' + r.then.text)
      if (!res.hasMore) break
      after = res.next
    }
    out.ok = got.length === want.length && got.every((x, i) => x === want[i])
    out.count = got.length
    out.rss = rss()
    return out
  }

  if (mode === 'recall') {
    const ms = []
    let hits = 0
    for (let rep = 0; rep < (ONCE ? 1 : 3); rep++) {
      for (const q of QUERIES) {
        const t0 = process.hrtime.bigint()
        hits += exp.recall(dir, q, { limit: 5 }).length
        ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
        if (ONCE) break
      }
      if (ONCE) break
    }
    out.ms = ms
    out.count = hits
    out.rss = rss()
    return out
  }

  if (mode === 'write') {
    // 在 10 万条的库上写：拷一份再写，别把基准数据改了
    const copy = dir + '-write'
    fs.rmSync(copy, { recursive: true, force: true })
    fs.mkdirSync(copy, { recursive: true })
    for (const name of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, name), path.join(copy, name))
    const ms = []
    for (let i = 0; i < (ONCE ? 1 : 20); i++) {
      const t0 = process.hrtime.bigint()
      exp.addExperience(copy, { text: '写一条新的：第 ' + i + ' 条（基准）', kind: '日常' })
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    fs.rmSync(copy, { recursive: true, force: true })
    out.ms = ms
    out.count = ms.length
    out.rss = rss()
    return out
  }

  throw new Error('未知的测量项：' + mode)
}

// ---------------------------------------------------------------- 汇总

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))]
}
const r1 = (n) => Math.round(n * 10) / 10

function runChild(mode, dir, extra = [], heapMB = 0) {
  const args = heapMB ? ['--max-old-space-size=' + heapMB, fileURLToPath(import.meta.url)] : [fileURLToPath(import.meta.url)]
  const r = spawnSync(process.execPath, [...args, '--child', mode, dir, ...extra], { encoding: 'utf8', maxBuffer: 8 << 20 })
  if (r.status !== 0) {
    const msg = String(r.stderr || r.stdout || '')
    if (/heap out of memory|Allocation failed|Reached heap limit/i.test(msg)) return { oom: true }
    throw new Error('子进程失败（' + mode + '）：' + msg.split('\n').slice(0, 4).join(' '))
  }
  return JSON.parse(String(r.stdout).trim().split('\n').pop())
}

// 最少要多少堆才能跑完：峰值 RSS 会被"还没回收的临时垃圾"顶高，
// 但 V8 的堆上限是硬墙——堆里活着的对象超过上限就直接 OOM。
// 所以"能跑完的最小 --max-old-space-size"才说明这一段读路径真正压着多少东西。
function minHeap(mode, dir, from = 320, to = 32, step = 16) {
  let ok = 0
  for (let cap = from; cap >= to; cap -= step) {
    const r = runChild(mode, dir, ['--once'], cap)
    if (r.oom) return { ok, failedAt: cap }
    ok = cap
  }
  return { ok, failedAt: 0 }
}

function main() {
  if (argv.includes('--gen')) {
    const g = gen()
    console.log(JSON.stringify({ dir: MEM, ...g }))
    return
  }

  const genInfo = gen()
  const base = runChild('baseline', MEM)
  const results = { rows: ROWS, dir: MEM, fileMB: base.fileMB, baselineRSS: base.rss }

  // 计时：多次；内存：单次（单次才是这一段读路径自己的峰值）
  const timed = (mode) => runChild(mode, MEM)
  const peak = (mode) => runChild(mode, MEM, ['--once'])

  results.verify = runChild('verify', MEM)
  results.load = { ...timed('load'), peak: peak('load').rss }
  results.iterate = { ...timed('iterate'), peak: peak('iterate').rss }
  results.page = { ...timed('page'), peak: peak('page').rss }
  results.recall = { ...timed('recall'), peak: peak('recall').rss }
  results.write = { ...timed('write'), peak: peak('write').rss }
  // --cap：再量一遍「最少要多少堆才跑得完」（慢：每种档位都单起一个子进程）
  if (argv.includes('--cap')) {
    results.cap = { load: minHeap('load', MEM), iterate: minHeap('iterate', MEM) }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ genInfo, results }, null, 2))
    return
  }

  const L = results.load
  const I = results.iterate
  const P = results.page
  const R = results.recall
  const W = results.write
  const extra = (x) => x.peak - base.rss

  console.log('')
  console.log('规模基准（' + ROWS.toLocaleString('en-US') + ' 条 · 虚构数据 · ' + path.basename(MEM) + '）')
  console.log('文件 ' + results.fileMB + ' MB；基线子进程峰值 ' + base.rss + ' MB（只 import + 摸文件）')
  console.log('')
  console.log('| 项 | 中位 | p99 | 说明 | 单次峰值 RSS | 比基线多 |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  console.log('| 全量读 loadAll | ' + r1(median(L.ms)) + ' ms | ' + r1(pct(L.ms, 99)) + ' ms | 5 次，' + L.count + ' 条 | ' + L.peak + ' MB | +' + extra(L) + ' MB |')
  console.log('| 逐条读 iterate | ' + r1(I.ms[0]) + ' ms | — | 一次遍历 ' + I.count + ' 条 | ' + I.peak + ' MB | +' + extra(I) + ' MB |')
  console.log('| 分页 page(100) | ' + r1(median(P.ms)) + ' ms | ' + r1(pct(P.ms, 99)) + ' ms | ' + P.pages + ' 页，每页 100 条 | ' + P.peak + ' MB | +' + extra(P) + ' MB |')
  console.log('| 召回 recall(5) | ' + r1(median(R.ms)) + ' ms | ' + r1(pct(R.ms, 99)) + ' ms | ' + R.ms.length + ' 次查询 | ' + R.peak + ' MB | +' + extra(R) + ' MB |')
  console.log('| 写入 addExperience | ' + r1(median(W.ms)) + ' ms | ' + r1(pct(W.ms, 99)) + ' ms | ' + W.count + ' 次 | ' + W.peak + ' MB | +' + extra(W) + ' MB |')
  console.log('')
  console.log('分页与全量切片逐条一致：' + (results.verify.ok ? '是（' + results.verify.count + ' 条全对）' : '不——有 bug'))
  console.log('内存对比：loadAll 单次峰值 +' + extra(L) + ' MB，iterate 单次峰值 +' + extra(I) + ' MB（差 ' + r1(extra(L) / Math.max(1, extra(I))) + ' 倍）')
  if (results.cap) {
    const capText = (c) => (c.ok ? (c.ok === 512 ? '≥ ' + c.ok + ' MB（没探到墙）' : '≥ ' + c.ok + ' MB（' + (c.failedAt ? c.failedAt + ' MB 就 OOM' : '') + '）') : '512 MB 也跑不完')
    console.log('堆下限（能跑完的最小 --max-old-space-size）：loadAll ' + capText(results.cap.load) + '；iterate ' + capText(results.cap.iterate))
  }
  if (!results.verify.ok) process.exitCode = 1
}

if (argv[0] === '--child') {
  child(argv[1], argv[2]).then((out) => { process.stdout.write(JSON.stringify(out) + '\n') }).catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1) })
} else {
  main()
}