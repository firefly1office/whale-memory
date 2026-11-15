import test from 'node:test'
import assert from 'node:assert/strict'
import * as ep from '../packages/core/lib/evidence-policy.js'

const F = [
  { id: 'f1', subject: 'her', slot: 'mood', value: '闷', at: '2026-11-10T10:00:00+08:00', source: '日记' },
  { id: 'f2', subject: 'her', slot: 'mood', value: '缓过来了', at: '2026-11-12T10:00:00+08:00', supersedes: 'f1', source: '日记' },
  { id: 'f3', subject: 'owner', slot: 'trip', value: '周末去外地', at: '2026-11-11T10:00:00+08:00', source: '他说' }
]

test('证据：as-of 之前只看得到当时成立的记录', () => {
  const before = ep.query(F, { subject: 'her', slot: 'mood', at: '2026-11-11T00:00:00+08:00' })
  assert.equal(before.status, 'known')
  assert.equal(before.value, '闷')
  assert.equal(before.evidence.length, 1)
})

test('证据：有后续记录时给出新值，并保留旧值在证据链里', () => {
  const after = ep.query(F, { subject: 'her', slot: 'mood', at: '2026-11-13T00:00:00+08:00' })
  assert.equal(after.status, 'known')
  assert.equal(after.value, '缓过来了')
  assert.deepEqual(after.evidence.map((f) => f.id), ['f1', 'f2'])
  assert.match(after.reason, /后续/)
})

test('证据：没有记录就说不知道，不推断', () => {
  const none = ep.query(F, { subject: 'her', slot: 'dream', at: '2026-11-13T00:00:00+08:00' })
  assert.equal(none.status, 'unknown')
  assert.match(none.reason, /没有记录/)
  assert.deepEqual(none.evidence, [])
})

test('证据：as-of 早于所有记录，也是不知道', () => {
  const early = ep.query(F, { subject: 'her', slot: 'mood', at: '2026-11-01T00:00:00+08:00' })
  assert.equal(early.status, 'unknown')
})

test('证据：当前有效值排除被取代的旧值', () => {
  const cur = ep.currentFact(F, { subject: 'her', slot: 'mood', at: '2026-11-13T00:00:00+08:00' })
  assert.equal(cur.id, 'f2')
})

test('证据：后继缺席如实报告', () => {
  const s1 = ep.hasSuccessor(F, 'f2', '2026-11-13T00:00:00+08:00')
  assert.equal(s1.ok, true)
  assert.equal(s1.hasSuccessor, false)

  const s2 = ep.hasSuccessor(F, 'f1', '2026-11-13T00:00:00+08:00')
  assert.equal(s2.hasSuccessor, true)
  assert.equal(s2.successors[0].id, 'f2')
})

test('证据：渲染成人话，不知道就说不知道', () => {
  const known = ep.query(F, { subject: 'owner', slot: 'trip', at: '2026-11-13T00:00:00+08:00' })
  assert.match(ep.render(known), /周末去外地 · 2026-11-11/)

  const unknown = ep.query(F, { subject: 'owner', slot: 'salary', at: '2026-11-13T00:00:00+08:00' })
  assert.match(ep.render(unknown), /没有记录/)
})

test('证据：坏输入不猜', () => {
  assert.equal(ep.query(F, { subject: 'her', slot: 'mood', at: '不是时间' }).status, 'unknown')
  assert.deepEqual(ep.asOf(F, '不是时间'), [])
  assert.equal(ep.currentFact([], { subject: 'x' }), null)
})