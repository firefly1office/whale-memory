// 信任六档：分数 → 档位、升级要攒证据、掉档只要一次、里程碑只记「到过」。
//
// 借自 dsh-emotion-state（MIT）的「信任六档 + 里程碑」设计；实现自写，没有复制其代码
// （见 docs/attribution-zh.md）。这一层是纯函数：不碰磁盘、不读时间、不保存任何全局状态。
// 默认关：包入口（packages/core/index.js）没登记它，仓库里也没有任何调用点。
//
// 为什么升档慢、掉档快（这一条是硬口径，测试会盯着）：
//   - 升档：分数进入下一档还不够，要**连续** UP_CONFIRMATIONS 次观测都停在下一档及以上；
//           而且每次只升一档——从 1 档一跳到 100 分，也得一档一档地攒。
//   - 掉档：分数跌破本档下限（本档的 enter），**一次**观测就掉，并且可以直接掉多档。
// 所以同样的 Δ：往上一格不算数（还要再来两次），往下一格立刻算。
//
// 分数从哪来不由这里决定：调用方（宿主 / 评测 / 人工）给 0..100 的分数，
// 这里只负责分档与翻身规则，不编造证据。

export const TRUST_MAX = 100

// 六档。enter 是进这一档的最低分；掉档线就用本档的 enter（跌破就掉）。
// 阈值是拍出来的第一版，没有数据支撑，见 docs/ledger-zh.md「没验什么」。
export const TRUST_LEVELS = Object.freeze([
  Object.freeze({ level: 1, key: 'stranger', name: '陌路', enter: 0 }),
  Object.freeze({ level: 2, key: 'acquaintance', name: '相识', enter: 12 }),
  Object.freeze({ level: 3, key: 'familiar', name: '相熟', enter: 30 }),
  Object.freeze({ level: 4, key: 'trusted', name: '信赖', enter: 50 }),
  Object.freeze({ level: 5, key: 'entrusted', name: '托付', enter: 70 }),
  Object.freeze({ level: 6, key: 'confidant', name: '交心', enter: 88 })
])

// 升一档要连续几次观测达标。3 的意思：一次撞上去不算，得连着再来两次。
export const UP_CONFIRMATIONS = 3

// 里程碑：第一次到这一档时才记。掉下去也不收回——「到过」是经历，经历不改写
// （与 v1 契约的「记录不可变」同一个道理）。
export const MILESTONES = Object.freeze([
  Object.freeze({ id: 'known', level: 2, name: '认下这个人' }),
  Object.freeze({ id: 'trusted', level: 4, name: '敢把一件事托给她' }),
  Object.freeze({ id: 'confidant', level: 6, name: '交过心' })
])

/** 分数限幅到 0..100。不是有限数字就报错，不静默当 0。 */
export function clampScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) throw new Error('score 必须是有限数字（score）')
  return Math.min(TRUST_MAX, Math.max(0, score))
}

/** 纯阈值分档：这个分数落在第几档（不含滞回，只用来解释「分数在哪一段」）。 */
export function levelForScore(score) {
  const s = clampScore(score)
  let level = 1
  for (const band of TRUST_LEVELS) {
    if (s >= band.enter) level = band.level
  }
  return level
}

/** 档位对象（1..6）。越界报错。 */
export function bandFor(level) {
  if (!Number.isInteger(level) || level < 1 || level > TRUST_LEVELS.length) throw new Error('level 必须是 1..6 的整数（level）')
  return TRUST_LEVELS[level - 1]
}

/** 走到第 level 档时应该已经拿到的里程碑（含更低档的）。 */
export function milestonesForLevel(level) {
  const band = bandFor(level)
  return MILESTONES.filter((m) => m.level <= band.level)
}

export function milestoneById(id) {
  return MILESTONES.find((m) => m.id === id) || null
}

function normalizeMilestones(list) {
  if (!Array.isArray(list)) throw new Error('milestones 必须是数组（milestones）')
  const out = []
  for (const id of list) {
    if (!milestoneById(id)) throw new Error('里程碑认不出：' + String(id))
    if (!out.includes(id)) out.push(id)
  }
  return out
}

function freezeState({ level, upStreak, milestones }) {
  return Object.freeze({ level, upStreak, milestones: Object.freeze(milestones) })
}

