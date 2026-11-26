// 四本账：承诺 / 边界 / 拒绝 / 和解。纯数据层，用固定时间戳，不碰磁盘。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  ACTIONS,
  BOOKS,
  OVERDUE_WEIGHT_CAP,
  REPAIR_LEVELS,
  REPAIR_LEVEL_ZH,
  assertEvent,
  eventProblem,
  foldLedger,
  isValidEvent,
  ledgerEvent,
  overduePromises,
  overdueWeight,
  record,
  repairLevelForAttempts,
  repairLevelOf,
  summarize
} from '../packages/core/lib/ledger.js'

const T = (day, hour = 0) => '2026-11-' + String(day).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':00:00.000Z'
const NOW = Date.parse(T(27, 12))

const fold = (events) => foldLedger(events)
const promise = (events) => fold(events).promise
const repairs = (events) => fold(events).repair

// ── 信封与构造 ──────────────────────────────────────────────

test('事件：四条必填字段（book / action / id / at），四本账的动作表齐全', () => {
  assert.deepEqual(BOOKS, ['promise', 'boundary', 'refusal', 'repair'])
  assert.deepEqual(ACTIONS.promise, ['made', 'kept', 'overdue', 'released'])
  assert.deepEqual(ACTIONS.boundary, ['set', 'crossed', 'lifted'])
  assert.deepEqual(ACTIONS.refusal, ['declined', 'repeated', 'withdrew'])
  assert.deepEqual(ACTIONS.repair, ['attempted'])
  const ev = ledgerEvent('promise', 'made', { id: 'p1', at: T(1), text: '周五把书还了' })
  assert.deepEqual(ev, { book: 'promise', action: 'made', id: 'p1', at: T(1), text: '周五把书还了' })
  assert.ok(Object.isFrozen(ev), '事件要冻结，不许记账之后被人改口径')
})

test('事件：不认识的 book / action / 缺字段一律报错（fail closed），多余字段原样忽略', () => {
  assert.throws(() => ledgerEvent('mood', 'made', { id: 'x' }), /book 认不出/)
  assert.throws(() => ledgerEvent('promise', 'forgot', { id: 'x' }), /action 认不出/)
  assert.throws(() => ledgerEvent('promise', 'made', { id: '', text: 'a' }), /id 必须是非空字符串/)
  assert.throws(() => ledgerEvent('promise', 'made', { id: 'p1', text: '   ' }), /text 必须是非空字符串/)
  assert.throws(() => ledgerEvent('promise', 'made', { id: 'p1', text: 'a'.repeat(501) }), /超过上限 500/)
  assert.throws(() => ledgerEvent('promise', 'made', { id: 'p1', text: 'a', at: '不是时间' }), /at 必须是可解析的 ISO 时间/)
  assert.throws(() => ledgerEvent('repair', 'attempted', { id: 'r1', target: { book: 'promise', id: 'p1' }, scope: 'half' }), /scope 只能是 partial \/ full/)
  assert.throws(() => ledgerEvent('repair', 'attempted', { id: 'r1', scope: 'full' }), /target 必须是/)
  // 只加不减：多出来的字段不算坏，但不带出去
  const ev = ledgerEvent('refusal', 'declined', { id: 'n1', text: '这题不替他作弊', reason: '原则', futureField: 1 })
  assert.equal(isValidEvent(ev), true)
  assert.equal('futureField' in ev, false)
})

test('记账：record 返回新数组，旧数组不变，事件带精确时间顺序', () => {
  const empty = []
  const one = record(empty, 'promise', 'made', { id: 'p1', at: T(1), text: '周五把书还了' })
  const two = record(one, 'promise', 'kept', { id: 'p1', at: T(2) })
  assert.equal(empty.length, 0, '旧数组不能被改')
  assert.equal(one.length, 1)
  assert.equal(two.length, 2)
  assert.deepEqual(two.map((e) => e.action), ['made', 'kept'])
})

// ── 承诺账 ──────────────────────────────────────────────────

