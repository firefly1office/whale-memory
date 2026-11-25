// SQLite 后端（阶段 1）：用 Node 内置的 node:sqlite，不引入依赖。
//
// 要求 Node >= 22.5（node:sqlite 自 22.5 起可用）。宿主在 Node 20 上跑时，
// 动态 import 会失败，这里给一句明确的话，由调用方退回 file 后端——
// 不装依赖、不静默降级。
//
// 表结构故意只有一个表：id 主键 + day/at 索引 + 整行 json。
// 记录是不可变的，所以不需要 UPDATE；换引擎不改变契约里的任何一条。
import path from 'node:path'

const TABLE = 'records'

export class SqliteBackend {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir
    this.kind = 'sqlite'
    this.file = path.join(dir, 'memory.sqlite')
    this.db = null
    this.capabilities = { transactions: true, wal: true, engine: 'sqlite' }
  }

  async #open() {
    if (this.db) return this.db
    let DatabaseSync
    try {
      ;({ DatabaseSync } = await import('node:sqlite'))
    } catch {
      throw new Error('当前 Node 版本没有内置 node:sqlite（需要 >= 22.5）；请改用 file 后端')
    }
    const fs = await import('node:fs')
    fs.mkdirSync(this.dir, { recursive: true })
    const db = new DatabaseSync(this.file)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      at TEXT NOT NULL,
      json TEXT NOT NULL
    )`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_day ON ${TABLE}(day)`)
    this.db = db
    return db
  }

  /** @param {object} record */
  async append(record) {
    const db = await this.#open()
    if (!record || typeof record.id !== 'string' || !record.id) throw new Error('记录缺少 id')
    const stmt = db.prepare(`INSERT INTO ${TABLE} (id, day, at, json) VALUES (?, ?, ?, ?)`)
    try {
      stmt.run(record.id, String(record.day || ''), String(record.at || ''), JSON.stringify(record))
    } catch (error) {
      // 同一个 id 写两次是调用方的 bug；契约里 id 永不复用，这里直接拒绝
      if (String(error?.message || '').includes('UNIQUE')) throw new Error('id 已存在：' + record.id)
      throw error
    }
    return record
  }

  async all() {
    const db = await this.#open()
    const rows = db.prepare(`SELECT json FROM ${TABLE} ORDER BY rowid`).all()
    return rows.map((r) => JSON.parse(r.json))
  }

  /** @param {string} id */
  async byId(id) {
    const db = await this.#open()
    const row = db.prepare(`SELECT json FROM ${TABLE} WHERE id = ?`).get(String(id))
    return row ? JSON.parse(row.json) : null
  }

  /** 按本地日取（契约里的 day 语义）。 */
  async byDay(day) {
    const db = await this.#open()
    const rows = db.prepare(`SELECT json FROM ${TABLE} WHERE day = ? ORDER BY rowid`).all(String(day))
    return rows.map((r) => JSON.parse(r.json))
  }

  async count() {
    const db = await this.#open()
    return db.prepare(`SELECT COUNT(*) AS c FROM ${TABLE}`).get().c
  }

  /** 事务里跑一段：迁移用。失败自动回滚。 */
  async transaction(fn) {
    const db = await this.#open()
    db.exec('BEGIN')
    try {
      const result = await fn(this)
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  async close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}