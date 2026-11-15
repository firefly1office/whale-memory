export function buildWakingBlock(dataDir: string, chatKey: string, opts?: { now?: Date }): string
export function consumeWaking(dataDir: string, chatKey: string, opts?: { now?: Date }): boolean
export function leaveNote(dataDir: string, text: string): { at: string; day: string; text: string }