export const FORMAT: 'whale-memory-export'
export function sha256(buf: Uint8Array | string): string
export function stamp(): string
export function collectFiles(root: string): Array<{ name: string; abs: string }>
/** a 是否等于 b 或在 b 里面（按解析后的绝对路径） */
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
/** 先整包校验；目标已有数据时默认拒绝，force 先把现有目录改名备份 */
export function importArchive(fromDir: string, memDir: string, opts?: { force?: boolean }): { ok: true; files: number; restoreTo: string; backup: string; counts: { experiences: number } }
