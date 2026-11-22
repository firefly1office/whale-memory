// 参考宿主：能不能真的跑起来（子进程 + 管道输入）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { safeRemove, tmpDir } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const host = new URL('../examples/reference-host/host.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

test('写下两条、问一句命中、最后能看到自己改过的主意', () => {
  const dir = tmpDir('refhost-')
  const input = ['/write 夜里翻完灯塔那章，守灯人整晚没睡', '/changed', '灯塔那章你记得吗', '/quit'].join('\n')
  const r = spawnSync(process.execPath, [decodeURIComponent(host), '--data', dir], { input, encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  assert.equal(r.status, 0, out)
  assert.ok(out.includes('已写下'), out)
  assert.ok(out.includes('灯塔'))
  assert.ok(out.includes('会把这一段递进上下文'), out)
  safeRemove(dir)
})

test('群聊会话不递记忆', () => {
  const dir = tmpDir('refhost-group-')
  const input = ['/write 夜里翻完灯塔那章', '灯塔那章你记得吗', '/quit'].join('\n')
  const r = spawnSync(process.execPath, [decodeURIComponent(host), '--data', dir, '--chat', 'group:10001'], { input, encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  assert.equal(r.status, 0, out)
  assert.ok(out.includes('not-private'), out)
  assert.ok(!out.includes('会把这一段递进上下文'))
  safeRemove(dir)
})

test('群聊里 /changed 不打印任何原文', () => {
  const dir = tmpDir('refhost-group-changed-')
  // 先造一条改过主意的经历，再进群聊模式敲 /changed
  const input = ['/write 夜里翻完灯塔那章', '/changed', '/quit'].join('\n')
  const r = spawnSync(process.execPath, [decodeURIComponent(host), '--data', dir, '--chat', 'group:10001'], { input, encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  assert.equal(r.status, 0, out)
  assert.ok(out.includes('群聊里不列这些'), out)
  assert.ok(!out.includes('你改过主意的事'), '群聊里不该出现改主意列表：' + out)
  assert.ok(!out.includes('灯塔'), '群聊里不该出现原文：' + out)
  safeRemove(dir)
})