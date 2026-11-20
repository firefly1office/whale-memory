/** 从一句话里抽事实（规则兜底）；返回空数组表示没抽到 */
export function extractFacts(text: string, meta?: { personId?: string; chatKey?: string; ts?: number; sourceId?: string }): Array<{ kind: string; value: string; subject: string; text: string; ts: number; personId: string; chatKey: string; sourceId: string }>
/** 合并：同 kind+value 留一条，记次数与最新时间 */
export function mergeFacts(facts: Array<Record<string, unknown>>): Array<Record<string, unknown>>
/** 渲染成一行 */
export function renderFact(fact: Record<string, unknown>): string
