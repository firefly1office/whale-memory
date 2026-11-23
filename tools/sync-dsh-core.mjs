#!/usr/bin/env node
// 把 packages/core 的内核同步到 DSH 示例副本，并检查是否漂移
// 用法：node tools/sync-dsh-core.mjs          # 写入副本
//       node tools/sync-dsh-core.mjs --check  # 只校验，漂移则退出 1（CI 用）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const SRC_LIB = path.join(root, 'packages', 'core', 'lib')
const DST_LIB = path.join(root, 'examples', 'dsh-plugin', 'dsh-whale-memory', 'skills', 'whale-memory', 'scripts', 'core', 'lib')
const SRC_CLI = path.join(root, 'adapters', 'cli', 'memory-cli.mjs')
const DST_CLI = path.join(root, 'examples', 'dsh-plugin', 'dsh-whale-memory', 'skills', 'whale-memory', 'scripts', 'memory-cli.mjs')

const check = process.argv.includes('--check')
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

let drift = []
let synced = 0

fs.mkdirSync(DST_LIB, { recursive: true })

for (const name of fs.readdirSync(SRC_LIB).filter((f) => f.endsWith('.js') || f.endsWith('.d.ts'))) {
  const srcFile = path.join(SRC_LIB, name)
  const dstFile = path.join(DST_LIB, name)
  const src = fs.readFileSync(srcFile)
  const dst = fs.existsSync(dstFile) ? fs.readFileSync(dstFile) : null
  if (!dst || sha(src) !== sha(dst)) {
    drift.push(name)
    if (!check) { fs.writeFileSync(dstFile, src); synced += 1 }
  }
}

const srcCli = fs.readFileSync(SRC_CLI, 'utf8').replace(/'\.\.\/\.\.\/packages\/core\/lib\//g, "'./core/lib/")
const dstCli = fs.existsSync(DST_CLI) ? fs.readFileSync(DST_CLI, 'utf8') : null
if (dstCli !== srcCli) {
  drift.push('memory-cli.mjs')
  if (!check) { fs.writeFileSync(DST_CLI, srcCli, 'utf8'); synced += 1 }
}

// whale-drafts 的锁是 core 这份的逐字节副本（它要能单独安装，所以不依赖 core）。
// 漂移检查放在这里：改锁的时候两边必须一起改，检查会红。
const LOCK_SRC = path.join(SRC_LIB, 'file-lock.js')
const LOCK_DST = path.join(root, 'packages', 'drafts', 'lib', 'file-lock.js')
const lockSrc = fs.readFileSync(LOCK_SRC)
const lockDst = fs.existsSync(LOCK_DST) ? fs.readFileSync(LOCK_DST) : null
if (!lockDst || sha(lockSrc) !== sha(lockDst)) {
  drift.push('drafts/lib/file-lock.js')
  if (!check) { fs.mkdirSync(path.dirname(LOCK_DST), { recursive: true }); fs.writeFileSync(LOCK_DST, lockSrc); synced += 1 }
}

if (check && drift.length) {
  console.error('示例副本与 packages/core 漂移：' + drift.join(', '))
  console.error('跑 node tools/sync-dsh-core.mjs 同步后再提交。')
  process.exitCode = 1
} else if (check) {
  console.log('示例副本一致')
} else {
  console.log(`同步完成：${synced} 个文件更新`)
}