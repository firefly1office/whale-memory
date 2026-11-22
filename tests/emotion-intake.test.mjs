// 情绪采集模块的公开测试：全部合成样本，不含真实对话。
import assert from 'node:assert/strict'
import test from 'node:test'

import { allowWrite, mergeMomentWindow, momentDue, recordMoment, recordWrite, scoreTurn } from '../packages/emotion-intake/index.js'

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
  const s = recordWrite({ intakeLog: [] }, { turnIndex: 0, now: Date.now(), write: { dim: 'v', value: 0.15, source: 'self_felt' } })
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
  assert.equal(recordWrite(null, { now: fixed, write: { dim: 'v', value: 1, source: 'self_felt' } }), null)
  assert.equal(recordWrite(undefined, { now: fixed }), null)
  assert.equal(recordWrite(Object.freeze({}), { now: fixed, write: { dim: 'v', value: 1, source: 'self_felt' } }).intakeLog.length, 1)

  const original = { intakeLog: [{ turn: 0 }] }
  const next = recordWrite(original, { turnIndex: 1, now: fixed, write: { dim: 'v', value: 0.1, source: 'self_felt' } })
  assert.equal(original.intakeLog.length, 1)
  assert.notEqual(next, original)
  assert.notEqual(next.intakeLog, original.intakeLog)
  assert.equal(next.intakeLog.length, 2)

  let s = { intakeLog: [] }
  for (let i = 0; i < 150; i += 1) s = recordWrite(s, { turnIndex: i, now: fixed, write: { dim: 'v', value: 0.1, source: 'self_felt' } })
  assert.equal(s.intakeLog.length, 100)
})

test('recordWrite 不隐藏时钟：缺 now 返回 null；无候选不占配额', () => {
  const s = { intakeLog: [] }
  assert.equal(recordWrite(s, { write: { dim: 'v', value: 1, source: 'self_felt' } }), null)
  assert.equal(recordWrite(s, { now: Date.now() }), null)
  assert.equal(recordWrite(s, { now: Date.now(), write: null }), null)
  assert.equal(allowWrite(s, { turnIndex: 0 }), true)

  const late = new Date('2026-11-22T23:59:00+08:00').getTime()
  const early = new Date('2026-11-23T00:01:00+08:00').getTime()
  const a = recordWrite(s, { now: late, write: { dim: 'v', value: 0.1, source: 'self_felt' } })
  const b = recordWrite(s, { now: early, write: { dim: 'v', value: 0.1, source: 'self_felt' } })
  assert.notEqual(a.intakeLog[0].day, b.intakeLog[0].day)
})
test('moment 窗口认识 scoreTurn 的新来源名', () => {
  const r = scoreTurn({ otherText: '我有点难过', selfText: '我也有点闷' })
  const state = {}
  const w = mergeMomentWindow(state, { turnIndex: 1, sources: r.sources })
  assert.equal(w.due, true, JSON.stringify(r.sources))
})
test('moment 旧来源名先归一化，不会被算成两个源', () => {
  const state = {}
  mergeMomentWindow(state, { turnIndex: 1, sources: ['her_felt'] })
  const w = mergeMomentWindow(state, { turnIndex: 2, sources: ['self_felt'] })
  assert.equal(w.sources.length, 1)
  assert.equal(w.due, false)
})

test('moment 空回合不给旧证据续期', () => {
  const state = {}
  mergeMomentWindow(state, { turnIndex: 1, sources: ['other_evidence'] })
  mergeMomentWindow(state, { turnIndex: 4, sources: [] })
  const w = mergeMomentWindow(state, { turnIndex: 5, sources: ['self_felt'] })
  assert.deepEqual(w.sources, ['self_felt'], '第 1 回合的来源应过期')
  assert.equal(w.due, false)
})

test('moment 弱源 + 感染也够两个独立源', () => {
  const state = {}
  const w = mergeMomentWindow(state, { turnIndex: 1, sources: ['self_weak', 'contagion'] })
  assert.equal(w.due, true)
})
test('旧格式窗口升级：相邻两回合的旧来源仍能合并', () => {
  const state = { momentWindow: { turn: 1, sources: ['her_felt'] } }
  const w = mergeMomentWindow(state, { turnIndex: 2, sources: ['other_evidence'] })
  assert.equal(w.due, true, JSON.stringify(w.sources))
})

