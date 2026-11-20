/**
 * 事实判断：把一段对话交给模型，问「这里有没有值得长期记住的稳定事实」。
 *
 * 为什么不用规则：实测规则抽不出「黄焖鸡吧，下饭」「最爱的还是咸蛋黄焗南瓜」这类隐性说法，
 * 而它们恰恰是"她记得住人、记不住事"的缺口。
 *
 * 这一层只负责问和整理（不写存储）；写不写、写哪里由调用方决定。
 */

const KINDS = ['project', 'budget', 'like', 'dislike', 'place', 'name', 'relation', 'goal', 'other'];

const SYSTEM = `你在帮一位 AI 陪伴者整理"关于对方的稳定事实"。
只从给出的对话里抽取：对方的项目/工作、金额与预算、喜恶（吃的、玩的、话题）、所在地、称呼、关系、长期打算。
硬规则：
1. 只抽稳定事实，不抽当下一句话的情绪、玩笑、假设和反问。
2. 必须能在原文里找到依据；quote 必须逐字取自该条消息。
3. 说话人自己说的事，subject 写 sender；别人问他、他确认的，也算。
4. 不确定就不抽。宁少勿错。
5. 输出 JSON：{"facts":[{"kind":"project|budget|like|dislike|place|name|relation|goal|other","value":"抽到的值（≤16字）","subject":"关于谁（用消息里的 sender 名字）","quote":"原文片段","ref":"该消息的 ref"}]}
没有就返回 {"facts":[]}。不要输出任何解释。`;

function contentOf(response) {
  const c = response?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('');
  return '';
}

function parseJson(text, failMessage) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(failMessage);
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * @param {object} opts
 * @param {Array<{ref:string, sender:string, text:string, ts:number}>} opts.messages
 * @param {Function} opts.chatCompletion
 * @returns {Promise<Array<object>>} 规范化后的事实
 */
export async function judgeFacts({ messages, chatCompletion, maxMessages = 40, logger = null } = {}) {
  const rows = (Array.isArray(messages) ? messages : [])
    .map((m, i) => ({
      ref: String(m.ref || `M${i + 1}`),
      sender: String(m.sender || '').slice(0, 20),
      text: String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      ts: Number(m.ts) || 0
    }))
    .filter((m) => m.text);
  if (!rows.length) return [];

  const batch = rows.slice(0, Math.max(1, Math.min(60, Number(maxMessages) || 40)));
  const response = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(batch) }
    ],
    tools: null,
    temperature: 0.1,
    // 推理型模型会先想一大段，预算给小了 content 会是空的（实测 300 时全被思考吃掉）
    maxTokens: Math.max(1200, Math.min(3000, 800 + batch.length * 30))
  });

  const parsed = parseJson(contentOf(response), '模型未返回有效 JSON');
  const list = Array.isArray(parsed?.facts) ? parsed.facts : [];
  const byRef = new Map(batch.map((m) => [m.ref, m]));
  const out = [];
  for (const row of list) {
    const kind = String(row?.kind || '').toLowerCase();
    const value = String(row?.value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20);
    if (!KINDS.includes(kind) || !value) continue;
    const ref = String(row?.ref || '');
    const source = byRef.get(ref);
    const quote = String(row?.quote || '').trim().slice(0, 80);
    // 引文必须能在对应消息里找到，否则这条不采信
    if (source && quote && !source.text.includes(quote.slice(0, 12))) {
      logger?.warn?.('[fact-judge] 引文对不上原文，丢弃：', value);
      continue;
    }
    out.push({
      kind,
      value,
      subject: String(row?.subject || source?.sender || '').slice(0, 20),
      quote: quote || (source ? source.text.slice(0, 40) : ''),
      ts: source?.ts || 0,
      ref
    });
  }
  return out;
}

export { KINDS as FACT_KINDS };