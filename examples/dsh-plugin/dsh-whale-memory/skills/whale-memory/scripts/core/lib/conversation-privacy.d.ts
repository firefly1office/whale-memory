/** 解析会话键：group_123 / private_9 / local:owner，可带 #p_xxx 人设后缀 */
export function roomOf(chatKey: string): { base: string; slot: string; key: string; group: boolean; private: boolean; local: boolean } | null
/** 这个会话是不是主人自己的窗口 */
export function isOwnerRoom(chatKey: string, ownerId: string): boolean
/** 跨窗口可见性判定：主人私聊不流向群；同房间只认同槽位；其余交给 isActive */
export function createAudience(policy?: { ownerId?: string; isActive?: (sourceKey: string, sourceBase: string) => boolean }): { permits: (sourceKey: string, destKey: string) => boolean }
/** 确定性脱敏：数字、链接、邮箱、密钥、长串 */
export function redactSensitive(value: string): string
/** 跨窗口引用别人私话时的使用规则 */
export const CROSS_ROOM_RULE: string
export function baseChatKey(chatKey: string): string
