/** 「2026-11-15」= 那天本地时间最后一刻；也接受 ISO 时间或 Date；空值返回 null（不截断） */
export function parseAsOf(v: string | Date | null | undefined): number | null
/** 这条记录是否发生在截断时刻之前（含）；until 为 null 表示不截断 */
export function before(row: { at?: string } | null | undefined, until: number | null | undefined): boolean
export function dayOf(ms: number): string
