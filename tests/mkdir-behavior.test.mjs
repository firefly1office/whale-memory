// 「目录不存在时会不会被建出来」——`docs/limits.md` 的「写入会不会自动建目录」一节靠这个文件撑着。
//
// S12 收尾项 3 的结论：写入口**统一**自动建（不是"一半有一半没有"），所以不改行为，只把边界钉住：
//   · 写：建（含父级）
//   · 读：不建，也不建库
//   · 目标错了：在写任何东西之前就返回失败，不留空目录
//   · 两个故意的例外：markRecalled 不查存在性；erase 一个不存在的 id 会返回 alreadyGone 但目录已建
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  addExperience, loadAll, recall, currentView, reviseExperience, setSealed,
  setUnfinishedState, markRecalled, linkExperiences, badLines
} from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import * as audit from '../packages/core/lib/audit.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import * as unsaid from '../packages/core/lib/unsaid.js'
import * as book from '../packages/core/lib/book.js'
import { exportMemory } from '../packages/core/lib/export-memory.js'
import { tmpDir, safeRemove } from './_safety.mjs'

// 一个三层的、肯定不存在的新目录
const fresh = (t, tag) => {
  const base = tmpDir('wm-mkdir-' + tag + '-')
  t.after(() => safeRemove(base))
  return path.join(base, 'a', 'b', 'mem')
}

test('自动建目录：所有写入口从零开始都能把目录（含父级）建出来', (t) => {
  const dir = fresh(t, 'write')
  assert.equal(fs.existsSync(dir), false)

  const row = addExperience(dir, { text: '从零写一条', unfinished: '还没弄完的事' })
  assert.equal(fs.existsSync(dir), true, '写经历要能建目录')
  assert.ok(fs.existsSync(path.join(dir, 'self-experience.jsonl')))
  assert.equal(loadAll(dir)[0].id, row.id, '建出来的目录里读得回来')

  reviseExperience(dir, { id: row.id, thought: '后记' })
  setSealed(dir, { id: row.id, sealed: true, note: '理由' })
  setUnfinishedState(dir, { id: row.id, choice: 'shelved' })
  assert.equal(markRecalled(dir, row.id), true)
  const ch = chapterEvents.open(dir, { name: '一段日子', from: '2026-11-01' })
  assert.ok(ch.row && ch.row.id)
  audit.noteRead(dir, { actor: 'self', ids: [row.id] })
  assert.equal(unsaid.leaveUnsaid(dir, { chatKey: 'local:owner', kind: 'draft', text: '没说出口' }).ok, true)

  const names = fs.readdirSync(dir).sort()
  for (const expected of ['self-experience.jsonl', 'later-events.jsonl', 'seal-events.jsonl',
    'recall-events.jsonl', 'unfinished-events.jsonl', 'chapter-events.jsonl', 'audit.jsonl']) {
    assert.ok(names.includes(expected), '缺文件：' + expected)
  }
})

test('自动建目录：读路径不建目录、也不建库（空就是空）', (t) => {
  const never = fresh(t, 'read')
  assert.equal(loadAll(never).length, 0)
  assert.equal(recall(never, '随便问点什么').length, 0)
  assert.equal(currentView(never, 'exp_whatever'), null)
  assert.equal(typeof book.renderBook(never), 'string')
  assert.equal(exportMemory(never), '')
  assert.equal(badLines(never), 0)
  assert.equal(fs.existsSync(never), false, '读不许把目录建出来')
  assert.equal(fs.existsSync(path.join(never, 'memory.sqlite')), false, '读不许顺手建库')
})

test('自动建目录：目标记录不存在时，在写任何东西之前就失败（不留空目录）', (t) => {
  const dir = fresh(t, 'wrong')
  const revised = reviseExperience(dir, { id: 'exp_没有这条', thought: '白写' })
  assert.equal(revised.ok, false)
  assert.equal(setSealed(dir, { id: 'exp_没有这条', sealed: true }).ok, false)
  assert.equal(setUnfinishedState(dir, { id: 'exp_没有这条', choice: 'done' }).ok, false)
  assert.equal(linkExperiences(dir, { from: 'exp_a', to: 'exp_b', reason: 'r' }).ok, false)
  assert.equal(fs.existsSync(dir), false, '目标错了就不该留下目录')
})

test('自动建目录：两个故意的例外（markRecalled 不查存在性；erase 不存在的 id 会建出空目录）', (t) => {
  // 例外一：想起次数不查存在性 —— 会建目录并追加一条孤儿事件（读的时候被忽略）
  const recalled = fresh(t, 'recall')
  assert.equal(markRecalled(recalled, 'exp_不存在'), true)
  assert.equal(fs.existsSync(path.join(recalled, 'recall-events.jsonl')), true)
  assert.equal(loadAll(recalled).length, 0, '孤儿想起事件不产生记录')

  // 例外二：撤回一个不存在的 id —— 返回 alreadyGone，但目录已经被建出来（空目录）
  const erased = fresh(t, 'erase')
  const result = eraseExperience(erased, { id: 'exp_从来没有这条', reason: '测试', actor: 'self' })
  assert.equal(result.ok, true)
  assert.equal(result.alreadyGone, true)
  assert.equal(result.tombstone, false, '没看见过记录，写不出墓碑')
  assert.equal(fs.existsSync(erased), true, '目录会被建出来（这一条写进 docs/limits.md 了）')
  assert.deepEqual(fs.readdirSync(erased), [], '建出来的是空目录，没有半条文件')
})