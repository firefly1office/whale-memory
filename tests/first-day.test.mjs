import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('隔天接着读：第二天宿主自己把昨天递回来，不需要 recall 命令', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'examples/first-day/run.mjs')], {
    cwd: root, encoding: 'utf8'
  })
  assert.equal(res.status, 0, res.stderr || res.stdout)
  assert.match(res.stdout, /\[第 1 天\] 她留下了一条经历/)
  assert.match(res.stdout, /应用关闭，进程结束/)
  assert.match(res.stdout, /\[宿主\] 判断相关，把昨天递回来/)
  assert.match(res.stdout, /【递回来的昨天】/)
  assert.match(res.stdout, /我读到的原文：守灯人整晚没睡/)
  assert.match(res.stdout, /她改了主意；原文没有被覆盖/)
  assert.match(res.stdout, /当时：她是在等人回来吧/)
})