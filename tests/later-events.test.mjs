import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as later from '../packages/core/lib/later-events.js'
import * as exp from '../packages/core/lib/self-experience.js'
import { migrate, rollback } from '../tools/migrate-later-events.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const worker = path.join(root, 'tests', 'fixtures', 'revise-worker.mjs')

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-later-'))
  t.after(() => safeRemove(dir))
  return dir
}

const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')

test('改主意：只追加事件，不重写经历正文', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '翻到灯塔那一章' })
  const file = path.join(dir, 'self-experience.jsonl')
  const before = hash(file)

  const res = exp.reviseExperience(dir, { id: row.id, thought: '现在觉得她在等船' })
  assert.equal(res.ok, true)
  assert.equal(hash(file), before, '经历文件一个字节都不该动')
  assert.equal(later.groupByExp(dir).get(row.id).length, 1)
  assert.equal(exp.currentView(dir, row.id).later.at(-1).thought, '现在觉得她在等船')
})

test('改主意：超长和空白都拒绝，文件不变', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '灯塔' })
  const file = path.join(dir, 'self-experience.jsonl')
  const before = hash(file)

  assert.equal(exp.reviseExperience(dir, { id: row.id, thought: '字'.repeat(1001) }).ok, false)
  assert.equal(exp.reviseExperience(dir, { id: row.id, thought: '   ' }).ok, false)
  assert.equal(hash(file), before)
  assert.equal(later.groupByExp(dir).size, 0)
})

test('改主意：孤儿事件在读取时被忽略', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '灯塔' })
  later.append(dir, { id: 'exp_不存在', thought: '这条不该出现' })
  const all = exp.loadAll(dir)
  assert.equal(all.length, 1)
  assert.equal((all[0].later || []).length, 0)
})

test('并发：3 个进程各改 20 次，60 条一条不丢', async (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '灯塔' })
  const runs = [0, 1, 2].map(() => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, dir, '20', row.id], { stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker exit ' + code))))
  }))
  await Promise.all(runs)

  const view = exp.currentView(dir, row.id)
  assert.equal(view.later.length, 60)
  assert.equal(view.later.filter((l) => String(l.thought).startsWith('worker-')).length, 60)
})

test('迁移：later 数组搬进事件，dry-run 不写，可回滚', (t) => {
  const dir = tmp(t)
  const mem = path.join(dir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })
  const file = path.join(mem, 'self-experience.jsonl')
  const rows = [
    { id: 'x1', day: '2026-11-10', then: { text: '灯塔' }, later: [{ at: '2026-11-11T00:00:00.000Z', thought: '后来懂了' }] },
    { id: 'x2', day: '2026-11-11', then: { text: '折纸' }, later: [] }
  ]
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  const original = fs.readFileSync(file, 'utf8')

  const dry = migrate({ dataDir: dir, apply: false })
  assert.equal(dry.eventsToCreate, 1)
  assert.equal(fs.readFileSync(file, 'utf8'), original)

  const res = migrate({ dataDir: dir, apply: true })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(later.groupByExp(mem).get('x1').length, 1)
  assert.equal(exp.loadAll(mem).find((r) => r.id === 'x1').later.length, 1)
  const after = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(after.every((r) => !('later' in r)), true)

  rollback({ dataDir: dir, backup: res.backup })
  assert.equal(fs.readFileSync(file, 'utf8'), original)
  assert.equal(fs.existsSync(later.eventsFile(mem)), false)
})