import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove, tmpDir } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as waking from '../packages/core/lib/waking.js'
import * as unfinishedEvents from '../packages/core/lib/unfinished-events.js'

const root = fileURLToPath(new URL('../', import.meta.url))

function tmp(t) {
  const dir = tmpDir('whale-unfinished-')
  t.after(() => safeRemove(dir))
  return dir
}
const memOf = (dataDir) => path.join(dataDir, 'plugin-data', 'biomimetic-memory')
const tomorrow = () => new Date(Date.now() + 24 * 3600e3)

function seed(dataDir, extra = {}) {
  return exp.addExperience(memOf(dataDir), {
    text: '读完灯塔故事的上半篇',
    unfinished: '想知道船有没有回来',
    ...extra
  })
}

test('基线：只写普通后记，次日醒来仍然接着想', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  exp.reviseExperience(memOf(dataDir), { id: row.id, thought: '读完结尾了，船回来了' })
  const block = waking.buildWakingBlock(dataDir, 'local:owner', { now: tomorrow() })
  assert.match(block, /你还没弄完：想知道船有没有回来/)
  assert.equal(exp.currentView(memOf(dataDir), row.id).unfinishedState, undefined)
})

test('想通：次日移出未完列表，翻读显示已想通，后记数不变', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  const res = exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'done' })
  assert.equal(res.ok, true)
  const block = waking.buildWakingBlock(dataDir, 'local:owner', { now: tomorrow() })
  assert.doesNotMatch(block, /你还没弄完：想知道船有没有回来/)

  const view = exp.currentView(memOf(dataDir), row.id)
  assert.equal(view.unfinishedState.choice, 'done')
  assert.equal(view.later.length, 0, '结案不是后记，不能算改主意')
  assert.equal(Number(view.recalls || 0), 0)
  const text = exp.renderTwoPart(view)
  assert.match(text, /当时没弄完的「想知道船有没有回来」：后来想通了（\d{4}-\d{2}-\d{2}）/)
})

test('暂放：次日不提醒，也不自动催；翻读显示先放下', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  assert.equal(exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'shelved' }).ok, true)
  const block = waking.buildWakingBlock(dataDir, 'local:owner', { now: tomorrow() })
  assert.doesNotMatch(block, /你还没弄完/)
  const later = waking.buildWakingBlock(dataDir, 'local:owner', { now: new Date(Date.now() + 5 * 24 * 3600e3) })
  assert.doesNotMatch(later, /你还没弄完/)

  const view = exp.currentView(memOf(dataDir), row.id)
  assert.equal(view.unfinishedState.choice, 'shelved')
  assert.equal(view.later.length, 0)
  assert.match(exp.renderTwoPart(view), /先放下了，还没想通/)
})

test('再接着想：恢复进入未完列表，翻读看得出中间放下过', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'shelved' })
  assert.equal(exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'reopen' }).ok, true)
  const block = waking.buildWakingBlock(dataDir, 'local:owner', { now: tomorrow() })
  assert.match(block, /你还没弄完：想知道船有没有回来/)
  const view = exp.currentView(memOf(dataDir), row.id)
  assert.equal(view.unfinishedState.choice, 'reopen')
  assert.match(exp.renderTwoPart(view), /放下过，后来又决定接着想/)
  assert.deepEqual(view.unfinishedState.history, ['shelved', 'reopen'])
})

test('想通之后再拾起：措辞是「本来觉得想通了」，不是「放下过」', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'done' })
  exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'reopen' })
  const view = exp.currentView(memOf(dataDir), row.id)
  const text = exp.renderTwoPart(view)
  assert.match(text, /想通过一次，后来又决定接着想/)
  assert.doesNotMatch(text, /放下过，后来又决定接着想/)
})
test('按 id 操作：相同未完文字的另一条不受影响', (t) => {
  const dataDir = tmp(t)
  const a = exp.addExperience(memOf(dataDir), { text: '甲', unfinished: '想知道船有没有回来' })
  const b = exp.addExperience(memOf(dataDir), { text: '乙', unfinished: '想知道灯为什么灭了' })
  assert.equal(exp.setUnfinishedState(memOf(dataDir), { id: a.id, choice: 'done' }).ok, true)
  const block = waking.buildWakingBlock(dataDir, 'local:owner', { now: tomorrow() })
  assert.doesNotMatch(block, /想知道船有没有回来/)
  assert.match(block, /想知道灯为什么灭了/)
  assert.equal(exp.currentView(memOf(dataDir), b.id).unfinishedState, undefined)
})

test('错误与幂等：不存在的 id 报错；同一选择重试不写第二条', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  assert.equal(exp.setUnfinishedState(memOf(dataDir), { id: 'exp_nope', choice: 'done' }).ok, false)
  const first = exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'done' })
  assert.equal(first.ok, true)
  const again = exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'done' })
  assert.equal(again.ok, true)
  assert.equal(again.noop, true)
  const { rows } = unfinishedEvents.readAll(memOf(dataDir))
  assert.equal(rows.length, 1)
  const reopen = exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'reopen' })
  assert.equal(reopen.noop, false)
  assert.equal(unfinishedEvents.readAll(memOf(dataDir)).rows.length, 2)
})

