/**
 * 事实卡存储：把「关于他的稳定事实」单独放一个文件，不混进事件卡库。
 *
 * 为什么单独放：事件库是她记忆的主干，改格式风险高；事实卡是补充层，
 * 坏了删掉就行，不影响她原来的记忆。
 *
 * 文件：<dir>/fact-cards.jsonl，一行一条，便于人工查看和手改。
 */
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock, writeFileAtomic } from './file-lock.js';

const FILE = 'fact-cards.jsonl';

function fileOf(dir) {
  return path.join(String(dir || ''), FILE);
}

// 上次写到一半崩掉留下的临时文件：拿到锁以后清掉（锁保证没有别的写者在用）。
function cleanupTemps(file) {
  const dir = path.dirname(file);
  const prefix = path.basename(file) + '.tmp-';
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* 下一轮再清 */ }
  }
}

function serializeFacts(rows) {
  const lines = rows.map((f) => JSON.stringify(f)).join('\n');
  return lines ? `${lines}\n` : '';
}

/** 读全部事实卡；文件不存在返回空数组。 */
export function loadFacts(dir) {
  const file = fileOf(dir);
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      const row = JSON.parse(text);
      if (row && row.kind && row.value) out.push(row);
    } catch { /* 坏行跳过，不影响其他 */ }
  }
  return out;
}

/**
 * 合并写入：同 kind + value + 主体 只留一条，更新时间和次数，不重复堆积。
 * 主体必须进合并键：Alice 喜欢咖啡和 Bob 喜欢咖啡是两条事实，不能合成一个人。
 *
 * 并发安全：整段「重读 → 合并 → 写回」都在 file-lock 里，写回走临时文件 + fsync + rename；
 * 并发写不会互相覆盖，写到一半崩掉也不会把正式文件写成半截。
 * @returns {{added:number, updated:number}}
 */
export function saveFacts(dir, facts) {
  const dirPath = String(dir || '');
  const incoming = Array.isArray(facts) ? facts : [];
  if (!dirPath) {
    const merged = mergeFacts([], incoming);
    return { added: merged.added, updated: merged.updated };
  }
  fs.mkdirSync(dirPath, { recursive: true });
  const file = fileOf(dirPath);
  return withFileLock(file + '.lock', () => {
    const merged = mergeFacts(loadFacts(dirPath), incoming);
    cleanupTemps(file);
    writeFileAtomic(file, serializeFacts(merged.rows));
    return { added: merged.added, updated: merged.updated };
  });
}

function mergeFacts(existing, facts) {
  const keyOf = (f) => `${f.kind}|${String(f.subject || '').trim()}|${f.value}`;
  const byKey = new Map(existing.map((f) => [keyOf(f), f]));
  let added = 0;
  let updated = 0;
  for (const fact of Array.isArray(facts) ? facts : []) {
    if (!fact?.kind || !fact?.value) continue;
    const subject = String(fact.subject || '').trim();
    const key = `${fact.kind}|${subject}|${fact.value}`;
    const chatKey = String(fact.chatKey || '');
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        kind: fact.kind,
        value: fact.value,
        subject,
        quote: String(fact.quote || '').slice(0, 80),
        chatKey,
        sources: chatKey ? [chatKey] : [],
        ts: Number(fact.ts) || Date.now(),
        count: 1
      });
      added += 1;
      continue;
    }
    cur.count = (Number(cur.count) || 1) + 1;
    // 会话来源单独留一份：同一主体在不同会话里说过，不能只记住最后一次。
    if (chatKey) {
      const sources = Array.isArray(cur.sources) ? cur.sources : (cur.chatKey ? [cur.chatKey] : []);
      if (!sources.includes(chatKey)) sources.push(chatKey);
      cur.sources = sources;
      cur.chatKey = chatKey;
    }
    if ((Number(fact.ts) || 0) >= (Number(cur.ts) || 0)) {
      cur.ts = Number(fact.ts) || cur.ts;
      cur.quote = String(fact.quote || cur.quote || '').slice(0, 80);
    }
    updated += 1;
  }
  return { rows: [...byKey.values()], added, updated };
}

/** 这个值能不能安全地说出来：短、是名词短语、不含动词和否定。 */
function valueLooksSafe(fact) {
  const v = cleanValue(fact);
  if (!v || v.length > 12) return false;
  if (fact.kind === 'like' || fact.kind === 'dislike') {
    if (/[喜欢吃喝玩花叫是不别想看去来]/.test(v)) return false;
  }
  return true;
}

const KIND_LABEL = {
  project: '项目',
  budget: '预算',
  like: '喜欢',
  dislike: '不喜欢',
  place: '在',
  name: '称呼',
  relation: '关系',
  goal: '打算'
};

