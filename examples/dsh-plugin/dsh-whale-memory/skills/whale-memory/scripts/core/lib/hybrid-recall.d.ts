// 混合检索（阶段 2）的类型声明。只有 recall({ ranker: 'hybrid' }) 会用到这些函数，
// 单独 import 也可以：它们都是纯函数，不读写磁盘。
import type { Experience } from './self-experience.js'

/** 同义词表：[a, b]，两个方向都试 */
export const SYNONYMS: Array<[string, string]>

/** 混合检索的覆盖率门槛（字面检索是 MIN_COVER=0.7） */
export const HYBRID_MIN_COVER: number

/** 查询 → 同义替换的变体，原句永远在第一个 */
export function variantsOf(query: string): string[]

/** 索引用的词：拉丁整词 + 中文 2–3 字滑窗 */
export function tokensOf(text: string): string[]

export interface HybridIndex {
  docs: Array<{ tf: Map<string, number>; len: number }>
  df: Map<string, number>
  n: number
  avgdl: number
}

export function buildIndex(texts: string[]): HybridIndex
export function idfOf(index: HybridIndex, token: string): number
export function bm25Scores(index: HybridIndex, tokens: string[]): number[]

/** 对已经过滤好的 rows 做混合排序；返回值形状和 recall 一致，另带 hybridScore / hybridCover */
export function hybridRank(opts: {
  rows: unknown[]
  query: string
  context?: string
  limit?: number
  minCover?: number
}): Array<Experience & { hybridScore: number; hybridCover: number }>