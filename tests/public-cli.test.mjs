import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
for (const script of ['adapters/cli/memory-cli.mjs', 'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs']) {
  test(script, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cli-test-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    function run(args, status = 0) {
      const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
        cwd: dir, env: { ...process.env, WHALE_DATA_DIR: dir }, encoding: 'utf8'
      })
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
    assert.equal(run(['read']).items.length, 4)
    assert.deepEqual(fs.readFileSync(book).subarray(0, original.length), original)
    const before = fs.readFileSync(book)
    run(['revise', '--id', row.id, '--thought', '再想想'], 1)
    assert.deepEqual(fs.readFileSync(book), before)
  })
}

test('参数边界：空白文本、超长、非法 weight 都拒绝', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cli-edge-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const script = 'adapters/cli/memory-cli.mjs'
  function run(args) {
    return spawnSync(process.execPath, [path.join(root, script), ...args], {
      cwd: dir, env: { ...process.env, WHALE_DATA_DIR: dir }, encoding: 'utf8'
    })
  }
  const blank = run(['write', '--text', '   '])
  assert.equal(blank.status, 1)
  assert.match(JSON.parse(blank.stdout).error, /不能是空白/)

  const tooLong = run(['write', '--text', '字'.repeat(2001)])
  assert.equal(tooLong.status, 1)
  assert.match(JSON.parse(tooLong.stdout).error, /太长/)

  const badWeight = run(['write', '--text', '一句话', '--weight', '爆炸'])
  assert.equal(badWeight.status, 1)
  assert.match(JSON.parse(badWeight.stdout).error, /weight/)
})

test('参数边界：limit 0 = 一条都不要，负数拒绝', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cli-limit-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const script = 'adapters/cli/memory-cli.mjs'
  function run(args) {
    const r = spawnSync(process.execPath, [path.join(root, script), ...args], {
      cwd: dir, env: { ...process.env, WHALE_DATA_DIR: dir }, encoding: 'utf8'
    })
    return { status: r.status, json: JSON.parse(r.stdout) }
  }
  run(['write', '--text', '第一条'])
  run(['write', '--text', '第二条'])

  assert.equal(run(['read', '--limit', '0']).json.items.length, 0)
  assert.equal(run(['recall', '--query', '第一条', '--limit', '0']).json.items.length, 0)

  const neg = run(['read', '--limit', '-1'])
  assert.equal(neg.status, 1)
  assert.match(neg.json.error, /非负整数/)
})

test('空 query 是“最近 N 条”，不是报错也不是硬凑', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cli-empty-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const script = 'adapters/cli/memory-cli.mjs'
  function run(args) {
    return JSON.parse(spawnSync(process.execPath, [path.join(root, script), ...args], {
      cwd: dir, env: { ...process.env, WHALE_DATA_DIR: dir }, encoding: 'utf8'
    }).stdout)
  }
  run(['write', '--text', '第一条'])
  run(['write', '--text', '第二条'])
  const out = run(['recall', '--query', '', '--limit', '2'])
  assert.equal(out.ok, true)
  assert.equal(out.items.length, 2)
})