test('momentDue 识别旧名记录，不重复触发', () => {
  const now = new Date('2026-11-22T10:00:00+08:00').getTime()
  const state = { momentPairs: [{ day: '2026-11-22', pair: 'her_felt+his_evidence' }] }
  assert.equal(momentDue(state, { turnIndex: 5, sources: ['self_felt', 'other_evidence'], now }), false)
})

test('recordMoment 写入新名', () => {
  const now = new Date('2026-11-22T10:00:00+08:00').getTime()
  const state = {}
  recordMoment(state, { turnIndex: 5, sources: ['her_felt', 'his_evidence'], now })
  assert.equal(state.momentPairs[0].pair, 'other_evidence+self_felt')
})

test('单个弱源配未知标签：不算够源', () => {
  const state = {}
  const w = mergeMomentWindow(state, { turnIndex: 1, sources: ['self_weak', 'mystery'] })
  assert.equal(w.due, false)
  assert.deepEqual(w.sources, ['self_weak'])
})
test('旧状态里的未知来源会被过滤，不会凑成第二个源', () => {
  const state = { momentWindow: { turn: 2, sources: ['self_felt', 'mystery'], last: { self_felt: 2, mystery: 2 } } }
  const w = mergeMomentWindow(state, { turnIndex: 3, sources: [] })
  assert.deepEqual(w.sources, ['self_felt'])
  assert.equal(w.due, false)
})

test('旧窗口第 0 回合不被替换成当前回合', () => {
  const state = { momentWindow: { turn: 0, sources: ['other_evidence'] } }
  const w = mergeMomentWindow(state, { turnIndex: 4, sources: ['self_felt'] })
  assert.deepEqual(w.sources, ['self_felt'], '第 0 回合的来源应已过期')
  assert.equal(w.due, false)

  const boundary = { momentWindow: { turn: 0, sources: ['other_evidence'] } }
  const b = mergeMomentWindow(boundary, { turnIndex: 3, sources: ['self_felt'] })
  assert.equal(b.due, true, '正好 3 回合仍在窗口内')
})
test('同一份状态：第 0 回合迁移后保留 0，第 4 回合才过期', () => {
  const state = { momentWindow: { turn: 0, sources: ['other_evidence'] } }
  mergeMomentWindow(state, { turnIndex: 3, sources: [] })
  assert.equal(state.momentWindow.last.other_evidence, 0, '迁移必须保留第 0 回合')

  const w = mergeMomentWindow(state, { turnIndex: 4, sources: ['self_felt'] })
  assert.deepEqual(w.sources, ['self_felt'], '第 0 回合来源应过期')
  assert.equal(w.due, false)
})
test('评价对象不是她自己：不写 self_felt / self_weak', () => {
  const obj = scoreTurn({ otherText: '', selfText: '我觉得房间有点闷', prevAskedSelf: true })
  assert.equal(obj.write, null)
  const weak = scoreTurn({ otherText: '', selfText: '房间有点闷', prevAskedSelf: true })
  assert.equal(weak.write, null, '问过感受也不能把房间的闷算成她的')
})

test('问句不写：我累？', () => {
  const r = scoreTurn({ otherText: '', selfText: '我累？' })
  assert.equal(r.write, null)
})

test('否定偏好取负值，不被肯定子串抵消', () => {
  const r = scoreTurn({ otherText: '我不喜欢你', selfText: '' })
  assert.equal(r.write.source, 'other_direct')
  assert.equal(r.write.value, -0.10)
})

test('recordWrite 拒绝缺字段的候选，不占配额', () => {
  const s = { intakeLog: [] }
  assert.equal(recordWrite(s, { now: Date.now(), write: {} }), null)
  assert.equal(recordWrite(s, { now: Date.now(), write: { dim: 'v', value: 0.1 } }), null)
  assert.equal(allowWrite(s, { turnIndex: 0, now: Date.now() }), true)
})
test('「让我」是感受起因，不按评价对象处理', () => {
  const r = scoreTurn({ otherText: '', selfText: '这首歌让我很难过' })
  assert.equal(r.write.source, 'self_felt')
  assert.equal(r.write.value, -0.15)
})

test('电影/剧也是评价对象', () => {
  const r = scoreTurn({ otherText: '', selfText: '电影有点闷', prevAskedSelf: true })
  assert.equal(r.write, null)
})

