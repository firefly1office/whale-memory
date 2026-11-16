import type { AsOf } from './self-experience.js'

/** 人能读的 Markdown 自传：按章节分组，章节外按月份；封存的默认不收 */
export function renderBook(dir: string, opts?: { asOf?: AsOf; includeSealed?: boolean; title?: string; now?: Date }): string
