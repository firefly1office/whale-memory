export interface RecallEvent {
  id: string
  at: string
  query: string
  chatKey: string
  backfilled?: boolean
}

export function eventsFile(memDir: string): string

export function append(memDir: string, event: {
  id: string
  query?: string
  chatKey?: string
  backfilled?: boolean
}, opts?: { timeoutMs?: number }): RecallEvent

export function readAll(memDir: string): { rows: RecallEvent[]; bad: number }

/** until：只数这一刻（毫秒时间戳）之前（含）的想起 */
export function countByExp(memDir: string, opts?: { until?: number | null }): Map<string, { count: number; lastAt: string }>

/** 同 countByExp，但输入是已经读出的行（不碰文件、不走缓存） */
export function countRows(rows: RecallEvent[], opts?: { until?: number | null }): Map<string, { count: number; lastAt: string }>
/** 一行算不算合格的想起事件（文件与 SQLite 同一条判据） */
export function isValid(row: unknown): boolean

export function list(memDir: string, opts?: { id?: string; limit?: number }): RecallEvent[]

/** 造一行但**不落盘**（S4：写路径切 sqlite 时，JSONL 与库存同一行） */
export function buildRow(event: { id: string; query?: string; chatKey?: string; backfilled?: boolean }): RecallEvent
/** 追加一行**已经造好**的事件（双写用） */
export function appendRow(memDir: string, row: RecallEvent, opts?: { timeoutMs?: number }): RecallEvent

export const internals: { FILE: string }