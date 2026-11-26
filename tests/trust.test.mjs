// 信任六档：分档、升档攒证据、掉档一步到位、里程碑只记「到过」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  MILESTONES,
  TRUST_LEVELS,
  TRUST_MAX,
  UP_CONFIRMATIONS,
  advanceTrust,
  bandFor,
  clampScore,
  createTrustState,
  foldTrust,
  levelForScore,
  milestoneById,
  milestonesForLevel
} from '../packages/core/lib/trust.js'

const confirm = (state, score) => {
  let current = state
  for (let i = 0; i < UP_CONFIRMATIONS; i += 1) current = advanceTrust(current, score).state
  return current
}

test('六档阈值：0 / 12 / 30 / 50 / 70 / 88，分数落在哪一档', () => {
  assert.equal(TRUST_MAX, 100)
  assert.deepEqual(TRUST_LEVELS.map((b) => b.enter), [0, 12, 30, 50, 70, 88])
  assert.deepEqual(TRUST_LEVELS.map((b) => b.name), ['陌路', '相识', '相熟', '信赖', '托付', '交心'])
  assert.equal(levelForScore(0), 1)
  assert.equal(levelForScore(11.9), 1)
  assert.equal(levelForScore(12), 2)
  assert.equal(levelForScore(29.9), 2)
  assert.equal(levelForScore(30), 3)
  assert.equal(levelForScore(50), 4)
  assert.equal(levelForScore(70), 5)
  assert.equal(levelForScore(88), 6)
  assert.equal(levelForScore(100), 6)
  // 越界限幅：分数给超了算边界，不算坏数据；NaN 才是坏数据
  assert.equal(clampScore(-5), 0)
  assert.equal(clampScore(150), 100)
  assert.equal(levelForScore(-5), 1)
  assert.equal(levelForScore(150), 6)
})

test('掉档比升档快：同样跨 2 分，往上要连证三次，往下一步就掉', () => {
  assert.equal(UP_CONFIRMATIONS, 3)
  // 同一个分界（70 分）：69 在第 4 档、71 在第 5 档
  assert.equal(levelForScore(69), 4)
  assert.equal(levelForScore(71), 5)

  const at4 = createTrustState({ level: 4 })
  const firstUp = advanceTrust(at4, 71)
  assert.equal(firstUp.state.level, 4, '+2 一次不够，先攒着')
  assert.equal(firstUp.decision.direction, 'hold')
  assert.equal(firstUp.decision.reason, 'awaiting-evidence')
  assert.equal(firstUp.state.upStreak, 1)
  assert.equal(firstUp.decision.missing, 2)

  const at5 = confirm(at4, 71)
  assert.equal(at5.level, 5, '连续三次达标才升一档')

  const down = advanceTrust(at5, 69)
  assert.equal(down.state.level, 4, '-2 一次就掉')
  assert.equal(down.decision.direction, 'down')
  assert.equal(down.decision.reason, 'below-level-floor')
  assert.equal(down.decision.missing, 0)
})

test('升档一次只升一档：从第 1 档打 100 分，三次也只到第 2 档', () => {
  const after = confirm(createTrustState(), 100)
  assert.equal(after.level, 2)
  const more = confirm(after, 100)
  assert.equal(more.level, 3)
  assert.equal(levelForScore(100), 6, '分数已经到第 6 档，档位还得一档一档攒')
})

test('掉档可以跨多档：第 6 档一次跌到 0 分直接回第 1 档，攒的证据清零', () => {
  const at6 = createTrustState({ level: 6, milestones: ['known', 'trusted', 'confidant'] })
  const dropped = advanceTrust(at6, 0)
  assert.equal(dropped.state.level, 1)
  assert.equal(dropped.state.upStreak, 0)
  assert.equal(dropped.decision.fromName, '交心')
  assert.equal(dropped.decision.toName, '陌路')
  assert.deepEqual([...dropped.state.milestones], ['known', 'trusted', 'confidant'], '到过的里程碑不因掉档收回')
})

test('攒证据中途回到同档：证据清零，下次重新数三次', () => {
  const at4 = createTrustState({ level: 4 })
  const one = advanceTrust(at4, 71)
  assert.equal(one.state.upStreak, 1)
  const same = advanceTrust(one.state, 60)
  assert.equal(same.state.level, 4)
  assert.equal(same.state.upStreak, 0, '中间落回同档，之前攒的不算')
  assert.equal(same.decision.reason, 'same-band')

  const again = advanceTrust(same.state, 71)
  assert.equal(again.state.upStreak, 1, '重新从第一次开始数')
})

