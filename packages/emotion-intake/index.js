// 情绪采集：分句体验者判定、证据与感受分账（公开模块）
//
// 分账：
//   - 他直接喜欢/不喜欢 → C 0.10（唯一例外：即使带"不"也按极性算）
//   - 他一般情绪词     → C 0（只进证据，是 moment 的"强证据源"）
//   - 她第一人称/让我+感受/躯体 → C 0.15（强情绪源）
//   - 她无对象+程度+上轮问感受 → C 0.15（弱锚定）；其余评价只进证据
//   - 语气/长度/速度 → 永不单独产生 C
// 合并：每回合最多写一次，Δ≤0.15；同源冷却 2 回合；每 3 回合≤2 次；每天≤6 次。
// moment：≥2 个独立有效源且至少 1 个强源（强情绪或强证据）；语气不计源；日≤3。

export const C_HIS_DIRECT = 0.10
export const C_HER_FELT = 0.15
export const C_CONTAGION = 0.10
export const TURN_CAP = 0.15
export const COOLDOWN_TURNS = 2
export const DAY_CAP = 6
export const MOMENT_DAY_CAP = 3

// 来源名归一化：旧名 → 新名；只统计认可来源，未知标签不计
const SOURCE_ALIAS = { her_felt: 'self_felt', his_direct: 'other_direct', his_evidence: 'other_evidence', her_weak: 'self_weak' }
const ALLOWED_SOURCES = new Set(['self_felt', 'other_direct', 'other_evidence', 'self_weak', 'contagion'])
const ALWAYS_STRONG = new Set(['self_felt', 'other_direct', 'other_evidence'])
function normalizeSources(sources) {
  return [...new Set((Array.isArray(sources) ? sources : []).map((s) => SOURCE_ALIAS[s] || s).filter((s) => ALLOWED_SOURCES.has(s)))]
}
function isStrong(sources) {
  if (sources.some((s) => ALWAYS_STRONG.has(s))) return true
  // 弱源例外：必须 self_weak 与 contagion 成对，单个弱源不算
  return sources.includes('self_weak') && sources.includes('contagion')
}

const FELT = ['烦', '闷', '累', '疼', '怕', '慌', '难受', '委屈', '堵', '酸', '丧', '难过', '低落', '焦虑', '孤单', '生气', '冲', '开心', '高兴', '松', '暖', '舒服', '轻松', '踏实', '爽', '安', '喜']
const FELT_POS = new Set(['开心', '高兴', '松', '暖', '舒服', '轻松', '踏实', '爽', '安', '喜'])
const FELT_RE = FELT.join('|')
const EVAL = ['好听', '好看', '不错', '喜欢', '可爱', '帅', '美', '棒', '行', '可以', '难听', '难看', '不行', '讨厌', '丑', '差', '冲', '快']
const DIRECT_POS = ['我喜欢你', '爱你', '想你', '喜欢你', '我喜欢这个']
const DIRECT_NEG = ['我讨厌你', '烦你', '不想理你', '不喜欢你', '我不喜欢这个', '不爱你', '不爱你了']
export const LEXICON_WORDS = [...new Set([...DIRECT_POS, ...DIRECT_NEG, ...FELT, ...EVAL])]

const FIRST_PERSON = /我|咱/
const HEARSAY = /(他说|她说|听说|据说|别人说|好像说)/
const QUESTION = /[?？]\s*$|(吗|呢)\s*[。.!！]?\s*$|怎么样/
const NEGATION = /(不|没|别|勿)\s*\S{0,2}$/
const PREV_ASK_SELF = /(你|你自己).{0,8}(烦|闷|累|怕|难受|开心|高兴|舒服|感觉|觉得|感受)/

export function askedSelf(text) {
  return PREV_ASK_SELF.test(String(text || ''))
}

/** 受限句法标记：只出布尔/粗桶，不保留原句。 */
export function wordsInText(text) {
  const s = String(text || '')
  return [...new Set([...hits(s, DIRECT_POS), ...hits(s, DIRECT_NEG), ...hits(s, FELT), ...hits(s, EVAL)])]
}

