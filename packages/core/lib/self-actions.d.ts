export declare const FILE_NAME: string
export declare const DEFAULT_MAX_LINES: number
export declare const SOURCES: readonly string[]

export interface SelfActionSource {
  asked: number
  self: number
  unknown: number
  [key: string]: number
}

export interface SelfActionRow {
  v: 1
  at: number
  day: string
  action: string
  source: 'asked' | 'self' | 'unknown'
  outcome: string
  itemRef?: string
  triggerLen?: number
  triggerDigest?: string
  extra?: unknown
}

export interface SelfActionOk { ok: true; [key: string]: unknown }
export interface SelfActionFailure {
  ok: false
  code: 'invalid_input' | 'limit' | 'busy' | 'storage_error'
  [key: string]: unknown
}

export interface SelfActionLogOptions {
  dir: string
  actions?: string[]
  maxLines?: number
}

export interface RecordSelfActionInput {
  action: string
  source?: 'asked' | 'self' | 'unknown'
  outcome?: string
  itemRef?: string
  triggerLen?: number
  triggerDigest?: string
  extra?: unknown
  at?: number
}

export interface SelfActionLog {
  record(input: RecordSelfActionInput): SelfActionOk | SelfActionFailure
  read(input?: {
    since?: number
    until?: number
    action?: string
    source?: string
    outcome?: string
    limit?: number
  }): { ok: true; total: number; rows: SelfActionRow[]; corrupt: number } | SelfActionFailure
  summarize(input?: { now?: number; days?: number }): {
    ok: true
    windowDays: number
    total: number
    bySource: SelfActionSource
    byOutcome: Record<string, number>
    byAction: Record<string, number>
    daily: Array<{ day: string; asked: number; self: number; unknown: number }>
    corrupt: number
  } | SelfActionFailure
  file: string
  maxLines: number
}

export declare function createSelfActionLog(options: SelfActionLogOptions): SelfActionLog