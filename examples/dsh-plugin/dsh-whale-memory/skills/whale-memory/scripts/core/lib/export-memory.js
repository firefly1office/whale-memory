// 导出（阶段 4）：把记忆库导成 JSONL。
//
// 和"书 / 回顾"那种展示型导出不同：这是**整份数据口径**——封存的内容默认也导出，
// 只是打上 sealed: true（不给封存理由，理由里可能有她写下的原话）。
// 要"只导没封存的"，传 includeSealed: false。
//
// 每一行就是 loadAll 在同条件（backend / 封存口径）下返回的那一条，唯一差别是封存状态记成 true。
// 因此"导出与同条件全量读逐条一致"是可验证的（tests/erase-audit-export.test.mjs）。
//
// 只读：不写回任何数据文件，不建目录，不追加审计/墓碑。
//
// 规模：整份导出必然要把全部记录读进内存（loadAll 就是这个代价）。十万条以上、内存吃紧时，
// 用 self-experience.iterate 一条一条自己写文件——这条路径不替你猜"要流到哪去"。
import { loadAll } from './self-experience.js'
import { parseAsOf, dayOf } from './as-of.js'

// from / to 按"本地日"截，含端点；'2026-11-01' 与完整 ISO 都收
function dayBound(value, name) {
  if (value === null || value === undefined || value === '') return ''
  try {
    return dayOf(parseAsOf(value))
  } catch (error) {
    throw new Error(name + ' 不是合法日期（用 2026-11-01 这样的日期或完整 ISO 时间）。（invalid ' + name + '）')
  }
}

// 一条记录属于谁：v1 记录本身不带 person 字段；只有宿主把 personId 写进 then.state 时才有意义
const personOf = (row) => String(
  (row && row.then && row.then.state && row.then.state.personId) ||
  (row && row.then && row.then.state && row.then.state.person) ||
  (row && row.personId) ||
  ''
)

/**
 * 导出记忆为 JSONL 文本（一行一条，末尾带换行；没有记录时返回空字符串）。
 *
 * @param {string} dir 记忆目录
 * @param {{ personId?: string, from?: string|Date|null, to?: string|Date|null, includeSealed?: boolean, backend?: 'file'|'sqlite' }} opts
 *   personId：只导出这个人的（匹配 then.state.personId / then.state.person / 顶层 personId）
 *   from / to：按本地日截，含端点
 *   includeSealed：默认 true（封存内容照样导出，标 sealed: true）；false = 完全排除封存内容
 *   backend：读哪个容器（默认 file；sqlite 的可用性/过期规则与 loadAll 相同）
 * @returns {string}
 */
export function exportMemory(dir, { personId = '', from = null, to = null, includeSealed = true, backend = 'file' } = {}) {
  const fromDay = dayBound(from, 'from')
  const toDay = dayBound(to, 'to')
  if (fromDay && toDay && fromDay > toDay) throw new Error('from 不能晚于 to。（from is after to）')
  const who = String(personId || '')
  const rows = loadAll(dir, { backend })
  const out = []
  for (const row of rows) {
    const day = String((row && row.day) || '')
    if (fromDay && day < fromDay) continue
    if (toDay && day > toDay) continue
    if (who && personOf(row) !== who) continue
    if (row.sealed) {
      if (!includeSealed) continue
      // 封存理由（seal.note）不导出：那是"封存之后才写下的"，不是记录本身
      out.push(JSON.stringify({ ...row, sealed: true }))
    } else {
      out.push(JSON.stringify(row))
    }
  }
  return out.length ? out.join('\n') + '\n' : ''
}

export const internals = { personOf }