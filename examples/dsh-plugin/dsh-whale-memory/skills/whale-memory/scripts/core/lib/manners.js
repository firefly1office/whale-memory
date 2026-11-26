// 「知道不等于说」：把「在什么场合、说谁的事、有多敏感」折成三种出口。
//
// 这条线只做判断，不做识别：场合、敏感度、来源都由调用方给（受信宿主决定），
// 这里只负责给出能说 / 说个大概 / 不提，以及一个稳定的理由 id。
// 默认关闭：不传 enabled: true 时恒为 say，与接入前逐字相同。
//
// 三种出口：
//   say        原话可以说
//   paraphrase 可以说个大概，不引原话、不点具体细节
//   withhold   不提（不是「忘了」，是这次不说）

export const MODES = Object.freeze(['say', 'paraphrase', 'withhold'])

export const PLACES = Object.freeze(['owner-private', 'other-private', 'group', 'public'])
export const SENSITIVITIES = Object.freeze(['normal', 'private', 'secret'])
export const SOURCES = Object.freeze(['owner-said', 'other-said', 'herself', 'unknown'])

const norm = (value, allowed, fallback) => {
  const v = String(value ?? '').trim()
  return allowed.includes(v) ? v : fallback
}

/**
 * 最小判断表。规则是固定的，不做推断。
 *
 * 规则（按命中顺序）：
 *   1. disabled              → say（默认关；接入前的行为）
 *   2. secret                → withhold（任何场合都不说）
 *   3. private + 非一对一     → withhold（群/公开场合不说私事）
 *   4. private + 别人的私聊   → withhold（除非来源是她自己）
 *   5. private + 主人私聊     → 主人说的或她自己的照说；别人说的只说个大概
 *   6. 主人的事在主人私聊之外 → withhold（不把主人的事说给别人）
 *   7. 来源不明 + 私密       → withhold（拿不准就不说）
 *   8. 其余                  → say
 *
 * @param {{enabled?: boolean, place?: string, sensitivity?: string, source?: string}} [input]
 * @returns {{mode: 'say'|'paraphrase'|'withhold', reason: string, off?: boolean}}
 */
export function decideManners({ enabled = false, place = 'owner-private', sensitivity = 'normal', source = 'herself' } = {}) {
  if (enabled !== true) return { mode: 'say', reason: 'disabled', off: true }

  const p = norm(place, PLACES, 'group')
  const s = norm(sensitivity, SENSITIVITIES, 'secret') // 敏感度认不出 → 按最严
  const from = norm(source, SOURCES, 'unknown')

  if (s === 'secret') return { mode: 'withhold', reason: 'secret' }
  if (s === 'private' && p !== 'owner-private') return { mode: 'withhold', reason: 'private-outside-owner' }
  if (from === 'owner-said' && p !== 'owner-private') return { mode: 'withhold', reason: 'owner-topic-outside-owner' }
  if (s === 'private' && from === 'other-said' && p === 'owner-private') return { mode: 'paraphrase', reason: 'third-party-private-in-owner-dm' }
  if (from === 'unknown' && s === 'private') return { mode: 'withhold', reason: 'unknown-source-private' }
  return { mode: 'say', reason: 'normal' }
}

const ZH = Object.freeze({
  say: '这次可以说，不用绕。',
  paraphrase: '这次只说个大概：不引原话、不点具体细节。',
  withhold: '这次不提这件事。不是忘了，是这次不说。',
})

/**
 * 把判断结果折成一行提示（给提示词用）。默认关闭时返回空串，调用方无须判断。
 *
 * @param {{mode?: string, off?: boolean}} [decision]
 * @param {{lang?: 'zh'|'en'}} [options]
 * @returns {string}
 */
export function renderMannersHint(decision = {}, { lang = 'zh' } = {}) {
  if (!decision || decision.off === true) return ''
  const mode = MODES.includes(decision.mode) ? decision.mode : 'withhold'
  if (lang === 'en') {
    if (mode === 'say') return 'You can say this one directly.'
    if (mode === 'paraphrase') return 'Keep this one general: no quotes, no specifics.'
    return 'Do not bring this one up this time. Not forgotten — just not said now.'
  }
  return ZH[mode]
}