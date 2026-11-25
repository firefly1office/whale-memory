export interface LaterEvent {
  id: string
  at: string
  day: string
  thought: string
  reason: string
  /** 她后来再想起时的感觉（0.12 起） */
  feeling?: string[]
}

export function eventsFile(memDir: string): string

export function append(memDir: string, event: { id: string; thought: string; reason?: string; feeling?: string[] }, opts?: { timeoutMs?: number }): LaterEvent

export function readAll(memDir: string): { rows: LaterEvent[]; bad: number }

/** until：只要这一刻（毫秒时间戳）之前（含）的后记 */
export function groupByExp(memDir: string, opts?: { until?: number | null }): Map<string, LaterEvent[]>

/** 同 groupByExp，但输入是已经读出的行（不碰文件） */
export function groupRows(rows: LaterEvent[], opts?: { until?: number | null }): Map<string, LaterEvent[]>
/** 一行算不算合格的后记事件（文件与 SQLite 同一条判据） */
export function isValid(row: unknown): boolean

export function list(memDir: string, opts?: { id?: string; limit?: number }): LaterEvent[]

export const internals: { FILE: string }