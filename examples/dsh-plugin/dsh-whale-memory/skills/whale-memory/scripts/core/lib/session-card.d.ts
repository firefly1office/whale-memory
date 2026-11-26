export interface SessionCardInput {
  /** 唯一开关：不传就返回空串（默认关，宿主不用加分支） */
  enabled?: boolean
  /** 她现在的名字（认人用，上限 24 字）；空就不写这一行 */
  name?: string
  /** 记忆目录（只写进卡里当提示，函数本身不读盘，上限 100 字，超了留尾部） */
  memoryDir?: string
  /** 今天（原样写进去；不传就不写这一行，保证纯函数） */
  today?: string
  /** 一行额外提醒（上限 40 字，换行压成空格） */
  extra?: string
}

/** 生成开局短卡：≤ 220 字，含"读不到别编"；默认关时返回空串 */
export function sessionCard(opts?: SessionCardInput): string
export const internals: { MAX_CHARS: number; NAME_LIMIT: number; DIR_LIMIT: number; EXTRA_LIMIT: number }