#!/usr/bin/env node
// 跑 tests/ 下所有 *.test.mjs；新加测试文件不用再改 CI 列表
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = path.join(root, 'tests')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f))

if (!files.length) {
  console.error('tests/ 下没有 *.test.mjs')
  process.exit(1)
}

console.log('测试文件：' + files.map((f) => path.basename(f)).join(', '))
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(res.status === null ? 1 : res.status)