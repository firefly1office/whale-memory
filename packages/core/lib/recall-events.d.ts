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

export function list(memDir: string, opts?: { id?: string; limit?: number }): RecallEvent[]

export const internals: { FILE: string }