test('承诺：记一条承诺 → open；兑现 → kept；文案与期限都留着', () => {
  const events = record([], 'promise', 'made', { id: 'p1', at: T(1), text: '周五把书还了', dueAt: T(5) })
  const open = promise(events).get('p1')
  assert.equal(open.status, 'open')
  assert.equal(open.text, '周五把书还了')
  assert.equal(open.dueAt, T(5))
  assert.equal(open.overdueCount, 0)
  assert.equal(open.weight, 0)
  assert.equal(open.lastAt, T(1))

  const kept = promise(record(events, 'promise', 'kept', { id: 'p1', at: T(4), note: '提前还了' })).get('p1')
  assert.equal(kept.status, 'kept')
  assert.equal(kept.overdueCount, 0)
  assert.equal(kept.lastAt, T(4))
})

test('承诺：逾期权重 1 → 2 → 4 → 8（第 n 次 2^(n-1)），封顶 8，累计也跟着涨', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => overdueWeight(n)), [0, 1, 2, 4, 8, 8, 8])
  assert.equal(OVERDUE_WEIGHT_CAP, 8)

  let events = record([], 'promise', 'made', { id: 'p1', at: T(1), text: '周五把书还了' })
  const seen = []
  for (let n = 1; n <= 5; n += 1) {
    events = record(events, 'promise', 'overdue', { id: 'p1', at: T(n + 1) })
    const state = promise(events).get('p1')
    seen.push([state.overdueCount, state.weight, state.totalWeight])
  }
  assert.deepEqual(seen, [
    [1, 1, 1],
    [2, 2, 3],
    [3, 4, 7],
    [4, 8, 15],
    [5, 8, 23] // 第 5 次封顶还是 8
  ])
})

test('承诺：逾期表只列到期且没了结的，按累计权重 → 逾期天数 → id 排序', () => {
  let events = []
  events = record(events, 'promise', 'made', { id: 'light', at: T(1), text: '顺手带杯咖啡', dueAt: T(20) })
  events = record(events, 'promise', 'overdue', { id: 'light', at: T(21) })
  events = record(events, 'promise', 'made', { id: 'heavy', at: T(1), text: '答应过的事', dueAt: T(10) })
  events = record(events, 'promise', 'overdue', { id: 'heavy', at: T(11) })
  events = record(events, 'promise', 'overdue', { id: 'heavy', at: T(12) })
  events = record(events, 'promise', 'made', { id: 'open', at: T(1), text: '还没到期', dueAt: T(30) })
  events = record(events, 'promise', 'made', { id: 'nodue', at: T(1), text: '没说什么时候' })

  const overdue = overduePromises(fold(events), { now: NOW })
  assert.deepEqual(overdue.map((row) => row.id), ['heavy', 'light'])
  assert.equal(overdue[0].totalWeight, 3)
  assert.equal(overdue[0].daysLate, 17)
  assert.equal(overdue[1].daysLate, 7)
})

test('承诺：补上或撤回之后不再挂逾期债，但逾期历史不抹掉', () => {
  let events = record([], 'promise', 'made', { id: 'p1', at: T(1), text: '周五把书还了', dueAt: T(5) })
  events = record(events, 'promise', 'overdue', { id: 'p1', at: T(6) })
  const afterKeep = record(events, 'promise', 'kept', { id: 'p1', at: T(7) })
  const kept = promise(afterKeep).get('p1')
  assert.equal(kept.status, 'kept')
  assert.equal(kept.overdueCount, 1, '补上了也不改写「曾经逾期过一次」')
  assert.equal(kept.weight, 1)
  assert.equal(overduePromises(fold(afterKeep), { now: NOW }).length, 0, '补上了就不在逾期表里')
  assert.equal(summarize(fold(afterKeep), { now: NOW }).promise.weight, 0, '了结的承诺不再压着总权重')

  const afterRelease = record(events, 'promise', 'released', { id: 'p1', at: T(7), reason: '不用还了' })
  assert.equal(promise(afterRelease).get('p1').status, 'released')
})

test('承诺：同一 id 重新许一次只更新文案与期限，不清历史欠账', () => {
  let events = record([], 'promise', 'made', { id: 'p1', at: T(1), text: '第一次', dueAt: T(3) })
  events = record(events, 'promise', 'overdue', { id: 'p1', at: T(4) })
  events = record(events, 'promise', 'made', { id: 'p1', at: T(5), text: '第二次', dueAt: T(9) })
  const state = promise(events).get('p1')
  assert.equal(state.status, 'open')
  assert.equal(state.text, '第二次')
  assert.equal(state.dueAt, T(9))
  assert.equal(state.overdueCount, 1)
})