export function featureFlags(text) {
  const s = String(text || '')
  return {
    first_person: FIRST_PERSON.test(s) ? 1 : 0,
    degree: /(有点|有些|挺|很|太|特别|好)/.test(s) ? 'mild' : 'none',
    negation: NEGATION.test(s.replace(/[，,。！!？?；;]/g, '')) ? 1 : 0,
    question: QUESTION.test(s) ? 1 : 0,
    rhetorical: /(难道|怎么可能|你说呢|呵呵)/.test(s) ? 1 : 0,
    reported: HEARSAY.test(s) ? 1 : 0,
    punct_bucket: /[!！]{2,}/.test(s) ? 'excl' : /[?？]/.test(s) ? 'q' : /(…{2,}|\.{3,})/.test(s) ? 'ellipsis' : 'plain'
  }
}

/** 词 → 7 类粗语义；不细分原词。 */
export function categoryOf(word) {
  const w = String(word || '')
  if (DIRECT_POS.includes(w)) return 'direct_like'
  if (DIRECT_NEG.includes(w)) return 'direct_dislike'
  if (FELT.filter((x) => !FELT_POS.has(x)).includes(w)) return 'body_neg'
  if (FELT_POS.has(w)) return 'body_pos'
  if (EVAL.includes(w) && ['难听', '难看', '不行', '讨厌', '丑', '差'].includes(w)) return 'eval_neg'
  if (EVAL.includes(w)) return 'eval_pos'
  return 'neutral'
}

const splitClauses = (text) => {
  const parts = String(text || '').split(/([，,。！!？?；;\n])/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    const s = (parts[i] + (parts[i + 1] || '')).trim()
    if (s) out.push(s)
  }
  return out
}

const hits = (c, list) => list.filter((w) => c.includes(w))

/**
 * 语气因子：0.5–1.0，只乘已放行的强信号，绝不单独产生 C。
 * 夸张标点/笑声/省略号会被视为表演性语气，压低权重。
 */
export function toneFactor(clause) {
  const c = String(clause || '')
  let f = 1
  if (/[!！]{2,}/.test(c)) f -= 0.2
  if (/(哈{2,}|笑死|狗头|doge)/i.test(c)) f -= 0.2
  if (/(…{2,}|\.{3,})/.test(c)) f -= 0.1
  return Math.max(0.5, Math.min(1, f))
}

