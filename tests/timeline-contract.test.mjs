// 事实时间线契约的离线验收：不碰存储，只验纯函数。
import assert from 'node:assert/strict'
import test from 'node:test'
import { applySuccession, nextFactVersion, planChainVersions, stampSuccession, validateLineage } from '../packages/core/lib/fact-timeline-contract.js'

const H = 3600 * 1000
const T0 = Date.UTC(2026, 10, 19, 2, 0, 0)

test('序号：没有前驱从 1 开始，有前驱就加一', () => {
  assert.equal(nextFactVersion(null), 1)
  assert.equal(nextFactVersion({}), 1)
  assert.equal(nextFactVersion({ version: 0 }), 1)
  assert.equal(nextFactVersion({ version: 3 }), 4)
  // 前驱序号脏了也不猜，回到 1
  assert.equal(nextFactVersion({ version: 'x' }), 1)
})

test('取代：两边各补什么，不碰值轴', () => {
  const before = { id: 'a', factVersionAt: T0, validFrom: T0 }
  const after = { id: 'b', factVersionAt: T0 + 5 * H }
  const patch = stampSuccession(before, after, { reason: 'correction' })
  assert.equal(patch.before.supersededById, 'b')
  assert.equal(patch.before.invalidatedAt, T0 + 5 * H)
  assert.equal(patch.before.supersedeReason, 'correction')
  assert.equal(patch.after.revisionOf, 'a')
  assert.equal(patch.after.version, 2)
  // 值轴不许被编出来
  assert.equal(patch.after.validFrom, undefined)
  assert.equal(patch.after.validUntil, undefined)
})

test('取代：原因非法时保守记 unknown，不丢信息也不编造', () => {
  const patch = stampSuccession({ id: 'a', version: 2 }, { id: 'b' }, { reason: 'because' })
  assert.equal(patch.before.supersedeReason, 'unknown')
  assert.equal(patch.after.version, 3)
})

test('取代：同一条记录不能取代自己', () => {
  assert.throws(() => stampSuccession({ id: 'a' }, { id: 'a' }), /不同的记录/)
})

test('就地应用：链校验通过', () => {
  const before = { id: 'a', factVersionAt: T0, lineageId: 'L1' }
  const after = { id: 'b', factVersionAt: T0 + H, lineageId: 'L1' }
  applySuccession(before, after, { reason: 'update' })
  assert.deepEqual(validateLineage([before, after]), [])
})

test('校验：缺号 / 重复号 / 语义问题都能报出来', () => {
  const rows = [
    { id: 'a', version: 1, supersededById: 'c', invalidatedAt: T0 + H },
    { id: 'c', version: 3, revisionOf: 'a', factVersionAt: T0 + H }
  ]
  const issues = validateLineage(rows)
  assert.ok(issues.some((i) => i.code === 'I1' && /缺少 version 2/.test(i.message)))
  assert.ok(!issues.some((i) => /version 3/.test(i.message)), 'version 3 本身合法，不该报')
})

test('校验：invalidatedAt 与后继起点对不上要报', () => {
  const rows = [
    { id: 'a', version: 1, supersededById: 'b', invalidatedAt: T0 },
    { id: 'b', version: 2, revisionOf: 'a', factVersionAt: T0 + 7 * H }
  ]
  const issues = validateLineage(rows)
  assert.ok(issues.some((i) => i.code === 'I2' && /不一致/.test(i.message)))
})

test('校验：有后继却没写 invalidatedAt 要报', () => {
  const rows = [
    { id: 'a', version: 1, supersededById: 'b' },
    { id: 'b', version: 2, revisionOf: 'a', factVersionAt: T0 }
  ]
  const issues = validateLineage(rows)
  assert.ok(issues.some((i) => i.code === 'I2' && /缺 invalidatedAt/.test(i.message)))
})

test('校验：写了 invalidatedAt 却没有后继要报', () => {
  const issues = validateLineage([{ id: 'a', version: 1, invalidatedAt: T0 }])
  assert.ok(issues.some((i) => i.code === 'I2' && /没有后继/.test(i.message)))
})

