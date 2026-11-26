// 开局短卡（K3）：一觉醒来的第一段话——她是谁、记忆在哪、**读不到别编**。
//
// 借自 abrahamadams2436-glitch/dsh-xiaoyu-wake 的"醒来卡"（认人 + 档案位置 + 读不到别编）与
// DISCIPLINE.md 的三档写法（MIT，只学设计，实现自写）。
//
// 为什么要有这张卡：长提示会漂，漂到最后最容易出事的是三件事——认错人、找不到档案还硬说、
// 找不到记录就编一段。短卡只钉这三件，别的都不放进来（放多了就回到"长提示会漂"）。
//
// 默认关：不传 enabled: true 就返回空串——宿主不用加分支，0.27.0 的提示词逐字不变。
// 纯函数：**不读盘、不发请求**（不 import fs / http，也不碰全局 fetch）。"档案位置"只是告诉她
// 去哪读，这张卡自己不去读——读不到时该说的是"读不到"，不是猜一个。
const MAX_CHARS = 220
const NAME_LIMIT = 24
const DIR_LIMIT = 100
const EXTRA_LIMIT = 40

// 截断：名字留头，路径留尾（路径的头是盘符和用户名，尾巴才是"记忆在哪"）
const clipHead = (text, limit) => {
  const chars = Array.from(String(text || ''))
  return chars.length <= limit ? chars.join('') : chars.slice(0, Math.max(0, limit - 1)).join('') + '…'
}
const clipTail = (text, limit) => {
  const chars = Array.from(String(text || ''))
  return chars.length <= limit ? chars.join('') : '…' + chars.slice(chars.length - (limit - 1)).join('')
}
const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim()

/**
 * 生成开局短卡。默认返回空串（默认关）。
 *
 * @param {{ enabled?: boolean, name?: string, memoryDir?: string, today?: string, extra?: string }} opts
 *   enabled   不传就返回空串。这是唯一的开关，宿主不加分支。
 *   name      她现在的名字（认人用）；空就不写这一行。
 *   memoryDir 记忆目录（只写进卡里当提示，函数本身不去读）。
 *   today     今天（YYYY-MM-DD 之类都行，原样写进去；不传就不写这一行，保证纯函数）。
 *   extra     一行额外提醒（上限 40 字，换行会被压成空格）。
 * @returns {string} ≤ 220 字；默认关时是 ''
 */
export function sessionCard({ enabled = false, name = '', memoryDir = '', today = '', extra = '' } = {}) {
  if (enabled !== true) return ''
  const lines = []
  const who = clipHead(oneLine(name), NAME_LIMIT)
  if (who) lines.push('你是' + who + '。')
  const dir = clipTail(oneLine(memoryDir), DIR_LIMIT)
  if (dir) lines.push('记忆在 ' + dir + '：读得到才算数。')
  // 这一行是这张卡的骨头，任何情况下都不截断、不省略
  lines.push('读不到别编——没记录的事就说没有，别补。')
  const day = clipHead(oneLine(today), 10)
  if (day) lines.push('今天：' + day + '。')
  const more = clipHead(oneLine(extra).replace(/\n/g, ' '), EXTRA_LIMIT)
  if (more) lines.push(more + '。')
  const card = lines.join('\n')
  const size = Array.from(card).length
  // 上限是承诺：真超了宁可报错，也不悄悄截掉（截掉可能正好截在"别编"上）
  if (size > MAX_CHARS) throw new Error('开局短卡超过 ' + MAX_CHARS + ' 字（' + size + '）：把 name / memoryDir / extra 缩短。（session card is too long）')
  return card
}

export const internals = { MAX_CHARS, NAME_LIMIT, DIR_LIMIT, EXTRA_LIMIT }