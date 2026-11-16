export type UnfinishedChoice = 'done' | 'shelved' | 'reopen'

export const CHOICES: Set<UnfinishedChoice>

export interface UnfinishedEvent {
  id: string
  at: string
  day: string
  choice: UnfinishedChoice
  note: string
}

export interface UnfinishedLatest {
  id: string
  at: string
  day: string
  choice: UnfinishedChoice | ''
  note: string
  history: UnfinishedChoice[]
}

export function eventsFile(memDir: string): string
export function append(memDir: string, opts: { id: string; choice: UnfinishedChoice; note?: string }, lockOpts?: Record<string, unknown>): UnfinishedEvent
export function readAll(memDir: string): { rows: UnfinishedEvent[]; bad: number }
export function latestByExp(memDir: string): Map<string, UnfinishedLatest>
export function countByExp(memDir: string): Map<string, number>