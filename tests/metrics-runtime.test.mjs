// 运行时指标：只数数字，不记内容；开销要小到可以随手调。
import test from 'node:test'
import assert from 'node:assert/strict'
import { metrics, snapshot, recordWrite, recordRecall, recordBadLines, reset, VERSION } from '../packages/core/lib/metrics.js'

test('指标：写入 / 召回的计数与延迟累加都对', () => {
  reset()
  recordWrite({ ms: 10 })
  recordWrite({ ms: 30 })
  recordWrite({ ms: 20 })
  recordRecall({ ms: 5, hits: 2, backend: 'file' })
  recordRecall({ ms: 7, hits: 1, backend: 'file' })
  recordRecall({ ms: 15, hits: 2, backend: 'sqlite' })
  recordBadLines(0)
  recordBadLines(3)
  recordBadLines(1)

  const snap = snapshot()
  assert.equal(snap.version, VERSION)
  assert.equal(snap.writes.count, 3, '写入次数')
  assert.equal(snap.writes.msTotal, 60, '写入延迟总和')
  assert.equal(snap.writes.msMax, 30, '写入延迟最大值')
  assert.equal(snap.writes.msLast, 20, '最近一次写入延迟')
  assert.equal(snap.writes.msAvg, 20, '写入延迟均值')

  assert.equal(snap.recalls.count, 3, '召回次数')
  assert.equal(snap.recalls.hits, 5, '召回条数总和')
  assert.equal(snap.recalls.msTotal, 27, '召回延迟总和')
  assert.equal(snap.recalls.msMax, 15, '召回延迟最大值')
  assert.equal(snap.recalls.msLast, 15, '最近一次召回延迟')
  assert.equal(snap.recalls.msAvg, 9, '召回延迟均值')
  assert.deepEqual(snap.recalls.backends, { file: 2, sqlite: 1, other: 0 }, '后端类型计数')
  assert.equal(snap.recalls.lastBackend, 'sqlite', '最近一次用的后端')

  assert.equal(snap.badLines.last, 1, '最近一次坏行数')
  assert.equal(snap.badLines.max, 3, '坏行数最大值')
  assert.equal(snap.badLines.observations, 3, '坏行观测次数')
})

test('指标：snapshot() 是纯对象，JSON 往返后完全一致', () => {
  reset()
  recordWrite({ ms: 1.5 })
  recordRecall({ ms: 2.5, hits: 1, backend: 'sqlite' })
  recordBadLines(0)
  const snap = snapshot()

  // 纯对象：没有 Map / Set / Date / 函数，能直接落盘
  assert.equal(JSON.stringify(snap).includes('undefined'), false, '没有 undefined 字段')
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, 'JSON 往返后一模一样')

  // 时间用 ISO 字符串，宿主拿到就能写进日志
  assert.equal(Number.isNaN(Date.parse(snap.since)), false, 'since 是可解析的时间')
  assert.equal(Number.isNaN(Date.parse(snap.at)), false, 'at 是可解析的时间')

  // 字段就是这些：多出来的字段只可能是误存的内容，所以这里把清单钉死
  assert.deepEqual(Object.keys(snap).sort(), ['at', 'badLines', 'recalls', 'since', 'version', 'writes'], '顶层字段')
})

test('指标：快照里不含任何正文 / 查询串 / id', () => {
  reset()
  // 就算调用方图省事，把整条记录一起递进来，也只该取走数字
  recordWrite({ ms: 2, text: '我把灯塔那件事写下来了', id: 'exp_abc123', thought: '悄悄想的' })
  recordRecall({ ms: 1, hits: 1, backend: 'exp_secret_1', query: '围巾是什么颜色', text: '她问我围巾' })
  recordBadLines(1)
  const snap = snapshot()
  const json = JSON.stringify(snap)

  for (const secret of ['灯塔', '围巾', '悄悄想的', 'exp_abc123', 'exp_secret_1', 'query', 'text']) {
    assert.equal(json.includes(secret), false, '快照里不该出现「' + secret + '」')
  }
  // backend 只留固定枚举：传进来像 id 的字符串也只记成 other
  assert.equal(snap.recalls.lastBackend, 'other', '认不出的后端记成 other')
  assert.deepEqual(snap.recalls.backends, { file: 0, sqlite: 0, other: 1 }, '后端计数只落在三个固定桶里')

  // 递归看键名：不许出现 text / query / id 这类字段
  const keys = []
  const walk = (v) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    if (!v || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x) }
  }
  walk(snap)
  assert.deepEqual(keys.filter((k) => /^(text|query|id)$/i.test(k)), [], '快照字段里没有正文类键名')
})

test('指标：reset() 清回零，之后重新累加', () => {
  reset()
  recordWrite({ ms: 4 })
  recordRecall({ ms: 4, hits: 3, backend: 'file' })
  recordBadLines(2)
  reset()

  const zero = snapshot()
  assert.equal(zero.writes.count, 0)
  assert.equal(zero.writes.msTotal, 0)
  assert.equal(zero.writes.msAvg, 0, '没有观测时均值是 0，不是 NaN')
  assert.equal(zero.recalls.count, 0)
  assert.equal(zero.recalls.hits, 0)
  assert.equal(zero.recalls.lastBackend, '')
  assert.deepEqual(zero.recalls.backends, { file: 0, sqlite: 0, other: 0 })
  assert.deepEqual(zero.badLines, { last: 0, max: 0, observations: 0 })
  assert.equal(Number.isNaN(Date.parse(zero.since)), false, 'reset 后重新起算')

  recordWrite({ ms: 1 })
  assert.equal(snapshot().writes.count, 1, 'reset 之后还能继续记')
})

// 实测开销（这台机器，Node v24）：单次 observe 约 15–60 ns，和一次函数调用同量级。
// 断言只卡一个很宽的上限：慢到微秒级说明有人在观测路径里分配对象或取时间。
test('指标：一次观测是纳秒级开销，不分配大对象、不取时间', (t) => {
  reset()
  const N = 100000
  const write = { ms: 1.25 }
  const recall = { ms: 0.5, hits: 1, backend: 'file' }

  // 预热：先让 JIT 把这两个函数编出来，免得把解释执行算进开销
  for (let i = 0; i < 1000; i += 1) {
    recordWrite(write)
    recordRecall(recall)
  }

  const calls = N * 2
  const start = process.hrtime.bigint()
  for (let i = 0; i < N; i += 1) {
    recordWrite(write)
    recordRecall(recall)
  }
  const perCall = Number(process.hrtime.bigint() - start) / calls
  t.diagnostic('单次观测约 ' + perCall.toFixed(1) + ' ns（' + calls + ' 次调用，含循环本身）')

  assert.ok(perCall < 2000, '单次观测不该慢于 2 微秒；实测 ' + perCall.toFixed(1) + ' ns')
  const snap = snapshot()
  assert.equal(snap.writes.count, 1000 + N, '十万次写入一次没漏')
  assert.equal(snap.recalls.count, 1000 + N, '十万次召回一次没漏')

  // 单例：metrics 上的方法和具名导出是同一份状态
  metrics.recordWrite({ ms: 3 })
  assert.equal(snapshot().writes.count, 1001 + N, 'metrics.recordWrite 和 recordWrite 共用单例')
})