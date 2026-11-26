/** 墓碑：一条经历被整条撤回后留下的那一行（不含正文，不可用于恢复） */
export interface Tombstone {
  v: 1
  id: string
  /** 撤回时间（ISO 8601） */
  at: string
  /** 为什么撤回（人写的短句） */
  reason: string
  /** 谁要求的（self / leo / host……） */
  actor: string
  /** 删除前那一行的 sha256（原样字节，不含行尾换行） */
  hash: string
  /** 可选（阶段 4 复审后加）：这一条经历在库里用过的所有 id（当前 id + 旧 id） */
  ids?: string[]
}

export const eventsFile: (memDir: string) => string
export function isValid(r: unknown): r is Tombstone
/** 读全部墓碑（文件不存在 = 还没撤回过任何一条） */
export function readAll(memDir: string): { rows: Tombstone[]; bad: number }
export function append(memDir: string, row: Tombstone): Tombstone
export function byId(memDir: string, id: string): Tombstone | null
/** 已撤回的全部 id */
export function ids(memDir: string): Set<string>
export function badLines(memDir: string): number
export const internals: { FILE: string }