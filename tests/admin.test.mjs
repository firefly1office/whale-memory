// 管理页（只读）：导出四组数字与库一致、封存/抽屉不外露、默认不自动启动、
// 撤回走 eraseExperience 且需要 confirm、坏行 fail closed。
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { safeRemove, tmpDir } from './_safety.mjs'
import { loadAll } from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import * as tombstones from '../packages/core/lib/tombstones.js'
import * as audit from '../packages/core/lib/audit.js'
import * as recallEvents from '../packages/core/lib/recall-events.js'
import * as unsaid from '../packages/core/lib/unsaid.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const TOOL = 'tools/admin.mjs'
const RECORDS = 'self-experience.jsonl'

const pad = (n) => String(n).padStart(2, '0')
const DAY = (day) => '2026-11-' + pad(day)
const AT = (day, hour = 10) => DAY(day) + 'T' + pad(hour) + ':00:00.000Z'

function record({ id, day, text, kind = '其它' }) {
  return {
    id,
    at: AT(day),
    day: DAY(day),
    author: 'self',
    source: 'own-time',
    kind,
    weight: 'normal',
    then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: { at: AT(day) } },
    later: [],
    status: 'kept'
  }
}

const writeJsonl = (dir, name, rows) => {
  fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

const sha = (file) => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null)
const snapshot = (dir) => {
  const out = {}
  for (const name of fs.readdirSync(dir).sort()) out[name] = sha(path.join(dir, name))
  return out
}

const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { cwd: root, encoding: 'utf8', timeout: 20000 })

const statOf = (html, key) => {
  const hit = new RegExp('data-stat="' + key + '">(\\d+)<').exec(html)
  assert.ok(hit, 'HTML 里应该有 ' + key + ' 这个数字')
  return Number(hit[1])
}

// 三个经历：exp_a 未封存、exp_b 已封存（正文是哨兵）、exp_c 先写后撤回
function makeStore(t) {
  const dir = tmpDir('admin-')
  t.after(() => safeRemove(dir))
  writeJsonl(dir, RECORDS, [
    record({ id: 'exp_a', day: 10, text: '读过灯塔故事，纸船被潮汐带走' }),
    record({ id: 'exp_b', day: 11, text: '封存界正文：潮汐终会归来这段不该出现在页面里', kind: '回想' }),
    record({ id: 'exp_c', day: 12, text: '这条等一下会被撤回' })
  ])
  writeJsonl(dir, 'seal-events.jsonl', [{ id: 'exp_b', at: AT(13), day: DAY(13), action: 'seal', note: '' }])
  recallEvents.append(dir, { id: 'exp_a', query: '围巾到底是什么颜色' })
  recallEvents.append(dir, { id: 'exp_a', query: '灯塔' })
  const erased = eraseExperience(dir, { id: 'exp_c', reason: '她要求撤回这条', actor: 'leo' })
  assert.equal(erased.ok, true)
  return dir
}

const outDir = (t) => {
  const dir = tmpDir('admin-out-')
  t.after(() => safeRemove(dir))
  return dir
}

test('--export：四组数字与库读出来的一致，墓碑 / 审计 / 召回都列出来', (t) => {
  const dir = makeStore(t)
  const out = path.join(outDir(t), 'admin.html')
  const r = run(dir, '--export', out)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.existsSync(out), '导出文件应该存在')
  const html = fs.readFileSync(out, 'utf8')

  // 期望值直接来自库（不是自己另算一遍）
  const rows = loadAll(dir)
  const expected = {
    total: rows.length,
    sealed: rows.filter((row) => row.sealed).length,
    unsealed: rows.filter((row) => !row.sealed).length,
    tombstones: tombstones.readAll(dir).rows.length,
    audit: audit.read(dir).length,
    auditErase: audit.read(dir, { action: 'erase' }).length,
    recalls: recallEvents.readAll(dir).rows.length
  }
  assert.deepEqual(
    [statOf(html, 'records-total'), statOf(html, 'records-unsealed'), statOf(html, 'records-sealed')],
    [expected.total, expected.unsealed, expected.sealed],
    '记录数（总/未封存/已封存）要和库读出来的一致'
  )
  assert.equal(statOf(html, 'tombstones-total'), expected.tombstones)
  assert.equal(statOf(html, 'audit-total'), expected.audit)
  assert.equal(statOf(html, 'audit-erase'), expected.auditErase)
  assert.equal(statOf(html, 'recalls-total'), expected.recalls)
  assert.equal(expected.total, 2, '三个经历撤回一个，剩两个')
  assert.equal(expected.sealed, 1)
  assert.equal(expected.tombstones, 1)
  assert.equal(expected.audit, 1)

  // 列表内容
  const mark = tombstones.readAll(dir).rows[0]
  assert.ok(html.includes(mark.id), '墓碑 id 要在页面里')
  assert.ok(html.includes('她要求撤回这条'), '墓碑原因要在页面里')
  assert.ok(html.includes('leo'), '墓碑 actor 要在页面里')
  assert.ok(html.includes('erase'), '审计里的 erase 动作要在页面里')
  assert.ok(html.includes('exp_a'), '最近召回要列经历 id')
})

