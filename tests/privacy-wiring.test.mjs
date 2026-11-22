// 隐私门是一条链：scope-key 的私聊判定 → 醒来块 / 注入 / 未说出口抽屉 / 跨窗口可见性。
// 这里走真实入口，确认没人自己另写一份"不是群就行"。
import assert from 'node:assert/strict'
import test from 'node:test'
import { safeRemove, tmpDir } from './_safety.mjs'
import * as waking from '../packages/core/lib/waking.js'
import * as injection from '../packages/core/lib/injection.js'
import * as unsaid from '../packages/core/lib/unsaid.js'
import * as host from '../packages/core/lib/conversation-privacy.js'
import { isGroupScope, isPrivateScope } from '../packages/core/lib/scope-key.js'
import { addExperience } from '../packages/core/lib/self-experience.js'

function tmp(t) {
  const dir = tmpDir('whale-priv-')
  t.after(() => safeRemove(dir))
  return dir
}

const OWNER_DM_KEYS = ['private_10001', 'private:10001', 'private_10001#p_ab12', 'local:owner', 'local_owner']
// 群：认得出的群写法 + 外面套了 private/local 的群
const GROUP_KEYS = ['group_123', 'group:123', 'qq:group:1', 'private:group_123', 'private_group_123', 'local_group_1', 'local:group:1']
const FAKE_PRIVATE = ['private:group_123', 'private_group_123', 'local_group_1', 'local:group:1']

test('一对一：醒来块 / 注入 / 抽屉 / 跨窗口都放行（四种写法）', (t) => {
  const dir = tmp(t)
  addExperience(dir, { text: '夜里翻完灯塔那一章，守灯人整晚没睡', thought: '她是在等人' })
  const aud = host.createAudience({ ownerId: '10001' })
  for (const key of OWNER_DM_KEYS) {
    assert.equal(isPrivateScope(key), true, key)
    assert.equal(waking.isPrivateKey(key), true, key)
    assert.match(waking.buildWakingBlock(dir, key), /【醒来】/, key)
    assert.equal(injection.shouldInject({ chatKey: key, text: '灯塔那章' }).ok, true, key)
    assert.equal(injection.surface(dir, { chatKey: key, text: '灯塔那章你记得吗' }).reason, 'ok', key)
    assert.equal(unsaid.listUnsaid(dir, { chatKey: key }).ok, true, key)
    const room = host.roomOf(key)
    assert.ok(room && (room.private || room.local), key)
    // 主人私聊里的经历不会默认流向群
    assert.equal(aud.permits(key, 'group_40101'), false, key)
  }
})

test('群：醒来块 / 注入 / 抽屉都不给', (t) => {
  const dir = tmp(t)
  addExperience(dir, { text: '夜里翻完灯塔那一章，守灯人整晚没睡' })
  for (const key of GROUP_KEYS) {
    assert.equal(isPrivateScope(key), false, key)
    assert.equal(waking.isPrivateKey(key), false, key)
    assert.equal(waking.buildWakingBlock(dir, key), '', key)
    assert.equal(waking.consumeWaking(dir, key), false, key)
    assert.deepEqual(injection.shouldInject({ chatKey: key, text: '灯塔那章' }), { ok: false, reason: 'not-private' }, key)
    assert.deepEqual(injection.surface(dir, { chatKey: key, text: '灯塔那章' }), { block: '', reason: 'not-private' }, key)
    const drawer = unsaid.listUnsaid(dir, { chatKey: key })
    assert.equal(drawer.ok, false, key)
    assert.match(drawer.error, /一对一/, key)
    assert.equal(unsaid.leaveUnsaid(dir, { chatKey: key, text: '其实我想问' }).ok, false, key)
  }
})

test('套了 private: 的群一律不算私聊：四个入口同一步拒绝', (t) => {
  const dir = tmp(t)
  addExperience(dir, { text: '夜里翻完灯塔那一章，守灯人整晚没睡' })
  const aud = host.createAudience({ ownerId: '10001' })
  for (const key of FAKE_PRIVATE) {
    assert.equal(isGroupScope(key), true, key)
    assert.equal(waking.isPrivateKey(key), false, key)
    assert.equal(injection.shouldInject({ chatKey: key, text: '灯塔那章' }).reason, 'not-private', key)
    assert.equal(unsaid.listUnsaid(dir, { chatKey: key }).ok, false, key)
    assert.equal(host.roomOf(key), null, key)
    assert.equal(aud.permits(key, 'group_40101'), false, key)
    assert.equal(aud.permits(key, 'private_20002'), false, key)
  }
})

test('缺 ownerId 的可见性判定器在真实入口上也不放行', (t) => {
  const dir = tmp(t)
  addExperience(dir, { text: '夜里翻完灯塔那一章，守灯人整晚没睡' })
  const open = host.createAudience()
  assert.equal(open.permits('private_10001', 'private_20002'), false)
  assert.equal(open.permits('local:owner', 'private_20002'), false)
  assert.equal(open.permits('private_10001', 'group_40101'), false)
  // 私聊门本身不受影响：醒来块和抽屉照常只在私聊里开
  assert.equal(waking.isPrivateKey('private_10001'), true)
  assert.equal(unsaid.listUnsaid(dir, { chatKey: 'private_10001' }).ok, true)
})

test('人设后缀不影响私聊判定；前缀只有一半也不算', () => {
  assert.equal(isPrivateScope('private_10001#p_abcd1234'), true)
  assert.equal(isPrivateScope('private:group_123#p_ab'), false)
  for (const key of ['', '   ', 'private:', 'private_', 'local:', 'qq:private:10001', '随便什么']) {
    assert.equal(isPrivateScope(key), false, key)
    assert.equal(waking.isPrivateKey(key), false, key)
  }
})