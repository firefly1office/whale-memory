// 作品稿本（drafts）：一个角色自己写下来的正文，能改、能读回、能翻回过去。
//
// 解决的问题很小、很具体：
//   · 聊天记录留不住"她写下来的东西"——一段正文改到第三版，前两版就没地方找了；
//   · 两个进程同时改同一页，后写的会把先写的覆盖掉，而且没人知道发生了冲突；
//   · 网络重试会把同一次保存写两遍，版本号凭空多一版。
//
// 所以这里只有三件事：只追加的版本、可选的旧版本读取、以及"你上一次读到的版本"这个基线。
// 不做内容判断、不调用模型、不碰网络；纯 Node 内置模块。
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const MAX_TEXT_BYTES = 16384
export const MAX_VERSIONS_PER_ITEM = 2000

const LOCK_TIMEOUT_MS = 1000
const LOCK_RETRY_MS = 20

function fail(code, extra = {}) {
  return { ok: false, code, ...extra }
}

function scopeDir(dir, scopeKey) {
  const hash = createHash('sha256').update(String(scopeKey || ''), 'utf8').digest('hex').slice(0, 32)
  return path.join(dir, 'drafts', hash)
}

function itemFile(dir, scopeKey, itemId) {
  return path.join(scopeDir(dir, scopeKey), `${itemId}.jsonl`)
}

function byteLength(text) {
  return Buffer.byteLength(String(text), 'utf8')
}

/** 读一份稿子的所有版本；坏行跳过，但整份都读不出来时报 unreadable。 */
function loadVersions(file) {
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, versions: [], corrupt: 0 }
    return fail('unreadable', { error })
  }
  const versions = []
  let corrupt = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed)
      if (!row || typeof row !== 'object') throw new Error('bad row')
      if (!Number.isInteger(row.revision) || row.revision <= 0) throw new Error('bad revision')
      if (typeof row.text !== 'string') throw new Error('bad text')
      versions.push(row)
    } catch {
      corrupt += 1
    }
  }
  if (!versions.length && corrupt > 0) return fail('unreadable', { corrupt })
  versions.sort((a, b) => a.revision - b.revision)
  return { ok: true, versions, corrupt }
}

function acquireLock(lockDir) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      fs.mkdirSync(lockDir, { recursive: false })
      return true
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        // 崩溃留下的锁：超过 30 秒就收掉
        try {
          const st = fs.statSync(lockDir)
          if (Date.now() - st.mtimeMs > 30000) {
            fs.rmdirSync(lockDir, { recursive: true })
            continue
          }
        } catch { /* 锁刚好消失，继续重试 */ }
        if (Date.now() > deadline) return false
        continue
      }
      try { fs.mkdirSync(path.dirname(lockDir), { recursive: true }) } catch { /* 下面重试 */ }
      if (Date.now() > deadline) return false
    }
  }
}

function releaseLock(lockDir) {
  try { fs.rmdirSync(lockDir) } catch { /* 已经没了 */ }
}

/** 原子写：先写同目录临时文件，再 rename 覆盖。 */
function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 存一版。
 *
 * @param {string} dir 数据目录
 * @param {object} input
 * @param {string} input.scopeKey 作用域（例如某个会话的键）；不同作用域互相看不见
 * @param {string} input.itemId 哪一件作品
 * @param {string} input.text 整份正文（不是补丁）
 * @param {number} input.baseRevision 你读到的那一版；第一次写是 0
 * @param {string} [input.operationId] 重试用的幂等键；同键同内容重复提交只算一版
 * @param {number} [input.now] 测试用的时钟
 * @returns {{ok:true, itemId:string, revision:number, at:number, replayed?:true} | {ok:false, code:string, [k:string]:unknown}}
 */
