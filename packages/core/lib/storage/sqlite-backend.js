// SQLite 后端（阶段 1）：用 Node 内置的 node:sqlite，不引入依赖。
//
// 要求 Node >= 22.5（node:sqlite 自 22.5 起可用）。拿不到 node:sqlite 时直接报错，
// 由调用方显式退回 file 后端——不装依赖、不静默降级。
//
// 两张数据表：records（id 主键 + day 索引 + 整行 json）和 events（seq 自增 + kind/exp_id 索引 + 整行 json）。
// 记录与事件都是不可变的，所以没有 UPDATE；换引擎不改变契约里的任何一条。
// 表结构、读写的同步内核在 ../sqlite-store.js（loadAll 是同步 API，要和这里共用同一份）。
import path from 'node:path'
import { DB_FILE, requireSqlite, openDatabase, insertRecord, insertEvent, recordExists, readEvents, readRecords, kindOf } from '../sqlite-store.js'

export class SqliteBackend {
  /** @param {string} dir */
  constructor(dir) {
    // 在 openBackend 这一步就报错：文档里「try sqlite / catch 退回 file」的写法才真的接得住
    requireSqlite()
    this.dir = dir
    this.kind = 'sqlite'
    this.file = path.join(dir, DB_FILE)
    this.db = null
    this.capabilities = { transactions: true, wal: true, engine: 'sqlite' }
    this.inTransaction = false
  }

  async #open() {
    if (this.db) return this.db
    this.db = openDatabase(this.dir, { create: true })
    return this.db
  }

  // 一段写入要么全成、要么全不成。已经在 transaction() 里时并进外层事务，不再嵌套 BEGIN
  #atomic(db, fn) {
    if (this.inTransaction) return fn()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** @param {object} record */
  async append(record) {
    const db = await this.#open()
    return insertRecord(db, record)
  }

  /**
   * 追加一条事件（原样存这一行的 JSON，不改形状）。
   * mustExist：先确认这条事件指向的经历在库里（改主意、封存、结案用）；查和写在同一个事务里。
   * 这是低层追加：不做「重复封存算 noop」这类业务判断，那些在上层。
   */
  async appendEvent(kind, row, { mustExist = false } = {}) {
    const db = await this.#open()
    const k = kindOf(kind)
    return this.#atomic(db, () => {
      if (mustExist && !recordExists(db, k.subject(row))) throw new Error('找不到这条经历：' + k.subject(row) + '（事件没有写入）')
      return insertEvent(db, kind, row)
    })
  }

  /**
   * 一条经历 + 它的若干事件，同一个事务写：任何一条失败（重复 id、事件不合格），整组都不落盘。
   * @param {object} record
   * @param {{ kind: string, row: object }[]} events
   */
  async appendWithEvents(record, events = []) {
    const db = await this.#open()
    return this.#atomic(db, () => {
      insertRecord(db, record)
      for (const e of events) insertEvent(db, e && e.kind, e && e.row)
      return record
    })
  }

  async all() {
    const db = await this.#open()
    const { rows, bad } = readRecords(db)
    // 坏数据整体失败，不当空
    if (bad) throw new Error('memory.sqlite 里有 ' + bad + ' 条记录解析不了（拒绝当作空）')
    return rows
  }

  /** 某一类事件，按追加顺序。坏行整体失败，不当空。 */
  async events(kind) {
    const db = await this.#open()
    const { rows, bad } = readEvents(db, kind)
    if (bad) throw new Error('memory.sqlite 里 ' + kind + ' 事件有 ' + bad + ' 条解析不了或不合格（拒绝当作空）')
    return rows
  }

  /** @param {string} id */
  async byId(id) {
    const db = await this.#open()
    const row = db.prepare('SELECT json FROM records WHERE id = ?').get(String(id))
    return row ? JSON.parse(row.json) : null
  }

  /** 按本地日取（契约里的 day 语义）。 */
  async byDay(day) {
    const db = await this.#open()
    const rows = db.prepare('SELECT json FROM records WHERE day = ? ORDER BY rowid').all(String(day))
    return rows.map((r) => JSON.parse(r.json))
  }

  async count() {
    const db = await this.#open()
    return db.prepare('SELECT COUNT(*) AS c FROM records').get().c
  }

  /** 事务里跑一段（记录与事件都在同一个事务里）。失败自动回滚。 */
  async transaction(fn) {
    const db = await this.#open()
    if (this.inTransaction) return fn(this)
    db.exec('BEGIN IMMEDIATE')
    this.inTransaction = true
    try {
      const result = await fn(this)
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  async close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
