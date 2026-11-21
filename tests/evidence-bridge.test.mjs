import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import * as exp from '../packages/core/lib/self-experience.js'
import * as bridge from '../packages/core/lib/evidence-from-experience.js'

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bridge-'))
  t.after(() => safeRemove(dir))
  return dir
}

test('桥接：情绪快照成为 fact，as-of 查询给当时那条', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '灯塔那一章读完了', state: { mood: '闷' } })
  const rows = exp.loadAll(dir)
  const facts = bridge.moodFacts(rows)
  assert.equal(facts.length, 1)
  assert.equal(facts[0].subject, 'self')
  assert.equal(facts[0].slot, 'mood')
  assert.equal(facts[0].value, '闷')
})

test('桥接：原文锚成为带出处的 fact', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '读到那句', quote: { text: '灯还亮着', source: '《灯塔》第2章' } })
  const facts = bridge.quoteFacts(exp.loadAll(dir))
  assert.equal(facts.length, 1)
  assert.equal(facts[0].slot, 'quote:《灯塔》第2章')
  assert.equal(facts[0].value, '灯还亮着')
})

test('桥接：问她某天什么心情，没有就说没有', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '灯塔', state: { mood: '闷' } })
  const rows = exp.loadAll(dir)
  const hit = bridge.ask(rows, { slot: 'mood', at: new Date(Date.now() + 1000).toISOString() })
  assert.equal(hit.status, 'known')

  const miss = bridge.ask(rows, { slot: 'mood', at: '2020-01-01T00:00:00Z' })
  assert.equal(miss.status, 'unknown')
})