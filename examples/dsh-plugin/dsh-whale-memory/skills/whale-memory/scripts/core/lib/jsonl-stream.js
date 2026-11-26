// 逐行读 JSONL：不把整个文件读成一个字符串。
//
// 为什么要有这个：旧写法是 readFileSync 整读 + split('\n')，十万条时同时占着
// 「文件字符串 + 切出来的行数组 + 解析后的对象」三份内存，峰值能到几百 MB。
// 这里按 64KB 块读、按字节找换行，每行单独解码、解析完就丢掉文本。
//
// 按字节找换行是安全的：0x0A 不可能出现在多字节 UTF-8 序列的内部（续字节都 ≥ 0x80），
// 所以「按 0x0A 切字节」和「先整体解码再按 '\n' 切字符串」得到的是同一组行。
// 唯一差别是文件末尾被截断在多字节字符中间时，最后一行解码成 U+FFFD——和 readFileSync 一样。
//
// 同步与异步两条读法共用 lineSplitter：切行口径只写一次。

import fs from 'node:fs'

export const READ_CHUNK = 64 * 1024

// 字节块 → 行。onLine(text, offset, bytes)：
//   text   这一行的原样文本（不含换行符；行尾的 \r 保留，和 split('\n') 一致）
//   offset 这一行在文件里的起始字节位置
//   bytes  这一行的字节长度（不含换行符）
// 注意：push 收到的 chunk 可能被复用，回调里不能把 chunk 存下来（存 text 没问题，它是新字符串）。
export function lineSplitter(onLine) {
  let pending = Buffer.alloc(0)
  let pendingAt = 0
  return {
    push(chunk, chunkAt) {
      const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk
      let start = 0
      for (;;) {
        const nl = buf.indexOf(10, start)
        if (nl === -1) break
        onLine(buf.toString('utf8', start, nl), pendingAt + start, nl - start)
        start = nl + 1
      }
      // 剩下没换行的一段留到下一块；整块都以换行结尾时 pending 清空
      pending = start >= buf.length ? Buffer.alloc(0) : Buffer.from(buf.subarray(start))
      pendingAt += start
    },
    end() {
      if (!pending.length) return
      const text = pending.toString('utf8')
      const at = pendingAt
      const bytes = pending.length
      pending = Buffer.alloc(0)
      onLine(text, at, bytes)
    }
  }
}

// 同步逐行：调用方自己 open / close（这样"文件不存在"在打开那一步就能报出来，
// 不会等第一次 next() 才冒出来）。一次只留 64KB 的读缓冲和一行文本。
export function* readLines(fd) {
  const buf = Buffer.allocUnsafe(READ_CHUNK)
  let lines = []
  const split = lineSplitter((text, offset, bytes) => lines.push({ text, offset, bytes }))
  let at = 0
  for (;;) {
    const n = fs.readSync(fd, buf, 0, READ_CHUNK, null)
    if (!n) break
    split.push(buf.subarray(0, n), at)
    at += n
    for (const line of lines) yield line
    lines = []
  }
  split.end()
  for (const line of lines) yield line
}

// 异步逐行：同上，块读走 fs/promises，不把事件循环卡住。
export async function* readLinesAsync(fh) {
  const buf = Buffer.allocUnsafe(READ_CHUNK)
  let lines = []
  const split = lineSplitter((text, offset, bytes) => lines.push({ text, offset, bytes }))
  let at = 0
  for (;;) {
    const { bytesRead } = await fh.read(buf, 0, READ_CHUNK, null)
    if (!bytesRead) break
    split.push(buf.subarray(0, bytesRead), at)
    at += bytesRead
    for (const line of lines) yield line
    lines = []
  }
  split.end()
  for (const line of lines) yield line
}