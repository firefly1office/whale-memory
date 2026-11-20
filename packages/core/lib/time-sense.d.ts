/** 「刚刚 / 12 分钟前 / 今天 09:12 / 昨天 20:30 / 3 天前 / 上周三 / 2 个月前 / 2025-08-01」 */
export function humanTime(ts: number | string | null | undefined, options?: { now?: number }): string
/** 只要时长，不要时刻：「刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 4 天前」 */
export function timeAgo(ts: number | string | null | undefined, options?: { now?: number }): string
/** 本地日历日差：0=今天，1=昨天，2=前天 */
export function dayDiff(ts: number, now?: number): number | null