/** 初始状态：第 1 档，没有攒任何升级证据，没有里程碑。 */
export function createTrustState({ level = 1, upStreak = 0, milestones = [] } = {}) {
  bandFor(level)
  if (!Number.isInteger(upStreak) || upStreak < 0) throw new Error('upStreak 必须是非负整数（upStreak）')
  if (upStreak >= UP_CONFIRMATIONS) throw new Error('upStreak 不能大于等于 UP_CONFIRMATIONS（upStreak）')
  return freezeState({ level, upStreak, milestones: normalizeMilestones(milestones) })
}

function readState(state) {
  if (!state || typeof state !== 'object') throw new Error('state 必须是 createTrustState() 造出来的对象（state）')
  bandFor(state.level)
  if (!Number.isInteger(state.upStreak) || state.upStreak < 0) throw new Error('state.upStreak 必须是非负整数（state）')
  return createTrustState({ level: state.level, upStreak: state.upStreak, milestones: state.milestones || [] })
}

function decision({ from, to, score, target, upStreak, reason, milestones = [] }) {
  const fromBand = bandFor(from)
  const toBand = bandFor(to)
  return Object.freeze({
    from,
    to,
    direction: to > from ? 'up' : to < from ? 'down' : 'hold',
    fromName: fromBand.name,
    toName: toBand.name,
    score,
    target,
    upStreak,
    // 还差几次观测才能升档；已经是最高档或正在掉档时为 0。
    missing: to === from && target > from ? UP_CONFIRMATIONS - upStreak : 0,
    newMilestones: Object.freeze(milestones.map((m) => m.id)),
    reason
  })
}

/**
 * 吃一次观测，返回新状态和这次怎么变的。
 *
 * 不修改传入的 state：返回的是独立的新对象（调用方可以留着旧状态回看）。
 *
 * @param {{level:number, upStreak:number, milestones:string[]}} state
 * @param {number} score 0..100
 * @returns {{state: object, decision: object}}
 */
export function advanceTrust(state, score) {
  const current = readState(state)
  const s = clampScore(score)
  const target = levelForScore(s)

  // 掉档：跌破本档下限，一次就掉，可跨多档；攒着的升级证据一并作废。
  if (target < current.level) {
    const next = freezeState({ level: target, upStreak: 0, milestones: current.milestones })
    return {
      state: next,
      decision: decision({
        from: current.level,
        to: target,
        score: s,
        target,
        upStreak: 0,
        reason: 'below-level-floor'
      })
    }
  }

  // 同档：没有升级证据可攒，清零。
  if (target === current.level) {
    const next = freezeState({ level: current.level, upStreak: 0, milestones: current.milestones })
    return {
      state: next,
      decision: decision({ from: current.level, to: current.level, score: s, target, upStreak: 0, reason: 'same-band' })
    }
  }

  // 升档：每次只升一档；要连续 UP_CONFIRMATIONS 次达标。
  const streak = current.upStreak + 1
  if (streak < UP_CONFIRMATIONS) {
    const next = freezeState({ level: current.level, upStreak: streak, milestones: current.milestones })
    return {
      state: next,
      decision: decision({
        from: current.level,
        to: current.level,
        score: s,
        target,
        upStreak: streak,
        reason: 'awaiting-evidence'
      })
    }
  }

  const to = current.level + 1
  const gained = MILESTONES.filter((m) => m.level > current.level && m.level <= to && !current.milestones.includes(m.id))
  const milestones = [...current.milestones, ...gained.map((m) => m.id)]
  const next = freezeState({ level: to, upStreak: 0, milestones })
  return {
    state: next,
    decision: decision({
      from: current.level,
      to,
      score: s,
      target,
      upStreak: 0,
      reason: 'confirmed',
      milestones: gained
    })
  }
}

/** 一串分数按顺序喂进去。返回最终状态与每一步的判定，方便回放排错。 */
export function foldTrust(scores = [], { initial } = {}) {
  if (!Array.isArray(scores)) throw new Error('scores 必须是数组（scores）')
  let state = initial === undefined ? createTrustState() : readState(initial)
  const decisions = []
  for (const score of scores) {
    const stepped = advanceTrust(state, score)
    state = stepped.state
    decisions.push(stepped.decision)
  }
  return { state, decisions }
}