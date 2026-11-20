/** 把一个人的档案压成一行提示词；信息不足返回空串 */
export function renderPersonCard(card: Record<string, unknown>, options?: { now?: number; minEvidence?: number }): string
/** 挑当前说话人那张卡；默认不按"话最多"退回别人 */
export function pickPersonCard(cards: Array<Record<string, unknown>>, speaker?: { personId?: string; chatKey?: string }, options?: { fallback?: boolean }): Record<string, unknown> | null
