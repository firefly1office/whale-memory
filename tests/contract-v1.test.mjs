// v1 契约测试：当前实现必须过。
// 只断言「契约里写了什么」，不测内部实现细节；实现换了（比如换存储引擎）这套测试不该改。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { addExperience, loadAll, setSealed, reviseExperience, recall } from '../packages/core/lib/self-experience.js'

const repo = path.resolve(import.meta.dirname, '..')
const schema = JSON.parse(fs.readFileSync(path.join(repo, 'schemas', 'record.v1.json'), 'utf8'))

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wm-contract-'))
const rowsOf = (dir) => fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('契约 §2.2：写入返回的是一整条记录，必填字段都在', () => {
  const dir = tmp()
  const row = addExperience(dir, { text: '今天把柜子修好了' })
  for (const key of schema.required) assert.ok(key in row, '缺必填字段：' + key)
  assert.match(row.id, /^exp_[a-z0-9]+$/)
  assert.equal(row.then.text, '今天把柜子修好了')
  assert.ok(Array.isArray(row.later) && row.later.length === 0, 'later 写入时必须为空数组')
  assert.equal(row.status, 'kept')
})

test('契约 §2.2：落盘那一行符合 schema 的必填与类型', () => {
  const dir = tmp()
  addExperience(dir, { text: '一', feeling: ['平静'], weight: 'minor' })
  const line = rowsOf(dir)[0]
  for (const key of schema.required) assert.ok(key in line)
  assert.equal(typeof line.id, 'string')
  assert.equal(typeof line.then.text, 'string')
  assert.ok(line.then.text.length <= schema.properties.then.properties.text.maxLength)
  assert.ok(['important', 'normal', 'minor'].includes(line.weight))
})

test('契约 §3.1：非法输入抛错，不写半成品', () => {
  const dir = tmp()
  assert.throws(() => addExperience(dir, { text: '' }))
  assert.throws(() => addExperience(dir, { text: 'x'.repeat(2001) }))
  assert.throws(() => addExperience(dir, { text: 'ok', feeling: Array.from({ length: 9 }, (_, i) => 'f' + i) }))
  const file = path.join(dir, 'self-experience.jsonl')
  assert.equal(fs.existsSync(file) ? rowsOf(dir).length : 0, 0, '抛错的调用不该留下记录')
})

test('契约 §1：记录不可变——改主意只追加事件，原行一个字节都不变', () => {
  const dir = tmp()
  const row = addExperience(dir, { text: '想去学游泳' })
  const before = rowsOf(dir)[0]
  reviseExperience(dir, { id: row.id, thought: '不想学了，改成跑步' })
  const after = rowsOf(dir)[0]
  assert.deepEqual(after, before, '原记录必须原样保留')
  assert.equal(fs.existsSync(path.join(dir, 'later-events.jsonl')), true, '改主意要落事件文件')
})

test('契约 §3.4：封存不删除，召回过滤、原始文件里还在', () => {
  const dir = tmp()
  const row = addExperience(dir, { text: '一件不想再被提起的事' })
  const res = setSealed(dir, { id: row.id, sealed: true, note: '先放着' })
  assert.equal(res.ok, true)
  assert.equal(res.noop, false, '第一次封存不是 noop')
  const seen = loadAll(dir).find((r) => r.id === row.id)
  assert.ok(seen, '记录还在')
  assert.ok(seen.sealed, 'loadAll 必须带上 sealed 状态，交调用方过滤')
  assert.equal(recall(dir, '一件不想再被提起的事', { limit: 5 }).some((r) => r.id === row.id), false, '召回必须过滤封存')
  assert.ok(rowsOf(dir).some((r) => r.id === row.id), '原始文件里必须还在——封存不是删除')
})

test('契约 §3.4：重复封存是 noop，不是错误', () => {
  const dir = tmp()
  const row = addExperience(dir, { text: '一件事' })
  setSealed(dir, { id: row.id, sealed: true })
  const again = setSealed(dir, { id: row.id, sealed: true })
  assert.equal(again.ok, true)
  assert.equal(again.noop, true)
})

test('契约 §3.4：目标不存在返回 ok:false，不抛异常', () => {
  const dir = tmp()
  const res = setSealed(dir, { id: 'exp_不存在', sealed: true })
  assert.equal(res.ok, false)
  assert.match(res.error, /not found|找不到/i)
})

test('契约 §3.2 / §3.3：id 稳定、召回可重复', () => {
  const dir = tmp()
  addExperience(dir, { text: '上周去了杭州看桂花' })
  addExperience(dir, { text: '在西湖边吃了碗面' })
  const a = loadAll(dir).map((r) => r.id)
  const b = loadAll(dir).map((r) => r.id)
  assert.deepEqual(a, b)
  const r1 = recall(dir, '杭州 桂花', { limit: 5 }).map((r) => r.id)
  const r2 = recall(dir, '杭州 桂花', { limit: 5 }).map((r) => r.id)
  assert.deepEqual(r1, r2, '同一查询两次结果顺序必须一致')
})

test('契约 §2.3：as-of 只看那一刻已存在的记录', () => {
  const dir = tmp()
  addExperience(dir, { text: '很早以前的事' })
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  assert.equal(loadAll(dir, { asOf: past }).length, 0, 'as-of 到写入之前应当看不到')
  assert.equal(loadAll(dir, { asOf: future }).length, 1)
})