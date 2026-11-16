export type Weight = 'important' | 'normal' | 'minor'

export interface Quote {
  text: string
  source?: string
}

export interface LaterEntry {
  at: string
  day?: string
  thought: string
  reason?: string
  /** 她后来再想起时的感觉（0.12 起）；当时的感觉在 then.feeling 里，永远不动 */
  feeling?: string[]
}

/** 出处 / 反向引用里的一条：指路用的一句话摘要 */
export interface ExperienceBrief {
  id: string
  day?: string
  text?: string
  /** 出处指向的经历找不到了（例如只恢复了部分文件） */
  missing?: boolean
  /** 那条经历她封存了：不给摘要 */
  sealed?: boolean
}

/** 「翻回那天的自己」：2026-11-15（截到那天本地时间的最后一刻）、完整 ISO 时间或 Date */
export type AsOf = string | Date | null

export interface Experience {
  id: string
  at: string
  day: string
  author?: string
  source?: string
  kind: string
  weight: Weight
  then: {
    text: string
    scene?: string
    feeling?: string[]
    thought?: string
    unfinished?: string
    quote?: Quote | null
    state?: Record<string, unknown> | null
    /** 这条是从哪几件事想到的（经历 id，写入时校验过存在） */
    refs?: string[]
  }
  later: LaterEntry[]
  /** 由 then.refs 派生：出处的摘要 */
  refsInfo?: ExperienceBrief[]
  /** 反向引用：后来有哪些回想把这条写进了出处 */
  citedBy?: ExperienceBrief[]
  /** 用 asOf 读出来时，截到的那一刻（ISO） */
  viewAsOf?: string
  /** 她封存了这件事（0.13 起）：不会被召回、不进醒来块，但还在 */
  sealed?: { at: string; day: string; note: string }
  recalls?: number
  lastRecalledAt?: string
  matchedIn?: Array<'then' | 'quote' | 'later'>
  /** 没弄完的事后来怎么样了：done=想通，shelved=先放下，reopen=又接着想 */
  unfinishedState?: {
    id: string
    at: string
    day: string
    choice: 'done' | 'shelved' | 'reopen'
    note: string
    /** 完整的选择历史，按追加顺序 */
    history: Array<'done' | 'shelved' | 'reopen'>
  }
  /** recall 返回：是哪几条后记让这条被想起 */
  matchedLater?: LaterEntry[]
  /** 0.10.0 之前的旧 id（只在唯一对应时出现）；用它也能 revise / currentView */
  formerId?: string
  status?: string
  legacy?: boolean
}

export const LIMITS: Record<string, number>

export function loadAll(dir: string, opts?: { asOf?: AsOf }): Experience[]

export function addExperience(dir: string, opts: {
  text: string
  scene?: string
  feeling?: string[]
  thought?: string
  unfinished?: string
  quote?: Quote | null
  weight?: Weight
  kind?: string
  state?: Record<string, unknown> | null
  source?: string
  /** 出处：数组，或逗号分隔的字符串；引用不存在的经历会抛错，整条不写 */
  refs?: string[] | string
}): Experience

export function reviseExperience(dir: string, opts: { id: string; thought: string; reason?: string; feeling?: string[] | string }): {
  ok: boolean
  id?: string
  at?: string
  feeling?: string[]
  error?: string
}

export function markRecalled(dir: string, id: string): boolean

export function currentView(dir: string, id: string, opts?: { asOf?: AsOf }): Experience | null

export function recall(dir: string, query: string, opts?: {
  limit?: number
  minOverlap?: number
  mark?: boolean
  minRatio?: number
  mode?: 'strict' | 'loose'
  /** 在那天的自己里找；不能和 mark 一起用 */
  asOf?: AsOf
  /** 默认不召回她封存了的经历；只在"她自己要翻"时打开 */
  includeSealed?: boolean
}): Experience[]

/** 封存 / 解封：不删除任何东西；重复同一个动作是 noop */
export function setSealed(dir: string, opts: { id: string; sealed?: boolean; note?: string }): {
  ok: boolean
  id?: string
  sealed?: boolean
  at?: string
  noop?: boolean
  error?: string
}

export function renderTwoPart(entry: Experience, opts?: { now?: Date }): string

export interface PendingLegacyEvents {
  /** 几条旧经历共用的旧 id */
  id: string
  /** 可能的归属（当前 id） */
  candidates: string[]
  later: number
  recalls: number
}

export function pendingLegacyEvents(dir: string): PendingLegacyEvents[]

export function setUnfinishedState(
  dir: string,
  opts: { id: string; choice: 'done' | 'shelved' | 'reopen'; note?: string }
): { ok: boolean; id?: string; at?: string; choice?: string; noop?: boolean; error?: string }

export interface RecallContextItem {
  id: string
  day: string
  text: string
  thought: string
  weight: Weight
  raw: Experience
}

export function recallForContext(dir: string, query: string, opts?: { max?: number }): RecallContextItem[]

export const internals: { WEIGHTS: Set<Weight>; FILE: string }