// ── 边界账 ──────────────────────────────────────────────────

test('边界：立一条边界 → active；越界一次记一次', () => {
  let events = record([], 'boundary', 'set', { id: 'b1', at: T(1), text: '别替他答应别人的事' })
  const set = fold(events).boundary.get('b1')
  assert.equal(set.status, 'active')
  assert.equal(set.text, '别替他答应别人的事')
  assert.equal(set.crossings, 0)
  assert.equal(set.firstCrossedAt, null)

  events = record(events, 'boundary', 'crossed', { id: 'b1', at: T(3), note: '替他答应了' })
  const one = fold(events).boundary.get('b1')
  assert.equal(one.crossings, 1)
  assert.equal(one.firstCrossedAt, T(3))
  assert.equal(one.lastCrossedAt, T(3))

  events = record(events, 'boundary', 'crossed', { id: 'b1', at: T(8) })
  const two = fold(events).boundary.get('b1')
  assert.equal(two.crossings, 2)
  assert.equal(two.firstCrossedAt, T(3), '第一次越界的时间不被后面的覆盖')
  assert.equal(two.lastCrossedAt, T(8))
})

test('边界：撤掉边界 → lifted；越界次数留着（撤了不等于没越过）', () => {
  let events = record([], 'boundary', 'set', { id: 'b1', at: T(1), text: '别替他答应别人的事' })
  events = record(events, 'boundary', 'crossed', { id: 'b1', at: T(3) })
  events = record(events, 'boundary', 'lifted', { id: 'b1', at: T(5), reason: '他改主意了' })
  const state = fold(events).boundary.get('b1')
  assert.equal(state.status, 'lifted')
  assert.equal(state.crossings, 1)
})

test('边界：撤掉之后重新立起来，同一条边界回到 active，历史越界仍在', () => {
  let events = record([], 'boundary', 'set', { id: 'b1', at: T(1), text: '旧说法' })
  events = record(events, 'boundary', 'crossed', { id: 'b1', at: T(2) })
  events = record(events, 'boundary', 'lifted', { id: 'b1', at: T(3) })
  events = record(events, 'boundary', 'set', { id: 'b1', at: T(4), text: '新说法' })
  const state = fold(events).boundary.get('b1')
  assert.equal(state.status, 'active')
  assert.equal(state.text, '新说法')
  assert.equal(state.crossings, 1)
})

test('边界：三条边界各自独立折叠，互不串账', () => {
  let events = record([], 'boundary', 'set', { id: 'b1', at: T(1), text: '一' })
  events = record(events, 'boundary', 'set', { id: 'b2', at: T(1), text: '二' })
  events = record(events, 'boundary', 'crossed', { id: 'b2', at: T(2) })
  events = record(events, 'boundary', 'lifted', { id: 'b1', at: T(3) })
  const { boundary } = fold(events)
  assert.equal(boundary.get('b1').status, 'lifted')
  assert.equal(boundary.get('b1').crossings, 0)
  assert.equal(boundary.get('b2').status, 'active')
  assert.equal(boundary.get('b2').crossings, 1)
})

test('边界：撤一条不存在的边界也按追加记（没有撤销事件，只有新事件）', () => {
  const events = record([], 'boundary', 'lifted', { id: 'never-set', at: T(1) })
  const state = fold(events).boundary.get('never-set')
  assert.equal(state.status, 'lifted')
  assert.equal(state.text, '')
})

// ── 拒绝账 ──────────────────────────────────────────────────

test('拒绝：拒一次 → held，理由留着', () => {
  const events = record([], 'refusal', 'declined', { id: 'n1', at: T(1), text: '不替他撒谎', reason: '原则' })
  const state = fold(events).refusal.get('n1')
  assert.equal(state.status, 'held')
  assert.equal(state.text, '不替他撒谎')
  assert.equal(state.reason, '原则')
  assert.equal(state.repeats, 0)
})

test('拒绝：同一件事又拒一次 → repeats 加一，立场还是 held', () => {
  let events = record([], 'refusal', 'declined', { id: 'n1', at: T(1), text: '不替他撒谎' })
  events = record(events, 'refusal', 'repeated', { id: 'n1', at: T(2) })
  events = record(events, 'refusal', 'repeated', { id: 'n1', at: T(4) })
  const state = fold(events).refusal.get('n1')
  assert.equal(state.repeats, 2)
  assert.equal(state.status, 'held')
})

