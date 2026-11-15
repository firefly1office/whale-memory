#!/usr/bin/env node
// 通用 CLI 适配层：任何能执行命令的 agent（DSH、自建、其他框架）都能用
// 用法：node memory-cli.mjs <命令> [参数]，输出 JSON 到 stdout
import path from 'node:path'
import * as exp from '../../packages/core/lib/self-experience.js'
import * as mem from '../../packages/core/lib/self-memory.js'
import * as waking from '../../packages/core/lib/waking.js'
import * as prompt from '../../packages/core/lib/self-prompt.js'
import * as settings from '../../packages/core/lib/self-settings.js'

const DATA = process.env.WHALE_DATA_DIR || path.resolve(process.cwd(), 'data')
const MEM_DIR = path.join(DATA, 'plugin-data', 'biomimetic-memory')
const WEIGHTS = new Set(['important', 'normal', 'minor'])

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error('--' + name + ' 缺少参数值')
  return v
}

// --limit 必须是非负整数：0 表示一条都不要，负数直接拒绝（不能变成“全部”）
function limitArg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error('--' + name + ' 缺少参数值')
  if (!/^\d+$/.test(v)) throw new Error('--' + name + ' 必须是非负整数')
  return Number(v)
}

function weightArg() {
  const w = arg('weight', 'normal') || 'normal'
  if (!WEIGHTS.has(w)) throw new Error('--weight 只能是 important / normal / minor')
  return w
}

function out(obj) { console.log(JSON.stringify(obj, null, 2)) }

const cmd = process.argv[2]
try {
  if (cmd === 'write') {
    const text = arg('text')
    if (typeof text !== 'string' || !text.trim()) throw new Error('缺少 --text（不能是空白）')
    const row = exp.addExperience(MEM_DIR, {
      text,
      scene: arg('scene', '') || '',
      feeling: (arg('feeling', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
      thought: arg('thought', '') || '',
      unfinished: arg('unfinished', '') || '',
      quote: arg('quote') ? { text: arg('quote'), source: arg('source', '') || '' } : null,
      weight: weightArg(),
      kind: arg('kind', '其它') || '其它'
    })
    out({ ok: true, id: row.id, day: row.day })
  } else if (cmd === 'recall') {
    // 空 query = 最近 N 条（不是“什么都不返回”）；想看最近就用空 query，想按相关度就给词
    const q = arg('query', '') || ''
    const n = limitArg('limit', 3)
    const mark = String(arg('mark', 'false')) === 'true'
    const rows = n === 0 ? [] : exp.recall(MEM_DIR, q, { limit: n, mark })
    out({ ok: true, items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, text: exp.renderTwoPart(r) })) })
  } else if (cmd === 'read') {
    const n = limitArg('limit', 8)
    const all = exp.loadAll(MEM_DIR)
    const rows = n === 0 ? [] : all.slice(-n)
    out({ ok: true, items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, text: r.then.text, thought: r.then.thought, later: (r.later || []).map((x) => x.thought) })) })
  } else if (cmd === 'revise') {
    const id = arg('id')
    const thought = arg('thought')
    if (!id || typeof thought !== 'string' || !thought.trim()) throw new Error('需要 --id 与 --thought（不能是空白）')
    const res = exp.reviseExperience(MEM_DIR, { id, thought, reason: arg('reason', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'waking') {
    const chat = arg('chat', 'local:owner') || 'local:owner'
    const block = waking.buildWakingBlock(DATA, chat)
    out({ ok: true, block })
    // 打印成功即视为已展示；只想预览不占用今天的额度，加 --peek true
    if (block && String(arg('peek', 'false')) !== 'true') waking.consumeWaking(DATA, chat)
  } else if (cmd === 'memory') {
    const q = arg('query', '') || ''
    const includeDiary = String(arg('diary', 'false')) === 'true'
    const n = limitArg('limit', 4)
    const rows = n === 0 ? [] : mem.recall(MEM_DIR, q, { includeDiary, limit: n })
    out({ ok: true, block: mem.renderBlock(rows) })
  } else if (cmd === 'prompt') {
    const sub = process.argv[3]
    if (sub === 'get') out({ ok: true, text: prompt.load(DATA) })
    else if (sub === 'set') out(prompt.save(DATA, arg('text') || '', arg('reason', '') || ''))
    else if (sub === 'history') {
      const n = limitArg('limit', 10)
      out({ ok: true, versions: n === 0 ? [] : prompt.history(DATA, n) })
    } else if (sub === 'revert') out(prompt.revert(DATA, arg('version') || ''))
    else throw new Error('prompt 子命令：get/set/history/revert')
  } else if (cmd === 'settings') {
    const sub = process.argv[3]
    if (sub === 'get') out({ ok: true, settings: settings.load(DATA) })
    else if (sub === 'set') {
      const patch = JSON.parse(arg('json', '{}') || '{}')
      out({ ok: true, settings: settings.save(DATA, patch, arg('reason', '') || '') })
    } else throw new Error('settings 子命令：get/set')
  } else {
    out({
      ok: false,
      usage: [
        'write --text "..." [--scene .. --feeling a,b --thought .. --unfinished .. --quote .. --source .. --weight important|normal|minor --kind 读书]',
        'recall --query "..." [--limit 3] [--mark true]   （空 query = 最近 N 条；默认只读）',
        'read [--limit 8]',
        'revise --id ... --thought "..." [--reason ..]',
        'waking [--chat private:100000000] [--peek true]   （默认打印即记为已展示）',
        'memory --query "..." [--diary true --limit 4]',
        'prompt get|set --text ...|history|revert --version ...',
        'settings get|set --json {...}',
        '',
        '--limit 是非负整数；0 = 一条都不要'
      ]
    })
  }
} catch (e) {
  out({ ok: false, error: String(e && e.message ? e.message : e) })
  process.exit(1)
}