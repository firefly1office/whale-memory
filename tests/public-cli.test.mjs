import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove, tmpDir } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

// 两条 CLI 都要跑：README 推荐的 DSH 路径装的必须是同一份内核
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]

function makeRunner(dir, script) {
  return (args) => spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: dir, env: { ...process.env, WHALE_DATA_DIR: dir }, encoding: 'utf8'
  })
}

for (const script of CLIS) {
  test(script, t => {
    const dir = tmpDir('whale-cli-test-')
    t.after(() => safeRemove(dir))
    const runRaw = makeRunner(dir, script)
    function run(args, status = 0) {
      const result = runRaw(args)
      assert.equal(result.status, status, result.stderr || result.stdout)
      return JSON.parse(result.stdout)
    }

    const row = run(['write', '--text', '翻到灯塔那一章', '--thought', '她怕黑'])
    run(['write', '--text', '学会一种新的折纸'])
    run(['write', '--text', '走到码头'])
    assert.equal(run(['read']).items.length, 3)
    assert.equal(run(['recall', '--query', '灯塔']).items[0].id, row.id)
    assert.equal(run(['revise', '--id', row.id, '--thought', '她在等船']).ok, true)
    const revised = run(['read']).items.find(item => item.id === row.id)
    assert.equal(revised.thought, '她怕黑')
    assert.deepEqual(revised.later, ['她在等船'])

    assert.equal(run(['write', '--text'], 1).ok, false)

    const book = path.join(dir, 'plugin-data', 'biomimetic-memory', 'self-experience.jsonl')
    fs.appendFileSync(book, '{"unfinished":')
    const original = fs.readFileSync(book)
    run(['write', '--text', '新的一页'])
    assert.deepEqual(fs.readFileSync(book).subarray(0, original.length), original, '坏行原样保留')

    // 坏行不静默：展示路径 fail closed，不能把 4 条当成"就这些"
    const blocked = runRaw(['read'])
    assert.equal(blocked.status, 1)
    const blockedJson = JSON.parse(blocked.stdout)
    assert.equal(blockedJson.ok, false)
    assert.match(blockedJson.error, /无法解析/)

    const before = fs.readFileSync(book)
    const again = run(['revise', '--id', row.id, '--thought', '再想想'])
    assert.equal(again.ok, true)
    assert.deepEqual(fs.readFileSync(book), before, '改主意不碰经历文件（哪怕有坏行）')

    // 修好坏行（人来做）之后，后记按顺序都在
    const lines = fs.readFileSync(book, 'utf8').split('\n').filter((line) => line.trim())
    fs.writeFileSync(book, lines.filter((line) => { try { JSON.parse(line); return true } catch { return false } }).join('\n') + '\n', 'utf8')
    const latest = run(['read']).items.find(item => item.id === row.id)
    assert.deepEqual(latest.later, ['她在等船', '再想想'])
  })

  test(`参数边界（${path.basename(path.dirname(script))}）：空白、超长、非法 weight 都拒绝`, t => {
    const dir = tmpDir('whale-cli-edge-')
    t.after(() => safeRemove(dir))
    const run = makeRunner(dir, script)

    const blank = run(['write', '--text', '   '])
    assert.equal(blank.status, 1)
    assert.match(JSON.parse(blank.stdout).error, /不能是空白/)
    assert.match(JSON.parse(blank.stdout).error, /^Missing --text \(it cannot be blank\)（/, 'English first, Chinese kept after it')

    const tooLong = run(['write', '--text', '字'.repeat(2001)])
    assert.equal(tooLong.status, 1)
    assert.match(JSON.parse(tooLong.stdout).error, /太长/)

    const badWeight = run(['write', '--text', '一句话', '--weight', '爆炸'])
    assert.equal(badWeight.status, 1)
    assert.match(JSON.parse(badWeight.stdout).error, /weight/)

    const longLater = run(['write', '--text', '一句话'])
    const id = JSON.parse(longLater.stdout).id
    const rev = run(['revise', '--id', id, '--thought', '字'.repeat(1001)])
    assert.equal(rev.status, 1)
    assert.match(JSON.parse(rev.stdout).error, /太长/)
  })

  test(`参数边界（${path.basename(path.dirname(script))}）：limit 0 = 一条都不要，负数拒绝`, t => {
    const dir = tmpDir('whale-cli-limit-')
    t.after(() => safeRemove(dir))
    const run = makeRunner(dir, script)
    run(['write', '--text', '第一条'])
    run(['write', '--text', '第二条'])

    assert.equal(JSON.parse(run(['read', '--limit', '0']).stdout).items.length, 0)
    assert.equal(JSON.parse(run(['recall', '--query', '第一条', '--limit', '0']).stdout).items.length, 0)

    const neg = run(['read', '--limit', '-1'])
    assert.equal(neg.status, 1)
    assert.match(JSON.parse(neg.stdout).error, /非负整数/)
    assert.match(JSON.parse(neg.stdout).error, /--limit must be a non-negative integer/)
  })

  test(`空 query（${path.basename(path.dirname(script))}）：最近 N 条，不是报错也不是硬凑`, t => {
    const dir = tmpDir('whale-cli-empty-')
    t.after(() => safeRemove(dir))
    const run = makeRunner(dir, script)
    run(['write', '--text', '第一条'])
    run(['write', '--text', '第二条'])
    const out = JSON.parse(run(['recall', '--query', '', '--limit', '2']).stdout)
    assert.equal(out.ok, true)
    assert.equal(out.items.length, 2)
  })
}