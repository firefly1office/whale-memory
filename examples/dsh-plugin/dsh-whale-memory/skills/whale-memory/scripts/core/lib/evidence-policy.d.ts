export interface Fact {
  id: string
  subject: string
  slot?: string
  value?: unknown
  at: string
  source?: string
  supersedes?: string
}

export interface NormalizedFact extends Required<Omit<Fact, 'slot' | 'value' | 'source' | 'supersedes'>> {
  slot: string
  value: unknown
  source: string
  supersedes: string
  t: number
}

export type Verdict =
  | { status: 'known'; value: unknown; fact: NormalizedFact; evidence: NormalizedFact[]; reason: string }
  | { status: 'unknown'; reason: string; evidence: NormalizedFact[] }

export function normalizeFacts(facts?: Fact[]): NormalizedFact[]
export function asOf(facts: Fact[], at: string): NormalizedFact[]
export function supersessionMap(facts?: Fact[]): Map<string, NormalizedFact>
export function currentFact(facts: Fact[], opts?: { subject: string; slot?: string; at?: string }): NormalizedFact | null
export function query(facts: Fact[], opts: { subject: string; slot?: string; at?: string }): Verdict
export function hasSuccessor(facts: Fact[], id: string, at?: string): {
  ok: boolean
  reason?: string
  hasSuccessor?: boolean
  successors?: NormalizedFact[]
}
export function render(verdict: Verdict | null): string