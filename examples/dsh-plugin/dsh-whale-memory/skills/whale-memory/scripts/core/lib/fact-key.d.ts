export const KEY_LIMIT: number
export const VALUE_LIMIT: number
export const NOTE_LIMIT: number

export interface FactEvent {
  v: 1
  type: 'fact_set'
  id: string
  key: string
  value: string
  about?: string
  expId?: string
  note?: string
  at: string
  day: string
  /** 读路径推出的：被同键的哪一条取代（写进文件的那一行没有这个字段） */
  supersededBy?: string
  supersededAt?: string
}

export interface FactSetResult {
  event: FactEvent
  /** true = 最新一条本来就是同键同值，没有写新事件 */
  noop: boolean
  /** 被这一条取代的上一代 id；第一次写这个键时是空串 */
  supersededBy: string
}

export interface FactDerived {
  all: FactEvent[]
  current: FactEvent[]
  byKey: Map<string, FactEvent>
}

export function eventsFile(memDir: string): string
/** 一行算不算合格的事实事件（文件与将来的其它容器同一条判据） */
export function isValid(row: unknown): boolean
export function readAll(memDir: string): { rows: FactEvent[]; bad: number }
/** 记一条事实；同一个 key 再记一次就是取代上一代（只追加，不改正文件） */
export function setFact(
  memDir: string,
  input: { key: string; value: string; about?: string; expId?: string; note?: string; now?: Date | string },
  lockOpts?: Record<string, unknown>
): FactSetResult
/** 纯函数：事件行 → 每一代 + 现行（until = 毫秒时间戳，按那一刻重放） */
export function derive(rows: FactEvent[], opts?: { until?: number | null }): FactDerived
/** { all, current, byKey, bad }；坏行默认 fail closed；until 可传毫秒时间戳或 `2026-11-15`（看不懂就抛） */
export function readFacts(memDir: string, opts?: { until?: number | string | null; allowCorrupt?: boolean }): FactDerived & { bad: number }
export function currentFacts(memDir: string, opts?: { until?: number | string | null; allowCorrupt?: boolean }): FactEvent[]
export function historyOf(memDir: string, key: string, opts?: { until?: number | string | null }): FactEvent[]
/** 撤回前核对用；坏行默认 fail closed（这个函数的用途最不该给残缺清单） */
export function factsForExp(memDir: string, expId: string, opts?: { allowCorrupt?: boolean }): Array<FactEvent & { isCurrent: boolean }>
export const internals: { FILE: string; KEY_LIMIT: number; VALUE_LIMIT: number; NOTE_LIMIT: number }