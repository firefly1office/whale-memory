// 她自己的设置：软限制归她，硬熔断归系统
import fs from 'node:fs'
import path from 'node:path'
import { addExperience } from './self-experience.js'

export const DEFAULTS = {
  ownTime: '21:00-21:40',
  voiceSoftLimitPerDay: null, // null = 不限，只有防 bug 熔断
  quietHours: null,           // null = 不静音，随时可发
  readingPerDay: 120,
  note: '这些最初由开发者设定；她可以改，改完记进她的经历。'
}

export function load(dataDir) {
  const f = path.join(dataDir, 'plugin-data', 'biomimetic-memory', 'self-settings.json')
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    return { ...DEFAULTS, ...j }
  } catch { return { ...DEFAULTS } }
}

export function save(dataDir, patch, reason = '') {
  const f = path.join(dataDir, 'plugin-data', 'biomimetic-memory', 'self-settings.json')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const cur = load(dataDir)
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() }
  fs.writeFileSync(f, JSON.stringify(next, null, 1), 'utf8')
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