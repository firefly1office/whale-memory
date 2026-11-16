// 跑一遍「第一天读、第二天接」：两个独立进程，模拟关掉应用再打开
// 加 --keep true 保留数据目录，方便接着跑 choose.mjs 看「想通 / 暂放」
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dayScript = path.join(here, 'day.mjs')
const keep = process.argv.includes('--keep') && process.argv[process.argv.indexOf('--keep') + 1] === 'true'
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
// 第 1 天的进程已经结束：第 2 天写下的一切都晚于这一刻，翻回第 1 天就截在这里
const endOfDay1 = new Date().toISOString()
console.log('\n（应用关闭，进程结束）\n')
run(2)
console.log('\n数据文件：' + fs.readdirSync(path.join(dataDir, 'plugin-data', 'biomimetic-memory')).join(', '))
if (keep) {
  console.log('\n数据保留在：' + dataDir)
  console.log('接着试「想通」：node examples/first-day/choose.mjs --data "' + dataDir + '" --state done')
  console.log('接着试「暂放」：node examples/first-day/choose.mjs --data "' + dataDir + '" --state shelved')
  console.log('翻回第 1 天的她：node adapters/cli/memory-cli.mjs read --data "' + dataDir + '" --as-of ' + endOfDay1)
} else {
  fs.rmSync(dataDir, { recursive: true, force: true })
}