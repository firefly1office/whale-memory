// 墓碑（阶段 4）：一条经历被**整条撤回**之后，只留这一行。
//
// 一行一个 { v: 1, id, at, reason, actor, hash, ids? }：
//   · id     被撤回那条经历的 id（不透明，永不复用；墓碑里留着它，才能核"这条存在过、被撤回了"）
//   · at     撤回时间（ISO 8601）
//   · reason 为什么撤（人写的，短句；这是唯一由人提供的字段）
//   · actor  谁要求的（self / leo / host……，由宿主决定）
//   · hash   删除前那一行的 sha256（那一行原样字节，不含行尾换行；CRLF 的 \r 也不算）
//   · ids    可选（阶段 4 复审后加）：这一条经历在库里用过的所有 id（当前 id + 0.10 之前的旧 id）。
//            按旧 id 撤回时墓碑的 id 是旧 id，封存事件却挂在当前 id 上；体检靠这个字段把两边的账对上。
//            只加不减：老墓碑没有这个字段照样读。
//
// 墓碑**不含正文**，也**不能用来恢复**：它只说"有过这一条、什么时候、为什么没的"。
// 只追加、不提供删除/清空的 API（库内 API 删不掉审计与墓碑；整目录导入是另一件事，
// archive.importArchive 会按导入包整体替换目录里的文件，见 docs/erase-audit-zh.md）。
//
// 为什么把墓碑单独放一个文件：撤回是破坏性操作，删除本身不可逆，唯一能事后核对的
// 就是这一行。它必须比记录文件更难被顺手清掉，也必须一眼看得出只有 id 和哈希。
import fs from 'node:fs'
import path from 'node:path'
import { createLog } from './event-log.js'

const FILE = 'tombstones.jsonl'
const HASH = /^[0-9a-f]{64}$/

export const eventsFile = (memDir) => path.join(memDir, FILE)

// 一行算不算合格的墓碑。文件和将来的其它容器用同一条判据
export function isValid(r) {
  return Boolean(
    r &&
    r.v === 1 &&
    typeof r.id === 'string' && r.id.trim() &&
    typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) &&
    typeof r.reason === 'string' &&
    typeof r.actor === 'string' && r.actor.trim() &&
    typeof r.hash === 'string' && HASH.test(r.hash) &&
    (r.ids === undefined || (Array.isArray(r.ids) && r.ids.every((id) => typeof id === 'string' && id.trim())))
  )
}

const log = createLog(FILE, { valid: isValid })

// { rows, bad }；文件不存在 = 还没有任何撤回（不是坏了）；读不出来抛（不当成空）
export const readAll = log.readAll

// 追加一条墓碑：先校验，写不进去就抛（不许写半条）
export function append(memDir, row) {
  if (!isValid(row)) throw new Error('墓碑不合格（需要 v:1 / id / at / reason / actor / 64 位十六进制 hash），拒绝写入。（tombstone is not valid）')
  return log.decide(memDir, () => ({ ...row })).row
}

// 某个 id 的墓碑（id 或 ids 里任一个对上）；没有返回 null
export function byId(memDir, id) {
  const key = String(id || '')
  return readAll(memDir).rows.find((r) => r.id === key || (Array.isArray(r.ids) && r.ids.includes(key))) || null
}

// 所有已撤回的 id（体检用来判断封存事件是不是指向一条"撤回过的"经历；id 与 ids 都算）
export function ids(memDir) {
  const out = new Set()
  for (const r of readAll(memDir).rows) {
    out.add(r.id)
    if (Array.isArray(r.ids)) for (const id of r.ids) out.add(id)
  }
  return out
}

// 坏行数（给 doctor / 诊断用）：只给数字
export const badLines = (memDir) => readAll(memDir).bad

export const internals = { FILE }