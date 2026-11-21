import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import * as waking from '../packages/core/lib/waking.js'
import * as prompt from '../packages/core/lib/self-prompt.js'
import * as settings from '../packages/core/lib/self-settings.js'

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-aux-test-'))
  t.after(() => safeRemove(dir))
  return dir
}

const memDir = (dataDir) => path.join(dataDir, 'plugin-data', 'biomimetic-memory')

function yesterday() {
  return new Date(Date.now() - 86400000).toLocaleDateString('sv-SE')
}

test('醒来块：给昨天的时间线，同一天只给一次', (t) => {
  const dataDir = tmp(t)
  fs.mkdirSync(memDir(dataDir), { recursive: true })
  fs.writeFileSync(
    path.join(memDir(dataDir), 'self-experience.jsonl'),
    JSON.stringify({
      id: 'e1', day: yesterday(), author: 'self',
      then: { text: '读到灯塔那一章', unfinished: '想知道她有没有等到船' }
    }) + '\n',
    'utf8'
  )

  const first = waking.buildWakingBlock(dataDir, 'private_test', { now: new Date() })
  assert.match(first, /【醒来】/)
  assert.match(first, /读到灯塔那一章/)
  assert.match(first, /还没弄完：想知道她有没有等到船/)

  const previewAgain = waking.buildWakingBlock(dataDir, 'private_test', { now: new Date() })
  assert.match(previewAgain, /【醒来】/, '没确认展示之前不消耗今天的额度')

  waking.consumeWaking(dataDir, 'private_test', { now: new Date() })
  const second = waking.buildWakingBlock(dataDir, 'private_test', { now: new Date() })
  assert.equal(second, '', '确认展示后同一天同一会话不再出')

  const otherChat = waking.buildWakingBlock(dataDir, 'private_other', { now: new Date() })
  assert.match(otherChat, /【醒来】/, '去重按会话各自计算')
})

test('醒来块：带上睡前的留言', (t) => {
  const dataDir = tmp(t)
  fs.mkdirSync(memDir(dataDir), { recursive: true })
  fs.writeFileSync(
    path.join(memDir(dataDir), 'notes-to-tomorrow.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), day: yesterday(), text: '明天把第三章读完' }) + '\n',
    'utf8'
  )
  const block = waking.buildWakingBlock(dataDir, 'local:owner', { now: new Date() })
  assert.match(block, /睡前你给今天留了一句：明天把第三章读完/)
})

test('她的提示词：版本只追加，能回退', (t) => {
  const dataDir = tmp(t)
  const v1 = prompt.save(dataDir, '说话短一点', '第一版')
  assert.equal(v1.ok, true)
  const v2 = prompt.save(dataDir, '说话短一点；累的时候更短', '第二版')
  assert.equal(v2.ok, true)
  assert.notEqual(v1.version, v2.version, '同一秒写两次也要有不同版本号')

  assert.equal(prompt.load(dataDir), '说话短一点；累的时候更短')
  const hist = prompt.history(dataDir, 5)
  assert.equal(hist.length, 2)
  assert.equal(hist[0].chars, '说话短一点；累的时候更短'.length)
  assert.equal(hist[0].snapshot, v2.version)
  assert.equal(hist[1].snapshot, v1.version)

  const back = prompt.revert(dataDir, v1.version)
  assert.equal(back.ok, true)
  assert.equal(prompt.load(dataDir), '说话短一点')
  assert.equal(prompt.history(dataDir, 10).length, 3, '回退本身也是一次新版本')

  const evil = prompt.revert(dataDir, '../../../../not-a-snapshot')
  assert.equal(evil.ok, false, '不在 history 里的版本名不能被拼进路径')
  assert.equal(prompt.load(dataDir), '说话短一点', '拒绝后当前内容不变')
})

test('她的提示词：空内容和超长内容都拒绝', (t) => {
  const dataDir = tmp(t)
  assert.equal(prompt.save(dataDir, '   ').ok, false)
  assert.equal(prompt.save(dataDir, 'x'.repeat(prompt.internals.MAX_CHARS + 1)).ok, false)
  assert.equal(prompt.load(dataDir), '')
})

test('她的设置：默认值、修改持久化、改动写进经历', (t) => {
  const dataDir = tmp(t)
  const fresh = settings.load(dataDir)
  assert.equal(fresh.ownTime, settings.DEFAULTS.ownTime)

  const saved = settings.save(dataDir, { ownTime: '23:00-23:40' }, '挪到睡前')
  assert.equal(saved.ownTime, '23:00-23:40')
  assert.equal(settings.load(dataDir).ownTime, '23:00-23:40')

  const rows = fs.readFileSync(path.join(memDir(dataDir), 'self-experience.jsonl'), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, '决定')
  assert.match(rows[0].then.text, /23:00-23:40/)
  assert.equal(rows[0].then.thought, '挪到睡前')
  assert.equal(rows[0].source, 'own-decision')
})
test('隔天延续：用虚拟时钟模拟两天，不靠真等', (t) => {
  const dataDir = tmp(t)
  const mem = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })

  // 11 月 10 日写的经历
  fs.writeFileSync(
    path.join(mem, 'self-experience.jsonl'),
    JSON.stringify({ id: 'd1', day: '2026-11-10', then: { text: '那天读到灯塔最后一页' } }) + '\n',
    'utf8'
  )

  // 11 月 11 日醒来：应该看见 10 号那条
  const day11 = waking.buildWakingBlock(dataDir, 'private_test', { now: new Date('2026-11-11T09:00:00+08:00') })
  assert.match(day11, /读了灯塔最后一页|读到灯塔最后一页/)
  waking.consumeWaking(dataDir, 'private_test', { now: new Date('2026-11-11T09:00:00+08:00') })

  // 同日再来一次：不重复
  const day11again = waking.buildWakingBlock(dataDir, 'private_test', { now: new Date('2026-11-11T21:00:00+08:00') })
  assert.equal(day11again, '')

  // 11 月 12 日：昨天(11 号)没记录，如实说没有
  const day12 = waking.buildWakingBlock(dataDir, 'private_test', { now: new Date('2026-11-12T09:00:00+08:00') })
  assert.match(day12, /昨天你没有留下自己的记录/)
})

