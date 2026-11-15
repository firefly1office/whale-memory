export const DEFAULTS: {
  ownTime: string
  voiceSoftLimitPerDay: number | null
  quietHours: string | null
  readingPerDay: number
  note: string
}

export type SelfSettings = typeof DEFAULTS & Record<string, unknown> & { updatedAt?: string }

export function load(dataDir: string): SelfSettings
export function save(dataDir: string, patch: Record<string, unknown>, reason?: string): SelfSettings