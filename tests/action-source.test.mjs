// 发起来源判据：只认结构化证据。自由文本不是证据，判不出就 unknown。
// 这一版是重做：上一版靠中文关键词匹配，每加一条规则就多一个反例（陈述句、否定句、看/删混判）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifySource,
  describeSource,
  noExternalInput,
  SOURCES,
  TRIGGER_KINDS
} from '../packages/core/lib/action-source.js'
import * as core from '../packages/core/index.js'

// —— self：只有一条入口 ——
test('trigger 为 null 才是 self', () => {
  assert.equal(classifySource({ action: 'draft_read', trigger: null }), 'self')
  assert.equal(noExternalInput(), null)
  assert.equal(classifySource({ action: 'draft_read', trigger: noExternalInput() }), 'self')
})

test('trigger 为 {kind:none} 也算没有外部输入', () => {
  assert.equal(classifySource({ action: 'draft_read', trigger: { kind: 'none' } }), 'self')
})

test('没传 trigger / undefined：unknown，不当作没有输入', () => {
  assert.equal(classifySource({ action: 'draft_read' }), 'unknown')
  assert.equal(classifySource({ action: 'draft_read', trigger: undefined }), 'unknown')
  assert.equal(classifySource({}), 'unknown')
  assert.equal(classifySource(), 'unknown')
  assert.equal(classifySource(null), 'unknown')
})

// —— 自由文本不是证据 ——
test('传字符串：unknown（不再从中文里猜）', () => {
  assert.equal(classifySource({ action: 'draft_read', trigger: '帮我看看初稿' }), 'unknown')
  assert.equal(classifySource({ action: 'draft_save', trigger: '先别存稿' }), 'unknown')
  assert.equal(classifySource({ action: 'diary_write', trigger: '可以告诉我日记是什么吗' }), 'unknown')
})

// —— 系统触发：不算她自己发起 ——
test('定时器 / 空闲窗口 / 提醒 → unknown，不是 self', () => {
  assert.equal(classifySource({ action: 'draft_read', trigger: { kind: 'system' } }), 'unknown')
  assert.equal(classifySource({ action: 'project_progress', trigger: { kind: 'system' } }), 'unknown')
})

test('系统触发的描述会写清"不计入自己发起"', () => {
  assert.match(describeSource('unknown', { system: true }), /系统触发/)
  assert.doesNotMatch(describeSource('unknown', { system: true }), /自己发起（/)
})

// —— asked：用户要求，且动作对得上 ——
test('user-request 命中本次动作：asked', () => {
  assert.equal(classifySource({ action: 'draft_read', trigger: { kind: 'user-request' } }), 'asked')
  assert.equal(
    classifySource({ action: 'draft_read', tool: 'self_project_draft', trigger: { kind: 'user-request' } }),
    'asked'
  )
})

test('user-request 标了动作名：必须与本次一致', () => {
  assert.equal(
    classifySource({ action: 'draft_read', trigger: { kind: 'user-request', action: 'draft_read' } }),
    'asked'
  )
  assert.equal(
    classifySource({ action: 'draft_delete', trigger: { kind: 'user-request', action: 'draft_read' } }),
    'unknown'
  )
})

test('user-request 标了工具名：必须与本次一致', () => {
  assert.equal(
    classifySource({
      action: 'draft_read',
      tool: 'self_project_draft',
      trigger: { kind: 'user-request', tool: 'self_project_draft' }
    }),
    'asked'
  )
  assert.equal(
    classifySource({
      action: 'draft_read',
      tool: 'self_project_draft',
      trigger: { kind: 'user-request', tool: 'self_project' }
    }),
    'unknown'
  )
})

// —— 提到 ≠ 要求 ——
test('user-mention：unknown', () => {
  assert.equal(classifySource({ action: 'draft_read', trigger: { kind: 'user-mention' } }), 'unknown')
})

test('未知 kind：unknown', () => {
  assert.equal(classifySource({ action: 'draft_read', trigger: { kind: 'whatever' } }), 'unknown')
  assert.equal(classifySource({ action: 'draft_read', trigger: {} }), 'unknown')
})

// —— 永不抛错 ——
test('异常输入不抛错', () => {
  assert.equal(classifySource({ action: 123, tool: {}, trigger: { kind: 'user-request' } }), 'unknown')
  assert.equal(classifySource({ trigger: 42 }), 'unknown')
  assert.equal(classifySource({ trigger: [] }), 'unknown')
  assert.equal(classifySource('字符串'), 'unknown')
  assert.equal(classifySource({ trigger: Object.create(null) }), 'unknown')
})

test('属性 getter 抛错、被撤销的 Proxy：都不抛', () => {
  const boom = { trigger: { kind: 'user-request' } }
  Object.defineProperty(boom, 'action', { get() { throw new Error('boom') } })
  assert.equal(classifySource(boom), 'unknown')

  const boom2 = { action: 'draft_read', trigger: { kind: 'user-request' } }
  Object.defineProperty(boom2.trigger, 'tool', { get() { throw new Error('boom') } })
  assert.equal(classifySource(boom2), 'unknown')

  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  assert.equal(classifySource({ trigger: proxy }), 'unknown')
})

test('describeSource 的异常参数也不抛', () => {
  assert.doesNotThrow(() => describeSource('unknown', { get system() { throw new Error('boom') } }))
  assert.doesNotThrow(() => describeSource(null))
})

test('原型链上的 action/tool 也算"标了"，不能靠继承绕过', () => {
  assert.equal(
    classifySource({
      action: 'draft_delete',
      trigger: Object.create({ kind: 'user-request', action: 'draft_read' })
    }),
    'unknown'
  )
})

test('本次动作一侧标坏（非字符串）也不放过', () => {
  assert.equal(classifySource({ action: 123, trigger: { kind: 'user-request' } }), 'unknown')
  assert.equal(classifySource({ action: 'draft_read', tool: {}, trigger: { kind: 'user-request' } }), 'unknown')
})
test('标了但标坏的动作/工具不等于没标：unknown', () => {
  assert.equal(classifySource({ action: 'draft_delete', trigger: { kind: 'user-request', action: '' } }), 'unknown')
  assert.equal(classifySource({ action: 'draft_delete', trigger: { kind: 'user-request', action: null } }), 'unknown')
  assert.equal(classifySource({ action: 'draft_delete', trigger: { kind: 'user-request', action: 42 } }), 'unknown')
  assert.equal(
    classifySource({ action: 'draft_read', tool: 'self_project_draft', trigger: { kind: 'user-request', tool: '' } }),
    'unknown'
  )
})

test('getter 抛错也不挂到调用点', () => {
  const boom = { action: 'draft_read' }
  Object.defineProperty(boom, 'trigger', { get() { throw new Error('boom') } })
  assert.equal(classifySource(boom), 'unknown')
})

// —— 常量与描述 ——
test('常量与文档一致', () => {
  assert.deepEqual([...SOURCES], ['asked', 'self', 'unknown'])
  assert.deepEqual([...TRIGGER_KINDS], ['user-request', 'user-mention', 'system', 'none'])
})

test('describeSource 只用于展示，不参与判定', () => {
  assert.equal(describeSource('asked'), '用户要求')
  assert.match(describeSource('self'), /自己发起/)
  assert.equal(describeSource('unknown'), '判不出来源')
  assert.equal(describeSource('nonsense'), '未知来源值')
})

test('包入口也能拿到（actionSource 命名空间）', () => {
  assert.equal(typeof core.actionSource.classifySource, 'function')
  assert.equal(core.actionSource.classifySource({ action: 'draft_read', trigger: null }), 'self')
})