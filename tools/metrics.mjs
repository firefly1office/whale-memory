#!/usr/bin/env node
// 她的记忆指标：测「她有没有在长」，不测召回准确率
// 用法：node tools/metrics.mjs [--data=<dir>] [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { countByExp } from '../packages/core/lib/recall-events.js'

const root = fileURLToPath(new URL('../', import.meta.url))

function readJsonl(file) {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return { rows: [], bad: 0 } }
  const rows = []
  let bad = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { bad += 1 }
  }
  return { rows, bad }
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)

export function computeMetrics(dataDir) {
  const mem = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  const exp = readJsonl(path.join(mem, 'self-experience.jsonl'))
  const diary = readJsonl(path.join(mem, 'autobiography.jsonl'))
  const notes = readJsonl(path.join(mem, 'notes-to-tomorrow.jsonl'))
  const promptHistory = readJsonl(path.join(mem, 'prompt-overlay', 'history.jsonl'))

  const experiences = exp.rows.map((r) => {
    const then = r.then && typeof r.then === 'object' ? r.then : { text: r.text, thought: r.thought }
    return {
      id: r.id || '',
      day: r.day || '',
      weight: r.weight || 'normal',
      kind: r.kind || '其它',
      hasLater: Array.isArray(r.later) && r.later.length > 0,
      laterCount: Array.isArray(r.later) ? r.later.length : 0,
      legacyRecalls: Number(r.recalls || 0),
      unfinished: Boolean(then && then.unfinished),
      quoted: Boolean(then && then.quote && then.quote.text)
    }
  }).filter((r) => r.day || r.weight)

  // 想起次数以事件为准；没有事件的旧记录才用行内字段
  let eventCounts = new Map()
  try { eventCounts = countByExp(mem) } catch { }
  for (const r of experiences) {
    const c = eventCounts.get(r.id)
    r.recalls = c ? c.count : r.legacyRecalls
  }

  const total = experiences.length
  const revised = experiences.filter((r) => r.hasLater).length
  const recalled = experiences.filter((r) => r.recalls > 0).length
  const unfinished = experiences.filter((r) => r.unfinished).length
  const quoted = experiences.filter((r) => r.quoted).length
  const byWeight = {}
  const byKind = {}
  for (const r of experiences) {
    byWeight[r.weight] = (byWeight[r.weight] || 0) + 1
    byKind[r.kind] = (byKind[r.kind] || 0) + 1
  }

  const promptVersions = promptHistory.rows.length
  const lastPromptAt = promptVersions ? promptHistory.rows[promptHistory.rows.length - 1].at : null

  let settingsChangedAt = null
  try { settingsChangedAt = JSON.parse(fs.readFileSync(path.join(mem, 'self-settings.json'), 'utf8')).updatedAt || null } catch { }

  return {
    dataDir,
    experiences: {
      total,
      revised,
      revisedRate: pct(revised, total),
      recalled,
      recalledRate: pct(recalled, total),
      totalRecalls: experiences.reduce((s, r) => s + r.recalls, 0),
      unfinished,
      quoted,
      byWeight,
      byKind
    },
    diaries: { total: diary.rows.length, ratioToExperiences: total ? Math.round((diary.rows.length / total) * 100) / 100 : null },
    notes: notes.rows.length,
    prompt: { versions: promptVersions, lastChangedAt: lastPromptAt },
    settings: { lastChangedAt: settingsChangedAt },
    integrity: { badExperienceLines: exp.bad, badDiaryLines: diary.bad },
    caveat: '这些指标测的是「她有没有在长」，不是召回准确率。'
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataArg = process.argv.find((a) => a.startsWith('--data='))
  const dataDir = dataArg ? path.resolve(dataArg.slice('--data='.length)) : (process.env.WHALE_DATA_DIR || process.cwd())
  const asJson = process.argv.includes('--json')
  const m = computeMetrics(dataDir)

  if (asJson) {
    console.log(JSON.stringify(m, null, 2))
  } else {
    const e = m.experiences
    console.log(`数据目录：${m.dataDir}`)
    console.log(`经历 ${e.total} 条`)
    console.log(`  改过主意（有 later）：${e.revised} 条 · ${e.revisedRate}%`)
    console.log(`  被想起过：${e.recalled} 条 · ${e.recalledRate}% · 累计 ${e.totalRecalls} 次`)
    console.log(`  没弄完的：${e.unfinished} 条`)
    console.log(`  带原文锚：${e.quoted} 条`)
    console.log(`  重要度：${Object.entries(e.byWeight).map(([k, v]) => k + ' ' + v).join(' / ')}`)
    console.log(`日记 ${m.diaries.total} 条 · 睡前留言 ${m.notes} 条`)
    console.log(`提示词 ${m.prompt.versions} 个版本${m.prompt.lastChangedAt ? ' · 最近 ' + m.prompt.lastChangedAt : ''}`)
    if (m.integrity.badExperienceLines || m.integrity.badDiaryLines) {
      console.log(`损坏行：经历 ${m.integrity.badExperienceLines} / 日记 ${m.integrity.badDiaryLines}`)
    }
    console.log(`\n${m.caveat}`)
  }
}