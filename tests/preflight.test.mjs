// 外发预检：正文要扫干净，调用链带出去的东西管不到。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { scanText } from '../tools/preflight.mjs'

const TOOL = fileURLToPath(new URL('../tools/preflight.mjs', import.meta.url))
const ruleIds = (text) => scanText(text).map((h) => h.rule)

test('干净文本：不误报', () => {
  assert.deepEqual(ruleIds('这是一段干净的说明，没有任何路径和编号。'), [])
  assert.deepEqual(ruleIds('测试 625 条，外露 0 次。'), [])
})

test('日期不算账号：20261125 与 2026-11-25 都放行', () => {
  assert.deepEqual(ruleIds('发布于 20261125'), [])
  assert.deepEqual(ruleIds('写于 2026-11-25'), [])
})

test('6–11 位数字命中，5 位与 12 位不命中', () => {
  assert.deepEqual(ruleIds('编号 123456'), ['long-digits'])
  assert.deepEqual(ruleIds('数量 12345'), [])
  assert.deepEqual(ruleIds('长号 123456789012'), [])
})

test('路径与私钥头命中', () => {
  assert.ok(ruleIds('D:\\somewhere\\file.txt').includes('win-path'))
  assert.ok(ruleIds('/Users/example/project').includes('posix-home'))
  assert.ok(ruleIds('-----BEGIN RSA PRIVATE KEY-----').includes('private-key'))
})

test('长十六进制命中，短的不管', () => {
  assert.deepEqual(ruleIds('abcdefabcdefabcdef'), ['long-hex'])
  assert.deepEqual(ruleIds('abcdef01'), [])
})

test('命令行：干净文件退出 0，带编号的文件退出 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'))
  const clean = path.join(dir, 'clean.md')
  const dirty = path.join(dir, 'dirty.md')
  fs.writeFileSync(clean, '普通说明\n', 'utf8')
  fs.writeFileSync(dirty, '联系 13800001234\n', 'utf8')
  const a = spawnSync(process.execPath, [TOOL, clean], { encoding: 'utf8' })
  const b = spawnSync(process.execPath, [TOOL, dirty], { encoding: 'utf8' })
  assert.equal(a.status, 0, a.stdout + a.stderr)
  assert.equal(b.status, 1, b.stdout + b.stderr)
  assert.match(b.stdout, /13800001234/)
  fs.rmSync(dir, { recursive: true, force: true })
})