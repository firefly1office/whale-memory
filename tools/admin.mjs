#!/usr/bin/env node
// 管理页（只读）：给 Leo 看"库里现在有什么、发生过什么"。
//
// 借自 ru-гу 的管理页、Lysmor 的星图（只学"一眼看清"的做法）与我们自己的 erase / audit
// （只学设计；实现自写，见 docs/attribution-zh.md）。星图不在这一页重复做（S2 在做）。
//
// 两条边界：
//   1. **默认只读**：页面本身不写任何东西。唯一的写操作是「撤回一条」，它不自己删文件，
//      只调 eraseExperience——墓碑、审计、回滚、幂等都由库那边负责。
//   2. **默认不自动启动**：不带 --serve 只打印用法，一个端口都不开；--export 出的静态 HTML
//      不引 CDN、不联网、不带可用的删除按钮。
//
// 隐私口径：
//   · 封存的经历只列 id / 日子 / 种类，正文一个字都不渲染；
//   · 抽屉（unsaid）根本不读；
//   · 召回列表只给 id 与时间，不抄查询原文（和审计同一个理由：查询里常带着她写的原话）；
//   · 撤回原因、审计 note、id 等所有动态文本一律 HTML 转义。
//
// 用法：
//   node tools/admin.mjs <memory-dir> --export <out.html> [--limit=N]
//   node tools/admin.mjs <memory-dir> --serve [--port=N] [--limit=N]
//   node tools/admin.mjs                        # 只打印用法，不起端口
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadAll } from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import { writeFileAtomic } from '../packages/core/lib/file-lock.js'
import * as tombstones from '../packages/core/lib/tombstones.js'
import * as audit from '../packages/core/lib/audit.js'
import * as recallEvents from '../packages/core/lib/recall-events.js'

export const ADMIN_VERSION = '1'
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 200
const MAX_BODY = 64 * 1024

const USAGE = [
  '管理页（只读）：四组数字 + 墓碑 / 审计 / 最近召回。',
  '',
  '用法：',
  '  node tools/admin.mjs <memory-dir> --export <out.html> [--limit=N]   导出静态 HTML（自包含）',
  '  node tools/admin.mjs <memory-dir> --serve [--port=N] [--limit=N]    起本地只读页（只绑 127.0.0.1）',
  '  node tools/admin.mjs                                               只打印这份用法，不起端口',
  '',
  '  --limit=N   每个列表最多显示几条（1..' + MAX_LIMIT + '，默认 ' + DEFAULT_LIMIT + '）',
  '  --port=N    只对 --serve 有效；N=0 表示随机端口（默认随机）',
  '',
  '页面里唯一的写操作是「撤回一条」：走 eraseExperience，带二次确认（前端 confirm + 服务端 confirm 字段），',
  '会写墓碑与审计。--export 的静态页是只读的，删除按钮不可用。',
  '',
  '退出码：0 正常；1 数据读不出来 / 有坏行；2 用法错。'
].join('\n')

const msg = (e) => String(e && e.message ? e.message : e)

const coded = (message, code) => Object.assign(new Error(message), { code })

const esc = (value) => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const pad = (n) => String(n).padStart(2, '0')
const localDay = (date) => date.toLocaleDateString('sv-SE')

