/** 找出「后来改过想法」的经历；没改过或超出天数的不会出现 */
export function changedSince(dir: string, options?: { days?: number; limit?: number; now?: number; includeSealed?: boolean }): Array<{ id: string; day: string; then: string; now: string; at: number; daysAgo: number }>
/** 渲染成给模型看的一段话；没有就返回空串 */
export function renderChanged(items: Array<Record<string, unknown>>, options?: { lang?: 'zh' | 'en' }): string
