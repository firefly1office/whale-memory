import assert from 'node:assert/strict'
import test from 'node:test'
import { score } from '../examples/emotion-bridge/next-day/score.mjs'

const forced = { kind: 'forced_choice', kept: 'thought', sacrificed: 'unfinished' }
const none = { kind: 'none', kept: null, sacrificed: null }
const cases = [{ id: 'toy', expect: { a: forced, b: { kind: 'unclear' }, control: { kind: 'none' } } }]
const attempt = (condition, tradeoff, status = 'reflected') => ({ case: 'toy', condition, status, appraisal: { tradeoff } })
const run = (...results) => score(cases, { results })

test('零次无可估区间；全对时给单侧精确下界，对照零误报给上界', () => {
  assert.deepEqual(run().forced, { trials: 0, correct: 0, accuracy: null, lower95: null })
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
  assert.deepEqual(report.none, { trials: 2, valid: 1, falsePositives: 1, upper95: 1 })
  assert.equal(report.failures.rate, 2/9)
})
test('无结构回答记失效，提供方错误另列，未知题号显式报错', () => {
  const report = run(attempt('a', {}), attempt('control', null, 'provider-error'))
  assert.equal(report.failures.count, 1)
  assert.equal(report.none.upper95, null)
  assert.equal(report.failures.totalWithoutAppraisal, 2)
  assert.throws(() => run({ case: 'missing', condition: 'a' }))
})
