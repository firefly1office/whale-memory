// 外发预检：任何要送出去的文本，先过这一遍。
//
// 由来：一次真实事故里，材料正文是干净的，泄漏发生在**调用链本身**——命令行工具把自己的
// 系统提示（含本机主目录）一起发了出去，而我们的闸门只扫了正文。这个脚本管两件事：
//   1. 把「我们自己写的材料」扫干净：本机路径、用户名、像账号的数字串、长哈希、私钥头；
//   2. 让调用方知道它**管不到**什么——CLI 自带的提示、环境变量、SDK 的隐式字段。
//      管不到的部分只能靠换通道或换做法，不能靠这个脚本兜。
//
// 用法：
//   node tools/preflight.mjs <文件...>        扫描文件，命中即退出码 1
//   node tools/preflight.mjs --text "一段话"   直接扫一段文本
//
// 只读：不联网、不改文件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const USER = path.basename(HOME)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const RULES = [
  { id: 'home-path', desc: '本机主目录绝对路径', re: new RegExp(escapeRe(HOME), 'g') },
  { id: 'username', desc: '本机用户名', re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(USER)}(?![A-Za-z0-9])`, 'g') },
  { id: 'win-path', desc: 'Windows 绝对路径', re: /[A-Za-z]:\\[^\s"'<>|]{3,}/g },
  { id: 'posix-home', desc: '类 Unix 主目录', re: /\/Users\/[A-Za-z0-9._-]+/g },
  { id: 'long-digits', desc: '6–11 位连续数字（像账号/手机号）', re: /(?<!\d)\d{6,11}(?!\d)/g },
  { id: 'long-hex', desc: '16 位以上连续十六进制（像密钥/哈希）', re: /\b[0-9a-f]{16,}\b/gi },
  { id: 'private-key', desc: '私钥头', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
]

// 日期不算账号：20261125 / 2026-11-25 这类放行
const isDate = (v) => /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(v)

export function scanText(text) {
  const hits = []
  for (const rule of RULES) {
    let found = String(text).match(rule.re) || []
    if (rule.id === 'long-digits') found = found.filter((v) => !isDate(v))
    if (found.length) hits.push({ rule: rule.id, desc: rule.desc, count: found.length, sample: found[0].slice(0, 40) })
  }
  return hits
}

function scanLabel(text, label) {
  const hits = scanText(text)
  if (!hits.length) {
    console.log(`✓ ${label}：干净`)
  } else {
    console.log(`✗ ${label}：命中 ${hits.length} 类`)
    for (const h of hits) console.log(`    - ${h.desc} × ${h.count}  例：${String(h.sample).replace(/\s+/g, ' ')}`)
  }
  return hits.length
}

function main(argv) {
  if (argv[0] === '--text') {
    const n = scanLabel(argv.slice(1).join(' '), '(文本)')
    return n ? 1 : 0
  }
  if (!argv.length) {
    console.error('用法：node tools/preflight.mjs <文件...>  或  --text "..."')
    return 2
  }
  let bad = 0
  for (const file of argv) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      console.error(`✗ ${file}：读不了（${error.code || error.message}）`)
      bad += 1
      continue
    }
    bad += scanLabel(text, file)
  }
  return bad ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('preflight.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}