test('校验：指向链外、原因非法、重复 id 都要报', () => {
  const rows = [
    { id: 'a', version: 1, supersededById: 'zzz', supersedeReason: 'whatever' },
    { id: 'a', version: 2 }
  ]
  const issues = validateLineage(rows)
  assert.ok(issues.some((i) => i.code === 'I3' && /链外/.test(i.message)))
  assert.ok(issues.some((i) => i.code === 'I4' && /非法/.test(i.message)))
  assert.ok(issues.some((i) => i.code === 'I0' && /重复 id/.test(i.message)))
})

test('校验：空链不报错', () => {
  assert.deepEqual(validateLineage([]), [])
  assert.deepEqual(validateLineage(null), [])
})
test('迁移规划：指针链能排出序号，并补知轴终点', () => {
  const rows = [
    { id: 'a', lineageId: 'L', factVersionAt: T0, supersededById: 'b' },
    { id: 'b', lineageId: 'L', factVersionAt: T0 + H, revisionOf: 'a', supersededById: 'c' },
    { id: 'c', lineageId: 'L', factVersionAt: T0 + 2 * H, revisionOf: 'b' }
  ]
  const plan = planChainVersions(rows)
  assert.equal(plan.orderBy, 'pointer')
  assert.deepEqual(plan.order.map((r) => r.id), ['a', 'b', 'c'])
  assert.deepEqual(plan.patches.map((p) => p.version), [1, 2, 3])
  assert.equal(plan.patches[0].invalidatedAt, T0 + H)
  assert.equal(plan.patches[1].invalidatedAt, T0 + 2 * H)
  assert.equal(plan.patches[2].invalidatedAt, null)
  assert.equal(plan.patches[2].supersedeReason, null)
})

test('迁移规划：指针排不出来就退回按时间，并明确标出', () => {
  const rows = [
    { id: 'b', lineageId: 'L', factVersionAt: T0 + H, revisionOf: 'x' }, // 指向链外
    { id: 'a', lineageId: 'L', factVersionAt: T0 }
  ]
  const plan = planChainVersions(rows)
  assert.equal(plan.orderBy, 'time')
  assert.deepEqual(plan.order.map((r) => r.id), ['a', 'b'])
  assert.ok(plan.issues.some((i) => i.code === 'I5'))
})

test('迁移规划：成环要报，不静默', () => {
  const rows = [
    { id: 'a', lineageId: 'L', factVersionAt: T0, revisionOf: 'b', supersededById: 'b' },
    { id: 'b', lineageId: 'L', factVersionAt: T0 + H, revisionOf: 'a', supersededById: 'a' }
  ]
  const plan = planChainVersions(rows)
  assert.ok(plan.issues.some((i) => i.code === 'I5'))
})

test('迁移规划：空链', () => {
  assert.equal(planChainVersions([]).orderBy, 'empty')
})

test('迁移规划出来的链能通过校验', () => {
  const rows = [
    { id: 'a', lineageId: 'L', factVersionAt: T0, supersededById: 'b' },
    { id: 'b', lineageId: 'L', factVersionAt: T0 + H, revisionOf: 'a' }
  ]
  const plan = planChainVersions(rows)
  const stamped = rows.map((r) => ({ ...r, ...plan.patches.find((p) => p.id === r.id) }))
  assert.deepEqual(validateLineage(stamped), [])
})

test('迁移规划：多个链头算歧义，不给补丁', () => {
  const rows = [
    { id: 'a', lineageId: 'L', factVersionAt: T0 },
    { id: 'b', lineageId: 'L', factVersionAt: T0 + H }
  ]
  const plan = planChainVersions(rows)
  assert.equal(plan.orderBy, 'ambiguous')
  assert.equal(plan.patches.length, 0)
  assert.ok(plan.issues.some((i) => i.code === 'I6'))
})
