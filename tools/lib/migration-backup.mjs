// 迁移的备份与回滚，两个迁移脚本共用
// 回滚可以重复执行，每次结果相同：备份文件一个都不删；当前事件文件只会被挪开，不会被删除
// 迁移前有没有事件文件，写在 <backup>.manifest.json 里，回滚不靠"备份文件还在不在"去猜
import fs from 'node:fs'

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)

export function writeManifest(backup, { eventsBackup = '' } = {}) {
  fs.writeFileSync(backup + '.manifest.json', JSON.stringify({ hadEvents: Boolean(eventsBackup), eventsBackup }) + '\n', 'utf8')
}

function readManifest(backup) {
  try { return JSON.parse(fs.readFileSync(backup + '.manifest.json', 'utf8')) } catch { return null }
}

export function rollback({ experiencesFile, eventsFile, backup, eventsBackup = '' }) {
  if (!backup || !fs.existsSync(backup)) throw new Error('找不到备份文件')
  const manifest = readManifest(backup)
  const pre = eventsBackup || (manifest && manifest.eventsBackup) || (backup + '.events')
  // 没有 manifest 的旧备份：只能看事件备份在不在
  const hadEvents = manifest ? Boolean(manifest.hadEvents) : fs.existsSync(pre)
  // 先核对，再动文件：说好有事件备份却找不到，就一个文件都不改
  if (hadEvents && !fs.existsSync(pre)) throw new Error('迁移前的事件备份不见了（' + pre + '），没有改动任何文件，请人工检查。')

  fs.copyFileSync(backup, experiencesFile)
  if (hadEvents) {
    // 迁移前就有事件：原样恢复。备份留着，再回滚一次结果一样
    fs.copyFileSync(pre, eventsFile)
    return { ok: true, restoredEvents: true }
  }
  // 迁移前没有事件文件：把现在的挪到旁边，不删
  let movedTo = ''
  if (fs.existsSync(eventsFile)) {
    movedTo = eventsFile + '.rolled-back-' + stamp()
    fs.renameSync(eventsFile, movedTo)
  }
  return { ok: true, restoredEvents: false, movedTo }
}
