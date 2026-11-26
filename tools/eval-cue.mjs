#!/usr/bin/env node
// S7 对照：线索表旁路 + 迟疑提醒，在 452 条用例上与现有注入比，看有没有"多注 / 少注"。
//
// 比法（每条用例都从干净的 seen 开始，模拟"这一轮之前没递过"）：
//   基线 = surface(dir, { text: c.query })                     —— 现在的行为（全库 recall）
//   变体 = surface(dir, { text: c.query, cueTable, cueGate })  —— 线索表旁路 + 迟疑提醒
// 要的结论：
//   · 少注 = 基线递了、变体没递   → 必须 0（关键项不能因为旁路丢掉）
//   · 多注 = 基线没递、变体递了   → 必须 0（这个方案只加一行字，不该新增召回）
//   · 负面用例（none / near）上出现迟疑提醒 → 必须 0（不能对"没有的事"暗示有记忆）
//   · 迟疑提醒的精度：插了提醒的用例里，"期望的那条记录真的被基线命中"的比例
//
// 用法：node tools/eval-cue.mjs [--json] [--split=dev|holdout|all]
// 不联网、不调模型；语料写进临时目录，跑完就删。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from '../packages/core/lib/self-experience.js'
import { buildCueTable, createCueGate } from '../packages/core/lib/cue-table.js'
import { surface } from '../packages/core/lib/injection.js'
import { loadEvalV2, buildCorpus } from './lib/eval-v2-corpus.mjs'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const split = arg('split', 'all')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-eval-cue-'))
try {
  const { corpus, caseFile } = loadEvalV2()
  const { memoryDir } = buildCorpus(dir, corpus)
  const rows = exp.loadAll(memoryDir)
  const cueTable = buildCueTable(rows)
  const cases = caseFile.cases.filter((c) => split === 'all' || c.split === split)
  const OWNER_DM = 'local:owner'

  const out = {
    corpus: { experiences: corpus.experiences.length, cases: caseFile.cases.length, casesInSplit: cases.length, cues: cueTable.byCue.size, recordsWithCues: cueTable.records.length },
    split,
    baseline: { injected: 0 },
    hintOnly: { injected: 0, hinted: 0, lost: [], extra: [] },
    prefilterShort: { injected: 0, hinted: 0, skipped: 0, lost: [], extra: [] },
    prefilterAny: { injected: 0, hinted: 0, skipped: 0, lost: [] },
    hintedOnNegative: [],
    hintedPositive: 0,
    hintedExpectHit: 0,
    byType: {}
  }

  cases.forEach((c, turn) => {
    const base = surface(memoryDir, { chatKey: OWNER_DM, text: c.query, seen: {} })
    const hint = surface(memoryDir, { chatKey: OWNER_DM, text: c.query, seen: {}, cueTable, cueGate: createCueGate(), turn })
    const short = surface(memoryDir, { chatKey: OWNER_DM, text: c.query, seen: {}, cueTable, cueGate: createCueGate(), turn, cuePrefilter: 'short' })
    const any = surface(memoryDir, { chatKey: OWNER_DM, text: c.query, seen: {}, cueTable, cueGate: createCueGate(), turn, cuePrefilter: 'any' })
    const baseInjected = Boolean(base.block)
    const hinted = Boolean(hint.cue && hint.cue.hint)
    const t = (out.byType[c.type] ||= { n: 0, base: 0, hint: 0, hinted: 0, short: 0 })
    t.n += 1
    if (baseInjected) { out.baseline.injected += 1; t.base += 1 }
    if (hint.block) { out.hintOnly.injected += 1; t.hint += 1 }
    if (hinted) { out.hintOnly.hinted += 1; t.hinted += 1 }
    if (short.block) { out.prefilterShort.injected += 1; t.short += 1 }
    if (short.cue && short.cue.hint) out.prefilterShort.hinted += 1
    if (short.reason === 'no-cue') out.prefilterShort.skipped += 1
    if (any.block) out.prefilterAny.injected += 1
    if (any.cue && any.cue.hint) out.prefilterAny.hinted += 1
    if (any.reason === 'no-cue') out.prefilterAny.skipped += 1

    if (baseInjected && !hint.block) out.hintOnly.lost.push({ id: c.id, type: c.type, query: c.query })
    if (!baseInjected && hint.block) out.hintOnly.extra.push({ id: c.id, type: c.type, query: c.query })
    if (baseInjected && !short.block) out.prefilterShort.lost.push({ id: c.id, type: c.type, query: c.query })
    if (!baseInjected && short.block) out.prefilterShort.extra.push({ id: c.id, type: c.type, query: c.query })
    if (baseInjected && !any.block) out.prefilterAny.lost.push({ id: c.id, type: c.type, query: c.query })

    if (hinted && (c.type === 'none' || c.type === 'near')) out.hintedOnNegative.push({ id: c.id, type: c.type, query: c.query })
    if (hinted) {
      out.hintedPositive += 1
      const hits = exp.recall(memoryDir, c.query, { limit: 10 }).map((h) => h.id)
      if (c.expect && hits.includes(c.expect)) out.hintedExpectHit += 1
    }
  })

  const lost = (arm) => arm.lost.length
  out.verdict = {
    hintOnlyKeepsAll: lost(out.hintOnly) === 0,
    extraIsZero: out.hintOnly.extra.length === 0,
    negativesClean: out.hintedOnNegative.length === 0,
    prefilterShortLost: lost(out.prefilterShort),
    prefilterAnyLost: lost(out.prefilterAny),
    // 迟疑提醒的精度：插了提醒的用例里，期望记录真的能被召回的占比（其余是"提醒了但其实没那条"）
    hintPrecision: out.hintedPositive ? Number((out.hintedExpectHit / out.hintedPositive).toFixed(4)) : null
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(`线索表对照 · ${out.corpus.experiences} 条经历 / ${out.corpus.cases} 条用例（${split} 跑 ${out.corpus.casesInSplit} 条）· 线索 ${out.corpus.cues} 个 / 有线索的记录 ${out.corpus.recordsWithCues} 条`)
    console.log('')
    console.log('                          递了   迟疑提醒   旁路跳过   少注')
    const line = (name, arm, skipped) => console.log('  ' + name.padEnd(20) + String(arm.injected).padStart(5) + String(arm.hinted || 0).padStart(10) + String(skipped).padStart(10) + String(arm.lost ? arm.lost.length : '—').padStart(7))
    line('基线（现状）', out.baseline, '—')
    line('线索表·只插迟疑', out.hintOnly, '—')
    line('线索表·短问句也跳过', out.prefilterShort, out.prefilterShort.skipped)
    line('线索表·一律跳过', out.prefilterAny, out.prefilterAny.skipped)
    console.log('')
    console.log(`多注（基线没递、线索表递了）：${out.hintOnly.extra.length} 条`)
    console.log(`负面用例上的迟疑提醒：${out.hintedOnNegative.length} 条`)
    console.log(`迟疑提醒精度：插了 ${out.hintedPositive} 条，其中期望记录真被召回 ${out.hintedExpectHit} 条（${out.verdict.hintPrecision === null ? '—' : (out.verdict.hintPrecision * 100).toFixed(1) + '%'}）`)
    console.log('')
    const types = ['exact', 'paraphrase', 'combo', 'multiturn', 'none', 'near']
    for (const type of types) {
      const t = out.byType[type]
      if (!t) continue
      console.log(`  ${type.padEnd(11)} ${t.n} 条 · 基线递 ${t.base} · 只插迟疑 ${t.hint}（带迟疑 ${t.hinted}）· 短问句跳过 ${t.short}`)
    }
    console.log('')
    console.log(`结论：只插迟疑「不少注」=${out.verdict.hintOnlyKeepsAll ? '0 条 ✔' : '有 ✘'}；多注 ${out.verdict.extraIsZero ? '0 ✔' : '有 ✘'}；负面干净 ${out.verdict.negativesClean ? '✔' : '✘'}；预筛少注 = 短问句 ${out.verdict.prefilterShortLost} 条 / 一律 ${out.verdict.prefilterAnyLost} 条（所以默认不跳过）`)
  }

  const ok = out.verdict.hintOnlyKeepsAll && out.verdict.extraIsZero && out.verdict.negativesClean
  if (!ok) process.exitCode = 1
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}