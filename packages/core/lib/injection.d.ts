import type { CueGate, CueTable } from './cue-table.js'

/**
 * 这一轮要不要递记忆；递了之后调用 confirm() 才记为「想起」。
 * 传了 cueTable 才启用线索表旁路（默认关）：一个线索都对不上返回 reason='no-cue' 且不跑全库检索；
 * 覆盖率过门槛时 block 前面会多一行迟疑提醒，可用 cueGate 频控。
 */
export function surface(memDir: string, options: {
  chatKey: string
  text: string
  seen?: Record<string, number>
  now?: number
  mode?: 'strict' | 'loose'
  guard?: (ctx: { chatKey: string; text: string }) => boolean
  /** 线索表（buildCueTable 的结果）。不传 = 老路径，零变化 */
  cueTable?: CueTable | null
  /** 频控（createCueGate 的结果）；不传就不限次 */
  cueGate?: CueGate | null
  /** 第几轮（频控用，宿主自己数） */
  turn?: number
  /** 传了线索表还要不要插迟疑提醒；false = 只用旁路省检索 */
  cueHint?: boolean
  /** 覆盖率门槛（默认 CUE_HINT_COVER） */
  cueMinCover?: number
}): {
  block: string
  id?: string
  reason: string
  confirm?: () => boolean
  /** 线索表查出来的结果（只在传了 cueTable 时出现） */
  cue?: { cover: number; bestId: string; hint: boolean; hintReason: string; hintKey: string }
}
/** 只回答是/否，不碰磁盘 */
export function shouldInject(options?: { chatKey?: string; text?: string; seen?: Record<string, number>; id?: string; now?: number }): { ok: boolean; reason: string }
export const INJECTION_RULES: string[]