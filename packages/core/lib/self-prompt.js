// 她自己的提示词 overlay：不碰默认段，整段追加；版本只追加，可回退
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'prompt-overlay'
const ACTIVE = 'prompt-overlay.md'
const VERSIONS = 'versions'
const MAX_CHARS = 2000

function base(dataDir) {
  const d = path.join(dataDir, 'plugin-data', 'biomimetic-memory', DIR)
  fs.mkdirSync(path.join(d, VERSIONS), { recursive: true })
  return d
}

export function load(dataDir) {
  try {
    const f = path.join(base(dataDir), ACTIVE)
    const text = fs.readFileSync(f, 'utf8').trim()
    return text || ''
  } catch { return '' }
}

export function save(dataDir, text, reason = '') {
  const body = String(text || '').trim()
  if (!body) return { ok: false, error: '空的，不写。' }
  if (body.length > MAX_CHARS) return { ok: false, error: '太长了（' + body.length + '/' + MAX_CHARS + ' 字），删一些再试。' }
  const d = base(dataDir)
  const baseStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
  let stamp = baseStamp
  let n = 1
  while (fs.existsSync(path.join(d, VERSIONS, stamp + '.md'))) {
    stamp = baseStamp + '-' + n
    n += 1
  }
  fs.writeFileSync(path.join(d, VERSIONS, stamp + '.md'), body, 'utf8')
  fs.writeFileSync(path.join(d, ACTIVE), body, 'utf8')
  fs.appendFileSync(path.join(d, 'history.jsonl'), JSON.stringify({ at: new Date().toISOString(), chars: body.length, reason: String(reason || '').slice(0, 200), snapshot: stamp }) + '\n', 'utf8')
  return { ok: true, version: stamp, chars: body.length }
}

export function history(dataDir, limit = 10) {
  try {
    const d = base(dataDir)
    const rows = fs.readFileSync(path.join(d, 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    return rows.slice(-limit).reverse()
  } catch { return [] }
}

export function revert(dataDir, version) {
  try {
    const d = base(dataDir)
    const body = fs.readFileSync(path.join(d, VERSIONS, String(version) + '.md'), 'utf8')
    return save(dataDir, body, '回退到 ' + version)
  } catch { return { ok: false, error: '找不到这个版本。' } }
}

export const internals = { MAX_CHARS, VERSIONS, ACTIVE }