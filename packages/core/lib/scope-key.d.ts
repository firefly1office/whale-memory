/** 去掉人设后缀（#p_xxx），得到会话级键 */
export function baseChatKey(chatKey: string): string
/** 这个键是不是人设级 */
export function isPersonaScoped(chatKey: string): boolean
/** 这个键是不是群 / 公共场景（group_1、qq:group:1、private:group_123、群聊……） */
export function isGroupScope(chatKey: string): boolean
/** 这个键是不是认得出来的一对一私聊；带群标记或认不出的一律 false（宁可不给） */
export function isPrivateScope(chatKey: string): boolean
/** 一次查询应覆盖的键：人设级 = [人设键, 会话键]；会话级 = [会话键]（不反向并入，避免串台） */
export function scopeKeysFor(chatKey: string): string[]
/** 记录是否落在查询范围内 */
export function recordInScope(recordChatKey: string, queryChatKey: string): boolean
/** 一个键的所有写法（去重） */
export function variantsOf(chatKey: string): string[]
