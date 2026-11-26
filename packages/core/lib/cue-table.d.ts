export const CUE_VERSION: number
export const CUE_PER_RECORD: number
export const CUE_MIN_LEN: number
export const CUE_MAX_DF: number
export const CUE_HINT_COVER: number
export const CUE_HINT_LINE: string

export interface CueRecord {
  id: string
  cues: string[]
}

export interface CueTable {
  v: number
  byCue: Map<string, string[]>
  records: CueRecord[]
}

export interface CueLookup {
  units: number
  cover: number
  bestId: string
  hits: Array<{ id: string; matched: number; cover: number }>
}

export interface CueGate {
  allow(key: string, turn?: number): boolean
  note(key: string, turn?: number): number
  reset(): void
  load(state: unknown): CueGate
  toJSON(): { lastKey: string; lastTurn: Array<[string, number]>; streak: Array<[string, number]> }
  readonly state: { lastKey: string; lastTurn: Array<[string, number]>; streak: Array<[string, number]> }
}

/** 建线索表：只给没封存的经历建；每条按词的稀有度取前 perRecord 个 */
export function buildCueTable(rows: unknown[], opts?: { perRecord?: number; maxDf?: number; minLen?: number }): CueTable
/** 查表：消息里的词能盖住哪几条经历（cover = 最好那条盖住的比例） */
export function lookupCues(table: CueTable, text: string): CueLookup
/** 频控：同标题连贴 ≤ maxStreak 次、同键两次间隔 ≥ minGapTurns 轮；状态可存可恢复 */
export function createCueGate(opts?: { maxStreak?: number; minGapTurns?: number }): CueGate
/** 该不该插迟疑提醒（不记状态；贴完由调用方 gate.note） */
export function cueHintFor(opts?: {
  lookup?: CueLookup | null
  gate?: CueGate | null
  key?: string
  turn?: number
  minCover?: number
  enabled?: boolean
}): { hint: boolean; key: string; reason: 'ok' | 'below-cover' | 'no-key' | 'throttled' }
export const internals: { CUE_VERSION: number; CUE_PER_RECORD: number; CUE_MIN_LEN: number; CUE_MAX_DF: number; CUE_HINT_COVER: number }