test('--export：自包含、不联网、没有可用的删除入口', (t) => {
  const dir = makeStore(t)
  const out = path.join(outDir(t), 'admin.html')
  assert.equal(run(dir, '--export', out).status, 0)
  const html = fs.readFileSync(out, 'utf8')
  assert.ok(html.includes('<style>'), '样式内联')
  assert.ok(!/<script\s+src=/i.test(html), '不许引外部脚本')
  assert.ok(!/<link[^>]+stylesheet/i.test(html), '不许引外部样式表')
  assert.ok(!/https?:\/\//.test(html), '导出的 HTML 里不许出现任何 http(s) 地址')
  assert.ok(!/method="post"/i.test(html), '静态页不该带能提交的删除表单')
  assert.match(html, /静态导出/, '要标明这是静态只读页')
})

test('--export：封存正文与抽屉正文按字节都搜不到', (t) => {
  const dir = makeStore(t)
  const drawer = unsaid.leaveUnsaid(dir, { chatKey: 'local:owner', kind: 'draft', text: '抽屉里的哨兵：这句话不许出现在管理页', reason: '测试' })
  assert.equal(drawer.ok, true)
  const out = path.join(outDir(t), 'admin.html')
  assert.equal(run(dir, '--export', out).status, 0)
  const html = fs.readFileSync(out, 'utf8')

  assert.ok(!html.includes('封存界正文'), '封存正文不许出现在导出的 HTML 里')
  assert.ok(!html.includes('潮汐终会归来这段不该出现'), '封存正文的细节也不许出现')
  assert.ok(!html.includes('抽屉里的哨兵'), '抽屉正文不许出现在导出的 HTML 里')
  assert.ok(!html.includes('围巾到底是什么颜色'), '召回列表不抄查询原文（和审计同一口径）')
  // 封存那条仍然要能被看见（只是不给正文）
  assert.ok(html.includes('exp_b'), '封存的经历至少列出 id')
  assert.ok(html.includes('已封存'), '要标出封存状态')
})

test('--export：坏行 fail closed，退出 1，不生成也不改写导出文件', (t) => {
  const dir = makeStore(t)
  fs.appendFileSync(path.join(dir, RECORDS), '{"broken":\n', 'utf8')
  const out = path.join(outDir(t), 'admin.html')
  fs.writeFileSync(out, 'keep-me', 'utf8')

  const r = run(dir, '--export', out)
  assert.equal(r.status, 1, '经历文件坏行时导出必须报错')
  assert.match(r.stderr, /无法解析/)
  assert.equal(fs.readFileSync(out, 'utf8'), 'keep-me', '失败时不许把已有文件改坏')

  const missing = path.join(outDir(t), 'never.html')
  const r2 = run(dir, '--export', missing)
  assert.equal(r2.status, 1)
  assert.equal(fs.existsSync(missing), false, '失败时不许留下半个页面')
})

test('默认不自动启动：不带参数、只给目录，都只打印用法，不起端口', () => {
  for (const args of [[], ['some-dir']]) {
    const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /--export/)
    assert.match(r.stdout, /--serve/)
    assert.ok(!/http:\/\/127\.0\.0\.1:\d+/.test(r.stdout), '没带 --serve 就不许有服务地址')
  }
})

test('用法错：--export 与 --serve 同时、非法 --port / --limit，退出 2', (t) => {
  const dir = makeStore(t)
  const both = run(dir, '--export', 'x.html', '--serve')
  assert.equal(both.status, 2)
  assert.match(both.stderr, /不能同时用/)
  const port = run(dir, '--serve', '--port=abc')
  assert.equal(port.status, 2)
  const limit = run(dir, '--serve', '--limit=0')
  assert.equal(limit.status, 2)
})

// ── --serve ────────────────────────────────────────────────

function startServer(t, dir) {
  const child = spawn(process.execPath, [TOOL, dir, '--serve', '--port=0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (child.exitCode === null) await new Promise((resolve) => child.once('close', resolve))
  })
  return {
    child,
    get stdout() { return stdout },
    get stderr() { return stderr }
  }
}