function shortTime(iso) {
  const text = String(iso || '')
  if (!text) return '—'
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return text
  const d = new Date(parsed)
  return localDay(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 收集页面要用的全部数据。只读：不写、不加锁、不读抽屉。
 * 坏行一律抛（fail closed）：不许给一份"少了几条"的页面。
 */
export function collect(dir, { limit = DEFAULT_LIMIT, now = new Date() } = {}) {
  const rows = loadAll(dir)
  const records = rows.map((row) => ({
    id: row.id,
    day: row.day || String(row.at || '').slice(0, 10),
    kind: row.kind || '',
    weight: row.weight || 'normal',
    sealed: Boolean(row.sealed)
  }))

  const marks = tombstones.readAll(dir)
  if (marks.bad > 0) throw coded('墓碑文件有 ' + marks.bad + ' 行无法解析：先备份再修，不能给一份漏了撤回记录的页面。', 'ADMIN_TOMBSTONES_CORRUPT')
  const auditRows = audit.read(dir) // 坏行由 audit.read 自己抛（AUDIT_CORRUPT），这里不吞
  const recall = recallEvents.readAll(dir)
  if (recall.bad > 0) throw coded('召回事件有 ' + recall.bad + ' 行无法解析：先备份再修，不能给一份少了几条召回的页面。', 'ADMIN_RECALL_CORRUPT')

  const sealedCount = records.filter((row) => row.sealed).length
  const latest = (list) => list.slice(-limit).reverse()

  return {
    dir: path.resolve(dir),
    generatedAt: now.toISOString(),
    limit,
    records: {
      total: records.length,
      unsealed: records.length - sealedCount,
      sealed: sealedCount,
      recent: latest(records)
    },
    tombstones: {
      total: marks.rows.length,
      recent: latest(marks.rows).map((row) => ({
        id: row.id,
        at: row.at,
        reason: row.reason,
        actor: row.actor
      }))
    },
    audit: {
      total: auditRows.length,
      erase: auditRows.filter((row) => row.action === 'erase').length,
      recent: latest(auditRows).map((row) => ({
        at: row.at,
        actor: row.actor,
        action: row.action,
        ids: Array.isArray(row.ids) ? row.ids : [],
        note: row.note
      }))
    },
    recalls: {
      total: recall.rows.length,
      // 查询原文不进页面：和审计一个理由，查询里经常带着她写的原话
      recent: latest(recall.rows).map((row) => ({ id: row.id, at: row.at }))
    }
  }
}

const tableShell = (head, body, empty) => [
  '<table>',
  '<thead><tr>' + head.map((th) => '<th>' + esc(th) + '</th>').join('') + '</tr></thead>',
  '<tbody>' + (body || '<tr><td colspan="' + head.length + '" class="empty">' + esc(empty) + '</td></tr>') + '</tbody>',
  '</table>'
].join('\n')

function recordsTable(data) {
  const body = data.records.recent.map((row) => '<tr>' +
    '<td class="mono">' + esc(row.id) + '</td>' +
    '<td>' + esc(row.day) + '</td>' +
    '<td>' + esc(row.kind) + '</td>' +
    '<td>' + (row.sealed ? '<span class="badge">已封存</span>' : '未封存') + '</td>' +
    '</tr>').join('')
  return tableShell(['id', '日子', '种类', '状态'], body, '还没有经历')
}

function tombstoneTable(data) {
  const body = data.tombstones.recent.map((row) => '<tr>' +
    '<td class="mono">' + esc(row.id) + '</td>' +
    '<td>' + esc(shortTime(row.at)) + '</td>' +
    '<td>' + esc(row.reason) + '</td>' +
    '<td>' + esc(row.actor) + '</td>' +
    '</tr>').join('')
  return tableShell(['id', '时间', '原因', 'actor'], body, '还没有撤回记录')
}

function auditTable(data) {
  const body = data.audit.recent.map((row) => '<tr>' +
    '<td>' + esc(shortTime(row.at)) + '</td>' +
    '<td>' + esc(row.actor) + '</td>' +
    '<td>' + esc(row.action) + '</td>' +
    '<td class="mono">' + esc(row.ids.join(', ')) + '</td>' +
    '<td>' + esc(row.note) + '</td>' +
    '</tr>').join('')
  return tableShell(['时间', 'actor', '动作', 'ids', 'note'], body, '还没有审计')
}

function recallTable(data) {
  const body = data.recalls.recent.map((row) => '<tr>' +
    '<td>' + esc(shortTime(row.at)) + '</td>' +
    '<td class="mono">' + esc(row.id) + '</td>' +
    '</tr>').join('')
  return tableShell(['时间', '经历 id'], body, '还没有召回记录')
}

function eraseSection(data, { mode, token }) {
  const openIds = data.records.recent.filter((row) => !row.sealed).map((row) => '<option value="' + esc(row.id) + '"></option>').join('')
  const warning = '<p class="warn">破坏性操作：记录会从库里删掉，只留一块墓碑和一条审计。删了不能恢复。</p>'
  if (mode !== 'serve') {
    return [
      '<section class="panel" id="erase">',
      '<h2>撤回一条</h2>',
      warning,
      '<p class="muted">这份是静态导出，不能删除。要撤回请用 <code>--serve</code> 模式打开本页，',
      '或直接调用 <code>eraseExperience(dir, { id, reason, actor })</code>。</p>',
      '</section>'
    ].join('\n')
  }
  return [
    '<section class="panel" id="erase">',
    '<h2>撤回一条</h2>',
    warning,
    '<form method="post" action="/erase" onsubmit="return confirm(\'确定要撤回这条经历？删除不可恢复，会留下墓碑与审计。\')">',
    '<label>经历 id <input name="id" list="open-ids" required placeholder="exp_..."></label>',
    '<datalist id="open-ids">' + openIds + '</datalist>',
    '<label>原因 <input name="reason" required maxlength="500" placeholder="为什么撤（会写进墓碑）"></label>',
    '<label>actor <input name="actor" required maxlength="120" value="owner"></label>',
    '<input type="hidden" name="confirm" value="true">',
    '<input type="hidden" name="token" value="' + esc(token) + '">',
    '<button type="submit" class="danger">撤回</button>',
    '<p class="muted">服务端同样要求 <code>confirm: true</code> 与本次页面令牌；缺一个都会被拒绝。</p>',
    '</form>',
    '</section>'
  ].join('\n')
}

/** 一整页 HTML。自包含：样式内联，没有外链、没有 CDN、没有网络请求（serve 的表单除外）。 */
export function renderHtml(data, { mode = 'export', token = '', flash = '' } = {}) {
  const title = '记忆管理（只读）'
  const flashHtml = flash ? '<p class="flash" data-flash="1">' + esc(flash) + '</p>' : ''
  const modeLine = mode === 'serve'
    ? '<span class="badge live">--serve：只绑 127.0.0.1</span>'
    : '<span class="badge">静态导出：只读</span>'
  return '<!doctype html>\n' +
'<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>' + esc(title) + '</title>\n' +
'<style>\n' +
':root{color-scheme:light dark;--bg:#f7f6f2;--card:#fff;--ink:#1f2328;--muted:#6b7280;--line:#e5e2da;--danger:#b42318}\n' +
'@media (prefers-color-scheme:dark){:root{--bg:#16181d;--card:#1e2128;--ink:#e8e6e1;--muted:#9aa0aa;--line:#2e323b}}\n' +
'*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,"Segoe UI","Noto Sans SC",sans-serif}\n' +
'h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px}.muted{color:var(--muted)}\n' +
'.meta{color:var(--muted);font-size:12px;margin-bottom:18px;word-break:break-all}\n' +
'.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}\n' +
'.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}\n' +
'.card .k{color:var(--muted);font-size:12px}.card .v{font-size:28px;font-weight:600;line-height:1.2;margin:2px 0}.card .sub{color:var(--muted);font-size:12px}\n' +
'.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:14px 0}\n' +
'table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}\n' +
'th{color:var(--muted);font-weight:500}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}\n' +
'.empty{color:var(--muted);text-align:center;padding:14px}.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:12px;color:var(--muted)}\n' +
'.badge.live{color:#0a7d4b;border-color:#0a7d4b}.warn{color:var(--danger);margin:0 0 10px}\n' +
'label{display:block;margin:8px 0;color:var(--muted);font-size:12px}input{width:100%;max-width:420px;margin-top:4px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}\n' +
'button{padding:9px 18px;border:0;border-radius:8px;background:var(--ink);color:var(--bg);font:inherit;cursor:pointer}.danger{background:var(--danger);color:#fff}\n' +
'code{font-family:ui-monospace,Consolas,monospace;font-size:12px}.flash{background:#0a7d4b;color:#fff;padding:8px 12px;border-radius:8px}\n' +
'</style>\n</head>\n<body>\n' +
'<h1>' + esc(title) + '</h1>\n' +
'<div class="meta">' + esc(data.dir) + ' · 生成于 ' + esc(shortTime(data.generatedAt)) + ' · ' + modeLine + '</div>\n' +
flashHtml + '\n' +
'<section class="cards">\n' +
'  <div class="card"><div class="k">经历</div><div class="v" data-stat="records-total">' + data.records.total + '</div>' +
'  <div class="sub"><span data-stat="records-unsealed">' + data.records.unsealed + '</span> 未封存 · <span data-stat="records-sealed">' + data.records.sealed + '</span> 已封存</div></div>\n' +
'  <div class="card"><div class="k">撤回</div><div class="v" data-stat="tombstones-total">' + data.tombstones.total + '</div><div class="sub">墓碑条数</div></div>\n' +
'  <div class="card"><div class="k">审计</div><div class="v" data-stat="audit-total">' + data.audit.total + '</div>' +
'  <div class="sub">其中撤回 <span data-stat="audit-erase">' + data.audit.erase + '</span> 条</div></div>\n' +
'  <div class="card"><div class="k">召回事件</div><div class="v" data-stat="recalls-total">' + data.recalls.total + '</div>' +
'  <div class="sub">最近 ' + Math.min(data.limit, data.recalls.recent.length) + ' 条见下表</div></div>\n' +
'</section>\n' +
'<section class="panel"><h2>最近 ' + data.limit + ' 条经历（正文不回显）</h2>' + recordsTable(data) + '</section>\n' +
'<section class="panel"><h2>墓碑（最近 ' + data.limit + ' 条）</h2>' + tombstoneTable(data) + '</section>\n' +
'<section class="panel"><h2>审计（最近 ' + data.limit + ' 条）</h2>' + auditTable(data) + '</section>\n' +
'<section class="panel"><h2>最近召回（最近 ' + data.limit + ' 条）</h2>' + recallTable(data) + '</section>\n' +
eraseSection(data, { mode, token }) + '\n' +
'<p class="muted">只读页：除了「撤回一条」，任何操作都不改数据。撤回走 <code>eraseExperience</code>，' +
'会写墓碑与审计；本页不读抽屉、不渲染封存正文。</p>\n' +
'</body>\n</html>\n'
}

function send(res, status, type, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store' })
  res.end(buf)
}

const sendJson = (res, status, payload) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(payload))

const errorPage = (status, message) => '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>管理页出错了</title></head>' +
  '<body style="font:14px/1.6 sans-serif;padding:24px"><h1>管理页出错了（' + status + '）</h1>' +
  '<p style="color:#b42318">' + esc(message) + '</p><p><a href="/">回到首页</a></p></body></html>'

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(coded('请求体太大（超过 ' + MAX_BODY + ' 字节）', 'ADMIN_BODY_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 起一个只读本地服务。除了 POST /erase（走 eraseExperience）以外全是读。
 * token 每次启动随机生成，只有本次页面里的表单带着它——挡住跨站表单的盲打。
 */
export function createServer(dir, { limit = DEFAULT_LIMIT, now = () => new Date() } = {}) {
  const token = crypto.randomBytes(16).toString('hex')
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true })
      if (req.method === 'GET' && url.pathname === '/') {
        const data = collect(dir, { limit, now: now() })
        const erased = url.searchParams.get('erased')
        return send(res, 200, 'text/html; charset=utf-8', renderHtml(data, {
          mode: 'serve',
          token,
          flash: erased ? '已撤回：' + erased : ''
        }))
      }
      if (req.method === 'POST' && url.pathname === '/erase') {
        const type = String(req.headers['content-type'] || '')
        if (!type.includes('application/x-www-form-urlencoded')) {
          return sendJson(res, 415, { ok: false, error: '只接受 application/x-www-form-urlencoded' })
        }
        const body = new URLSearchParams(await readBody(req))
        if (body.get('confirm') !== 'true') {
          return sendJson(res, 400, { ok: false, error: '需要 confirm: true（二次确认）' })
        }
        if (!token || body.get('token') !== token) {
          return sendJson(res, 403, { ok: false, error: '页面令牌不对或已过期：刷新页面再来一次' })
        }
        const id = String(body.get('id') || '').trim()
        const reason = String(body.get('reason') || '').trim()
        const actor = String(body.get('actor') || '').trim()
        if (!id || !reason || !actor) {
          return sendJson(res, 400, { ok: false, error: 'id / reason / actor 都必填' })
        }
        try {
          const result = eraseExperience(dir, { id, reason, actor })
          return sendJson(res, 200, {
            ok: true,
            id: result.id,
            alreadyGone: Boolean(result.alreadyGone),
            tombstone: Boolean(result.tombstone)
          })
        } catch (error) {
          const status = String(error && error.code || '').includes('CORRUPT') ? 409 : 400
          return sendJson(res, status, { ok: false, error: msg(error) })
        }
      }
      if (url.pathname === '/' || url.pathname === '/erase') {
        res.setHeader('allow', url.pathname === '/' ? 'GET' : 'POST')
        return sendJson(res, 405, { ok: false, error: '只支持 ' + (url.pathname === '/' ? 'GET' : 'POST') })
      }
      return sendJson(res, 404, { ok: false, error: '没有这个页面' })
    } catch (error) {
      // 数据坏了也如实报：不给一份"少了几条"的页面
      if (String(req.headers.accept || '').includes('application/json')) {
        return sendJson(res, 500, { ok: false, error: msg(error), code: error && error.code })
      }
      return send(res, 500, 'text/html; charset=utf-8', errorPage(500, msg(error)))
    }
  })
}

