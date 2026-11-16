import type { AsOf } from './self-experience.js'

export interface RecapItem {
  id: string
  day: string
  text: string
}

export interface Recap {
  from: string
  to: string
  days: number
  written: Array<RecapItem & { kind: string; feeling: string[]; refs: string[] }>
  revised: Array<RecapItem & { thought: string; feeling: string[]; at: string; laterDay: string }>
  feelingShifts: Array<RecapItem & { then: string[]; now: string[]; laterDay: string }>
  settled: Array<RecapItem & { unfinished: string; choice: 'done' | 'shelved'; stateDay: string }>
  reopened: Array<RecapItem & { unfinished: string; choice: 'reopen'; stateDay: string }>
  stillOpen: Array<RecapItem & { unfinished: string }>
}

/** 只整理事实，不调模型、不下结论；她封存了的不列 */
export function recap(dir: string, opts?: { days?: number; asOf?: AsOf; now?: Date }): Recap
export function renderRecap(recap: Recap): string
