/** 把一批消息交给模型抽事实；引文对不上原文的条目不采信 */
export function judgeFacts(options: { messages: Array<{ ref?: string; sender?: string; text: string; ts?: number }>; chatCompletion: Function; maxMessages?: number; logger?: { warn?: Function } }): Promise<Array<{ kind: string; value: string; subject: string; quote: string; ts: number; ref: string }>>
export const FACT_KINDS: string[]
