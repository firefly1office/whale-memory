// 会话作用域键：两种写法、方向不对称（人设→会话可以，会话→人设不行）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { baseChatKey, isPersonaScoped, recordInScope, scopeKeysFor, variantsOf } from '../packages/core/lib/scope-key.js'

test('去掉人设后缀', () => {
  assert.equal(baseChatKey('group_123#p_abcd1234'), 'group_123')
  assert.equal(baseChatKey('private_9#p_ff'), 'private_9')
  assert.equal(baseChatKey('group_123'), 'group_123')
  assert.equal(baseChatKey(''), '')
})

test('是否人设级', () => {
  assert.equal(isPersonaScoped('group_1#p_ab12'), true)
  assert.equal(isPersonaScoped('group_1'), false)
  assert.equal(isPersonaScoped(''), false)
})

test('人设级查询覆盖两层', () => {
  assert.deepEqual(scopeKeysFor('group_1#p_ab12'), ['group_1#p_ab12', 'group_1'])
})

test('会话级查询只覆盖自己（不反向串人设）', () => {
  assert.deepEqual(scopeKeysFor('group_1'), ['group_1'])
  assert.equal(recordInScope('group_1#p_ab12', 'group_1'), false)
})

test('人设级查询能看到会话级记录', () => {
  assert.equal(recordInScope('group_1', 'group_1#p_ab12'), true)
  assert.equal(recordInScope('group_1#p_ab12', 'group_1#p_ab12'), true)
})

test('别的会话不在范围内', () => {
  assert.equal(recordInScope('group_2', 'group_1#p_ab12'), false)
  assert.equal(recordInScope('group_2', 'group_1'), false)
})

test('不限定会话时全部在内', () => {
  assert.equal(recordInScope('group_9', ''), true)
  assert.equal(recordInScope('', ''), true)
})

test('空记录键 + 限定会话：不在范围', () => {
  assert.equal(recordInScope('', 'group_1'), false)
})

test('variantsOf 去重且稳定', () => {
  assert.deepEqual(variantsOf('group_1#p_ab'), ['group_1', 'group_1#p_ab'])
  assert.deepEqual(variantsOf('group_1'), ['group_1'])
  assert.deepEqual(variantsOf(''), [])
})