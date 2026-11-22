// 文档样例可执行性：README 用法与接入指南的核心调用必须真的成立。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { selfExperience } from '../packages/core/index.js'
import { scoreTurn } from '../packages/emotion-intake/index.js'

test('README 用法：双方证据与来源值', () => {
  const r = scoreTurn({
    otherText: '我有点难过',
    selfText: '我也有点闷',
    prevAskedSelf: false
  })
  assert.deepEqual(r.selfEvidence, ['闷'])
  assert.deepEqual(r.otherEvidence, ['难过'])
  assert.equal(r.write.source, 'self_felt')
  assert.equal(r.write.value, -0.15)
})

test('接入指南：写入、修订、按写入时刻回看', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-guide-'))
  const { id, at } = selfExperience.addExperience(dir, {
    text: '读到守灯人怕黑',
    thought: '我以为他怕黑'
  })
  assert.ok(id)
  await new Promise((r) => setTimeout(r, 5))
  const revised = selfExperience.reviseExperience(dir, { id, thought: '他在给晚归的船留灯' })
  assert.equal(revised.ok, true)

  const before = selfExperience.currentView(dir, id, { asOf: at })
  assert.equal(before.later.length, 0, '修订前只能看到当时')
  assert.equal(before.then.thought, '我以为他怕黑')

  const after = selfExperience.currentView(dir, id, {})
  assert.equal(after.later.length, 1, '现在能看到后来')
  assert.equal(after.later[0].thought, '他在给晚归的船留灯')
})
test('指南第 3 节：评价对象与体验者区分', () => {
  const r = scoreTurn({ otherText: '房间有点闷', selfText: '我觉得心里闷', prevAskedSelf: false })
  assert.ok(r.otherEvidence.includes('闷'))
  assert.equal(r.write.source, 'self_felt')
  assert.equal(r.write.value, -0.15)

  const evalOnly = scoreTurn({ otherText: '', selfText: '房间有点闷' })
  assert.equal(evalOnly.write, null, '评价对象不是她自己')
})