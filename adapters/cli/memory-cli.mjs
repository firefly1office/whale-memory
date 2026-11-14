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

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
function out(obj) { console.log(JSON.stringify(obj, null, 2)) }

const cmd = process.argv[2]
try {
  if (cmd === 'write') {
    const text = arg('text')
    if (!text) throw new Error('缺少 --text')
    const row = exp.addExperience(MEM_DIR, {
      text,
      scene: arg('scene', '') || '',
      feeling: (arg('feeling', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
      thought: arg('thought', '') || '',
      unfinished: arg('unfinished', '') || '',
      quote: arg('quote') ? { text: arg('quote'), source: arg('source', '') || '' } : null,
      weight: arg('weight', 'normal') || 'normal',
      kind: arg('kind', '其它') || '其它'
    })
    out({ ok: true, id: row.id, day: row.day })
  } else if (cmd === 'recall') {
    const q = arg('query', '') || ''
    const n = Number(arg('limit', 3)) || 3
    const rows = exp.recall(MEM_DIR, q, { limit: n })
    out({ ok: true, items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, text: exp.renderTwoPart(r) })) })
  } else if (cmd === 'read') {
    const n = Number(arg('limit', 8)) || 8
    const rows = exp.loadAll(MEM_DIR).slice(-n)
    out({ ok: true, items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, text: r.then.text, thought: r.then.thought, later: (r.later || []).map((x) => x.thought) })) })
  } else if (cmd === 'revise') {
    const id = arg('id'); const thought = arg('thought')
    if (!id || !thought) throw new Error('需要 --id 与 --thought')
    out(exp.reviseExperience(MEM_DIR, { id, thought, reason: arg('reason', '') || '' }))
  } else if (cmd === 'waking') {
    const chat = arg('chat', 'local:owner') || 'local:owner'
    out({ ok: true, block: waking.buildWakingBlock(DATA, chat) })
  } else if (cmd === 'memory') {
    const q = arg('query', '') || ''
    const includeDiary = String(arg('diary', 'false')) === 'true'
    const rows = mem.recall(MEM_DIR, q, { includeDiary, limit: Number(arg('limit', 4)) || 4 })
    out({ ok: true, block: mem.renderBlock(rows) })
  } else if (cmd === 'prompt') {
    const sub = process.argv[3]
    if (sub === 'get') out({ ok: true, text: prompt.load(DATA) })
    else if (sub === 'set') out(prompt.save(DATA, arg('text') || '', arg('reason', '') || ''))
    else if (sub === 'history') out({ ok: true, versions: prompt.history(DATA, Number(arg('limit', 10)) || 10) })
    else if (sub === 'revert') out(prompt.revert(DATA, arg('version') || ''))
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
        'write --text "..." [--scene .. --feeling a,b --thought .. --unfinished .. --quote .. --source .. --weight important --kind 读书]',
        'recall --query "..." [--limit 3]',
        'read [--limit 8]',
        'revise --id ... --thought "..." [--reason ..]',
        'waking [--chat private:100000000]',
        'memory --query "..." [--diary true]',
        'prompt get|set --text ...|history|revert --version ...',
        'settings get|set --json {...}'
      ]
    })
  }
} catch (e) {
  out({ ok: false, error: String(e && e.message ? e.message : e) })
  process.exit(1)
}