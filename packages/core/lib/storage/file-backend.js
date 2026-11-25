// 文件后端：就是现在的 self-experience.jsonl。行为与既有实现一致，
// 只是把「读整个文件」包成一个对象，方便和 SQLite 后端对拍。
import fs from 'node:fs'
import path from 'node:path'

const FILE = 'self-experience.jsonl'

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
    const fd = fs.openSync(this.file, 'a+')
    try {
      const size = fs.fstatSync(fd).size
      let separator = ''
      if (size) {
        const last = Buffer.alloc(1)
        fs.readSync(fd, last, 0, 1, size - 1)
        if (last[0] !== 10) separator = '\n'
      }
      fs.writeFileSync(fd, separator + JSON.stringify(record) + '\n', 'utf8')
    } finally {
      fs.closeSync(fd)
    }
    return record
  }

  /** 全部记录。坏行直接抛错——展示路径不许把坏行当空。 */
  async all() {
    let raw
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
    const out = []
    const lines = raw.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        throw new Error(`self-experience.jsonl 第 ${i + 1} 行不是合法 JSON（拒绝当作空）`)
      }
    }
    return out
  }

  /** @param {string} id */
  async byId(id) {
    const rows = await this.all()
    return rows.find((r) => r && r.id === id) || null
  }

  async count() {
    return (await this.all()).length
  }

  async close() {
    /* 文件后端没有连接要关 */
  }
}