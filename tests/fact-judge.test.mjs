// 事实判断（模型层）：规范化、引文校验、失败处理。
import assert from 'node:assert/strict'
import test from 'node:test'
import { judgeFacts } from '../packages/core/lib/fact-judge.js'

const messages = [
  { ref: 'M1', sender: '阿甲', text: '我最爱吃黄焖鸡', ts: 1000 },
  { ref: 'M2', sender: '阿乙', text: '我住在城西', ts: 2000 }
]

const reply = (facts) => async () => ({
  choices: [{ message: { content: JSON.stringify({ facts }) } }]
})

test('正常抽取：规范成 kind/value/subject/quote', async () => {
  const facts = await judgeFacts({
    messages,
    chatCompletion: reply([
      { kind: 'like', value: '黄焖鸡', subject: '阿甲', quote: '我最爱吃黄焖鸡', ref: 'M1' }
    ])
  })
  assert.equal(facts.length, 1)
  assert.equal(facts[0].kind, 'like')
  assert.equal(facts[0].value, '黄焖鸡')
  assert.equal(facts[0].ts, 1000)
})

test('引文和原文对不上：这条不采信', async () => {
  const facts = await judgeFacts({
    messages,
    chatCompletion: reply([
      { kind: 'project', value: '鲸舟', subject: '阿甲', quote: '完全没出现过的话', ref: 'M1' }
    ])
  })
  assert.deepEqual(facts, [])
})

test('kind 不在白名单：丢弃', async () => {
  const facts = await judgeFacts({
    messages,
    chatCompletion: reply([{ kind: '胡编', value: 'x', ref: 'M1' }])
  })
  assert.deepEqual(facts, [])
})

test('值为空：丢弃', async () => {
  const facts = await judgeFacts({
    messages,
    chatCompletion: reply([{ kind: 'like', value: '   ', ref: 'M1' }])
  })
  assert.deepEqual(facts, [])
})

test('模型返回非 JSON：抛错（由调用方决定重试）', async () => {
  await assert.rejects(
    () => judgeFacts({ messages, chatCompletion: async () => ({ choices: [{ message: { content: '不是 JSON' } }] }) }),
    /未返回有效 JSON/
  )
})

test('没有消息：直接返回空，不调用模型', async () => {
  let called = false
  const facts = await judgeFacts({ messages: [], chatCompletion: async () => { called = true; return {} } })
  assert.deepEqual(facts, [])
  assert.equal(called, false)
})