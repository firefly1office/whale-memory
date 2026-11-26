// 图扩展召回（T10）的类型声明。纯函数：不读盘、不写盘；
// 只有 recall({ graphExpand: true }) 会用到它，单独 import 也可以。
// 来源与口径见 docs/graph-expand-zh.md（设计参照 Lysmor，AGPL-3.0；未复制代码）。
import type { Experience } from './self-experience.js'

/** 邻接来源：写出处（then.refs）/ 后来亲手连的（link-events）/ 同一段日子（chapter-events） */
export type GraphKind = 'refs' | 'link' | 'chapter'

/** 扩展补进来的那条经历的标记：因为哪几条种子、什么关系、几条种子指到它 */
export interface RecallVia {
  /** 指到它的基础命中 id；种子本身有排名，这里只留前 5 条 */
  seeds: string[]
  /** 一共几条种子指到它（≥ seeds.length） */
  seedCount: number
  /** 最强的那个关系（refs > link > chapter） */
  kind: GraphKind
}

export type ExpandedExperience = Experience & { via: RecallVia }

export interface Adjacency {
  /** 参与邻居计算的记录（已排除封存 / 重复 id） */
  byId: Map<string, Experience>
  /** refs 与 link 的无向邻接：id → 邻居 id → 关系集合 */
  edges: Map<string, Map<string, Set<GraphKind>>>
  /** 章节 id → 成员 id（同一章节的成员互为一跳） */
  chapters: Map<string, string[]>
  /** 记录 id → 它落在哪几段日子里 */
  rowChapters: Map<string, string[]>
}

export const KINDS: readonly GraphKind[]
export const internals: { KIND_PRIORITY: Record<GraphKind, number>; MAX_VIA_SEEDS: number }

/** 从 loadAll 形状的 rows 建邻接表；includeSealed 默认 false（封存的不参与） */
export function buildAdjacency(rows: Experience[], opts?: { includeSealed?: boolean }): Adjacency

/** 一跳邻居（同一对可能同时是 refs 和 link，会给多条） */
export function neighboursOf(graph: Adjacency, id: string): Array<{ id: string; kind: GraphKind }>

/**
 * 只填基础命中剩下的名额：limit - hits.length 条，按
 * ① 命中了几条种子 ② 最好那条种子的排名 ③ 时间 排序。
 * 已有命中不重复、不插队；返回的每条带 via。
 */
export function expandHits(opts: {
  rows?: Experience[]
  hits?: Array<{ id: string }>
  limit?: number
  includeSealed?: boolean
}): ExpandedExperience[]