function parseNumber(value, name, min, max) {
  if (!/^\d+$/.test(String(value || ''))) throw new Error(name + ' 必须是非负整数')
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(name + ' 超出范围（' + min + '..' + max + '）')
  return n
}

function parseArgs(argv) {
  const out = { dir: '', export: '', serve: false, port: 0, limit: DEFAULT_LIMIT, help: false }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--export') {
      out.export = String(argv[i + 1] || '')
      if (!out.export) throw new Error('--export 后面需要输出文件路径')
      i += 1
    } else if (arg === '--serve') out.serve = true
    else if (arg === '--port') {
      out.port = parseNumber(argv[i + 1], '--port', 0, 65535)
      i += 1
    } else if (arg.startsWith('--port=')) out.port = parseNumber(arg.slice('--port='.length), '--port', 0, 65535)
    else if (arg === '--limit') {
      out.limit = parseNumber(argv[i + 1], '--limit', 1, MAX_LIMIT)
      i += 1
    } else if (arg.startsWith('--limit=')) out.limit = parseNumber(arg.slice('--limit='.length), '--limit', 1, MAX_LIMIT)
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg.startsWith('--')) throw new Error('认不出的参数：' + arg)
    else positional.push(arg)
  }
  if (positional.length > 1) throw new Error('只接受一个记忆目录')
  if (out.export && out.serve) throw new Error('--export 与 --serve 不能同时用')
  out.dir = positional[0] || ''
  return out
}

