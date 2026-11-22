// 会话作用域键：两种写法、方向不对称（人设→会话可以，会话→人设不行）；私聊判定也在这里。
import assert from 'node:assert/strict'
import test from 'node:test'
import { baseChatKey, isGroupScope, isPersonaScoped, isPrivateScope, recordInScope, scopeKeysFor, variantsOf } from '../packages/core/lib/scope-key.js'

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

test('私聊判定：private_ / private: / local_ / local: 四种写法都认', () => {
  for (const key of ['private_10001', 'private:10001', 'local_owner', 'local:owner', 'private_10001#p_ab12', 'private:10001#p_ab12']) {
    assert.equal(isPrivateScope(key), true, key)
  }
})

test('私聊判定：带群标记的一律不算私聊（哪怕外面套了 private:）', () => {
  for (const key of ['group_123', 'group:123', 'qq:group:1', 'private:group_123', 'private_group_123', 'local:group:1', 'local_group_1', 'private:guild_9', 'local:channel_7', 'private:群聊_1']) {
    assert.equal(isGroupScope(key), true, key)
    assert.equal(isPrivateScope(key), false, key)
  }
})

test('私聊判定：认不出来的一律 false（空键、别家平台的写法、光有个前缀）', () => {
  for (const key of ['', '   ', 'private:', 'private_', 'local:', '随便什么', 'qq:private:10001']) {
    assert.equal(isPrivateScope(key), false, key)
  }
})

test('群标记不误伤账号名里带 group 的私聊', () => {
  assert.equal(isGroupScope('private_groupie_42'), false)
  assert.equal(isPrivateScope('private_groupie_42'), true)
  assert.equal(isPrivateScope('private:groupie'), true)
})