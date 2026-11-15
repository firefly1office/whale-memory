import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeMetrics } from '../tools/metrics.mjs'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-metrics-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const mem = path.join(dir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(path.join(mem, 'prompt-overlay'), { recursive: true })

  const rows = [
    { day: '2026-11-10', weight: 'important', kind: '读书', then: { text: '灯塔', quote: { text: '灯还亮着' }, unfinished: '想知道结尾' }, later: [{ thought: '后来懂了' }], recalls: 2 },
    { day: '2026-11-11', weight: 'normal', kind: '想事', then: { text: '折纸' }, later: [], recalls: 0 },
    { day: '2026-11-12', weight: 'minor', kind: '其它', then: { text: '码头' }, later: [], recalls: 1 }
  ]
  fs.writeFileSync(path.join(mem, 'self-experience.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  fs.writeFileSync(path.join(mem, 'autobiography.jsonl'), JSON.stringify({ day: '2026-11-10', event: '下雨' }) + '\n', 'utf8')
  fs.writeFileSync(path.join(mem, 'prompt-overlay', 'history.jsonl'), JSON.stringify({ at: '2026-11-11T00:00:00Z', snapshot: 'v1' }) + '\n', 'utf8')
  fs.writeFileSync(path.join(mem, 'self-settings.json'), JSON.stringify({ updatedAt: '2026-11-11T01:00:00Z' }), 'utf8')
  return dir
}

test('指标：改主意率、想起率、原文锚都算得对', (t) => {
  const dir = fixture(t)
  const m = computeMetrics(dir)

  assert.equal(m.experiences.total, 3)
  assert.equal(m.experiences.revised, 1)
  assert.equal(m.experiences.revisedRate, 33.3)
  assert.equal(m.experiences.recalled, 2)
  assert.equal(m.experiences.totalRecalls, 3)
  assert.equal(m.experiences.unfinished, 1)
  assert.equal(m.experiences.quoted, 1)
  assert.deepEqual(m.experiences.byWeight, { important: 1, normal: 1, minor: 1 })
  assert.equal(m.diaries.total, 1)
  assert.equal(m.prompt.versions, 1)
  assert.equal(m.settings.lastChangedAt, '2026-11-11T01:00:00Z')
  assert.match(m.caveat, /不是召回准确率/)
})

test('指标：坏行计数不爆炸', (t) => {
  const dir = fixture(t)
  const file = path.join(dir, 'plugin-data', 'biomimetic-memory', 'self-experience.jsonl')
  fs.appendFileSync(file, '{"broken":\n', 'utf8')
  const m = computeMetrics(dir)
  assert.equal(m.integrity.badExperienceLines, 1)
  assert.equal(m.experiences.total, 3)
})