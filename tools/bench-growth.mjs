#!/usr/bin/env node
// N2 · 真实规模与增长曲线：1k → 5k → 2万 → 10万 → 20万，同一个目录一路长上去（不重建）。
//
// 和 bench-scale 的区别：
//   · bench-scale 每次从零造一个定规模的库、只测一次 10 万；
//   · 这里是一条曲线：同一个目录**逐步长到** 20 万，每一档量同一组指标，拐点在哪一档自己露出来；
//   · 语料按真实分布造（长短混合、中文为主、有后记 / 封存 / 撤回、时间跨 90 天），不是词表随机拼。
//
// 做法（为什么增长不逐条走 addExperience）：
//   增长本身用批量追加（和 bench-scale 同一个手法：直接写 JSONL 行），否则光造 20 万条就要半小时以上；
//   **写入吞吐**另外用真的 addExperience 在每档的副本上量（默认 200 次/档，量完删副本，不动主库）。
//   这样曲线是分钟级的，但延迟 / 内存这些指标量的是真 API。
//
// 每档测：
//   写入吞吐（200 次真写：中位 / p95 / 每秒）、loadAll 中位与堆峰值、iterate 中位与堆峰值、
//   page 中位 / p99 与首页冷启（含建索引）、recall 中位 / p95、索引重建时间（首页冷启 − 热页中位）。
//
// 堆峰值都在**独立子进程**里量（loadAll / iterate 是同步的，主线程采样不可靠）：
//   用 process.resourceUsage().maxRSS，再减掉一个只 import 的基线子进程，得到这一段读路径自己的账。
//
// 用法：
//   node tools/bench-growth.mjs                       # 默认阶梯，跑完打印 markdown 表
//   node tools/bench-growth.mjs --json                # 只打 JSON
//   node tools/bench-growth.mjs --out=growth.json     # 另外落一份 JSON（相对当前目录）
//   node tools/bench-growth.mjs --steps=1000,5000     # 换阶梯（最后一档决定总规模）
//   node tools/bench-growth.mjs --dir=<dir>           # 换目录（默认系统临时目录）
//   node tools/bench-growth.mjs --resume              # 上次跑一半：接着长（默认重头来）
//   node tools/bench-growth.mjs --samples=50          # 每档写多少次（默认 200）
//
// 数据是虚构的，落在系统临时目录，不碰真实记忆。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const LIB = path.join(root, 'packages', 'core', 'lib', 'self-experience.js')
const SELF = fileURLToPath(import.meta.url)
const expLib = await import(pathToFileURL(LIB).href)
const { addExperience } = expLib
const { eraseExperience } = await import(pathToFileURL(path.join(root, 'packages', 'core', 'lib', 'erase.js')).href)

const argv = process.argv.slice(2)
const flag = (name, dflt = null) => {
  const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='))
  if (!hit) return dflt
  if (hit === '--' + name) return true
  return hit.slice(name.length + 3)
}
const STEPS = String(flag('steps', '1000,5000,20000,100000,200000')).split(',').map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
const SAMPLES = Number(flag('samples', 200))
const AS_JSON = Boolean(flag('json', false))
const OUT = flag('out', '')
const RESUME = Boolean(flag('resume', false))
const BASE = String(flag('dir', path.join(os.tmpdir(), 'whale-bench-growth')))
const MEM = path.join(BASE, 'mem')
const FILE = path.join(MEM, 'self-experience.jsonl')
const FINAL = Math.max(...STEPS)
const DAYS = 90
const START = Date.UTC(2026, 7, 29, 0, 0, 0) // 2026-08-29 → 2026-11-27，正好 90 天

