// 她自己的提示词 overlay：不碰默认段，整段追加；版本只追加，可回退
// 护栏：大小上限、控制字符清理、重复内容不写、原子写、单写者锁、篡改可检测
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DIR = 'prompt-overlay'
const ACTIVE = 'prompt-overlay.md'
const VERSIONS = 'versions'
const MAX_CHARS = 2000
const MAX_APPEND_TOTAL = 12000

function base(dataDir) {
  const d = path.join(dataDir, 'plugin-data', 'biomimetic-memory', DIR)
  fs.mkdirSync(path.join(d, VERSIONS), { recursive: true })
  return d
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)

// 清理不可见控制字符；换行和制表保留
function clean(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, '')
    .trim()
}

function atomicWrite(file, body) {
  const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  fs.writeFileSync(tmp, body, 'utf8')
  fs.renameSync(tmp, file)
}

// 单写者锁：另一个进程正在写时等一会儿；超过 timeout 报错，不静默覆盖
function withLock(dir, fn, { timeoutMs = 2000 } = {}) {
  const lock = path.join(dir, '.lock')
  const start = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        const st = fs.statSync(lock)
        if (Date.now() - st.mtimeMs > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue }
      } catch { /* 锁刚被释放 */ }
      if (Date.now() - start > timeoutMs) throw new Error('提示词文件被另一个进程锁着，稍后再试。')
      const t = Date.now()
      while (Date.now() - t < 25) { /* 短等待 */ }
    }
  }
  try { return fn() } finally { try { fs.rmSync(lock, { recursive: true, force: true }) } catch { } }
}

export function load(dataDir) {
  try {
    return clean(fs.readFileSync(path.join(base(dataDir), ACTIVE), 'utf8'))
  } catch { return '' }
}

export function save(dataDir, text, reason = '', opts = {}) {
  const body = clean(text)
  if (!body) return { ok: false, error: '空的，不写。' }
  if (body.length > MAX_CHARS) return { ok: false, error: '太长了（' + body.length + '/' + MAX_CHARS + ' 字），删一些再试。' }

  const current = load(dataDir)
  if (current === body) return { ok: true, noop: true, reason: '和当前版本一样，没有写入。' }

  const d = base(dataDir)
  try {
    return withLock(d, () => {
      const baseStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
      let stamp = baseStamp
      let n = 1
      while (fs.existsSync(path.join(d, VERSIONS, stamp + '.md'))) {
        stamp = baseStamp + '-' + n
        n += 1
      }
      atomicWrite(path.join(d, VERSIONS, stamp + '.md'), body)
      atomicWrite(path.join(d, ACTIVE), body)
      fs.appendFileSync(path.join(d, 'history.jsonl'), JSON.stringify({
        at: new Date().toISOString(),
        chars: body.length,
        hash: sha1(body),
        reason: String(reason || '').slice(0, 200),
        snapshot: stamp
      }) + '\n', 'utf8')
      return { ok: true, version: stamp, chars: body.length, hash: sha1(body) }
    }, opts)
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

export function history(dataDir, limit = 10) {
  try {
    const d = base(dataDir)
    const rows = fs.readFileSync(path.join(d, 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    return rows.slice(-limit).reverse()
  } catch { return [] }
}

export function revert(dataDir, version, reason = '') {
  try {
    const d = base(dataDir)
    const body = fs.readFileSync(path.join(d, VERSIONS, String(version) + '.md'), 'utf8')
    return save(dataDir, body, reason || ('回退到 ' + version))
  } catch { return { ok: false, error: '找不到这个版本。' } }
}

// 生效内容 = 默认段 + 她的 overlay；超总长会明确报告截断，不悄悄切
export function render(basePrompt, dataDir, { marker = '\n\n<!-- 她自己的补充 -->\n' } = {}) {
  const overlay = load(dataDir)
  const base = String(basePrompt || '')
  if (!overlay) return { text: base, appended: false, truncated: false }
  const full = base + marker + overlay
  if (full.length <= MAX_APPEND_TOTAL) return { text: full, appended: true, truncated: false }
  const room = MAX_APPEND_TOTAL - base.length - marker.length
  return {
    text: base + marker + overlay.slice(0, Math.max(0, room)),
    appended: true,
    truncated: true,
    note: 'overlay 超过总长上限，已截断；建议她精简。'
  }
}

// 篡改检测：生效文件应该和最新版本文件一致
export function verify(dataDir) {
  const active = load(dataDir)
  const h = history(dataDir, 1)[0]
  if (!h) return { ok: active === '', note: active ? '有生效文件但没有历史版本。' : '还没有写过。' }
  let versionBody = ''
  try { versionBody = clean(fs.readFileSync(path.join(base(dataDir), VERSIONS, String(h.snapshot) + '.md'), 'utf8')) } catch { }
  const ok = active === versionBody
  return { ok, activeHash: sha1(active), versionHash: sha1(versionBody), version: h.snapshot }
}

export const internals = { MAX_CHARS, MAX_APPEND_TOTAL, VERSIONS, ACTIVE, sha1 }