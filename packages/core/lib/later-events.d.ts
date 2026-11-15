export interface LaterEvent {
  id: string
  at: string
  day: string
  thought: string
  reason: string
}

export function eventsFile(memDir: string): string

export function append(memDir: string, event: { id: string; thought: string; reason?: string }, opts?: { timeoutMs?: number }): LaterEvent

export function readAll(memDir: string): { rows: LaterEvent[]; bad: number }

export function groupByExp(memDir: string): Map<string, LaterEvent[]>

export function list(memDir: string, opts?: { id?: string; limit?: number }): LaterEvent[]

export const internals: { FILE: string }