// ---------------------------------------------------------------- 语料（虚构，按真实分布）
//
// 分布（和 10 万条 bench 的"词表随机拼"不同）：
//   · 长度：30% 短（8–25 字）、50% 中（25–70）、20% 长（70–200）；
//   · 语言：中文为主，8% 夹一个英文词；
//   · 结构：30% 有场景、35% 有想法、6% 有没弄完的事、20% 有引用、50% 有情绪；
//   · 事件：5% 有后记、3% 封存、10% 被想起过；每档撤回 1 条（真走 eraseExperience）；
//   · 时间：按写入顺序摊在 90 天里（越早的档越旧），后记 / 封存 / 想起时间都晚于当时。
const WHO = ['阿禾', '小满', '妈妈', '店长', '楼下的猫', '隔壁的小孩', '灯塔管理员', '送信的阿姨', '同桌', '房东', '校刊编辑', '话剧社的人']
const WHAT = [
  '在书店值了晚班', '把海鸟放回了海边', '煮了一锅粥', '把伞借给了同事', '爬上楼顶看雨', '收到一张明信片',
  '把旧照片翻了出来', '在站台上等了很久', '把窗户擦干净了', '学会了折纸船', '在校刊改到凌晨', '在话剧社排了两遍',
  '去外婆家吃了饭', '把围巾落在教室', '在码头坐到天黑', '给花浇了水', '把抽屉整理了一遍', '在图书馆借了三本书',
  '骑车绕了半个城', '把音乐调小了一点'
]
const HOW = [
  '有点累，但心里是静的', '风很大，围巾一直贴在脸上', '闻到了桂花，忽然想家', '灯光黄得让人想坐一会儿',
  '雨点把玻璃敲得很响', '声音很小，像怕吵醒什么', '没有说出口的那句话还在', '手心一直是热的',
  '楼道里有股旧木头味', '远处的船笛响了两声', '肚子有点饿，但懒得动', '太阳落下去的时候有点舍不得',
  '手机响了一下，又安静了', '把窗户关上了，屋里更静', '鞋底沾了泥，走一步掉一点', '走廊的灯忽明忽暗'
]
const KIND = ['日常', '人际', '工作', '其它', '想起']
const FEEL = ['安心', '累', '高兴', '怕', '失落', '暖', '乱', '平静']
const EN = ['playlist', 'deadline', 'weekend', 'coffee', 'meeting', 'overtime', 'podcast', 'sunset', 'playlist', 'notes']
const SOURCE = ['校刊', '话剧社的群', '妈妈', '一本旧书', '电台', '同学']
const QUERIES = ['书店 晚班', '海鸟', '明信片 照片', '桂花 想家', '雨 玻璃', '妈妈', '折纸船', '围巾', '楼顶', '粥', '校刊 凌晨', '话剧社']
const LATER = ['后来想想，其实还好', '那天应该多说一句的', '现在再想起来是暖的', '还是有点难过', '原来那时候就已经决定了']
const SEAL_NOTE = ['不想再提起', '先放着吧', '这段不想被主动问起']

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

const pad = (n, w) => { const s = String(n); return s.length >= w ? s : '0'.repeat(w - s.length) + s }
const dayOf = (at) => at.slice(0, 10)
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)]
const atOf = (index) => new Date(START + Math.floor((Math.min(index, FINAL - 1) / FINAL) * DAYS * 24 * 3600 * 1000)).toISOString()

function makeRecord(i, rnd) {
  const at = atOf(i)
  const roll = rnd()
  const lenClass = roll < 0.3 ? 'short' : roll < 0.8 ? 'medium' : 'long'
  const parts = [pick(rnd, WHAT) + '，' + pick(rnd, HOW) + '。']
  if (rnd() < 0.35) parts.push(pick(rnd, WHO) + '也在。')
  if (rnd() < 0.08) parts.push('耳机里放的是 ' + pick(rnd, EN) + '。')
  if (lenClass === 'long') parts.push(pick(rnd, HOW) + '。' + pick(rnd, HOW) + '。' + pick(rnd, WHO) + '说下次再来。')
  if (lenClass === 'short') parts.length = Math.min(parts.length, 1)
  const text = parts.join('')
  const weight = rnd() < 0.08 ? 'important' : rnd() < 0.4 ? 'minor' : 'normal'
  const feelings = []
  if (rnd() < 0.5) feelings.push(pick(rnd, FEEL))
  if (rnd() < 0.12) { const f = pick(rnd, FEEL); if (!feelings.includes(f)) feelings.push(f) }
  const row = {
    id: 'exp_g' + pad(i.toString(36), 6),
    at,
    day: dayOf(at),
    author: 'self',
    source: 'own-time',
    kind: pick(rnd, KIND),
    weight,
    then: {
      text,
      scene: rnd() < 0.3 ? pick(rnd, HOW) : '',
      feeling: feelings,
      thought: rnd() < 0.35 ? '我大概是个' + pick(rnd, FEEL) + '的人吧' : '',
      unfinished: rnd() < 0.06 ? '要不要再去找她' : '',
      quote: rnd() < 0.2 ? { text: '好像有点舍不得', source: pick(rnd, SOURCE) } : null,
      state: { at }
    },
    later: [],
    status: 'kept'
  }
  return row
}

