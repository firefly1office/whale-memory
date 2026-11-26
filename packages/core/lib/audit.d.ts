import type { AsOf, Experience, StorageBackendName } from './self-experience.js'

/** 审计行：只记 id 与动作，绝不记正文（召回只留查询的 sha256） */
export interface AuditRow {
  at: string
  /** 谁（self / leo / host……） */
  actor: string
  /** read / recall / erase（新增动作算兼容） */
  action: string
  ids: string[]
  note: string
}

export const ACTIONS: readonly string[]
export function eventsFile(memDir: string): string
export function isValid(r: unknown): r is AuditRow
/** 查询的 sha256：审计只留这个指纹，不留原文 */
export function queryHash(query: unknown): string
export function record(memDir: string, row: { at?: string; actor: string; action: string; ids?: string[]; note?: string }): AuditRow
export function read(dir: string, opts?: { since?: string | Date | null; until?: string | Date | null; action?: string; actor?: string }): AuditRow[]
/** 坏行数（只数，不把整份读进内存） */
export function badLines(dir: string): number
/** 读一条并留 read 审计（找不到也留；返回 null） */
export function readRecord(dir: string, id: string, opts?: { actor: string; note?: string; backend?: StorageBackendName; asOf?: AsOf }): Experience | null
/** 召回一次并留 recall 审计（只留查询哈希 + 命中 id） */
export function recall(dir: string, query: string, opts?: {
  actor: string
  note?: string
  limit?: number
  backend?: StorageBackendName
  includeSealed?: boolean
  ranker?: 'literal' | 'hybrid' | null
  gate?: 'cover' | 'legacy'
  mode?: 'strict' | 'loose'
  asOf?: AsOf
}): Experience[]
export function noteRead(dir: string, opts: { actor: string; ids?: string[]; note?: string }): AuditRow
export function noteRecall(dir: string, opts: { actor: string; ids?: string[]; query?: string; note?: string }): AuditRow
export const internals: { FILE: string }