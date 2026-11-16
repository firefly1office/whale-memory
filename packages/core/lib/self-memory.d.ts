export interface MemoryItem {
  id: string
  at: string
  kind: string
  text: string
  thought: string
  later?: string
  origin: 'own-time' | 'diary'
  author: string
}

export function loadExperiences(dir: string): MemoryItem[]
export function loadDiaries(dir: string): MemoryItem[]
export function recall(dir: string, query: string, opts?: {
  includeDiary?: boolean
  limit?: number
  minOverlap?: number
  minRatio?: number
  mode?: 'strict' | 'loose'
}): MemoryItem[]
export function renderBlock(items: MemoryItem[], opts?: { title?: string; maxChars?: number }): string