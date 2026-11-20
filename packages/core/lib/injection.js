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
import { recall, renderTwoPart, markRecalled } from './self-experience.js'
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
 * @returns {{block:string, id?:string, reason:string, confirm?:()=>boolean}}
 *   block 为空时 reason 说明原因：vetoed / not-private / no-hit / recently-shown
 */
export function surface(memDir, { chatKey = '', text = '', seen = {}, now = Date.now(), mode = 'strict', guard } = {}) {
  if (typeof guard === 'function' && guard({ chatKey, text }) === false) {
    return { block: '', reason: 'vetoed' }
  }
  if (!isPrivateKey(chatKey)) return { block: '', reason: 'not-private' }
  if (!String(text || '').trim()) return { block: '', reason: 'no-hit' }

  const hit = recall(memDir, text, { limit: 1, mode })[0]
  if (!hit) return { block: '', reason: 'no-hit' }

  const last = Number(seen[hit.id] || 0)
  if (last && now - last < DAY) return { block: '', reason: 'recently-shown' }

  return {
    block: renderTwoPart(hit),
    id: hit.id,
    reason: 'ok',
    confirm() {
      markRecalled(memDir, hit.id)
      seen[hit.id] = now
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