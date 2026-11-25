export type ChapterAction = 'open' | 'rename' | 'close'

export const ACTIONS: Set<ChapterAction>

export interface ChapterEvent {
  id: string
  at: string
  day: string
  action: ChapterAction
  name?: string
  from?: string
  to?: string
  note?: string
}

export interface Chapter {
  id: string
  /** 现在（或截至 until）的名字 */
  name: string
  /** 起过的所有名字，按先后；最后一个就是 name */
  names: string[]
  from: string
  /** 空字符串表示"还在这段日子里" */
  to: string
  note: string
  openedAt: string
}

export function eventsFile(memDir: string): string
export function readAll(memDir: string): { rows: ChapterEvent[]; bad: number }
export function chapters(memDir: string, opts?: { until?: number | null }): Chapter[]
/** 同 chapters，但输入是已经读出的行（不碰文件） */
export function chapterRows(rows: ChapterEvent[], opts?: { until?: number | null }): Chapter[]
/** 一行算不算合格的章节事件（文件与 SQLite 同一条判据） */
export function isValid(row: unknown): boolean
/** 这一天落在哪些章节里（章节可以重叠） */
export function chaptersOn(list: Chapter[], day: string): Chapter[]
/** from 默认今天；同名同起点重复提交是 noop */
export function open(memDir: string, opts: { name: string; from?: string; to?: string; note?: string }, lockOpts?: Record<string, unknown>): { row: ChapterEvent | null; noop: boolean }
export function rename(memDir: string, opts: { id: string; name: string }, lockOpts?: Record<string, unknown>): { row: ChapterEvent | null; noop: boolean }
/** to 默认今天；再 close 一次可以改结束日期 */
export function close(memDir: string, opts: { id: string; to?: string }, lockOpts?: Record<string, unknown>): { row: ChapterEvent | null; noop: boolean }
export const internals: { FILE: string }
