// 跨窗口可见性与脱敏。
import assert from 'node:assert/strict'
import test from 'node:test'
import { CROSS_ROOM_RULE, createAudience, isOwnerRoom, redactSensitive, roomOf } from '../packages/core/lib/conversation-privacy.js'

const OWNER = '10001'
const aud = createAudience({ ownerId: OWNER })
const GROUP = 'group_40101'
const GROUP_B = 'group_40102'
const OWNER_DM = 'private_10001'
const FRIEND = 'private_20002'
const OTHER = 'private_30003'
const LOCAL = 'local:owner'

test('解析会话键', () => {
  assert.deepEqual(roomOf('group_1'), { base: 'group_1', slot: '', key: 'group_1', group: true, private: false, local: false })
  assert.equal(roomOf('group_1#p_ab12cd').slot, 'p_ab12cd')
  assert.equal(roomOf('private_9').private, true)
  assert.equal(roomOf('local:owner').local, true)
  assert.equal(roomOf('随便什么'), null)
})

test('主人窗口识别', () => {
  assert.equal(isOwnerRoom(OWNER_DM, OWNER), true)
  assert.equal(isOwnerRoom(LOCAL, OWNER), true)
  assert.equal(isOwnerRoom(FRIEND, OWNER), false)
  assert.equal(isOwnerRoom(GROUP, OWNER), false)
})

test('主人私聊不流向群', () => {
  assert.equal(aud.permits(OWNER_DM, GROUP), false)
  assert.equal(aud.permits(LOCAL, GROUP), false)
})

test('主人私聊可以流向朋友的私聊（策略可改）', () => {
  assert.equal(aud.permits(OWNER_DM, FRIEND), true)
})

test('群之间的经历可以互换', () => {
  assert.equal(aud.permits(GROUP, GROUP_B), true)
  assert.equal(aud.permits(GROUP, OWNER_DM), true)
})

test('同一个房间只认同一套槽位', () => {
  assert.equal(aud.permits('group_1#p_aa', 'group_1#p_aa'), true)
  assert.equal(aud.permits('group_1#p_aa', 'group_1#p_bb'), false)
  assert.equal(aud.permits('group_1', 'group_1'), true)
})

test('isActive 可以再收紧（例如人设槽位失效）', () => {
  const strict = createAudience({ ownerId: OWNER, isActive: () => false })
  assert.equal(strict.permits(FRIEND, GROUP), false)
})

test('脱敏：数字、链接、邮箱、密钥、长串', () => {
  assert.ok(!redactSensitive('验证码 938475').includes('938475'))
  assert.ok(!redactSensitive('https://a.example.com/x?y=1').includes('example.com'))
  assert.ok(!redactSensitive('发我 a.b@c.com').includes('@'))
  assert.ok(!redactSensitive('密码: hunter2').includes('hunter2'))
  assert.ok(!redactSensitive('token abcdefghijklmnopqrstuvwx').includes('abcdefghijklmnopqrstuvwx'))
})

test('脱敏不误伤普通句子', () => {
  const text = '昨天吃了黄焖鸡，很下饭'
  assert.equal(redactSensitive(text), text)
})

test('规则文本说明「拿不准就不提」', () => {
  assert.ok(CROSS_ROOM_RULE.includes('模糊'))
  assert.ok(CROSS_ROOM_RULE.includes('拿不准就不提'))
})