export function saveDraft(dir, { scopeKey = '', itemId = '', text = '', baseRevision, operationId = '', now = Date.now() } = {}) {
  const scope = String(scopeKey || '').trim()
  const id = String(itemId || '').trim()
  if (!scope) return fail('invalid_input', { field: 'scopeKey' })
  if (!id) return fail('invalid_input', { field: 'itemId' })
  if (typeof text !== 'string') return fail('invalid_input', { field: 'text' })
  if (!text.trim()) return fail('invalid_input', { field: 'text', reason: 'empty' })
  if (byteLength(text) > MAX_TEXT_BYTES) return fail('text_too_large', { limit: MAX_TEXT_BYTES })
  const base = Number(baseRevision)
  if (!Number.isInteger(base) || base < 0) return fail('invalid_input', { field: 'baseRevision' })

  const file = itemFile(dir, scope, id)
  const lockDir = `${file}.lock`
  const opId = String(operationId || '').trim()

  try { fs.mkdirSync(path.dirname(file), { recursive: true }) } catch (error) { return fail('storage_error', { error }) }
  if (!acquireLock(lockDir)) return fail('busy')
  try {
    const loaded = loadVersions(file)
    if (!loaded.ok) return loaded
    const { versions } = loaded
    const currentRevision = versions.length ? versions[versions.length - 1].revision : 0

    // 幂等重放：同一个 operationId 已经落过盘，直接回原回执
    if (opId) {
      const previous = versions.find((row) => String(row.operationId || '') === opId)
      if (previous) {
        if (Number(previous.baseRevision) === base && previous.text === text) {
          return { ok: true, itemId: id, revision: previous.revision, at: previous.at, replayed: true }
        }
        return fail('operation_conflict', { itemId: id, revision: previous.revision })
      }
    }

    if (base !== currentRevision) return fail('conflict', { itemId: id, currentRevision })
    if (versions.length >= MAX_VERSIONS_PER_ITEM) return fail('version_limit', { limit: MAX_VERSIONS_PER_ITEM })

    const at = Number(now) || Date.now()
    const row = {
      v: 1, scopeKey: scope, itemId: id,
      revision: currentRevision + 1, baseRevision: base,
      operationId: opId, at, text,
    }
    const next = `${versions.map((r) => JSON.stringify(r)).join('\n')}${versions.length ? '\n' : ''}${JSON.stringify(row)}\n`
    writeAtomic(file, next)
    return { ok: true, itemId: id, revision: row.revision, at }
  } catch (error) {
    return fail('storage_error', { error })
  } finally {
    releaseLock(lockDir)
  }
}

/**
 * 读回来。不指定 revision 就是最新一版；给了 asOf 就取那个时刻之前最后一版。
 *
 * @returns {{ok:true, itemId:string, revision:number, text?:string, at?:number, empty?:true} | {ok:false, code:string}}
 */
export function readDraft(dir, { scopeKey = '', itemId = '', revision, asOf } = {}) {
  const scope = String(scopeKey || '').trim()
  const id = String(itemId || '').trim()
  if (!scope || !id) return fail('invalid_input', { field: !scope ? 'scopeKey' : 'itemId' })
  const file = itemFile(dir, scope, id)
  const loaded = loadVersions(file)
  if (!loaded.ok) return loaded
  const { versions } = loaded
  if (!versions.length) return { ok: true, itemId: id, revision: 0, empty: true }

  if (revision !== undefined && revision !== null) {
    const want = Number(revision)
    const hit = versions.find((row) => row.revision === want)
    if (!hit) return fail('revision_missing', { itemId: id, revision: want })
    return { ok: true, itemId: id, revision: hit.revision, text: hit.text, at: hit.at }
  }
  if (asOf !== undefined && asOf !== null) {
    const cutoff = Number(asOf)
    if (!Number.isFinite(cutoff)) return fail('invalid_input', { field: 'asOf' })
    const hit = [...versions].reverse().find((row) => Number(row.at) <= cutoff)
    if (!hit) return { ok: true, itemId: id, revision: 0, empty: true }
    return { ok: true, itemId: id, revision: hit.revision, text: hit.text, at: hit.at }
  }
  const latest = versions[versions.length - 1]
  return { ok: true, itemId: id, revision: latest.revision, text: latest.text, at: latest.at }
}

/**
 * 翻历史：从新到旧，给 revision 和字数，不给正文（正文要逐版读）。
 *
 * @returns {{ok:true, itemId:string, versions:Array<{revision:number, at:number, bytes:number}>, nextBefore:number|null} | {ok:false, code:string}}
 */
export function listHistory(dir, { scopeKey = '', itemId = '', before, limit = 20 } = {}) {
  const scope = String(scopeKey || '').trim()
  const id = String(itemId || '').trim()
  if (!scope || !id) return fail('invalid_input', { field: !scope ? 'scopeKey' : 'itemId' })
  const file = itemFile(dir, scope, id)
  const loaded = loadVersions(file)
  if (!loaded.ok) return loaded
  const max = Math.max(1, Math.min(200, Number(limit) || 20))
  const cursor = Number(before)
  const rows = loaded.versions
    .filter((row) => !Number.isFinite(cursor) || row.revision < cursor)
    .sort((a, b) => b.revision - a.revision)
  const page = rows.slice(0, max)
  return {
    ok: true,
    itemId: id,
    versions: page.map((row) => ({ revision: row.revision, at: row.at, bytes: byteLength(row.text) })),
    nextBefore: rows.length > max ? page[page.length - 1].revision : null,
  }
}