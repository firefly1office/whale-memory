// 跑一遍「第一天读、第二天接」：两个独立进程，模拟关掉应用再打开
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dayScript = path.join(here, 'day.mjs')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-first-day-'))

function run(day) {
  const res = spawnSync(process.execPath, [dayScript, '--day=' + day, '--data=' + dataDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (res.stdout) process.stdout.write(res.stdout)
  if (res.stderr) process.stderr.write(res.stderr)
  if (res.status !== 0) process.exit(res.status || 1)
}

console.log('数据目录：' + dataDir)
run(1)
console.log('\n（应用关闭，进程结束）\n')
run(2)
console.log('\n数据文件：' + fs.readdirSync(dataDir).join(', '))
fs.rmSync(dataDir, { recursive: true, force: true })