import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const ENTRIES = ['packages/core/bin/whale-memory-mcp.mjs', 'adapters/mcp/whale-memory-mcp.mjs']

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-mcp-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// 一个最小的 MCP 客户端：真起子进程，一行一条 JSON-RPC
function client(t, entry, args) {
  const child = spawn(process.execPath, [path.join(root, entry), ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  const waiting = new Map(), stray = []
  let buf = '', nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      let msg
      try { msg = JSON.parse(line) } catch { stray.push(line); continue }
      const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w(msg) } else stray.push(line)
    }
  })
  const raw = (line, id) => new Promise((resolve) => { waiting.set(id, resolve); child.stdin.write(line + '\n') })
  const request = (method, params) => { const id = nextId++; return raw(JSON.stringify({ jsonrpc: '2.0', id, method, params }), id) }
  const call = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args })
    return { ...r.result, data: JSON.parse(r.result.content[0].text) }
  }
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  return { request, call, notify, raw, stray }
}

async function connect(t, entry, args) {
  const c = client(t, entry, args)
  const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
  c.notify('notifications/initialized')
  return { ...c, init }
}

for (const entry of ENTRIES) {
  test('MCP：握手、工具列表、默认不开抽屉（' + entry + '）', async (t) => {
    const data = tmp(t)
    const c = await connect(t, entry, ['--data', data])
    assert.equal(c.init.result.protocolVersion, '2025-06-18')
    assert.equal(c.init.result.serverInfo.name, 'whale-memory')
    assert.match(c.init.result.instructions, /不要编/)
    const names = (await c.request('tools/list')).result.tools.map((x) => x.name)
    for (const n of ['memory_recall', 'memory_read', 'memory_write', 'memory_revise', 'memory_unfinished', 'memory_seal', 'memory_link', 'memory_chapter', 'memory_recap', 'memory_book', 'memory_waking', 'memory_chapters']) assert.ok(names.includes(n), n)
    assert.ok(!names.includes('memory_unsaid'), '没给 --owner 时抽屉不出现')
    for (const bad of ['export', 'import', 'purge', 'prompt', 'settings']) assert.ok(!names.some((n) => n.includes(bad)), '不提供 ' + bad)
    assert.deepEqual(c.stray, [], 'stdout 只有协议消息')
  })
}

test('MCP：写下 → 想起 → 翻读；then 不改，改主意只追加', async (t) => {
  const data = tmp(t)
  const c = await connect(t, ENTRIES[0], ['--data', data])
  const w = await c.call('memory_write', { text: '今天读完了灯塔那一章', feeling: ['安静'], unfinished: '想知道船回来没有', quote: { text: '灯一直亮着', source: '灯塔' } })
  assert.equal(w.isError, false)
  assert.match(w.data.id, /\S/)
  const hit = await c.call('memory_recall', { query: '灯塔', limit: 3 })
  assert.equal(hit.data.items[0].id, w.data.id)
  const file = path.join(data, 'plugin-data', 'biomimetic-memory', 'self-experience.jsonl')
  const before = fs.readFileSync(file)
  const rv = await c.call('memory_revise', { id: w.data.id, thought: '其实船早就回来了', feeling: ['释然'] })
  assert.equal(rv.data.ok, true)
  assert.ok(fs.readFileSync(file).equals(before), '改主意不碰当时写下的那一行')
  const one = await c.call('memory_read', { id: w.data.id })
  assert.equal(one.data.items[0].text, '今天读完了灯塔那一章')
  assert.deepEqual(one.data.items[0].later, ['其实船早就回来了'])
  assert.deepEqual(one.data.items[0].feelingNow, ['释然'])
  const none = await c.call('memory_recall', { query: '火星基地', limit: 3 })
  assert.deepEqual(none.data.items, [])
  assert.match(none.data.note, /没有找到/)
})

test('MCP：想通了醒来就不再提；封存后想起、翻读、书里都没有，点名还在', async (t) => {
  const data = tmp(t)
  const c = await connect(t, ENTRIES[0], ['--data', data])
  const a = (await c.call('memory_write', { text: '没写完的那封信', unfinished: '信还没寄出去' })).data
  const b = (await c.call('memory_write', { text: '下雨天在窗边发呆' })).data
  assert.match((await c.call('memory_waking', { peek: true })).data.block, /信还没寄出去/)
  assert.equal((await c.call('memory_unfinished', { id: a.id, state: 'done' })).data.ok, true)
  assert.doesNotMatch((await c.call('memory_waking', { peek: true })).data.block, /信还没寄出去/)
  assert.equal((await c.call('memory_seal', { id: b.id, sealed: true })).data.ok, true)
  assert.deepEqual((await c.call('memory_recall', { query: '下雨天 窗边 发呆', limit: 5, mode: 'loose' })).data.items.filter((x) => x.id === b.id), [])
  const list = (await c.call('memory_read', {})).data
  assert.ok(list.items.every((x) => x.id !== b.id))
  assert.equal(list.sealedHidden, 1)
  assert.doesNotMatch((await c.call('memory_book', {})).data.markdown, /窗边发呆/)
  const named = (await c.call('memory_read', { id: b.id })).data
  assert.ok(named.items[0].sealed, '点名的那一条照给，带封存标记')
  assert.equal((await c.call('memory_seal', { id: b.id, sealed: false })).data.ok, true)
  assert.ok((await c.call('memory_read', {})).data.items.some((x) => x.id === b.id))
})

