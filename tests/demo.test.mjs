import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('demo 能跑通：写 → 想起 → 改主意', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'packages/core/demo.mjs'), '--lang', 'zh'], {
    cwd: root, encoding: 'utf8'
  })
  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.match(res.stdout, /\[写\] id=/)
  assert.match(res.stdout, /\[想起\]/)
  assert.doesNotMatch(res.stdout, /什么都没想起来/, 'demo 的查询必须能命中，否则示例等于空转')
  assert.match(res.stdout, /这条被你想起过 1 次/)
  assert.match(res.stdout, /后来你想过/)
})

test('demo --lang en：只会英文的人从头看到尾，输出里一个汉字都没有', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'packages/core/demo.mjs'), '--lang', 'en'], { cwd: root, encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.match(res.stdout, /\[Then\]/)
  assert.match(res.stdout, /\[Now\]/)
  assert.match(res.stdout, /You have recalled this 1 time/)
  assert.match(res.stdout, /Later you thought: /)
  assert.match(res.stdout, /\[Waking up\]/)
  assert.doesNotMatch(res.stdout.replace(/^.*whale-demo-[^\n]*$/gm, ''), /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/, '英文模式不该出现中文字或全角标点')
})