test('拒绝：改口 → withdrew；拒过几次的历史留着', () => {
  let events = record([], 'refusal', 'declined', { id: 'n1', at: T(1), text: '不替他撒谎' })
  events = record(events, 'refusal', 'repeated', { id: 'n1', at: T(2) })
  events = record(events, 'refusal', 'withdrew', { id: 'n1', at: T(5), reason: '这次可以说了' })
  const state = fold(events).refusal.get('n1')
  assert.equal(state.status, 'withdrew')
  assert.equal(state.repeats, 1)
})

test('拒绝：一条拒绝都没立就记「又拒一次」，算独立记录、次数是 1', () => {
  const events = record([], 'refusal', 'repeated', { id: 'n2', at: T(1) })
  const state = fold(events).refusal.get('n2')
  assert.equal(state.repeats, 1)
  assert.equal(state.status, 'held')
  assert.equal(state.text, '')
})

// ── 和解账 ──────────────────────────────────────────────────

test('和解：三档是 未和解 / 部分和解 / 已和解，名字与口径固定', () => {
  assert.deepEqual(REPAIR_LEVELS, ['open', 'partial', 'repaired'])
  assert.deepEqual(REPAIR_LEVEL_ZH, { open: '未和解', partial: '部分和解', repaired: '已和解' })
  assert.equal(repairLevelOf('partial'), 'partial')
  assert.equal(repairLevelOf('full'), 'repaired')
  assert.equal(repairLevelForAttempts([]), 'open')
  assert.equal(repairLevelForAttempts(['partial']), 'partial')
  assert.equal(repairLevelForAttempts(['partial', 'full']), 'repaired')
  assert.equal(repairLevelForAttempts(['full', 'partial']), 'repaired', '已和解不会因为又一次部分尝试降回去')
})

test('和解：一条尝试都没有 → open；部分尝试 → partial；彻底 → repaired 且只升不降', () => {
  const made = record([], 'promise', 'made', { id: 'p1', at: T(1), text: '周五把书还了' })
  const breached = record(made, 'promise', 'overdue', { id: 'p1', at: T(6) })
  const one = record(breached, 'repair', 'attempted', {
    id: 'r1',
    at: T(7),
    target: { book: 'promise', id: 'p1' },
    scope: 'partial',
    note: '先道了歉'
  })
  assert.equal(repairs(one).get('r1').level, 'partial')
  assert.equal(repairs(one).get('r1').attempts, 1)
  assert.deepEqual(repairs(one).get('r1').target, { book: 'promise', id: 'p1' })

  const two = record(one, 'repair', 'attempted', {
    id: 'r1',
    at: T(9),
    target: { book: 'promise', id: 'p1' },
    scope: 'full',
    note: '书带来了'
  })
  assert.equal(repairs(two).get('r1').level, 'repaired')
  assert.equal(repairs(two).get('r1').attempts, 2)

  const three = record(two, 'repair', 'attempted', {
    id: 'r1',
    at: T(10),
    target: { book: 'promise', id: 'p1' },
    scope: 'partial'
  })
  assert.equal(repairs(three).get('r1').level, 'repaired')
  assert.equal(repairs(three).get('r1').attempts, 3)
})

test('和解：一条和解只能对着一处欠账，前后指向不同就报错（不改口径凑合）', () => {
  let events = record([], 'repair', 'attempted', { id: 'r1', at: T(1), target: { book: 'promise', id: 'p1' }, scope: 'partial' })
  events = record(events, 'repair', 'attempted', { id: 'r1', at: T(2), target: { book: 'boundary', id: 'b1' }, scope: 'full' })
  assert.throws(() => fold(events), /target 前后不一致/)
})

test('和解：target 只能指向承诺 / 边界 / 拒绝，不能指向另一条和解', () => {
  assert.throws(
    () => ledgerEvent('repair', 'attempted', { id: 'r1', target: { book: 'repair', id: 'r0' }, scope: 'full' }),
    /target.book 只能是 promise \/ boundary \/ refusal/
  )
  assert.throws(
    () => ledgerEvent('repair', 'attempted', { id: 'r1', target: { book: 'promise', id: '' }, scope: 'full' }),
    /target.id 必须是非空字符串/
  )
})

