// 擦除的锁范围：**擦除期间只持 erase.lock，不去抢事件文件自己的 .lock**。
//
// 这一条是 S12 收尾项 1 的回归护栏。做法不是读代码猜，而是真的验证：
// 在同一个进程里先把五个事件文件的锁都拿在手上（withFileLock 不可重入——同一个进程再拿同一把锁
// 会等满 3 秒超时），然后在锁里面调 eraseExperience。
//   · 擦除照常完成 → 说明它根本没去拿那些锁；
//   · 将来谁给擦除加上"顺手拿事件锁"，这条会卡 3 秒然后红。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { addExperience, reviseExperience, loadAll } from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import { withFileLock } from '../packages/core/lib/file-lock.js'
import { tmpDir, safeRemove } from './_safety.mjs'

const EVENT_FILES = [
  'later-events.jsonl',
  'seal-events.jsonl',
  'recall-events.jsonl',
  'unfinished-events.jsonl',
  'link-events.jsonl',
  'chapter-events.jsonl'
]

// 依次拿住每个事件文件的锁，再跑 fn（同步嵌套，全部在同一进程里）
function withAllEventLocks(dir, fn) {
  const step = (i) => {
    if (i >= EVENT_FILES.length) return fn()
    return withFileLock(path.join(dir, EVENT_FILES[i] + '.lock'), () => step(i + 1))
  }
  return step(0)
}

test('擦除的锁范围：别的进程持着事件文件的锁时，擦除照常完成（它不去抢那些锁）', (t) => {
  const dir = tmpDir('wm-erase-lock-')
  t.after(() => safeRemove(dir))
  const row = addExperience(dir, { text: '要被撤回的一条' })
  reviseExperience(dir, { id: row.id, thought: '后记也要一起删' })

  const started = Date.now()
  const result = withAllEventLocks(dir, () => eraseExperience(dir, { id: row.id, reason: '测试：锁范围', actor: 'self' }))
  const elapsed = Date.now() - started

  assert.equal(result.ok, true, '擦除应该成功：' + JSON.stringify(result))
  assert.equal(result.alreadyGone, false)
  assert.equal(result.tombstone, true)
  assert.ok(elapsed < 2000, '擦除耗时 ' + elapsed + 'ms —— 它在等某把事件文件的锁（最多 3 秒超时）')
  assert.equal(loadAll(dir).length, 0, '记录已经撤回')
  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8').includes(row.id), false)
  assert.equal(fs.readFileSync(path.join(dir, 'later-events.jsonl'), 'utf8').includes(row.id), false)
})

test('擦除的锁范围：自己的锁正常释放——目录里不留 erase.lock', (t) => {
  const dir = tmpDir('wm-erase-lock-')
  t.after(() => safeRemove(dir))
  const a = addExperience(dir, { text: '第一条' })
  const b = addExperience(dir, { text: '第二条' })
  eraseExperience(dir, { id: a.id, reason: '测试：释放锁', actor: 'self' })
  assert.equal(fs.existsSync(path.join(dir, 'erase.lock')), false, 'erase.lock 应该被释放')
  // 释放干净才谈得上"串行化"：第二次撤回不会因为上一把锁没删而卡住
  const second = eraseExperience(dir, { id: b.id, reason: '测试：第二次', actor: 'self' })
  assert.equal(second.ok, true)
  assert.equal(loadAll(dir).length, 0)
})