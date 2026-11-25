// SQLite 后端（阶段 1）：用 Node 内置的 node:sqlite，不引入依赖。
//
// 要求 Node >= 22.5（node:sqlite 自 22.5 起可用）。拿不到 node:sqlite 时直接报错，
// 由调用方显式退回 file 后端——不装依赖、不静默降级。
//
// 两张数据表：records（id 主键 + day 索引 + 整行 json）和 events（seq 自增 + kind/exp_id 索引 + 整行 json）。
// 记录与事件都是不可变的，所以没有 UPDATE；换引擎不改变契约里的任何一条。
// 表结构、读写的同步内核在 ../sqlite-store.js（loadAll 是同步 API，要和这里共用同一份）。
//
// 事务的规矩（一个后端对象只有一条连接）：
//   · 同一时刻只有一个事务。别的调用方（不在这个事务的调用链里）的读写一律排队，等它结束——
//     不会悄悄并进别人的事务、跟着别人一起回滚，也读不到别人还没提交的东西；
//   · 在事务自己的调用链里（transaction(fn) 的 fn 以及它 await 的一切）：写入直接进这个事务；
//     appendWithEvents / appendEvent / 嵌套的 transaction() 各自包一层 SAVEPOINT，
//     失败只撤掉自己这一组，外层可以接住错误继续；
//   · 同一个事务里别并发跑两个嵌套分组（Promise.all 两个嵌套 transaction）：SAVEPOINT 是栈，交错会乱。
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DB_FILE, requireSqlite, openDatabase, insertRecord, insertEvent, recordExists, readEvents, readRecords, kindOf } from '../sqlite-store.js'

export class SqliteBackend {
  #als = new AsyncLocalStorage()
  #tail = Promise.resolve()
  #savepoints = 0

  /** @param {string} dir */
  constructor(dir) {
    // 在 openBackend 这一步就报错：文档里「try sqlite / catch 退回 file」的写法才真的接得住
    requireSqlite()
    this.dir = dir
    this.kind = 'sqlite'
    this.file = path.join(dir, DB_FILE)
    this.db = null
    this.capabilities = { transactions: true, wal: true, engine: 'sqlite' }
  }

  /** 当前调用是不是在本对象正在进行的事务的调用链里 */
  get inTransaction() {
    return this.#als.getStore() === this
  }

  #open() {
    if (!this.db) this.db = openDatabase(this.dir, { create: true })
    return this.db
  }

  // 排队：同一时刻只跑一个（事务，或一次事务外的读写）
  async #exclusive(task) {
    const prev = this.#tail
    let release
    this.#tail = new Promise((resolve) => { release = resolve })
    try {
      await prev
      return await task()
    } finally {
      release()
    }
  }

  // 事务外：排队后自己开一个事务；事务里：直接跑
  async #run(fn) {
    if (this.inTransaction) return fn(this.#open())
    return this.#exclusive(async () => fn(this.#open()))
  }

  // 一组同步写入要么全成、要么全不成：事务里用 SAVEPOINT，事务外用 BEGIN IMMEDIATE
  #group(db, fn) {
    if (this.inTransaction) {
      const sp = 'wm_sp_' + (++this.#savepoints)
      db.exec('SAVEPOINT ' + sp)
      try {
        const result = fn()
        db.exec('RELEASE ' + sp)
        return result
      } catch (error) {
        db.exec('ROLLBACK TO ' + sp)
        db.exec('RELEASE ' + sp)
        throw error
      }
    }
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
    return this.#run((db) => insertRecord(db, record))
  }

  /**
   * 追加一条事件（原样存这一行的 JSON，不改形状）。
   * mustExist：先确认这条事件指向的经历都在库里（联想两头都查；章节不指向经历，不查）；查和写在同一个事务里。
   * 这是低层追加：不做「重复封存算 noop」这类业务判断，那些在上层。
   */
  async appendEvent(kind, row, { mustExist = false } = {}) {
    const k = kindOf(kind)
    return this.#run((db) => this.#group(db, () => {
      if (mustExist && k.valid(row)) {
        const missing = k.expIds(row).filter((id) => !recordExists(db, id))
        if (missing.length) throw new Error('找不到这条经历：' + missing.join('、') + '（事件没有写入）')
      }
      return insertEvent(db, kind, row)
    }))
  }

  /**
   * 一条经历 + 它的若干事件，同一个事务写：任何一条失败（重复 id、事件不合格），整组都不落盘。
   * 在 transaction() 里调用时同样成立（这一组包在 SAVEPOINT 里）。
   * @param {object} record
   * @param {{ kind: string, row: object }[]} events
   */
  async appendWithEvents(record, events = []) {
    return this.#run((db) => this.#group(db, () => {
      insertRecord(db, record)
      for (const e of events) insertEvent(db, e && e.kind, e && e.row)
      return record
    }))
  }

  async all() {
    return this.#run((db) => {
      const { rows, bad } = readRecords(db)
      // 坏数据整体失败，不当空
      if (bad) throw new Error('memory.sqlite 里有 ' + bad + ' 条记录解析不了（拒绝当作空）')
      return rows
    })
  }

  /** 某一类事件，按追加顺序。坏行整体失败，不当空。 */
  async events(kind) {
    kindOf(kind)
    return this.#run((db) => {
      const { rows, bad } = readEvents(db, kind)
      if (bad) throw new Error('memory.sqlite 里 ' + kind + ' 事件有 ' + bad + ' 条解析不了或不合格（拒绝当作空）')
      return rows
    })
  }

  /** @param {string} id */
  async byId(id) {
    return this.#run((db) => {
      const row = db.prepare('SELECT json FROM records WHERE id = ?').get(String(id))
      return row ? JSON.parse(row.json) : null
    })
  }

  /** 按本地日取（契约里的 day 语义）。 */
  async byDay(day) {
    return this.#run((db) => db.prepare('SELECT json FROM records WHERE day = ? ORDER BY rowid').all(String(day)).map((r) => JSON.parse(r.json)))
  }

  async count() {
    return this.#run((db) => db.prepare('SELECT COUNT(*) AS c FROM records').get().c)
  }

  /**
   * 事务里跑一段（记录与事件都在同一个事务里）。失败自动回滚。
   * 嵌套调用（在 fn 里再 transaction）是一层 SAVEPOINT：内层失败只撤内层，错误照常抛给外层。
   */
  async transaction(fn) {
    if (this.inTransaction) {
      const db = this.#open()
      const sp = 'wm_sp_' + (++this.#savepoints)
      db.exec('SAVEPOINT ' + sp)
      try {
        const result = await fn(this)
        db.exec('RELEASE ' + sp)
        return result
      } catch (error) {
        db.exec('ROLLBACK TO ' + sp)
        db.exec('RELEASE ' + sp)
        throw error
      }
    }
    return this.#exclusive(async () => {
      const db = this.#open()
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await this.#als.run(this, () => fn(this))
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    })
  }

  async close() {
    // 事务里关连接会让外层事务永远等不到自己（排队等的正是它）：直接拒绝
    if (this.inTransaction) throw new Error('事务进行中不能 close()')
    return this.#exclusive(async () => {
      if (this.db) {
        this.db.close()
        this.db = null
      }
    })
  }
}