test('和解：四本账的折叠互不干扰——同一 id 在承诺与和解里各是一本', () => {
  let events = record([], 'promise', 'made', { id: 'same', at: T(1), text: '答应的事' })
  events = record(events, 'promise', 'overdue', { id: 'same', at: T(2) })
  events = record(events, 'repair', 'attempted', { id: 'same', at: T(3), target: { book: 'promise', id: 'same' }, scope: 'partial' })
  const snapshot = fold(events)
  assert.equal(snapshot.promise.get('same').status, 'overdue')
  assert.equal(snapshot.repair.get('same').level, 'partial')
})

// ── 汇总与坏数据 ────────────────────────────────────────────

test('汇总：四本账各自计数，权重只算没了结的承诺', () => {
  let events = []
  events = record(events, 'promise', 'made', { id: 'p-kept', at: T(1), text: '还书', dueAt: T(3) })
  events = record(events, 'promise', 'kept', { id: 'p-kept', at: T(2) })
  events = record(events, 'promise', 'made', { id: 'p-due', at: T(1), text: '带咖啡', dueAt: T(20) })
  events = record(events, 'promise', 'overdue', { id: 'p-due', at: T(21) })
  events = record(events, 'promise', 'made', { id: 'p-open', at: T(1), text: '以后再说' })
  events = record(events, 'promise', 'released', { id: 'p-open', at: T(2) })
  events = record(events, 'boundary', 'set', { id: 'b1', at: T(1), text: '别替他答应' })
  events = record(events, 'boundary', 'crossed', { id: 'b1', at: T(2) })
  events = record(events, 'boundary', 'lifted', { id: 'b2', at: T(2) })
  events = record(events, 'refusal', 'declined', { id: 'n1', at: T(1), text: '不撒谎' })
  events = record(events, 'refusal', 'repeated', { id: 'n1', at: T(2) })
  events = record(events, 'refusal', 'withdrew', { id: 'n2', at: T(2) })
  events = record(events, 'repair', 'attempted', { id: 'r1', at: T(1), target: { book: 'refusal', id: 'n1' }, scope: 'partial' })
  events = record(events, 'repair', 'attempted', { id: 'r2', at: T(1), target: { book: 'boundary', id: 'b1' }, scope: 'full' })

  const summary = summarize(fold(events), { now: NOW })
  assert.deepEqual(summary.promise, { total: 3, open: 0, due: 0, kept: 1, overdue: 1, released: 1, weight: 1 })
  assert.deepEqual(summary.boundary, { total: 2, active: 1, lifted: 1, crossings: 1 })
  assert.deepEqual(summary.refusal, { total: 2, held: 1, withdrew: 1, repeats: 1 })
  assert.deepEqual(summary.repair, { total: 2, open: 0, partial: 1, repaired: 1, attempts: 2 })
})

test('坏数据 fail closed：折叠时坏事件直接抛，带下标与错误码，不返回「看起来正常」的快照', () => {
  const good = ledgerEvent('promise', 'made', { id: 'p1', at: T(1), text: '还书' })
  const bad = { book: 'promise', action: 'made', id: 'p2', at: T(1) } // 缺 text
  assert.notEqual(eventProblem(bad), null)
  assert.equal(isValidEvent(bad), false)
  assert.equal(isValidEvent(good), true)
  assert.throws(() => assertEvent(bad), /text 必须是非空字符串/)
  try {
    foldLedger([good, bad])
    assert.fail('坏事件应该抛错')
  } catch (error) {
    assert.equal(error.code, 'LEDGER_EVENT_INVALID')
    assert.match(error.message, /第 1 条/)
  }
  assert.throws(() => foldLedger('不是数组'), /必须是数组/)
  assert.throws(() => overdueWeight(-1), /非负整数/)
  assert.throws(() => overdueWeight(1, { cap: 0 }), /封顶必须是正整数/)
})

test('数据层不碰磁盘：模块没有文件系统依赖（默认关、无副作用）', () => {
  const source = fs.readFileSync(new URL('../packages/core/lib/ledger.js', import.meta.url), 'utf8')
  assert.ok(!/from ['"]node:fs['"]/.test(source), '纯数据层不许 import fs')
  assert.ok(!/\bwriteFileSync|\bappendFileSync|\breadFileSync\b/.test(source), '纯数据层不许读写文件')
})