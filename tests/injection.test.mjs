// 注入模块：宿主调一个函数就知道这一轮该不该递记忆。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { addExperience, loadAll, reviseExperience } from '../packages/core/lib/self-experience.js'
import { INJECTION_RULES, shouldInject, surface } from '../packages/core/lib/injection.js'

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-'))
  const row = addExperience(dir, { text: '夜里翻完灯塔那一章，守灯人整晚没睡', thought: '她是在等人' })
  return { dir, row }
}

const OWNER_DM = 'local:owner'
const GROUP = 'group:10001'

test('一对一里命中就递一块，并带上 then/now 两段', () => {
  const { dir } = fresh()
  const r = surface(dir, { chatKey: OWNER_DM, text: '灯塔那章你记得吗' })
  assert.equal(r.reason, 'ok')
  assert.ok(r.block.includes('【当时】'))
  assert.ok(r.block.includes('守灯人'))
})

test('群聊一律不递', () => {
  const { dir } = fresh()
  assert.equal(surface(dir, { chatKey: GROUP, text: '灯塔那章' }).reason, 'not-private')
})

test('没命中就不递', () => {
  const { dir } = fresh()
  assert.equal(surface(dir, { chatKey: OWNER_DM, text: '我上周买的股票' }).reason, 'no-hit')
})

test('24 小时内同一条不重复递', () => {
  const { dir } = fresh()
  const seen = {}
  const first = surface(dir, { chatKey: OWNER_DM, text: '灯塔那章', seen })
  assert.equal(first.reason, 'ok')
  first.confirm()
  const second = surface(dir, { chatKey: OWNER_DM, text: '灯塔那章', seen })
  assert.equal(second.reason, 'recently-shown')
})

test('没调 confirm 就不记为想起过', () => {
  const { dir, row } = fresh()
  surface(dir, { chatKey: OWNER_DM, text: '灯塔那章' })
  const after = loadAll(dir).find((x) => x.id === row.id)
  assert.equal(Number(after.recalls || 0), 0)
})

test('confirm 会记一次想起', () => {
  const { dir, row } = fresh()
  surface(dir, { chatKey: OWNER_DM, text: '灯塔那章', seen: {} }).confirm()
  const after = loadAll(dir).find((x) => x.id === row.id)
  assert.ok(Number(after.recalls || 0) >= 1)
})

test('守卫返回 false 时什么都不递', () => {
  const { dir } = fresh()
  const r = surface(dir, { chatKey: OWNER_DM, text: '灯塔那章', guard: () => false })
  assert.equal(r.block, '')
  assert.equal(r.reason, 'vetoed')
})

test('守卫返回 true 也不能绕过别的规则（群聊仍然不递）', () => {
  const { dir } = fresh()
  const r = surface(dir, { chatKey: GROUP, text: '灯塔那章', guard: () => true })
  assert.equal(r.reason, 'not-private')
})

test('shouldInject 只回答是/否', () => {
  assert.equal(shouldInject({ chatKey: GROUP, text: 'x' }).ok, false)
  assert.equal(shouldInject({ chatKey: OWNER_DM, text: '' }).ok, false)
  assert.equal(shouldInject({ chatKey: OWNER_DM, text: '灯塔' }).ok, true)
  const seen = { abc: Date.now() }
  assert.equal(shouldInject({ chatKey: OWNER_DM, text: '灯塔', id: 'abc', seen }).reason, 'recently-shown')
})

test('规则常量与文档一致（八条）', () => {
  assert.equal(INJECTION_RULES.length, 8)
  assert.ok(INJECTION_RULES[0].includes('一对一'))
})

test('后来改过主意的条目，递出去时带上新看法', () => {
  const { dir, row } = fresh()
  reviseExperience(dir, { id: row.id, thought: '她是在等邮船' })
  const r = surface(dir, { chatKey: OWNER_DM, text: '灯塔那章' })
  assert.ok(r.block.includes('等邮船'))
})