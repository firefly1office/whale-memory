// 公开示例必须能直接跑：十行示例的退出码与关键输出。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

test('emotion-intake 的十行示例可以直接运行', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'packages/emotion-intake/example.mjs')], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr)
  assert.ok(res.stdout.includes('写入后日志条数: 1'), res.stdout)
  const last = res.stdout.trim().split(/\r?\n/).pop()
  const out = JSON.parse(last)
  assert.deepEqual(out.self, ['闷'])
  assert.equal(out.write.dim, 'v')
  assert.equal(out.write.value, -0.15)
  assert.equal(out.write.source, 'self_felt')
  assert.equal(out.moment, true)
})