export const FORMAT: 'whale-memory-export'
export function sha256(buf: Uint8Array | string): string
export function stamp(): string
export function collectFiles(root: string): Array<{ name: string; abs: string }>
/** a 是否等于 b 或在 b 里面（解析现存父目录的真实路径，含目录链接） */
export function inside(a: string, b: string): boolean
/** 越界路径（正反斜杠、绝对路径、盘符、..）抛错 */
export function safeJoin(root: string, name: string): string

export interface ArchiveManifest {
  format: 'whale-memory-export'
  version: number
  exportedAt: string
  files: Array<{ name: string; bytes: number; sha256: string }>
  counts: Record<string, number>
}

export function exportArchive(memDir: string, outDir: string, opts?: { name?: string }): { ok: true; dir: string; files: number; bytes: number; counts: Record<string, number> }
/** 整包校验；不对就抛错并说清是哪个文件 */
export function verifyArchive(fromDir: string): ArchiveManifest
/** 先校验并暂存完整副本，再替换；force 保留旧目录备份，替换报错时尝试还原。源与目标不得互相包含。 */
export function importArchive(fromDir: string, memDir: string, opts?: { force?: boolean }): { ok: true; files: number; restoreTo: string; backup: string; counts: { experiences: number } }

/** 导入日志的路径：和目标目录同级，名字带 .import-journal.json */
export function importJournalPath(memDir: string): string

export interface ImportRecovery {
  /** 这一次真的把数据恢复回来了（in-progress / 待人工处理时为 false） */
  recovered: boolean
  /** 走到哪一步：no-journal / restored-backup / installed-stage / kept-target / restore-failed … */
  action: string
  target: string
  journal: string
  backup: string
  /** restore-failed 时说明卡在哪 */
  error?: string
  stage?: string
}

/** 恢复被打断的导入（断电/崩溃后调用）：能自动恢复就恢复，不能就保留日志和产物等人工处理 */
export function recoverImport(memDir: string): ImportRecovery
