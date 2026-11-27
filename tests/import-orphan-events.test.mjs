// 恢复备份不该带回指向已撤回记录的孤儿事件行（N4 finding）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { exportArchive, importArchive } from '../packages/core/lib/archive.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import { addExperience, reviseExperience, loadAll } from '../packages/core/lib/self-experience.js'
import { readAll as laterReadAll } from '../packages/core/lib/later-events.js'

const mk = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-events-'))
  const mem = path.join(root, 'mem')
  fs.mkdirSync(mem, { recursive: true })
  return { root, mem }
}

test('恢复后：指向已撤回 id 的后记被剔掉，并计数', () => {
  const { root, mem } = mk()
  const row = addExperience(mem, { text: '会被撤回的经历', thought: '当时想法' })
  reviseExperience(mem, { id: row.id, thought: '后来改的主意' })
  assert.equal(laterReadAll(mem).rows.length, 1)

  const ex = exportArchive(mem, path.join(root, 'backups'))
  eraseExperience(mem, { id: row.id, reason: '测试', actor: 'leo' })
  assert.equal(loadAll(mem).length, 0)
  assert.equal(laterReadAll(mem).rows.length, 0)

  const im = importArchive(ex.dir, mem, { force: true })
  assert.equal(im.ok, true)
  assert.equal(loadAll(mem).length, 0)
  assert.equal(laterReadAll(mem).rows.length, 0, '孤儿后记应被剔掉')
  assert.equal(im.skippedOrphanEvents, 1, '剔掉条数应报给调用方')
  fs.rmSync(root, { recursive: true, force: true })
})

test('没撤回时：恢复照常把经历和后记一起带回来', () => {
  const { root, mem } = mk()
  const row = addExperience(mem, { text: '一条普通经历', thought: '想法' })
  reviseExperience(mem, { id: row.id, thought: '后记' })
  const ex = exportArchive(mem, path.join(root, 'backups'))
  fs.rmSync(mem, { recursive: true, force: true })
  fs.mkdirSync(mem, { recursive: true })
  const im = importArchive(ex.dir, mem, { force: true })
  assert.equal(im.ok, true)
  assert.equal(loadAll(mem).length, 1)
  assert.equal(laterReadAll(mem).rows.length, 1)
  assert.equal(im.skippedOrphanEvents, 0)
  fs.rmSync(root, { recursive: true, force: true })
})