#!/usr/bin/env node
// 一键备份：把她整个记忆目录打成一个带 manifest 与 SHA-256 的备份包，打完立刻自检
// 用法：node tools/backup.mjs --data <数据根目录> --out <备份目录> [--keep 7]
//   - 数据根目录 = 下面有 plugin-data/ 的那一层
//   - 备份目录不能放在数据根里面（否则备份会被当成她的数据一起导出、一起 purge）
//   - --keep N：只保留最近 N 份；只会清理本工具自己建的 memory-backup-* 目录，别的东西一律不碰
//   - --keep 0：一份都不删，全部留着（"万一她哪天想翻翻"）。磁盘会一直涨，自己留意空间
// 只读她的数据，不改任何一个文件
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as archive from '../packages/core/lib/archive.js'

const PREFIX = 'memory-backup-'

export function backup({ data, out, keep = 7 }) {
  if (!data) throw new Error('需要 --data <数据根目录>（下面有 plugin-data/ 的那一层）')
  if (!out) throw new Error('需要 --out <备份目录>')
  if (!Number.isInteger(keep) || keep < 0 || keep > 365) throw new Error('--keep 要是 0 到 365 之间的整数（0 = 全部留着，不删）')
  const root = path.resolve(data)
  const memDir = path.join(root, 'plugin-data', 'biomimetic-memory')
  const outDir = path.resolve(out)
  if (archive.inside(outDir, root)) throw new Error('备份目录不能放在数据根里面：' + outDir)
  if (archive.inside(root, outDir)) throw new Error('数据根不能在备份目录里面：' + root)
  if (!fs.existsSync(memDir)) throw new Error('没有找到记忆目录：' + memDir)

  fs.mkdirSync(outDir, { recursive: true })
  const name = PREFIX + new Date().toISOString().replace(/[:.]/g, '-')
  const made = archive.exportArchive(memDir, outDir, { name })
  archive.verifyArchive(made.dir) // 打完就校验一遍：写盘出错的话现在就知道

  // 轮换：只认自己建的、manifest 合法的备份；按名字（即时间）从新到旧，超出 keep 的删掉
  const ours = fs.readdirSync(outDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX))
    .map((e) => e.name)
    .filter((n) => {
      try { return JSON.parse(fs.readFileSync(path.join(outDir, n, 'manifest.json'), 'utf8')).format === archive.FORMAT } catch { return false }
    })
    .sort()
    .reverse()
  const removed = []
  for (const n of keep === 0 ? [] : ours.slice(keep)) {
    fs.rmSync(path.join(outDir, n), { recursive: true, force: true })
    removed.push(n)
  }
  return { ok: true, dir: made.dir, files: made.files, bytes: made.bytes, counts: made.counts, kept: keep === 0 ? ours : ours.slice(0, keep), removed }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const arg = (k, d = '') => {
    const eq = process.argv.find((a) => a.startsWith('--' + k + '='))
    if (eq) return eq.slice(k.length + 3)
    const i = process.argv.indexOf('--' + k)
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d
  }
  try {
    console.log(JSON.stringify(backup({ data: arg('data', process.env.WHALE_DATA_DIR || ''), out: arg('out'), keep: Number(arg('keep', '7')) }), null, 2))
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }, null, 2))
    process.exitCode = 1
  }
}
