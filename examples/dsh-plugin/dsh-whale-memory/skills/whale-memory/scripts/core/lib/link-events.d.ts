export interface LinkEvent {
  from: string
  to: string
  at: string
  day: string
  reason: string
}

export function eventsFile(memDir: string): string
export function readAll(memDir: string): { rows: LinkEvent[]; bad: number }
/** 同一对（不分方向）只连一次；重复是 noop。自己连自己会抛错 */
export function link(memDir: string, opts: { from: string; to: string; reason: string }, lockOpts?: Record<string, unknown>): { row: LinkEvent | null; noop: boolean }
/** 每条经历连着哪些（两头都有）；until 用于翻回那天 */
export function linksByExp(memDir: string, opts?: { until?: number | null }): Map<string, Array<{ other: string; reason: string; at: string; day: string }>>
/** 同 linksByExp，但输入是已经读出的行（不碰文件） */
export function linksRows(rows: LinkEvent[], opts?: { until?: number | null }): Map<string, Array<{ other: string; reason: string; at: string; day: string }>>
/** 一行算不算合格的联想事件（文件与 SQLite 同一条判据） */
export function isValid(row: unknown): boolean
export const internals: { FILE: string }
