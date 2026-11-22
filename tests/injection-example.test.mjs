import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove, tmpDir } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addExperience, currentView, loadAll, renderTwoPart } from '../packages/core/lib/self-experience.js'
import { surface } from '../examples/injection/inject.mjs'
import { isPrivateKey } from '../packages/core/lib/waking.js'

const root = fileURLToPath(new URL('../', import.meta.url))

function tmp(t) {
  const dir = tmpDir('whale-inject-test-')
  t.after(() => safeRemove(dir))
  return dir
}

test('注入：群聊不递、认不出的会话键不递', (t) => {
  const mem = tmp(t)
  addExperience(mem, { text: '守灯人整晚没睡' })
  for (const key of ['group:936614388', 'qq:group:1', '', 'room:123']) {
    assert.equal(surface(mem, { chatKey: key, text: '守灯人' }).block, '')
  }
  assert.equal(isPrivateKey('private_100000000#p_x'), true)
  assert.equal(isPrivateKey('local:owner'), true)
})

test('注入：没命中就闭嘴，不硬凑', (t) => {
  const mem = tmp(t)
  addExperience(mem, { text: '夜里翻完灯塔那一章，守灯人整晚没睡' })
  const r = surface(mem, { chatKey: 'private_100000000', text: '我昨天买了什么股票' })
  assert.equal(r.block, '')
  assert.equal(r.reason, 'no-hit')
})

test('注入：确认之后才记「想起」，同一条 24 小时内不重复', (t) => {
  const mem = tmp(t)
  const row = addExperience(mem, { text: '守灯人整晚没睡', quote: { text: '潮汐终会归来', source: '《灯塔》' } })
  const seen = {}
  const now = Date.parse('2026-11-16T21:00:00+08:00')

  const first = surface(mem, { chatKey: 'private_100000000', text: '守灯人', seen, now })
  assert.equal(first.reason, 'ok')
  assert.match(first.block, /【当时】/)
  assert.match(first.block, /【现在】/)
  assert.equal(Number(currentView(mem, row.id).recalls || 0), 0, '确认之前不该加次数')

  assert.equal(first.confirm(), true)
  assert.equal(Number(currentView(mem, row.id).recalls || 0), 1)

  const again = surface(mem, { chatKey: 'private_100000000', text: '守灯人', seen, now: now + 60_000 })
  assert.equal(again.block, '')
  assert.equal(again.reason, 'recently-shown')

  const nextDay = surface(mem, { chatKey: 'private_100000000', text: '守灯人', seen, now: now + 25 * 3600e3 })
  assert.equal(nextDay.reason, 'ok')
})

test('提示词模板里的标签必须来自 renderTwoPart 的真实输出', (t) => {
  const mem = tmp(t)
  const row = addExperience(mem, { text: '守灯人整晚没睡', thought: '她在等人' })
  const view = currentView(mem, row.id)
  const block = renderTwoPart(view)
  assert.match(block, /【当时】/)
  assert.match(block, /【现在】/)
  assert.doesNotMatch(block, /【后来】/)
})

test('守卫只能否决，不能放行', (t) => {
  const mem = tmp(t)
  addExperience(mem, { text: '守灯人整晚没睡' })
  const vetoed = surface(mem, { chatKey: 'private_100000000', text: '守灯人', guard: () => false })
  assert.equal(vetoed.reason, 'vetoed')
  assert.equal(vetoed.block, '')
  const noHit = surface(mem, { chatKey: 'private_100000000', text: '我昨天买了什么股票', guard: () => true })
  assert.equal(noHit.reason, 'no-hit')
  assert.equal(noHit.block, '')
})
test('注入示例可跑，输出与规则一致', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'examples/injection/host.mjs')], { cwd: root, encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.match(res.stdout, /\[群聊\].*not-private/)
  assert.match(res.stdout, /\[没命中\].*no-hit/)
  assert.match(res.stdout, /\[第一次\] reason=ok/)
  assert.match(res.stdout, /\[confirm\] true \| recalls=1/)
  assert.match(res.stdout, /\[一分钟后再问\].*recently-shown/)
})