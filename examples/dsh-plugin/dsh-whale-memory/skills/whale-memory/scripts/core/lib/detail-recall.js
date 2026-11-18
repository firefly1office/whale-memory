import { loadAll, recall } from './self-experience.js'
import { queryTerms, matchedTerms } from './query-match.js'

// Strip only the requested attribute and conversational wrappers. The remaining
// subject keeps names, quantities, negation, and time qualifiers together.
const questions = [
  ['color', /(?:的颜色|(?:是)?什么颜色)(?:的)?$/u],
  ['brand', /(?:的品牌|(?:是)?什么(?:牌子|品牌))(?:的)?$/u],
  ['price', /(?:的价格|多少钱)$/u],
  ['detail', /(?:是什么(?:材料|品种|口味)|的(?:型号|重量|工资)|叫什么(?:名字)?|有多[重长高宽]|好吃|会不会[\p{Script=Han}]{1,6})$/u]
]

function splitQuestion(query) {
  const plain = query.trim().replace(/[？?。！!]+$/u, '').trim()
    .replace(/^(?:你还记得|还记得|请问)/u, '').replace(/吗$/u, '')

  for (const [attribute, suffix] of questions) {
    const match = suffix.exec(plain)
    if (!match) continue
    const topic = plain.slice(0, match.index).replace(/^[那这](?:条|支|本|个|双|件|把|台|盏|张)/u, '').trim()
    if (topic.length >= 2) return { attribute, topic }
  }
  return { attribute: null, topic: plain }
}

// A value is offered only for a whole, explicit statement about this subject.
// Other prose, including reported speech, questions and guesses, stays evidence
// for the reader. A later note can qualify the statement even without the noun.
const statements = {
  color: /^(?:的颜色是|是)((?:深|浅|淡|墨|天|米|银|金)?(?:红|橙|黄|绿|青|蓝|紫|白|黑|灰|棕|粉|银|金)色)(?:的)?[。.]?$/u,
  price: /^的价格是((?:\d+(?:\.\d{1,2})?|[一二三四五六七八九十百千两零]+)元)[。.]?$/u,
  brand: /^的品牌是([\p{Script=Han}A-Za-z0-9·-]{1,20})[。.]?$/u
}
const uncertainBrand = /不|没|未知|忘|可能|或|好像|大概|似乎|据说|听说|也许|应该|记得|猜|待定|待查|待确认|保密|个谜|什么|无名|无牌|无品牌|^无$|^(?:unknown|none|null|tbd)$/iu

function directValue(row, topic, attribute) {
  const text = String(row.then.text || '').trim()
  if (row.later.length || row.then.thought || row.then.scene || row.then.quote || !text.startsWith(topic)) return null
  const value = statements[attribute]?.exec(text.slice(topic.length))?.[1]
  if (!value || (attribute === 'brand' && uncertainBrand.test(value))) return null
  return value
}

function excerpt(text, topic) {
  const index = text.indexOf(topic)
  const start = Math.max(0, index - 48)
  return text.slice(start, start + Math.max(144, topic.length + 48))
}

// “我织的那条围巾”“去年冬天织的围巾”这类说法，中心词在“的”后面。
// 只在整句找不到时兜底，避免把“阿禾的工资”直接当成“工资”去全库乱找。
function headTopic(topic) {
  const index = topic.lastIndexOf('的')
  if (index < 0) return ''
  const prefix = topic.slice(0, index)
  // 只回退“我织的 / 去年冬天织的”这类带动词的定语。
  // “姐姐的雨衣”“安安的相册”是限定归属，不能退成“雨衣/相册”去全库找。
  if (!/[织做买画写缝编烤煮修建送借寄挑选洗修]/u.test(prefix)) return ''
  // “没寄出的包裹”“没买的球鞋”是否定/未发生，不能退成“包裹/球鞋”去找已发生的那条。
  if (/没|未|不|别|非|无/u.test(prefix)) return ''
  // “冬青寄给我的那本画册”自带角色关系，交给 eventClues 判断；不要绕过它。
  if (eventClues(topic)) return ''
  let head = topic.slice(index + 1).trim()
  head = head.replace(/^(?:那|这)?(?:条|支|本|个|双|件|把|台|盏|张|只|位|名)/u, '').trim()
  if ([...head].length < 2 || [...head].length > 12) return ''
  if (/^[的了吗呢吧啊呀么着过在里那这个些]+$/u.test(head)) return ''
  return head
}

