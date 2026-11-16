export type SealAction = 'seal' | 'unseal'

export const ACTIONS: Set<SealAction>

export interface SealEvent {
  id: string
  at: string
  day: string
  action: SealAction
  note: string
}

export interface SealedInfo {
  at: string
  day: string
  note: string
}

export function eventsFile(memDir: string): string
/** 同一把锁里重读 → 判断 → 追加；已是这个状态就 noop，不写第二条 */
export function decide(memDir: string, opts: { id: string; action: SealAction; note?: string }, lockOpts?: Record<string, unknown>): { row: SealEvent | null; noop: boolean }
export function readAll(memDir: string): { rows: SealEvent[]; bad: number }
/** 现在（或截至 until）仍封存着的经历 */
export function sealedByExp(memDir: string, opts?: { until?: number | null }): Map<string, SealedInfo>
export const internals: { FILE: string }
