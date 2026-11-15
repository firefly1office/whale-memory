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
