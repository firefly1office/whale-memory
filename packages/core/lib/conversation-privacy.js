/**
 * 跨窗口可见性：不同会话之间，谁的记忆可以给谁看。
 *
 * 这不是通用"全共享"或"全隔离"的二选一——真实产品里，主人私聊的内容
 * 不能被带进群，但换一个窗口聊天时又应该接得上；别人的私聊则往往属于
 * "本人不在场时不替他公开"的模糊地带。这里把这条判断题写成一个纯函数，
 * 让宿主自己填策略，而不是把默认值藏进实现里。
 *
 * 纯函数，无 IO。
 */
import { baseChatKey } from './scope-key.js';

/** 解析会话键：group_123 / private_9 / local:owner，可带 #p_xxx 人设后缀。 */
export function roomOf(chatKey) {
  const raw = String(chatKey || '').trim();
  if (!raw) return null;
  const key = raw.replace(/:/, ':');
  const m = /^(group_\d+|private_\d+|local:owner)(?:#(p_[A-Za-z0-9]{1,16}))?$/.exec(key);
  if (!m) return null;
  return {
    base: m[1],
    slot: m[2] || '',
    key,
    group: m[1].startsWith('group_'),
    private: m[1].startsWith('private_'),
    local: m[1] === 'local:owner'
  };
}

/** 这个会话是不是"主人自己的窗口"。 */
export function isOwnerRoom(chatKey, ownerId) {
  const room = roomOf(chatKey);
  if (!room) return false;
  return room.local || (room.private && room.base === `private_${ownerId}`);
}

/**
 * 建一个可见性判定器。
 *
 * @param {object} policy
 * @param {string} policy.ownerId 主人的账号 ID
 * @param {(sourceKey:string, sourceBase:string)=>boolean} [policy.isActive] 额外的活跃性判断（例如人设槽位是否匹配）
 * @returns {{permits:(sourceKey:string, destKey:string)=>boolean}}
 */
export function createAudience({ ownerId = '', isActive = () => true } = {}) {
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
      } else if (!(dest.group && isOwnerRoom(sourceKey, ownerId))) {
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
  [/\b[A-Za-z0-9_-]{24,}\b/g, '（长串略）']
];

export function redactSensitive(value) {
  let text = String(value || '');
  for (const [re, replacement] of SENSITIVE_RULES) text = text.replace(re, replacement);
  return text;
}

/** 跨窗口引用别人私聊内容时，给模型的使用规则（放在召回条目之后，被裁剪时先裁它）。 */
export const CROSS_ROOM_RULE = '（这些是不同窗口的经历；别人的私话只能模糊带过，不复述原话、不带数字身份；拿不准就不提。）';

export { baseChatKey };