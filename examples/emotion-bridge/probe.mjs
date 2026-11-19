// Optional paid probe on ten synthetic cases. Usage: node probe.mjs RESULT_FILE
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { selfExperience } from '../../packages/core/index.js'
import { reflectOnExperience, format, evidenceRules } from './appraisal.mjs'
import { requestCompletion } from './deepseek.mjs'

const casesFile = new URL('./cases.json', import.meta.url)
const cases = JSON.parse(fs.readFileSync(casesFile))
const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash'
const output = process.argv[2]
if (!output || !process.env.DEEPSEEK_API_KEY) throw Error('Supply an output filename and DEEPSEEK_API_KEY')
const settings = { model, temperature: 0.4, max_tokens: 8192, response_format: { type: 'json_object' } }
const report = {
  model, settings,
  casesHash: crypto.createHash('sha256').update(fs.readFileSync(casesFile)).digest('hex'),
  results: []
}
fs.writeFileSync(output, JSON.stringify(report), { flag: 'wx' })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appraisal-probe-'))

async function run(item, i) {
  const [name, text, thought, effect, extra, agency, control, kind] = item
  const mixed = kind === 'frustrated'
  const changed = kind === 'reconsider' || kind === 'no-change'
  const row = selfExperience.addExperience(dir, { text, thought, scene: mixed || changed ? '' : extra, unfinished: mixed ? extra : '' })
  if (changed) {
    const r = selfExperience.reviseExperience(dir, {id:row.id,thought:extra})
    if (!r.ok) throw Error(r.error)
  }
  for (const arm of i % 2 ? ['guided','baseline'] : ['baseline','guided']) {
    const result = { name, arm }
    try {
      const reply = await reflectOnExperience({ enabled:true, chatKey:'local:owner', dir, id:row.id,
        generate: async messages => {
          if (arm === 'baseline') messages[0] = { role: 'system', content: ['回想这段虚构经历，填写表格。', format, evidenceRules].join('\n') }
          result.requestHash = crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex')
          const response = await requestCompletion(messages, settings)
          result.usage = response.usage
          result.responseModel = response.model
          result.raw = response.text
          result.finishReason = response.finishReason
          if (response.finishReason !== 'stop') throw Error('Incomplete provider response: ' + response.finishReason)
          return JSON.parse(response.text)
        }
      })
      result.status = reply.status
      if (reply.status === 'reflected') {
        const a = reply.appraisal
        result.checks = {
          goals: effect === 'unknown' ? a.perspectives.length === 0 : a.perspectives.some(p => p.goal === 'thought' && p.effect === effect),
          mixed: !mixed || a.perspectives.some(p => p.goal === 'unfinished' && p.effect === 'frustrated'),
          agency: a.agency.value === agency,
          control: a.control.value === control,
          now: Boolean(a.now) === (kind === 'reconsider')
        }
      }
    } catch (e) { result.error = e.message }
    report.results.push(result)
    fs.writeFileSync(output, JSON.stringify(report, null, 2))
    const outcome = result.checks ? Object.values(result.checks).every(Boolean) : result.status
    console.log(name, arm, result.error || outcome)
    if (result.error?.startsWith('Provider HTTP')) throw Error(result.error)
  }
}
try {
  // Bounded batches so failures settle before temporary files are removed.
  for (let i = 0; i < cases.length; i += 3) {
    const batch = await Promise.allSettled(cases.slice(i,i+3).map((c,n) => run(c,i+n)))
    const err = batch.find(x => x.status === 'rejected')
    if (err) throw err.reason
  }
} finally { fs.rmSync(dir,{recursive:true,force:true}) }
