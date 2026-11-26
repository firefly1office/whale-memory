import type { StorageBackendName } from './self-experience.js'

/**
 * 导出记忆为 JSONL 文本（一行一条，末尾带换行；没有记录时返回空字符串）。
 * 每一行就是 loadAll 在同条件下返回的那一条，唯一差别是封存状态记成 sealed: true（不导出封存理由）。
 * 只读：不写回任何数据文件，也不写审计/墓碑。
 */
export function exportMemory(dir: string, opts?: {
  /** 只导出这个人的（匹配 then.state.personId / then.state.person / 顶层 personId） */
  personId?: string
  /** 按本地日截，含端点 */
  from?: string | Date | null
  to?: string | Date | null
  /** 默认 true（封存内容照样导出，标 sealed: true）；false = 完全排除封存内容 */
  includeSealed?: boolean
  backend?: StorageBackendName
}): string
export const internals: { personOf: (row: unknown) => string }