function summaryLine(data) {
  return '记录 ' + data.records.total + '（未封存 ' + data.records.unsealed + ' / 封存 ' + data.records.sealed + '），' +
    '墓碑 ' + data.tombstones.total + '，审计 ' + data.audit.total + '，召回 ' + data.recalls.total
}

function exportHtml(dir, outPath, { limit }) {
  const target = path.resolve(outPath)
  const data = collect(dir, { limit })
  const html = renderHtml(data, { mode: 'export' })
  let stat = null
  try { stat = fs.statSync(path.dirname(target)) } catch { stat = null }
  if (!stat || !stat.isDirectory()) throw coded('导出目录不存在：' + path.dirname(target), 'ADMIN_EXPORT_DIR_MISSING')
  writeFileAtomic(target, html)
  return { target, data, bytes: Buffer.byteLength(html) }
}

function serve(dir, { port, limit }) {
  const server = createServer(dir, { limit })
  server.on('error', (error) => {
    process.stderr.write('管理页启动失败：' + msg(error) + '\n')
    process.exitCode = 1
  })
  server.listen(port, '127.0.0.1', () => {
    const address = server.address()
    const actual = address && typeof address === 'object' ? address.port : port
    process.stdout.write('管理页（只读，仅本机）：http://127.0.0.1:' + actual + '/\n')
    process.stdout.write('只是看：不改任何文件。撤回走 eraseExperience（带墓碑与审计）。按 Ctrl+C 退出。\n')
  })
  return server
}

function run(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    process.stderr.write(msg(error) + '\n\n' + USAGE + '\n')
    return 2
  }
  if (args.help || !args.dir || (!args.export && !args.serve)) {
    process.stdout.write(USAGE + '\n')
    return 0
  }
  const dir = path.resolve(args.dir)
  try {
    const st = fs.statSync(dir)
    if (!st.isDirectory()) throw new Error('不是目录')
  } catch (error) {
    process.stderr.write('管理页失败：数据目录不存在或读不出来：' + dir + '（' + msg(error) + '）\n')
    return 1
  }
  try {
    if (args.export) {
      const result = exportHtml(dir, args.export, { limit: args.limit })
      process.stdout.write('已导出管理页：' + result.target + '（' + result.bytes + ' 字节）\n')
      process.stdout.write(summaryLine(result.data) + '\n')
      process.stdout.write('静态页只读：不引 CDN、不联网、没有可用的删除按钮。\n')
      return 0
    }
    serve(dir, { port: args.port, limit: args.limit })
    return 0
  } catch (error) {
    process.stderr.write('管理页失败：' + msg(error) + '\n')
    return 1
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const code = run(process.argv.slice(2))
  if (code !== 0) process.exitCode = code
}