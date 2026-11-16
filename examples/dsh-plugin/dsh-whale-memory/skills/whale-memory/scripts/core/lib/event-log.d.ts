export interface EventLog<T> {
  FILE: string
  eventsFile(memDir: string): string
  readAll(memDir: string): { rows: T[]; bad: number }
  /** 锁内重读 → judge 决定要不要追加（返回 null 即 noop） */
  decide(memDir: string, judge: (rows: T[]) => T | null, opts?: Record<string, unknown>): { row: T | null; noop: boolean }
}

export function createLog<T = Record<string, unknown>>(fileName: string, opts?: { valid?: (row: T) => boolean }): EventLog<T>
export function stamp(): { at: string; day: string }
