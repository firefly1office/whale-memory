export interface SaveDraftInput {
  scopeKey: string
  itemId: string
  text: string
  baseRevision: number
  operationId?: string
  now?: number
  lockTimeoutMs?: number
}

export interface SaveDraftOk {
  ok: true
  itemId: string
  revision: number
  at: number
  replayed?: true
}

export interface DraftFailure {
  ok: false
  code:
    | 'invalid_input'
    | 'conflict'
    | 'operation_conflict'
    | 'revision_missing'
    | 'text_too_large'
    | 'version_limit'
    | 'busy'
    | 'unreadable'
    | 'storage_error'
  [key: string]: unknown
}

export interface DraftReadOk {
  ok: true
  itemId: string
  revision: number
  text?: string
  at?: number
  empty?: true
  corrupt?: number
}

export interface DraftHistoryOk {
  ok: true
  itemId: string
  versions: Array<{ revision: number; at: number; bytes: number }>
  nextBefore: number | null
  corrupt?: number
}

export const MAX_TEXT_BYTES: number
export const MAX_VERSIONS_PER_ITEM: number
export const MAX_ID_LENGTH: number

export function saveDraft(dir: string, input: SaveDraftInput): SaveDraftOk | DraftFailure
export function readDraft(dir: string, input: {
  scopeKey: string
  itemId: string
  revision?: number | null
  asOf?: number | null
}): DraftReadOk | DraftFailure
export function listHistory(dir: string, input: {
  scopeKey: string
  itemId: string
  before?: number
  limit?: number
}): DraftHistoryOk | DraftFailure