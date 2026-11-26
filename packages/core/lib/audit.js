// 审计（阶段 4）：只追加的 audit.jsonl，一行一个 { at, actor, action, ids, note }。
//
// 目的只有一个：出了事能回答"谁在什么时候读过/召回/撤回过哪几条"。
// 因此它有两条硬规矩：
//   1. **不记正文**。正文、查询原文、经历的一句话摘要都不进来。召回只留查询的 sha256（note = "qsha256:<hex>"）。
//   2. **库内 API 删不掉它**。这里只导出追加与只读查询，没有删除/清空/改写；要动只能人拿编辑器来。
//
// 不自动挂在读路径上：loadAll / recall 是纯读（备份、体检、评测都靠它们），在库里偷偷写文件
// 会让"读"不再只读，也会让只读盘上的库直接报错。宿主在"要留痕"的那个边界调 noteRead / noteRecall；
// eraseExperience 自己写 erase 那一条。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { withFileLock } from './file-lock.js'
import { readLines } from './jsonl-stream.js'
import { currentView, recall as recallInner } from './self-experience.js'

const FILE = 'audit.jsonl'

// 动作：至少这三类。别的名字也收（新增动作算兼容），但必须是非空字符串
export const ACTIONS = Object.freeze(['read', 'recall', 'erase'])

export const eventsFile = (memDir) => path.join(memDir, FILE)

export function isValid(r) {
  return Boolean(
    r &&
    typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) &&
    typeof r.actor === 'string' && r.actor.trim() &&
    typeof r.action === 'string' && r.action.trim() &&
    Array.isArray(r.ids) && r.ids.every((id) => typeof id === 'string') &&
    typeof r.note === 'string'
  )
}

// 查询哈希：只留指纹，不留原文（查询里经常带着她写的原话）
export const queryHash = (query) => crypto.createHash('sha256').update(String(query ?? ''), 'utf8').digest('hex')

// 追加一条：先校验再写；锁内只 append，不重读整个文件（审计会越来越长）
export function record(memDir, { at = new Date().toISOString(), actor, action, ids = [], note = '' } = {}) {
  const row = {
    at: String(at),
    actor: String(actor ?? '').trim(),
    action: String(action ?? '').trim(),
    ids: (Array.isArray(ids) ? ids : []).map(String),
    note: String(note ?? '')
  }
  if (!isValid(row)) throw new Error('审计行不合格（需要 at / actor / action / ids / note），拒绝写入。（audit row is not valid）')
  fs.mkdirSync(memDir, { recursive: true })
  return withFileLock(eventsFile(memDir) + '.lock', () => {
    const file = eventsFile(memDir)
    let prefix = ''
    try {
      const st = fs.statSync(file)
      if (st.size) {
        const fd = fs.openSync(file, 'r')
        const buf = Buffer.alloc(1)
        fs.readSync(fd, buf, 0, 1, st.size - 1)
        fs.closeSync(fd)
        if (buf[0] !== 10) prefix = '\n'
      }
    } catch { }
    fs.appendFileSync(file, prefix + JSON.stringify(row) + '\n', 'utf8')
    return row
  })
}

// 读一次（宿主在"她要看这一条"的边界调它）：返回记录（找不到返回 null），并留一条 read 审计
export function readRecord(dir, id, { actor, note = '', backend = 'file', asOf = null } = {}) {
  const row = currentView(dir, String(id), { asOf, backend })
  record(dir, { actor, action: 'read', ids: [String(id)], note })
  return row
}

// 召回一次并留一条 recall 审计：只留查询哈希 + 命中 id，不留查询原文
export function recall(dir, query, { actor, note = '', ...opts } = {}) {
  const hits = recallInner(dir, query, opts)
  record(dir, { actor, action: 'recall', ids: hits.map((r) => r.id), note: note || 'qsha256:' + queryHash(query) })
  return hits
}

// 只读查询：按动作 / 按人 / 按时间（ISO 或 Date，左闭右开），按追加顺序返回
export function read(dir, { since = null, until = null, action = '', actor = '' } = {}) {
  const from = since === null || since === undefined || since === '' ? null : ms(since, 'since')
  const to = until === null || until === undefined || until === '' ? null : ms(until, 'until')
  const wantAction = String(action || '')
  const wantActor = String(actor || '')
  const rows = []
  let bad = 0
  let fd
  try {
    fd = fs.openSync(eventsFile(dir), 'r')
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    const wrapped = new Error('审计文件读不出来（' + FILE + '）：' + String(error && error.message ? error.message : error))
    wrapped.code = 'AUDIT_UNREADABLE'
    wrapped.cause = error
    throw wrapped
  }
  try {
    for (const line of readLines(fd)) {
      if (!line.text.trim()) continue
      let row
      try { row = JSON.parse(line.text) } catch { bad += 1; continue }
      if (!isValid(row)) { bad += 1; continue }
      const t = Date.parse(row.at)
      if (from !== null && t < from) continue
      if (to !== null && t >= to) continue
      if (wantAction && row.action !== wantAction) continue
      if (wantActor && row.actor !== wantActor) continue
      rows.push(row)
    }
  } finally {
    fs.closeSync(fd)
  }
  // 坏行不静默：审计读不完整时宁可报错，也不给一份"看起来没问题"的审计
  if (bad > 0) {
    const error = new Error('审计文件有 ' + bad + ' 行无法解析或不合格：这份审计不完整，不能当真。（' + bad + ' unreadable audit line(s)）')
    error.code = 'AUDIT_CORRUPT'
    error.bad = bad
    throw error
  }
  return rows
}

function ms(v, name) {
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v))
  if (!Number.isFinite(t)) throw new Error(name + ' 不是合法时间（用 ISO 时间或 Date）。（invalid audit time filter）')
  return t
}

// 宿主边界用的顺手别名（名字直白一点，别让调用方去记 action 字符串）
export const noteRead = (dir, { actor, ids, note = '' } = {}) => record(dir, { actor, action: 'read', ids, note })
export const noteRecall = (dir, { actor, ids, query = '', note = '' } = {}) => record(dir, { actor, action: 'recall', ids, note: note || 'qsha256:' + queryHash(query) })

export const internals = { FILE }