test('MCP：联想、章节、回顾', async (t) => {
  const data = tmp(t)
  const c = await connect(t, ENTRIES[0], ['--data', data])
  const a = (await c.call('memory_write', { text: '读了一首关于海的诗' })).data
  const b = (await c.call('memory_write', { text: '梦见自己在海边' })).data
  const l = await c.call('memory_link', { from: a.id, to: b.id, reason: '都是海' })
  assert.equal(l.data.ok, true)
  assert.equal((await c.call('memory_link', { from: a.id, to: b.id, reason: '' })).isError, true, '不说为什么就不连')
  const ch = await c.call('memory_chapter', { action: 'open', name: '海边的日子' })
  assert.equal(ch.data.ok, true)
  const chs = (await c.call('memory_chapters', {})).data.chapters
  assert.equal(chs[0].name, '海边的日子')
  assert.equal(chs[0].experiences, 2)
  assert.match((await c.call('memory_recap', { days: 7 })).data.text, /海/)
})

test('MCP：--owner 才打开抽屉；抽屉里的话想起、翻读、书、醒来都看不到', async (t) => {
  const data = tmp(t)
  const c = await connect(t, ENTRIES[0], ['--data', data, '--owner', 'true'])
  assert.ok((await c.request('tools/list')).result.tools.some((x) => x.name === 'memory_unsaid'))
  await c.call('memory_write', { text: '今天和他聊得很开心' })
  const left = await c.call('memory_unsaid', { action: 'leave', kind: 'held', text: '其实那句话让我有点难过' })
  assert.equal(left.data.ok, true)
  const seen = JSON.stringify([
    (await c.call('memory_recall', { query: '难过', limit: 5, mode: 'loose' })).data,
    (await c.call('memory_read', {})).data,
    (await c.call('memory_book', {})).data,
    (await c.call('memory_recap', {})).data,
    (await c.call('memory_waking', { peek: true })).data
  ])
  assert.ok(!seen.includes('其实那句话让我有点难过'))
  const open = (await c.call('memory_unsaid', { action: 'list' })).data
  assert.equal(open.items.length, 1)
  assert.equal((await c.call('memory_unsaid', { action: 'spoken', id: left.data.id })).data.ok, true)
  assert.equal((await c.call('memory_unsaid', { action: 'list' })).data.items.length, 0)
})

test('MCP：--readonly 只给读的工具，醒来只看不占用', async (t) => {
  const data = tmp(t)
  const w = await connect(t, ENTRIES[0], ['--data', data])
  await w.call('memory_write', { text: '一件事', unfinished: '还没弄完的' })
  const c = await connect(t, ENTRIES[0], ['--data', data, '--readonly', 'true'])
  const names = (await c.request('tools/list')).result.tools.map((x) => x.name)
  assert.ok(!names.some((n) => ['memory_write', 'memory_revise', 'memory_seal', 'memory_unfinished', 'memory_link', 'memory_chapter'].includes(n)))
  assert.match((await c.call('memory_waking', {})).data.block, /还没弄完的/)
  assert.match((await c.call('memory_waking', {})).data.block, /还没弄完的/, '只读模式不算今天已经醒来')
  const t2 = await c.request('tools/call', { name: 'memory_write', arguments: { text: 'x' } })
  assert.equal(t2.error.code, -32602)
})

test('MCP：坏输入都有明确答复，进程不崩', async (t) => {
  const data = tmp(t)
  const c = await connect(t, ENTRIES[0], ['--data', data])
  assert.equal((await c.call('memory_write', { text: '   ' })).isError, true)
  assert.equal((await c.call('memory_write', { text: 'x', weight: 'huge' })).isError, true)
  assert.equal((await c.call('memory_recall', { query: 'x', limit: -1 })).isError, true)
  assert.equal((await c.call('memory_unfinished', { id: 'exp_nope', state: 'done' })).isError, true)
  assert.equal((await c.request('nope/method', {})).error.code, -32601)
  assert.equal((await c.raw('{这不是json', null)).error.code, -32700)
  assert.equal((await c.request('ping', {})).result && true, true)
  const unknown = await c.request('initialize', { protocolVersion: '1999-01-01' })
  assert.equal(unknown.result.protocolVersion, '2025-06-18', '不认识的版本就回最新的')
  assert.deepEqual(c.stray, [])
})
