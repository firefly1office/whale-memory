/**
 * 会话作用域键：同一个会话可能有两种写法——会话级 `group_123` 和人设级 `group_123#p_abcd`。
 * 检索时如果只认精确键，人设级查询就看不到会话级的老记录。
 *
 * 规则（从 QQ Agent 插件的真实 bug 里提炼）：
 *   - 人设级查询 = 人设级记录 + 同会话的会话级记录
 *   - 会话级查询 = 只认会话级记录（不反向并入人设记录，避免把某人的记忆串给所有人）
 *
 * 另外，这里也放"这个会话是不是一对一的私聊"这一条判断：
 * 醒来块、注入、未说出口抽屉、跨窗口可见性都问同一个实现，别让每个出口各写一份正则。
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

// 一对一会话的写法：private_10001 / private:10001 / local_owner / local:owner。
// 分隔符后面必须有东西：光一个 `private:` 认不出是谁，不给。
const PRIVATE_PREFIX = /^(?:private|local)[:_](.+)$/i;

// 群 / 公共场景的标记。前后都要是边界（键首、分隔符、数字、结尾），
// 所以 `private_groupie_42` 这种账号名不算群；`group_1`、`group:1`、`qq:group:1`、
// `private:group_123`、`local_group_1` 都算。中文"群"当整体标记看。
const GROUP_MARK = /(?:^|[:_\-#.@])(?:groupchat|groupdm|group|guild|channel|chatroom|conference)(?=$|[:_\-#.@0-9])/i;
const GROUP_CJK = /群/;

/** 这个键是不是群 / 公共场景（group_1、qq:group:1、private:group_123、群聊……）。 */
export function isGroupScope(chatKey) {
  const base = baseChatKey(chatKey);
  if (!base) return false;
  return GROUP_MARK.test(base) || GROUP_CJK.test(base);
}

/**
 * 这个键是不是认得出来的一对一私聊。
 *
 * 只认 `private_` / `private:` / `local_` / `local:` 开头；带群标记的（`private:group_123`、
 * `local_group_1`……）和认不出来的写法（`group_1`、`qq:group:1`、空键）一律 false。
 * 这是"宁可不给"的方向：醒来块、注入、抽屉都靠它，错放行一次就是把私话带进群里。
 */
export function isPrivateScope(chatKey) {
  const base = baseChatKey(chatKey);
  if (!base) return false;
  if (!PRIVATE_PREFIX.test(base)) return false;
  return !isGroupScope(base);
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
  if (!query) return !record;           // 空查询只匹配没有会话键的记录，不再当“全局”
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