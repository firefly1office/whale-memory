// 作品稿本：只追加的版本、基线冲突、幂等重放、as-of 读取。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
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

const sha = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 32)
const onlyDraftFile = (dir) => {
  const scopeDir = path.join(dir, 'drafts', sha(SCOPE))
  return path.join(scopeDir, fs.readdirSync(scopeDir).filter((f) => f.endsWith('.jsonl'))[0])
}

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
  const file = onlyDraftFile(dir)
  fs.appendFileSync(file, '这不是 JSON\n', 'utf8')
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(res.ok, true)
  assert.equal(res.text, '好的那句')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('整份都读不出来：unreadable，不假装空', () => {
  const dir = freshDir('all-corrupt')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '原来那句' })
  const file = onlyDraftFile(dir)
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
  const files = fs.readdirSync(scopeDir).filter((f) => f.endsWith('.jsonl'))
  assert.equal(files.length, 1)
  const lines = fs.readFileSync(path.join(scopeDir, files[0]), 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines[0])
  assert.equal(row.text, text)
  assert.equal(row.revision, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('八个进程同时抢同一个基线：只有一个成功，其余 conflict（有起跑栅栏）', async () => {
  const dir = freshDir('race')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '起点' })
  const gate = path.join(dir, 'go')
  const code = (label) => `
    import fs from 'node:fs'
    import { saveDraft } from ${JSON.stringify(PKG)}
    while (!fs.existsSync(${JSON.stringify(gate)})) { /* 等大家一起起跑 */ }
    const res = saveDraft(${JSON.stringify(dir)}, { scopeKey: ${JSON.stringify(SCOPE)}, itemId: ${JSON.stringify(ITEM)}, baseRevision: 1, text: ${JSON.stringify(label)} })
    process.stdout.write(JSON.stringify(res))
  `
  const run = (label) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code(label)], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += String(chunk) })
    child.on('close', () => resolve(JSON.parse(out || '{}')))
  })
  const pending = Array.from({ length: 8 }, (_, i) => run(`第 ${i + 1} 个`))
  // 等子进程都起来了再放行
  await new Promise((r) => setTimeout(r, 400))
  fs.writeFileSync(gate, 'go', 'utf8')
  const results = await Promise.all(pending)
  const oks = results.filter((r) => r && r.ok === true)
  const conflicts = results.filter((r) => r && r.code === 'conflict')
  assert.equal(oks.length, 1, JSON.stringify(results))
  assert.equal(conflicts.length, 7, JSON.stringify(results))
  assert.equal(readDraft(dir, { scopeKey: SCOPE, itemId: ITEM }).revision, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('itemId 里带路径也不会写到数据目录外面', () => {
  const dir = freshDir('traversal')
  const evil = '../../escape'
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: evil, baseRevision: 0, text: '越界试试' })
  assert.equal(res.ok, true)
  // 只在 drafts 目录里落了一个文件
  const inside = fs.readdirSync(path.join(dir, 'drafts'))
  assert.equal(inside.length, 1)
  const scopeDir = path.join(dir, 'drafts', inside[0])
  assert.deepEqual(fs.readdirSync(scopeDir).filter((f) => f.endsWith('.jsonl')).length, 1)
  // 数据目录外面没有多出任何东西
  assert.ok(!fs.existsSync(path.join(dir, '..', 'escape.jsonl')))
  assert.equal(readDraft(dir, { scopeKey: SCOPE, itemId: evil }).text, '越界试试')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('两个作用域用同名 itemId：读不到对方的稿子', () => {
  const dir = freshDir('scope-isolation')
  saveDraft(dir, { scopeKey: 'private:a', itemId: 'same', baseRevision: 0, text: 'a 的' })
  saveDraft(dir, { scopeKey: 'private:b', itemId: 'same', baseRevision: 0, text: 'b 的' })
  assert.equal(readDraft(dir, { scopeKey: 'private:a', itemId: 'same' }).text, 'a 的')
  assert.equal(readDraft(dir, { scopeKey: 'private:b', itemId: 'same' }).text, 'b 的')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('itemId 带换行/控制字符：拒绝，不破坏一行一版的结构', () => {
  const dir = freshDir('bad-id')
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: 'a\nb', baseRevision: 0, text: 'x' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'invalid_input')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('写入不会抹掉读不懂的旧行（byte-for-byte 那条保证）', () => {
  const dir = freshDir('preserve-corrupt')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '第一版' })
  const file = onlyDraftFile(dir)
  fs.appendFileSync(file, '这一行不是 JSON\n', 'utf8')
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '第二版' })
  assert.equal(res.ok, true)
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 3)
  assert.equal(lines[1], '这一行不是 JSON')
  // 读的时候坏行被跳过，但会告诉你有几行读不懂
  const read = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(read.revision, 2)
  assert.equal(read.corrupt, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('版本到顶：拒绝写入，不悄悄裁掉历史', () => {
  const dir = freshDir('limit')
  const scopeDir = path.join(dir, 'drafts', sha(SCOPE))
  fs.mkdirSync(scopeDir, { recursive: true })
  const file = path.join(scopeDir, `${sha(ITEM)}.jsonl`)
  const rows = []
  for (let i = 1; i <= 2000; i += 1) {
    rows.push(JSON.stringify({ v: 1, scopeKey: SCOPE, itemId: ITEM, revision: i, baseRevision: i - 1, operationId: '', at: i, text: `第 ${i} 版` }))
  }
  fs.writeFileSync(file, rows.join('\n') + '\n', 'utf8')
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 2000, text: '再来一版' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'version_limit')
  // 文件没被裁：还是 2000 行
  assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 2000)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('锁被活着的进程占着：返回 busy，不抢锁', () => {
  const dir = freshDir('busy')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '先有一版' })
  const file = onlyDraftFile(dir)
  const lock = `${file}.lock`
  fs.mkdirSync(lock)
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: 'x', acquiredAt: Date.now(), heartbeatAt: Date.now() }), 'utf8')
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '抢不到', lockTimeoutMs: 150 })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'busy')
  fs.rmSync(lock, { recursive: true, force: true })
  const again = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '锁放开后' })
  assert.equal(again.ok, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('幂等重放：调用方重读后基线变了，重试仍然回原回执', () => {
  const dir = freshDir('replay-base')
  const first = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '只该有一版', operationId: 'op-b' })
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '别人又写了一版' })
  const retry = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 9, text: '只该有一版', operationId: 'op-b' })
  assert.equal(retry.ok, true)
  assert.equal(retry.replayed, true)
  assert.equal(retry.revision, first.revision)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('文件末尾停在半行：下一次保存先补换行，旧半行留着当坏行，新版本读得到', () => {
  const dir = freshDir('half-line')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '完整的一版' })
  const file = onlyDraftFile(dir)
  // 模拟写到一半就断电：末尾没有换行
  fs.appendFileSync(file, '{"v":1,"revision":2,"text":"写到一半', 'utf8')
  const res = saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 1, text: '下一版' })
  assert.equal(res.ok, true)
  const read = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(read.revision, 2)
  assert.equal(read.text, '下一版')
  assert.equal(read.corrupt, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('显式读 revision 0：按空稿返回，不报找不到', () => {
  const dir = freshDir('rev0')
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM, revision: 0 })
  assert.equal(res.ok, true)
  assert.equal(res.empty, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('now 传 0 时按 0 记录（不会被 || 吞成当前时间）', () => {
  const dir = freshDir('now-zero')
  saveDraft(dir, { scopeKey: SCOPE, itemId: ITEM, baseRevision: 0, text: '零时刻', now: 0 })
  const res = readDraft(dir, { scopeKey: SCOPE, itemId: ITEM })
  assert.equal(res.at, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})
