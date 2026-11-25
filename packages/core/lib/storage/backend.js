// 存储后端接口（阶段 1）
//
// 目的：把「记录存在哪」和「记录长什么样」分开。契约（docs/contract-v1-zh.md）
// 说记录不可变、追加写；引擎换成 SQLite 也不该改变契约里的任何一条。
//
// 两个后端都接管经历记录和六类事件（改主意/封存/想起/未完成/联想/章节）：
// append / appendEvent / events / all / byId / byDay / count；sqlite 另有 appendWithEvents 与 transaction。
// 上层的写路径（addExperience 等）还没接到这里，仍直接写 JSONL——见 docs/storage-backend-zh.md 第六节。

/** @typedef {{ id: string, at: string, day: string, then: object, [k: string]: any }} Record */

/**
 * 后端能力。调用方可以据此决定能不能依赖事务。
 * @typedef {{ transactions: boolean, wal: boolean, engine: 'file'|'sqlite' }} Capabilities
 */

/**
 * 打开一个后端。
 * @param {{ kind?: 'file'|'sqlite', dir: string }} options
 */
export async function openBackend({ kind = 'file', dir } = {}) {
  if (!dir) throw new Error('openBackend 需要 dir')
  const name = String(kind || 'file')
  if (name === 'file') {
    const { FileBackend } = await import('./file-backend.js')
    return new FileBackend(dir)
  }
  if (name === 'sqlite') {
    const { SqliteBackend } = await import('./sqlite-backend.js')
    return new SqliteBackend(dir)
  }
  throw new Error('未知的存储后端：' + name + '（支持 file / sqlite）')
}

/** 把后端里的记录读成一个数组；坏一条就整体失败（fail closed）。 */
export async function dumpRecords(backend) {
  const rows = await backend.all()
  return rows
}