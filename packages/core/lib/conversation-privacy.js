/**
 * 跨窗口可见性：不同会话之间，谁的记忆可以给谁看。
 *
 * 这不是通用"全共享"或"全隔离"的二选一——真实产品里，主人私聊的内容
 * 不能被带进群，但换一个窗口聊天时又应该接得上；别人的私聊则往往属于
 * "本人不在场时不替他公开"的模糊地带。这里把这条判断题写成一个纯函数，
 * 让宿主自己填策略，而不是把默认值藏进实现里。
 *
 * 会话键的解析和"这是不是一对一的私聊"都交给 scope-key.js：
 * 两边必须认同一套写法，否则一个入口放行、另一个入口拒绝。
 *
 * 纯函数，无 IO。
 */
import { baseChatKey, isGroupScope, isPrivateScope } from './scope-key.js';

// 认得出来的房间写法：群 / 私聊都接受 `_` 和 `:` 两种分隔符；
// 本机主人窗口是 local:owner / local_owner。私聊的另一半是账号 ID，不限定是纯数字。
const GROUP_BASE = /^group[:_]\d+$/i;
const PRIVATE_BASE = /^private[:_](.+)$/i;
const LOCAL_BASE = /^local[:_]owner$/i;

/** 解析会话键：group_123 / private_9 / local:owner，可带 #p_xxx 人设后缀。 */
export function roomOf(chatKey) {
  const raw = String(chatKey || '').trim();
  if (!raw) return null;
  const base = baseChatKey(raw);
  if (!base) return null;
  const slot = base === raw ? '' : raw.slice(base.length + 1);
  const local = LOCAL_BASE.test(base);
  // 带群标记的（private:group_123、local_group_1……）私聊写法不算私聊房间：
  // 宁可认不出，也不要把"外面套了 private"的群当成一对一。
  const priv = !local && PRIVATE_BASE.test(base) && isPrivateScope(base);
  const group = !local && !priv && GROUP_BASE.test(base) && isGroupScope(base);
  if (!local && !priv && !group) return null;
  return {
    base,
    slot,
    key: raw,
    group,
    private: priv,
    local
  };
}

/** 这个会话是不是"主人自己的窗口"。缺 ownerId 时谁都不算主人。 */
export function isOwnerRoom(chatKey, ownerId) {
  const room = roomOf(chatKey);
  if (!room) return false;
  if (room.local) return true;
  const owner = String(ownerId ?? '').trim();
  if (!owner) return false;
  const m = PRIVATE_BASE.exec(room.base);
  return Boolean(room.private && m && m[1] === owner);
}

/**
 * 建一个可见性判定器。
 *
 * 没有 ownerId 时一律不放行（fail closed）：认不出哪间是主人的私聊，
 * 就没法判断"这个人不在场时能不能替他说"，宁可什么都不给。
 *
 * @param {object} policy
 * @param {string} policy.ownerId 主人的账号 ID；缺省时判定器拒绝一切
 * @param {(sourceKey:string, sourceBase:string)=>boolean} [policy.isActive] 额外的活跃性判断（例如人设槽位是否匹配）
 * @returns {{permits:(sourceKey:string, destKey:string)=>boolean}}
 */
export function createAudience({ ownerId = '', isActive = () => true } = {}) {
  const owner = String(ownerId ?? '').trim();
  if (!owner) return { permits: () => false };
  const cache = new Map();
  function permits(sourceKey, destKey) {
    const cacheKey = `${sourceKey}\u0000${destKey}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const source = roomOf(sourceKey);
    const dest = roomOf(destKey);
    let allowed = false;
    if (source && dest) {
      if (source.base === dest.base) {
        // 同一个房间内：只有完全同一套槽位才算"这里本来就看得到"
        allowed = source.key === dest.key;
      } else if (!(dest.group && isOwnerRoom(sourceKey, owner))) {
        // 跨房间：主人私聊 / 本机主人不流向群；其余按 isActive 判断
        allowed = isActive(source.key, source.base);
      }
    }
    cache.set(cacheKey, allowed);
    return allowed;
  }
  return { permits };
}

// 确定性脱敏：数字、链接、邮箱、密钥串。模型只能决定"要不要提"，
// 而"长什么样可以被复述"在这里掐掉，不依赖模型自觉。
const SENSITIVE_RULES = [
  [/\b\d{6,}\b/g, '（数字略）'],
  [/https?:\/\/\S+/gi, '（链接略）'],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '（邮箱略）'],
  [/(?:密码|口令|验证码|密钥|token|api[_-]?key)\s*[:：=]?\s*\S+/gi, '（密钥略）'],
  // 门牌号：数字后面跟「号/弄/栋/室/单元」才算，裸数字不碰（否则金额、年份全废）
  [/\d{1,4}\s*(?:号楼|号院|号|弄|栋|幢|单元|室)/g, '（门牌略）'],
  [/([路街巷道])\s*\d{1,4}/g, '$1（门牌略）'],
  [/\b[A-Za-z0-9_-]{24,}\b/g, '（长串略）']
];

export function redactSensitive(value) {
  let text = String(value || '');
  for (const [re, replacement] of SENSITIVE_RULES) text = text.replace(re, replacement);
  // 「3 号楼 502 室」会连出两个占位，合成一个，别让句子读起来像乱码
  return text.replace(/(（门牌略）)[\s、]*(?:（门牌略）)+/g, '$1');
}

/** 跨窗口引用别人私聊内容时，给模型的使用规则（放在召回条目之后，被裁剪时先裁它）。 */
export const CROSS_ROOM_RULE = '（这些是不同窗口的经历；别人的私话只能模糊带过，不复述原话、不带数字身份；拿不准就不提。）';

export { baseChatKey };