test('里程碑：升到第 2 档拿「认下这个人」、第 4 档拿「敢托付」、第 6 档拿「交过心」，不重复记', () => {
  assert.deepEqual(MILESTONES.map((m) => m.level), [2, 4, 6])
  let state = createTrustState()
  let step = advanceTrust(state, 12)
  assert.deepEqual([...step.decision.newMilestones], [])
  step = advanceTrust(step.state, 12)
  assert.deepEqual([...step.decision.newMilestones], [])
  step = advanceTrust(step.state, 12)
  assert.equal(step.state.level, 2)
  assert.deepEqual([...step.decision.newMilestones], ['known'])
  assert.deepEqual([...step.state.milestones], ['known'])

  state = confirm(step.state, 30) // 第 3 档没有里程碑
  assert.equal(state.level, 3)
  assert.deepEqual([...state.milestones], ['known'])

  const at4 = confirm(state, 50)
  assert.equal(at4.level, 4)
  assert.deepEqual([...at4.milestones], ['known', 'trusted'])
  assert.deepEqual(milestonesForLevel(4).map((m) => m.id), ['known', 'trusted'])
  assert.equal(milestoneById('trusted').name, '敢把一件事托给她')
  assert.equal(milestoneById('nope'), null)
})

test('状态不可变：advanceTrust 返回新对象，原状态一个字不动', () => {
  const before = createTrustState({ level: 4 })
  const snapshot = JSON.stringify(before)
  const { state } = advanceTrust(before, 71)
  assert.notEqual(state, before)
  assert.equal(JSON.stringify(before), snapshot)
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.milestones))
})

test('回放：foldTrust 按顺序吃分数，给出每一步的判定', () => {
  const { state, decisions } = foldTrust([12, 12, 12, 50, 50, 50])
  assert.equal(decisions.length, 6)
  assert.deepEqual(decisions.map((d) => d.direction), ['hold', 'hold', 'up', 'hold', 'hold', 'up'])
  assert.equal(state.level, 3)
  assert.deepEqual([...state.milestones], ['known'])
  const empty = foldTrust([])
  assert.equal(empty.state.level, 1)
  assert.equal(empty.decisions.length, 0)
})

test('坏输入 fail closed：分数、档位、状态、里程碑不合规都报错，不静默当 0 档', () => {
  assert.throws(() => clampScore(NaN), /score 必须是有限数字/)
  assert.throws(() => clampScore(Infinity), /score 必须是有限数字/)
  assert.throws(() => clampScore('80'), /score 必须是有限数字/)
  assert.throws(() => advanceTrust(createTrustState(), NaN), /score 必须是有限数字/)
  assert.throws(() => bandFor(0), /level 必须是 1..6 的整数/)
  assert.throws(() => bandFor(7), /level 必须是 1..6 的整数/)
  assert.throws(() => createTrustState({ level: 0 }), /level 必须是 1..6 的整数/)
  assert.throws(() => createTrustState({ upStreak: UP_CONFIRMATIONS }), /upStreak 不能大于等于/)
  assert.throws(() => createTrustState({ milestones: ['made-up'] }), /里程碑认不出/)
  assert.throws(() => advanceTrust({ level: 9, upStreak: 0, milestones: [] }, 10), /level 必须是 1..6 的整数/)
  assert.throws(() => advanceTrust({}, 10), /level 必须是 1..6 的整数/)
})

test('默认关：包入口与 exports 都没登记这两个新模块，仓库里没有调用点', () => {
  const root = new URL('../', import.meta.url)
  const index = fs.readFileSync(new URL('packages/core/index.js', root), 'utf8')
  assert.ok(!/ledger\.js/.test(index), 'package 入口不许 re-export ledger')
  assert.ok(!/trust\.js/.test(index), 'package 入口不许 re-export trust')
  const pkg = JSON.parse(fs.readFileSync(new URL('packages/core/package.json', root), 'utf8'))
  assert.equal(pkg.exports['./ledger'], undefined)
  assert.equal(pkg.exports['./trust'], undefined)
})