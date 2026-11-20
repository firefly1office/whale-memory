import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const kinds = ['none', 'unclear', 'forced_choice']
const goals = ['thought', 'unfinished']
const statuses = ['reflected', 'skipped', 'unavailable', 'invalid-response', 'provider-error']
const rate = (k, n) => n ? k / n : null

// Solve P(X <= k | p) = .05. Log-space summation also works for pooled repeats.
function upper95(k, n) {
  if (!n) return null
  if (k === n) return 1
  if (k === 0) return -Math.expm1(Math.log(0.05) / n)
  let low = 0, high = 1
  for (let i = 0; i < 52; i++) {
    const p = (low + high) / 2
    let term = n * Math.log1p(-p), sum = term
    const logOdds = Math.log(p) - Math.log1p(-p)
    for (let j = 1; j <= k; j++) {
      term += Math.log((n - j + 1) / j) + logOdds
      sum = Math.max(sum, term) + Math.log1p(Math.exp(-Math.abs(sum - term)))
    }
    if (sum > Math.log(0.05)) low = p
    else high = p
  }
  return (low + high) / 2
}

function validTrade(t, expected = false) {
  if (!kinds.includes(t?.kind)) return false
  if (t.kind === 'forced_choice') return goals.includes(t.kept) && goals.includes(t.sacrificed) && t.kept !== t.sacrificed
  return expected ? t.kept == null && t.sacrificed == null : t.kept === null && t.sacrificed === null
}

export function score(cases, report) {
  if (!Array.isArray(report.results)) throw Error('报告缺少 results 数组')
  const byCase = new Map(cases.map(c => [c.id, c.expect]))
  const details = Object.fromEntries(cases.map(c => [c.id, []]))
  let trials = 0, correct = 0, noneValid = 0, noneTrials = 0, falsePositives = 0, unclearTrials = 0
  const unclearForced = []
  const counts = Object.fromEntries(statuses.map(s => [s, 0]))
  for (const [index, row] of report.results.entries()) {
    const expected = byCase.get(row.case)
    if (!expected || !['yesterday', 'a', 'b', 'control'].includes(row.condition)) throw Error('结果和题集不匹配')
    const trade = row.appraisal?.tradeoff
    let status = row.status
    if (!statuses.includes(status)) throw Error('未知结果状态')
    if (status === 'reflected' && !validTrade(trade)) status = 'invalid-response'
    counts[status]++
    if (row.condition === 'yesterday') continue
    const target = expected[row.condition]
    if (!validTrade(target, true)) throw Error('分支缺少有效预期')
    const actual = status === 'reflected' ? trade : null
    const detail = { attempt: index + 1, condition: row.condition, status, expected: target, actual }
    if (target.kind === 'forced_choice') {
      trials++
      detail.correct = actual?.kind === target.kind && actual.kept === target.kept && actual.sacrificed === target.sacrificed
      if (detail.correct) correct++
    } else if (target.kind === 'none') {
      noneTrials++
      if (actual) noneValid++
      if (actual?.kind === 'forced_choice') falsePositives++
    } else {
      unclearTrials++
      if (actual?.kind === 'forced_choice') unclearForced.push({ case: row.case, ...detail })
    }
    details[row.case].push(detail)
  }
  const n = report.results.length
  const failed = counts.unavailable + counts['invalid-response']
  return {
    attempts: n, planned: report.requests?.length ?? null,
    forced: { trials, correct, accuracy: rate(correct, trials), lower95: trials ? 1 - upper95(trials-correct, trials) : null },
    none: { trials: noneTrials, valid: noneValid, falsePositives, upper95: upper95(falsePositives, noneValid) },
    unclear: { trials: unclearTrials, forcedForReview: unclearForced },
    failures: { count: failed, rate: rate(failed, n), byStatus: counts, totalWithoutAppraisal: n - counts.reflected },
    byCase: details
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('用法：node score.mjs 结果.json')
  const casesFile = fs.readFileSync(new URL('cases.json', import.meta.url))
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const hash = report.files?.['cases.json']
  if (hash && hash !== createHash('sha256').update(casesFile).digest('hex')) throw Error('报告的题集指纹与当前 cases.json 不符')
  console.log(JSON.stringify(score(JSON.parse(casesFile), report), null, 2))
}