test('「我不爱你」取负值', () => {
  const r = scoreTurn({ otherText: '我不爱你', selfText: '' })
  assert.equal(r.write.source, 'other_direct')
  assert.equal(r.write.value, -0.10)
})

test('带句号的语气词问句不写', () => {
  const r = scoreTurn({ otherText: '', selfText: '我累吗。' })
  assert.equal(r.write, null)
})

test('recordWrite 拒绝 null 值与对象来源', () => {
  const s = { intakeLog: [] }
  assert.equal(recordWrite(s, { now: Date.now(), write: { dim: 'v', value: null, source: 'self_felt' } }), null)
  assert.equal(recordWrite(s, { now: Date.now(), write: { dim: 'v', value: 0.1, source: {} } }), null)
  assert.equal(allowWrite(s, { turnIndex: 0, now: Date.now() }), true)
})
test('否定偏好：证据保留否定短语，加「了」也不翻正', () => {
  for (const text of ['我不爱你', '我不爱你了']) {
    const r = scoreTurn({ otherText: text, selfText: '' })
    assert.equal(r.write.value, -0.10, text)
    assert.ok(r.otherEvidence.some((w) => w.includes('不爱你')), text)
  }
})

test('「让我」支配感受 vs 支配动作', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '这首歌让我很难过' }).write.value, -0.15)
  assert.equal(scoreTurn({ otherText: '', selfText: '你让我看看房间有多闷' }).write, null)
})

test('剧/书与电影同一口径', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '我觉得这部剧很闷' }).write, null)
  assert.equal(scoreTurn({ otherText: '', selfText: '这本书有点闷', prevAskedSelf: true }).write, null)
})

test('第三人称与假设句不归她', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '我觉得他很难过' }).write, null)
  assert.equal(scoreTurn({ otherText: '', selfText: '如果我累了就休息' }).write, null)
})
test('直接偏好只认说话者本人', () => {
  assert.equal(scoreTurn({ otherText: '她不爱你了', selfText: '' }).write, null)
  assert.equal(scoreTurn({ otherText: '如果我不爱你就会离开', selfText: '' }).write, null)
})

test('他让我难过：起因归她；他焦虑：体验者不是她', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '他让我很难过' }).write.value, -0.15)
  assert.equal(scoreTurn({ otherText: '', selfText: '我觉得他很焦虑' }).write, null)
})

test('「让我看房间多闷」仍是评价房间', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '你让我看房间多闷' }).write, null)
})

test('「你的话」不是假设句', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '你的话让我很难过' }).write.value, -0.15)
})
test('偏好/感受的所属者：其实她、你、我', () => {
  assert.equal(scoreTurn({ otherText: '其实她不爱你了', selfText: '' }).write, null)
  assert.equal(scoreTurn({ otherText: '', selfText: '我觉得你很焦虑' }).write, null)
  assert.equal(scoreTurn({ otherText: '', selfText: '我觉得我很焦虑' }).write.value, -0.15)
})

test('条件词与词内子串', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '我累了的话就休息' }).write, null)
  assert.equal(scoreTurn({ otherText: '', selfText: '我主要是有点累' }).write.value, -0.15)
})

test('已知局限：条件前半句不影响后半句（首版保留）', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '如果下雨，我会很难过' }).write.value, -0.15)
})
test('直接偏好的条件句：如果…与…的话一致', () => {
  assert.equal(scoreTurn({ otherText: '如果我喜欢这个就买', selfText: '' }).write, null)
  assert.equal(scoreTurn({ otherText: '我喜欢这个的话就买', selfText: '' }).write, null)
})

test('已知局限：同伴/听者人称会误拦第一人称', () => {
  assert.equal(scoreTurn({ otherText: '', selfText: '和你在一起我很开心' }).write, null)
  assert.equal(scoreTurn({ otherText: '', selfText: '我告诉她我喜欢你' }).write, null)
})
test('otherText 里的直接偏好与已知误拦', () => {
  assert.equal(scoreTurn({ otherText: '我喜欢你', selfText: '' }).write.value, 0.10)
  assert.equal(scoreTurn({ otherText: '我告诉她我喜欢你', selfText: '' }).write, null, '已知局限：听者代词误拦')
  assert.equal(scoreTurn({ otherText: '我喜欢你的话就直说', selfText: '' }).write.value, 0.10, '已知局限：条件的话被当名词')
})