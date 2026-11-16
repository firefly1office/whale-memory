import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-doctor-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

for (const cli of CLIS) {
  test('doctor：空目录也能体检，全部能力项通过（' + cli + '）', (t) => {
    const data = tmp(t)
    const r = spawnSync(process.execPath, [path.join(root, cli), 'doctor', '--data', data], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const j = JSON.parse(r.stdout)
    assert.equal(j.ok, true)
    assert.equal(j.checks.length, 6)
    assert.ok(j.checks.some((c) => c.name === '出处完整'), '0.12 起体检出处是否完整')
    for (const c of j.checks) assert.equal(c.ok, true, c.name + ': ' + c.detail)
  })

  test('doctor：导出导入探针真的走了一遍（' + cli + '）', (t) => {
    const data = tmp(t)
    const cliPath = path.join(root, cli)
    assert.equal(spawnSync(process.execPath, [cliPath, 'write', '--data', data, '--text', '真的有数据'], { encoding: 'utf8' }).status, 0)
    const r = spawnSync(process.execPath, [cliPath, 'doctor', '--data', data], { encoding: 'utf8' })
    const j = JSON.parse(r.stdout)
    assert.equal(j.ok, true)
    const ex = j.checks.find((c) => c.name === '导出→导入（临时目录）')
    assert.equal(ex.ok, true)
    assert.match(ex.detail, /导出包能完整导回/)
  })
}