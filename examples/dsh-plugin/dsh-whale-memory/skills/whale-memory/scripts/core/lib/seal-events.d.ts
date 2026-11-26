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
/** 现在（或截至 until）仍封存着的经历；strict 时坏行会抛 SEAL_EVENTS_CORRUPT */
export function sealedByExp(memDir: string, opts?: { until?: number | null; strict?: boolean }): Map<string, SealedInfo>
/** 同 sealedByExp，但输入是已经读出的 { rows, bad }（不碰文件）；strict 时坏行同样抛 */
export function sealedFrom(read: { rows: SealEvent[]; bad: number }, opts?: { until?: number | null; strict?: boolean }): Map<string, SealedInfo>
/** 一行算不算合格的封存事件（文件与 SQLite 同一条判据） */
export function isValid(row: unknown): boolean
/** 造一行但**不落盘**（S4：写路径切 sqlite 时，JSONL 与库存同一行） */
export function buildRow(event: { id: string; action: SealAction; note?: string }): SealEvent
/** 追加一行**已经造好**的事件（双写用） */
export function appendRow(memDir: string, row: SealEvent, opts?: { timeoutMs?: number }): SealEvent
export const internals: { FILE: string }
