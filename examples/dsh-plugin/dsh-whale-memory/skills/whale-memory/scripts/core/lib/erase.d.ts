export interface EraseRemoved {
  /** 删掉了几行经历（重复 id 的副本会一起删） */
  records: number
  later: number
  recall: number
  unfinished: number
  link: number
  /** 文件里同一个 id 出现多次时，除第一行外多删了几行 */
  duplicates?: number
  /** 目录里有 memory.sqlite 时，是否也删了库里的副本 */
  sqlite: boolean
  sqliteRecords: number
  sqliteEvents: number
}

export interface EraseResult {
  ok: true
  id: string
  /** 第二次（或本来就没有）：没删任何东西，也没再写墓碑 */
  alreadyGone: boolean
  /** 撤回时间（ISO 8601）；alreadyGone 且从没写过墓碑时是空串 */
  at: string
  /** 删除前那一行的 sha256 */
  hash?: string
  /** 这次有没有墓碑在手：true = 确实撤回并留了墓碑（或之前已撤回）；false = 本来就没有这条记录（id 可能抄错） */
  tombstone: boolean
  actor?: string
  reason?: string
  removed: EraseRemoved
}

/**
 * 整条撤回：记录 + later / recall / unfinished / link 事件物理删除，seal 事件保留，
 * 成功后在 tombstones.jsonl 留一块墓碑（id / 时间 / 原因 / 哈希，不含正文）。
 *
 * 幂等；坏行 / 读不出来 / SQLite 副本删不了都整次拒绝（不许只删一半）。
 * 只由宿主在"她本人或 Leo 明确要求"时调用；库不自动擦除。
 */
export function eraseExperience(dir: string, opts: { id: string; reason: string; actor: string; now?: Date | string }): EraseResult
export const internals: { RECORDS: string; EVENT_FILES: string[] }