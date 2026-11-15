import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('组合示例：向量库只给 id，渲染仍走 then/later', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'examples/with-vector/host.mjs')], {
    cwd: root, encoding: 'utf8'
  })
  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.match(res.stdout, /\[向量库\] 已索引 2 条/)
  assert.match(res.stdout, /\[向量库\] 候选：exp_/)
  assert.match(res.stdout, /【当时】/)
  assert.match(res.stdout, /当时想法|当时的想法/)
  assert.match(res.stdout, /后来你想过/)
  assert.match(res.stdout, /召回由宿主负责/)
})