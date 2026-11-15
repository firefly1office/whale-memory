export interface PromptHistoryEntry {
  at: string
  chars: number
  hash?: string
  reason: string
  snapshot: string
}

export function load(dataDir: string): string

export function save(dataDir: string, text: string, reason?: string, opts?: { timeoutMs?: number }): {
  ok: boolean
  noop?: boolean
  version?: string
  chars?: number
  hash?: string
  error?: string
  reason?: string
}

export function history(dataDir: string, limit?: number): PromptHistoryEntry[]

export function revert(dataDir: string, version: string, reason?: string): ReturnType<typeof save>

export function render(basePrompt: string, dataDir: string, opts?: { marker?: string }): {
  text: string
  appended: boolean
  truncated: boolean
  note?: string
}

export function verify(dataDir: string): {
  ok: boolean
  activeHash?: string
  versionHash?: string
  version?: string
  note?: string
}

export const internals: { MAX_CHARS: number; MAX_APPEND_TOTAL: number; VERSIONS: string; ACTIVE: string; sha1: (s: string) => string }