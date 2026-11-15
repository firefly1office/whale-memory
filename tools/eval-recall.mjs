#!/usr/bin/env node
// 召回小评测：命中率 + 空查询是否真的返回空（防编造的第一道闸）
// 用法：node tools/eval-recall.mjs [--json]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/recall-cases.json'), 'utf8'))
const asJson = process.argv.includes('--json')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-eval-'))
const rows = {}
for (const e of fixture.experiences) {
  rows[e.id] = exp.addExperience(dir, { text: e.text, thought: e.thought, day: e.day })
}

let hits = 0
let emptyCorrect = 0
let emptyTotal = 0
const details = []

for (const c of fixture.cases) {
  const found = exp.recall(dir, c.query, { limit: 2 })
  if (c.expect === 'empty') {
    emptyTotal++
    const ok = found.length === 0
    if (ok) emptyCorrect++
    details.push({ query: c.query, expect: 'empty', got: found.map(f => f.id), pass: ok })
  } else {
    const ok = found.length > 0 && found[0].id === rows[c.expect].id
    if (ok) hits++
    details.push({ query: c.query, expect: c.expect, got: found.map(f => f.id), pass: ok })
  }
}

fs.rmSync(dir, { recursive: true, force: true })

const total = fixture.cases.length
const positivesTotal = total - emptyTotal
const pass = details.filter((d) => d.pass).length
const summary = {
  cases: total,
  pass,
  positives: positivesTotal,
  top1Accuracy: Number((hits / Math.max(1, positivesTotal)).toFixed(3)),
  emptyAccuracy: Number((emptyCorrect / Math.max(1, emptyTotal)).toFixed(3)),
  details
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  for (const d of details) {
    console.log(`${d.pass ? 'ok  ' : 'FAIL'}  ${d.query}  →  ${d.got.join(', ') || '(空)'}`)
  }
  console.log(`\n用例 ${summary.cases} · 通过 ${summary.pass} · 首位命中率 ${summary.top1Accuracy} · 空查询正确率 ${summary.emptyAccuracy}`)
}

// 任何一条用例不过，CI 就该红；准确率只作信息展示
const ok = pass === total
process.exit(ok ? 0 : 1)