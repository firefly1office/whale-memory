// 时间线查询的离线验收：知轴 / 值轴 / 变化对比三个问法。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  changesBetween, currentVersion, orderChain, valueValidAt, versionKnownAt
} from '../packages/core/lib/fact-timeline-query.js'

const H = 3600 * 1000
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0)

// 一条版本链：v1 (T0) 被 v2 (T0+10h) 取代，v2 至今有效
const chain = [
  { id: 'v2', version: 2, factVersionAt: T0 + 10 * H, revisionOf: 'v1', validFrom: T0 + 10 * H },
  {
    id: 'v1', version: 1, factVersionAt: T0, supersededById: 'v2',
    invalidatedAt: T0 + 10 * H, validFrom: T0, validUntil: T0 + 10 * H
  }
]

test('排序：按版本号升序，缺号排最后', () => {
  const ordered = orderChain([...chain, { id: 'x', factVersionAt: T0 + H }])
  assert.deepEqual(ordered.map((r) => r.id), ['v1', 'v2', 'x'])
})

test('当前版本：最后一个没有后继的', () => {
  assert.equal(currentVersion(chain).id, 'v2')
  assert.equal(currentVersion([{ id: 'only', version: 1 }]).id, 'only')
  assert.equal(currentVersion([]), null)
})

test('知轴：改主意之前，她认为的是旧版本', () => {
  assert.equal(versionKnownAt(chain, T0 + 5 * H).id, 'v1')
  assert.equal(versionKnownAt(chain, T0 + 10 * H).id, 'v2')   // 边界：终点当天算新版本
  assert.equal(versionKnownAt(chain, T0 - H), null)           // 还没发生
  assert.equal(versionKnownAt(chain, T0 + 100 * H).id, 'v2')
})

test('值轴：与知轴可以不一致（已知但已不在世上）', () => {
  const worldChanged = [
    { id: 'w1', version: 1, factVersionAt: T0, validFrom: T0, validUntil: T0 + 3 * H, supersededById: 'w2', invalidatedAt: T0 + 20 * H },
    { id: 'w2', version: 2, factVersionAt: T0 + 20 * H, validFrom: T0 + 3 * H, revisionOf: 'w1' }
  ]
  // 10 小时时：世上已经变了（值轴 w2），但她还是 3 小时那条认识（知轴 w1）
  assert.equal(valueValidAt(worldChanged, T0 + 10 * H).id, 'w2')
  assert.equal(versionKnownAt(worldChanged, T0 + 10 * H).id, 'w1')
})

test('值轴：validFrom 缺失时退回知轴起点', () => {
  const rows = [{ id: 'a', version: 1, factVersionAt: T0, validFrom: 0 }]
  assert.equal(valueValidAt(rows, T0 + H).id, 'a')
  assert.equal(valueValidAt(rows, T0 - H), null)
})

test('变化对比：只列区间内新增的版本', () => {
  const changes = changesBetween(chain, T0 + H, T0 + 20 * H)
  assert.deepEqual(changes.map((c) => c.id), ['v2'])
  assert.equal(changes[0].version, 2)
  assert.equal(changes[0].revisionOf, 'v1')
})

test('变化对比：区间反了或为空时返回空数组', () => {
  assert.deepEqual(changesBetween(chain, T0 + 20 * H, T0 + H), [])
  assert.deepEqual(changesBetween(chain, 0, T0), [])
})