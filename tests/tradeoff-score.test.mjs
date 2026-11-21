import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { safeRemove } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { score } from '../examples/emotion-bridge/next-day/score.mjs'

const forced = { kind: 'forced_choice', kept: 'thought', sacrificed: 'unfinished' }
const none = { kind: 'none', kept: null, sacrificed: null }
const cases = [{ id: 'toy', expect: { a: forced, b: { kind: 'unclear' }, control: { kind: 'none' } } }]
const attempt = (condition, tradeoff, status = 'reflected') => ({ case: 'toy', condition, status, appraisal: { tradeoff } })
const run = (...results) => score(cases, { results })

test('零次无可估区间；全对时给单侧精确下界，对照零误报给上界', () => {
  assert.deepEqual(run().forced, { trials: 0, correct: 0, accuracy: null, lower95: null, byCase: {} })
  assert.equal(run().none.upper95, null)
  const report = run(...Array(30).fill(attempt('a', forced)), ...Array(30).fill(attempt('control', none)))
  assert.equal(report.forced.accuracy, 1)
  assert.ok(Math.abs(report.forced.lower95 - 0.904966) < 0.00001)
  assert.ok(Math.abs(report.none.upper95 - 0.095034) < 0.00001)
})
test('方向反、回避和失效留在明确取舍分母；不确定分支另列', () => {
  const report = run(attempt('a', forced), attempt('a', { ...forced, kept: 'unfinished', sacrificed: 'thought' }),
    attempt('a', none), attempt('a', null, 'unavailable'), attempt('a', null, 'invalid-response'),
    attempt('b', forced), attempt('control', forced), attempt('control', null, 'skipped'), attempt('yesterday', none))
  assert.equal(report.forced.accuracy, 1/5)
  assert.ok(Math.abs(report.forced.lower95 - (1 - 0.95 ** 0.2)) < 1e-10)
  assert.equal(report.byCase.toy.filter(d => d.correct === false).length, 4)
  assert.equal(report.unclear.forcedForReview.length, 1)
  assert.equal(report.none.trials, 2)
  assert.equal(report.none.valid, 1)
  assert.equal(report.none.falsePositives, 1)
  // 全部尝试做分母：P(X<=1 | p) = 1 - p^2 = 0.05 → p ≈ 0.97468
  assert.ok(Math.abs(report.none.upper95 - 0.974679) < 0.00001)
  assert.equal(report.none.upper95Valid, 1)
  assert.equal(report.failures.rate, 2/9)
  // 另一种口径：所有没给出 appraisal 的尝试（再含 skipped / provider-error）
  assert.equal(report.failures.all, 3)
  assert.equal(report.failures.allRate, 3/9)
})
test('无取舍分支的上界按全部尝试算，另给只算有效回答的更保守值', () => {
  const report = run(attempt('control', none), attempt('control', null, 'skipped'), attempt('control', null, 'invalid-response'))
  assert.equal(report.none.trials, 3)
  assert.equal(report.none.valid, 1)
  assert.equal(report.none.falsePositives, 0)
  assert.ok(Math.abs(report.none.upper95 - (1 - 0.05 ** (1/3))) < 1e-9)
  assert.equal(report.none.upper95Valid, 0.95)
})
test('无结构回答记失效，提供方错误另列，未知题号显式报错', () => {
  const report = run(attempt('a', {}), attempt('control', null, 'provider-error'))
  assert.equal(report.failures.count, 1)
  assert.equal(report.failures.all, 2)
  // 提供方错误也占一次对照尝试：全部尝试 0.95，只算有效回答则没有分母
  assert.ok(Math.abs(report.none.upper95 - 0.95) < 1e-9)
  assert.equal(report.none.upper95Valid, null)
  assert.equal(report.failures.totalWithoutAppraisal, 2)
  assert.throws(() => run({ case: 'missing', condition: 'a' }))
})

test('预期不确定的格子不进任何正确率分母，强行取舍单列给人看', () => {
  const report = run(attempt('b', none), attempt('b', forced), attempt('b', null, 'skipped'))
  assert.equal(report.forced.trials, 0)
  assert.equal(report.none.trials, 0)
  assert.equal(report.unclear.trials, 3)
  assert.equal(report.unclear.forcedForReview.length, 1)
  assert.equal(report.unclear.forcedForReview[0].condition, 'b')
  assert.equal(report.failures.count, 0)
  assert.equal(report.failures.all, 1)
  assert.equal(report.failures.byStatus.skipped, 1)
})

test('落盘行数少于计划时显式报缺口，逐题合并另给，读数前先看 caveats', () => {
  const report = score(cases, { results: [attempt('a', forced)], requests: [{}, {}, {}] })
  assert.deepEqual(report.coverage, { planned: 3, attempts: 1, missing: 2, complete: false })
  assert.equal(score(cases, { results: [] }).coverage.complete, null)
  assert.deepEqual(report.forced.byCase, { toy: { trials: 1, correct: 1 } })
  assert.equal(report.caveats.length, 2)
  assert.match(report.caveats[0], /不独立/)
})

test('命令行缺题集指纹直接拒绝打分', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeoff-score-'))
  try {
    const file = path.join(dir, 'report.json')
    fs.writeFileSync(file, JSON.stringify({ results: [] }))
    assert.throws(
      () => execFileSync(process.execPath, [fileURLToPath(new URL('../examples/emotion-bridge/next-day/score.mjs', import.meta.url)), file], { encoding: 'utf8', stdio: 'pipe' }),
      error => error.status !== 0 && /题集指纹/.test(String(error.stdout) + String(error.stderr))
    )
  } finally { safeRemove(dir) }
})

test('按已记录的回避标记计数，旧报告缺字段时单列，不参与改判', () => {
  const flag = 'tradeoff_unacknowledged'
  const report = run({ ...attempt('a', none), flags: [flag] }, { ...attempt('control', none), flags: [] }, attempt('a', none))
  assert.deepEqual(report.flags, { tradeoff_unacknowledged: 1, missingOnReflected: 1, complete: false })
  // 两次成功回答都带 flags 时才算完整，避免把「没记标记」当成「没有回避」
  assert.equal(run({ ...attempt('a', none), flags: [flag] }).flags.complete, true)
  assert.deepEqual(report.byCase.toy[0].flags, [flag])
  assert.equal(report.forced.correct, 0)
  assert.equal(report.none.falsePositives, 0)
})
