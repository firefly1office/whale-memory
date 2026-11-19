// Offline only: retain original scores/raw/messages; compare settlement policies separately.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { validateAppraisal, settle } from '../../packages/emotion/index.js'
import { score, summarize } from './scoring.mjs'
import { cases } from './cases.mjs'
const files = ['results-20261119.json', 'results-20261119-round2.json', 'results-20261119-round3.json']
const output = { kind: 'offline-policy-reanalysis', corpus: 'unchanged-development-rubric', modelCalls: 0, rounds: [] }
for (const file of files) {
  const original = JSON.parse(fs.readFileSync(new URL(file, import.meta.url)))
  const rows = original.results.map(row => {
    if (createHash('sha256').update(JSON.stringify(row.messages)).digest('hex') !== row.requestHash) throw Error('Local hash mismatch')
    const result = { id: row.id, arm: row.arm, status: row.status, proposed: row.raw?.relationship?.kind ?? null, legacy: null, revised: null }
    if (row.checks) {
      const item = cases.find(c => c.id === row.id)
      const sources = JSON.parse(row.messages[1].content).sources
      const appraisal = validateAppraisal(row.raw, sources)
      const revised = settle(appraisal, { policy: 'boundary-v2', sources })
      result.legacy = { checks: score(item, appraisal, row.applied), proposed: result.proposed, applied: row.applied }
      result.revised = { checks: score(item, appraisal, revised), proposed: result.proposed, applied: revised }
    }
    return result
  })
  const summary = Object.fromEntries(['baseline', 'guided'].map(arm => [arm, Object.fromEntries(['legacy', 'revised'].map(policy => [policy,
    summarize(rows.filter(r => r.arm === arm).map(r => r[policy] || { checks: null }))
  ]))]))
  output.rounds.push({ file, summary, rows })
}
fs.writeFileSync(new URL('policy-reanalysis.json', import.meta.url), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify(output.rounds.map(r => ({ file: r.file, summary: r.summary })), null, 2))