/** 单句判定：返回 { evidence: [{word,strong}], cue }。cue = 可写入的维度。 */
export function classifyClause(clause, { speaker = 'other', prevAskedSelf = false } = {}) {
  const c = String(clause || '').trim()
  if (!c) return { evidence: [], cue: null }
  const firstPerson = FIRST_PERSON.test(c)
  const hearsay = HEARSAY.test(c)
  const question = QUESTION.test(c)
  const negated = NEGATION.test(c.replace(/[，,。！!？?；;]/g, ''))
  const directPos = hits(c, DIRECT_POS)
  const directNeg = hits(c, DIRECT_NEG)
  const felt = hits(c, FELT)
  const evalWords = hits(c, EVAL)

  // 转述/引用/疑问/否定：不归她，也不产生 C；转述保留证据（记的是"他说的"）
  if (hearsay) return { evidence: [], transfer: felt.map((w) => ({ word: w })), cue: null, reason: 'hearsay' }
  if (question) return { evidence: [], cue: null, reason: 'question' }

  // 「她不爱你了」「如果我不爱你」不是在陈述说话者自己的偏好
  const thirdSubject = new RegExp(`(他|她|他们|她们|别人)[^，。！？]{0,6}(${FELT_RE}|${DIRECT_POS.join('|')}|${DIRECT_NEG.join('|')})`).test(c)
  const hypotheticalEarly = /(如果|要是|假如|万一)/.test(c.replace(/主要是/g, ''))
    || (/的话/.test(c) && !/你的话/.test(c))

  // 他：直接喜欢/不喜欢是唯一进 C 的例外（否定短语包含肯定子串，先判否定）
  if (speaker === 'other' && !thirdSubject && !hypotheticalEarly && (directPos.length || directNeg.length)) {
    const sign = directNeg.length || negated ? -1 : 1
    const words = directNeg.length ? directNeg : directPos
    return {
      evidence: words.map((w) => ({ word: w, strong: true })),
      cue: { source: 'other_direct', dim: 'v', value: sign * C_HIS_DIRECT, strong: true },
      reason: 'direct'
    }
  }

  if (negated) return { evidence: [], cue: null, reason: 'negated' }

  // 他：一般情绪词只进证据（强证据源）
  if (speaker === 'other') {
    return { evidence: felt.map((w) => ({ word: w, strong: true })), cue: null, reason: 'his-evidence' }
  }

  // 她：第一人称 / "让我" + 感受/躯体 → 强情绪
  // 但「我觉得房间有点闷」是在评价对象，不是她的体感
  const OBJECT = /(房间|屋子|天气|这个|那个|它|歌|视频|声音|音色|电影|剧|书|饭|菜|作业|题)/
  const feltIdx = felt.length ? Math.min(...felt.map((w) => c.indexOf(w)).filter((i) => i >= 0)) : -1
  const objIdx = c.search(OBJECT)
  // 「让我」要直接支配感受词（中间只允许程度副词）；「让我看看房间有多闷」不算
  const letCause = new RegExp(`让我\\s*(很|有点|有些|挺|太|特别|好|真)?\\s*(${FELT_RE})`).test(c)
  const aboutObject = objIdx >= 0 && feltIdx >= 0 && objIdx < feltIdx && !letCause
  // 第三人称/第二人称、假设句里的感受不归她
  const thirdPerson = new RegExp(`(他|她|他们|她们|别人)\\s*[^，。！？]{0,6}?(${FELT_RE})`).test(c)
  const secondPerson = new RegExp(`你[^，。！？]{0,6}?(${FELT_RE})`).test(c)
  const hypothetical = /(如果|要是|假如|万一)/.test(c.replace(/主要是/g, ''))
    || (/的话/.test(c) && !/你的话/.test(c))
  const selfFelt = (firstPerson || letCause) && felt.length && !aboutObject && !(thirdPerson && !letCause) && !(secondPerson && !letCause) && !hypothetical
  if (selfFelt) {
    const pos = felt.some((w) => FELT_POS.has(w))
    const neg = felt.some((w) => !FELT_POS.has(w))
    const sign = pos && !neg ? 1 : neg && !pos ? -1 : 0
    return {
      evidence: felt.map((w) => ({ word: w, strong: true })),
      cue: sign ? { source: 'self_felt', dim: 'v', value: sign * C_HER_FELT, strong: true, a: sign < 0 ? 1 : 0 } : null,
      reason: 'self-felt'
    }
  }

  // 她：无对象 + 程度 + 上轮在问自己感受 → 弱锚定（问音色则不算）
  const degree = /(有点|有些|挺|很|太|特别|好)/.test(c)
  const noObject = !OBJECT.test(c) && !/(他|她|你)/.test(c)
  if (prevAskedSelf && degree && noObject && felt.length && !thirdPerson && !hypothetical) {
    const pos = felt.some((w) => FELT_POS.has(w))
    const neg = felt.some((w) => !FELT_POS.has(w))
    const sign = pos && !neg ? 1 : neg && !pos ? -1 : 0
    return {
      evidence: felt.map((w) => ({ word: w, strong: true })),
      cue: sign ? { source: 'self_weak', dim: 'v', value: sign * 0.15, strong: false } : null,
      reason: 'weak-anchor'
    }
  }

  // 其余（评价/偏好/无自感）只进证据
  return {
    evidence: [...felt, ...evalWords].map((w) => ({ word: w, strong: felt.includes(w) })),
    cue: null,
    reason: evalWords.length ? 'evaluation' : 'evidence'
  }
}

