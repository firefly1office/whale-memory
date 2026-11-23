// 自主行动日志（self-actions）：角色做过什么，以及这件事是谁发起的。
//
// 这一层只存事实，不做判断：
//   · 动作是不是"她自己发起的"，由调用方声明（source），这里不推断；
//   · 结果好不好，由调用方声明（outcome）；
//   · 触发文本一个字都不存 —— 短句的哈希等于明文（"第三章""继续"一查就知道）。
//     需要留痕时，调用方自己算 HMAC 再传 triggerDigest。
//
// 存储是只追加的一行一条 JSONL：写坏了只坏一行，历史不会被重写。
import fs from 'node:fs'
import path from 'node:path'

import { withFileLock } from './file-lock.js'

export const FILE_NAME = 'self-actions.jsonl'
export const DEFAULT_MAX_LINES = 5000
export const SOURCES = Object.freeze(['asked', 'self', 'unknown'])
const LOCK_TIMEOUT_MS = 2000
const LOCKED_MESSAGE = 'The file is locked by another process; try again shortly.（文件被另一个进程锁着，稍后再试。）'

function fail(code, extra = {}) {
  return { ok: false, code, ...extra }
}

function dayOf(at) {
  return new Date(Number(at) || 0).toLocaleDateString('sv-SE')
}

function normalizeOutcome(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return /^[a-z][a-z0-9_]{0,23}$/.test(text) ? text : 'unknown'
}

function appendLine(file, line) {
  const fd = fs.openSync(file, 'a')
  try {
    // 末尾停在半行时先补换行：否则新行会粘在坏行后面，读的时候整行报废
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

function readRows(file) {
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, rows: [], corrupt: 0 }
    return fail('storage_error', { error })
  }
  const rows = []
  let corrupt = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed)
      if (!row || typeof row !== 'object') throw new Error('bad')
      if (!row.action || !Number.isFinite(Number(row.at))) throw new Error('bad')
      rows.push(row)
    } catch {
      corrupt += 1
    }
  }
  rows.sort((a, b) => Number(a.at) - Number(b.at))
  return { ok: true, rows, corrupt }
}

/**
 * 建一个日志实例。动作白名单由宿主给：不同产品词表不一样，这里不猜。
 *
 * @param {object} options
 * @param {string} options.dir 数据目录
 * @param {string[]} options.actions 允许记录的动作名
 * @param {number} [options.maxLines=5000] 超过就拒绝写入（不裁剪历史）
 */
export function createSelfActionLog({ dir, actions = [], maxLines = DEFAULT_MAX_LINES } = {}) {
  const base = String(dir || '').trim()
  const whitelist = new Set((Array.isArray(actions) ? actions : []).map((x) => String(x || '').trim()).filter(Boolean))
  const file = path.join(base, FILE_NAME)
  const limit = Number.isFinite(Number(maxLines)) && Number(maxLines) > 0 ? Number(maxLines) : DEFAULT_MAX_LINES

  /**
   * 记一条。source / outcome 都是调用方声明的，这里不推断。
   *
   * @param {object} input
   * @param {string} input.action
   * @param {'asked'|'self'|'unknown'} [input.source='unknown']
   * @param {string} [input.outcome='ok']
   * @param {string} [input.itemRef] 指向被操作对象的 id（可选）
   * @param {number} [input.triggerLen] 触发文本长度（可选；不存文本本身）
   * @param {string} [input.triggerDigest] 调用方自己算的摘要（可选，建议 HMAC）
   * @param {number} [input.at] 时间戳；测试用
   */
  function record({ action = '', source = 'unknown', outcome = 'ok', itemRef = '', triggerLen, triggerDigest = '', at = Date.now() } = {}) {
    const name = String(action || '').trim()
    if (!base) return fail('invalid_input', { field: 'dir' })
    if (!name) return fail('invalid_input', { field: 'action' })
    if (whitelist.size && !whitelist.has(name)) return fail('invalid_input', { field: 'action', reason: 'not_in_whitelist' })

    const ts = Number(at)
    if (!Number.isFinite(ts)) return fail('invalid_input', { field: 'at' })

    const row = {
      v: 1,
      at: ts,
      day: dayOf(ts),
      action: name.slice(0, 40),
      source: SOURCES.includes(source) ? source : 'unknown',
      outcome: normalizeOutcome(outcome),
      ...(itemRef ? { itemRef: String(itemRef).slice(0, 64) } : {}),
      ...(Number.isFinite(Number(triggerLen)) ? { triggerLen: Math.max(0, Math.floor(Number(triggerLen))) } : {}),
      ...(triggerDigest ? { triggerDigest: String(triggerDigest).slice(0, 64) } : {}),
    }

    try { fs.mkdirSync(base, { recursive: true }) } catch (error) { return fail('storage_error', { error }) }
    try {
      return withFileLock(`${file}.lock`, () => {
        const loaded = readRows(file)
        if (!loaded.ok) return loaded
        if (loaded.rows.length >= limit) return fail('limit', { limit })
        appendLine(file, `${JSON.stringify(row)}\n`)
        return { ok: true }
      }, { timeoutMs: LOCK_TIMEOUT_MS })
    } catch (error) {
      if (String(error && error.message || '') === LOCKED_MESSAGE) return fail('busy')
      return fail('storage_error', { error })
    }
  }

  /** 读回来。过滤条件都可选；坏行跳过并给 corrupt 计数。 */
  function read({ since, until, action = '', source = '', outcome = '', limit: take = 0 } = {}) {
    const loaded = readRows(file)
    if (!loaded.ok) return loaded
    let rows = loaded.rows
    if (Number.isFinite(Number(since))) rows = rows.filter((r) => Number(r.at) >= Number(since))
    if (Number.isFinite(Number(until))) rows = rows.filter((r) => Number(r.at) <= Number(until))
    if (action) rows = rows.filter((r) => r.action === action)
    if (source) rows = rows.filter((r) => r.source === source)
    if (outcome) rows = rows.filter((r) => r.outcome === outcome)
    const n = Number(take) > 0 ? Number(take) : 0
    const page = n ? rows.slice(-n) : rows
    return { ok: true, total: rows.length, rows: page, corrupt: loaded.corrupt }
  }

  /** 统计：自己发起 / 被要求 / 无法判断，以及每天各多少。 */
  function summarize({ now = Date.now(), days = 7 } = {}) {
    const end = Number(now)
    const start = end - Math.max(1, Number(days) || 7) * 86400000
    const loaded = read({ since: start, until: end })
    if (!loaded.ok) return loaded
    const bySource = { self: 0, asked: 0, unknown: 0 }
    const byOutcome = {}
    const byAction = {}
    const daily = new Map()
    for (const row of loaded.rows) {
      bySource[row.source] = (bySource[row.source] || 0) + 1
      byOutcome[row.outcome] = (byOutcome[row.outcome] || 0) + 1
      byAction[row.action] = (byAction[row.action] || 0) + 1
      const day = row.day || dayOf(row.at)
      if (!daily.has(day)) daily.set(day, { self: 0, asked: 0, unknown: 0 })
      daily.get(day)[row.source] = (daily.get(day)[row.source] || 0) + 1
    }
    return {
      ok: true,
      windowDays: Math.max(1, Number(days) || 7),
      total: loaded.rows.length,
      bySource,
      byOutcome,
      byAction,
      daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({ day, ...counts })),
      corrupt: loaded.corrupt,
    }
  }

  return { record, read, summarize, file, maxLines: limit }
}