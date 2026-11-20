/**
 * 会话作用域键：同一个会话可能有两种写法——会话级 `group_123` 和人设级 `group_123#p_abcd`。
 * 检索时如果只认精确键，人设级查询就看不到会话级的老记录。
 *
 * 规则（从 QQ Agent 插件的真实 bug 里提炼）：
 *   - 人设级查询 = 人设级记录 + 同会话的会话级记录
 *   - 会话级查询 = 只认会话级记录（不反向并入人设记录，避免把某人的记忆串给所有人）
 *
 * 纯函数，宿主无关。
 */

const PERSONA_SUFFIX = /#p_[A-Za-z0-9]+$/i;

/** 去掉人设后缀，得到会话级键。 */
export function baseChatKey(chatKey) {
  return String(chatKey || '').trim().replace(PERSONA_SUFFIX, '');
}

/** 这个键是不是人设级。 */
export function isPersonaScoped(chatKey) {
  return PERSONA_SUFFIX.test(String(chatKey || '').trim());
}

/**
 * 一次查询应该覆盖哪些键。
 * @param {string} chatKey 当前会话键
 * @returns {string[]} 由具体到宽泛；会话级查询只有一个
 */
export function scopeKeysFor(chatKey) {
  const raw = String(chatKey || '').trim();
  if (!raw) return [];
  const base = baseChatKey(raw);
  if (!base || base === raw) return [raw];
  return [raw, base];
}

/**
 * 一条记录的会话键是否落在本次查询范围内。
 * @param {string} recordChatKey 记录自己的键
 * @param {string} queryChatKey 查询用的键
 */
export function recordInScope(recordChatKey, queryChatKey) {
  const record = String(recordChatKey || '').trim();
  const query = String(queryChatKey || '').trim();
  if (!query) return true;              // 不限定会话 = 全局
  if (!record) return false;
  return scopeKeysFor(query).includes(record);
}

/** 供测试与迁移用：把一个键的两种写法都列出来。 */
export function variantsOf(chatKey) {
  const raw = String(chatKey || '').trim();
  const base = baseChatKey(raw);
  if (!base) return [];
  return [...new Set([base, raw])];
}