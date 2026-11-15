#!/usr/bin/env node
// 全仓语法检查：给每个 .js / .mjs 跑一遍 node --check
// 只检查、不执行；插件那半边也能被 CI 覆盖到
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const roots = ['plugin', 'packages', 'adapters', 'examples', 'tools', 'tests']
const skipDir = new Set(['node_modules', '.git', 'assets', 'frames', 'out'])

const files = []
function walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (skipDir.has(e.name)) continue
      walk(path.join(dir, e.name))
    } else if (/\.(js|mjs)$/.test(e.name)) {
      files.push(path.join(dir, e.name))
    }
  }
}
for (const r of roots) walk(path.join(root, r))

let failed = 0
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (res.status !== 0) {
    failed++
    console.error('语法错误：' + path.relative(root, file))
    console.error((res.stderr || '').split('\n').slice(0, 3).join('\n'))
  }
}
console.log(`语法检查：${files.length - failed}/${files.length} 通过`)
process.exit(failed ? 1 : 0)