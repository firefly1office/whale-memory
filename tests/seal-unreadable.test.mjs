// 封存日志读不出来时的行为：不能当成"她什么都没封存"。
//
// 监督意见（2026-11-22，审核 000cfdc）：seal-events.readAll 把权限/设备错误
// 与"文件还不存在"一起转成空记录；正文可读、封存日志坏掉时，召回/醒来/书
// 会重新展示本应隐藏的经历。这里把"读失败"做成一个可复现的文件系统状态：
// seal-events.jsonl 是个目录，读它必然报错（并不是 ENOENT）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { renderBook } from '../packages/core/lib/book.js'
import { readAll } from '../packages/core/lib/seal-events.js'
import { addExperience, loadAll } from '../packages/core/lib/self-experience.js'
import { buildWakingBlock } from '../packages/core/lib/waking.js'
import { tmpDir } from './_safety.mjs'

function brokenSealLog() {
  const dir = tmpDir('seal-broken-')
  addExperience(dir, { text: '不该被看见的旧事', thought: '旧想法' })
  fs.mkdirSync(path.join(dir, 'seal-events.jsonl'), { recursive: true })
  return dir
}

test('封存日志读不出来时，readAll 抛错而不是返回空', () => {
  const dir = brokenSealLog()
  assert.throws(() => readAll(dir), /封存日志读不出来/)
})

test('正文可读但封存日志坏了时，loadAll 也要抛错', () => {
  const dir = brokenSealLog()
  assert.throws(() => loadAll(dir), /封存日志读不出来/)
})

test('文件还不存在（ENOENT）仍然按空处理：旧库不该报错', () => {
  const dir = tmpDir('seal-empty-')
  addExperience(dir, { text: '正常经历', thought: '想法' })
  assert.doesNotThrow(() => readAll(dir))
  assert.equal(readAll(dir).rows.length, 0)
  assert.equal(loadAll(dir).length, 1)
})

test('自动展示宁可为空：醒来块与书都不把经历露出来', () => {
  const dir = brokenSealLog()
  const dataDir = tmpDir('seal-display-')
  const memDir = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(memDir, { recursive: true })
  fs.cpSync(dir, memDir, { recursive: true })

  const wake = buildWakingBlock(dataDir, 'private_3249105390')
  assert.equal(wake, '', '醒来块应为空')

  const book = renderBook(memDir)
  assert.equal(book, '', '书应为空')
})