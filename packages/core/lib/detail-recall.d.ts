import type { AsOf } from './self-experience.js'

export interface DetailEvidence {
  field: 'then.text' | 'then.scene' | 'then.thought' | 'then.quote' | 'then.quote.source' | 'then.feeling' | 'later.thought' | 'later.feeling'
  at: string
  text: string
  source?: string
}
export interface DetailResult {
  status: 'supported' | 'related' | 'ambiguous' | 'unmatched'
  value: string | null
  attribute: 'color' | 'price' | 'brand' | 'detail' | null
  candidates: Array<{ id: string; day: string; match: 'phrase' | 'terms'; evidence: DetailEvidence[] }>
}
export function recallDetail(dir: string, query: string, opts?: { asOf?: AsOf }): DetailResult
