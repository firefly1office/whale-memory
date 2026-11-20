/** 这一轮要不要递记忆；递了之后调用 confirm() 才记为「想起」 */
export function surface(memDir: string, options: { chatKey: string; text: string; seen?: Record<string, number>; now?: number; mode?: 'strict' | 'loose'; guard?: (ctx: { chatKey: string; text: string }) => boolean }): { block: string; id?: string; reason: string; confirm?: () => boolean }
/** 只回答是/否，不碰磁盘 */
export function shouldInject(options?: { chatKey?: string; text?: string; seen?: Record<string, number>; id?: string; now?: number }): { ok: boolean; reason: string }
export const INJECTION_RULES: string[]
