// 存储基准：比较 file / sqlite 两个后端的写入与按 id 读取。
//
// 用法：node tools/bench-storage.mjs [--n 20000] [--lookups 1000]
// 只在本机临时目录里造数据，不碰真实记忆。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBackend } from '../packages/core/lib/storage/backend.js'

const args = process.argv.slice(2)
const num = (name, fallback) => {
  const i = args.indexOf('--' + name)
  const v = i >= 0 ? Number(args[i + 1]) : NaN
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}
const N = num('n', 20000)
const LOOKUPS = num('lookups', 1000)

const mk = (i) => ({
  id: 'exp_' + i.toString(36),
  at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
  day: '2026-01-01',
  then: { text: '第 ' + i + ' 条经历的内容，长度接近真实记录', scene: '测试', feeling: ['平静'] }
})

const p = (arr, q) => arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0
const time = async (fn) => { const t = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t) / 1e6 }

for (const kind of ['file', 'sqlite']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bench-' + kind + '-'))
  const backend = await openBackend({ kind, dir })
  const rows = Array.from({ length: N }, (_, i) => mk(i))

  const writeMs = await time(async () => {
    if (kind === 'sqlite') await backend.transaction(async (db) => { for (const r of rows) await db.append(r) })
    else for (const r of rows) await backend.append(r)
  })

  const ids = Array.from({ length: LOOKUPS }, () => rows[Math.floor(Math.random() * rows.length)].id)
  const lat = []
  for (const id of ids) {
    const t = process.hrtime.bigint()
    await backend.byId(id)
    lat.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  const readAllMs = await time(() => backend.all())
  await backend.close()

  console.log(`${kind.padEnd(6)} 写入 ${N} 条 ${writeMs.toFixed(0)}ms  ` +
    `byId p50 ${p(lat, 0.5).toFixed(3)}ms / p99 ${p(lat, 0.99).toFixed(3)}ms  ` +
    `全量读 ${readAllMs.toFixed(0)}ms`)
}