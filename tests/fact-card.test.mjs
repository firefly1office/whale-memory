// 事实抽取（规则兜底）：常见说法、去重、渲染。
import assert from 'node:assert/strict'
import test from 'node:test'
import { extractFacts, mergeFacts, renderFact } from '../packages/core/lib/fact-card.js'

const kinds = (text) => extractFacts(text).map((f) => `${f.kind}:${f.value}`)

test('项目名', () => {
  assert.deepEqual(kinds('新项目叫鲸舟'), ['project:鲸舟'])
  assert.deepEqual(kinds('代号是蓝鲸'), [])
})

test('预算/金额', () => {
  assert.deepEqual(kinds('这个项目预算三万'), ['budget:三万'])
  assert.deepEqual(kinds('花了 200 块'), ['budget:200 块'])
})

test('喜欢 / 不喜欢', () => {
  assert.deepEqual(kinds('我最爱吃黄焖鸡'), ['like:黄焖鸡'])
  assert.deepEqual(kinds('我不吃香菜'), ['dislike:香菜'])
})

test('所在地 / 名字 / 关系', () => {
  assert.deepEqual(kinds('我住在城西'), ['place:城西'])
  assert.deepEqual(kinds('我叫阿甲'), ['name:阿甲'])
  assert.deepEqual(kinds('我的朋友叫阿乙'), ['relation:阿乙'])
})

test('普通闲聊抽不出东西', () => {
  assert.deepEqual(kinds('今天下雨了'), [])
  assert.deepEqual(kinds(''), [])
})

test('句中带标点：值在标点处截断', () => {
  assert.deepEqual(kinds('我最爱吃黄焖鸡，其次是火锅'), ['like:黄焖鸡'])
})

test('合并：同 kind+value 只留一条，记次数与最新时间', () => {
  const merged = mergeFacts([
    { kind: 'like', value: '黄焖鸡', ts: 1, text: '第一次' },
    { kind: 'like', value: '黄焖鸡', ts: 5, text: '第二次' }
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].count, 2)
  assert.equal(merged[0].ts, 5)
  assert.equal(merged[0].text, '第二次')
})

test('渲染成一行', () => {
  assert.ok(renderFact({ kind: 'like', value: '黄焖鸡' }).includes('黄焖鸡'))
  assert.ok(renderFact({ kind: 'project', value: '鲸舟' }).includes('项目'))
})