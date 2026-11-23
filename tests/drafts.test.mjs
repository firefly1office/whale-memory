// 作品稿本：只追加的版本、基线冲突、幂等重放、as-of 读取。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  MAX_TEXT_BYTES,
  saveDraft,
  readDraft,
  listHistory,
} from '../packages/drafts/index.js'

const PKG = pathToFileURL(fileURLToPath(new URL('../packages/drafts/index.js', import.meta.url))).href

function freshDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drafts-${label}-`))
  return dir
}

const SCOPE = 'private:owner'
const ITEM = 'story-1'

test('第一次写：revision 1', () => {
  const dir = freshDir('first')
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '第一句' })
  assert.equal(res.ok, true)
  assert.equal(res.revision, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('连续写：版本递增，最新一次读得到', () => {
  const dir = freshDir('chain')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '第一版' })
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '第二版' })
  const read = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(read.ok, true)
  assert.equal(read.revision, 2)
  assert.equal(read.text, '第二版')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('旧基线：拒绝，并告诉现在是第几版', () => {
  const dir = freshDir('conflict')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '甲' })
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '乙' })
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '丙' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'conflict')
  assert.equal(res.currentRevision, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('旧版本还能原样读回来（不可变）', () => {
  const dir = freshDir('immutable')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '我不记得那一天' })
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '后来想起来了' })
  const old = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM, revision: 1 })
  assert.equal(old.text, '我不记得那一天')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('读一个不存在的版本：revision_missing', () => {
  const dir = freshDir('missing-rev')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '只有一版' })
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM, revision: 9 })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'revision_missing')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('空正文不写', () => {
  const dir = freshDir('empty')
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '   \n  ' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'invalid_input')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('超长正文不写，上限按字节', () => {
  const dir = freshDir('large')
  const text = '字'.repeat(Math.ceil(MAX_TEXT_BYTES / 3) + 1)
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'text_too_large')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('同一个 operationId 同内容重放：回原回执，不多一版', () => {
  const dir = freshDir('replay')
  const first = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '重试的那句', operationId: 'op-1' })
  const again = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '重试的那句', operationId: 'op-1' })
  assert.equal(again.ok, true)
  assert.equal(again.replayed, true)
  assert.equal(again.revision, first.revision)
  const history = listHistory(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(history.versions.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('同一个 operationId 改了内容：operation_conflict', () => {
  const dir = freshDir('op-conflict')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '原来的', operationId: 'op-2' })
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '换过的', operationId: 'op-2' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'operation_conflict')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不同作用域互相看不见', () => {
  const dir = freshDir('scope')
  saveDraft(dir, { scopeKey: 'private:a', itemId: ITEM, baseRevision: 0, text: '给 a 的' })
  const other = readDraft(dir, { scopeKey: 'private:b', itemId: ITEM })
  assert.equal(other.ok, true)
  assert.equal(other.empty, true)
  assert.equal(other.revision, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('asOf：读到那一刻之前的最后一版', () => {
  const dir = freshDir('asof')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '昨天写的', now: 1000 })
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '今天改的', now: 9000 })
  const middle = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM, asOf: 5000 })
  assert.equal(middle.revision, 1)
  assert.equal(middle.text, '昨天写的')
  const latest = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(latest.revision, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('asOf 早于第一版：空实现', () => {
  const dir = freshDir('asof-empty')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '后来的', now: 5000 })
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM, asOf: 1000 })
  assert.equal(res.ok, true)
  assert.equal(res.empty, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('历史：从新到旧，能分页', () => {
  const dir = freshDir('history')
  for (let i = 0; i < 5; i += 1) {
    saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: i, text: `第 ${i + 1} 版` })
  }
  const page1 = listHistory(dir, { scopeKey: SCOPE, itemId: ITEM, limit: 2 })
  assert.deepEqual(page1.versions.map((v) => v.revision), [5, 4])
  assert.equal(page1.nextBefore, 4)
  const page2 = listHistory(dir, { scopeKey: SCOPE, itemId: ITEM, limit: 10, before: page1.nextBefore })
  assert.deepEqual(page2.versions.map((v) => v.revision), [3, 2, 1])
  assert.equal(page2.nextBefore, null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('坏行只跳过自己，好行照常读', () => {
  const dir = freshDir('corrupt')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '好的那句' })
  const file = path.join(dir, 'drafts', fs.readdirSync(path.join(dir, 'drafts'))[0], `${ITEM}.jsonl`)
  fs.appendFileSync(file, '这不是 JSON\n', 'utf8')
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(res.ok, true)
  assert.equal(res.text, '好的那句')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('整份都读不出来：unreadable，不假装空', () => {
  const dir = freshDir('all-corrupt')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '原来那句' })
  const file = path.join(dir, 'drafts', fs.readdirSync(path.join(dir, 'drafts'))[0], `${ITEM}.jsonl`)
  fs.writeFileSync(file, '坏\n也坏\n', 'utf8')
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'unreadable')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('文件还不存在：读出来是空，不是报错', () => {
  const dir = freshDir('no-file')
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: 'nothing-yet' })
  assert.equal(res.ok, true)
  assert.equal(res.empty, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('落盘格式：一行一版，正文原样（不裁切、不改写）', () => {
  const dir = freshDir('verbatim')
  const text = '我不记得那一天，只记得风很大。'
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text })
  const scopeDir = path.join(dir, 'drafts', fs.readdirSync(path.join(dir, 'drafts'))[0])
  const lines = fs.readFileSync(path.join(scopeDir, `${ITEM}.jsonl`), 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines[0])
  assert.equal(row.text, text)
  assert.equal(row.revision, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('两个进程抢同一个基线：一个成功，一个 conflict', async () => {
  const dir = freshDir('race')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '起点' })

  const script = (label) => `
    import { saveDraft } from ${JSON.stringify(PKG)}
    const res = saveDraft(${JSON.stringify(dir)}, { scopeKey: ${JSON.stringify(SCOPE)}, itemId: ${JSON.stringify(ITEM)}, baseRevision: 1, text: ${JSON.stringify(label)} })
    process.stdout.write(JSON.stringify(res))
  `
  const run = (label) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script(label)], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += String(chunk) })
    child.on('close', () => resolve(JSON.parse(out || '{}')))
  })


  const [a, b] = await Promise.all([run('甲写的'), run('乙写的')])
  const oks = [a, b].filter((r) => r && r.ok === true)
  const conflicts = [a, b].filter((r) => r && r.code === 'conflict')
  assert.equal(oks.length, 1)
  assert.equal(conflicts.length, 1)
  assert.equal(readDraft(dir, { scopeKey: SCOPE, itemId: ITEM }).revision, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})