// ---------------------------------------------------------------- 造数据（批量追加，增量增长）

function countLines(file) {
  if (!fs.existsSync(file)) return 0
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

const fileMB = (p) => Math.round((fs.existsSync(p) ? fs.statSync(p).size : 0) / 1048576 * 10) / 10

function openOut(name) {
  fs.mkdirSync(MEM, { recursive: true })
  const file = path.join(MEM, name)
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8')
  return fs.openSync(file, 'a')
}

function writeLines(fd, lines) {
  if (lines.length) fs.writeSync(fd, lines.join('\n') + '\n', null, 'utf8')
}

// 增长：把目录从 current 长到 target；返回这一档的统计
function growTo(target, state) {
  const before = countLines(FILE)
  let erasedId = ''
  if (state.stepIndex > 0 && before > 0) {
    // 每档真撤回一条（带后记 / 想起的），再补写一条新的，条数正好落在 target
    const pool = state.eventfulByStep[state.stepIndex - 1] || []
    if (pool.length) {
      erasedId = pool[Math.floor(state.rnd() * pool.length)]
      eraseExperience(MEM, { id: erasedId, reason: '基准：模拟她要求撤回一条', actor: 'self' })
    }
  }
  const now = countLines(FILE)
  const delta = Math.max(0, target - now)
  const rowFd = openOut('self-experience.jsonl')
  const laterFd = openOut('later-events.jsonl')
  const sealFd = openOut('seal-events.jsonl')
  const recallFd = openOut('recall-events.jsonl')
  let rows = []
  let later = []
  let seal = []
  let recalls = []
  const eventful = new Set()
  const t0 = process.hrtime.bigint()
  try {
    for (let j = 0; j < delta; j += 1) {
      const index = state.written
      const row = makeRecord(index, state.rnd)
      state.written += 1
      rows.push(JSON.stringify(row))
      const atMs = Date.parse(row.at)
      if (state.rnd() < 0.05) {
        const at = new Date(atMs + Math.floor(state.rnd() * 25 * 24 * 3600 * 1000) + 3600 * 1000).toISOString()
        later.push(JSON.stringify({ id: row.id, at, day: dayOf(at), thought: pick(state.rnd, LATER), reason: '', feeling: [] }))
        state.later += 1
        eventful.add(row.id)
      }
      if (state.rnd() < 0.03) {
        const at = new Date(atMs + Math.floor(state.rnd() * 50 * 24 * 3600 * 1000) + 3600 * 1000).toISOString()
        seal.push(JSON.stringify({ id: row.id, at, day: dayOf(at), action: 'seal', note: pick(state.rnd, SEAL_NOTE) }))
        state.seal += 1
        eventful.add(row.id)
      }
      if (state.rnd() < 0.1) {
        const at = new Date(atMs + Math.floor(state.rnd() * 20 * 24 * 3600 * 1000) + 3600 * 1000).toISOString()
        recalls.push(JSON.stringify({ id: row.id, at, query: pick(state.rnd, QUERIES), chatKey: '' }))
        state.recall += 1
        eventful.add(row.id)
      }
      if (rows.length >= 2000 || j === delta - 1) {
        writeLines(rowFd, rows); rows = []
        writeLines(laterFd, later); later = []
        writeLines(sealFd, seal); seal = []
        writeLines(recallFd, recalls); recalls = []
      }
    }
  } finally {
    for (const fd of [rowFd, laterFd, sealFd, recallFd]) fs.closeSync(fd)
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  state.eventfulByStep[state.stepIndex] = [...eventful]
  return { before, after: countLines(FILE), delta, erasedId, generatedMs: Math.round(ms) }
}

// ---------------------------------------------------------------- 单次测量（子进程）

const REPS_LOAD = 3
// 召回一次就是"读全量 + 匹配"，大档一次近 2 秒；12 条查询 × 1 轮足够看中位/p95，别把时间全花在这
const REPS_RECALL = 1

async function child(mode, dir) {
  const exp = await import(pathToFileURL(LIB).href)
  const rss = () => Math.round(process.resourceUsage().maxRSS / 1024) // MB
  const once = Boolean(flag('once', false))
  const out = { mode }
  if (mode === 'baseline') {
    exp.badLines(path.join(dir, 'no-such-dir'))
    out.rss = rss()
    return out
  }
  if (mode === 'load') {
    const times = []
    let count = 0
    for (let i = 0; i < (once ? 1 : REPS_LOAD); i += 1) {
      const t0 = process.hrtime.bigint()
      count = exp.loadAll(dir).length
      times.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    return { ...out, times, count, rss: rss() }
  }
  if (mode === 'iterate') {
    const t0 = process.hrtime.bigint()
    let count = 0
    for await (const row of exp.iterate(dir)) if (row && row.id) count += 1
    return { ...out, ms: Number(process.hrtime.bigint() - t0) / 1e6, count, rss: rss() }
  }
  if (mode === 'page') {
    // 第一次 page 会建索引（缓存按「文件 size + mtime + asOf」认库）；后面 19 页吃缓存。
    const times = []
    let count = 0
    let after = null
    let first = null
    for (let p = 0; p < (once ? 1 : 20); p += 1) {
      const t0 = process.hrtime.bigint()
      const res = await exp.page(dir, { limit: 100, after })
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      if (p === 0) first = ms
      else times.push(ms)
      count += res.rows.length
      if (!res.hasMore) break
      after = res.next
    }
    return { ...out, firstMs: first, times, count, rss: rss() }
  }
  if (mode === 'recall') {
    const times = []
    let hits = 0
    for (let rep = 0; rep < (once ? 1 : REPS_RECALL); rep += 1) {
      for (const q of QUERIES) {
        const t0 = process.hrtime.bigint()
        hits += exp.recall(dir, q, { limit: 5 }).length
        times.push(Number(process.hrtime.bigint() - t0) / 1e6)
        if (once) break
      }
      if (once) break
    }
    return { ...out, times, hits, rss: rss() }
  }
  throw new Error('未知的测量项：' + mode)
}

function runChild(mode, dir, extra = []) {
  const r = spawnSync(process.execPath, [SELF, '--child=' + mode, '--dir=' + dir, ...extra], { encoding: 'utf8', maxBuffer: 16 << 20 })
  if (r.status !== 0) throw new Error('子进程失败（' + mode + '）：' + String(r.stderr || r.stdout || '').split('\n').slice(0, 5).join(' '))
  const lines = String(r.stdout).trim().split('\n')
  return JSON.parse(lines[lines.length - 1])
}

// ---------------------------------------------------------------- 统计

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}
const r1 = (n) => Math.round(n * 10) / 10
const r2 = (n) => Math.round(n * 100) / 100

// 写入吞吐：在每档的副本上真写 SAMPLES 次 addExperience（副本量完就删，不动主库）
function measureWrites(mem) {
  const copy = mem + '-writecopy'
  fs.rmSync(copy, { recursive: true, force: true })
  fs.cpSync(mem, copy, { recursive: true })
  const times = []
  try {
    for (let i = 0; i < SAMPLES; i += 1) {
      const t0 = process.hrtime.bigint()
      addExperience(copy, { text: '基准写入：第 ' + i + ' 条，雨点砸在窗台上。', kind: '日常' })
      times.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
  } finally {
    fs.rmSync(copy, { recursive: true, force: true })
  }
  const total = times.reduce((a, b) => a + b, 0)
  return {
    samples: times.length,
    medianMs: r2(median(times)),
    p95Ms: r2(pct(times, 95)),
    perSec: r1((times.length * 1000) / total),
    totalMs: Math.round(total)
  }
}

// 拐点：每 1 万条的边际成本（延迟 / 内存）。某一档开始明显高于"最便宜的那档"就是拐点。
function findKnee(curve) {
  const metrics = [
    { name: 'loadAll', unit: 'ms/万条', get: (c) => (c.loadAll.medianMs / c.records) * 10000 },
    { name: 'iterate', unit: 'ms/万条', get: (c) => (c.iterate.ms / c.records) * 10000 },
    { name: 'page', unit: 'ms/万条', get: (c) => (c.page.medianMs / c.records) * 10000 },
    { name: 'recall', unit: 'ms/万条', get: (c) => (c.recall.medianMs / c.records) * 10000 },
    { name: 'loadAll 内存', unit: 'MB/万条', get: (c) => (c.loadAll.deltaMB / c.records) * 10000 },
    { name: 'iterate 内存', unit: 'MB/万条', get: (c) => (c.iterate.deltaMB / c.records) * 10000 },
    { name: '写入', unit: 'ms/次', get: (c) => c.write.medianMs }
  ]
  const points = []
  let knee = null
  const reasons = []
  for (let i = 1; i < curve.length; i += 1) {
    for (const m of metrics) {
      const prev = m.get(curve[i - 1])
      const now = m.get(curve[i])
      if (!Number.isFinite(prev) || !Number.isFinite(now) || prev <= 0) continue
      const ratio = now / prev
      if (ratio >= 1.5) {
        points.push({ step: curve[i].records, metric: m.name, from: r2(prev), to: r2(now), ratio: r2(ratio), unit: m.unit })
        if (knee === null || curve[i].records < knee) knee = curve[i].records
        reasons.push(curve[i].records.toLocaleString('en-US') + ' 档 ' + m.name + ' 每' + m.unit.replace('/', '') + '成本从 ' + r2(prev) + ' 涨到 ' + r2(now) + '（×' + r2(ratio) + '）')
      }
    }
  }
  return { step: knee, note: knee === null ? '没有明显拐点：各档每万条成本基本持平（涨幅都 < 1.5 倍）' : reasons[0], reasons, points }
}

// ---------------------------------------------------------------- 主流程

async function main() {
  if (!RESUME) fs.rmSync(BASE, { recursive: true, force: true })
  fs.mkdirSync(MEM, { recursive: true })
  const state = { rnd: mulberry32(20261127), written: 0, later: 0, seal: 0, recall: 0, stepIndex: 0, eventfulByStep: [] }
  if (RESUME && fs.existsSync(FILE)) {
    // 断点续跑：把已有的行数当成已经写过的条数（生成器的下标接着走，时间仍然摊在 90 天里）
    state.written = countLines(FILE)
  }

  const base = runChild('baseline', MEM)
  const curve = []
  const startedAll = Date.now()
  for (let i = 0; i < STEPS.length; i += 1) {
    const target = STEPS[i]
    state.stepIndex = i
    const before = countLines(FILE)
    if (before > target) {
      // 续跑时这一档已经长过去了：跳过（别拿大库冒充小档）
      curve.push({ step: target, records: before, skipped: true })
      continue
    }
    const grown = growTo(target, state)
    const records = countLines(FILE)
    if (records !== target) throw new Error('第 ' + target + ' 档条数不对：' + records)
    process.stderr.write('[' + new Date().toISOString().slice(11, 19) + '] ' + target.toLocaleString('en-US') + ' 条就绪（新增 ' + grown.delta + '）\n')

    const write = { ...measureWrites(MEM), heapMB: null }
    // 计时用多次的子进程；内存峰值用**单次**的子进程（多次调用会把"GC 之前的垃圾"也记进 maxRSS）
    const load = runChild('load', MEM)
    const loadPeak = runChild('load', MEM, ['--once'])
    const iter = runChild('iterate', MEM)
    const page = runChild('page', MEM)
    const pagePeak = runChild('page', MEM, ['--once'])
    const recall = runChild('recall', MEM)
    const recallPeak = runChild('recall', MEM, ['--once'])
    const pageWarm = page.times.length ? page.times : [page.firstMs]
    const medianPage = median(pageWarm)
    curve.push({
      step: target,
      records,
      fileMB: fileMB(FILE),
      eventMB: r1(['later-events.jsonl', 'seal-events.jsonl', 'recall-events.jsonl'].reduce((n, f) => n + fileMB(path.join(MEM, f)), 0)),
      grown,
      write,
      loadAll: { medianMs: r1(median(load.times)), p99Ms: r1(pct(load.times, 99)), count: load.count, peakRssMB: loadPeak.rss, deltaMB: r1(loadPeak.rss - base.rss) },
      iterate: { ms: r1(iter.ms), count: iter.count, peakRssMB: iter.rss, deltaMB: r1(iter.rss - base.rss) },
      page: { firstMs: r1(page.firstMs), medianMs: r1(medianPage), p99Ms: r1(pct(pageWarm, 99)), pages: page.times.length + 1, count: page.count, peakRssMB: pagePeak.rss, deltaMB: r1(pagePeak.rss - base.rss) },
      recall: { medianMs: r1(median(recall.times)), p95Ms: r1(pct(recall.times, 95)), queries: recall.times.length, hits: recall.hits, peakRssMB: recallPeak.rss, deltaMB: r1(recallPeak.rss - base.rss) },
      indexRebuildMs: r1(Math.max(0, page.firstMs - medianPage))
    })
    process.stderr.write('[' + new Date().toISOString().slice(11, 19) + '] ' + target.toLocaleString('en-US') + ' 条测完\n')
  }

  const result = {
    generatedAt: new Date().toISOString(),
    dir: MEM,
    steps: STEPS,
    baselineRssMB: base.rss,
    corpus: { records: countLines(FILE), spanDays: DAYS, later: state.later, seal: state.seal, recall: state.recall, fileMB: fileMB(FILE) },
    elapsedSec: Math.round((Date.now() - startedAll) / 1000),
    curve,
    knee: findKnee(curve.filter((c) => !c.skipped))
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8')
  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const pctText = (x) => (Number.isFinite(x) ? String(x) : '—')
  console.log('')
  console.log('增长曲线（同一目录一路长上去 · 虚构语料 · 90 天 · 中文为主 · 有后记/封存/撤回）')
  console.log('目录 ' + MEM + '；基线子进程峰值 ' + base.rss + ' MB（只 import + 摸文件）；本机 Node ' + process.version)
  console.log('')
  console.log('### 延迟与吞吐')
  console.log('')
  console.log('| 档 | 条数 | 文件 | 写入中位/p95 | 写入/秒 | loadAll | iterate | page 中位/p99 | 索引重建 | recall 中位/p95 |')
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const c of curve) {
    if (c.skipped) { console.log('| ' + c.step.toLocaleString('en-US') + ' | — | 跳过（续跑时目录已经更大） | | | | | | | |'); continue }
    console.log('| ' + c.step.toLocaleString('en-US') + ' | ' + c.records.toLocaleString('en-US') + ' | ' + c.fileMB + ' MB | ' +
      c.write.medianMs + ' / ' + c.write.p95Ms + ' ms | ' + c.write.perSec + ' | ' +
      c.loadAll.medianMs + ' ms | ' + c.iterate.ms + ' ms | ' + c.page.medianMs + ' / ' + c.page.p99Ms + ' ms | ' +
      c.indexRebuildMs + ' ms | ' + c.recall.medianMs + ' / ' + pctText(c.recall.p95Ms) + ' ms |')
  }
  console.log('')
  console.log('### 内存（子进程峰值 RSS，已减掉基线）')
  console.log('')
  console.log('| 档 | 条数 | loadAll 峰值 | 比基线多 | iterate 峰值 | 比基线多 | page 峰值 | recall 峰值 | 每万条 loadAll 内存 |')
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const c of curve) {
    if (c.skipped) continue
    console.log('| ' + c.step.toLocaleString('en-US') + ' | ' + c.records.toLocaleString('en-US') + ' | ' +
      c.loadAll.peakRssMB + ' MB | +' + c.loadAll.deltaMB + ' MB | ' + c.iterate.peakRssMB + ' MB | +' + c.iterate.deltaMB + ' MB | ' +
      c.page.peakRssMB + ' MB | ' + c.recall.peakRssMB + ' MB | ' + r1((c.loadAll.deltaMB / c.records) * 10000) + ' MB |')
  }
  console.log('')
  console.log('### 拐点')
  console.log('')
  console.log(result.knee.step === null
    ? '没有明显拐点（' + result.knee.note + '）。'
    : '第一处明显变慢/变贵的是 **' + result.knee.step.toLocaleString('en-US') + ' 条** 那一档：' + result.knee.note)
  if (result.knee.points.length) {
    console.log('')
    console.log('逐步涨幅 ≥1.5 倍的项：')
    for (const p of result.knee.points) console.log('- ' + p.step.toLocaleString('en-US') + ' 档 · ' + p.metric + '：' + p.from + ' → ' + p.to + ' ' + p.unit + '（×' + p.ratio + '）')
  }
  console.log('')
  console.log('总耗时 ' + result.elapsedSec + ' 秒；语料：记录 ' + result.corpus.records.toLocaleString('en-US') + ' · 后记 ' +
    result.corpus.later + ' · 封存 ' + result.corpus.seal + ' · 想起 ' + result.corpus.recall + '（每档另外撤回 1 条，真走 eraseExperience）')
}

if (flag('child', '')) {
  const mode = String(flag('child', ''))
  const dir = String(flag('dir', MEM))
  child(mode, dir).then((out) => process.stdout.write(JSON.stringify(out) + '\n')).catch((e) => {
    console.error(e && e.stack ? e.stack : e)
    process.exit(1)
  })
} else {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e)
    process.exit(1)
  })
}