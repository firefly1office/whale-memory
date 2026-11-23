// 自主行动日志：只存事实（做了什么、谁发起的、结果如何），不存正文、不做推断。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createSelfActionLog, DEFAULT_MAX_LINES } from '../packages/core/lib/self-actions.js'
import * as core from '../packages/core/index.js'

const PKG = pathToFileURL(fileURLToPath(new URL('../packages/core/lib/self-actions.js', import.meta.url))).href
const ACTIONS = ['draft_save', 'draft_read', 'project_start', 'plan_add']

function fresh(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `actions-${label}-`))
  return dir
}

test('core 导出了 selfActions', () => {
  assert.equal(typeof core.selfActions.createSelfActionLog, 'function')
  assert.equal(typeof core.selfActions.record, 'undefined')
})

test('记一条：落盘一行，字段齐全且不含触发原文', () => {
  const dir = fresh('one')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  const res = log.record({ action: 'draft_save', source: 'self', outcome: 'ok', itemRef: 'it_1', triggerLen: 7 })
  assert.equal(res.ok, true)
  const file = path.join(dir, 'self-actions.jsonl')
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines[0])
  assert.equal(row.action, 'draft_save')
  assert.equal(row.source, 'self')
  assert.equal(row.outcome, 'ok')
  assert.equal(row.itemRef, 'it_1')
  assert.equal(row.triggerLen, 7)
  assert.equal(row.triggerDigest, undefined)
  assert.equal(typeof row.day, 'string')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('白名单之外的动作拒绝写入', () => {
  const dir = fresh('whitelist')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  const res = log.record({ action: 'delete_everything' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'invalid_input')
  assert.ok(!fs.existsSync(path.join(dir, 'self-actions.jsonl')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('source 三态：只认 asked/self/unknown，其它一律 unknown', () => {
  const dir = fresh('source')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  log.record({ action: 'draft_save', source: 'self' })
  log.record({ action: 'draft_save', source: 'asked' })
  log.record({ action: 'draft_save', source: 'user' })
  log.record({ action: 'draft_save' })
  const res = log.read()
  assert.deepEqual(res.rows.map((r) => r.source), ['self', 'asked', 'unknown', 'unknown'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('outcome 归一：非法值记 unknown，正常值小写保留', () => {
  const dir = fresh('outcome')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  log.record({ action: 'draft_save', outcome: 'Conflict' })
  log.record({ action: 'draft_save', outcome: '不是枚举' })
  const res = log.read()
  assert.deepEqual(res.rows.map((r) => r.outcome), ['conflict', 'unknown'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('读到顶：超过上限拒绝写入，不裁掉历史', () => {
  const dir = fresh('limit')
  const log = createSelfActionLog({ dir, actions: ACTIONS, maxLines: 3 })
  for (let i = 0; i < 3; i += 1) assert.equal(log.record({ action: 'draft_save', at: 1000 + i }).ok, true)
  const res = log.record({ action: 'draft_save', at: 2000 })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'limit')
  const rows = fs.readFileSync(path.join(dir, 'self-actions.jsonl'), 'utf8').split('\n').filter(Boolean)
  assert.equal(rows.length, 3)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('默认上限是 5000', () => {
  const dir = fresh('default-limit')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  assert.equal(log.maxLines, DEFAULT_MAX_LINES)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('坏行跳过并计数，好行照常读', () => {
  const dir = fresh('corrupt')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  log.record({ action: 'draft_save', at: 1000 })
  fs.appendFileSync(path.join(dir, 'self-actions.jsonl'), '不是 JSON\n', 'utf8')
  const res = log.read()
  assert.equal(res.ok, true)
  assert.equal(res.total, 1)
  assert.equal(res.corrupt, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('末尾停在半行：下一次写入补换行，旧半行留作坏行', () => {
  const dir = fresh('half')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  log.record({ action: 'draft_save', at: 1000 })
  fs.appendFileSync(path.join(dir, 'self-actions.jsonl'), '{"v":1,"action":"draft', 'utf8')
  const res = log.record({ action: 'draft_read', at: 2000 })
  assert.equal(res.ok, true)
  const read = log.read()
  assert.equal(read.total, 2)
  assert.equal(read.corrupt, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('过滤：按动作、来源、结果、时间窗', () => {
  const dir = fresh('filter')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  log.record({ action: 'draft_save', source: 'self', outcome: 'ok', at: 1000 })
  log.record({ action: 'draft_save', source: 'asked', outcome: 'conflict', at: 2000 })
  log.record({ action: 'plan_add', source: 'self', outcome: 'ok', at: 3000 })
  assert.deepEqual(log.read({ action: 'draft_save' }).rows.map((r) => r.at), [1000, 2000])
  assert.deepEqual(log.read({ source: 'self' }).rows.map((r) => r.at), [1000, 3000])
  assert.deepEqual(log.read({ outcome: 'conflict' }).rows.map((r) => r.at), [2000])
  assert.deepEqual(log.read({ since: 1500, until: 2500 }).rows.map((r) => r.at), [2000])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('统计：三态计数 + 按天分组（本地日）', () => {
  const dir = fresh('summarize')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  const day1 = new Date(2026, 10, 22, 7, 59).getTime()
  const day1later = new Date(2026, 10, 22, 8, 1).getTime()
  const day2 = new Date(2026, 10, 23, 12, 0).getTime()
  log.record({ action: 'draft_save', source: 'self', at: day1 })
  log.record({ action: 'draft_save', source: 'asked', at: day1later })
  log.record({ action: 'plan_add', source: 'unknown', at: day2 })
  const s = log.summarize({ now: day2 + 1000, days: 7 })
  assert.equal(s.ok, true)
  assert.equal(s.total, 3)
  assert.deepEqual(s.bySource, { self: 1, asked: 1, unknown: 1 })
  assert.equal(s.daily.length, 2)
  assert.deepEqual(s.daily[0], { day: '2026-11-22', self: 1, asked: 1, unknown: 0 })
  assert.deepEqual(s.daily[1], { day: '2026-11-23', self: 0, asked: 0, unknown: 1 })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('统计只算窗口内', () => {
  const dir = fresh('window')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  const now = Date.now()
  log.record({ action: 'draft_save', source: 'self', at: now - 30 * 86400000 })
  log.record({ action: 'draft_save', source: 'self', at: now - 1000 })
  const s = log.summarize({ now, days: 7 })
  assert.equal(s.total, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('目录不存在也能写（自动建）', () => {
  const dir = path.join(fresh('mkdir'), 'nested', 'deep')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  assert.equal(log.record({ action: 'draft_save' }).ok, true)
  assert.ok(fs.existsSync(path.join(dir, 'self-actions.jsonl')))
  fs.rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true })
})

test('并发：八个进程同时写，行不丢（锁生效）', async () => {
  const dir = fresh('race')
  const code = (i) => `
    import { createSelfActionLog } from ${JSON.stringify(PKG)}
    const log = createSelfActionLog({ dir: ${JSON.stringify(dir)}, actions: ${JSON.stringify(ACTIONS)} })
    const res = log.record({ action: 'draft_save', source: 'self', at: ${1000 + i} })
    process.stdout.write(JSON.stringify(res))
  `
  const run = (i) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code(i)], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (c) => { out += String(c) })
    child.on('close', () => resolve(JSON.parse(out || '{}')))
  })
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => run(i)))
  assert.equal(results.filter((r) => r.ok).length, 8, JSON.stringify(results))
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  assert.equal(log.read().total, 8)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不存触发原文：只留长度和调用方给的摘要', () => {
  const dir = fresh('privacy')
  const log = createSelfActionLog({ dir, actions: ACTIONS })
  log.record({ action: 'draft_save', triggerLen: 3, triggerDigest: 'hmac-abc' })
  const raw = fs.readFileSync(path.join(dir, 'self-actions.jsonl'), 'utf8')
  assert.ok(!raw.includes('第三章'))
  assert.ok(raw.includes('"triggerLen":3'))
  assert.ok(raw.includes('"triggerDigest":"hmac-abc"'))
  fs.rmSync(dir, { recursive: true, force: true })
})