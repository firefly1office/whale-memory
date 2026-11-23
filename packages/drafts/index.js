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

import { withFileLock } from './lib/file-lock.js'

export const MAX_TEXT_BYTES = 16384
export const MAX_VERSIONS_PER_ITEM = 2000
export const MAX_ID_LENGTH = 200

const DEFAULT_LOCK_TIMEOUT_MS = 3000
const LOCKED_MESSAGE = 'The file is locked by another process; try again shortly.（文件被另一个进程锁着，稍后再试。）'

function fail(code, extra = {}) {
  return { ok: false, code, ...extra }
}

function normalizeId(value) {
  const id = String(value ?? '').trim()
  if (!id) return ''
  if (id.length > MAX_ID_LENGTH) return ''
  // 换行、控制字符会让"一行一版"的存储结构崩掉；不允许
  if (/[\u0000-\u001f\u007f]/.test(id)) return ''
  return id
}

function hashKey(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 32)
}

// itemId 只取哈希当文件名：调用方给什么字符串都行，但拼不出 ../ 这种路径。
function scopeDir(dir, scopeKey) {
  return path.join(dir, 'drafts', hashKey(scopeKey))
}

function itemFile(dir, scopeKey, itemId) {
  return path.join(scopeDir(dir, scopeKey), `${hashKey(itemId)}.jsonl`)
}

function byteLength(text) {
  return Buffer.byteLength(String(text), 'utf8')
}

/** 读一份稿子的所有版本；坏行跳过并计数，但整份都读不出来时报 unreadable。 */
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

/**
 * 追加一行并落盘。用 O_APPEND 单次写：不重写整个文件，坏行/历史行原样保留。
 * 注意：不提供"删版本"的接口——旧版本是她的过去，删不删由调用方决定。
 */
