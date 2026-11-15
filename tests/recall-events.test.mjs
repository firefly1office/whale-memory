import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as events from '../packages/core/lib/recall-events.js'
import * as exp from '../packages/core/lib/self-experience.js'
import { migrate, rollback } from '../tools/migrate-recall-events.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const worker = path.join(root, 'tests', 'fixtures', 'append-worker.mjs')

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-events-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')

test('事件：追加、计数、坏行跳过', (t) => {
  const dir = tmp(t)
  events.append(dir, { id: 'a', query: '灯塔' })
  events.append(dir, { id: 'a', query: '灯塔' })
  events.append(dir, { id: 'b' })

  const counts = events.countByExp(dir)
  assert.equal(counts.get('a').count, 2)
  assert.equal(counts.get('b').count, 1)
  assert.equal(events.list(dir, { id: 'a' }).length, 2)

  fs.appendFileSync(events.eventsFile(dir), '{"broken":\n', 'utf8')
  const read = events.readAll(dir)
  assert.equal(read.rows.length, 3)
  assert.equal(read.bad, 1)
})

test('事件：markRecalled 不重写经历正文', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '翻到灯塔那一章' })
  const file = path.join(dir, 'self-experience.jsonl')
  const before = hash(file)

  assert.equal(exp.markRecalled(dir, row.id), true)
  assert.equal(hash(file), before, '经历文件一个字节都不该动')
  assert.equal(exp.currentView(dir, row.id).recalls, 1)

  exp.markRecalled(dir, row.id)
  assert.equal(exp.currentView(dir, row.id).recalls, 2)
  assert.equal(events.countByExp(dir).get(row.id).count, 2)
})

test('迁移：dry-run 不写，apply 后计数一致、可回滚', (t) => {
  const dir = tmp(t)
  const mem = path.join(dir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })
  const file = path.join(mem, 'self-experience.jsonl')
  const rows = [
    { id: 'x1', day: '2026-11-10', then: { text: '灯塔' }, recalls: 2, lastRecalledAt: '2026-11-12T00:00:00.000Z' },
    { id: 'x2', day: '2026-11-11', then: { text: '折纸' }, recalls: 1 },
    { id: 'x3', day: '2026-11-12', then: { text: '码头' }, recalls: 0 }
  ]
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  const original = fs.readFileSync(file, 'utf8')

  const dry = migrate({ dataDir: dir, apply: false })
  assert.equal(dry.ok, true)
  assert.equal(dry.eventsToCreate, 3)
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'dry-run 不能改文件')
  assert.equal(fs.existsSync(events.eventsFile(mem)), false)

  const res = migrate({ dataDir: dir, apply: true })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(events.countByExp(mem).get('x1').count, 2)
  assert.equal(events.countByExp(mem).get('x2').count, 1)

  const after = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(after.every((r) => !('recalls' in r) && !('lastRecalledAt' in r)), true)
  assert.equal(exp.loadAll(mem).find((r) => r.id === 'x1').recalls, 2, '读路径从事件派生')
  assert.equal(fs.existsSync(res.backup), true)

  rollback({ dataDir: dir, backup: res.backup })
  assert.equal(fs.readFileSync(file, 'utf8'), original, '回滚后字节一致')
  assert.equal(fs.existsSync(events.eventsFile(mem)), false)
})

test('并发：4 个进程各追加 25 条，一条不丢', async (t) => {
  const dir = tmp(t)
  const runs = [0, 1, 2, 3].map(() => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, dir, '25', 'exp_shared'], { stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker exit ' + code))))
  }))
  await Promise.all(runs)

  const { rows, bad } = events.readAll(dir)
  assert.equal(bad, 0)
  assert.equal(rows.length, 100)
  assert.equal(events.countByExp(dir).get('exp_shared').count, 100)
})