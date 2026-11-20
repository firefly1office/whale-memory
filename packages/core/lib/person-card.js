/**
 * 人物卡：把「这个人是谁、你们聊过什么、最近一次」压成一行，供提示词使用。
 *
 * 为什么需要：她的记忆是「事件」和「片段」，没有「人」这一层。
 * 问她"某某是谁"，她能翻到提到过这个名字的片段，但拼不出这个人是谁。
 *
 * 纯函数，不读文件、不调模型；数据由调用方传进来。
 *
 * 两轮审查后收紧的地方：
 *   1. 群聊不退回别人；精确匹配要带会话，避免同一个人跨群取错卡
 *   2. 关系阶段要有证据支撑（证据条数 < 3 不写）
 *   3. 名字清洗只针对真乱码，不剥合法英文前缀（Tom小明 保持完整）
 *   4. 名字和例句里的分隔符要净化：否则昵称写成「X：关系：挚友」就能伪造卡片
 *   5. 时间戳兼容秒级；「刚认识」只用于当天
 */

/** 全角/半角里能伪造卡片结构的符号，从名字里去掉。 */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const NAME_BREAKERS = /[：:，,。.；;、｜|「」『』“”"'\n\r\t\u2028\u2029]/g;

import { humanTime } from './time-sense.js';

/** 名字里的控制字符、零宽字符一律清掉。 */
function cleanName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f\u200b-\u200f\ufeff]/g, '')
    .replace(BIDI, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')     // 开头的符号去掉
    .replace(NAME_BREAKERS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 只处理真乱码：名字开头连续 2 个以上 Latin-1 补充字符、且后面跟着汉字时，
 * 把这段剥掉（如「ÿfÌÿ地形雨…」→「地形雨…」）。
 * 合法的「Tom小明」「Ame酱」不含这类字符，不会被剥。
 */
function stripMojibakePrefix(name) {
  const cjkAt = name.search(/[\u3400-\u9fff]/);
  if (cjkAt <= 0) return name;
  const prefix = name.slice(0, cjkAt);
  if (prefix.length > 8) return name;
  const latin1 = [...prefix].filter((c) => c >= '\u00c0' && c <= '\u00ff').length;
  // 只有"前面夹了两个以上 Latin-1 补充字符"才当乱码；Tom小明、Ame酱 这类合法名不受影响
  return latin1 >= 2 ? name.slice(cjkAt) : name;
}

/** 「傻鱼(￢_￢)」→「傻鱼」：去掉结尾的括号注释。 */
function baseName(value) {
  const first = String(value || '').split(' / ')[0];
  const cleaned = cleanName(stripMojibakePrefix(cleanName(first)));
  return cleaned.replace(/[（(][^（）()]{0,8}[)）]$/, '').trim();
}

/** 名字是否还能用：有字，且没有控制/替换字符。 */
function nameIsUsable(name) {
  if (!name) return false;
  if (/[\u0000-\u001f\u007f\ufffd]/.test(name)) return false;
  return /[\p{L}\p{N}]/u.test(name);
}

/** 说过多少条 → 一个词。数字对"她记得这个人"没有帮助，只会挤掉具体的事。 */
function familiarityWord(count) {
  const n = Number(count) || 0;
  if (n >= 800) return '老熟人了';
  if (n >= 200) return '聊得挺多';
  if (n >= 50) return '聊过一阵';
  if (n >= 10) return '说过几次话';
  return '刚打过照面';
}

/** 秒级时间戳换算成毫秒，避免渲染成 1970。 */
function toMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1e11 ? n : n * 1000;
}

function fmtTime(ts) {
  const n = toMs(ts);
  if (!n) return '';
  const d = new Date(n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysBetween(from, to) {
  const a = toMs(from);
  const b = toMs(to);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

/** 例句里不能出现会截断外层的引号；同时去掉换行。 */
function cleanSample(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(BIDI, '')
    .replace(/\u2028|\u2029/g, ' ')
    .replace(/[「」『』]/g, '')      // 只去会截断外层的引号，正文标点保留
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 渲染一张人物卡。
 * @param {object} card {名字, 消息条数, 首次出现(ts), 最后说话(ts), 常聊话题[], 关系阶段, 证据条数, 最近一句}
 * @param {object} [options] {now, minEvidence}
 * @returns {string} 一行文本；信息不足时返回空串
 */
export function renderPersonCard(card, { now = Date.now(), minEvidence = 3 } = {}) {
  if (!card) return '';
  const name = baseName(card.名字);
  if (!nameIsUsable(name)) return '';
  const parts = [];

  const since = daysBetween(card.首次出现, now);
  if (since != null && since >= 0) parts.push(since <= 0 ? '刚认识' : `认识 ${since} 天`);
  const count = Number(card.消息条数) || 0;
  if (count > 0) parts.push(familiarityWord(count));
  const last = humanTime(card.最后说话, { now });
  if (last) parts.push(`最近 ${last}`);

  const stage = String(card.关系阶段 || '').trim().replace(BIDI, '').replace(NAME_BREAKERS, '');
  const evidence = Number(card.证据条数) || 0;
  if (stage && stage !== '初识' && evidence >= minEvidence) parts.push(`关系：${stage}`);

  // 话题只留中文的：英文串要么是用户名、要么是工具名，对"这人是谁"帮助不大。
  const topics = (Array.isArray(card.常聊话题) ? card.常聊话题 : [])
    .map((t) => String(t).replace(/\(\d+\)$/, '').trim().replace(BIDI, '').replace(NAME_BREAKERS, ''))
    .filter((t) => /[\u3400-\u9fff]{2}/.test(t))
    .slice(0, 3);
  if (topics.length) parts.push(`常聊：${topics.join('、')}`);

  // 引用/转发里的话可能是别人说的，归到她认识的人头上会张冠李戴：这种直接不用。
  const rawSample = cleanSample(card.最近一句);
  let sample = /^\[(?:引用|合并转发|转发|回复)/.test(rawSample) ? '' : rawSample;
  sample = sample.slice(0, 28);
  const tail = sample && sample !== '[图片]' && sample !== '[表情]' ? `。最近说过「${sample}」` : '';

  if (!parts.length) return '';
  return `你认识 ${name}：${parts.join('，')}${tail}。`;
}

/**
 * 从一堆人里挑「当前说话的人」那张卡。
 * - 同一 personId 可能有多个群的卡：先匹配 personId + 当前会话；私聊允许退回该人的任意一张
 * - 默认**不按"话最多"退回别人**：群聊里那等于把别人的资料塞给在场的人
 * @param {Array} cards 人物卡数组
 * @param {{personId?: string, chatKey?: string}} speaker
 * @param {{fallback?: boolean}} options fallback=true 才允许按话最多退回
 */
export function pickPersonCard(cards, speaker = {}, { fallback = false } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const id = String(speaker.personId || '').trim();
  const chat = String(speaker.chatKey || '').trim();
  if (id) {
    const samePerson = list.filter((c) => String(c.personId || '') === id);
    if (!chat) {
      // 没有会话键就无法确认是哪张卡；只有唯一一张时才用
      return samePerson.length === 1 ? samePerson[0] : null;
    }
    const exact = samePerson.find((c) => String(c.chatKey || '') === chat);
    if (exact) return exact;
    if (/^(?:private)[_:-]/i.test(chat)) {
      const anyChat = list.find((c) => String(c.personId || '') === id);
      if (anyChat) return anyChat;
    }
  }
  if (!fallback || id) return null;
  if (chat) {
    const inChat = list
      .filter((c) => String(c.chatKey || '') === chat)
      .sort((a, b) => (Number(b.消息条数) || 0) - (Number(a.消息条数) || 0));
    if (inChat.length) return inChat[0];
  }
  return null;
}