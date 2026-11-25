// 存储迁移：JSONL → SQLite。默认只演练，不落盘。
//
// 用法：
//   node tools/migrate-storage.mjs <memory-dir> [--write]
//   node tools/migrate-storage.mjs <memory-dir> --verify-only
//
// 原则：
//   · 源文件一个字都不改（迁移是叠加，不是替换）；
//   · 逐条按 id 对拍：条数相同、每条 JSON 逐字节相同，才算成功；
//   · 任何一条对不上就整体失败——不写"迁移了一半"的库。
import fs from 'node:fs'
import path from 'node:path'
import { openBackend } from '../packages/core/lib/storage/backend.js'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const write = args.includes('--write')
const verifyOnly = args.includes('--verify-only')

if (!dir) {
  console.error('用法：node tools/migrate-storage.mjs <memory-dir> [--write] [--verify-only]')
  process.exit(2)
}

const filePath = path.join(dir, 'self-experience.jsonl')
if (!fs.existsSync(filePath)) {
  console.error('没有找到 ' + filePath + '（这个目录里还没有经历记录）')
  process.exit(2)
}

const file = await openBackend({ kind: 'file', dir })
const rows = await file.all()
console.log('源文件：' + rows.length + ' 条')

const targetPath = path.join(dir, 'memory.sqlite')
if (verifyOnly) {
  if (!fs.existsSync(targetPath)) {
    console.error('没有 memory.sqlite，无法 verify-only')
    process.exit(2)
  }
  const sqlite = await openBackend({ kind: 'sqlite', dir })
  const back = await sqlite.all()
  await sqlite.close()
  compare(rows, back)
  process.exit(0)
}

if (!write) {
  console.log('演练模式：不写盘。加 --write 才会建 memory.sqlite。')
  process.exit(0)
}

if (fs.existsSync(targetPath)) {
  console.error('memory.sqlite 已存在；迁移不覆盖。要重来请先手工移走它。')
  process.exit(3)
}

const sqlite = await openBackend({ kind: 'sqlite', dir })
try {
  await sqlite.transaction(async (db) => {
    for (const row of rows) await db.append(row)
  })
  const back = await sqlite.all()
  compare(rows, back)
  console.log('已写入 ' + targetPath)
} catch (error) {
  // 失败就把半成品删掉，不留一个"迁移了一半"的库
  try { await sqlite.close() } catch {}
  try { fs.rmSync(targetPath, { force: true }) } catch {}
  try { fs.rmSync(targetPath + '-wal', { force: true }) } catch {}
  try { fs.rmSync(targetPath + '-shm', { force: true }) } catch {}
  console.error('迁移失败，已回滚：' + (error?.message || error))
  process.exit(1)
}

function compare(source, back) {
  if (source.length !== back.length) {
    console.error(`条数不一致：源 ${source.length} / 目标 ${back.length}`)
    process.exit(1)
  }
  const byId = new Map(back.map((r) => [r.id, r]))
  for (const row of source) {
    const other = byId.get(row.id)
    if (!other) {
      console.error('目标里缺这条：' + row.id)
      process.exit(1)
    }
    if (JSON.stringify(other) !== JSON.stringify(row)) {
      console.error('这一条内容不一致：' + row.id)
      process.exit(1)
    }
  }
  console.log('逐条对拍通过：' + source.length + ' 条全部一致')
}