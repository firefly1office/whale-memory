/**
 * 事实抽取：从对话里认出「项目叫 X」「预算 X」「我爱吃 X」这类稳定事实。
 *
 * 为什么需要：她记得"那天聊了什么"，但记不住"他爱吃黄焖鸡、项目叫鲸舟"。
 * 实测：这类事实在原始消息里都有，源库 1194 张卡里却是 0 张——消息变成卡片时被当成事件吞掉了。
 *
 * 这一层只负责"认出并整理成一条结构化事实"，写不写、写哪里由调用方决定。
 * 纯函数，无 IO。
 */

/** 值里不能带这些：它们说明后面接的是从句，不是名字。 */
const STOP_VALUE = /^(?:什么|啥|这个|那个|一下|这些|那些|他|她|它|我|你)$/;

function clean(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\ufeff]/g, '')
    .replace(/^[「『"'\s]+/, '')
    .replace(/[」』"'\s]+$/, '')
    .replace(/[，。；、,.;!?！？].*$/, '')
    .trim();
}

function usable(value, { min = 1, max = 16 } = {}) {
  const v = clean(value);
  if (!v || v.length < min || v.length > max) return '';
  if (STOP_VALUE.test(v)) return '';
  return v;
}

/**
 * 从一句话里抽事实。
 * @param {string} text 原始消息
 * @param {object} [meta] {personId, chatKey, ts, sourceId}
 * @returns {Array<{kind: string, value: string, subject: string, text: string, ts: number, personId: string, chatKey: string, sourceId: string}>}
 */
export function extractFacts(text, meta = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const out = [];
  const push = (kind, value, subject = '') => {
    const v = usable(value, { max: kind === 'budget' ? 12 : 20 });
    if (!v) return;
    out.push({
      kind,
      value: v,
      subject,
      text: raw.slice(0, 120),
      ts: Number(meta.ts) || 0,
      personId: String(meta.personId || ''),
      chatKey: String(meta.chatKey || ''),
      sourceId: String(meta.sourceId || '')
    });
  };

  // 项目 / 名字：项目叫鲸舟 / 名字叫做 X / 代号是 X
  let m = /(?:项目|产品|工程|计划|企划)(?:名|名字|代号)?\s*(?:叫|叫做|是|定为|取名)\s*[「『"]?([^，。；、,.!?！？」』"]{1,16})/.exec(raw);
  if (m) push('project', m[1]);

  // 预算 / 金额
  m = /(?:预算|成本|花了|投入|报价|价格|工资|月薪)\s*(?:是|在|大概|差不多|一共|约)?\s*([0-9一二三四五六七八九十百千万两]{1,10}\s*[元块万]?)/.exec(raw);
  if (m) push('budget', m[1]);

  // 偏好：我喜欢 / 我爱吃 / 我不吃 / 我讨厌
  m = /我(?:最|很|真的|特别)?(喜欢|爱吃|爱喝|讨厌|不喜欢|不吃|忌口)\s*([^，。；、,.!?！？]{1,16})/.exec(raw);
  if (m) push(/讨厌|不喜欢|不吃|忌口/.test(m[1]) ? 'dislike' : 'like', m[2]);

  // 居住 / 所在地
  m = /我(?:现在)?(?:住在|家在|生活在)\s*([^，。；、,.!?！？]{2,14})/.exec(raw);
  if (m) push('place', m[1]);

  // 名字
  m = /我(?:的名字)?(?:叫|叫做)\s*([^，。；、,.!?！？]{1,10})/.exec(raw);
  if (m) push('name', m[1]);

  // 关系：我的 X 是 Y
  m = /我的(朋友|同事|室友|对象|女朋友|男朋友|女儿|儿子|爸爸|妈妈|师父|徒弟)\s*(?:叫|叫做|是)\s*([^，。；、,.!?！？]{1,10})/.exec(raw);
  if (m) push('relation', m[2], m[1]);

  // 去重（同一句里同 kind 同 value 只留一条）
  const seen = new Set();
  return out.filter((f) => {
    const key = `${f.kind}|${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 把一批事实合并成卡片列表：同 kind+value 只留最近一条，并记次数。 */
export function mergeFacts(facts) {
  const map = new Map();
  for (const f of Array.isArray(facts) ? facts : []) {
    if (!f || !f.kind || !f.value) continue;
    const key = `${f.kind}|${f.value}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ...f, count: 1 });
      continue;
    }
    cur.count += 1;
    if ((Number(f.ts) || 0) >= (Number(cur.ts) || 0)) {
      cur.ts = f.ts;
      cur.text = f.text;
      cur.sourceId = f.sourceId;
      cur.personId = f.personId || cur.personId;
      cur.chatKey = f.chatKey || cur.chatKey;
      cur.subject = f.subject || cur.subject;
    }
  }
  return [...map.values()].sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
}

/** 渲染成一行，供写入记忆卡或展示。 */
export function renderFact(f) {
  const label = {
    project: '项目',
    budget: '预算/金额',
    like: '喜欢',
    dislike: '不喜欢',
    place: '所在地',
    name: '称呼',
    relation: '关系'
  }[f.kind] || f.kind;
  const who = f.subject ? `${f.subject}` : '他';
  return `${who}的${label}：${f.value}`;
}