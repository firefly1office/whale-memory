// 情绪采集模块的公开测试：全部合成样本，不含真实对话。
import assert from 'node:assert/strict'
import test from 'node:test'

import { allowWrite, recordWrite, scoreTurn } from '../packages/emotion-intake/index.js'

const turn = (otherText, selfText, prevAskedSelf = false) => scoreTurn({ otherText, selfText, prevAskedSelf })

test('她的评价只进证据，不写情绪', () => {
  for (const text of ['好听', '这个快', '有点冲']) {
    const r = turn('', text)
    assert.ok(r.selfEvidence.length > 0, text)
    assert.equal(r.write, null, text)
  }
})

test('她第一人称感受才写，幅度 0.15', () => {
  for (const text of ['我有点闷', '我难过', '我累', '我开心']) {
    const r = turn('', text)
    assert.equal(Math.abs(r.write?.value || 0), 0.15, text)
    assert.equal(r.write.source, 'self_felt', text)
  }
})

test('省略主语只在上一句问她感受时成立', () => {
  const without = turn('', '有点闷')
  assert.equal(without.write, null)
  const withPrev = turn('', '有点闷', true)
  assert.equal(withPrev.write.source, 'self_weak')
  assert.equal(withPrev.write.value, -0.15)
})

test('否定/疑问/听说只留证据', () => {
  for (const text of ['我不难过', '难过？呵呵', '他说我难过']) {
    const r = turn('', text)
    assert.equal(r.write, null, text)
  }
})

test('他的一般情绪词只进证据，他直接说喜欢才写 0.10', () => {
  const general = turn('我有点累', '')
  assert.equal(general.write, null)
  assert.ok(general.otherEvidence.length > 0)
  const direct = turn('我喜欢这个', '')
  assert.equal(direct.write.value, 0.10)
})

test('moment 要两个源：他证据 + 她自感', () => {
  const both = turn('我有点难过', '我也有点闷')
  assert.equal(both.moment, true)
  assert.equal(both.write.value, -0.15)

  assert.equal(turn('', '我有点闷').moment, false)
  assert.equal(turn('我喜欢这个', '好听').moment, false)
})

test('语气抑制：带夸张标点的强信号仍写，但被压低', () => {
  const normal = turn('', '我有点闷')
  assert.equal(normal.write.value, -0.15)
  const loud = turn('', '我有点闷！！！')
  assert.ok(Math.abs(loud.write.value) < 0.15)
  assert.ok(Math.abs(loud.write.value) >= 0.12)
})

test('配额：冷却 2 回合；差一回合不放，恰好两回合放行', () => {
  const s = recordWrite({ intakeLog: [] }, { turnIndex: 0, now: Date.now(), write: { value: 0.15 } })
  assert.equal(allowWrite(s, { turnIndex: 1 }), false)
  assert.equal(allowWrite(s, { turnIndex: 2 }), true)
})

test('空/非字符串输入不抛错，也不产生候选', () => {
  for (const input of [undefined, null, 0, 123, {}]) {
    const r = turn(input, input)
    assert.equal(r.write, null)
    assert.deepEqual(r.selfEvidence, [])
    assert.deepEqual(r.otherEvidence, [])
  }
})

test('超长文本不抛错，证据数量有界', () => {
  const r = turn('', '我有点闷。'.repeat(2000))
  assert.ok(r.selfEvidence.length <= 10)
  assert.ok(r.write === null || Math.abs(r.write.value) <= 0.15)
})

test('混合句：评价 + 第一人称同时出现，只认自感', () => {
  const r = turn('', '好听，我有点闷')
  assert.equal(r.write.source, 'self_felt')
  assert.ok(r.selfEvidence.includes('好听'))
  assert.ok(r.selfEvidence.includes('闷'))
})

test('recordWrite 不修改入参：返回新状态，日志有界', () => {
  const fixed = new Date('2026-11-22T10:00:00+08:00').getTime()
  assert.equal(recordWrite(null, { now: fixed, write: { value: 1 } }), null)
  assert.equal(recordWrite(undefined, { now: fixed }), null)
  assert.equal(recordWrite(Object.freeze({}), { now: fixed, write: { value: 1 } }).intakeLog.length, 1)

  const original = { intakeLog: [{ turn: 0 }] }
  const next = recordWrite(original, { turnIndex: 1, now: fixed, write: { value: 0.1 } })
  assert.equal(original.intakeLog.length, 1)
  assert.notEqual(next, original)
  assert.notEqual(next.intakeLog, original.intakeLog)
  assert.equal(next.intakeLog.length, 2)

  let s = { intakeLog: [] }
  for (let i = 0; i < 150; i += 1) s = recordWrite(s, { turnIndex: i, now: fixed, write: { value: 0.1 } })
  assert.equal(s.intakeLog.length, 100)
})

test('recordWrite 不隐藏时钟：缺 now 返回 null；无候选不占配额', () => {
  const s = { intakeLog: [] }
  assert.equal(recordWrite(s, { write: { value: 1 } }), null)
  assert.equal(recordWrite(s, { now: Date.now() }), null)
  assert.equal(recordWrite(s, { now: Date.now(), write: null }), null)
  assert.equal(allowWrite(s, { turnIndex: 0 }), true)

  const late = new Date('2026-11-22T23:59:00+08:00').getTime()
  const early = new Date('2026-11-23T00:01:00+08:00').getTime()
  const a = recordWrite(s, { now: late, write: { value: 0.1 } })
  const b = recordWrite(s, { now: early, write: { value: 0.1 } })
  assert.notEqual(a.intakeLog[0].day, b.intakeLog[0].day)
})