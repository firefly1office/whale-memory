// 文件后端：就是现在的 self-experience.jsonl + 各类事件 JSONL。行为与既有实现一致，
// 只是把「读整个文件」包成一个对象，方便和 SQLite 后端对拍。
import fs from 'node:fs'
import path from 'node:path'
import { withFileLock } from '../file-lock.js'
import { kindOf } from '../sqlite-store.js'

const FILE = 'self-experience.jsonl'

// 追加一行：末尾没换行先补一个（和各事件模块的写法一致）
function appendLine(file, value) {
  const fd = fs.openSync(file, 'a+')
  try {
    const size = fs.fstatSync(fd).size
    let separator = ''
    if (size) {
      const last = Buffer.alloc(1)
      fs.readSync(fd, last, 0, 1, size - 1)
      if (last[0] !== 10) separator = '\n'
    }
    fs.writeFileSync(fd, separator + JSON.stringify(value) + '\n', 'utf8')
  } finally {
    fs.closeSync(fd)
  }
}

// 读一个 JSONL：坏行（含不合格行）直接抛错——展示路径不许把坏行当空。
// 坏行的口径必须和 loadAll 一模一样：trim 只用来跳过空行，解析的是**原样那一行**。
// 先 trim 再解析会把 BOM / 全角空格 / NBSP 包着的行救活，而 loadAll 把它当坏行——迁移就会把坏行搬进库。
function readLines(file, valid = null) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const out = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      throw new Error(`${path.basename(file)} 第 ${i + 1} 行不是合法 JSON（拒绝当作空）`)
    }
    if (valid && !valid(r)) throw new Error(`${path.basename(file)} 第 ${i + 1} 行缺必填字段（拒绝当作空）`)
    out.push(r)
  }
  return out
}

export class FileBackend {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir
    this.kind = 'file'
    this.capabilities = { transactions: false, wal: false, engine: 'file' }
    this.file = path.join(dir, FILE)
  }

  /** @param {object} record */
  async append(record) {
    fs.mkdirSync(this.dir, { recursive: true })
    appendLine(this.file, record)
    return record
  }

  /**
   * 追加一条事件到它自己的 JSONL（原样一行，不改形状），和各事件模块用同一把锁。
   * mustExist：先确认指向的经历都在（联想两头都查；章节不指向经历，不查）。
   * 文件后端没有事务，查和写之间不是原子的——要原子请用 sqlite 后端。
   */
  async appendEvent(kind, row, { mustExist = false } = {}) {
    const k = kindOf(kind)
    if (!k.valid(row)) throw new Error(kind + ' 事件不合格（缺必填字段），拒绝写入')
    if (mustExist) {
      const ids = new Set((await this.all()).map((r) => r && r.id))
      const missing = k.expIds(row).filter((id) => !ids.has(id))
      if (missing.length) throw new Error('找不到这条经历：' + missing.join('、') + '（事件没有写入）')
    }
    fs.mkdirSync(this.dir, { recursive: true })
    const file = path.join(this.dir, k.file)
    withFileLock(file + '.lock', () => appendLine(file, row))
    return row
  }

  /** 全部记录。坏行直接抛错——展示路径不许把坏行当空。 */
  async all() {
    return readLines(this.file)
  }

  /** 某一类事件，按文件顺序。坏行、不合格行直接抛错。 */
  async events(kind) {
    const k = kindOf(kind)
    return readLines(path.join(this.dir, k.file), k.valid)
  }

  /** @param {string} id */
  async byId(id) {
    const rows = await this.all()
    return rows.find((r) => r && r.id === id) || null
  }

  /** 按本地日取：文件后端没有索引，走全量过滤 */
  async byDay(day) {
    return (await this.all()).filter((r) => r && r.day === String(day))
  }

  async count() {
    return (await this.all()).length
  }

  async close() {
    /* 文件后端没有连接要关 */
  }
}