const SELF_NAMES = new Set(['我', '鲸', 'self', '小鲸鱼', '鲸鲸']);

/** 事实关于谁：关于她自己的用「你」，关于别人的用名字。 */
function subjectOf(fact) {
  const raw = String(fact?.subject || '').trim();
  if (!raw || SELF_NAMES.has(raw)) return '你';
  return raw.slice(0, 12);
}

/** 模型常把整句塞进 value：「我爸爸是山中晨雾」。这里去掉多余的主语和系词。 */
function cleanValue(fact) {
  let v = String(fact?.value || '')
    .replace(/^(?:我|他|她|你)(?:的)?/, '')
    .replace(/^(?:是|叫|在)/, '')
    .trim();
  // 「不吃香菜」当 dislike 时，把否定词去掉，别渲染成「不喜欢不吃香菜」
  if (fact?.kind === 'dislike') v = v.replace(/^(?:不|别)(?:爱|喜欢|吃|喝|玩|看|要)?/, '').trim();
  // 值里带「不+动词」的，多半是句子不是名词短语，宁可不用
  if (/[不别][好吃玩喝看说想]/.test(v)) return '';
  return v.slice(0, 20);
}

function renderText(fact) {
  const label = KIND_LABEL[fact.kind] || '记得';
  const who = subjectOf(fact);
  const value = cleanValue(fact) || String(fact?.value || '').slice(0, 20);
  if (fact.kind === 'relation') return who === '你' ? `你${value}` : `${who}${value}`;
  if (fact.kind === 'name') return who === '你' ? `别人叫你${value}` : `${who}叫${value}`;
  if (fact.kind === 'place') return who === '你' ? `你在${value}` : `${who}在${value}`;
  if (fact.kind === 'other') return who === '你' ? `你${value}` : `${who}${value}`;
  return who === '你' ? `你${label}${value}` : `${who}${label}${value}`;
}

/**
 * 挑和当前这句话最相关的事实。
 * @param {Array} facts
 * @param {string} query 当前消息
 * @param {{limit?:number, now?:number}} options
 */
export function relevantFacts(facts, query, { limit = 3 } = {}) {
  const q = String(query || '');
  const list = Array.isArray(facts) ? facts : [];
  if (!list.length) return [];
  // 只讲当前语境相关的：关于她自己的，或者这句话里点到的。别人的事不往里塞。
  const SAFE_KINDS = new Set(['project', 'budget', 'like', 'dislike', 'place', 'name', 'relation']);
  const scoped = list.filter((fact) => {
    if (!SAFE_KINDS.has(String(fact.kind || ''))) return false;
    if (!valueLooksSafe(fact)) return false;
    const who = String(fact.subject || '').trim();
    const isSelf = !who || ['我', '鲸', 'self', '小鲸鱼', '鲸鲸'].includes(who);
    if (isSelf) return true;
    return Boolean(q && fact.value && q.includes(String(fact.value).slice(0, 6)));
  });
  const asksName = /(叫|名字|谁|称呼|身份)/.test(q);
  const asksProject = /(项目|工程|做啥|做什么|在忙)/.test(q);
  const asksBudget = /(预算|钱|花|成本|价格)/.test(q);
  const scoped2 = scoped.filter((fact) => {
    const kind = String(fact.kind || '');
    if (kind === 'name') return asksName;
    if (kind === 'project') return asksProject || (q && q.includes(String(fact.value || '').slice(0, 4)));
    if (kind === 'budget') return asksBudget || (q && q.includes(String(fact.value || '').slice(0, 3)));
    if (kind === 'relation') return /(谁|爸|妈|女儿|关系|家人)/.test(q);
    return true;
  });
  const scored = scoped2.map((fact) => {
    let score = 0;
    const value = String(fact.value || '');
    if (q && value && q.includes(value)) score += 5;                    // 这句话直接提到了
    else if (q && value && [...value].filter((ch) => q.includes(ch)).length >= 2) score += 1;
    if (fact.kind === 'like' || fact.kind === 'dislike') score += 0.5;   // 口味类允许泛提示
    if (fact.kind === 'name' && asksName) score += 0.8;
    if (fact.kind === 'project' && asksProject) score += 0.8;
    if (fact.kind === 'budget' && asksBudget) score += 0.8;
    if (fact.kind === 'relation' && /(谁|爸|妈|女儿|关系|家人)/.test(q)) score += 0.8;
    return { fact, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score >= 0.6).slice(0, limit).map((x) => x.fact);
}

/** 渲染成一行提示词；没有事实返回空串。 */
export function renderFactsLine(facts) {
  const list = (Array.isArray(facts) ? facts : []).filter((f) => f?.kind && f?.value);
  if (!list.length) return '';
  const parts = list.slice(0, 3).map(renderText);
  return `（你还记得：${parts.join('；')}。）`;
}