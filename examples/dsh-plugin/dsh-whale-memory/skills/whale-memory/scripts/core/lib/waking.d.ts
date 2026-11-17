export function buildWakingBlock(dataDir: string, chatKey: string, opts?: { now?: Date; allowGroup?: boolean; lang?: 'zh' | 'en' }): string
export function consumeWaking(dataDir: string, chatKey: string, opts?: { now?: Date; allowGroup?: boolean }): boolean
export function leaveNote(dataDir: string, text: string): { at: string; day: string; text: string }
export function isPrivateKey(chatKey: string): boolean