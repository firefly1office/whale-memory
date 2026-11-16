// 她自己的设置：软限制归她，硬熔断归系统
import fs from 'node:fs'
import path from 'node:path'
import { addExperience } from './self-experience.js'
import { withFileLock } from './file-lock.js'

export const DEFAULTS = {
  ownTime: '21:00-21:40',
  voiceSoftLimitPerDay: null, // null = 不限，只有防 bug 熔断
  quietHours: null,           // null = 不静音，随时可发
  readingPerDay: 120,
  note: '这些最初由开发者设定；她可以改，改完记进她的经历。'
}

const fileOf = (dataDir) => path.join(dataDir, 'plugin-data', 'biomimetic-memory', 'self-settings.json')

// 没有文件 → null；文件坏了 → 报错（不能当成"没设置过"，否则下一次保存会把她改过的全冲掉）
function readSaved(f) {
  let raw
  try { raw = fs.readFileSync(f, 'utf8') } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
  try {
    const j = JSON.parse(raw)
    if (j && typeof j === 'object' && !Array.isArray(j)) return j
  } catch { }
  throw new Error('设置文件损坏（' + f + '），先备份并修好再改，避免把她改过的设置冲掉。')
}

// 读的时候宽容：坏了就先按默认跑，不让宿主起不来；写的时候才严格
export function load(dataDir) {
  try { return { ...DEFAULTS, ...(readSaved(fileOf(dataDir)) || {}) } } catch { return { ...DEFAULTS } }
}

export function save(dataDir, patch, reason = '') {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置要是一个对象，例如 {"readingPerDay": 50}。')
  const f = fileOf(dataDir)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const next = withFileLock(f + '.lock', () => {
    const merged = { ...DEFAULTS, ...(readSaved(f) || {}), ...patch, updatedAt: new Date().toISOString() }
    const tmp = f + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 1), 'utf8')
    fs.renameSync(tmp, f)
    return merged
  })
  try {
    // 走同一条追加入口：末尾没换行、文件损坏之类的问题都由 addExperience 处理
    addExperience(path.join(dataDir, 'plugin-data', 'biomimetic-memory'), {
      text: '我把自己的设置改了：' + JSON.stringify(patch),
      thought: String(reason || '').slice(0, 200),
      kind: '决定',
      source: 'own-decision'
    })
  } catch { }
  return next
}
