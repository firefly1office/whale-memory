// 发起来源：只认结构化证据，不从自然语言里猜。
//
// 这条是踩过坑才定下来的：上一版试图从一句中文里抽出"谁要的"，结果每加一条规则就多一个反例——
// 「初稿看起来还行」被判成请求，「先别存稿」被判成请求，「帮我看看我删掉的初稿」把"看"和"删"混成一件。
// 中文口语没有可依赖的边界，关键词匹配在"判不出就记 unknown"这条原则下只会越改越假。
//
// 所以这一版换掉整个思路：**调用方给结构化的触发描述，库只做受约束的判定。**
//   · 自由文本一律不当证据：传字符串 → unknown。
//   · self 只有一条入口：调用方显式传 trigger: null（这一轮没有外部输入）。
//   · 定时器、空闲窗口、提醒这类"系统触发"永远不是 self——它们不算她的主动性。
//   · 判不出就 unknown；库不提供任何"猜"的开关。

export const SOURCES = Object.freeze(['asked', 'self', 'unknown'])

// 触发种类。调用方必须在自己的回合模型里判出来，再交给库。
export const TRIGGER_KINDS = Object.freeze([
  'user-request', // 用户明确要求做这件事（可带动作名/工具名做精确匹配）
  'user-mention', // 用户提到了这件事，但不是要求
  'system', // 定时器 / 空闲窗口 / 提醒等系统触发
  'none' // 这一轮确实没有外部输入
])

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * 判一条动作的发起来源。永不抛错；任何拿不准的输入都返回 unknown。
 *
 * @param {object|null} [input]
 * @param {string} [input.action] 动作名（draft_save / project_done …）
 * @param {string} [input.tool]   这一轮调用的工具名
 * @param {null|{kind: string, action?: string, tool?: string}} [input.trigger]
 *        · null                        —— 这一轮没有外部输入（唯一能得到 self 的入口）
 *        · {kind:'user-request',...}   —— 用户要求；若给了 action/tool，必须与本次一致
 *        · {kind:'user-mention'}       —— 提到但不是要求 → unknown
 *        · {kind:'system'}             —— 定时器/空闲窗口/提醒 → unknown（不是 self）
 *        · undefined / 字符串 / 其它    —— unknown
 * @returns {'asked'|'self'|'unknown'}
 */
export function classifySource(input) {
  // 整个函数体包在一层 try 里：属性 getter、被撤销的 Proxy、任何奇怪的宿主对象，
  // 都不能让调用点因为记账失败而挂掉。
  try {
    return classifyInner(input)
  } catch {
    return 'unknown'
  }
}

function classifyInner(input) {
  const o = isPlainObject(input) || (input && typeof input === 'object') ? input : {}

  const trigger = o.trigger

  // ① 唯一的 self 入口：调用方显式声明"这一轮没有外部输入"。
  if (trigger === null) return 'self'

  // ② 取不到值、或者给了自由文本：不当证据。
  if (!isPlainObject(trigger)) return 'unknown'

  const rawKind = trigger.kind
  if (typeof rawKind !== 'string') return 'unknown'
  const kind = rawKind.trim()

  // ③ 显式写 none 等同于"没有外部输入"，但只有在 kind 明确时才认。
  if (kind === 'none') return 'self'

  // ④ 系统触发（定时器/空闲/提醒）：不算她自己发起，也不算被用户要求。
  if (kind === 'system') return 'unknown'

  if (kind !== 'user-request') return 'unknown' // user-mention 与未知种类

  // ⑤ 用户要求：标了动作/工具就必须对得上。
  //    注意"标了但标坏"（空串、null、非字符串）不等于"没标"——那是调用方的错误，按 unknown 处理。
  // 本次动作/工具一侧：给了就必须是字符串，否则无从核对，按 unknown（调用方的错误不放过）。
  if (o.action !== undefined && typeof o.action !== 'string') return 'unknown'
  if (o.tool !== undefined && typeof o.tool !== 'string') return 'unknown'
  const action = typeof o.action === 'string' ? o.action.trim() : ''
  const tool = typeof o.tool === 'string' ? o.tool.trim() : ''

  // 触发一侧：读到就核对。用 !== undefined 而不是自有属性判断——
  // 原型链上的 action/tool 同样算"标了"，不能靠继承绕过去。
  if (trigger.action !== undefined) {
    const want = trigger.action
    if (typeof want !== 'string' || !want.trim() || want.trim() !== action) return 'unknown'
  }
  if (trigger.tool !== undefined) {
    const want = trigger.tool
    if (typeof want !== 'string' || !want.trim() || want.trim() !== tool) return 'unknown'
  }

  return 'asked'
}

/**
 * 给宿主用的便捷构造：明确表示"这一轮没有外部输入"。
 * 用函数而不是常量，避免调用点误把对象当可变的共享状态。
 */
export function noExternalInput() {
  return null
}

/**
 * 人类可读的一句话，用于日志与报表；不参与判定。
 * @param {'asked'|'self'|'unknown'} source
 * @param {{system?: boolean}} [opts]
 */
export function describeSource(source, opts = {}) {
  try {
    const s = typeof source === 'string' ? source.trim() : ''
    if (s === 'asked') return '用户要求'
    if (s === 'self') return '自己发起（这一轮没有外部输入）'
    if (s === 'unknown') {
      const system = isPlainObject(opts) && opts.system === true
      return system ? '系统触发（定时/空闲/提醒），不计入自己发起' : '判不出来源'
    }
    return '未知来源值'
  } catch {
    return '未知来源值'
  }
}