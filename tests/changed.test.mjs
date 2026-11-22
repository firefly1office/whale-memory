// 改主意的可见性：只有 then/later 这套数据模型能给出来的东西。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { changedSince, renderChanged } from '../packages/core/lib/changed.js'
import { addExperience, reviseExperience } from '../packages/core/lib/self-experience.js'
import { tmpDir } from './_safety.mjs'

const DAY = 24 * 3600 * 1000

function fresh() {
  return tmpDir('changed-')
}

test('改过主意的会被列出来，带当时和后来两句', () => {
  const dir = fresh()
  const row = addExperience(dir, { text: '读完灯塔那一章', thought: '我以为守灯人怕黑' })
  reviseExperience(dir, { id: row.id, thought: '她在给晚归的船留灯' })
  const list = changedSince(dir, { days: 30 })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, row.id)
  assert.equal(list[0].then, '我以为守灯人怕黑')
  assert.equal(list[0].now, '她在给晚归的船留灯')
})

test('没写过后来的不算改主意', () => {
  const dir = fresh()
  addExperience(dir, { text: '读完灯塔那一章', thought: '我以为守灯人怕黑' })
  assert.deepEqual(changedSince(dir, { days: 30 }), [])
})

test('后来写的是同一句，不算改主意', () => {
  const dir = fresh()
  const row = addExperience(dir, { text: '读完灯塔那一章', thought: '有点冷' })
  reviseExperience(dir, { id: row.id, thought: '有点冷' })
  assert.deepEqual(changedSince(dir, { days: 30 }), [])
})

test('超出天数的旧改动不算', () => {
  const dir = fresh()
  const row = addExperience(dir, { text: '旧事', thought: '当时这么想' })
  reviseExperience(dir, { id: row.id, thought: '后来那么想' })
  const list = changedSince(dir, { days: 30, now: Date.now() + 40 * DAY })
  assert.deepEqual(list, [])
})

test('limit 生效，按最近改的排前面', () => {
  const dir = fresh()
  const a = addExperience(dir, { text: 'A', thought: '旧 A' })
  reviseExperience(dir, { id: a.id, thought: '新 A' })
  const b = addExperience(dir, { text: 'B', thought: '旧 B' })
  reviseExperience(dir, { id: b.id, thought: '新 B' })
  const list = changedSince(dir, { days: 30, limit: 1 })
  assert.equal(list.length, 1)
  assert.ok(['新 A', '新 B'].includes(list[0].now))
})

test('封存的默认不出现在列表里', () => {
  const dir = fresh()
  const row = addExperience(dir, { text: '不想再提', thought: '旧' })
  reviseExperience(dir, { id: row.id, thought: '新' })
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8'), 'utf8')
  // 直接改文件里的 sealed 标记，避免依赖 seal 事件
  const file = path.join(dir, 'self-experience.jsonl')
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  for (const r of rows) if (r.id === row.id) r.sealed = true
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  assert.deepEqual(changedSince(dir, { days: 30 }), [])
  assert.equal(changedSince(dir, { days: 30, includeSealed: true }).length, 1)
})

test('渲染成给人看的一段', () => {
  const text = renderChanged([
    { then: '守灯人怕黑', now: '他在给船留灯', daysAgo: 0 },
    { then: '他是个坏人', now: '他只是护着朋友', daysAgo: 3 }
  ])
  assert.ok(text.includes('你改过主意的事'))
  assert.ok(text.includes('守灯人怕黑'))
  assert.ok(text.includes('3 天前'))
})

test('没有改动时渲染空串', () => {
  assert.equal(renderChanged([]), '')
  assert.equal(renderChanged(null), '')
})