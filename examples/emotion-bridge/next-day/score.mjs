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
  const forcedByCase = new Map()
  const flags = { tradeoff_unacknowledged: 0, missingOnReflected: 0 }
  const counts = Object.fromEntries(statuses.map(s => [s, 0]))
  for (const [index, row] of report.results.entries()) {
    const expected = byCase.get(row.case)
    if (!expected || !['yesterday', 'a', 'b', 'control'].includes(row.condition)) throw Error('结果和题集不匹配')
    const trade = row.appraisal?.tradeoff
    let status = row.status
    if (!statuses.includes(status)) throw Error('未知结果状态')
    if (status === 'reflected' && !validTrade(trade)) status = 'invalid-response'
    counts[status]++
    if (status === 'reflected') {
      if (!Array.isArray(row.flags)) flags.missingOnReflected++
      else if (row.flags.includes('tradeoff_unacknowledged')) flags.tradeoff_unacknowledged++
    }
    if (row.condition === 'yesterday') continue
    const target = expected[row.condition]
    if (!validTrade(target, true)) throw Error('分支缺少有效预期')
    const actual = status === 'reflected' ? trade : null
    const detail = { attempt: index + 1, condition: row.condition, status, expected: target, actual, flags: row.flags ?? null }
    if (target.kind === 'forced_choice') {
      trials++
      detail.correct = actual?.kind === target.kind && actual.kept === target.kept && actual.sacrificed === target.sacrificed
      if (detail.correct) correct++
      const perCase = forcedByCase.get(row.case) ?? { trials: 0, correct: 0 }
      perCase.trials++
      if (detail.correct) perCase.correct++
      forcedByCase.set(row.case, perCase)
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
  // 两种「没拿到有效回答」的口径都报，别挑小的那个：
  //   count —— 结构化失效（unavailable + invalid-response），这是设计里的失效率分子；
  //   all   —— 所有没给出 appraisal 的尝试（再含 skipped / provider-error）。
  const failed = counts.unavailable + counts['invalid-response']
  const withoutAppraisal = n - counts.reflected
  const planned = report.requests?.length ?? null
  return {
    attempts: n, planned,
    // planned 只是回显不等于 attempts 时，缺的行既不进分母也不进失效，区间会偏乐观。
    coverage: { planned, attempts: n, missing: planned === null ? null : Math.max(0, planned - n), complete: planned === null ? null : planned === n },
    forced: {
      trials, correct, accuracy: rate(correct, trials), lower95: trials ? 1 - upper95(trials-correct, trials) : null,
      byCase: Object.fromEntries(forcedByCase)
    },
    // 无取舍分支的假阳性上界按该分支全部尝试算，和明确取舍把失效留在分母一致；
    // 另给只按有效回答算的上界（更保守），两个都报，别只看小的那个。
    none: {
      trials: noneTrials, valid: noneValid, falsePositives,
      upper95: upper95(falsePositives, noneTrials), upper95Valid: upper95(falsePositives, noneValid)
    },
    unclear: { trials: unclearTrials, forcedForReview: unclearForced },
    // complete=false 说明这批成功回答里有缺 flags 的（旧报告），抽查计数不完整，别当成「没有回避」。
    failures: {
      count: failed, rate: rate(failed, n), all: withoutAppraisal, allRate: rate(withoutAppraisal, n),
      byStatus: counts, totalWithoutAppraisal: withoutAppraisal
    },
    flags: { ...flags, complete: flags.missingOnReflected === 0 }, byCase: details,
    // 读数前先看这两条，别把区间当结论。
    caveats: [
      '区间按每次尝试独立计算；同题重复采样的次数并不独立，逐题看 forced.byCase。',
      '对照组假阳性上界受 appraisal 提示词里「在 now 里写清」的旧措辞影响，不能单独当结论。'
    ]
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('用法：node score.mjs 结果.json')
  const casesFile = fs.readFileSync(new URL('cases.json', import.meta.url))
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const hash = report.files?.['cases.json']
  if (!hash) throw Error('报告缺少题集指纹，无法确认与当前 cases.json 同源')
  if (hash !== createHash('sha256').update(casesFile).digest('hex')) throw Error('报告的题集指纹与当前 cases.json 不符')
  console.log(JSON.stringify(score(JSON.parse(casesFile), report), null, 2))
}
