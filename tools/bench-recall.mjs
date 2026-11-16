#!/usr/bin/env node
// 召回性能基准：热身之后取中位数，样本形状写死在下面
// 用法：node tools/bench-recall.mjs [--n 10000] [--runs 5]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from '../packages/core/lib/self-experience.js'

const arg = (name, fallback) => {
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='))
  if (eq) return eq.slice(name.length + 3)
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const N = Number(arg('n', '10000'))
const RUNS = Number(arg('runs', '5'))
const WARMUP = 3
const QUERY = '守灯人为什么没睡'

// 样本形状：每条 30~50 字正文 + 一句想法，部分带原文锚；每 10 条一条后记
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bench-'))
const lines = []
for (let i = 0; i < N; i++) {
  lines.push(JSON.stringify({
    id: 'exp_bench_' + i,
    at: new Date(Date.UTC(2026, 0, 1 + (i % 300), 10, 0, 0)).toISOString(),
    day: '2026-01-01',
    weight: i % 7 === 0 ? 'important' : 'normal',
    kind: '其它',
    then: {
      text: '第 ' + i + ' 条：夜里翻完灯塔那一章，守灯人整晚没睡，海面一直没有船',
      thought: i % 3 === 0 ? '她是在等人' : '可能是风向不对',
      feeling: i % 5 === 0 ? ['闷'] : [],
      unfinished: '',
      quote: i % 4 === 0 ? { text: '潮汐终会归来', source: '《灯塔》' } : null,
      state: null
    },
    later: []
  }))
}
fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), lines.join('\n') + '\n')

const time = (fn) => {
  const t = performance.now()
  fn()
  return performance.now() - t
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

for (let i = 0; i < WARMUP; i++) { exp.loadAll(dir); exp.recall(dir, QUERY, { limit: 3 }) }
const loads = []
const recalls = []
for (let i = 0; i < RUNS; i++) {
  loads.push(time(() => exp.loadAll(dir)))
  recalls.push(time(() => exp.recall(dir, QUERY, { limit: 3 })))
}

console.log(JSON.stringify({
  n: N,
  runs: RUNS,
  warmup: WARMUP,
  query: QUERY,
  sample: '30~50 字正文 + 一句想法，1/4 带原文锚，1/7 important',
  platform: process.platform + '/' + process.arch,
  node: process.version,
  loadAllMsMedian: Number(median(loads).toFixed(1)),
  recallMsMedian: Number(median(recalls).toFixed(1))
}, null, 2))
fs.rmSync(dir, { recursive: true, force: true })