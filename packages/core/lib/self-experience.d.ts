export type Weight = 'important' | 'normal' | 'minor'

export interface Quote {
  text: string
  source?: string
}

export interface LaterEntry {
  at: string
  day?: string
  thought: string
  reason?: string
}

export interface Experience {
  id: string
  at: string
  day: string
  author?: string
  source?: string
  kind: string
  weight: Weight
  then: {
    text: string
    scene?: string
    feeling?: string[]
    thought?: string
    unfinished?: string
    quote?: Quote | null
    state?: Record<string, unknown> | null
  }
  later: LaterEntry[]
  recalls?: number
  lastRecalledAt?: string
  matchedIn?: Array<'then' | 'quote' | 'later'>
  status?: string
  legacy?: boolean
}

export const LIMITS: Record<string, number>

export function loadAll(dir: string): Experience[]

export function addExperience(dir: string, opts: {
  text: string
  scene?: string
  feeling?: string[]
  thought?: string
  unfinished?: string
  quote?: Quote | null
  weight?: Weight
  kind?: string
  state?: Record<string, unknown> | null
  source?: string
}): Experience

export function reviseExperience(dir: string, opts: { id: string; thought: string; reason?: string }): {
  ok: boolean
  id?: string
  at?: string
  error?: string
}

export function markRecalled(dir: string, id: string): boolean

export function currentView(dir: string, id: string): Experience | null

export function recall(dir: string, query: string, opts?: {
  limit?: number
  minOverlap?: number
  mark?: boolean
  minRatio?: number
  mode?: 'strict' | 'loose'
}): Experience[]

export function renderTwoPart(entry: Experience, opts?: { now?: Date; laterCount?: number }): string

export interface RecallContextItem {
  id: string
  day: string
  text: string
  thought: string
  weight: Weight
  raw: Experience
}

export function recallForContext(dir: string, query: string, opts?: { max?: number }): RecallContextItem[]

export const internals: { WEIGHTS: Set<Weight>; FILE: string }