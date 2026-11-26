// 什么时候把记忆递回去：宿主最该复用的一段判断。
//
// recall 只负责"找到"，不负责"该不该说"。这里把 docs/injection.md 的规则
// 做成可调用的函数，宿主不必自己重写一遍。
//
// 规则（按顺序，任一不过就返回空 block）：
//   1. 只在一对一里递
//   2. 一轮最多一块
//   3. 同一条 24 小时内不重复
//   4. 用户提到相关话题才递（由 recall 决定，没命中就是没提到）
//   5. 默认 strict
//   6. 递了才记（confirm 由调用方在真正塞进上下文后调用）
//   7. 没命中就闭嘴
//   8. guard 只能否决
//   9. （可选，默认关）线索表旁路：传了 cueTable 就先查线索，一个都对不上就不跑全库检索；
//      覆盖率过门槛时在 block 前面插一行迟疑提醒，并用 cueGate 做频控（同标题连贴 ≤3 次、间隔 ≥2 轮）
import { recall, renderTwoPart, markRecalled } from './self-experience.js'
import { CUE_HINT_COVER, CUE_HINT_LINE, CUE_SHORT_UNITS, cueHintFor, lookupCues } from './cue-table.js'
import { isPrivateKey } from './waking.js'

const DAY = 24 * 3600 * 1000

/**
 * 判断这一轮要不要递记忆。
 *
 * @param {string} memDir 记忆目录
 * @param {object} options
 * @param {string} options.chatKey 当前会话键
 * @param {string} options.text 当前这条用户消息
 * @param {Record<string, number>} [options.seen] 宿主保存的"递过没"记录：id → 时间戳
 * @param {number} [options.now=Date.now()]
 * @param {'strict'|'loose'} [options.mode='strict']
 * @param {(ctx:{chatKey:string,text:string})=>boolean} [options.guard] 守卫，返回 false 时一律不递
 * @param {object} [options.cueTable] 线索表（buildCueTable 的结果）。**默认不传 = 老路径**：
 *   不传就没有旁路、不插迟疑、一个字节都没变
 * @param {object} [options.cueGate] 频控（createCueGate 的结果）；不传就不限次
 * @param {number} [options.turn=0] 第几轮（频控用；宿主自己数）
 * @param {boolean} [options.cueHint=true] 传了线索表还要不要插迟疑提醒（false = 只用旁路省检索）
 * @param {false|'short'|'any'} [options.cuePrefilter=false] 要不要用线索表**跳过**全库检索：
 *   false=不跳过（默认，安全）；'short'=只对短问句（≤ CUE_SHORT_UNITS 个词）跳过；
 *   'any'=一律跳过。实测：跳过会少注一部分该递的（见 docs/cue-table-zh.md 的对照数字），所以不默认开。
 * @param {number} [options.cueMinCover=CUE_HINT_COVER] 覆盖率门槛
 * @returns {{block:string, id?:string, reason:string, confirm?:()=>boolean, cue?:object}}
 *   block 为空时 reason 说明原因：vetoed / not-private / no-cue / no-hit / recently-shown
 */
export function surface(memDir, { chatKey = '', text = '', seen = {}, now = Date.now(), mode = 'strict', guard, cueTable = null, cueGate = null, turn = 0, cueHint = true, cuePrefilter = false, cueMinCover = CUE_HINT_COVER } = {}) {
  if (typeof guard === 'function' && guard({ chatKey, text }) === false) {
    return { block: '', reason: 'vetoed' }
  }
  if (!isPrivateKey(chatKey)) return { block: '', reason: 'not-private' }
  if (!String(text || '').trim()) return { block: '', reason: 'no-hit' }

  // 线索表旁路（可选，默认不跳过）：一个线索都对不上、而且这条消息够短，才不跑全库检索。
  // 跳过判断错了的代价是"这次没递"——和 no-hit 同一个结果，不会递错东西；但会漏（数字见文档）。
  // cue 的返回形状统一成 {cover, bestId, hint, hintReason, hintKey}：没走到"要不要提醒"那一步时 hint=false。
  const cueInfo = (lookup, decided = null) => ({
    cover: lookup.cover,
    bestId: lookup.bestId,
    hint: Boolean(decided && decided.hint),
    hintReason: decided ? decided.reason : 'not-decided',
    hintKey: decided ? String(decided.key || '') : ''
  })
  let cue = null
  if (cueTable) {
    cue = lookupCues(cueTable, text)
    const maySkip = cuePrefilter === 'any' || (cuePrefilter === 'short' && cue.units > 0 && cue.units <= CUE_SHORT_UNITS)
    if (maySkip && cue.cover <= 0) return { block: '', reason: 'no-cue', cue: cueInfo(cue) }
  }

  const hit = recall(memDir, text, { limit: 1, mode })[0]
  if (!hit) return { block: '', reason: 'no-hit', ...(cue ? { cue: cueInfo(cue) } : {}) }

  const last = Number(seen[hit.id] || 0)
  if (last && now - last < DAY) return { block: '', reason: 'recently-shown', ...(cue ? { cue: cueInfo(cue) } : {}) }

  // 迟疑提醒：覆盖率达到门槛才加这一行，且受频控约束（同标题连贴 ≤3 次、间隔 ≥2 轮）。
  // 这一行不改注入了什么，只让她把"不确定"说出来。
  const decided = cue ? cueHintFor({ lookup: cue, gate: cueGate, turn, minCover: cueMinCover, enabled: cueHint }) : null
  if (decided && decided.hint && cueGate) cueGate.note(decided.key, turn)

  let confirmed = false
  return {
    block: (decided && decided.hint ? CUE_HINT_LINE + '\n' : '') + renderTwoPart(hit),
    id: hit.id,
    reason: 'ok',
    ...(cue ? { cue: cueInfo(cue, decided) } : {}),
    confirm() {
      // 同一次展示只记一次：宿主重试或重复确认不会把想起次数加成 2。
      if (confirmed) return true
      // 落盘失败要如实返回 false，并且不占掉 seen，下次还能再试。
      const wrote = markRecalled(memDir, hit.id)
      if (!wrote) return false
      seen[hit.id] = now
      confirmed = true
      return true
    }
  }
}

/** 本轮该不该递：只回答是/否，不碰磁盘。用于宿主自己做预算前的快速判断。 */
export function shouldInject({ chatKey = '', text = '', seen = {}, id = '', now = Date.now() } = {}) {
  if (!isPrivateKey(chatKey)) return { ok: false, reason: 'not-private' }
  if (!String(text || '').trim()) return { ok: false, reason: 'no-hit' }
  if (id && Number(seen[id] || 0) && now - Number(seen[id]) < DAY) return { ok: false, reason: 'recently-shown' }
  return { ok: true, reason: 'ok' }
}

export const INJECTION_RULES = [
  '只在一对一里递',
  '一轮最多一块',
  '同一条 24 小时内不重复',
  '用户提到相关话题才递',
  '默认用 strict',
  '递了才记',
  '没命中就闭嘴',
  '守卫只能否决'
]