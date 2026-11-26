// 运行时指标：给宿主定期落盘用的几个数字，不记内容。
//
// 只存数字和固定枚举（backend 只有 file / sqlite / other 三种取值）。
// 这里**永远不写正文、查询串、经历 id**：指标常被写进日志、监控、落盘文件，
// 漏一条正文进去，等于把她的记忆抄了一份到别处。要证明这一点，见
// tests/metrics-runtime.test.mjs：那组用例会把整份快照序列化后逐字检查。
//
// 开销：一次 record* 就是给几个数字加一次，不分配对象、不取时间（耗时由调用方量好传进来）；
// 只有 snapshot() 取一次 Date.now() 并拼出纯对象。时间源只用 Date.now()。
//
// 单例：进程内一份（模块级状态）。宿主 fork 出去的子进程各算各的，不跨进程汇总。
// 叶子模块：不 import 任何其它模块，免得和 self-experience.js 之类形成循环依赖。

export const VERSION = 1

// 起算时刻：snapshot 里的 since 用它，reset() 时重设
let startedAt = Date.now()

// 一块扁平的数字：观测路径只做 s.x += 1 这种原地加法，不建临时对象
const s = {
  writes: 0, writeMs: 0, writeMax: 0, writeLast: 0,
  recalls: 0, recallMs: 0, recallMax: 0, recallLast: 0, hits: 0,
  file: 0, sqlite: 0, other: 0, lastBackend: '',
  badLast: 0, badMax: 0, badObservations: 0
}

// 毫秒数：非有限值、负数一律当 0（观测错不能把汇总算成 NaN，落盘就废了）
function duration(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function count(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 记一次写入：{ ms } 是这次写入的耗时（毫秒）。 */
export function recordWrite({ ms } = {}) {
  const d = duration(ms)
  s.writes += 1
  s.writeMs += d
  s.writeLast = d
  if (d > s.writeMax) s.writeMax = d
}

/** 记一次召回：{ ms, hits, backend }。hits 是这次返回的条数，backend 只认 file / sqlite。 */
export function recordRecall({ ms, hits, backend } = {}) {
  const d = duration(ms)
  s.recalls += 1
  s.recallMs += d
  s.recallLast = d
  if (d > s.recallMax) s.recallMax = d
  s.hits += count(hits)
  // backend 必须是固定枚举：宿主传进来一个像 id 的字符串，也只落成 'other'
  if (backend === 'file') { s.file += 1; s.lastBackend = 'file' }
  else if (backend === 'sqlite') { s.sqlite += 1; s.lastBackend = 'sqlite' }
  else { s.other += 1; s.lastBackend = 'other' }
}

/** 记一次坏行观测：n 是此刻 badLines / 各类事件读出来的坏行数（0 = 这次没有坏行）。 */
export function recordBadLines(n) {
  const bad = count(n)
  s.badLast = bad
  s.badObservations += 1
  if (bad > s.badMax) s.badMax = bad
}

const round3 = (n) => Math.round(n * 1000) / 1000
const avg = (total, n) => (n ? round3(total / n) : 0)

/**
 * 当前快照：纯对象（数字 + ISO 字符串），可以直接 JSON.stringify 落盘。
 * 每次返回新对象，调用方改它不会影响内部计数。
 */
export function snapshot() {
  return {
    version: VERSION,
    since: new Date(startedAt).toISOString(),
    at: new Date().toISOString(),
    writes: {
      count: s.writes,
      msTotal: round3(s.writeMs),
      msMax: round3(s.writeMax),
      msLast: round3(s.writeLast),
      msAvg: avg(s.writeMs, s.writes)
    },
    recalls: {
      count: s.recalls,
      hits: s.hits,
      msTotal: round3(s.recallMs),
      msMax: round3(s.recallMax),
      msLast: round3(s.recallLast),
      msAvg: avg(s.recallMs, s.recalls),
      lastBackend: s.lastBackend,
      backends: { file: s.file, sqlite: s.sqlite, other: s.other }
    },
    badLines: {
      last: s.badLast,
      max: s.badMax,
      observations: s.badObservations
    }
  }
}

/** 清回刚启动的样子（测试用；宿主换会话时可以调）。 */
export function reset() {
  s.writes = 0; s.writeMs = 0; s.writeMax = 0; s.writeLast = 0
  s.recalls = 0; s.recallMs = 0; s.recallMax = 0; s.recallLast = 0; s.hits = 0
  s.file = 0; s.sqlite = 0; s.other = 0; s.lastBackend = ''
  s.badLast = 0; s.badMax = 0; s.badObservations = 0
  startedAt = Date.now()
}

/** 进程内单例：`metrics.recordWrite(...)` 和单独 import 的函数是同一份状态。 */
export const metrics = Object.freeze({ recordWrite, recordRecall, recordBadLines, snapshot, reset, VERSION })