/** 整段（他 + 她）评估：证据分账、C 合并、moment 判定。 */
export function scoreTurn({ otherText = '', selfText = '', prevAskedSelf = false, contagion = null, tone = true } = {}) {
  const hisClauses = splitClauses(otherText).map((s) => classifyClause(s, { speaker: 'other' }))
  const herClauses = splitClauses(selfText).map((s) => classifyClause(s, { speaker: 'self', prevAskedSelf }))
  const otherEvidence = [...new Set(hisClauses.flatMap((r) => r.evidence.map((e) => e.word)))]
  const transferEvidence = [...new Set([...hisClauses, ...herClauses].flatMap((r) => (r.transfer || []).map((e) => e.word)))]
  // 疑问/反问里的裸感受词是"回声"，不记成她的证据（S16「难过？呵呵」）
  const echo = /[?？]/.test(String(selfText || ''))
  const selfEvidence = [...new Set(herClauses.flatMap((r, i) => {
    const raw = splitClauses(selfText)[i] || ''
    if (echo && /^(烦|闷|累|疼|怕|慌|难受|委屈|堵|酸|丧|难过|低落|焦虑|孤单|生气|开心|高兴|松|暖|舒服|轻松|踏实|爽|安|喜)$/.test(raw)) return []
    return r.evidence.map((e) => e.word)
  }))]
  const cues = [...hisClauses, ...herClauses].map((r) => r.cue).filter(Boolean)
  // 情绪传染：只有她本轮没有强自感时才作为独立源进 C（0.10）
  const herFeltCue = cues.some((c) => c.source === 'self_felt')
  const contagionCue = herFeltCue ? null : contagionCueOf(contagion)
  if (contagionCue) cues.push(contagionCue)

  // 每回合只写一次：取 |value| 最大的 cue
  cues.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  let write = null
  if (cues.length) {
    const top = cues[0]
    // 分句会吃掉标点，所以整体语气在这里再乘一次（只抑制，不产生新信号）
    const tf = tone ? Math.min(toneFactor(otherText), toneFactor(selfText)) : 1
    write = { dim: top.dim, value: Math.sign(top.value) * Math.min(TURN_CAP, Math.abs(top.value) * tf), source: top.source, a: top.a ? 1 : 0 }
  }

  const strongEmotion = cues.some((c) => c.source === 'self_felt' || c.source === 'other_direct')
  const strongEvidence = hisClauses.some((r) => r.reason === 'his-evidence' && r.evidence.length)
  const generalHisEvidence = hisClauses.some((r) => r.reason === 'his-evidence' && r.evidence.length)
  const weakAnchor = cues.some((c) => c.source === 'self_weak')
  const sources = new Set()
  if (cues.some((c) => c.source === 'other_direct')) sources.add('other_direct')
  if (generalHisEvidence) sources.add('other_evidence')
  if (cues.some((c) => c.source === 'self_felt')) sources.add('self_felt')
  if (weakAnchor) sources.add('self_weak')
  if (contagionCue) sources.add('contagion')
  const moment = sources.size >= 2 && (strongEmotion || strongEvidence || weakAnchor)

  return { otherEvidence, selfEvidence, transferEvidence, otherFeatures: featureFlags(otherText), selfFeatures: featureFlags(selfText), cues, write, moment, sources: [...sources] }
}

/** 跨回合配额：冷却 2 回合、每 3 回合≤2 次、每天≤6 次。 */
export function allowWrite(state, { turnIndex = 0, now = Date.now() } = {}) {
  if (!state || typeof state !== 'object') return false;
  const log = Array.isArray(state.intakeLog) ? state.intakeLog : []
  const last = log[log.length - 1]
  if (last && turnIndex - last.turn < COOLDOWN_TURNS) return false
  const recent = log.filter((x) => turnIndex - x.turn <= 3)
  if (recent.length >= 2) return false
  const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  if (log.filter((x) => x.day === day).length >= DAY_CAP) return false
  return true
}

/**
 * 追加一条写入日志，返回**新状态**；不修改传入的 state 或它的 intakeLog 数组。
 * `now` 必须由调用方传入（不隐藏时钟）；`write` 为空时返回 null，不占配额。
 */
