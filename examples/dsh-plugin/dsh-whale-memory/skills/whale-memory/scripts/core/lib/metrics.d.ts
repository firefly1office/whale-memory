/** 指标快照：纯数据，可直接 JSON.stringify */
export interface MetricsSnapshot {
  version: number
  /** 起算时刻（ISO） */
  since: string
  /** 取快照的时刻（ISO） */
  at: string
  writes: { count: number; msTotal: number; msMax: number; msLast: number; msAvg: number }
  recalls: {
    count: number
    hits: number
    msTotal: number
    msMax: number
    msLast: number
    msAvg: number
    lastBackend: 'file' | 'sqlite' | 'other' | ''
    backends: { file: number; sqlite: number; other: number }
  }
  badLines: { last: number; max: number; observations: number }
}

/** 记一次写入（ms：这次写入耗时，毫秒） */
export function recordWrite(sample?: { ms?: number }): void
/** 记一次召回（hits：返回条数；backend 只认 file / sqlite，其它一律记成 other） */
export function recordRecall(sample?: { ms?: number; hits?: number; backend?: string }): void
/** 记一次坏行观测（n：此刻的坏行数） */
export function recordBadLines(n?: number): void
export function snapshot(): MetricsSnapshot
export function reset(): void
export const VERSION: number
/** 进程内单例 */
export const metrics: {
  recordWrite: typeof recordWrite
  recordRecall: typeof recordRecall
  recordBadLines: typeof recordBadLines
  snapshot: typeof snapshot
  reset: typeof reset
  VERSION: number
}