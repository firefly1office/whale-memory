// 每日备份：她的记忆库、日记、摘要、配置；保留 30 天；支持恢复演练
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const DATA = 'C:/Users/USER/QQAgentData'
const DEST = './backups/daily'
const SEVENZIP = 'C:/Program Files/7-Zip/7z.exe'
const KEEP_DAYS = 30

fs.mkdirSync(DEST, { recursive: true })
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
const out = path.join(DEST, `whale-${stamp}.7z`)

const items = [
  ['plugin-data/biomimetic-memory', path.join(DATA, 'plugin-data/biomimetic-memory')],
  ['plugin-data/companion-memory', path.join(DATA, 'plugin-data/companion-memory')],
  ['plugin-data/whale-practice', path.join(DATA, 'plugin-data/whale-practice')],
  ['memory', path.join(DATA, 'memory')],
  ['memory-v2', path.join(DATA, 'memory-v2')],
  ['memory-v3', path.join(DATA, 'memory-v3')],
  ['semantic-cards', path.join(DATA, 'semantic-cards')],
  ['stickers.json', path.join(DATA, 'stickers.json')],
  ['config.json', path.join(DATA, 'config.json')]
].filter(([, p]) => fs.existsSync(p))

const args = ['a', out, ...items.map(([rel]) => rel), '-mx=5', '-y']
try {
  execFileSync(SEVENZIP, args, { stdio: 'pipe', timeout: 20 * 60 * 1000, cwd: DATA })
  const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1)
  console.log(`备份完成 ${path.basename(out)} ${size}MB，包含 ${items.length} 项`)
} catch (e) {
  console.error('备份失败:', String(e.message).slice(0, 300))
  process.exit(1)
}

// 清理超过保留期的
const cutoff = Date.now() - KEEP_DAYS * 86400000
let removed = 0
for (const f of fs.readdirSync(DEST)) {
  const p = path.join(DEST, f)
  if (!f.startsWith('whale-') || !f.endsWith('.7z')) continue
  if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { force: true }); removed++ }
}
if (removed) console.log(`清理过期备份 ${removed} 个`)
console.log('备份目录:', DEST)
