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
  /** 事后联想（0.14 起）：她亲手连起来的另一件事，两头都能看到 */
  links?: Array<ExperienceBrief & { reason: string; linkDay: string }>
  /** 这一天落在她起过名字的哪段日子里（0.14 起） */
  chapters?: Array<{ id: string; name: string }>
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

/** 读哪个容器：file（默认，JSONL）或 sqlite（memory.sqlite；拿不到 node:sqlite、没迁移、迁移后 JSONL 又变过都会抛错，不静默退回 file） */
export type StorageBackendName = 'file' | 'sqlite'

export function loadAll(dir: string, opts?: { asOf?: AsOf; allowSealCorrupt?: boolean; allowCorrupt?: boolean; backend?: StorageBackendName }): Experience[]

/** 经历文件里解析不了的行数：展示路径遇到坏行会 fail closed，这个用于诊断和"先备份再修复" */
export function badLines(dir: string): number

export function addExperience(dir: string, opts: {
  text: string
  scene?: string
  /** 数组，或逗号分隔的字符串（, ， 、）；去空白、去重 */
  feeling?: string[] | string
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

export function currentView(dir: string, id: string, opts?: { asOf?: AsOf; backend?: StorageBackendName }): Experience | null

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
  /** strict 用哪套门槛：cover（默认，0.17 起）或 legacy（0.16 及以前，结果逐条一致） */
  gate?: 'cover' | 'legacy'
  /** 读哪个容器（默认 file）。sqlite 下不能 mark：写路径还在 JSONL 上 */
  backend?: StorageBackendName
  /** 匹配/排序方式：literal（默认，0.23.0 及以前的行为不变；null/undefined 也按 literal）或 hybrid（BM25 + 字符 n-gram + 小同义词表，实验性）。
   * hybrid 下 mode / minOverlap / minRatio / gate 都不参与，空查询返回空。 */
  ranker?: 'literal' | 'hybrid' | null
  /** 上一轮查询（字符串或数组），给多轮追问用；字面检索拼到查询前面，混合检索只用它排序 */
  context?: string | string[] | null
}): Experience[]

/** 事后联想：两条都必须存在、必须写理由；同一对（不分方向）只连一次 */
export function linkExperiences(dir: string, opts: { from: string; to: string; reason: string }): {
  ok: boolean
  from?: string
  to?: string
  noop?: boolean
  at?: string
  error?: string
}

/** 封存 / 解封：不删除任何东西；重复同一个动作是 noop */
export function setSealed(dir: string, opts: { id: string; sealed?: boolean; note?: string }): {
  ok: boolean
  id?: string
  sealed?: boolean
  at?: string
  noop?: boolean
  error?: string
}

/** lang：'zh'（默认）或 'en'，只换标签，她写下的内容原样 */
export function renderTwoPart(entry: Experience, opts?: { now?: Date; lang?: 'zh' | 'en' }): string

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

/** 宿主拿用户原话自动召回用；默认 gate 为 cover（0.17 起），升级不改变自动递回的行为 */
export function recallForContext(dir: string, query: string, opts?: { max?: number; gate?: 'cover' | 'legacy' }): RecallContextItem[]

export const internals: { WEIGHTS: Set<Weight>; FILE: string }