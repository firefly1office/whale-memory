// 注入的最小实现：宿主决定该不该递，递了之后才记账
// 规则见 docs/injection.md；这里只保留最笨、能测的版本
import { recall, renderTwoPart, markRecalled } from '../../packages/core/lib/self-experience.js'
import { isPrivateKey } from '../../packages/core/lib/waking.js'

const DAY = 24 * 3600 * 1000

/**
 * @returns {{ block: string, id?: string, reason: string, confirm?: () => boolean }}
 * block 为空时 reason 说明为什么没递；非空时调用方把 block 塞进上下文，再调 confirm()
 */
export function surface(memDir, { chatKey = '', text = '', seen = {}, now = Date.now(), mode = 'strict', guard } = {}) {
  // 守卫只能否决，不能放行：guard 返回 false 就什么都不递
  // 返回 true 也只是不拦，后面照常走完所有规则
  if (typeof guard === 'function' && guard({ chatKey, text }) === false) {
    return { block: '', reason: 'vetoed' }
  }
  if (!isPrivateKey(chatKey)) return { block: '', reason: 'not-private' }

  const hit = recall(memDir, text, { limit: 1, mode })[0]
  if (!hit) return { block: '', reason: 'no-hit' }

  const last = Number(seen[hit.id] || 0)
  if (now - last < DAY) return { block: '', reason: 'recently-shown' }

  return {
    block: renderTwoPart(hit),
    id: hit.id,
    reason: 'ok',
    // 只有确认真的进了上下文才记「想起」；调用方不调，就不加次数
    confirm() {
      markRecalled(memDir, hit.id)
      seen[hit.id] = now
      return true
    }
  }
}