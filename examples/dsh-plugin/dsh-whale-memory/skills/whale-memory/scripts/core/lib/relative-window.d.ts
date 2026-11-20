/** 把「前几天 / 上周三 / 上个月 / 两周前 / 昨天晚上」翻成 [from, to)；翻不出来返回 null */
export function parseRelativeWindow(text: string, options?: { now?: number }): { from: number; to: number; label: string; kind: string } | null
/** 时间是否落在窗口内；窗口为 null 时一律算在内 */
export function inWindow(ts: number | string | null | undefined, window: { from: number; to: number } | null): boolean