function appendLine(file, line) {
  const fd = fs.openSync(file, 'a')
  try {
    // 文件末尾如果停在半行（崩溃、掉电、写入不足），直接追加会把新行粘在坏行后面，
    // 结果是"保存成功但这一版读不出来"。先补一个换行，让半行原样留着当坏行。
    const size = fs.fstatSync(fd).size
    if (size > 0) {
      const rfd = fs.openSync(file, 'r')
      try {
        const last = Buffer.alloc(1)
        fs.readSync(rfd, last, 0, 1, size - 1)
        if (last[0] !== 0x0a) fs.writeSync(fd, '\n')
      } finally {
        fs.closeSync(rfd)
      }
    }
    const buf = Buffer.from(line, 'utf8')
    let offset = 0
    while (offset < buf.length) offset += fs.writeSync(fd, buf, offset, buf.length - offset)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 存一版。
 *
 * @param {string} dir 数据目录
 * @param {object} input
 * @param {string} input.scopeKey 作用域（例如某个会话的键）；不同作用域互相看不见
 * @param {string} input.itemId 哪一件作品（任意字符串，存储时只取哈希）
 * @param {string} input.text 整份正文（不是补丁）
 * @param {number} input.baseRevision 你读到的那一版；第一次写是 0
 * @param {string} [input.operationId] 幂等键；同键重复提交不会多出一版
 * @param {number} [input.now] 测试用的时钟
 * @param {number} [input.lockTimeoutMs] 抢锁等待上限（测试用）
 * @returns {{ok:true, itemId:string, revision:number, at:number, replayed?:true} | {ok:false, code:string, [k:string]:unknown}}
 */
export function saveDraft(dir, {
  scopeKey = '', itemId = '', text = '', baseRevision,
  operationId = '', now = Date.now(), lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
} = {}) {
  const scope = String(scopeKey || '').trim()
  if (!scope) return fail('invalid_input', { field: 'scopeKey' })
  const id = normalizeId(itemId)
  if (!id) return fail('invalid_input', { field: 'itemId' })
  if (typeof text !== 'string') return fail('invalid_input', { field: 'text' })
  if (!text.trim()) return fail('invalid_input', { field: 'text', reason: 'empty' })
  if (byteLength(text) > MAX_TEXT_BYTES) return fail('text_too_large', { limit: MAX_TEXT_BYTES })
  const base = Number(baseRevision)
  if (!Number.isInteger(base) || base < 0) return fail('invalid_input', { field: 'baseRevision' })

  const file = itemFile(dir, scope, id)
  const lockPath = `${file}.lock`
  const opId = String(operationId || '').trim()

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  } catch (error) {
    return fail('storage_error', { error })
  }

  try {
    return withFileLock(lockPath, () => {
      const loaded = loadVersions(file)
      if (!loaded.ok) return loaded
      const { versions } = loaded
      const currentRevision = versions.length ? versions[versions.length - 1].revision : 0

      // 幂等重放：同一个 operationId 已经落过盘，直接回原回执（不再看 baseRevision）
      if (opId) {
        const previous = versions.find((row) => String(row.operationId || '') === opId)
        if (previous) {
          if (previous.text === text) {
            return { ok: true, itemId: id, revision: previous.revision, at: previous.at, replayed: true }
          }
          return fail('operation_conflict', { itemId: id, revision: previous.revision })
        }
      }

      if (base !== currentRevision) return fail('conflict', { itemId: id, currentRevision })
      if (versions.length >= MAX_VERSIONS_PER_ITEM) return fail('version_limit', { limit: MAX_VERSIONS_PER_ITEM })

      const at = Number.isFinite(Number(now)) ? Number(now) : Date.now()
      const row = {
        v: 1, scopeKey: scope, itemId: id,
        revision: currentRevision + 1, baseRevision: base,
        operationId: opId, at, text,
      }
      appendLine(file, `${JSON.stringify(row)}\n`)
      return { ok: true, itemId: id, revision: row.revision, at }
    }, { timeoutMs: Number.isFinite(Number(lockTimeoutMs)) ? Math.max(0, Number(lockTimeoutMs)) : DEFAULT_LOCK_TIMEOUT_MS })
  } catch (error) {
    if (String(error && error.message || '') === LOCKED_MESSAGE) return fail('busy')
    return fail('storage_error', { error })
  }
}

/**
 * 读回来。不指定 revision 就是最新一版；给了 asOf 就取那个时刻之前最后一版。
 *
 * asOf 用的是每条记录里调用方给的 `at`，所以时钟回拨会让结果看起来"错位"
 * （这是调用方时钟的问题，不在本模块里修正）。
 */
export function readDraft(dir, { scopeKey = '', itemId = '', revision, asOf } = {}) {
  const scope = String(scopeKey || '').trim()
  if (!scope) return fail('invalid_input', { field: 'scopeKey' })
  const id = normalizeId(itemId)
  if (!id) return fail('invalid_input', { field: 'itemId' })
  const loaded = loadVersions(itemFile(dir, scope, id))
  if (!loaded.ok) return loaded
  const { versions, corrupt } = loaded
  if (!versions.length) return { ok: true, itemId: id, revision: 0, empty: true, corrupt }

  if (revision !== undefined && revision !== null) {
    const want = Number(revision)
    // 空稿读出来的就是 revision 0；显式要 0 时按"空"返回，而不是报找不到
    if (want === 0) return { ok: true, itemId: id, revision: 0, empty: true, corrupt }
    const hit = versions.find((row) => row.revision === want)
    if (!hit) return fail('revision_missing', { itemId: id, revision: want })
    return { ok: true, itemId: id, revision: hit.revision, text: hit.text, at: hit.at, corrupt }
  }
  if (asOf !== undefined && asOf !== null) {
    const cutoff = Number(asOf)
    if (!Number.isFinite(cutoff)) return fail('invalid_input', { field: 'asOf' })
    const hit = [...versions].reverse().find((row) => Number(row.at) <= cutoff)
    if (!hit) return { ok: true, itemId: id, revision: 0, empty: true, corrupt }
    return { ok: true, itemId: id, revision: hit.revision, text: hit.text, at: hit.at, corrupt }
  }
  const latest = versions[versions.length - 1]
  return { ok: true, itemId: id, revision: latest.revision, text: latest.text, at: latest.at, corrupt }
}

/**
 * 翻历史：从新到旧，给 revision 和字数，不给正文（正文要逐版读）。
 */
export function listHistory(dir, { scopeKey = '', itemId = '', before, limit = 20 } = {}) {
  const scope = String(scopeKey || '').trim()
  if (!scope) return fail('invalid_input', { field: 'scopeKey' })
  const id = normalizeId(itemId)
  if (!id) return fail('invalid_input', { field: 'itemId' })
  const loaded = loadVersions(itemFile(dir, scope, id))
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
    corrupt: loaded.corrupt,
  }
}