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

export function countByExp(memDir: string): Map<string, { count: number; lastAt: string }>

export function list(memDir: string, opts?: { id?: string; limit?: number }): RecallEvent[]

export const internals: { FILE: string }