// A lender, object and action can appear apart in the same sentence. This
// retrieves a lead; their order alone cannot establish who lent what to whom.
function eventClues(topic) {
  const match = /^(.{2,20}?)([借送寄买卖挑选画写做])(?:给|来|去)?(?:我|你|他|她)?的(?:那|这)?(?:条|支|本|个|双|件|把|台|盏|张)?([\p{Script=Han}]{1,16})$/u.exec(topic)
  return match ? match.slice(1) : null
}

function candidate(row, topic, attribute, terms, clues) {
  const fields = [
    ['then.text', row.then.text, row.at], ['then.scene', row.then.scene, row.at],
    ['then.thought', row.then.thought, row.at], ['then.quote', row.then.quote?.text, row.at],
    ['then.quote.source', row.then.quote?.source, row.at],
    ...(Array.isArray(row.then.feeling) ? row.then.feeling : []).map(feeling => ['then.feeling', feeling, row.at]),
    ...row.later.flatMap(note => [
      ['later.thought', note.thought, note.at],
      ...(Array.isArray(note.feeling) ? note.feeling : []).map(feeling => ['later.feeling', feeling, note.at])
    ])
  ]
  let hit = fields.find(([, text]) => typeof text === 'string' && text.includes(topic))
  let anchor = topic
  let match = hit ? 'phrase' : 'terms'
  if (!hit && clues) {
    for (const [field, text, at] of fields) {
      if (typeof text !== 'string') continue
      const sentence = text.split(/[。！？!?；;\n]/u).find(s => clues.every(word => s.includes(word)))
      if (sentence) {
        hit = [field, sentence, at]
        anchor = clues[0]
        match = 'terms'
        break
      }
    }
  }
  if (!hit && !attribute) {
    let best = 0
    for (const field of fields) {
      if (typeof field[1] !== 'string') continue
      const matched = matchedTerms(terms, field[1])
      if (matched.size <= best) continue
      best = matched.size
      hit = field
      anchor = [...matched][0]
    }
  }
  if (!hit) return null
  const [field, text, at] = hit
  const evidence = [{ field, at, text: excerpt(text, anchor) }]
  if (field === 'then.quote' && row.then.quote.source) evidence[0].source = row.then.quote.source
  const latest = row.later.at(-1)
  if (latest?.thought && (field !== 'later.thought' || at !== latest.at || text !== latest.thought)) {
    evidence.push({ field: 'later.thought', at: latest.at, text: excerpt(latest.thought, topic) })
  }
  return { id: row.id, day: row.day, match, evidence }
}

export function recallDetail(dir, query, { asOf = null } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) {
    throw new Error('Expected a question of 1 to 500 characters（请提供 1 到 500 字的问题）')
  }
  const { topic, attribute } = splitQuestion(query)
  const result = { status: 'unmatched', value: null, attribute, candidates: [] }
  if (!topic) return result
  // A recognized attribute lets us look for the intact subject anywhere in the
  // visible record, including a scene that the general recall index skips.
  const visible = attribute
    ? loadAll(dir, { asOf }).filter(row => !row.sealed).sort((a, b) => String(b.at).localeCompare(String(a.at)))
    : null

  const collect = (subject) => {
    const rows = visible || recall(dir, subject, { asOf, limit: 3 })
    const { terms } = queryTerms(subject)
    const clues = attribute ? eventClues(subject) : null
    const candidates = []
    const leads = []
    let value = null
    for (const row of rows) {
      const item = candidate(row, subject, attribute, terms, clues)
      if (!item) continue
      if (attribute && item.match === 'terms') {
        if (leads.length < 3) leads.push(item)
        continue
      }
      candidates.push(item)
      if (candidates.length === 1 && attribute) value = directValue(row, subject, attribute)
      if (candidates.length === 3) break
    }
    if (!candidates.length) candidates.push(...leads)
    return { candidates, value }
  }

  let scan = collect(topic)
  // 带定语的说法（“我织的那条围巾”）先在原句里找；找不到再退到中心词。
  if (!scan.candidates.length) {
    const head = headTopic(topic)
    if (head && head !== topic) scan = collect(head)
  }

  result.candidates = scan.candidates
  if (result.candidates.length > 1) result.status = 'ambiguous'
  else if (result.candidates.length === 1) {
    result.status = scan.value === null ? 'related' : 'supported'
    result.value = scan.value
  }
  return result
}
