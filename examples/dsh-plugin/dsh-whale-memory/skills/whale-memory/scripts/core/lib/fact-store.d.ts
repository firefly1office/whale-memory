/** 读全部事实卡；文件不存在返回空数组 */
export function loadFacts(dir: string): Array<Record<string, unknown>>
/** 合并写入（同 kind+value 更新而不堆积） */
export function saveFacts(dir: string, facts: Array<Record<string, unknown>>): { added: number; updated: number }
/** 挑和当前这句话最相关的事实；没有明显相关的返回空 */
export function relevantFacts(facts: Array<Record<string, unknown>>, query: string, options?: { limit?: number }): Array<Record<string, unknown>>
/** 渲染成一行提示词；没有事实返回空串 */
export function renderFactsLine(facts: Array<Record<string, unknown>>): string
