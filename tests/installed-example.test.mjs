// 发布产物实测：临时目录打包 → 空项目安装 → 按 README 命令跑示例，并核对候选内容。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = path.join(root, 'packages/emotion-intake')

test('打包产物在空项目里能安装并按 README 运行', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-install-'))
  const packed = spawnSync('npm', ['pack', '--pack-destination', tmp], { cwd: pkg, encoding: 'utf8', shell: true })
  assert.equal(packed.status, 0, packed.stderr)
  const tgz = packed.stdout.trim().split(/\r?\n/).pop()
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'consumer', private: true }), 'utf8')
    const installed = spawnSync('npm', ['install', path.join(tmp, tgz), '--no-audit', '--no-fund'], { cwd: tmp, encoding: 'utf8', shell: true })
    assert.equal(installed.status, 0, installed.stderr)
    const run = spawnSync(process.execPath, ['node_modules/whale-emotion-intake/example.mjs'], { cwd: tmp, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const last = run.stdout.trim().split(/\r?\n/).pop()
    assert.ok(run.stdout.includes('写入后日志条数: 1'), run.stdout)
    const out = JSON.parse(last)
    assert.deepEqual(out.self, ['闷'])
    assert.equal(out.write.dim, 'v')
    assert.equal(out.write.value, -0.15)
    assert.equal(out.write.source, 'self_felt')
    assert.equal(out.moment, true)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})