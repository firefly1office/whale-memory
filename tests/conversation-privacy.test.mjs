// 跨窗口可见性与脱敏。
import assert from 'node:assert/strict'
import test from 'node:test'
import { CROSS_ROOM_RULE, createAudience, isOwnerRoom, redactSensitive, roomOf } from '../packages/core/lib/conversation-privacy.js'
import { isPrivateScope } from '../packages/core/lib/scope-key.js'

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

test('别人的私聊默认也不流向群，显式 isActive 绕不过', () => {
  assert.equal(aud.permits(FRIEND, GROUP), false)
  assert.equal(aud.permits(FRIEND, GROUP_B), false)
  const permissive = createAudience({ ownerId: OWNER, isActive: () => true })
  assert.equal(permissive.permits(FRIEND, GROUP), false)
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

test('缺 ownerId 时 fail closed：谁的记忆都不跨窗口递', () => {
  for (const aud of [createAudience(), createAudience({}), createAudience({ ownerId: '' }), createAudience({ ownerId: '   ' }), createAudience({ ownerId: null })]) {
    assert.equal(aud.permits(OWNER_DM, GROUP), false, '主人私聊不能默认漏给群')
    assert.equal(aud.permits(LOCAL, GROUP), false)
    assert.equal(aud.permits(OWNER_DM, FRIEND), false)
    assert.equal(aud.permits(GROUP, FRIEND), false)
    assert.equal(aud.permits(FRIEND, GROUP), false)
    assert.equal(aud.permits(GROUP, GROUP_B), false)
    assert.equal(aud.permits(OWNER_DM, OWNER_DM), false, '认不出主人是谁，连同一个房间也不放行')
  }
})

test('私聊两种分隔符都认；主人窗口跟着 ownerId 走', () => {
  assert.equal(roomOf('private:10001').private, true)
  assert.equal(roomOf('private:10001').base, 'private:10001')
  assert.equal(isOwnerRoom('private:10001', OWNER), true)
  assert.equal(isOwnerRoom('private_10001', OWNER), true)
  assert.equal(isOwnerRoom('private:10001', ''), false, '缺 ownerId 时谁都不算主人')
  assert.equal(createAudience({ ownerId: OWNER }).permits('private:10001', GROUP), false, '主人私聊不漏给群')
  assert.equal(createAudience({ ownerId: OWNER }).permits('private:10001', 'private:20002'), true)
  // 账号 ID 不一定是纯数字：认得出是私聊，就按同一个 ownerId 比
  assert.equal(isOwnerRoom('private:fixture-owner', 'fixture-owner'), true)
  assert.equal(isOwnerRoom('private:fixture-owner', OWNER), false)
})

test('带群标记的"私聊"不是私聊房间，也不算主人窗口', () => {
  for (const key of ['private:group_123', 'private_group_123', 'local_group_1', 'local:group:1']) {
    assert.equal(roomOf(key), null, key)
    assert.equal(isOwnerRoom(key, OWNER), false, key)
    assert.equal(createAudience({ ownerId: OWNER }).permits(key, GROUP), false, key)
  }
})

test('两个模块对同一批键的判断一致（私聊判定只有 scope-key 一份实现）', () => {
  const keys = ['private_10001', 'private:10001', 'private_10001#p_ab12', 'local:owner', 'local_owner',
    'private:group_123', 'private_group_123', 'local_group_1', 'group_123', 'group:123', 'qq:group:1', '', '随便什么']
  for (const key of keys) {
    const room = roomOf(key)
    const privateRoom = Boolean(room && (room.private || room.local))
    assert.equal(privateRoom, isPrivateScope(key), key)
  }
})

test('脱敏：数字、链接、邮箱、密钥、长串', () => {
  assert.ok(!redactSensitive('验证码 938475').includes('938475'))
  assert.ok(!redactSensitive('https://a.example.com/x?y=1').includes('example.com'))
  assert.ok(!redactSensitive('发我 a.b@c.com').includes('@'))
  assert.ok(!redactSensitive('密码: hunter2').includes('hunter2'))
  assert.ok(!redactSensitive('token abcdefghijklmnopqrstuvwx').includes('abcdefghijklmnopqrstuvwx'))
})

test('门牌与地址：跟着号/弄/栋/室才脱，裸数字不动', () => {
  assert.ok(!redactSensitive('我住在中山路 88 号').includes('88'))
  assert.ok(!redactSensitive('送到 3 号楼 502 室').includes('502'))
  assert.equal(redactSensitive('这个月花了 3000 块'), '这个月花了 3000 块')
  assert.equal(redactSensitive('2026 年 11 月 20 日'), '2026 年 11 月 20 日')
  assert.equal(redactSensitive('《海上灯塔》第 88 页'), '《海上灯塔》第 88 页')
})

test('脱敏不误伤普通句子', () => {
  const text = '昨天吃了黄焖鸡，很下饭'
  assert.equal(redactSensitive(text), text)
})

test('规则文本说明「拿不准就不提」', () => {
  assert.ok(CROSS_ROOM_RULE.includes('模糊'))
  assert.ok(CROSS_ROOM_RULE.includes('拿不准就不提'))
})