test('没有未完内容的经历：结案返回明确错误', (t) => {
  const dataDir = tmp(t)
  const row = exp.addExperience(memOf(dataDir), { text: '只是读了一页' })
  const res = exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'done' })
  assert.equal(res.ok, false)
  assert.match(res.error, /没有「还没弄完」/)
})

test('旧 id 有歧义：不落到任何一条', (t) => {
  const dataDir = tmp(t)
  const mem = memOf(dataDir)
  fs.mkdirSync(mem, { recursive: true })
  fs.writeFileSync(path.join(mem, 'self-experience.jsonl'),
    JSON.stringify({ at: '2026-05-10T10:00:00Z', text: '甲', unfinished: '想知道船' }) + '\n' +
    JSON.stringify({ at: '2026-05-10T10:00:50Z', text: '乙', unfinished: '想知道船' }) + '\n', 'utf8')
  const shared = 'exp_legacy_202605101000'
  const res = exp.setUnfinishedState(mem, { id: shared, choice: 'done' })
  assert.equal(res.ok, false)
  assert.match(res.error, /好几条旧经历共用/)
})

test('先想通再暂放：文案看得出想通过', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'done' })
  exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'shelved' })
  const text = exp.renderTwoPart(exp.currentView(memOf(dataDir), row.id))
  assert.match(text, /想通过一次，后来又决定先放下/)
})

test('多次重提：按最近一次之前的状态渲染', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  for (const c of ['shelved', 'reopen', 'done', 'reopen']) exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: c })
  const view = exp.currentView(memOf(dataDir), row.id)
  assert.deepEqual(view.unfinishedState.history, ['shelved', 'reopen', 'done', 'reopen'])
  assert.match(exp.renderTwoPart(view), /想通过一次，后来又决定接着想/)
})

test('没有文字后记时，不说她没想过', (t) => {
  const dataDir = tmp(t)
  const row = seed(dataDir)
  exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'done' })
  const text = exp.renderTwoPart(exp.currentView(memOf(dataDir), row.id))
  assert.match(text, /还没有文字后记/)
  assert.doesNotMatch(text, /还没回头想过/)
})

test('两个进程同时提交同一选择，只记一次', async (t) => {
  const dataDir = tmp(t)
  const mem = memOf(dataDir)
  const cli = path.join(root, 'adapters/cli/memory-cli.mjs')
  const row = seed(dataDir)
  const lock = path.join(mem, 'unfinished-events.jsonl.lock')
  fs.mkdirSync(lock, { recursive: true })

  const start = () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [cli, 'unfinished', '--id', row.id, '--state', 'done', '--data', dataDir], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (b) => { out += b })
    p.stderr.on('data', (b) => { err += b })
    p.on('error', reject)
    p.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(err + out)))
  })
  const both = Promise.all([start(), start()])
  await new Promise((resolve) => setTimeout(resolve, 700))
  fs.rmdirSync(lock)
  await both

  const view = exp.currentView(mem, row.id)
  assert.deepEqual(view.unfinishedState.history, ['done'])
  assert.equal(unfinishedEvents.readAll(mem).rows.length, 1)
})
test('CLI：unfinished 命令落盘，read 能读回状态', (t) => {
  const dataDir = tmp(t)
  const cli = path.join(root, 'adapters/cli/memory-cli.mjs')
  const run = (args) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--data', dataDir], { encoding: 'utf8' })
    return { status: r.status, json: JSON.parse(r.stdout) }
  }
  assert.equal(run(['write', '--text', '读完上半篇', '--unfinished', '想知道船有没有回来']).status, 0)
  const id = run(['read', '--limit', '1']).json.items[0].id
  const set = run(['unfinished', '--id', id, '--state', 'done'])
  assert.equal(set.status, 0)
  assert.equal(set.json.ok, true)
  const item = run(['read', '--limit', '1']).json.items[0]
  assert.equal(item.unfinished, '想知道船有没有回来')
  assert.equal(item.unfinishedState.choice, 'done')

  const bad = run(['unfinished', '--id', 'exp_nope', '--state', 'done'])
  assert.notEqual(bad.status, 0)
  assert.equal(bad.json.ok, false)
})

test('导出再导入，暂放状态还在', (t) => {
  const dataDir = tmp(t)
  const out = path.join(tmp(t), 'out')
  fs.mkdirSync(out, { recursive: true })
  const cli = path.join(root, 'adapters/cli/memory-cli.mjs')
  const row = seed(dataDir)
  exp.setUnfinishedState(memOf(dataDir), { id: row.id, choice: 'shelved' })
  const e = spawnSync(process.execPath, [cli, 'export', '--data', dataDir, '--out', out], { encoding: 'utf8' })
  const exported = JSON.parse(e.stdout)
  const data2 = tmp(t)
  const i = spawnSync(process.execPath, [cli, 'import', '--data', data2, '--from', exported.dir], { encoding: 'utf8' })
  assert.equal(i.status, 0, i.stderr)
  const view = exp.currentView(memOf(data2), row.id)
  assert.equal(view.unfinishedState.choice, 'shelved')
})