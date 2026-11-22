export function withFileLock<T>(lockPath: string, fn: () => T, opts?: { timeoutMs?: number }): T

/** 原子写文件（临时文件 + fsync + rename）：写成功返回目标路径，失败抛错且不留临时文件 */
export function writeFileAtomic(file: string, data: string | Uint8Array): string