async function waitForUrl(server, timeoutMs = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const hit = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(server.stdout)
    if (hit) return 'http://127.0.0.1:' + hit[1] + '/'
    if (server.child.exitCode !== null) throw new Error('服务提前退出了：' + server.stderr)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('等不到服务地址：' + server.stdout + server.stderr)
}

const postErase = (base, fields, headers = {}) => fetch(base + 'erase', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(fields)
})

test('--serve：页面能打开；没带 confirm 或令牌的删除被拒；带 confirm 的走 erase 并写墓碑与审计', async (t) => {
  const dir = makeStore(t)
  const server = startServer(t, dir)
  const base = await waitForUrl(server)

  const health = await fetch(base + 'health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true })

  const before = snapshot(dir)
  const page = await fetch(base)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.equal(statOf(html, 'records-total'), 2)
  assert.equal(statOf(html, 'tombstones-total'), 1)
  assert.match(html, /method="post"/, 'serve 模式要有撤回表单')
  assert.match(html, /onsubmit="return confirm\(/, '前端要有二次确认')
  assert.match(html, /name="confirm" value="true"/, '表单要带 confirm 字段')
  const tokenHit = /name="token" value="([0-9a-f]+)"/.exec(html)
  assert.ok(tokenHit, '表单要带本次页面令牌')
  const token = tokenHit[1]

  // 只读：GET 一遍之后所有文件字节不变
  assert.deepEqual(snapshot(dir), before, '只读页面不许改任何文件')

  // 没有 confirm → 400，记录还在
  const noConfirm = await postErase(base, { id: 'exp_a', reason: '测试', actor: 'leo', token })
  assert.equal(noConfirm.status, 400)
  assert.match((await noConfirm.json()).error, /confirm/)
  assert.ok(loadAll(dir).some((row) => row.id === 'exp_a'), '没确认的请求不许删东西')

  // 有 confirm 但没令牌 → 403，记录还在
  const noToken = await postErase(base, { id: 'exp_a', reason: '测试', actor: 'leo', confirm: 'true' })
  assert.equal(noToken.status, 403)
  assert.ok(loadAll(dir).some((row) => row.id === 'exp_a'), '令牌不对的请求不许删东西')

  // 正确请求：走 eraseExperience
  const auditsBefore = audit.read(dir, { action: 'erase' }).length
  const ok = await postErase(base, { id: 'exp_a', reason: '这条也不要了', actor: 'leo', confirm: 'true', token })
  assert.equal(ok.status, 200, await ok.clone().text())
  const body = await ok.json()
  assert.equal(body.ok, true)
  assert.equal(body.id, 'exp_a')

  assert.ok(!loadAll(dir).some((row) => row.id === 'exp_a'), '记录真的删掉了')
  const marks = tombstones.readAll(dir).rows
  assert.equal(marks.length, 2, '墓碑多一条')
  const mark = marks.find((row) => row.id === 'exp_a')
  assert.ok(mark, '墓碑里要有刚撤回的那条')
  assert.equal(mark.reason, '这条也不要了')
  assert.equal(mark.actor, 'leo')
  assert.equal(audit.read(dir, { action: 'erase' }).length, auditsBefore + 1, '审计多一条 erase')

  // 页面刷新后数字跟着变
  const after = await fetch(base)
  assert.equal(statOf(await after.text(), 'records-total'), 1)

  // 只读边界：别的路径 / 方法一律不接
  assert.equal((await fetch(base + 'nope')).status, 404)
  assert.equal((await fetch(base, { method: 'PUT' })).status, 405)
  assert.equal((await fetch(base + 'erase')).status, 405)
})

test('--serve：经历文件坏行时页面 500，不渲染一份少了几条的页面', async (t) => {
  const dir = makeStore(t)
  const server = startServer(t, dir)
  const base = await waitForUrl(server)
  fs.appendFileSync(path.join(dir, RECORDS), '{oops\n', 'utf8')
  const res = await fetch(base, { headers: { accept: 'application/json' } })
  assert.equal(res.status, 500)
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.match(body.error, /无法解析/)
})

test('零依赖、不联网：只 import node 内置与本仓库模块；没有对外请求', () => {
  const source = fs.readFileSync(path.join(root, TOOL), 'utf8')
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.ok(imports.length > 0)
  for (const spec of imports) {
    assert.ok(spec.startsWith('node:') || spec.startsWith('../packages/'), '不许引第三方：' + spec)
  }
  assert.ok(!/\bfetch\s*\(/.test(source), '工具本身不对外发请求')
  assert.ok(!/node:https|node:net(?!['"])|XMLHttpRequest|http\.request|crypto\.createCipheriv/.test(source), '不联网、不加密')
})