test('提示词护栏：重复内容不写、控制字符清理', (t) => {
  const dataDir = tmp(t)
  const first = prompt.save(dataDir, '说话短一点')
  assert.equal(first.ok, true)

  const again = prompt.save(dataDir, '说话短一点')
  assert.equal(again.ok, true)
  assert.equal(again.noop, true)
  assert.equal(prompt.history(dataDir, 10).length, 1, '重复保存不产生新版本')

  const cleaned = prompt.save(dataDir, '说\u200b话\u0000短一点')
  assert.equal(cleaned.noop, true, '清掉不可见字符后与当前一致')
})

test('提示词护栏：篡改能被发现', (t) => {
  const dataDir = tmp(t)
  const saved = prompt.save(dataDir, '说话短一点')
  assert.equal(prompt.verify(dataDir).ok, true)

  fs.writeFileSync(path.join(dataDir, 'plugin-data', 'biomimetic-memory', 'prompt-overlay', 'prompt-overlay.md'), '被改过了', 'utf8')
  const v = prompt.verify(dataDir)
  assert.equal(v.ok, false)
  assert.notEqual(v.activeHash, v.versionHash)
  void saved
})

test('提示词护栏：锁住时写入报错而不是覆盖', (t) => {
  const dataDir = tmp(t)
  prompt.save(dataDir, '第一版')
  const lock = path.join(dataDir, 'plugin-data', 'biomimetic-memory', 'prompt-overlay', '.lock')
  fs.mkdirSync(lock, { recursive: true })
  const res = prompt.save(dataDir, '第二版', '', { timeoutMs: 80 })
  assert.equal(res.ok, false)
  assert.match(res.error, /锁/)
  assert.match(res.error, /locked by another process/)
  safeRemove(lock)
  assert.equal(prompt.load(dataDir), '第一版', '失败时不能动生效文件')
})

test('提示词护栏：拼接默认段，截断要报告', (t) => {
  const dataDir = tmp(t)
  prompt.save(dataDir, '补充一条：累的时候少说两句')

  const short = prompt.render('默认提示词。', dataDir)
  assert.equal(short.appended, true)
  assert.equal(short.truncated, false)
  assert.match(short.text, /默认提示词。/)
  assert.match(short.text, /累的时候少说两句/)

  const hugeBase = 'x'.repeat(prompt.internals.MAX_APPEND_TOTAL)
  const capped = prompt.render(hugeBase, dataDir)
  assert.equal(capped.truncated, true)
  assert.match(capped.note, /截断/)
})

test('醒来块安全默认：没 chatKey 或群聊一律空白', (t) => {
  const dataDir = tmp(t)
  fs.mkdirSync(memDir(dataDir), { recursive: true })
  fs.writeFileSync(
    path.join(memDir(dataDir), 'self-experience.jsonl'),
    JSON.stringify({ id: 'w1', day: yesterday(), then: { text: '昨天私下说的话' } }) + '\n',
    'utf8'
  )

  assert.equal(waking.buildWakingBlock(dataDir, ''), '', '没 chatKey 时不能给内容')
  assert.equal(waking.buildWakingBlock(dataDir, undefined), '')
  assert.equal(waking.buildWakingBlock(dataDir, 'group_123456'), '', '群聊默认不能给')

  const allowed = waking.buildWakingBlock(dataDir, 'group_123456', { allowGroup: true })
  assert.match(allowed, /昨天私下说的话/, '显式 allowGroup 才给')

  assert.equal(waking.consumeWaking(dataDir, ''), false)
  assert.equal(waking.consumeWaking(dataDir, 'group_123456'), false)
})
