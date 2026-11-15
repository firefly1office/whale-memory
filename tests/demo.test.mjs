import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('demo 能跑通：写 → 想起 → 改主意', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'packages/core/demo.mjs')], {
    cwd: root, encoding: 'utf8'
  })
  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.match(res.stdout, /\[写\] id=/)
  assert.match(res.stdout, /\[想起\]/)
  assert.doesNotMatch(res.stdout, /什么都没想起来/, 'demo 的查询必须能命中，否则示例等于空转')
  assert.match(res.stdout, /这条被你想起过 1 次/)
  assert.match(res.stdout, /后来你想过/)
})