export function recordWrite(state, { turnIndex = 0, now, write = null } = {}) {
  if (!state || typeof state !== 'object') return null;
  if (!Number.isFinite(now)) return null;
  if (!write || typeof write !== 'object') return null;
  if (!['v', 'a'].includes(write.dim)) return null;
  if (typeof write.value !== 'number' || !Number.isFinite(write.value)) return null;
  if (typeof write.source !== 'string' || !write.source.trim()) return null;
  const prev = Array.isArray(state.intakeLog) ? state.intakeLog.slice() : []
  const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  prev.push({ turn: turnIndex, day, dim: write.dim || '', value: write.value || 0, source: write.source || '' })
  return { ...state, intakeLog: prev.slice(-100) }
}

/**
 * moment 序列闸门：≥2 个独立源、距上次 ≥2 回合、同一对源当天只触发一次。
 * 返回 true 才允许 noteCandidate。
 */
export function momentDue(state, { turnIndex = 0, sources = [], now = Date.now() } = {}) {
  const norm = normalizeSources(sources)
  if (norm.length < 2) return false
  if (Number.isFinite(state.lastMomentTurn) && turnIndex - state.lastMomentTurn < 2) return false
  const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const pair = norm.sort().join('+')
  const pairs = Array.isArray(state.momentPairs) ? state.momentPairs : []
  if (pairs.some((p) => p.day === day && normalizeSources(String(p.pair || '').split('+')).sort().join('+') === pair)) return false
  return true
}

export function recordMoment(state, { turnIndex = 0, sources = [], now = Date.now() } = {}) {
  const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  state.momentPairs = Array.isArray(state.momentPairs) ? state.momentPairs : []
  state.momentPairs.push({ day, pair: normalizeSources(sources).sort().join('+'), turn: turnIndex })
  state.momentPairs = state.momentPairs.slice(-50)
  state.lastMomentTurn = turnIndex
}

/** 传染源门槛：置信度 ≥0.4 且 |push| ≥0.12，两个条件同时满足才算（宿主入口同口径）。 */
export function contagionCueOf(contagion) {
  const confidence = Number(contagion?.confidence ?? 0)
  const push = Number(contagion?.push ?? 0)
  if (confidence < 0.4 || Math.abs(push) < 0.12) return null
  return { source: 'contagion', dim: 'v', value: Math.sign(push) * C_CONTAGION, strong: false }
}

/**
 * moment 跨回合窗口：3 回合内的独立源合并；按来源各自最后出现的回合淘汰。
 * 旧来源名先归一化再计数；兼容旧格式窗口（只有 turn/sources，没有 last）。
 */
export function mergeMomentWindow(state, { turnIndex = 0, sources = [] } = {}) {
  const old = state.momentWindow
  const oldTurn = old && Number.isFinite(Number(old.turn)) ? Number(old.turn) : null
  const fresh = oldTurn !== null && turnIndex - oldTurn <= 3
  const w = fresh ? old : { turn: turnIndex, sources: [], last: {} }
  const last = {}
  // 已存的 last 也要过白名单与别名：旧版本可能存过未知标签
  if (w.last && typeof w.last === 'object') {
    for (const [k, v] of Object.entries(w.last)) {
      const name = SOURCE_ALIAS[k] || k
      if (!ALLOWED_SOURCES.has(name) || !Number.isFinite(Number(v))) continue
      last[name] = Math.max(Number.isFinite(last[name]) ? last[name] : -Infinity, Number(v))
    }
  }
  // 旧格式没有 last：只有 turn 表示窗口最近一次更新，无法还原每个来源的实际出现回合，
  // 迁就取这个更新回合作为上界。
  if (!w.last && Array.isArray(w.sources)) {
    const t = oldTurn !== null ? oldTurn : turnIndex
    for (const s of normalizeSources(w.sources)) last[s] = t
  }
  for (const s of normalizeSources(sources)) last[s] = turnIndex
  // 只保留 3 回合内出现过的来源；空回合不会给旧证据续期
  const alive = Object.fromEntries(Object.entries(last).filter(([, t]) => turnIndex - t <= 3))
  w.sources = Object.keys(alive)
  w.last = alive
  w.turn = turnIndex
  state.momentWindow = w
  return { due: w.sources.length >= 2 && isStrong(w.sources), sources: w.sources }
}