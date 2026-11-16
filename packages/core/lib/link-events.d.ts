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
export const internals: { FILE: string }
