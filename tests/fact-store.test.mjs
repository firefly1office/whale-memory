// 事实卡：读写、去重、相关性挑选。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadFacts, relevantFacts, renderFactsLine, saveFacts } from '../packages/core/lib/fact-store.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'facts-'))
}

test('空目录读出来是空数组', () => {
  const dir = tmpDir()
  assert.deepEqual(loadFacts(dir), [])
})

test('写一条再读回来', () => {
  const dir = tmpDir()
  const r = saveFacts(dir, [{ kind: 'like', value: '黄焖鸡', subject: 'Leo', ts: 1000 }])
  assert.deepEqual(r, { added: 1, updated: 0 })
  const rows = loadFacts(dir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, '黄焖鸡')
  assert.equal(rows[0].count, 1)
})

test('同 kind+value 不重复堆积，count 累加', () => {
  const dir = tmpDir()
  saveFacts(dir, [{ kind: 'like', value: '黄焖鸡', ts: 1000 }])
  const r = saveFacts(dir, [{ kind: 'like', value: '黄焖鸡', ts: 2000, quote: '第二次' }])
  assert.deepEqual(r, { added: 0, updated: 1 })
  const rows = loadFacts(dir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].count, 2)
  assert.equal(rows[0].ts, 2000)
  assert.equal(rows[0].quote, '第二次')
})

test('坏行跳过，不影响好行', () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'fact-cards.jsonl'), '{"kind":"like","value":"火锅"}\nnot-json\n\n', 'utf8')
  const rows = loadFacts(dir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, '火锅')
})

test('写出来的文件是逐行 JSON，方便手改', () => {
  const dir = tmpDir()
  saveFacts(dir, [{ kind: 'project', value: '鲸舟' }, { kind: 'dislike', value: '香菜' }])
  const lines = fs.readFileSync(path.join(dir, 'fact-cards.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  for (const line of lines) assert.ok(JSON.parse(line).kind)
})

test('挑最相关的：提到就优先', () => {
  const facts = [
    { kind: 'like', value: '火锅', count: 1 },
    { kind: 'like', value: '黄焖鸡', count: 5 },
    { kind: 'project', value: '鲸舟', count: 1 }
  ]
  const top = relevantFacts(facts, '晚上吃黄焖鸡吗', { limit: 2 })
  assert.equal(top[0].value, '黄焖鸡')
})

test('没有明显相关的：不硬塞', () => {
  const facts = [{ kind: 'like', value: '火锅', count: 1 }]
  const top = relevantFacts(facts, '今天天气不错', { limit: 3 })
  assert.deepEqual(top, [])
})

test('渲染成一行', () => {
  const line = renderFactsLine([
    { kind: 'like', value: '黄焖鸡' },
    { kind: 'dislike', value: '香菜' }
  ])
  assert.ok(line.startsWith('（你还记得：'))
  assert.ok(line.includes('喜欢黄焖鸡'))
  assert.ok(line.includes('不喜欢香菜'))
})

test('空列表渲染空串', () => {
  assert.equal(renderFactsLine([]), '')
  assert.equal(renderFactsLine(null), '')
})